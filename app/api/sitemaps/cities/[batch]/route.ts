/**
 * Batched city sitemap: serves category x city URLs in batches of 10,000.
 *
 * DB-DRIVEN: only emits URLs whose PseoStats row says the page indexes. The
 * rows are written by app/api/cron/aggregate-pseo from the canonical job
 * predicate and carry the index-gate verdicts of lib/pseo/render-gate.ts
 * (PLAN C.2), so a sitemap URL can never be one the page renders noindex,
 * outside the PSEO_STATS_MAX_AGE_HOURS freshness window. Submitting empty or
 * noindex pages was the root cause of most GSC coverage issues.
 *
 * Categories come from the taxonomy registry's CITY-eligible set
 * (all 45 slugs, lib/pseo/taxonomy-registry.ts). Also includes
 * state-level URLs for the 28 state-eligible settings.
 *
 * Routes:
 *   /api/sitemaps/cities/0 first 10K URLs
 *   /api/sitemaps/cities/1 next 10K URLs
 *   etc.
 */
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { CITIES } from '@/lib/pseo/city-data/cities';
import { getAllSettingSlugs, getAllStateSlugs } from '@/lib/pseo/setting-state-config';
import { brand } from '@/config/brand';
import { CITY_ELIGIBLE_CATEGORY_SLUGS } from '@/lib/pseo/taxonomy-registry';
import { pseoStatsFreshnessThreshold, shouldIndexLocalListingPage } from '@/lib/pseo/render-gate';

// Category set comes from the drift-guarded registry. The category x city
// surface is CITY-eligible (all 45 slugs, see taxonomy-registry.ts), not
// the 28-slug STATE-eligible subset this route previously used, which left
// part of the category x city surface with zero sitemap presence. The
// PseoStats index gates below still prune combos that do not index, so
// widening the allow-list only admits pages that genuinely render and index.
const SITEMAP_CATEGORIES = CITY_ELIGIBLE_CATEGORY_SLUGS;

const BATCH_SIZE = 10000;
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || brand.baseUrl;

// City slug to population lookup. Used as a defense-in-depth filter on top
// of PseoStats: small towns can technically clear the index gate but will
// not rank on generic queries, so we cap to cities with population >= 10K.
// A page this filter drops still indexes on its own; it is only not
// advertised here.
const CITY_POPULATION_LOOKUP = new Map<string, number>(
  CITIES.map(c => [c.slug, c.population])
);

// Allow-list of category slugs the sitemap is permitted to emit. Mirrors the
// PSEO category surface; we cross-check PseoStats rows against this set so a
// stale aggregator row for a retired category can't leak into the sitemap.
const SITEMAP_CATEGORY_SET = new Set(SITEMAP_CATEGORIES);

// DYNAMIC SITEMAP PRUNING
// Only emit URLs that clear the page-level index gate, read from the SAME
// function or stored verdict the page robots use (PLAN C.2):
//   Category x City: shouldIndexLocalListingPage over the row's totalJobs
//     and distinctEmployers (3 or more jobs from 2 or more employers).
//   Setting x State: the row's `indexable` flag, the cron's stored verdict
//     of shouldIndexSettingState (3 or more jobs plus two data signals).
//   City population >= MIN_SITEMAP_POPULATION (defense-in-depth).
//   PseoStats row must be fresh: pseoStatsFreshnessThreshold() from
//     lib/pseo/render-gate.ts (PSEO_STATS_MAX_AGE_HOURS, 36h) is the one
//     copy of the window; this route used to carry its own.
const MIN_SITEMAP_POPULATION = 10000;

type StatsRowType = 'category-city' | 'setting-state';

/** The PseoStats columns the gates read, typed locally (see readFreshStatsRows). */
interface PseoStatsRow {
  categorySlug: string;
  locationSlug: string;
  totalJobs: number;
  distinctEmployers: number;
  indexable: boolean;
  updatedAt: Date;
}

/**
 * Fresh PseoStats rows of one type.
 *
 * WHY RAW: the generated Prisma client predates the `distinctEmployers` and
 * `indexable` columns (prisma/migrations/20260916120000_pseo_stats_index_gate)
 * and must not be regenerated on this branch, so the two gate columns are
 * only reachable through a $queryRaw tagged template (parameterized; the
 * column names are literals). A non-array result (an unmocked client in
 * tests) reads as no rows.
 */
async function readFreshStatsRows(filter: { type: StatsRowType }): Promise<PseoStatsRow[]> {
  const rows = await prisma.$queryRaw<PseoStatsRow[]>`
    SELECT "categorySlug", "locationSlug", "totalJobs", "distinctEmployers", "indexable", "updatedAt"
    FROM "PseoStats"
    WHERE "type" = ${filter.type}
      AND "updatedAt" >= ${pseoStatsFreshnessThreshold()}`;
  return Array.isArray(rows) ? rows : [];
}

