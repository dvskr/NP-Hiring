import { NextRequest, NextResponse } from 'next/server';
import { brand } from '@/config/brand';
import { prisma } from '@/lib/prisma';
import {
    GOOGLE_INDEXING_LANES,
    googleWasNotAsked,
    pingAllSearchEnginesBatchDeleted,
} from '@/lib/search-indexing';
import { slugify } from '@/lib/utils';
import { verifyCronOrAdmin } from '@/lib/auth/verify-cron-or-admin';
import { sendCronFailureAlert } from '@/lib/discord-notifier';
import { withCronTracking, type CronRunResult } from '@/lib/cron/track';
import { logger } from '@/lib/logger';
import {
    DEINDEX_EXPIRED_CRON,
    advanceCursor,
    passedOverWhere,
    pendingJobsWhere,
    planWindow,
    readLastCursor,
    type CursorHold,
    type DeindexCursor,
    type OfferedJob,
} from './cursor';

// Google publishes are paced 100 ms apart and capped per run by the lane, so a
// normal run takes seconds. The ceiling covers a slow Google or IndexNow.
export const maxDuration = 300;

/**
 * Jobs offered per run: exactly what the expired-job-removal lane lets one run
 * publish to Google. IndexNow gets the same list. A longer list would reach
 * IndexNow now and Google only on a later run, so IndexNow would hear about
 * those URLs twice.
 */
const BATCH_SIZE = GOOGLE_INDEXING_LANES['expired-job-removal'].perInvocation;

/**
 * Dedicated de-indexing cron for expired jobs.
 *
 * WHY THIS EXISTS. Expiry unpublishes a job (cleanup-expired, and the sweep at
 * the end of every ingest run), and a dead job URL that is still in Google's
 * index has no other way out: IndexNow reaches Bing, Yandex and Seznam but
 * cannot remove anything from Google. This cron is the caller that tells
 * Google, out of the expired-job-removal lane in lib/search-indexing.ts.
 *
 * HOW IT PICKS JOBS. Oldest first, from a resume point stored in cron_runs, so a
 * job is sent once unless another writer updates it after it was sent
 * (./cursor.ts explains the cursor, the lookback cap, the settle margin and that
 * exception, which ingest renewal is guarded against). The cursor moves past a job only
 * once Google has given a final answer for it, so a job Google was not asked
 * about stays ahead of the cursor, a batch Google refused outright is offered
 * again, and so are the jobs Google failed after the last one it accepted (a
 * quota that ran out, or an outage that began, partway through the batch);
 * everything past the run's share carries over to the next run instead of
 * being dropped.
 *
 * WITHOUT THE GOOGLE KEY the run reads no jobs and sends nothing, and carries
 * the cursor forward. Sending to IndexNow alone would move the cursor past jobs
 * Google was never told about. Meanwhile IndexNow still hears about every job
 * the sweep at the end of an ingest run expires (lib/ingestion-service.ts);
 * only jobs the cleanup-expired safety net flips wait for this cron.
 *
 * Schedule: the midday batch in config/cron-schedule.ts, twice daily, after
 * cleanup-expired.
 */
