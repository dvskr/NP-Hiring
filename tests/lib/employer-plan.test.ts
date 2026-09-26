/**
 * lib/employer-plan.ts — the $config.planPrice/month Employer plan
 * (2026-09-12 launch promo + 2027 ladder).
 *
 * What is pinned and why:
 *   - `isPlanEntitled` is the ONLY entitlement rule (webhook, posting gate,
 *     lapse job and admin page all call it): 'active' or 'past_due' AND
 *     currentPeriodEnd + config.planGraceDays still in the future. The grace
 *     window exists so Stripe Smart Retries can recover a failed payment
 *     without the employer's posts vanishing first. A 'cancelled' plan keeps
 *     exactly its paid-through period (no grace); a 'pending' plan (first
 *     payment not settled) is never entitled.
 *   - `getPlanSlotStatus` never counts posts for a plan that is not entitled
 *     (canPost must be false and no DB round-trip wasted).
 *   - `pausePlanPosts` / `resumePlanPosts` touch only 'plan' rows, keep the
 *     EmployerJob rows, and resume newest-first within the remaining slots.
 *     Resume only revives posts the PLAN paused: a post the employer paused
 *     or an admin unpublished / soft deleted (isManuallyUnpublished = true)
 *     stays down on every renewal.
 *   - `republishPlanPost` (employer unpause of a 'plan' post) reads the plan,
 *     counts live plan posts and writes in ONE Serializable transaction, and
 *     writes nothing unless the plan is entitled AND a slot is free.
 *   - `upsertPlan` falls through subscriptionId → userId → unattached email
 *     row so an admin grant followed by a Stripe checkout UPDATES rather
 *     than failing on the unique userId.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';
import {
    PLAN_STATUSES,
    PlanSubscriptionConflictError,
    findLapsedPlans,
    getActivePlan,
    getPlanSlotStatus,
    isPlanEntitled,
    mapStripeSubscriptionStatus,
    pausePlanPosts,
    planEntitlementEndsAt,
    republishPlanPost,
    resumePlanPosts,
    upsertPlan,
} from '@/lib/employer-plan';

const NOW = new Date('2027-02-10T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const daysFromNow = (days: number) => new Date(NOW.getTime() + days * DAY_MS);
const USER_ID = 'user-1';

function makePlan(overrides: Partial<{
    id: string; userId: string | null; email: string; status: string; slots: number; priceCents: number;
    currentPeriodEnd: Date; stripeCustomerId: string | null; stripeSubscriptionId: string | null; source: string;
}> = {}) {
    return {
        id: 'plan-1',
        userId: USER_ID,
        email: 'owner@clinic.example',
        status: 'active',
        slots: config.planSlots,
        priceCents: config.planPrice * 100,
        currentPeriodEnd: daysFromNow(10),
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_1',
        source: 'stripe',
        createdAt: NOW,
        updatedAt: NOW,
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('isPlanEntitled — active/past_due AND inside period end + grace', () => {
    it('is false for no plan', () => {
        expect(isPlanEntitled(null, NOW)).toBe(false);
        expect(isPlanEntitled(undefined, NOW)).toBe(false);
    });

    it('is true for an active plan whose period has not ended', () => {
        expect(isPlanEntitled(makePlan({ currentPeriodEnd: daysFromNow(1) }), NOW)).toBe(true);
    });

    it('stays true through the grace window after the period end (Smart Retries)', () => {
        const insideGrace = daysFromNow(-(config.planGraceDays - 1));
        expect(isPlanEntitled(makePlan({ status: 'active', currentPeriodEnd: insideGrace }), NOW)).toBe(true);
        expect(isPlanEntitled(makePlan({ status: 'past_due', currentPeriodEnd: insideGrace }), NOW)).toBe(true);
    });

    it('is false once period end + grace has passed', () => {
        const pastGrace = daysFromNow(-(config.planGraceDays + 1));
        expect(isPlanEntitled(makePlan({ status: 'active', currentPeriodEnd: pastGrace }), NOW)).toBe(false);
        expect(isPlanEntitled(makePlan({ status: 'past_due', currentPeriodEnd: pastGrace }), NOW)).toBe(false);
    });

    it('is false at the exact grace boundary (strictly greater than now)', () => {
        const boundary = new Date(NOW.getTime() - config.planGraceDays * DAY_MS);
        expect(planEntitlementEndsAt(boundary).getTime()).toBe(NOW.getTime());
        expect(isPlanEntitled(makePlan({ currentPeriodEnd: boundary }), NOW)).toBe(false);
        expect(isPlanEntitled(makePlan({ currentPeriodEnd: new Date(boundary.getTime() + 1) }), NOW)).toBe(true);
    });

    it('keeps a cancelled plan entitled through its paid period — and not one instant of grace beyond it (/terms §8)', () => {
        expect(isPlanEntitled(makePlan({ status: 'cancelled', currentPeriodEnd: daysFromNow(20) }), NOW)).toBe(true);
        expect(isPlanEntitled(makePlan({ status: 'cancelled', currentPeriodEnd: new Date(NOW.getTime() + 1) }), NOW)).toBe(true);
        expect(isPlanEntitled(makePlan({ status: 'cancelled', currentPeriodEnd: NOW }), NOW)).toBe(false);
        expect(isPlanEntitled(makePlan({ status: 'cancelled', currentPeriodEnd: daysFromNow(-1) }), NOW)).toBe(false);
    });

    it('never entitles a pending plan (checkout completed, first payment not settled)', () => {
        expect(isPlanEntitled(makePlan({ status: 'pending', currentPeriodEnd: daysFromNow(30) }), NOW)).toBe(false);
    });

    it('recognises exactly the four plan statuses', () => {
        expect([...PLAN_STATUSES].sort()).toEqual(['active', 'cancelled', 'past_due', 'pending']);
    });
});

describe('mapStripeSubscriptionStatus', () => {
    it.each([
        ['active', 'active'],
        ['trialing', 'active'],
        ['past_due', 'past_due'],
        ['unpaid', 'past_due'],
        ['paused', 'past_due'],
        ['incomplete', 'pending'],
        ['canceled', 'cancelled'],
        ['incomplete_expired', 'cancelled'],
    ])("maps Stripe '%s' → '%s'", (stripeStatus, planStatus) => {
        expect(mapStripeSubscriptionStatus(stripeStatus)).toBe(planStatus);
    });

    it("fails toward the grace window ('past_due') for an unknown status", () => {
        expect(mapStripeSubscriptionStatus('some_future_status')).toBe('past_due');
        expect(mapStripeSubscriptionStatus(undefined)).toBe('past_due');
    });
});

describe('getPlanSlotStatus', () => {
    it('reports no entitlement and no slots when the employer has no plan — without counting posts', async () => {
        vi.mocked(prisma.employerPlan.findUnique).mockResolvedValue(null as never);
        const status = await getPlanSlotStatus(USER_ID, NOW);
        expect(status).toEqual({ plan: null, entitled: false, slots: 0, used: 0, remaining: 0, canPost: false });
        expect(prisma.employerPlan.findUnique).toHaveBeenCalledWith({ where: { userId: USER_ID } });
        expect(prisma.employerJob.count).not.toHaveBeenCalled();
    });

    it("counts live 'plan' posts against the slots for an entitled plan", async () => {
        vi.mocked(prisma.employerPlan.findUnique).mockResolvedValue(makePlan({ slots: 5 }) as never);
        vi.mocked(prisma.employerJob.count).mockResolvedValue(3 as never);
        const status = await getPlanSlotStatus(USER_ID, NOW);
        expect(status).toMatchObject({ entitled: true, slots: 5, used: 3, remaining: 2, canPost: true });
        expect(prisma.employerJob.count).toHaveBeenCalledWith({
            where: {
                userId: USER_ID,
                paymentStatus: 'plan',
                job: { isPublished: true, OR: [{ expiresAt: null }, { expiresAt: { gt: NOW } }] },
            },
        });
    });

    it('cannot post when every slot is in use', async () => {
        vi.mocked(prisma.employerPlan.findUnique).mockResolvedValue(makePlan({ slots: 5 }) as never);
        vi.mocked(prisma.employerJob.count).mockResolvedValue(5 as never);
        const status = await getPlanSlotStatus(USER_ID, NOW);
        expect(status).toMatchObject({ used: 5, remaining: 0, canPost: false });
    });

    it('never goes negative when more posts are live than slots (admin shrank the plan)', async () => {
        vi.mocked(prisma.employerPlan.findUnique).mockResolvedValue(makePlan({ slots: 2 }) as never);
        vi.mocked(prisma.employerJob.count).mockResolvedValue(4 as never);
        const status = await getPlanSlotStatus(USER_ID, NOW);
        expect(status).toMatchObject({ used: 4, remaining: 0, canPost: false });
    });

    it('reports zero used / zero remaining for a lapsed plan without counting posts', async () => {
        vi.mocked(prisma.employerPlan.findUnique).mockResolvedValue(makePlan({ status: 'cancelled', currentPeriodEnd: daysFromNow(-1) }) as never);
        const status = await getPlanSlotStatus(USER_ID, NOW);
        expect(status).toMatchObject({ entitled: false, slots: config.planSlots, used: 0, remaining: 0, canPost: false });
        expect(prisma.employerJob.count).not.toHaveBeenCalled();
    });

    it('getActivePlan returns the row only while entitled', async () => {
        vi.mocked(prisma.employerPlan.findUnique).mockResolvedValue(makePlan() as never);
        expect(await getActivePlan(USER_ID, NOW)).not.toBeNull();
        vi.mocked(prisma.employerPlan.findUnique).mockResolvedValue(makePlan({ status: 'cancelled', currentPeriodEnd: daysFromNow(-1) }) as never);
        expect(await getActivePlan(USER_ID, NOW)).toBeNull();
    });
});

describe('pausePlanPosts — unpublish live plan posts, keep the rows', () => {
    it("selects only live, unexpired 'plan' rows for this employer", async () => {
        vi.mocked(prisma.employerJob.findMany).mockResolvedValue([] as never);
        expect(await pausePlanPosts(USER_ID, NOW)).toEqual([]);
        expect(prisma.employerJob.findMany).toHaveBeenCalledWith({
            where: {
                userId: USER_ID,
                paymentStatus: 'plan',
                job: { isPublished: true, OR: [{ expiresAt: null }, { expiresAt: { gt: NOW } }] },
            },
            select: { jobId: true },
        });
        expect(prisma.job.updateMany).not.toHaveBeenCalled();
    });

    it('unpublishes exactly the matched jobs and returns their ids', async () => {
        vi.mocked(prisma.employerJob.findMany).mockResolvedValue([{ jobId: 'j1' }, { jobId: 'j2' }] as never);
        vi.mocked(prisma.job.updateMany).mockResolvedValue({ count: 2 } as never);
        expect(await pausePlanPosts(USER_ID, NOW)).toEqual(['j1', 'j2']);
        expect(prisma.job.updateMany).toHaveBeenCalledWith({
            where: { id: { in: ['j1', 'j2'] } },
            data: { isPublished: false },
        });
    });
});

describe('resumePlanPosts — re-publish paused plan posts within the remaining slots', () => {
    it('does nothing when the plan cannot post (not entitled or full)', async () => {
        vi.mocked(prisma.employerPlan.findUnique).mockResolvedValue(makePlan({ status: 'pending' }) as never);
        expect(await resumePlanPosts(USER_ID, NOW)).toEqual([]);
        expect(prisma.employerJob.findMany).not.toHaveBeenCalled();
        expect(prisma.job.updateMany).not.toHaveBeenCalled();
    });

    it('re-publishes newest first, only unexpired + unarchived rows the plan paused, capped at the remaining slots', async () => {
        vi.mocked(prisma.employerPlan.findUnique).mockResolvedValue(makePlan({ slots: 5 }) as never);
        vi.mocked(prisma.employerJob.count).mockResolvedValue(3 as never); // 2 slots free
        vi.mocked(prisma.employerJob.findMany).mockResolvedValue([{ jobId: 'newest' }, { jobId: 'older' }] as never);
        vi.mocked(prisma.job.updateMany).mockResolvedValue({ count: 2 } as never);

        expect(await resumePlanPosts(USER_ID, NOW)).toEqual(['newest', 'older']);
        expect(prisma.employerJob.findMany).toHaveBeenCalledWith({
            where: {
                userId: USER_ID,
                paymentStatus: 'plan',
                job: { isPublished: false, isManuallyUnpublished: false, archivedAt: null, expiresAt: { gt: NOW } },
            },
            select: { jobId: true },
            orderBy: { createdAt: 'desc' },
            take: 2,
        });
        expect(prisma.job.updateMany).toHaveBeenCalledWith({
            where: { id: { in: ['newest', 'older'] } },
            data: { isPublished: true },
        });
    });

    it('returns [] without writing when nothing is paused', async () => {
        vi.mocked(prisma.employerPlan.findUnique).mockResolvedValue(makePlan() as never);
        vi.mocked(prisma.employerJob.count).mockResolvedValue(0 as never);
        vi.mocked(prisma.employerJob.findMany).mockResolvedValue([] as never);
        expect(await resumePlanPosts(USER_ID, NOW)).toEqual([]);
        expect(prisma.job.updateMany).not.toHaveBeenCalled();
    });

    it('never selects a post the employer paused or an admin unpublished, even with every slot free', async () => {
        vi.mocked(prisma.employerPlan.findUnique).mockResolvedValue(makePlan({ slots: 5 }) as never);
        vi.mocked(prisma.employerJob.count).mockResolvedValue(0 as never);
        vi.mocked(prisma.employerJob.findMany).mockResolvedValue([] as never);
        await resumePlanPosts(USER_ID, NOW);
        const where = vi.mocked(prisma.employerJob.findMany).mock.calls[0][0]?.where as { job: Record<string, unknown> };
        expect(where.job.isManuallyUnpublished).toBe(false);
    });
});

describe('republishPlanPost — employer unpause of a plan post, race safe', () => {
    const JOB_ID = 'job-9';
    const REPUBLISH_DATA = { isPublished: true, isManuallyUnpublished: false };

    /** Interactive-transaction stand-in: records the options and hands the callback its own client. */
    function mockTransaction() {
        const tx = {
            employerPlan: { findUnique: vi.fn() },
            employerJob: { count: vi.fn() },
            job: { update: vi.fn().mockResolvedValue({ id: JOB_ID }) },
        };
        vi.mocked(prisma.$transaction).mockImplementationOnce(
            ((fn: (client: typeof tx) => Promise<unknown>) => fn(tx)) as never,
        );
        return tx;
    }

    it('refuses as plan_inactive without opening a transaction when the post has no owner', async () => {
        expect(await republishPlanPost(null, JOB_ID, REPUBLISH_DATA, NOW)).toEqual({ ok: false, reason: 'plan_inactive' });
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('reads the plan, counts and writes through ONE Serializable transaction', async () => {
        const tx = mockTransaction();
        tx.employerPlan.findUnique.mockResolvedValue(makePlan({ slots: 5 }));
        tx.employerJob.count.mockResolvedValue(4);

        expect(await republishPlanPost(USER_ID, JOB_ID, REPUBLISH_DATA, NOW)).toEqual({ ok: true });

        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(vi.mocked(prisma.$transaction).mock.calls[0][1]).toEqual({ isolationLevel: 'Serializable' });
        expect(tx.employerPlan.findUnique).toHaveBeenCalledWith({ where: { userId: USER_ID } });
        expect(tx.employerJob.count).toHaveBeenCalledWith({
            where: {
                userId: USER_ID,
                paymentStatus: 'plan',
                job: { isPublished: true, OR: [{ expiresAt: null }, { expiresAt: { gt: NOW } }] },
            },
        });
        expect(tx.job.update).toHaveBeenCalledWith({ where: { id: JOB_ID }, data: REPUBLISH_DATA });
        // Nothing went through the global client: the check and the write share the snapshot.
        expect(prisma.employerPlan.findUnique).not.toHaveBeenCalled();
        expect(prisma.employerJob.count).not.toHaveBeenCalled();
        expect(prisma.job.update).not.toHaveBeenCalled();
    });

    it('refuses as slots_full and writes nothing when every slot holds a live post', async () => {
        const tx = mockTransaction();
        tx.employerPlan.findUnique.mockResolvedValue(makePlan({ slots: 5 }));
        tx.employerJob.count.mockResolvedValue(5);

        expect(await republishPlanPost(USER_ID, JOB_ID, REPUBLISH_DATA, NOW)).toEqual({ ok: false, reason: 'slots_full', used: 5, slots: 5 });
        expect(tx.job.update).not.toHaveBeenCalled();
    });

    it.each([
        ['no plan', null],
        ['a pending plan', makePlan({ status: 'pending', currentPeriodEnd: daysFromNow(30) })],
        ['a cancelled plan past its paid period', makePlan({ status: 'cancelled', currentPeriodEnd: daysFromNow(-1) })],
        ['an active plan past its grace window', makePlan({ status: 'active', currentPeriodEnd: daysFromNow(-(config.planGraceDays + 1)) })],
    ])('refuses as plan_inactive for %s, without counting or writing', async (_label, plan) => {
        const tx = mockTransaction();
        tx.employerPlan.findUnique.mockResolvedValue(plan);

        expect(await republishPlanPost(USER_ID, JOB_ID, REPUBLISH_DATA, NOW)).toEqual({ ok: false, reason: 'plan_inactive' });
        expect(tx.employerJob.count).not.toHaveBeenCalled();
        expect(tx.job.update).not.toHaveBeenCalled();
    });

    it('lets a serialization failure (P2034) reach the caller so it can ask for a retry', async () => {
        const conflict = Object.assign(new Error('could not serialize access'), { code: 'P2034' });
        vi.mocked(prisma.$transaction).mockRejectedValueOnce(conflict as never);
        await expect(republishPlanPost(USER_ID, JOB_ID, REPUBLISH_DATA, NOW)).rejects.toBe(conflict);
    });
});

