/**
 * lib/gsc-movers.ts — pure week-over-week "top movers" math (P1 gsc-ops).
 *
 * The gsc-health-check cron stores two 7-day dimension windows per snapshot
 * (current: yesterday-6…yesterday; previous: the 7 days before) under
 * GscSnapshot.raw.dimensions. This module joins those windows and ranks
 * queries/pages by click delta so the admin dashboard can show what's
 * rising and falling on the 165K-URL surface.
 *
 * TRUNCATION IS THE HARD PART: both windows are GSC's top-N-by-clicks (the
 * cron asks for GSC_DIMENSION_ROW_LIMIT rows), so a key can vanish from one
 * window purely by crossing the row cut. Treating that as "0 clicks" would
 * manufacture phantom gainers ("0 → 50") and phantom total-loss losers
 * ("40 → 0") — and since both tables rank by click delta, the biggest
 * fabrications would sort straight to the top rows. Instead every absence is
 * resolved against what its window actually proves, and anything the data
 * can't settle is reported as unknown rather than guessed.
 *
 * Everything here is pure (no prisma, no fetch) — the admin page passes in
 * the raw JSON blob and renders the result.
 */
import type { GscDimensionRow } from '@/lib/gsc-client';

export interface MoverRow {
    key: string;
    /** Clicks in the current window; null when the key was unranked there. */
    clicks: number | null;
    /** Clicks in the previous window; null when the key was unranked there. */
    prevClicks: number | null;
    /**
     * Click movement. Exact when both sides are known; when one side is
     * unranked inside a click-truncated window this is a GUARANTEED MINIMUM
     * magnitude — the true move is at least this big, never smaller.
     */
    clicksDelta: number;
    /** True when clicksDelta is a bound rather than an exact figure. */
    estimated: boolean;
    impressions: number | null;
    prevImpressions: number | null;
    /**
     * Impression movement, or null when unknowable. GSC cuts each window by
     * CLICKS, so an unranked key's impressions are not bounded by anything we
     * fetched — there is no honest number to show.
     */
    impressionsDelta: number | null;
}

export interface Movers {
    gainers: MoverRow[];
    losers: MoverRow[];
    /**
     * Lowest click count GSC returned in each window — the truncation floor.
     * 0 means the window reached the zero-click tail and is therefore
     * complete for ranking purposes; > 0 means it was cut while rows still
     * had clicks, so absence from it proves nothing.
     */
    currentFloor: number;
    previousFloor: number;
    /**
     * Rows dropped because truncation makes their direction unknowable (e.g.
     * a key with 5 clicks now, unranked in a window that cut off at 8 — it
     * could have risen or fallen). Surfaced so the UI can disclose the gap
     * instead of silently hiding it.
     */
    indeterminate: number;
}

/**
 * What one window proves about a key that does NOT appear in it.
 *
 * GSC orders dimension rows by clicks desc and cuts at rowLimit, so an absent
 * key has AT MOST `floor` clicks — never more. Three cases follow:
 *
 *   empty window  → GSC returned nothing for the range, so nothing had clicks
 *                   OR impressions. Absence proves both are zero.
 *   floor === 0   → the window reached the zero-click tail, so absence proves
 *                   zero CLICKS. Impressions stay unknown: a zero-click key
 *                   can still have impressions and may sit past the cut.
 *   floor > 0     → the window was truncated while rows still had clicks.
 *                   Absence only bounds clicks at ≤ floor.
 */
interface WindowFacts {
    floor: number;
    empty: boolean;
}

function windowFacts(rows: readonly GscDimensionRow[]): WindowFacts {
    if (rows.length === 0) return { floor: 0, empty: true };
    // Min over all rows rather than last-row — stored JSON ordering is not
    // something this module gets to assume.
    let floor = rows[0].clicks;
    for (const row of rows) {
        if (row.clicks < floor) floor = row.clicks;
    }
    return { floor, empty: false };
}

