/**
 * lib/salary-report/stats.ts: the salary statistics engine, the single
 * source of truth for every dollar figure the site publishes about
 * advertised pay (salary guide hub and state pages, specialty pages, the
 * reports, the tools and the connector). Ported from the sister board's engine
 * of the same name on 2026-11-25 so both boards publish under one rule set.
 *
 * House rules, enforced here so no surface can drift:
 *   - Medians and percentiles only, never means (means are dragged by
 *     annualization defects and by one employer posting many roles).
 *   - Only rows with BOTH normalized bounds and salaryIsEstimated=false. A
 *     single figure ("$130,000/yr") has no range and does not count.
 *   - Fixed sanity bounds: midpoints outside $50k to $500k a year are
 *     quarantined, and so is a range whose max is more than 3 times its min
 *     (a parsing or annualization defect).
 *   - Each employer counts once per figure, at the median of the distinct
 *     ranges it advertises in the rows being summarized. Large employers
 *     post one role per city or per state; counted per posting, one
 *     employer's range became most of a state's sample. An employer's
 *     posting volume says how much it is hiring, not what the market pays.
 *   - Tiered gating by the number of employers, so a small sample degrades
 *     honestly:
 *       n >= 10  full stats (p25, median, p75)
 *       5 to 9   median only
 *       3 to 4   count only, NO dollar figures
 *       < 3      nothing
 *   - Every figure travels with its n, the number of employers behind it.
 *     Framing is always "advertised pay" or "posted pay", never what nurse
 *     practitioners "earn" and never an "average".
 *
 * Pure: no Prisma and no server imports, so a client component can use it.
 * The caller passes the employer identity it wants grouped
 * (lib/salary-analytics.ts passes the alias-merged key, so "LifeStance" and
 * "LifeStance Health" are one employer); a missing or placeholder name
 * counts as an employer of its own.
 */
import { employerKey } from '@/lib/jobs/employer-key';

export const SALARY_SANITY_MIN = 50_000;
export const SALARY_SANITY_MAX = 500_000;
export const MAX_RANGE_RATIO = 3;

export const TIER_FULL_MIN_N = 10;
export const TIER_MEDIAN_MIN_N = 5;
export const TIER_COUNT_MIN_N = 3;

export interface SalaryRow {
    normalizedMinSalary: number | null;
    normalizedMaxSalary: number | null;
    salaryIsEstimated?: boolean | null;
    /**
     * Who advertises the range. Required, so a caller cannot leave it out of
     * its query and count an employer once for every posting again. A posting
     * that names no employer counts as an employer of its own.
     */
    employer: string | null;
}

/** The sentence that states the counting rule, for every methodology note. */
export const ONE_EMPLOYER_NOTE = 'Each employer counts once, at the middle of the pay ranges it advertises, however many postings it has.';

/** The publishing rule in one sentence, for captions and notes. */
export const TIER_RULE_NOTE = `A median is published once at least ${TIER_MEDIAN_MIN_N} employers disclose pay, and the 25th to 75th percentile range once at least ${TIER_FULL_MIN_N} do.`;

export interface CleanResult {
    /**
     * Ascending advertised pay ($/yr), one value per employer: the median of
     * the midpoints of the distinct ranges that employer advertises in these
     * rows, after every gate.
     */
    midpoints: number[];
    /** Postings that survived every gate. For sentences that count postings; never a sample size. */
    postings: number;
    /** Rows dropped by the sanity, ratio or estimated gates (not missing-data rows). */
    quarantined: number;
}

export type SalaryTier = 'full' | 'median' | 'countOnly' | 'none';

export type SalaryTierSummary =
    | { tier: 'full'; n: number; p25: number; median: number; p75: number }
    | { tier: 'median'; n: number; median: number }
    | { tier: 'countOnly'; n: number }
    | { tier: 'none'; n: number };

