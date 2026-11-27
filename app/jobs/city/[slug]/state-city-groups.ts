/**
 * The state's town groups for the city page's nearby-markets block, read
 * through the shared data cache. In its own module because a page file may
 * export only Next.js's own page fields.
 */
import { prisma } from '@/lib/prisma';
import { canonicalBucketWhere } from '@/lib/canonical-counts';
import { sharedCachedRead } from '@/lib/data-cache';
import { isTallyCity } from '@/lib/pseo/city-tally';

/**
 * City groups read for the nearby-markets block. Twice the directory's
 * 12-row view, so stored values that are not towns (CQ-02: "Remote", a
 * street number, a facility), which are dropped below, cannot crowd real
 * cities out of the slice.
 */
const STATE_CITY_GROUP_TAKE = 24;

/** Cached as long as the city page itself (`revalidate` in ./page.tsx), so no page's window shrinks. */
export const STATE_CITY_GROUPS_CACHE_SECONDS = 3600;

/**
 * The state's busiest towns with their live job counts. Only values that
 * read as a town count (isTallyCity, lib/pseo/city-tally.ts).
 *
 * 2026-11-27: every city page in a state ran this same grouped read over the
 * whole state, so a crawl across a state's cities ran it once per city, each
 * holding a pool connection while the database grouped the state's jobs. On
 * Nov 26 a burst on the city pages filled the pooler's 200 clients and the
 * route answered 5xx to almost every request. It is the one read on the page
 * that does not depend on the city, so it is read once per state per window
 * through the shared data cache, for every instance.
 */
export async function readStateCityGroups(
    stateName: string,
    stateCode: string,
): Promise<Array<{ city: string; count: number }>> {
    const rows = await prisma.job.groupBy({
        by: ['city'],
        where: canonicalBucketWhere({
            city: { not: null },
            OR: [{ state: stateName }, { stateCode }],
        }),
        _count: { city: true },
        orderBy: { _count: { city: 'desc' } },
        take: STATE_CITY_GROUP_TAKE,
    });
    return rows.flatMap((row) =>
        row.city && isTallyCity(row.city, stateCode) ? [{ city: row.city, count: row._count.city }] : [],
    );
}

export const stateCityGroups = sharedCachedRead(
    readStateCityGroups,
    ['city-page-state-city-groups', 'v1'],
    STATE_CITY_GROUPS_CACHE_SECONDS,
);
