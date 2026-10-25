/**
 * POST /api/create-pack-checkout — Stripe Checkout for the 5-post pack
 * (2027 re-price, phase 2; the backend ships dark: nothing links to it).
 *
 * Pins, in the order the route checks them:
 *   - 503 PAID_POSTING_DISABLED while the flag is off, 503
 *     STRIPE_NOT_CONFIGURED without the Stripe key or the webhook secret
 *     (the webhook could not record the sale): the same gate as every paid
 *     route, and as lib/post-pack-sale.ts#isPackSaleOpen;
 *   - 409 PROMO_ACTIVE while the launch promo runs, before the account or
 *     the body is read: every post is free, so a pack would buy nothing;
 *   - 401 signed out, 403 for any account that is not an employer, 400 for
 *     a free-email signup (post-free refuses those accounts, so the credits
 *     could never be spent);
 *   - the session sells exactly config.packPosts posts for
 *     config.stripePackPriceInCents to the signed-in account: its email,
 *     client_reference_id and metadata.userId are the account, never the
 *     request, and metadata.quotaDomain is the signup domain the intro rule
 *     reads; Stripe sends the receipt and an invoice;
 *   - the idempotency key collapses a double click inside one ten-minute
 *     window into one session (expires_at is a function of the window, so a
 *     replay sends identical parameters), and gives a later click its own.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';
import { ANALYTICS_ONLY, CONSENT_COOKIE, serializeConsent } from '@/lib/consent';

const sessionsCreate = vi.fn();
vi.mock('stripe', () => ({
    default: vi.fn().mockImplementation(() => ({ checkout: { sessions: { create: sessionsCreate } } })),
}));

const env = vi.hoisted(() => ({
    isFeatureEnabled: vi.fn(),
    getEnv: vi.fn(),
    getBaseUrl: vi.fn(() => 'http://localhost:3000'),
    getPaidPostingStatus: vi.fn(() => ({ enabled: true, stripeConfigured: true, available: true })),
}));
vi.mock('@/lib/env', () => env);

vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn().mockResolvedValue(null),
    RATE_LIMITS: { postJob: { limit: 100, windowMs: 60_000 } },
}));

const getUserMock = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}));

const DAY_MS = 24 * 60 * 60 * 1000;
const AFTER_PROMO_MS = Date.parse('2027-03-01T12:03:00.000Z');
const WINDOW_MS = 10 * 60 * 1000;

function signedIn(email = 'Owner@Clinic.example', role = 'employer') {
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1', email } }, error: null });
    vi.mocked(prisma.userProfile.findUnique).mockResolvedValue({ role } as never);
}

async function buy(body: unknown = {}, headers: Record<string, string> = {}) {
    const { POST } = await import('@/app/api/create-pack-checkout/route');
    const res = await POST(new NextRequest('https://test.local/api/create-pack-checkout', {
        method: 'POST',
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: { 'content-type': 'application/json', ...headers },
    }));
    return { res, json: await res.json() };
}

const createdParams = () => sessionsCreate.mock.calls[0][0];
const createdKey = () => sessionsCreate.mock.calls[0][1].idempotencyKey as string;

let nowSpy: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
    await import('@/app/api/create-pack-checkout/route');
}, 120_000);

beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    env.isFeatureEnabled.mockImplementation((feature: string) => feature === 'paidPosting');
    env.getEnv.mockReturnValue({ STRIPE_WEBHOOK_SECRET: 'whsec_x' });
    nowSpy = vi.spyOn(Date, 'now').mockReturnValue(AFTER_PROMO_MS);
    vi.spyOn(config, 'isPromoActive').mockReturnValue(false);
    signedIn();
    sessionsCreate.mockResolvedValue({ id: 'cs_pack', url: 'https://checkout.stripe.test/cs_pack' });
});

afterEach(() => {
    nowSpy.mockRestore();
    vi.mocked(config.isPromoActive).mockRestore();
});

describe('the sale gate', () => {
    it('503 PAID_POSTING_DISABLED while paid posting is off, before anything else', async () => {
        env.isFeatureEnabled.mockReturnValue(false);

        const { res, json } = await buy();

        expect(res.status).toBe(503);
        expect(json.code).toBe('PAID_POSTING_DISABLED');
        expect(getUserMock).not.toHaveBeenCalled();
        expect(sessionsCreate).not.toHaveBeenCalled();
    });

    it('503 STRIPE_NOT_CONFIGURED without the Stripe key', async () => {
        delete process.env.STRIPE_SECRET_KEY;

        const { res, json } = await buy();

        expect(res.status).toBe(503);
        expect(json.code).toBe('STRIPE_NOT_CONFIGURED');
        expect(sessionsCreate).not.toHaveBeenCalled();
    });

    it('503 STRIPE_NOT_CONFIGURED without the webhook secret, which the sale could not be recorded without', async () => {
        env.getEnv.mockReturnValue({ STRIPE_WEBHOOK_SECRET: undefined });

        const { res, json } = await buy();

        expect(res.status).toBe(503);
        expect(json.code).toBe('STRIPE_NOT_CONFIGURED');
        expect(sessionsCreate).not.toHaveBeenCalled();
    });

    it('409 PROMO_ACTIVE while the launch promo runs, before the account is read', async () => {
        vi.mocked(config.isPromoActive).mockReturnValue(true);

        const { res, json } = await buy();

        expect(res.status).toBe(409);
        expect(json.code).toBe('PROMO_ACTIVE');
        expect(json.error).toContain(config.ladderStartsLabel);
        expect(json.error).not.toMatch(/[–—]| - /);
        expect(getUserMock).not.toHaveBeenCalled();
        expect(sessionsCreate).not.toHaveBeenCalled();
    });

    it('nothing in the request can switch the promo check off', async () => {
        vi.mocked(config.isPromoActive).mockReturnValue(true);

        const { res } = await buy({ promoActive: false, now: '2027-06-01T00:00:00Z' });

        expect(res.status).toBe(409);
        expect(config.isPromoActive).toHaveBeenCalledWith(expect.any(Date));
    });
});

describe('who can buy', () => {
    it('401 signed out', async () => {
        getUserMock.mockResolvedValue({ data: { user: null }, error: null });

        const { res } = await buy();

        expect(res.status).toBe(401);
        expect(sessionsCreate).not.toHaveBeenCalled();
    });

    it.each(['job_seeker', 'admin'])("403 for a '%s' account: only an employer can buy", async (role) => {
        signedIn('owner@clinic.example', role);

        const { res } = await buy();

        expect(res.status).toBe(403);
        expect(sessionsCreate).not.toHaveBeenCalled();
    });

    it('400 for a free-email signup, whose account could never spend the credits', async () => {
        signedIn('someone@gmail.com');

        const { res, json } = await buy();

        expect(res.status).toBe(400);
        expect(json.error).toBe('Company email required');
        expect(sessionsCreate).not.toHaveBeenCalled();
    });
});

describe('the Checkout Session', () => {
    it('sells config.packPosts posts for config.stripePackPriceInCents to the signed-in account', async () => {
        const { res, json } = await buy();

        expect(res.status).toBe(200);
        expect(json).toEqual({ sessionId: 'cs_pack', url: 'https://checkout.stripe.test/cs_pack' });
        const params = createdParams();
        expect(params.mode).toBe('payment');
        expect(params.line_items).toEqual([{
            price_data: {
                currency: 'usd',
                product_data: {
                    name: '5-post pack',
                    description: `5 job posts, each a ${config.durationDays}-day Featured listing, to use within 12 months`,
                },
                unit_amount: 124500,
            },
            quantity: 1,
        }]);
        expect(params.line_items[0].price_data.unit_amount).toBe(config.stripePackPriceInCents);
        expect(params.customer_email).toBe('Owner@Clinic.example');
        expect(params.client_reference_id).toBe('user-1');
        expect(params.billing_address_collection).toBe('required');
        expect(params.tax_id_collection).toEqual({ enabled: true });
        expect(params.payment_intent_data).toEqual({ receipt_email: 'Owner@Clinic.example' });
        expect(params.invoice_creation).toMatchObject({ enabled: true, invoice_data: { metadata: { type: 'post_pack', sku: 'post-pack-5', userId: 'user-1' } } });
        expect(params.success_url).toBe('http://localhost:3000/employer/post-pack?session_id={CHECKOUT_SESSION_ID}');
        expect(params.cancel_url).toBe('http://localhost:3000/employer/post-pack');
        expect(params.metadata).toEqual({ type: 'post_pack', sku: 'post-pack-5', userId: 'user-1', quotaDomain: 'clinic.example', posts: '5' });
        expect(params).not.toHaveProperty('payment_method_types');
    });

    it('closes within the hour, at an instant every request of the window shares', async () => {
        await buy();

        const expiresAtMs = createdParams().expires_at * 1000;
        expect(expiresAtMs - AFTER_PROMO_MS).toBeGreaterThan(30 * 60 * 1000);
        expect(expiresAtMs - AFTER_PROMO_MS).toBeLessThanOrEqual(60 * 60 * 1000);
        expect(expiresAtMs % 1000).toBe(0);
    });

    it('takes nothing from the body: the price, the posts and the buyer are the server', async () => {
        await buy({ userId: 'user-2', price: 1, unit_amount: 100, posts: 50, quotaDomain: 'other.example', email: 'x@other.example' });

        const params = createdParams();
        expect(params.line_items[0].price_data.unit_amount).toBe(config.stripePackPriceInCents);
        expect(params.metadata).toMatchObject({ userId: 'user-1', quotaDomain: 'clinic.example', posts: '5' });
        expect(params.client_reference_id).toBe('user-1');
        expect(params.customer_email).toBe('Owner@Clinic.example');
    });

    it('accepts an empty or malformed body, which it does not need', async () => {
        expect((await buy(undefined)).res.status).toBe(200);
        const { POST } = await import('@/app/api/create-pack-checkout/route');
        const res = await POST(new NextRequest('https://test.local/api/create-pack-checkout', { method: 'POST', body: '{not json' }));
        expect(res.status).toBe(200);
    });

    it('writes its product text in house style', async () => {
        await buy();

        const { name, description } = createdParams().line_items[0].price_data.product_data;
        for (const text of [name, description, createdParams().invoice_creation.invoice_data.description]) {
            expect(text).not.toMatch(/[–—]| - /);
        }
    });

    it('answers 502 when Stripe returns a session without a URL', async () => {
        sessionsCreate.mockResolvedValue({ id: 'cs_pack', url: null });

        const { res } = await buy();

        expect(res.status).toBe(502);
    });

    it('answers 500 on a Stripe error without echoing it', async () => {
        sessionsCreate.mockRejectedValue(new Error('Invalid API Key provided: sk_live_secret'));

        const { res, json } = await buy();

        expect(res.status).toBe(500);
        expect(JSON.stringify(json)).not.toContain('sk_live_secret');
    });
});

describe('the idempotency key', () => {
    async function keyAt(nowMs: number, headers: Record<string, string> = {}): Promise<string> {
        sessionsCreate.mockClear();
        nowSpy.mockReturnValue(nowMs);
        await buy({}, headers);
        return createdKey();
    }

    it('is post-pack-v1, the account, the window and a digest of the parameters', async () => {
        expect(await keyAt(AFTER_PROMO_MS)).toMatch(new RegExp(`^post-pack-v1-user-1-${Math.floor(AFTER_PROMO_MS / WINDOW_MS)}-[0-9a-f]{12}$`));
    });

    it('a double click inside one window replays one session; the next window gets its own', async () => {
        const first = await keyAt(AFTER_PROMO_MS);
        const second = await keyAt(AFTER_PROMO_MS + 60_000);
        const later = await keyAt(AFTER_PROMO_MS + WINDOW_MS);

        expect(second).toBe(first);
        expect(later).not.toBe(first);
    });

    it('every request of a window sends the same expires_at, so a replayed key never differs in its parameters', async () => {
        nowSpy.mockReturnValue(AFTER_PROMO_MS);
        await buy();
        const firstExpiry = createdParams().expires_at;
        sessionsCreate.mockClear();
        nowSpy.mockReturnValue(AFTER_PROMO_MS + 5 * 60_000);
        await buy();

        expect(createdParams().expires_at).toBe(firstExpiry);
    });

    it('folds in the GA ids a consenting visitor carries, and stores them for the purchase event', async () => {
        const gaCookies = '_ga=GA1.1.1234567890.1699999999; _ga_TESTSTREAM=GS2.1.s1748000000$o12$g1$t1748000100';
        const consented = `${CONSENT_COOKIE}=${encodeURIComponent(serializeConsent(ANALYTICS_ONLY))}; ${gaCookies}`;

        const withoutConsent = await keyAt(AFTER_PROMO_MS, { cookie: gaCookies });
        expect(createdParams().metadata).not.toHaveProperty('gaClientId');
        const withConsent = await keyAt(AFTER_PROMO_MS, { cookie: consented });

        expect(createdParams().metadata).toMatchObject({ gaClientId: '1234567890.1699999999', gaSessionId: '1748000000' });
        expect(withConsent).toBe(`${withoutConsent}-ga-1234567890.1699999999-1748000000`);
    });

    it('does not depend on the day: the same window of another day is another key', async () => {
        const today = await keyAt(AFTER_PROMO_MS);
        const tomorrow = await keyAt(AFTER_PROMO_MS + DAY_MS);

        expect(tomorrow).not.toBe(today);
    });
});
