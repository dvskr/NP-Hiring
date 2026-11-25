/**
 * A payment never puts a posting an admin took down back up, or extends it
 * (lib/admin/job-hold.ts). Held to the shared fulfilments
 * (activate-paid-job.ts, apply-renewal.ts), which the webhook, the verify
 * pages and the daily payment check all run.
 *
 * A Checkout session stays payable for up to a day, so an admin can take a
 * posting down after its checkout opened and before it is paid.
 *   - First payment: the money is claimed and ledgered as usual (a refund is
 *     matched to it), but the publish carries adminHoldAt: null in its WHERE
 *     and the posting stays down. No "your listing is live" email; an alert
 *     asks an operator to refund it or lift the hold.
 *   - Renewal: the hold is read inside the transaction and rolls the whole
 *     renewal back. The payment is ledgered, nothing is extended or
 *     published, no confirmation email goes out, and it is alerted for a
 *     refund. Stripe gets a 200, so it does not retry.
 *   - A chargeback won restores the payment status but leaves a held
 *     posting down, a hold placed between its read and its write included
 *     (the republish carries adminHoldAt: null in its WHERE).
 *
 * All fixtures are fictional.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import type Stripe from 'stripe';
import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';
import { logger } from '@/lib/logger';
import { sendDiscordMessage } from '@/lib/discord-notifier';
import { sendConfirmationEmail, sendRenewalConfirmationEmail } from '@/lib/email-service';
import { trackServerPurchase } from '@/lib/analytics-server';
import { pingSearchEnginesForJobPage } from '@/lib/job-page-indexing';

const stripeMocks = vi.hoisted(() => ({ list: vi.fn(), expire: vi.fn(), retrieve: vi.fn() }));
vi.mock('stripe', () => ({
    default: vi.fn().mockImplementation(() => ({
        webhooks: { constructEvent: vi.fn().mockImplementation((raw: string) => JSON.parse(raw)) },
        checkout: { sessions: stripeMocks },
    })),
}));
vi.mock('@/lib/email-service', () => ({
    sendConfirmationEmail: vi.fn().mockResolvedValue({ success: true }),
    sendRenewalConfirmationEmail: vi.fn().mockResolvedValue({ success: true }),
    sendRefundConfirmationEmail: vi.fn().mockResolvedValue(undefined),
    getOrCreateUnsubToken: vi.fn().mockResolvedValue('utok'),
}));
vi.mock('@/lib/job-page-indexing', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/job-page-indexing')>()),
    pingSearchEnginesForJobPage: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/lib/analytics-server', () => ({ trackServerPurchase: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/discord-notifier', () => ({ sendDiscordMessage: vi.fn().mockResolvedValue(true) }));

const NOW_S = Math.floor(Date.now() / 1000);
const DAY_MS = 24 * 60 * 60 * 1000;
const HELD_SINCE = new Date(Date.now() - 2 * 60 * 60 * 1000);

function paidSession(id: string, metadata: Record<string, string>, amountTotal: number) {
    return {
        id,
        object: 'checkout.session',
        mode: 'payment',
        status: 'complete',
        payment_status: 'paid',
        payment_intent: `pi_${id}`,
        amount_total: amountTotal,
        currency: 'usd',
        invoice: null,
        created: NOW_S - 600,
        expires_at: NOW_S - 600 + 55 * 60,
        metadata,
    };
}

const NEW_POST_SESSION = paidSession('cs_held_new', { jobId: 'job-held', pricing: 'pro' }, config.stripePriceInCents);
const RENEWAL_SESSION = paidSession('cs_held_renewal', { jobId: 'job-held', type: 'renewal', tier: 'pro', renewalRung: 'base' }, config.stripeRenewalPriceInCents);

function asyncList<T>(items: T[]) {
    return { async *[Symbol.asyncIterator]() { for (const item of items) yield item; } };
}

async function deliver(eventId: string, type: string, object: object) {
    const { POST } = await import('@/app/api/webhooks/stripe/route');
    const res = await POST(new Request('https://example.com/api/webhooks/stripe', {
        method: 'POST',
        headers: { 'stripe-signature': 'sig_test' },
        body: JSON.stringify({ id: eventId, type, data: { object } }),
    }) as never);
    return { res, json: await res.json() };
}

const alerts = () => JSON.stringify(vi.mocked(sendDiscordMessage).mock.calls);

let logSpies: Array<{ mockRestore: () => void }> = [];

beforeAll(async () => {
    await import('@/app/api/webhooks/stripe/route');
}, 60_000);

beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_x';
    logSpies = [
        vi.spyOn(logger, 'error').mockImplementation(() => undefined),
        vi.spyOn(logger, 'warn').mockImplementation(() => undefined),
        vi.spyOn(logger, 'info').mockImplementation(() => undefined),
    ];
    vi.mocked(prisma.processedStripeEvent.create).mockResolvedValue({} as never);
    vi.mocked(prisma.jobCharge.create).mockReset();
    vi.mocked(prisma.jobCharge.create).mockResolvedValue({} as never);
    vi.mocked(prisma.jobCharge.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.employerJob.update).mockResolvedValue({} as never);
    vi.mocked(prisma.job.update).mockReset();
    vi.mocked(prisma.job.findUnique).mockReset();
    vi.mocked(prisma.emailSend.create).mockResolvedValue({} as never);
    vi.mocked(prisma.emailLead.findUnique).mockResolvedValue({ unsubscribeToken: 'utok' } as never);
    stripeMocks.list.mockImplementation(() => asyncList([]));
});

afterEach(() => {
    for (const spy of logSpies) spy.mockRestore();
});

describe('a first payment for a posting under a hold', () => {
    beforeEach(() => {
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({
            id: 'ej-held', jobId: 'job-held', paymentStatus: 'pending', contactEmail: 'owner@clinic.example', dashboardToken: 'tok', quotaDomain: null,
        } as never);
        // The claim and the publish run in one transaction (claimAndPublish), on the client itself here.
        vi.mocked(prisma.$transaction).mockImplementation(((fn: (client: typeof prisma) => Promise<unknown>) => fn(prisma)) as never);
        // The claim moves the pending row.
        vi.mocked(prisma.employerJob.updateMany).mockResolvedValue({ count: 1 } as never);
    });

    /** The publish matches no row while the hold is on (count 0), as the real WHERE would; the row is read back after it. */
    function heldJob(held: boolean) {
        vi.mocked(prisma.job.updateMany).mockImplementation((async (args: { where: Record<string, unknown> }) => (
            { count: held && 'adminHoldAt' in args.where ? 0 : 1 }
        )) as never);
        vi.mocked(prisma.job.findUnique).mockResolvedValue(
            { id: 'job-held', title: 'Nurse Practitioner', slug: 'nurse-practitioner-job-held', archivedAt: null, adminHoldAt: held ? HELD_SINCE : null } as never,
        );
    }

    it('claims and ledgers the payment, but leaves the posting down and asks an operator to act', async () => {
        heldJob(true);

        const { res, json } = await deliver('evt_held_new', 'checkout.session.completed', NEW_POST_SESSION);

        expect(res.status).toBe(200);
        expect(json).toEqual({ received: true, leftHeld: true });
        // The payment is the employer's: claimed and on the ledger, where a refund is matched to it.
        expect(prisma.employerJob.updateMany).toHaveBeenCalledWith({
            where: { id: 'ej-held', paymentStatus: 'pending' },
            data: { paymentStatus: 'paid', pricingTier: 'pro' },
        });
        expect(prisma.jobCharge.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ stripeSessionId: 'cs_held_new', type: 'new', employerJobId: 'ej-held' }),
        });
        // The publish carried the hold in its WHERE and matched nothing; no other write touched the job.
        const [publish] = vi.mocked(prisma.job.updateMany).mock.calls.map(([args]) => args as { where: Record<string, unknown> });
        expect(publish.where).toMatchObject({ id: 'job-held', adminHoldAt: null });
        expect(vi.mocked(prisma.job.updateMany)).toHaveBeenCalledTimes(1);
        expect(prisma.job.update).not.toHaveBeenCalled();
        // Not live: no "your listing is live" email and no ping.
        expect(sendConfirmationEmail).not.toHaveBeenCalled();
        expect(pingSearchEnginesForJobPage).not.toHaveBeenCalled();
        // A human is told: refund it, or lift the hold.
        expect(alerts()).toContain('admin hold');
        expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining('admin hold'),
            undefined,
            expect.objectContaining({ jobId: 'job-held', employerJobId: 'ej-held', sessionId: 'cs_held_new' }),
        );
        // Handled: the event is not handed back to Stripe for a retry.
        expect(prisma.processedStripeEvent.delete).not.toHaveBeenCalled();
    });

    it('tells every caller (webhook, verify page, sweep) that the posting was left down under the hold', async () => {
        heldJob(true);
        const { getStripe } = await import('@/lib/stripe');
        const { activatePaidJobCheckout } = await import('@/app/api/webhooks/stripe/activate-paid-job');

        const result = await activatePaidJobCheckout(getStripe() as Stripe, NEW_POST_SESSION as unknown as Stripe.Checkout.Session);

        expect(result).toEqual({ outcome: 'activated', jobId: 'job-held', leftHeld: true });
    });

    it('still publishes a posting with no hold', async () => {
        heldJob(false);

        const { res, json } = await deliver('evt_open_new', 'checkout.session.completed', NEW_POST_SESSION);

        expect(res.status).toBe(200);
        expect(json).toEqual({ received: true });
        expect(vi.mocked(prisma.job.updateMany).mock.calls[0][0].data).toMatchObject({ isPublished: true });
        expect(sendConfirmationEmail).toHaveBeenCalledTimes(1);
        expect(alerts()).not.toContain('admin hold');
    });
});

