/**
 * Refunds and chargebacks of a 5-post pack (2027 re-price, phase 2). The
 * webhook (./route.ts) hands an event here when no JobCharge matches its
 * payment intent; each function answers null when no pack does either.
 *
 * No refunds (owner decision 2026-10-25): a pack is not refundable, /terms
 * says so, and nothing does partial-refund credit arithmetic. A refund the
 * owner issues by hand in Stripe, or a chargeback, is still honoured:
 *   full refund   the pack becomes 'refunded', its unused credits are revoked
 *                 for good, and the posts still standing on it ('pack' rows)
 *                 go to 'refunded' and come off the board, as a full refund
 *                 of a post does. A renewed pack post has its own renewal
 *                 payment and stays up.
 *   partial       nothing changes but the refunded amount on the pack row
 *   dispute open  the pack is frozen ('disputed', never usable) and its
 *                 standing posts go to 'disputed', off the board
 *   dispute won   the pack is 'paid' again and the posts the dispute took
 *                 down are put back (republished while inside their run); a
 *                 dispute closed 'warning_closed', an inquiry that never
 *                 became a chargeback, is put back the same way
 *   dispute lost  the credits still unused are revoked for good, the loss
 *                 recorded as 'dispute_lost', and the posts still standing
 *                 taken down, from a frozen pack or from one still 'paid'
 *                 (a dispute.created that never froze it)
 * Every event alerts staff. Each step reads the state it changes
 * (lib/post-packs.ts), so a redelivery changes nothing twice. Errors
 * propagate: the webhook answers 500 and Stripe retries.
 *
 * A pack payment whose pack is not recorded yet (its checkout not fulfilled:
 * the webhook was lost and neither the verify page nor the sweep has run)
 * matches no pack. isUnrecordedPackPayment tells it from any other unmatched
 * payment by the tag /api/create-pack-checkout puts on its payment intent,
 * and the webhook answers 500 so Stripe retries the event once the pack
 * exists (code review M2). The fulfilment reads the payment first and
 * records the pack refunded or disputed when it already is.
 */
import type Stripe from 'stripe';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import {
  freezePack,
  restorePackPosts,
  revokeUnusedPackCredits,
  takeDownPackPosts,
  unfreezePack,
} from '@/lib/post-packs';
import { POST_PACK_CHECKOUT_TYPE } from '@/lib/post-pack-sale';
import { alertWebhookFailure } from './webhook-support';

export interface PackEventContext {
  eventId: string;
}

interface PackForPayment {
  id: string;
  amountCents: number;
  status: string;
  userId: string | null;
}

/** The pack a payment intent paid for, if any. */
async function packForPayment(paymentIntentId: string): Promise<PackForPayment | null> {
  return prisma.employerPostPack.findUnique({
    where: { stripePaymentIntentId: paymentIntentId },
    select: { id: true, amountCents: true, status: true, userId: true },
  });
}

/** Record what has gone back on the pack row: the amount Stripe reports, so a redelivery writes the same. */
async function recordMoneyBack(packId: string, amountCents: number, reason: string | null): Promise<void> {
  await prisma.employerPostPack.update({
    where: { id: packId },
    data: { refundedAt: new Date(), refundedAmountCents: amountCents, refundReason: reason },
  });
}

export type PackRefundOutcome = 'revoked' | 'partial_refund';

/** charge.refunded for a pack's payment. */
export async function applyPackRefund(
  charge: Stripe.Charge,
  paymentIntentId: string,
  ctx: PackEventContext,
): Promise<{ outcome: PackRefundOutcome; packId: string } | null> {
  const pack = await packForPayment(paymentIntentId);
  if (!pack) return null;
  // Stripe's cumulative refunded amount, not this refund's.
  const refunded = charge.amount_refunded ?? 0;
  await recordMoneyBack(pack.id, refunded, charge.refunds?.data?.[0]?.reason ?? null);
  const extras = { eventId: ctx.eventId, packId: pack.id, userId: pack.userId ?? undefined, paymentIntentId, refundedCents: refunded, amountCents: pack.amountCents };

  if (refunded < pack.amountCents) {
    await alertWebhookFailure('5-post pack partly refunded: its credits and posts are unchanged', null, extras);
    logger.warn('5-post pack partly refunded; nothing revoked', extras);
    return { outcome: 'partial_refund', packId: pack.id };
  }

  const { revoked } = await revokeUnusedPackCredits(pack.id, ['paid', 'disputed'], 'refunded');
  // Run even when the credits were revoked by an earlier delivery: one that
  // failed after revoking left these posts standing.
  const takenDown = await takeDownPackPosts(pack.id, 'refunded');
  await alertWebhookFailure('5-post pack refunded in full: unused credits revoked, its posts taken down', null, {
    ...extras,
    creditsRevoked: revoked,
    postsTakenDown: takenDown.length,
  });
  logger.warn('5-post pack refunded in full', { ...extras, creditsRevoked: revoked, postsTakenDown: takenDown.length });
  return { outcome: 'revoked', packId: pack.id };
}

