/**
 * Regressions for lib/analytics-server.ts, the GA4 Measurement Protocol
 * sender behind the Stripe webhook `purchase` event.
 *
 * The failure this pins against is the quiet one. The Measurement Protocol
 * answers 204 for a payload that will never appear in a report, so every
 * defect below looked exactly like "analytics is working" from the server:
 *
 *   1. No session_id and no engagement_time_msec, so events were accepted and
 *      then never shown in realtime or the standard reports.
 *   2. A Prisma job UUID passed as the GA client id, so every purchase became
 *      a new direct user detached from the browser session that produced it.
 *   3. A fire and forget POST that the serverless freeze could cut off.
 *   4. No way for a caller to tell "not configured" from "failed".
 *
 * The privacy assertions are deliberate too: the server payload must never be
 * more permissive than the browser tag, which runs with Consent Mode v2
 * denials and allow_ad_personalization_signals: false.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  trackServerPurchase,
  parseGaCookieHeader,
  type PurchaseParams,
} from '@/lib/analytics-server';
import { logger } from '@/lib/logger';

const MEASUREMENT_ID = 'G-TESTSTREAM';
const API_SECRET = 'test-api-secret';

/** A job UUID, which is what both webhook call sites pass today. */
const JOB_UUID = 'b3f9ed7c-1c2b-4a1e-9d7a-0f5c4e2a1b88';

const BASE_PARAMS: PurchaseParams = {
  clientId: JOB_UUID,
  sessionId: 'cs_test_a1b2c3',
  amountCents: 19900,
  currency: 'usd',
  type: 'new',
  tier: 'standard',
  jobId: JOB_UUID,
};

/** What a correctly wired checkout route will forward through Stripe metadata. */
const REAL_BROWSER_IDS = {
  gaClientId: '1234567890.1699999999',
  gaSessionId: '1748000000',
};

type FetchMock = ReturnType<typeof vi.fn>;

function mockFetchOk(): FetchMock {
  const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function configure(): void {
  vi.stubEnv('GA_MEASUREMENT_ID', MEASUREMENT_ID);
  vi.stubEnv('GA_API_SECRET', API_SECRET);
  vi.stubEnv('GA_MP_DEBUG', '');
}

function sentPayload(fetchMock: FetchMock, callIndex = 0) {
  const [, init] = fetchMock.mock.calls[callIndex] as [string, RequestInit];
  return JSON.parse(String(init.body));
}

function sentEventParams(fetchMock: FetchMock, callIndex = 0) {
  return sentPayload(fetchMock, callIndex).events[0].params;
}

const spyOnWarn = () => vi.spyOn(logger, 'warn').mockImplementation(() => {});
let warnSpy: ReturnType<typeof spyOnWarn>;

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  // Nearly every case here runs with the degraded attribution the webhooks
  // send today, which warns by design. Capturing it keeps the suite output
  // readable and gives the attribution tests something to assert on.
  warnSpy = spyOnWarn();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  // clearAllMocks in tests/setup.ts clears calls but leaves a stub installed,
  // which would mute a genuine warning in every test that runs afterwards.
  vi.restoreAllMocks();
});

describe('trackServerPurchase: unconfigured is a silent no op', () => {
  it('sends nothing and reports not_configured when the credentials are absent', async () => {
    vi.stubEnv('GA_MEASUREMENT_ID', '');
    vi.stubEnv('NEXT_PUBLIC_GA_MEASUREMENT_ID', '');
    vi.stubEnv('GA_API_SECRET', '');
    const fetchMock = mockFetchOk();

    const result = await trackServerPurchase(BASE_PARAMS);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'skipped', reason: 'not_configured' });
  });

  it('stays silent about attribution while GA4 is off, since nothing is being sent', async () => {
    vi.stubEnv('GA_MEASUREMENT_ID', '');
    vi.stubEnv('NEXT_PUBLIC_GA_MEASUREMENT_ID', '');
    vi.stubEnv('GA_API_SECRET', '');
    mockFetchOk();

    await trackServerPurchase(BASE_PARAMS);

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('still skips when only the measurement id is set, because the secret is the other half', async () => {
    vi.stubEnv('GA_MEASUREMENT_ID', MEASUREMENT_ID);
    vi.stubEnv('GA_API_SECRET', '');
    const fetchMock = mockFetchOk();

    const result = await trackServerPurchase(BASE_PARAMS);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'skipped', reason: 'not_configured' });
  });

  it('falls back to the public measurement id so the server cannot land in a second property', async () => {
    vi.stubEnv('GA_MEASUREMENT_ID', '');
    vi.stubEnv('NEXT_PUBLIC_GA_MEASUREMENT_ID', MEASUREMENT_ID);
    vi.stubEnv('GA_API_SECRET', API_SECRET);
    const fetchMock = mockFetchOk();

    const result = await trackServerPurchase(BASE_PARAMS);

    expect(result.status).toBe('sent');
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`measurement_id=${MEASUREMENT_ID}`);
  });
});

