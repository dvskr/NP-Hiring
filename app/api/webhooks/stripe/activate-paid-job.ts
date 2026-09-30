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

import type Stripe from 'stripe';
import { after } from 'next/server';
import { brand } from '@/config/brand';
import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';
import { asPaidTier, paidPostWhere, type PaidTier } from '@/lib/pricing';
import { logger } from '@/lib/logger';
import { sendConfirmationEmail } from '@/lib/email-service';
import { pingSearchEnginesForJobPage } from '@/lib/job-page-indexing';
import { anonymizeEmail } from '@/lib/server-utils';
import { trackServerPurchase, type PurchaseParams } from '@/lib/analytics-server';

/** How sendPurchaseEvent made sure the purchase POST leaves. Returned for tests. */
export type PurchaseEventDelivery = 'after_response' | 'awaited';

/**
 * Send the GA4 purchase event from a paid-checkout path without letting the
 * serverless freeze cut it off, and without holding up the response.
 *
 * Shared by this file and ./apply-renewal.ts, so the three callers of each
 * (webhook, verify-page self-heal, reconciliation sweep) behave alike.
 *
 * WHY `after()` FIRST, AND AN AWAIT ONLY AS THE FALLBACK. Inside a request
 * scope (the webhook, the verify routes, the Inngest route handler that runs
 * the sweep) `after()` from next/server hands the in-flight POST to the
 * platform's waitUntil, so the function stays alive until the POST settles
 * while the response goes out at once. Awaiting there instead would hold the
 * Stripe acknowledgement, or the success-page poll, for the whole Google
 * round trip, up to MP_TIMEOUT_MS in lib/analytics-server.ts, to protect
 * data that after() already protects. Outside a request scope `after()`
 * throws (so does a runtime without waitUntil); there is then no platform
 * keepalive and no client waiting on a response, so awaiting is both
 * necessary and free.
 *
 * trackServerPurchase also registers its own promise with `after()` as a
 * safety net for any caller. Registering the derived promise again here
 * changes nothing, because the two settle together, and it is the only way
 * this caller can learn whether a request scope exists.
 */
export async function sendPurchaseEvent(params: PurchaseParams): Promise<PurchaseEventDelivery> {
  // trackServerPurchase never rejects by contract. The async wrapper turns a
  // synchronous throw into a rejection too, and the catch then makes sure no
  // future break of that contract can fail a paid activation over analytics.
  // It logs rather than swallowing, because a sender that throws is a bug.
  const inFlight = (async () => trackServerPurchase(params))().catch((err: unknown) => {
    logger.warn('GA4 purchase sender broke its never-reject contract, purchase event lost', {
      sessionId: params.sessionId,
      err: String(err),
    });
  });
  try {
    after(inFlight);
    return 'after_response';
  } catch {
    await inFlight;
    return 'awaited';
  }
}

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

export type PaidJobActivationOutcome = 'activated' | 'already_active' | 'employer_job_missing' | 'duplicate_payment';

export interface PaidJobActivationResult {
  outcome: PaidJobActivationOutcome;
  jobId: string;
}

function prismaErrorCode(err: unknown): string | undefined {
  return (err as { code?: string } | null)?.code;
}

/**
 * Record the JobCharge for a paid session that did not win the activation
 * claim: the winner crashed before its ledger write, or this is a second
 * payment for the same posting. Money Stripe took must always be on the
 * ledger (the refund/dispute webhooks match on it). Best-effort — never throws.
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
        amountCents: session.amount_total ?? config.priceCentsForTier(asPaidTier(session.metadata?.pricing)),
        currency: session.currency ?? 'usd',
        type: 'new',
        ...invoiceData,
      },
    });
    logger.info('Backfilled missing JobCharge for a paid session that lost the activation claim', {
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
/**
 * Log (never throw) when an 'intro'-priced activation finds another paid
 * post already ledgered at the same domain — the only way that happens is
 * the concurrent-checkout race described at the call site. Exported for
 * the unit test; the count uses the SAME predicate the intro decision uses
 * (lib/pricing.ts#paidPostWhere) minus this row.
 */
export async function detectIntroDoubleCharge(
  employerJobId: string,
  quotaDomain: string | null,
  paidTier: PaidTier,
  jobId: string,
  session: Pick<Stripe.Checkout.Session, 'id' | 'amount_total'>,
): Promise<boolean> {
  if (paidTier !== 'intro' || !quotaDomain) return false;
  try {
    const others = await prisma.employerJob.count({
      where: { ...paidPostWhere(quotaDomain), id: { not: employerJobId } },
    });
    if (others === 0) return false;
    logger.error('Intro price charged twice for one domain (concurrent first checkouts) — refund the difference', undefined, {
      jobId,
      employerJobId,
      quotaDomain,
      sessionId: session.id,
      amountCents: session.amount_total ?? undefined,
      otherPaidPosts: others,
    });
    return true;
  } catch (err) {
    logger.warn('Intro double-charge check failed', { jobId, err });
    return false;
  }
}

/**
 * The claim was lost (P2025). Decide between a harmless replay and a SECOND
 * payment for one posting:
 *   - this session is already on the ledger → replay (webhook retry, verify
 *     page, sweep) — nothing to do;
 *   - the row is 'paid' and no OTHER new-post charge exists → the winner is
 *     mid-flight or crashed before its ledger write — backfill the charge;
 *   - anything else (another new-post session already charged, or the row
 *     is refunded/disputed/expired) → the employer paid twice. Record the
 *     charge and report 'duplicate_payment' so a human refunds it.
 */
