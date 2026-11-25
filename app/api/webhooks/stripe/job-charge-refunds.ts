/**
 * Refunds and chargebacks of a post's own payments, the ones the JobCharge
 * ledger holds, and what each does to the posting. The webhook (./route.ts)
 * matches the event to its JobCharge and hands the posting here; a 5-post
 * pack's payment goes to ./post-pack-refunds.ts instead.
 *   full refund    'refunded' and off the board, unless another payment for
 *                  the posting stands (fullRefundRevokesPosting)
 *   dispute open   'disputed' and off the board, unless the money already
 *                  went back: a payment refunded in full, or a posting
 *                  already 'refunded', is left as it is and alerted
 *   dispute won    'paid' again on a posting still 'disputed', and back on
 *                  the board while inside its run, not archived and not
 *                  held by an admin (lib/admin/job-hold.ts)
 * Each status write commits with its listing write in one transaction: a
 * failure between them rolls both back, and the Stripe retry, which reads
 * the status, does both again.
 *
 * Lives outside route.ts because Next.js App Router route files may only
 * export HTTP handlers and segment config (the activate-paid-job.ts
 * precedent).
 */
import type Stripe from 'stripe';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { alertWebhookFailure } from './webhook-support';

/** The EmployerJob behind a ledger row. B112: employerJobId is nullable (FK ON DELETE SET NULL). */
export async function employerJobForCharge(employerJobId: string | null) {
  return employerJobId
    ? prisma.employerJob.findUnique({
        where: { id: employerJobId },
        include: { job: { select: { id: true, title: true } } },
      })
    : null;
}

/**
 * Whether a full refund of this charge takes the posting down. It does when
 * the posting is left with no payment to stand on, and it does not while
 * another payment for it stands (one not refunded in full). The alerts "Two
 * paid renewals for one posting" (apply-renewal.ts) and "second payment for
 * one posting" (./route.ts) ask the operator for exactly that refund, and
 * revoking on it took down a posting the employer had paid for twice.
 *
 *   A renewal: revokes only a 'paid' posting with no other payment standing.
 *     An applied renewal always leaves the posting 'paid', so any other
 *     status means this one was never applied (the renewal cap, or a posting
 *     already revoked): refunding it changes nothing, which also keeps a
 *     'disputed' marker from being overwritten.
 *   A post fee: revokes unless the same fee was paid twice. A renewal alone
 *     does not keep a posting whose own fee went back, as before.
 *
 * The days a refunded renewal added stay on the posting: the ledger does not
 * record how many each renewal added (the renewal cap can shorten them).
 */
export async function fullRefundRevokesPosting(
  jobCharge: { id: string; type: string },
  employerJob: { id: string; paymentStatus: string },
): Promise<boolean> {
  if (jobCharge.type === 'renewal' && employerJob.paymentStatus !== 'paid') return false;
  const others = await prisma.jobCharge.findMany({
    where: { employerJobId: employerJob.id, id: { not: jobCharge.id } },
    select: { type: true, amountCents: true, refundedAmountCents: true },
  });
  const standing = others.filter((other) => (other.refundedAmountCents ?? 0) < other.amountCents);
  return jobCharge.type === 'renewal'
    ? standing.length === 0
    : !standing.some((other) => other.type === jobCharge.type);
}

/** The posting a refund or a chargeback acts on. */
export interface PostingRef {
  id: string;
  jobId: string;
}

/**
 * Take a posting down for a full refund: the status and the unpublish commit
 * together or not at all. Written one after the other, a failure between
 * them left the posting 'refunded' and still live, and the Stripe retry did
 * not always finish it: a refunded renewal reads the posting no longer
 * 'paid' and leaves it up (fullRefundRevokesPosting). Rolled back together,
 * the retry finds the posting as the first delivery did and takes it down.
 */
export async function revokeRefundedPosting(posting: PostingRef): Promise<void> {
  await prisma.$transaction([
    prisma.employerJob.update({ where: { id: posting.id }, data: { paymentStatus: 'refunded' } }),
    prisma.job.update({ where: { id: posting.jobId }, data: { isPublished: false } }),
  ]);
}

/**
 * Take a posting down for a chargeback, the status and the unpublish in one
 * transaction as for a refund. A posting already 'refunded' keeps that
 * status, and nothing is written: overwritten with 'disputed', a dispute
 * closed in our favour later restored it to 'paid' and put a refunded
 * posting back on the board (restoreWonPosting). False when nothing was
 * written.
 */
async function revokeDisputedPosting(posting: PostingRef): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.employerJob.updateMany({
      where: { id: posting.id, paymentStatus: { not: 'refunded' } },
      data: { paymentStatus: 'disputed' },
    });
    if (count === 0) return false;
    await tx.job.update({ where: { id: posting.jobId }, data: { isPublished: false } });
    return true;
  });
}

