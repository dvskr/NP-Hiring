/**
 * Joining a scheduled cron path to its cron_runs history, and reading a run.
 *
 * withCronTracking is called with a bare name ('ingest', 'index-pseo') while
 * the schedule holds a path with an optional query string
 * ('/api/cron/ingest?source=adzuna&chunk=1'). On this board the name is the
 * path after /api/cron/ with the query removed. For most routes that is the
 * last segment, but not for the batch dispatcher: '/api/cron/batch/morning'
 * records its runs as 'batch/morning'. Getting the join subtly wrong shows
 * "no run recorded" next to a cron that runs every day, which is worse than
 * showing nothing.
 *
 * Pure functions only: the admin cron page (a client component) and the
 * /api/admin/cron-runs route both import this file.
 */

const CRON_PATH_PREFIX = '/api/cron/';
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** The newest cron_runs row for one tracked name, as the API returns it. */
export interface LatestCronRun {
    name: string;
    startedAt: string;
    finishedAt: string | null;
    durationMs: number | null;
    success: boolean;
    error: string | null;
}

/** A batch dispatcher entry and the routes it runs, in order. */
export interface CronBatchView {
    /** The scheduled path, e.g. '/api/cron/batch/morning'. */
    path: string;
    targets: Array<{ path: string; gate: string | null }>;
}

/** The cron_runs.name a scheduled cron path records under. */
export function cronNameFromPath(path: string): string {
    const withoutQuery = path.split('?')[0];
    if (withoutQuery.startsWith(CRON_PATH_PREFIX)) {
        return withoutQuery.slice(CRON_PATH_PREFIX.length).replace(/\/+$/, '');
    }
    const segments = withoutQuery.split('/').filter(Boolean);
    return segments[segments.length - 1] ?? '';
}

/**
 * A cron with no run for this long is flagged. The dashboard flags the blunt
 * case: nothing at all for over a week.
 */
export const STALE_RUN_MS = 7 * DAY_MS;

/**
 * How long a cron may go without a run before the page flags it: a week, or
 * twice the cron's own worst-case gap between runs when that is longer (the
 * cron watchdog's rule), so a monthly report is not flagged on its eighth day.
 */
export function staleThresholdMs(maxGapMs?: number | null): number {
    if (maxGapMs == null || !Number.isFinite(maxGapMs) || maxGapMs <= 0) return STALE_RUN_MS;
    return Math.max(STALE_RUN_MS, 2 * maxGapMs);
}

export function isRunStale(
    startedAtIso: string,
    now: number = Date.now(),
    thresholdMs: number = STALE_RUN_MS,
): boolean {
    const started = Date.parse(startedAtIso);
    if (Number.isNaN(started)) return false;
    return now - started > thresholdMs;
}

/** The words on the stale flag for a given threshold. */
export function staleLabel(thresholdMs: number): string {
    const days = Math.round(thresholdMs / DAY_MS);
    return days === 7 ? 'No run in over a week' : `No run in over ${days} days`;
}

/**
 * A run with no finish time this long after it started is not still running:
 * the function was stopped at its time limit or crashed before the tracker
 * could write the result. Longer than any cron route's maxDuration.
 */
export const RUN_FINISH_GRACE_MS = 15 * 60 * 1000;

export type RunOutcome = 'succeeded' | 'failed' | 'running' | 'unfinished';

export function runOutcome(
    run: Pick<LatestCronRun, 'startedAt' | 'finishedAt' | 'success'>,
    now: number = Date.now(),
): RunOutcome {
    if (run.finishedAt) return run.success ? 'succeeded' : 'failed';
    const started = Date.parse(run.startedAt);
    if (!Number.isNaN(started) && now - started <= RUN_FINISH_GRACE_MS) return 'running';
    return 'unfinished';
}

export const RUN_OUTCOME_LABEL: Readonly<Record<RunOutcome, string>> = {
    succeeded: 'Succeeded',
    failed: 'Failed',
    running: 'Started, still running',
    unfinished: 'Started, never finished',
};

/** The per-target gates a batch dispatcher applies (config/cron-schedule.ts). */
export interface BatchTargetGates {
    readonly utcHours?: readonly number[];
    readonly utcDaysOfWeek?: readonly number[];
    readonly utcDaysOfMonth?: readonly number[];
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function joinWords(words: readonly string[]): string {
    if (words.length <= 1) return words.join('');
    return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

function hourLabel(hour: number): string {
    return `${String(hour).padStart(2, '0')}:00`;
}

/**
 * When a batch target runs, beyond its batch's own schedule, in plain words.
 * Null when the target runs on every batch run.
 */
export function describeTargetGate(gates: BatchTargetGates): string | null {
    const parts: string[] = [];
    if (gates.utcHours?.length) {
        parts.push(`only on the ${joinWords(gates.utcHours.map(hourLabel))} UTC run`);
    }
    if (gates.utcDaysOfWeek?.length) {
        const names = gates.utcDaysOfWeek.map((d) => WEEKDAY_NAMES[d] ?? `day ${d}`);
        parts.push(`${joinWords(names)} only`);
    }
    if (gates.utcDaysOfMonth?.length) {
        parts.push(`day ${joinWords(gates.utcDaysOfMonth.map(String))} of the month only`);
    }
    return parts.length > 0 ? parts.join(', ') : null;
}
