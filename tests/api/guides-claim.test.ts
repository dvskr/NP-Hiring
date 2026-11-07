/**
 * POST /api/guides/claim: the launch promo's way to the guides. Until
 * config.promoEndsAt every product, bundles included, is free to claim with
 * an email address, and Stripe is never called:
 *   - CSRF checked, then 5 claims a minute per IP;
 *   - 409 PROMO_ENDED once lib/guides/phase.ts#isGuideClaimOpen is false;
 *   - a 'promo' row (amount 0, no Stripe ids, the product's guides and
 *     never the checkout add-on), found or created under a transaction lock
 *     on the address, and the delivery email;
 *   - the library link goes by email; only a reader signed in with that
 *     confirmed address gets the token in this browser's np_guides cookie,
 *     so the answer never shows whether the address held a claim before;
 *   - an email that already holds every guide of the product re-uses its
 *     claim (no new row, the email re-sent at most every ten minutes);
 *   - newsletter: true opts the address in, and never fails the claim.
 * The route runs the real lib/guides/fulfill.ts against the Prisma mock.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';

const auth = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: auth.getUser } })),
}));
vi.mock('@/lib/rate-limit', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
    rateLimit: vi.fn().mockResolvedValue(null),
    checkRateLimit: vi.fn().mockResolvedValue({ success: true, reset: 0, remaining: 5 }),
}));
vi.mock('@/lib/guides/phase', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/guides/phase')>()),
    isGuideClaimOpen: vi.fn(() => true),
}));
vi.mock('@/lib/guides/email', () => ({ sendGuidePurchaseEmail: vi.fn() }));
vi.mock('@/lib/stripe', () => ({ getStripe: vi.fn() }));
vi.mock('@/lib/newsletter', () => ({ subscribeToNewsletter: vi.fn(), subscribeNewAddressToNewsletter: vi.fn() }));

import { NextResponse } from 'next/server';
import { checkRateLimit, rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { isGuideClaimOpen } from '@/lib/guides/phase';
import { sendGuidePurchaseEmail } from '@/lib/guides/email';
import { getStripe } from '@/lib/stripe';
import { subscribeNewAddressToNewsletter, subscribeToNewsletter } from '@/lib/newsletter';
import { BUNDLES } from '@/lib/guides/catalog';
import { GUIDES_COOKIE, parseLibraryCookie } from '@/lib/guides/access';
import { POST } from '@/app/api/guides/claim/route';

const ORIGIN = 'http://localhost:3000';
const gp = prisma.guidePurchase as unknown as Record<string, ReturnType<typeof vi.fn>>;
const EARLIER = 'a'.repeat(48);
/** The transaction lock statement fulfillPromoClaim runs first. */
const executeRaw = vi.fn();

/** A signed-in reader whose account address is confirmed. */
function signedIn(email: string): void {
    auth.getUser.mockResolvedValue({ data: { user: { id: 'user-7', email, email_confirmed_at: '2026-01-01T00:00:00Z' } } });
}

function claim(body: unknown, opts: { origin?: string; cookie?: string } = {}): NextRequest {
    return new NextRequest(`${ORIGIN}/api/guides/claim`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            origin: opts.origin ?? ORIGIN,
            ...(opts.cookie ? { cookie: opts.cookie } : {}),
        },
        body: typeof body === 'string' ? body : JSON.stringify(body),
    });
}

/** The row prisma.guidePurchase.create writes, echoed back as the created purchase. */
function echoCreate(): void {
    gp.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'gp_new', emailSentAt: null, ...data }));
}

beforeEach(() => {
    vi.clearAllMocks();
    auth.getUser.mockResolvedValue({ data: { user: null } });
    vi.mocked(isGuideClaimOpen).mockReturnValue(true);
    vi.mocked(sendGuidePurchaseEmail).mockResolvedValue('sent');
    gp.findFirst.mockReset().mockResolvedValue(null);
    gp.create.mockReset();
    gp.updateMany.mockReset().mockResolvedValue({ count: 1 });
    echoCreate();
    vi.mocked(sendGuidePurchaseEmail).mockReset().mockResolvedValue('sent');
    vi.mocked(subscribeToNewsletter).mockReset().mockResolvedValue(undefined);
    vi.mocked(subscribeNewAddressToNewsletter).mockReset().mockResolvedValue(true);
    executeRaw.mockReset().mockResolvedValue(1);
    vi.mocked(prisma.$transaction).mockImplementation(((arg: unknown) =>
        typeof arg === 'function'
            ? (arg as (tx: unknown) => Promise<unknown>)({ $executeRaw: executeRaw, guidePurchase: prisma.guidePurchase })
            : Promise.all(arg as Promise<unknown>[])) as never);
});

