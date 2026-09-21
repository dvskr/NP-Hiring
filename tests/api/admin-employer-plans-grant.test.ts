/**
 * POST /api/admin/employer-plans — admin grant / attach must never sever a
 * paying Stripe subscription.
 *
 * Pins:
 *   - a grant that would change status / period end / slots on a row that
 *     has a stripeSubscriptionId is refused with 409 (Stripe owns those
 *     fields — use PATCH), and nothing is written;
 *   - ATTACHING an unmatched Stripe row (userId null → employer) is allowed
 *     and goes through upsertPlan without Stripe ids, so the ids survive
 *     (the id-preservation itself is pinned in tests/lib/employer-plan.test.ts);
 *   - a plain comp grant for an employer with no Stripe row still works.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/auth/require-api-admin', () => ({ requireApiAdmin: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/csrf', () => ({ verifyCsrf: vi.fn().mockReturnValue(null) }));
vi.mock('@/lib/audit-log', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin-1' } } }) } })),
}));

const planMocks = vi.hoisted(() => ({ upsertPlan: vi.fn(), findExistingPlanRow: vi.fn() }));
vi.mock('@/lib/employer-plan', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/employer-plan')>();
    return { ...actual, ...planMocks };
});

const PERIOD_END = new Date('2027-02-01T00:00:00Z');

function stripeRow(overrides: Record<string, unknown> = {}) {
    return {
        id: 'plan-stripe',
        userId: null,
        email: 'billing@clinic.example',
        status: 'active',
        slots: 5,
        priceCents: 39900,
        currentPeriodEnd: PERIOD_END,
        stripeCustomerId: 'cus_x',
        stripeSubscriptionId: 'sub_x',
        source: 'stripe',
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    };
}

function grant(body: object): NextRequest {
    return new NextRequest('https://test.local/api/admin/employer-plans', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
    });
}

async function post(body: object) {
    const { POST } = await import('@/app/api/admin/employer-plans/route');
    const res = await POST(grant(body));
    return { res, json: await res.json() };
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.userProfile.findFirst).mockResolvedValue({ supabaseId: 'employer-1', email: 'billing@clinic.example' } as never);
    vi.mocked(prisma.employerJob.groupBy).mockResolvedValue([] as never);
    vi.mocked(prisma.employerJob.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.employerPlan.findUnique).mockResolvedValue(null as never);
});

describe('admin grant on a Stripe-billed row', () => {
    it('attaches an unmatched Stripe row to the employer without passing (or wiping) its Stripe ids', async () => {
        planMocks.findExistingPlanRow.mockResolvedValue({ row: stripeRow(), matchedBy: 'email' });
        planMocks.upsertPlan.mockResolvedValue(stripeRow({ userId: 'employer-1' }));

        const { res, json } = await post({ email: 'billing@clinic.example' });

        expect(res.status).toBe(201);
        expect(json.attached).toBe(true);
        expect(planMocks.findExistingPlanRow).toHaveBeenCalledWith({ stripeSubscriptionId: null, userId: 'employer-1', email: 'billing@clinic.example' });
        const input = planMocks.upsertPlan.mock.calls[0][0] as Record<string, unknown>;
        expect(input).toMatchObject({ userId: 'employer-1', source: 'admin', slots: 5 });
        expect(input).not.toHaveProperty('stripeSubscriptionId');
        expect(input).not.toHaveProperty('stripeCustomerId');
    });

    it.each([
        ['status', { status: 'cancelled' }],
        ['period end', { currentPeriodEnd: '2027-06-01' }],
        ['slots', { slots: 10 }],
    ])('409s a grant that would change %s on a Stripe-billed row, writing nothing', async (_label, change) => {
        planMocks.findExistingPlanRow.mockResolvedValue({ row: stripeRow({ userId: 'employer-1' }), matchedBy: 'user' });

        const { res, json } = await post({ email: 'billing@clinic.example', ...change });

        expect(res.status).toBe(409);
        expect(json.error).toMatch(/billed through Stripe/);
        expect(json.planId).toBe('plan-stripe');
        expect(planMocks.upsertPlan).not.toHaveBeenCalled();
    });

    it("409s a bare re-grant for an employer who already pays through Stripe ('comp them a month')", async () => {
        planMocks.findExistingPlanRow.mockResolvedValue({ row: stripeRow({ userId: 'employer-1' }), matchedBy: 'user' });

        const { res } = await post({ email: 'billing@clinic.example' });

        expect(res.status).toBe(409);
        expect(planMocks.upsertPlan).not.toHaveBeenCalled();
    });

    it('still grants a comp plan to an employer with no Stripe row', async () => {
        planMocks.findExistingPlanRow.mockResolvedValue(null);
        planMocks.upsertPlan.mockResolvedValue(stripeRow({ id: 'plan-comp', userId: 'employer-1', stripeSubscriptionId: null, stripeCustomerId: null, source: 'admin' }));

        const { res } = await post({ email: 'billing@clinic.example', slots: 3, currentPeriodEnd: '2027-03-01' });

        expect(res.status).toBe(201);
        expect(planMocks.upsertPlan).toHaveBeenCalledWith(expect.objectContaining({ userId: 'employer-1', slots: 3, status: 'active', source: 'admin' }));
    });
});