describe('trackServerPurchase: the parameters GA4 needs to show the event', () => {
  it('sends session_id and engagement_time_msec, without which the event never appears', async () => {
    configure();
    const fetchMock = mockFetchOk();

    await trackServerPurchase(BASE_PARAMS);

    const params = sentEventParams(fetchMock);
    expect(params.session_id).toBeTruthy();
    expect(Number(params.session_id)).toBeGreaterThan(0);
    expect(Number(params.engagement_time_msec)).toBeGreaterThan(0);
  });

  it('uses the real browser session id when the caller supplies one', async () => {
    configure();
    const fetchMock = mockFetchOk();

    await trackServerPurchase({ ...BASE_PARAMS, gaSessionId: '1748000000' });

    expect(sentEventParams(fetchMock).session_id).toBe('1748000000');
  });

  it('derives the same synthetic session id for the same Stripe session every time', async () => {
    configure();
    const fetchMock = mockFetchOk();

    await trackServerPurchase(BASE_PARAMS);
    await trackServerPurchase(BASE_PARAMS);

    expect(sentEventParams(fetchMock, 1).session_id).toBe(sentEventParams(fetchMock, 0).session_id);
  });

  it('keeps the ecommerce fields the purchase report reads', async () => {
    configure();
    const fetchMock = mockFetchOk();

    await trackServerPurchase(BASE_PARAMS);

    const params = sentEventParams(fetchMock);
    expect(sentPayload(fetchMock).events[0].name).toBe('purchase');
    expect(params.transaction_id).toBe('cs_test_a1b2c3');
    expect(params.currency).toBe('USD');
    expect(params.value).toBe(199);
    expect(params.items).toHaveLength(1);
    expect(params.items[0].price).toBe(199);
  });

  it('stamps timestamp_micros when the caller knows when the payment happened', async () => {
    configure();
    const fetchMock = mockFetchOk();
    const eventTimeMs = Date.now() - 60_000;

    await trackServerPurchase({ ...BASE_PARAMS, eventTimeMs });

    expect(sentPayload(fetchMock).timestamp_micros).toBe(Math.round(eventTimeMs * 1000));
  });

  it('drops a stamp older than the 72 hour window rather than letting GA4 discard the event', async () => {
    configure();
    const fetchMock = mockFetchOk();

    await trackServerPurchase({ ...BASE_PARAMS, eventTimeMs: Date.now() - 96 * 60 * 60 * 1000 });

    expect(sentPayload(fetchMock).timestamp_micros).toBeUndefined();
  });
});

/**
 * The ids arrive through Stripe metadata, an untyped external string store,
 * so this module is the trust boundary for both of them. The two are handed
 * to the checkout implementer as similar looking strings, which makes posting
 * the raw `_ga_<stream>` cookie in place of the bare seconds the likely slip.
 * GA4 answers 204 for it and then hides the event from every session scoped
 * report, so nothing except these tests would object.
 */