describe('the gate', () => {
    it('refuses a cross-site request before anything else', async () => {
        const res = await POST(claim({ product: 'career-bundle', email: 'np@example.com' }, { origin: 'https://evil.example' }));
        expect(res.status).toBe(403);
        expect(rateLimit).not.toHaveBeenCalled();
        expect(gp.create).not.toHaveBeenCalled();
    });

    it('allows 5 claims a minute per IP', async () => {
        await POST(claim({ product: 'career-bundle', email: 'np@example.com' }));
        expect(rateLimit).toHaveBeenCalledWith(expect.anything(), 'guides:claim', RATE_LIMITS.guideClaim);
        expect(RATE_LIMITS.guideClaim).toEqual({ limit: 5, windowSeconds: 60 });
    });

    it('answers the rate limiter\'s 429 without recording anything', async () => {
        vi.mocked(rateLimit).mockResolvedValueOnce(NextResponse.json({ error: 'Too many requests' }, { status: 429 }));
        const res = await POST(claim({ product: 'career-bundle', email: 'np@example.com' }));
        expect(res.status).toBe(429);
        expect(gp.findFirst).not.toHaveBeenCalled();
        expect(gp.create).not.toHaveBeenCalled();
    });

    it('caps one email address at 6 claims an hour from any IP, keyed on a hash of it', async () => {
        await POST(claim({ product: 'career-bundle', email: ' NP@Example.com ' }));
        expect(RATE_LIMITS.guideClaimPerEmail).toEqual({ limit: 6, windowSeconds: 3600 });
        const [key, limit] = vi.mocked(checkRateLimit).mock.calls[0];
        expect(limit).toBe(RATE_LIMITS.guideClaimPerEmail);
        expect(key).toMatch(/^ratelimit:guides:claim-email:[0-9a-f]{32}$/);
        expect(key).not.toContain('example');

        // The same address however it is typed, so the cap cannot be dodged by case or spaces.
        await POST(claim({ product: 'career-bundle', email: 'np@example.com' }));
        expect(vi.mocked(checkRateLimit).mock.calls[1][0]).toBe(key);

        vi.mocked(checkRateLimit).mockResolvedValueOnce({ success: false, reset: Date.now() + 60_000, remaining: 0 });
        gp.create.mockClear();
        const res = await POST(claim({ product: 'career-bundle', email: 'np@example.com' }));
        expect(res.status).toBe(429);
        expect(res.headers.get('retry-after')).toMatch(/^\d+$/);
        expect(gp.create).not.toHaveBeenCalled();
        expect(sendGuidePurchaseEmail).toHaveBeenCalledTimes(2);
    });

    it('answers 409 PROMO_ENDED after the promo, and records nothing', async () => {
        vi.mocked(isGuideClaimOpen).mockReturnValue(false);
        const res = await POST(claim({ product: 'career-bundle', email: 'np@example.com' }));
        expect(res.status).toBe(409);
        expect(await res.json()).toEqual({ error: 'This offer has ended.', code: 'PROMO_ENDED' });
        expect(gp.findFirst).not.toHaveBeenCalled();
        expect(gp.create).not.toHaveBeenCalled();
        expect(sendGuidePurchaseEmail).not.toHaveBeenCalled();
        expect(res.cookies.get(GUIDES_COOKIE)).toBeUndefined();
    });

    it('refuses an unknown product, a malformed body and a bad email', async () => {
        for (const body of [
            { product: 'free-everything', email: 'np@example.com' },
            { product: '__proto__', email: 'np@example.com' },
            { product: 'career-bundle' },
            { product: 'career-bundle', email: 'not an email' },
            { product: 'career-bundle', email: `${'x'.repeat(250)}@example.com` },
            'not json',
        ]) {
            const res = await POST(claim(body));
            expect(res.status, JSON.stringify(body)).toBe(400);
        }
        const bad = await POST(claim({ product: 'career-bundle', email: 'nope' }));
        expect((await bad.json()).error).toBe('Enter a valid email address.');
        expect(gp.create).not.toHaveBeenCalled();
    });

    it('never calls Stripe', async () => {
        await POST(claim({ product: 'complete-library', email: 'np@example.com' }));
        expect(getStripe).not.toHaveBeenCalled();
    });
});

