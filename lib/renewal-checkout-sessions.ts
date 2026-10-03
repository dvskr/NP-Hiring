/**
 * Renewal Checkout Sessions: at most one payable renewal per post
 * (backlog 2.5).
 *
 * /api/create-renewal-checkout reuses one idempotency key for a ten minute
 * window, so a double click gets one session. Until this module a renewal
 * session also lived Stripe's default 24 hours and nothing retired the older
 * ones: an employer who started a renewal, came back ten or more minutes
 * later and started another held two payable sessions for one post, and
 * could pay both. Four guards close that, with no schema change:
 *
 *   1. the create route refuses (409) while a renewal payment for the post
 *      is in flight: paid but not on the ledger yet, or a delayed payment
 *      (ACH and similar) still settling (findRenewalPaymentsInFlight);
 *   2. the create route expires every other open renewal session for the
 *      post before it hands out a new one, and refuses (503, retryable) when
 *      it cannot confirm either check;
 *   3. every renewal session carries a short expires_at derived from its
 *      idempotency window (renewalSessionExpiresAt), so an abandoned one
 *      stops being payable within the hour instead of the day;
 *   4. once a renewal is applied, app/api/webhooks/stripe/apply-renewal.ts
 *      expires the post's other open renewal sessions and alerts a human
 *      when another one was paid as well (never an automatic refund).
 *
 * Sessions are found by listing Checkout Sessions (Stripe's Search API does
 * not cover them) and matching metadata.type === 'renewal' and
 * metadata.jobId, both written by the create route. Sessions of other posts,
 * and new-post sessions for the same post, are never touched.
 */
import type Stripe from 'stripe';
import { renewalExpiresAt } from '@/lib/expires-at';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

/**
 * Reuse window of the renewal idempotency key: a double click or a client
 * retry inside one window replays the same session; a later attempt (the
 * next window, or after the post's expiry moved) gets a fresh one.
 */
export const RENEWAL_IDEMPOTENCY_WINDOW_MS = 10 * 60 * 1000;

/**
 * Lifetime of the httpOnly renewal session cookie the create route sets.
 * /api/verify-renewal-session hands the management token only to the
 * browser holding it, so a renewal must not stay payable after the cookie
 * set by the request that created its session has gone.
 */
export const RENEWAL_SESSION_COOKIE_MAX_AGE_S = 60 * 60;

/**
 * How long before that cookie expires a renewal session closes: room for the
 * redirect to the success page, and its verify call, after a payment made in
 * the session's last minute.
 */
const COOKIE_MARGIN_MS = 5 * 60 * 1000;

/**
 * A renewal session's lifetime, counted from the START of its idempotency
 * window (55 minutes). The creating request lands somewhere inside the
 * window, so the session closes 45 to 55 minutes after that request:
 *   - never after the cookie that request set (60 minutes), less the margin;
 *   - always beyond Stripe's 30 minute minimum for expires_at, with 15
 *     minutes to spare for clock skew between this server and Stripe.
 * Counting from the window start, not from the request, is what keeps
 * expires_at identical for every request that shares an idempotency key:
 * Stripe refuses a reused key whose parameters differ.
 */
export const RENEWAL_SESSION_LIFETIME_MS = RENEWAL_SESSION_COOKIE_MAX_AGE_S * 1000 - COOKIE_MARGIN_MS;

/**
 * Stripe's longest Checkout Session lifetime, and its default when
 * expires_at is not set. Any session that can still be open, including a
 * renewal session created before renewal sessions carried expires_at, was
 * created within this much of now, so it bounds every scan below.
 */
export const STRIPE_MAX_SESSION_LIFETIME_MS = 24 * 60 * 60 * 1000;

/**
 * How far back a renewal payment can still be on its way. A delayed payment
 * method (ACH and similar) completes the Checkout Session before the money
 * arrives: its PaymentIntent is 'requires_action' while the employer has yet
 * to verify microdeposits, which Stripe keeps open for up to 10 days, then
 * 'processing' while the debit settles, which takes several business days
 * more. Three weeks covers both, after the day a session can stay open
 * before it completes, with room for weekends and bank holidays.
 */
export const RENEWAL_SETTLEMENT_LOOKBACK_MS = 21 * 24 * 60 * 60 * 1000;

/** The idempotency window a moment falls in. */
export function renewalIdempotencyWindow(nowMs: number): number {
  return Math.floor(nowMs / RENEWAL_IDEMPOTENCY_WINDOW_MS);
}

/** expires_at (epoch seconds) of every renewal session created in `windowIndex`. */
export function renewalSessionExpiresAt(windowIndex: number): number {
  return Math.floor((windowIndex * RENEWAL_IDEMPOTENCY_WINDOW_MS + RENEWAL_SESSION_LIFETIME_MS) / 1000);
}

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RenewalExtension {
  /** The expiry a renewal applied now writes (lib/expires-at.ts#renewalExpiresAt). */
  expiresAt: Date;
  /** Whole days that adds to the listing; 0 at or past the renewal cap. */
  daysAdded: number;
}

