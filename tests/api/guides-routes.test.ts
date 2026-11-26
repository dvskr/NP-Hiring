/**
 * The guides store's paid routes:
 *  - checkout opens only when lib/guides/phase.ts#guidePhase is 'paid' (the
 *    Stripe key and the webhook secret both set), whatever ENABLE_PAID_POSTING
 *    or the posting promo say; until then it answers 503 STRIPE_NOT_CONFIGURED
 *    and sends the reader back to the free claim. Once open it charges catalog
 *    prices only, whatever the request says;
 *  - verify hands the library cookie only to the browser that paid;
 *  - download is authorised by that cookie and answers with a short-lived link.
 * The claim route (the free phase's way in) is tests/api/guides-claim.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const stripeMock = vi.hoisted(() => ({
    create: vi.fn(),
    retrieve: vi.fn(),
    configured: true,
}));

vi.mock('@/lib/stripe', () => ({
    getStripe: vi.fn(() => (stripeMock.configured
        ? { checkout: { sessions: { create: stripeMock.create, retrieve: stripeMock.retrieve } } }
        : null)),
}));
vi.mock('@/lib/env', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/env')>()),
    getBaseUrl: vi.fn(() => 'https://nphiring.com'),
}));
const auth = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: auth.getUser } })),
}));
vi.mock('@/lib/rate-limit', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
    rateLimit: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/guides/fulfill', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/guides/fulfill')>()),
    fulfillGuideSession: vi.fn(),
}));
vi.mock('@/lib/guides/library', () => ({
    authorizeDownload: vi.fn(),
    purchaseExists: vi.fn(),
    releaseDownload: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/guides/storage', () => ({ signedGuideUrl: vi.fn() }));

import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { config } from '@/lib/config';
import { ADD_ON, BUNDLES, GUIDES } from '@/lib/guides/catalog';
import { fulfillGuideSession } from '@/lib/guides/fulfill';
import { authorizeDownload, releaseDownload } from '@/lib/guides/library';
import { signedGuideUrl } from '@/lib/guides/storage';
import { GUIDE_CHECKOUT_COOKIE, GUIDES_COOKIE } from '@/lib/guides/access';
import { POST as checkout } from '@/app/api/guides/checkout/route';
import { GET as verify } from '@/app/api/guides/verify/route';
import { GET as download } from '@/app/api/guides/download/route';

const ORIGIN = 'http://localhost:3000';
const SESSION_ID = 'cs_test_a1B2c3D4e5F6g7H8';
const TOKEN = 'd'.repeat(48);

function cookieHeader(cookies: Record<string, string>): Record<string, string> {
    const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    return cookie ? { cookie } : {};
}

function post(body: unknown, cookies: Record<string, string> = {}, origin = ORIGIN): NextRequest {
    return new NextRequest(`${ORIGIN}/api/guides/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', origin, ...cookieHeader(cookies) },
        body: JSON.stringify(body),
    });
}

function get(path: string, cookies: Record<string, string> = {}, headers: Record<string, string> = {}): NextRequest {
    return new NextRequest(`${ORIGIN}${path}`, { headers: { ...cookieHeader(cookies), ...headers } });
}

beforeEach(() => {
    vi.clearAllMocks();
    stripeMock.configured = true;
    stripeMock.create.mockResolvedValue({ id: SESSION_ID, url: 'https://checkout.stripe.com/c/pay/x' });
    auth.getUser.mockResolvedValue({ data: { user: null } });
    // The paid phase: both Stripe values set on this deployment.
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_x');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_x');
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
});

describe('POST /api/guides/checkout', () => {
    it('refuses in the free phase before calling Stripe, even with paid posting on, and points to the claim', async () => {
        vi.stubEnv('ENABLE_PAID_POSTING', 'true');
        for (const [key, secret] of [['', 'whsec_x'], ['sk_test_x', ''], ['   ', '   ']] as const) {
            vi.stubEnv('STRIPE_SECRET_KEY', key);
            vi.stubEnv('STRIPE_WEBHOOK_SECRET', secret);
            const res = await checkout(post({ product: 'complete-library' }));
            expect(res.status, `${key}|${secret}`).toBe(503);
            expect(await res.json()).toEqual({
                code: 'STRIPE_NOT_CONFIGURED',
                error: 'The guides are free to claim right now. Refresh the page to claim one.',
            });
        }
        expect(stripeMock.create).not.toHaveBeenCalled();
    });

    it('sells with paid posting off and while the posting promo runs: neither is part of the gate', async () => {
        vi.stubEnv('ENABLE_PAID_POSTING', 'false');
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-11-26T12:00:00.000Z'));
        expect(config.isPromoActive()).toBe(true);
        const res = await checkout(post({ product: 'complete-library' }));
        expect(res.status).toBe(200);
        expect(stripeMock.create).toHaveBeenCalledTimes(1);
    });

    it('answers 503 when the Stripe client is missing even with the gate open', async () => {
        stripeMock.configured = false;
        const res = await checkout(post({ product: 'interview-prep-pack' }));
        expect(res.status).toBe(503);
        expect((await res.json()).code).toBe('STRIPE_NOT_CONFIGURED');
    });

    it('is rate limited per IP and refuses a cross-site request', async () => {
        await checkout(post({ product: 'interview-prep-pack' }));
        expect(rateLimit).toHaveBeenCalledWith(expect.anything(), 'guides:checkout', RATE_LIMITS.guideCheckout);
        expect(RATE_LIMITS.guideCheckout).toEqual({ limit: 10, windowSeconds: 60 });

        const res = await checkout(post({ product: 'interview-prep-pack' }, {}, 'https://evil.example'));
        expect(res.status).toBe(403);
    });

    it('charges the catalog price and tags the session and the payment intent as a guide checkout', async () => {
        const res = await checkout(post({ product: 'complete-library', priceCents: 1 }));
        expect(res.status).toBe(200);
        const library = BUNDLES['complete-library'];
        expect(await res.json()).toEqual({ url: 'https://checkout.stripe.com/c/pay/x', amountCents: library.priceCents });

        const params = stripeMock.create.mock.calls[0][0];
        expect(params.mode).toBe('payment');
        expect(params.payment_method_types).toEqual(['card']);
        expect(params.line_items).toHaveLength(1);
        expect(params.line_items[0].price_data.unit_amount).toBe(library.priceCents);
        expect(params.metadata).toEqual({ type: 'guide', product: 'complete-library', addOn: '', userId: '' });
        expect(params.success_url).toBe('https://nphiring.com/guides/success?session_id={CHECKOUT_SESSION_ID}');
        expect(params.cancel_url).toBe('https://nphiring.com/guides/complete-library');
        // Unrestricted promotion codes in the account must not apply to guides.
        expect(params.allow_promotion_codes).toBeUndefined();
        expect(params.payment_intent_data).toEqual({ metadata: { type: 'guide', product: 'complete-library' } });
    });

    it('keeps the signed-in buyer\'s id and prefills their email', async () => {
        auth.getUser.mockResolvedValueOnce({ data: { user: { id: 'user-1', email: 'np@example.com' } } });
        await checkout(post({ product: 'first-year-playbook' }));
        const params = stripeMock.create.mock.calls[0][0];
        expect(params.customer_email).toBe('np@example.com');
        expect(params.metadata.userId).toBe('user-1');
    });

    it('adds the add-on line only where the product is eligible', async () => {
        const guide = GUIDES['interview-prep-pack'];
        const priced = await checkout(post({ product: guide.slug, addOn: true }));
        expect(await priced.json()).toMatchObject({ amountCents: guide.priceCents + ADD_ON.priceCents });
        const withAddOn = stripeMock.create.mock.calls[0][0];
        expect(withAddOn.line_items.map((l: { price_data: { unit_amount: number } }) => l.price_data.unit_amount)).toEqual([guide.priceCents, ADD_ON.priceCents]);
        expect(withAddOn.metadata.addOn).toBe('compensation-report');

        await checkout(post({ product: 'career-bundle', addOn: true }));
        const bundle = stripeMock.create.mock.calls[1][0];
        expect(bundle.line_items).toHaveLength(1);
        expect(bundle.metadata.addOn).toBe('');
    });

    it('ties the checkout to this browser with an httpOnly cookie', async () => {
        const res = await checkout(post({ product: 'interview-prep-pack' }));
        const cookie = res.cookies.get(GUIDE_CHECKOUT_COOKIE);
        expect(cookie?.value).toBe(SESSION_ID);
        expect(cookie?.httpOnly).toBe(true);
    });

    it('remembers an earlier checkout from another tab', async () => {
        const earlier = 'cs_test_EarlierTab123456';
        const res = await checkout(post({ product: 'interview-prep-pack' }, { [GUIDE_CHECKOUT_COOKIE]: earlier }));
        expect(res.cookies.get(GUIDE_CHECKOUT_COOKIE)?.value).toBe(`${SESSION_ID}.${earlier}`);
    });

    it('refuses unknown products and malformed bodies', async () => {
        expect((await checkout(post({ product: 'free-everything' }))).status).toBe(400);
        expect((await checkout(post({ product: '__proto__' }))).status).toBe(400);
        expect((await checkout(post({ product: 42 }))).status).toBe(400);
        expect(stripeMock.create).not.toHaveBeenCalled();
    });

    it('answers 502 for a session without a URL and 500 when Stripe fails', async () => {
        stripeMock.create.mockResolvedValueOnce({ id: SESSION_ID, url: null });
        expect((await checkout(post({ product: 'interview-prep-pack' }))).status).toBe(502);
        stripeMock.create.mockRejectedValueOnce(new Error('stripe down'));
        expect((await checkout(post({ product: 'interview-prep-pack' }))).status).toBe(500);
    });
});

describe('GET /api/guides/verify', () => {
    const paidSession = { id: SESSION_ID, payment_status: 'paid', amount_total: 6900, metadata: { type: 'guide' } };
    const purchase = { productSlug: 'complete-library', guideSlugs: ['compensation-report'], amountCents: 6900, email: 'b@x.com', accessToken: TOKEN };

    it('rejects a malformed session id before calling Stripe', async () => {
        expect((await verify(get('/api/guides/verify?session_id=nope'))).status).toBe(400);
        expect(stripeMock.retrieve).not.toHaveBeenCalled();
    });

    it('does not confirm a session from another checkout type', async () => {
        stripeMock.retrieve.mockResolvedValueOnce({ ...paidSession, metadata: { type: 'post_pack' } });
        expect((await verify(get(`/api/guides/verify?session_id=${SESSION_ID}`))).status).toBe(404);
        expect(fulfillGuideSession).not.toHaveBeenCalled();
    });

    it('answers 404 for a session Stripe cannot find', async () => {
        stripeMock.retrieve.mockRejectedValueOnce(new Error('No such checkout.session'));
        expect((await verify(get(`/api/guides/verify?session_id=${SESSION_ID}`))).status).toBe(404);
    });

    it('reports an unpaid session as unpaid', async () => {
        stripeMock.retrieve.mockResolvedValueOnce({ ...paidSession, payment_status: 'unpaid' });
        expect((await verify(get(`/api/guides/verify?session_id=${SESSION_ID}`))).status).toBe(402);
        expect(fulfillGuideSession).not.toHaveBeenCalled();
    });

    it('gives the library cookie to the browser that paid', async () => {
        stripeMock.retrieve.mockResolvedValueOnce(paidSession);
        vi.mocked(fulfillGuideSession).mockResolvedValueOnce({ status: 'fulfilled', purchase, delivery: 'already' } as never);
        const res = await verify(get(`/api/guides/verify?session_id=${SESSION_ID}`, { [GUIDE_CHECKOUT_COOKIE]: `cs_test_OtherTab12345678.${SESSION_ID}` }));
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ paid: true, inLibrary: true, emailed: true, amountCents: 6900 });
        // The webhook sends the delivery email; the success page never does.
        expect(vi.mocked(fulfillGuideSession).mock.calls[0][1]).toEqual({ sendEmail: false });
        expect(res.cookies.get(GUIDES_COOKIE)?.value).toBe(TOKEN);
        expect(res.headers.get('cache-control')).toContain('no-store');
    });

    it('confirms but grants nothing to anyone else holding the session id', async () => {
        stripeMock.retrieve.mockResolvedValueOnce(paidSession);
        vi.mocked(fulfillGuideSession).mockResolvedValueOnce({ status: 'fulfilled', purchase, delivery: 'pending' } as never);
        const res = await verify(get(`/api/guides/verify?session_id=${SESSION_ID}`));
        expect(await res.json()).toMatchObject({ paid: true, inLibrary: false, emailed: false });
        expect(res.cookies.get(GUIDES_COOKIE)).toBeUndefined();
    });

    it('answers 500 when a paid session cannot be fulfilled', async () => {
        stripeMock.retrieve.mockResolvedValueOnce(paidSession);
        vi.mocked(fulfillGuideSession).mockResolvedValueOnce({ status: 'invalid' });
        expect((await verify(get(`/api/guides/verify?session_id=${SESSION_ID}`))).status).toBe(500);
        stripeMock.retrieve.mockResolvedValueOnce(paidSession);
        vi.mocked(fulfillGuideSession).mockRejectedValueOnce(new Error('db down'));
        expect((await verify(get(`/api/guides/verify?session_id=${SESSION_ID}`))).status).toBe(500);
    });
});

describe('GET /api/guides/download', () => {
    /** What a current browser sends for a click on the library page. */
    const SAME_ORIGIN = { 'sec-fetch-site': 'same-origin' };

    it('sends a browser without access back to the library', async () => {
        vi.mocked(authorizeDownload).mockResolvedValueOnce({ ok: false, reason: 'no-access' });
        const res = await download(get('/api/guides/download?guide=interview-prep-pack', {}, SAME_ORIGIN));
        expect(res.status).toBe(302);
        expect(res.headers.get('location')).toBe(`${ORIGIN}/guides/library?error=no-access`);
        expect(signedGuideUrl).not.toHaveBeenCalled();
    });

    it('refuses a download started from another site, without counting it', async () => {
        const res = await download(get('/api/guides/download?guide=interview-prep-pack', { [GUIDES_COOKIE]: TOKEN }, { 'sec-fetch-site': 'cross-site' }));
        expect(res.headers.get('location')).toBe(`${ORIGIN}/guides/library`);
        expect(authorizeDownload).not.toHaveBeenCalled();
    });

    it('lets an older browser without Sec-Fetch-Site download only from a page on this site', async () => {
        vi.mocked(authorizeDownload).mockResolvedValue({ ok: true, purchaseId: 'p1' });
        vi.mocked(signedGuideUrl).mockResolvedValue('https://storage.example/signed?token=t');
        const path = '/api/guides/download?guide=interview-prep-pack';

        const fromLibrary = await download(get(path, { [GUIDES_COOKIE]: TOKEN }, { referer: `${ORIGIN}/guides/library` }));
        expect(fromLibrary.headers.get('location')).toBe('https://storage.example/signed?token=t');

        const refused: Record<string, string>[] = [{}, { referer: 'https://evil.example/page' }, { referer: 'not a url' }];
        for (const headers of refused) {
            vi.mocked(authorizeDownload).mockClear();
            const res = await download(get(path, { [GUIDES_COOKIE]: TOKEN }, headers));
            expect(res.headers.get('location'), JSON.stringify(headers)).toBe(`${ORIGIN}/guides/library`);
            expect(authorizeDownload).not.toHaveBeenCalled();
        }
        vi.mocked(authorizeDownload).mockReset();
        vi.mocked(signedGuideUrl).mockReset();
    });

    it('gives the download back when the file cannot be signed', async () => {
        vi.mocked(authorizeDownload).mockResolvedValueOnce({ ok: true, purchaseId: 'p1' });
        vi.mocked(signedGuideUrl).mockResolvedValueOnce(null);
        const res = await download(get('/api/guides/download?guide=interview-prep-pack', { [GUIDES_COOKIE]: TOKEN }, { 'sec-fetch-site': 'same-origin' }));
        expect(res.headers.get('location')).toBe(`${ORIGIN}/guides/library?error=unavailable`);
        expect(releaseDownload).toHaveBeenCalledWith('p1');
    });

    it('sends the reader back when the database cannot be read', async () => {
        vi.mocked(authorizeDownload).mockRejectedValueOnce(new Error('db down'));
        const res = await download(get('/api/guides/download?guide=interview-prep-pack', { [GUIDES_COOKIE]: TOKEN }, SAME_ORIGIN));
        expect(res.headers.get('location')).toBe(`${ORIGIN}/guides/library?error=unavailable`);
    });

    it('rejects a guide that is not in the catalog', async () => {
        const res = await download(get('/api/guides/download?guide=../../secrets', {}, SAME_ORIGIN));
        expect(res.headers.get('location')).toBe(`${ORIGIN}/guides/library?error=unknown`);
        expect(authorizeDownload).not.toHaveBeenCalled();
    });

    it('redirects an authorised browser to a signed link, without a referrer', async () => {
        vi.mocked(authorizeDownload).mockResolvedValueOnce({ ok: true, purchaseId: 'p1' });
        vi.mocked(signedGuideUrl).mockResolvedValueOnce('https://storage.example/signed?token=t');
        const res = await download(get('/api/guides/download?guide=interview-prep-pack', { [GUIDES_COOKIE]: TOKEN }, SAME_ORIGIN));
        expect(vi.mocked(authorizeDownload).mock.calls[0]).toEqual([[TOKEN], 'interview-prep-pack']);
        expect(res.headers.get('location')).toBe('https://storage.example/signed?token=t');
        expect(res.headers.get('referrer-policy')).toBe('no-referrer');
        expect(res.headers.get('x-robots-tag')).toContain('noindex');
        expect(res.headers.get('cache-control')).toContain('no-store');
    });
});
