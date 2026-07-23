/**
 * Batched city sitemap — serves category × city URLs in batches of 10,000.
 * 
 * DB-DRIVEN: Only emits URLs where actual published, non-expired jobs exist
 * for the category+city+state combination. This prevents submitting tens of
 * thousands of empty pages to Google (which was the root cause of most GSC
 * coverage issues).
 * 
 * Categories come from the taxonomy registry's CITY-eligible set (all 42
 * slugs — lib/pseo/taxonomy-registry.ts). Also includes state-level URLs
 * for the 21 state-eligible settings.
 *
 * Routes:
 *   /api/sitemaps/cities/0 → first 10K URLs
 *   /api/sitemaps/cities/1 → next 10K URLs
 *   etc.
 */
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { CITIES } from '@/lib/pseo/city-data/cities';
import { getAllSettingSlugs, getAllStateSlugs } from '@/lib/pseo/setting-state-config';
import { brand } from '@/config/brand';
import { CITY_ELIGIBLE_CATEGORY_SLUGS } from '@/lib/pseo/taxonomy-registry';

// Category set comes from the drift-guarded registry. The category×city
// surface is CITY-eligible (all 42 slugs — see taxonomy-registry.ts), not
// the 21-slug STATE-eligible subset this route previously used, which left
// half the category×city surface with zero sitemap presence. The pseoStats
// job-count/freshness gates below still prune empty combos, so widening the
// allow-list only admits pages that genuinely render and index.
const SITEMAP_CATEGORIES = CITY_ELIGIBLE_CATEGORY_SLUGS;

const BATCH_SIZE = 10000;
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || brand.baseUrl;

// City slug → population lookup. Used as a defense-in-depth filter on top of
// pseoStats — small towns can technically have ≥3 jobs but won't rank on
// generic queries, so we cap to cities with population ≥ 10K.
const CITY_POPULATION_LOOKUP = new Map<string, number>(
  CITIES.map(c => [c.slug, c.population])
);

// Allow-list of category slugs the sitemap is permitted to emit. Mirrors the
// PSEO category surface; we cross-check pseoStats rows against this set so a
// stale aggregator row for a retired category can't leak into the sitemap.
const SITEMAP_CATEGORY_SET = new Set(SITEMAP_CATEGORIES);

// ═══ DYNAMIC SITEMAP PRUNING ═══
// Only emit URLs that meet quality thresholds — must mirror the page-level
// gates exactly so we never advertise a URL that renders noindex:
//   • Category × City: pseoStats.totalJobs ≥ MIN_SITEMAP_JOBS (matches
//     MIN_JOBS_FOR_INDEX = 3 in lib/pseo/category-city-template.tsx)
//   • Setting × State: pseoStats.totalJobs ≥ 1 (state pages render content
//     even at low counts since state-level demand is broader)
//   • City population ≥ MIN_SITEMAP_POPULATION (defense-in-depth)
//   • pseoStats row must be fresh (≤ 36h since last aggregator run)
const MIN_SITEMAP_JOBS = 3;
const MIN_SITEMAP_POPULATION = 10000;

// 36h = 6x the 6h aggregate-pseo cron cadence ("15 0,6,12,18 * * *" in
// vercel.json / config/cron-schedule.ts). Allows several missed runs without
// dropping URLs from the sitemap; catches sustained aggregator failure
// before Google indexes pages whose underlying jobs already expired.
const PSEO_STALENESS_HOURS = 36;

// One sitemap entry: canonical URL + the pseoStats row's real refresh time.
interface SitemapEntry {
  loc: string;
  lastmod: string; // YYYY-MM-DD
}

// B27: lastmod comes from the pseoStats row's updatedAt (when the aggregator
// last recomputed that page's inventory) instead of "today" on every request.
// Fabricated always-fresh lastmod erodes Google's trust in the signal
// site-wide and burns crawl budget re-fetching pages that never changed.
const toLastmod = (d: Date): string => d.toISOString().split('T')[0];

// Generate only URLs where sufficient jobs exist in quality cities, plus
// state-level pSEO URLs. All gating is driven by pseoStats so the sitemap
// never disagrees with the page-level noindex gate.
async function getActiveCategoryCityUrls(): Promise<SitemapEntry[]> {
  const urls: SitemapEntry[] = [];
  const freshnessThreshold = new Date(Date.now() - PSEO_STALENESS_HOURS * 60 * 60 * 1000);
  const validStateSlugs = new Set(getAllStateSlugs());
  const settingSlugs = new Set(getAllSettingSlugs());

  // Category × City URLs — quality-gated via pseoStats.
  // SEO Fix (audit Item #11): previously used a city-level Job groupBy that
  // ignored category. A city with 10 total jobs but 0 "Remote" jobs would
  // still get /jobs/remote/city/{slug} into the sitemap, despite the page
  // rendering noindex (per-category count < 3). pseoStats is per-(category,
  // city) so the sitemap and page-level gate now agree exactly.
  try {
    const categoryCityRows = await prisma.pseoStats.findMany({
      where: {
        type: 'category-city',
        totalJobs: { gte: MIN_SITEMAP_JOBS },
        updatedAt: { gte: freshnessThreshold },
      },
      select: { categorySlug: true, locationSlug: true, updatedAt: true },
    });
    for (const row of categoryCityRows) {
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
    // If pseoStats is empty/unreachable, skip category×city URLs entirely.
    // Better to omit than to flood the sitemap with dead URLs again.
    console.error('[sitemaps/cities] pseoStats category-city lookup failed; omitting category×city URLs:', err);
  }

  // Setting × State URLs — quality-gated via pseoStats.
  // GSC Fix (P1.1): previously emitted all 13 settings × 51 states = 663 URLs
  // unconditionally. Most had 0 matching jobs and 404'd, polluting GSC with
  // "Not found" entries. Now only emit URLs where ≥1 active job exists.
  try {
    const settingStateRows = await prisma.pseoStats.findMany({
      where: {
        type: 'setting-state',
        totalJobs: { gte: 1 },
        updatedAt: { gte: freshnessThreshold },
      },
      select: { categorySlug: true, locationSlug: true, updatedAt: true },
    });
    for (const row of settingStateRows) {
      if (!settingSlugs.has(row.categorySlug)) continue;
      if (!validStateSlugs.has(row.locationSlug)) continue;
      urls.push({
        loc: `${BASE_URL}/jobs/${row.categorySlug}/${row.locationSlug}`,
        lastmod: toLastmod(row.updatedAt),
      });
    }
  } catch (err) {
    console.error('[sitemaps/cities] pseoStats setting-state lookup failed; omitting setting×state URLs:', err);
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

  // DB-driven: only emit URLs where jobs actually exist
  const allUrls = await getActiveCategoryCityUrls();
  const totalBatches = Math.ceil(allUrls.length / BATCH_SIZE) || 1;

  if (batchIndex >= totalBatches) {
    return NextResponse.json({ error: 'Invalid batch index' }, { status: 404 });
  }

  const start = batchIndex * BATCH_SIZE;
  const end = Math.min(start + BATCH_SIZE, allUrls.length);
  const batchUrls = allUrls.slice(start, end);

  // B27: per-URL lastmod from pseoStats.updatedAt — see toLastmod above.
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
