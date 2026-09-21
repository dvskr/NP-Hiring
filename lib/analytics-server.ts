/**
 * Server side analytics: the GA4 Measurement Protocol.
 *
 * The Stripe webhook is the only place where we authoritatively know that a
 * payment completed, so the `purchase` event has to originate here. Every
 * other step of the funnel is measured in the browser (lib/analytics.ts).
 *
 * ENVIRONMENT
 *   GA_MEASUREMENT_ID  The SAME G- id the browser tag uses. It exists as its
 *                      own variable only because NEXT_PUBLIC_GA_MEASUREMENT_ID
 *                      is inlined at build time, and server code should not
 *                      depend on a build time value. Pointing it at a second
 *                      GA4 property would permanently split server revenue
 *                      away from browser traffic, and the two properties can
 *                      never be joined afterwards. That is why an unset value
 *                      falls back to the public id rather than disabling the
 *                      send.
 *   GA_API_SECRET      The only genuinely server side credential here. GA4
 *                      Admin > Data Streams > Measurement Protocol API
 *                      secrets. A secret belongs to one data stream, so it
 *                      must come from the stream that owns GA_MEASUREMENT_ID.
 *   GA_MP_DEBUG=1      Optional, and deliberately ignored when NODE_ENV is
 *                      production. It routes the send to the validation
 *                      endpoint, which returns the payload errors the
 *                      production endpoint hides behind its 204, but which
 *                      validates and then discards the event. Honouring it on
 *                      Vercel would destroy every purchase while this module
 *                      still reported "sent", which is the precise silent
 *                      failure the module exists to remove. Vercel ticks the
 *                      production environment by default when a variable is
 *                      added, so that accident is one click away. Production
 *                      therefore ignores the flag and warns instead of
 *                      trusting whoever set it.
 *
 * Without a measurement id and an API secret every call is a no op. That is
 * the current production state and it is deliberate, so the no op stays quiet
 * at info level and announces itself at debug level: "never configured" and
 * "configured and failing" must not look identical to whoever is debugging.
 *
 * ATTRIBUTION
 *   A purchase only joins the browser funnel when it carries both real
 *   browser ids: the `_ga` client id and the `_ga_<stream>` session id. Both
 *   Stripe webhook call sites still pass a Prisma job UUID as the client id
 *   and no session id at all, so every event today lands as a brand new
 *   direct user. That degraded case warns at warn level rather than debug,
 *   because lib/logger.ts raises the minimum level to info in production and
 *   this is the one fault here that is true for 100 percent of purchases: at
 *   debug level the owner would switch GA4 on and production would say
 *   nothing whatsoever about the misattribution.
 */

import { after } from 'next/server';

import { logger } from '@/lib/logger';

const MP_ENDPOINT = 'https://www.google-analytics.com/mp/collect';
const MP_VALIDATION_ENDPOINT = 'https://www.google-analytics.com/debug/mp/collect';

/** The webhook must answer Stripe quickly, so the send gets a short leash. */
const MP_TIMEOUT_MS = 5000;

/**
 * GA4 counts an event as engaged only when engagement_time_msec is present
 * and positive. A server event has no dwell time to report, so we send the
 * smallest truthful value: enough to be counted, too small to distort the
 * average engagement time of a real session.
 */
const ENGAGEMENT_TIME_MSEC = '1';

/** GA4 discards Measurement Protocol events stamped older than this. */
const MP_MAX_EVENT_AGE_MS = 72 * 60 * 60 * 1000;

/** A browser client id from the `_ga` cookie always reads `<digits>.<digits>`. */
const GA_CLIENT_ID_PATTERN = /^\d+\.\d+$/;

/**
 * A GA4 session id is the session start time in unix seconds, so it is digits
 * only. The `_ga_<stream>` cookie wraps it (`GS2.1.s1748000000$o12$g1`), and
 * forwarding that wrapper verbatim is the mistake this pattern exists to
 * catch.
 */
const GA_SESSION_ID_PATTERN = /^\d+$/;

/** GA4 stream ids read `G-` plus an alphanumeric suffix. */
const GA_MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]+$/i;

/**
 * GA4 session ids are conventionally the session start time in unix seconds.
 * A synthesized one is kept inside that range so nothing downstream has to
 * treat it as a special case.
 */
