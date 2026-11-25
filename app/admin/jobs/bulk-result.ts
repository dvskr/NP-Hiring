/**
 * The sentence /admin/jobs shows after a bulk action
 * (POST /api/admin/jobs/bulk).
 *
 * The route answers how many jobs it changed and, for a publish or a hard
 * delete, the ids it left alone (skippedJobIds): a publish skips archived and
 * unpaid postings, and a hard delete keeps a posting that a payment, a
 * checkout or an application reached after the list loaded. The page used to
 * report only the number it changed, so a publish of six that skipped two
 * read as a job done.
 *
 * Pure, so the client page and its tests share it.
 */

export const BULK_JOB_ACTIONS = ['publish', 'unpublish', 'feature', 'unfeature', 'delete', 'hard_delete'] as const;

export type BulkJobAction = (typeof BULK_JOB_ACTIONS)[number];

/** What each action did, as the start of the sentence. A bulk delete is a takedown (lib/admin/job-hold.ts). */
const DONE: Readonly<Record<BulkJobAction, string>> = {
  publish: 'Published',
  unpublish: 'Unpublished',
  feature: 'Featured',
  unfeature: 'Unfeatured',
  delete: 'Took down',
  hard_delete: 'Permanently deleted',
};

/** Why the route leaves a job alone, for the actions that can. */
const SKIP_REASON: Readonly<Partial<Record<BulkJobAction, string>>> = {
  publish: 'archived or unpaid',
  hard_delete: 'changed since the list loaded',
};

function isBulkJobAction(value: string): value is BulkJobAction {
  return (BULK_JOB_ACTIONS as readonly string[]).includes(value);
}

function jobCount(count: number): string {
  return `${count} job${count === 1 ? '' : 's'}`;
}

/** How many ids the response's skippedJobIds names; anything but a list of ids counts as none. */
export function skippedCount(skippedJobIds: unknown): number {
  return Array.isArray(skippedJobIds) ? skippedJobIds.filter((id) => typeof id === 'string').length : 0;
}

/**
 * "Published 4 jobs; 2 skipped (archived or unpaid)", or without the second
 * half when nothing was skipped.
 */
export function describeBulkResult(action: string, affected: number, skippedJobIds?: unknown): string {
  const done = isBulkJobAction(action) ? `${DONE[action]} ${jobCount(affected)}` : `Applied ${action} to ${jobCount(affected)}`;
  const skipped = skippedCount(skippedJobIds);
  if (skipped === 0) return done;
  const reason = isBulkJobAction(action) ? SKIP_REASON[action] : undefined;
  return `${done}; ${skipped} skipped${reason ? ` (${reason})` : ''}`;
}
