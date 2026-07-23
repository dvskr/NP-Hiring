/**
 * Shared activation logic for a PAID new-job checkout session (F32).
 *
 * Extracted from the `checkout.session.completed` handler in ./route.ts so
 * three callers run the exact same code and can never drift:
 *   1. The Stripe webhook (normal path)
 *   2. /api/verify-checkout-session (self-heal when Stripe says paid but the
 *      webhook was lost and the row is still paymentStatus='pending')
 *   3. The daily Inngest reconciliation sweep
 *      (lib/inngest/functions/payment-reconciliation.ts)
 *
 * Idempotency: the webhook keeps its ProcessedStripeEvent dedupe on event id.
 * Cross-path dedupe (webhook vs self-heal vs sweep have no shared event id)
 * is handled here with an atomic compare-and-set on
 * EmployerJob.paymentStatus='pending' — exactly one caller wins the claim and
 * runs the side effects (publish, JobCharge, confirmation email); every other
 * caller gets 'already_active' and does nothing. The publish flip happens
 * AFTER the claim so a refunded/disputed posting can never be silently
 * re-published by a late verify-page hit or a sweep run.
 */

import Stripe from 'stripe';
import { brand } from '@/config/brand';
import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';
import { logger } from '@/lib/logger';
import { sendConfirmationEmail } from '@/lib/email-service';
import { pingAllSearchEngines } from '@/lib/search-indexing';
import { anonymizeEmail } from '@/lib/server-utils';
import { trackServerPurchase } from '@/lib/analytics-server';

export interface StripeInvoiceData {
  stripeInvoiceId: string | null;
  invoicePdfUrl: string | null;
  hostedInvoiceUrl: string | null;
  invoiceNumber: string | null;
}

/**
 * Pull invoice URLs off a session that had `invoice_creation` enabled.
 * Returns null fields gracefully if the invoice is missing or can't be
 * fetched — payment processing must never fail because the invoice URL
 * lookup hiccupped.
 */
export async function fetchInvoiceData(
  stripeClient: Stripe,
  session: Stripe.Checkout.Session
): Promise<StripeInvoiceData> {
  const invoiceId = typeof session.invoice === 'string' ? session.invoice : session.invoice?.id ?? null;
  if (!invoiceId) {
    return { stripeInvoiceId: null, invoicePdfUrl: null, hostedInvoiceUrl: null, invoiceNumber: null };
  }
  try {
    const invoice = await stripeClient.invoices.retrieve(invoiceId);
    return {
      stripeInvoiceId: invoice.id ?? invoiceId,
      invoicePdfUrl: invoice.invoice_pdf ?? null,
      hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
      invoiceNumber: invoice.number ?? null,
    };
  } catch (invErr) {
    logger.error('Failed to retrieve Stripe invoice for JobCharge', invErr, { invoiceId, sessionId: session.id });
    return { stripeInvoiceId: invoiceId, invoicePdfUrl: null, hostedInvoiceUrl: null, invoiceNumber: null };
  }
}

export type PaidJobActivationOutcome = 'activated' | 'already_active' | 'employer_job_missing';

export interface PaidJobActivationResult {
  outcome: PaidJobActivationOutcome;
  jobId: string;
}

function prismaErrorCode(err: unknown): string | undefined {
  return (err as { code?: string } | null)?.code;
}

/**
 * Record the JobCharge for a paid session if the winner of the activation
 * claim crashed before writing it. Best-effort — never throws.
 */
async function ensureJobChargeRecorded(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
  employerJobId: string,
): Promise<void> {
  try {
    const existing = await prisma.jobCharge.findFirst({
      where: { stripeSessionId: session.id },
      select: { id: true },
    });
    if (existing) return;

    const invoiceData = await fetchInvoiceData(stripe, session);
    await prisma.jobCharge.create({
      data: {
        employerJobId,
        stripeSessionId: session.id,
        stripePaymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : null,
        amountCents: session.amount_total ?? config.stripePriceInCents,
        currency: session.currency ?? 'usd',
        type: 'new',
        ...invoiceData,
      },
    });
    logger.info('Backfilled missing JobCharge for already-active paid session', {
      sessionId: session.id,
      employerJobId,
    });
  } catch (err) {
    if (prismaErrorCode(err) !== 'P2002') {
      logger.error('Failed to backfill JobCharge for paid session', err, { sessionId: session.id });
    }
  }
}

/**
 * Activate a NEW job posting whose checkout session Stripe reports as paid.
 *
 * Callers MUST have verified `session.payment_status === 'paid'` and that the
 * session is not a renewal/upgrade (`session.metadata.type`).
 *
 * DB errors propagate to the caller: the webhook turns them into a 500 (+
 * dedupe rollback) so Stripe retries; the self-heal and sweep callers catch,
 * log, and alert.
 */