/**
 * What a renewal applied at `now` does to a post's expiry.
 *
 * A renewal adds `durationDays` to the later of now and the current expiry,
 * and never past config.renewalCapDays after the post was created. For a
 * post that already runs to that cap the result is the unchanged expiry, and
 * for one older than the cap it is a date already gone: money taken for a
 * listing that does not move. The create route and the fulfilment both read
 * `daysAdded` from here, so a renewal that adds no full day is neither sold
 * nor applied, and Checkout states the days a renewal near the cap really
 * adds.
 */
export function renewalExtension(
  job: { expiresAt: Date | null; createdAt: Date },
  durationDays: number,
  now: Date = new Date(),
): RenewalExtension {
  const expiresAt = renewalExpiresAt({
    currentExpiry: job.expiresAt,
    originalCreatedAt: job.createdAt,
    durationDays,
    now,
  });
  const runsUntil = Math.max(now.getTime(), job.expiresAt?.getTime() ?? 0);
  return { expiresAt, daysAdded: Math.max(0, Math.floor((expiresAt.getTime() - runsUntil) / DAY_MS)) };
}

/** Page size of the session listing (Stripe's maximum). */
const LIST_PAGE_SIZE = 100;

/**
 * Most sessions one scan reads. Stripe lists newest first, so a scan stopped
 * here leaves unread only the oldest sessions of the range. For the open
 * scan that is at worst a renewal session created before renewal sessions
 * carried expires_at (one minted by the create route is payable for under an
 * hour); for the in-flight scan it is the completed renewals whose payment
 * has had the longest to settle. Reaching the cap means hundreds of sessions
 * in the range, so it is logged as an error (forwarded to Sentry) with the
 * range that went unread.
 */
export const MAX_RENEWAL_SESSIONS_SCANNED = 500;

export interface RenewalSessionScan {
  /** The post's renewal sessions, newest first. */
  sessions: Stripe.Checkout.Session[];
  /** True when the scan stopped at MAX_RENEWAL_SESSIONS_SCANNED with sessions left unread. */
  capped: boolean;
}

export interface RenewalSessionScanOptions {
  /** Epoch seconds: only sessions created at or after this are read. */
  createdSince: number;
  /** Only sessions in this state; every state when omitted. */
  status?: Stripe.Checkout.SessionListParams.Status;
}

/**
 * The post's renewal Checkout Sessions created since `createdSince`.
 * Stripe errors propagate: each caller decides what a failed scan means.
 */
export async function listRenewalSessionsForJob(
  stripe: Stripe,
  jobId: string,
  options: RenewalSessionScanOptions,
): Promise<RenewalSessionScan> {
  const sessions: Stripe.Checkout.Session[] = [];
  let scanned = 0;
  let oldestScannedCreated: number | null = null;
  let capped = false;

  for await (const candidate of stripe.checkout.sessions.list({
    created: { gte: options.createdSince },
    limit: LIST_PAGE_SIZE,
    ...(options.status ? { status: options.status } : {}),
  })) {
    if (scanned >= MAX_RENEWAL_SESSIONS_SCANNED) {
      capped = true;
      break;
    }
    scanned += 1;
    oldestScannedCreated = candidate.created;
    if (candidate.metadata?.type === 'renewal' && candidate.metadata?.jobId === jobId) {
      sessions.push(candidate);
    }
  }

  if (capped) {
    logger.error('[RenewalSessions] Session scan stopped at the cap; older sessions in the range were not checked', null, {
      jobId,
      status: options.status ?? 'any',
      cap: MAX_RENEWAL_SESSIONS_SCANNED,
      uncheckedFrom: options.createdSince,
      uncheckedUntil: oldestScannedCreated,
    });
  }
  return { sessions, capped };
}

/**
 * Why a renewal payment for the post counts as in flight:
 *   paid_unapplied        Stripe has the money, and no renewal path (the
 *                         webhook, the verify page self-heal, the sweep) has
 *                         put it on the ledger yet;
 *   processing            a delayed payment is settling;
 *   awaiting_verification the employer has yet to verify the bank account
 *                         (ACH microdeposits), and the payment can still
 *                         succeed.
 */
export type RenewalPaymentInFlightState = 'paid_unapplied' | 'processing' | 'awaiting_verification';

export interface RenewalPaymentInFlight {
  sessionId: string;
  state: RenewalPaymentInFlightState;
}

/**
 * The post's renewal payments that Stripe has taken, or may still take, but
 * that are not on the books. A renewal bought next to one of them is a second
 * payment for one renewal, which until now only the alert in apply-renewal
 * caught, after the money was taken.
 *
 * Completed renewal sessions created within RENEWAL_SETTLEMENT_LOOKBACK_MS
 * are read through the same capped scan as the open ones. The money decides,
 * as in /api/create-checkout's retirePreviousSession: a delayed payment
 * completes its session while it is still 'unpaid', so an unpaid session is
 * read back with its PaymentIntent, and one whose payment failed (the intent
 * is back to 'requires_payment_method', or 'canceled') is not in flight. A
 * paid session stays in flight until its JobCharge row exists, the row every
 * renewal path writes first.
 *
 * Stripe and database errors propagate: whether a payment is in flight is
 * then unknown, and the caller decides what that means.
 */
