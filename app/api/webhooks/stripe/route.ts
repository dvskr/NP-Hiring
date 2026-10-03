import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';
import {
  sendRefundConfirmationEmail,
  getOrCreateUnsubToken,
} from '@/lib/email-service';
import { logger } from '@/lib/logger';
import { activatePaidJobCheckout } from './activate-paid-job';
import { applyRenewalCheckout } from './apply-renewal';
import { handlePlanAsyncPaymentFailed, handlePlanCheckout } from './plan-checkout';
import { applySubscriptionEvent, handlePlanInvoicePaymentFailed, type SubscriptionEventType } from './plan-subscription';
import {
  alertWebhookFailure,
  claimEmailSend,
  prismaErrorCode,
  releaseEmailClaim,
} from './webhook-support';

/**
 * Stripe webhook. Event handling lives in sibling modules so the verify-page
 * self-heals and the Inngest sweeps can run the exact same code:
 *   activate-paid-job.ts — new paid posts
 *   apply-renewal.ts     — renewals
 *   plan-checkout.ts     — Employer plan checkout
 *   plan-subscription.ts — Employer plan subscription lifecycle + dunning
 *   webhook-support.ts   — alerting (Sentry + Discord), email claims, helpers
 *
 * Required endpoint events (tmp/stripe-bootstrap.js EVENTS, .env.example):
 *   checkout.session.completed, checkout.session.async_payment_succeeded,
 *   checkout.session.async_payment_failed, invoice.paid,
 *   invoice.payment_failed, charge.refunded, charge.dispute.created,
 *   charge.dispute.closed, customer.subscription.created/updated/deleted.
 */

// The handler makes several Stripe + DB round trips and an email send before
// responding; give it headroom so a slow dependency is not a platform kill
// mid-processing (which no catch block can clean up after).
export const maxDuration = 60;

/**
 * A 'processing' dedupe row older than this is a delivery that died without
 * running any catch block (function timeout, OOM, instance shutdown). A
 * Stripe retry may take it over instead of being acknowledged as a duplicate.
 *
 * Derived from maxDuration: no live delivery can hold its claim longer than
 * the platform lets the function run, so anything older is dead. The margin
 * covers clock skew between the database and the instances that stamp
 * claimedAt and compute the cutoff. A longer window only means a retry that
 * lands after the kill but inside the window is acknowledged as a duplicate
 * and the event is lost.
 */
const DEDUPE_RECLAIM_MARGIN_MS = 30 * 1000;
const DEDUPE_RECLAIM_AFTER_MS = maxDuration * 1000 + DEDUPE_RECLAIM_MARGIN_MS;

type CleanupDedupe = () => Promise<void>;

/** Alert, roll back the dedupe row so Stripe's retry replays, and 500. */
async function failAndRetry(
  cleanupDedupe: CleanupDedupe,
  reason: string,
  err: unknown,
  extras: Record<string, string | number | undefined>,
  message: string,
): Promise<NextResponse> {
  await alertWebhookFailure(reason, err, extras);
  await cleanupDedupe();  // C2: let Stripe retry succeed
  return NextResponse.json({ error: message }, { status: 500 });
}

/**
 * P2002 on the dedupe insert: either the event was (or is being) processed —
 * acknowledge — or a previous delivery died mid-flight and left a stale
 * 'processing' claim, which this delivery takes over. The conditional
 * update is atomic, so two concurrent retries cannot both reclaim.
 */
async function reclaimStaleDedupe(eventId: string): Promise<boolean> {
  const reclaimed = await prisma.processedStripeEvent.updateMany({
    where: { eventId, status: 'processing', claimedAt: { lt: new Date(Date.now() - DEDUPE_RECLAIM_AFTER_MS) } },
    data: { claimedAt: new Date() },
  });
  return (reclaimed?.count ?? 0) > 0;
}

/** Second phase of the claim: the delivery succeeded (or will never succeed on retry). Best-effort. */
async function markDedupeDone(eventId: string): Promise<void> {
  try {
    await prisma.processedStripeEvent.updateMany({ where: { eventId }, data: { status: 'done' } });
  } catch (err) {
    logger.error('[Stripe] Failed to mark dedupe row done — a later retry could reprocess after the reclaim window', err, { eventId });
  }
}