describe('findLapsedPlans — what the daily lapse sweep pauses', () => {
    it('selects attached plans that are cancelled past their paid period, pending, or past period end + grace', async () => {
        vi.mocked(prisma.employerPlan.findMany).mockResolvedValue([] as never);
        await findLapsedPlans(NOW);
        expect(prisma.employerPlan.findMany).toHaveBeenCalledWith({
            where: {
                userId: { not: null },
                OR: [
                    { status: 'cancelled', currentPeriodEnd: { lte: NOW } },
                    { status: 'pending' },
                    { status: { notIn: ['cancelled', 'pending'] }, currentPeriodEnd: { lt: new Date(NOW.getTime() - config.planGraceDays * DAY_MS) } },
                ],
            },
            select: { id: true, userId: true, email: true, status: true, currentPeriodEnd: true },
            orderBy: { currentPeriodEnd: 'asc' },
        });
    });

    it('agrees with isPlanEntitled around the cutoff', () => {
        // The cutoff is now − grace: a period end just after it is still
        // entitled, just before it is not — the same instant the sweep uses.
        const cutoff = new Date(NOW.getTime() - config.planGraceDays * DAY_MS);
        expect(isPlanEntitled(makePlan({ currentPeriodEnd: new Date(cutoff.getTime() + 1) }), NOW)).toBe(true);
        expect(isPlanEntitled(makePlan({ currentPeriodEnd: new Date(cutoff.getTime() - 1) }), NOW)).toBe(false);
    });
});

