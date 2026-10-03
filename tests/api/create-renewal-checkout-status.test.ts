/**
 * POST /api/create-renewal-checkout — which rows may buy a renewal
 * ($config.renewalPrice for +config.durationDays) under the 2026-09-12
 * launch promo + 2027 ladder.
 *
 *   allowed  'promo' (launch-free posts renew at the normal price) and 'paid'
 *   409      'pending' (never completed), 'expired' (an abandoned checkout the
 *            reconciliation sweep retired: never paid, so a renewal must not
 *            publish it at the renewal price), legacy 'free' (unchanged message),
 *            'refunded' (moderation gate), 'disputed' (chargeback), 'plan' (plan posts stay live while
 *            the plan is active — re-post from a slot instead)
 *
 * Also pins that metadata.tier carries the ROW's own rung so the renewal
 * webhook (which writes pricingTier = metadata.tier) cannot rewrite an
 * 'intro' row as 'pro'. A blocked row answers before any Stripe call, the
 * open-session scan included (tests/api/create-renewal-checkout-single-payable.test.ts
 * covers that scan).
 *
 * An archived post is refused with 409 too, whatever its status: a renewal
 * publishes, and the dashboard requires a restore before any republish.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';

const sessionsCreate = vi.fn();
const sessionsList = vi.fn();
const sessionsExpire = vi.fn();
vi.mock('stripe', () => ({
    default: vi.fn().mockImplementation(() => ({
        checkout: { sessions: { create: sessionsCreate, list: sessionsList, expire: sessionsExpire } },
    })),
}));

/** No other open renewal session for the post. */
function noOpenSessions() {
    return { async *[Symbol.asyncIterator]() { /* empty */ } };
}

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

function makeReq(body: object): NextRequest {
    return new NextRequest('https://test.local/api/create-renewal-checkout', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
    });
}

function row(paymentStatus: string, pricingTier = 'pro', archivedAt: Date | null = null) {
    vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({
        id: 'ej-1',
        jobId: 'job-1',
        editToken: 'edit-1',
        contactEmail: 'owner@clinic.example',
        paymentStatus,
        pricingTier,
        // A post well inside its renewal cap (tests/api/create-renewal-checkout-cap.test.ts covers the cap).
        job: { id: 'job-1', title: 'PMHNP', employer: 'Clinic Co', location: 'Remote', archivedAt, expiresAt: null, createdAt: new Date(Date.now() - 30 * 86_400_000) },
    } as never);
}

const ARCHIVED_AT = new Date('2026-09-30T12:00:00.000Z');
const VISIBLE_DASH = /[–—]|\s-\s/;

async function post() {
    const { POST } = await import('@/app/api/create-renewal-checkout/route');
    const res = await POST(makeReq({ jobId: 'job-1', editToken: 'edit-1' }));
    return { res, json: await res.json() };
}

// Load the route graph once, outside any single test's time budget (a cold
// import under a loaded full suite run can outlast vitest's 5 second default).
beforeAll(async () => {
    await import('@/app/api/create-renewal-checkout/route');
}, 60_000);

beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    // `created`: stamped by this request, so the route need not read the session back.
    sessionsCreate.mockImplementation(async () => ({ id: 'cs_r1', url: 'https://checkout.stripe.test/cs_r1', created: Math.floor(Date.now() / 1000) }));
    sessionsList.mockImplementation(noOpenSessions);
});

describe('renewable rows', () => {
    it("allows a 'promo' post to renew at the flat renewal price", async () => {
        row('promo');
        const { res, json } = await post();
        expect(res.status).toBe(200);
        expect(json).toMatchObject({ sessionId: 'cs_r1', url: 'https://checkout.stripe.test/cs_r1' });
        const arg = sessionsCreate.mock.calls[0][0];
        expect(arg.line_items[0].price_data.unit_amount).toBe(config.stripeRenewalPriceInCents);
        expect(arg.line_items[0].price_data.product_data.description).toContain(`${config.durationDays} more days`);
        expect(arg.metadata).toEqual({ jobId: 'job-1', type: 'renewal', tier: 'pro' });
        expect(res.headers.get('set-cookie')).toContain('pmhnp_renewal_session=cs_r1');
    });

    it("allows a 'paid' post and carries its own 'intro' rung through metadata", async () => {
        row('paid', 'intro');
        const { res } = await post();
        expect(res.status).toBe(200);
        expect(sessionsCreate.mock.calls[0][0].metadata.tier).toBe('intro');
    });

    it("never carries 'plan' or an unknown rung — anything else narrows to 'pro'", async () => {
        row('paid', 'starter');
        await post();
        expect(sessionsCreate.mock.calls[0][0].metadata.tier).toBe('pro');
    });

    it('leaves payment methods to the Dashboard, uses getBaseUrl, and keys the create so a double-click reuses one session', async () => {
        row('paid');
        await post();
        await post();
        const [arg, options] = sessionsCreate.mock.calls[0];
        expect(arg).not.toHaveProperty('payment_method_types');
        expect(arg.success_url).toBe('http://localhost:3000/employer/renewal-success?session_id={CHECKOUT_SESSION_ID}');
        expect(arg.cancel_url).toBe('http://localhost:3000/employer/dashboard');
        // 'v2' since the parameters gained expires_at (backlog 2.5); the tail is
        // a fingerprint of the create parameters, so a reused key always
        // carries the parameters it was first used with.
        expect(options.idempotencyKey).toMatch(/^renewal-v2-ej-1-none-\d+-[0-9a-f]{12}$/);
        expect(sessionsCreate.mock.calls[1][1].idempotencyKey).toBe(options.idempotencyKey);
    });
});

