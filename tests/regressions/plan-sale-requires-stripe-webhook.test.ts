/**
 * Backlog 2.16: the Employer plan is on sale only while the Stripe webhook
 * could record the sale.
 *
 * isPlanSaleOpen (lib/employer-plan-link.ts) read the Payment Link, the
 * ENABLE_PAID_POSTING flag and the promo clock, never the Stripe secrets. With
 * the flag on after the promo and a valid https://buy.stripe.com/ link, the
 * /pricing plan card and GET /api/employer/plan/subscribe sent a buyer to
 * Stripe while POST /api/webhooks/stripe still answered 503 for want of
 * STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET: the subscription was paid and
 * the webhook recorded nothing. Without the key the daily plan reconciliation
 * could not recover it either; without the webhook secret only that sweep
 * could, about a day later.
 *
 * Each case sets one environment and asks both sides: the real gate, through
 * the real lib/env, and the real webhook route. The sale may be open only
 * where the webhook gets past its own configuration check, so the two cannot
 * drift apart unnoticed: if the webhook comes to require something this
 * environment lacks, the first case fails, and the new requirement belongs
 * in the table below.
 *
 * tests/lib/employer-plan-link.test.ts pins the rest of the gate (the link
 * format, the flag, the promo, the account reference) against a mocked
 * lib/env.
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

const LINK = 'https://buy.stripe.com/test_abc123';
const AFTER_PROMO = new Date(Date.parse(config.promoEndsAt) + 60 * 60 * 1000);
const BUYER = { userId: 'user-uuid-1', email: 'owner@clinic.example' };

/** Everything a plan sale needs once the promo is over. */
const SELLABLE = {
    ENABLE_PAID_POSTING: 'true',
    STRIPE_PLAN_PAYMENT_LINK: LINK,
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
    await import('@/lib/employer-plan-link');
}, 60_000);

afterEach(() => {
    vi.unstubAllEnvs();
});

/** What the plan gate and the webhook each answer under one environment. */
async function answersUnder(overrides: Partial<Record<keyof typeof SELLABLE, string | undefined>> = {}) {
    const environment: Record<string, string | undefined> = { ...SELLABLE, ...overrides };
    for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value);
    vi.resetModules();
    const { isPlanSaleOpen, buildPlanPaymentLink } = await import('@/lib/employer-plan-link');
    const webhook = await webhookPost(
        new NextRequest('https://nphiring.test/api/webhooks/stripe', {
            method: 'POST',
            headers: { 'stripe-signature': 'unsigned' },
            body: '{}',
        }),
    );
    return {
        saleOpen: isPlanSaleOpen(AFTER_PROMO),
        link: buildPlanPaymentLink(BUYER, AFTER_PROMO),
        webhookStatus: webhook.status,
    };
}

describe('backlog 2.16: the plan is sold only while the webhook could record the sale', () => {
    it('is on sale, with the account-bound link, once the key and the webhook secret are both set', async () => {
        const { saleOpen, link, webhookStatus } = await answersUnder();
        // 400, not 503: the request passed the configuration check and failed its signature.
        expect(webhookStatus).toBe(400);
        expect(saleOpen).toBe(true);
        expect(link).toBe(`${LINK}?client_reference_id=${BUYER.userId}&prefilled_email=${encodeURIComponent(BUYER.email)}`);
    }, FRESH_IMPORT_TIMEOUT_MS);

    it.each([
        ['STRIPE_SECRET_KEY is unset', { STRIPE_SECRET_KEY: undefined }],
        ['STRIPE_SECRET_KEY is empty', { STRIPE_SECRET_KEY: '' }],
        ['STRIPE_WEBHOOK_SECRET is unset', { STRIPE_WEBHOOK_SECRET: undefined }],
        ['STRIPE_WEBHOOK_SECRET is empty', { STRIPE_WEBHOOK_SECRET: '' }],
        ['both secrets are unset', { STRIPE_SECRET_KEY: undefined, STRIPE_WEBHOOK_SECRET: undefined }],
        // Register 2.26: a value of spaces passed every "is it set" check, so
        // the plan was sold while the webhook could verify nothing.
        ['STRIPE_SECRET_KEY is only spaces', { STRIPE_SECRET_KEY: '   ' }],
        ['STRIPE_WEBHOOK_SECRET is only whitespace', { STRIPE_WEBHOOK_SECRET: ' \n\t ' }],
    ])('is closed, and hands out no link, when %s: the webhook answers 503', async (_label, missing) => {
        const { saleOpen, link, webhookStatus } = await answersUnder(missing);
        expect(webhookStatus).toBe(503);
        expect(saleOpen).toBe(false);
        expect(link).toBeNull();
    }, FRESH_IMPORT_TIMEOUT_MS);

    it('reads a secret pasted with stray whitespace as the secret itself', async () => {
        const { saleOpen, webhookStatus } = await answersUnder({ STRIPE_SECRET_KEY: ' sk_test_x\n', STRIPE_WEBHOOK_SECRET: 'whsec_x\n' });
        expect(webhookStatus).toBe(400);
        expect(saleOpen).toBe(true);
    }, FRESH_IMPORT_TIMEOUT_MS);
});
