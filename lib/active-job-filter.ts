import type { Prisma } from '@prisma/client';
import { GLOBAL_EXCLUSIONS } from '@/lib/filters';
import { DEAD_LINK_MISS_THRESHOLD } from '@/lib/dead-link-threshold';

/**
 * Dead-link gate (S6, audit 2026-05-31).
 *
 * `healthConsecutiveMissing` is incremented by the check-dead-links cron each
 * time a job's source listing returns missing/404. It was written but never
 * used to gate visibility ("shadow mode"), so jobs whose apply link had been
 * dead for many consecutive checks stayed `isPublished=true` and kept appearing
 * in the sitemaps — Googlebot crawls them, hits a dead end, and the URL becomes
 * a soft-404 / low-quality signal. We exclude jobs at or above this many
 * consecutive misses from indexable surfaces (sitemaps), without unpublishing
 * them outright (a separate decision owned by the health pipeline).
 *
 * The constant lives in lib/dead-link-threshold.ts (a leaf, so lib/filters.ts
 * can read it without an import cycle) and is re-exported here for existing
 * callers.
 */
export { DEAD_LINK_MISS_THRESHOLD };

/**
 * Prisma `where` for jobs that should appear in indexable surfaces (sitemaps):
 * published, not expired, not flagged as a repeated dead link, and not vetoed
 * by the site-wide GLOBAL_EXCLUSIONS (profession-class quarantine plus the
 * non-NP title vetoes).
 *
 * P10 platform-routing-db #3: the exclusions used to be missing here, so the
 * job sitemap batches, feed and every surface built on this helper advertised
 * quarantined non-NP rows (e.g. a Podiatrist with professionClass
 * other_clinical) whose detail URL answers 410. `NOT: [...]` excludes a row
 * matching ANY clause. It sits under its own top-level key so callers that
 * spread this object beside their own `state` / `city` keys keep it, and
 * lib/canonical-counts.ts (which re-applies the same set inside AND) stays
 * equivalent.
 *
 * `now` is injectable for deterministic tests.
 *
 * Paid-post twins: a free copy of a confirmed employer's live paid post
 * (lib/paid-post-twins.ts) redirects to that post, so no surface built on
 * this predicate lists or advertises it. A top-level key, so a caller that
 * must see copies too (lib/paid-post-twins-sync.ts) can set it undefined,
 * and canonicalActiveJobWhere carries it through its spread.
 */
export function activeIndexableJobWhere(now: Date = new Date()): Prisma.JobWhereInput {
    return {
        isPublished: true,
        shadowedByJobId: null,
        healthConsecutiveMissing: { lt: DEAD_LINK_MISS_THRESHOLD },
        NOT: [...GLOBAL_EXCLUSIONS],
        OR: [
            { expiresAt: null },
            { expiresAt: { gt: now } },
        ],
    };
}

/**
 * Jobs still inside their run at `now`: no expiry, or one not yet passed.
 * An expiry equal to `now` still counts, as the employer toggle's read check
 * (an expiry before now refuses a republish) lets it. For the WHERE of a
 * write that must agree with that check made a moment earlier
 * (app/api/employer/jobs/[jobId]/toggle-publish/route.ts). Typed as the one
 * OR, so it spreads into a WHERE that has no OR of its own.
 */
export function insideRunWhere(now: Date): { OR: Prisma.JobWhereInput[] } {
    return { OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] };
}