const SYNTHETIC_SESSION_ID_FLOOR = 1_000_000_000;
const SYNTHETIC_SESSION_ID_SPAN = 1_000_000_000;

export type GaIdSource = 'ga_cookie' | 'synthetic';

/**
 * Deliberately a discriminated union rather than void. The two silent
 * outcomes, "not configured" and "sent", used to be indistinguishable from
 * the outside, which is how analytics stays broken for months without anyone
 * noticing.
 */
export type TrackServerPurchaseResult =
  | { status: 'skipped'; reason: 'not_configured' }
  | {
      status: 'sent';
      /**
       * The verdict that matters, and the one stamped on the event. It reads
       * 'ga_cookie' only when the client id AND the session id both came from
       * the buyer cookies, because either one missing detaches the purchase
       * from the browser funnel just as completely.
       */
      attributionSource: GaIdSource;
      /** Which half failed, for a caller or a test that wants the detail. */
      clientIdSource: GaIdSource;
      sessionIdSource: GaIdSource;
    }
  | { status: 'failed'; reason: 'http_error' | 'network_error'; detail: string };

export interface PurchaseParams {
  /**
   * Fallback identifier, used only when `gaClientId` is absent or unusable.
   * Today both webhook call sites pass a Prisma job UUID here, which GA4
   * accepts but cannot join to anything: it becomes a brand new user in a
   * brand new direct session, detached from the begin_checkout the same
   * person fired in the browser minutes earlier. See `gaClientId`.
   */
  clientId: string;
  /**
   * The real GA4 client id from the buyer `_ga` cookie, shaped
   * `<digits>.<digits>`. Supplying it is what makes the purchase attach to
   * the session and the traffic source that produced it. The webhook has no
   * visitor request to read cookies from, so the value has to be captured
   * when the checkout session is created and carried through Stripe
   * metadata. `parseGaCookieHeader` below does the capture half.
   */
  gaClientId?: string;
  /**
   * The real GA4 session id from the `_ga_<stream suffix>` cookie: unix
   * seconds, digits only. Optional, and validated rather than trusted,
   * because it reaches this module through Stripe metadata, which is an
   * untyped external string store. A caller who forwards the raw cookie
   * (`GS2.1.s1748000000$o12`) would buy a 204 and an event that never appears
   * in any session scoped report, which is the exact invisible failure this
   * module exists to remove. Anything unusable falls back to a stable
   * synthetic id derived from `sessionId`.
   */
  gaSessionId?: string;
  /** Stripe checkout session id. Doubles as transaction_id, which GA4 dedupes on. */
  sessionId: string;
  /** Total amount paid. */
  amountCents: number;
  currency: string;
  /** 'new' job post or 'renewal'. */
  type: 'new' | 'renewal';
  /** Optional: pricing tier carried in Stripe metadata. */
  tier?: string;
  /** Optional: jobId for funnel attribution. */
  jobId?: string;
  /**
   * Optional: when the payment actually happened, in epoch milliseconds.
   * Worth passing from the reconciliation and self heal paths, which can run
   * hours after the charge. Omitted means "stamp it on arrival".
   */
  eventTimeMs?: number;
}

export interface GaBrowserIds {
  gaClientId?: string;
  gaSessionId?: string;
}

/**
 * Pull the GA4 client id and session id out of a request Cookie header.
 *
 * This lives beside the sender rather than in the checkout routes so the
 * cookie format and the payload that consumes it cannot drift apart. Both
 * cookies are first party and not HttpOnly, so a same origin POST to our own
 * checkout route already carries them: no client side change is needed to
 * start supplying real ids.
 *
 * `_ga` reads `GA1.<n>.<clientId>` where clientId is the last two segments.
 * `_ga_<suffix>` has two shipped formats: `GS1.1.<sessionId>.<n>...` and the
 * newer `GS2.1.s<sessionId>$o<n>$g<n>...`. Both are handled because a visitor
 * who has not returned since the format changed still carries the old one.
 */
