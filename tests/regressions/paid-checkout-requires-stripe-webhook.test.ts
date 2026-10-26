/**
 * Paid checkout is offered only while the Stripe webhook could record the sale.
 *
 * GET /api/create-checkout/availability, which /post-job, the checkout page,
 * the employer dashboard and the edit page read before they offer Pay or
 * Renew, combined the ENABLE_PAID_POSTING flag with STRIPE_SECRET_KEY and
 * never looked at STRIPE_WEBHOOK_SECRET; POST /api/create-checkout and POST
 * /api/create-renewal-checkout did the same. POST /api/webhooks/stripe
 * answers 503 without that secret, so a buyer could pay for a post or a
 * renewal that the webhook never recorded, and whose refunds and disputes it
 * would never see. Backlog 2.16 closed the same gap for the Employer plan
 * (since retired: its code and that test were deleted in phase 4 of the
 * 2027 re-price), and lib/post-pack-sale.ts applies it to the 5-post pack.
 *
 * Each case sets one environment and asks both sides, through the real
 * lib/env: the availability signal and the real webhook route. Checkout may
 * be offered only where the webhook gets past its own configuration check,
 * so the two cannot drift apart unnoticed: if the webhook comes to require
 * something this environment lacks, the first case fails, and the new
 * requirement belongs in the table below.
 *
 * tests/regressions/paid-posting-checkout-gate.test.ts pins that the two
 * checkout routes refuse with 503 STRIPE_NOT_CONFIGURED in the same
 * environments.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

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

/** Everything a paid checkout needs. */
const SELLABLE = {
    ENABLE_PAID_POSTING: 'true',
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_WEBHOOK_SECRET: 'whsec_x',
    // lib/env requires it; tests/setup.ts sets the other required variables.
    CRON_SECRET: 'unit-test-cron-secret',
} as const;

// A fresh import of the availability route can outlast vitest's 5 second
// default when a full run saturates the workers.
const FRESH_IMPORT_TIMEOUT_MS = 20_000;

let webhookPost: (request: NextRequest) => Promise<Response>;

// The webhook reads both secrets on every request, so one instance of the
// route serves every case. The availability route reads them through
// lib/env, which caches its first parse, so each case loads it on a fresh
// module graph; it is loaded once here so that its cold load is not charged
// to a test.
beforeAll(async () => {
    ({ POST: webhookPost } = await import('@/app/api/webhooks/stripe/route'));
    await import('@/app/api/create-checkout/availability/route');
}, 60_000);

afterEach(() => {
    vi.unstubAllEnvs();
});

/** What the availability signal and the webhook each answer under one environment. */
async function answersUnder(overrides: Partial<Record<keyof typeof SELLABLE, string | undefined>> = {}) {
    const environment: Record<string, string | undefined> = { ...SELLABLE, ...overrides };
    for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value);
    vi.resetModules();
    const { GET } = await import('@/app/api/create-checkout/availability/route');
    const availability = await (await GET()).json();
    const webhook = await webhookPost(
        new NextRequest('https://nphiring.test/api/webhooks/stripe', {
            method: 'POST',
            headers: { 'stripe-signature': 'unsigned' },
            body: '{}',
        }),
    );
    return { availability, webhookStatus: webhook.status };
}

describe('paid checkout is offered only while the webhook could record the sale', () => {
    it('is offered once the key and the webhook secret are both set', async () => {
        const { availability, webhookStatus } = await answersUnder();
        // 400, not 503: the request passed the configuration check and failed its signature.
        expect(webhookStatus).toBe(400);
        expect(availability).toEqual({ available: true });
    }, FRESH_IMPORT_TIMEOUT_MS);

    it.each([
        ['STRIPE_SECRET_KEY is unset', { STRIPE_SECRET_KEY: undefined }],
        ['STRIPE_SECRET_KEY is empty', { STRIPE_SECRET_KEY: '' }],
        ['STRIPE_WEBHOOK_SECRET is unset', { STRIPE_WEBHOOK_SECRET: undefined }],
        ['STRIPE_WEBHOOK_SECRET is empty', { STRIPE_WEBHOOK_SECRET: '' }],
        ['both secrets are unset', { STRIPE_SECRET_KEY: undefined, STRIPE_WEBHOOK_SECRET: undefined }],
    ])('is not offered when %s: the webhook answers 503', async (_label, missing) => {
        const { availability, webhookStatus } = await answersUnder(missing);
        expect(webhookStatus).toBe(503);
        expect(availability).toEqual({ available: false, code: 'STRIPE_NOT_CONFIGURED' });
    }, FRESH_IMPORT_TIMEOUT_MS);
});
