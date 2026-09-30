/**
 * Live aggregate queries behind the /reports pages (P5 A7/A8).
 *
 * TRUTH RULES:
 *   - Everything here is computed from THIS BOARD's own postings, counted
 *     with the same activeIndexableJobWhere() filter the sitemaps and
 *     /press use. The pages must present these as board aggregates, never
 *     as market or census figures.
 *   - Salary aggregation excludes `salaryIsEstimated` rows and reuses
 *     `summarizeBenchmarks` from components/tools/benchmark-model.ts, so
 *     the report's pay table carries the exact min-sample /
 *     min-distinct-employer gates of the public benchmark widget (see the
 *     TRUTH RULE note in components/tools/EmployerBenchmarkWidget.tsx).
 *   - The pay table also sits under the employer-share cap (indexing audit
 *     CQ-15, lib/salary-guide-gate.ts summarizeCappedBenchmarks): a state, or
 *     the national row, is published only when no single employer contributes
 *     more than MAX_EMPLOYER_SHARE_PERCENT of the postings behind it, the
 *     policy /salary-guide uses. A national row held by the cap is reported
 *     as such (nationalHeldByEmployerShare), never as "sample too small".
 *   - "Disclosed pay" means the pay range came from the posting itself:
 *     a normalized range present AND salaryIsEstimated=false. Figures the
 *     enrichment pipeline inferred count as NOT disclosed.
 *   - A report must never quote a fallback constant. A loader retries a
 *     failed aggregation, then THROWS at request time so ISR keeps the
 *     previous good render instead of caching a degraded one for the whole
 *     revalidate window (lib/reports/live-load.ts). Only during `next build`
 *     does it resolve to null, and callers then OMIT the block.
 */
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { loadLiveReportData } from './live-load';
import { activeIndexableJobWhere } from '@/lib/active-job-filter';
import type { Prisma } from '@prisma/client';
import { CATEGORY_AXES } from '@/lib/pseo/taxonomy-registry';
import { categoryPredicateWhere, type CategoryTag } from '@/lib/pseo/category-tagger';
import { CATEGORY_LABELS, isCategoryFaqSlug } from '@/lib/pseo/category-faq-data';
import { SETTING_CONFIGS } from '@/lib/pseo/setting-state-config';
import {
    type BenchmarkSummary,
} from '@/components/tools/benchmark-model';
import { summarizeCappedBenchmarks } from '@/lib/salary-guide-gate';
import type { CountGroup, MonthlyDisclosureRow } from './report-model';

/**
 * Display label for a category slug, resolved from the registries that
 * already carry the taxonomy's labels — never typed here, so the report
 * cannot spell a specialty differently from the rest of the site.
 */
