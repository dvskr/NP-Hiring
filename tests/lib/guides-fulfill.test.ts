/**
 * Guide fulfilment runs from the Stripe webhook and from the success page,
 * whichever arrives first, so it must be safe to run twice: one purchase per
 * Checkout session and one delivery email per purchase, sent by the webhook
 * only (the success page passes sendEmail: false). Refunds and
 * chargebacks take access back; a partial refund or a won dispute does not.
 *
 * During the launch promo a claim (fulfillPromoClaim) records a 'promo' row:
 * no amount, no Stripe ids, the product's own guides and never the add-on.
 * A claim the same email already holds is re-used, its email re-sent at most
 * once per ten minutes; claims for one address run under a transaction lock,
 * so two at the same instant make one row.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/guides/email', () => ({ sendGuidePurchaseEmail: vi.fn() }));

import { sendGuidePurchaseEmail } from '@/lib/guides/email';
import { BUNDLES, GUIDES } from '@/lib/guides/catalog';
import {
    ADD_ON_METADATA_VALUE,
    GUIDE_CHECKOUT_TYPE,
    PROMO_RESEND_INTERVAL_MS,
    claimLockKey,
    emailDelivered,
    fulfillGuideSession,
    fulfillPromoClaim,
    isGuidePayment,
    isUnrecordedGuidePayment,
    restoreDisputedGuidePurchase,
    revokeGuidePurchase,
} from '@/lib/guides/fulfill';

const gp = prisma.guidePurchase as unknown as Record<string, ReturnType<typeof vi.fn>>;

function session(overrides: Partial<Stripe.Checkout.Session> = {}): Stripe.Checkout.Session {
    return {
        id: 'cs_test_abc',
        payment_status: 'paid',
        payment_intent: 'pi_1',
        amount_total: 1900,
        currency: 'usd',
        customer_details: { email: '  Buyer@Example.COM ' },
        metadata: { type: 'guide', product: 'interview-prep-pack', addOn: '', userId: '' },
        ...overrides,
    } as unknown as Stripe.Checkout.Session;
}

const PURCHASE = {
    id: 'gp_1',
    source: 'stripe',
    email: 'buyer@example.com',
    accessToken: 'a'.repeat(48),
    productSlug: 'interview-prep-pack',
    guideSlugs: ['interview-prep-pack'],
    amountCents: 1900,
    emailSentAt: null,
};

beforeEach(() => {
    vi.clearAllMocks();
    gp.upsert.mockReset().mockResolvedValue(PURCHASE);
    gp.updateMany.mockReset().mockResolvedValue({ count: 1 });
    gp.findUnique.mockReset().mockResolvedValue(null);
    gp.findFirst.mockReset().mockResolvedValue(null);
    gp.count.mockReset().mockResolvedValue(0);
    gp.create.mockReset();
    gp.update.mockReset();
    vi.mocked(sendGuidePurchaseEmail).mockReset().mockResolvedValue('sent');
    executeRaw.mockReset().mockResolvedValue(1);
    vi.mocked(prisma.$transaction).mockImplementation(((arg: unknown) =>
        typeof arg === 'function'
            ? (arg as (tx: unknown) => Promise<unknown>)({ $executeRaw: executeRaw, guidePurchase: prisma.guidePurchase })
            : Promise.all(arg as Promise<unknown>[])) as never);
});

/** The transaction lock statement a new promo claim runs first. */
const executeRaw = vi.fn();

describe('the metadata the checkout and the webhook share', () => {
    it('tags a guide checkout and its add-on', () => {
        expect(GUIDE_CHECKOUT_TYPE).toBe('guide');
        expect(ADD_ON_METADATA_VALUE).toBe('compensation-report');
    });
});

