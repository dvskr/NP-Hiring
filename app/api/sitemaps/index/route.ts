/**
 * Sitemap Index — lists the primary sitemap and all city sitemap batches.
 *
 * DB-driven: batch count is calculated from pseoStats (matching the per-batch
 * route at /api/sitemaps/cities/[batch]) so the index and batches always
 * agree on how many URLs are emitted. The two routes share thresholds and
 * gating so a stale index never points at empty batches.
 *
 * Each child's <lastmod> is the newest lastmod inside that child (indexing
 * audit CS-02), read from content the same way the child dates its URLs
 * (app/api/sitemaps/lastmod.ts). A child whose content date cannot be read
 * carries no <lastmod>: the old fallback, "today" on every child, told Google
 * every sitemap changed on every fetch.
 *
 * Route: /api/sitemaps/index
 */
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { activeIndexableJobWhere } from '@/lib/active-job-filter';
import { CITIES } from '@/lib/pseo/city-data/cities';
import { brand } from '@/config/brand';
import { CITY_ELIGIBLE_CATEGORY_SLUGS } from '@/lib/pseo/taxonomy-registry';
import { getAllSettingSlugs, getAllStateSlugs } from '@/lib/pseo/setting-state-config';
import {
  isSettingStateIndexable,
  pseoStatsFreshnessThreshold,
  SETTING_STATE_INDEXING_ENABLED,
  shouldIndexLocalListingPage,
} from '@/lib/pseo/render-gate';
import { getAllPublishedSlugs } from '@/lib/blog';
import { getLicenseGuideReviewedAt, isBlogSlugIndexable } from '@/lib/blog-license-guides';
import { LICENSE_GUIDE_SLUG_REGEX } from '@/config/niche/content-map';
import { COMPARE_REVIEW_DATE } from '@/lib/compare-data';
import { latestJobContentDate, latestOf, lastmodTag, newestPageContentDate } from '@/app/api/sitemaps/lastmod';
import { listingContentDates, type ListingUrlKey } from '@/app/api/sitemaps/listing-lastmod';
import { JOB_BATCH_SIZE, jobBatchContentDates } from '@/app/api/sitemaps/job-batches';
import { SITEMAP_CACHE_CONTROL } from '@/app/api/sitemaps/cache-control';

// Category set comes from the drift-guarded registry and MUST be the same
// CITY_ELIGIBLE_CATEGORY_SLUGS export that cities/[batch]/route.ts emits
// against. This route previously imported the 28-slug STATE-eligible subset
// while the batch route emitted all 45 city-eligible slugs — the index
// undercounted URLs, so tail batches (carrying the setting×state URLs
// appended last) existed but were never listed here, and their URLs were
// never submitted to Google. Import parity is pinned by
// tests/regressions/p6-sitemap-parity-index-batch.test.ts.
const SITEMAP_CATEGORY_SET = new Set(CITY_ELIGIBLE_CATEGORY_SLUGS);
const CITY_POPULATION_LOOKUP = new Map<string, number>(
  CITIES.map(c => [c.slug, c.population])
);

const BATCH_SIZE = 10000;
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || brand.baseUrl;

// Mirror of the gating in cities/[batch]/route.ts. If you change either,
// change both: the two routes must agree exactly, or the index advertises
// batches the batch route never fills (or hides ones it does).
const MIN_SITEMAP_POPULATION = 10000;

/** The PseoStats columns the gates read, typed locally (see readFreshStatsRows). */
interface PseoStatsRow {
  categorySlug: string;
  locationSlug: string;
  totalJobs: number;
  distinctEmployers: number;
  indexable: boolean;
}

/**
 * Fresh PseoStats rows of one type, in the batch route's order (so the index
 * can date each batch by the URLs it holds). WHY RAW: the generated Prisma
 * client predates the distinctEmployers and indexable columns and must not be
 * regenerated on this branch, so the gate columns are only reachable through
 * a $queryRaw tagged template (parameterized; column names are literals).
 */
