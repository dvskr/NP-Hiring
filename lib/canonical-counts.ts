/**
 * Canonical "countable inventory" predicate — the single source of truth for
 * every user-facing count.
 *
 * Live review 2026-08-17, item #4: five coexisting "active job" predicates put
 * four different totals in front of readers at once (/jobs 876, /press 988,
 * /about 1,079+, homepage 1,000+, /for-programs a fifth). Each surface had
 * privately re-derived what "active" means. This module ends that: a displayed
 * count must come from here, and must never exceed what a reader finds by
 * actually browsing /jobs.
 *
 * Definition: `activeIndexableJobWhere()` (published + unexpired + repeated-
 * dead-link gate — the exact filter the sitemaps and feed use,
 * lib/active-job-filter.ts) composed with `GLOBAL_EXCLUSIONS` (the same
 * out-of-scope veto every /jobs browse query applies, lib/filters.ts). When
 * the quarantine package extends GLOBAL_EXCLUSIONS with the profession gate,
 * every count on the site follows automatically — no per-surface edits.
 *
 * Composition safety: `activeIndexableJobWhere()` carries its expiry check as
 * a top-level `OR`, which callers have historically clobbered by spreading the
 * base object and then adding their own `OR` (the /about bug silently dropped
 * the expiry gate exactly this way). This builder therefore nests every clause
 * inside `AND`, so `{ AND: [canonicalActiveJobWhere(), bucket] }` — or the
 * `canonicalBucketWhere` helper below — can never lose a gate.
 */
import type { Prisma } from '@prisma/client';
import { activeIndexableJobWhere } from '@/lib/active-job-filter';
import { GLOBAL_EXCLUSIONS } from '@/lib/filters';

/**
 * The canonical countable-inventory predicate. `now` is injectable for
 * deterministic tests (same convention as activeIndexableJobWhere).
 */
export function canonicalActiveJobWhere(now: Date = new Date()): Prisma.JobWhereInput {
    const { OR: expiryOr, ...rest } = activeIndexableJobWhere(now);
    return {
        ...rest,
        AND: [
            // Expiry OR moved inside AND so downstream composition can never
            // clobber it with a sibling OR key.
            ...(expiryOr ? [{ OR: expiryOr } satisfies Prisma.JobWhereInput] : []),
            ...GLOBAL_EXCLUSIONS.map((exclusion): Prisma.JobWhereInput => ({ NOT: exclusion })),
        ],
    };
}

/**
 * The ONE employer definition (review item #4c): a Company row with at least
 * one job matching the canonical predicate. Replaces the three prior
 * definitions (distinct `job.employer` strings, distinct `companyId`, and
 * company-rows-with-indexable-jobs) that put 107 vs 109 on different pages.
 */
export function canonicalEmployerWhere(now: Date = new Date()): Prisma.CompanyWhereInput {
    return { jobs: { some: canonicalActiveJobWhere(now) } };
}

/**
 * Compose the canonical predicate with a bucket clause (category filter,
 * new-grad clause, remote flag, …) with no OR-clobber risk. Use this instead
 * of spreading `canonicalActiveJobWhere()` into a wider object.
 */
export function canonicalBucketWhere(
    bucket: Prisma.JobWhereInput,
    now: Date = new Date(),
): Prisma.JobWhereInput {
    return { AND: [canonicalActiveJobWhere(now), bucket] };
}

/**
 * Display floors — a live count below its floor is OMITTED, never padded,
 * inflated, or zero-filled ("0+" is a rendering of a query failure, not a
 * statistic). Surfaces render the real number at/above the floor and drop the
 * figure (keeping the label copy count-free) below it.
 */
export const COUNT_DISPLAY_FLOOR = 5;
export const SUBSCRIBER_DISPLAY_FLOOR = 25;