export async function activatePaidJobCheckout(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
): Promise<PaidJobActivationResult> {
  const jobId = session.metadata?.jobId;
  if (!jobId) {
    throw new Error(`Checkout session ${session.id} has no jobId metadata`);
  }

  const employerJob = await prisma.employerJob.findFirst({
    where: { jobId },
  });

  if (!employerJob) {
    // C3: a missing EmployerJob row must surface loudly instead of being
    // skipped — the webhook returns 500 (with dedupe rollback) so Stripe
    // redelivers and transient read-after-write lag can self-heal.
    return { outcome: 'employer_job_missing', jobId };
  }

  const paidTier = session.metadata?.pricing || 'pro';

  // Atomic claim: exactly one of {webhook, verify self-heal, sweep} flips
  // pending → paid. Prisma ≥5 allows non-unique filters in `update` where;
  // P2025 = no row matched = someone else already claimed it (or the row is
  // refunded/disputed and must stay that way).
  try {
    await prisma.employerJob.update({
      where: { id: employerJob.id, paymentStatus: 'pending' },
      data: { paymentStatus: 'paid', pricingTier: paidTier },
    });
  } catch (claimErr) {
    if (prismaErrorCode(claimErr) === 'P2025') {
      const current = await prisma.employerJob.findUnique({
        where: { id: employerJob.id },
        select: { paymentStatus: true },
      });
      if (current?.paymentStatus === 'paid') {
        // The winner may have crashed between the claim and the ledger
        // write — make sure the charge is recorded either way.
        await ensureJobChargeRecorded(stripe, session, employerJob.id);
      }
      logger.info('Paid checkout already activated by another path — skipping side effects', {
        jobId,
        sessionId: session.id,
        paymentStatus: current?.paymentStatus,
      });
      return { outcome: 'already_active', jobId };
    }
    throw claimErr;
  }

  // Publish AFTER winning the claim — republish on webhook retry is
  // idempotent, but a refunded/disputed row never reaches this line.
  const job = await prisma.job.update({
    where: { id: jobId },
    data: { isPublished: true, isVerifiedEmployer: true },
  });

  // Audit #2: record JobCharge for the new-post payment.
  // Audit #28: also persist payment_intent so the refund webhook can
  // match `charge.refunded` events back to this JobCharge row.
  const newPostInvoiceData = await fetchInvoiceData(stripe, session);
  try {
    await prisma.jobCharge.create({
      data: {
        employerJobId: employerJob.id,
        stripeSessionId: session.id,
        stripePaymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : null,
        amountCents: session.amount_total ?? config.stripePriceInCents,
        currency: session.currency ?? 'usd',
        type: 'new',
        ...newPostInvoiceData,
      },
    });
  } catch (chargeErr) {
    // Idempotency on stripeSessionId — duplicate webhooks shouldn't fail the flow.
    if (prismaErrorCode(chargeErr) !== 'P2002') {
      logger.error('Failed to record JobCharge for new post', chargeErr, { jobId });
    }
  }

  // Send confirmation email.
  //
  // 2026-05-15 fix: this fires BEFORE Stripe transitions the invoice to
  // "paid". If we pass `invoicePdfUrl` directly, the recipient may download
  // an "amount due" PDF. Instead, link to our dashboard invoice endpoint —
  // it 302-redirects to whatever URL is currently in JobCharge.invoicePdfUrl.
  // The `invoice.paid` handler updates that URL within a few hundred ms.
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? '';
  const stableInvoiceUrl = baseUrl
    ? `${baseUrl}/api/employer/invoice?jobId=${job.id}&token=${employerJob.dashboardToken}`
    : null;

  try {
    await sendConfirmationEmail(
      employerJob.contactEmail,
      job.title,
      job.id,
      employerJob.dashboardToken,
      undefined, // unsubscribeToken — sendConfirmationEmail looks it up by email
      undefined, // durationDays — paid posts use config.durationDays default
      {
        invoicePdfUrl: stableInvoiceUrl,
        hostedInvoiceUrl: newPostInvoiceData.hostedInvoiceUrl,
        invoiceNumber: newPostInvoiceData.invoiceNumber,
      }
    );
  } catch (emailError) {
    logger.error('Failed to send confirmation email', emailError, { jobId });
    // Don't throw - job already activated
  }

  // Clean up any job drafts for this email (no longer needed)
  try {
    const deletedDrafts = await prisma.jobDraft.deleteMany({
      where: { email: employerJob.contactEmail },
    });
    if (deletedDrafts.count > 0) {
      const anonymizedEmail = anonymizeEmail(employerJob.contactEmail);
      logger.debug('Deleted drafts', { count: deletedDrafts.count, email: anonymizedEmail });
    }
  } catch (draftError) {
    logger.error('Failed to delete job drafts', draftError, { jobId });
    // Don't throw - job already activated
  }

  logger.info('Job published', { jobId });

  // P7: server-side purchase event (fire-and-forget)
  trackServerPurchase({
    clientId: jobId,
    sessionId: session.id,
    amountCents: session.amount_total ?? config.stripePriceInCents,
    currency: session.currency ?? 'usd',
    type: 'new',
    tier: session.metadata?.pricing,
    jobId,
  }).catch(() => { /* logged inside */ });

  // Ping search engines for new job (fire-and-forget)
  if (job.slug) {
    pingAllSearchEngines(`${brand.baseUrl}/jobs/${job.slug}`).catch((err) =>
      logger.error('[Stripe] Background indexing ping failed (new job)', err)
    );
  }

  return { outcome: 'activated', jobId };
}
