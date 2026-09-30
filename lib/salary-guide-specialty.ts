/**
 * lib/salary-guide-specialty.ts: live data and the index verdict for the
 * by-specialty salary pages (/salary-guide/specialty/<slug>).
 *
 * ONE VERDICT, TWO READERS (indexing audit CQ-09, plan FB-2). The page's
 * robots meta and the sitemap must agree on which specialty pages index, so
 * both read getSalarySpecialtyIndexBasis / shouldIndexSalarySpecialty from
 * here, over the same pool and the same gate:
 *   - a gated POSTED median (the npSalaryAnalyticsWhere pool scoped to the
 *     specialty tag and to NP-eligible titles, n of BENCHMARK_MIN_POSTINGS
 *     or more from BENCHMARK_MIN_EMPLOYERS or more employers, and no
 *     employer above the CQ-15 share cap), or
 *   - the role's own cited BLS OEWS occupation median, which only the two
 *     non-niche APRN roles have (29-1151 nurse anesthetists, 29-1161 nurse
 *     midwives; lib/salary-guide-occupation-wages.ts).
 * Anything else renders `noindex, follow` and stays out of the sitemap.
 *
 * Every live figure the page prints comes from the loaders below, so the
 * number a reader sees is the number behind the verdict. The loaders are
 * wrapped in React cache(): generateMetadata and the page body share one
 * query per request.
 */
import { cache } from 'react';
import type { Prisma } from '@prisma/client';
import { withTagFallback, type CategoryTag } from '@/lib/pseo/category-tagger';
import { STATE_CODES, stateToSlug } from '@/lib/pseo/setting-state-config';
import { fetchNpAnalyticsRows } from '@/lib/salary-analytics';
import { summarizeCappedBenchmarks, summarizeCappedPool } from '@/lib/salary-guide-gate';
import {
    getSpecialtySalaryPage,
    SALARY_SPECIALTY_PAGES,
} from '@/app/salary-guide/specialty/specialty-config';
import {
    specialtyIndexBasis,
    type SpecialtyExperienceRow,
    type SpecialtyIndexBasis,
    type SpecialtyLiveStats,
    type SpecialtyStateRow,
} from '@/app/salary-guide/specialty/specialty-content';

/** Top-paying-states rows the page lists at most. */
const TOP_STATES_LIMIT = 8;

/**
 * withTagFallback returns an intentionally untyped where fragment (its
 * callers cast; see lib/pseo/setting-state-template.tsx). Cast once here so
 * every query below stays fully typed.
 */
export function specialtyTagWhere(slug: CategoryTag): Prisma.JobWhereInput {
    return withTagFallback(slug) as Prisma.JobWhereInput;
}

/**
 * NP-eligible analytics rows for one specialty tag: fetchNpAnalyticsRows
 * (the hygiene pool ANDed with the scope, then the NP-title screen) with
 * the tag predicate and any extra clause composed under a top-level AND, so
 * neither side's own AND and OR trees can be dropped by an object spread.
 */
function fetchSpecialtyAnalyticsRows(slug: CategoryTag, extra?: Prisma.JobWhereInput) {
    const scope = extra ? { AND: [specialtyTagWhere(slug), extra] } : specialtyTagWhere(slug);
    return fetchNpAnalyticsRows(scope);
}

/**
 * The specialty-wide posted median, pooled across every row (stateless
 * ones included), plus the lowest and highest disclosed figure for the
 * "Reported range" card. `gatePassed` is the gate AND the share cap.
 */
export const getSpecialtyLiveStats = cache(async (slug: CategoryTag): Promise<SpecialtyLiveStats> => {
    const npRows = await fetchSpecialtyAnalyticsRows(slug);
    const { national } = summarizeCappedPool(npRows);
    const mins = npRows
        .map((row) => row.normalizedMinSalary)
        .filter((value): value is number => typeof value === 'number' && value > 0);
    const maxs = npRows
        .map((row) => row.normalizedMaxSalary ?? row.normalizedMinSalary)
        .filter((value): value is number => typeof value === 'number' && value > 0);
    return {
        medianSalary: national?.median ?? 0,
        minSalary: mins.length > 0 ? Math.min(...mins) : 0,
        maxSalary: maxs.length > 0 ? Math.max(...maxs) : 0,
        // The sample behind the published median when gated (rows lacking
        // an employer are excluded there), else the raw eligible-row count.
        jobCount: national?.postings ?? npRows.length,
        gatePassed: national != null,
    };
});