/**
 * A renewal's first run: the transaction's own client, so a read inside it is told apart from one
 * outside, and the ledger row goes in (the replay below makes it collide). Both blocks use it.
 */
function renewalTransaction(adminHoldAt: Date | null) {
    const tx = {
        jobCharge: { create: vi.fn().mockResolvedValue({}) },
        employerJob: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        job: {
            update: vi.fn().mockResolvedValue({}),
            findUnique: vi.fn().mockResolvedValue({ archivedAt: null, adminHoldAt }),
        },
    };
    vi.mocked(prisma.$transaction).mockImplementation(((fn: (client: typeof tx) => Promise<unknown>) => fn(tx)) as never);
    return tx;
}

describe('a renewal payment for a posting under a hold', () => {
    beforeEach(() => {
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({
            id: 'ej-held', jobId: 'job-held', paymentStatus: 'paid', contactEmail: 'owner@clinic.example', dashboardToken: 'tok',
        } as never);
        vi.mocked(prisma.job.findUnique).mockResolvedValue({
            expiresAt: new Date(Date.now() + 3 * DAY_MS),
            createdAt: new Date(Date.now() - 57 * DAY_MS),
            title: 'Nurse Practitioner',
            slug: 'nurse-practitioner-job-held',
        } as never);
    });

    it('applies nothing, ledgers the payment for a refund, and acknowledges it', async () => {
        const tx = renewalTransaction(HELD_SINCE);

        const { res, json } = await deliver('evt_held_renewal', 'checkout.session.completed', RENEWAL_SESSION);

        expect(res.status).toBe(200);
        expect(json.note).toMatch(/admin hold/);
        // The hold is read inside the transaction, after the write that locks the row...
        expect(tx.job.findUnique).toHaveBeenCalledWith({ where: { id: 'job-held' }, select: { archivedAt: true, adminHoldAt: true } });
        expect(tx.job.update.mock.invocationCallOrder[0]).toBeLessThan(tx.job.findUnique.mock.invocationCallOrder[0]);
        // ...and nothing publishes the posting: the transaction rolls back.
        expect(tx.job.update).toHaveBeenCalledTimes(1);
        expect(prisma.job.update).not.toHaveBeenCalled();
        // The money is on the ledger, outside the rolled back transaction, so the refund is matched to it.
        expect(prisma.jobCharge.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ stripeSessionId: 'cs_held_renewal', type: 'renewal', employerJobId: 'ej-held' }),
        });
        // No "renewed" email and no purchase event: nothing was renewed.
        expect(sendRenewalConfirmationEmail).not.toHaveBeenCalled();
        expect(trackServerPurchase).not.toHaveBeenCalled();
        expect(alerts()).toContain('Renewal paid for a posting an admin took down, refund required');
        expect(prisma.processedStripeEvent.delete).not.toHaveBeenCalled();
    });

    it('reports the hold to every caller (webhook, verify page, sweep)', async () => {
        renewalTransaction(HELD_SINCE);
        const { getStripe } = await import('@/lib/stripe');
        const { applyRenewalCheckout } = await import('@/app/api/webhooks/stripe/apply-renewal');

        const result = await applyRenewalCheckout(getStripe() as Stripe, RENEWAL_SESSION as unknown as Stripe.Checkout.Session);

        expect(result).toEqual({ outcome: 'admin_hold', jobId: 'job-held' });
    });

    it('a posting with no hold is renewed and put back live as before', async () => {
        const tx = renewalTransaction(null);

        const { res, json } = await deliver('evt_open_renewal', 'checkout.session.completed', RENEWAL_SESSION);

        expect(res.status).toBe(200);
        expect(json).toEqual({ received: true });
        expect(tx.job.update).toHaveBeenCalledTimes(2);
        expect(tx.job.update.mock.calls[1][0]).toEqual({ where: { id: 'job-held' }, data: { isPublished: true } });
        expect(sendRenewalConfirmationEmail).toHaveBeenCalledTimes(1);
    });
});

