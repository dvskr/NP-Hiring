/**
 * POST /api/create-renewal-checkout — $config.renewalPrice for
 * +config.durationDays on an existing post.
 *
 * Eligible rows: 'promo' (launch-free post, renewable at the normal price)
 * and 'paid' (intro / pro). Blocked with 409:
 *   'pending'  — checkout never completed; resume the original instead
 *   'expired'  — an abandoned checkout the reconciliation sweep retired: the
 *                post was never paid for, and a renewal would publish it at
 *                the renewal price instead of the post price (the renewal
 *                webhook refuses these too)
 *   'free'     — legacy free-quota rows (unchanged message)
 *   'refunded' — pulled by refund/moderation; must not relist at a discount
 *   'disputed' — charged back; a renewal must not re-publish it or erase the
 *                dispute marker (the renewal webhook re-checks this too)
 *   'plan'     — each plan post runs config.durationDays; the employer posts
 *                again into the freed plan slot rather than buying a renewal
 * Everything else (legacy 'free_renewed' / 'free_upgraded') keeps today's
 * behaviour and falls through to Checkout. An archived post is blocked with
 * 409 too (a status refused above keeps its own message): a renewal
 * republishes, and the dashboard requires a restore before any republish.
 * So is a post at its renewal cap (config.renewalCapDays after it was
 * created): a renewal there adds no full day, and the employer would pay
 * for an expiry that does not move.
 *
 * One payable renewal per post (backlog 2.5). A renewal payment already in
 * flight for the post refuses a new session with 409: one paid but not
 * applied yet is applied here and now, and one whose delayed payment is
 * still settling is left to settle. Otherwise every other open renewal
 * Checkout Session for the post is expired before the new session is handed
 * out, and the session handed out is known to be payable: a reused
 * idempotency key can replay one this route already closed
 * (createLiveRenewalSession). When a check cannot be confirmed the request
 * is refused with a retryable 503 rather than risking a second payment. The
 * session itself closes within the hour (expires_at). See
 * lib/renewal-checkout-sessions.ts.
 */
import { createHash } from 'node:crypto';
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { config, PricingTier } from '@/lib/config';
import { asPaidTier } from '@/lib/pricing';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { getBaseUrl, isFeatureEnabled } from '@/lib/env';
import { logger } from '@/lib/logger';
import { gaCheckoutMetadata, idempotencyKeyWithGaIds } from '@/lib/analytics-server';
import {
  RENEWAL_SESSION_COOKIE_MAX_AGE_S,
  STRIPE_MAX_SESSION_LIFETIME_MS,
  expireCheckoutSessions,
  findRenewalPaymentsInFlight,
  listRenewalSessionsForJob,
  renewalExtension,
  renewalIdempotencyWindow,
  renewalSessionExpiresAt,
  type RenewalPaymentInFlight,
  type RenewalPaymentInFlightState,
} from '@/lib/renewal-checkout-sessions';
import { applyRenewalCheckout } from '@/app/api/webhooks/stripe/apply-renewal';

/**
 * Retry-After on a refusal. What blocks a new session is a Stripe hiccup, or
 * an earlier session completing a payment just as it was being closed; the
 * renewal webhook settles the latter within seconds.
 */
const REFUSAL_RETRY_AFTER_S = 60;

/**
 * The refusal for a post at its renewal cap. The first sentence is the cap
 * as every other surface states it (RENEWAL_CAP_LINE in
 * app/pricing/pricing-page-copy.ts and lib/email-service.ts).
 */
const RENEWAL_CAP_REACHED_MESSAGE = `Renewals can extend a post to at most ${config.renewalCapDays} days after it was first posted, and this post has reached that limit. To keep hiring for this role, post it again as a new listing.`;

/** The answer once a renewal payment found in flight has been applied by this request. */
const RENEWAL_APPLIED_MESSAGE = 'We had already received a renewal payment for this job and have now applied it, so there is nothing more to pay. Refresh your dashboard to see the new expiry date.';

