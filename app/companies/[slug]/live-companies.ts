/**
 * app/companies/[slug]/live-companies.ts
 *
 * Every company with a live profile (at least one job under
 * activeIndexableJobWhere) and its live job count: what a /companies/{slug}
 * request is resolved against (indexing audit L-01).
 *
 * The profile page used to run this read on every render, to resolve one
 * slug. It returns about 1,100 rows and took 2.4 s on the production
 * database (22,103 runs in nine days, a fifth of all database time, measured
 * 2026-11-23), on a two-connection pool that crawler bursts then filled. It
 * is now read once an hour for every profile, through the shared data cache.
 *
 * The window equals the profile page's own (`revalidate` in ./page.tsx):
 * Next.js gives a page the shortest cache window in its tree, so a shorter
 * one here would make every profile re-render that often. A company whose
 * last job expired inside the window still resolves; the page's own job read
 * then finds none and answers 404, as it did before.
 *
 * The other direction needs a second look. A company whose first job went
 * live inside the window is not in the hourly copy yet, so its new profile
 * URL would answer 404 for up to an hour (and an old slug of it would skip
 * its redirect). A slug the hourly copy does not know is therefore checked
 * against a second copy, at most five minutes old
 * (loadLiveCompaniesAfterMiss). Only those requests read it, so only their
 * pages (a 404, a redirect, or the new profile until the hourly copy catches
 * up) take its shorter window; every profile the hourly copy knows keeps
 * the hour.
 */
import { prisma } from '@/lib/prisma';
import { activeIndexableJobWhere } from '@/lib/active-job-filter';
import { sharedCachedRead } from '@/lib/data-cache';

/** Seconds the directory is reused across profile renders: an hour, the page's window. */
export const LIVE_COMPANY_DIRECTORY_CACHE_SECONDS = 3600;

/** Seconds the copy consulted for a slug the hourly one does not know is reused. */
export const LIVE_COMPANY_RECHECK_CACHE_SECONDS = 300;

/** A company with a live profile, as the slug resolver reads it. */
export interface LiveCompany {
    name: string;
    normalizedName: string;
    activeJobs: number;
}

/**
 * The directory, straight from the database. A failed read throws.
 *
 * The read's cost is the live predicate itself: the board's whole title and
 * employer exclusion list, tested on every live job. As a relation filter
 * plus a relation count, Postgres tested it twice, once for the EXISTS and
 * once for the grouped count (2.4 to 3.3 s per refill, Sentry NP-HIRING-2).
 * One groupBy on the jobs tests it once; the names then come by primary key.
 */
export async function readLiveCompanies(): Promise<LiveCompany[]> {
    const liveWhere = activeIndexableJobWhere(new Date());
    const groups = await prisma.job.groupBy({
        by: ['companyId'],
        where: { ...liveWhere, companyId: { not: null } },
        _count: { _all: true },
    });
    const activeJobsById = new Map<string, number>();
    for (const group of groups) {
        if (group.companyId) activeJobsById.set(group.companyId, group._count._all);
    }
    const companies = await prisma.company.findMany({
        where: { id: { in: Array.from(activeJobsById.keys()) } },
        select: { id: true, name: true, normalizedName: true },
    });
    return companies.map((company) => ({
        name: company.name,
        normalizedName: company.normalizedName,
        activeJobs: activeJobsById.get(company.id) ?? 0,
    }));
}

/**
 * The directory through the hourly cache. While a refresh fails, a page being
 * regenerated gets the previous copy; with no copy at all the error reaches
 * the caller (a 5xx, never a cached 404 on a live profile).
 */
export const loadLiveCompanies = sharedCachedRead(
    readLiveCompanies,
    ['live-company-directory', 'v1'],
    LIVE_COMPANY_DIRECTORY_CACHE_SECONDS,
);

/**
 * The directory in a copy at most five minutes old, for a slug the hourly
 * copy has no profile under. Never call it before the hourly copy has missed:
 * its window is shorter than the profile page's, and a page that reads it is
 * regenerated that often. It is one database read per five minutes however
 * many unknown slugs are requested, where a live read per miss would put a
 * crawler walking dead profile URLs straight back on the slow query.
 */
export const loadLiveCompaniesAfterMiss = sharedCachedRead(
    readLiveCompanies,
    ['live-company-directory-recheck', 'v1'],
    LIVE_COMPANY_RECHECK_CACHE_SECONDS,
);