export async function POST(request: NextRequest) {
  // C2 fix (2026-06-01): tracks whether the idempotency row was committed
  // so the outer catch can roll it back. Without this, an uncaught exception
  // after the dedupe row was written leaves Stripe's retry permanently
  // blocked (P2002 → "deduped"), losing money silently.
  let dedupedEventId: string | null = null;
  try {
    const stripe = getStripe();
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!stripe || !webhookSecret) {
      logger.error('Stripe webhook called but STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET is missing', null);
      return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });
    }

    // Get raw body for signature verification
    const body = await request.text();
    const signature = request.headers.get('stripe-signature')!;

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err) {
      logger.error('Webhook signature verification failed', err);
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    // Audit #3 + two-phase claim: insert 'processing', flip to 'done' after
    // the handler answers. Every 500 path deletes the row (cleanupDedupe) so
    // Stripe's retry replays; a delivery that dies without a catch leaves a
    // stale 'processing' row that the next retry reclaims.
    try {
      await prisma.processedStripeEvent.create({
        data: { eventId: event.id, eventType: event.type, status: 'processing' },
      });
      dedupedEventId = event.id;  // C2: enable outer-catch rollback
    } catch (dedupeErr) {
      // Prisma P2002 = unique constraint violation → already claimed.
      // Any other error → log and bail conservatively (Stripe will retry).
      const code = prismaErrorCode(dedupeErr);
      const alreadyClaimed = code === 'P2002';
      if (!alreadyClaimed) {
        logger.error('Failed to record processed Stripe event', dedupeErr, { eventId: event.id });
        await alertWebhookFailure('Idempotency check failed', dedupeErr, { eventId: event.id, eventType: event.type });
        return NextResponse.json({ error: 'Idempotency check failed' }, { status: 500 });
      }
      if (!(await reclaimStaleDedupe(event.id))) {
        logger.info('Stripe webhook event already processed; skipping', { eventId: event.id, eventType: event.type });
        return NextResponse.json({ received: true, deduped: true });
      }
      logger.warn('[Stripe] Reclaimed a stale processing claim — previous delivery died mid-flight', { eventId: event.id, eventType: event.type });
      dedupedEventId = event.id;
    }

    // Remove the dedupe row so Stripe will redeliver. If the deletion itself
    // fails, the worst case is Stripe's retry hitting P2002 — alert a human.
    const cleanupDedupe: CleanupDedupe = async () => {
      try {
        await prisma.processedStripeEvent.delete({ where: { eventId: event.id } });
      } catch (cleanupErr) {
        logger.error('[Stripe] Failed to roll back dedupe row before 500 — Stripe retry may be silently dropped', cleanupErr, { eventId: event.id });
        await alertWebhookFailure('Dedupe rollback failed — Stripe retry may be silently dropped', cleanupErr, { eventId: event.id, eventType: event.type });
      }
    };

    const response = await processEvent(stripe, event, cleanupDedupe);
    if (response.status < 500) await markDedupeDone(event.id);
    return response;
  } catch (error) {
    logger.error('Webhook error', error);
    await alertWebhookFailure('Unhandled webhook error', error, { eventId: dedupedEventId ?? undefined });
    // C2: roll back the idempotency row so Stripe's retry actually runs.
    if (dedupedEventId) {
      try {
        await prisma.processedStripeEvent.delete({ where: { eventId: dedupedEventId } });
      } catch (cleanupErr) {
        logger.error('[Stripe] Failed to roll back dedupe row in outer catch — Stripe retry may be silently dropped', cleanupErr, { eventId: dedupedEventId });
        await alertWebhookFailure('Dedupe rollback failed in outer catch — Stripe retry may be silently dropped', cleanupErr, { eventId: dedupedEventId });
      }
    }
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
  }
}

async function processEvent(stripe: Stripe, event: Stripe.Event, cleanupDedupe: CleanupDedupe): Promise<NextResponse> {
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      return handleCheckoutSessionPaid(stripe, event, event.data.object as Stripe.Checkout.Session, cleanupDedupe);
    case 'checkout.session.async_payment_failed':
      return handleCheckoutSessionPaymentFailed(event, event.data.object as Stripe.Checkout.Session, cleanupDedupe);
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      return handleSubscriptionEvent(stripe, event, event.data.object as Stripe.Subscription, cleanupDedupe);
    case 'invoice.paid':
      return handleInvoicePaid(event, event.data.object as Stripe.Invoice, cleanupDedupe);
    case 'invoice.payment_failed':
      return handleInvoicePaymentFailed(event, event.data.object as Stripe.Invoice, cleanupDedupe);
    case 'charge.refunded':
      return handleChargeRefunded(event, event.data.object as Stripe.Charge, cleanupDedupe);
    case 'charge.dispute.created':
      return handleDisputeCreated(event, event.data.object as Stripe.Dispute, cleanupDedupe);
    case 'charge.dispute.closed':
      return handleDisputeClosed(event, event.data.object as Stripe.Dispute, cleanupDedupe);
    default:
      // customer.subscription.created is intentionally a no-op: the checkout
      // session creates the plan row from the retrieved subscription.
      return NextResponse.json({ received: true });
  }
}

