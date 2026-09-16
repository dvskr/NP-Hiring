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
    type BenchmarkInputRow,
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

/* ═══════════════════════════════════════════════════════════════════════
 * GATED LOCATION SALARY (pSEO thin-content program, PLAN C.3)
 *
 * One shape for every state, city, metro and sub-pool figure on the pSEO
 * surfaces, so the state hub, the city directory, the metro guide and the
 * salary guide can never disagree about a state's median. Same pool, same
 * gate, same rounding as the helpers above.
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * One gated figure for a location or sub-pool. `postings` and `employers`
 * are the benchmark sample (rows with an employer and a positive normalized
 * minimum, exactly what summarizeBenchmarks counts), so the n a page prints
 * is always the n behind its median. Below the gate every figure is null:
 * callers omit the sentence, row or FAQ entry, or fall back to the cited
 * BLS figure (STAT_SOURCES); they never print a mean or a "$0".
 */
export interface GatedSalary {
    /** NP-eligible analytics rows in scope that entered the benchmark sample. */
    postings: number;
    /** Distinct employers behind them. */
    employers: number;
    /** n >= BENCHMARK_MIN_POSTINGS (5) from >= BENCHMARK_MIN_EMPLOYERS (3). */
    gatePassed: boolean;
    /** Whole dollars (BenchmarkRow units); null below the gate. */
    median: number | null;
    p25: number | null;
    p75: number | null;
    /** Whole $k, Math.round(x / 1000) (the pSEO display unit); null below the gate. */
    medianK: number | null;
    p25K: number | null;
    p75K: number | null;
}

/** A gated benchmark row labeled by the caller's key (a table row label). */
export interface LabeledBenchmarkRow extends BenchmarkRow {
    label: string;
}

const BELOW_GATE: Omit<GatedSalary, 'postings' | 'employers'> = {
    gatePassed: false,
    median: null,
    p25: null,
    p75: null,
    medianK: null,
    p25K: null,
    p75K: null,
};

function toK(dollars: number): number {
    return Math.round(dollars / 1000);
}

function fromBenchmarkRow(row: BenchmarkRow): GatedSalary {
    return {
        postings: row.postings,
        employers: row.employers,
        gatePassed: true,
        median: row.median,
        p25: row.p25,
        p75: row.p75,
        medianK: toK(row.median),
        p25K: toK(row.p25),
        p75K: toK(row.p75),
    };
}

/** Sample counts with the benchmark model's own row eligibility. */
function countBenchmarkSample(rows: readonly BenchmarkInputRow[]): { postings: number; employers: number } {
    const eligible = rows.filter((row) => Boolean(row.employer) && (row.normalizedMinSalary ?? 0) > 0);
    const employers = new Set(eligible.map((row) => row.employer as string));
    return { postings: eligible.length, employers: employers.size };
}

/**
 * Collapse one scope's NP-eligible rows into a GatedSalary. Pure: the rows
 * are treated as one pool regardless of their state (stateless rows count,
 * as in getGatedBenchmark). Exported for tests and for callers that already
 * hold the rows.
 */
export function summarizeGatedSalary(rows: readonly BenchmarkInputRow[]): GatedSalary {
    const { postings, employers } = countBenchmarkSample(rows);
    const { national } = summarizeBenchmarks(
        rows.map((row) => ({ ...row, state: row.state ?? 'Unknown' })),
    );
    if (!national) return { postings, employers, ...BELOW_GATE };
    return fromBenchmarkRow(national);
}

/**
 * Gated figure for one location scope: `{ state: stateName }` for a state
 * or salary-guide page, `metroScopeWhere(metro)` for a metro (the analytics
 * where already carries the published and expiry clauses), or any sub-pool
 * where. `{ gatePassed: false }` with null figures below the gate.
 */
export async function getGatedLocationSalary(
    extra: Prisma.JobWhereInput = {},
): Promise<GatedSalary> {
    return summarizeGatedSalary(await fetchNpAnalyticsRows(extra));
}

/** The analytics select plus the city column, for the per-city pass. */
const NP_CITY_SALARY_ANALYTICS_SELECT = { ...NP_SALARY_ANALYTICS_SELECT, city: true } as const;

/**
 * Per-city gated figures for a state (the city directory): one fetch for
 * the state, grouped in memory by city through summarizeBenchmarks with the
 * city name as the scope. Only cities that clear the gate are in the map,
 * keyed by the city spelling stored on Job.city (trimmed).
 */
export async function getGatedCitySalaries(stateName: string): Promise<Map<string, GatedSalary>> {
    const rows = await prisma.job.findMany({
        where: { AND: [npSalaryAnalyticsWhere(), { state: stateName, city: { not: null } }] },
        select: NP_CITY_SALARY_ANALYTICS_SELECT,
    });
    const npRows = filterNpEligibleRows(rows);
    const { states: cities } = summarizeBenchmarks(
        npRows.map((row) => ({ ...row, state: row.city?.trim() || null })),
    );
    return new Map(cities.map((row) => [row.scope, fromBenchmarkRow(row)]));
}

/**
 * Gated benchmark rows for several sub-pools at once (salary guide SAL-S2:
 * pay by work arrangement and employment type). Keys are the visible row
 * labels; values are each sub-pool's extra where, composed with the
 * analytics pool by fetchNpAnalyticsRows. Only sub-pools that clear the
 * gate come back, in input order, with `scope` and `label` both set to the
 * key. Callers render the table only at 2 or more rows: a single row is the
 * scope median again.
 */
export async function getGatedBenchmarkRows(
    extras: Record<string, Prisma.JobWhereInput>,
): Promise<LabeledBenchmarkRow[]> {
    const entries = Object.entries(extras);
    const rows = await Promise.all(entries.map(([, extra]) => getGatedBenchmark(extra)));
    return entries.flatMap(([label], index) => {
        const row = rows[index];
        return row ? [{ ...row, scope: label, label }] : [];
    });
}

/**
 * States whose `/salary-guide/{state}` page publishes a median: the scopes
 * of getGatedStateBenchmarks, keyed by the state name stored on Job.state
 * (the same key the page queries with). The page robots decision
 * (shouldIndexSalaryGuideState) and app/sitemap.ts read this one set (the
 * sitemap slugifies the names and intersects with its active-job state
 * set), so the hub, the guide and the sitemap cannot disagree.
 */
export async function getPublishableSalaryGuideStates(): Promise<Set<string>> {
    const rows = await getGatedStateBenchmarks();
    return new Set(rows.map((row) => row.scope));
}
