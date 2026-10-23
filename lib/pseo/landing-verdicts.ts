/**
 * lib/pseo/landing-verdicts.ts
 *
 * Which category landings (/jobs/{category}) are indexable right now, read
 * the way app/sitemap.ts reads them for the landing URLs it submits: the
 * fresh 'category-landing' PseoStats row the aggregate-pseo cron writes, with
 * its stored verdict true AND its stored counts still clearing
 * shouldIndexCategoryLanding (5 or more distinct postings from 3 or more
 * employers). The second check means a row written before a floor change
 * never admits a landing the page now answers `noindex` for, or a 0-job
 * landing that answers 404.
 *
 * Every internal link surface that may only point at indexable landings
 * reads this one rule: the sitewide footer (M-02, lib/pseo/
 * footer-category-loader.ts) and the /jobs hub editorial (M-07,
 * lib/pseo/hub-category-links.ts). Links written into content and page code
 * read the looser loadEmptyLandingSlugs below instead: they may point at a
 * landing that renders `noindex`, never at one that 404s. Each read is cached
 * across requests for an hour, so a page that renders per request adds no
 * query per render.
 */
import { unstable_cache } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { pseoStatsFreshnessThreshold, shouldIndexCategoryLanding, shouldRenderCategoryLanding } from './render-gate';

/** Seconds the verdict list is reused across requests. */
export const LANDING_VERDICT_CACHE_SECONDS = 3600;

/** The 'category-landing' rows are keyed on this location slug (PLAN C.2). */
const LANDING_LOCATION_SLUG = 'all';

/** The stored columns the verdict reads. */
export interface LandingVerdictRow {
  categorySlug: string;
  totalJobs: number;
  distinctEmployers: number;
  indexable: boolean;
}

/**
 * The sitemap's landing rule over one stored row: the cron's verdict, and
 * the listing floor over the counts stored beside it.
 */
export function isLandingVerdictIndexable(row: LandingVerdictRow): boolean {
  return (
    row.indexable === true &&
    shouldIndexCategoryLanding({ activeJobs: row.totalJobs, distinctEmployers: row.distinctEmployers })
  );
}

/**
 * Slugs of the landings indexable now, uncached. A row older than the
 * PSEO_STATS_MAX_AGE_HOURS window says nothing current and does not count.
 * Allowed to throw.
 */
export async function readIndexableLandingSlugs(): Promise<string[]> {
  const rows = await prisma.pseoStats.findMany({
    where: {
      type: 'category-landing',
      locationSlug: LANDING_LOCATION_SLUG,
      indexable: true,
      updatedAt: { gte: pseoStatsFreshnessThreshold() },
    },
    select: { categorySlug: true, totalJobs: true, distinctEmployers: true, indexable: true },
  });
  return Array.isArray(rows) ? rows.filter(isLandingVerdictIndexable).map((row) => row.categorySlug) : [];
}

const cachedIndexableLandingSlugs = unstable_cache(readIndexableLandingSlugs, ['indexable-landing-slugs'], {
  revalidate: LANDING_VERDICT_CACHE_SECONDS,
});

/**
 * Indexable landing slugs, or null when the verdicts cannot be read. Each
 * caller decides what null means (the footer falls back to its standing
 * list; the /jobs hub links no landing). `surface` names the caller in the
 * error log.
 */
export async function loadIndexableLandingSlugs(surface: string): Promise<ReadonlySet<string> | null> {
  try {
    return new Set(await cachedIndexableLandingSlugs());
  } catch (error) {
    console.error(`[${surface}] category-landing index verdicts unavailable:`, error);
    return null;
  }
}

/**
 * Slugs of the landings known to answer 404 now, uncached: a fresh
 * 'category-landing' row whose stored count fails the render floor
 * (shouldRenderCategoryLanding). The cron writes that row for every landing.
 * For links written into content and page code (lib/pseo/live-landing-links.ts),
 * which may point at a landing that renders `noindex` but never at one that
 * 404s; a landing with no fresh row is unknown, so it is not listed.
 * Allowed to throw.
 */
export async function readEmptyLandingSlugs(): Promise<string[]> {
  const rows = await prisma.pseoStats.findMany({
    where: {
      type: 'category-landing',
      locationSlug: LANDING_LOCATION_SLUG,
      updatedAt: { gte: pseoStatsFreshnessThreshold() },
    },
    select: { categorySlug: true, totalJobs: true },
  });
  return Array.isArray(rows)
    ? rows.filter((row) => !shouldRenderCategoryLanding(row.totalJobs)).map((row) => row.categorySlug)
    : [];
}

const cachedEmptyLandingSlugs = unstable_cache(readEmptyLandingSlugs, ['empty-landing-slugs'], {
  revalidate: LANDING_VERDICT_CACHE_SECONDS,
});

/**
 * Empty landing slugs, or null when the rows cannot be read, in which case
 * every link stays. `surface` names the caller in the error log.
 * Tests: tests/lib/empty-landing-slugs.test.ts
 */
export async function loadEmptyLandingSlugs(surface: string): Promise<ReadonlySet<string> | null> {
  try {
    return new Set(await cachedEmptyLandingSlugs());
  } catch (error) {
    console.error(`[${surface}] category-landing rows unavailable:`, error);
    return null;
  }
}