/**
 * checkout.session.completed and checkout.session.async_payment_succeeded.
 * Delayed-notification payment methods complete the session while it is
 * still 'unpaid'; fulfilment waits for async_payment_succeeded (a different
 * event id, so the ProcessedStripeEvent dedupe never collapses the two).
 */
async function handleCheckoutSessionPaid(
  stripe: Stripe,
  event: Stripe.Event,
  session: Stripe.Checkout.Session,
  cleanupDedupe: CleanupDedupe,
): Promise<NextResponse> {
  // Employer plan (Payment Link, subscription mode). Checked FIRST: these
  // sessions carry no jobId, so they must never reach the "Missing job ID"
  // 400 below or the per-post paths. The plan handler applies its own
  // payment_status rule (unsettled → 'pending', never entitled).
  if (session.mode === 'subscription') {
    try {
      const result = await handlePlanCheckout(stripe, session, { eventId: event.id, eventCreated: event.created });
      return NextResponse.json({ received: true, plan: result.outcome });
    } catch (planErr) {
      logger.error('[Stripe] Employer plan checkout processing failed', planErr, { sessionId: session.id });
      return failAndRetry(cleanupDedupe, 'Employer plan checkout failed', planErr, { eventId: event.id, sessionId: session.id }, 'Failed to activate employer plan');
    }
  }

  const jobId = session.metadata?.jobId;
  if (!jobId) {
    logger.error('No job ID in session metadata', null, { sessionId: session.id });
    // 400 is intentional — bad payload won't get better on retry.
    return NextResponse.json({ error: 'Missing job ID' }, { status: 400 });
  }

  // Money gate for every per-post path (new post AND renewal): nothing is
  // published, extended or ledgered until Stripe says the money arrived.
  if (session.payment_status !== 'paid') {
    logger.info('[Stripe] checkout completed but payment not settled; deferring fulfillment', {
      sessionId: session.id, jobId, paymentStatus: session.payment_status,
    });
    if (session.payment_status === 'no_payment_required') {
      await alertWebhookFailure('Per-post checkout completed with no payment required — not fulfilled', null, {
        eventId: event.id, jobId, sessionId: session.id,
      });
    }
    return NextResponse.json({ received: true, deferred: true });
  }

  if (session.metadata?.type === 'renewal') {
    return handleRenewalPaid(stripe, event, session, jobId, cleanupDedupe);
  }

  // New job posting. F32: the publish/charge/email logic lives in
  // ./activate-paid-job.ts, shared with the verify-checkout-session self-heal
  // and the daily reconciliation sweep so the three paths can never drift.
  try {
    const activation = await activatePaidJobCheckout(stripe, session);

    if (activation.outcome === 'employer_job_missing') {
      // C3: a missing EmployerJob row must not be skipped silently — 500 so
      // Stripe redelivers and read-after-write lag can self-heal.
      logger.error('[Stripe] EmployerJob not found for paid checkout — returning 500 so Stripe retries', undefined, { jobId, sessionId: session.id });
      return failAndRetry(cleanupDedupe, 'EmployerJob missing for paid checkout', null, { eventId: event.id, jobId, sessionId: session.id }, 'EmployerJob not found for paid session');
    }
    if (activation.outcome === 'duplicate_payment') {
      // Retrying cannot help and the charge is already on the ledger — keep
      // the dedupe row, acknowledge, and page a human to refund.
      await alertWebhookFailure('second payment for one posting — refund required', null, {
        eventId: event.id,
        jobId,
        sessionId: session.id,
        paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : undefined,
        amountCents: session.amount_total ?? undefined,
      });
      return NextResponse.json({ received: true, note: 'duplicate payment — refund required' });
    }
    if (activation.outcome === 'already_active') {
      logger.info('[Stripe] Checkout already activated by another path', { jobId, sessionId: session.id });
    }
    // Paid and claimed, but archived while the checkout was open: not live
    // until the employer restores it. Said in the acknowledgement, so the
    // delivery log in Stripe shows it.
    if (activation.leftArchived) return NextResponse.json({ received: true, leftArchived: true });
  } catch (activationErr) {
    logger.error('Error updating job in database', activationErr, { jobId });
    return failAndRetry(cleanupDedupe, 'New-post activation failed', activationErr, { eventId: event.id, jobId, sessionId: session.id }, 'Failed to update job');
  }
  return NextResponse.json({ received: true });
}

