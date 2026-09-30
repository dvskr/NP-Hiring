import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { pingAllSearchEnginesBatch } from '@/lib/search-indexing';
import { slugify } from '@/lib/utils';
import { verifyCronOrAdmin } from '@/lib/auth/verify-cron-or-admin';
import { sendCronFailureAlert } from '@/lib/discord-notifier';
import { withCronTracking } from '@/lib/cron/track';
import { brand } from '@/config/brand';
import {
    INDEX_URLS_CRON,
    isSubmittableJobPosting,
    planSubmissionWindow,
    readLastWindowEnd,
    submissionWhere,
    type SubmissionWindow,
} from './window';

export const maxDuration = 300; // 5 minutes: Google publishes are paced one at a time

const BASE_URL = brand.baseUrl;

/**
 * Daily cron: submit new and content-changed job URLs to the Google Indexing
 * API, Bing Webmaster API and IndexNow.
 *
 * - Selects jobs created, or whose content changed, since the newest
 *   successful run's window ended, and only live pages that emit a valid
 *   JobPosting item (./window.ts explains the window and both filters). An
 *   unchanged job is never sent again, so no URL is resubmitted day after day.
 * - Google: job detail pages only, at most the new-content lane's per-run
 *   grant (GOOGLE_INDEXING_LANES['new-content'].perInvocation in
 *   lib/search-indexing.ts), newest first; pingAllSearchEnginesBatch enforces
 *   both, and the rest of a large day waits for the sitemap and Google's own
 *   crawl
 * - Bing: batch up to 500 at once
 * - IndexNow: batch up to 10,000 at once
 *
 * Every successful run records its window end in cron_runs.metrics, including
 * a run that found nothing, because the next run resumes from it.
 */
export async function GET(request: NextRequest) {
    // Verify cron secret
    const authError = await verifyCronOrAdmin(request);
    if (authError) return authError;

    const startTime = Date.now();
    console.log('[CRON:index-urls] Starting daily search engine indexing');

    try {
        return await withCronTracking(INDEX_URLS_CRON, async () => {
            const now = new Date();
            const window = planSubmissionWindow(await readLastWindowEnd(), now);

            const candidates = await prisma.job.findMany({
                where: submissionWhere(window, now),
                select: {
                    id: true,
                    title: true,
                    // Content audit P0 #3: the stored slug column MUST be
                    // selected — without it the `job.slug ||` fallback below
                    // always fires and every URL is re-derived from the title.
                    slug: true,
                    // Everything isSubmittableJobPosting reads.
                    employer: true,
                    description: true,
                    location: true,
                    mode: true,
                    isRemote: true,
                    isHybrid: true,
                    city: true,
                    state: true,
                    stateCode: true,
                    country: true,
                },
                // New jobs first: a content-changed job was created before the
                // window, so it sorts after every job created inside it.
                orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
            });
            // A page that emits no JobPosting item is not sent to an API that
            // only accepts job posting pages (./window.ts).
            const recentJobs = candidates.filter(isSubmittableJobPosting);
            const skippedNoJobPosting = candidates.length - recentJobs.length;

            if (recentJobs.length === 0) {
                console.log('[CRON:index-urls] No new or changed jobs to index');
                return {
                    response: NextResponse.json({
                        success: true,
                        message: 'No new or changed jobs to index',
                        jobCount: 0,
                        skippedNoJobPosting,
                        window: windowSummary(window),
                        duration: `${((Date.now() - startTime) / 1000).toFixed(1)}s`,
                        timestamp: new Date().toISOString(),
                    }),
                    metrics: { jobCount: 0, skippedNoJobPosting, ...windowMetrics(window) },
                };
            }

            // Build full URLs.
            // MUST match the job page's canonical exactly (app/jobs/[slug]/
            // page.tsx: `job.slug || slugify(job.title, job.id)`) — same fix
            // as app/feed.xml/route.ts. Deriving the slug from the title alone
            // spent the 200/day Google Indexing API quota on URLs whose
            // rel=canonical pointed elsewhere for titles with apostrophes,
            // slashes, or parens, or for jobs whose title changed after the
            // slug was stored.
            const urls = recentJobs.map((job) => {
                const slug = job.slug || slugify(job.title, job.id);
                return `${BASE_URL}/jobs/${slug}`;
            });

            console.log(`[CRON:index-urls] Submitting ${urls.length} URLs to search engines`);

            // Submit to all engines (Google, Bing, IndexNow)
            const results = await pingAllSearchEnginesBatch(urls, 'new-content');

            const googleSuccess = results.google.filter((r) => r.success).length;
            const googleFailed = results.google.filter((r) => !r.success).length;
            const bingSuccess = results.bing.filter((r) => r.success).length;
            const bingFailed = results.bing.filter((r) => !r.success).length;
            const indexNowSuccess = results.indexNow.filter((r) => r.success).length;
            const indexNowFailed = results.indexNow.filter((r) => !r.success).length;

            const duration = ((Date.now() - startTime) / 1000).toFixed(1);

            const summary = {
                success: true,
                jobCount: urls.length,
                skippedNoJobPosting,
                window: windowSummary(window),
                google: { submitted: googleSuccess, failed: googleFailed },
                bing: { submitted: bingSuccess, failed: bingFailed },
                indexNow: { submitted: indexNowSuccess, failed: indexNowFailed },
                duration: `${duration}s`,
                timestamp: new Date().toISOString(),
            };

            console.log('[CRON:index-urls] Complete:', JSON.stringify(summary));

            return {
                response: NextResponse.json(summary),
                metrics: {
                    jobCount: urls.length,
                    skippedNoJobPosting,
                    ...windowMetrics(window),
                    googleSubmitted: googleSuccess,
                    googleFailed,
                    bingSubmitted: bingSuccess,
                    bingFailed,
                    indexNowSubmitted: indexNowSuccess,
                    indexNowFailed,
                },
            };
        });
    } catch (error) {
        await sendCronFailureAlert(INDEX_URLS_CRON, error);
        console.error('[CRON:index-urls] Error:', error);

        return NextResponse.json(
            {
                success: false,
                error: 'Indexing cron failed',
                details: error instanceof Error ? error.message : 'Unknown error',
                timestamp: new Date().toISOString(),
            },
            { status: 500 }
        );
    }
}

function windowSummary(window: SubmissionWindow): { since: string; until: string } {
    return { since: window.since.toISOString(), until: window.until.toISOString() };
}

/** windowEnd is the resume point the next run reads back (./window.ts). */
function windowMetrics(window: SubmissionWindow): { windowStart: string; windowEnd: string } {
    return { windowStart: window.since.toISOString(), windowEnd: window.until.toISOString() };
}
