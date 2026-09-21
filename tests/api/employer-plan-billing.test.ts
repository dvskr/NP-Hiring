/**
 * Employer plan self-serve surfaces:
 *   GET  /api/employer/plan            — server-built Payment Link + canManageBilling
 *   GET  /api/employer/plan/subscribe  — the /pricing CTA's gatekeeper redirect
 *   POST /api/employer/billing-portal  — Stripe Customer Portal session
 *
 * Pins:
 *   - the plan endpoint never hands out a raw link: it is the account-bound
 *     link from lib/employer-plan-link (null while plan sales are closed), and
 *     the Stripe customer id itself is never sent to the client;
 *   - subscribe: closed → /pricing; anonymous → login and back; non-employer →
 *     /pricing; already on a plan (entitled or pending) → dashboard, never a
 *     second subscription; otherwise → the account-bound Payment Link;
 *   - billing portal: the customer is read from the caller's own plan row
 *     (never the request), 400 without one, CSRF + auth enforced.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/require-employer-api', () => ({ requireEmployerApi: authMock }));

const getUserMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}));

const linkMocks = vi.hoisted(() => ({ buildPlanPaymentLink: vi.fn(), isPlanSaleOpen: vi.fn() }));
vi.mock('@/lib/employer-plan-link', () => linkMocks);

const csrfMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/csrf', () => ({ verifyCsrf: csrfMock }));
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn().mockResolvedValue(null),
    RATE_LIMITS: { employer: { limit: 30, windowSeconds: 60 } },
}));

const portalCreate = vi.hoisted(() => vi.fn());
vi.mock('stripe', () => ({
    default: vi.fn().mockImplementation(() => ({ billingPortal: { sessions: { create: portalCreate } } })),
}));

const PAYMENT_LINK = 'https://buy.stripe.com/test_abc?client_reference_id=user-1&prefilled_email=owner%40clinic.example';
const FUTURE = new Date(Date.now() + 20 * 86_400_000);

function planRow(overrides: Record<string, unknown> = {}) {
    return {
        id: 'plan-1', userId: 'user-1', email: 'owner@clinic.example', status: 'active', slots: 5, priceCents: 39900,
        currentPeriodEnd: FUTURE, stripeCustomerId: 'cus_secret', stripeSubscriptionId: 'sub_1', source: 'stripe',
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    authMock.mockResolvedValue({ user: { id: 'user-1', email: 'owner@clinic.example' }, profile: { id: 'p1', role: 'employer' }, isAdmin: false });
    linkMocks.isPlanSaleOpen.mockReturnValue(true);
    linkMocks.buildPlanPaymentLink.mockReturnValue(PAYMENT_LINK);
    csrfMock.mockReturnValue(null);
    vi.mocked(prisma.employerPlan.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.employerJob.count).mockResolvedValue(0 as never);
});

describe('GET /api/employer/plan', () => {
    it('returns the account-bound Payment Link and no Stripe ids', async () => {
        vi.mocked(prisma.employerPlan.findUnique).mockResolvedValue(planRow() as never);
        const { GET } = await import('@/app/api/employer/plan/route');
        const res = await GET();
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(linkMocks.buildPlanPaymentLink).toHaveBeenCalledWith({ userId: 'user-1', email: 'owner@clinic.example' });
        expect(json.paymentLinkUrl).toBe(PAYMENT_LINK);
        expect(json.plan.canManageBilling).toBe(true);
        expect(JSON.stringify(json)).not.toContain('cus_secret');
        expect(JSON.stringify(json)).not.toContain('sub_1');
    });

    it('hands out no link while plan sales are closed', async () => {
        linkMocks.buildPlanPaymentLink.mockReturnValue(null);
        const { GET } = await import('@/app/api/employer/plan/route');
        const json = await (await GET()).json();
        expect(json.paymentLinkUrl).toBeNull();
    });
});

describe('GET /api/employer/plan/subscribe', () => {
    async function subscribe() {
        const { GET } = await import('@/app/api/employer/plan/subscribe/route');
        return GET(new NextRequest('https://nphiring.test/api/employer/plan/subscribe'));
    }

    it('sends everyone to /pricing while plan sales are closed', async () => {
        linkMocks.isPlanSaleOpen.mockReturnValue(false);
        const res = await subscribe();
        expect(res.headers.get('location')).toBe('https://nphiring.test/pricing');
        expect(getUserMock).not.toHaveBeenCalled();
    });

    it('sends an anonymous visitor to login and back here', async () => {
        getUserMock.mockResolvedValue({ data: { user: null } });
        const res = await subscribe();
        expect(res.headers.get('location')).toBe('https://nphiring.test/login?redirectTo=%2Fapi%2Femployer%2Fplan%2Fsubscribe');
    });

    it('sends a non-employer account to /pricing', async () => {
        getUserMock.mockResolvedValue({ data: { user: { id: 'cand-1', email: 'c@x.example' } } });
        vi.mocked(prisma.userProfile.findUnique).mockResolvedValue({ role: 'job_seeker', email: 'c@x.example' } as never);
        const res = await subscribe();
        expect(res.headers.get('location')).toBe('https://nphiring.test/pricing');
    });

    it.each([
        ['entitled', planRow()],
        ['pending', planRow({ status: 'pending' })],
    ])('sends an employer whose plan is %s to the dashboard — never a second subscription', async (_label, row) => {
        getUserMock.mockResolvedValue({ data: { user: { id: 'user-1', email: 'owner@clinic.example' } } });
        vi.mocked(prisma.userProfile.findUnique).mockResolvedValue({ role: 'employer', email: 'owner@clinic.example' } as never);
        vi.mocked(prisma.employerPlan.findUnique).mockResolvedValue(row as never);
        const res = await subscribe();
        expect(res.headers.get('location')).toBe('https://nphiring.test/employer/dashboard?plan=manage');
        expect(linkMocks.buildPlanPaymentLink).not.toHaveBeenCalled();
    });

    it('redirects an employer without a plan to the account-bound Payment Link', async () => {
        getUserMock.mockResolvedValue({ data: { user: { id: 'user-1', email: 'owner@clinic.example' } } });
        vi.mocked(prisma.userProfile.findUnique).mockResolvedValue({ role: 'employer', email: 'owner@clinic.example' } as never);
        vi.mocked(prisma.employerPlan.findUnique).mockResolvedValue(planRow({ status: 'cancelled', currentPeriodEnd: new Date(Date.now() - 86_400_000) }) as never);
        const res = await subscribe();
        expect(res.status).toBe(303);
        expect(res.headers.get('location')).toBe(PAYMENT_LINK);
        expect(linkMocks.buildPlanPaymentLink).toHaveBeenCalledWith({ userId: 'user-1', email: 'owner@clinic.example' });
    });
});

describe('POST /api/employer/billing-portal', () => {
    async function openPortal(body: object = {}) {
        const { POST } = await import('@/app/api/employer/billing-portal/route');
        return POST(new NextRequest('https://nphiring.test/api/employer/billing-portal', { method: 'POST', body: JSON.stringify(body) }));
    }

    it("creates a portal session for the caller's OWN Stripe customer, ignoring anything in the request", async () => {
        vi.mocked(prisma.employerPlan.findUnique).mockResolvedValue(planRow() as never);
        portalCreate.mockResolvedValue({ url: 'https://billing.stripe.com/p/session_1' });

        const res = await openPortal({ customer: 'cus_attacker' });

        expect(res.status).toBe(200);
        expect((await res.json()).url).toBe('https://billing.stripe.com/p/session_1');
        expect(prisma.employerPlan.findUnique).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
        expect(portalCreate).toHaveBeenCalledWith({ customer: 'cus_secret', return_url: expect.stringMatching(/\/employer\/dashboard$/) });
    });

    it('400s when the plan has no Stripe customer (admin comp / no plan)', async () => {
        vi.mocked(prisma.employerPlan.findUnique).mockResolvedValue(planRow({ stripeCustomerId: null }) as never);
        const res = await openPortal();
        expect(res.status).toBe(400);
        expect(portalCreate).not.toHaveBeenCalled();
    });

    it('rejects a cross-site request before touching auth or Stripe', async () => {
        csrfMock.mockReturnValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
        const res = await openPortal();
        expect(res.status).toBe(403);
        expect(authMock).not.toHaveBeenCalled();
        expect(portalCreate).not.toHaveBeenCalled();
    });

    it('requires an authenticated employer', async () => {
        authMock.mockResolvedValue({ error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) });
        const res = await openPortal();
        expect(res.status).toBe(401);
        expect(portalCreate).not.toHaveBeenCalled();
    });
});
