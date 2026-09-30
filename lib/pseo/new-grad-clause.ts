/**
 * lib/pseo/new-grad-clause.ts
 *
 * The one "open to new grads" predicate (indexing audit CQ-14, fixSoon 11).
 * The /jobs "Open to new grads" facet, its badge count, the /jobs/new-grad
 * landing, the /jobs/new-grad/{state} and /jobs/new-grad/city/{city} pages,
 * the aggregate-pseo verdicts and every in-memory category tally read this
 * clause, so a new grad count is one number wherever it prints.
 *
 * A job qualifies when ANY of:
 *   (a) the employer flagged newGradFriendly,
 *   (b) it declares a 0-year minimum (the "New grad accepted" bucket, the
 *       same signal the JobCard chip shows for min = 0),
 *   (c) the title names a new grad program (NEW_GRAD_TITLE_OR),
 * and NONE of NEW_GRAD_EXCLUSIONS applies (director, instructor, "no new
 * grad", fellowship-trained and APP fellowship titles).
 *
 * A leaf module (Prisma types only), so lib/filters.ts and
 * lib/pseo/category-tagger.ts can both import it without an import cycle.
 * lib/filters.ts re-exports the arrays under its historical names
 * (CATEGORY_FILTERS['new-grad'], CATEGORY_EXTRA_OR['new-grad'],
 * CATEGORY_EXCLUSIONS['new-grad']) and newGradWhereClause itself.
 */
import type { Prisma } from '@prisma/client';

/** Structured "open to new grads" signals. */
export const NEW_GRAD_EXTRA_OR: Prisma.JobWhereInput[] = [
  { newGradFriendly: true },
  { minYearsExperience: 0 },
];

/**
 * Title keywords. Bare `fellowship` and `residency` were removed 2026-05-15:
 * they matched post-graduate APP fellowships that require 3 to 5 years of NP
 * experience. The `program` suffix keeps NP residency and fellowship
 * training programs while dropping those.
 */
export const NEW_GRAD_TITLE_OR: Prisma.JobWhereInput[] = [
  { title: { contains: 'new grad', mode: 'insensitive' } },
  { title: { contains: 'new graduate', mode: 'insensitive' } },
  { title: { contains: 'entry level', mode: 'insensitive' } },
  { title: { contains: 'fellowship program', mode: 'insensitive' } },
  { title: { contains: 'residency program', mode: 'insensitive' } },
  { title: { contains: 'recent graduate', mode: 'insensitive' } },
  { title: { contains: 'training program', mode: 'insensitive' } },
];

/** Titles that never count as new grad roles, whatever else they say. */
export const NEW_GRAD_EXCLUSIONS: Prisma.JobWhereInput[] = [
  { title: { contains: 'director', mode: 'insensitive' } },
  { title: { contains: 'instructor', mode: 'insensitive' } },
  { title: { contains: 'no new grad', mode: 'insensitive' } },
  { title: { contains: 'clinical psychology', mode: 'insensitive' } },
  { title: { contains: 'fellowship trained', mode: 'insensitive' } },
  { title: { contains: 'APC Fellowship', mode: 'insensitive' } },
  { title: { contains: 'Advanced Practice Provider', mode: 'insensitive' } },
];

/** The new grad predicate (header rules). */
export function newGradWhereClause(): Prisma.JobWhereInput {
  return {
    AND: [
      { OR: [...NEW_GRAD_EXTRA_OR, ...NEW_GRAD_TITLE_OR] },
      ...NEW_GRAD_EXCLUSIONS.map((exclusion): Prisma.JobWhereInput => ({ NOT: exclusion })),
    ],
  };
}
