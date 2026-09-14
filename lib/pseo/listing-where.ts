import type { Prisma } from '@prisma/client';
import { GLOBAL_EXCLUSIONS } from '@/lib/filters';

/**
 * Profession quarantine for pSEO listing queries.
 *
 * P10 pseo-jobs #1: GLOBAL_EXCLUSIONS (lib/filters.ts) is the site-wide veto
 * for non-NP rows (professionClass quarantine plus the provider-title veto),
 * and /jobs, the category landings and the sitemaps apply it. The state hub,
 * city hub, metro guide, locations hub, category x city / setting x state
 * templates and the job detail route each hand-wrote `isPublished: true`
 * predicates that never did, so a quarantined Podiatrist row still rendered
 * on /jobs/state/texas, /jobs/city/austin-tx and its own detail URL. The
 * earlier fix only extended activeIndexableJobWhere, which none of those
 * routes call.
 *
 * The exclusions are appended to the predicate's own top-level `AND`, never
 * a sibling key: callers keep their `OR` (state name OR state code), and a
 * caller spreading the result beside extra scalar keys
 * (`{ ...where, city: { not: null } }`) keeps the quarantine.
 */
export function withListingQuarantine<T extends Prisma.JobWhereInput>(where: T): T & { AND: Prisma.JobWhereInput[] } {
  const existing = where.AND;
  const existingAnd: Prisma.JobWhereInput[] = existing === undefined
    ? []
    : Array.isArray(existing)
      ? [...existing]
      : [existing];
  return {
    ...where,
    AND: [
      ...existingAnd,
      ...GLOBAL_EXCLUSIONS.map((exclusion): Prisma.JobWhereInput => ({ NOT: exclusion })),
    ],
  };
}

/** Published listing rows that pass the profession quarantine. */
export function publishedListingWhere(extra: Prisma.JobWhereInput = {}): Prisma.JobWhereInput {
  return withListingQuarantine({ isPublished: true, ...extra });
}

/**
 * Spreadable base for hand-written listing predicates: replaces a bare
 * `isPublished: true,` with `...PUBLISHED_LISTING_WHERE,`. It carries its own
 * top-level `AND`, so it must only be spread into an object that declares no
 * `AND` of its own (a later `AND` key would silently drop the quarantine);
 * wrap such an object with withListingQuarantine instead.
 */
export const PUBLISHED_LISTING_WHERE: Readonly<{ isPublished: true; AND: Prisma.JobWhereInput[] }> = Object.freeze(
  withListingQuarantine({ isPublished: true as const }),
);