export function parseGaCookieHeader(
  cookieHeader: string | null | undefined,
  // Defaulted from the environment rather than left undefined. The any-stream
  // scan below is only safe when our own cookie name is genuinely unknowable.
  // Leaving that to the caller means one omitted argument silently re-enables
  // the scan, which can adopt a stale cookie from a previously installed GA4
  // property and produce a hit stamped as well attributed that points at a
  // session in another property. Those cookies live two years, so the window
  // opens the moment the owner ever switches properties.
  measurementId: string | undefined = process.env.GA_MEASUREMENT_ID || process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID,
): GaBrowserIds {
  if (!cookieHeader) return {};

  const cookies = new Map<string, string>();
  for (const pair of cookieHeader.split(';')) {
    const separator = pair.indexOf('=');
    if (separator === -1) continue;
    const name = pair.slice(0, separator).trim();
    if (name) cookies.set(name, pair.slice(separator + 1).trim());
  }

  const result: GaBrowserIds = {};

  const gaCookie = cookies.get('_ga');
  if (gaCookie) {
    const segments = gaCookie.split('.');
    const candidate = segments.slice(-2).join('.');
    if (GA_CLIENT_ID_PATTERN.test(candidate)) result.gaClientId = candidate;
  }

  // The scan is the fallback for not KNOWING the cookie name, never for the
  // named cookie being absent. When the measurement id is known and its
  // cookie is missing, any other `_ga_*` cookie belongs to a different GA4
  // stream: a stale install, a consent tool, a second property. Its session
  // id does not exist in the property that receives this event, so accepting
  // it would produce a hit stamped as well attributed and pointing at
  // nothing.
  const streamCookieName = measurementId?.startsWith('G-')
    ? `_ga_${measurementId.slice(2)}`
    : undefined;
  const sessionCookie = streamCookieName
    ? cookies.get(streamCookieName)
    : [...cookies.entries()].find(([name]) => /^_ga_[A-Z0-9]+$/i.test(name))?.[1];

  if (sessionCookie) {
    const sessionId = parseGaSessionCookie(sessionCookie);
    if (sessionId) result.gaSessionId = sessionId;
  }

  return result;
}

function parseGaSessionCookie(value: string): string | undefined {
  const raw = value.split('.')[2];
  if (!raw) return undefined;
  const token = raw.split('$')[0];
  const digits = token.startsWith('s') ? token.slice(1) : token;
  return GA_SESSION_ID_PATTERN.test(digits) ? digits : undefined;
}

/**
 * FNV-1a, 32 bit. Not security relevant: the only requirement is that one
 * Stripe checkout session always maps to the same GA session id. A timestamp
 * would scatter a single purchase across several GA sessions whenever the
 * event is sent more than once, which the webhook retry, the
 * verify-checkout-session self heal and the daily reconciliation all can do.
 */
function stableSessionId(seed: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return String(SYNTHETIC_SESSION_ID_FLOOR + (hash % SYNTHETIC_SESSION_ID_SPAN));
}

function resolveClientId(params: PurchaseParams): { clientId: string; source: GaIdSource } {
  const supplied = params.gaClientId?.trim();
  if (supplied && GA_CLIENT_ID_PATTERN.test(supplied)) {
    return { clientId: supplied, source: 'ga_cookie' };
  }
  // A supplied id that fails the shape check is DISCARDED, not forwarded.
  // It reached us through Stripe metadata, the same store that carries the
  // employer dashboard token, so a value that is not shaped like a client id
  // is a string of unknown provenance and must not be posted to Google. The
  // job identifier is at least ours and at least stable. This mirrors
  // resolveSessionId below; the two must stay symmetrical.
  return { clientId: params.clientId, source: 'synthetic' };
}

/**
 * Checked the same way as the client id, and for the same reason: this module
 * is the trust boundary for values that arrive through Stripe metadata. The
 * two ids are handed to the checkout route as a pair of similar looking
 * strings, so forwarding the raw `_ga_<stream>` cookie in place of the bare
 * seconds is the likely slip, and GA4 punishes it with a 204 and silence
 * instead of an error.
 */
function resolveSessionId(params: PurchaseParams): { sessionId: string; source: GaIdSource } {
  const candidate = params.gaSessionId?.trim();
  if (candidate && GA_SESSION_ID_PATTERN.test(candidate)) {
    return { sessionId: candidate, source: 'ga_cookie' };
  }
  return { sessionId: stableSessionId(params.sessionId), source: 'synthetic' };
}

