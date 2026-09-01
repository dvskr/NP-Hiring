/**
 * lib/salary-analytics.ts — the ONE server-side pipeline for posting-derived
 * salary figures on public surfaces (review P9 #2c/#2d).
 *
 * Every public dollar figure computed from postings must be:
 *   pool   = npSalaryAnalyticsWhere (published, non-expired, non-estimated,
 *            confidence ≥ 0.8, annual-cadence, normalized salary present)
 *            scoped to NP-eligible titles (interim deterministic heuristic
 *            until the professionClass column lands), and
 *   figure = a TRUE MEDIAN under the benchmark widget's publishing gate
 *            (n ≥ BENCHMARK_MIN_POSTINGS from ≥ BENCHMARK_MIN_EMPLOYERS).
 *
 * Below the gate there is NO figure — callers omit the section or fall back
 * to a cited stat (STAT_SOURCES), never a posting mean. The old per-page
 * `prisma.job.aggregate({ _avg })` mean-of-min/max calls this module
 * replaces ran over every published row: psychiatrist/PA/podiatrist pay,
 * hourly locum rows annualized to $728k, and estimated rows all fed
 * published "averages".
 *
 * Server-only (imports prisma) — client components receive plain numbers.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
    npSalaryAnalyticsWhere,
    NP_SALARY_ANALYTICS_SELECT,
    filterNpEligibleRows,
    type NpSalaryAnalyticsRow,
} from '@/lib/salary-utils';
import {
    summarizeBenchmarks,
    type BenchmarkRow,
} from '@/components/tools/benchmark-model';

/**
 * Fetch the NP-eligible analytics rows for a sub-pool. `extra` is composed
 * via a top-level AND — both sides can carry their own AND/OR trees, so an
 * object spread would silently drop clauses.
 */
export async function fetchNpAnalyticsRows(
    extra: Prisma.JobWhereInput = {},
): Promise<NpSalaryAnalyticsRow[]> {
    const rows = await prisma.job.findMany({
        where: { AND: [npSalaryAnalyticsWhere(), extra] },
        select: NP_SALARY_ANALYTICS_SELECT,
    });
    return filterNpEligibleRows(rows);
}

/**
 * Gated benchmark for a sub-pool as a whole (e.g. one category tag).
 * Rows without a state still count. Returns null below the publishing gate.
 */
export async function getGatedBenchmark(
    extra: Prisma.JobWhereInput = {},
): Promise<BenchmarkRow | null> {
    const npRows = await fetchNpAnalyticsRows(extra);
    const { national } = summarizeBenchmarks(
        npRows.map((r) => ({ ...r, state: r.state ?? 'Unknown' })),
    );
    return national;
}

/**
 * Gated median for a sub-pool in whole $k (the category-page display unit),
 * or 0 below the publishing gate — callers already branch to their static
 * fallback copy on 0, exactly as they did when a pool had no salaries.
 */
export async function getGatedMedianKForWhere(
    extra: Prisma.JobWhereInput = {},
): Promise<number> {
    const row = await getGatedBenchmark(extra);
    return row ? Math.round(row.median / 1000) : 0;
}

/**
 * Gated per-state benchmark rows (median/p25/p75/postings/employers per
 * state that clears the gate). The shared source for every "salary by
 * state" table outside the salary-guide hub (which runs the same pipeline
 * inline to also list below-gate states).
 */
export async function getGatedStateBenchmarks(): Promise<BenchmarkRow[]> {
    const npRows = await fetchNpAnalyticsRows({ state: { not: null } });
    return summarizeBenchmarks(npRows).states;
}
