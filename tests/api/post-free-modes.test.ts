/**
 * POST /api/jobs/post-free — the no-charge posting gate under the 2026-09-12
 * launch promo + 2027 ladder.
 *
 * The path name is historical; the route now publishes a job when the
 * employer's NEXT post costs nothing and refuses (403 requiresPayment) when it
 * does. What this file pins, per mode:
 *
 *   promo — every post is free through config.promoEndsLabel: the row is
 *           written as paymentStatus 'promo' / pricingTier 'pro', runs
 *           config.durationDays, snapshots the SIGNUP domain into quotaDomain,
 *           and the response carries mode 'promo'. The abuse cap
 *           (config.promoMaxActivePostsPerDomain, re-counted inside the
 *           transaction) 403s with promoCapReached. A 5-post pack credit is
 *           not read and not spent: the promo wins.
 *   pack  — after the promo, a usable 5-post pack credit publishes the post:
 *           one credit is spent INSIDE the Serializable transaction that
 *           creates the post (a conditional decrement, lib/post-packs.ts), the
 *           row is written 'pack' / 'pack' with postPackId, and the response
 *           carries mode 'pack' and the credits left. A credit spent first by a
 *           parallel post answers 409 packCreditUnavailable, a serialization
 *           conflict 409 retry, never 500, and nothing is written either way.
 *   paid  — otherwise 403 { requiresPayment, mode: 'intro' | 'paid', tier,
 *           price, priceCents } from the same quote the checkout charges.
 * The Employer plan path is gone (phase 2 of the 2027 re-price: no plan row
 * exists in production).
 *
 * Plus the signup-domain rules that never change: a free-mail signup is 400
 * even during the promo, and the form contactEmail can never shift the domain.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';
import { paidPostWhere } from '@/lib/pricing';
import { usablePackWhere } from '@/lib/post-packs';
import { sendConfirmationEmail } from '@/lib/email-service';

const getUserMock = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}));

vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn().mockResolvedValue(null),
    RATE_LIMITS: { postJob: { limit: 100, windowMs: 60_000 } },
}));

// Pass-through sanitizers — the gate logic is what's under test, not HTML cleaning.
vi.mock('@/lib/sanitize', () => ({
    sanitizeJobPosting: vi.fn().mockImplementation((d: Record<string, unknown>) => d),
    sanitizeUrl: vi.fn().mockImplementation((u: string) => u),
    sanitizeEmail: vi.fn().mockImplementation((e: string) => e),
    sanitizeText: vi.fn().mockImplementation((t: string) => t),
    normalizeContentWhitespace: vi.fn().mockImplementation((s: string) => s),
}));

vi.mock('@/lib/inngest/client', () => ({ inngest: { send: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('@/lib/search-indexing', () => ({ pingAllSearchEngines: vi.fn().mockResolvedValue(undefined) }));

const DURING_PROMO = new Date('2026-10-01T12:00:00.000Z');
const AFTER_PROMO = new Date('2027-03-01T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const SIGNUP_DOMAIN = 'clinic.example';

const BODY = {
    title: 'PMHNP — Telepsychiatry',
    employer: 'Clinic Co',
    location: 'Remote',
    mode: 'Remote',
    jobType: 'Full-Time',
    description: '<p>' + 'x'.repeat(220) + '</p>',
    applyLink: 'https://clinic.example/apply',
    // Deliberately a DIFFERENT domain from the signup email: the form contact
    // email must never move the per-domain rules.
    contactEmail: 'hiring@recruiter-agency.example',
};

function makeReq(body: object = BODY): NextRequest {
    return new NextRequest('https://test.local/api/jobs/post-free', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
    });
}

function signedInEmployer(email = `owner@${SIGNUP_DOMAIN}`) {
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1', email } }, error: null });
    vi.mocked(prisma.userProfile.findUnique).mockResolvedValue({ supabaseId: 'user-1', role: 'employer', email } as never);
}

const PACK_EXPIRES = new Date('2027-12-15T00:00:00.000Z');

/** The account's usable packs, as getPackCreditStatus reads them: before the post, then after its credit is spent. */
function packCredits(before: number, after: number = before - 1) {
    const usable = (remaining: number) => (remaining > 0 ? [{ creditsRemaining: remaining, creditsTotal: config.packPosts, creditsRevoked: 0, expiresAt: PACK_EXPIRES }] : []);
    vi.mocked(prisma.employerPostPack.findMany)
        .mockResolvedValueOnce(usable(before) as never)
        .mockResolvedValueOnce(usable(after) as never);
    vi.mocked(prisma.employerPostPack.findFirst).mockResolvedValue({ id: 'pack-1' } as never);
    vi.mocked(prisma.employerPostPack.updateMany).mockResolvedValue({ count: 1 } as never);
}