describe('trackServerPurchase: the ids are validated, not trusted', () => {
  it('treats a client id that is not GA shaped as synthetic rather than forwarding it', async () => {
    configure();
    const fetchMock = mockFetchOk();

    const result = await trackServerPurchase({ ...BASE_PARAMS, gaClientId: 'GA1.1.not-a-client-id' });

    expect(sentEventParams(fetchMock).attribution_source).toBe('synthetic');
    expect(result).toMatchObject({ status: 'sent', clientIdSource: 'synthetic' });
    // The value that failed the shape check must be DISCARDED, not posted.
    // These ids arrive through Stripe metadata, the same store that carries
    // the employer dashboard token, so anything unrecognised is a string of
    // unknown provenance and must never reach Google.
    expect(sentPayload(fetchMock).client_id).toBe(JOB_UUID);
  });

  it('rejects a raw GS2 cookie value as a session id and falls back to the stable one', async () => {
    configure();
    const fetchMock = mockFetchOk();

    await trackServerPurchase({
      ...BASE_PARAMS,
      gaClientId: REAL_BROWSER_IDS.gaClientId,
      gaSessionId: 'GS2.1.s1748000000$o12$g1',
    });
    await trackServerPurchase(BASE_PARAMS);

    const forwarded = sentEventParams(fetchMock, 0).session_id;
    expect(forwarded).not.toContain('GS2');
    expect(forwarded).toBe(sentEventParams(fetchMock, 1).session_id);
  });

  it('rejects a session id that is not digits, because GA4 would accept it and hide the event', async () => {
    configure();
    const fetchMock = mockFetchOk();

    const result = await trackServerPurchase({ ...BASE_PARAMS, gaSessionId: 's1748000000' });

    expect(sentEventParams(fetchMock).session_id).not.toBe('s1748000000');
    expect(result).toMatchObject({ status: 'sent', sessionIdSource: 'synthetic' });
  });
});

describe('trackServerPurchase: attribution is only claimed when both ids are real', () => {
  it('marks the event attributable when the client id and the session id both come from cookies', async () => {
    configure();
    const fetchMock = mockFetchOk();

    const result = await trackServerPurchase({ ...BASE_PARAMS, ...REAL_BROWSER_IDS });

    expect(sentPayload(fetchMock).client_id).toBe(REAL_BROWSER_IDS.gaClientId);
    expect(sentEventParams(fetchMock).attribution_source).toBe('ga_cookie');
    expect(result).toEqual({
      status: 'sent',
      attributionSource: 'ga_cookie',
      clientIdSource: 'ga_cookie',
      sessionIdSource: 'ga_cookie',
    });
  });

  it('keeps working on the job UUID the webhook passes today, and marks it synthetic', async () => {
    configure();
    const fetchMock = mockFetchOk();

    const result = await trackServerPurchase(BASE_PARAMS);

    expect(sentPayload(fetchMock).client_id).toBe(JOB_UUID);
    expect(sentEventParams(fetchMock).attribution_source).toBe('synthetic');
    expect(result).toEqual({
      status: 'sent',
      attributionSource: 'synthetic',
      clientIdSource: 'synthetic',
      sessionIdSource: 'synthetic',
    });
  });

  it('does not claim attribution on a real client id with no session id, which GA4 credits to direct', async () => {
    configure();
    const fetchMock = mockFetchOk();

    const result = await trackServerPurchase({
      ...BASE_PARAMS,
      gaClientId: REAL_BROWSER_IDS.gaClientId,
    });

    expect(sentEventParams(fetchMock).attribution_source).toBe('synthetic');
    expect(result).toEqual({
      status: 'sent',
      attributionSource: 'synthetic',
      clientIdSource: 'ga_cookie',
      sessionIdSource: 'synthetic',
    });
  });

  it('warns at warn level about the degraded case, which production would discard at debug level', async () => {
    configure();
    mockFetchOk();

    await trackServerPurchase(BASE_PARAMS);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('not joined to a browser session'),
      expect.objectContaining({
        sessionId: BASE_PARAMS.sessionId,
        clientIdSource: 'synthetic',
        sessionIdSource: 'synthetic',
      }),
    );
  });

  it('names the half that failed, so the checkout handoff can be fixed from the log alone', async () => {
    configure();
    mockFetchOk();

    await trackServerPurchase({ ...BASE_PARAMS, gaClientId: REAL_BROWSER_IDS.gaClientId });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ clientIdSource: 'ga_cookie', sessionIdSource: 'synthetic' }),
    );
  });

  it('goes quiet once both ids are real, so the warning cannot become background noise', async () => {
    configure();
    mockFetchOk();

    await trackServerPurchase({ ...BASE_PARAMS, ...REAL_BROWSER_IDS });

    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('trackServerPurchase: awaitable, and it never rejects', () => {
  it('resolves only after the POST settles, so the caller can hold the function open', async () => {
    configure();
    let releaseFetch: (() => void) | undefined;
    const fetchGate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        await fetchGate;
        return new Response(null, { status: 204 });
      }),
    );

    let settled = false;
    const pending = trackServerPurchase(BASE_PARAMS).then((value) => {
      settled = true;
      return value;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    releaseFetch?.();
    const result = await pending;
    expect(settled).toBe(true);
    expect(result.status).toBe('sent');
  });

  it('reports an HTTP rejection instead of throwing into the webhook', async () => {
    configure();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad request', { status: 400 })));

    const result = await trackServerPurchase(BASE_PARAMS);

    expect(result).toEqual({ status: 'failed', reason: 'http_error', detail: 'HTTP 400' });
  });

  it('reports a network failure instead of throwing into the webhook', async () => {
    configure();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('socket hang up');
      }),
    );

    const result = await trackServerPurchase(BASE_PARAMS);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('network_error');
      expect(result.detail).toContain('socket hang up');
    }
  });
});

