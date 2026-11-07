/**
 * The guides store's events in the Stripe webhook (./route.ts). Only paid
 * guide sales reach Stripe: a launch-promo claim (POST /api/guides/claim)
 * has no payment, so no event ever names one.
 *
 *   checkout paid   lib/guides/fulfill.ts#fulfillGuideSession records the
 *                   purchase (keyed on the session, so the success page and
 *                   the webhook never record it twice) and sends the
 *                   delivery email. A failed write, or a failed email, rolls
 *                   the dedupe row back and answers 500, so Stripe retries;
 *                   the retry only re-sends the email. The GA purchase goes
 *                   out once the email has.
 *   full refund     downloads end; a partial refund leaves them
 *   dispute opened  downloads freeze
 *   dispute closed  won (or warning_closed): downloads come back; lost: they
 *                   stay frozen
 * A refund or dispute of a guide payment whose purchase is not recorded yet
 * answers 500 too (the checkout tags the payment intent), so it lands once
 * the purchase exists instead of being dropped.
 *
 * The route hands a refund or dispute here only when no JobCharge and no
 * 5-post pack matches its payment intent, so posts, renewals and packs are
 * handled exactly as before. Each function answers null when the payment is
 * not a guide purchase.
 */
import type Stripe from 'stripe';
import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { getProduct } from '@/lib/guides/catalog';
import type { PaymentIntentReader } from '@/lib/payment-intent-reader';
import {
  fulfillGuideSession,
  isGuidePayment,
  isUnrecordedGuidePayment,
  restoreDisputedGuidePurchase,
  revokeGuidePurchase,
  type FulfillResult,
} from '@/lib/guides/fulfill';
import { sendPurchaseEvent } from './activate-paid-job';
import { disputeClosedInOurFavour } from './post-pack-refunds';
import { alertWebhookFailure, type AlertExtras } from './webhook-support';

/** The route's failAndRetry, bound to this delivery's dedupe row: alert, roll the row back, answer 500. */
export type FailAndRetry = (reason: string, err: unknown, extras: AlertExtras, message: string) => Promise<NextResponse>;

/** checkout.session.completed or async_payment_succeeded for a guide checkout. */
export async function handleGuideCheckoutPaid(
  event: Stripe.Event,
  session: Stripe.Checkout.Session,
  failAndRetry: FailAndRetry,
): Promise<NextResponse> {
  const extras = { eventId: event.id, sessionId: session.id };
  if (session.payment_status !== 'paid') {
    logger.info('[Stripe] Guide checkout completed but payment not settled; deferring fulfilment', {
      ...extras, paymentStatus: session.payment_status,
    });
    if (session.payment_status === 'no_payment_required') {
      await alertWebhookFailure('Guide checkout completed with no payment required: not fulfilled', null, extras);
    }
    return NextResponse.json({ received: true, deferred: true });
  }

  let result: FulfillResult;
  try {
    result = await fulfillGuideSession(session);
  } catch (err) {
    logger.error('[Stripe] Failed to record guide purchase', err, { sessionId: session.id });
    return failAndRetry('Guide purchase write failed', err, extras, 'Guide purchase write failed');
  }

  if (result.status !== 'fulfilled') {
    // A paid session for a product the catalog does not have: no retry will
    // fix it, so the dedupe row stays and a human delivers or refunds it.
    await alertWebhookFailure('Guide checkout paid but not fulfilled: deliver or refund it by hand', null, {
      ...extras, status: result.status, product: session.metadata?.product,
    });
    return NextResponse.json({ error: 'Bad guide metadata' }, { status: 400 });
  }

  const { purchase } = result;
  if (result.delivery === 'retry') {
    // The purchase is saved, but the buyer has no library link yet. The
    // retry finds the purchase and only re-sends the email.
    return failAndRetry(
      'Guide purchase recorded, delivery email failed: Stripe will retry',
      null,
      { ...extras, purchaseId: purchase.id },
      'Guide delivery email failed',
    );
  }
  if (result.delivery === 'refused' || result.delivery === 'no-address') {
    // No retry can send it, so a person must. /admin/guides re-sends the link
    // to the address on the purchase; with no address on it, reach the buyer
    // through the email or receipt details in Stripe.
    const reason = result.delivery === 'refused'
      ? 'Guide purchase recorded, but its delivery email cannot be sent: send the library link from /admin/guides'
      : 'Guide purchase recorded with no email address: reach the buyer through Stripe and send the library link by hand';
    await alertWebhookFailure(reason, null, { ...extras, purchaseId: purchase.id, delivery: result.delivery });
  }

  const amountCents = session.amount_total ?? purchase.amountCents;
  if (amountCents > 0) {
    // The GA ids are the ones /api/guides/checkout stored when the buyer had
    // granted analytics consent; trackServerPurchase validates both.
    await sendPurchaseEvent({
      clientId: purchase.id,
      gaClientId: session.metadata?.gaClientId,
      gaSessionId: session.metadata?.gaSessionId,
      sessionId: session.id,
      amountCents,
      currency: session.currency ?? purchase.currency,
      type: 'guide',
      itemId: purchase.productSlug,
      itemName: getProduct(purchase.productSlug)?.title,
    });
  }
  return NextResponse.json({ received: true, guidePurchase: purchase.id });
}

/** charge.refunded: a full refund ends the purchase's downloads, a partial one leaves them. */
export async function guideRefund(charge: Stripe.Charge, paymentIntentId: string): Promise<NextResponse | null> {
  if (!(await revokeGuidePurchase(paymentIntentId, 'refunded', charge.amount_refunded ?? 0))) return null;
  return NextResponse.json({ received: true, note: 'guide purchase refund handled' });
}

/** charge.dispute.created: a chargeback freezes the purchase's downloads until the dispute closes. */
export async function guideDisputeCreated(paymentIntentId: string): Promise<NextResponse | null> {
  if (!(await revokeGuidePurchase(paymentIntentId, 'disputed'))) return null;
  return NextResponse.json({ received: true, note: 'guide purchase disputed' });
}

/** charge.dispute.closed: the downloads come back only when we kept the funds. */
export async function guideDisputeClosed(dispute: Stripe.Dispute, paymentIntentId: string): Promise<NextResponse | null> {
  if (!(await isGuidePayment(paymentIntentId))) return null;
  const kept = disputeClosedInOurFavour(dispute.status);
  if (kept) await restoreDisputedGuidePurchase(paymentIntentId);
  return NextResponse.json({ received: true, note: kept ? 'guide purchase restored' : 'guide purchase dispute lost' });
}

/**
 * A refund or dispute of a guide payment whose purchase is not recorded yet:
 * 500 with the dedupe row rolled back, so Stripe retries once the checkout
 * is fulfilled. Null when the payment is not a guide sale. A failed read of
 * the payment intent throws into the caller's catch, which answers 500 too.
 */
export async function retryUntilGuideRecorded(
  stripe: PaymentIntentReader,
  event: Stripe.Event,
  paymentIntentId: string,
  failAndRetry: FailAndRetry,
): Promise<NextResponse | null> {
  if (!(await isUnrecordedGuidePayment(stripe, paymentIntentId))) return null;
  logger.warn('[Stripe] A guide payment event arrived before its purchase was recorded; answering 500 so Stripe retries', {
    eventId: event.id, eventType: event.type, paymentIntentId,
  });
  return failAndRetry(
    `${event.type} for a guide payment arrived before its purchase was recorded: Stripe will retry`,
    null,
    { eventId: event.id, paymentIntentId },
    'The guide purchase for this payment is not recorded yet',
  );
}