/** No pack: the table as tests/setup.ts leaves it, with any queued answer from an earlier test dropped. */
function noPack() {
    vi.mocked(prisma.employerPostPack.findMany).mockReset().mockResolvedValue([] as never);
    vi.mocked(prisma.employerPostPack.findFirst).mockReset().mockResolvedValue(null as never);
    vi.mocked(prisma.employerPostPack.updateMany).mockReset().mockResolvedValue({ count: 0 } as never);
}

function wireWrites() {
    vi.mocked(prisma.$transaction).mockImplementation(((fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma)) as never);
    vi.mocked(prisma.job.create).mockResolvedValue({ id: 'job-1' } as never);
    vi.mocked(prisma.job.update).mockResolvedValue({ id: 'job-1', slug: 'pmhnp-telepsychiatry-job-1' } as never);
    vi.mocked(prisma.employerJob.create).mockResolvedValue({ id: 'ej-1' } as never);
    vi.mocked(prisma.jobDraft.deleteMany).mockResolvedValue({ count: 0 } as never);
}

async function post(body: object = BODY) {
    const { POST } = await import('@/app/api/jobs/post-free/route');
    const res = await POST(makeReq(body));
    return { res, json: await res.json() };
}

// Load the route graph once, outside any single test's time budget: on a
// loaded machine the cold import outran the first test's 5 second default.
beforeAll(async () => {
    await import('@/app/api/jobs/post-free/route');
}, 120_000);

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    wireWrites();
    noPack();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('launch promo — every post is free', () => {
    beforeEach(() => {
        vi.setSystemTime(DURING_PROMO);
        signedInEmployer();
    });

    it("publishes a 'promo' row for the full duration and reports mode 'promo'", async () => {
        vi.mocked(prisma.employerJob.count).mockResolvedValue(2 as never); // live promo posts at the domain

        const { res, json } = await post();

        expect(res.status).toBe(200);
        expect(json).toMatchObject({ success: true, jobId: 'job-1', mode: 'promo' });
        expect(json.editToken).toMatch(/^[0-9a-f]{64}$/);
        expect(json.dashboardToken).toMatch(/^[0-9a-f]{64}$/);

        const row = vi.mocked(prisma.employerJob.create).mock.calls[0][0].data;
        expect(row).toMatchObject({
            paymentStatus: 'promo',
            pricingTier: 'pro',
            userId: 'user-1',
            quotaDomain: SIGNUP_DOMAIN,
            contactEmail: BODY.contactEmail,
        });

        const job = vi.mocked(prisma.job.create).mock.calls[0][0].data as { expiresAt: Date; isPublished: boolean; isFeatured: boolean };
        expect(job.isPublished).toBe(true);
        expect(job.isFeatured).toBe(false); // top placement comes from the EmployerJob relation
        expect(Math.round((job.expiresAt.getTime() - DURING_PROMO.getTime()) / DAY_MS)).toBe(config.durationDays);
        expect(config.durationDays).toBe(60);
    });

    it('re-counts the live promo posts through the transaction client with the immutable domain anchor', async () => {
        vi.mocked(prisma.employerJob.count).mockResolvedValue(0 as never);
        await post();
        expect(prisma.employerJob.count).toHaveBeenCalledWith({
            where: {
                quotaDomain: SIGNUP_DOMAIN,
                paymentStatus: 'promo',
                job: { isPublished: true, OR: [{ expiresAt: null }, { expiresAt: { gt: DURING_PROMO } }] },
            },
        });
    });

    it('sends the confirmation email with the real listing duration and the promo mode', async () => {
        vi.mocked(prisma.employerJob.count).mockResolvedValue(0 as never);
        await post();
        expect(sendConfirmationEmail).toHaveBeenCalledOnce();
        const args = vi.mocked(sendConfirmationEmail).mock.calls[0];
        expect(args[0]).toBe(BODY.contactEmail);
        expect(args[2]).toBe('job-1');
        expect(args[5]).toBe(config.durationDays);
        expect(args[6]).toBeUndefined(); // no invoice on a no-charge post
        expect(args[7]).toBe('promo');
    });

    it('403s with promoCapReached at the per-domain cap, writing nothing', async () => {
        vi.mocked(prisma.employerJob.count).mockResolvedValue(config.promoMaxActivePostsPerDomain as never);

        const { res, json } = await post();

        expect(res.status).toBe(403);
        expect(json.promoCapReached).toBe(true);
        expect(json.requiresPayment).toBeUndefined();
        expect(json.error).toContain(SIGNUP_DOMAIN);
        expect(prisma.job.create).not.toHaveBeenCalled();
        expect(prisma.employerJob.create).not.toHaveBeenCalled();
        expect(sendConfirmationEmail).not.toHaveBeenCalled();
    });

    it('never asks for payment during the promo — the paid-post count is not even consulted', async () => {
        vi.mocked(prisma.employerJob.count).mockResolvedValue(0 as never);
        const { res, json } = await post();
        expect(res.status).toBe(200);
        expect(json.mode).toBe('promo');
        expect(prisma.employerJob.count).not.toHaveBeenCalledWith({ where: paidPostWhere(SIGNUP_DOMAIN) });
    });

    it('ignores a 5-post pack: the promo wins, and the credit is neither read nor spent', async () => {
        packCredits(5);
        vi.mocked(prisma.employerJob.count).mockResolvedValue(0 as never);

        const { res, json } = await post();

        expect(res.status).toBe(200);
        expect(json.mode).toBe('promo');
        expect(json).not.toHaveProperty('pack');
        expect(vi.mocked(prisma.employerJob.create).mock.calls[0][0].data).toMatchObject({ paymentStatus: 'promo', pricingTier: 'pro' });
        expect(vi.mocked(prisma.employerJob.create).mock.calls[0][0].data).not.toHaveProperty('postPackId');
        expect(prisma.employerPostPack.findMany).not.toHaveBeenCalled();
        expect(prisma.employerPostPack.updateMany).not.toHaveBeenCalled();
    });
});

