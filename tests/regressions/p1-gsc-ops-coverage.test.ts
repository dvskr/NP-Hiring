/**
 * P1 gsc-ops: renderable vs indexable coverage math (lib/gsc-coverage.ts)
 * plus drift guards pinning the mirrored sitemap-gate constants to the
 * authoritative literals in app/api/sitemaps/index/route.ts.
 */
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
    computeCategoryCityCoverage,
    computeSettingStateCoverage,
    pseoFreshnessThreshold,
    MIN_SITEMAP_JOBS,
    MIN_SITEMAP_POPULATION,
    PSEO_STALENESS_HOURS,
} from '@/lib/gsc-coverage';
import { GSC_DIMENSION_ROW_LIMIT, GSC_MAX_ROW_LIMIT } from '@/lib/gsc-client';
import { MIN_JOBS_FOR_CATEGORY_CITY } from '@/lib/pseo/render-gate';
import { STATE_ELIGIBLE_CATEGORY_SLUGS } from '@/lib/pseo/taxonomy-registry';

const NOW = new Date('2026-07-28T12:00:00Z');
const FRESH = new Date('2026-07-28T00:00:00Z'); // 12h old — inside 36h window
const STALE = new Date('2026-07-25T12:00:00Z'); // 72h old — outside 36h window

const ELIGIBLE = STATE_ELIGIBLE_CATEGORY_SLUGS[0];
const INELIGIBLE = 'definitely-not-a-real-category-slug';

interface RowOverrides {
    categorySlug?: string;
    locationSlug?: string;
    totalJobs?: number;
    updatedAt?: Date;
}

function coverageRow(overrides: RowOverrides = {}) {
    return {
        categorySlug: ELIGIBLE,
        locationSlug: 'big-city',
        totalJobs: 10,
        updatedAt: FRESH,
        ...overrides,
    };
}

const POPULATIONS = new Map<string, number>([
    ['big-city', 500000],
    ['small-town', MIN_SITEMAP_POPULATION - 1],
    ['floor-city', MIN_SITEMAP_POPULATION],
]);

describe('computeCategoryCityCoverage', () => {
    test('fresh eligible row above all gates is renderable and indexable', () => {
        const result = computeCategoryCityCoverage({
            totalsByCategory: new Map([[ELIGIBLE, 5]]),
            renderableRows: [coverageRow()],
            populationBySlug: POPULATIONS,
            now: NOW,
        });

        expect(result.categories).toHaveLength(1);
        expect(result.categories[0]).toMatchObject({
            categorySlug: ELIGIBLE,
            total: 5,
            renderable: 1,
            indexable: 1,
            sitemapEligible: true,
        });
    });

    test('render gate boundary: rows below MIN_JOBS_FOR_CATEGORY_CITY never count', () => {
        const result = computeCategoryCityCoverage({
            totalsByCategory: new Map([[ELIGIBLE, 2]]),
            renderableRows: [
                coverageRow({ totalJobs: MIN_JOBS_FOR_CATEGORY_CITY - 1, locationSlug: 'big-city' }),
                coverageRow({ totalJobs: MIN_JOBS_FOR_CATEGORY_CITY, locationSlug: 'floor-city' }),
            ],
            populationBySlug: POPULATIONS,
            now: NOW,
        });

        expect(result.categories[0].renderable).toBe(1);
        expect(result.categories[0].indexable).toBe(1);
    });

    test('population floor: below-floor and unknown cities render but are not indexable', () => {
        const result = computeCategoryCityCoverage({
            totalsByCategory: new Map([[ELIGIBLE, 3]]),
            renderableRows: [
                coverageRow({ locationSlug: 'small-town' }),
                coverageRow({ locationSlug: 'city-with-no-population-data' }),
                coverageRow({ locationSlug: 'floor-city' }),
            ],
            populationBySlug: POPULATIONS,
            now: NOW,
        });

        expect(result.categories[0].renderable).toBe(3);
        expect(result.categories[0].indexable).toBe(1); // only floor-city
    });

    test('staleness gate: stale rows render but are not indexable', () => {
        const result = computeCategoryCityCoverage({
            totalsByCategory: new Map([[ELIGIBLE, 1]]),
            renderableRows: [coverageRow({ updatedAt: STALE })],
            populationBySlug: POPULATIONS,
            now: NOW,
        });

        expect(result.categories[0].renderable).toBe(1);
        expect(result.categories[0].indexable).toBe(0);
    });

    test('state-ineligible categories render but never index', () => {
        const result = computeCategoryCityCoverage({
            totalsByCategory: new Map([[INELIGIBLE, 1]]),
            renderableRows: [coverageRow({ categorySlug: INELIGIBLE })],
            populationBySlug: POPULATIONS,
            now: NOW,
        });

        expect(result.categories[0]).toMatchObject({ renderable: 1, indexable: 0, sitemapEligible: false });
    });

    test('categories with zero renderable combos still appear with their totals', () => {
        const result = computeCategoryCityCoverage({
            totalsByCategory: new Map([[ELIGIBLE, 42]]),
            renderableRows: [],
            populationBySlug: POPULATIONS,
            now: NOW,
        });

        expect(result.categories[0]).toMatchObject({ total: 42, renderable: 0, indexable: 0 });
        expect(result.totals).toEqual({ total: 42, renderable: 0, indexable: 0 });
    });

    test('totals aggregate across categories', () => {
        const result = computeCategoryCityCoverage({
            totalsByCategory: new Map([[ELIGIBLE, 10], [INELIGIBLE, 4]]),
            renderableRows: [
                coverageRow(),
                coverageRow({ locationSlug: 'floor-city' }),
                coverageRow({ categorySlug: INELIGIBLE }),
            ],
            populationBySlug: POPULATIONS,
            now: NOW,
        });

        expect(result.totals).toEqual({ total: 14, renderable: 3, indexable: 2 });
    });
});

