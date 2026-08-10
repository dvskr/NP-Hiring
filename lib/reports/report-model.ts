/**
 * Pure aggregation model for the /reports data surfaces (P5 A7/A8).
 *
 * HONESTY GATES — the whole reason this module exists:
 *
 *   1. No percentage is ever published over a small denominator. A "62%
 *      remote share" computed from 13 postings is noise wearing a suit;
 *      `computeShare` returns null below REPORT_MIN_SHARE_SAMPLE and the
 *      page renders a "sample too small" note instead of a padded number.
 *   2. Distribution rows below REPORT_MIN_GROUP_COUNT fold into a single
 *      "everything else" remainder instead of rendering "1 posting in
 *      <state>" rows that read as market signal.
 *   3. Salary distributions are NOT re-modelled here. The report pages
 *      reuse `summarizeBenchmarks` from components/tools/benchmark-model.ts
 *      verbatim, so the published salary table carries the exact same
 *      min-postings / min-distinct-employers gates as the public benchmark
 *      widget. One gating regime, not two.
 *   4. The disclosure trend renders only from months with a real sample
 *      (TREND_MIN_MONTH_SAMPLE) and only when enough qualifying months
 *      exist to call it a trend at all (TREND_MIN_MONTHS). Otherwise the
 *      trend is null and the page says so.
 *
 * Pure functions over plain data — no database, no network — so the gates
 * are unit-testable (tests/regressions/p5-market-reports-model.test.ts).
 */

/** Minimum denominator before any percentage share is published. */
export const REPORT_MIN_SHARE_SAMPLE = 100;

/** Minimum postings before a named distribution row is shown on its own. */
export const REPORT_MIN_GROUP_COUNT = 5;

/** Minimum postings in a month before it participates in the trend. */
export const TREND_MIN_MONTH_SAMPLE = 50;

/** Minimum qualifying months before a trend is published at all. */
export const TREND_MIN_MONTHS = 3;

/** A published percentage share, with the sample that produced it. */
export interface ShareStat {
    numerator: number;
    denominator: number;
    /** Whole-number percentage, e.g. 34 for 34%. */
    pct: number;
}

/**
 * Percentage share gated on sample size. Returns null (render a "sample too
 * small" note, never a number) when the denominator is under the floor or
 * the inputs are incoherent.
 */
export function computeShare(numerator: number, denominator: number): ShareStat | null {
    if (denominator < REPORT_MIN_SHARE_SAMPLE) return null;
    if (numerator < 0 || numerator > denominator) return null;
    return {
        numerator,
        denominator,
        pct: Math.round((numerator / denominator) * 100),
    };
}

/** One row of a count distribution (a specialty, a state, a work mode). */
export interface CountGroup {
    key: string;
    label: string;
    count: number;
}

export interface CountGroupSummary {
    /** Rows meeting REPORT_MIN_GROUP_COUNT, sorted by count descending. */
    shown: CountGroup[];
    /** Combined postings across the folded (below-floor) rows. */
    otherCount: number;
    /** How many rows were folded into the remainder. */
    otherGroups: number;
    /** Total postings across all input rows. */
    total: number;
}

/**
 * Fold a raw count distribution into publishable rows plus an honest
 * remainder. Zero-count rows are dropped entirely (a category with no
 * postings is absence, not data); rows under `minGroup` fold into the
 * remainder rather than rendering as one-posting "signal".
 */
export function summarizeCountGroups(
    groups: readonly CountGroup[],
    minGroup: number = REPORT_MIN_GROUP_COUNT,
): CountGroupSummary {
    const nonZero = groups.filter((g) => g.count > 0);
    const shown = nonZero
        .filter((g) => g.count >= minGroup)
        .slice()
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    const folded = nonZero.filter((g) => g.count < minGroup);
    return {
        shown,
        otherCount: folded.reduce((sum, g) => sum + g.count, 0),
        otherGroups: folded.length,
        total: nonZero.reduce((sum, g) => sum + g.count, 0),
    };
}

/** One month of the disclosure cohort, as returned by the DB query. */
export interface MonthlyDisclosureRow {
    /** Calendar month, 'YYYY-MM'. */
    month: string;
    /** Postings added to the board in that month. */
    total: number;
    /** Of those, postings whose pay range came from the posting itself. */
    disclosed: number;
}

/** A publishable trend point: a qualifying month plus its disclosure rate. */
export interface DisclosureTrendPoint extends MonthlyDisclosureRow {
    /** Whole-number percentage of postings that disclosed pay. */
    pct: number;
}

/**
 * Gate the monthly disclosure cohort into a publishable trend, or null.
 *
 * Months under TREND_MIN_MONTH_SAMPLE are dropped (their rates are noise),
 * and if fewer than TREND_MIN_MONTHS qualifying months remain there is no
 * trend to publish — the page renders its "not enough history" note
 * instead. Rows with incoherent counts are treated as disqualifying the
 * whole series: a cohort that can produce disclosed > total is a query bug,
 * and publishing around it would hide the bug behind a plausible chart.
 */
export function summarizeDisclosureTrend(
    rows: readonly MonthlyDisclosureRow[],
): DisclosureTrendPoint[] | null {
    for (const row of rows) {
        if (row.disclosed < 0 || row.total < 0 || row.disclosed > row.total) return null;
    }
    const qualifying = rows
        .filter((row) => row.total >= TREND_MIN_MONTH_SAMPLE)
        .slice()
        .sort((a, b) => a.month.localeCompare(b.month))
        .map((row) => ({ ...row, pct: Math.round((row.disclosed / row.total) * 100) }));
    return qualifying.length >= TREND_MIN_MONTHS ? qualifying : null;
}
