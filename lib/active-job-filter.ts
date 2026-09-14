import type { Prisma } from '@prisma/client';
import { GLOBAL_EXCLUSIONS } from '@/lib/filters';

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
 */
export const DEAD_LINK_MISS_THRESHOLD = 5;

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
 */
export function activeIndexableJobWhere(now: Date = new Date()): Prisma.JobWhereInput {
    return {
        isPublished: true,
        healthConsecutiveMissing: { lt: DEAD_LINK_MISS_THRESHOLD },
        NOT: [...GLOBAL_EXCLUSIONS],
        OR: [
            { expiresAt: null },
            { expiresAt: { gt: now } },
        ],
    };
}
