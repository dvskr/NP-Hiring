/**
 * Cron schedule — single source of truth for vercel.json's `crons` array.
 *
 * vercel.json is GENERATED from this file. After editing it (or after
 * changing GREENHOUSE_TOTAL_CHUNKS / WORKDAY_TOTAL_CHUNKS), regenerate:
 *
 *   npm run crons:generate             # rewrite vercel.json's crons key
 *   npm run crons:generate -- --check  # verify only, exit 1 on drift
 *
 * tests/aggregators/cron-schedule-drift.test.ts fails CI if vercel.json
 * and this file disagree, so hand-editing either side without
 * regenerating breaks the build.
 *
 * ── FORK/OPS NOTE ────────────────────────────────────────────────────
 * 1. Waves + 5-minute staggers are LOAD-BEARING. Ingestion runs as
 *    twice-daily waves with staggered minute offsets because concurrent
 *    serverless ingest bursts exhausted the PgBouncer connection pool
 *    in a past incident. Do not collapse entries onto the same minute.
 * 2. ingest-wave-summary coupling: WINDOW_MINUTES in
 *    app/api/cron/ingest-wave-summary/route.ts (currently 200) must
 *    cover the span from a wave's first ingest entry to its summary
 *    entry. If a wave stretches (more chunks, later offsets), re-check
 *    that window before regenerating.
 * 3. Vercel plan cron limits — OPEN QUESTION, deliberately unresolved:
 *    README claims Pro=64 but the file has 69. (README also still says
 *    "55 total cron entries".) Whether the 64 limit is stale docs, a
 *    plan difference, or a real overage has not been verified here.
 * ─────────────────────────────────────────────────────────────────────
 */

import { GREENHOUSE_TOTAL_CHUNKS } from '@/lib/aggregators/greenhouse';
import { WORKDAY_TOTAL_CHUNKS } from '@/lib/aggregators/workday';
import type { JobSource } from '@/lib/aggregators/types';

export interface CronEntry {
    readonly path: string;
    readonly schedule: string;
}

const INGEST_PATH = '/api/cron/ingest';

/** Gap between consecutive chunk invocations of the same source (see note 1). */
const CHUNK_STAGGER_MINUTES = 5;

/**
 * Single (non-chunked) ingest entry. `minute` offsets are hand-tuned
 * per source — they are NOT an arithmetic series, so each one is stated
 * literally at the call site rather than derived.
 */
function ingest(source: JobSource, minute: number, hours: string): CronEntry {
    return {
        path: `${INGEST_PATH}?source=${source}`,
        schedule: `${minute} ${hours} * * *`,
    };
}

/**
 * Chunked ingest expansion: one entry per chunk index, staggered
 * CHUNK_STAGGER_MINUTES apart starting at `firstChunkMinute`. Changing
 * an aggregator's *_TOTAL_CHUNKS constant regenerates the right number
 * of entries here.
 */
function chunkedIngest(
    source: JobSource,
    totalChunks: number,
    firstChunkMinute: number,
    hours: string,
): CronEntry[] {
    return Array.from({ length: totalChunks }, (_, chunk) => {
        const minute = firstChunkMinute + chunk * CHUNK_STAGGER_MINUTES;
        if (minute > 59) {
            throw new Error(
                `chunkedIngest(${source}): chunk ${chunk} lands at minute ${minute} — ` +
                'restructure the wave (this would spill past the hour and break staggering)',
            );
        }
        return {
            path: `${INGEST_PATH}?source=${source}&chunk=${chunk}`,
            schedule: `${minute} ${hours} * * *`,
        };
    });
}

/**
 * Wave A — twice-daily daytime wave (10:00–12:10 UTC and a partial
 * 16:00–17:35 UTC repeat). Sources scheduled only at the single-hour
 * specs (11, 12, 21) intentionally run once per day in this wave
 * (API quotas / low churn); do not "fix" them to twice daily.
 */
const WAVE_A_INGESTION: readonly CronEntry[] = [
    ingest('adzuna', 0, '10,16'),
    ...chunkedIngest('greenhouse', GREENHOUSE_TOTAL_CHUNKS, 10, '10,16'),
    ingest('lever', 50, '10,16'),
    ...chunkedIngest('workday', WORKDAY_TOTAL_CHUNKS, 5, '11,17'),
    // fantastic-jobs-db is hand-tuned and irregular: two once-daily 24h
    // pulls plus an annual 6-month backfill — kept literal.
    { path: `${INGEST_PATH}?source=fantastic-jobs-db&endpoint=24h`, schedule: '30 12 * * *' },
    { path: `${INGEST_PATH}?source=fantastic-jobs-db&endpoint=24h`, schedule: '0 21 * * *' },
    { path: `${INGEST_PATH}?source=fantastic-jobs-db&endpoint=6m`, schedule: '0 0 1 1 *' },
    ingest('smartrecruiters', 35, '11,17'),
    ingest('usajobs', 45, '11'),
    ingest('ashby', 40, '11'),
    ingest('bamboohr', 50, '11'),
    ingest('jazzhr', 55, '11'),
    ingest('workable', 0, '12'),
    ingest('doccafe', 5, '12'),
    ingest('healthcareercenter', 10, '12'),
];