/** A session the open listing could not vouch for, and that could not be read back either. */
const SESSION_CHECK_UNAVAILABLE_MESSAGE = 'We could not check this job for an open renewal checkout, so a new one was not started. Please try again in a minute.';

/**
 * How many expired sessions one request walks past before it gives up
 * (createLiveRenewalSession). Each one takes another browser closing this
 * browser's checkout inside the same ten minute window, so past a handful
 * something other than two people clicking is going on.
 */
const MAX_REPLACED_SESSIONS = 5;

/**
 * What the employer is told while a renewal payment for the post is in
 * flight. Each says the renewal applies on its own, so nobody pays twice,
 * and when a new renewal can be started. The paid_unapplied wording is the
 * fallback for a payment this request could not apply itself
 * (applyPaidRenewals): the daily reconciliation sweep is then what applies
 * it, so it promises a day, not a minute.
 */
const PAYMENT_IN_FLIGHT_MESSAGES: Record<RenewalPaymentInFlightState, string> = {
  paid_unapplied: 'We have already received a renewal payment for this job. It is applied automatically, so there is nothing more to pay. If your dashboard does not show the new expiry date within a day, please contact support.',
  processing: 'A renewal payment for this job is still processing. The renewal is applied automatically once it clears, so there is nothing more to pay now. If that payment fails, you can start a new renewal then.',
  awaiting_verification: 'A bank payment for this renewal is waiting for you to verify your bank account. Once you complete the verification Stripe asked for and the payment clears, the renewal is applied automatically, so there is nothing more to pay now. If that payment fails, you can start a new renewal then.',
};

/** Which message wins when several payments are in flight: the money already taken first. */
const PAYMENT_IN_FLIGHT_PRECEDENCE: readonly RenewalPaymentInFlightState[] = ['paid_unapplied', 'processing', 'awaiting_verification'];

interface RenewalCheckoutBody {
  jobId: string;
  editToken: string;
  tier?: PricingTier; // ignored — single tier model
}