describe('blocked rows (409, no Stripe call)', () => {
    it("'plan' — plan posts are not renewed; each runs its 60 days, then re-post into the freed slot", async () => {
        row('plan', 'plan');
        const { res, json } = await post();
        expect(res.status).toBe(409);
        expect(json.error).toMatch(/plan slot/i);
        expect(json.error).toMatch(/Employer plan/);
        expect(sessionsCreate).not.toHaveBeenCalled();
    });

    it("legacy 'free' — unchanged message", async () => {
        row('free');
        const { res, json } = await post();
        expect(res.status).toBe(409);
        expect(json.error).toBe('Free posts cannot be renewed at the discounted rate. Post a new job at the regular price instead.');
        expect(sessionsCreate).not.toHaveBeenCalled();
    });

    it("'pending' — complete the original checkout instead", async () => {
        row('pending');
        const { res, json } = await post();
        expect(res.status).toBe(409);
        expect(json.error).toMatch(/never completed/i);
        expect(sessionsCreate).not.toHaveBeenCalled();
    });

    it("'expired' — an abandoned checkout cannot be bought back at the renewal price", async () => {
        row('expired');
        const { res, json } = await post();
        expect(res.status).toBe(409);
        expect(json.error).toMatch(/never completed/i);
        expect(json.error).toMatch(/complete the original checkout/i);
        expect(sessionsCreate).not.toHaveBeenCalled();
    });

    it("'refunded' — cannot relist at the discount", async () => {
        row('refunded');
        const { res, json } = await post();
        expect(res.status).toBe(409);
        expect(json.error).toMatch(/refunded/i);
        expect(sessionsCreate).not.toHaveBeenCalled();
    });

    it("'disputed' — a charged-back posting cannot buy its way back to 'paid'", async () => {
        row('disputed');
        const { res, json } = await post();
        expect(res.status).toBe(409);
        expect(json.error).toMatch(/payment dispute/i);
        expect(json.error).toMatch(/contact support/i);
        expect(sessionsCreate).not.toHaveBeenCalled();
    });

    it('404s an unknown job / edit token pair without leaking status', async () => {
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue(null as never);
        const { res } = await post();
        expect(res.status).toBe(404);
        expect(sessionsCreate).not.toHaveBeenCalled();
        expect(sessionsList).not.toHaveBeenCalled();
    });

    it.each(['plan', 'free', 'pending', 'expired', 'refunded', 'disputed'])(
        "'%s' answers before any Stripe call: no session is listed, expired or created",
        async (status) => {
            row(status, status === 'plan' ? 'plan' : 'pro');
            const { res } = await post();
            expect(res.status).toBe(409);
            expect(sessionsList).not.toHaveBeenCalled();
            expect(sessionsExpire).not.toHaveBeenCalled();
            expect(sessionsCreate).not.toHaveBeenCalled();
        },
    );
});

describe('archived posts (409: restore first, no Stripe call)', () => {
    it.each(['paid', 'promo'])("an archived '%s' post is refused until it is restored", async (status) => {
        row(status, 'pro', ARCHIVED_AT);
        const { res, json } = await post();
        expect(res.status).toBe(409);
        expect(json.archived).toBe(true);
        expect(json.error).toMatch(/archived/i);
        expect(json.error).toMatch(/Restore it from the Archived tab/);
        expect(json.error).not.toMatch(VISIBLE_DASH);
        expect(sessionsList).not.toHaveBeenCalled();
        expect(sessionsExpire).not.toHaveBeenCalled();
        expect(sessionsCreate).not.toHaveBeenCalled();
        expect(res.headers.get('set-cookie')).toBeNull();
    });

    it('loads archivedAt with the post, so the check reads the stored value', async () => {
        row('paid');
        const { res } = await post();
        expect(res.status).toBe(200);
        expect(prisma.employerJob.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            include: { job: { select: expect.objectContaining({ archivedAt: true }) } },
        }));
    });

    it('a status that can never renew keeps its own message when the post is archived as well', async () => {
        row('refunded', 'pro', ARCHIVED_AT);
        const { res, json } = await post();
        expect(res.status).toBe(409);
        expect(json.error).toMatch(/refunded/i);
        expect(json.archived).toBeUndefined();
    });
});
