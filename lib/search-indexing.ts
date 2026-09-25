/**
 * Search Engine Indexing Utility
 *
 * Supports:
 *  - Google Indexing API, for job posting pages only (see the scope note below)
 *  - Bing URL Submission API
 *  - IndexNow (Bing, Yandex, Seznam, Naver, all at once)
 */

import * as crypto from 'crypto';
import { brand } from '@/config/brand';
import { logger } from '@/lib/logger';
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

export type GoogleNotificationType = 'URL_UPDATED' | 'URL_DELETED';

// ─── Google Indexing API scope ───────────────────────────────────────────────

/**
 * WHAT GOOGLE WILL ACCEPT. Google restricts the Indexing API to pages that
 * carry JobPosting structured data, or BroadcastEvent inside a VideoObject,
 * which this site does not publish. Google reserves the right to cut the
 * quota or revoke Indexing API access for misuse, and that sanction lands on
 * the whole Cloud project. The same project carries every submission here
 * that has no substitute: new job pages from app/api/cron/index-urls and
 * removals of expired jobs from app/api/cron/deindex-expired. One off policy
 * caller could therefore cost the site both. So the rule is enforced here, in
 * the one function that talks to Google, rather than trusted to each caller.
 *
 * Exactly one route on this site emits JobPosting: app/jobs/[slug]/page.tsx,
 * through components/JobStructuredData.tsx. That page resolves a job only from
 * a trailing UUID in the slug and 404s any /jobs/ path without one, so the
 * shape below is the page's own resolver. Everything else is refused: the
 * category and setting landings, the state, metro and city pages, the category
 * x city landings app/api/cron/index-pseo used to push, blog posts, company
 * pages and account pages. A URL_DELETED for an expired job's URL passes,
 * because it is the same page and telling Google a posting has closed is what
 * the API exists for.
 *
 * The host is deliberately not checked. The Indexing API enforces Search
 * Console ownership on its own, which is the real host rule, and callers build
 * URLs from brand.baseUrl or NEXT_PUBLIC_BASE_URL interchangeably, so a host
 * check here would refuse good URLs built from whichever one it did not pick.
 *
 * tests/regressions/indexing-safety.test.ts pins both facts this relies on:
 * the page still resolves jobs with this UUID pattern, and no other page
 * renders JobPosting. If either changes, widen this rule in the same commit.
 */
const JOB_POSTING_PATH =
    /^\/jobs\/[^/]*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?$/i;

/** True only for a URL whose page carries JobPosting markup. */
export function isGoogleIndexingEligibleUrl(url: string): boolean {
    try {
        return JOB_POSTING_PATH.test(new URL(url).pathname);
    } catch {
        // Not an absolute URL, so not a page Google could be told about.
        return false;
    }
}

/** IndexResult.error of a publish refused because the page is out of scope. */
export const GOOGLE_POLICY_REFUSED =
    'not submitted: the Google Indexing API only accepts job posting pages';

/**
 * True when the URL was never offered to Google because of its page type.
 *
 * This is a permanent answer, unlike the two cases googleWasNotAsked() covers.
 * Retrying the same URL can never succeed, so a caller that keeps a retry
 * counter should let it run out (or retire the row at once) rather than hold
 * the row for a later run that will refuse it again.
 */
