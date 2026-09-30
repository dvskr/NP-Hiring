/**
 * Content lastmod for the PseoStats-listed URLs of /api/sitemaps/cities/[batch]
 * (indexing audit CS-02): the newest content date among the jobs each page
 * lists, read over the page's own bucket clause. PseoStats.updatedAt is the
 * aggregate-pseo heartbeat (the freshness filter reads it) and moves every six
 * hours whether or not the listing changed, so it is never a lastmod.
 *
 * One aggregate per URL, run a few at a time. The routes only reach this for
 * URLs that already passed their index gate, a few dozen at most today; past
 * LISTING_LASTMOD_QUERY_CAP URLs the rest carry no lastmod instead of making a
 * sitemap request run thousands of queries. A URL whose read fails also
 * carries none: an omitted lastmod is honest, a guessed one is not.
 */
import type { Prisma } from '@prisma/client';
import { canonicalBucketWhere } from '@/lib/canonical-counts';
import { getCityBySlug } from '@/lib/pseo/city-data/cities';
import { ALL_CATEGORY_CONFIGS } from '@/lib/pseo/category-city-template';
import { SETTING_CONFIGS, URL_TO_STATE } from '@/lib/pseo/setting-state-config';
import { latestJobContentDate } from '@/app/api/sitemaps/lastmod';

/** One cities-sitemap URL as its PseoStats row names it. */
export interface ListingUrlKey {
  type: 'category-city' | 'setting-state';
  categorySlug: string;
  locationSlug: string;
}

/** URLs past this many get no lastmod (see the module comment). */
export const LISTING_LASTMOD_QUERY_CAP = 500;

/** Aggregates in flight at once. */
const LISTING_LASTMOD_CONCURRENCY = 8;

/**
 * The page's bucket clause, exactly as its template builds it:
 * config.buildWhere(city.state, city.name) for category x city
 * (lib/pseo/category-city-template.tsx) and config.buildWhere(stateName) for
 * setting x state (lib/pseo/setting-state-template.tsx). Null for a slug the
 * page would 404 on.
 */
export function listingBucketWhere(key: ListingUrlKey): Prisma.JobWhereInput | null {
  if (key.type === 'category-city') {
    const config = ALL_CATEGORY_CONFIGS[key.categorySlug];
    const city = getCityBySlug(key.locationSlug);
    return config && city ? (config.buildWhere(city.state, city.name) as Prisma.JobWhereInput) : null;
  }
  const config = SETTING_CONFIGS[key.categorySlug];
  const stateName = URL_TO_STATE[key.locationSlug];
  return config && stateName ? (config.buildWhere(stateName) as Prisma.JobWhereInput) : null;
}

async function contentDateOf(key: ListingUrlKey, now: Date): Promise<Date | null> {
  const bucket = listingBucketWhere(key);
  if (!bucket) return null;
  try {
    return await latestJobContentDate(canonicalBucketWhere(bucket, now));
  } catch (error) {
    console.error(`[sitemaps] lastmod read failed for ${key.type} ${key.categorySlug}/${key.locationSlug}; omitting it:`, error);
    return null;
  }
}

/**
 * The content lastmod of each key, in order; null where there is none (no
 * listed job, a failed read, or past the cap). Never throws.
 */
export async function listingContentDates(keys: readonly ListingUrlKey[], now: Date = new Date()): Promise<Array<Date | null>> {
  const dates: Array<Date | null> = keys.map(() => null);
  const limit = Math.min(keys.length, LISTING_LASTMOD_QUERY_CAP);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < limit) {
      const index = next++;
      dates[index] = await contentDateOf(keys[index], now);
    }
  };
  await Promise.all(Array.from({ length: Math.min(LISTING_LASTMOD_CONCURRENCY, limit) }, worker));
  return dates;
}