describe('a new claim', () => {
    it('records a promo row for the product and its guides, and answers ok', async () => {
        const res = await POST(claim({ product: 'career-bundle', email: '  NP@Example.COM ' }));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true, emailed: true, guides: [...BUNDLES['career-bundle'].guides], inLibrary: false });
        expect(gp.create).toHaveBeenCalledTimes(1);
        expect(gp.create.mock.calls[0][0].data).toMatchObject({
            source: 'promo',
            amountCents: 0,
            stripeSessionId: null,
            stripePaymentIntentId: null,
            email: 'np@example.com',
            userId: null,
            productSlug: 'career-bundle',
            guideSlugs: [...BUNDLES['career-bundle'].guides],
        });
        expect(sendGuidePurchaseEmail).toHaveBeenCalledTimes(1);
        expect(res.headers.get('cache-control')).toContain('no-store');
    });

    it('never adds the checkout add-on, whatever the body says', async () => {
        await POST(claim({ product: 'interview-prep-pack', email: 'np@example.com', addOn: true }));
        expect(gp.create.mock.calls[0][0].data.guideSlugs).toEqual(['interview-prep-pack']);
    });

    it('keeps the signed-in reader\'s user id', async () => {
        auth.getUser.mockResolvedValueOnce({ data: { user: { id: 'user-7', email: 'other@example.com' } } });
        await POST(claim({ product: 'first-year-playbook', email: 'np@example.com' }));
        expect(gp.create.mock.calls[0][0].data.userId).toBe('user-7');
    });

    it('finds or creates the claim under a transaction lock on the address', async () => {
        await POST(claim({ product: 'first-year-playbook', email: 'NP@example.com' }));
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        const lock = executeRaw.mock.calls[0];
        expect(lock[0].join('')).toContain('pg_advisory_xact_lock(hashtext(');
        expect(lock[1]).toBe('guide-claim:np@example.com');
        expect(gp.findFirst).toHaveBeenCalledTimes(2);
    });

    it('sends the link by email and gives this browser nothing', async () => {
        const res = await POST(claim({ product: 'telehealth-playbook', email: 'np@example.com' }, { cookie: `${GUIDES_COOKIE}=${EARLIER}` }));
        expect(await res.json()).toMatchObject({ ok: true, emailed: true, inLibrary: false });
        expect(res.cookies.get(GUIDES_COOKIE)).toBeUndefined();
    });

    it('adds the token to the library cookie of a reader signed in with that confirmed address', async () => {
        signedIn('NP@example.com');
        const res = await POST(claim({ product: 'telehealth-playbook', email: 'np@example.com' }, { cookie: `${GUIDES_COOKIE}=${EARLIER}` }));
        expect(await res.json()).toMatchObject({ ok: true, inLibrary: true });
        const token = gp.create.mock.calls[0][0].data.accessToken as string;
        expect(token).toMatch(/^[0-9a-f]{48}$/);
        const cookie = res.cookies.get(GUIDES_COOKIE);
        expect(parseLibraryCookie(cookie?.value)).toEqual([token, EARLIER]);
        expect(cookie?.httpOnly).toBe(true);
        expect(cookie?.sameSite).toBe('lax');
    });

    it('gives nothing to a signed-in reader whose address is unconfirmed or different', async () => {
        auth.getUser.mockResolvedValueOnce({ data: { user: { id: 'user-7', email: 'np@example.com', email_confirmed_at: null } } });
        const unconfirmed = await POST(claim({ product: 'telehealth-playbook', email: 'np@example.com' }));
        expect(unconfirmed.cookies.get(GUIDES_COOKIE)).toBeUndefined();
        signedIn('someone@example.com');
        const different = await POST(claim({ product: 'telehealth-playbook', email: 'np@example.com' }));
        expect(await different.json()).toMatchObject({ inLibrary: false });
        expect(different.cookies.get(GUIDES_COOKIE)).toBeUndefined();
    });

    it('says so when the email could not be sent, and still keeps the claim', async () => {
        vi.mocked(sendGuidePurchaseEmail).mockResolvedValueOnce('retry');
        const res = await POST(claim({ product: 'telehealth-playbook', email: 'np@example.com' }));
        expect(await res.json()).toMatchObject({ ok: true, emailed: false, inLibrary: false });
        expect(gp.create).toHaveBeenCalledTimes(1);
    });

    it('for an anonymous claim, subscribes only an address the site has never seen, and only when asked', async () => {
        await POST(claim({ product: 'telehealth-playbook', email: 'NP@example.com', newsletter: true }));
        expect(subscribeNewAddressToNewsletter).toHaveBeenCalledWith('np@example.com', 'guide_claim');
        expect(subscribeToNewsletter).not.toHaveBeenCalled();
        vi.mocked(subscribeNewAddressToNewsletter).mockClear();
        await POST(claim({ product: 'telehealth-playbook', email: 'np@example.com' }));
        await POST(claim({ product: 'telehealth-playbook', email: 'np@example.com', newsletter: false }));
        expect(subscribeNewAddressToNewsletter).not.toHaveBeenCalled();
        expect(subscribeToNewsletter).not.toHaveBeenCalled();
    });

    it('opts in the address\'s signed-in owner as the public signup does', async () => {
        signedIn('np@example.com');
        await POST(claim({ product: 'telehealth-playbook', email: 'np@example.com', newsletter: true }));
        expect(subscribeToNewsletter).toHaveBeenCalledWith('np@example.com', 'guide_claim');
        expect(subscribeNewAddressToNewsletter).not.toHaveBeenCalled();
    });

    it('still delivers the guides when the newsletter opt-in fails', async () => {
        vi.mocked(subscribeNewAddressToNewsletter).mockRejectedValueOnce(new Error('db down'));
        const res = await POST(claim({ product: 'telehealth-playbook', email: 'np@example.com', newsletter: true }));
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ ok: true, emailed: true });
    });

    it('refuses a newsletter field that is not a boolean', async () => {
        const res = await POST(claim({ product: 'telehealth-playbook', email: 'np@example.com', newsletter: 'yes' }));
        expect(res.status).toBe(400);
        expect(gp.create).not.toHaveBeenCalled();
    });

    it('answers 500 when the claim cannot be written', async () => {
        gp.create.mockRejectedValueOnce(new Error('db down'));
        const res = await POST(claim({ product: 'telehealth-playbook', email: 'np@example.com' }));
        expect(res.status).toBe(500);
        expect(res.cookies.get(GUIDES_COOKIE)).toBeUndefined();
    });
});

