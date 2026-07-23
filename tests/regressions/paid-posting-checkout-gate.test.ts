/**
 * Regression (F3, audit high) — the checkout APIs must gate on the real
 * ENABLE_PAID_POSTING flag with stable machine-readable 503 codes:
 *   - flag off                    → 503 { code: 'PAID_POSTING_DISABLED' }
 *   - flag on, Stripe key missing → 503 { code: 'STRIPE_NOT_CONFIGURED' }
 *   - both on                     → the gate passes (request proceeds to
 *                                   auth/validation, NOT a 503)
 * Also pins GET /api/create-checkout/availability — the server-checked
 * signal /post-job uses to show "paid posting coming soon" BEFORE the form.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const envMock = vi.hoisted(() => ({ paidPostingEnabled: false }));

vi.mock('@/lib/env', () => ({
    isFeatureEnabled: vi.fn((feature: string) => feature === 'paidPosting' && envMock.paidPostingEnabled),
    getPaidPostingStatus: vi.fn(() => {
        const enabled = envMock.paidPostingEnabled;
        const stripeConfigured = !!process.env.STRIPE_SECRET_KEY;
        return { enabled, stripeConfigured, available: enabled && stripeConfigured };
    }),
    getEnv: vi.fn(() => ({})),
    getBaseUrl: vi.fn(() => 'http://localhost:3000'),
}));

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

beforeEach(() => {
    envMock.paidPostingEnabled = false;
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
    it('503 PAID_POSTING_DISABLED when the flag is off, even with Stripe configured', async () => {
        process.env.STRIPE_SECRET_KEY = 'sk_test_x';
        const { POST } = await import('@/app/api/create-checkout/route');
        const res = await POST(makePost('https://test.local/api/create-checkout'));
        expect(res.status).toBe(503);
        const body = await res.json();
        expect(body.code).toBe('PAID_POSTING_DISABLED');
        expect(body.error).toBeTruthy();
    });

    it('503 STRIPE_NOT_CONFIGURED when the flag is on but the key is missing', async () => {
        envMock.paidPostingEnabled = true;
        const { POST } = await import('@/app/api/create-checkout/route');
        const res = await POST(makePost('https://test.local/api/create-checkout'));
        expect(res.status).toBe(503);
        const body = await res.json();
        expect(body.code).toBe('STRIPE_NOT_CONFIGURED');
    });

    it('passes the gate (proceeds to auth, not 503) when flag + key are both set', async () => {
        envMock.paidPostingEnabled = true;
        process.env.STRIPE_SECRET_KEY = 'sk_test_x';
        const { POST } = await import('@/app/api/create-checkout/route');
        const res = await POST(makePost('https://test.local/api/create-checkout'));
        // Outside a request scope Supabase auth fails → 401. The point is:
        // NOT a 503 — the availability gate itself let the request through.
        expect(res.status).not.toBe(503);
    });
});

describe('F3 — POST /api/create-renewal-checkout flag gate', () => {
    it('503 PAID_POSTING_DISABLED when the flag is off', async () => {
        process.env.STRIPE_SECRET_KEY = 'sk_test_x';
        const { POST } = await import('@/app/api/create-renewal-checkout/route');
        const res = await POST(makePost('https://test.local/api/create-renewal-checkout'));
        expect(res.status).toBe(503);
        const body = await res.json();
        expect(body.code).toBe('PAID_POSTING_DISABLED');
    });

    it('503 STRIPE_NOT_CONFIGURED when the flag is on but the key is missing', async () => {
        envMock.paidPostingEnabled = true;
        const { POST } = await import('@/app/api/create-renewal-checkout/route');
        const res = await POST(makePost('https://test.local/api/create-renewal-checkout'));
        expect(res.status).toBe(503);
        const body = await res.json();
        expect(body.code).toBe('STRIPE_NOT_CONFIGURED');
    });

    it('passes the gate (400 missing fields, not 503) when flag + key are both set', async () => {
        envMock.paidPostingEnabled = true;
        process.env.STRIPE_SECRET_KEY = 'sk_test_x';
        const { POST } = await import('@/app/api/create-renewal-checkout/route');
        const res = await POST(makePost('https://test.local/api/create-renewal-checkout'));
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toContain('Missing required fields');
    });
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

    it('reports available when flag + key are both set', async () => {
        envMock.paidPostingEnabled = true;
        process.env.STRIPE_SECRET_KEY = 'sk_test_x';
        const { GET } = await import('@/app/api/create-checkout/availability/route');
        const res = await GET();
        const body = await res.json();
        expect(body).toEqual({ available: true });
    });
});