function toCurrencyAmount(amountCents: number): number {
  return Math.round(amountCents) / 100;
}

/**
 * Send the `purchase` event.
 *
 * Returns a promise the caller can await, and hands that same promise to the
 * Next.js `after()` primitive so the platform keeps the function alive until
 * the request leaves. Without that, a fire and forget POST on Vercel races
 * the freeze that follows the response: an unknowable share of purchases
 * never reach Google and nothing anywhere records the loss.
 *
 * The returned promise never rejects. Failures come back as a `failed`
 * result, because an analytics problem must never fail a Stripe webhook.
 */
export function trackServerPurchase(params: PurchaseParams): Promise<TrackServerPurchaseResult> {
  const work = sendPurchase(params);
  keepFunctionAliveFor(work);
  return work;
}

function keepFunctionAliveFor(work: Promise<unknown>): void {
  try {
    after(work);
  } catch {
    // `after` throws when there is no request scope: cron ticks, scripts and
    // unit tests all reach this module outside one. The caller still holds
    // the promise, so only the platform level keepalive is unavailable, and
    // in those contexts nothing is about to freeze anyway.
  }
}

async function sendPurchase(params: PurchaseParams): Promise<TrackServerPurchaseResult> {
  const measurementId = process.env.GA_MEASUREMENT_ID || process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
  const apiSecret = process.env.GA_API_SECRET;

  if (!measurementId || !apiSecret) {
    // Quiet at info level so a webhook under load does not log on every hit,
    // loud at debug level so a developer can tell this apart from a failure.
    logger.debug('GA4 Measurement Protocol not configured, purchase event skipped', {
      sessionId: params.sessionId,
      hasMeasurementId: Boolean(measurementId),
      hasApiSecret: Boolean(apiSecret),
    });
    return { status: 'skipped', reason: 'not_configured' };
  }

  if (!GA_MEASUREMENT_ID_PATTERN.test(measurementId)) {
    // The endpoint answers 204 for this too, so without the warning the only
    // symptom is an empty report and no evidence anywhere.
    logger.warn('GA_MEASUREMENT_ID does not look like a GA4 stream id, events will not land', {
      sessionId: params.sessionId,
    });
  }

  const { clientId, source: clientIdSource } = resolveClientId(params);
  const { sessionId: gaSessionId, source: sessionIdSource } = resolveSessionId(params);

  // Both halves have to be real. A genuine client id paired with a synthetic
  // session id is detached in the way that actually costs: GA4 opens a fresh
  // session for that user with no campaign and no source, so the purchase is
  // still credited to direct and still fails to join the begin_checkout.
  const attributionSource: GaIdSource =
    clientIdSource === 'ga_cookie' && sessionIdSource === 'ga_cookie' ? 'ga_cookie' : 'synthetic';

  if (attributionSource === 'synthetic') {
    // warn, not debug. lib/logger.ts floors production at info, and this is
    // the one condition here that is true for every purchase today, so debug
    // would mean the owner sets the credentials and production says nothing
    // at all while the revenue report fills with direct traffic. A handful of
    // purchases a day is not log spam, and the line stops on its own once the
    // checkout route starts forwarding the real cookie ids.
    logger.warn('GA4 purchase is not joined to a browser session, it will be credited to direct', {
      sessionId: params.sessionId,
      jobId: params.jobId,
      clientIdSource,
      sessionIdSource,
    });
  }

  // Ignored in production on purpose. The validation endpoint validates the
  // payload and then throws it away, so obeying this flag on Vercel would
  // swallow every purchase while the result below still read "sent": accepted,
  // invisible, believed on, which is the whole class of bug this module was
  // written to close. Vercel applies a newly added variable to production by
  // default, so the flag is one careless checkbox away from erasing revenue
  // data with no other trace. Every other fault here warns; this one loses all
  // of the data, so it warns loudly and then does the safe thing anyway.
  const debugRequested = process.env.GA_MP_DEBUG === '1';
  const debugMode = debugRequested && process.env.NODE_ENV !== 'production';
  if (debugRequested && !debugMode) {
    logger.warn(
      'GA_MP_DEBUG is set in production and is being ignored, purchase events go to the recording endpoint',
      { sessionId: params.sessionId },
    );
  }

  const endpoint = debugMode ? MP_VALIDATION_ENDPOINT : MP_ENDPOINT;
  const url = `${endpoint}?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`;

  const body = {
    client_id: clientId,
    ...buildTimestamp(params),
    // The browser tag runs with allow_google_signals: false,
    // allow_ad_personalization_signals: false and Consent Mode v2 defaults
    // that deny every advertising signal until the visitor accepts marketing
    // cookies (lib/analytics.ts). The Measurement Protocol cannot see that
    // choice: the webhook runs minutes later with no visitor request
    // attached. Omitting these two fields would make the server strictly
    // more permissive than the browser, which is the one direction this
    // codebase must not drift in, so advertising use is pinned off. The cost
    // is that a purchase never feeds ad audiences even for a buyer who did
    // accept marketing. Widening that needs the real consent state carried
    // from the browser through Stripe metadata, the same route the client id
    // has to travel, and it is an owner decision rather than a default.
    non_personalized_ads: true,
    consent: {
      ad_user_data: 'DENIED',
      ad_personalization: 'DENIED',
    },
    events: [
      {
        name: 'purchase',
        params: {
          // session_id and engagement_time_msec decide whether this event is
          // visible at all. Without them GA4 still answers 204 and still
          // stores the hit, but it never appears in realtime or in the
          // standard reports, which reads exactly like analytics being off.
          session_id: gaSessionId,
          engagement_time_msec: ENGAGEMENT_TIME_MSEC,
          transaction_id: params.sessionId,
          currency: params.currency.toUpperCase(),
          value: toCurrencyAmount(params.amountCents),
          checkout_type: params.type,
          // Stamped on every event so the detached ones can be excluded in
          // reporting instead of quietly averaging into revenue per user. One
          // combined verdict rather than a client id flag and a session id
          // flag, because a two field marker invites a report that filters on
          // one of them and silently keeps the other half of the detached
          // events in the revenue figure. The breakdown of which half failed
          // is in the warning above, where the developer fixing the checkout
          // handoff is looking anyway. Register this under GA4 Admin > Custom
          // definitions, otherwise the parameter is collected but not
          // queryable.
          attribution_source: attributionSource,
          ...(params.tier ? { pricing_tier: params.tier } : {}),
          ...(params.jobId ? { job_id: params.jobId } : {}),
          items: [
            {
              item_id: params.jobId ?? 'job-post',
              item_name: params.type === 'renewal' ? 'Job Posting Renewal' : 'Job Posting',
              item_category: params.type,
              price: toCurrencyAmount(params.amountCents),
              quantity: 1,
            },
          ],
        },
      },
    ],
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MP_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      logger.warn('GA4 Measurement Protocol purchase event rejected', {
        sessionId: params.sessionId,
        status: response.status,
      });
      return { status: 'failed', reason: 'http_error', detail: `HTTP ${response.status}` };
    }

    if (debugMode) {
      // The validation endpoint reports payload errors in its body and is the
      // only way to see them: production answers 204 for valid and invalid
      // payloads alike.
      logger.debug('GA4 Measurement Protocol validation response', {
        sessionId: params.sessionId,
        body: await response.text(),
      });
    }

    return { status: 'sent', attributionSource, clientIdSource, sessionIdSource };
  } catch (err) {
    // Best effort. Never fail a webhook because of analytics.
    logger.warn('GA4 Measurement Protocol purchase event failed', {
      sessionId: params.sessionId,
      err: String(err),
    });
    return { status: 'failed', reason: 'network_error', detail: String(err) };
  } finally {
    clearTimeout(timeout);
  }
}

function buildTimestamp(params: PurchaseParams): { timestamp_micros?: number } {
  const eventTimeMs = params.eventTimeMs;
  if (!eventTimeMs || !Number.isFinite(eventTimeMs)) return {};

  if (Date.now() - eventTimeMs > MP_MAX_EVENT_AGE_MS) {
    // GA4 drops a stamped event older than its window without telling anyone.
    // Letting it be stamped on arrival records the purchase on the wrong day,
    // which only matters if day alignment beats revenue totals. It does not.
    logger.warn('GA4 purchase event is older than the Measurement Protocol window, stamping on arrival', {
      sessionId: params.sessionId,
    });
    return {};
  }

  return { timestamp_micros: Math.round(eventTimeMs * 1000) };
}
