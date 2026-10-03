/**
 * Regression (audit) — Stripe refund/dispute entitlement handling:
 *  - A PARTIAL refund must NOT revoke entitlement (only a full refund does),
 *    otherwise the customer keeps a live job but loses invoice/receipt/republish.
 *  - A FULL refund flips paymentStatus='refunded' and unpublishes.
 *  - A chargeback (charge.dispute.created) — which never emits charge.refunded —
 *    must revoke: unpublish + paymentStatus='disputed'.
 *  - A WON dispute (charge.dispute.closed) restores 'paid' and re-publishes a
 *    still-unexpired posting; a LOST one is recorded on the ledger.
 *  - A renewal paid on a refunded/disputed posting never re-publishes it
 *    (pre-check AND the conditional write inside the transaction), is
 *    ledgered for the refund, alerted, and acknowledged without a retry.
 *  - The same holds for a posting that was never paid for ('pending', or
 *    'expired' after the reconciliation sweep retired the abandoned
 *    checkout): a $179 renewal must not publish a post nobody paid for.
 *  - A full refund takes the posting down only when no other payment for it
 *    stands. The alerts "Two paid renewals for one posting, refund required"
 *    and "second payment for one posting" ask the operator for exactly that
 *    refund, and it used to revoke the posting the employer had paid for
 *    twice. A renewal that was never applied (renewal cap, revoked posting)
 *    is refunded without touching the posting either.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { sendDiscordMessage } from '@/lib/discord-notifier';
import { sendRefundConfirmationEmail, sendRenewalConfirmationEmail } from '@/lib/email-service';

vi.mock('stripe', () => ({
    default: vi.fn().mockImplementation(() => ({
        webhooks: { constructEvent: vi.fn().mockImplementation((raw: string) => JSON.parse(raw)) },
    })),
}));
vi.mock('@/lib/email-service', () => ({
    sendRenewalConfirmationEmail: vi.fn().mockResolvedValue(undefined),
    sendRefundConfirmationEmail: vi.fn().mockResolvedValue(undefined),
    getOrCreateUnsubToken: vi.fn().mockResolvedValue('utok'),
    sendPlanActivatedEmail: vi.fn().mockResolvedValue({ success: true }),
    sendPlanPausedEmail: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('@/lib/search-indexing', () => ({ pingAllSearchEngines: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/analytics-server', () => ({ trackServerPurchase: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/discord-notifier', () => ({ sendDiscordMessage: vi.fn().mockResolvedValue(true) }));

function makeRequest(body: object): Request {
    return new Request('https://example.com/api/webhooks/stripe', {
        method: 'POST',
        headers: { 'stripe-signature': 'sig_test' },
        body: JSON.stringify(body),
    });
}

const AMOUNT = 19900;

// Load the webhook route graph once, outside any single test's time budget (a
// cold import under a loaded full suite run can outlast vitest's 5 second default).
beforeAll(async () => {
    await import('@/app/api/webhooks/stripe/route');
}, 60_000);

beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_x';
    vi.mocked(prisma.processedStripeEvent.create).mockResolvedValue({} as never);
    vi.mocked(prisma.jobCharge.findUnique).mockResolvedValue({ id: 'jc1', employerJobId: 'ej1', amountCents: AMOUNT } as never);
    vi.mocked(prisma.jobCharge.update).mockResolvedValue({} as never);
    // The posting's only payment, unless a test says otherwise.
    vi.mocked(prisma.jobCharge.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.employerJob.findUnique).mockResolvedValue({ id: 'ej1', jobId: 'job1', contactEmail: 'e@x.com', job: { id: 'job1', title: 'PMHNP' } } as never);
    vi.mocked(prisma.employerJob.update).mockResolvedValue({} as never);
    vi.mocked(prisma.job.update).mockResolvedValue({} as never);
});

describe('Stripe webhook — refund/dispute entitlement', () => {
    it('PARTIAL refund keeps entitlement (no status flip, no unpublish)', async () => {
        const { POST } = await import('@/app/api/webhooks/stripe/route');
        const res = await POST(makeRequest({
            id: 'evt_pr', type: 'charge.refunded',
            data: { object: { id: 'ch1', payment_intent: 'pi1', amount_refunded: 5000, refunds: { data: [{ reason: 'requested_by_customer' }] } } },
        }) as never);

        expect(res.status).toBe(200);
        expect(prisma.jobCharge.update).toHaveBeenCalled(); // ledger still records the partial refund
        // Entitlement preserved: status not flipped, job not unpublished.
        expect(prisma.employerJob.update).not.toHaveBeenCalled();
        expect(prisma.job.update).not.toHaveBeenCalled();
    });

    it('FULL refund revokes entitlement (status refunded + unpublish)', async () => {
        const { POST } = await import('@/app/api/webhooks/stripe/route');
        const res = await POST(makeRequest({
            id: 'evt_fr', type: 'charge.refunded',
            data: { object: { id: 'ch2', payment_intent: 'pi1', amount_refunded: AMOUNT, refunds: { data: [{ reason: 'requested_by_customer' }] } } },
        }) as never);

        expect(res.status).toBe(200);
        expect(prisma.employerJob.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ paymentStatus: 'refunded' }) }),
        );
        expect(prisma.job.update).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 'job1' }, data: { isPublished: false } }),
        );
    });

    it('chargeback (dispute.created) revokes: unpublish + disputed', async () => {
        const { POST } = await import('@/app/api/webhooks/stripe/route');
        const res = await POST(makeRequest({
            id: 'evt_dp', type: 'charge.dispute.created',
            data: { object: { id: 'dp1', payment_intent: 'pi1', amount: AMOUNT } },
        }) as never);

        expect(res.status).toBe(200);
        expect(prisma.employerJob.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: { paymentStatus: 'disputed' } }),
        );
        expect(prisma.job.update).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 'job1' }, data: { isPublished: false } }),
        );
    });
});

describe('Stripe webhook — a full refund takes the posting down only when no other payment for it stands', () => {
    const RENEWAL = 17900;
    const POST_FEE = 29900;

    /** The refunded ledger row, as charge.refunded finds it by payment intent. */
    function refundedCharge(type: 'renewal' | 'new', amountCents: number) {
        vi.mocked(prisma.jobCharge.findUnique).mockResolvedValue({ id: 'jc2', employerJobId: 'ej1', amountCents, type } as never);
    }

    /** The posting's other ledger rows. */
    function otherCharges(rows: Array<{ type: string; amountCents: number; refundedAmountCents: number | null }>) {
        vi.mocked(prisma.jobCharge.findMany).mockResolvedValue(rows as never);
    }

    function posting(paymentStatus: string) {
        vi.mocked(prisma.employerJob.findUnique).mockResolvedValue({
            id: 'ej1', jobId: 'job1', paymentStatus, contactEmail: 'e@x.com', job: { id: 'job1', title: 'Nurse Practitioner' },
        } as never);
    }

    async function refundInFull(eventId: string, amountCents: number) {
        const { POST } = await import('@/app/api/webhooks/stripe/route');
        return POST(makeRequest({
            id: eventId, type: 'charge.refunded',
            data: { object: { id: 'ch_dup', payment_intent: 'pi_dup', amount_refunded: amountCents, refunds: { data: [{ id: `re_${eventId}`, reason: 'duplicate' }] } } },
        }) as never);
    }

    function expectPostingKept() {
        expect(prisma.employerJob.update).not.toHaveBeenCalled();
        expect(prisma.job.update).not.toHaveBeenCalled();
    }

    function expectPostingRevoked() {
        expect(prisma.employerJob.update).toHaveBeenCalledWith({ where: { id: 'ej1' }, data: { paymentStatus: 'refunded' } });
        expect(prisma.job.update).toHaveBeenCalledWith({ where: { id: 'job1' }, data: { isPublished: false } });
    }

    it('one of two paid renewals refunded in full: the refund is recorded, and the posting stays live and paid', async () => {
        refundedCharge('renewal', RENEWAL);
        otherCharges([{ type: 'renewal', amountCents: RENEWAL, refundedAmountCents: null }]);
        posting('paid');

        const res = await refundInFull('evt_dup_renewal', RENEWAL);

        expect(res.status).toBe(200);
        // The ledger records the refund, and the employer is told about it...
        expect(prisma.jobCharge.update).toHaveBeenCalledWith({
            where: { id: 'jc2' },
            data: expect.objectContaining({ refundedAmountCents: RENEWAL, refundReason: 'duplicate' }),
        });
        expect(sendRefundConfirmationEmail).toHaveBeenCalledWith('e@x.com', 'Nurse Practitioner', RENEWAL, false, 'utok');
        // ...but the posting they paid for twice is not taken down.
        expectPostingKept();
        expect(prisma.jobCharge.findMany).toHaveBeenCalledWith({
            where: { employerJobId: 'ej1', id: { not: 'jc2' } },
            select: { type: true, amountCents: true, refundedAmountCents: true },
        });
    });

    it('a refunded renewal keeps the posting while its post fee stands', async () => {
        refundedCharge('renewal', RENEWAL);
        otherCharges([{ type: 'new', amountCents: POST_FEE, refundedAmountCents: null }]);
        posting('paid');

        await refundInFull('evt_renewal_with_post_fee', RENEWAL);

        expectPostingKept();
    });

    it('a partly refunded payment still stands', async () => {
        refundedCharge('renewal', RENEWAL);
        otherCharges([{ type: 'renewal', amountCents: RENEWAL, refundedAmountCents: 5000 }]);
        posting('paid');

        await refundInFull('evt_other_partly_refunded', RENEWAL);

        expectPostingKept();
    });

    it("the posting's last standing payment refunded in full: revoked as before", async () => {
        refundedCharge('renewal', RENEWAL);
        otherCharges([{ type: 'renewal', amountCents: RENEWAL, refundedAmountCents: RENEWAL }]);
        posting('paid');

        const res = await refundInFull('evt_both_refunded', RENEWAL);

        expect(res.status).toBe(200);
        expectPostingRevoked();
    });

    it('a renewed promo post whose only renewal is refunded is revoked as before', async () => {
        refundedCharge('renewal', RENEWAL);
        otherCharges([]);
        posting('paid');

        await refundInFull('evt_only_renewal', RENEWAL);

        expectPostingRevoked();
    });

    it.each(['promo', 'disputed', 'pending', 'expired', 'refunded'])(
        "a refunded renewal that was never applied (posting still '%s') leaves the posting exactly as it is",
        async (status) => {
            // An applied renewal always leaves the posting 'paid'. This one was
            // ledgered for a refund instead: the renewal cap, or a revoked posting.
            refundedCharge('renewal', RENEWAL);
            otherCharges([]);
            posting(status);

            const res = await refundInFull(`evt_unapplied_${status}`, RENEWAL);

            expect(res.status).toBe(200);
            expect(prisma.jobCharge.update).toHaveBeenCalled();
            expectPostingKept();
        },
    );

    it('a post fee refunded in full still revokes the posting when only renewals stand', async () => {
        refundedCharge('new', POST_FEE);
        otherCharges([{ type: 'renewal', amountCents: RENEWAL, refundedAmountCents: null }]);
        posting('paid');

        await refundInFull('evt_post_fee', POST_FEE);

        expectPostingRevoked();
    });

    it('a post fee paid twice: refunding one of the two keeps the posting', async () => {
        refundedCharge('new', POST_FEE);
        otherCharges([{ type: 'new', amountCents: POST_FEE, refundedAmountCents: null }]);
        posting('paid');

        await refundInFull('evt_dup_post_fee', POST_FEE);

        expectPostingKept();
    });
});

