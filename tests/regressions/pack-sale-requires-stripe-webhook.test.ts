/**
 * Backlog 2.16 and register 2.26: the 5-post pack is on sale only while the
 * Stripe webhook could record the sale, and a Stripe secret of nothing but
 * whitespace counts as unset.
 *
 * These cases pinned the retired Employer plan's sale gate
 * (tests/regressions/plan-sale-requires-stripe-webhook.test.ts, deleted with
 * the plan code in phase 4 of the 2027 re-price). They moved here, onto the
 * pack's gate, so lib/clean-secret.ts keeps a test (security review F3,
 * 2026-10-27).
 *
 * Each case sets one environment and asks both sides: the real gate
 * (lib/post-pack-sale.ts#packSaleClosedReason) through the real lib/env, and
 * the real webhook route. The pack may be on sale only where the webhook gets
 * past its own configuration check, so the two cannot drift apart unnoticed:
 * if the webhook comes to require something this environment lacks, the
 * first case fails, and the new requirement belongs in the table below.
 *
 * tests/lib/post-pack-sale.test.ts pins the rest of the gate (the flag, the
 * promo, the order of the reasons) against a mocked lib/env.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { config } from '@/lib/config';

// A configured webhook stops an unsigned request at its signature check, so
// no case here reaches an event handler or the database.
vi.mock('stripe', () => ({
    default: vi.fn().mockImplementation(() => ({
        webhooks: {
            constructEvent: vi.fn().mockImplementation(() => {
                throw new Error('No signatures found matching the expected signature for payload');
            }),
        },
    })),
}));
// The webhook's alert channel, stubbed as in the other webhook suites.
vi.mock('@/lib/discord-notifier', () => ({ sendDiscordMessage: vi.fn().mockResolvedValue(true) }));

const AFTER_PROMO = new Date(Date.parse(config.promoEndsAt) + 60 * 60 * 1000);

/** Everything a pack sale needs once the promo is over. */
const SELLABLE = {
    ENABLE_PAID_POSTING: 'true',
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_WEBHOOK_SECRET: 'whsec_x',
    // lib/env requires it; tests/setup.ts sets the other required variables.
    CRON_SECRET: 'unit-test-cron-secret',
} as const;

// A fresh import of the gate can outlast vitest's 5 second default when a
// full run saturates the workers.
const FRESH_IMPORT_TIMEOUT_MS = 20_000;

let webhookPost: (request: NextRequest) => Promise<Response>;

// The webhook reads both secrets on every request, so one instance of the
// route serves every case. The gate reads them through lib/env, which caches
// its first parse, so each case loads the gate on a fresh module graph; it is
// loaded once here so that its cold load is not charged to a test.
beforeAll(async () => {
    ({ POST: webhookPost } = await import('@/app/api/webhooks/stripe/route'));
    await import('@/lib/post-pack-sale');
}, 60_000);

afterEach(() => {
    vi.unstubAllEnvs();
});

/** What the pack gate and the webhook each answer under one environment. */
async function answersUnder(overrides: Partial<Record<keyof typeof SELLABLE, string | undefined>> = {}) {
    const environment: Record<string, string | undefined> = { ...SELLABLE, ...overrides };
    for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value);
    vi.resetModules();
    const { packSaleClosedReason } = await import('@/lib/post-pack-sale');
    const webhook = await webhookPost(
        new NextRequest('https://nphiring.test/api/webhooks/stripe', {
            method: 'POST',
            headers: { 'stripe-signature': 'unsigned' },
            body: '{}',
        }),
    );
    return { closedReason: packSaleClosedReason(AFTER_PROMO), webhookStatus: webhook.status };
}

describe('backlog 2.16: the pack is sold only while the webhook could record the sale', () => {
    it('is on sale once the key and the webhook secret are both set', async () => {
        const { closedReason, webhookStatus } = await answersUnder();
        // 400, not 503: the request passed the configuration check and failed its signature.
        expect(webhookStatus).toBe(400);
        expect(closedReason).toBeNull();
    }, FRESH_IMPORT_TIMEOUT_MS);

    it.each([
        ['STRIPE_SECRET_KEY is unset', { STRIPE_SECRET_KEY: undefined }],
        ['STRIPE_SECRET_KEY is empty', { STRIPE_SECRET_KEY: '' }],
        ['STRIPE_WEBHOOK_SECRET is unset', { STRIPE_WEBHOOK_SECRET: undefined }],
        ['STRIPE_WEBHOOK_SECRET is empty', { STRIPE_WEBHOOK_SECRET: '' }],
        ['both secrets are unset', { STRIPE_SECRET_KEY: undefined, STRIPE_WEBHOOK_SECRET: undefined }],
        // Register 2.26: a value of spaces passed every "is it set" check, so
        // a sale could open while the webhook could verify nothing.
        ['STRIPE_SECRET_KEY is only spaces', { STRIPE_SECRET_KEY: '   ' }],
        ['STRIPE_WEBHOOK_SECRET is only whitespace', { STRIPE_WEBHOOK_SECRET: ' \n\t ' }],
    ])('is closed when %s: the webhook answers 503', async (_label, missing) => {
        const { closedReason, webhookStatus } = await answersUnder(missing);
        expect(webhookStatus).toBe(503);
        expect(closedReason).toBe('STRIPE_NOT_CONFIGURED');
    }, FRESH_IMPORT_TIMEOUT_MS);

    it('reads a secret pasted with stray whitespace as the secret itself', async () => {
        const { closedReason, webhookStatus } = await answersUnder({ STRIPE_SECRET_KEY: ' sk_test_x\n', STRIPE_WEBHOOK_SECRET: 'whsec_x\n' });
        expect(webhookStatus).toBe(400);
        expect(closedReason).toBeNull();
    }, FRESH_IMPORT_TIMEOUT_MS);
});