export async function POST(request: NextRequest) {
    // Rate limiting
    const rateLimitResult = await rateLimit(request, 'renewal-checkout', RATE_LIMITS.postJob);
    if (rateLimitResult) return rateLimitResult;

  try {
    // F3: master switch first — see app/api/create-checkout/route.ts for the
    // rationale behind the two distinct machine-readable 503 codes.
    if (!isFeatureEnabled('paidPosting')) {
      return NextResponse.json(
        { error: 'Paid job posting is not available yet', code: 'PAID_POSTING_DISABLED' },
        { status: 503 }
      );
    }

    const stripe = getStripe();
    if (!stripe) {
      return NextResponse.json(
        { error: 'Paid checkout is currently unavailable', code: 'STRIPE_NOT_CONFIGURED' },
        { status: 503 }
      );
    }

    const body: RenewalCheckoutBody = await request.json();
    const { jobId, editToken } = body;

    // Validate required fields
    if (!jobId || !editToken) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Find the employer job and verify edit token
    const employerJob = await prisma.employerJob.findFirst({
      where: {
        jobId,
        editToken,
      },
      include: {
        job: {
          select: {
            id: true,
            title: true,
            employer: true,
            location: true,
            expiresAt: true,
            // With expiresAt, what the renewal cap is computed from.
            createdAt: true,
            archivedAt: true,
          },
        },
      },
    });

    if (!employerJob) {
      return NextResponse.json(
        { error: 'Invalid job ID or edit token' },
        { status: 404 }
      );
    }

    // Audit #11: don't allow renewing a posting that was never paid in the first
    // place. 'pending' = checkout abandoned; 'expired' = an abandoned checkout
    // the reconciliation sweep retired. Renewing either would publish a post
    // nobody paid for at the renewal price. Legacy 'free' = the old free-quota
    // path; renewing one via the renewal flow would let it sneak past that quota.
    // All of them re-enter the appropriate flow rather than buying a renewal.
    // ('promo' rows are deliberately NOT blocked — launch-promo posts renew at
    // the normal renewal price, see file header.)
    if (employerJob.paymentStatus === 'pending' || employerJob.paymentStatus === 'expired') {
      return NextResponse.json(
        { error: 'This job posting was never completed. Please complete the original checkout instead of renewing.' },
        { status: 409 }
      );
    }
    if (employerJob.paymentStatus === 'free') {
      return NextResponse.json(
        { error: 'Free posts cannot be renewed at the discounted rate. Post a new job at the regular price instead.' },
        { status: 409 }
      );
    }
    // A refunded posting was pulled (refund/moderation). The renewal webhook
    // unconditionally re-publishes + flips paymentStatus to 'paid', which would
    // bypass the refund-unpublish moderation gate (toggle-publish 402s these).
    // Block renewal so a refunded post can't quietly relist at the discount.
    if (employerJob.paymentStatus === 'refunded') {
      return NextResponse.json(
        { error: 'This posting was refunded and is no longer eligible for renewal. Please contact support or create a new posting.' },
        { status: 409 }
      );
    }
    // A charged-back posting was revoked when the dispute opened. Renewing it
    // would re-publish it as 'paid' and erase the dispute marker.
    if (employerJob.paymentStatus === 'disputed') {
      return NextResponse.json(
        { error: 'This posting is under a payment dispute and is not eligible for renewal. Please contact support.' },
        { status: 409 }
      );
    }
    // Plan posts are not renewed per-post: each runs config.durationDays
    // while the plan is active, and the employer re-posts into the freed
    // plan slot afterwards. Buying a renewal here would
    // convert the row to 'paid' and confuse both the slot count and billing.
    if (employerJob.paymentStatus === 'plan') {
      return NextResponse.json(
        { error: `Employer plan posts are not renewed. Each runs ${config.durationDays} days; when this one ends, post again into your free plan slot at no extra charge.` },
        { status: 409 }
      );
    }
    // A renewal republishes the post, and an archived post goes back on the
    // board only through a restore: toggle-publish 409s a republish of an
    // archived post. Checked after the statuses above, so a post that can
    // never be renewed says so whether or not it is archived. The renewal
    // webhook checks again inside its transaction, for a post archived while
    // this checkout was open.
    if (employerJob.job.archivedAt) {
      return NextResponse.json(
        {
          error: 'This post is archived. Restore it from the Archived tab of your dashboard before you renew it.',
          archived: true,
        },
        { status: 409 }
      );
    }

    // One clock reading feeds the cap check, the key, expires_at and the
    // replay check. Read twice, a window boundary between the reads would
    // pair this key with the next window's expires_at, and a replay of the
    // key would then send different parameters, which Stripe refuses.
    const nowMs = Date.now();

    // Carry the row's own rung through metadata so the renewal webhook
    // (which writes pricingTier = metadata.tier) doesn't rewrite an 'intro'
    // row as 'pro'. Never 'plan' — blocked above.
    const tier: PricingTier = asPaidTier(employerJob.pricingTier);

    // The renewal cap: what this renewal would add, computed exactly as the
    // webhook computes it when it applies one. Nothing to add, nothing to
    // sell. The webhook checks again, for a cap reached while the checkout
    // is open or a delayed payment settles.
    const extension = renewalExtension(employerJob.job, config.getDurationDays(tier), new Date(nowMs));
    if (extension.daysAdded === 0) {
      return NextResponse.json(
        { error: RENEWAL_CAP_REACHED_MESSAGE, code: 'RENEWAL_CAP_REACHED' },
        { status: 409 }
      );
    }

    // GA attribution for the renewal purchase event the webhook sends later;
    // only this request can read the GA cookies. Empty unless the visitor
    // granted analytics consent (lib/analytics-server.ts#gaCheckoutMetadata).
    const gaMetadata = gaCheckoutMetadata(request);

    const expiryMarker = employerJob.job.expiresAt ? employerJob.job.expiresAt.getTime() : 'none';
    const windowIndex = renewalIdempotencyWindow(nowMs);
    const expiresAt = renewalSessionExpiresAt(windowIndex);
    const checkout = {
      employerJob,
      jobId,
      tier,
      daysAdded: extension.daysAdded,
      // Closes before the renewal session cookie set below runs out, and is
      // identical for every request in this window (renewalSessionExpiresAt).
      expiresAt,
    };
    // This key is reused for a whole window, and Stripe refuses a reused key
    // whose parameters differ from the first request. So the key carries a
    // fingerprint of the parameters: whatever changes inside a window (the
    // title is edited between two clicks, the days a renewal near the cap
    // adds tick down, a deploy changes the copy) gets a key and a session of
    // its own instead of an idempotency error. The GA ids, which change the
    // same way (the cookie banner is accepted between two clicks, or GA
    // starts a new session), ride on the end where they can be read; see
    // idempotencyKeyWithGaIds. 'v2' set these keys apart from the ones
    // minted before the parameters gained expires_at.
    const idempotencyKey = idempotencyKeyWithGaIds(
      `renewal-v2-${employerJob.id}-${expiryMarker}-${windowIndex}-${digest(JSON.stringify(renewalSessionParams(checkout, {})))}`,
      gaMetadata,
    );

    // A renewal bought next to one already paid for, or next to one whose
    // delayed payment is still settling, is a second payment for one renewal:
    // refuse before any open session is listed, closed or created.
    const inFlight = await findRenewalPaymentInFlight(stripe, jobId);
    if (!inFlight) {
      return retryableRefusal(
        'We could not check this job for a renewal payment in progress, so a new checkout was not started. Please try again in a minute.',
        'RENEWAL_CHECK_UNAVAILABLE',
      );
    }
    if (inFlight.length > 0) return renewalPaymentInFlight(stripe, jobId, inFlight);

    const openRenewals = await findOpenRenewalSessions(stripe, jobId);
    if (!openRenewals) return retryableRefusal(SESSION_CHECK_UNAVAILABLE_MESSAGE, 'RENEWAL_CHECK_UNAVAILABLE');
    // A session from another window can never be the one this key replays
    // (expires_at is a function of the window), so those close BEFORE the
    // create. A session from this window may be exactly that replay (a
    // double click), and expiring it first would hand the employer a dead
    // checkout; whether it is becomes known only from the create's answer.
    const fromOtherWindows = openRenewals.filter((s) => s.expires_at !== expiresAt);
    if (!(await closeRenewalSessions(stripe, jobId, fromOtherWindows))) {
      return previousCheckoutStillOpen();
    }
    const openThisWindow = openRenewals.filter((s) => s.expires_at === expiresAt);

    const session = await createLiveRenewalSession(stripe, {
      params: renewalSessionParams(checkout, gaMetadata),
      idempotencyKey,
      listedOpen: new Set(openThisWindow.map((s) => s.id)),
      requestedAtSec: Math.floor(nowMs / 1000),
      jobId,
    });
    if (session instanceof NextResponse) return session;

    if (!session.url) {
      return NextResponse.json(
        { error: 'Checkout session created but URL is missing' },
        { status: 502 }
      );
    }

    // This window's other sessions: one minted under a different key (the GA
    // ids changed between two clicks) is a second payable session. Closed
    // only now, with a session known to be payable in hand. If closing one
    // fails, the new session stays unreachable because its URL is never
    // returned, and a retry inside the window replays it and tries again.
    const otherThisWindow = openThisWindow.filter((s) => s.id !== session.id);
    if (!(await closeRenewalSessions(stripe, jobId, otherThisWindow))) {
      return previousCheckoutStillOpen();
    }

    // Sec3 fix (2026-06-01): same cookie-binding pattern as
    // /api/create-checkout. /api/verify-renewal-session now requires
    // this cookie before handing out the dashboardToken. Without it,
    // anyone who learned a session_id (browser history, referer
    // headers) could harvest the management token for a renewed job.
    const response = NextResponse.json({
      sessionId: session.id,
      url: session.url,
    });
    response.cookies.set('pmhnp_renewal_session', session.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      // The session's expires_at is derived from this lifetime.
      maxAge: RENEWAL_SESSION_COOKIE_MAX_AGE_S,
    });
    return response;
  } catch (error) {
    logger.error('Error creating renewal checkout session', error);
    return NextResponse.json(
      { error: 'Failed to create checkout session' },
      { status: 500 }
    );
  }
}

