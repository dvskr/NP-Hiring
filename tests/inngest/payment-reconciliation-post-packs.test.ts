/**
 * lib/inngest/functions/payment-reconciliation.ts — 5-post pack arm.
 *
 * A pack is bought with no EmployerJob row behind it, so the pending-row
 * sweep can never see one whose webhook was lost. Pins:
 *   - a paid `metadata.type === 'post_pack'` session older than 2h with no
 *     pack recorded for its session id is fulfilled through the webhook's
 *     shared fulfilPostPackCheckout, even when no new-post row is pending,
 *     and alerted as "5-post pack recovered";
 *   - a pack already recorded, an unpaid one, and one younger than 2h are
 *     left alone;
 *   - pack sessions never feed the new-post or renewal paths;
 *   - one failed recovery is reported and the sweep goes on.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
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

const fulfilmentMocks = vi.hoisted(() => ({
    activatePaidJobCheckout: vi.fn(),
    applyRenewalCheckout: vi.fn(),
    fulfilPostPackCheckout: vi.fn(),
}));
vi.mock('@/app/api/webhooks/stripe/activate-paid-job', () => ({ activatePaidJobCheckout: fulfilmentMocks.activatePaidJobCheckout }));
vi.mock('@/app/api/webhooks/stripe/apply-renewal', () => ({ applyRenewalCheckout: fulfilmentMocks.applyRenewalCheckout }));
vi.mock('@/app/api/webhooks/stripe/post-pack-checkout', () => ({ fulfilPostPackCheckout: fulfilmentMocks.fulfilPostPackCheckout }));

const discordMocks = vi.hoisted(() => ({ sendDiscordMessage: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/discord-notifier', () => discordMocks);

const HOUR_S = 3600;

function asyncIterable<T>(items: T[]) {
    return { async *[Symbol.asyncIterator]() { for (const item of items) yield item; } };
}

/** A pack session as /api/create-pack-checkout creates it: no jobId. */
function packSession(id: string, overrides: Record<string, unknown> = {}) {
    return {
        id,
        payment_status: 'paid',
        status: 'complete',
        created: Math.floor(Date.now() / 1000) - 5 * HOUR_S,
        metadata: { type: 'post_pack', sku: 'post-pack-5', userId: 'user-1', quotaDomain: 'clinic.example', posts: '5' },
        ...overrides,
    };
}

async function run() {
    const mod = await import('@/lib/inngest/functions/payment-reconciliation');
    const fn = mod.paymentReconciliationSweep as unknown as CapturedFunction;
    return fn.handler({ step: { run: (async (_n: string, cb: () => Promise<unknown>) => cb()) as StepRun } });
}

function alerted(): string {
    return JSON.stringify(discordMocks.sendDiscordMessage.mock.calls);
}

// Load the sweep once outside any test, so a cold import cannot eat the first test's timeout.
beforeAll(async () => {
    await import('@/lib/inngest/functions/payment-reconciliation');
}, 60_000);

beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    vi.mocked(prisma.employerJob.findMany).mockResolvedValue([] as never); // no stale pending rows
    vi.mocked(prisma.employerPostPack.findUnique).mockReset().mockResolvedValue(null as never);
    fulfilmentMocks.fulfilPostPackCheckout.mockReset().mockResolvedValue({ outcome: 'fulfilled', packId: 'pack-1' });
});

