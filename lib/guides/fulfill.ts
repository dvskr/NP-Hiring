/**
 * Record a guides store delivery and send its email.
 *
 * Two ways in, one row shape (GuidePurchase):
 *   - a paid Stripe checkout (source 'stripe'): fulfillGuideSession, called by
 *     the Stripe webhook and by the success page (/api/guides/verify),
 *     whichever gets there first. Both are safe to repeat: the purchase is
 *     keyed on the Checkout session. Only the webhook sends the delivery
 *     email (sendEmail: false on the success page), so a send that fails is
 *     always the webhook's, and Stripe's retry sends it again.
 *   - a launch-promo claim (source 'promo'): fulfillPromoClaim, called by
 *     POST /api/guides/claim while lib/guides/phase.ts#isGuideClaimOpen. No
 *     payment and no Stripe ids; a claim the same email already holds is
 *     re-used rather than duplicated (claims for one address are serialised
 *     with a transaction lock), and its email re-sent at most once per
 *     PROMO_RESEND_INTERVAL_MS.
 *
 * Refunds and chargebacks reach only Stripe rows (a promo row has no payment
 * intent): a full refund revokes downloads, a partial one leaves them, a
 * dispute freezes them and a dispute decided in our favour restores them.
 */
import type Stripe from 'stripe';
import type { GuidePurchase, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import type { PaymentIntentReader } from '@/lib/payment-intent-reader';
import { ADD_ON, getProduct, isGuideSlug, productGuides, resolvePurchaseGuides, type Product } from './catalog';
import { GUIDE_CHECKOUT_TYPE } from './phase';
import { newAccessToken } from './access';
import { sendGuidePurchaseEmail } from './email';

export { GUIDE_CHECKOUT_TYPE };

/** Checkout Session metadata.addOn when the add-on guide was bought. */
export const ADD_ON_METADATA_VALUE: string = ADD_ON.guide;

/** How often a re-used promo claim may re-send its email. */
export const PROMO_RESEND_INTERVAL_MS = 10 * 60 * 1000;

/**
 * What happened to the delivery email on this call:
 *  - 'sent': sent now; 'already': sent before (for a re-used promo claim,
 *    within PROMO_RESEND_INTERVAL_MS), or being sent by a concurrent caller;
 *  - 'no-address': no email to send to; 'refused': it will never send;
 *  - 'retry': a provider or database failure, released for the next caller;
 *  - 'pending': not sent yet, and this caller does not send it (the success
 *    page, which leaves the email to the webhook).
 */
export type DeliveryOutcome = 'sent' | 'already' | 'no-address' | 'refused' | 'retry' | 'pending';

export interface FulfillOptions {
    /** False on the success page: record the purchase, leave the email to the webhook. */
    readonly sendEmail?: boolean;
}

export type FulfillResult =
    | { readonly status: 'fulfilled'; readonly purchase: GuidePurchase; readonly delivery: DeliveryOutcome }
    | { readonly status: 'not-guide' | 'unpaid' | 'invalid' };

/** Whether the reader has, or is about to have, the library link in their inbox. */
export function emailDelivered(delivery: DeliveryOutcome): boolean {
    return delivery === 'sent' || delivery === 'already';
}

function buyerEmail(session: Stripe.Checkout.Session): string | null {
    const email = session.customer_details?.email ?? session.customer_email ?? null;
    return email ? email.trim().toLowerCase() : null;
}

function paymentIntentId(session: Stripe.Checkout.Session): string | null {
    return typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null;
}

type SaleData = Omit<Prisma.GuidePurchaseCreateInput, 'source' | 'stripeSessionId' | 'accessToken'>;

async function recordPurchase(session: Stripe.Checkout.Session, data: SaleData): Promise<GuidePurchase> {
    try {
        return await prisma.guidePurchase.upsert({
            where: { stripeSessionId: session.id },
            create: { ...data, source: 'stripe', stripeSessionId: session.id, accessToken: newAccessToken() },
            update: {},
        });
    } catch (error) {
        // Two callers creating the same session at once: the loser hits the
        // unique index, and the winner's row is the purchase.
        if ((error as { code?: string } | null)?.code === 'P2002') {
            const existing = await prisma.guidePurchase.findUnique({ where: { stripeSessionId: session.id } });
            if (existing) return existing;
        }
        throw error;
    }
}

/**
 * The row as this caller read it: every claim and release of the email is
 * tied to the token too, so a link support replaced in between
 * (lib/guides/admin.ts#rotateGuideAccess) is never emailed, and its send is
 * never undone by this caller.
 */
function asRead(purchase: GuidePurchase): { id: string; accessToken: string } {
    return { id: purchase.id, accessToken: purchase.accessToken };
}

/** Send the delivery email once per purchase. A failed send releases the claim for the next caller. */
async function deliverOnce(purchase: GuidePurchase): Promise<DeliveryOutcome> {
    if (!purchase.email) return 'no-address';
    if (purchase.emailSentAt) return 'already';
    const claim = await prisma.guidePurchase.updateMany({
        where: { ...asRead(purchase), emailSentAt: null },
        data: { emailSentAt: new Date() },
    });
    if (claim.count !== 1) return 'already';
    const result = await sendGuidePurchaseEmail(purchase);
    if (result !== 'sent') {
        await prisma.guidePurchase.updateMany({ where: asRead(purchase), data: { emailSentAt: null } });
    }
    return result;
}

/** deliverOnce, with a database failure reported as 'retry' (the row is recorded either way). */
async function deliverSafely(purchase: GuidePurchase, deliver: (p: GuidePurchase) => Promise<DeliveryOutcome>): Promise<DeliveryOutcome> {
    try {
        return await deliver(purchase);
    } catch (error) {
        logger.error('Guide delivery email failed', error, { purchaseId: purchase.id });
        return 'retry';
    }
}

export async function fulfillGuideSession(session: Stripe.Checkout.Session, options: FulfillOptions = {}): Promise<FulfillResult> {
    if (session.metadata?.type !== GUIDE_CHECKOUT_TYPE) return { status: 'not-guide' };
    if (session.payment_status !== 'paid') return { status: 'unpaid' };

    const product = getProduct(session.metadata?.product ?? '');
    if (!product) {
        logger.error('Guide checkout paid for an unknown product', null, { sessionId: session.id, product: session.metadata?.product });
        return { status: 'invalid' };
    }
    const withAddOn = session.metadata?.addOn === ADD_ON_METADATA_VALUE;
    const guideSlugs = resolvePurchaseGuides(product, withAddOn).filter(isGuideSlug);

    const purchase = await recordPurchase(session, {
        stripePaymentIntentId: paymentIntentId(session),
        email: buyerEmail(session),
        userId: session.metadata?.userId || null,
        productSlug: product.slug,
        guideSlugs,
        amountCents: session.amount_total ?? 0,
        currency: session.currency ?? 'usd',
    });

    if (options.sendEmail === false) {
        return { status: 'fulfilled', purchase, delivery: purchase.emailSentAt ? 'already' : 'pending' };
    }
    // The purchase is recorded either way; the caller decides whether to
    // retry the email (the webhook does, by asking Stripe to resend).
    const delivery = await deliverSafely(purchase, deliverOnce);
    return { status: 'fulfilled', purchase, delivery };
}

export interface PromoClaimResult {
    readonly purchase: GuidePurchase;
    /** True when the email already held a claim with every guide of the product. */
    readonly reused: boolean;
    readonly delivery: DeliveryOutcome;
}

/**
 * Re-send a re-used claim's email, at most once per PROMO_RESEND_INTERVAL_MS.
 * The send is claimed by moving emailSentAt forward in one conditional write;
 * a failed send puts the previous value back.
 */
async function resendThrottled(purchase: GuidePurchase, now: Date): Promise<DeliveryOutcome> {
    if (!purchase.email) return 'no-address';
    const cutoff = new Date(now.getTime() - PROMO_RESEND_INTERVAL_MS);
    const claim = await prisma.guidePurchase.updateMany({
        where: { ...asRead(purchase), OR: [{ emailSentAt: null }, { emailSentAt: { lt: cutoff } }] },
        data: { emailSentAt: now },
    });
    // Sent within the interval, claimed by a concurrent caller just now, or
    // given a new link by support since this caller read it.
    if (claim.count !== 1) return 'already';
    const result = await sendGuidePurchaseEmail(purchase);
    if (result !== 'sent') {
        await prisma.guidePurchase.updateMany({
            where: { ...asRead(purchase), emailSentAt: now },
            data: { emailSentAt: purchase.emailSentAt },
        });
    }
    return result;
}

type GuidePurchaseReader = Pick<Prisma.TransactionClient, 'guidePurchase'>;

/** The newest promo claim of `email` (trimmed, lowercased) that already holds every guide of `product`. */
export async function findReusableClaim(product: Product, email: string, db: GuidePurchaseReader = prisma): Promise<GuidePurchase | null> {
    return db.guidePurchase.findFirst({
        where: { source: 'promo', email, guideSlugs: { hasEvery: [...productGuides(product)] } },
        orderBy: { createdAt: 'desc' },
    });
}

/** The transaction lock that serialises promo claims for one address (the job alert and application routes lock the same way). */
export function claimLockKey(email: string): string {
    return `guide-claim:${email}`;
}

/**
 * The address's reusable claim, or a new one. Runs under a transaction lock
 * on the address, so two claims sent at the same instant find one row (and
 * send one email) instead of creating two.
 */
async function findOrCreateClaim(
    product: Product,
    email: string,
    userId: string | null,
): Promise<{ readonly purchase: GuidePurchase; readonly reused: boolean }> {
    return prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${claimLockKey(email)}))`;
        const existing = await findReusableClaim(product, email, tx);
        if (existing) return { purchase: existing, reused: true };
        const purchase = await tx.guidePurchase.create({
            data: {
                source: 'promo',
                stripeSessionId: null,
                stripePaymentIntentId: null,
                email,
                userId,
                productSlug: product.slug,
                guideSlugs: [...productGuides(product)],
                amountCents: 0,
                accessToken: newAccessToken(),
            },
        });
        return { purchase, reused: false };
    });
}

/**
 * A launch-promo claim of `product` for `email` (already trimmed and
 * lowercased). The caller checks lib/guides/phase.ts#isGuideClaimOpen first.
 * Unlocks the product's own guides, never the checkout add-on. `known` is the
 * caller's findReusableClaim answer, when it found one; otherwise the claim
 * is found or created here, under the address's lock.
 */
export async function fulfillPromoClaim(
    product: Product,
    email: string,
    userId: string | null,
    now: Date = new Date(),
    known?: GuidePurchase | null,
): Promise<PromoClaimResult> {
    const { purchase, reused } = known ? { purchase: known, reused: true } : await findOrCreateClaim(product, email, userId);
    const delivery = reused
        ? await deliverSafely(purchase, (p) => resendThrottled(p, now))
        : await deliverSafely(purchase, deliverOnce);
    return { purchase, reused, delivery };
}

/** Whether this payment bought guides, so the webhook knows to stop looking elsewhere. */
export async function isGuidePayment(paymentIntent: string): Promise<boolean> {
    return (await prisma.guidePurchase.count({ where: { stripePaymentIntentId: paymentIntent } })) > 0;
}

/**
 * True for a guide payment whose purchase is not recorded yet, because its
 * checkout.session.completed has not been processed. A refund or dispute
 * that lands first must be retried, not dropped, or the purchase would be
 * created afterwards with full access. The checkout tags the PaymentIntent
 * (payment_intent_data.metadata.type) so this can tell without a purchase
 * row. As for the 5-post pack (isUnrecordedPackPayment), a payment intent
 * Stripe no longer has is not one, and any other failure to read it throws,
 * so the webhook answers 500 and Stripe retries.
 */
export async function isUnrecordedGuidePayment(stripe: PaymentIntentReader, paymentIntent: string): Promise<boolean> {
    if (await isGuidePayment(paymentIntent)) return false;
    try {
        const intent = await stripe.paymentIntents.retrieve(paymentIntent);
        // A product the catalog does not have is never recorded (the
        // checkout event answers 400 and pages a human), so retrying its
        // refund or dispute could only fail for Stripe's whole retry window.
        return intent?.metadata?.type === GUIDE_CHECKOUT_TYPE && getProduct(intent.metadata?.product ?? '') !== null;
    } catch (error) {
        if ((error as { code?: string } | null)?.code === 'resource_missing') return false;
        throw error;
    }
}

/**
 * Take back access after a full refund or a chargeback. Returns true when the
 * payment was a guide purchase, so the webhook can stop looking elsewhere.
 * A partial refund (a goodwill credit) leaves access in place.
 */
export async function revokeGuidePurchase(
    paymentIntent: string,
    reason: 'refunded' | 'disputed',
    amountRefundedCents?: number,
): Promise<boolean> {
    const purchase = await prisma.guidePurchase.findUnique({ where: { stripePaymentIntentId: paymentIntent } });
    if (!purchase) return false;
    if (reason === 'refunded' && (amountRefundedCents ?? 0) < purchase.amountCents) {
        logger.warn('Partial refund on a guide purchase; access left in place', {
            purchaseId: purchase.id,
            refundedCents: amountRefundedCents,
        });
        return true;
    }
    await prisma.guidePurchase.update({
        where: { id: purchase.id },
        data: reason === 'refunded' ? { refundedAt: new Date() } : { disputedAt: new Date() },
    });
    logger.warn(`Guide purchase ${reason}; downloads revoked`, { purchaseId: purchase.id });
    return true;
}

/** A dispute decided in our favour gives access back. Returns true when a frozen purchase was restored. */
export async function restoreDisputedGuidePurchase(paymentIntent: string): Promise<boolean> {
    const result = await prisma.guidePurchase.updateMany({
        where: { stripePaymentIntentId: paymentIntent, disputedAt: { not: null } },
        data: { disputedAt: null },
    });
    if (result.count > 0) logger.info('Guide purchase dispute won; downloads restored', { paymentIntent });
    return result.count > 0;
}