/** A short, stable digest for an idempotency key: 12 hex characters of SHA-256. */
function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

interface RenewalCheckout {
  employerJob: { id: string; contactEmail: string; job: { title: string; employer: string } };
  jobId: string;
  tier: PricingTier;
  /** Whole days this renewal adds: the posting period, or what the renewal cap leaves of it. */
  daysAdded: number;
  /** expires_at of the session, in epoch seconds. */
  expiresAt: number;
}

/**
 * The Checkout Session parameters. Payment methods follow the Dashboard
 * settings (see create-checkout). The line item and the invoice description
 * are what the employer reads on Stripe's page and on the invoice, so they
 * follow the house style, and the days stated are the days this renewal
 * adds, which near the renewal cap is fewer than the posting period.
 */
function renewalSessionParams(
  checkout: RenewalCheckout,
  gaMetadata: Record<string, string>,
): Stripe.Checkout.SessionCreateParams {
  const { employerJob, jobId, tier, daysAdded } = checkout;
  const { title, employer } = employerJob.job;
  const baseUrl = getBaseUrl();
  return {
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: {
            name: `Job renewal: ${title}`,
            description: `${employer}, ${daysAdded} more ${daysAdded === 1 ? 'day' : 'days'}`,
          },
          // Renewal price is flat for every renewable rung.
          unit_amount: config.stripeRenewalPriceInCents,
        },
        quantity: 1,
      },
    ],
    mode: 'payment',
    expires_at: checkout.expiresAt,
    success_url: `${baseUrl}/employer/renewal-success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/employer/dashboard`,
    customer_email: employerJob.contactEmail,
    billing_address_collection: 'required',
    tax_id_collection: { enabled: true },
    // Force Stripe receipt regardless of dashboard toggle — see comment in
    // /api/create-checkout for rationale.
    payment_intent_data: {
      receipt_email: employerJob.contactEmail,
    },
    invoice_creation: {
      enabled: true,
      invoice_data: {
        description: `Job renewal: ${title}, ${employer}`,
        metadata: {
          jobId,
          employerJobId: employerJob.id,
          type: 'renewal',
        },
        rendering_options: { amount_tax_display: 'exclude_tax' },
      },
    },
    metadata: {
      jobId,
      type: 'renewal',
      tier,
      ...gaMetadata,
    },
  };
}

