/**
 * lib/inngest/functions/plan-lapse.ts — the daily sweep that pauses 'plan'
 * posts once an Employer plan is no longer entitled (2026-09-12 launch promo
 * + 2027 ladder).
 *
 * Two lapse paths have no webhook of their own: a subscription left unpaid
 * after Smart Retries (past_due with the grace window run out) and an
 * admin-granted plan whose period simply ends. The sweep covers both.
 *
 * Pins:
 *   - the function is registered on the documented id / daily UTC cron and
 *     runs in Inngest (NOT vercel.json, which is at its entry limit);
 *   - the candidate set is exactly lib/employer-plan#findLapsedPlans (the
 *     one entitlement rule) — entitled plans are never touched;
 *   - each lapsed plan's posts are paused and the employer is emailed ONCE
 *     with the right reason; a plan with nothing live sends nothing, which
 *     is what makes a re-run idempotent;
 *   - per-plan failures are contained, unattached rows are skipped, and the
 *     run is bounded.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type StepRun = <T>(name: string, fn: () => Promise<T>) => Promise<T>;
interface CapturedFunction {
    opts: { id: string; name: string; triggers: { cron: string }[]; retries: number; concurrency: number };
    handler: (ctx: { step: { run: StepRun } }) => Promise<{ checked: number; paused: number; emailed: number; failures: number }>;
}

// Capture the (options, handler) pair instead of booting the Inngest SDK, so
// the handler can be driven with a pass-through `step.run`.
vi.mock('@/lib/inngest/client', () => ({
    inngest: {
        createFunction: vi.fn((opts: CapturedFunction['opts'], handler: CapturedFunction['handler']) => ({ opts, handler })),
        send: vi.fn().mockResolvedValue(undefined),
    },
}));

const planMocks = vi.hoisted(() => ({
    findLapsedPlans: vi.fn(),
    pausePlanPosts: vi.fn(),
}));
vi.mock('@/lib/employer-plan', () => planMocks);

const emailMocks = vi.hoisted(() => ({ sendPlanPausedEmail: vi.fn() }));
vi.mock('@/lib/email-service', () => emailMocks);

const NOW = new Date('2027-03-01T07:00:00.000Z');

function lapsed(overrides: Partial<{ id: string; userId: string | null; email: string; status: string }> = {}) {
    return {
        id: 'plan-1',
        userId: 'user-1',
        email: 'owner@clinic.example',
        status: 'cancelled',
        currentPeriodEnd: new Date('2027-01-01T00:00:00Z'),
        ...overrides,
    };
}

async function loadSweep(): Promise<CapturedFunction> {
    const mod = await import('@/lib/inngest/functions/plan-lapse');
    return mod.planLapseSweep as unknown as CapturedFunction;
}

function run(fn: CapturedFunction) {
    const stepRun = vi.fn(async (_name: string, cb: () => Promise<unknown>) => cb()) as unknown as StepRun;
    return { result: fn.handler({ step: { run: stepRun } }), stepRun };
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    planMocks.findLapsedPlans.mockResolvedValue([]);
    planMocks.pausePlanPosts.mockResolvedValue([]);
    emailMocks.sendPlanPausedEmail.mockResolvedValue({ success: true });
});

describe('registration', () => {
    it('runs daily on Inngest under the documented id, after the payment reconciliation', async () => {
        const fn = await loadSweep();
        expect(fn.opts.id).toBe('employer-plan-lapse-sweep');
        expect(fn.opts.triggers).toEqual([{ cron: 'TZ=UTC 0 7 * * *' }]);
        expect(fn.opts.retries).toBe(2);
        expect(fn.opts.concurrency).toBe(1);
        const mod = await import('@/lib/inngest/functions/plan-lapse');
        expect(mod.planLapseFunctions).toEqual([mod.planLapseSweep]);
    });
});

describe('sweep', () => {
    it('does nothing when no plan has lapsed', async () => {
        const fn = await loadSweep();
        const { result } = run(fn);
        expect(await result).toEqual({ checked: 0, paused: 0, emailed: 0, failures: 0 });
        expect(planMocks.findLapsedPlans).toHaveBeenCalledOnce();
        expect(planMocks.pausePlanPosts).not.toHaveBeenCalled();
        expect(emailMocks.sendPlanPausedEmail).not.toHaveBeenCalled();
    });

    it('pauses only the plans findLapsedPlans returns (the single entitlement rule) — never an entitled one', async () => {
        planMocks.findLapsedPlans.mockResolvedValue([lapsed({ id: 'plan-1', userId: 'user-1' })]);
        planMocks.pausePlanPosts.mockResolvedValue(['job-a', 'job-b']);

        const fn = await loadSweep();
        const { result } = run(fn);

        expect(await result).toEqual({ checked: 1, paused: 2, emailed: 1, failures: 0 });
        expect(planMocks.pausePlanPosts).toHaveBeenCalledTimes(1);
        expect(planMocks.pausePlanPosts).toHaveBeenCalledWith('user-1');
    });

    it("emails a cancelled plan's employer with reason 'cancelled' and the paused count", async () => {
        planMocks.findLapsedPlans.mockResolvedValue([lapsed({ status: 'cancelled' })]);
        planMocks.pausePlanPosts.mockResolvedValue(['job-a', 'job-b', 'job-c']);

        const fn = await loadSweep();
        await run(fn).result;

        expect(emailMocks.sendPlanPausedEmail).toHaveBeenCalledWith('owner@clinic.example', { reason: 'cancelled', pausedCount: 3 });
    });

    it("emails a plan whose period + grace ran out with reason 'past_due'", async () => {
        planMocks.findLapsedPlans.mockResolvedValue([lapsed({ status: 'past_due' }), lapsed({ id: 'plan-2', userId: 'user-2', email: 'x@y.example', status: 'active' })]);
        planMocks.pausePlanPosts.mockResolvedValue(['job-a']);

        const fn = await loadSweep();
        const { result } = run(fn);

        expect(await result).toEqual({ checked: 2, paused: 2, emailed: 2, failures: 0 });
        expect(emailMocks.sendPlanPausedEmail).toHaveBeenNthCalledWith(1, 'owner@clinic.example', { reason: 'past_due', pausedCount: 1 });
        // An admin-granted 'active' plan past its period end has no Stripe event; it lapses the same way.
        expect(emailMocks.sendPlanPausedEmail).toHaveBeenNthCalledWith(2, 'x@y.example', { reason: 'past_due', pausedCount: 1 });
    });

    it('sends nothing for a lapsed plan with no live posts — a re-run is idempotent', async () => {
        planMocks.findLapsedPlans.mockResolvedValue([lapsed()]);
        planMocks.pausePlanPosts.mockResolvedValue([]);

        const fn = await loadSweep();
        const { result } = run(fn);

        expect(await result).toEqual({ checked: 1, paused: 0, emailed: 0, failures: 0 });
        expect(emailMocks.sendPlanPausedEmail).not.toHaveBeenCalled();
    });

    it('skips unattached rows (userId null) — they cannot own posts', async () => {
        planMocks.findLapsedPlans.mockResolvedValue([lapsed({ id: 'orphan', userId: null }), lapsed({ id: 'plan-1', userId: 'user-1' })]);
        planMocks.pausePlanPosts.mockResolvedValue(['job-a']);

        const fn = await loadSweep();
        const { result } = run(fn);

        expect(await result).toMatchObject({ checked: 1, paused: 1 });
        expect(planMocks.pausePlanPosts).toHaveBeenCalledTimes(1);
        expect(planMocks.pausePlanPosts).toHaveBeenCalledWith('user-1');
    });

    it('contains a per-plan failure so the other employers are still processed', async () => {
        planMocks.findLapsedPlans.mockResolvedValue([lapsed({ id: 'bad', userId: 'user-bad' }), lapsed({ id: 'good', userId: 'user-good' })]);
        planMocks.pausePlanPosts
            .mockRejectedValueOnce(new Error('db boom'))
            .mockResolvedValueOnce(['job-a']);

        const fn = await loadSweep();
        const { result } = run(fn);

        expect(await result).toEqual({ checked: 2, paused: 1, emailed: 1, failures: 1 });
        expect(planMocks.pausePlanPosts).toHaveBeenCalledWith('user-good');
        expect(emailMocks.sendPlanPausedEmail).toHaveBeenCalledOnce();
    });

    it('keeps the pause when only the email fails (the entitlement decision stands) and reports it', async () => {
        planMocks.findLapsedPlans.mockResolvedValue([lapsed()]);
        planMocks.pausePlanPosts.mockResolvedValue(['job-a']);
        emailMocks.sendPlanPausedEmail.mockRejectedValue(new Error('resend down'));

        const fn = await loadSweep();
        const { result } = run(fn);

        expect(await result).toEqual({ checked: 1, paused: 1, emailed: 0, failures: 1 });
    });

    it('runs each plan in its own durable step', async () => {
        planMocks.findLapsedPlans.mockResolvedValue([lapsed({ id: 'plan-1' }), lapsed({ id: 'plan-2', userId: 'user-2' })]);
        planMocks.pausePlanPosts.mockResolvedValue([]);

        const fn = await loadSweep();
        const { result, stepRun } = run(fn);
        await result;

        const names = (stepRun as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
        expect(names).toEqual(['find-lapsed-plans', 'pause-plan-1', 'pause-plan-2']);
    });

    it('bounds a run at 200 plans (a backlog resumes tomorrow)', async () => {
        planMocks.findLapsedPlans.mockResolvedValue(Array.from({ length: 250 }, (_, i) => lapsed({ id: `plan-${i}`, userId: `user-${i}` })));
        planMocks.pausePlanPosts.mockResolvedValue([]);

        const fn = await loadSweep();
        const { result } = run(fn);

        expect((await result).checked).toBe(200);
        expect(planMocks.pausePlanPosts).toHaveBeenCalledTimes(200);
    });
});
