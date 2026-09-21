/**
 * lib/inngest/functions/plan-reconciliation.ts — missed-webhook recovery for
 * the $399/month Employer plan subscription.
 *
 * Pins:
 *   - registered on Inngest under its id, daily, before the 07:00 lapse sweep;
 *   - an Employer plan subscription with no plan row (lost checkout event) is
 *     rebuilt by replaying the webhook's own handlePlanCheckout on its
 *     Checkout Session; non-plan subscriptions are ignored;
 *   - a plan row whose status / paid-through date drifted from the live
 *     subscription (lost .updated/.deleted) is re-applied through
 *     handleSubscriptionChange; an in-sync row is left alone;
 *   - a row whose subscription Stripe no longer has is reported as orphaned;
 *   - every finding reaches Discord.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';

type StepRun = <T>(name: string, fn: () => Promise<T>) => Promise<T>;
interface CapturedFunction {
    opts: { id: string; triggers: { cron: string }[]; concurrency: number };
    handler: (ctx: { step: { run: StepRun } }) => Promise<{ missingRows: number; checkedRows: number; findings: number }>;
}

vi.mock('@/lib/inngest/client', () => ({
    inngest: { createFunction: vi.fn((opts: CapturedFunction['opts'], handler: CapturedFunction['handler']) => ({ opts, handler })) },
}));

const stripeMocks = vi.hoisted(() => ({ subscriptionsList: vi.fn(), subscriptionsRetrieve: vi.fn(), sessionsList: vi.fn() }));
vi.mock('stripe', () => ({
    default: vi.fn().mockImplementation(() => ({
        subscriptions: { list: stripeMocks.subscriptionsList, retrieve: stripeMocks.subscriptionsRetrieve },
        checkout: { sessions: { list: stripeMocks.sessionsList } },
    })),
}));

const planMocks = vi.hoisted(() => ({ getPlanBySubscriptionId: vi.fn() }));
vi.mock('@/lib/employer-plan', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/employer-plan')>()), ...planMocks }));

const handlerMocks = vi.hoisted(() => ({ handlePlanCheckout: vi.fn(), handleSubscriptionChange: vi.fn() }));
vi.mock('@/app/api/webhooks/stripe/plan-checkout', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/app/api/webhooks/stripe/plan-checkout')>()),
    handlePlanCheckout: handlerMocks.handlePlanCheckout,
}));
vi.mock('@/app/api/webhooks/stripe/plan-subscription', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/app/api/webhooks/stripe/plan-subscription')>()),
    handleSubscriptionChange: handlerMocks.handleSubscriptionChange,
}));

const discordMocks = vi.hoisted(() => ({ sendDiscordMessage: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/discord-notifier', () => discordMocks);

const PLAN_PRICE = { lookup_key: 'np_hiring_employer_plan_monthly', unit_amount: 39900, metadata: {} };
const PERIOD_END_UNIX = 1_800_000_000;

function subscription(overrides: Record<string, unknown> = {}) {
    return {
        id: 'sub_1', status: 'active', metadata: {},
        current_period_start: PERIOD_END_UNIX - 30 * 86_400, current_period_end: PERIOD_END_UNIX,
        items: { data: [{ price: PLAN_PRICE }] },
        ...overrides,
    };
}

function asyncIterable<T>(items: T[]) {
    return { async *[Symbol.asyncIterator]() { for (const item of items) yield item; } };
}

async function load(): Promise<CapturedFunction> {
    const mod = await import('@/lib/inngest/functions/plan-reconciliation');
    return mod.planReconciliationSweep as unknown as CapturedFunction;
}

function run(fn: CapturedFunction) {
    const stepRun = (async (_name: string, cb: () => Promise<unknown>) => cb()) as StepRun;
    return fn.handler({ step: { run: stepRun } });
}

beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    stripeMocks.subscriptionsList.mockReturnValue(asyncIterable([]));
    vi.mocked(prisma.employerPlan.findMany).mockResolvedValue([] as never);
    handlerMocks.handlePlanCheckout.mockResolvedValue({ outcome: 'activated' });
    handlerMocks.handleSubscriptionChange.mockResolvedValue({ outcome: 'updated', status: 'cancelled' });
});

describe('registration', () => {
    it('runs daily on Inngest before the lapse sweep and is exported for the serve handler', async () => {
        const fn = await load();
        expect(fn.opts.id).toBe('employer-plan-reconciliation-sweep');
        expect(fn.opts.triggers).toEqual([{ cron: 'TZ=UTC 45 6 * * *' }]);
        expect(fn.opts.concurrency).toBe(1);
        const mod = await import('@/lib/inngest/functions/plan-reconciliation');
        expect(mod.planReconciliationFunctions).toEqual([mod.planReconciliationSweep]);
    });
});

describe('missing plan rows', () => {
    it('rebuilds a plan row by replaying handlePlanCheckout on the subscription checkout session, and alerts', async () => {
        stripeMocks.subscriptionsList.mockReturnValue(asyncIterable([
            subscription({ id: 'sub_missing' }),
            subscription({ id: 'sub_other_product', items: { data: [{ price: { lookup_key: 'other', metadata: {} } }] } }),
        ]));
        planMocks.getPlanBySubscriptionId.mockResolvedValue(null);
        const session = { id: 'cs_lost', mode: 'subscription', subscription: 'sub_missing' };
        stripeMocks.sessionsList.mockResolvedValue({ data: [session] });

        const result = await run(await load());

        expect(stripeMocks.sessionsList).toHaveBeenCalledTimes(1);
        expect(stripeMocks.sessionsList).toHaveBeenCalledWith({ subscription: 'sub_missing', limit: 1 });
        expect(handlerMocks.handlePlanCheckout).toHaveBeenCalledWith(expect.anything(), session, { eventId: 'plan-reconciliation:sub_missing' });
        expect(result).toMatchObject({ missingRows: 1, findings: 1 });
        expect(JSON.stringify(discordMocks.sendDiscordMessage.mock.calls)).toContain('created-missing-row');
    });
});

describe('drift on existing rows', () => {
    const stored = {
        id: 'plan-1', userId: 'user-1', email: 'o@c.example', status: 'active', slots: 5, priceCents: 39900,
        currentPeriodEnd: new Date(PERIOD_END_UNIX * 1000), stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', source: 'stripe', lastStripeEventAt: null,
    };

    beforeEach(() => {
        vi.mocked(prisma.employerPlan.findMany).mockResolvedValue([{ id: 'plan-1', stripeSubscriptionId: 'sub_1' }] as never);
        planMocks.getPlanBySubscriptionId.mockResolvedValue({ ...stored });
    });

    it('leaves an in-sync row alone and sends nothing', async () => {
        stripeMocks.subscriptionsRetrieve.mockResolvedValue(subscription());
        const result = await run(await load());
        expect(handlerMocks.handleSubscriptionChange).not.toHaveBeenCalled();
        expect(result.findings).toBe(0);
        expect(discordMocks.sendDiscordMessage).not.toHaveBeenCalled();
    });

    it('re-applies a lost cancellation through handleSubscriptionChange and alerts', async () => {
        stripeMocks.subscriptionsRetrieve.mockResolvedValue(subscription({ status: 'canceled' }));
        const result = await run(await load());
        expect(handlerMocks.handleSubscriptionChange).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'sub_1', status: 'canceled' }),
            'customer.subscription.updated',
            expect.objectContaining({ eventId: 'plan-reconciliation:plan-1', observedAt: expect.any(Date) }),
        );
        expect(result.findings).toBe(1);
        expect(JSON.stringify(discordMocks.sendDiscordMessage.mock.calls)).toContain('drift-applied');
    });

    it('re-applies a lost renewal (stale period end) so a paying employer is not lapsed', async () => {
        stripeMocks.subscriptionsRetrieve.mockResolvedValue(subscription({ current_period_end: PERIOD_END_UNIX + 30 * 86_400 }));
        handlerMocks.handleSubscriptionChange.mockResolvedValue({ outcome: 'updated', status: 'active' });
        await run(await load());
        expect(handlerMocks.handleSubscriptionChange).toHaveBeenCalledOnce();
    });

    it('reports a row whose subscription Stripe no longer has as orphaned', async () => {
        stripeMocks.subscriptionsRetrieve.mockRejectedValue(Object.assign(new Error('No such subscription'), { code: 'resource_missing', statusCode: 404 }));
        const result = await run(await load());
        expect(result.findings).toBe(1);
        expect(JSON.stringify(discordMocks.sendDiscordMessage.mock.calls)).toContain('orphaned-row');
        expect(handlerMocks.handleSubscriptionChange).not.toHaveBeenCalled();
    });
});
