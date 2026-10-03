/**
 * lib/inngest/functions/payment-reconciliation.ts — what the sweep's alert
 * says about a payment it recovered, and how far back it looks for renewals.
 *
 * Left archived. activatePaidJobCheckout and applyRenewalCheckout return
 * leftArchived: true when the post was archived while its checkout was open:
 * the payment is on the books, and the post stays unpublished until the
 * employer restores it. The sweep dropped that flag, so its Discord line
 * read "recovered (activated now)" or "renewal recovered" for a post that is
 * not live. Pins: the line says the post was left archived and that the
 * employer must restore it, for both arms, and says nothing of the kind for
 * a post that went live.
 *
 * Lookback. /api/create-renewal-checkout refuses a new renewal while a paid
 * one for the post is not on the ledger, looking back
 * RENEWAL_SETTLEMENT_LOOKBACK_MS (a delayed payment can settle weeks after
 * its checkout). The sweep looked back one week, so a renewal that settled
 * later, with its webhook lost, was never recovered. Pins: the sweep reads
 * the same range.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { RENEWAL_SETTLEMENT_LOOKBACK_MS } from '@/lib/renewal-checkout-sessions';

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

const HOUR_MS = 60 * 60 * 1000;
const LEFT_ARCHIVED = '(left archived: employer must restore)';

function asyncIterable<T>(items: T[]) {
    return { async *[Symbol.asyncIterator]() { for (const item of items) yield item; } };
}

/** A paid session Stripe lists, five hours old: past the two hour grace for a webhook still on its way. */
function paidSession(id: string, metadata: Record<string, string>) {
    return { id, payment_status: 'paid', status: 'complete', created: Math.floor((Date.now() - 5 * HOUR_MS) / 1000), metadata };
}

async function run() {
    const mod = await import('@/lib/inngest/functions/payment-reconciliation');
    const fn = mod.paymentReconciliationSweep as unknown as CapturedFunction;
    return fn.handler({ step: { run: (async (_n: string, cb: () => Promise<unknown>) => cb()) as StepRun } });
}

const alertText = () => JSON.stringify(discordMocks.sendDiscordMessage.mock.calls);

beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    vi.mocked(prisma.employerJob.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.jobCharge.findUnique).mockResolvedValue(null as never);
});

describe('a recovered payment for a post that was archived meanwhile', () => {
    function stalePendingNewPost() {
        const session = paidSession('cs_new_post', { jobId: 'job-new', pricing: 'pro' });
        vi.mocked(prisma.employerJob.findMany).mockResolvedValue([
            { id: 'ej-new', jobId: 'job-new', createdAt: new Date(Date.now() - 6 * HOUR_MS) },
        ] as never);
        stripeMocks.list.mockReturnValue(asyncIterable([session]));
        stripeMocks.retrieve.mockResolvedValue(session);
    }

    function lostRenewal() {
        const session = paidSession('cs_renewal', { jobId: 'job-renewed', type: 'renewal', tier: 'pro' });
        stripeMocks.list.mockReturnValue(asyncIterable([session]));
        stripeMocks.retrieve.mockResolvedValue(session);
    }

    it('new post: the alert says it was activated but left archived, so nobody reads it as live', async () => {
        stalePendingNewPost();
        activationMocks.activatePaidJobCheckout.mockResolvedValue({ outcome: 'activated', jobId: 'job-new', leftArchived: true });

        const result = await run();

        expect(result.activated).toBe(1);
        expect(alertText()).toContain(`job job-new · session cs_new_post · recovered (activated now) ${LEFT_ARCHIVED}`);
    });

    it('new post that went live: no such note', async () => {
        stalePendingNewPost();
        activationMocks.activatePaidJobCheckout.mockResolvedValue({ outcome: 'activated', jobId: 'job-new' });

        await run();

        expect(alertText()).toContain('job job-new · session cs_new_post · recovered (activated now)');
        expect(alertText()).not.toContain('left archived');
    });

    it('renewal: the alert says it was recovered but left archived', async () => {
        lostRenewal();
        activationMocks.applyRenewalCheckout.mockResolvedValue({ outcome: 'applied', jobId: 'job-renewed', leftArchived: true });

        const result = await run();

        expect(result.activated).toBe(1);
        expect(alertText()).toContain(`job job-renewed · session cs_renewal · renewal recovered ${LEFT_ARCHIVED}`);
    });

    it('renewal that went live: no such note', async () => {
        lostRenewal();
        activationMocks.applyRenewalCheckout.mockResolvedValue({ outcome: 'applied', jobId: 'job-renewed' });

        await run();

        expect(alertText()).toContain('job job-renewed · session cs_renewal · renewal recovered');
        expect(alertText()).not.toContain('left archived');
    });

    it('a replayed renewal that is archived carries the note too', async () => {
        lostRenewal();
        activationMocks.applyRenewalCheckout.mockResolvedValue({ outcome: 'already_applied', jobId: 'job-renewed', leftArchived: true });

        await run();

        expect(alertText()).toContain(`renewal already_applied ${LEFT_ARCHIVED}`);
    });

    it('a renewal refused at the renewal cap is reported by its outcome, never as recovered', async () => {
        lostRenewal();
        activationMocks.applyRenewalCheckout.mockResolvedValue({ outcome: 'cap_reached', jobId: 'job-renewed' });

        await run();

        expect(alertText()).toContain('job job-renewed · session cs_renewal · renewal cap_reached');
        expect(alertText()).not.toContain('renewal recovered');
    });
});

describe('the renewal arm looks back as far as a renewal payment can still be settling', () => {
    it('lists Checkout Sessions from the settlement lookback, the range the create route refuses on', async () => {
        stripeMocks.list.mockReturnValue(asyncIterable([]));
        const before = Date.now();

        await run();

        const [params] = stripeMocks.list.mock.calls[0] as [{ created: { gte: number }; limit: number }];
        const expected = Math.floor((before - RENEWAL_SETTLEMENT_LOOKBACK_MS) / 1000) - 3600;
        expect(params.created.gte).toBeGreaterThanOrEqual(expected);
        expect(params.created.gte).toBeLessThanOrEqual(expected + 5);
    });

    it('recovers a paid renewal whose checkout is two weeks old (a delayed payment that settled late)', async () => {
        const session = { ...paidSession('cs_late_ach', { jobId: 'job-ach', type: 'renewal', tier: 'pro' }), created: Math.floor((Date.now() - 14 * 24 * HOUR_MS) / 1000) };
        // Stripe returns what the listing asked for: nothing older than `created.gte`.
        stripeMocks.list.mockImplementation((params: { created: { gte: number } }) =>
            asyncIterable([session].filter((s) => s.created >= params.created.gte)));
        stripeMocks.retrieve.mockResolvedValue(session);
        activationMocks.applyRenewalCheckout.mockResolvedValue({ outcome: 'applied', jobId: 'job-ach' });

        const result = await run();

        expect(activationMocks.applyRenewalCheckout).toHaveBeenCalledWith(expect.anything(), session);
        expect(result.activated).toBe(1);
    });
});
