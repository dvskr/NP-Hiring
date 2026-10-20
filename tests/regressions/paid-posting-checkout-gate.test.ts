/**
 * Regression (F3, audit high) — the checkout APIs must gate on the real
 * ENABLE_PAID_POSTING flag with stable machine-readable 503 codes:
 *   - flag off                    → 503 { code: 'PAID_POSTING_DISABLED' }
 *   - flag on, Stripe key missing → 503 { code: 'STRIPE_NOT_CONFIGURED' }
 *   - flag and key on, webhook secret missing
 *                                 → 503 { code: 'STRIPE_NOT_CONFIGURED' }
 *   - all three set               → the gate passes (request proceeds to
 *                                   auth/validation, NOT a 503)
 * Also pins GET /api/create-checkout/availability — the server-checked
 * signal /post-job uses to show "paid posting coming soon" BEFORE the form.
 *
 * The webhook secret: POST /api/webhooks/stripe answers 503 without
 * STRIPE_WEBHOOK_SECRET, so a post or renewal paid for then is never
 * recorded by the webhook, and its refunds and disputes never reach it. The
 * same rule closes plan sales (lib/employer-plan-link.ts#isPlanSaleOpen);
 * tests/regressions/paid-checkout-requires-stripe-webhook.test.ts holds the
 * availability signal to the real webhook.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';

const envMock = vi.hoisted(() => ({ paidPostingEnabled: false, webhookSecret: undefined as string | undefined }));

vi.mock('@/lib/env', () => ({
    isFeatureEnabled: vi.fn((feature: string) => feature === 'paidPosting' && envMock.paidPostingEnabled),
    getPaidPostingStatus: vi.fn(() => {
        const enabled = envMock.paidPostingEnabled;
        const stripeConfigured = !!process.env.STRIPE_SECRET_KEY;
        return { enabled, stripeConfigured, available: enabled && stripeConfigured };
    }),
    getEnv: vi.fn(() => ({ STRIPE_WEBHOOK_SECRET: envMock.webhookSecret })),
    getBaseUrl: vi.fn(() => 'http://localhost:3000'),
}));

/** The webhook secret is set unless a case says otherwise: each case varies one input. */
const WEBHOOK_SECRET_MISSING: ReadonlyArray<[string, string | undefined]> = [['unset', undefined], ['empty', '']];

vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn().mockResolvedValue(null),
    RATE_LIMITS: { postJob: { limit: 100, windowMs: 60_000 } },
}));

function makePost(url: string): NextRequest {
    return new NextRequest(url, {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'content-type': 'application/json' },
    });
}

const savedStripeKey = process.env.STRIPE_SECRET_KEY;

// The checkout routes' cold import (Stripe SDK + lib/pricing + lib/expires-at
// since the 2026-09-12 ladder change) can exceed vitest's 5s default under a
// full parallel run; the first test in each describe pays for it.
const COLD_IMPORT_TIMEOUT_MS = 20_000;

beforeEach(() => {
    envMock.paidPostingEnabled = false;
    envMock.webhookSecret = 'whsec_x';
    delete process.env.STRIPE_SECRET_KEY;
});

afterEach(() => {
    if (savedStripeKey === undefined) {
        delete process.env.STRIPE_SECRET_KEY;
    } else {
        process.env.STRIPE_SECRET_KEY = savedStripeKey;
    }
});

describe('F3 — POST /api/create-checkout flag gate', () => {
    // The route's cold import (stripe SDK, prisma, supabase) can exceed the 5 s
    // per-test budget when the full suite saturates the workers. Warm the module
    // cache here with its own budget; the Stripe client is created per request
    // and env is read at call time, so this changes no assertion below.
    beforeAll(async () => {
        await import('@/app/api/create-checkout/route');
    }, 60_000);

    it('503 PAID_POSTING_DISABLED when the flag is off, even with Stripe configured', async () => {
        process.env.STRIPE_SECRET_KEY = 'sk_test_x';
        const { POST } = await import('@/app/api/create-checkout/route');
        const res = await POST(makePost('https://test.local/api/create-checkout'));
        expect(res.status).toBe(503);
        const body = await res.json();
        expect(body.code).toBe('PAID_POSTING_DISABLED');
        expect(body.error).toBeTruthy();
    }, COLD_IMPORT_TIMEOUT_MS);

    it('503 STRIPE_NOT_CONFIGURED when the flag is on but the key is missing', async () => {
        envMock.paidPostingEnabled = true;
        const { POST } = await import('@/app/api/create-checkout/route');
        const res = await POST(makePost('https://test.local/api/create-checkout'));
        expect(res.status).toBe(503);
        const body = await res.json();
        expect(body.code).toBe('STRIPE_NOT_CONFIGURED');
    }, COLD_IMPORT_TIMEOUT_MS);

    it.each(WEBHOOK_SECRET_MISSING)('503 STRIPE_NOT_CONFIGURED when the flag and key are set but the webhook secret is %s', async (_label, secret) => {
        envMock.paidPostingEnabled = true;
        process.env.STRIPE_SECRET_KEY = 'sk_test_x';
        envMock.webhookSecret = secret;
        const { POST } = await import('@/app/api/create-checkout/route');
        const res = await POST(makePost('https://test.local/api/create-checkout'));
        expect(res.status).toBe(503);
        const body = await res.json();
        expect(body).toEqual({ error: 'Paid checkout is currently unavailable', code: 'STRIPE_NOT_CONFIGURED' });
    }, COLD_IMPORT_TIMEOUT_MS);

    it('passes the gate (proceeds to auth, not 503) when the flag, the key and the webhook secret are all set', async () => {
        envMock.paidPostingEnabled = true;
        process.env.STRIPE_SECRET_KEY = 'sk_test_x';
        const { POST } = await import('@/app/api/create-checkout/route');
        const res = await POST(makePost('https://test.local/api/create-checkout'));
        // During the launch promo the route answers 409 PROMO_ACTIVE; after
        // it, Supabase auth fails outside a request scope → 401. The point is:
        // NOT a 503 — the availability gate itself let the request through.
        expect(res.status).not.toBe(503);
    }, COLD_IMPORT_TIMEOUT_MS);
});