/** A key present in the current window but absent from the previous one. */
function resolveNewcomer(row: GscDimensionRow, prev: WindowFacts): MoverRow | null {
    if (prev.empty) {
        return {
            key: row.key,
            clicks: row.clicks,
            prevClicks: 0,
            clicksDelta: row.clicks,
            estimated: false,
            impressions: row.impressions,
            prevImpressions: 0,
            impressionsDelta: row.impressions,
        };
    }
    if (prev.floor === 0) {
        // Zero clicks is proven; impressions are not.
        return {
            key: row.key,
            clicks: row.clicks,
            prevClicks: 0,
            clicksDelta: row.clicks,
            estimated: false,
            impressions: row.impressions,
            prevImpressions: null,
            impressionsDelta: null,
        };
    }
    // Truncated window: it had at most `floor` clicks, so the gain is at
    // least clicks - floor. If that bound doesn't clear zero we cannot claim
    // any direction at all.
    const guaranteed = row.clicks - prev.floor;
    if (guaranteed <= 0) return null;
    return {
        key: row.key,
        clicks: row.clicks,
        prevClicks: null,
        clicksDelta: guaranteed,
        estimated: true,
        impressions: row.impressions,
        prevImpressions: null,
        impressionsDelta: null,
    };
}

/** A key present in the previous window but absent from the current one. */
function resolveDropout(prev: GscDimensionRow, current: WindowFacts): MoverRow | null {
    if (current.empty) {
        return {
            key: prev.key,
            clicks: 0,
            prevClicks: prev.clicks,
            clicksDelta: -prev.clicks,
            estimated: false,
            impressions: 0,
            prevImpressions: prev.impressions,
            impressionsDelta: -prev.impressions,
        };
    }
    if (current.floor === 0) {
        return {
            key: prev.key,
            clicks: 0,
            prevClicks: prev.clicks,
            clicksDelta: -prev.clicks,
            estimated: false,
            impressions: null,
            prevImpressions: prev.impressions,
            impressionsDelta: null,
        };
    }
    const guaranteed = current.floor - prev.clicks;
    if (guaranteed >= 0) return null;
    return {
        key: prev.key,
        clicks: null,
        prevClicks: prev.clicks,
        clicksDelta: guaranteed,
        estimated: true,
        impressions: null,
        prevImpressions: prev.impressions,
        impressionsDelta: null,
    };
}

export interface DimensionWindows {
    current: GscDimensionRow[];
    previous: GscDimensionRow[];
}

export interface SnapshotDimensions {
    /** ISO dates of the current 7-day window. */
    window?: { startDate?: string; endDate?: string };
    /** ISO dates of the previous 7-day window. */
    prevWindow?: { startDate?: string; endDate?: string };
    queries?: DimensionWindows;
    pages?: DimensionWindows;
}

/**
 * Join current vs previous dimension rows on key and rank by click delta.
 *
 * Both windows are GSC's top-N-by-clicks, so a key missing from one of them
 * is NOT proof of zero traffic — it may simply have fallen past the cut. This
 * function never invents the missing side: it reports what each window
 * actually proves (see WindowFacts), emits bounds instead of figures when a
 * window was truncated, and drops rows whose direction truncation makes
 * unknowable. That keeps fabricated "0 → 50" gainers and "40 → 0" total-loss
 * alarms out of the tables they would otherwise sort straight to the top of.
 */