interface RenewalSessionRequest {
  params: Stripe.Checkout.SessionCreateParams;
  idempotencyKey: string;
  /** This window's renewal sessions the open listing showed moments ago. */
  listedOpen: ReadonlySet<string>;
  /** When this request began, in epoch seconds. */
  requestedAtSec: number;
  jobId: string;
}

/**
 * Create the renewal session, and make sure the one handed back can still
 * be paid.
 *
 * Stripe answers a reused idempotency key with its cached first response:
 * the session as it was when it was created ('open', with its URL), whatever
 * happened to it since. This route itself expires sessions: another browser
 * renewing the same post in this window (other GA ids, so another key)
 * closes this browser's session as the window's other one. Its next click
 * then replayed the dead session, closed the live one as the "other", and
 * returned a dead URL, and nobody could pay until the window rolled over.
 *
 * So a session the create hands back is checked (sessionStatusNow). Expired:
 * a replacement is minted under a key derived from the dead session's id,
 * which every later click from this browser replays in turn, walking on if
 * the replacement was closed too. Completed (a payment went through on it,
 * or is settling) or unreadable: refused, as nothing safe can be handed
 * out. The caller closes the window's other sessions only once this
 * returns a session.
 */
async function createLiveRenewalSession(
  stripe: Stripe,
  request: RenewalSessionRequest,
): Promise<Stripe.Checkout.Session | NextResponse> {
  const { params, jobId } = request;
  let idempotencyKey = request.idempotencyKey;
  for (let replaced = 0; replaced <= MAX_REPLACED_SESSIONS; replaced += 1) {
    const session = await stripe.checkout.sessions.create(params, { idempotencyKey });
    const status = await sessionStatusNow(stripe, session, request);
    if (status === 'open') return session;
    if (status === 'complete') {
      logger.warn('[RenewalCheckout] The idempotency key replayed a completed renewal session; refused to start another', { jobId, sessionId: session.id });
      return previousCheckoutStillOpen();
    }
    if (status !== 'expired') return retryableRefusal(SESSION_CHECK_UNAVAILABLE_MESSAGE, 'RENEWAL_CHECK_UNAVAILABLE');
    logger.info('[RenewalCheckout] The idempotency key replayed an expired renewal session; minting its replacement', { jobId, sessionId: session.id });
    idempotencyKey = `${request.idempotencyKey}-after-${digest(session.id)}`;
  }
  logger.error('[RenewalCheckout] The idempotency key kept replaying expired renewal sessions; refused to start another', null, {
    jobId,
    replaced: MAX_REPLACED_SESSIONS + 1,
  });
  return retryableRefusal(SESSION_CHECK_UNAVAILABLE_MESSAGE, 'RENEWAL_CHECK_UNAVAILABLE');
}