describe('a replay of a renewal that was not applied because of a hold', () => {
    const CONFIRMATION_KEY = 'renewal-confirmation:cs_held_renewal';
    const WITHHELD = { metadata: { guard: 'stripe-webhook', reason: 'renewal_not_applied', outcome: 'admin_hold' } };

    /** The renewal transaction, as a replay meets it: the session's ledger row is already there. */
    function replayTransaction(adminHoldAt: Date | null) {
        const tx = {
            jobCharge: { create: vi.fn().mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })) },
            employerJob: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
            job: { update: vi.fn().mockResolvedValue({}), findUnique: vi.fn().mockResolvedValue({ archivedAt: null, adminHoldAt }) },
        };
        vi.mocked(prisma.$transaction).mockImplementation(((fn: (client: typeof tx) => Promise<unknown>) => fn(tx)) as never);
        return tx;
    }

    beforeEach(() => {
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({
            id: 'ej-held', jobId: 'job-held', paymentStatus: 'paid', contactEmail: 'owner@clinic.example', dashboardToken: 'tok',
        } as never);
        // The hold has been lifted since the first run: the posting reads as live and unheld.
        vi.mocked(prisma.job.findUnique).mockResolvedValue({
            expiresAt: new Date(Date.now() + 3 * DAY_MS),
            createdAt: new Date(Date.now() - 57 * DAY_MS),
            title: 'Nurse Practitioner',
            slug: 'nurse-practitioner-job-held',
            archivedAt: null,
            adminHoldAt: null,
        } as never);
        vi.mocked(prisma.emailSend.findFirst).mockReset();
        vi.mocked(prisma.emailSend.deleteMany).mockReset();
    });

    it('the first run withholds the confirmation before it ledgers the payment', async () => {
        renewalTransaction(HELD_SINCE);

        await deliver('evt_held_marker', 'checkout.session.completed', RENEWAL_SESSION);

        expect(prisma.emailSend.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                dedupeKey: CONFIRMATION_KEY,
                status: 'withheld',
                emailType: 'renewal_confirmation',
                to: 'owner@clinic.example',
                metadata: expect.objectContaining({ outcome: 'admin_hold' }),
            }),
        });
        const markerOrder = vi.mocked(prisma.emailSend.create).mock.invocationCallOrder[0];
        const ledgerOrder = vi.mocked(prisma.jobCharge.create).mock.invocationCallOrder[0];
        expect(markerOrder).toBeLessThan(ledgerOrder);
    });

    it('sends no "live again" email and no purchase event after the hold was lifted, and answers admin_hold again', async () => {
        const tx = replayTransaction(null);
        vi.mocked(prisma.emailSend.findFirst).mockResolvedValue(WITHHELD as never);

        const { res, json } = await deliver('evt_held_replay', 'checkout.session.async_payment_succeeded', RENEWAL_SESSION);

        expect(res.status).toBe(200);
        expect(json.note).toMatch(/admin hold/);
        expect(prisma.emailSend.findFirst).toHaveBeenCalledWith({
            where: { dedupeKey: CONFIRMATION_KEY, status: 'withheld' },
            select: { metadata: true },
        });
        expect(sendRenewalConfirmationEmail).not.toHaveBeenCalled();
        expect(trackServerPurchase).not.toHaveBeenCalled();
        expect(pingSearchEnginesForJobPage).not.toHaveBeenCalled();
        // Nothing applied, and no second refund alert: the first run raised it.
        expect(tx.employerJob.updateMany).not.toHaveBeenCalled();
        expect(tx.job.update).not.toHaveBeenCalled();
        expect(sendDiscordMessage).not.toHaveBeenCalled();
    });

    it('tells every caller the same outcome the first run did', async () => {
        replayTransaction(null);
        vi.mocked(prisma.emailSend.findFirst).mockResolvedValue(WITHHELD as never);
        const { getStripe } = await import('@/lib/stripe');
        const { applyRenewalCheckout } = await import('@/app/api/webhooks/stripe/apply-renewal');

        const result = await applyRenewalCheckout(getStripe() as Stripe, RENEWAL_SESSION as unknown as Stripe.Checkout.Session);

        expect(result).toEqual({ outcome: 'admin_hold', jobId: 'job-held' });
    });

    it('a replay of a renewal that WAS applied still confirms it once, as before', async () => {
        replayTransaction(null);
        vi.mocked(prisma.emailSend.findFirst).mockResolvedValue(null as never);
        const { getStripe } = await import('@/lib/stripe');
        const { applyRenewalCheckout } = await import('@/app/api/webhooks/stripe/apply-renewal');

        const result = await applyRenewalCheckout(getStripe() as Stripe, RENEWAL_SESSION as unknown as Stripe.Checkout.Session);

        expect(result.outcome).toBe('already_applied');
        expect(sendRenewalConfirmationEmail).toHaveBeenCalledTimes(1);
    });

    it('a renewal applied after a run that died between the marker and the ledger row clears the marker first', async () => {
        renewalTransaction(null);

        await deliver('evt_after_crash', 'checkout.session.completed', RENEWAL_SESSION);

        expect(prisma.emailSend.deleteMany).toHaveBeenCalledWith({ where: { dedupeKey: CONFIRMATION_KEY, status: 'withheld' } });
        const clearOrder = vi.mocked(prisma.emailSend.deleteMany).mock.invocationCallOrder[0];
        const claimOrder = vi.mocked(prisma.emailSend.create).mock.invocationCallOrder[0];
        expect(clearOrder).toBeLessThan(claimOrder);
        expect(sendRenewalConfirmationEmail).toHaveBeenCalledTimes(1);
    });
});