describe('payment reconciliation — 5-post pack arm', () => {
    it('records a paid pack with no pack row even when no new-post row is pending, and alerts', async () => {
        const lost = packSession('cs_pack_lost');
        stripeMocks.list.mockReturnValue(asyncIterable([lost]));
        stripeMocks.retrieve.mockResolvedValue(lost);

        const result = await run();

        expect(prisma.employerPostPack.findUnique).toHaveBeenCalledWith({ where: { stripeSessionId: 'cs_pack_lost' }, select: { id: true } });
        expect(fulfilmentMocks.fulfilPostPackCheckout).toHaveBeenCalledWith(expect.anything(), lost, { eventId: 'payment-reconciliation' });
        expect(result.activated).toBe(1);
        expect(alerted()).toContain('5-post pack recovered');
        expect(alerted()).toContain('cs_pack_lost');
        expect(alerted()).toContain('user-1');
    });

    it('re-reads the session before recording, and skips one no longer paid', async () => {
        stripeMocks.list.mockReturnValue(asyncIterable([packSession('cs_pack_reversed')]));
        stripeMocks.retrieve.mockResolvedValue(packSession('cs_pack_reversed', { payment_status: 'unpaid' }));

        const result = await run();

        expect(stripeMocks.retrieve).toHaveBeenCalledWith('cs_pack_reversed');
        expect(fulfilmentMocks.fulfilPostPackCheckout).not.toHaveBeenCalled();
        expect(result.activated).toBe(0);
        expect(discordMocks.sendDiscordMessage).not.toHaveBeenCalled();
    });

    it('leaves alone a pack already recorded, an unpaid one, and one younger than 2h', async () => {
        stripeMocks.list.mockReturnValue(asyncIterable([
            packSession('cs_pack_recorded'),
            packSession('cs_pack_unpaid', { payment_status: 'unpaid' }),
            packSession('cs_pack_fresh', { created: Math.floor(Date.now() / 1000) - 600 }),
        ]));
        vi.mocked(prisma.employerPostPack.findUnique).mockResolvedValue({ id: 'pack-1' } as never);

        const result = await run();

        expect(prisma.employerPostPack.findUnique).toHaveBeenCalledTimes(1); // only cs_pack_recorded qualified
        expect(stripeMocks.retrieve).not.toHaveBeenCalled();
        expect(fulfilmentMocks.fulfilPostPackCheckout).not.toHaveBeenCalled();
        expect(result.activated).toBe(0);
        expect(discordMocks.sendDiscordMessage).not.toHaveBeenCalled();
    });

    it('never feeds a pack session to the new-post or renewal paths', async () => {
        const lost = packSession('cs_pack_lost');
        stripeMocks.list.mockReturnValue(asyncIterable([lost]));
        stripeMocks.retrieve.mockResolvedValue(lost);

        await run();

        expect(fulfilmentMocks.activatePaidJobCheckout).not.toHaveBeenCalled();
        expect(fulfilmentMocks.applyRenewalCheckout).not.toHaveBeenCalled();
        expect(prisma.jobCharge.findUnique).not.toHaveBeenCalled();
    });

    it('reports a pack another path recorded in between, without recording it twice', async () => {
        const lost = packSession('cs_pack_raced');
        stripeMocks.list.mockReturnValue(asyncIterable([lost]));
        stripeMocks.retrieve.mockResolvedValue(lost);
        fulfilmentMocks.fulfilPostPackCheckout.mockResolvedValue({ outcome: 'already_fulfilled', packId: 'pack-1' });

        const result = await run();

        expect(fulfilmentMocks.fulfilPostPackCheckout).toHaveBeenCalledTimes(1);
        expect(result.activated).toBe(1);
        expect(alerted()).toContain('5-post pack already_fulfilled');
    });

    it('reports a failed recovery and goes on to the next pack', async () => {
        const broken = packSession('cs_pack_boom');
        const next = packSession('cs_pack_next', { metadata: { ...packSession('x').metadata, userId: 'user-2' } });
        stripeMocks.list.mockReturnValue(asyncIterable([broken, next]));
        stripeMocks.retrieve.mockImplementation(async (id: string) => (id === broken.id ? broken : next));
        fulfilmentMocks.fulfilPostPackCheckout
            .mockRejectedValueOnce(new Error('db down'))
            .mockResolvedValueOnce({ outcome: 'fulfilled', packId: 'pack-2' });

        const result = await run();

        expect(result.failures).toBe(1);
        expect(result.activated).toBe(1);
        expect(alerted()).toContain('POST PACK db down');
        expect(alerted()).toContain('cs_pack_boom');
        expect(alerted()).toContain('cs_pack_next');
    });

    it('names a session that carries no account as such in the alert', async () => {
        const orphan = packSession('cs_pack_orphan', { metadata: { type: 'post_pack', sku: 'post-pack-5', posts: '5' } });
        stripeMocks.list.mockReturnValue(asyncIterable([orphan]));
        stripeMocks.retrieve.mockResolvedValue(orphan);

        await run();

        expect(fulfilmentMocks.fulfilPostPackCheckout).toHaveBeenCalledWith(expect.anything(), orphan, { eventId: 'payment-reconciliation' });
        expect(alerted()).toContain('no account');
    });
});