describe('5-post pack: after the promo, a usable credit publishes the post', () => {
    beforeEach(() => {
        vi.setSystemTime(AFTER_PROMO);
        signedInEmployer();
    });

    it("spends one credit and publishes a 'pack' / 'pack' row that names its pack", async () => {
        packCredits(5);

        const { res, json } = await post();

        expect(res.status).toBe(200);
        expect(json).toMatchObject({
            success: true,
            jobId: 'job-1',
            mode: 'pack',
            pack: { remaining: 4, total: config.packPosts, expiresAt: PACK_EXPIRES.toISOString() },
        });
        expect(vi.mocked(prisma.employerJob.create).mock.calls[0][0].data).toMatchObject({
            paymentStatus: 'pack',
            pricingTier: 'pack',
            postPackId: 'pack-1',
            userId: 'user-1',
            quotaDomain: SIGNUP_DOMAIN,
        });
        const job = vi.mocked(prisma.job.create).mock.calls[0][0].data as { expiresAt: Date; isPublished: boolean };
        expect(job.isPublished).toBe(true);
        expect(Math.round((job.expiresAt.getTime() - AFTER_PROMO.getTime()) / DAY_MS)).toBe(config.durationDays);
        // A pack post is never priced: the paid-post count is not consulted.
        expect(prisma.employerJob.count).not.toHaveBeenCalledWith({ where: paidPostWhere(SIGNUP_DOMAIN) });
    });

    it('reads the credit for the account, then spends it inside the Serializable transaction, before the post is created', async () => {
        packCredits(2);

        await post();

        expect(prisma.employerPostPack.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: usablePackWhere('user-1', AFTER_PROMO) }));
        expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
        expect(prisma.employerPostPack.updateMany).toHaveBeenCalledWith({
            where: { id: 'pack-1', userId: 'user-1', status: 'paid', expiresAt: { gt: AFTER_PROMO }, creditsRemaining: { gt: 0 } },
            data: { creditsRemaining: { decrement: 1 } },
        });
        const spent = vi.mocked(prisma.employerPostPack.updateMany).mock.invocationCallOrder[0];
        expect(spent).toBeLessThan(vi.mocked(prisma.job.create).mock.invocationCallOrder[0]);
        expect(spent).toBeLessThan(vi.mocked(prisma.employerJob.create).mock.invocationCallOrder[0]);
    });

    it('reports the credits left after this post, across the packs, from inside the transaction', async () => {
        packCredits(1, 0);

        const { json } = await post();

        expect(json.pack).toEqual({ remaining: 0, total: 0, expiresAt: null });
    });

    it("sends the confirmation email in 'pack' mode, with no invoice", async () => {
        packCredits(3);

        await post();

        const args = vi.mocked(sendConfirmationEmail).mock.calls[0];
        expect(args[6]).toBeUndefined();
        expect(args[7]).toBe('pack');
    });

    it('a credit spent first by a parallel post answers 409 packCreditUnavailable and writes nothing', async () => {
        packCredits(1);
        vi.mocked(prisma.employerPostPack.updateMany).mockResolvedValue({ count: 0 } as never);

        const { res, json } = await post();

        expect(res.status).toBe(409);
        expect(json.packCreditUnavailable).toBe(true);
        expect(json.error).not.toMatch(/[–—]| - /);
        expect(prisma.job.create).not.toHaveBeenCalled();
        expect(prisma.employerJob.create).not.toHaveBeenCalled();
        expect(sendConfirmationEmail).not.toHaveBeenCalled();
    });

    it('a serialization conflict (P2034) answers 409 try again, never 500', async () => {
        packCredits(2);
        vi.mocked(prisma.$transaction).mockRejectedValueOnce(Object.assign(new Error('could not serialize access'), { code: 'P2034' }) as never);

        const { res, json } = await post();

        expect(res.status).toBe(409);
        expect(json.retry).toBe(true);
        expect(json.error).toMatch(/try again/i);
        expect(sendConfirmationEmail).not.toHaveBeenCalled();
    });

    it('any other failure inside the transaction is still a 500', async () => {
        packCredits(2);
        vi.mocked(prisma.$transaction).mockRejectedValueOnce(new Error('connection reset') as never);

        const { res } = await post();

        expect(res.status).toBe(500);
    });
});

