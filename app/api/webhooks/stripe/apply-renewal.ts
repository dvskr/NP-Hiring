/**
 * Shared fulfilment for a PAID renewal checkout session (+config.durationDays
 * on an existing posting).
 *
 * Three callers run exactly this code, like activate-paid-job.ts does for new
 * posts:
 *   1. the Stripe webhook (`checkout.session.completed` /
 *      `checkout.session.async_payment_succeeded`, metadata.type 'renewal');
 *   2. /api/verify-renewal-session (self-heal when Stripe says paid but no
 *      JobCharge exists for the session — the webhook was lost);
 *   3. the daily payment reconciliation sweep.
 *
 * Idempotency across paths: the JobCharge row (unique stripeSessionId) is
 * inserted FIRST inside one interactive transaction, before the expiry is
 * extended. Two paths racing on one session cannot both commit — the loser
 * hits P2002, its transaction rolls back, and it returns 'already_applied' —
 * so the expiry is never extended twice.
 *
 * Refused postings: a 'refunded' or 'disputed' posting must never be
 * re-published by a renewal (that would erase the dispute marker and bypass
 * the refund gate), and neither may a posting that was never paid for:
 * 'pending' (checkout not completed) or 'expired' (an abandoned checkout the
 * reconciliation sweep retired). Renewing one of those would publish it as
 * 'paid' for the renewal price instead of the post price. The EmployerJob
 * status write is conditional on the row not being in a refused state and
 * the whole transaction rolls back when it matches nothing, closing the
 * race with a refund landing mid-checkout. The money is still recorded on
 * the ledger (without touching the posting) so the operator can refund it,
 * and the outcome is 'revoked_posting', which every caller alerts on.
 *
 * Callers MUST have verified `session.payment_status === 'paid'` and
 * `session.metadata.type === 'renewal'`.
 */
import type Stripe from 'stripe';
import { brand } from '@/config/brand';
import { prisma } from '@/lib/prisma';
import { config, type PricingTier } from '@/lib/config';
import { renewalExpiresAt } from '@/lib/expires-at';
import { logger } from '@/lib/logger';
import { sendRenewalConfirmationEmail } from '@/lib/email-service';
import { JOB_POSTING_ELIGIBILITY_SELECT, pingSearchEnginesForJobPage } from '@/lib/job-page-indexing';
import { fetchInvoiceData, sendPurchaseEvent, type StripeInvoiceData } from './activate-paid-job';
import { claimEmailSend, prismaErrorCode, releaseEmailClaim } from './webhook-support';

export type RenewalOutcome =
  | 'applied'
  | 'already_applied'
  | 'revoked_posting'
  | 'employer_job_missing';

export interface RenewalResult {
  outcome: RenewalOutcome;
  jobId: string;
  /** Payment status of the posting when the renewal was refused. */
  revokedStatus?: string;
}

/**
 * Statuses a renewal must never be applied to: revoked postings, and
 * postings that were never paid for (see the file header).
 */
const REFUSED_STATUSES = ['refunded', 'disputed', 'pending', 'expired'];

class RevokedPostingError extends Error {
  constructor() {
    super('posting was refunded, disputed or never paid for before the renewal applied');
    this.name = 'RevokedPostingError';
  }
}

function renewalChargeData(session: Stripe.Checkout.Session, employerJobId: string, invoiceData: StripeInvoiceData) {
  return {
    employerJobId,
    stripeSessionId: session.id,
    stripePaymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : null,
    amountCents: session.amount_total ?? config.stripeRenewalPriceInCents,
    currency: session.currency ?? 'usd',
    type: 'renewal',
    ...invoiceData,
  };
}

/** Ledger-only write for a renewal paid on a revoked posting. Never throws on a duplicate. */
async function recordChargeOnly(session: Stripe.Checkout.Session, employerJobId: string, invoiceData: StripeInvoiceData): Promise<void> {
  try {
    await prisma.jobCharge.create({ data: renewalChargeData(session, employerJobId, invoiceData) });
  } catch (err) {
    if (prismaErrorCode(err) !== 'P2002') throw err;
  }
}

