/**
 * Search Engine Indexing Utility
 * 
 * Supports:
 *  - Google Indexing API (for JobPosting / general pages)
 *  - Bing URL Submission API
 *  - IndexNow (Bing, Yandex, Seznam, Naver, all at once)
 */

import * as crypto from 'crypto';
import { brand } from '@/config/brand';
// P2 #20: the single IndexNow client. Aliased because this module exports its
// own `pingIndexNow` (a per-URL-result adapter over this call).
import { pingIndexNow as submitToIndexNow } from '@/lib/indexnow';

// Env override first so preview/staging deployments never submit the
// canonical domain's URLs; brand.baseUrl keeps prod correct per board.
const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || brand.baseUrl).replace(/\/$/, '');
const INDEXNOW_HOST = new URL(BASE_URL).hostname;

// ─── Types ───────────────────────────────────────────────────────────────────

interface IndexResult {
    engine: string;
    url: string;
    success: boolean;
    error?: string;
}

// ─── Google Indexing API daily budget ───────────────────────────────────────

/**
 * Google's default Indexing API allowance is 200 publish requests per project
 * per day, and every caller in this file spends from that one number.
 *
 * What the callers ask for today, at their own per run caps (schedules from
 * vercel.json and config/cron-schedule.ts):
 *
 *   ingest wave creations      30 firings x 100 =  3,000   lib/ingestion-service.ts
 *   ingest expiry sweep        30 firings x 100 =  3,000   lib/ingestion-service.ts
 *   deindex-expired             2 firings x 100 =    200
 *   historical-deindex          3 firings x  50 =    150
 *   index-urls                  1 firing  x 100 =    100
 *   index-pseo                  1 firing  x 100 =    100
 *
 * The four dedicated indexing crons alone want 550 of a 200 allowance, and the
 * ingest path multiplies that by ten. Without a budget the spend is first come
 * first served, which inverts the priority we actually want: the earliest
 * firings of the UTC day are an ingest wave at 00:05 and historical-deindex at
 * 01:00, the two least valuable callers of the set, so they would drain the
 * day and everything that matters would collect 429s from 07:00 onward.
 *
 * PRIORITY ORDER WHEN THE BUDGET RUNS OUT, highest first, and why:
 *
 *  1. expired-job-removal. A job URL that now 404s but is still in the index
 *     is the one failure with no second channel: IndexNow reaches Bing,
 *     Yandex and Seznam but cannot remove anything from Google, and Google
 *     will not drop the URL on its own for weeks. The removal window is also
 *     bounded, because deindex-expired only looks at recently expired rows, so
 *     a skipped run is never retried by anybody.
 *  2. new-content. This is the product promise, but a new job URL has two
 *     other discovery channels (the sitemap and IndexNow) and Google crawls
 *     freshly linked pages by itself, so deferring costs latency, not
 *     correctness.
 *  3. backlog-removal. Same direction of value as 1, but the queue is roughly
 *     25,000 rows deep and drains over months either way; one day's deferral
 *     is invisible, and rows stay pending and are retried.
 *  4. programmatic. Google supports the Indexing API for JobPosting and
 *     BroadcastEvent pages only. pSEO category and city landings are neither,
 *     so those submissions are an off label use Google may ignore outright,
 *     and the pages are already sitemapped and internally linked.
 *  5. unreserved. Zero, by design. See below.
 *
 * WHY THE BUDGET IS A STATIC ALLOCATION RATHER THAN A LIVE COUNTER: every
 * cron firing is its own serverless invocation with its own memory, and the
 * batch dispatcher invokes its targets over HTTP, so nothing in this process
 * can see what another invocation already spent. The budget is therefore
 * expressed as fixed daily reservations that sum below the quota, each one
 * divided by the number of scheduled firings that land in the lane. The
 * arithmetic is pinned by tests/regressions/indexing-safety.test.ts.
 *
 * The one part this cannot bound exactly is the per post fire and forget
 * publish from the employer and blog paths, which has no schedule. The
 * new-content reservation leaves 20 publishes a day for it, and the table as
 * a whole leaves 5 spare. A durable daily ledger is the real fix and needs a
 * table this package is not allowed to add.
 *
 * WHY THE BATCH HELPERS TAKE THE LANE AS A REQUIRED ARGUMENT: no default is
 * both safe and useful, so there is no honest one to pick. Count the batch
 * invocations that would rely on a default in a day: app/api/cron/index-urls
 * fires once, app/api/cron/deindex-expired twice, and lib/ingestion-service.ts
 * sixty times. A default generous enough for the three cron firings hands the
 * same per invocation share to the sixty ingest batches and spends the whole
 * day's quota before noon. A default small enough to survive the ingest path
 * is zero, which silently kills expired-job-removal, the one lane at the top
 * of the list above precisely because nothing else can do its job.
 *
 * So the choice belongs at the call site, and the type is what makes sure it
 * is made. Adding a caller without a lane is a compile error rather than a
 * quiet no-op discovered months later in Search Console. pingGoogle keeps a
 * default because app/api/cron/index-pseo is off limits to this package and
 * could not be edited to declare one; see the note on that function.
 */