/** Wave A summaries — one per daytime pass (see WINDOW_MINUTES, note 2). */
const WAVE_A_SUMMARIES: readonly CronEntry[] = [
    { path: '/api/cron/ingest-wave-summary', schedule: '50 12 * * *' },
    { path: '/api/cron/ingest-wave-summary', schedule: '55 17 * * *' },
];

/**
 * Wave B — nightly wave (23:00–00:55 UTC). Mirrors Wave A minus
 * fantastic-jobs-db and usajobs (once-daily sources). The tail offsets
 * (45/48/52/53/54) are hand-compressed to finish before the 00:55
 * summary — irregular by design, kept literal.
 */
const WAVE_B_INGESTION: readonly CronEntry[] = [
    ingest('adzuna', 0, '23'),
    ...chunkedIngest('greenhouse', GREENHOUSE_TOTAL_CHUNKS, 10, '23'),
    ingest('lever', 50, '23'),
    ...chunkedIngest('workday', WORKDAY_TOTAL_CHUNKS, 5, '0'),
    ingest('smartrecruiters', 35, '0'),
    ingest('ashby', 40, '0'),
    ingest('bamboohr', 45, '0'),
    ingest('jazzhr', 48, '0'),
    ingest('workable', 52, '0'),
    ingest('doccafe', 53, '0'),
    ingest('healthcareercenter', 54, '0'),
    { path: '/api/cron/ingest-wave-summary', schedule: '55 0 * * *' },
];

/** Housekeeping crons — independent of the ingestion waves, kept literal. */
const HOUSEKEEPING: readonly CronEntry[] = [
    { path: '/api/cron/enrich-jobs', schedule: '0 6,12,18,22 * * *' },
    { path: '/api/cron/cleanup-expired', schedule: '10 12,18 * * *' },
    { path: '/api/cron/cleanup-rejected-jobs', schedule: '45 4 * * *' },
    { path: '/api/cron/aggregate-pseo', schedule: '15 0,6,12,18 * * *' },
    { path: '/api/cron/freshness-decay', schedule: '20 12,18 * * *' },
    { path: '/api/cron/check-dead-links', schedule: '30 12,18 * * *' },
    { path: '/api/cron/engagement-anomaly', schedule: '0 5 * * *' },
    { path: '/api/cron/daily-report', schedule: '0 13 * * *' },
    { path: '/api/cron/index-urls', schedule: '15 13 * * *' },
    { path: '/api/cron/index-pseo', schedule: '45 13 * * *' },
    { path: '/api/cron/deindex-expired', schedule: '45 12,18 * * *' },
    { path: '/api/cron/historical-deindex', schedule: '0 1,7,19 * * *' },
    { path: '/api/cron/gsc-health-check', schedule: '30 9 * * *' },
    { path: '/api/cron/embedding-drift-check', schedule: '0 14 * * *' },
    { path: '/api/cron/send-alerts', schedule: '30 13 * * *' },
    { path: '/api/cron/candidate-alerts', schedule: '45 13 * * *' },
    { path: '/api/cron/employer-report', schedule: '0 14 1 * *' },
    { path: '/api/cron/saved-job-reminder', schedule: '0 13 * * 3,6' },
    { path: '/api/cron/push-notifications', schedule: '30 14 * * *' },
    { path: '/api/cron/expiry-warnings', schedule: '0 22 * * *' },
    { path: '/api/cron/source-presence-unpublish', schedule: '55 12 * * *' },
    { path: '/api/cron/health-anomaly-check', schedule: '0 13 * * *' },
    { path: '/api/cron/purge-soft-deleted', schedule: '30 8 * * *' },
    { path: '/api/cron/purge-inactive-users', schedule: '45 8 * * *' },
    { path: '/api/cron/dsar-overdue', schedule: '0 9 * * *' },
    { path: '/api/cron/refresh-site-stats', schedule: '15 * * * *' },
];

/**
 * Full crons array in the exact order emitted into vercel.json.
 * Order matters only for review-diff stability, but keep it stable.
 */
export const CRON_ENTRIES: readonly CronEntry[] = [
    ...WAVE_A_INGESTION,
    ...WAVE_A_SUMMARIES,
    ...WAVE_B_INGESTION,
    ...HOUSEKEEPING,
];
