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
 *   - "Disclosed pay" means the pay range came from the posting itself:
 *     a normalized range present AND salaryIsEstimated=false. Figures the
 *     enrichment pipeline inferred count as NOT disclosed.
 *   - Every loader returns null on failure so callers OMIT the block (the
 *     /press pattern) — a report must never quote a fallback constant.
 */
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { activeIndexableJobWhere } from '@/lib/active-job-filter';
import { CATEGORY_AXES } from '@/lib/pseo/taxonomy-registry';
import { CATEGORY_LABELS, isCategoryFaqSlug } from '@/lib/pseo/category-faq-data';
import { SETTING_CONFIGS } from '@/lib/pseo/setting-state-config';
import {
    summarizeBenchmarks,
    type BenchmarkSummary,
} from '@/components/tools/benchmark-model';
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
    /** Advertised-pay distribution, benchmark-gated. */
    salary: BenchmarkSummary;
    disclosure: DisclosureCounts;
}

/** Specialty + APRN axes — the clinical slugs the report breaks down by. */
const REPORT_SPECIALTY_SLUGS: readonly string[] = [
    ...CATEGORY_AXES.specialty,
    ...CATEGORY_AXES.aprn,
];

async function countBySpecialty(now: Date): Promise<CountGroup[]> {
    const where = activeIndexableJobWhere(now);
    const counts = await Promise.all(
        REPORT_SPECIALTY_SLUGS.map((slug) =>
            prisma.job.count({ where: { ...where, categoryTags: { has: slug } } }),
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

async function loadSalarySummary(now: Date): Promise<BenchmarkSummary> {
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
    return summarizeBenchmarks(rows);
}

/**
 * The full State of Hiring aggregate snapshot, or null on any failure —
 * the page then renders its "live data unavailable" note instead of any
 * number.
 */
export async function loadHiringReportSnapshot(): Promise<HiringReportSnapshot | null> {
    try {
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
    } catch (error) {
        logger.error('[reports] hiring snapshot aggregation failed — omitting live sections', error);
        return null;
    }
}

/**
 * Monthly disclosure cohort for the pay-transparency trend: postings ADDED
 * to the board in each of the last 12 COMPLETE months (the current partial
 * month is excluded — a half-month rate reads as a drop that isn't there),
 * with the disclosed subset counted under the same definition as the live
 * rate. Gating to publishable months happens in report-model.
 */
export async function loadDisclosureCohort(): Promise<MonthlyDisclosureRow[] | null> {
    try {
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
    } catch (error) {
        logger.error('[reports] disclosure cohort query failed — omitting the trend', error);
        return null;
    }
}