describe('trackServerPurchase: privacy posture matches the browser tag', () => {
  it('never lets the server send a more permissive advertising signal than the client', async () => {
    configure();
    const fetchMock = mockFetchOk();

    await trackServerPurchase(BASE_PARAMS);

    const payload = sentPayload(fetchMock);
    expect(payload.non_personalized_ads).toBe(true);
    expect(payload.consent).toEqual({ ad_user_data: 'DENIED', ad_personalization: 'DENIED' });
  });

  it('posts to the production collect endpoint, not the validation one, by default', async () => {
    configure();
    const fetchMock = mockFetchOk();

    await trackServerPurchase(BASE_PARAMS);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.startsWith('https://www.google-analytics.com/mp/collect?')).toBe(true);
  });
});

/**
 * The debug flag routes the send to the GA4 validation endpoint, which
 * validates a payload and then discards it. That is exactly what a developer
 * wants and exactly what production must never do, and the case above only
 * proves the default because `configure` clears the flag. Vercel ticks the
 * production environment by default when a variable is added, so a flag added
 * for a local investigation can silently erase live revenue data. These pin
 * the guard that makes that impossible.
 */
describe('trackServerPurchase: GA_MP_DEBUG is development only', () => {
  it('ignores GA_MP_DEBUG in production, where the validation endpoint would discard every purchase', async () => {
    configure();
    vi.stubEnv('GA_MP_DEBUG', '1');
    vi.stubEnv('NODE_ENV', 'production');
    const fetchMock = mockFetchOk();

    const result = await trackServerPurchase(BASE_PARAMS);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.startsWith('https://www.google-analytics.com/mp/collect?')).toBe(true);
    expect(result.status).toBe('sent');
  });

  it('warns at warn level when it ignores the flag, so the misconfiguration is not silent', async () => {
    configure();
    vi.stubEnv('GA_MP_DEBUG', '1');
    vi.stubEnv('NODE_ENV', 'production');
    mockFetchOk();

    await trackServerPurchase(BASE_PARAMS);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('GA_MP_DEBUG'),
      expect.objectContaining({ sessionId: BASE_PARAMS.sessionId }),
    );
  });

  it('still routes to the validation endpoint outside production, which is the point of the flag', async () => {
    configure();
    vi.stubEnv('GA_MP_DEBUG', '1');
    const fetchMock = mockFetchOk();

    await trackServerPurchase(BASE_PARAMS);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.startsWith('https://www.google-analytics.com/debug/mp/collect?')).toBe(true);
  });
});

