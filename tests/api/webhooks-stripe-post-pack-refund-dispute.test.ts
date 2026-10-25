/**
 * POST /api/webhooks/stripe — refunds and chargebacks of a 5-post pack
 * (2027 re-price, phase 2; app/api/webhooks/stripe/post-pack-refunds.ts).
 *
 * No refunds (owner decision 2026-10-25): a pack is not refundable, and
 * nothing does partial-refund credit arithmetic. A refund the owner issues
 * by hand in Stripe, or a chargeback, is still honoured. The route hands the
 * event to the pack code only when no JobCharge matches its payment intent:
 *   - a FULL refund revokes the pack's unused credits for good ('refunded')
 *     and takes down the posts still standing on it ('pack' rows go to
 *     'refunded' and come off the board, as a full refund of a post does); a
 *     renewed pack post, which has its own renewal payment, stays up;
 *   - a PARTIAL refund changes nothing but the amount on the pack row;
 *   - a dispute freezes the pack ('disputed', never usable) and takes its
 *     posts down to 'disputed'; a won dispute unfreezes it and puts back
 *     exactly the posts it took down; a lost one revokes the frozen credits
 *     for good, recorded as 'dispute_lost';
 *   - every one of them alerts staff, and a redelivery changes nothing twice.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { sendDiscordMessage } from '@/lib/discord-notifier';
import { sendRefundConfirmationEmail } from '@/lib/email-service';

vi.mock('stripe', () => ({
    default: vi.fn().mockImplementation(() => ({
        webhooks: { constructEvent: vi.fn().mockImplementation((raw: string) => JSON.parse(raw)) },
    })),
}));
vi.mock('@/lib/email-service', () => ({
    sendRefundConfirmationEmail: vi.fn().mockResolvedValue({ success: true }),
    getOrCreateUnsubToken: vi.fn().mockResolvedValue('utok'),
}));
vi.mock('@/lib/discord-notifier', () => ({ sendDiscordMessage: vi.fn().mockResolvedValue(true) }));

const NOW = new Date('2027-05-01T12:00:00.000Z');
const PACK = { id: 'pack-1', amountCents: 124500, status: 'paid', userId: 'user-1' };

async function deliver(type: string, object: Record<string, unknown>, id = `evt_${type}`) {
    const { POST } = await import('@/app/api/webhooks/stripe/route');
    const res = await POST(new Request('https://example.com/api/webhooks/stripe', {
        method: 'POST',
        headers: { 'stripe-signature': 'sig_test' },
        body: JSON.stringify({ id, type, data: { object } }),
    }) as never);
    return { res, json: await res.json() };
}

const refund = (amountRefunded: number) => deliver('charge.refunded', {
    id: 'ch_pack', payment_intent: 'pi_pack', amount: 124500, amount_refunded: amountRefunded,
    refunds: { data: [{ id: 're_1', reason: 'requested_by_customer' }] },
});
const dispute = (type: 'charge.dispute.created' | 'charge.dispute.closed', status: string) =>
    deliver(type, { id: 'dp_1', payment_intent: 'pi_pack', amount: 124500, status });

const alerts = (): string => JSON.stringify(vi.mocked(sendDiscordMessage).mock.calls);
const packWrites = () => vi.mocked(prisma.employerPostPack.updateMany).mock.calls.map(([args]) => args);

/** The pack the payment intent finds, then (for each later read by id) its status and counter. */
function packFound(current: { status: string; creditsRemaining: number } = { status: 'paid', creditsRemaining: 3 }) {
    vi.mocked(prisma.employerPostPack.findUnique).mockImplementation((async (args: { where: { stripePaymentIntentId?: string; id?: string } }) =>
        (args.where.stripePaymentIntentId ? PACK : current)) as never);
}

/** The posts standing on the pack, as the take-down and the restore read them. */
function posts(rows: unknown[]) {
    vi.mocked(prisma.employerJob.findMany).mockResolvedValue(rows as never);
    vi.mocked(prisma.employerJob.updateMany).mockResolvedValue({ count: rows.length } as never);
    vi.mocked(prisma.job.updateMany).mockResolvedValue({ count: rows.length } as never);
}