export function isGooglePolicyRefusal(result: IndexResult): boolean {
    return result.engine === 'Google' && !result.success && result.error === GOOGLE_POLICY_REFUSED;
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
 *
 * app/api/cron/index-pseo used to ask for 100 more. It no longer calls Google
 * at all: its category x city landings carry no JobPosting (see the scope note
 * above), and it now submits them to Bing and IndexNow only.
 *
 * The three dedicated indexing crons alone want 450 of a 200 allowance, and
 * the ingest path multiplies that by ten. Without a budget the spend is first
 * come first served, which inverts the priority we actually want: the earliest
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
 *  2. new-content. This is the product promise, but a new job URL has other
 *     discovery channels (the sitemap, and IndexNow for the other engines)
 *     and Google crawls freshly linked pages by itself, so deferring costs
 *     latency, not correctness.
 *  3. backlog-removal. Same direction of value as 1, but the queue is roughly
 *     25,000 rows deep and drains over months either way; one day's deferral
 *     is invisible, and rows stay pending and are retried.
 *  4. unreserved. Zero, by design. See below.
 *
 * WHERE THE OLD PROGRAMMATIC LANE WENT. A fourth lane, 'programmatic', used to
 * hold 30 publishes a day for index-pseo's landings and the one off scripts.
 * Once the scope rule refuses those landings, no in-policy caller is left to
 * spend it, so its 30 went to backlog-removal, which rises from 15 to 25 per
 * run. That is the lane with the most work waiting behind its cap: at 45 a day
 * a 25,000 row queue needs about eighteen months of removals in the worst
 * case, at 75 about eleven, and fewer in practice, because live rows and out
 * of scope rows leave the queue without spending any quota.
 *
 * expired-job-removal gets none of it on purpose. app/api/cron/deindex-expired
 * records nothing about what it already sent, so each run offers the most
 * recently expired jobs first again, and a bigger cap there buys resubmissions
 * of the same URLs before it buys new ones. That lane's fix is at the caller.
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
 * publish from the employer post and paid activation paths, which has no
 * schedule. The new-content reservation leaves 20 publishes a day for it, and
 * GOOGLE_DAILY_HEADROOM stays unreserved on top. A durable daily ledger is the
 * real fix and needs a table this module does not own.
 *
 * WHY EVERY LANE IS A REQUIRED ARGUMENT: no default is both safe and useful,
 * so there is no honest one to pick. Count the batch invocations that would
 * rely on a default in a day: app/api/cron/index-urls fires once,
 * app/api/cron/deindex-expired twice, and lib/ingestion-service.ts sixty
 * times. A default generous enough for the three cron firings hands the same
 * per invocation share to the sixty ingest batches and spends the whole day's
 * quota before noon. A default small enough to survive the ingest path is
 * zero, which silently kills expired-job-removal, the one lane at the top of
 * the list above precisely because nothing else can do its job.
 *
 * So the choice belongs at the call site, and the type is what makes sure it
 * is made. Adding a caller without a lane is a compile error rather than a
 * quiet no-op discovered months later in Search Console. pingGoogle follows
 * the same rule. It used to default to 'programmatic' so index-pseo could
 * spend without declaring a lane; with that caller and that lane gone, a
 * caller that declares nothing throws by name, which also reaches the scripts
 * tsconfig does not compile.
 */
export const GOOGLE_DAILY_PUBLISH_QUOTA = 200;

/**
 * Publishes a day that no lane reserves. It absorbs what the static table
 * cannot schedule: a burst of employer posts beyond new-content's ad hoc
 * share, or a manual script run on a day the crons also fire. The lanes plus
 * this headroom must fit inside GOOGLE_DAILY_PUBLISH_QUOTA, and the test suite
 * fails the moment a reservation change breaks that.
 */
export const GOOGLE_DAILY_HEADROOM = 5;

export type GoogleIndexingLane =
    | 'expired-job-removal'
    | 'new-content'
    | 'backlog-removal'
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
        callers:
            'app/api/cron/index-urls, one publish per posted or activated job, and scripts/google-index.ts when run by hand',
    },
    'backlog-removal': {
        priority: 3,
        // 45 until the programmatic lane was retired; see the note above.
        dailyReservation: 75,
        perInvocation: 25,
        scheduledInvocationsPerDay: 3,
        callers: 'app/api/cron/historical-deindex',
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
        priority: 4,
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
 * True when NO publish request reached Google for this result YET, and a later
 * run could still make one.
 *
 * Two things can stop a publish before it becomes a request and clear up on
 * their own: this budget held it back, or no credential is configured to make
 * it with. They read as failures in an IndexResult, but nothing was tried, so
 * nothing failed.
 *
 * Any caller that retires a row, spends a retry attempt, or reports a URL as
 * submitted must consult this rather than `success`. Getting it wrong is not
 * recoverable in app/api/cron/historical-deindex: its queue is filtered on
 * status 'pending', so a row retired while Google was never asked is a URL
 * Google is never asked about again.
 *
 * A scope refusal (isGooglePolicyRefusal) is deliberately NOT included, even
 * though it made no request either. It never clears up, so reporting it as
 * "not asked yet" would make historical-deindex hold every out of scope row
 * pending forever, and because that cron reads the oldest rows first, a
 * handful of them would block the queue for good. Left on the failure path,
 * the row spends its attempts and retires with the reason in lastError.
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
 * The budget for `lane`, or a throw that names the problem.
 *
 * The compiler holds app/ and lib/ to a declared lane, but tsconfig excludes
 * scripts/, so a one off script can still arrive here with a lane that does
 * not exist or with none at all. Throwing by name beats the TypeError three
 * frames down, and it beats granting zero, which would print in the script's
 * own summary as Google having taken nothing and read like a quota problem
 * rather than a typo.
 */
function laneBudget(lane: GoogleIndexingLane): GoogleIndexingLaneBudget {
    if (Object.prototype.hasOwnProperty.call(GOOGLE_INDEXING_LANES, lane)) {
        return GOOGLE_INDEXING_LANES[lane];
    }
    const known = Object.keys(GOOGLE_INDEXING_LANES).join(', ');
    throw new Error(
        lane === undefined
            ? `[Indexing] No Google indexing lane was declared. Pass one of: ${known}.`
            : `[Indexing] Unknown Google indexing lane "${lane}". Declare one of: ${known}.`
    );
}

/**
 * Reserve up to `want` publishes in `lane` and return how many were granted.
 * Grants are recorded per invocation, so a caller that loops (a script, or
 * ingestion calling both batch helpers in one process) cannot reset its cap by
 * calling again.
 */
function takeGoogleBudget(lane: GoogleIndexingLane, want: number): number {
    const budget = laneBudget(lane);

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
 * Three checks run before any network, in this order, and each one reports
 * itself distinctly in the result:
 *
 *  1. Scope. A URL that is not a job posting page comes back as
 *     GOOGLE_POLICY_REFUSED and spends nothing, whatever lane it names and
 *     whether or not a credential exists. This is the check that keeps the
 *     Cloud project inside Google's policy (see the scope note above), so it
 *     sits outside everything else. It is a permanent answer; see
 *     isGooglePolicyRefusal.
 *  2. Budget. The lane's grant is taken ahead of the credential check and the
 *     OAuth exchange, so a refused publish costs no network at all and the
 *     cap stays the outermost numeric invariant: no configuration state can
 *     produce a run that publishes more than a lane allows, which is what
 *     makes the arithmetic testable without a credential. A grant spent on a
 *     call that then finds no credential costs nothing at Google, and the one
 *     caller that keeps durable per URL state, app/api/cron/historical-deindex,
 *     refuses to start at all without the key.
 *  3. Credential. An absent key and a key that will not exchange are reported
 *     differently, because only the first is a state to wait out.
 *
 * Budget refusals and an absent key are both reported through
 * googleWasNotAsked(), because a caller has to tell "Google said no" from "we
 * have not asked Google yet".
 *
 * `type` and `lane` are both required. See the budget note at the top of this
 * file for why no default lane is safe.
 */
export async function pingGoogle(
    url: string,
    type: GoogleNotificationType,
    lane: GoogleIndexingLane,
): Promise<IndexResult> {
    if (!isGoogleIndexingEligibleUrl(url)) {
        return { engine: 'Google', url, success: false, error: GOOGLE_POLICY_REFUSED };
    }

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
        // The job callers (the free post route, the paid activation and the
        // Stripe webhook) each publish one freshly created job page, which is
        // what the new-content lane reserves its ad hoc share for. The blog
        // publish in app/api/blog calls here too: pingGoogle refuses a post on
        // scope, so it still reaches Bing and IndexNow and never reaches Google.
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

    for (const r of flat) {
        logger.info('[Indexing] search engine ping', {
            engine: r.engine,
            url: r.url,
            success: r.success,
            ...(r.error ? { error: r.error } : {}),
        });
    }

    return flat;
}

/**
 * Publish `urls` to Google one at a time, spending the lane's budget, and
 * return a result for EVERY url. URLs past the lane's per run cap come back as
 * explicit refusals rather than being dropped from the array, because a caller
 * that keeps per URL state needs to tell "Google said no" from "we never asked
 * Google" (see app/api/cron/historical-deindex/route.ts). Out of scope URLs
 * come back as scope refusals and do not use up any of the lane's grant, so
 * the job URLs later in the same list still get it.
 */
async function publishToGoogleWithinBudget(
    urls: string[],
    type: GoogleNotificationType,
    lane: GoogleIndexingLane,
): Promise<IndexResult[]> {
    const results: IndexResult[] = [];
    for (const url of urls) {
        const result = await pingGoogle(url, type, lane);
        results.push(result);
        // A refusal made no request, so there is nothing to pace.
        if (isGoogleBudgetRefusal(result) || isGooglePolicyRefusal(result)) continue;
        // Small delay between Google requests.
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    return results;
}

/**
 * Ping all configured search engines for multiple URLs in batch, for new or
 * updated pages. Bing and IndexNow take the whole list: neither shares Google's
 * 200/day allowance or its page type restriction, so throttling them would
 * lose coverage for nothing.
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
    // the lane's share of the daily quota and limited to job posting pages.
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