export async function GET(request: NextRequest) {
    const authError = await verifyCronOrAdmin(request);
    if (authError) return authError;

    const startTime = Date.now();
    logger.info('[CRON:deindex-expired] Starting expired URL de-indexing');

    try {
        return await withCronTracking(DEINDEX_EXPIRED_CRON, async () => {
            const now = new Date();
            // Read before anything else, so that every successful run, including
            // one that sends nothing, carries the resume point forward.
            const previous = await readLastCursor();

            if (!process.env.GOOGLE_INDEXING_CREDENTIALS) {
                logger.warn(
                    '[CRON:deindex-expired] GOOGLE_INDEXING_CREDENTIALS is not set; leaving expired jobs for a run that can reach Google',
                );
                return report(startTime, {
                    ...NOTHING_SENT,
                    message: 'Google Indexing API is not configured, so no expired job was sent',
                    hold: 'google-not-configured',
                    cursor: previous,
                });
            }

            const window = planWindow(previous, now);
            const pending = pendingJobsWhere(window, now);
            const [waiting, passedOver] = await Promise.all([
                prisma.job.count({ where: pending }),
                window.staleCursor
                    ? prisma.job.count({ where: passedOverWhere(window.staleCursor, window, now) })
                    : Promise.resolve(0),
            ]);
            if (passedOver > 0) {
                logger.warn('[CRON:deindex-expired] Expired jobs fell behind the lookback window unsent', {
                    passedOver,
                    staleCursor: window.staleCursor,
                });
            }

            const batch = await prisma.job.findMany({
                where: pending,
                select: { id: true, title: true, slug: true, updatedAt: true },
                orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
                take: BATCH_SIZE,
            });

            if (batch.length === 0) {
                return report(startTime, {
                    ...NOTHING_SENT,
                    message: 'No expired jobs waiting for removal',
                    passedOver,
                    cursor: previous,
                });
            }

            // Same expression as the job page's canonical URL.
            const offered: OfferedJob[] = batch.map((job) => ({
                id: job.id,
                updatedAt: job.updatedAt,
                url: `${brand.baseUrl}/jobs/${job.slug || slugify(job.title, job.id)}`,
            }));

            const results = await pingAllSearchEnginesBatchDeleted(
                offered.map((job) => job.url),
                'expired-job-removal',
            );
            const outcome = advanceCursor(previous, offered, results.google);

            if (outcome.hold === 'google-rejected-every-url') {
                logger.warn('[CRON:deindex-expired] Google refused every removal; the batch will be offered again', {
                    firstError: results.google.find((r) => !r.success)?.error,
                });
            }
            if (outcome.hold === 'google-failed-after-last-success') {
                logger.warn('[CRON:deindex-expired] Google failed every removal after its last success; those jobs will be offered again', {
                    completed: outcome.completed,
                    firstError: results.google[outcome.completed]?.error,
                });
            }

            const googleNotAsked = results.google.filter(googleWasNotAsked).length;
            const googleDeleted = results.google.filter((r) => r.success).length;
            const indexNowDeleted = results.indexNow.filter((r) => r.success).length;

            return report(startTime, {
                message: `Offered ${batch.length} expired job URLs; the cursor moved past ${outcome.completed}`,
                expiredCount: batch.length,
                completed: outcome.completed,
                backlog: Math.max(0, waiting - outcome.completed),
                passedOver,
                hold: outcome.hold,
                cursor: outcome.cursor,
                google: {
                    deleted: googleDeleted,
                    failed: results.google.length - googleDeleted - googleNotAsked,
                    notAsked: googleNotAsked,
                },
                indexNow: {
                    deleted: indexNowDeleted,
                    failed: results.indexNow.length - indexNowDeleted,
                },
            });
        });
    } catch (error) {
        await sendCronFailureAlert(DEINDEX_EXPIRED_CRON, error);
        logger.error('[CRON:deindex-expired] Error', error);

        return NextResponse.json(
            {
                success: false,
                error: 'De-indexing cron failed',
                details: error instanceof Error ? error.message : 'Unknown error',
                timestamp: new Date().toISOString(),
            },
            { status: 500 },
        );
    }
}

interface RunReport {
    readonly message: string;
    /** Jobs offered to the search engines this run. */
    readonly expiredCount: number;
    /** Jobs the cursor moved past; the next run will not offer them again. */
    readonly completed: number;
    /** Expired jobs inside the window still waiting after this run. */
    readonly backlog: number;
    /** Expired jobs that fell behind the lookback floor before any run sent them. */
    readonly passedOver: number;
    readonly hold: CursorHold | 'google-not-configured' | null;
    /** The resume point the next run reads back from this run's metrics. */
    readonly cursor: DeindexCursor | null;
    readonly google: { readonly deleted: number; readonly failed: number; readonly notAsked: number };
    readonly indexNow: { readonly deleted: number; readonly failed: number };
}

const NOTHING_SENT: Omit<RunReport, 'message' | 'cursor'> = {
    expiredCount: 0,
    completed: 0,
    backlog: 0,
    passedOver: 0,
    hold: null,
    google: { deleted: 0, failed: 0, notAsked: 0 },
    indexNow: { deleted: 0, failed: 0 },
};

/**
 * The response and the run metrics. Every successful run records `cursor`,
 * because the next run reads its resume point from the newest successful run.
 */
function report(startTime: number, run: RunReport): CronRunResult {
    const summary = {
        success: true,
        ...run,
        duration: `${((Date.now() - startTime) / 1000).toFixed(1)}s`,
        timestamp: new Date().toISOString(),
    };
    logger.info('[CRON:deindex-expired] Complete', {
        expiredCount: run.expiredCount,
        completed: run.completed,
        backlog: run.backlog,
        hold: run.hold,
    });

    return {
        response: NextResponse.json(summary),
        metrics: {
            expiredCount: run.expiredCount,
            completed: run.completed,
            backlog: run.backlog,
            passedOver: run.passedOver,
            hold: run.hold,
            googleDeleted: run.google.deleted,
            googleFailed: run.google.failed,
            googleNotAsked: run.google.notAsked,
            indexNowDeleted: run.indexNow.deleted,
            indexNowFailed: run.indexNow.failed,
            cursor: run.cursor,
        },
    };
}
