/**
 * pSEO URL Indexing Cron
 *
 * Submits the category x city landings the city sitemap advertises to Bing
 * (URL Submission API) and IndexNow, highest value first, and remembers what
 * it sent so the same URL is not offered again for seven days.
 *
 * WHY THERE IS NO GOOGLE LEG. Google restricts its Indexing API to pages that
 * carry JobPosting (or BroadcastEvent) structured data. These landings carry
 * ItemList and Place and no JobPosting, so publishing them there was outside
 * Google's policy, and Google can answer misuse by cutting the quota or
 * revoking Indexing API access for the whole Cloud project. That project also
 * carries the job page publishes from app/api/cron/index-urls and the expired
 * job removals from app/api/cron/deindex-expired, which are in policy and have
 * no substitute. Google still finds these landings through the city sitemaps
 * and the internal link mesh. lib/search-indexing.ts refuses an out of scope
 * URL by itself as well, so putting a Google call back here would publish
 * nothing, and tests/regressions/indexing-safety.test.ts fails before it ships.
 *
 * Strategy:
 * - Candidates pass the same gate as the city sitemap: the job and employer
 *   floors and the freshness window from lib/pseo/render-gate.ts, plus the
 *   population floor below.
 * - Pages are scored (job count, city size, the city's shortage flag) and the
 *   best SUBMISSIONS_PER_RUN that were not offered in the last seven days go
 *   out, highest score first.
 * - A URL is recorded as submitted only when Bing or IndexNow accepted it, so
 *   a run with neither key configured does not bench URLs for a week.
 *
 * Route: GET /api/cron/index-pseo
 * Auth: Bearer ${CRON_SECRET}
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCityBySlug } from '@/lib/pseo/city-data/cities';
import { pingBingBatch, pingIndexNow } from '@/lib/search-indexing';
import { verifyCronOrAdmin } from '@/lib/auth/verify-cron-or-admin';
import { sendCronFailureAlert } from '@/lib/discord-notifier';
import { withCronTracking } from '@/lib/cron/track';
import { logger } from '@/lib/logger';
import { brand } from '@/config/brand';
import { PSEO_INDEXING_CATEGORY_SLUGS } from '@/lib/pseo/taxonomy-registry';
import { Prisma } from '@prisma/client';
import { pseoStatsFreshnessThreshold, shouldIndexLocalListingPage } from '@/lib/pseo/render-gate';

export const maxDuration = 300;

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || brand.baseUrl;

// Only submit broad categories that have meaningful city-level coverage —
// the subset choice lives in the drift-guarded registry.
const PSEO_INDEXING_CATEGORIES = PSEO_INDEXING_CATEGORY_SLUGS;

// Mirrors MIN_SITEMAP_POPULATION in the sitemap routes; the job and employer
// floors and the freshness window come from lib/pseo/render-gate.ts, the same
// module those routes read, so this cron never submits a URL the sitemap
// would not advertise (a page that renders noindex wastes the run's slots and
// benches nothing useful for a week).
const MIN_POPULATION = 10000;

// How many new landings one run offers. It was 100 while Google's quota set
// the pace, and it stays 100 now that Bing does: the Bing URL Submission API
// has its own per site daily quota (shown in Bing Webmaster Tools), and
// app/api/cron/index-urls and lib/ingestion-service.ts spend from that same
// quota, so raising this is a call to make with that number in hand.
const SUBMISSIONS_PER_RUN = 100;

// A landing offered within this window is not offered again.
const RESUBMIT_AFTER_DAYS = 7;

/** The PseoStats columns the sitemap gate reads (see readCandidateRows). */
interface CandidateRow {
  categorySlug: string;
  locationSlug: string;
  totalJobs: number;
  distinctEmployers: number;
}

/**
 * Fresh category-city rows for the submittable categories. WHY RAW: the gate
 * reads distinctEmployers, a column the generated Prisma client predates and
 * that must not be regenerated on this branch (see aggregate-pseo/route.ts).
 * Tagged template: the slug list and the cutoff are bound parameters.
 */
