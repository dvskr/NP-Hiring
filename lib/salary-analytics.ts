/**
 * lib/salary-analytics.ts: the ONE server-side pipeline for posting-derived
 * salary figures on public surfaces (review P9 #2c/#2d; one engine since the
 * 2026-11 salary build, the sister board's rules).
 *
 * Every public dollar figure computed from postings is:
 *   pool   = activeIndexableJobWhere() (published, not expired, passing the
 *            dead-link health check, outside GLOBAL_EXCLUSIONS) AND
 *            npSalaryAnalyticsWhere (both bounds, non-estimated, confidence
 *            0.8 or more, annual cadence, the scope's profession class),
 *            then the title screen for unclassified rows. The NP scope
 *            never includes CRNA, CNM or CNS postings; the two APRN scopes
 *            exist only for their own specialty pages.
 *   figure = the engine (lib/salary-report/stats.ts through
 *            components/tools/benchmark-model.ts): each employer counts
 *            once, a median at 5 or more employers, the 25th and 75th
 *            percentiles at 10 or more, nothing below 5.
 *
 * Below the median tier there is NO figure: callers omit the section or
 * cite the BLS figure (STAT_SOURCES, lib/salary-guide-bls-states.ts), never
 * a posting mean and never "$0".
 *
 * Server-only (imports prisma and the company normalizer); client
 * components receive plain numbers.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { activeIndexableJobWhere } from '@/lib/active-job-filter';
import { findCanonicalName, normalizeCompanyName } from '@/lib/company-normalizer';
import { employerKey as pureEmployerKey } from '@/lib/jobs/employer-key';
import {
    npSalaryAnalyticsWhere,
    NP_SALARY_ANALYTICS_SELECT,
    filterSalaryScopeRows,
    type NpSalaryAnalyticsRow,
    type SalaryRoleScope,
} from '@/lib/salary-utils';
import {
    summarizeBenchmarks,
    summarizeScope,
    type BenchmarkInputRow,
    type BenchmarkRow,
} from '@/components/tools/benchmark-model';
import { displayThousands, type SalaryTier } from '@/lib/salary-report/stats';

/* ── Employer identity ──────────────────────────────────────────────── */

/**
 * Memo for the alias-merged key. findCanonicalName re-normalizes every known
 * alias on each call, and one render summarizes the same employer names
 * several times, so keys are kept per process. Bounded: cleared when it
 * outgrows any realistic employer roster.
 */
const EMPLOYER_KEY_MEMO_LIMIT = 5_000;
const employerKeyMemo = new Map<string, string>();

/**
 * The employer identity the engine groups by: the canonical company name,
 * else the normalizer's key, so "LifeStance" and "LifeStance Health" are one
 * employer (the rule the listing facts use). A missing or placeholder name
 * ("Confidential", "Company Not Listed") returns null, which the engine
 * counts as an employer of its own, never as one large anonymous employer.
 */
export function salaryEmployerIdentity(raw: string | null | undefined): string | null {
    const name = raw?.trim() ?? '';
    if (pureEmployerKey(name) === '') return null;
    const memo = employerKeyMemo.get(name);
    if (memo !== undefined) return memo;
    const canonical = findCanonicalName(name);
    const key = canonical ? `canonical ${canonical}` : normalizeCompanyName(name) || name.toLowerCase();
    if (employerKeyMemo.size >= EMPLOYER_KEY_MEMO_LIMIT) employerKeyMemo.clear();
    employerKeyMemo.set(name, key);
    return key;
}

/* ── The pool ───────────────────────────────────────────────────────── */

/** The full pool predicate for a scope: the listing predicate AND the salary hygiene predicate. */
export function salaryPoolWhere(scope: SalaryRoleScope = 'np', now: Date = new Date()): Prisma.JobWhereInput {
    return { AND: [activeIndexableJobWhere(now), npSalaryAnalyticsWhere(now, scope)] };
}

/**
 * Fetch the scope's analytics rows for a sub-pool, with `employer` replaced
 * by the alias-merged identity (salaryEmployerIdentity). `extra` is
 * composed through a top-level AND: both sides can carry their own AND/OR
 * trees, so an object spread would silently drop clauses.
 */
export async function fetchSalaryAnalyticsRows(
    extra: Prisma.JobWhereInput = {},
    scope: SalaryRoleScope = 'np',
): Promise<NpSalaryAnalyticsRow[]> {
    const rows = await prisma.job.findMany({
        where: { AND: [salaryPoolWhere(scope), extra] },
        select: NP_SALARY_ANALYTICS_SELECT,
    });
    return filterSalaryScopeRows(rows, scope).map((row) => ({ ...row, employer: salaryEmployerIdentity(row.employer) }));
}

/** The NP scope of fetchSalaryAnalyticsRows: every NP figure on the site reads this. */
export function fetchNpAnalyticsRows(extra: Prisma.JobWhereInput = {}): Promise<NpSalaryAnalyticsRow[]> {
    return fetchSalaryAnalyticsRows(extra, 'np');
}

/* ── Gated figures ──────────────────────────────────────────────────── */

/**
 * One gated figure for a location or sub-pool. `employers` is the sample
 * size (each employer once) and `postings` the postings behind it, for
 * context only. Below the median tier every dollar figure is null; p25 and
 * p75 are null below the full tier. Callers never print a mean or a "$0".
 */