// One sitemap entry: canonical URL + the PseoStats row's real refresh time.
interface SitemapEntry {
  loc: string;
  lastmod: string; // YYYY-MM-DD
}

// B27: lastmod comes from the PseoStats row's updatedAt (when the aggregator
// last recomputed that page's inventory) instead of "today" on every request.
// Fabricated always-fresh lastmod erodes Google's trust in the signal
// site-wide and burns crawl budget re-fetching pages that never changed.
const toLastmod = (d: Date): string => d.toISOString().split('T')[0];

// Generate only URLs whose page indexes, plus state-level pSEO URLs. All
// gating is driven by PseoStats so the sitemap never disagrees with the
// page-level noindex gate.
async function getActiveCategoryCityUrls(): Promise<SitemapEntry[]> {
  const urls: SitemapEntry[] = [];
  const validStateSlugs = new Set(getAllStateSlugs());
  const settingSlugs = new Set(getAllSettingSlugs());

  // Category x City URLs, gated by shouldIndexLocalListingPage over the
  // row's own counts. SEO Fix (audit Item #11): previously used a
  // city-level Job groupBy that ignored category. A city with 10 total jobs
  // but 0 "Remote" jobs would still get /jobs/remote/city/{slug} into the
  // sitemap, despite the page rendering noindex. PseoStats is per
  // (category, city) so the sitemap and page-level gate agree exactly.
  try {
    const categoryCityRows = await readFreshStatsRows({ type: 'category-city' });
    for (const row of categoryCityRows) {
      if (!shouldIndexLocalListingPage({ activeJobs: row.totalJobs, distinctEmployers: row.distinctEmployers })) continue;
      // Defense in depth against stale aggregator rows whose slugs were
      // retired or whose underlying city no longer meets the population gate.
      if (!SITEMAP_CATEGORY_SET.has(row.categorySlug)) continue;
      const population = CITY_POPULATION_LOOKUP.get(row.locationSlug);
      if (population === undefined || population < MIN_SITEMAP_POPULATION) continue;
      urls.push({
        loc: `${BASE_URL}/jobs/${row.categorySlug}/city/${row.locationSlug}`,
        lastmod: toLastmod(row.updatedAt),
      });
    }
  } catch (err) {
    // If PseoStats is empty/unreachable, skip category x city URLs entirely.
    // Better to omit than to flood the sitemap with dead URLs again.
    console.error('[sitemaps/cities] PseoStats category-city lookup failed; omitting category x city URLs:', err);
  }

  // Setting x State URLs, gated by the row's stored `indexable` verdict.
  // GSC Fix (P1.1): previously emitted all settings x 51 states
  // unconditionally. Most had 0 matching jobs and 404'd, polluting GSC with
  // "Not found" entries. The gate then moved to >= 1 and later >= 3 jobs;
  // the page now also requires two data signals beyond the count
  // (shouldIndexSettingState), and the cron stores that verdict per row, so
  // the sitemap reads the flag instead of re-deriving a count floor.
  try {
    const settingStateRows = await readFreshStatsRows({ type: 'setting-state' });
    for (const row of settingStateRows) {
      if (!row.indexable) continue;
      if (!settingSlugs.has(row.categorySlug)) continue;
      if (!validStateSlugs.has(row.locationSlug)) continue;
      urls.push({
        loc: `${BASE_URL}/jobs/${row.categorySlug}/${row.locationSlug}`,
        lastmod: toLastmod(row.updatedAt),
      });
    }
  } catch (err) {
    console.error('[sitemaps/cities] PseoStats setting-state lookup failed; omitting setting x state URLs:', err);
  }

  return urls;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ batch: string }> }
) {
  const { batch: batchStr } = await params;
  const batchIndex = parseInt(batchStr, 10);

  if (isNaN(batchIndex) || batchIndex < 0) {
    return NextResponse.json({ error: 'Invalid batch index' }, { status: 404 });
  }

  // DB-driven: only emit URLs whose pages index
  const allUrls = await getActiveCategoryCityUrls();
  const totalBatches = Math.ceil(allUrls.length / BATCH_SIZE) || 1;

  if (batchIndex >= totalBatches) {
    return NextResponse.json({ error: 'Invalid batch index' }, { status: 404 });
  }

  const start = batchIndex * BATCH_SIZE;
  const end = Math.min(start + BATCH_SIZE, allUrls.length);
  const batchUrls = allUrls.slice(start, end);

  // B27: per-URL lastmod from PseoStats.updatedAt, see toLastmod above.
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${batchUrls.map(entry => `  <url>
    <loc>${entry.loc}</loc>
    <lastmod>${entry.lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.5</priority>
  </url>`).join('\n')}
</urlset>`;

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}
