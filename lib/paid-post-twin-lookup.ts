import type { Prisma } from '@prisma/client';
import { activeIndexableJobWhere } from '@/lib/active-job-filter';

/**
 * Following a free copy to its paid post, for anything that reaches a job by
 * an id it stored before the copy was marked.
 *
 * lib/paid-post-twins.ts says what a copy is and lib/paid-post-twins-sync.ts
 * writes the marks. activeIndexableJobWhere hides a marked copy and its URL
 * redirects to the paid post, so an assistant handed the copy's id or URL has
 * to answer with that post as well. Answering "no longer open" tells a
 * candidate that a live role was taken down.
 *
 * Both sides go through activeIndexableJobWhere, NP Hiring's live-listing
 * predicate, so a stand-in is always a posting the candidate could have found
 * anyway.
 */

/**
 * A copy that activeIndexableJobWhere hides only because of its mark. The
 * copy's own state still counts: an expired or unpublished copy is gone,
 * which is what its own URL answers too.
 */
function markedCopyWhere(now: Date): Prisma.JobWhereInput {
  return { ...activeIndexableJobWhere(now), shadowedByJobId: { not: null } };
}

/** Which of these ids are marked copies whose paid post is visible. */
export function copiesWithVisibleTwinWhere(
  copyIds: readonly string[],
  now: Date = new Date(),
): Prisma.JobWhereInput {
  return {
    ...markedCopyWhere(now),
    id: { in: [...copyIds] },
    shadowedBy: { is: activeIndexableJobWhere(now) },
  };
}

/** The same pairs from the paid post's side: the visible posts standing in for these copies. */
export function visibleTwinsOfCopiesWhere(
  copyIds: readonly string[],
  now: Date = new Date(),
): Prisma.JobWhereInput {
  return {
    ...activeIndexableJobWhere(now),
    shadowedCopies: { some: { ...markedCopyWhere(now), id: { in: [...copyIds] } } },
  };
}
