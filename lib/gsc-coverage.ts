/**
 * lib/gsc-coverage.ts — renderable vs indexable pSEO coverage math
 * (P1 gsc-ops). Pure DB math over pseoStats rows: no external API.
 *
 * Why no GSC API here: Google's Page-Indexing coverage BREAKDOWN
 * (crawled-not-indexed, duplicate-no-canonical, …) has NO public API —
 * those columns only exist in GSC UI bulk exports. What we CAN measure
 * precisely from our own DB is the supply side of the funnel:
 *
 *   total combos  →  renderable (render gate passes, page returns 200)
 *                →  indexable  (sitemap gates pass, URL is advertised)
 *
 * per category axis. A category with a big renderable→indexable gap is
 * publishing pages the sitemap never advertises (staleness, population
 * floor, or a retired category slug), which is exactly the visibility
 * this dashboard panel exists to expose.
 *
 * Threshold mirrors: MIN_SITEMAP_JOBS / MIN_SITEMAP_POPULATION /
 * PSEO_STALENESS_HOURS mirror app/api/sitemaps/index/route.ts (which in
 * turn mirrors /api/sitemaps/cities/[batch]). Drift is guarded by
 * tests/regressions/p1-gsc-ops-coverage.test.ts — if you change the route
 * constants, change these and the test together.
 */
import { MIN_JOBS_FOR_CATEGORY_CITY } from '@/lib/pseo/render-gate';
import { CITY_ELIGIBLE_CATEGORY_SLUGS } from '@/lib/pseo/taxonomy-registry';

// Mirrors app/api/sitemaps/index/route.ts — see header comment.
export const MIN_SITEMAP_JOBS = 3;
export const MIN_SITEMAP_POPULATION = 10000;
export const PSEO_STALENESS_HOURS = 36;

// Same CITY_ELIGIBLE_CATEGORY_SLUGS allow-list the sitemap index and
// cities/[batch] routes filter on (previously the stale 28-slug
// state-eligible subset — parity pinned by
// tests/regressions/p6-sitemap-parity-index-batch.test.ts).
const SITEMAP_CATEGORY_SET: ReadonlySet<string> = new Set(CITY_ELIGIBLE_CATEGORY_SLUGS);

/** Cutoff before which a pseoStats row counts as stale for sitemap purposes. */
export function pseoFreshnessThreshold(now: Date = new Date()): Date {
    return new Date(now.getTime() - PSEO_STALENESS_HOURS * 60 * 60 * 1000);
}

export interface PseoCoverageRow {
    categorySlug: string;
    locationSlug: string;
    totalJobs: number;
    updatedAt: Date;
}

export interface CategoryCoverage {
    categorySlug: string;
    /** All category×city combos with a pseoStats row. */
    total: number;
    /** Combos passing the render gate (page serves 200 instead of 404). */
    renderable: number;
    /** Renderable combos the sitemap actually advertises. */
    indexable: number;
    /** Whether this category's state/city URLs are sitemap-eligible at all. */
    sitemapEligible: boolean;
}

export interface CategoryCityCoverage {
    categories: CategoryCoverage[];
    totals: { total: number; renderable: number; indexable: number };
}

export interface CategoryCityCoverageInput {
    /** Full combo count per categorySlug (cheap prisma groupBy). */
    totalsByCategory: ReadonlyMap<string, number>;
    /**
     * Rows with totalJobs >= MIN_JOBS_FOR_CATEGORY_CITY (the renderable
     * candidates — fetched pre-filtered so we never load all ~165K rows).
     */
    renderableRows: readonly PseoCoverageRow[];
    /** City slug → population (from lib/pseo/city-data/cities.ts). */
    populationBySlug: ReadonlyMap<string, number>;
    now?: Date;
}

/**
 * Per-category renderable vs indexable counts for the category×city axis.
 * Pure — all DB reads happen in the caller.
 */
export function computeCategoryCityCoverage(input: CategoryCityCoverageInput): CategoryCityCoverage {
    const now = input.now ?? new Date();
    const freshCutoff = pseoFreshnessThreshold(now);

    const byCategory = new Map<string, CategoryCoverage>();
    const ensure = (slug: string): CategoryCoverage => {
        let entry = byCategory.get(slug);
        if (!entry) {
            entry = {
                categorySlug: slug,
                total: input.totalsByCategory.get(slug) ?? 0,
                renderable: 0,
                indexable: 0,
                sitemapEligible: SITEMAP_CATEGORY_SET.has(slug),
            };
            byCategory.set(slug, entry);
        }
        return entry;
    };

    // Seed every category that has combos, even if none are renderable.
    for (const slug of input.totalsByCategory.keys()) ensure(slug);

    for (const row of input.renderableRows) {
        // Defensive re-check: callers pre-filter on the DB side, but the gate
        // is the source of truth.
        if (row.totalJobs < MIN_JOBS_FOR_CATEGORY_CITY) continue;
        const entry = ensure(row.categorySlug);
        entry.renderable += 1;

        const population = input.populationBySlug.get(row.locationSlug);
        const isIndexable =
            entry.sitemapEligible &&
            row.totalJobs >= MIN_SITEMAP_JOBS &&
            row.updatedAt >= freshCutoff &&
            population !== undefined &&
            population >= MIN_SITEMAP_POPULATION;
        if (isIndexable) entry.indexable += 1;
    }

    const categories = Array.from(byCategory.values()).sort(
        (a, b) => b.indexable - a.indexable || b.renderable - a.renderable || a.categorySlug.localeCompare(b.categorySlug),
    );

    const totals = categories.reduce(
        (acc, c) => ({
            total: acc.total + c.total,
            renderable: acc.renderable + c.renderable,
            indexable: acc.indexable + c.indexable,
        }),
        { total: 0, renderable: 0, indexable: 0 },
    );

    return { categories, totals };
}

export interface SettingStateCoverageRow {
    totalJobs: number;
    updatedAt: Date;
}

export interface SettingStateCoverage {
    total: number;
    renderable: number;
    indexable: number;
}

/**
 * Setting×state axis: renders whenever a stats row exists with ≥1 job;
 * indexed when additionally fresh (mirrors the index route's setting-state
 * count: totalJobs ≥ 1 AND updatedAt within the staleness window).
 */
export function computeSettingStateCoverage(
    rows: readonly SettingStateCoverageRow[],
    now: Date = new Date(),
): SettingStateCoverage {
    const freshCutoff = pseoFreshnessThreshold(now);
    let renderable = 0;
    let indexable = 0;
    for (const row of rows) {
        if (row.totalJobs < 1) continue;
        renderable += 1;
        if (row.updatedAt >= freshCutoff) indexable += 1;
    }
    return { total: rows.length, renderable, indexable };
}