export const GOOGLE_DAILY_PUBLISH_QUOTA = 200;

export type GoogleIndexingLane =
    | 'expired-job-removal'
    | 'new-content'
    | 'backlog-removal'
    | 'programmatic'
    | 'unreserved';

export interface GoogleIndexingLaneBudget {
    /** 1 wins when the day's quota runs out. The reservations implement it. */
    readonly priority: number;
    /** Publishes per day reserved for this lane across all of its callers. */
    readonly dailyReservation: number;
    /** Most one serverless invocation may publish in this lane. */
    readonly perInvocation: number;
    /** Scheduled cron firings per day that land in this lane. */
    readonly scheduledInvocationsPerDay: number;
    /** Who spends here, so the next reader does not have to grep for it. */
    readonly callers: string;
}

export const GOOGLE_INDEXING_LANES: Readonly<
    Record<GoogleIndexingLane, GoogleIndexingLaneBudget>
> = {
    'expired-job-removal': {
        priority: 1,
        dailyReservation: 60,
        perInvocation: 30,
        scheduledInvocationsPerDay: 2,
        callers: 'app/api/cron/deindex-expired',
    },
    'new-content': {
        priority: 2,
        dailyReservation: 60,
        perInvocation: 40,
        scheduledInvocationsPerDay: 1,
        callers: 'app/api/cron/index-urls plus one publish per posted job or blog post',
    },
    'backlog-removal': {
        priority: 3,
        dailyReservation: 45,
        perInvocation: 15,
        scheduledInvocationsPerDay: 3,
        callers: 'app/api/cron/historical-deindex',
    },
    programmatic: {
        priority: 4,
        dailyReservation: 30,
        perInvocation: 25,
        scheduledInvocationsPerDay: 1,
        callers: 'app/api/cron/index-pseo plus the one off scripts (the pingGoogle default)',
    },
    unreserved: {
        // Zero, and a caller has to ask for it by name. This is the lane for a
        // path that should still reach Bing, Yandex and Seznam over IndexNow
        // but must not spend Google quota, because a budgeted caller already
        // covers the same URLs. lib/ingestion-service.ts is the case it exists
        // for: it publishes each wave's new job URLs 30 times a day and sweeps
        // expiries 30 times a day, and app/api/cron/index-urls and
        // app/api/cron/deindex-expired publish those same jobs once and twice
        // a day out of real lanes. Paying twice would cost 60 invocations of
        // quota for URLs that are already covered.
        //
        // The cost of being wrong here is asymmetric: an over quota day gets
        // the whole project throttled, while a skipped publish costs latency
        // on a URL the sitemap and IndexNow already carry.
        priority: 5,
        dailyReservation: 0,
        perInvocation: 0,
        scheduledInvocationsPerDay: 0,
        callers: 'lib/ingestion-service.ts, whose URLs the scheduled crons already publish',
    },
};

/** Prefix on the IndexResult.error of a publish this budget refused. */
export const GOOGLE_BUDGET_REFUSED = 'not submitted: daily Google Indexing budget';