async function readCandidateRows(): Promise<CandidateRow[]> {
  if (PSEO_INDEXING_CATEGORIES.length === 0) return [];
  const rows = await prisma.$queryRaw<CandidateRow[]>`
    SELECT "categorySlug", "locationSlug", "totalJobs", "distinctEmployers"
    FROM "PseoStats"
    WHERE "type" = 'category-city'
      AND "categorySlug" IN (${Prisma.join([...PSEO_INDEXING_CATEGORIES])})
      AND "updatedAt" >= ${pseoStatsFreshnessThreshold()}`;
  return Array.isArray(rows) ? rows : [];
}

interface ScoredUrl {
  url: string;
  categorySlug: string;
  locationSlug: string;
  score: number; // Higher = more important
}

/** Key shared by the candidate list and the 'index-submitted' tracking rows. */
const trackingKey = (categorySlug: string, locationSlug: string): string =>
  `${categorySlug}|${locationSlug}`;

/** Every landing the sitemap gate admits, best first. */
function scoreCandidates(rows: CandidateRow[]): ScoredUrl[] {
  const scoredUrls: ScoredUrl[] = [];

  for (const row of rows) {
    if (!shouldIndexLocalListingPage({ activeJobs: row.totalJobs, distinctEmployers: row.distinctEmployers })) continue;
    const city = getCityBySlug(row.locationSlug);
    if (!city || city.population < MIN_POPULATION) continue;

    // Score: job count (0-40) + population tier (0-20) + shortage flag (0-15)
    let score = Math.min(40, row.totalJobs * 2);
    if (city.population >= 500000) score += 20;
    else if (city.population >= 100000) score += 15;
    else if (city.population >= 50000) score += 10;
    else score += 5;
    if (city.mentalHealthShortage) score += 15;

    scoredUrls.push({
      url: `${BASE_URL}/jobs/${row.categorySlug}/city/${row.locationSlug}`,
      categorySlug: row.categorySlug,
      locationSlug: row.locationSlug,
      score,
    });
  }

  // Sort by score descending — submit highest-value pages first
  return scoredUrls.sort((a, b) => b.score - a.score);
}

/** Tracking keys of every landing offered inside the resubmission window. */
async function readRecentlySubmitted(): Promise<Set<string>> {
  const since = new Date();
  since.setDate(since.getDate() - RESUBMIT_AFTER_DAYS);

  const recentlySubmitted = await prisma.pseoStats.findMany({
    where: {
      type: 'index-submitted',
      updatedAt: { gte: since },
    },
    select: {
      categorySlug: true,
      locationSlug: true,
    },
  });

  return new Set(recentlySubmitted.map(r => trackingKey(r.categorySlug, r.locationSlug)));
}

/**
 * Bench each landing an engine accepted for the resubmission window, and
 * return how many were written. The score rides along in totalJobs so the
 * tracking rows can be read back in priority order.
 */
async function recordSubmitted(submitted: ScoredUrl[]): Promise<number> {
  let recorded = 0;
  let failed = 0;
  for (const su of submitted) {
    try {
      await prisma.pseoStats.upsert({
        where: {
          type_categorySlug_locationSlug: {
            type: 'index-submitted',
            categorySlug: su.categorySlug,
            locationSlug: su.locationSlug,
          },
        },
        update: {
          totalJobs: su.score, // Reuse field to store score
          rawAvgSalary: 0,
          colAdjustedSalary: 0,
        },
        create: {
          type: 'index-submitted',
          categorySlug: su.categorySlug,
          locationSlug: su.locationSlug,
          totalJobs: su.score,
          rawAvgSalary: 0,
          colAdjustedSalary: 0,
        },
      });
      recorded++;
    } catch {
      // Not fatal: an unrecorded landing is simply offered again next run.
      failed++;
    }
  }
  if (failed > 0) {
    console.warn(`[CRON:index-pseo] Could not record ${failed} submitted landings; they will be offered again next run`);
  }
  return recorded;
}

