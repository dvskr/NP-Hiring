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
import {
  isSettingStateIndexable,
  pseoStatsFreshnessThreshold,
  SETTING_STATE_INDEXING_ENABLED,
  shouldIndexLocalListingPage,
} from '@/lib/pseo/render-gate';
import { lastmodTag } from '@/app/api/sitemaps/lastmod';
import { listingContentDates, type ListingUrlKey } from '@/app/api/sitemaps/listing-lastmod';
import { SITEMAP_CACHE_CONTROL } from '@/app/api/sitemaps/cache-control';

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
//   Category x City: the row's stored `indexable` verdict (the cron counts
//     distinct postings) AND shouldIndexLocalListingPage over the row's
//     totalJobs and distinctEmployers (the listing floor: 5 or more jobs
//     from 3 or more employers), so a row written before a floor change
//     can never admit a URL the page now noindexes.
//   Setting x State: nothing while SETTING_STATE_INDEXING_ENABLED is off
//     (FB-1: the section is not even read); once it is on, the row's stored
//     strict verdict through isSettingStateIndexable, the function the page
//     robots call.
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
}

/**
 * Fresh PseoStats rows of one type, in a stable order, so a URL keeps its
 * batch from one request to the next and the index can date each batch.
 *
 * WHY RAW: the generated Prisma client predates the `distinctEmployers` and
 * `indexable` columns (prisma/migrations/20260916120000_pseo_stats_index_gate)
 * and must not be regenerated on this branch, so the two gate columns are
 * only reachable through a $queryRaw tagged template (parameterized; the
 * column names are literals). A non-array result (an unmocked client in
 * tests) reads as no rows. updatedAt is the freshness filter only: it is the
 * cron's heartbeat, never a lastmod (see app/api/sitemaps/listing-lastmod.ts).
 */
async function readFreshStatsRows(filter: { type: StatsRowType }): Promise<PseoStatsRow[]> {
  const rows = await prisma.$queryRaw<PseoStatsRow[]>`
    SELECT "categorySlug", "locationSlug", "totalJobs", "distinctEmployers", "indexable"
    FROM "PseoStats"
    WHERE "type" = ${filter.type}
      AND "updatedAt" >= ${pseoStatsFreshnessThreshold()}
    ORDER BY "categorySlug", "locationSlug"`;
  return Array.isArray(rows) ? rows : [];
}

// Generate only URLs whose page indexes, plus state-level pSEO URLs. All
// gating is driven by PseoStats so the sitemap never disagrees with the
// page-level noindex gate.
async function getActiveCategoryCityUrls(): Promise<ListingUrlKey[]> {
  const urls: ListingUrlKey[] = [];
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
      if (!row.indexable) continue;
      if (!shouldIndexLocalListingPage({ activeJobs: row.totalJobs, distinctEmployers: row.distinctEmployers })) continue;
      // Defense in depth against stale aggregator rows whose slugs were
      // retired or whose underlying city no longer meets the population gate.
      if (!SITEMAP_CATEGORY_SET.has(row.categorySlug)) continue;
      const population = CITY_POPULATION_LOOKUP.get(row.locationSlug);
      if (population === undefined || population < MIN_SITEMAP_POPULATION) continue;
      urls.push({ type: 'category-city', categorySlug: row.categorySlug, locationSlug: row.locationSlug });
    }
  } catch (err) {
    // If PseoStats is empty/unreachable, skip category x city URLs entirely.
    // Better to omit than to flood the sitemap with dead URLs again.
    console.error('[sitemaps/cities] PseoStats category-city lookup failed; omitting category x city URLs:', err);
  }

  // Setting x State URLs. FB-1: while SETTING_STATE_INDEXING_ENABLED is off
  // the whole section is skipped (every such page renders noindex, follow).
  // Once it is on, a row is emitted only when isSettingStateIndexable
  // accepts its stored strict verdict (shouldIndexSettingState, written by
  // the cron), the same call the page robots make.
  // GSC Fix (P1.1): previously emitted all settings x 51 states
  // unconditionally. Most had 0 matching jobs and 404'd, polluting GSC with
  // "Not found" entries.
  if (!SETTING_STATE_INDEXING_ENABLED) return urls;
  try {
    const settingStateRows = await readFreshStatsRows({ type: 'setting-state' });
    for (const row of settingStateRows) {
      if (!isSettingStateIndexable(row.indexable)) continue;
      if (!settingSlugs.has(row.categorySlug)) continue;
      if (!validStateSlugs.has(row.locationSlug)) continue;
      urls.push({ type: 'setting-state', categorySlug: row.categorySlug, locationSlug: row.locationSlug });
    }
  } catch (err) {
    console.error('[sitemaps/cities] PseoStats setting-state lookup failed; omitting setting x state URLs:', err);
  }

  return urls;
}

/** The public URL of a listed page. */
function locOf(key: ListingUrlKey): string {
  return key.type === 'category-city'
    ? `${BASE_URL}/jobs/${key.categorySlug}/city/${key.locationSlug}`
    : `${BASE_URL}/jobs/${key.categorySlug}/${key.locationSlug}`;
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

  // CS-02: each URL is dated by the newest content change among the jobs its
  // page lists (listingContentDates), not by PseoStats.updatedAt, which the
  // cron rewrites every six hours whether or not the listing changed. No
  // changefreq or priority: Google ignores both (GFJ-10).
  const lastmods = await listingContentDates(batchUrls);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${batchUrls.map((key, i) => `  <url>
    <loc>${locOf(key)}</loc>${lastmodTag(lastmods[i])}
  </url>`).join('\n')}
</urlset>`;

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': SITEMAP_CACHE_CONTROL,
    },
  });
}