async function resolveLostClaim(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
  employerJobId: string,
  jobId: string,
): Promise<PaidJobActivationOutcome> {
  const [current, charges] = await Promise.all([
    prisma.employerJob.findUnique({ where: { id: employerJobId }, select: { paymentStatus: true } }),
    prisma.jobCharge.findMany({ where: { employerJobId }, select: { stripeSessionId: true, type: true } }),
  ]);
  const chargeRows = Array.isArray(charges) ? charges : [];

  if (chargeRows.some((c) => c.stripeSessionId === session.id)) {
    logger.info('Paid checkout already activated by another path — skipping side effects', {
      jobId, sessionId: session.id, paymentStatus: current?.paymentStatus,
    });
    return 'already_active';
  }

  const otherNewCharge = chargeRows.some((c) => c.type === 'new' && c.stripeSessionId !== session.id);
  await ensureJobChargeRecorded(stripe, session, employerJobId);

  if (current?.paymentStatus === 'paid' && !otherNewCharge) {
    logger.info('Paid checkout already activated by another path — ledger backfilled', {
      jobId, sessionId: session.id,
    });
    return 'already_active';
  }

  logger.error('Second payment for one posting — refund required', undefined, {
    jobId,
    employerJobId,
    sessionId: session.id,
    paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : undefined,
    amountCents: session.amount_total ?? undefined,
    paymentStatus: current?.paymentStatus,
  });
  return 'duplicate_payment';
}

export async function activatePaidJobCheckout(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
): Promise<PaidJobActivationResult> {
  const jobId = session.metadata?.jobId;
  if (!jobId) {
    throw new Error(`Checkout session ${session.id} has no jobId metadata`);
  }
  // Runtime guard for the caller contract: publishing a posting (and
  // ledgering a charge) for money that has not settled is never correct.
  if (session.payment_status !== 'paid') {
    throw new Error(`activatePaidJobCheckout called for session ${session.id} with payment_status=${session.payment_status}`);
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

  // Ladder rung the session was sold at — written by /api/create-checkout
  // as metadata.pricing ('intro' | 'pro'). Narrowed so a legacy or tampered
  // value can only ever fall back to 'pro', never to a cheaper rung. The
  // fallback amount below is only used when Stripe omits amount_total.
  const paidTier = asPaidTier(session.metadata?.pricing);
  const fallbackAmountCents = config.priceCentsForTier(paidTier);

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
      const outcome = await resolveLostClaim(stripe, session, employerJob.id, jobId);
      return { outcome, jobId };
    }
    throw claimErr;
  }

  // Publish AFTER winning the claim — republish on webhook retry is
  // idempotent, but a refunded/disputed row never reaches this line.
  // contentChangedAt: the posting goes public now, so its content is new
  // now (sitemap lastmod, the page's "Last updated"; indexing audit
  // fixSoon 5). Only the claim winner reaches this write, once per payment.
  const job = await prisma.job.update({
    where: { id: jobId },
    data: { isPublished: true, isVerifiedEmployer: true, contentChangedAt: new Date() },
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
        amountCents: session.amount_total ?? fallbackAmountCents,
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

  // Intro-rung race detector. The intro price is decided at Checkout
  // creation from the domain's paid-post count; two checkouts opened at the
  // same time for one domain can both be sold at 'intro' before either is
  // paid. Blocking that at creation would make an honest employer who
  // abandons a $199 checkout see $299 on retry, so the race is accepted and
  // surfaced here instead: once THIS charge is in the ledger, any OTHER paid
  // post at the domain means the intro price was charged twice. Logged as an
  // error (forwarded to Sentry) so the owner can refund the difference.
  await detectIntroDoubleCharge(employerJob.id, employerJob.quotaDomain, paidTier, jobId, session);

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
      config.durationDays,
      {
        invoicePdfUrl: stableInvoiceUrl,
        hostedInvoiceUrl: newPostInvoiceData.hostedInvoiceUrl,
        invoiceNumber: newPostInvoiceData.invoiceNumber,
      },
      'paid', // mode — lets the template drop the promo / plan wording
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

  // P7: server-side purchase event. The GA ids are the ones /api/create-checkout
  // stored when the buyer had granted analytics consent; absent otherwise, and
  // then the job UUID fallback applies. Passed through as stored:
  // trackServerPurchase validates both, and a second check here could only
  // drift from it. Delivery: see sendPurchaseEvent above.
  await sendPurchaseEvent({
    clientId: jobId,
    gaClientId: session.metadata?.gaClientId,
    gaSessionId: session.metadata?.gaSessionId,
    sessionId: session.id,
    amountCents: session.amount_total ?? fallbackAmountCents,
    currency: session.currency ?? 'usd',
    type: 'new',
    tier: paidTier,
    jobId,
  });

  // Ping search engines for new job (fire-and-forget)
  if (job.slug) {
    // Google only when the page carries a JobPosting (lib/job-page-indexing.ts).
    pingSearchEnginesForJobPage(`${brand.baseUrl}/jobs/${job.slug}`, job).catch((err) =>
      logger.error('[Stripe] Background indexing ping failed (new job)', err)
    );
  }

  return { outcome: 'activated', jobId };
}
