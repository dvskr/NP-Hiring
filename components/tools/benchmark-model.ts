/**
 * Public salary-benchmark aggregation (P2 #17), on the one salary engine
 * (lib/salary-report/stats.ts, the sister board's rules since 2026-11-25).
 *
 * PUBLIC-SAFETY RULES: these aggregates reach unauthenticated pages, so they
 * may only ever publish figures that cannot be resolved back to one
 * employer's pay:
 *   1. Each employer counts once, at the median of the distinct ranges it
 *      advertises in the scope, however many postings it has. A figure's n
 *      is its number of employers, so no employer can be more than 1 in n
 *      of a published median (20% at the smallest published n of 5). This
 *      replaced the 40% employer-share cap, which a per-posting count needed.
 *   2. Tiers by employers: a median at BENCHMARK_MIN_EMPLOYERS (5) or more,
 *      the 25th and 75th percentiles at BENCHMARK_FULL_MIN_EMPLOYERS (10) or
 *      more, nothing below 5. Below the median tier there is no row.
 *   3. Nothing employer-identifying leaves this module. Employer names (or
 *      the keys the server passes as `employer`) are used to group and are
 *      then discarded.
 *   4. Estimated pay, a single figure with no range, a midpoint outside
 *      $50k to $500k and a range wider than 3 to 1 never count (the engine's
 *      quarantine). Callers still filter estimated rows in their query.
 *
 * Pure: no Prisma, safe in a client bundle.
 */

import { parsePlainAmount } from './parse-amount';
import {
    cleanSalaryRows,
    roundDisplayDollars,
    summarizeMidpoints,
    TIER_FULL_MIN_N,
    TIER_MEDIAN_MIN_N,
    type SalaryTierSummary,
} from '@/lib/salary-report/stats';

/** Employers that must disclose pay before a scope publishes a median. */
export const BENCHMARK_MIN_EMPLOYERS = TIER_MEDIAN_MIN_N;

/** Employers that must disclose pay before a scope publishes its 25th to 75th percentile range. */
export const BENCHMARK_FULL_MIN_EMPLOYERS = TIER_FULL_MIN_N;

export interface BenchmarkInputRow {
    state: string | null;
    /** The employer identity to group by (lib/salary-analytics.ts passes the alias-merged key). */
    employer: string | null;
    normalizedMinSalary: number | null;
    normalizedMaxSalary: number | null;
    salaryIsEstimated?: boolean | null;
}

export interface BenchmarkRow {
    /** Full state name, 'National' for the pooled row, or a caller's label. */
    scope: string;
    /** 'full' carries quartiles; 'median' carries the median alone. */
    tier: 'full' | 'median';
    /** Whole dollars on the $500 display grid. */
    median: number;
    /** Null below the full tier (fewer than BENCHMARK_FULL_MIN_EMPLOYERS employers). */
    p25: number | null;
    p75: number | null;
    /** Postings behind the figure, for context only; never the sample size. */
    postings: number;
    /** The sample size: employers behind the figure, each counted once. */
    employers: number;
}

export interface BenchmarkSummary {
    national: BenchmarkRow | null;
    states: BenchmarkRow[];
}

/** One scope's summary at every tier, for pages that state why a figure is missing. */
export interface ScopeSummary {
    /** The publishable row, or null below the median tier. */
    row: BenchmarkRow | null;
    /** The tier summary, including n employers below the median tier. */
    summary: SalaryTierSummary;
    /** Postings that survived the engine's gates. */
    postings: number;
}

/** Summarize one scope's rows (treated as one pool, whatever their state). */
export function summarizeScope(scope: string, rows: readonly BenchmarkInputRow[]): ScopeSummary {
    const { midpoints, postings } = cleanSalaryRows(rows);
    const summary = summarizeMidpoints(midpoints);
    if (summary.tier === 'full') {
        return {
            summary,
            postings,
            row: {
                scope,
                tier: 'full',
                median: roundDisplayDollars(summary.median),
                p25: roundDisplayDollars(summary.p25),
                p75: roundDisplayDollars(summary.p75),
                postings,
                employers: summary.n,
            },
        };
    }
    if (summary.tier === 'median') {
        return {
            summary,
            postings,
            row: { scope, tier: 'median', median: roundDisplayDollars(summary.median), p25: null, p75: null, postings, employers: summary.n },
        };
    }
    return { summary, postings, row: null };
}

/** The publishable row for one pool, every row counted (stateless ones included). */
export function summarizePool(rows: readonly BenchmarkInputRow[], scope = 'National'): BenchmarkRow | null {
    return summarizeScope(scope, rows).row;
}

/**
 * Collapse raw posting rows into publishable state and national benchmarks.
 * Rows without a state are left out of both (the national row here pools
 * the state rows); summarizeBenchmarkPool counts them nationally.
 */
export function summarizeBenchmarks(rows: readonly BenchmarkInputRow[]): BenchmarkSummary {
    const byState = new Map<string, BenchmarkInputRow[]>();
    const stated: BenchmarkInputRow[] = [];
    for (const row of rows) {
        if (!row.state) continue;
        stated.push(row);
        const bucket = byState.get(row.state);
        if (bucket) bucket.push(row);
        else byState.set(row.state, [row]);
    }
    const states = [...byState.entries()]
        .map(([state, bucket]) => summarizeScope(state, bucket).row)
        .filter((row): row is BenchmarkRow => row !== null)
        .sort((a, b) => a.scope.localeCompare(b.scope));
    return { national: summarizePool(stated), states };
}

/**
 * State rows exactly as summarizeBenchmarks gates them, and a national row
 * over EVERY pool row, stateless ones included, as /salary-guide/<state>
 * computes its national base.
 */
export function summarizeBenchmarkPool(rows: readonly BenchmarkInputRow[]): BenchmarkSummary {
    return { national: summarizePool(rows), states: summarizeBenchmarks(rows).states };
}

/**
 * Parse the planned-offer field. Only a plain positive amount counts: a
 * negative, zero, blank, or malformed entry is not an offer, so it returns
 * null and the widget shows no standing. Stripping every non-digit (the
 * previous parser) turned "-120000" into 120000 and graded it.
 */
export function parseOfferInput(raw: string): number | null {
    const value = parsePlainAmount(raw);
    return value !== null && value > 0 ? value : null;
}

/** Where a proposed offer sits against a benchmark row. */
export type OfferStanding = 'below' | 'competitive' | 'above';

/**
 * The offer against the row's 25th to 75th percentile range, or null when
 * the row is at the median tier and publishes no range to compare with.
 */
export function classifyOffer(offer: number, row: BenchmarkRow): OfferStanding | null {
    if (row.p25 === null || row.p75 === null) return null;
    if (offer < row.p25) return 'below';
    if (offer > row.p75) return 'above';
    return 'competitive';
}