/** charge.dispute.created for a pack's payment. */
export async function applyPackDisputeCreated(
  dispute: Stripe.Dispute,
  paymentIntentId: string,
  ctx: PackEventContext,
): Promise<{ outcome: 'frozen' | 'not_frozen'; packId: string } | null> {
  const pack = await packForPayment(paymentIntentId);
  if (!pack) return null;
  const frozen = await freezePack(pack.id);
  const takenDown = await takeDownPackPosts(pack.id, 'disputed');
  const extras = { eventId: ctx.eventId, packId: pack.id, userId: pack.userId ?? undefined, disputeId: dispute.id, amountCents: dispute.amount, postsTakenDown: takenDown.length };
  await alertWebhookFailure(disputeOpenedReason(frozen, pack.status), null, { ...extras, packStatus: pack.status });
  logger.warn('5-post pack disputed', { ...extras, frozen });
  return { outcome: frozen ? 'frozen' : 'not_frozen', packId: pack.id };
}

/** What the alert of a dispute opened says: frozen now, frozen already (a pack recorded disputed), or not paid. */
function disputeOpenedReason(frozen: boolean, statusBefore: string): string {
  if (frozen) return '5-post pack disputed: credits frozen, its posts taken down';
  if (statusBefore === 'disputed') return '5-post pack disputed: already frozen, its posts taken down';
  return '5-post pack disputed: it was not paid, so nothing was frozen';
}

/**
 * The dispute statuses that give the money back to us at close: 'won', and
 * 'warning_closed', an inquiry that never became a chargeback (security
 * review L8). Any other status ('prevented', or one Stripe adds later)
 * changes nothing here; a refund that settles a dispute arrives as its own
 * charge.refunded, which applyPackRefund applies.
 */
const DISPUTE_RESTORES: ReadonlySet<string> = new Set(['won', 'warning_closed']);

/** True for a dispute status that closes in our favour (DISPUTE_RESTORES). The JobCharge path in ./route.ts uses it too. */
export function disputeClosedInOurFavour(status: string): boolean {
  return DISPUTE_RESTORES.has(status);
}

/** charge.dispute.closed for a pack's payment. */
export async function applyPackDisputeClosed(
  dispute: Stripe.Dispute,
  paymentIntentId: string,
  ctx: PackEventContext,
): Promise<{ outcome: 'won' | 'lost' | 'open'; packId: string } | null> {
  const pack = await packForPayment(paymentIntentId);
  if (!pack) return null;
  const extras = { eventId: ctx.eventId, packId: pack.id, userId: pack.userId ?? undefined, disputeId: dispute.id, amountCents: dispute.amount };

  if (dispute.status === 'lost') {
    await recordMoneyBack(pack.id, dispute.amount, 'dispute_lost');
    // From 'paid' too: a dispute.created that never froze the pack (it came
    // before the pack was recorded paid) must not leave its credits spendable.
    const { revoked } = await revokeUnusedPackCredits(pack.id, ['paid', 'disputed'], 'disputed');
    const takenDown = await takeDownPackPosts(pack.id, 'disputed');
    await alertWebhookFailure('5-post pack dispute lost: its unused credits revoked', null, { ...extras, creditsRevoked: revoked, postsTakenDown: takenDown.length });
    logger.warn('5-post pack dispute lost', { ...extras, creditsRevoked: revoked, postsTakenDown: takenDown.length });
    return { outcome: 'lost', packId: pack.id };
  }
  if (!disputeClosedInOurFavour(dispute.status)) {
    logger.info('charge.dispute.closed for a 5-post pack with a non-final outcome; no change', { ...extras, status: dispute.status });
    return { outcome: 'open', packId: pack.id };
  }

  await unfreezePack(pack.id);
  // Put the posts back only while the pack stands: a refund since the
  // dispute opened wins over the dispute outcome. Read after the unfreeze,
  // so a redelivery that finds the pack already 'paid' still finishes.
  const current = await prisma.employerPostPack.findUnique({ where: { id: pack.id }, select: { status: true } });
  const standing = current?.status === 'paid';
  const restored = standing ? await restorePackPosts(pack.id, new Date()) : { restored: 0, republished: [] };
  await alertWebhookFailure(closedInOurFavourReason(dispute.status, standing), null, {
    ...extras,
    packStatus: current?.status ?? 'missing',
    postsRestored: restored.restored,
    postsRepublished: restored.republished.length,
  });
  logger.info('5-post pack dispute closed in our favour', { ...extras, status: dispute.status, restored: restored.restored, republished: restored.republished.length });
  return { outcome: 'won', packId: pack.id };
}

/** What the alert of a dispute closed in our favour says: won or an inquiry closed, and whether the pack stood to be put back. */
function closedInOurFavourReason(status: string, standing: boolean): string {
  if (status === 'won') {
    return standing ? '5-post pack dispute won: credits and posts restored' : '5-post pack dispute won after a refund: nothing restored';
  }
  return standing
    ? '5-post pack inquiry closed without a chargeback: credits and posts restored'
    : '5-post pack inquiry closed without a chargeback after a refund: nothing restored';
}

/**
 * Whether a payment that no JobCharge and no pack matches is a 5-post pack's
 * whose pack is not recorded yet: /api/create-pack-checkout tags the payment
 * intent (payment_intent_data.metadata.type). The webhook then answers 500
 * for Stripe to retry once the pack exists (see the file header). False for
 * an intent Stripe no longer has: no retry could find a pack for it. Any
 * other Stripe error propagates, and the webhook answers 500 for it too.
 */
export async function isUnrecordedPackPayment(stripe: Stripe, paymentIntentId: string): Promise<boolean> {
  try {
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    return intent.metadata?.type === POST_PACK_CHECKOUT_TYPE;
  } catch (err) {
    if ((err as { code?: string } | null)?.code === 'resource_missing') return false;
    throw err;
  }
}
