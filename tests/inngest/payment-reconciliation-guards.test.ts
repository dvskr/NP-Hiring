/**
 * lib/inngest/functions/payment-reconciliation.ts — the two guards around
 * the new-post expiry arm.
 *
 * Delayed payments: a Checkout Session paid by ACH (or another delayed
 * method) is 'complete' and still 'unpaid' while the money settles, and
 * checkout.session.async_payment_succeeded can land days later. Expiring the
 * row in the meantime made the activation's pending→paid claim fail, so the
 * paid post was reported as a 'duplicate_payment' and never published. Pins:
 *   - complete + PaymentIntent 'processing' → the row stays 'pending';
 *   - complete + PaymentIntent 'requires_action' (ACH microdeposits not yet
 *     verified, open for up to 10 days) → the row stays 'pending';
 *   - complete + the delayed payment failed ('requires_payment_method' or
 *     'canceled') → the row expires as before;
 *   - an open / expired session past 24h → expires as before, no extra call;
 *   - Stripe cannot be asked → the row is held for the next run;
 *   - paid since the scan → held (the next run activates it).
 *
 * No Stripe key: the sweep logs a skip and returns instead of throwing (the
 * function and its retries failed every day), and touches no row. With a
 * key and no pending row it still scans Stripe, for the renewal arm.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

type StepRun = <T>(name: string, fn: () => Promise<T>) => Promise<T>;
interface SweepResult { checked: number; activated: number; expired: number; settling: number; failures: number; skipped?: string }
interface CapturedFunction {
    handler: (ctx: { step: { run: StepRun } }) => Promise<SweepResult>;
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
const DAY_MS = 24 * HOUR_MS;

function asyncIterable<T>(items: T[]) {
    return { async *[Symbol.asyncIterator]() { for (const item of items) yield item; } };
}

/** A new-post session for job-1, created two days ago (past the 24h window). */
function newPostSession(overrides: Record<string, unknown> = {}) {
    return {
        id: 'cs_ach',
        status: 'complete',
        payment_status: 'unpaid',
        payment_intent: 'pi_ach',
        created: Math.floor((Date.now() - 2 * DAY_MS) / 1000),
        metadata: { jobId: 'job-1', pricing: 'pro' },
        ...overrides,
    };
}

function pendingRow() {
    vi.mocked(prisma.employerJob.findMany).mockResolvedValue([
        { id: 'ej-1', jobId: 'job-1', createdAt: new Date(Date.now() - 3 * DAY_MS) },
    ] as never);
}

async function run(): Promise<SweepResult> {
    const mod = await import('@/lib/inngest/functions/payment-reconciliation');
    const fn = mod.paymentReconciliationSweep as unknown as CapturedFunction;
    return fn.handler({ step: { run: (async (_n: string, cb: () => Promise<unknown>) => cb()) as StepRun } });
}

const EXPIRE_CALL = { where: { id: 'ej-1', paymentStatus: 'pending' }, data: { paymentStatus: 'expired' } };
const savedKey = process.env.STRIPE_SECRET_KEY;

beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    vi.mocked(prisma.employerJob.updateMany).mockResolvedValue({ count: 1 } as never);
    stripeMocks.list.mockReturnValue(asyncIterable([newPostSession()]));
});