export async function GET(request: NextRequest) {
  const authError = await verifyCronOrAdmin(request);
  if (authError) return authError;

  const startTime = Date.now();
  logger.info('[CRON:index-pseo] Starting pSEO URL submission to Bing and IndexNow');

  try {
    return await withCronTracking('index-pseo', async () => {
    // 1. Get CATEGORY-SPECIFIC job counts from the pre-aggregated stats — the
    // same source the sitemap and the page's own render gate use. The previous
    // implementation counted city-wide totals (groupBy city/state, no category
    // filter), so a city with 10 jobs but 0 in a given category still got
    // /jobs/{category}/city/{slug} submitted — a URL its own render gate 404s —
    // spending the run's submissions on guaranteed 404s.
    const categoryCityRows = await readCandidateRows();

    // 2. Build scored URL list — only pages the sitemap gate admits
    const scoredUrls = scoreCandidates(categoryCityRows);

    // 3. Drop anything offered inside the resubmission window, then take
    //    only up to the cap.
    const submittedSet = await readRecentlySubmitted();
    const newUrls = scoredUrls.filter(
      su => !submittedSet.has(trackingKey(su.categorySlug, su.locationSlug))
    );
    const urlsToSubmit = newUrls.slice(0, SUBMISSIONS_PER_RUN);

    if (urlsToSubmit.length === 0) {
      logger.info('[CRON:index-pseo] All qualifying URLs already submitted within the resubmission window');
      return {
        response: NextResponse.json({
          success: true,
          message: 'All qualifying pSEO URLs already submitted',
          totalQualifying: scoredUrls.length,
          newToSubmit: 0,
          duration: `${((Date.now() - startTime) / 1000).toFixed(1)}s`,
          timestamp: new Date().toISOString(),
        }),
        metrics: {
          totalQualifying: scoredUrls.length,
          newToSubmit: 0,
          submitted: 0,
        },
      };
    }

    const urls = urlsToSubmit.map(su => su.url);

    logger.info('[CRON:index-pseo] Submitting pSEO URLs', {
      submitting: urls.length,
      totalQualifying: scoredUrls.length,
      newToSubmit: newUrls.length,
    });

    // 4. Bing (batch) and IndexNow (batch). Deliberately no Google: see the
    //    header for why these pages must never reach the Indexing API.
    const bingResults = await pingBingBatch(urls);
    const indexNowResults = await pingIndexNow(urls);

    // 5. Track what an engine actually took, so it is not offered again for
    //    the resubmission window. A URL neither engine accepted stays eligible.
    const acceptedUrls = new Set(
      [...bingResults, ...indexNowResults].filter(r => r.success).map(r => r.url)
    );
    const recorded = await recordSubmitted(urlsToSubmit.filter(su => acceptedUrls.has(su.url)));

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const bingSuccess = bingResults.filter(r => r.success).length;
    const bingFailed = bingResults.filter(r => !r.success).length;
    const indexNowSuccess = indexNowResults.filter(r => r.success).length;
    const indexNowFailed = indexNowResults.filter(r => !r.success).length;

    const summary = {
      success: true,
      totalQualifying: scoredUrls.length,
      newToSubmit: newUrls.length,
      submitted: urls.length,
      recorded,
      bing: { submitted: bingSuccess, failed: bingFailed },
      indexNow: { submitted: indexNowSuccess, failed: indexNowFailed },
      topUrls: urls.slice(0, 5), // Show first 5 for debugging
      duration: `${duration}s`,
      timestamp: new Date().toISOString(),
    };

    logger.info('[CRON:index-pseo] Complete', summary);
    return {
      response: NextResponse.json(summary),
      metrics: {
        totalQualifying: scoredUrls.length,
        newToSubmit: newUrls.length,
        submitted: urls.length,
        recorded,
        bingSubmitted: bingSuccess,
        bingFailed,
        indexNowSubmitted: indexNowSuccess,
        indexNowFailed,
      },
    };
    });
  } catch (error) {
    await sendCronFailureAlert('index-pseo', error);
    console.error('[CRON:index-pseo] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'pSEO indexing failed',
        details: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