describe('F3 — POST /api/create-renewal-checkout flag gate', () => {
    // Same warm-up as the create-checkout describe: the first case here used
    // to pay the route's cold import inside its own budget.
    beforeAll(async () => {
        await import('@/app/api/create-renewal-checkout/route');
    }, 60_000);

    it('503 PAID_POSTING_DISABLED when the flag is off', async () => {
        process.env.STRIPE_SECRET_KEY = 'sk_test_x';
        const { POST } = await import('@/app/api/create-renewal-checkout/route');
        const res = await POST(makePost('https://test.local/api/create-renewal-checkout'));
        expect(res.status).toBe(503);
        const body = await res.json();
        expect(body.code).toBe('PAID_POSTING_DISABLED');
    }, COLD_IMPORT_TIMEOUT_MS);

    it('503 STRIPE_NOT_CONFIGURED when the flag is on but the key is missing', async () => {
        envMock.paidPostingEnabled = true;
        const { POST } = await import('@/app/api/create-renewal-checkout/route');
        const res = await POST(makePost('https://test.local/api/create-renewal-checkout'));
        expect(res.status).toBe(503);
        const body = await res.json();
        expect(body.code).toBe('STRIPE_NOT_CONFIGURED');
    }, COLD_IMPORT_TIMEOUT_MS);

    it.each(WEBHOOK_SECRET_MISSING)('503 STRIPE_NOT_CONFIGURED when the flag and key are set but the webhook secret is %s, before the post is read', async (_label, secret) => {
        envMock.paidPostingEnabled = true;
        process.env.STRIPE_SECRET_KEY = 'sk_test_x';
        envMock.webhookSecret = secret;
        const { POST } = await import('@/app/api/create-renewal-checkout/route');
        const res = await POST(makePost('https://test.local/api/create-renewal-checkout'));
        expect(res.status).toBe(503);
        const body = await res.json();
        expect(body).toEqual({ error: 'Paid checkout is currently unavailable', code: 'STRIPE_NOT_CONFIGURED' });
        expect(prisma.employerJob.findFirst).not.toHaveBeenCalled();
    }, COLD_IMPORT_TIMEOUT_MS);

    it('passes the gate (400 missing fields, not 503) when the flag, the key and the webhook secret are all set', async () => {
        envMock.paidPostingEnabled = true;
        process.env.STRIPE_SECRET_KEY = 'sk_test_x';
        const { POST } = await import('@/app/api/create-renewal-checkout/route');
        const res = await POST(makePost('https://test.local/api/create-renewal-checkout'));
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toContain('Missing required fields');
    }, COLD_IMPORT_TIMEOUT_MS);
});

describe('F3 — GET /api/create-checkout/availability', () => {
    it('reports unavailable with PAID_POSTING_DISABLED when the flag is off', async () => {
        const { GET } = await import('@/app/api/create-checkout/availability/route');
        const res = await GET();
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual({ available: false, code: 'PAID_POSTING_DISABLED' });
    });

    it('reports unavailable with STRIPE_NOT_CONFIGURED when only the flag is on', async () => {
        envMock.paidPostingEnabled = true;
        const { GET } = await import('@/app/api/create-checkout/availability/route');
        const res = await GET();
        const body = await res.json();
        expect(body).toEqual({ available: false, code: 'STRIPE_NOT_CONFIGURED' });
    });

    it.each(WEBHOOK_SECRET_MISSING)('reports unavailable with STRIPE_NOT_CONFIGURED when the flag and key are set but the webhook secret is %s', async (_label, secret) => {
        envMock.paidPostingEnabled = true;
        process.env.STRIPE_SECRET_KEY = 'sk_test_x';
        envMock.webhookSecret = secret;
        const { GET } = await import('@/app/api/create-checkout/availability/route');
        const res = await GET();
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual({ available: false, code: 'STRIPE_NOT_CONFIGURED' });
    });

    it('reports PAID_POSTING_DISABLED, not a Stripe problem, while the flag is off whatever the secrets', async () => {
        process.env.STRIPE_SECRET_KEY = 'sk_test_x';
        envMock.webhookSecret = undefined;
        const { GET } = await import('@/app/api/create-checkout/availability/route');
        const body = await (await GET()).json();
        expect(body).toEqual({ available: false, code: 'PAID_POSTING_DISABLED' });
    });

    it('reports available when the flag, the key and the webhook secret are all set', async () => {
        envMock.paidPostingEnabled = true;
        process.env.STRIPE_SECRET_KEY = 'sk_test_x';
        const { GET } = await import('@/app/api/create-checkout/availability/route');
        const res = await GET();
        const body = await res.json();
        expect(body).toEqual({ available: true });
    });
});