async function handleRenewalPaid(
  stripe: Stripe,
  event: Stripe.Event,
  session: Stripe.Checkout.Session,
  jobId: string,
  cleanupDedupe: CleanupDedupe,
): Promise<NextResponse> {
  try {
    const result = await applyRenewalCheckout(stripe, session);
    if (result.outcome === 'employer_job_missing') {
      logger.error('Renewal webhook: EmployerJob not found for paid job', null, { jobId, sessionId: session.id });
      return failAndRetry(cleanupDedupe, 'EmployerJob missing for paid renewal', null, { eventId: event.id, jobId, sessionId: session.id }, 'EmployerJob record missing for renewed job');
    }
    if (result.outcome === 'revoked_posting') {
      // Never re-publish a refunded/disputed posting. The charge is on the
      // ledger; keep the dedupe row so Stripe does not retry.
      logger.warn('[Stripe] Renewal paid on a refunded/disputed posting — not applied', {
        jobId, sessionId: session.id, status: result.revokedStatus,
      });
      await alertWebhookFailure('Renewal paid on revoked posting', null, {
        eventId: event.id, jobId, sessionId: session.id, status: result.revokedStatus,
      });
      return NextResponse.json({ received: true, note: 'renewal on revoked posting — refund required' });
    }
    if (result.outcome === 'cap_reached') {
      // The post is at its renewal cap, so nothing was applied. The charge
      // is on the ledger and apply-renewal.ts raised the refund alert; keep
      // the dedupe row so Stripe does not retry.
      return NextResponse.json({ received: true, note: 'renewal at the renewal limit, not applied, refund required' });
    }
    // leftArchived: applied, but the post stays unpublished until restored.
    return NextResponse.json({ received: true, ...(result.leftArchived && { leftArchived: true }) });
  } catch (renewalErr) {
    logger.error('Error renewing job in database', renewalErr, { jobId });
    return failAndRetry(cleanupDedupe, 'Renewal processing failed', renewalErr, { eventId: event.id, jobId, sessionId: session.id }, 'Failed to renew job');
  }
}

/**
 * checkout.session.async_payment_failed — a delayed payment never arrived.
 * Per-post rows stay 'pending' (the dashboard's "Complete payment" action
 * and the reconciliation sweep's expiry both still apply); plan rows stay
 * non-entitled. Always surfaced to a human.
 */
async function handleCheckoutSessionPaymentFailed(
  event: Stripe.Event,
  session: Stripe.Checkout.Session,
  cleanupDedupe: CleanupDedupe,
): Promise<NextResponse> {
  try {
    if (session.mode === 'subscription') {
      const result = await handlePlanAsyncPaymentFailed(session, event.id);
      return NextResponse.json({ received: true, plan: result.outcome });
    }
    logger.warn('[Stripe] delayed checkout payment failed — posting left unpaid', {
      sessionId: session.id, jobId: session.metadata?.jobId, type: session.metadata?.type,
    });
    await alertWebhookFailure('Delayed checkout payment failed — nothing fulfilled', null, {
      eventId: event.id, sessionId: session.id, jobId: session.metadata?.jobId, type: session.metadata?.type ?? 'new',
    });
    return NextResponse.json({ received: true });
  } catch (failedErr) {
    logger.error('[Stripe] Error handling async_payment_failed', failedErr, { sessionId: session.id });
    return failAndRetry(cleanupDedupe, 'checkout.session.async_payment_failed handler failed', failedErr, { eventId: event.id }, 'Failed to handle failed payment');
  }
}

/**
 * customer.subscription.updated / .deleted. The plan takes the LIVE
 * subscription, re-read from Stripe, not this payload: event.created has
 * one-second precision, so same-second events cannot be ordered by it
 * (plan-subscription.ts#applySubscriptionEvent). A failed read throws into
 * the catch below: 500 and the dedupe row is dropped, so Stripe retries.
 */
