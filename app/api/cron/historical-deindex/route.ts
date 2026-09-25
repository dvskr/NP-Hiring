import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
    GOOGLE_POLICY_REFUSED,
    googleWasNotAsked,
    isGoogleIndexingEligibleUrl,
    pingAllSearchEnginesBatchDeleted,
} from '@/lib/search-indexing';
import { verifyCronOrAdmin } from '@/lib/auth/verify-cron-or-admin';
import { sendCronFailureAlert } from '@/lib/discord-notifier';
import { withCronTracking } from '@/lib/cron/track';
import { brand } from '@/config/brand';

export const maxDuration = 300; // 5 minutes: HEAD checks BATCH_SIZE URLs in parallel, then submits.

// HEAD-check up to 50 URLs per run x 3 runs/day (vercel.json: 0 1,7,19). The
// scarce resource is not BATCH_SIZE, it is the backlog-removal lane's share of
// the 200/day Google Indexing API quota: the lane's per-run grant
// (GOOGLE_INDEXING_LANES['backlog-removal'].perInvocation in
// lib/search-indexing.ts) is smaller than the batch. A run that finds more gone
// URLs than that defers the rest and they come back on the next run, so the
// queue advances at the lane's pace whatever BATCH_SIZE says.
//
// The HEAD batch is still kept wider than the lane on purpose: a URL that turns
// out to be LIVE is cleared from the queue without spending any Google budget,
// so the extra checks drain live rows that would otherwise sit behind gone ones
// waiting for quota. Narrowing BATCH_SIZE to the lane cap would stall them.
const BATCH_SIZE = 50;
const HEAD_CHECK_TIMEOUT_MS = 8000;
const MAX_ATTEMPTS = 3;

/**
 * Statuses that prove a URL is GONE rather than merely unreachable right now.
 *
 * This is the whole safety story of this cron. Everything it does with a
 * "dead" URL is irreversible from our side: it asks Google to drop the page
 * from the index, and re-indexing afterwards takes weeks. So the bar is proof
 * of absence, not absence of proof.
 *
 *   404 and 410 are the only statuses that mean "this resource is not here".
 *
 * Everything else that is not 2xx/3xx is a reason to try again later:
 *   5xx   our own server failed. One Vercel incident or a cold start burst
 *         during a sweep would otherwise hand Google removal requests for
 *         live pages, across a 25,000 URL surface, unattended, at 01:00.
 *   429   we are being rate limited, by our own host or by a CDN. The page is
 *         fine; we are just asking too fast.
 *   403   a WAF or bot rule blocked the checker. Employer ATS pages behind
 *         Cloudflare do this (see the User-Agent note below), and Googlebot
 *         is usually allowed through the same rule we are not.
 *   401   an auth wall, which is a reason to noindex a page, never a reason to
 *         tell Google the URL does not exist.
 *   405   the host refuses HEAD as a method. That says nothing about the URL.
 *   400   a malformed request or a picky edge proxy, not a missing resource.
 *
 * 451 is deliberately absent: it means removed for legal reasons, which is a
 * removal decision a human should make, not a sweep at 01:00.
 */
const GONE_STATUSES: ReadonlySet<number> = new Set([404, 410]);

