/**
 * app/jobs/[slug]/place-cache.ts
 *
 * Place-scoped figures the job page shows, read through a daily cache shared
 * by every job in the same state or city (2026-11-21).
 *
 * Before, each job render re-read them: the state's salary rows for the
 * median and a count of the city's live jobs, plus the state-hub and city
 * crumb verdicts (./job-breadcrumbs.ts). Under a crawler burst hundreds of
 * job pages in the same few states rendered at once, each repeating the same
 * reads on a 2-connection pool, and the pool timed out.
 *
 * The window must be at least the job page's own (`revalidate` in
 * ./page.tsx): Next.js gives a page the shortest cache window in its tree, so
 * a shorter window here would make every job page re-render that often
 * (the footer bug of 2026-11-18). Guarded by
 * tests/regressions/job-page-isr-window.test.ts. A figure can therefore be up
 * to a day older than the database, which the cached page HTML already is.
 */
import { unstable_cache } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { PUBLISHED_LISTING_WHERE } from '@/lib/pseo/listing-where';
import { getGatedMedianKForWhere } from '@/lib/salary-analytics';

/** Seconds a place-scoped figure is reused across job pages: a day. */
export const JOB_PAGE_PLACE_CACHE_SECONDS = 86400;

async function readStateSalaryMedianK(stateName: string | null, stateCode: string | null): Promise<number> {
  if (!stateName && !stateCode) return 0;
  return getGatedMedianKForWhere({
    OR: [
      ...(stateName ? [{ state: stateName }] : []),
      ...(stateCode ? [{ stateCode: stateCode }] : []),
    ],
  });
}

async function readCityJobCount(city: string, stateName: string, stateCode: string): Promise<number> {
  return prisma.job.count({
    where: {
      ...PUBLISHED_LISTING_WHERE,
      city: { equals: city, mode: 'insensitive' },
      OR: [{ state: stateName }, { stateCode }],
    },
  });
}

const cachedStateSalaryMedianK = unstable_cache(readStateSalaryMedianK, ['job-page-state-median-k'], {
  revalidate: JOB_PAGE_PLACE_CACHE_SECONDS,
});

const cachedCityJobCount = unstable_cache(readCityJobCount, ['job-page-city-job-count'], {
  revalidate: JOB_PAGE_PLACE_CACHE_SECONDS,
});

/**
 * Gated state salary median in whole $k, or 0 below the publishing gate.
 * The arguments are part of the cache key, so each state has its own entry.
 */
export function getCachedStateSalaryMedianK(stateName: string | null, stateCode: string | null): Promise<number> {
  if (!stateName && !stateCode) return Promise.resolve(0);
  return cachedStateSalaryMedianK(stateName, stateCode);
}

/**
 * Live jobs in a city, by the predicate app/jobs/city/[slug]/page.tsx gates
 * its render on (insensitive city, state name OR code). Callers pass the
 * dataset record's state and code so the key matches the city page's scope.
 */
export function getCachedCityJobCount(city: string, stateName: string, stateCode: string): Promise<number> {
  return cachedCityJobCount(city, stateName, stateCode);
}