describe('fulfillGuideSession', () => {
    it('ignores sessions that are not guide checkouts or not paid', async () => {
        expect(await fulfillGuideSession(session({ metadata: { type: 'post_pack' } }))).toEqual({ status: 'not-guide' });
        expect(await fulfillGuideSession(session({ payment_status: 'unpaid' }))).toEqual({ status: 'unpaid' });
        expect(gp.upsert).not.toHaveBeenCalled();
    });

    it('refuses a product the catalog does not have', async () => {
        const result = await fulfillGuideSession(session({ metadata: { type: 'guide', product: 'mystery-guide' } }));
        expect(result).toEqual({ status: 'invalid' });
        expect(gp.upsert).not.toHaveBeenCalled();
    });

    it('records a Stripe purchase once per session, with the amount Stripe charged', async () => {
        const result = await fulfillGuideSession(session());
        expect(result.status).toBe('fulfilled');
        const call = gp.upsert.mock.calls[0][0];
        expect(call.where).toEqual({ stripeSessionId: 'cs_test_abc' });
        expect(call.update).toEqual({});
        expect(call.create).toMatchObject({
            source: 'stripe',
            stripeSessionId: 'cs_test_abc',
            stripePaymentIntentId: 'pi_1',
            email: 'buyer@example.com',
            userId: null,
            productSlug: 'interview-prep-pack',
            guideSlugs: ['interview-prep-pack'],
            amountCents: 1900,
        });
        expect(call.create.accessToken).toMatch(/^[0-9a-f]{48}$/);
    });

    it('keeps the signed-in buyer\'s user id and an expanded payment intent', async () => {
        await fulfillGuideSession(session({
            payment_intent: { id: 'pi_expanded' } as Stripe.PaymentIntent,
            metadata: { type: 'guide', product: 'career-bundle', addOn: '', userId: 'user-1' },
        }));
        expect(gp.upsert.mock.calls[0][0].create).toMatchObject({
            stripePaymentIntentId: 'pi_expanded',
            userId: 'user-1',
            guideSlugs: [...BUNDLES['career-bundle'].guides],
        });
    });

    it('unlocks the add-on guide when it was bought', async () => {
        await fulfillGuideSession(session({ metadata: { type: 'guide', product: 'interview-prep-pack', addOn: 'compensation-report' } }));
        expect(gp.upsert.mock.calls[0][0].create.guideSlugs).toEqual(['interview-prep-pack', 'compensation-report']);
    });

    it('finds the winning row when two callers create the same session at once', async () => {
        gp.upsert.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }));
        gp.findUnique.mockResolvedValueOnce(PURCHASE);
        const result = await fulfillGuideSession(session());
        expect(result).toMatchObject({ status: 'fulfilled', purchase: PURCHASE });
        expect(gp.findUnique).toHaveBeenCalledWith({ where: { stripeSessionId: 'cs_test_abc' } });
    });

    it('rethrows any other write failure, so the webhook asks Stripe to retry', async () => {
        gp.upsert.mockRejectedValueOnce(new Error('db down'));
        await expect(fulfillGuideSession(session())).rejects.toThrow('db down');
    });

    it('sends the delivery email only to the caller that claims it', async () => {
        expect(await fulfillGuideSession(session())).toMatchObject({ delivery: 'sent' });
        expect(sendGuidePurchaseEmail).toHaveBeenCalledTimes(1);
        expect(gp.updateMany).toHaveBeenCalledWith({ where: { id: 'gp_1', accessToken: PURCHASE.accessToken, emailSentAt: null }, data: { emailSentAt: expect.any(Date) } });

        gp.updateMany.mockResolvedValueOnce({ count: 0 });
        expect(await fulfillGuideSession(session())).toMatchObject({ delivery: 'already' });
        expect(sendGuidePurchaseEmail).toHaveBeenCalledTimes(1);
    });

    it('does not claim again once the email has gone out', async () => {
        gp.upsert.mockResolvedValueOnce({ ...PURCHASE, emailSentAt: new Date() });
        expect(await fulfillGuideSession(session())).toMatchObject({ delivery: 'already' });
        expect(gp.updateMany).not.toHaveBeenCalled();
    });

    it('releases the claim when the email fails, and reports it for a retry', async () => {
        vi.mocked(sendGuidePurchaseEmail).mockResolvedValueOnce('retry');
        expect(await fulfillGuideSession(session())).toMatchObject({ status: 'fulfilled', delivery: 'retry' });
        expect(gp.updateMany).toHaveBeenLastCalledWith({ where: { id: 'gp_1', accessToken: PURCHASE.accessToken }, data: { emailSentAt: null } });
    });

    it('reports a permanently refused address without asking for a retry', async () => {
        vi.mocked(sendGuidePurchaseEmail).mockResolvedValueOnce('refused');
        expect(await fulfillGuideSession(session())).toMatchObject({ delivery: 'refused' });
    });

    it('still fulfils when the email claim throws, and asks for a retry', async () => {
        gp.updateMany.mockRejectedValueOnce(new Error('db blip'));
        expect(await fulfillGuideSession(session())).toMatchObject({ status: 'fulfilled', delivery: 'retry' });
    });

    it('sends nothing when Stripe has no email for the buyer', async () => {
        gp.upsert.mockResolvedValueOnce({ ...PURCHASE, email: null });
        expect(await fulfillGuideSession(session({ customer_details: null }))).toMatchObject({ delivery: 'no-address' });
        expect(gp.updateMany).not.toHaveBeenCalled();
        expect(sendGuidePurchaseEmail).not.toHaveBeenCalled();
    });

    it('tells the success page the link is in the inbox only when it is', () => {
        expect(emailDelivered('sent')).toBe(true);
        expect(emailDelivered('already')).toBe(true);
        for (const outcome of ['retry', 'refused', 'no-address', 'pending'] as const) expect(emailDelivered(outcome)).toBe(false);
    });

    it('records the purchase for the success page without sending, leaving the email to the webhook', async () => {
        const pending = await fulfillGuideSession(session(), { sendEmail: false });
        expect(pending).toMatchObject({ status: 'fulfilled', delivery: 'pending' });
        expect(gp.upsert).toHaveBeenCalledTimes(1);
        expect(gp.updateMany).not.toHaveBeenCalled();
        expect(sendGuidePurchaseEmail).not.toHaveBeenCalled();

        gp.upsert.mockResolvedValueOnce({ ...PURCHASE, emailSentAt: new Date() });
        expect(await fulfillGuideSession(session(), { sendEmail: false })).toMatchObject({ delivery: 'already' });
        expect(sendGuidePurchaseEmail).not.toHaveBeenCalled();
    });
});

