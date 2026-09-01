/**
 * Cached site-wide counters (jobs / companies / subscribers).
 *
 * The homepage previously ran a `job.count` AND a `findMany({ distinct:
 * ['employer'] })` on every render + every metadata generation — expensive
 * aggregates on the hottest, most-crawled page. This caches the numbers in the
 * `SiteStat` singleton row, refreshed by the refresh-site-stats cron, so page
 * loads do a single cheap row read instead.
 *
 * Reads fall back to a live compute if the row hasn't been populated yet (e.g.
 * before the cron's first run), and to fixed defaults if the DB is unreachable.
 *
 * Count semantics (live review 2026-08-17 item #4a/#4c):
 *   - totalJobs counts the canonical countable inventory
 *     (lib/canonical-counts.ts: activeIndexableJobWhere + GLOBAL_EXCLUSIONS),
 *     NOT bare `isPublished` — the cached homepage number previously exceeded
 *     what /jobs actually browses by ~200 rows (expired + excluded roles).
 *   - totalCompanies counts Company rows with ≥1 canonical active job (the
 *     ONE employer definition), replacing the distinct-`employer`-string
 *     counter that disagreed with /companies and /about by a few units.
 */
import { prisma } from '@/lib/prisma';
import { canonicalActiveJobWhere, canonicalEmployerWhere } from '@/lib/canonical-counts';

export interface SiteStats {
    totalJobs: number;
    totalCompanies: number;
    totalSubscribers: number;
}

/** Used only when the DB is unreachable — keeps the homepage rendering. */
const FALLBACK: SiteStats = { totalJobs: 200, totalCompanies: 500, totalSubscribers: 0 };

/** Compute the live numbers. Expensive — call from the cron, not page renders. */
export async function computeSiteStats(): Promise<SiteStats> {
    const now = new Date();
    const [totalJobs, totalCompanies, totalSubscribers] = await Promise.all([
        prisma.job.count({ where: canonicalActiveJobWhere(now) }),
        prisma.company.count({ where: canonicalEmployerWhere(now) }),
        prisma.emailLead.count({ where: { newsletterOptIn: true, isSuppressed: false } }),
    ]);
    return { totalJobs, totalCompanies, totalSubscribers };
}

/** Compute + persist the numbers into the SiteStat singleton row. */
export async function refreshSiteStats(): Promise<SiteStats> {
    const stats = await computeSiteStats();
    const existing = await prisma.siteStat.findFirst({ orderBy: { updatedAt: 'desc' } });
    if (existing) {
        await prisma.siteStat.update({ where: { id: existing.id }, data: stats });
    } else {
        await prisma.siteStat.create({ data: stats });
    }
    return stats;
}

/** Read the cached numbers for display. Falls back to live compute if the row
 *  isn't populated yet, and to fixed defaults if the DB is down. */
export async function getSiteStats(): Promise<SiteStats> {
    try {
        const row = await prisma.siteStat.findFirst({ orderBy: { updatedAt: 'desc' } });
        if (row) {
            return {
                totalJobs: row.totalJobs,
                totalCompanies: row.totalCompanies,
                totalSubscribers: row.totalSubscribers,
            };
        }
        return await computeSiteStats();
    } catch {
        return FALLBACK;
    }
}

/**
 * Same read, but returns null on failure instead of the FALLBACK constants.
 *
 * For surfaces bound by the omit-not-fabricate rule (/press, /for-programs —
 * live review item #4d): a placeholder figure quoted by a journalist or a
 * program director is fabrication, so those pages OMIT the stat block when the
 * numbers are unavailable rather than rendering a default. The homepage keeps
 * getSiteStats(): there the number is decorative and a render must not fail.
 */
export async function getSiteStatsOrNull(): Promise<SiteStats | null> {
    try {
        const row = await prisma.siteStat.findFirst({ orderBy: { updatedAt: 'desc' } });
        if (row) {
            return {
                totalJobs: row.totalJobs,
                totalCompanies: row.totalCompanies,
                totalSubscribers: row.totalSubscribers,
            };
        }
        return await computeSiteStats();
    } catch {
        return null;
    }
}
