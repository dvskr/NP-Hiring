/**
 * lib/inngest/functions/payment-reconciliation.ts — renewal arm.
 *
 * A renewal is bought against an already-live row, so the pending-row sweep
 * can never see it. Pins:
 *   - paid renewal sessions older than 2h with NO JobCharge for their session
 *     are fulfilled through the webhook's shared applyRenewalCheckout, even
 *     when there are no stale pending rows at all, and alerted as
 *     "renewal recovered";
 *   - a renewal that already has its ledger row, an unpaid one, or one
 *     younger than 2h is left alone;
 *   - renewal sessions never feed the new-post activation path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';

type StepRun = <T>(name: string, fn: () => Promise<T>) => Promise<T>;
interface CapturedFunction {
    handler: (ctx: { step: { run: StepRun } }) => Promise<{ checked: number; activated: number; expired: number; failures: number }>;
}

vi.mock('@/lib/inngest/client', () => ({
    inngest: { createFunction: vi.fn((opts: unknown, handler: CapturedFunction['handler']) => ({ opts, handler })) },
}));

const stripeMocks = vi.hoisted(() => ({ list: vi.fn(), retrieve: vi.fn() }));
vi.mock('stripe', () => ({
    default: vi.fn().mockImplementation(() => ({ checkout: { sessions: { list: stripeMocks.list, retrieve: stripeMocks.retrieve } } })),
}));

const activationMocks = vi.hoisted(() => ({ activatePaidJobCheckout: vi.fn(), applyRenewalCheckout: vi.fn() }));
vi.mock('@/app/api/webhooks/stripe/activate-paid-job', () => ({ activatePaidJobCheckout: activationMocks.activatePaidJobCheckout }));
vi.mock('@/app/api/webhooks/stripe/apply-renewal', () => ({ applyRenewalCheckout: activationMocks.applyRenewalCheckout }));

const discordMocks = vi.hoisted(() => ({ sendDiscordMessage: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/discord-notifier', () => discordMocks);

const HOUR_S = 3600;

function asyncIterable<T>(items: T[]) {
    return { async *[Symbol.asyncIterator]() { for (const item of items) yield item; } };
}

function session(id: string, overrides: Record<string, unknown> = {}) {
    return {
        id,
        payment_status: 'paid',
        status: 'complete',
        created: Math.floor(Date.now() / 1000) - 5 * HOUR_S,
        metadata: { jobId: `job-${id}`, type: 'renewal', tier: 'pro' },
        ...overrides,
    };
}

async function run() {
    const mod = await import('@/lib/inngest/functions/payment-reconciliation');
    const fn = mod.paymentReconciliationSweep as unknown as CapturedFunction;
    return fn.handler({ step: { run: (async (_n: string, cb: () => Promise<unknown>) => cb()) as StepRun } });
}

beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    vi.mocked(prisma.employerJob.findMany).mockResolvedValue([] as never); // no stale pending rows
    activationMocks.applyRenewalCheckout.mockResolvedValue({ outcome: 'applied', jobId: 'job-x' });
});

describe('payment reconciliation — renewal arm', () => {
    it('recovers a paid renewal with no ledger row even when no new-post row is pending, and alerts', async () => {
        const lost = session('cs_lost');
        stripeMocks.list.mockReturnValue(asyncIterable([lost]));
        stripeMocks.retrieve.mockResolvedValue(lost);
        vi.mocked(prisma.jobCharge.findUnique).mockResolvedValue(null as never);

        const result = await run();

        expect(prisma.jobCharge.findUnique).toHaveBeenCalledWith({ where: { stripeSessionId: 'cs_lost' }, select: { id: true } });
        expect(activationMocks.applyRenewalCheckout).toHaveBeenCalledWith(expect.anything(), lost);
        expect(activationMocks.activatePaidJobCheckout).not.toHaveBeenCalled();
        expect(result.activated).toBe(1);
        expect(JSON.stringify(discordMocks.sendDiscordMessage.mock.calls)).toContain('renewal recovered');
    });

    it('leaves alone a renewal already on the ledger, an unpaid one, and one younger than 2h', async () => {
        stripeMocks.list.mockReturnValue(asyncIterable([
            session('cs_ledgered'),
            session('cs_unpaid', { payment_status: 'unpaid' }),
            session('cs_fresh', { created: Math.floor(Date.now() / 1000) - 600 }),
        ]));
        vi.mocked(prisma.jobCharge.findUnique).mockResolvedValue({ id: 'jc-1' } as never);

        const result = await run();

        expect(prisma.jobCharge.findUnique).toHaveBeenCalledTimes(1); // only cs_ledgered qualified
        expect(activationMocks.applyRenewalCheckout).not.toHaveBeenCalled();
        expect(result.activated).toBe(0);
        expect(discordMocks.sendDiscordMessage).not.toHaveBeenCalled();
    });

    it('reports a renewal recovery failure without aborting the sweep', async () => {
        const lost = session('cs_boom');
        stripeMocks.list.mockReturnValue(asyncIterable([lost]));
        stripeMocks.retrieve.mockResolvedValue(lost);
        vi.mocked(prisma.jobCharge.findUnique).mockResolvedValue(null as never);
        activationMocks.applyRenewalCheckout.mockRejectedValue(new Error('db down'));

        const result = await run();

        expect(result.failures).toBe(1);
        expect(JSON.stringify(discordMocks.sendDiscordMessage.mock.calls)).toContain('RENEWAL db down');
    });
});