describe('fulfillPromoClaim', () => {
    const NOW = new Date('2026-11-20T12:00:00.000Z');
    const CLAIM = {
        id: 'gp_promo',
        source: 'promo',
        email: 'np@example.com',
        accessToken: 'b'.repeat(48),
        productSlug: 'career-bundle',
        guideSlugs: [...BUNDLES['career-bundle'].guides],
        amountCents: 0,
        emailSentAt: null,
    };

    it('records a promo row with no amount, no Stripe ids and the product\'s own guides', async () => {
        gp.create.mockResolvedValueOnce(CLAIM);
        const result = await fulfillPromoClaim(BUNDLES['career-bundle'], 'np@example.com', 'user-9', NOW);
        expect(result).toMatchObject({ reused: false, delivery: 'sent', purchase: CLAIM });
        const data = gp.create.mock.calls[0][0].data;
        expect(data).toMatchObject({
            source: 'promo',
            amountCents: 0,
            stripeSessionId: null,
            stripePaymentIntentId: null,
            email: 'np@example.com',
            userId: 'user-9',
            productSlug: 'career-bundle',
            guideSlugs: [...BUNDLES['career-bundle'].guides],
        });
        expect(data.accessToken).toMatch(/^[0-9a-f]{48}$/);
        expect(sendGuidePurchaseEmail).toHaveBeenCalledWith(CLAIM);
    });

    it('creates a claim only under a transaction lock on the address, after looking again', async () => {
        gp.create.mockResolvedValueOnce(CLAIM);
        await fulfillPromoClaim(BUNDLES['career-bundle'], 'np@example.com', null, NOW, null);
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(executeRaw.mock.calls[0][1]).toBe(claimLockKey('np@example.com'));
        expect(claimLockKey('np@example.com')).toBe('guide-claim:np@example.com');
        expect(gp.findFirst).toHaveBeenCalledTimes(1);
        expect(executeRaw.mock.invocationCallOrder[0]).toBeLessThan(gp.findFirst.mock.invocationCallOrder[0]);
        expect(gp.findFirst.mock.invocationCallOrder[0]).toBeLessThan(gp.create.mock.invocationCallOrder[0]);
    });

    it('re-uses a claim a concurrent request created, found under the lock, and sends one email', async () => {
        const created = { ...CLAIM, emailSentAt: new Date(NOW.getTime() - 1000) };
        gp.findFirst.mockResolvedValueOnce(created);
        gp.updateMany.mockResolvedValueOnce({ count: 0 });
        const result = await fulfillPromoClaim(BUNDLES['career-bundle'], 'np@example.com', null, NOW, null);
        expect(result).toMatchObject({ reused: true, delivery: 'already', purchase: created });
        expect(gp.create).not.toHaveBeenCalled();
        expect(sendGuidePurchaseEmail).not.toHaveBeenCalled();
    });

    it('never adds the checkout add-on to a claim', async () => {
        gp.create.mockResolvedValueOnce({ ...CLAIM, productSlug: 'interview-prep-pack', guideSlugs: ['interview-prep-pack'] });
        await fulfillPromoClaim(GUIDES['interview-prep-pack'], 'np@example.com', null, NOW);
        expect(gp.create.mock.calls[0][0].data.guideSlugs).toEqual(['interview-prep-pack']);
    });

    it('looks for an earlier claim by this email that holds every guide of the product', async () => {
        gp.create.mockResolvedValueOnce(CLAIM);
        await fulfillPromoClaim(BUNDLES['career-bundle'], 'np@example.com', null, NOW);
        expect(gp.findFirst).toHaveBeenCalledWith({
            where: { source: 'promo', email: 'np@example.com', guideSlugs: { hasEvery: [...BUNDLES['career-bundle'].guides] } },
            orderBy: { createdAt: 'desc' },
        });
    });

    it('re-uses that claim instead of creating another, and re-sends its email', async () => {
        const earlier = { ...CLAIM, emailSentAt: new Date(NOW.getTime() - PROMO_RESEND_INTERVAL_MS - 1) };
        gp.findFirst.mockResolvedValueOnce(earlier);
        const result = await fulfillPromoClaim(GUIDES['interview-prep-pack'], 'np@example.com', null, NOW);
        expect(result).toMatchObject({ reused: true, delivery: 'sent', purchase: earlier });
        expect(gp.create).not.toHaveBeenCalled();
        expect(gp.updateMany).toHaveBeenCalledWith({
            where: { id: 'gp_promo', accessToken: CLAIM.accessToken, OR: [{ emailSentAt: null }, { emailSentAt: { lt: new Date(NOW.getTime() - PROMO_RESEND_INTERVAL_MS) } }] },
            data: { emailSentAt: NOW },
        });
        expect(sendGuidePurchaseEmail).toHaveBeenCalledWith(earlier);
    });

    it('re-sends at most once per ten minutes', async () => {
        expect(PROMO_RESEND_INTERVAL_MS).toBe(10 * 60 * 1000);
        gp.findFirst.mockResolvedValueOnce({ ...CLAIM, emailSentAt: new Date(NOW.getTime() - 60_000) });
        gp.updateMany.mockResolvedValueOnce({ count: 0 });
        const result = await fulfillPromoClaim(BUNDLES['career-bundle'], 'np@example.com', null, NOW);
        expect(result).toMatchObject({ reused: true, delivery: 'already' });
        expect(sendGuidePurchaseEmail).not.toHaveBeenCalled();
        expect(emailDelivered(result.delivery)).toBe(true);
    });

    it('puts the previous send time back when a re-send fails', async () => {
        const sentAt = new Date(NOW.getTime() - PROMO_RESEND_INTERVAL_MS * 2);
        gp.findFirst.mockResolvedValueOnce({ ...CLAIM, emailSentAt: sentAt });
        vi.mocked(sendGuidePurchaseEmail).mockResolvedValueOnce('retry');
        const result = await fulfillPromoClaim(BUNDLES['career-bundle'], 'np@example.com', null, NOW);
        expect(result.delivery).toBe('retry');
        expect(gp.updateMany).toHaveBeenLastCalledWith({ where: { id: 'gp_promo', accessToken: CLAIM.accessToken, emailSentAt: NOW }, data: { emailSentAt: sentAt } });
    });

    it('releases a new claim\'s email for the next attempt when the send fails', async () => {
        gp.create.mockResolvedValueOnce(CLAIM);
        vi.mocked(sendGuidePurchaseEmail).mockResolvedValueOnce('retry');
        const result = await fulfillPromoClaim(BUNDLES['career-bundle'], 'np@example.com', null, NOW);
        expect(result).toMatchObject({ reused: false, delivery: 'retry' });
        expect(gp.updateMany).toHaveBeenLastCalledWith({ where: { id: 'gp_promo', accessToken: CLAIM.accessToken }, data: { emailSentAt: null } });
    });

    it('lets a failed write throw, so the route answers 500', async () => {
        gp.create.mockRejectedValueOnce(new Error('db down'));
        await expect(fulfillPromoClaim(BUNDLES['career-bundle'], 'np@example.com', null, NOW)).rejects.toThrow('db down');
    });
});