describe('upsertPlan — one row per employer, lookup falls through', () => {
    const input = {
        userId: USER_ID,
        email: 'Owner@Clinic.Example',
        status: 'active' as const,
        currentPeriodEnd: daysFromNow(30),
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_1',
        source: 'stripe' as const,
    };

    it('updates the row matched by subscription id', async () => {
        vi.mocked(prisma.employerPlan.findUnique).mockResolvedValueOnce(makePlan({ id: 'by-sub' }) as never);
        vi.mocked(prisma.employerPlan.update).mockResolvedValue(makePlan({ id: 'by-sub' }) as never);
        await upsertPlan(input);
        expect(prisma.employerPlan.findUnique).toHaveBeenCalledWith({ where: { stripeSubscriptionId: 'sub_1' } });
        expect(prisma.employerPlan.update).toHaveBeenCalledWith({
            where: { id: 'by-sub' },
            data: expect.objectContaining({ userId: USER_ID, email: 'owner@clinic.example', status: 'active', stripeSubscriptionId: 'sub_1', source: 'stripe' }),
        });
        expect(prisma.employerPlan.create).not.toHaveBeenCalled();
    });

    it('admin grant then Stripe checkout for the same employer UPDATES the grant instead of a P2002 on userId', async () => {
        vi.mocked(prisma.employerPlan.findUnique)
            .mockResolvedValueOnce(null as never) // no row for sub_1 yet
            .mockResolvedValueOnce(makePlan({ id: 'granted', stripeSubscriptionId: null, source: 'admin' }) as never);
        vi.mocked(prisma.employerPlan.update).mockResolvedValue(makePlan({ id: 'granted' }) as never);
        await upsertPlan(input);
        expect(prisma.employerPlan.findUnique).toHaveBeenNthCalledWith(2, { where: { userId: USER_ID } });
        expect(prisma.employerPlan.update).toHaveBeenCalledWith({
            where: { id: 'granted' },
            data: expect.objectContaining({ stripeSubscriptionId: 'sub_1', source: 'stripe' }),
        });
        expect(prisma.employerPlan.create).not.toHaveBeenCalled();
    });

    it('re-uses an unattached row with the same email (orphan Stripe row, then a matched checkout)', async () => {
        vi.mocked(prisma.employerPlan.findUnique).mockResolvedValue(null as never);
        vi.mocked(prisma.employerPlan.findFirst).mockResolvedValue(makePlan({ id: 'orphan', userId: null }) as never);
        vi.mocked(prisma.employerPlan.update).mockResolvedValue(makePlan({ id: 'orphan' }) as never);
        await upsertPlan(input);
        expect(prisma.employerPlan.findFirst).toHaveBeenCalledWith({ where: { email: 'owner@clinic.example', userId: null } });
        expect(prisma.employerPlan.update).toHaveBeenCalledWith({ where: { id: 'orphan' }, data: expect.objectContaining({ userId: USER_ID }) });
        expect(prisma.employerPlan.create).not.toHaveBeenCalled();
    });

    it('an admin write to a Stripe-billed row keeps its subscription/customer ids, status, period end and Stripe ownership', async () => {
        const stripeRow = makePlan({ id: 'paying', status: 'past_due', stripeSubscriptionId: 'sub_x', stripeCustomerId: 'cus_x', currentPeriodEnd: daysFromNow(5), source: 'stripe' });
        vi.mocked(prisma.employerPlan.findUnique).mockResolvedValueOnce(stripeRow as never); // found by userId
        vi.mocked(prisma.employerPlan.update).mockResolvedValue(stripeRow as never);

        await upsertPlan({ userId: USER_ID, email: 'owner@clinic.example', status: 'active', currentPeriodEnd: daysFromNow(90), source: 'admin' });

        const data = vi.mocked(prisma.employerPlan.update).mock.calls[0][0].data as Record<string, unknown>;
        expect(data).not.toHaveProperty('stripeSubscriptionId');
        expect(data).not.toHaveProperty('stripeCustomerId');
        expect(data).toMatchObject({ status: 'past_due', currentPeriodEnd: stripeRow.currentPeriodEnd, source: 'stripe' });
    });

    it('refuses to overwrite a row that tracks a DIFFERENT live subscription (no orphaned billing, no hijack)', async () => {
        vi.mocked(prisma.employerPlan.findUnique)
            .mockResolvedValueOnce(null as never) // no row for sub_B
            .mockResolvedValueOnce(makePlan({ id: 'live', stripeSubscriptionId: 'sub_A', status: 'active' }) as never);

        await expect(upsertPlan({ ...input, stripeSubscriptionId: 'sub_B' })).rejects.toBeInstanceOf(PlanSubscriptionConflictError);
        expect(prisma.employerPlan.update).not.toHaveBeenCalled();
        expect(prisma.employerPlan.create).not.toHaveBeenCalled();
    });

    it('re-subscribing over a CANCELLED row is not a conflict', async () => {
        vi.mocked(prisma.employerPlan.findUnique)
            .mockResolvedValueOnce(null as never)
            .mockResolvedValueOnce(makePlan({ id: 'old', stripeSubscriptionId: 'sub_A', status: 'cancelled' }) as never);
        vi.mocked(prisma.employerPlan.update).mockResolvedValue(makePlan({ id: 'old' }) as never);

        await upsertPlan({ ...input, stripeSubscriptionId: 'sub_B' });
        expect(prisma.employerPlan.update).toHaveBeenCalledWith({ where: { id: 'old' }, data: expect.objectContaining({ stripeSubscriptionId: 'sub_B' }) });
    });

    it('detached mode never touches the employer row — creates an unattached row for the duplicate subscription', async () => {
        vi.mocked(prisma.employerPlan.findUnique).mockResolvedValueOnce(null as never); // no row for sub_B
        vi.mocked(prisma.employerPlan.create).mockResolvedValue(makePlan({ id: 'dup', userId: null }) as never);

        await upsertPlan({ ...input, userId: null, stripeSubscriptionId: 'sub_B' }, { detached: true });

        expect(prisma.employerPlan.findUnique).toHaveBeenCalledTimes(1);
        expect(prisma.employerPlan.findFirst).not.toHaveBeenCalled();
        expect(prisma.employerPlan.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: null, stripeSubscriptionId: 'sub_B' }) });
    });

    it('creates a new row with the config defaults (slots, price) when nothing matches', async () => {
        vi.mocked(prisma.employerPlan.findUnique).mockResolvedValue(null as never);
        vi.mocked(prisma.employerPlan.findFirst).mockResolvedValue(null as never);
        vi.mocked(prisma.employerPlan.create).mockResolvedValue(makePlan({ id: 'new' }) as never);
        await upsertPlan({ ...input, userId: null, stripeSubscriptionId: null, stripeCustomerId: null, source: 'admin' });
        expect(prisma.employerPlan.create).toHaveBeenCalledWith({
            data: {
                userId: null,
                email: 'owner@clinic.example',
                status: 'active',
                currentPeriodEnd: input.currentPeriodEnd,
                slots: config.planSlots,
                priceCents: config.planPrice * 100,
                stripeCustomerId: null,
                stripeSubscriptionId: null,
                source: 'admin',
            },
        });
        // No subscription id and no userId → neither unique lookup runs.
        expect(prisma.employerPlan.findUnique).not.toHaveBeenCalled();
    });
});
