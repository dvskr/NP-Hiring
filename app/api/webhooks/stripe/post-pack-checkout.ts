/**
 * 5-post pack checkout fulfilment (2027 re-price, phase 2).
 *
 * Three callers run exactly this code, like activate-paid-job.ts does for a
 * new post:
 *   1. the Stripe webhook (checkout.session.completed and
 *      checkout.session.async_payment_succeeded, metadata.type 'post_pack');
 *   2. /api/verify-pack-session (self-heal when the buyer returns before the
 *      webhook lands);
 *   3. the daily payment reconciliation sweep (a paid session whose webhook
 *      was lost).
 *
 * Idempotency across paths: one create keyed on the unique stripeSessionId.
 * The path that creates the row runs the side effects, once: the purchase
 * email (claimed through EmailSend), the GA purchase event, the alerts. A
 * session already on the books, or a P2002 from a path that got there first,
 * is 'already_fulfilled' and runs nothing.
 *
 * The money is always recorded. A pack bought while the sale was closed
 * (lib/post-pack-sale.ts#isPackSaleOpen false), by an account that is not an
 * employer, or with no account reference at all, is still written with its
 * credits, and staff are alerted to refund it in Stripe; the refund then
 * revokes it (./post-pack-refunds.ts). Only a buyer who can spend the credits
 * (an employer account) gets the purchase email.
 *
 * Callers MUST have verified payment_status === 'paid' and metadata.type ===
 * POST_PACK_CHECKOUT_TYPE; both are checked again. Errors propagate: the
 * webhook answers 500 and rolls its dedupe row back so Stripe retries.
 */
import type Stripe from 'stripe';
import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';
import { logger } from '@/lib/logger';
import { domainOf } from '@/lib/pricing';
import { stringField } from '@/lib/request-body';
import { packExpiresAt } from '@/lib/post-packs';
import { POST_PACK_CHECKOUT_TYPE, POST_PACK_SKU, isPackSaleOpen } from '@/lib/post-pack-sale';
import { sendPostPackPurchasedEmail } from '@/lib/email-service';
import { fetchInvoiceData, sendPurchaseEvent, type StripeInvoiceData } from './activate-paid-job';
import { alertWebhookFailure, claimEmailSend, prismaErrorCode, releaseEmailClaim, stripeIdOf, type AlertExtras } from './webhook-support';

export type PostPackFulfilmentOutcome = 'fulfilled' | 'already_fulfilled';

export interface PostPackFulfilment {
  outcome: PostPackFulfilmentOutcome;
  packId: string;
}

export interface PostPackContext {
  /** The Stripe event id, or the path that ran it ('verify-pack-session', 'payment-reconciliation'). */
  eventId: string;
}

/** Who bought the pack, as the server-set references name them. */
interface PackBuyer {
  /** metadata.userId, else client_reference_id: both the buying account, set by /api/create-pack-checkout. */
  userId: string | null;
  isEmployer: boolean;
  email: string;
  quotaDomain: string | null;
}

/** The pack recorded for a session, if any. */
async function packIdFor(sessionId: string): Promise<string | null> {
  const pack = await prisma.employerPostPack.findUnique({ where: { stripeSessionId: sessionId }, select: { id: true } });
  return pack?.id ?? null;
}

async function resolveBuyer(session: Stripe.Checkout.Session): Promise<PackBuyer> {
  const userId = stringField(session.metadata?.userId) ?? stringField(session.client_reference_id);
  const profile = userId
    ? await prisma.userProfile.findUnique({ where: { supabaseId: userId }, select: { role: true, email: true } })
    : null;
  const email = session.customer_details?.email ?? session.customer_email ?? profile?.email ?? '';
  return {
    userId,
    isEmployer: profile?.role === 'employer',
    email,
    quotaDomain: stringField(session.metadata?.quotaDomain)?.toLowerCase() ?? domainOf(email),
  };
}

/** The alerts for money the sale should not have taken; the pack is recorded either way. */
async function alertUnsellablePurchase(session: Stripe.Checkout.Session, buyer: PackBuyer, extras: AlertExtras): Promise<void> {
  if (!buyer.userId) {
    await alertWebhookFailure('5-post pack checkout carries no account: recorded unattached, refund it in Stripe', null, extras);
  } else if (!buyer.isEmployer) {
    await alertWebhookFailure('5-post pack bought by an account that is not an employer: recorded, refund it in Stripe', null, extras);
  }
  if (!isPackSaleOpen()) {
    await alertWebhookFailure('5-post pack bought while pack sales were closed: recorded, refund it in Stripe', null, extras);
  }
}

