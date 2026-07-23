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
 *    entry. Wave A spans 10:10 → 12:50 (160m); Wave B spans
 *    23:10 → 00:55 (105m) — both inside the window. If a wave
 *    stretches (more chunks, later offsets), re-check before
 *    regenerating.
 * 3. Vercel plan cron limits: the Pro plan's documented cap is 40 cron
 *    jobs (a previous version of this comment claimed 64 — that number
 *    was never in Vercel's docs). This board schedules exactly 40
 *    entries: 32 ingestion-wave entries + 8 housekeeping entries, after
 *    the B106 consolidation folded 21 low-frequency housekeeping crons
 *    into 3 sequential batch dispatchers (see CRON_BATCHES below).
 *    There is NO headroom left — before adding a new cron, either add
 *    it as a target inside an existing batch (cadence permitting) or
 *    move it to an Inngest schedule (lib/inngest/functions/).
 * ─────────────────────────────────────────────────────────────────────
 */

import { GREENHOUSE_TOTAL_CHUNKS } from '@/lib/aggregators/greenhouse';
import { WORKDAY_TOTAL_CHUNKS } from '@/lib/aggregators/workday';
import type { JobSource } from '@/lib/aggregators/types';

export interface CronEntry {
    readonly path: string;
    readonly schedule: string;
}

/**
 * Sources that exist in the engine's registry but are NOT scheduled on
 * this board. Per-board decision: NP Hiring runs ATS-ONLY ingestion, a
 * strategy ported from the donor NP board (its 2026-05-23 "ATS-only
 * ingestion" decision): employer-authoritative feeds, fewer duplicates,
 * healthier apply links, and zero external API quota cost. The adapters
 * remain in the engine for other boards — only the scheduling is
 * per-board.
 *
 * The 8 scheduled ATS sources: greenhouse, lever, workday,
 * smartrecruiters, ashby, bamboohr, jazzhr, workable.
 *
 * (jooble / jsearch / ats-jobs-db were also rejected by the donor but
 * are not present in this template's registry, so they are not listed.)
 *
 * tests/aggregators/cron-schedule-drift.test.ts asserts every registry
 * source is either scheduled below or listed here — both directions.
 */
export const DISABLED_SOURCES: readonly JobSource[] = [
    'adzuna',              // job aggregator (scraped, not employer-controlled)
    'fantastic-jobs-db',   // RapidAPI aggregator (paid 20k/mo quota)
    'usajobs',             // federal job board
    'doccafe',             // healthcare niche board, not employer-controlled
    'healthcareercenter',  // healthcare niche board, not employer-controlled
];

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
 * Wave A — morning ingestion wave (10:10–12:00 UTC), ATS sources only.
 * Minute/hour offsets mirror the donor NP board's Inngest schedule
 * (its lib/inngest/functions/scheduled-crons.ts) as the reference
 * cadence: twice-daily waves, 5-minute staggers, chunked
 * greenhouse/workday. This board stays on the vercel.json mechanism.
 */
const WAVE_A_INGESTION: readonly CronEntry[] = [
    ...chunkedIngest('greenhouse', GREENHOUSE_TOTAL_CHUNKS, 10, '10'),
    ingest('lever', 50, '10'),
    ...chunkedIngest('workday', WORKDAY_TOTAL_CHUNKS, 5, '11'),
    ingest('smartrecruiters', 35, '11'),
    ingest('ashby', 40, '11'),
    ingest('bamboohr', 50, '11'),
    ingest('jazzhr', 55, '11'),
    ingest('workable', 0, '12'),
];

/**
 * Wave A summary — 12:50 covers 10:10 → 12:50 (see WINDOW_MINUTES,
 * note 2). The donor also fired a 17:55 summary left over from a
 * 16:00 repeat wave neither board schedules — dropped here as dead
 * weight (a summary with no ingest runs in its window no-ops).
 */
const WAVE_A_SUMMARIES: readonly CronEntry[] = [
    { path: '/api/cron/ingest-wave-summary', schedule: '50 12 * * *' },
];

/**
 * Wave B — nightly wave (23:10–00:55 UTC). Mirrors Wave A across the
 * midnight boundary. The tail offsets (45/48/52) are hand-compressed to
 * finish before the 00:55 summary — irregular by design (donor
 * cadence), kept literal.
 */
const WAVE_B_INGESTION: readonly CronEntry[] = [
    ...chunkedIngest('greenhouse', GREENHOUSE_TOTAL_CHUNKS, 10, '23'),
    ingest('lever', 50, '23'),
    ...chunkedIngest('workday', WORKDAY_TOTAL_CHUNKS, 5, '0'),
    ingest('smartrecruiters', 35, '0'),
    ingest('ashby', 40, '0'),
    ingest('bamboohr', 45, '0'),
    ingest('jazzhr', 48, '0'),
    ingest('workable', 52, '0'),
    { path: '/api/cron/ingest-wave-summary', schedule: '55 0 * * *' },
];

// ─── Housekeeping batches (B106 cron-limit consolidation) ────────────
//
// Vercel Pro caps a project at 40 cron entries; the previous schedule had
// 58. The 21 low-frequency housekeeping crons below are consolidated into
// 3 sequential batch dispatchers served by app/api/cron/batch/[group].
// The dispatcher invokes each target route over HTTP (with the CRON_SECRET
// bearer) ONE AT A TIME, so DB-load characteristics stay serialized —
// stricter than the old minute-staggering. Cadences are preserved exactly
// (daily stays daily, twice-daily stays twice-daily) via the batch
// schedule plus per-target gates; only the minute-of-day shifts.
//
// Targets keep their own routes, auth, maxDuration, and withCronTracking
// names, so CronRun history and the cron watchdog
// (lib/inngest/functions/cron-watchdog.ts) keep working per-cron.

/** A single route invoked by a batch dispatcher. */
export interface CronBatchTarget {
    readonly path: string;
    /** Run only when the dispatcher fires in one of these UTC hours. */
    readonly utcHours?: readonly number[];
    /** Run only on these UTC days of week (0=Sun … 6=Sat). */
    readonly utcDaysOfWeek?: readonly number[];
    /** Run only on these UTC days of month (1–31). */
    readonly utcDaysOfMonth?: readonly number[];
}

export interface CronBatch {
    /** URL segment: dispatched at /api/cron/batch/<group>. */
    readonly group: string;
    readonly schedule: string;
    /** Invoked strictly in order; a failing target does not stop the rest. */
    readonly targets: readonly CronBatchTarget[];
}

export const CRON_BATCHES: readonly CronBatch[] = [
    {
        // Daily morning maintenance (was 6 entries between 04:45 and 09:30).
        group: 'morning',
        schedule: '30 8 * * *',
        targets: [
            { path: '/api/cron/cleanup-rejected-jobs' },   // was 45 4
            { path: '/api/cron/engagement-anomaly' },      // was 0 5
            { path: '/api/cron/purge-soft-deleted' },      // was 30 8
            { path: '/api/cron/purge-inactive-users' },    // was 45 8
            { path: '/api/cron/dsar-overdue' },            // was 0 9
            { path: '/api/cron/gsc-health-check' },        // was 30 9
        ],
    },
    {
        // Twice-daily expiry/health sweep (was 5 entries at 12:xx/18:xx).
        // Order preserved from the old minute offsets: cleanup-expired must
        // flip expired jobs before deindex-expired submits removals.
        group: 'midday',
        schedule: '10 12,18 * * *',
        targets: [
            { path: '/api/cron/cleanup-expired' },         // was 10 12,18
            { path: '/api/cron/freshness-decay' },         // was 20 12,18
            { path: '/api/cron/check-dead-links' },        // was 30 12,18
            { path: '/api/cron/deindex-expired' },         // was 45 12,18
            // Daily (not twice-daily) — gate to the 12:00 invocation only.
            { path: '/api/cron/source-presence-unpublish', utcHours: [12] }, // was 55 12
        ],
    },
    {
        // Daily reporting/alerts/notifications (was 10 entries, 13:00–14:30).
        // Order preserved from the old clock order.
        group: 'daily',
        schedule: '0 13 * * *',
        targets: [
            { path: '/api/cron/daily-report' },            // was 0 13
            { path: '/api/cron/health-anomaly-check' },    // was 0 13
            // Wednesday + Saturday only — cadence preserved via gate.
            { path: '/api/cron/saved-job-reminder', utcDaysOfWeek: [3, 6] }, // was 0 13 * * 3,6
            { path: '/api/cron/index-urls' },              // was 15 13
            { path: '/api/cron/send-alerts' },             // was 30 13
            { path: '/api/cron/index-pseo' },              // was 45 13
            { path: '/api/cron/candidate-alerts' },        // was 45 13
            { path: '/api/cron/embedding-drift-check' },   // was 0 14
            // Monthly on the 1st — cadence preserved via gate.
            { path: '/api/cron/employer-report', utcDaysOfMonth: [1] },      // was 0 14 1 * *
            { path: '/api/cron/push-notifications' },      // was 30 14
        ],
    },
];

/**
 * Housekeeping crons — batch dispatcher entries plus the crons that keep
 * their own vercel.json entry (multi-hour cadences that no batch matches,
 * or hourly frequency).
 */
const HOUSEKEEPING: readonly CronEntry[] = [
    ...CRON_BATCHES.map((batch) => ({
        path: `/api/cron/batch/${batch.group}`,
        schedule: batch.schedule,
    })),
    { path: '/api/cron/enrich-jobs', schedule: '0 6,12,18,22 * * *' },
    { path: '/api/cron/aggregate-pseo', schedule: '15 0,6,12,18 * * *' },
    { path: '/api/cron/historical-deindex', schedule: '0 1,7,19 * * *' },
    { path: '/api/cron/expiry-warnings', schedule: '0 22 * * *' },
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
