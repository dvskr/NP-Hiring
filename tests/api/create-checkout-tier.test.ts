/**
 * POST /api/create-checkout — the paid rung is priced server-side from the
 * SIGNUP email domain (2026-09-12 launch promo + 2027 ladder).
 *
 *   intro — config.introPrice, the first PAID post per company domain
 *   pro   — config.postingPrice, every later post
 *
 * Pins:
 *   - the rung comes from lib/pricing#getNextPaidTier over the signup domain
 *     (never the form's contactEmail, never the request body's pricingTier);
 *   - Stripe unit_amount = config.priceCentsForTier(rung), metadata.pricing =
 *     rung, and the product / invoice names carry config.getTierLabel(rung);
 *   - EmployerJob is written 'pending' with pricingTier = rung and the
 *     immutable quotaDomain snapshot;
 *   - the response carries { tier, price } for the checkout page;
 *   - the B78 resume path re-prices from the PERSISTED pricingTier (the row
 *     the employer is completing), not from a fresh count;
 *   - during the launch promo both paths answer 409 PROMO_ACTIVE before any
 *     row or Stripe session exists (every other test runs with the promo
 *     stubbed off: the paid funnel only opens once the promo ends);
 *   - the resume path decides "already paid" by payment_status, so a failed
 *     delayed payment can be retried while one that is still settling
 *     (intent 'processing') or awaiting ACH microdeposit verification
 *     (intent 'requires_action') cannot be paid twice.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';
import { paidPostWhere } from '@/lib/pricing';

const sessionsCreate = vi.fn();
const sessionsRetrieve = vi.fn();
const sessionsExpire = vi.fn();
vi.mock('stripe', () => ({
    default: vi.fn().mockImplementation(() => ({
        checkout: { sessions: { create: sessionsCreate, retrieve: sessionsRetrieve, expire: sessionsExpire } },
    })),
}));

vi.mock('@/lib/env', () => ({
    isFeatureEnabled: vi.fn((feature: string) => feature === 'paidPosting'),
    getPaidPostingStatus: vi.fn(() => ({ enabled: true, stripeConfigured: true, available: true })),
    getEnv: vi.fn(() => ({})),
    getBaseUrl: vi.fn(() => 'http://localhost:3000'),
}));

vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn().mockResolvedValue(null),
    RATE_LIMITS: { postJob: { limit: 100, windowMs: 60_000 } },
}));

vi.mock('@/lib/sanitize', () => ({
    sanitizeJobPosting: vi.fn().mockImplementation((d: Record<string, unknown>) => d),
    sanitizeUrl: vi.fn().mockImplementation((u: string) => u),
    sanitizeEmail: vi.fn().mockImplementation((e: string) => e),
    sanitizeText: vi.fn().mockImplementation((t: string) => t),
    normalizeContentWhitespace: vi.fn().mockImplementation((s: string) => s),
}));

const getUserMock = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}));

const SIGNUP_DOMAIN = 'clinic.example';
const BODY = {
    title: 'PMHNP — Telepsychiatry',
    companyName: 'Clinic Co',
    contactEmail: 'hiring@recruiter-agency.example', // different domain on purpose
    location: 'Remote',
    mode: 'Remote',
    jobType: 'Full-Time',
    description: '<p>' + 'x'.repeat(220) + '</p>',
    applyUrl: 'https://clinic.example/apply',
    pricingTier: 'intro', // body value must be ignored
};

function makeReq(body: object): NextRequest {
    return new NextRequest('https://test.local/api/create-checkout', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
    });
}

async function post(body: object) {
    const { POST } = await import('@/app/api/create-checkout/route');
    const res = await POST(makeReq(body));
    return { res, json: await res.json() };
}

function stripeSessionArg() {
    return sessionsCreate.mock.calls[0][0] as {
        line_items: { price_data: { unit_amount: number; product_data: { name: string } } }[];
        metadata: Record<string, string>;
        invoice_creation: { invoice_data: { description: string; metadata: Record<string, string> } };
    };
}

// Load the route graph once, outside any single test's time budget: on a
// loaded machine the cold import outran the first test's 5 second default.
beforeAll(async () => {
    await import('@/app/api/create-checkout/route');
}, 120_000);

beforeEach(() => {
    vi.clearAllMocks();
    // The paid funnel only opens after the launch promo; the promo describe
    // below switches it back on.
    vi.spyOn(config, 'isPromoActive').mockReturnValue(false);
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1', email: `Owner@${SIGNUP_DOMAIN}` } }, error: null });
    vi.mocked(prisma.userProfile.findUnique).mockResolvedValue({ supabaseId: 'user-1', role: 'employer', email: `owner@${SIGNUP_DOMAIN}` } as never);
    vi.mocked(prisma.$transaction).mockImplementation(((fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma)) as never);
    vi.mocked(prisma.job.create).mockResolvedValue({ id: 'job-1' } as never);
    vi.mocked(prisma.job.update).mockResolvedValue({ id: 'job-1', slug: 'slug-job-1' } as never);
    vi.mocked(prisma.employerJob.create).mockResolvedValue({ id: 'ej-1', dashboardToken: 'dash-1' } as never);
    sessionsCreate.mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' });
});

describe('fresh post — rung from the signup domain', () => {
    it("prices the first paid post per domain as 'intro'", async () => {
        vi.mocked(prisma.employerJob.count).mockResolvedValue(0 as never);

        const { res, json } = await post(BODY);

        expect(res.status).toBe(200);
        expect(json).toMatchObject({ sessionId: 'cs_1', url: 'https://checkout.stripe.test/cs_1', tier: 'intro', price: config.introPrice });

        const arg = stripeSessionArg();
        expect(arg.line_items[0].price_data.unit_amount).toBe(config.stripeIntroPriceInCents);
        expect(arg.line_items[0].price_data.product_data.name).toBe(`${config.getTierLabel('intro')} job post — ${BODY.title}`);
        expect(arg.metadata).toEqual({ jobId: 'job-1', pricing: 'intro' });
        expect(arg.invoice_creation.invoice_data.metadata.pricing).toBe('intro');
        expect(arg.invoice_creation.invoice_data.description).toContain(`${config.getTierLabel('intro')} job post`);

        // Counted against PAID posts at the SIGNUP domain (lower-cased), not the form contactEmail.
        // The predicate itself is pinned in tests/lib/pricing.test.ts.
        expect(prisma.employerJob.count).toHaveBeenCalledWith({ where: paidPostWhere(SIGNUP_DOMAIN) });
        expect(vi.mocked(prisma.employerJob.create).mock.calls[0][0].data).toMatchObject({
            paymentStatus: 'pending',
            pricingTier: 'intro',
            quotaDomain: SIGNUP_DOMAIN,
            userId: 'user-1',
            contactEmail: BODY.contactEmail,
        });
    });

    it("prices every later post as 'pro' at the featured price", async () => {
        vi.mocked(prisma.employerJob.count).mockResolvedValue(1 as never);

        const { res, json } = await post(BODY);

        expect(res.status).toBe(200);
        expect(json).toMatchObject({ tier: 'pro', price: config.postingPrice });
        const arg = stripeSessionArg();
        expect(arg.line_items[0].price_data.unit_amount).toBe(config.stripePriceInCents);
        expect(arg.line_items[0].price_data.product_data.name).toBe(`${config.getTierLabel('pro')} job post — ${BODY.title}`);
        expect(arg.metadata.pricing).toBe('pro');
        expect(vi.mocked(prisma.employerJob.create).mock.calls[0][0].data).toMatchObject({ pricingTier: 'pro' });
    });

    it('ignores the pricingTier the client sent', async () => {
        vi.mocked(prisma.employerJob.count).mockResolvedValue(3 as never);
        const { json } = await post({ ...BODY, pricingTier: 'intro' });
        expect(json.tier).toBe('pro');
        expect(stripeSessionArg().line_items[0].price_data.unit_amount).toBe(config.stripePriceInCents);
    });

    it('binds the browser to the session with the checkout cookie (unchanged Sec3 behaviour)', async () => {
        vi.mocked(prisma.employerJob.count).mockResolvedValue(0 as never);
        const { res } = await post(BODY);
        expect(res.headers.get('set-cookie')).toContain('checkout_session_bind=cs_1');
    });

    it('leaves payment methods to the Dashboard, keys the create, uses getBaseUrl and records the session on the row', async () => {
        vi.mocked(prisma.employerJob.count).mockResolvedValue(0 as never);
        await post(BODY);

        const [arg, options] = sessionsCreate.mock.calls[0] as [Record<string, unknown>, { idempotencyKey?: string }];
        expect(arg).not.toHaveProperty('payment_method_types');
        expect(arg.success_url).toBe('http://localhost:3000/success?session_id={CHECKOUT_SESSION_ID}');
        expect(arg.cancel_url).toBe('http://localhost:3000/post-job');
        expect(options).toEqual({ idempotencyKey: 'new-post-ej-1' });
        // The bearer dashboardToken never leaves our database.
        expect(JSON.stringify(arg)).not.toContain('dash-1');
        expect(prisma.employerJob.update).toHaveBeenCalledWith({ where: { id: 'ej-1' }, data: { stripeCheckoutSessionId: 'cs_1' } });
    });

    it('every paid post runs config.durationDays from creation, unpublished until the webhook', async () => {
        vi.mocked(prisma.employerJob.count).mockResolvedValue(0 as never);
        const before = Date.now();
        await post(BODY);
        const job = vi.mocked(prisma.job.create).mock.calls[0][0].data as { expiresAt: Date; isPublished: boolean };
        expect(job.isPublished).toBe(false);
        const days = (job.expiresAt.getTime() - before) / (24 * 60 * 60 * 1000);
        expect(days).toBeGreaterThan(config.durationDays - 0.01);
        expect(days).toBeLessThan(config.durationDays + 0.01);
    });
});

describe('B78 resume path — re-prices from the persisted rung', () => {
    function pendingRow(pricingTier: string) {
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({
            id: 'ej-9',
            jobId: 'job-9',
            paymentStatus: 'pending',
            pricingTier,
            userId: 'user-1',
            contactEmail: 'hiring@recruiter-agency.example',
            dashboardToken: 'dash-9',
            job: { id: 'job-9', title: 'Resumed PMHNP', employer: 'Clinic Co', location: 'Remote', archivedAt: null },
        } as never);
    }

    it("keeps the intro price for a row quoted 'intro', without a fresh count", async () => {
        pendingRow('intro');
        const { res, json } = await post({ resumeJobId: 'job-9' });
        expect(res.status).toBe(200);
        expect(json).toMatchObject({ tier: 'intro', price: config.introPrice });
        const arg = stripeSessionArg();
        expect(arg.line_items[0].price_data.unit_amount).toBe(config.stripeIntroPriceInCents);
        expect(arg.metadata).toEqual({ jobId: 'job-9', pricing: 'intro' });
        expect(prisma.employerJob.count).not.toHaveBeenCalled();
        expect(prisma.employerJob.create).not.toHaveBeenCalled();
    });

    it("charges the featured price for a 'pro' row", async () => {
        pendingRow('pro');
        const { json } = await post({ resumeJobId: 'job-9' });
        expect(json).toMatchObject({ tier: 'pro', price: config.postingPrice });
        expect(stripeSessionArg().line_items[0].price_data.unit_amount).toBe(config.stripePriceInCents);
    });

    it('never under-charges a legacy / unknown persisted tier', async () => {
        pendingRow('starter');
        const { json } = await post({ resumeJobId: 'job-9' });
        expect(json.tier).toBe('pro');
        expect(stripeSessionArg().line_items[0].price_data.unit_amount).toBe(config.stripePriceInCents);
    });

    it('expires the previous open session before minting a new one, and keys the create on it', async () => {
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({
            id: 'ej-9', jobId: 'job-9', paymentStatus: 'pending', pricingTier: 'pro', userId: 'user-1',
            contactEmail: 'x@y.example', dashboardToken: 'd', stripeCheckoutSessionId: 'cs_old',
            job: { id: 'job-9', title: 't', employer: 'e', location: 'l', archivedAt: null },
        } as never);
        sessionsRetrieve.mockResolvedValue({ id: 'cs_old', status: 'open' });
        sessionsExpire.mockResolvedValue({ id: 'cs_old', status: 'expired' });

        const { res } = await post({ resumeJobId: 'job-9' });

        expect(res.status).toBe(200);
        expect(sessionsExpire).toHaveBeenCalledWith('cs_old');
        expect(sessionsExpire.mock.invocationCallOrder[0]).toBeLessThan(sessionsCreate.mock.invocationCallOrder[0]);
        const [arg, options] = sessionsCreate.mock.calls[0] as [Record<string, unknown>, { idempotencyKey?: string }];
        expect(arg).not.toHaveProperty('payment_method_types');
        expect(options).toEqual({ idempotencyKey: 'resume-ej-9-pro-cs_old' });
        expect(prisma.employerJob.update).toHaveBeenCalledWith({ where: { id: 'ej-9' }, data: { stripeCheckoutSessionId: 'cs_1' } });
    });

    it('still resumes when the previous session is already expired (expire errors are ignored)', async () => {
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({
            id: 'ej-9', jobId: 'job-9', paymentStatus: 'pending', pricingTier: 'pro', userId: 'user-1',
            contactEmail: 'x@y.example', dashboardToken: 'd', stripeCheckoutSessionId: 'cs_old',
            job: { id: 'job-9', title: 't', employer: 'e', location: 'l', archivedAt: null },
        } as never);
        sessionsRetrieve.mockRejectedValue(new Error('No such checkout.session'));

        const { res } = await post({ resumeJobId: 'job-9' });

        expect(res.status).toBe(200);
        expect(sessionsCreate).toHaveBeenCalledOnce();
    });

    it('409s instead of selling the post twice when the previous session was already paid', async () => {
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({
            id: 'ej-9', jobId: 'job-9', paymentStatus: 'pending', pricingTier: 'pro', userId: 'user-1',
            contactEmail: 'x@y.example', dashboardToken: 'd', stripeCheckoutSessionId: 'cs_paid',
            job: { id: 'job-9', title: 't', employer: 'e', location: 'l', archivedAt: null },
        } as never);
        sessionsRetrieve.mockResolvedValue({ id: 'cs_paid', status: 'complete', payment_status: 'paid' });

        const { res, json } = await post({ resumeJobId: 'job-9' });

        expect(res.status).toBe(409);
        expect(json.code).toBe('PAYMENT_PROCESSING');
        expect(sessionsCreate).not.toHaveBeenCalled();
        expect(sessionsExpire).not.toHaveBeenCalled();
    });

    it('409s a row that has no outstanding payment', async () => {
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({
            id: 'ej-9', jobId: 'job-9', paymentStatus: 'paid', pricingTier: 'intro', userId: 'user-1',
            contactEmail: 'x@y.example', dashboardToken: 'd', job: { id: 'job-9', title: 't', employer: 'e', location: 'l', archivedAt: null },
        } as never);
        const { res, json } = await post({ resumeJobId: 'job-9' });
        expect(res.status).toBe(409);
        expect(json.code).toBe('NOT_RESUMABLE');
        expect(sessionsCreate).not.toHaveBeenCalled();
    });
});

describe('B78 resume path — delayed payments decide by payment_status, not session status', () => {
    function rowWithPreviousSession(paymentStatus = 'pending') {
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({
            id: 'ej-9', jobId: 'job-9', paymentStatus, pricingTier: 'pro', userId: 'user-1',
            contactEmail: 'x@y.example', dashboardToken: 'd', stripeCheckoutSessionId: 'cs_prev',
            job: { id: 'job-9', title: 't', employer: 'e', location: 'l', archivedAt: null },
        } as never);
    }

    it('reads the previous session with its PaymentIntent expanded', async () => {
        rowWithPreviousSession();
        sessionsRetrieve.mockResolvedValue({ id: 'cs_prev', status: 'expired', payment_status: 'unpaid' });
        await post({ resumeJobId: 'job-9' });
        expect(sessionsRetrieve).toHaveBeenCalledWith('cs_prev', { expand: ['payment_intent'] });
    });

    it('a failed delayed payment (complete, unpaid, intent back to requires_payment_method) can be paid again', async () => {
        rowWithPreviousSession('expired');
        sessionsRetrieve.mockResolvedValue({
            id: 'cs_prev', status: 'complete', payment_status: 'unpaid',
            payment_intent: { id: 'pi_prev', status: 'requires_payment_method' },
        });

        const { res, json } = await post({ resumeJobId: 'job-9' });

        expect(res.status).toBe(200);
        expect(json).toMatchObject({ sessionId: 'cs_1', tier: 'pro', price: config.postingPrice });
        expect(sessionsCreate).toHaveBeenCalledOnce();
        // A completed session cannot be expired; nothing is payable on it any more.
        expect(sessionsExpire).not.toHaveBeenCalled();
        // The swept row is revived so the new session's activation can claim it.
        expect(prisma.employerJob.updateMany).toHaveBeenCalledWith({
            where: { id: 'ej-9', paymentStatus: 'expired' },
            data: { paymentStatus: 'pending' },
        });
    });

    it('a delayed payment that is still settling (intent processing) is refused, so the employer cannot pay twice', async () => {
        rowWithPreviousSession();
        sessionsRetrieve.mockResolvedValue({
            id: 'cs_prev', status: 'complete', payment_status: 'unpaid',
            payment_intent: { id: 'pi_prev', status: 'processing' },
        });

        const { res, json } = await post({ resumeJobId: 'job-9' });

        expect(res.status).toBe(409);
        expect(json.code).toBe('PAYMENT_PROCESSING');
        expect(json.error).toMatch(/still processing/);
        expect(json.error).toMatch(/goes live automatically once it clears/);
        expect(sessionsCreate).not.toHaveBeenCalled();
        expect(prisma.job.update).not.toHaveBeenCalled();
    });

    it('a delayed payment awaiting ACH microdeposit verification (intent requires_action) is refused, so the employer cannot pay twice', async () => {
        rowWithPreviousSession();
        sessionsRetrieve.mockResolvedValue({
            id: 'cs_prev', status: 'complete', payment_status: 'unpaid',
            payment_intent: { id: 'pi_prev', status: 'requires_action', next_action: { type: 'verify_with_microdeposits' } },
        });

        const { res, json } = await post({ resumeJobId: 'job-9' });

        expect(res.status).toBe(409);
        expect(json.code).toBe('PAYMENT_PROCESSING');
        expect(json.error).toMatch(/verify your bank account/);
        expect(json.error).toMatch(/nothing more to pay now/);
        expect(json.error).not.toMatch(/[–—]| - /);
        expect(sessionsCreate).not.toHaveBeenCalled();
        expect(sessionsExpire).not.toHaveBeenCalled();
        expect(prisma.job.update).not.toHaveBeenCalled();
        expect(prisma.employerJob.updateMany).not.toHaveBeenCalled();
    });

    it("a delayed payment that was canceled (complete, unpaid, intent 'canceled') can be paid again", async () => {
        rowWithPreviousSession();
        sessionsRetrieve.mockResolvedValue({
            id: 'cs_prev', status: 'complete', payment_status: 'unpaid',
            payment_intent: { id: 'pi_prev', status: 'canceled' },
        });

        const { res } = await post({ resumeJobId: 'job-9' });

        expect(res.status).toBe(200);
        expect(sessionsCreate).toHaveBeenCalledOnce();
    });

    it("treats 'no_payment_required' like 'paid': refused, never sold again", async () => {
        rowWithPreviousSession();
        sessionsRetrieve.mockResolvedValue({ id: 'cs_prev', status: 'complete', payment_status: 'no_payment_required' });

        const { res, json } = await post({ resumeJobId: 'job-9' });

        expect(res.status).toBe(409);
        expect(json.code).toBe('PAYMENT_PROCESSING');
        expect(json.error).toMatch(/already received/);
        expect(sessionsCreate).not.toHaveBeenCalled();
    });
});

describe('launch promo — no paid checkout while every post is free', () => {
    const PROMO_MESSAGE = `Every post is free through ${config.promoEndsLabel}. Go back to the preview to publish.`;

    beforeEach(() => {
        vi.mocked(config.isPromoActive).mockReturnValue(true);
    });

    it('refuses a new paid post with 409 PROMO_ACTIVE before creating any row or Stripe session', async () => {
        vi.mocked(prisma.employerJob.count).mockResolvedValue(0 as never);

        const { res, json } = await post(BODY);

        expect(res.status).toBe(409);
        expect(json).toEqual({ code: 'PROMO_ACTIVE', error: PROMO_MESSAGE });
        expect(prisma.employerJob.count).not.toHaveBeenCalled();
        expect(prisma.job.create).not.toHaveBeenCalled();
        expect(prisma.employerJob.create).not.toHaveBeenCalled();
        expect(sessionsCreate).not.toHaveBeenCalled();
        expect(res.headers.get('set-cookie')).toBeNull();
    });

    it("refuses the dashboard's resume path too, before touching the row or Stripe", async () => {
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({
            id: 'ej-9', jobId: 'job-9', paymentStatus: 'expired', pricingTier: 'intro', userId: 'user-1',
            contactEmail: 'x@y.example', dashboardToken: 'd', stripeCheckoutSessionId: 'cs_old',
            job: { id: 'job-9', title: 't', employer: 'e', location: 'l', archivedAt: null },
        } as never);

        const { res, json } = await post({ resumeJobId: 'job-9' });

        expect(res.status).toBe(409);
        expect(json).toEqual({ code: 'PROMO_ACTIVE', error: PROMO_MESSAGE });
        expect(prisma.employerJob.findFirst).not.toHaveBeenCalled();
        expect(prisma.employerJob.updateMany).not.toHaveBeenCalled();
        expect(sessionsRetrieve).not.toHaveBeenCalled();
        expect(sessionsExpire).not.toHaveBeenCalled();
        expect(sessionsCreate).not.toHaveBeenCalled();
    });

    it('nothing in the request can switch the promo check off', async () => {
        const { res } = await post({ ...BODY, promoActive: false, isPromoActive: false, now: '2027-06-01T00:00:00Z', pricingTier: 'pro' });
        expect(res.status).toBe(409);
        expect(sessionsCreate).not.toHaveBeenCalled();
    });

    it('consults config.isPromoActive, the promo clock tests/lib/config-pricing.test.ts pins', async () => {
        await post(BODY);
        expect(config.isPromoActive).toHaveBeenCalledWith();
    });
});
