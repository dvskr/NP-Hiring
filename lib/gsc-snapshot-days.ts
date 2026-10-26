/**
 * The Search Analytics totals a gsc_snapshots row stored for its two days
 * (raw.searchAnalytics.today and .weekAgo, written by
 * app/api/cron/gsc-health-check).
 *
 * The cron stores null for a day Search Console returned no row for, usually
 * "today" (yesterday), which Search Console has not processed when the cron
 * runs. That is not a day of zero traffic, so a reader shows it as not read
 * and computes no change from it (register 2.30,
 * tests/lib/gsc-snapshot-days.test.ts).
 */

export interface SnapshotDay {
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A stored figure, or 0 when it is missing or not a number. */
function figure(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** The totals the snapshot stored for that day, or null when Search Console returned none. */
export function snapshotDay(raw: unknown, which: 'today' | 'weekAgo'): SnapshotDay | null {
    if (!isRecord(raw) || !isRecord(raw.searchAnalytics)) return null;
    const day = raw.searchAnalytics[which];
    if (!isRecord(day)) return null;
    return {
        clicks: figure(day.clicks),
        impressions: figure(day.impressions),
        ctr: figure(day.ctr),
        position: figure(day.position),
    };
}