export async function applyRenewalCheckout(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
): Promise<RenewalResult> {
  const jobId = session.metadata?.jobId;
  if (!jobId) throw new Error(`Renewal session ${session.id} has no jobId metadata`);
  if (session.payment_status !== 'paid') {
    throw new Error(`applyRenewalCheckout called for unpaid session ${session.id}`);
  }
  const renewalTier = (session.metadata?.tier || 'pro') as PricingTier;

  // Audit #8: a missing EmployerJob row surfaces loudly (the webhook 500s so
  // Stripe redelivers) instead of silently extending the job.
  const employerJob = await prisma.employerJob.findFirst({ where: { jobId } });
  if (!employerJob) return { outcome: 'employer_job_missing', jobId };

  const invoiceData = await fetchInvoiceData(stripe, session);

  if (REFUSED_STATUSES.includes(employerJob.paymentStatus)) {
    await recordChargeOnly(session, employerJob.id, invoiceData);
    return { outcome: 'revoked_posting', jobId, revokedStatus: employerJob.paymentStatus };
  }

  const existingJob = await prisma.job.findUnique({
    where: { id: jobId },
    // The eligibility columns decide whether Google hears about the renewal.
    select: { ...JOB_POSTING_ELIGIBILITY_SELECT, expiresAt: true, createdAt: true, slug: true },
  });
  if (!existingJob) throw new Error(`Renewal: Job ${jobId} not found`);

  // renewalExpiresAt: UTC math, extends from a future expiry (audit #22) or
  // from now, capped at 365 days from createdAt.
  const newExpiresAt = renewalExpiresAt({
    currentExpiry: existingJob.expiresAt,
    originalCreatedAt: existingJob.createdAt,
    durationDays: config.getDurationDays(renewalTier),
  });

  let outcome: RenewalOutcome = 'applied';
  try {
    await prisma.$transaction(async (tx) => {
      // Ledger FIRST: the unique stripeSessionId is the cross-path lock.
      await tx.jobCharge.create({ data: renewalChargeData(session, employerJob.id, invoiceData) });
      const claimed = await tx.employerJob.updateMany({
        where: { id: employerJob.id, paymentStatus: { notIn: REFUSED_STATUSES } },
        // Reset expiryWarningSentAt so the renewed posting (new, later
        // expiresAt) gets its own 5-day-out warning.
        data: { paymentStatus: 'paid', pricingTier: renewalTier, expiryWarningSentAt: null },
      });
      if (claimed.count === 0) throw new RevokedPostingError();
      await tx.job.update({
        where: { id: jobId },
        data: {
          expiresAt: newExpiresAt,
          isPublished: true,
          isVerifiedEmployer: true,
          // The renewal re-publishes the row and moves expiresAt, a rendered
          // field (lib/job-content-change.ts RENDERED_JOB_FIELDS), so the
          // posting's content changed now (indexing audit fixSoon 5).
          contentChangedAt: new Date(),
          ...(config.isFeaturedTier(renewalTier) && { isFeatured: true }),
        },
      });
    });
  } catch (err) {
    if (err instanceof RevokedPostingError) {
      await recordChargeOnly(session, employerJob.id, invoiceData);
      const current = await prisma.employerJob.findUnique({ where: { id: employerJob.id }, select: { paymentStatus: true } });
      return { outcome: 'revoked_posting', jobId, revokedStatus: current?.paymentStatus };
    }
    if (prismaErrorCode(err) !== 'P2002') throw err;
    outcome = 'already_applied';
  }

  // B109: the email is guarded by its own dedupe claim, so a replay after a
  // partial failure (state applied, email not sent) still sends it once.
  const expiresForEmail = outcome === 'applied' ? newExpiresAt : (existingJob.expiresAt ?? newExpiresAt);
  await sendRenewalEmailOnce(session, jobId, employerJob, existingJob.title, expiresForEmail, invoiceData);

  if (outcome === 'applied') {
    logger.info('Job renewed', { jobId, tier: renewalTier });
    // GA ids as /api/create-renewal-checkout stored them (consent only),
    // passed through unvalidated because trackServerPurchase is the trust
    // boundary. sendPurchaseEvent keeps the function alive until the POST
    // leaves without holding the webhook acknowledgement; see its comment.
    await sendPurchaseEvent({
      clientId: jobId,
      gaClientId: session.metadata?.gaClientId,
      gaSessionId: session.metadata?.gaSessionId,
      sessionId: session.id,
      amountCents: session.amount_total ?? config.stripeRenewalPriceInCents,
      currency: session.currency ?? 'usd',
      type: 'renewal',
      tier: renewalTier,
      jobId,
    });
    if (existingJob.slug) {
      // Google only when the page carries a JobPosting (lib/job-page-indexing.ts).
      pingSearchEnginesForJobPage(`${brand.baseUrl}/jobs/${existingJob.slug}`, existingJob).catch((err) =>
        logger.error('[Stripe] Background indexing ping failed (renewal)', err),
      );
    }
  } else {
    logger.info('Renewal state already applied for this session — skipped re-extension', { jobId, sessionId: session.id });
  }

  return { outcome, jobId };
}

async function sendRenewalEmailOnce(
  session: Stripe.Checkout.Session,
  jobId: string,
  employerJob: { contactEmail: string; dashboardToken: string },
  jobTitle: string,
  expiresAt: Date,
  invoiceData: StripeInvoiceData,
): Promise<void> {
  const emailKey = `renewal-confirmation:${session.id}`;
  if (!(await claimEmailSend(emailKey, employerJob.contactEmail, 'renewal_confirmation'))) {
    logger.info('Renewal confirmation email already sent for this session — skipping duplicate', { jobId, sessionId: session.id });
    return;
  }
  try {
    const emailLead = await prisma.emailLead.findUnique({ where: { email: employerJob.contactEmail } })
      ?? await prisma.emailLead.create({ data: { email: employerJob.contactEmail } });
    // Stable URL: our endpoint 302s to the latest "Paid" PDF, not the
    // open-state PDF captured before invoice.paid fires.
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? '';
    const stableInvoiceUrl = baseUrl
      ? `${baseUrl}/api/employer/invoice?jobId=${jobId}&token=${employerJob.dashboardToken}`
      : null;
    await sendRenewalConfirmationEmail(
      employerJob.contactEmail,
      jobTitle,
      expiresAt,
      employerJob.dashboardToken,
      emailLead.unsubscribeToken,
      {
        invoicePdfUrl: stableInvoiceUrl,
        hostedInvoiceUrl: invoiceData.hostedInvoiceUrl,
        invoiceNumber: invoiceData.invoiceNumber,
      },
    );
  } catch (emailError) {
    // Job already renewed. Release the claim so a later replay can send it.
    logger.error('Failed to send renewal confirmation email', emailError, { jobId });
    await releaseEmailClaim(emailKey);
  }
}