async function readFreshStatsRows(type: 'category-city' | 'setting-state'): Promise<PseoStatsRow[]> {
  const rows = await prisma.$queryRaw<PseoStatsRow[]>`
    SELECT "categorySlug", "locationSlug", "totalJobs", "distinctEmployers", "indexable"
    FROM "PseoStats"
    WHERE "type" = ${type}
      AND "updatedAt" >= ${pseoStatsFreshnessThreshold()}
    ORDER BY "categorySlug", "locationSlug"`;
  return Array.isArray(rows) ? rows : [];
}

/**
 * The newest lastmod app/sitemap.ts gives a blog URL: a listed post's
 * updated_at, or for an indexable license guide the later of that and its
 * review date. Posts the sitemap leaves out (noindexed guides) do not count.
 */
async function newestListedBlogDate(): Promise<Date | null> {
  const rows = await getAllPublishedSlugs();
  return latestOf(
    ...rows
      .filter((row) => isBlogSlugIndexable(row.slug))
      .map((row) => {
        const updated = new Date(row.updated_at);
        const guideState = row.slug.match(LICENSE_GUIDE_SLUG_REGEX)?.[1];
        return guideState ? latestOf(updated, new Date(getLicenseGuideReviewedAt(guideState))) : updated;
      }),
  );
}

/**
 * /sitemap.xml's newest lastmod: its listing pages are dated by the newest
 * content change among live jobs (a subset of this aggregate), its posts by
 * the blog, its code-authored pages by their copy dates and the comparison
 * pages by COMPARE_REVIEW_DATE. Null (no <lastmod>) when a read fails.
 */
async function primarySitemapLastmod(): Promise<Date | null> {
  try {
    const [jobs, blog] = await Promise.all([latestJobContentDate(activeIndexableJobWhere()), newestListedBlogDate()]);
    return latestOf(jobs, blog, newestPageContentDate(), new Date(`${COMPARE_REVIEW_DATE}T00:00:00.000Z`));
  } catch (error) {
    console.error('[sitemaps/index] primary sitemap lastmod unavailable; omitting it:', error);
    return null;
  }
}

/** The newest lastmod in each cities batch, over the batch's own URLs. */
async function citiesBatchLastmods(keys: readonly ListingUrlKey[], totalBatches: number): Promise<Array<Date | null>> {
  const batches = Array.from({ length: totalBatches }, (_, i) => keys.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE));
  const dates = await Promise.all(batches.map((batch) => listingContentDates(batch)));
  return dates.map((batchDates) => latestOf(...batchDates));
}

function sitemapEntry(loc: string, lastmod: Date | null): string {
  return `  <sitemap>
    <loc>${loc}</loc>${lastmodTag(lastmod)}
  </sitemap>`;
}