describe('paid ladder — after the promo with no pack credit', () => {
    beforeEach(() => {
        vi.setSystemTime(AFTER_PROMO);
        signedInEmployer();
    });

    it('403s requiresPayment with the intro price when the domain has no paid post', async () => {
        vi.mocked(prisma.employerJob.count).mockResolvedValue(0 as never);

        const { res, json } = await post();

        expect(res.status).toBe(403);
        expect(json).toMatchObject({
            requiresPayment: true,
            mode: 'intro',
            tier: 'intro',
            price: config.introPrice,
            priceCents: config.stripeIntroPriceInCents,
        });
        expect(json.error).toContain(`$${config.introPrice}`);
        expect(json.error).toContain(`${config.durationDays} days`);
        // The intro allowance is decided by PAID posts at the signup domain only
        // (predicate pinned in tests/lib/pricing.test.ts).
        expect(prisma.employerJob.count).toHaveBeenCalledWith({ where: paidPostWhere(SIGNUP_DOMAIN) });
        expect(prisma.job.create).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('403s requiresPayment with the featured price once the domain has a paid post', async () => {
        vi.mocked(prisma.employerJob.count).mockResolvedValue(1 as never);

        const { res, json } = await post();

        expect(res.status).toBe(403);
        expect(json).toMatchObject({
            requiresPayment: true,
            mode: 'paid',
            tier: 'pro',
            price: config.postingPrice,
            priceCents: config.stripePriceInCents,
        });
    });

    it('a pack whose credits are spent, expired or revoked falls through to the ladder', async () => {
        // No usable pack (getPackCreditStatus reads only usable ones), but a paid
        // Stripe pack at the domain used the intro price up.
        vi.mocked(prisma.employerJob.count).mockResolvedValue(0 as never);
        vi.mocked(prisma.employerPostPack.count).mockResolvedValueOnce(1 as never);

        const { res, json } = await post();

        expect(res.status).toBe(403);
        expect(json).toMatchObject({ requiresPayment: true, mode: 'paid', tier: 'pro', price: config.postingPrice });
        expect(prisma.employerPostPack.updateMany).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });
});

describe('signup-domain rules that hold in every mode', () => {
    beforeEach(() => {
        vi.setSystemTime(DURING_PROMO);
    });

    it('400s a free-mail signup even during the promo, ignoring a company contactEmail on the form', async () => {
        signedInEmployer('someone@gmail.com');
        const { res, json } = await post({ ...BODY, contactEmail: 'hr@clinic.example' });
        expect(res.status).toBe(400);
        expect(json.error).toBe('Company email required');
        expect(prisma.job.create).not.toHaveBeenCalled();
    });

    it('400s a free-mail signup after the promo too, before any pack credit is read', async () => {
        vi.setSystemTime(AFTER_PROMO);
        signedInEmployer('someone@gmail.com');
        packCredits(5);
        const { res } = await post();
        expect(res.status).toBe(400);
        expect(prisma.employerPostPack.findMany).not.toHaveBeenCalled();
        expect(prisma.employerPostPack.updateMany).not.toHaveBeenCalled();
    });

    it('401s an anonymous caller before any pricing decision', async () => {
        getUserMock.mockResolvedValue({ data: { user: null }, error: null });
        const { res } = await post();
        expect(res.status).toBe(401);
        expect(prisma.employerPostPack.findMany).not.toHaveBeenCalled();
    });

    it('403s a job-seeker account', async () => {
        getUserMock.mockResolvedValue({ data: { user: { id: 'seeker-1', email: 'np@clinic.example' } }, error: null });
        vi.mocked(prisma.userProfile.findUnique).mockResolvedValue({ supabaseId: 'seeker-1', role: 'job_seeker' } as never);
        const { res } = await post();
        expect(res.status).toBe(403);
        expect(prisma.employerPostPack.findMany).not.toHaveBeenCalled();
    });

    it('400s when required fields are missing, before touching auth', async () => {
        signedInEmployer();
        const { res, json } = await post({ ...BODY, title: '' });
        expect(res.status).toBe(400);
        expect(json.error).toContain('title');
        expect(getUserMock).not.toHaveBeenCalled();
    });
});