/**
 * The session's status now; null when it cannot be read. The create's own
 * answer is trusted for a session the open listing showed moments ago, and
 * for one Stripe stamped as created since this request began, which this
 * request minted. Anything else is the replay of an earlier response and is
 * read back. This server's clock running ahead of Stripe's makes a new
 * session look older, which costs one read and nothing else.
 */
async function sessionStatusNow(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
  request: RenewalSessionRequest,
): Promise<Stripe.Checkout.Session.Status | null> {
  if (request.listedOpen.has(session.id)) return 'open';
  if (typeof session.created === 'number' && session.created >= request.requestedAtSec) return 'open';
  try {
    return (await stripe.checkout.sessions.retrieve(session.id)).status;
  } catch (err) {
    logger.error('[RenewalCheckout] Could not read back a replayed renewal session; refused to hand it out', err, {
      jobId: request.jobId,
      sessionId: session.id,
    });
    return null;
  }
}

/** 503 with Retry-After: nothing payable was handed out, and trying again is safe. */
function retryableRefusal(error: string, code: string): NextResponse {
  return NextResponse.json(
    { error, code },
    { status: 503, headers: { 'Retry-After': String(REFUSAL_RETRY_AFTER_S) } },
  );
}

/** An earlier renewal session for the post may still be payable (or was just paid). */
function previousCheckoutStillOpen(): NextResponse {
  return retryableRefusal(
    'An earlier renewal checkout for this job could not be closed, so a new one was not started. If you already paid, your renewal will be applied shortly. Otherwise, please try again in a minute.',
    'PREVIOUS_RENEWAL_CHECKOUT_OPEN',
  );
}

/**
 * The post's renewal payments in flight, or null when Stripe or the ledger
 * could not be asked. Refused on null for the reason findOpenRenewalSessions
 * gives: a retry costs the employer a minute, a second payment costs a refund.
 */
async function findRenewalPaymentInFlight(stripe: Stripe, jobId: string): Promise<RenewalPaymentInFlight[] | null> {
  try {
    return await findRenewalPaymentsInFlight(stripe, jobId);
  } catch (err) {
    logger.error('[RenewalCheckout] Could not check for a renewal payment in flight; refused to start another', err, { jobId });
    return null;
  }
}

/**
 * Apply the renewal payments Stripe holds that are not on the ledger: the
 * webhook was lost or is still on its way, and the employer is here now.
 * Telling them "we are applying it" while nothing on this path did left the
 * post expired until the daily sweep ran. This is the same fulfilment the
 * webhook runs (its JobCharge-first transaction makes a race with a late
 * webhook harmless), as /api/verify-renewal-session runs it for the success
 * page. True only when every one of them is on the books.
 */