describe('parseGaCookieHeader', () => {
  it('returns nothing when there is no cookie header', () => {
    expect(parseGaCookieHeader(null)).toEqual({});
    expect(parseGaCookieHeader('')).toEqual({});
  });

  it('extracts the client id from the _ga cookie', () => {
    expect(parseGaCookieHeader('_ga=GA1.1.1234567890.1699999999').gaClientId).toBe(
      '1234567890.1699999999',
    );
  });

  it('reads the session id from the older GS1 cookie format', () => {
    const ids = parseGaCookieHeader('_ga_TESTSTREAM=GS1.1.1748000000.3.1.1748000100.0.0.0');
    expect(ids.gaSessionId).toBe('1748000000');
  });

  it('reads the session id from the current GS2 cookie format', () => {
    const ids = parseGaCookieHeader(
      '_ga_TESTSTREAM=GS2.1.s1748000000$o12$g1$t1748000100$j60$l0$h0',
    );
    expect(ids.gaSessionId).toBe('1748000000');
  });

  it('prefers the cookie belonging to our own stream when several are present', () => {
    const header = [
      '_ga=GA1.1.1234567890.1699999999',
      '_ga_OTHERSTREAM=GS2.1.s1111111111$o1$g1',
      '_ga_TESTSTREAM=GS2.1.s2222222222$o1$g1',
    ].join('; ');

    expect(parseGaCookieHeader(header, MEASUREMENT_ID).gaSessionId).toBe('2222222222');
  });

  it('ignores another stream cookie when our own is absent, since its session id is not ours', () => {
    // A leftover from a previous property or a consent tool. Accepting it
    // would produce a session id that does not exist in the property
    // receiving the event, stamped as if it were well attributed.
    const ids = parseGaCookieHeader(
      '_ga=GA1.1.1234567890.1699999999; _ga_OLDPROP=GS2.1.s1500000000$o1$g1',
      MEASUREMENT_ID,
    );

    expect(ids.gaClientId).toBe('1234567890.1699999999');
    expect(ids.gaSessionId).toBeUndefined();
  });

  it('scans for any stream cookie only when the measurement id is unknown', () => {
    // Unknown means the environment genuinely has no id to derive our own
    // cookie name from, which is why both are stubbed empty here.
    vi.stubEnv('GA_MEASUREMENT_ID', '');
    vi.stubEnv('NEXT_PUBLIC_GA_MEASUREMENT_ID', '');

    const ids = parseGaCookieHeader('_ga_ANYSTREAM=GS2.1.s1500000000$o1$g1');

    expect(ids.gaSessionId).toBe('1500000000');
  });

  it('never adopts another property\'s session cookie when our own stream is known', () => {
    // The caller omits the second argument, which used to re-enable the
    // any-stream scan. A visitor carrying a two year old cookie from a
    // previously installed property would then produce a purchase stamped as
    // well attributed, pointing at a session that does not exist in the live
    // property, and surviving every report filter the marker exists to enable.
    vi.stubEnv('GA_MEASUREMENT_ID', MEASUREMENT_ID);

    const ids = parseGaCookieHeader('_ga=GA1.1.1234567890.1699999999; _ga_OLDPROP=GS2.1.s1500000000$o1$g1');

    expect(ids.gaClientId).toBe('1234567890.1699999999');
    expect(ids.gaSessionId).toBeUndefined();
  });

  it('ignores a malformed _ga value rather than sending garbage as a client id', () => {
    expect(parseGaCookieHeader('_ga=deleted; other=1')).toEqual({});
  });

  it('produces ids that trackServerPurchase accepts as real', async () => {
    configure();
    const fetchMock = mockFetchOk();
    const ids = parseGaCookieHeader(
      '_ga=GA1.1.1234567890.1699999999; _ga_TESTSTREAM=GS2.1.s1748000000$o12$g1',
      MEASUREMENT_ID,
    );

    const result = await trackServerPurchase({ ...BASE_PARAMS, ...ids });

    expect(result).toEqual({
      status: 'sent',
      attributionSource: 'ga_cookie',
      clientIdSource: 'ga_cookie',
      sessionIdSource: 'ga_cookie',
    });
    expect(sentPayload(fetchMock).client_id).toBe('1234567890.1699999999');
    expect(sentEventParams(fetchMock).session_id).toBe('1748000000');
  });
});