export async function findRenewalPaymentsInFlight(
  stripe: Stripe,
  jobId: string,
  nowMs: number = Date.now(),
): Promise<RenewalPaymentInFlight[]> {
  const { sessions } = await listRenewalSessionsForJob(stripe, jobId, {
    status: 'complete',
    createdSince: Math.floor((nowMs - RENEWAL_SETTLEMENT_LOOKBACK_MS) / 1000),
  });
  const settling: RenewalPaymentInFlight[] = [];
  const paid: string[] = [];
  for (const listed of sessions) {
    // Only a completed session carries a payment; the listing asks for those.
    if (listed.status !== 'complete') continue;
    const session = listed.payment_status === 'unpaid'
      ? await stripe.checkout.sessions.retrieve(listed.id, { expand: ['payment_intent'] })
      : listed;
    if (session.payment_status === 'paid') {
      paid.push(session.id);
      continue;
    }
    const state = unsettledPaymentState(session);
    if (state) settling.push({ sessionId: session.id, state });
  }
  const unapplied = (await withoutLedgerRow(paid)).map((sessionId) => ({ sessionId, state: 'paid_unapplied' as const }));
  return [...unapplied, ...settling];
}

/** A completed, unpaid session whose payment can still succeed; null when it cannot. */
function unsettledPaymentState(session: Stripe.Checkout.Session): RenewalPaymentInFlightState | null {
  if (session.payment_status !== 'unpaid') return null;
  const intent = session.payment_intent;
  const intentStatus = intent && typeof intent === 'object' ? intent.status : null;
  if (intentStatus === 'processing') return 'processing';
  if (intentStatus === 'requires_action') return 'awaiting_verification';
  return null;
}

/** The paid sessions that no JobCharge row records yet. */
async function withoutLedgerRow(sessionIds: readonly string[]): Promise<string[]> {
  if (sessionIds.length === 0) return [];
  const charges = await prisma.jobCharge.findMany({
    where: { stripeSessionId: { in: [...sessionIds] } },
    select: { stripeSessionId: true },
  });
  const ledgered = new Set(charges.map((charge) => charge.stripeSessionId));
  return sessionIds.filter((sessionId) => !ledgered.has(sessionId));
}

export interface SessionExpiryResult {
  expired: string[];
  /** Sessions that may still take, or may have taken, money, with what Stripe said. */
  failed: Array<{ sessionId: string; reason: string }>;
}

/**
 * Expire each session, one at a time (a post rarely has more than one to
 * close). Stripe refuses to expire a session that is no longer open, so a
 * refusal is checked against the session's current state: one that expired
 * meanwhile, by its own expires_at or by a concurrent request, has reached
 * the goal state and counts as expired. Anything else (completed by a
 * payment, or still open after an error) is reported as failed.
 */
export async function expireCheckoutSessions(stripe: Stripe, sessionIds: readonly string[]): Promise<SessionExpiryResult> {
  const expired: string[] = [];
  const failed: SessionExpiryResult['failed'] = [];
  for (const sessionId of sessionIds) {
    const reason = await expireOne(stripe, sessionId);
    if (reason === null) expired.push(sessionId);
    else failed.push({ sessionId, reason });
  }
  return { expired, failed };
}

/** null once the session can no longer be paid; otherwise why it may still be payable. */
async function expireOne(stripe: Stripe, sessionId: string): Promise<string | null> {
  try {
    await stripe.checkout.sessions.expire(sessionId);
    return null;
  } catch (expireErr) {
    const expireMessage = expireErr instanceof Error ? expireErr.message : String(expireErr);
    try {
      const current = await stripe.checkout.sessions.retrieve(sessionId);
      if (current.status === 'expired') return null;
      return `${expireMessage} (session status: ${current.status ?? 'unknown'})`;
    } catch (retrieveErr) {
      const retrieveMessage = retrieveErr instanceof Error ? retrieveErr.message : String(retrieveErr);
      return `${expireMessage} (status check failed: ${retrieveMessage})`;
    }
  }
}

export type PayableWindow = Pick<Stripe.Checkout.Session, 'created' | 'expires_at'>;

/**
 * True when two sessions were payable at a shared moment: each was created
 * before the other expired. Two paid renewal sessions for one post that
 * overlap like this are a double payment for one renewal. The dashboard and
 * the edit page offer a renewal only while a post is expired or about to
 * expire, and a paid renewal moves the expiry config.durationDays out, so
 * nobody is offered a second renewal inside one session lifetime. The
 * exception is a post at its renewal cap (lib/expires-at.ts), where the
 * second renewal extends nothing: a human should see that one too.
 */
export function payableWindowsOverlap(a: PayableWindow, b: PayableWindow): boolean {
  return a.created < b.expires_at && b.created < a.expires_at;
}