async function applyPaidRenewals(
  stripe: Stripe,
  jobId: string,
  payments: readonly RenewalPaymentInFlight[],
): Promise<boolean> {
  let allApplied = true;
  for (const { sessionId } of payments) {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.payment_status !== 'paid' || session.metadata?.type !== 'renewal' || session.metadata?.jobId !== jobId) {
        throw new Error(`Session ${sessionId} no longer reads as a paid renewal of this post`);
      }
      const result = await applyRenewalCheckout(stripe, session);
      if (result.outcome === 'applied' || result.outcome === 'already_applied') {
        logger.info('[RenewalCheckout] Applied a paid renewal found in flight', { jobId, sessionId, outcome: result.outcome });
        continue;
      }
      // Refused by the fulfilment (revoked posting, renewal cap) or the row is
      // gone. Error level, so it reaches Sentry: money is held for nothing.
      logger.error('[RenewalCheckout] A paid renewal found in flight was not applied', null, {
        jobId, sessionId, outcome: result.outcome, status: result.revokedStatus,
      });
    } catch (err) {
      logger.error('[RenewalCheckout] Could not apply a paid renewal found in flight', err, { jobId, sessionId });
    }
    allApplied = false;
  }
  return allApplied;
}

/**
 * 409: the renewal already paid for is applied here and now; one that is
 * still settling, or could not be applied, applies on its own.
 */
async function renewalPaymentInFlight(
  stripe: Stripe,
  jobId: string,
  inFlight: readonly RenewalPaymentInFlight[],
): Promise<NextResponse> {
  const unapplied = inFlight.filter((payment) => payment.state === 'paid_unapplied');
  if (unapplied.length > 0 && (await applyPaidRenewals(stripe, jobId, unapplied))) {
    return NextResponse.json({ error: RENEWAL_APPLIED_MESSAGE, code: 'RENEWAL_ALREADY_PAID' }, { status: 409 });
  }
  const state = PAYMENT_IN_FLIGHT_PRECEDENCE.find((s) => inFlight.some((payment) => payment.state === s)) ?? inFlight[0].state;
  logger.info('[RenewalCheckout] A renewal payment for the post is in flight; refused to start another', {
    jobId,
    inFlight: inFlight.map((payment) => `${payment.sessionId}:${payment.state}`),
  });
  return NextResponse.json(
    { error: PAYMENT_IN_FLIGHT_MESSAGES[state], code: 'RENEWAL_PAYMENT_PROCESSING' },
    { status: 409 },
  );
}

/**
 * The post's open renewal sessions, or null when Stripe could not be asked.
 * Refusing on null is deliberate: proceeding would mint a session next to
 * one that may still be payable, which is the double payment this route
 * exists to prevent, while a refusal costs the employer one retry.
 */
async function findOpenRenewalSessions(stripe: Stripe, jobId: string): Promise<Stripe.Checkout.Session[] | null> {
  try {
    const { sessions } = await listRenewalSessionsForJob(stripe, jobId, {
      status: 'open',
      createdSince: Math.floor((Date.now() - STRIPE_MAX_SESSION_LIFETIME_MS) / 1000),
    });
    return sessions;
  } catch (err) {
    logger.error('[RenewalCheckout] Could not list open renewal sessions; refused to start another', err, { jobId });
    return null;
  }
}

/** Expire the sessions; false when any of them may still take money (the caller refuses). */
async function closeRenewalSessions(
  stripe: Stripe,
  jobId: string,
  sessions: readonly Stripe.Checkout.Session[],
): Promise<boolean> {
  if (sessions.length === 0) return true;
  const { expired, failed } = await expireCheckoutSessions(stripe, sessions.map((s) => s.id));
  if (failed.length > 0) {
    logger.error('[RenewalCheckout] Could not expire an open renewal session; refused to start another', null, {
      jobId,
      failed,
      expired,
    });
    return false;
  }
  logger.info('[RenewalCheckout] Expired other open renewal sessions for the post', { jobId, sessionIds: expired });
  return true;
}