describe('computeSettingStateCoverage', () => {
    test('renderable needs ≥1 job; indexable additionally needs freshness', () => {
        const result = computeSettingStateCoverage(
            [
                { totalJobs: 0, updatedAt: FRESH }, // not renderable
                { totalJobs: 1, updatedAt: FRESH }, // renderable + indexable
                { totalJobs: 5, updatedAt: STALE }, // renderable only
            ],
            NOW,
        );
        expect(result).toEqual({ total: 3, renderable: 2, indexable: 1 });
    });
});

describe('pseoFreshnessThreshold', () => {
    test('cutoff is exactly PSEO_STALENESS_HOURS before now', () => {
        const cutoff = pseoFreshnessThreshold(NOW);
        expect(NOW.getTime() - cutoff.getTime()).toBe(PSEO_STALENESS_HOURS * 60 * 60 * 1000);
    });
});

describe('drift guards — mirrored constants match the sitemap index route', () => {
    const routeSource = readFileSync(
        path.join(process.cwd(), 'app', 'api', 'sitemaps', 'index', 'route.ts'),
        'utf-8',
    );

    function routeConstant(name: string): number {
        const match = routeSource.match(new RegExp(`const ${name} = (\\d+);`));
        expect(match, `expected "const ${name} = <n>;" in app/api/sitemaps/index/route.ts`).not.toBeNull();
        return Number(match![1]);
    }

    test('MIN_SITEMAP_JOBS mirrors the route', () => {
        expect(MIN_SITEMAP_JOBS).toBe(routeConstant('MIN_SITEMAP_JOBS'));
    });

    test('MIN_SITEMAP_POPULATION mirrors the route', () => {
        expect(MIN_SITEMAP_POPULATION).toBe(routeConstant('MIN_SITEMAP_POPULATION'));
    });

    test('PSEO_STALENESS_HOURS mirrors the route', () => {
        expect(PSEO_STALENESS_HOURS).toBe(routeConstant('PSEO_STALENESS_HOURS'));
    });

    // The two constants are independently owned (render gate vs sitemap
    // floor) and happen to both be 3 today — pinning them equal would fail
    // spuriously if the render gate moved. What must never break is the
    // subset invariant: the sitemap may only advertise URLs that render.
    // If MIN_SITEMAP_JOBS ever dropped below the render gate, the sitemap
    // would list combos whose pages 404, and the coverage panel's
    // indexable count (derived from render-gate-filtered rows) would
    // silently under-report.
    test('sitemap job floor never falls below the render gate (indexable ⊆ renderable)', () => {
        expect(MIN_SITEMAP_JOBS).toBeGreaterThanOrEqual(MIN_JOBS_FOR_CATEGORY_CITY);
    });
});

describe('drift guards — wiring', () => {
    test('gsc-health-check cron uses the shared lib/gsc-client', () => {
        const cronSource = readFileSync(
            path.join(process.cwd(), 'app', 'api', 'cron', 'gsc-health-check', 'route.ts'),
            'utf-8',
        );
        expect(cronSource).toContain("from '@/lib/gsc-client'");
        expect(cronSource).toContain('fetchSitemapsList');
        expect(cronSource).toContain('buildSitemapAlerts');
        expect(cronSource).toContain('fetchSearchAnalyticsByDimension');
    });

    // Movers math reads a key's absence from a window as a signal, so the
    // depth of the dimension pull is a correctness input, not a volume knob.
    // Letting the cron fall back to the client default (as it once did) is
    // exactly how a shallow cut silently turned rank churn into phantom
    // "0 → 50" movers.
    test('gsc-health-check passes an explicit dimension row limit on every window', () => {
        const cronSource = readFileSync(
            path.join(process.cwd(), 'app', 'api', 'cron', 'gsc-health-check', 'route.ts'),
            'utf-8',
        );
        expect(cronSource).toContain('GSC_DIMENSION_ROW_LIMIT');

        const dimensionCalls = cronSource.match(/fetchSearchAnalyticsByDimension\([^)]*\)/g) ?? [];
        expect(dimensionCalls).toHaveLength(4);
        for (const call of dimensionCalls) {
            expect(call).toContain('rowLimit');
        }
    });

    test('the dimension row limit is deep enough to matter and inside the API cap', () => {
        expect(GSC_DIMENSION_ROW_LIMIT).toBeGreaterThanOrEqual(1_000);
        expect(GSC_DIMENSION_ROW_LIMIT).toBeLessThanOrEqual(GSC_MAX_ROW_LIMIT);
        expect(GSC_MAX_ROW_LIMIT).toBe(25_000);
    });

    test('admin seo-health page renders coverage + movers from the shared libs', () => {
        const pageSource = readFileSync(
            path.join(process.cwd(), 'app', 'admin', 'seo-health', 'page.tsx'),
            'utf-8',
        );
        expect(pageSource).toContain("from '@/lib/gsc-coverage'");
        expect(pageSource).toContain("from '@/lib/gsc-movers'");
        expect(pageSource).toContain('computeCategoryCityCoverage');
        expect(pageSource).toContain('computeMovers');
    });
});