beforeAll(async () => {
    await import('@/app/api/webhooks/stripe/route');
}, 120_000);

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_x';
    vi.mocked(prisma.processedStripeEvent.create).mockResolvedValue({} as never);
    vi.mocked(prisma.jobCharge.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.employerPostPack.findUnique).mockReset().mockResolvedValue(null as never);
    vi.mocked(prisma.employerPostPack.updateMany).mockReset().mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.employerPostPack.update).mockReset().mockResolvedValue({} as never);
    posts([]);
});

afterEach(() => {
    vi.useRealTimers();
});

describe('a full refund, issued by hand in Stripe', () => {
    it("revokes the unused credits for good and takes the pack's standing posts down", async () => {
        packFound({ status: 'paid', creditsRemaining: 3 });
        posts([{ id: 'ej-1', jobId: 'job-1' }, { id: 'ej-2', jobId: 'job-2' }]);

        const { res, json } = await refund(124500);

        expect(res.status).toBe(200);
        expect(json).toEqual({ received: true, pack: 'revoked' });
        expect(prisma.employerPostPack.update).toHaveBeenCalledWith({
            where: { id: 'pack-1' },
            data: { refundedAt: NOW, refundedAmountCents: 124500, refundReason: 'requested_by_customer' },
        });
        expect(packWrites()).toContainEqual({
            where: { id: 'pack-1', status: 'paid', creditsRemaining: 3 },
            data: { status: 'refunded', creditsRemaining: 0, creditsRevoked: { increment: 3 } },
        });
        // Only posts still standing on the pack: a renewed pack post is 'paid' and stays up.
        expect(prisma.employerJob.findMany).toHaveBeenCalledWith({ where: { postPackId: 'pack-1', paymentStatus: 'pack' }, select: { id: true, jobId: true } });
        expect(prisma.employerJob.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['ej-1', 'ej-2'] }, paymentStatus: 'pack' }, data: { paymentStatus: 'refunded' } });
        expect(prisma.job.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { isPublished: false } }));
        expect(alerts()).toContain('5-post pack refunded in full');
        // No post was refunded: no refund email for a posting, no ledger write.
        expect(sendRefundConfirmationEmail).not.toHaveBeenCalled();
        expect(prisma.jobCharge.update).not.toHaveBeenCalled();
    });

    it('a refund of more than the pack price is still a full refund', async () => {
        packFound();

        const { json } = await refund(130000);

        expect(json.pack).toBe('revoked');
    });

    it('a redelivered full refund changes nothing twice', async () => {
        packFound({ status: 'refunded', creditsRemaining: 0 });

        const { res, json } = await refund(124500);

        expect(res.status).toBe(200);
        expect(json.pack).toBe('revoked');
        expect(packWrites()).toEqual([]);
        expect(prisma.employerJob.updateMany).not.toHaveBeenCalled();
    });
});

describe('a partial refund', () => {
    it('records the amount and alerts, and changes no credit and no post', async () => {
        packFound();

        const { res, json } = await refund(24900);

        expect(res.status).toBe(200);
        expect(json).toEqual({ received: true, pack: 'partial_refund' });
        expect(prisma.employerPostPack.update).toHaveBeenCalledWith({
            where: { id: 'pack-1' },
            data: { refundedAt: NOW, refundedAmountCents: 24900, refundReason: 'requested_by_customer' },
        });
        expect(packWrites()).toEqual([]);
        expect(prisma.employerJob.findMany).not.toHaveBeenCalled();
        expect(alerts()).toContain('partly refunded');
    });
});