describe('refunds and disputes', () => {
    beforeEach(() => {
        gp.findUnique.mockResolvedValue(PURCHASE);
        gp.update.mockResolvedValue({});
    });

    it('a full refund ends downloads', async () => {
        expect(await revokeGuidePurchase('pi_1', 'refunded', 1900)).toBe(true);
        expect(gp.findUnique).toHaveBeenCalledWith({ where: { stripePaymentIntentId: 'pi_1' } });
        expect(gp.update).toHaveBeenCalledWith({ where: { id: 'gp_1' }, data: { refundedAt: expect.any(Date) } });
    });

    it('a partial refund leaves access in place', async () => {
        expect(await revokeGuidePurchase('pi_1', 'refunded', 500)).toBe(true);
        expect(gp.update).not.toHaveBeenCalled();
    });

    it('a chargeback freezes downloads', async () => {
        expect(await revokeGuidePurchase('pi_1', 'disputed')).toBe(true);
        expect(gp.update).toHaveBeenCalledWith({ where: { id: 'gp_1' }, data: { disputedAt: expect.any(Date) } });
    });

    it('reports a payment that bought no guides', async () => {
        gp.findUnique.mockResolvedValueOnce(null);
        expect(await revokeGuidePurchase('pi_other', 'refunded', 100)).toBe(false);
        gp.count.mockResolvedValueOnce(0);
        expect(await isGuidePayment('pi_other')).toBe(false);
        gp.count.mockResolvedValueOnce(1);
        expect(await isGuidePayment('pi_1')).toBe(true);
    });

    it('recognises a guide payment whose purchase is not recorded yet by its payment intent tag', async () => {
        const stripe = { paymentIntents: { retrieve: vi.fn() } };
        gp.count.mockResolvedValue(0);
        stripe.paymentIntents.retrieve.mockResolvedValueOnce({ metadata: { type: 'guide', product: 'complete-library' } });
        expect(await isUnrecordedGuidePayment(stripe as never, 'pi_new')).toBe(true);
        // A product the catalog does not have is never recorded: no retry could find it.
        stripe.paymentIntents.retrieve.mockResolvedValueOnce({ metadata: { type: 'guide', product: 'retired-guide' } });
        expect(await isUnrecordedGuidePayment(stripe as never, 'pi_unknown')).toBe(false);
        stripe.paymentIntents.retrieve.mockResolvedValueOnce({ metadata: { type: 'post_pack' } });
        expect(await isUnrecordedGuidePayment(stripe as never, 'pi_pack')).toBe(false);
        stripe.paymentIntents.retrieve.mockResolvedValueOnce({ metadata: {} });
        expect(await isUnrecordedGuidePayment(stripe as never, 'pi_job')).toBe(false);

        gp.count.mockResolvedValueOnce(1);
        expect(await isUnrecordedGuidePayment(stripe as never, 'pi_recorded')).toBe(false);
        expect(stripe.paymentIntents.retrieve).toHaveBeenCalledTimes(4);
    });

    it('a payment intent Stripe no longer has is not a guide payment; any other read failure throws', async () => {
        const stripe = { paymentIntents: { retrieve: vi.fn() } };
        gp.count.mockResolvedValue(0);
        stripe.paymentIntents.retrieve.mockRejectedValueOnce(Object.assign(new Error('No such payment_intent'), { code: 'resource_missing' }));
        expect(await isUnrecordedGuidePayment(stripe as never, 'pi_gone')).toBe(false);
        stripe.paymentIntents.retrieve.mockRejectedValueOnce(new Error('stripe down'));
        await expect(isUnrecordedGuidePayment(stripe as never, 'pi_x')).rejects.toThrow('stripe down');
    });

    it('a won dispute restores downloads', async () => {
        gp.updateMany.mockResolvedValueOnce({ count: 1 });
        expect(await restoreDisputedGuidePurchase('pi_1')).toBe(true);
        expect(gp.updateMany).toHaveBeenCalledWith({
            where: { stripePaymentIntentId: 'pi_1', disputedAt: { not: null } },
            data: { disputedAt: null },
        });
        gp.updateMany.mockResolvedValueOnce({ count: 0 });
        expect(await restoreDisputedGuidePurchase('pi_1')).toBe(false);
    });
});