/**
 * True when the publish never reached Google because this budget held it back.
 * Callers that keep a retry counter must not spend an attempt on one of these:
 * nothing was tried, so nothing failed.
 */
export function isGoogleBudgetRefusal(result: IndexResult): boolean {
    return (
        result.engine === 'Google' &&
        !result.success &&
        (result.error ?? '').startsWith(GOOGLE_BUDGET_REFUSED)
    );
}

/** IndexResult.error when GOOGLE_INDEXING_CREDENTIALS is absent entirely. */
export const GOOGLE_NOT_CONFIGURED = 'No credentials configured';

/**
 * IndexResult.error when the key is present but the OAuth exchange failed.
 *
 * Kept distinct from GOOGLE_NOT_CONFIGURED because the two need opposite
 * handling: an absent key is a deliberate state a caller should wait out, while
 * a key that will not exchange is a fault an operator has to see, so it belongs
 * on the normal failure path where a retry counter can eventually surface it.
 */
export const GOOGLE_TOKEN_EXCHANGE_FAILED = 'Google OAuth token exchange failed';

/**
 * True when NO publish request reached Google for this result.
 *
 * Two things can stop a publish before it becomes a request: this budget held
 * it back, or no credential is configured to make it with. They read as
 * failures in an IndexResult, but nothing was tried, so nothing failed.
 *
 * Any caller that retires a row, spends a retry attempt, or reports a URL as
 * submitted must consult this rather than `success`. Getting it wrong is not
 * recoverable in app/api/cron/historical-deindex: its queue is filtered on
 * status 'pending', so a row retired while Google was never asked is a URL
 * Google is never asked about again.
 */
export function googleWasNotAsked(result: IndexResult): boolean {
    return (
        isGoogleBudgetRefusal(result) ||
        (result.engine === 'Google' && !result.success && result.error === GOOGLE_NOT_CONFIGURED)
    );
}

interface LaneLedger {
    day: string;
    spent: Map<GoogleIndexingLane, number>;
}

let ledger: LaneLedger | null = null;
let warnedUnreserved = false;

/** Date key, so a warm lambda that survives midnight starts a fresh budget. */
function budgetDayKey(): string {
    return new Date().toISOString().slice(0, 10);
}

/**
 * Reserve up to `want` publishes in `lane` and return how many were granted.
 * Grants are recorded per invocation, so a caller that loops (a script, or
 * ingestion calling both batch helpers in one process) cannot reset its cap by
 * calling again.
 */
function takeGoogleBudget(lane: GoogleIndexingLane, want: number): number {
    const budget = GOOGLE_INDEXING_LANES[lane];
    if (!budget) {
        // The compiler holds app/ and lib/ to a declared lane, but tsconfig
        // excludes scripts/, so a one off script can still reach here with a
        // lane name that does not exist. Throwing by name beats the TypeError
        // three frames down, and it beats granting zero, which would print in
        // the script's own summary as Google having taken nothing and read
        // like a quota problem rather than a typo.
        //
        // An omitted argument does NOT land here: pingGoogle's parameter
        // default turns it into 'programmatic' before this runs.
        throw new Error(
            `[Indexing] Unknown Google indexing lane "${lane}". Declare one of: ` +
            `${Object.keys(GOOGLE_INDEXING_LANES).join(', ')}.`
        );
    }

    const day = budgetDayKey();
    if (!ledger || ledger.day !== day) {
        ledger = { day, spent: new Map() };
    }
    const already = ledger.spent.get(lane) ?? 0;
    const granted = Math.max(0, Math.min(want, budget.perInvocation - already));
    if (granted > 0) ledger.spent.set(lane, already + granted);

    if (lane === 'unreserved' && !warnedUnreserved) {
        warnedUnreserved = true;
        console.warn(
            '[Indexing] Google publishes skipped: this caller declared the "unreserved" lane, ' +
            'which holds no share of the 200/day quota by design. Google coverage for these ' +
            'URLs comes from the scheduled index-urls and deindex-expired crons.'
        );
    }
    return granted;
}