describe('a chargeback', () => {
    it('opened: freezes the pack and takes its standing posts down', async () => {
        packFound();
        posts([{ id: 'ej-1', jobId: 'job-1' }]);

        const { res, json } = await dispute('charge.dispute.created', 'needs_response');

        expect(res.status).toBe(200);
        expect(json).toEqual({ received: true, pack: 'frozen' });
        expect(packWrites()).toContainEqual({ where: { id: 'pack-1', status: 'paid' }, data: { status: 'disputed' } });
        expect(prisma.employerJob.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['ej-1'] }, paymentStatus: 'pack' }, data: { paymentStatus: 'disputed' } });
        expect(alerts()).toContain('5-post pack disputed');
    });

    it('won: unfreezes the pack and puts back the posts the dispute took down', async () => {
        packFound({ status: 'paid', creditsRemaining: 3 });
        posts([{ id: 'ej-1', jobId: 'job-1', job: { expiresAt: new Date('2027-06-01T00:00:00.000Z'), archivedAt: null, isManuallyUnpublished: false } }]);

        const { res, json } = await dispute('charge.dispute.closed', 'won');

        expect(res.status).toBe(200);
        expect(json).toEqual({ received: true, pack: 'won' });
        expect(packWrites()).toContainEqual({ where: { id: 'pack-1', status: 'disputed' }, data: { status: 'paid' } });
        expect(prisma.employerJob.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { postPackId: 'pack-1', paymentStatus: 'disputed', jobCharges: { none: {} } },
        }));
        expect(prisma.employerJob.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['ej-1'] }, paymentStatus: 'disputed' }, data: { paymentStatus: 'pack' } });
        expect(prisma.job.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['job-1'] }, archivedAt: null }, data: { isPublished: true, contentChangedAt: NOW } });
        expect(alerts()).toContain('dispute won');
    });

    it('won after a refund: the refund stands, nothing is put back', async () => {
        packFound({ status: 'refunded', creditsRemaining: 0 });
        vi.mocked(prisma.employerPostPack.updateMany).mockResolvedValue({ count: 0 } as never);

        const { json } = await dispute('charge.dispute.closed', 'won');

        expect(json.pack).toBe('won');
        expect(prisma.employerJob.findMany).not.toHaveBeenCalled();
        expect(prisma.job.updateMany).not.toHaveBeenCalled();
        // Staff are told what happened: nothing was restored.
        expect(alerts()).toContain('5-post pack dispute won after a refund: nothing restored');
        expect(alerts()).not.toContain('credits and posts restored');
    });

    it("lost: records 'dispute_lost' and revokes the frozen credits for good", async () => {
        packFound({ status: 'disputed', creditsRemaining: 3 });

        const { res, json } = await dispute('charge.dispute.closed', 'lost');

        expect(res.status).toBe(200);
        expect(json).toEqual({ received: true, pack: 'lost' });
        expect(prisma.employerPostPack.update).toHaveBeenCalledWith({
            where: { id: 'pack-1' },
            data: { refundedAt: NOW, refundedAmountCents: 124500, refundReason: 'dispute_lost' },
        });
        expect(packWrites()).toContainEqual({
            where: { id: 'pack-1', status: 'disputed', creditsRemaining: 3 },
            data: { status: 'disputed', creditsRemaining: 0, creditsRevoked: { increment: 3 } },
        });
        expect(alerts()).toContain('dispute lost');
    });

    it('closed with any other outcome: no change', async () => {
        packFound();

        const { json } = await dispute('charge.dispute.closed', 'warning_closed');

        expect(json.pack).toBe('open');
        expect(packWrites()).toEqual([]);
        expect(prisma.employerPostPack.update).not.toHaveBeenCalled();
    });
});

describe('the JobCharge ledger comes first', () => {
    it('a payment a JobCharge matches never reaches the pack code', async () => {
        vi.mocked(prisma.jobCharge.findUnique).mockResolvedValue({ id: 'jc-1', employerJobId: null, amountCents: 34900, type: 'new' } as never);
        vi.mocked(prisma.jobCharge.update).mockResolvedValue({} as never);

        await refund(34900);

        expect(prisma.employerPostPack.findUnique).not.toHaveBeenCalled();
    });

    it('a payment neither matches is acknowledged as before', async () => {
        const { res, json } = await refund(124500);

        expect(res.status).toBe(200);
        expect(json.note).toBe('no matching JobCharge');
        expect(prisma.employerPostPack.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { stripePaymentIntentId: 'pi_pack' } }));
    });

    it('a failure in the pack code answers 500 so Stripe retries', async () => {
        vi.mocked(prisma.employerPostPack.findUnique).mockRejectedValue(new Error('db down'));

        const { res } = await refund(124500);

        expect(res.status).toBe(500);
        expect(prisma.processedStripeEvent.delete).toHaveBeenCalled();
    });
});