export interface GatedSalary {
    /** Postings that survived the engine's gates (context, never the n). */
    postings: number;
    /** Employers behind the figure, each counted once: the n. */
    employers: number;
    /** The engine tier: 'full' (quartiles), 'median', 'countOnly' or 'none'. */
    tier: SalaryTier;
    /** True at the median or full tier: a median is published. */
    gatePassed: boolean;
    /** Whole dollars on the $500 display grid; null below the median tier. */
    median: number | null;
    /** Null below the full tier. */
    p25: number | null;
    p75: number | null;
    /** Whole $k for the pSEO display unit; null where the dollar figure is. */
    medianK: number | null;
    p25K: number | null;
    p75K: number | null;
}

/** A gated benchmark row labeled by the caller's key (a table row label). */
export interface LabeledBenchmarkRow extends BenchmarkRow {
    label: string;
}

/**
 * Collapse one scope's rows into a GatedSalary. Pure: the rows are one pool
 * whatever their state (stateless rows count). Exported for tests and for
 * callers that already hold the rows.
 */
export function summarizeGatedSalary(rows: readonly BenchmarkInputRow[]): GatedSalary {
    const { row, summary, postings } = summarizeScope('pool', rows);
    if (!row) {
        return { postings, employers: summary.n, tier: summary.tier, gatePassed: false, median: null, p25: null, p75: null, medianK: null, p25K: null, p75K: null };
    }
    return fromBenchmarkRow(row);
}

function fromBenchmarkRow(row: BenchmarkRow): GatedSalary {
    return {
        postings: row.postings,
        employers: row.employers,
        tier: row.tier,
        gatePassed: true,
        median: row.median,
        p25: row.p25,
        p75: row.p75,
        medianK: displayThousands(row.median),
        p25K: row.p25 === null ? null : displayThousands(row.p25),
        p75K: row.p75 === null ? null : displayThousands(row.p75),
    };
}

/** The BenchmarkRow of a GatedSalary, or null below the median tier. */
export function benchmarkRowOf(scope: string, salary: GatedSalary): BenchmarkRow | null {
    if (!salary.gatePassed || salary.median === null || (salary.tier !== 'full' && salary.tier !== 'median')) return null;
    return { scope, tier: salary.tier, median: salary.median, p25: salary.p25, p75: salary.p75, postings: salary.postings, employers: salary.employers };
}

/**
 * Gated figure for one location scope: `{ state: stateName }` for a state
 * page, `metroScopeWhere(metro)` for a metro, or any sub-pool where.
 */
export async function getGatedLocationSalary(extra: Prisma.JobWhereInput = {}): Promise<GatedSalary> {
    return summarizeGatedSalary(await fetchNpAnalyticsRows(extra));
}

/** Gated benchmark for a sub-pool as a whole (e.g. one category tag); null below the median tier. */
export async function getGatedBenchmark(extra: Prisma.JobWhereInput = {}): Promise<BenchmarkRow | null> {
    return summarizeScope('National', await fetchNpAnalyticsRows(extra)).row;
}

/**
 * Gated median for a sub-pool in whole $k (the category-page display unit),
 * or 0 below the median tier: callers branch to their static copy on 0.
 */
export async function getGatedMedianKForWhere(extra: Prisma.JobWhereInput = {}): Promise<number> {
    const row = await getGatedBenchmark(extra);
    return row ? displayThousands(row.median) : 0;
}

/** Gated per-state rows: every state at the median tier or above, by name. */
export async function getGatedStateBenchmarks(): Promise<BenchmarkRow[]> {
    const npRows = await fetchNpAnalyticsRows({ state: { not: null } });
    return summarizeBenchmarks(npRows).states;
}

/** The analytics select plus the city column, for the per-city pass. */
const NP_CITY_SALARY_ANALYTICS_SELECT = { ...NP_SALARY_ANALYTICS_SELECT, city: true } as const;

/**
 * Per-city gated figures for a state (the city directory): one fetch for
 * the state, grouped in memory by city. Only cities at the median tier are
 * in the map, keyed by the city spelling stored on Job.city (trimmed).
 */
export async function getGatedCitySalaries(stateName: string): Promise<Map<string, GatedSalary>> {
    const rows = await prisma.job.findMany({
        where: { AND: [salaryPoolWhere('np'), { state: stateName, city: { not: null } }] },
        select: NP_CITY_SALARY_ANALYTICS_SELECT,
    });
    const { states: cities } = summarizeBenchmarks(
        filterSalaryScopeRows(rows, 'np').map((row) => ({
            state: row.city?.trim() || null,
            employer: salaryEmployerIdentity(row.employer),
            normalizedMinSalary: row.normalizedMinSalary,
            normalizedMaxSalary: row.normalizedMaxSalary,
        })),
    );
    return new Map(cities.map((row) => [row.scope, fromBenchmarkRow(row)]));
}

/**
 * Gated benchmark rows for several sub-pools at once (pay by work
 * arrangement and employment type). Keys are the visible row labels; only
 * sub-pools at the median tier come back, in input order.
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
 * States whose posted median is published (the median tier), keyed by the
 * state name stored on Job.state. The salary guide's robots predicate reads
 * it as `salaryGatePassed` (beside the BLS median), and the state hubs and
 * job breadcrumbs read it as their salary signal.
 */
export async function getPublishableSalaryGuideStates(): Promise<Set<string>> {
    const rows = await getGatedStateBenchmarks();
    return new Set(rows.map((row) => row.scope));
}
