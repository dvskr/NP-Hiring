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
 * lib/pseo/hub-category-links.ts). The read is cached across requests for an
 * hour, so a page that renders per request adds no query per render.
 */
import { unstable_cache } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { pseoStatsFreshnessThreshold, shouldIndexCategoryLanding } from './render-gate';

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