describe('Stripe webhook — charge.dispute.closed', () => {
    it('WON: restores paid on a still-disputed posting and re-publishes it while its window is open', async () => {
        vi.mocked(prisma.employerJob.findUnique).mockResolvedValue({ id: 'ej1', jobId: 'job1' } as never);
        vi.mocked(prisma.employerJob.updateMany).mockResolvedValue({ count: 1 } as never);
        vi.mocked(prisma.job.findUnique).mockResolvedValue({ expiresAt: new Date(Date.now() + 86_400_000), archivedAt: null } as never);

        const { POST } = await import('@/app/api/webhooks/stripe/route');
        const res = await POST(makeRequest({
            id: 'evt_won', type: 'charge.dispute.closed',
            data: { object: { id: 'dp1', payment_intent: 'pi1', amount: AMOUNT, status: 'won' } },
        }) as never);

        expect(res.status).toBe(200);
        expect(prisma.employerJob.updateMany).toHaveBeenCalledWith({
            where: { id: 'ej1', paymentStatus: 'disputed' },
            data: { paymentStatus: 'paid' },
        });
        // A revival stamps contentChangedAt (indexing audit fixSoon 5).
        expect(prisma.job.update).toHaveBeenCalledWith({
            where: { id: 'job1' },
            data: { isPublished: true, contentChangedAt: expect.any(Date) },
        });
    });

    it('WON: restores paid but does not re-publish an expired posting', async () => {
        vi.mocked(prisma.employerJob.findUnique).mockResolvedValue({ id: 'ej1', jobId: 'job1' } as never);
        vi.mocked(prisma.employerJob.updateMany).mockResolvedValue({ count: 1 } as never);
        vi.mocked(prisma.job.findUnique).mockResolvedValue({ expiresAt: new Date(Date.now() - 86_400_000), archivedAt: null } as never);

        const { POST } = await import('@/app/api/webhooks/stripe/route');
        await POST(makeRequest({
            id: 'evt_won_exp', type: 'charge.dispute.closed',
            data: { object: { id: 'dp1', payment_intent: 'pi1', amount: AMOUNT, status: 'won' } },
        }) as never);

        expect(prisma.employerJob.updateMany).toHaveBeenCalled();
        expect(prisma.job.update).not.toHaveBeenCalled();
    });

    it('WON: a posting that is no longer disputed (e.g. refunded since) is left alone', async () => {
        vi.mocked(prisma.employerJob.findUnique).mockResolvedValue({ id: 'ej1', jobId: 'job1' } as never);
        vi.mocked(prisma.employerJob.updateMany).mockResolvedValue({ count: 0 } as never);

        const { POST } = await import('@/app/api/webhooks/stripe/route');
        await POST(makeRequest({
            id: 'evt_won_ref', type: 'charge.dispute.closed',
            data: { object: { id: 'dp1', payment_intent: 'pi1', amount: AMOUNT, status: 'won' } },
        }) as never);

        expect(prisma.job.update).not.toHaveBeenCalled();
    });

    it('LOST: records the lost funds on the ledger and keeps the posting revoked', async () => {
        const { POST } = await import('@/app/api/webhooks/stripe/route');
        const res = await POST(makeRequest({
            id: 'evt_lost', type: 'charge.dispute.closed',
            data: { object: { id: 'dp1', payment_intent: 'pi1', amount: AMOUNT, status: 'lost' } },
        }) as never);

        expect(res.status).toBe(200);
        expect(prisma.jobCharge.update).toHaveBeenCalledWith({
            where: { id: 'jc1' },
            data: expect.objectContaining({ refundedAmountCents: AMOUNT, refundReason: 'dispute_lost' }),
        });
        expect(prisma.employerJob.updateMany).not.toHaveBeenCalled();
        expect(prisma.job.update).not.toHaveBeenCalled();
    });
});