describe('an email that already holds the product', () => {
    const existing = {
        id: 'gp_old',
        source: 'promo',
        email: 'np@example.com',
        accessToken: 'b'.repeat(48),
        productSlug: 'complete-library',
        guideSlugs: [...BUNDLES['complete-library'].guides],
        amountCents: 0,
        emailSentAt: new Date(Date.now() - 60 * 60 * 1000),
    };

    it('re-uses the earlier claim: no new row, the email re-sent, the same answer as a new claim', async () => {
        gp.findFirst.mockResolvedValueOnce(existing);
        const res = await POST(claim({ product: 'interview-prep-pack', email: 'np@example.com' }));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true, emailed: true, guides: ['interview-prep-pack'], inLibrary: false });
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(gp.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: { source: 'promo', email: 'np@example.com', guideSlugs: { hasEvery: ['interview-prep-pack'] } },
        }));
        expect(gp.create).not.toHaveBeenCalled();
        expect(sendGuidePurchaseEmail).toHaveBeenCalledWith(existing);
        expect(res.cookies.get(GUIDES_COOKIE)).toBeUndefined();
    });

    it('never spends or checks the address limit, so nobody can lock its owner out', async () => {
        gp.findFirst.mockResolvedValueOnce(existing);
        vi.mocked(checkRateLimit).mockClear().mockResolvedValue({ success: false, reset: Date.now() + 60_000, remaining: 0 });
        const res = await POST(claim({ product: 'complete-library', email: 'np@example.com' }));
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ ok: true, emailed: true });
        expect(checkRateLimit).not.toHaveBeenCalled();
        expect(gp.findFirst).toHaveBeenCalledTimes(1);
        vi.mocked(checkRateLimit).mockResolvedValue({ success: true, reset: 0, remaining: 5 });
    });

    it('gives the earlier claim to the library of a reader signed in with that address', async () => {
        signedIn('np@example.com');
        gp.findFirst.mockResolvedValueOnce(existing);
        const res = await POST(claim({ product: 'complete-library', email: 'np@example.com' }));
        expect(await res.json()).toMatchObject({ inLibrary: true });
        expect(parseLibraryCookie(res.cookies.get(GUIDES_COOKIE)?.value)).toEqual([existing.accessToken]);
    });

    it('re-uses a claim another request created a moment earlier, found under the lock', async () => {
        gp.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(existing);
        const res = await POST(claim({ product: 'complete-library', email: 'np@example.com' }));
        expect(await res.json()).toMatchObject({ ok: true, emailed: true });
        expect(gp.create).not.toHaveBeenCalled();
        expect(sendGuidePurchaseEmail).toHaveBeenCalledWith(existing);
    });

    it('does not re-send within ten minutes, and still reports the email as sent', async () => {
        gp.findFirst.mockResolvedValueOnce({ ...existing, emailSentAt: new Date() });
        gp.updateMany.mockResolvedValueOnce({ count: 0 });
        const res = await POST(claim({ product: 'complete-library', email: 'np@example.com' }));
        expect(await res.json()).toMatchObject({ ok: true, emailed: true });
        expect(sendGuidePurchaseEmail).not.toHaveBeenCalled();
        expect(gp.create).not.toHaveBeenCalled();
    });
});
