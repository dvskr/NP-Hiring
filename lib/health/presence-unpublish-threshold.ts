/**
 * lib/health/presence-unpublish-threshold.ts
 *
 * The one reading of JOB_HEALTH_MIN_PRESENCE_MISSES: the number of ingest runs
 * in a row a source must stop listing a job before
 * app/api/cron/source-presence-unpublish takes it down. The deindex-expired
 * cron (app/api/cron/deindex-expired/cursor.ts) counts the same rows as
 * removals to send, so both read the threshold here and can never disagree.
 * A higher value in the cursor would leave rows the cron unpublished unsent;
 * a lower one would send rows another path unpublished below the cron's
 * threshold.
 */

/** The miss count used when JOB_HEALTH_MIN_PRESENCE_MISSES is unset or invalid. */
export const DEFAULT_PRESENCE_UNPUBLISH_MIN_MISSES = 3;

/**
 * The miss count at which a job is taken down: unset or empty gives the
 * default, and so does anything parseInt cannot read or that is below 1.
 */
export function presenceUnpublishMinMisses(
    raw: string | undefined = process.env.JOB_HEALTH_MIN_PRESENCE_MISSES,
): number {
    if (!raw) return DEFAULT_PRESENCE_UNPUBLISH_MIN_MISSES;
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_PRESENCE_UNPUBLISH_MIN_MISSES;
    return parsed;
}