describe('a chargeback won on a posting under a hold', () => {
    beforeEach(() => {
        vi.mocked(prisma.jobCharge.findUnique).mockResolvedValue({ id: 'jc-held', employerJobId: 'ej-held', amountCents: config.stripePriceInCents } as never);
        vi.mocked(prisma.employerJob.findUnique).mockResolvedValue({ id: 'ej-held', jobId: 'job-held' } as never);
        vi.mocked(prisma.employerJob.updateMany).mockResolvedValue({ count: 1 } as never);
        vi.mocked(prisma.job.updateMany).mockResolvedValue({ count: 1 } as never);
        // The restore and the republish run in one transaction (restoreWonPosting),
        // on the client itself here: the renewal tests above left their own.
        vi.mocked(prisma.$transaction).mockImplementation(((fn: (client: typeof prisma) => Promise<unknown>) => fn(prisma)) as never);
    });

    it('restores the payment status but leaves the posting down', async () => {
        vi.mocked(prisma.job.findUnique).mockResolvedValue({ expiresAt: new Date(Date.now() + 10 * DAY_MS), archivedAt: null, adminHoldAt: HELD_SINCE } as never);

        const { res, json } = await deliver('evt_held_won', 'charge.dispute.closed', { id: 'dp-held', payment_intent: 'pi_held', amount: config.stripePriceInCents, status: 'won' });

        expect(res.status).toBe(200);
        expect(json).toEqual({ received: true, dispute: 'won', restored: true, republished: false });
        expect(prisma.employerJob.updateMany).toHaveBeenCalledWith({ where: { id: 'ej-held', paymentStatus: 'disputed' }, data: { paymentStatus: 'paid' } });
        expect(prisma.job.updateMany).not.toHaveBeenCalled();
        expect(prisma.job.update).not.toHaveBeenCalled();
        expect(prisma.job.findUnique).toHaveBeenCalledWith({ where: { id: 'job-held' }, select: { expiresAt: true, archivedAt: true, adminHoldAt: true } });
    });

    it('still republishes a posting with no hold', async () => {
        vi.mocked(prisma.job.findUnique).mockResolvedValue({ expiresAt: new Date(Date.now() + 10 * DAY_MS), archivedAt: null, adminHoldAt: null } as never);

        const { json } = await deliver('evt_open_won', 'charge.dispute.closed', { id: 'dp-open', payment_intent: 'pi_open', amount: config.stripePriceInCents, status: 'won' });

        expect(json).toMatchObject({ dispute: 'won', republished: true });
        expect(prisma.job.updateMany).toHaveBeenCalledWith({
            where: { id: 'job-held', archivedAt: null, adminHoldAt: null },
            data: { isPublished: true, contentChangedAt: expect.any(Date) },
        });
    });

    it('a hold placed after the read keeps the posting down: the republish carries adminHoldAt: null in its WHERE', async () => {
        // The read finds no hold; an admin takes the posting down before the
        // write, which then matches no row.
        vi.mocked(prisma.job.findUnique).mockResolvedValue({ expiresAt: new Date(Date.now() + 10 * DAY_MS), archivedAt: null, adminHoldAt: null } as never);
        vi.mocked(prisma.job.updateMany).mockResolvedValue({ count: 0 } as never);

        const { res, json } = await deliver('evt_hold_race_won', 'charge.dispute.closed', { id: 'dp-race', payment_intent: 'pi_race', amount: config.stripePriceInCents, status: 'won' });

        expect(res.status).toBe(200);
        expect(json).toEqual({ received: true, dispute: 'won', restored: true, republished: false });
        expect(prisma.job.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ id: 'job-held', adminHoldAt: null, archivedAt: null }),
        }));
    });
});