async function handleSubscriptionEvent(
  stripe: Stripe,
  event: Stripe.Event,
  subscription: Stripe.Subscription,
  cleanupDedupe: CleanupDedupe,
): Promise<NextResponse> {
  try {
    const result = await applySubscriptionEvent(
      stripe,
      subscription,
      event.type as SubscriptionEventType,
      { eventId: event.id },
    );
    return NextResponse.json({ received: true, plan: result.outcome, status: result.status });
  } catch (subErr) {
    logger.error('[Stripe] Error handling subscription webhook', subErr, { eventType: event.type });
    return failAndRetry(cleanupDedupe, `${event.type} handler failed`, subErr, { eventId: event.id }, 'Failed to update employer plan');
  }
}

/**
 * invoice.paid — refresh the JobCharge's invoice URLs. At
 * checkout.session.completed the invoice is still `open` (the PDF says "amount
 * due"); Stripe regenerates the PDF when it transitions to `paid`.
 */
async function handleInvoicePaid(event: Stripe.Event, invoice: Stripe.Invoice, cleanupDedupe: CleanupDedupe): Promise<NextResponse> {
  try {
    const invoiceId = invoice.id;
    if (!invoiceId) {
      logger.warn('invoice.paid: invoice has no id', { eventId: event.id });
      return NextResponse.json({ received: true });
    }
    const jobCharge = await prisma.jobCharge.findFirst({ where: { stripeInvoiceId: invoiceId }, select: { id: true } });
    if (!jobCharge) {
      // Not all invoices belong to a JobCharge (plan invoices, one-offs).
      logger.info('invoice.paid: no matching JobCharge — skipping', { invoiceId });
      return NextResponse.json({ received: true });
    }
    await prisma.jobCharge.update({
      where: { id: jobCharge.id },
      data: {
        invoicePdfUrl: invoice.invoice_pdf ?? null,
        hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
        invoiceNumber: invoice.number ?? null,
      },
    });
    logger.info('JobCharge invoice URLs refreshed after invoice.paid', { jobChargeId: jobCharge.id, invoiceId });
    return NextResponse.json({ received: true });
  } catch (invErr) {
    logger.error('Error handling invoice.paid webhook', invErr);
    return failAndRetry(cleanupDedupe, 'invoice.paid handler failed', invErr, { eventId: event.id }, 'Failed to refresh invoice URLs');
  }
}

/** invoice.payment_failed — dunning notice for Employer plan subscriptions; per-post invoices are ignored. */
async function handleInvoicePaymentFailed(event: Stripe.Event, invoice: Stripe.Invoice, cleanupDedupe: CleanupDedupe): Promise<NextResponse> {
  try {
    const result = await handlePlanInvoicePaymentFailed(invoice);
    return NextResponse.json({ received: true, plan: result.outcome });
  } catch (failErr) {
    logger.error('Error handling invoice.payment_failed webhook', failErr);
    return failAndRetry(cleanupDedupe, 'invoice.payment_failed handler failed', failErr, { eventId: event.id }, 'Failed to handle invoice payment failure');
  }
}