function labelForCategorySlug(slug: string): string {
    if (isCategoryFaqSlug(slug)) return CATEGORY_LABELS[slug];
    const fromStateConfig = SETTING_CONFIGS[slug]?.label;
    if (fromStateConfig) return fromStateConfig;
    return slug
        .split('-')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

export interface InventoryTotals {
    totalActive: number;
    totalEmployers: number;
    totalStates: number;
}

export interface ModeCounts {
    remote: number;
    hybrid: number;
    onSite: number;
    total: number;
}

export interface DisclosureCounts {
    total: number;
    disclosed: number;
}

export interface HiringReportSnapshot {
    /** ISO timestamp of when the aggregation ran — the report's as-of date. */
    asOf: string;
    inventory: InventoryTotals;
    /** Raw per-specialty active-posting counts (page folds via report-model). */
    bySpecialty: CountGroup[];
    /** Raw per-state active-posting counts (page folds via report-model). */
    byState: CountGroup[];
    modes: ModeCounts;
    /** Active postings flagged open to new grads. */
    newGradFriendly: number;
    /**
     * Advertised-pay distribution, benchmark-gated and under the employer-share
     * cap. nationalHeldByEmployerShare is true when the national row cleared the
     * size gate but one employer holds more than the cap allows.
     */
    salary: BenchmarkSummary & { nationalHeldByEmployerShare: boolean };
    disclosure: DisclosureCounts;
}

/** Specialty + APRN axes — the clinical slugs the report breaks down by. */
const REPORT_SPECIALTY_SLUGS: readonly string[] = [
    ...CATEGORY_AXES.specialty,
    ...CATEGORY_AXES.aprn,
];

/**
 * CQ-14: a specialty is counted with its one category predicate (the stored
 * tag, with the legacy fallback for untagged rows), the clause its landing,
 * state pages and index verdict read, so the report never gives a specialty
 * a different count from its own pages. Nested AND, so the predicate's OR
 * cannot replace the active-job gate's.
 */
export function specialtyCountWhere(where: Prisma.JobWhereInput, slug: string): Prisma.JobWhereInput {
    return { AND: [where, categoryPredicateWhere(slug as CategoryTag)] };
}

async function countBySpecialty(now: Date): Promise<CountGroup[]> {
    const where = activeIndexableJobWhere(now);
    const counts = await Promise.all(
        REPORT_SPECIALTY_SLUGS.map((slug) =>
            prisma.job.count({ where: specialtyCountWhere(where, slug) }),
        ),
    );
    return REPORT_SPECIALTY_SLUGS.map((slug, i) => ({
        key: slug,
        label: labelForCategorySlug(slug),
        count: counts[i],
    }));
}

async function countByState(now: Date): Promise<CountGroup[]> {
    const grouped = await prisma.job.groupBy({
        by: ['state'],
        where: { ...activeIndexableJobWhere(now), state: { not: null } },
        _count: { _all: true },
    });
    return grouped.flatMap((g) =>
        g.state === null ? [] : [{ key: g.state, label: g.state, count: g._count._all }],
    );
}

async function loadSalarySummary(now: Date): Promise<HiringReportSnapshot['salary']> {
    // Same shape as loadBenchmarkSummary in EmployerBenchmarkWidget.tsx, but
    // scoped to the report's active-inventory filter so the pay table and
    // the posting counts describe the same population.
    const rows = await prisma.job.findMany({
        where: {
            ...activeIndexableJobWhere(now),
            salaryIsEstimated: false,
            state: { not: null },
            normalizedMinSalary: { not: null },
            normalizedMaxSalary: { not: null },
        },
        select: {
            state: true,
            employer: true,
            normalizedMinSalary: true,
            normalizedMaxSalary: true,
        },
    });
    const { national, states, nationalHeld } = summarizeCappedBenchmarks(rows);
    return { national, states, nationalHeldByEmployerShare: nationalHeld !== null };
}

async function aggregateHiringReportSnapshot(): Promise<HiringReportSnapshot> {
    const now = new Date();
    const where = activeIndexableJobWhere(now);
    const [
        totalActive,
        employerGroups,
        bySpecialty,
        byState,
        remote,
        hybridNotRemote,
        newGradFriendly,
        salary,
        disclosed,
    ] = await Promise.all([
        prisma.job.count({ where }),
        prisma.job.groupBy({ by: ['employer'], where }),
        countBySpecialty(now),
        countByState(now),
        prisma.job.count({ where: { ...where, isRemote: true } }),
        prisma.job.count({ where: { ...where, isHybrid: true, isRemote: false } }),
        prisma.job.count({ where: { ...where, newGradFriendly: true } }),
        loadSalarySummary(now),
        prisma.job.count({
            where: {
                ...where,
                salaryIsEstimated: false,
                normalizedMinSalary: { not: null },
            },
        }),
    ]);
    return {
        asOf: now.toISOString(),
        inventory: {
            totalActive,
            totalEmployers: employerGroups.length,
            totalStates: byState.length,
        },
        bySpecialty,
        byState,
        modes: {
            remote,
            hybrid: hybridNotRemote,
            onSite: totalActive - remote - hybridNotRemote,
            total: totalActive,
        },
        newGradFriendly,
        salary,
        disclosure: { total: totalActive, disclosed },
    };
}

/**
 * The full State of Hiring aggregate snapshot. Retries, then throws at
 * request time so ISR keeps the last good render; resolves to null only
 * during `next build`, where the page renders its "live data unavailable"
 * note instead of any number.
 */
export async function loadHiringReportSnapshot(): Promise<HiringReportSnapshot | null> {
    return loadLiveReportData(aggregateHiringReportSnapshot, {
        onFailure: (attempt, error) =>
            logger.error(`[reports] hiring snapshot aggregation failed (attempt ${attempt})`, error),
    });
}

/**
 * Monthly disclosure cohort for the pay-transparency trend: postings ADDED
 * to the board in each of the last 12 COMPLETE months (the current partial
 * month is excluded — a half-month rate reads as a drop that isn't there),
 * with the disclosed subset counted under the same definition as the live
 * rate. Gating to publishable months happens in report-model.
 */
export async function loadDisclosureCohort(): Promise<MonthlyDisclosureRow[] | null> {
    return loadLiveReportData(queryDisclosureCohort, {
        onFailure: (attempt, error) =>
            logger.error(`[reports] disclosure cohort query failed (attempt ${attempt})`, error),
    });
}

async function queryDisclosureCohort(): Promise<MonthlyDisclosureRow[]> {
    const rows = await prisma.$queryRaw<
        Array<{ month: string; total: number; disclosed: number }>
    >`
        SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month,
               COUNT(*)::int AS total,
               COUNT(*) FILTER (
                   WHERE normalized_min_salary IS NOT NULL
                     AND salary_is_estimated = false
               )::int AS disclosed
        FROM jobs
        WHERE created_at >= date_trunc('month', now()) - interval '12 months'
          AND created_at < date_trunc('month', now())
        GROUP BY 1
        ORDER BY 1
    `;
    return rows.map((r) => ({ month: r.month, total: r.total, disclosed: r.disclosed }));
}