/** Text for the refusal result, so an operator can see which lane ran dry. */
function budgetRefusalError(lane: GoogleIndexingLane): string {
    const { perInvocation, dailyReservation } = GOOGLE_INDEXING_LANES[lane];
    return `${GOOGLE_BUDGET_REFUSED} for lane "${lane}" (${perInvocation} per run, ${dailyReservation} per day)`;
}

/**
 * Clears the in process grant record. For tests, and for a long lived script
 * that deliberately starts a new invocation's worth of budget. It does not and
 * cannot restore quota that Google has already counted.
 */
export function resetGoogleIndexingBudget(): void {
    ledger = null;
    warnedUnreserved = false;
}

// ─── Google Indexing API ─────────────────────────────────────────────────────

async function getGoogleAccessToken(): Promise<string | null> {
    const credentialsRaw = process.env.GOOGLE_INDEXING_CREDENTIALS;
    if (!credentialsRaw) return null;

    let credentials;
    try {
        credentials = JSON.parse(credentialsRaw);
    } catch {
        credentials = JSON.parse(Buffer.from(credentialsRaw, 'base64').toString('utf-8'));
    }

    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const claimSet = {
        iss: credentials.client_email,
        scope: 'https://www.googleapis.com/auth/indexing',
        aud: 'https://oauth2.googleapis.com/token',
        exp: now + 3600,
        iat: now,
    };

    const b64url = (obj: object) =>
        Buffer.from(JSON.stringify(obj))
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');

    const signatureInput = `${b64url(header)}.${b64url(claimSet)}`;
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(signatureInput);
    const signature = sign
        .sign(credentials.private_key, 'base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

    const jwt = `${signatureInput}.${signature}`;

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    });

    if (!tokenResponse.ok) {
        console.error('[Google] Failed to get access token:', await tokenResponse.text());
        return null;
    }

    const { access_token } = await tokenResponse.json();
    return access_token;
}

/**
 * Publish one URL to the Google Indexing API.
 *
 * The lane defaults to 'programmatic', the lowest lane that still holds a
 * reservation, because the direct callers of this function are exactly what
 * that lane is for: app/api/cron/index-pseo and the manual scripts. index-pseo
 * cannot be edited to declare a lane from here, so the default is the only way
 * it gets a share, and giving an undeclared direct caller the SMALLEST real
 * share is the version of that compromise that cannot starve anyone.
 *
 * The budget is taken first, ahead of the credential check and the OAuth
 * exchange, so a refused publish costs no network at all and the cap stays the
 * outermost invariant: no configuration state can produce a run that publishes
 * more than a lane allows, which is what makes the arithmetic testable without
 * a credential. A grant spent on a call that then finds no credential costs
 * nothing at Google, and the one caller that keeps durable per URL state,
 * app/api/cron/historical-deindex, refuses to start at all without the key.
 *
 * Both early exits are reported through googleWasNotAsked(), because a caller
 * has to tell "Google said no" from "we never asked Google".
 */
export async function pingGoogle(
    url: string,
    type: 'URL_UPDATED' | 'URL_DELETED' = 'URL_UPDATED',
    lane: GoogleIndexingLane = 'programmatic'
): Promise<IndexResult> {
    if (takeGoogleBudget(lane, 1) === 0) {
        return { engine: 'Google', url, success: false, error: budgetRefusalError(lane) };
    }

    if (!process.env.GOOGLE_INDEXING_CREDENTIALS) {
        return { engine: 'Google', url, success: false, error: GOOGLE_NOT_CONFIGURED };
    }

    try {
        const accessToken = await getGoogleAccessToken();
        if (!accessToken) {
            // The key exists and did not work. That is a fault to surface, not
            // a state to wait out, so it does not claim "never asked".
            return { engine: 'Google', url, success: false, error: GOOGLE_TOKEN_EXCHANGE_FAILED };
        }

        const response = await fetch(
            'https://indexing.googleapis.com/v3/urlNotifications:publish',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${accessToken}`,
                },
                body: JSON.stringify({ url, type }),
            }
        );

        if (response.ok) {
            return { engine: 'Google', url, success: true };
        }
        return { engine: 'Google', url, success: false, error: await response.text() };
    } catch (error) {
        return { engine: 'Google', url, success: false, error: String(error) };
    }
}

// ─── Bing URL Submission API ─────────────────────────────────────────────────

export async function pingBing(url: string): Promise<IndexResult> {
    const apiKey = process.env.BING_WEBMASTER_API_KEY;
    if (!apiKey) {
        return { engine: 'Bing', url, success: false, error: 'BING_WEBMASTER_API_KEY not set' };
    }

    try {
        const response = await fetch(
            `https://ssl.bing.com/webmaster/api.svc/json/SubmitUrl?apikey=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ siteUrl: BASE_URL, url }),
            }
        );

        if (response.ok) {
            return { engine: 'Bing', url, success: true };
        }
        return { engine: 'Bing', url, success: false, error: await response.text() };
    } catch (error) {
        return { engine: 'Bing', url, success: false, error: String(error) };
    }
}