/**
 * GSC Indexing Crisis (P2.1): historical 404 / soft-404 / crawled-not-indexed
 * URL drainage cron.
 *
 * WHY THIS EXISTS:
 *   The deindex-expired cron only handles jobs unpublished in the last 48h.
 *   This cron drains the legacy backlog (~25k pre-Mar-19 URLs) seeded into
 *   the deindex_queue table from GSC bulk exports + sitemap-diff scrapers.
 *
 * FLOW:
 *   1. Pull oldest N pending rows (oldest first, for fairness)
 *      - A row whose URL is not a job posting page is retired as 'failed'
 *        at once, with GOOGLE_POLICY_REFUSED in lastError. The Google
 *        Indexing API accepts job posting pages only, so no later run could
 *        ever submit it, and it gets no HEAD check either
 *   2. HEAD-check each remaining URL with a short timeout
 *      - If 200/3xx, the URL is alive: mark 'live' and remove from queue
 *      - If 404/410, submit URL_DELETED to Google + IndexNow. The row is
 *        retired as 'submitted' only once Google has actually been asked
 *      - Any other status, or a network error, bumps the attempt counter and
 *        leaves the row 'pending' for the next run
 *      - Once attempt reaches MAX_ATTEMPTS, mark 'failed' and stop trying
 *
 * SAFETY:
 *   - Only GONE_STATUSES are treated as removable. See the note above it.
 *   - Without GOOGLE_INDEXING_CREDENTIALS the run stops before it reads the
 *     queue. See the guard in the body for why draining it unarmed is worse
 *     than doing nothing.
 *   - Google submissions run in the 'backlog-removal' lane, which sits BELOW
 *     live expired-job removals in lib/search-indexing.ts. A publish the lane
 *     budget refuses never reached Google, so it neither spends one of the
 *     row's three attempts nor retires the row: it stays pending and is picked
 *     up again on the next run.
 *   - An IndexNow acceptance on its own is NOT enough to retire a row.
 *     IndexNow reaches Bing, Yandex and Seznam but cannot remove anything from
 *     Google, so a row retired on IndexNow alone would leave the queue with
 *     Google never asked, and the pending filter means never asked again.
 *     googleWasNotAsked() is the single test for that, and it covers both ways
 *     a publish stops short: the lane budget, and a missing credential.
 *
 * SCHEDULE: vercel.json runs this at 0 1,7,19, offset from the midday batch
 * that carries deindex-expired.
 */