export async function GET() {
  // DB-driven: count how many URLs the batch route will actually emit.
  // Must match the pruning logic in cities/[batch]/route.ts exactly: both
  // routes read the same fresh PseoStats rows and apply the same gates (the
  // stored verdict plus shouldIndexLocalListingPage for category x city;
  // nothing while SETTING_STATE_INDEXING_ENABLED is off, then the stored
  // verdict through isSettingStateIndexable, for setting x state), so the
  // index never over- or under-reports the batch count.
  // Set when any count query fails. A degraded render must not be cached,
  // because the CDN would otherwise serve a wrong sitemap index for the whole
  // max-age window from a single transient failure.
  let degraded = false;
  let totalUrls = 0;
  let cityKeys: ListingUrlKey[] = [];
  try {
    const keys: ListingUrlKey[] = [];
    const categoryCityRows = await readFreshStatsRows('category-city');
    for (const row of categoryCityRows) {
      if (!row.indexable) continue;
      if (!shouldIndexLocalListingPage({ activeJobs: row.totalJobs, distinctEmployers: row.distinctEmployers })) continue;
      if (!SITEMAP_CATEGORY_SET.has(row.categorySlug)) continue;
      const population = CITY_POPULATION_LOOKUP.get(row.locationSlug);
      if (population === undefined || population < MIN_SITEMAP_POPULATION) continue;
      keys.push({ type: 'category-city', categorySlug: row.categorySlug, locationSlug: row.locationSlug });
    }

    // FB-1: the batch route skips the setting x state section while the
    // switch is off, so the index does not read it either.
    if (SETTING_STATE_INDEXING_ENABLED) {
      const validStateSlugs = new Set(getAllStateSlugs());
      const settingSlugs = new Set(getAllSettingSlugs());
      const settingStateRows = await readFreshStatsRows('setting-state');
      for (const row of settingStateRows) {
        if (!isSettingStateIndexable(row.indexable)) continue;
        if (!settingSlugs.has(row.categorySlug)) continue;
        if (!validStateSlugs.has(row.locationSlug)) continue;
        keys.push({ type: 'setting-state', categorySlug: row.categorySlug, locationSlug: row.locationSlug });
      }
    }
    cityKeys = keys;
    totalUrls = keys.length;
  } catch {
    // Advertise nothing we cannot serve. The batch route answers the SAME
    // failure by returning an empty URL list and 404ing every batch above 0,
    // so an estimate here (it used to guess categories multiplied by cities)
    // advertises batches that 404, which Search Console reports as "sitemap
    // could not be read". Zero lists no city batch at all for this
    // (uncached) render.
    degraded = true;
    totalUrls = 0;
    cityKeys = [];
  }

  // No floor (FB-1): a cities batch with no URL is an empty urlset, which
  // Search Console reports as a sitemap with no entries, so the index lists
  // a batch only when it carries URLs. The batch route still answers 200
  // with an empty urlset for batch 0, so a previously seen URL never 404s.
  const totalBatches = Math.ceil(totalUrls / BATCH_SIZE);

  // GSC Fix (P3.8): jobs-batch count. Splitting job-detail URLs into
  // /api/sitemaps/jobs/{N} keeps each file under the 50K-URL cap so the
  // sitemap is never rejected wholesale once ingestion volume scales.
  // JOB_BATCH_SIZE is the batch route's own constant (job-batches.ts).
  const activeJobWhere = activeIndexableJobWhere();
  let activeJobCount = 0;
  try {
    // #3 fix: use the SAME filter the batch route uses (includes the
    // healthConsecutiveMissing dead-link gate) so the index never advertises
    // more job batches than /api/sitemaps/jobs/[batch] actually serves.
    activeJobCount = await prisma.job.count({ where: activeJobWhere });
  } catch {
    // Zero job batches hides every job URL from discovery, so this render is
    // degraded too and must not be frozen in the CDN for the cache window.
    degraded = true;
    activeJobCount = 0;
  }
  const totalJobBatches = activeJobCount > 0
    ? Math.max(1, Math.ceil(activeJobCount / JOB_BATCH_SIZE))
    : 0;

  // Each child's lastmod: the newest lastmod inside it. A failed read omits
  // the child's lastmod; it never degrades the index or drops a child.
  const [primaryLastmod, cityLastmods, jobLastmods] = await Promise.all([
    primarySitemapLastmod(),
    citiesBatchLastmods(cityKeys, totalBatches),
    jobBatchContentDates(activeJobWhere, totalJobBatches).catch((error: unknown) => {
      console.error('[sitemaps/index] job batch lastmods unavailable; omitting them:', error);
      return [] as Array<Date | null>;
    }),
  ]);

  // Build sitemap entries: 1 primary + N city batches + M job batches
  const sitemaps = [sitemapEntry(`${BASE_URL}/sitemap.xml`, primaryLastmod)];

  for (let i = 0; i < totalBatches; i++) {
    sitemaps.push(sitemapEntry(`${BASE_URL}/api/sitemaps/cities/${i}`, cityLastmods[i] ?? null));
  }

  for (let i = 0; i < totalJobBatches; i++) {
    sitemaps.push(sitemapEntry(`${BASE_URL}/api/sitemaps/jobs/${i}`, jobLastmods[i] ?? null));
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemaps.join('\n')}
</sitemapindex>`;

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': degraded
        ? 'no-store'
        : SITEMAP_CACHE_CONTROL,
    },
  });
}
