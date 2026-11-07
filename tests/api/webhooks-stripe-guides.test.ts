/**
 * POST /api/webhooks/stripe: the guides store's branches
 * (app/api/webhooks/stripe/guide-checkout.ts).
 *
 *   - A guide checkout carries no jobId, so it is handled after the
 *     subscription-mode guard and the 5-post pack branch and before the
 *     job path's missing-jobId 400 (which keeps the dedupe row and would lose
 *     the sale).
 *   - A failed write or a failed delivery email answers 500 with the dedupe
 *     row rolled back (Stripe retries; fulfilment is idempotent). The GA
 *     purchase goes out once the email has, for a paid amount only.
 *   - Refunds and disputes reach the guide code only when no JobCharge and no
 *     5-post pack matches: the job ledger and the packs behave as before.
 *   - A refund or dispute of a guide payment whose purchase is not recorded
 *     yet answers 500, so Stripe retries once it is.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { sendDiscordMessage } from '@/lib/discord-notifier';

const stripeApi = vi.hoisted(() => ({ paymentIntentsRetrieve: vi.fn() }));
vi.mock('stripe', () => ({
    default: vi.fn().mockImplementation(() => ({
        webhooks: { constructEvent: vi.fn().mockImplementation((raw: string) => JSON.parse(raw)) },
        paymentIntents: { retrieve: stripeApi.paymentIntentsRetrieve },
    })),
}));
vi.mock('@/lib/email-service', () => ({
    sendRefundConfirmationEmail: vi.fn().mockResolvedValue({ success: true }),
    getOrCreateUnsubToken: vi.fn().mockResolvedValue('utok'),
}));
vi.mock('@/lib/discord-notifier', () => ({ sendDiscordMessage: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/analytics-server', () => ({ trackServerPurchase: vi.fn().mockResolvedValue({ status: 'skipped' }) }));
vi.mock('@/lib/guides/fulfill', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/guides/fulfill')>()),
    fulfillGuideSession: vi.fn(),
    revokeGuidePurchase: vi.fn(),
    isGuidePayment: vi.fn(),
    isUnrecordedGuidePayment: vi.fn(),
    restoreDisputedGuidePurchase: vi.fn(),
}));

import { trackServerPurchase } from '@/lib/analytics-server';
import {
    fulfillGuideSession,
    isGuidePayment,
    isUnrecordedGuidePayment,
    restoreDisputedGuidePurchase,
    revokeGuidePurchase,
} from '@/lib/guides/fulfill';

async function deliver(type: string, object: Record<string, unknown>, id = `evt_${type}`) {
    const { POST } = await import('@/app/api/webhooks/stripe/route');
    const res = await POST(new Request('https://example.com/api/webhooks/stripe', {
        method: 'POST',
        headers: { 'stripe-signature': 'sig_test' },
        body: JSON.stringify({ id, type, data: { object } }),
    }) as never);
    return { res, json: await res.json() };
}

const guideSession = {
    id: 'cs_test_guide',
    mode: 'payment',
    payment_status: 'paid',
    payment_intent: 'pi_g',
    amount_total: 6900,
    currency: 'usd',
    metadata: { type: 'guide', product: 'complete-library', addOn: '', userId: '', gaClientId: '1234567890.1699999999', gaSessionId: '1748000000' },
};
const PURCHASE = { id: 'gp1', productSlug: 'complete-library', amountCents: 6900, currency: 'usd' };

const alerts = (): string => JSON.stringify(vi.mocked(sendDiscordMessage).mock.calls);

beforeAll(async () => {
    await import('@/app/api/webhooks/stripe/route');
}, 120_000);

beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_x';
    vi.mocked(prisma.processedStripeEvent.create).mockResolvedValue({} as never);
    vi.mocked(prisma.processedStripeEvent.delete).mockResolvedValue({} as never);
    vi.mocked(prisma.jobCharge.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.employerPostPack.findUnique).mockReset().mockResolvedValue(null as never);
    vi.mocked(revokeGuidePurchase).mockReset().mockResolvedValue(false);
    vi.mocked(isGuidePayment).mockReset().mockResolvedValue(false);
    vi.mocked(isUnrecordedGuidePayment).mockReset().mockResolvedValue(false);
    vi.mocked(restoreDisputedGuidePurchase).mockReset().mockResolvedValue(false);
    // A payment intent that is neither a pack's nor a guide's, unless a test says otherwise.
    stripeApi.paymentIntentsRetrieve.mockReset().mockResolvedValue({ id: 'pi_x', metadata: {} });
});

describe('checkout.session.completed for a guide', () => {
    it('fulfils the purchase and sends the GA purchase, before the job path', async () => {
        vi.mocked(fulfillGuideSession).mockResolvedValueOnce({ status: 'fulfilled', purchase: PURCHASE, delivery: 'sent' } as never);
        const { res, json } = await deliver('checkout.session.completed', guideSession);
        expect(res.status).toBe(200);
        expect(json).toEqual({ received: true, guidePurchase: 'gp1' });
        expect(vi.mocked(trackServerPurchase).mock.calls[0][0]).toMatchObject({
            type: 'guide',
            amountCents: 6900,
            currency: 'usd',
            sessionId: 'cs_test_guide',
            clientId: 'gp1',
            gaClientId: '1234567890.1699999999',
            gaSessionId: '1748000000',
            itemId: 'complete-library',
            itemName: 'Complete NP Library',
        });
        expect(prisma.employerJob.findUnique).not.toHaveBeenCalled();
        expect(prisma.employerPostPack.create).not.toHaveBeenCalled();
        // Two-phase dedupe: a handled delivery keeps its row and marks it done.
        expect(prisma.processedStripeEvent.delete).not.toHaveBeenCalled();
    });

    it('is fulfilled the same way on async_payment_succeeded', async () => {
        vi.mocked(fulfillGuideSession).mockResolvedValueOnce({ status: 'fulfilled', purchase: PURCHASE, delivery: 'already' } as never);
        const { res } = await deliver('checkout.session.async_payment_succeeded', guideSession);
        expect(res.status).toBe(200);
        expect(fulfillGuideSession).toHaveBeenCalledTimes(1);
    });

    it('sends no GA purchase for a zero amount', async () => {
        vi.mocked(fulfillGuideSession).mockResolvedValueOnce({ status: 'fulfilled', purchase: { ...PURCHASE, amountCents: 0 }, delivery: 'sent' } as never);
        await deliver('checkout.session.completed', { ...guideSession, amount_total: 0 });
        expect(trackServerPurchase).not.toHaveBeenCalled();
    });

    it('defers an unsettled payment without recording anything', async () => {
        const { res, json } = await deliver('checkout.session.completed', { ...guideSession, payment_status: 'unpaid' });
        expect(res.status).toBe(200);
        expect(json).toEqual({ received: true, deferred: true });
        expect(fulfillGuideSession).not.toHaveBeenCalled();
    });

    it('asks Stripe to retry when the delivery email failed, and counts the sale only once it sends', async () => {
        vi.mocked(fulfillGuideSession).mockResolvedValueOnce({ status: 'fulfilled', purchase: PURCHASE, delivery: 'retry' } as never);
        const { res } = await deliver('checkout.session.completed', guideSession, 'evt_g4');
        expect(res.status).toBe(500);
        expect(prisma.processedStripeEvent.delete).toHaveBeenCalledWith({ where: { eventId: 'evt_g4' } });
        expect(trackServerPurchase).not.toHaveBeenCalled();
        expect(alerts()).toContain('delivery email failed');
    });

    it('does not retry an address that will never accept the email', async () => {
        vi.mocked(fulfillGuideSession).mockResolvedValueOnce({ status: 'fulfilled', purchase: PURCHASE, delivery: 'refused' } as never);
        const { res } = await deliver('checkout.session.completed', guideSession);
        expect(res.status).toBe(200);
        expect(prisma.processedStripeEvent.delete).not.toHaveBeenCalled();
    });

    it('lets Stripe retry when the write fails', async () => {
        vi.mocked(fulfillGuideSession).mockRejectedValueOnce(new Error('db down'));
        const { res } = await deliver('checkout.session.completed', guideSession, 'evt_g2');
        expect(res.status).toBe(500);
        expect(prisma.processedStripeEvent.delete).toHaveBeenCalledWith({ where: { eventId: 'evt_g2' } });
    });

    it('stops retries for a product the catalog does not have, and pages a human', async () => {
        vi.mocked(fulfillGuideSession).mockResolvedValueOnce({ status: 'invalid' });
        const { res } = await deliver('checkout.session.completed', guideSession);
        expect(res.status).toBe(400);
        expect(prisma.processedStripeEvent.delete).not.toHaveBeenCalled();
        expect(alerts()).toContain('Guide checkout paid but not fulfilled');
    });

    it('never fulfils a subscription-mode session as a guide', async () => {
        const { json } = await deliver('checkout.session.completed', { ...guideSession, mode: 'subscription' });
        expect(json).toMatchObject({ plan: 'retired' });
        expect(fulfillGuideSession).not.toHaveBeenCalled();
    });
});

describe('refunds and disputes on guide payments', () => {
    const refund = (amountRefunded: number) => deliver('charge.refunded', { id: 'ch_g', payment_intent: 'pi_g', amount_refunded: amountRefunded });
    const dispute = (type: 'charge.dispute.created' | 'charge.dispute.closed', status: string) =>
        deliver(type, { id: 'dp_g', payment_intent: 'pi_g', amount: 6900, status });

    it('a refund of a guide payment revokes it, after the job ledger and the packs found nothing', async () => {
        vi.mocked(revokeGuidePurchase).mockResolvedValueOnce(true);
        const { res, json } = await refund(6900);
        expect(res.status).toBe(200);
        expect(json).toEqual({ received: true, note: 'guide purchase refund handled' });
        expect(revokeGuidePurchase).toHaveBeenCalledWith('pi_g', 'refunded', 6900);
        expect(prisma.jobCharge.findUnique).toHaveBeenCalled();
        expect(prisma.employerPostPack.findUnique).toHaveBeenCalled();
        expect(stripeApi.paymentIntentsRetrieve).not.toHaveBeenCalled();
    });

    it('a payment a JobCharge matches never reaches the guide code', async () => {
        vi.mocked(prisma.jobCharge.findUnique).mockResolvedValueOnce({ id: 'jc-1', employerJobId: null, amountCents: 34900, type: 'new' } as never);
        vi.mocked(prisma.jobCharge.update).mockResolvedValueOnce({} as never);
        await refund(34900);
        expect(revokeGuidePurchase).not.toHaveBeenCalled();
        expect(isUnrecordedGuidePayment).not.toHaveBeenCalled();
    });

    it('a payment neither matches is acknowledged as before', async () => {
        const { res, json } = await refund(100);
        expect(res.status).toBe(200);
        expect(json.note).toBe('no matching JobCharge');
        expect(isUnrecordedGuidePayment).toHaveBeenCalledWith(expect.anything(), 'pi_g');
        expect(prisma.processedStripeEvent.delete).not.toHaveBeenCalled();
    });

    it('a pack payment not recorded yet is still retried by the pack code first', async () => {
        stripeApi.paymentIntentsRetrieve.mockResolvedValue({ id: 'pi_g', metadata: { type: 'post_pack' } });
        const { res } = await refund(124500);
        expect(res.status).toBe(500);
        expect(alerts()).toContain('before its pack was recorded');
        expect(isUnrecordedGuidePayment).not.toHaveBeenCalled();
    });

    it.each([
        ['a refund', () => refund(6900), 'evt_charge.refunded'],
        ['a dispute opened', () => dispute('charge.dispute.created', 'needs_response'), 'evt_charge.dispute.created'],
        ['a dispute closed', () => dispute('charge.dispute.closed', 'won'), 'evt_charge.dispute.closed'],
    ])('%s of a guide payment not recorded yet answers 500, so Stripe retries', async (_label, run, eventId) => {
        vi.mocked(isUnrecordedGuidePayment).mockResolvedValueOnce(true);
        const { res } = await run();
        expect(res.status).toBe(500);
        expect(prisma.processedStripeEvent.delete).toHaveBeenCalledWith({ where: { eventId } });
        expect(alerts()).toContain('before its purchase was recorded');
    });

    it('a failure reading the payment intent answers 500', async () => {
        vi.mocked(isUnrecordedGuidePayment).mockRejectedValueOnce(new Error('Stripe is down'));
        const { res } = await refund(6900);
        expect(res.status).toBe(500);
        expect(prisma.processedStripeEvent.delete).toHaveBeenCalled();
    });

    it('a chargeback freezes the guide purchase', async () => {
        vi.mocked(revokeGuidePurchase).mockResolvedValueOnce(true);
        const { res, json } = await dispute('charge.dispute.created', 'needs_response');
        expect(res.status).toBe(200);
        expect(json).toEqual({ received: true, note: 'guide purchase disputed' });
        expect(revokeGuidePurchase).toHaveBeenCalledWith('pi_g', 'disputed');
    });

    it('a won dispute restores downloads; a lost one does not', async () => {
        vi.mocked(isGuidePayment).mockResolvedValue(true);

        const lost = await dispute('charge.dispute.closed', 'lost');
        expect(lost.json).toEqual({ received: true, note: 'guide purchase dispute lost' });
        expect(restoreDisputedGuidePurchase).not.toHaveBeenCalled();

        const won = await dispute('charge.dispute.closed', 'won');
        expect(won.json).toEqual({ received: true, note: 'guide purchase restored' });
        expect(restoreDisputedGuidePurchase).toHaveBeenCalledWith('pi_g');
    });

    it('an inquiry closed without a chargeback restores downloads too', async () => {
        vi.mocked(isGuidePayment).mockResolvedValue(true);
        await dispute('charge.dispute.closed', 'warning_closed');
        expect(restoreDisputedGuidePurchase).toHaveBeenCalledWith('pi_g');
    });
});