/**
 * Gated per-state medians for the specialty, highest first. Each state
 * clears the benchmark gate and the share cap on its own sample; a ranked
 * list over anything less re-created the n=1 "top paying state" defect.
 */
export const getSpecialtyTopPayingStates = cache(async (slug: CategoryTag): Promise<SpecialtyStateRow[]> => {
    const npRows = await fetchSpecialtyAnalyticsRows(slug, { state: { not: null } });
    return summarizeCappedBenchmarks(npRows).states
        .filter((row) => STATE_CODES[row.scope])
        .map((row) => ({
            state: row.scope,
            stateCode: STATE_CODES[row.scope],
            slug: stateToSlug(row.scope),
            medianSalary: row.median,
            jobCount: row.postings,
        }))
        .sort((a, b) => b.medianSalary - a.medianSalary)
        .slice(0, TOP_STATES_LIMIT);
});

const EXPERIENCE_BANDS = [
    { label: 'New-grad friendly roles', extra: { newGradFriendly: true } },
    { label: 'Roles requiring 3+ years', extra: { minYearsExperience: { gte: 3 } } },
    { label: 'Roles requiring 5+ years', extra: { minYearsExperience: { gte: 5 } } },
] as const satisfies ReadonlyArray<{ label: string; extra: Prisma.JobWhereInput }>;

/** Gated medians per experience bucket; buckets below the gate or cap are omitted. */
export async function getSpecialtyExperienceBands(slug: CategoryTag): Promise<SpecialtyExperienceRow[]> {
    const results = await Promise.all(
        EXPERIENCE_BANDS.map(async (band): Promise<SpecialtyExperienceRow | null> => {
            const { national } = summarizeCappedPool(await fetchSpecialtyAnalyticsRows(slug, band.extra));
            return national
                ? { label: band.label, medianSalary: national.median, jobCount: national.postings }
                : null;
        }),
    );
    return results.filter((row): row is SpecialtyExperienceRow => row !== null);
}

/**
 * The index basis for a configured specialty slug, or null for `noindex,
 * follow` (and for an unknown slug). A niche page needs a gated posted
 * median; a non-niche page qualifies on its cited occupation median even
 * when the query finds none. A failed query is treated as "no posted
 * median": the sitemap then leaves a niche page out rather than advertising
 * a page whose verdict it could not establish.
 */
export async function getSalarySpecialtyIndexBasis(slug: string): Promise<SpecialtyIndexBasis | null> {
    const page = getSpecialtySalaryPage(slug);
    if (!page) return null;
    try {
        return specialtyIndexBasis(page, await getSpecialtyLiveStats(page.slug));
    } catch (error) {
        console.error(`[salary-specialty] index verdict query failed for "${slug}":`, error);
        return specialtyIndexBasis(page, { gatePassed: false, medianSalary: 0 });
    }
}

/**
 * True when /salary-guide/specialty/<slug> renders `index`. The page's
 * robots meta and the sitemap both call this, so they cannot disagree.
 */
export async function shouldIndexSalarySpecialty(slug: string): Promise<boolean> {
    return (await getSalarySpecialtyIndexBasis(slug)) !== null;
}

/** Every configured specialty slug that indexes, in config order. */
export async function getIndexableSalarySpecialtySlugs(): Promise<string[]> {
    const verdicts = await Promise.all(
        SALARY_SPECIALTY_PAGES.map(async (page) => [page.slug, await shouldIndexSalarySpecialty(page.slug)] as const),
    );
    return verdicts.filter(([, indexable]) => indexable).map(([slug]) => slug);
}

/**
 * The slugs that index on a cited occupation median alone, with no query:
 * the sitemap's degraded-mode list when the database is unreachable.
 */
export const SALARY_SPECIALTY_SLUGS_INDEXABLE_WITHOUT_DB: readonly string[] = SALARY_SPECIALTY_PAGES
    .filter((page) => specialtyIndexBasis(page, { gatePassed: false, medianSalary: 0 }) !== null)
    .map((page) => page.slug);