describe('Stripe webhook — renewal can never re-publish a refunded or disputed posting', () => {
    function renewalEvent(id = 'evt_ren') {
        return {
            id, type: 'checkout.session.completed',
            data: { object: { id: 'cs_ren', payment_status: 'paid', payment_intent: 'pi_ren', amount_total: 17900, currency: 'usd', metadata: { jobId: 'job1', type: 'renewal', tier: 'pro' } } },
        };
    }

    beforeEach(() => {
        vi.mocked(prisma.jobCharge.create).mockResolvedValue({} as never);
        vi.mocked(prisma.job.findUnique).mockResolvedValue({ expiresAt: new Date(Date.now() + 5 * 86_400_000), createdAt: new Date(Date.now() - 30 * 86_400_000), title: 'PMHNP', slug: 'pmhnp-job1' } as never);
        vi.mocked(prisma.emailSend.create).mockResolvedValue({} as never);
        vi.mocked(prisma.emailLead.findUnique).mockResolvedValue({ unsubscribeToken: 'utok' } as never);
        // Interactive transaction: run the callback against the mocked client.
        vi.mocked(prisma.$transaction).mockImplementation(((fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma)) as never);
    });

    it.each(['refunded', 'disputed'])("a renewal paid on a '%s' posting is ledgered, alerted and acknowledged — nothing re-published", async (status) => {
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({ id: 'ej1', jobId: 'job1', paymentStatus: status, contactEmail: 'e@x.com', dashboardToken: 'tok' } as never);

        const { POST } = await import('@/app/api/webhooks/stripe/route');
        const res = await POST(makeRequest(renewalEvent(`evt_ren_${status}`)) as never);
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json.note).toMatch(/revoked posting/);
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(prisma.job.update).not.toHaveBeenCalled();
        expect(prisma.employerJob.update).not.toHaveBeenCalled();
        expect(prisma.employerJob.updateMany).not.toHaveBeenCalled();
        // The money is still on the ledger so the refund can be issued and matched.
        expect(prisma.jobCharge.create).toHaveBeenCalledWith({ data: expect.objectContaining({ stripeSessionId: 'cs_ren', type: 'renewal', employerJobId: 'ej1' }) });
        expect(JSON.stringify(vi.mocked(sendDiscordMessage).mock.calls)).toContain('Renewal paid on revoked posting');
        // Dedupe kept — Stripe must not retry.
        expect(prisma.processedStripeEvent.delete).not.toHaveBeenCalled();
    });

    it.each(['pending', 'expired'])("a renewal paid on a never-paid '%s' posting is refused the same way — ledgered, alerted, nothing published", async (status) => {
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({ id: 'ej1', jobId: 'job1', paymentStatus: status, contactEmail: 'e@x.com', dashboardToken: 'tok' } as never);

        const { POST } = await import('@/app/api/webhooks/stripe/route');
        const res = await POST(makeRequest(renewalEvent(`evt_ren_${status}`)) as never);
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json.note).toMatch(/revoked posting/);
        expect(prisma.$transaction).not.toHaveBeenCalled();
        // Never flipped to 'paid', never published, never extended.
        expect(prisma.employerJob.update).not.toHaveBeenCalled();
        expect(prisma.employerJob.updateMany).not.toHaveBeenCalled();
        expect(prisma.job.update).not.toHaveBeenCalled();
        expect(sendRenewalConfirmationEmail).not.toHaveBeenCalled();
        expect(prisma.jobCharge.create).toHaveBeenCalledWith({ data: expect.objectContaining({ stripeSessionId: 'cs_ren', type: 'renewal', employerJobId: 'ej1' }) });
        const alerts = JSON.stringify(vi.mocked(sendDiscordMessage).mock.calls);
        expect(alerts).toContain('Renewal paid on revoked posting');
        expect(alerts).toContain(`status=${status}`);
        expect(prisma.processedStripeEvent.delete).not.toHaveBeenCalled();
    });

    it('closes the race: a refund that lands mid-checkout makes the conditional write match nothing and the transaction roll back', async () => {
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({ id: 'ej1', jobId: 'job1', paymentStatus: 'paid', contactEmail: 'e@x.com', dashboardToken: 'tok' } as never);
        vi.mocked(prisma.employerJob.updateMany).mockResolvedValue({ count: 0 } as never); // refunded in between
        vi.mocked(prisma.employerJob.findUnique).mockResolvedValue({ paymentStatus: 'refunded' } as never);

        const { POST } = await import('@/app/api/webhooks/stripe/route');
        const res = await POST(makeRequest(renewalEvent('evt_ren_race')) as never);

        expect(res.status).toBe(200);
        // The in-transaction guard refuses exactly the pre-check's states.
        expect(prisma.employerJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'ej1', paymentStatus: { notIn: ['refunded', 'disputed', 'pending', 'expired'] } },
        }));
        // The job write comes AFTER the guard inside the transaction — never reached.
        expect(prisma.job.update).not.toHaveBeenCalled();
        expect(JSON.stringify(vi.mocked(sendDiscordMessage).mock.calls)).toContain('Renewal paid on revoked posting');
    });

    it('a normal renewal writes the ledger row FIRST, then the guarded status write, then extends the job', async () => {
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({ id: 'ej1', jobId: 'job1', paymentStatus: 'paid', contactEmail: 'e@x.com', dashboardToken: 'tok' } as never);
        vi.mocked(prisma.employerJob.updateMany).mockResolvedValue({ count: 1 } as never);

        const { POST } = await import('@/app/api/webhooks/stripe/route');
        const res = await POST(makeRequest(renewalEvent('evt_ren_ok')) as never);

        expect(res.status).toBe(200);
        const chargeOrder = vi.mocked(prisma.jobCharge.create).mock.invocationCallOrder[0];
        const guardOrder = vi.mocked(prisma.employerJob.updateMany).mock.invocationCallOrder[0];
        const jobOrder = vi.mocked(prisma.job.update).mock.invocationCallOrder[0];
        expect(chargeOrder).toBeLessThan(guardOrder);
        expect(guardOrder).toBeLessThan(jobOrder);
        expect(prisma.employerJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: { paymentStatus: 'paid', pricingTier: 'pro', expiryWarningSentAt: null },
        }));
        expect(prisma.job.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'job1' }, data: expect.objectContaining({ isPublished: true }) }));
        expect(sendRenewalConfirmationEmail).toHaveBeenCalledOnce();
    });

    it('a second path on the same session hits the unique ledger row and never extends the expiry twice', async () => {
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({ id: 'ej1', jobId: 'job1', paymentStatus: 'paid', contactEmail: 'e@x.com', dashboardToken: 'tok' } as never);
        vi.mocked(prisma.jobCharge.create).mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
        vi.mocked(prisma.emailSend.create).mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));

        const { POST } = await import('@/app/api/webhooks/stripe/route');
        const res = await POST(makeRequest(renewalEvent('evt_ren_dup')) as never);

        expect(res.status).toBe(200);
        expect(prisma.employerJob.updateMany).not.toHaveBeenCalled();
        expect(prisma.job.update).not.toHaveBeenCalled();
        expect(sendRenewalConfirmationEmail).not.toHaveBeenCalled();
    });
});