export function computeMovers(
    current: readonly GscDimensionRow[],
    previous: readonly GscDimensionRow[],
    limit: number = 10,
): Movers {
    const currentFacts = windowFacts(current);
    const previousFacts = windowFacts(previous);
    const prevByKey = new Map(previous.map((r) => [r.key, r]));
    const currentKeys = new Set(current.map((r) => r.key));

    const joined: MoverRow[] = [];
    let indeterminate = 0;

    for (const row of current) {
        const prev = prevByKey.get(row.key);
        if (prev) {
            joined.push({
                key: row.key,
                clicks: row.clicks,
                prevClicks: prev.clicks,
                clicksDelta: row.clicks - prev.clicks,
                estimated: false,
                impressions: row.impressions,
                prevImpressions: prev.impressions,
                impressionsDelta: row.impressions - prev.impressions,
            });
            continue;
        }
        const resolved = resolveNewcomer(row, previousFacts);
        if (resolved) joined.push(resolved);
        else indeterminate++;
    }

    // Rows that left the current window: in previous, not in current.
    for (const prev of previous) {
        if (currentKeys.has(prev.key)) continue;
        const resolved = resolveDropout(prev, currentFacts);
        if (resolved) joined.push(resolved);
        else indeterminate++;
    }

    // Facts outrank bounds on ties so a proven mover never sits below an
    // estimated one. Written as two comparators rather than one reversed
    // comparator so the tiebreakers keep pointing the same way in both
    // tables.
    const tieBreak = (a: MoverRow, b: MoverRow) =>
        Number(a.estimated) - Number(b.estimated) || a.key.localeCompare(b.key);

    /** Biggest gain first. */
    const byGain = (a: MoverRow, b: MoverRow) =>
        b.clicksDelta - a.clicksDelta ||
        (b.impressionsDelta ?? 0) - (a.impressionsDelta ?? 0) ||
        tieBreak(a, b);

    /** Biggest loss first. */
    const byLoss = (a: MoverRow, b: MoverRow) =>
        a.clicksDelta - b.clicksDelta ||
        (a.impressionsDelta ?? 0) - (b.impressionsDelta ?? 0) ||
        tieBreak(a, b);

    const gainers = joined
        .filter((r) => r.clicksDelta > 0 || (r.clicksDelta === 0 && (r.impressionsDelta ?? 0) > 0))
        .sort(byGain)
        .slice(0, limit);

    const losers = joined
        .filter((r) => r.clicksDelta < 0 || (r.clicksDelta === 0 && (r.impressionsDelta ?? 0) < 0))
        .sort(byLoss)
        .slice(0, limit);

    return {
        gainers,
        losers,
        currentFloor: currentFacts.floor,
        previousFloor: previousFacts.floor,
        indeterminate,
    };
}

function coerceDimensionRow(value: unknown): GscDimensionRow | null {
    if (!value || typeof value !== 'object') return null;
    const row = value as Partial<GscDimensionRow>;
    if (typeof row.key !== 'string' || row.key.length === 0) return null;
    return {
        key: row.key,
        clicks: typeof row.clicks === 'number' ? row.clicks : 0,
        impressions: typeof row.impressions === 'number' ? row.impressions : 0,
        ctr: typeof row.ctr === 'number' ? row.ctr : 0,
        position: typeof row.position === 'number' ? row.position : 0,
    };
}

function coerceWindows(value: unknown): DimensionWindows | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const windows = value as { current?: unknown; previous?: unknown };
    const current = Array.isArray(windows.current)
        ? windows.current.map(coerceDimensionRow).filter((r): r is GscDimensionRow => r !== null)
        : [];
    const previous = Array.isArray(windows.previous)
        ? windows.previous.map(coerceDimensionRow).filter((r): r is GscDimensionRow => r !== null)
        : [];
    if (current.length === 0 && previous.length === 0) return undefined;
    return { current, previous };
}

/**
 * Safely extract the dimension payload from a GscSnapshot.raw blob.
 * Returns null when the snapshot predates dimension capture or the JSON
 * doesn't match the expected shape (never trust stored JSON blindly).
 */
export function extractSnapshotDimensions(raw: unknown): SnapshotDimensions | null {
    if (!raw || typeof raw !== 'object') return null;
    const dimensions = (raw as { dimensions?: unknown }).dimensions;
    if (!dimensions || typeof dimensions !== 'object') return null;

    const dims = dimensions as {
        window?: unknown;
        prevWindow?: unknown;
        queries?: unknown;
        pages?: unknown;
    };
    const queries = coerceWindows(dims.queries);
    const pages = coerceWindows(dims.pages);
    if (!queries && !pages) return null;

    const coerceRange = (value: unknown): { startDate?: string; endDate?: string } | undefined => {
        if (!value || typeof value !== 'object') return undefined;
        const range = value as { startDate?: unknown; endDate?: unknown };
        return {
            startDate: typeof range.startDate === 'string' ? range.startDate : undefined,
            endDate: typeof range.endDate === 'string' ? range.endDate : undefined,
        };
    };

    return {
        window: coerceRange(dims.window),
        prevWindow: coerceRange(dims.prevWindow),
        queries,
        pages,
    };
}