/** The EmployerJob behind a ledger row. B112: employerJobId is nullable (FK ON DELETE SET NULL). */
async function employerJobForCharge(employerJobId: string | null) {
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
 * one posting" above ask the operator for exactly that refund, and revoking
 * on it took down a posting the employer had paid for twice.
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
async function fullRefundRevokesPosting(
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

/**
 * Audit #28: charge.refunded — updates the JobCharge ledger, flips a FULL
 * refund to 'refunded' + unpublishes when no other payment for the posting
 * stands (fullRefundRevokesPosting), and sends a confirmation email.
 */
async function handleChargeRefunded(event: Stripe.Event, charge: Stripe.Charge, cleanupDedupe: CleanupDedupe): Promise<NextResponse> {
  try {
    const paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : null;
    if (!paymentIntentId) {
      logger.warn('charge.refunded webhook with no payment_intent — cannot match to JobCharge', { chargeId: charge.id });
      return NextResponse.json({ received: true, note: 'no payment_intent' });
    }

    const jobCharge = await prisma.jobCharge.findUnique({ where: { stripePaymentIntentId: paymentIntentId } });
    if (!jobCharge) {
      // Pre-audit-#28 charges don't have payment_intent persisted, OR the
      // refund is for a charge that originated outside our flow.
      logger.warn('charge.refunded: no matching JobCharge — pre-#28 row or external charge', { paymentIntentId, chargeId: charge.id });
      return NextResponse.json({ received: true, note: 'no matching JobCharge' });
    }

    const refundedAmount = charge.amount_refunded ?? 0;
    const isPartial = refundedAmount > 0 && refundedAmount < jobCharge.amountCents;
    const isFullRefund = refundedAmount >= jobCharge.amountCents;
    const latestRefund = charge.refunds?.data?.[0];
    const refundReason = latestRefund?.reason ?? null;

    await prisma.jobCharge.update({
      where: { id: jobCharge.id },
      data: { refundedAt: new Date(), refundedAmountCents: refundedAmount, refundReason },
    });

    const employerJob = await employerJobForCharge(jobCharge.employerJobId);
    let entitlementRetained = !isFullRefund;
    if (employerJob) {
      // Only a FULL refund revokes entitlement. A partial/goodwill refund
      // must leave paymentStatus='paid' — otherwise the customer keeps a live
      // job but loses invoice/receipt downloads and can never republish.
      if (isFullRefund) {
        if (await fullRefundRevokesPosting(jobCharge, employerJob)) {
          await prisma.employerJob.update({ where: { id: employerJob.id }, data: { paymentStatus: 'refunded' } });
          await prisma.job.update({ where: { id: employerJob.jobId }, data: { isPublished: false } });
        } else {
          entitlementRetained = true;
          logger.warn('charge.refunded: full refund of one payment, the posting keeps its entitlement', {
            employerJobId: employerJob.id, jobChargeId: jobCharge.id, type: jobCharge.type, paymentStatus: employerJob.paymentStatus,
          });
        }
      } else if (isPartial) {
        logger.info('charge.refunded: partial refund — entitlement retained', {
          employerJobId: employerJob.id, refundedAmount, totalCents: jobCharge.amountCents,
        });
      }

      // B109: keyed on the refund id so each distinct partial refund gets its
      // own email, but a redelivery of the same refund never double-sends.
      const refundEmailKey = `refund-confirmation:${latestRefund?.id ?? `${charge.id}:${refundedAmount}`}`;
      if (await claimEmailSend(refundEmailKey, employerJob.contactEmail, 'refund_confirmation')) {
        try {
          const unsubToken = await getOrCreateUnsubToken(employerJob.contactEmail);
          await sendRefundConfirmationEmail(
            employerJob.contactEmail,
            employerJob.job?.title ?? 'your job posting',
            refundedAmount,
            isPartial,
            unsubToken,
          );
        } catch (emailErr) {
          logger.error('Failed to send refund confirmation email', emailErr, { jobChargeId: jobCharge.id });
          await releaseEmailClaim(refundEmailKey);
        }
      } else {
        logger.info('Refund confirmation email already sent for this refund — skipping duplicate', { jobChargeId: jobCharge.id });
      }
    } else {
      logger.warn('charge.refunded: JobCharge has no matching EmployerJob — orphaned ledger row', { jobChargeId: jobCharge.id });
    }

    logger.info('Refund processed', { jobChargeId: jobCharge.id, refundedAmount, isPartial, isFullRefund, entitlementRetained, paymentIntentId });
    return NextResponse.json({ received: true });
  } catch (refundErr) {
    logger.error('Error handling charge.refunded webhook', refundErr);
    return failAndRetry(cleanupDedupe, 'charge.refunded handler failed', refundErr, { eventId: event.id }, 'Failed to handle refund');
  }
}

/**
 * Chargeback: the bank pulls the funds and Stripe does NOT emit
 * charge.refunded. Revoke entitlement (unpublish + mark 'disputed', which the
 * invoice/receipt routes, toggle-publish and renewal checkout treat as non-paid).
 */
async function handleDisputeCreated(event: Stripe.Event, dispute: Stripe.Dispute, cleanupDedupe: CleanupDedupe): Promise<NextResponse> {
  try {
    const paymentIntentId = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : null;
    if (!paymentIntentId) {
      logger.warn('charge.dispute.created with no payment_intent — cannot match to JobCharge', { disputeId: dispute.id });
      return NextResponse.json({ received: true, note: 'no payment_intent' });
    }
    const jobCharge = await prisma.jobCharge.findUnique({ where: { stripePaymentIntentId: paymentIntentId } });
    if (!jobCharge) {
      logger.warn('charge.dispute.created: no matching JobCharge', { paymentIntentId, disputeId: dispute.id });
      return NextResponse.json({ received: true, note: 'no matching JobCharge' });
    }
    const employerJob = await employerJobForCharge(jobCharge.employerJobId);
    if (employerJob) {
      await prisma.employerJob.update({ where: { id: employerJob.id }, data: { paymentStatus: 'disputed' } });
      await prisma.job.update({ where: { id: employerJob.jobId }, data: { isPublished: false } });
      logger.warn('Chargeback: revoked posting on dispute', { employerJobId: employerJob.id, disputeId: dispute.id, amount: dispute.amount });
    } else {
      logger.warn('charge.dispute.created: JobCharge has no matching EmployerJob', { jobChargeId: jobCharge.id });
    }
    return NextResponse.json({ received: true });
  } catch (disputeErr) {
    logger.error('Error handling charge.dispute.created webhook', disputeErr);
    return failAndRetry(cleanupDedupe, 'charge.dispute.created handler failed', disputeErr, { eventId: event.id }, 'Failed to handle dispute');
  }
}

/**
 * charge.dispute.closed — the other half of the chargeback lifecycle.
 *   won  → the funds came back: restore 'paid' on a still-'disputed' posting
 *          and re-publish it if its listing window has not ended.
 *   lost → record the lost funds on the ledger (refund columns,
 *          refundReason 'dispute_lost'); the posting stays revoked.
 */
async function handleDisputeClosed(event: Stripe.Event, dispute: Stripe.Dispute, cleanupDedupe: CleanupDedupe): Promise<NextResponse> {
  try {
    const paymentIntentId = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : null;
    const jobCharge = paymentIntentId
      ? await prisma.jobCharge.findUnique({ where: { stripePaymentIntentId: paymentIntentId } })
      : null;
    if (!jobCharge) {
      logger.warn('charge.dispute.closed: no matching JobCharge', { paymentIntentId: paymentIntentId ?? undefined, disputeId: dispute.id });
      return NextResponse.json({ received: true, note: 'no matching JobCharge' });
    }

    if (dispute.status === 'lost') {
      await prisma.jobCharge.update({
        where: { id: jobCharge.id },
        data: { refundedAt: new Date(), refundedAmountCents: dispute.amount, refundReason: 'dispute_lost' },
      });
      logger.warn('Chargeback lost — recorded on the ledger', { jobChargeId: jobCharge.id, disputeId: dispute.id, amount: dispute.amount });
      return NextResponse.json({ received: true, dispute: 'lost' });
    }
    if (dispute.status !== 'won') {
      logger.info('charge.dispute.closed with a non-final outcome — no entitlement change', { disputeId: dispute.id, status: dispute.status });
      return NextResponse.json({ received: true });
    }

    const employerJob = jobCharge.employerJobId
      ? await prisma.employerJob.findUnique({ where: { id: jobCharge.employerJobId }, select: { id: true, jobId: true } })
      : null;
    if (!employerJob) {
      return NextResponse.json({ received: true, dispute: 'won' });
    }
    // Only a posting still marked 'disputed' is restored — a later refund or
    // any other state change wins over the dispute outcome.
    const restored = await prisma.employerJob.updateMany({
      where: { id: employerJob.id, paymentStatus: 'disputed' },
      data: { paymentStatus: 'paid' },
    });
    let republished = false;
    if (restored.count > 0) {
      const job = await prisma.job.findUnique({ where: { id: employerJob.jobId }, select: { expiresAt: true, archivedAt: true } });
      if (job && !job.archivedAt && job.expiresAt && job.expiresAt.getTime() > Date.now()) {
        // A revival: the posting is public again, so contentChangedAt moves
        // (sitemap lastmod; indexing audit fixSoon 5).
        await prisma.job.update({ where: { id: employerJob.jobId }, data: { isPublished: true, contentChangedAt: new Date() } });
        republished = true;
      }
    }
    logger.info('Chargeback won — posting restored', { employerJobId: employerJob.id, disputeId: dispute.id, restored: restored.count > 0, republished });
    return NextResponse.json({ received: true, dispute: 'won', restored: restored.count > 0, republished });
  } catch (closedErr) {
    logger.error('Error handling charge.dispute.closed webhook', closedErr);
    return failAndRetry(cleanupDedupe, 'charge.dispute.closed handler failed', closedErr, { eventId: event.id }, 'Failed to handle dispute close');
  }
}