export async function GET(request: NextRequest) {
    const authError = await verifyCronOrAdmin(request);
    if (authError) return authError;

    const startTime = Date.now();
    console.log('[CRON:historical-deindex] Starting backlog drainage');

    try {
        return await withCronTracking('historical-deindex', async () => {
        // The queue is frozen on purpose until the key arms this cron.
        //
        // Removing a URL from Google is the entire point of the queue, and only
        // the Google Indexing API can do it: IndexNow reaches Bing, Yandex and
        // Seznam but has no removal channel into Google. So a run without the
        // credential cannot accomplish the one job it exists for, while it can
        // still consume the backlog, because a row leaves the queue on any
        // terminal status and the candidate filter only ever looks at 'pending'
        // rows. Three runs a day against a 25,000 row queue would quietly eat
        // the oldest rows for as long as the key is missing, and the owner
        // would arm it later against a queue that had already lost exactly the
        // URLs they wanted gone. Doing nothing is the only honest option, and
        // it keeps the promise .env.example and scripts/fork-preflight.ts make.
        if (!process.env.GOOGLE_INDEXING_CREDENTIALS) {
            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            console.warn(
                '[CRON:historical-deindex] GOOGLE_INDEXING_CREDENTIALS is not set; leaving the backlog untouched'
            );
            return {
                response: NextResponse.json({
                    success: true,
                    message: 'Google Indexing API is not configured, so the backlog was left intact',
                    processed: 0,
                    duration: `${duration}s`,
                    timestamp: new Date().toISOString(),
                }),
                metrics: { processed: 0 },
            };
        }

        const candidates = await prisma.deindexQueue.findMany({
            where: {
                status: 'pending',
                attempt: { lt: MAX_ATTEMPTS },
            },
            orderBy: [
                { addedAt: 'asc' },
            ],
            take: BATCH_SIZE,
        });

        if (candidates.length === 0) {
            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log('[CRON:historical-deindex] Queue empty, nothing to drain');
            return {
                response: NextResponse.json({
                    success: true,
                    message: 'Queue empty',
                    processed: 0,
                    duration: `${duration}s`,
                    timestamp: new Date().toISOString(),
                }),
                metrics: { processed: 0 },
            };
        }

        // 0. Retire the rows Google will never accept, before any network.
        //    The queue was seeded from Search Console exports of every URL
        //    type, so it holds landings, posts and account pages as well as
        //    jobs, and lib/search-indexing.ts refuses every one of them
        //    permanently. Left in the normal flow, each such row would cost a
        //    HEAD request and one attempt on three separate runs before it
        //    failed anyway, and hold a slot in this oldest first batch each
        //    time. One updateMany retires them all, attempt left as it is,
        //    because no request was ever made.
        const eligible = candidates.filter((row) => isGoogleIndexingEligibleUrl(row.url));
        const outOfScope = candidates.filter((row) => !isGoogleIndexingEligibleUrl(row.url));
        if (outOfScope.length > 0) {
            await prisma.deindexQueue.updateMany({
                where: { id: { in: outOfScope.map((r) => r.id) } },
                data: { status: 'failed', lastError: GOOGLE_POLICY_REFUSED },
            });
        }

        // 1. HEAD-check the eligible candidates in parallel.
        //    URLs that return 200/3xx are still live, so we must NOT submit
        //    URL_DELETED for them (would actively de-index a working page).
        const headResults = await Promise.all(
            eligible.map(async (row) => {
                try {
                    const controller = new AbortController();
                    const timer = setTimeout(() => controller.abort(), HEAD_CHECK_TIMEOUT_MS);
                    const res = await fetch(row.url, {
                        method: 'HEAD',
                        redirect: 'manual',
                        signal: controller.signal,
                        headers: {
                            // Audit 25 M-5: a bare proprietary
                            // "<brand.indexerUserAgent>/1.0" UA was being
                            // blocked by Cloudflare WAFs on
                            // employer ATS career pages, causing legitimate
                            // live URLs to look dead and never get the
                            // URL_DELETED submission they needed. A standard
                            // browser UA passes the WAFs and lets the HEAD
                            // check return real status codes.
                            'User-Agent': `Mozilla/5.0 (compatible; ${brand.indexerUserAgent}/1.0; +${brand.baseUrl}/about)`,
                        },
                    });
                    clearTimeout(timer);
                    return { row, status: res.status, error: null as string | null };
                } catch (err) {
                    return {
                        row,
                        status: 0,
                        error: err instanceof Error ? err.message : String(err),
                    };
                }
            })
        );

        // 2. Partition by HEAD result. Only a proven-gone status is removable;
        //    everything else goes down the retry path, including our own 5xx.
        const live: typeof candidates = [];
        const gone: typeof candidates = [];
        const retry: { row: typeof candidates[number]; error: string }[] = [];

        for (const r of headResults) {
            if (r.error) {
                retry.push({ row: r.row, error: r.error });
            } else if (r.status >= 200 && r.status < 400) {
                live.push(r.row);
            } else if (GONE_STATUSES.has(r.status)) {
                gone.push(r.row);
            } else {
                retry.push({
                    row: r.row,
                    error: `HTTP ${r.status} is not proof the URL is gone; retrying instead of asking Google to remove it`,
                });
            }
        }

        // 3. Mark live URLs as 'live' (clears them from queue without submitting).
        if (live.length > 0) {
            await prisma.deindexQueue.updateMany({
                where: { id: { in: live.map((r) => r.id) } },
                data: { status: 'live', submittedAt: null },
            });
        }

        // 4. Submit gone URLs to Google + IndexNow.
        //    Retiring a row takes it out of the queue for good, because the
        //    query above filters on status 'pending'. So the test for retiring
        //    is "was Google actually asked", not "did either engine take it":
        //    IndexNow has no way to remove a URL from Google, and with a batch
        //    of 50 against the lane's much smaller per-run grant, an
        //    IndexNow-only rule would retire most of every batch with Google
        //    never asked at all.
        //
        //    A deferred row is offered to IndexNow again on its next run. That
        //    is harmless: the protocol is idempotent, and lib/indexnow.ts caps
        //    the host at 10,000 URLs a day, which 50 per run cannot approach.
        let submittedCount = 0;
        let submitFailedCount = 0;
        let budgetDeferredCount = 0;
        if (gone.length > 0) {
            const goneUrls = gone.map((r) => r.url);
            const submitResults = await pingAllSearchEnginesBatchDeleted(goneUrls, 'backlog-removal');

            const googleResultByUrl = new Map(
                submitResults.google.map((g) => [g.url, g] as const)
            );
            const indexNowSuccess = new Map(
                submitResults.indexNow.map((i) => [i.url, i.success] as const)
            );

            for (const row of gone) {
                const googleResult = googleResultByUrl.get(row.url);
                const gOk = googleResult?.success ?? false;
                const iOk = indexNowSuccess.get(row.url) ?? false;
                // googleWasNotAsked means no request was made, whether the lane
                // budget held it back or no credential existed to make it with.
                // Neither is a rejection, so it must neither spend one of the
                // row's three attempts nor let the row leave the queue. A
                // missing result is read the same way: "we cannot show Google
                // was asked" has to fail safe on a queue we get one pass at.
                const googleDeferred = googleResult ? googleWasNotAsked(googleResult) : true;

                if (googleDeferred) {
                    // Leave status and attempt exactly as they are. Oldest
                    // first ordering brings this row back on the next run, and
                    // the lane budget is what paces the drain, not this batch.
                    const why = googleResult?.error ?? 'no result came back for this URL';
                    const indexNowNote = iOk
                        ? 'IndexNow accepted the URL but cannot remove it from Google'
                        : 'IndexNow did not accept the URL either';
                    await prisma.deindexQueue.update({
                        where: { id: row.id },
                        data: {
                            lastError: `Deferred: no removal request reached Google (${why}). ${indexNowNote}.`.slice(0, 1000),
                        },
                    });
                    budgetDeferredCount++;
                } else if (gOk) {
                    // ONLY a Google acceptance retires a row. IndexNow cannot
                    // remove a URL from Google, and removing it from Google is
                    // the entire point of this queue, so an IndexNow success
                    // beside a Google rejection is not a completed job. A
                    // Google rejection therefore falls through to the retry
                    // branch below, which holds the row pending and bumps the
                    // attempt until MAX_ATTEMPTS, after which it lands failed
                    // with the Google error in lastError for an operator.
                    //
                    // This matters most on the very first armed run: the
                    // Indexing API answers 403 until the service account is a
                    // verified owner of the property, which is the single most
                    // likely first-run response. Retiring on IndexNow alone
                    // would silently burn the backlog against that 403.
                    await prisma.deindexQueue.update({
                        where: { id: row.id },
                        data: {
                            status: 'submitted',
                            submittedAt: new Date(),
                            attempt: { increment: 1 },
                            lastError: iOk ? null : 'IndexNow rejected',
                        },
                    });
                    submittedCount++;
                } else {
                    const gErr = googleResult?.error || 'no result';
                    const nextAttempt = row.attempt + 1;
                    await prisma.deindexQueue.update({
                        where: { id: row.id },
                        data: {
                            status: nextAttempt >= MAX_ATTEMPTS ? 'failed' : 'pending',
                            attempt: nextAttempt,
                            lastError: gErr.slice(0, 1000),
                        },
                    });
                    submitFailedCount++;
                }
            }
        }

        // 5. Bump the retry counter for HEAD checks that proved nothing:
        //    network errors, timeouts, our own 5xx, and every other non-gone
        //    status. These rows are tried again until MAX_ATTEMPTS.
        for (const f of retry) {
            const nextAttempt = f.row.attempt + 1;
            await prisma.deindexQueue.update({
                where: { id: f.row.id },
                data: {
                    status: nextAttempt >= MAX_ATTEMPTS ? 'failed' : 'pending',
                    attempt: nextAttempt,
                    lastError: f.error.slice(0, 1000),
                },
            });
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        const summary = {
            success: true,
            processed: candidates.length,
            outOfScope: outOfScope.length,
            live: live.length,
            submitted: submittedCount,
            submitFailed: submitFailedCount,
            budgetDeferred: budgetDeferredCount,
            headFailed: retry.length,
            duration: `${duration}s`,
            timestamp: new Date().toISOString(),
        };

        console.log('[CRON:historical-deindex] Complete:', JSON.stringify(summary));
        return {
            response: NextResponse.json(summary),
            metrics: {
                processed: candidates.length,
                outOfScope: outOfScope.length,
                live: live.length,
                submitted: submittedCount,
                submitFailed: submitFailedCount,
                budgetDeferred: budgetDeferredCount,
                headFailed: retry.length,
            },
        };
        });
    } catch (error) {
        await sendCronFailureAlert('historical-deindex', error);
        console.error('[CRON:historical-deindex] Error:', error);
        return NextResponse.json(
            {
                success: false,
                error: 'Historical de-indexing cron failed',
                details: error instanceof Error ? error.message : 'Unknown error',
                timestamp: new Date().toISOString(),
            },
            { status: 500 }
        );
    }
}