export interface WonChargebackOutcome {
  restored: boolean;
  republished: boolean;
}

/**
 * A chargeback won: 'paid' again on a posting still marked 'disputed' (a
 * later refund, or any other change, wins over the dispute outcome), and back
 * on the board while inside its run, not archived and not held by an admin
 * (lib/admin/job-hold.ts). One transaction: a restore committed on its own,
 * then a failed republish, left the Stripe retry nothing to restore (the
 * posting already 'paid'), so the posting stayed down for good. The republish
 * carries the archive and hold gates in its WHERE too, so an archive or a
 * hold landing after the read keeps the posting down.
 */
export async function restoreWonPosting(posting: PostingRef): Promise<WonChargebackOutcome> {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.employerJob.updateMany({
      where: { id: posting.id, paymentStatus: 'disputed' },
      data: { paymentStatus: 'paid' },
    });
    if (count === 0) return { restored: false, republished: false };
    const job = await tx.job.findUnique({ where: { id: posting.jobId }, select: { expiresAt: true, archivedAt: true, adminHoldAt: true } });
    const goesLive = !!job && !job.archivedAt && !job.adminHoldAt && !!job.expiresAt && job.expiresAt.getTime() > Date.now();
    if (!goesLive) return { restored: true, republished: false };
    // A revival: the posting is public again, so contentChangedAt moves
    // (sitemap lastmod; indexing audit fixSoon 5).
    const live = await tx.job.updateMany({ where: { id: posting.jobId, archivedAt: null, adminHoldAt: null }, data: { isPublished: true, contentChangedAt: new Date() } });
    return { restored: true, republished: live.count > 0 };
  });
}

/** A JobCharge row as a chargeback reads it. */
export interface DisputedCharge {
  id: string;
  employerJobId: string | null;
  amountCents: number;
  refundedAmountCents: number | null;
}

/**
 * charge.dispute.created on a payment the JobCharge ledger holds. The posting
 * comes down ('disputed'), unless the money has gone back already: this
 * payment was refunded in full, or the posting was refunded. Then the
 * posting is left as it is ('refunded' stays 'refunded' and down, a posting
 * another payment keeps up stays up), an operator is alerted to answer the
 * dispute in Stripe, and a dispute closed later finds nothing 'disputed' to
 * restore.
 */
export async function applyLedgerDispute(jobCharge: DisputedCharge, dispute: Stripe.Dispute, eventId: string): Promise<NextResponse> {
  const employerJob = await employerJobForCharge(jobCharge.employerJobId);
  if (!employerJob) {
    logger.warn('charge.dispute.created: JobCharge has no matching EmployerJob', { jobChargeId: jobCharge.id });
    return NextResponse.json({ received: true });
  }
  const chargeRefunded = (jobCharge.refundedAmountCents ?? 0) >= jobCharge.amountCents;
  if (chargeRefunded || !(await revokeDisputedPosting(employerJob))) {
    await alertDisputeOnRefundedMoney(chargeRefunded, { jobCharge, employerJob, dispute, eventId });
    return NextResponse.json({ received: true, note: 'dispute on money already refunded, posting left as it is' });
  }
  logger.warn('Chargeback: revoked posting on dispute', { employerJobId: employerJob.id, disputeId: dispute.id, amount: dispute.amount });
  return NextResponse.json({ received: true });
}

interface RefundedDispute {
  jobCharge: DisputedCharge;
  employerJob: { id: string; jobId: string; paymentStatus: string };
  dispute: Stripe.Dispute;
  eventId: string;
}

/** A chargeback on money already refunded reaches a human: the dispute is answered in Stripe. */
async function alertDisputeOnRefundedMoney(chargeRefunded: boolean, { jobCharge, employerJob, dispute, eventId }: RefundedDispute): Promise<void> {
  const reason = chargeRefunded
    ? 'Chargeback on a payment already refunded in full: answer it in Stripe with the refund as evidence'
    : 'Chargeback on a posting already refunded: it stays refunded and down, answer the dispute in Stripe';
  const extras = {
    eventId,
    disputeId: dispute.id,
    disputedCents: dispute.amount,
    jobChargeId: jobCharge.id,
    refundedCents: jobCharge.refundedAmountCents ?? 0,
    employerJobId: employerJob.id,
    jobId: employerJob.jobId,
    paymentStatus: employerJob.paymentStatus,
  };
  logger.warn(`[Stripe] ${reason}`, extras);
  await alertWebhookFailure(reason, null, extras);
}
