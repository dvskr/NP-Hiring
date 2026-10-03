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
 * Archived postings: a renewal never puts an archived post back live. The
 * dashboard requires a restore before any republish and the create route
 * refuses an archived post, but a post can be archived after its checkout
 * opened. Inside the transaction the extension is written first (that write
 * takes the job row's lock), then archivedAt is read, and isPublished is set
 * only for a post that is not archived: an archive landing at the same
 * moment waits for the commit, and one that landed before is seen. The
 * payment is recorded and the expiry moves as usual; the post stays
 * unpublished and archived, gets no "live again" email and no search engine
 * ping, and a warning names it so the employer can be pointed to the
 * restore. The result carries leftArchived.
 *
 * The post's other renewal sessions (backlog 2.5): once a renewal is on the
 * books, every other open renewal session for the post is expired, and
 * another one that was paid as well is alerted for a refund
 * (settleOtherRenewalSessions). The second payment is looked for on Stripe
 * and on the ledger, so a failed Stripe listing does not hide it. Best
 * effort: never fails the caller.
 *
 * The renewal cap: a renewal that adds no full day is not applied. The
 * create route refuses to sell one, but the cap (config.renewalCapDays after
 * the post was created) can be reached while a checkout is open or a delayed
 * payment settles. Applying it would write the unchanged expiry, or one
 * already past, and tell the employer the listing was renewed. The payment
 * is recorded on the ledger without touching the posting and alerted for a
 * refund, and the outcome is 'cap_reached'.
 *
 * Callers MUST have verified `session.payment_status === 'paid'` and
 * `session.metadata.type === 'renewal'`.
 */
import type Stripe from 'stripe';
import type { Prisma } from '@prisma/client';
import { brand } from '@/config/brand';
import { prisma } from '@/lib/prisma';
import { config, type PricingTier } from '@/lib/config';
import { logger } from '@/lib/logger';
import { sendRenewalConfirmationEmail } from '@/lib/email-service';
import { JOB_POSTING_ELIGIBILITY_SELECT, pingSearchEnginesForJobPage } from '@/lib/job-page-indexing';
import {
  STRIPE_MAX_SESSION_LIFETIME_MS,
  expireCheckoutSessions,
  listRenewalSessionsForJob,
  payableWindowsOverlap,
  renewalExtension,
  type PayableWindow,
} from '@/lib/renewal-checkout-sessions';
import { fetchInvoiceData, sendPurchaseEvent, type StripeInvoiceData } from './activate-paid-job';
import { alertWebhookFailure, claimEmailSend, prismaErrorCode, releaseEmailClaim, stripeIdOf } from './webhook-support';

export type RenewalOutcome =
  | 'applied'
  | 'already_applied'
  | 'revoked_posting'
  | 'employer_job_missing'
  | 'cap_reached';

export interface RenewalResult {
  outcome: RenewalOutcome;
  jobId: string;
  /** Payment status of the posting when the renewal was refused. */
  revokedStatus?: string;
  /** The renewal is on the books, but the post is archived and stays unpublished until the employer restores it. */
  leftArchived?: true;
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

/** Ledger-only write for a renewal that is not applied (revoked posting, renewal cap). Never throws on a duplicate. */
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

  // UTC math, extends from a future expiry (audit #22) or from now, capped
  // config.renewalCapDays after createdAt (lib/expires-at.ts#renewalExpiresAt).
  const durationDays = config.getDurationDays(renewalTier);
  const extension = renewalExtension(existingJob, durationDays);
  const newExpiresAt = extension.expiresAt;

  // At the cap there is nothing to apply (see the file header). A session
  // already on the ledger is a replay of a renewal that WAS applied, and may
  // itself be what took the post to its cap: that one falls through to the
  // transaction, whose unique ledger row answers 'already_applied'.
  if (extension.daysAdded === 0 && !(await isSessionOnLedger(session.id))) {
    return recordRenewalAtCap(stripe, session, jobId, employerJob.id, invoiceData);
  }

  let outcome: RenewalOutcome = 'applied';
  let published = false;
  try {
    published = await prisma.$transaction(async (tx) => {
      // Ledger FIRST: the unique stripeSessionId is the cross-path lock.
      await tx.jobCharge.create({ data: renewalChargeData(session, employerJob.id, invoiceData) });
      const claimed = await tx.employerJob.updateMany({
        where: { id: employerJob.id, paymentStatus: { notIn: REFUSED_STATUSES } },
        // Reset expiryWarningSentAt so the renewed posting (new, later
        // expiresAt) gets its own 5-day-out warning.
        data: { paymentStatus: 'paid', pricingTier: renewalTier, expiryWarningSentAt: null },
      });
      if (claimed.count === 0) throw new RevokedPostingError();
      // The extension first: this write takes the job row's lock, which the
      // archived check in publishUnlessArchived relies on.
      await tx.job.update({
        where: { id: jobId },
        data: {
          expiresAt: newExpiresAt,
          isVerifiedEmployer: true,
          // expiresAt is a rendered field (lib/job-content-change.ts
          // RENDERED_JOB_FIELDS), so the posting's content changed now
          // (indexing audit fixSoon 5), whether it goes back live or not.
          contentChangedAt: new Date(),
          ...(config.isFeaturedTier(renewalTier) && { isFeatured: true }),
        },
      });
      return publishUnlessArchived(tx, jobId);
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

  // An archived post is not live, so it gets no "live again" email; Stripe's
  // own receipt still reaches the employer. A replay reads the post again,
  // so a first run that died before the email never sends it for an
  // archived post either.
  const leftArchived = outcome === 'applied' ? !published : await isJobArchived(jobId);
  if (!leftArchived) {
    // B109: the email is guarded by its own dedupe claim, so a replay after a
    // partial failure (state applied, email not sent) still sends it once.
    const expiresForEmail = outcome === 'applied' ? newExpiresAt : (existingJob.expiresAt ?? newExpiresAt);
    await sendRenewalEmailOnce(session, jobId, employerJob, existingJob.title, expiresForEmail, invoiceData);
  }

  if (outcome === 'applied') {
    logger.info('Job renewed', { jobId, tier: renewalTier });
    if (extension.daysAdded < durationDays) {
      // The cap cut the renewal short. Checkout stated the days it would add
      // when it opened; a payment that settled later adds fewer still. A
      // trace for whoever answers the employer who asks about it.
      logger.warn('[Renewal] Renewal applied near the renewal limit: it added fewer days than the posting period', {
        jobId,
        sessionId: session.id,
        daysAdded: extension.daysAdded,
        durationDays,
        expiresAt: newExpiresAt.toISOString(),
      });
    }
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
    if (leftArchived) {
      // Nothing to index: the post is off the board until a restore and a
      // republish, which puts it live with the renewed expiry.
      logger.warn('[Renewal] Renewal paid for an archived post: payment recorded and expiry moved, the post stays unpublished and archived until the employer restores it', {
        jobId,
        employerJobId: employerJob.id,
        sessionId: session.id,
        expiresAt: newExpiresAt.toISOString(),
      });
    } else if (existingJob.slug) {
      // Google only when the page carries a JobPosting (lib/job-page-indexing.ts).
      pingSearchEnginesForJobPage(`${brand.baseUrl}/jobs/${existingJob.slug}`, existingJob).catch((err) =>
        logger.error('[Stripe] Background indexing ping failed (renewal)', err),
      );
    }
  } else {
    logger.info('Renewal state already applied for this session — skipped re-extension', { jobId, sessionId: session.id, leftArchived });
  }

  // Backlog 2.5: with this renewal on the books, no other renewal checkout
  // for the post may stay payable, and one paid as well must reach a human.
  // Last, so its Stripe calls never hold the confirmation email or the
  // purchase event; and on a replay too, as the first run may have died
  // before reaching it.
  await settleOtherRenewalSessions(stripe, session, jobId, employerJob.id);

  return { outcome, jobId, ...(leftArchived && { leftArchived: true as const }) };
}

/**
 * Put the renewed post back live unless it is archived. Runs inside the
 * renewal transaction after the extension, whose write holds the job row's
 * lock until the commit: an archive that lands now waits, then unpublishes
 * the post itself, and one that landed earlier is seen by this read. The
 * dashboard requires a restore before any republish, and the chargeback-won
 * path in ./route.ts skips archived rows the same way. True when published.
 */
async function publishUnlessArchived(tx: Prisma.TransactionClient, jobId: string): Promise<boolean> {
  const job = await tx.job.findUnique({ where: { id: jobId }, select: { archivedAt: true } });
  if (job?.archivedAt) return false;
  await tx.job.update({ where: { id: jobId }, data: { isPublished: true } });
  return true;
}

/** Whether the post is archived now; read on a replay, which wrote nothing to tell. */
async function isJobArchived(jobId: string): Promise<boolean> {
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { archivedAt: true } });
  return !!job?.archivedAt;
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

/** Whether a JobCharge row records this session: a path that got here first already settled it. */
async function isSessionOnLedger(sessionId: string): Promise<boolean> {
  const charge = await prisma.jobCharge.findUnique({ where: { stripeSessionId: sessionId }, select: { id: true } });
  return !!charge;
}

/** What the operator is told to do about a renewal payment that added nothing. */
const REFUND_UNAPPLIED_RENEWAL = 'Refund this payment in full in Stripe. It added nothing to the posting.';

/**
 * What the operator is told to do about a second paid renewal. The refund is
 * safe for the posting: charge.refunded takes a posting down only when no
 * other payment for it stands (./route.ts#handleChargeRefunded).
 */
const REFUND_ONE_OF_TWO_RENEWALS = 'Refund one of these payments in full in Stripe. The posting stays live while the other payment stands, and keeps the days both renewals added.';

/**
 * A renewal paid for a post at its renewal cap (see the file header). The
 * payment goes on the ledger, where a refund is matched to it, and nothing
 * else is written: no status change, no expiry, no republish. No
 * confirmation email and no purchase event either, since nothing was
 * renewed. The alert is raised here, not by each caller, so the webhook, the
 * verify page, the sweep and the create route all report it alike.
 */
async function recordRenewalAtCap(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
  jobId: string,
  employerJobId: string,
  invoiceData: StripeInvoiceData,
): Promise<RenewalResult> {
  await recordChargeOnly(session, employerJobId, invoiceData);
  const extras = {
    paymentIntentId: stripeIdOf(session.payment_intent) ?? undefined,
    amountCents: session.amount_total ?? undefined,
    jobId,
    employerJobId,
    sessionId: session.id,
    action: REFUND_UNAPPLIED_RENEWAL,
  };
  logger.warn('[Renewal] Renewal paid for a posting at its renewal limit: payment recorded, nothing applied, refund required', extras);
  await alertWebhookFailure('Renewal paid for a posting at its renewal limit, refund required', null, extras);
  // The post's open renewal checkouts can only take more money for nothing.
  await settleOtherRenewalSessions(stripe, session, jobId, employerJobId, { alertSecondPayment: false });
  return { outcome: 'cap_reached', jobId };
}

/** Another payment for the same renewal: the ids a refund needs. */
interface OtherRenewalPayment {
  sessionId: string;
  paymentIntentId: string | null;
}

/**
 * Backlog 2.5 (lib/renewal-checkout-sessions.ts), once this renewal is on
 * the books:
 *   - every other OPEN renewal session for the post is expired, so an older
 *     checkout or a second tab cannot take a second payment;
 *   - every other PAID renewal for the post that was payable alongside this
 *     one is a second payment for one renewal (both paid at the same moment,
 *     or one before the other was applied). It is alerted with the ids a
 *     refund needs; the refund is a human decision. Two nets look for it, so
 *     one failing does not hide it: Stripe's session list (payable windows
 *     that overlap), and the ledger (paidAlongsideOnLedger). Of two such
 *     payments, the one applied second always finds the other on the ledger,
 *     so at least one alert fires whichever path applies them.
 *
 * `alertSecondPayment: false` only closes the open sessions. It is for a
 * renewal that was itself refused at the renewal cap: its own alert already
 * asks for its refund, and a second one would point at the payment the post
 * runs on.
 *
 * Best effort: the renewal is settled by now, so a failure here is logged
 * (error level, forwarded to Sentry) and never fails or retries the caller.
 */
async function settleOtherRenewalSessions(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
  jobId: string,
  employerJobId: string,
  { alertSecondPayment }: { alertSecondPayment: boolean } = { alertSecondPayment: true },
): Promise<void> {
  const nowSec = Math.floor(Date.now() / 1000);
  const thisWindow = payableWindowOf(session, nowSec);
  // A session created more than Stripe's longest lifetime before this one
  // had closed before this one existed, so the range starts there. It runs
  // to now, so it also covers every session still open when the sweep
  // applies a renewal days late. Math.min guards a `created` stamp ahead of
  // this server's clock.
  const sinceSec = Math.min(nowSec, thisWindow.created) - STRIPE_MAX_SESSION_LIFETIME_MS / 1000;
  const onStripe = await closeOpenAndFindPaidOnStripe(stripe, session, jobId, thisWindow, sinceSec);
  if (!alertSecondPayment) return;
  const onLedger = await paidAlongsideOnLedger(session, jobId, employerJobId, sinceSec);
  const others = [
    ...onStripe,
    ...onLedger.filter((charge) => !onStripe.some((paid) => paid.sessionId === charge.sessionId)),
  ];
  if (others.length > 0) await alertSecondRenewalPayment(session, others, jobId, employerJobId);
}

/**
 * Expire the post's other open renewal sessions, and return the ones paid
 * while this one was payable. Empty when Stripe cannot be asked.
 */
async function closeOpenAndFindPaidOnStripe(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
  jobId: string,
  thisWindow: PayableWindow,
  sinceSec: number,
): Promise<OtherRenewalPayment[]> {
  try {
    const { sessions } = await listRenewalSessionsForJob(stripe, jobId, { createdSince: sinceSec });
    const others = sessions.filter((s) => s.id !== session.id);
    await expireOpenSiblings(stripe, others.filter((s) => s.status === 'open'), jobId, session.id);
    return others
      .filter((s) => s.payment_status === 'paid' && payableWindowsOverlap(s, thisWindow))
      .map((s) => ({ sessionId: s.id, paymentIntentId: stripeIdOf(s.payment_intent) }));
  } catch (err) {
    logger.error('[Renewal] Could not check the post\'s other renewal sessions after applying a renewal', err, {
      jobId,
      sessionId: session.id,
    });
    return [];
  }
}

/**
 * The posting's other renewal charges, ledgered since `sinceSec` and not
 * refunded in full. A second net under the Stripe listing, which is one
 * capped, fallible call: this needs no Stripe call and has no scan cap.
 *
 * A row's createdAt is when its renewal was applied, never before its
 * session was created, so the range that holds every session payable
 * alongside this one holds every such charge. It can hold a little more (a
 * renewal applied within a day before this checkout was opened), which
 * nobody is offered: the dashboard and the edit page offer a renewal only
 * for a post that has ended or ends within the week, and the create route
 * refuses one at the renewal cap. A human should see that one too.
 */
async function paidAlongsideOnLedger(
  session: Stripe.Checkout.Session,
  jobId: string,
  employerJobId: string,
  sinceSec: number,
): Promise<OtherRenewalPayment[]> {
  try {
    const charges = await prisma.jobCharge.findMany({
      where: {
        employerJobId,
        type: 'renewal',
        stripeSessionId: { not: session.id },
        createdAt: { gte: new Date(sinceSec * 1000) },
      },
      select: { stripeSessionId: true, stripePaymentIntentId: true, amountCents: true, refundedAmountCents: true },
    });
    return charges
      .filter((charge) => (charge.refundedAmountCents ?? 0) < charge.amountCents)
      .map((charge) => ({ sessionId: charge.stripeSessionId, paymentIntentId: charge.stripePaymentIntentId }));
  } catch (err) {
    logger.error('[Renewal] Could not read the post\'s other renewal charges after applying a renewal', err, {
      jobId,
      sessionId: session.id,
    });
    return [];
  }
}

/** This session's payable window; a payload missing the stamps is read as broadly as Stripe allows. */
function payableWindowOf(session: Stripe.Checkout.Session, nowSec: number): PayableWindow {
  const created = typeof session.created === 'number' ? session.created : nowSec;
  const expiresAt = typeof session.expires_at === 'number'
    ? session.expires_at
    : created + STRIPE_MAX_SESSION_LIFETIME_MS / 1000;
  return { created, expires_at: expiresAt };
}

async function expireOpenSiblings(
  stripe: Stripe,
  open: readonly Stripe.Checkout.Session[],
  jobId: string,
  sessionId: string,
): Promise<void> {
  if (open.length === 0) return;
  const { expired, failed } = await expireCheckoutSessions(stripe, open.map((s) => s.id));
  if (failed.length > 0) {
    // A sibling left open can still be paid. If it is, its own application
    // finds this renewal paid and raises the double payment alert.
    logger.error('[Renewal] Could not expire another open renewal session for the post', null, {
      jobId,
      sessionId,
      failed,
      expired,
    });
    return;
  }
  logger.info('[Renewal] Expired the post\'s other open renewal sessions', { jobId, sessionId, expired });
}

/**
 * Two paid renewals for one posting. The alert carries both sides' session
 * and payment intent ids, which the alert redaction keeps readable
 * (lib/sanitize-for-discord.ts); a refund is issued against the payment
 * intent. No automatic refund: which payment to keep is the operator's call.
 * It also says what the refund does, because both renewals were applied.
 */
async function alertSecondRenewalPayment(
  session: Stripe.Checkout.Session,
  paidAlongside: readonly OtherRenewalPayment[],
  jobId: string,
  employerJobId: string,
): Promise<void> {
  // What a refund needs first: the Discord detail line is cut at a fixed
  // length, and readable session ids (about 66 characters each) would
  // otherwise push the payment intents past it. Sentry keeps every field.
  const extras = {
    paymentIntentId: stripeIdOf(session.payment_intent) ?? undefined,
    otherPaymentIntentIds: paidAlongside.map((paid) => paid.paymentIntentId ?? 'unknown').join(', '),
    amountCents: session.amount_total ?? undefined,
    jobId,
    employerJobId,
    sessionId: session.id,
    otherSessionIds: paidAlongside.map((paid) => paid.sessionId).join(', '),
    action: REFUND_ONE_OF_TWO_RENEWALS,
  };
  logger.warn('[Renewal] Two paid renewals for one posting, refund required', extras);
  await alertWebhookFailure('Two paid renewals for one posting, refund required', null, extras);
}