// Bing batch submission (up to 500 at once)
export async function pingBingBatch(urls: string[]): Promise<IndexResult[]> {
    const apiKey = process.env.BING_WEBMASTER_API_KEY;
    if (!apiKey) {
        return urls.map(url => ({ engine: 'Bing', url, success: false, error: 'BING_WEBMASTER_API_KEY not set' }));
    }

    const results: IndexResult[] = [];
    // Bing allows up to 500 URLs per batch
    const batchSize = 500;

    for (let i = 0; i < urls.length; i += batchSize) {
        const batch = urls.slice(i, i + batchSize);
        try {
            const response = await fetch(
                `https://ssl.bing.com/webmaster/api.svc/json/SubmitUrlBatch?apikey=${apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ siteUrl: BASE_URL, urlList: batch }),
                }
            );

            if (response.ok) {
                results.push(...batch.map(url => ({ engine: 'Bing', url, success: true })));
            } else {
                const errorText = await response.text();
                results.push(...batch.map(url => ({ engine: 'Bing', url, success: false, error: errorText })));
            }
        } catch (error) {
            results.push(...batch.map(url => ({ engine: 'Bing', url, success: false, error: String(error) })));
        }
    }

    return results;
}

// ─── IndexNow (Bing, Yandex, Seznam, Naver) ─────────────────────────────────

/**
 * P2 #20: thin adapter over lib/indexnow.ts, the single IndexNow client.
 *
 * This module used to carry its own copy of the protocol, and the two drifted:
 * this one read INDEXNOW_API_KEY (the other INDEXNOW_KEY), skipped the
 * same-host filter and the 10,000-URL cap, logged nothing, and reported every
 * URL as submitted even when the engine had silently dropped the off-host
 * ones. Everything below is now shape-mapping: the caller-visible
 * `IndexResult[]` contract is unchanged, but the request itself (key
 * resolution, host filtering, cap, logging, error handling) happens in one
 * place for every caller.
 */
export async function pingIndexNow(urls: string | string[]): Promise<IndexResult[]> {
    const urlList = Array.isArray(urls) ? urls : [urls];
    if (urlList.length === 0) return [];

    const result = await submitToIndexNow(urlList);

    // Only URLs that were actually accepted into the submission can be
    // reported as successful: the rest were filtered out client-side.
    const accepted = new Set(result.accepted);
    const error = result.ok
        ? 'not submitted (off-host or over the 10,000-URL cap)'
        : indexNowFailureMessage(result.reason);

    return urlList.map(url =>
        result.ok && accepted.has(url)
            ? { engine: 'IndexNow', url, success: true }
            : { engine: 'IndexNow', url, success: false, error }
    );
}

/** Human-readable text for the shared client's machine-readable reason code. */
function indexNowFailureMessage(reason?: string): string {
    switch (reason) {
        case 'no_key':
            return 'INDEXNOW_KEY / INDEXNOW_API_KEY not set';
        case 'no_same_host_urls':
            return `no URLs on ${INDEXNOW_HOST}`;
        case 'network_error':
            return 'network error reaching IndexNow';
        default:
            return reason ? `IndexNow rejected the batch (${reason})` : 'IndexNow rejected the batch';
    }
}

// ─── Unified Ping ────────────────────────────────────────────────────────────

/**
 * Ping all configured search engines for a single URL.
 * Fire-and-forget safe: never throws.
 */
export async function pingAllSearchEngines(url: string): Promise<IndexResult[]> {
    const results = await Promise.allSettled([
        // Single URL callers are the employer post, the paid activation webhook
        // and a blog publish: one freshly created page each, which is exactly
        // what the new-content lane reserves its ad hoc share for.
        pingGoogle(url, 'URL_UPDATED', 'new-content'),
        pingBing(url),
        pingIndexNow(url),
    ]);

    const flat: IndexResult[] = [];
    for (const result of results) {
        if (result.status === 'fulfilled') {
            if (Array.isArray(result.value)) {
                flat.push(...result.value);
            } else {
                flat.push(result.value);
            }
        }
    }

    // Log results
    for (const r of flat) {
        if (r.success) {
            console.log(`[Indexing] ✅ ${r.engine}: ${r.url}`);
        } else {
            console.log(`[Indexing] ❌ ${r.engine}: ${r.url}: ${r.error}`);
        }
    }

    return flat;
}

/**
 * Publish `urls` to Google one at a time, spending the lane's budget, and
 * return a result for EVERY url. URLs past the lane's per run cap come back as
 * explicit refusals rather than being dropped from the array, because a caller
 * that keeps per URL state needs to tell "Google said no" from "we never asked
 * Google" (see app/api/cron/historical-deindex/route.ts).
 */
async function publishToGoogleWithinBudget(
    urls: string[],
    type: 'URL_UPDATED' | 'URL_DELETED',
    lane: GoogleIndexingLane,
): Promise<IndexResult[]> {
    const results: IndexResult[] = [];
    for (const url of urls) {
        const result = await pingGoogle(url, type, lane);
        results.push(result);
        // A refusal made no request, so there is nothing to pace.
        if (isGoogleBudgetRefusal(result)) continue;
        // Small delay between Google requests.
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    return results;
}

/**
 * Ping all configured search engines for multiple URLs in batch, for new or
 * updated pages. Bing and IndexNow take the whole list: neither shares Google's
 * 200/day allowance, so throttling them would lose coverage for nothing.
 *
 * `lane` has no default on purpose. See the budget note at the top of this
 * file: the callers differ by two orders of magnitude in how often they fire,
 * so any default is either a quota overrun or a silent zero.
 */
export async function pingAllSearchEnginesBatch(
    urls: string[],
    lane: GoogleIndexingLane,
): Promise<{
    google: IndexResult[];
    bing: IndexResult[];
    indexNow: IndexResult[];
}> {
    // Google has no batch endpoint, so this is one request per URL, capped by
    // the lane's share of the daily quota.
    const googleResults = await publishToGoogleWithinBudget(urls, 'URL_UPDATED', lane);

    // Bing: batch submit
    const bingResults = await pingBingBatch(urls);

    // IndexNow: batch submit (up to 10,000 at once)
    const indexNowResults = await pingIndexNow(urls);

    return {
        google: googleResults,
        bing: bingResults,
        indexNow: indexNowResults,
    };
}

/**
 * Ping all search engines to DE-INDEX URLs that are gone.
 *
 * `lane` is required rather than defaulted to expired-job-removal, even though
 * that is what a removal usually is, because lib/ingestion-service.ts runs its
 * own expiry sweep through here 30 times a day: inheriting the top lane would
 * let the sweep spend 900 publishes against a 60 reservation. Defaulting the
 * other way, to a zero lane, would instead leave app/api/cron/deindex-expired
 * publishing nothing at all, and that cron is the only channel that can remove
 * a dead job URL from Google. Neither default is survivable, so each caller
 * names its own lane and the compiler holds them to it.
 */
export async function pingAllSearchEnginesBatchDeleted(
    urls: string[],
    lane: GoogleIndexingLane,
): Promise<{
    google: IndexResult[];
    indexNow: IndexResult[];
}> {
    const googleResults = await publishToGoogleWithinBudget(urls, 'URL_DELETED', lane);

    // IndexNow for batch de-indexing (Bing, Yandex, etc.)
    const indexNowResults = await pingIndexNow(urls);

    return {
        google: googleResults,
        indexNow: indexNowResults,
    };
}