afterEach(() => {
    if (savedKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = savedKey;
});

describe('delayed payments are not expired while they settle', () => {
    it('keeps the row pending while the PaymentIntent is processing', async () => {
        pendingRow();
        stripeMocks.retrieve.mockResolvedValue(newPostSession({ payment_intent: { id: 'pi_ach', status: 'processing' } }));

        const result = await run();

        expect(stripeMocks.retrieve).toHaveBeenCalledWith('cs_ach', { expand: ['payment_intent'] });
        expect(prisma.employerJob.updateMany).not.toHaveBeenCalled();
        expect(result).toMatchObject({ expired: 0, settling: 1, failures: 0 });
        // Nothing was paid yet: no activation, no alert.
        expect(activationMocks.activatePaidJobCheckout).not.toHaveBeenCalled();
        expect(discordMocks.sendDiscordMessage).not.toHaveBeenCalled();
    });

    it('keeps the row pending while ACH microdeposit verification is outstanding (requires_action)', async () => {
        // Stripe keeps the intent in requires_action for up to 10 days; the
        // employer can still verify and async_payment_succeeded then lands.
        pendingRow();
        stripeMocks.retrieve.mockResolvedValue(newPostSession({
            payment_intent: { id: 'pi_ach', status: 'requires_action', next_action: { type: 'verify_with_microdeposits' } },
        }));

        const result = await run();

        expect(prisma.employerJob.updateMany).not.toHaveBeenCalled();
        expect(result.settling).toBe(1);
        expect(result).toMatchObject({ expired: 0, failures: 0 });
        expect(activationMocks.activatePaidJobCheckout).not.toHaveBeenCalled();
        expect(discordMocks.sendDiscordMessage).not.toHaveBeenCalled();
    });

    it.each(['requires_payment_method', 'canceled'])("expires the row once the delayed payment has failed (intent '%s')", async (intentStatus) => {
        pendingRow();
        stripeMocks.retrieve.mockResolvedValue(newPostSession({ payment_intent: { id: 'pi_ach', status: intentStatus } }));

        const result = await run();

        expect(prisma.employerJob.updateMany).toHaveBeenCalledWith(EXPIRE_CALL);
        expect(result).toMatchObject({ expired: 1, settling: 0 });
    });

    it('holds a row whose session was paid after the scan; the next run activates it', async () => {
        pendingRow();
        stripeMocks.retrieve.mockResolvedValue(newPostSession({ payment_status: 'paid', payment_intent: { id: 'pi_ach', status: 'succeeded' } }));

        const result = await run();

        expect(prisma.employerJob.updateMany).not.toHaveBeenCalled();
        expect(result.settling).toBe(1);
    });

    it('holds the row when Stripe cannot be asked, and logs it', async () => {
        pendingRow();
        stripeMocks.retrieve.mockRejectedValue(new Error('Stripe timeout'));
        const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);

        const result = await run();

        expect(prisma.employerJob.updateMany).not.toHaveBeenCalled();
        expect(result.settling).toBe(1);
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('holding the row'), expect.any(Error), { sessionId: 'cs_ach' });
        errorSpy.mockRestore();
    });

    it('expires the row when Stripe no longer knows the session', async () => {
        pendingRow();
        stripeMocks.retrieve.mockRejectedValue(Object.assign(new Error('No such checkout.session'), { code: 'resource_missing' }));

        const result = await run();

        expect(prisma.employerJob.updateMany).toHaveBeenCalledWith(EXPIRE_CALL);
        expect(result.expired).toBe(1);
    });

    it.each(['expired', 'open'])("an abandoned '%s' session past 24h still expires, without an extra Stripe call", async (status) => {
        pendingRow();
        stripeMocks.list.mockReturnValue(asyncIterable([newPostSession({ status, payment_intent: null })]));

        const result = await run();

        expect(stripeMocks.retrieve).not.toHaveBeenCalled();
        expect(prisma.employerJob.updateMany).toHaveBeenCalledWith(EXPIRE_CALL);
        expect(result.expired).toBe(1);
    });
});

describe('without a Stripe key', () => {
    beforeEach(() => {
        delete process.env.STRIPE_SECRET_KEY;
    });

    it('skips with a warning, touches no pending row, and does not throw', async () => {
        pendingRow();
        const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

        const result = await run();

        expect(result).toEqual({ checked: 0, activated: 0, expired: 0, settling: 0, failures: 0, skipped: 'stripe_not_configured' });
        expect(stripeMocks.list).not.toHaveBeenCalled();
        expect(prisma.employerJob.updateMany).not.toHaveBeenCalled();
        expect(discordMocks.sendDiscordMessage).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Stripe is not configured'), { pendingRows: 1 });
        warnSpy.mockRestore();
    });

    it('skips with an info log when nothing is pending', async () => {
        vi.mocked(prisma.employerJob.findMany).mockResolvedValue([] as never);
        const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
        const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

        const result = await run();

        expect(result.skipped).toBe('stripe_not_configured');
        expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('Stripe is not configured'));
        expect(warnSpy).not.toHaveBeenCalled();
        infoSpy.mockRestore();
        warnSpy.mockRestore();
    });
});

describe('with a Stripe key and nothing pending', () => {
    it('still scans Stripe, because the renewal arm has no database trace to look for first', async () => {
        vi.mocked(prisma.employerJob.findMany).mockResolvedValue([] as never);
        stripeMocks.list.mockReturnValue(asyncIterable([]));

        const result = await run();

        expect(stripeMocks.list).toHaveBeenCalledOnce();
        expect(result.skipped).toBeUndefined();
    });
});
