/**
 * The live count of one category landing, read through the shared data cache.
 *
 * Every category landing prints its siblings' counts on its explore cards, and
 * a landing renders per request (it reads ?page). Counted on each render, those
 * cards started several count statements at once beside the page's own facts,
 * more than one instance's pool has slots, and on a busy database the last of
 * them waited past the pool's connect timeout. One count per landing per
 * window, shared by every instance, takes them off the render.
 */
import { prisma } from '@/lib/prisma';
import { canonicalBucketWhere } from '@/lib/canonical-counts';
import { sharedCachedRead } from '@/lib/data-cache';
import { landingBucketWhere } from '@/lib/pseo/landing-where';

/** The landings' own window (`export const revalidate = 3600`), so no page's window shrinks. */
export const LANDING_JOB_COUNT_CACHE_SECONDS = 3600;

/** The canonical live count of the landing `slug`, from the database. */
export async function readLandingJobCount(slug: string): Promise<number> {
    return prisma.job.count({ where: canonicalBucketWhere(landingBucketWhere(slug)) });
}

export const landingJobCount = sharedCachedRead(
    readLandingJobCount,
    ['landing-job-count', 'v1'],
    LANDING_JOB_COUNT_CACHE_SECONDS,
);
