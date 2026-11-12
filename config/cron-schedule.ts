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
 *    entry. Wave A spans 09:00 → 11:30 (150m); Wave B spans
 *    23:02 → 01:30 (148m) — both inside the window. If a wave
 *    stretches (more chunks, later offsets), re-check before
 *    regenerating.
 * 3. Vercel plan cron limits: 100 cron jobs per project on every plan,
 *    with no per-team cap, since 2026-01-20 (vercel.com/changelog/
 *    cron-jobs-now-support-100-per-project-on-every-plan; checked
 *    2026-11-12). The 40 this file used to cite was the old Pro per-team
 *    cap. This board schedules 64 entries: 56 ingestion-wave entries + 8
 *    housekeeping entries. The B106 consolidation (21 low-frequency
 *    housekeeping crons folded into 3 sequential batch dispatchers, see
 *    CRON_BATCHES below) stays: it serializes their database load.
 * 4. Chunked-presence coupling: every chunk of a chunked source must
 *    START inside one 2-hour bucket (RUN_BUCKET_MS in
 *    lib/health/chunked-presence.ts; buckets begin on even UTC hours), or
 *    the cross-chunk presence check never sees a complete cycle.
 *    chunkedIngest() throws at generation time if a wave breaks this.
 * 5. The twice-daily midday batch (12:10, 18:10) runs cleanup-expired and
 *    the health sweep; Wave A is finished well before the 12:10 run.
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
 * this board. The adapters remain in the engine for other boards — only
 * the scheduling is per-board.
 *
 * History: the board launched ATS-only (a strategy ported from the donor
 * NP board's 2026-05-23 decision: employer-authoritative feeds, fewer
 * duplicates, healthier apply links, no API quota). On 2026-11-12 the
 * owner added two sources to widen coverage:
 *   usajobs  the federal government's own postings (VA, IHS, BoP, DoD)
 *   adzuna   a job search engine; needs ADZUNA_APP_ID / ADZUNA_APP_KEY
 * Both return nothing, and log that, until their keys are set in Vercel.
 *
 * The 10 scheduled sources: greenhouse, lever, workday, smartrecruiters,
 * ashby, bamboohr, jazzhr, workable (employer ATS feeds, twice a day),
 * usajobs and adzuna (once a day).
 *
 * Changing this list changes what the site may say about where its
 * listings come from: BOARD_DESCRIPTION, EMAIL_DEFAULT_PREHEADER and
 * OG_HOMEPAGE_STATS in config/niche/copy.ts, the homepage hero, /about,
 * /contact and public/llms.txt. tests/regressions/indexing-site-copy.test.ts
 * ties the source count on the share card to this file.
 *
 * (jooble / jsearch / ats-jobs-db were also rejected by the donor but
 * are not present in this template's registry, so they are not listed.)
 *
 * tests/aggregators/cron-schedule-drift.test.ts asserts every registry
 * source is either scheduled below or listed here — both directions.
 */
export const DISABLED_SOURCES: readonly JobSource[] = [
    'fantastic-jobs-db',   // RapidAPI aggregator (paid 20k/mo quota)
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

/** Length of a chunked-presence bucket (RUN_BUCKET_MS in lib/health/chunked-presence.ts). */
const PRESENCE_BUCKET_HOURS = 2;

/**
 * Chunked ingest expansion: one entry per chunk index, staggered
 * CHUNK_STAGGER_MINUTES apart starting at `startHour:startMinute` UTC and
 * running on into the following hours. Changing an aggregator's
 * *_TOTAL_CHUNKS constant regenerates the right number of entries here.
 *
 * Throws when the chunks would not all start in one chunked-presence
 * bucket (fork note 4): the cross-chunk presence check would then never
 * see a complete cycle and would silently stop running.
 */
function chunkedIngest(
    source: JobSource,
    totalChunks: number,
    startHour: number,
    startMinute: number,
): CronEntry[] {
    const entries = Array.from({ length: totalChunks }, (_, chunk) => {
        const offset = startMinute + chunk * CHUNK_STAGGER_MINUTES;
        const hour = (startHour + Math.floor(offset / 60)) % 24;
        const minute = offset % 60;
        return {
            path: `${INGEST_PATH}?source=${source}&chunk=${chunk}`,
            schedule: `${minute} ${hour} * * *`,
            bucket: Math.floor((startHour * 60 + offset) / (PRESENCE_BUCKET_HOURS * 60)),
        };
    });
    if (new Set(entries.map((entry) => entry.bucket)).size > 1) {
        throw new Error(
            `chunkedIngest(${source}): ${totalChunks} chunks from ${startHour}:${String(startMinute).padStart(2, '0')} ` +
            `cross a ${PRESENCE_BUCKET_HOURS}-hour presence bucket boundary — start earlier in the bucket, ` +
            'shorten the stagger, or widen RUN_BUCKET_MS',
        );
    }
    return entries.map(({ path, schedule }) => ({ path, schedule }));
}

/**
 * Wave A — morning ingestion wave (09:00–11:20 UTC).
 *
 *   09:00, 09:05   usajobs, adzuna (once a day; each may use its full 240s)
 *   09:12–09:27    greenhouse, 4 chunks
 *   09:32–09:57    lever and the five small ATS sources
 *   10:02–11:17    workday, 16 chunks (one presence bucket, 10:00–12:00)
 *
 * Workday goes last and off the round minutes: it is the longest block,
 * and :02/:07/… keeps its chunks clear of the crons that fire at :00 and
 * :15 (refresh-site-stats, aggregate-pseo, historical-deindex).
 * Twice-daily waves and 5-minute staggers follow the donor NP board's
 * cadence. This board stays on the vercel.json mechanism.
 */
const WAVE_A_INGESTION: readonly CronEntry[] = [
    ingest('usajobs', 0, '9'),
    ingest('adzuna', 5, '9'),
    ...chunkedIngest('greenhouse', GREENHOUSE_TOTAL_CHUNKS, 9, 12),
    ingest('lever', 32, '9'),
    ingest('smartrecruiters', 37, '9'),
    ingest('ashby', 42, '9'),
    ingest('bamboohr', 47, '9'),
    ingest('jazzhr', 52, '9'),
    ingest('workable', 57, '9'),
    ...chunkedIngest('workday', WORKDAY_TOTAL_CHUNKS, 10, 2),
];

/**
 * Wave A summary — 11:30 covers 09:00 → 11:30 (see WINDOW_MINUTES,
 * note 2).
 */
const WAVE_A_SUMMARIES: readonly CronEntry[] = [
    { path: '/api/cron/ingest-wave-summary', schedule: '30 11 * * *' },
];

/**
 * Wave B — nightly wave (23:02–01:20 UTC). Mirrors Wave A across the
 * midnight boundary, without the once-a-day sources.
 *
 *   23:02–23:17    greenhouse, 4 chunks (presence bucket 22:00–24:00)
 *   23:22–23:47    lever and the five small ATS sources
 *   00:02–01:17    workday, 16 chunks (presence bucket 00:00–02:00)
 */
const WAVE_B_INGESTION: readonly CronEntry[] = [
    ...chunkedIngest('greenhouse', GREENHOUSE_TOTAL_CHUNKS, 23, 2),
    ingest('lever', 22, '23'),
    ingest('smartrecruiters', 27, '23'),
    ingest('ashby', 32, '23'),
    ingest('bamboohr', 37, '23'),
    ingest('jazzhr', 42, '23'),
    ingest('workable', 47, '23'),
    ...chunkedIngest('workday', WORKDAY_TOTAL_CHUNKS, 0, 2),
    { path: '/api/cron/ingest-wave-summary', schedule: '30 1 * * *' },
];

// ─── Housekeeping batches (B106 cron-limit consolidation) ────────────
//
// Written when the cron limit was believed to be 40 (it is 100, see fork
// note 3); the previous schedule had 58. The consolidation is kept for its
// serialized database load, not for the count.
// The 21 low-frequency housekeeping crons below are consolidated into
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
            // Read-only check (indexing audit GFJ-01, GFJ-04, CS-03): stub
            // descriptions, work-mode drift and jobs with no JobPosting
            // location; alerts on Discord. Runs before index-urls.
            { path: '/api/cron/job-posting-integrity' },
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
