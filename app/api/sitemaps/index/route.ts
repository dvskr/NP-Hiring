/**
 * Sitemap Index — lists the primary sitemap and all city sitemap batches.
 *
 * DB-driven: batch count is calculated from pseoStats (matching the per-batch
 * route at /api/sitemaps/cities/[batch]) so the index and batches always
 * agree on how many URLs are emitted. The two routes share thresholds and
 * gating so a stale index never points at empty batches.
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
import { pseoStatsFreshnessThreshold, shouldIndexLocalListingPage } from '@/lib/pseo/render-gate';

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
// Mirrors the constant in /api/sitemaps/jobs/[batch]/route.ts — must stay
// in lockstep so the index reports the right batch count.
const JOB_BATCH_SIZE = 25000;
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
 * Fresh PseoStats rows of one type. WHY RAW: the generated Prisma client
 * predates the distinctEmployers and indexable columns and must not be
 * regenerated on this branch, so the gate columns are only reachable through
 * a $queryRaw tagged template (parameterized; column names are literals).
 */
async function readFreshStatsRows(type: 'category-city' | 'setting-state'): Promise<PseoStatsRow[]> {
  const rows = await prisma.$queryRaw<PseoStatsRow[]>`
    SELECT "categorySlug", "locationSlug", "totalJobs", "distinctEmployers", "indexable"
    FROM "PseoStats"
    WHERE "type" = ${type}
      AND "updatedAt" >= ${pseoStatsFreshnessThreshold()}`;
  return Array.isArray(rows) ? rows : [];
}

export async function GET() {
  // SEO Fix #17: lastmod must reflect actual freshness, not "today". Using
  // today's date on every request signals to Google that every child sitemap
  // changed today — when most haven't — eroding the credibility of lastmod
  // signals across the entire site. Anchor to the latest job updatedAt with
  // the request day as a conservative ceiling.
  let lastmod = new Date().toISOString().split('T')[0];
  try {
    const latestJob = await prisma.job.findFirst({
      where: { isPublished: true },
      orderBy: { updatedAt: 'desc' },
      select: { updatedAt: true },
    });
    if (latestJob?.updatedAt) {
      lastmod = latestJob.updatedAt.toISOString().split('T')[0];
    }
  } catch {
    // fall back to today; underspecifying lastmod is safer than over-claiming
  }

  // DB-driven: count how many URLs the batch route will actually emit.
  // Must match the pruning logic in cities/[batch]/route.ts exactly: both
  // routes read the same fresh PseoStats rows and apply the same gates
  // (shouldIndexLocalListingPage for category x city, the stored indexable
  // verdict for setting x state), so the index never over- or under-reports
  // the batch count.
  // Set when any count query fails. A degraded render must not be cached,
  // because the CDN would otherwise serve a wrong sitemap index for the whole
  // max-age window from a single transient failure.
  let degraded = false;
  let totalUrls = 0;
  try {
    const categoryCityRows = await readFreshStatsRows('category-city');
    for (const row of categoryCityRows) {
      if (!shouldIndexLocalListingPage({ activeJobs: row.totalJobs, distinctEmployers: row.distinctEmployers })) continue;
      if (!SITEMAP_CATEGORY_SET.has(row.categorySlug)) continue;
      const population = CITY_POPULATION_LOOKUP.get(row.locationSlug);
      if (population === undefined || population < MIN_SITEMAP_POPULATION) continue;
      totalUrls++;
    }

    const validStateSlugs = new Set(getAllStateSlugs());
    const settingSlugs = new Set(getAllSettingSlugs());
    const settingStateRows = await readFreshStatsRows('setting-state');
    for (const row of settingStateRows) {
      if (!row.indexable) continue;
      if (!settingSlugs.has(row.categorySlug)) continue;
      if (!validStateSlugs.has(row.locationSlug)) continue;
      totalUrls++;
    }
  } catch {
    // Advertise nothing we cannot serve. The batch route answers the SAME
    // failure by returning an empty URL list and 404ing every batch above 0,
    // so an estimate here (it used to guess categories multiplied by cities)
    // advertises batches that 404, which Search Console reports as "sitemap
    // could not be read". Zero leaves exactly the one batch the floor below
    // keeps, and that batch serves an empty urlset rather than a 404.
    degraded = true;
    totalUrls = 0;
  }

  const totalBatches = Math.max(1, Math.ceil(totalUrls / BATCH_SIZE));

  // GSC Fix (P3.8): jobs-batch count. Splitting job-detail URLs into
  // /api/sitemaps/jobs/{N} keeps each file under the 50K-URL cap so the
  // sitemap is never rejected wholesale once ingestion volume scales.
  let activeJobCount = 0;
  try {
    // #3 fix: use the SAME filter the batch route uses (includes the
    // healthConsecutiveMissing dead-link gate) so the index never advertises
    // more job batches than /api/sitemaps/jobs/[batch] actually serves.
    activeJobCount = await prisma.job.count({ where: activeIndexableJobWhere() });
  } catch {
    // Zero job batches hides every job URL from discovery, so this render is
    // degraded too and must not be frozen in the CDN for the cache window.
    degraded = true;
    activeJobCount = 0;
  }
  const totalJobBatches = activeJobCount > 0
    ? Math.max(1, Math.ceil(activeJobCount / JOB_BATCH_SIZE))
    : 0;

  // Build sitemap entries: 1 primary + N city batches + M job batches
  const sitemaps = [
    `  <sitemap>
    <loc>${BASE_URL}/sitemap.xml</loc>
    <lastmod>${lastmod}</lastmod>
  </sitemap>`,
  ];

  for (let i = 0; i < totalBatches; i++) {
    sitemaps.push(`  <sitemap>
    <loc>${BASE_URL}/api/sitemaps/cities/${i}</loc>
    <lastmod>${lastmod}</lastmod>
  </sitemap>`);
  }

  for (let i = 0; i < totalJobBatches; i++) {
    sitemaps.push(`  <sitemap>
    <loc>${BASE_URL}/api/sitemaps/jobs/${i}</loc>
    <lastmod>${lastmod}</lastmod>
  </sitemap>`);
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
        : 'public, max-age=3600, s-maxage=3600',
    },
  });
}
