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
 *                 down are put back (republished while inside their run)
 *   dispute lost  the frozen credits are revoked for good, the loss recorded
 *                 as 'dispute_lost'
 * Every event alerts staff. Each step reads the state it changes
 * (lib/post-packs.ts), so a redelivery changes nothing twice. Errors
 * propagate: the webhook answers 500 and Stripe retries.
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
  await alertWebhookFailure(
    frozen ? '5-post pack disputed: credits frozen, its posts taken down' : '5-post pack disputed: it was not paid, so nothing was frozen',
    null,
    { ...extras, packStatus: pack.status },
  );
  logger.warn('5-post pack disputed', { ...extras, frozen });
  return { outcome: frozen ? 'frozen' : 'not_frozen', packId: pack.id };
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
    const { revoked } = await revokeUnusedPackCredits(pack.id, ['disputed'], 'disputed');
    await alertWebhookFailure('5-post pack dispute lost: its frozen credits revoked', null, { ...extras, creditsRevoked: revoked });
    logger.warn('5-post pack dispute lost', { ...extras, creditsRevoked: revoked });
    return { outcome: 'lost', packId: pack.id };
  }
  if (dispute.status !== 'won') {
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
  const reason = standing ? '5-post pack dispute won: credits and posts restored' : '5-post pack dispute won after a refund: nothing restored';
  await alertWebhookFailure(reason, null, {
    ...extras,
    packStatus: current?.status ?? 'missing',
    postsRestored: restored.restored,
    postsRepublished: restored.republished.length,
  });
  logger.info('5-post pack dispute won', { ...extras, restored: restored.restored, republished: restored.republished.length });
  return { outcome: 'won', packId: pack.id };
}