async function sendPurchasedEmailOnce(
  session: Stripe.Checkout.Session,
  buyer: PackBuyer,
  expiresAt: Date,
  invoiceData: StripeInvoiceData,
): Promise<void> {
  if (!buyer.isEmployer || !buyer.email) return;
  const key = `post-pack-purchased:${session.id}`;
  if (!(await claimEmailSend(key, buyer.email, 'post_pack_purchased'))) {
    logger.info('5-post pack purchase email already sent for this session; skipping', { sessionId: session.id });
    return;
  }
  const result = await sendPostPackPurchasedEmail(buyer.email, {
    posts: config.packPosts,
    expiresAt,
    hostedInvoiceUrl: invoiceData.hostedInvoiceUrl,
    invoiceNumber: invoiceData.invoiceNumber,
  });
  if (!result.success) {
    // The pack is recorded; release the claim so a later replay can send it.
    logger.error('Failed to send the 5-post pack purchase email', result.error ?? null, { sessionId: session.id });
    await releaseEmailClaim(key);
  }
}

/**
 * Record a PAID 5-post pack checkout: config.packPosts credits for the
 * buying account, usable until packExpiresAt(now).
 */
export async function fulfilPostPackCheckout(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
  ctx: PostPackContext,
): Promise<PostPackFulfilment> {
  if (session.metadata?.type !== POST_PACK_CHECKOUT_TYPE) {
    throw new Error(`Checkout session ${session.id} is not a 5-post pack checkout`);
  }
  if (session.payment_status !== 'paid') {
    throw new Error(`fulfilPostPackCheckout called for session ${session.id} with payment_status=${session.payment_status}`);
  }

  const recorded = await packIdFor(session.id);
  if (recorded) return { outcome: 'already_fulfilled', packId: recorded };

  const buyer = await resolveBuyer(session);
  const invoiceData = await fetchInvoiceData(stripe, session);
  const now = new Date();
  const expiresAt = packExpiresAt(now);
  const amountCents = session.amount_total ?? config.stripePackPriceInCents;
  let packId: string;
  try {
    const created = await prisma.employerPostPack.create({
      data: {
        userId: buyer.userId,
        email: buyer.email,
        quotaDomain: buyer.quotaDomain,
        status: 'paid',
        source: 'stripe',
        creditsTotal: config.packPosts,
        creditsRemaining: config.packPosts,
        amountCents,
        currency: session.currency ?? 'usd',
        purchasedAt: now,
        expiresAt,
        stripeSessionId: session.id,
        stripePaymentIntentId: stripeIdOf(session.payment_intent),
        ...invoiceData,
      },
      select: { id: true },
    });
    packId = created.id;
  } catch (err) {
    // A path that got here first already recorded this session: no side effect runs twice.
    if (prismaErrorCode(err) !== 'P2002') throw err;
    const raced = await packIdFor(session.id);
    if (!raced) throw err;
    return { outcome: 'already_fulfilled', packId: raced };
  }

  const extras: AlertExtras = {
    eventId: ctx.eventId,
    sessionId: session.id,
    packId,
    userId: buyer.userId ?? undefined,
    paymentIntentId: stripeIdOf(session.payment_intent) ?? undefined,
    amountCents,
  };
  await alertUnsellablePurchase(session, buyer, extras);
  await sendPurchasedEmailOnce(session, buyer, expiresAt, invoiceData);
  // The GA ids are the ones /api/create-pack-checkout stored when the buyer
  // had granted analytics consent; trackServerPurchase validates both.
  await sendPurchaseEvent({
    clientId: packId,
    gaClientId: session.metadata?.gaClientId,
    gaSessionId: session.metadata?.gaSessionId,
    sessionId: session.id,
    amountCents,
    currency: session.currency ?? 'usd',
    type: 'pack',
    tier: 'pack',
    itemId: POST_PACK_SKU,
  });
  logger.info('[Stripe] 5-post pack recorded', { packId, sessionId: session.id, userId: buyer.userId ?? undefined, via: ctx.eventId });
  return { outcome: 'fulfilled', packId };
}

/**
 * invoice.paid for a pack: refresh its invoice links once Stripe has issued
 * the paid PDF (the session fulfilled while the invoice was still open).
 * True when a pack carried the invoice.
 */
export async function refreshPackInvoice(invoice: Stripe.Invoice): Promise<boolean> {
  if (!invoice.id) return false;
  const { count } = await prisma.employerPostPack.updateMany({
    where: { stripeInvoiceId: invoice.id },
    data: {
      invoicePdfUrl: invoice.invoice_pdf ?? null,
      hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
      invoiceNumber: invoice.number ?? null,
    },
  });
  return count > 0;
}