/** Filter raw rows down to trustworthy advertised pay, ascending, one value per employer. */
export function cleanSalaryRows(rows: readonly SalaryRow[]): CleanResult {
    /** Each named employer's distinct clean ranges: "min|max" to midpoint. */
    const rangesByEmployer = new Map<string, Map<string, number>>();
    const midpoints: number[] = [];
    let postings = 0;
    let quarantined = 0;

    for (const row of rows) {
        const min = row.normalizedMinSalary;
        const max = row.normalizedMaxSalary;
        if (min == null || max == null) continue; // missing data, not quarantine
        if (row.salaryIsEstimated) { quarantined++; continue; }
        if (min <= 0 || max < min) { quarantined++; continue; }
        if (max / min > MAX_RANGE_RATIO) { quarantined++; continue; }
        const mid = (min + max) / 2;
        if (mid < SALARY_SANITY_MIN || mid > SALARY_SANITY_MAX) { quarantined++; continue; }
        postings++;
        const employer = employerKey(row.employer);
        if (employer === '') {
            // No name to group by: the posting stands for an employer of its own.
            midpoints.push(mid);
            continue;
        }
        const ranges = rangesByEmployer.get(employer) ?? new Map<string, number>();
        ranges.set(`${min}|${max}`, mid);
        rangesByEmployer.set(employer, ranges);
    }

    for (const ranges of rangesByEmployer.values()) {
        midpoints.push(percentile([...ranges.values()].sort((a, b) => a - b), 50));
    }
    return { midpoints: midpoints.sort((a, b) => a - b), postings, quarantined };
}

/**
 * Linear-interpolated percentile of an ASCENDING-sorted array.
 * p in [0, 100]. Returns NaN on empty input (callers gate on n first).
 */
export function percentile(sortedAsc: readonly number[], p: number): number {
    if (sortedAsc.length === 0) return NaN;
    if (sortedAsc.length === 1) return sortedAsc[0];
    const clamped = Math.min(100, Math.max(0, p));
    const rank = (clamped / 100) * (sortedAsc.length - 1);
    const lo = Math.floor(rank);
    const hi = Math.ceil(rank);
    if (lo === hi) return sortedAsc[lo];
    return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (rank - lo);
}

/** Collapse a cleaned midpoint set into the largest tier its n supports. */
export function summarizeMidpoints(sortedAsc: readonly number[]): SalaryTierSummary {
    const n = sortedAsc.length;
    if (n >= TIER_FULL_MIN_N) {
        return { tier: 'full', n, p25: percentile(sortedAsc, 25), median: percentile(sortedAsc, 50), p75: percentile(sortedAsc, 75) };
    }
    if (n >= TIER_MEDIAN_MIN_N) return { tier: 'median', n, median: percentile(sortedAsc, 50) };
    if (n >= TIER_COUNT_MIN_N) return { tier: 'countOnly', n };
    return { tier: 'none', n };
}

/** Round a dollar figure for display: the nearest $500 keeps small-n medians honest. */
export function roundDisplayDollars(v: number): number {
    return Math.round(v / 500) * 500;
}

/**
 * A dollar figure in whole thousands for "$153K"-style display: the $500
 * display value, then thousands, so a title and a hero printing the same
 * median can never round it two ways.
 */
export function displayThousands(v: number): number {
    return Math.round(roundDisplayDollars(v) / 1000);
}

/**
 * Raw rows in, tier-gated median in THOUSANDS out, or 0 when the sample is
 * too thin to say anything. Callers branch on `> 0` to decide whether to
 * mention pay at all.
 */
export function medianAdvertisedK(rows: readonly SalaryRow[]): number {
    return medianKFromMidpoints(cleanSalaryRows(rows).midpoints);
}

/**
 * medianAdvertisedK with its sample size: { medianK, n } where n is the
 * number of employers behind the figure, or { medianK: 0, n: 0 } below the
 * median tier.
 */
export function medianAdvertisedSummaryK(rows: readonly SalaryRow[]): { medianK: number; n: number } {
    const summary = summarizeMidpoints(cleanSalaryRows(rows).midpoints);
    if (summary.tier !== 'full' && summary.tier !== 'median') return { medianK: 0, n: 0 };
    return { medianK: displayThousands(summary.median), n: summary.n };
}

/** The same figure from a midpoint set that is already cleaned and ascending. */
export function medianKFromMidpoints(sortedAsc: readonly number[]): number {
    const summary = summarizeMidpoints(sortedAsc);
    if (summary.tier !== 'full' && summary.tier !== 'median') return 0;
    return displayThousands(summary.median);
}

/**
 * The day a live median describes, for an "as of" line: today in UTC, as
 * "Nov 25, 2026". Format on the server and pass the string down, so a client
 * component cannot hydrate a different day.
 */
export function salaryAsOfLabel(now: Date = new Date()): string {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(now);
}
