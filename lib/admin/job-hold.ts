import { brand } from '@/config/brand';

/**
 * An admin taking a posting down, and putting it back.
 *
 * Unpublishing from the admin tools used to write what an employer's own
 * pause writes (isPublished false, isManuallyUnpublished true). The owner
 * could press Unpause, or buy a renewal, and undo a removal made for a
 * policy reason.
 *
 * A takedown now writes:
 *
 *  - adminHoldAt, which only an admin clears. While it is set, the owner's
 *    resume (/api/employer/jobs/[jobId]/toggle-publish) and renewal
 *    (/api/create-renewal-checkout) are refused, and no payment puts the
 *    posting back up (app/api/webhooks/stripe).
 *  - isManuallyUnpublished, the flag every automatic republisher already
 *    leaves alone: ingest renewal, the false positive recovery, the 5-post
 *    pack restore. A takedown needs no change in any of them.
 *
 * It does not stamp unpublishReason or unpublishedAt. Those record an
 * employer's own pause.
 *
 * No server imports: the employer dashboard reads ADMIN_HOLD_MESSAGE too.
 */

export interface AdminTakedownData {
  isPublished: false;
  isManuallyUnpublished: true;
  adminHoldAt: Date;
}

export interface AdminReleaseData {
  isPublished: true;
  isManuallyUnpublished: false;
  adminHoldAt: null;
}

/** `heldSince` is when the hold began: now, or the time of an earlier takedown being kept. */
export function adminTakedownData(heldSince: Date = new Date()): AdminTakedownData {
  return { isPublished: false, isManuallyUnpublished: true, adminHoldAt: heldSince };
}

/** An admin publishing a posting ends any hold on it, and an earlier pause too. */
export function adminReleaseData(): AdminReleaseData {
  return { isPublished: true, isManuallyUnpublished: false, adminHoldAt: null };
}

/**
 * What an admin publish or unpublish did to the hold, for its audit row:
 * placed (a new takedown), kept (already held, its first time kept), lifted
 * (a release ended a hold), none (a publish of a posting that had none).
 */
export type HoldChange = 'placed' | 'kept' | 'lifted' | 'none';

export function holdChange(isPublished: boolean, priorHoldAt: Date | null | undefined): HoldChange {
  if (!isPublished) return priorHoldAt ? 'kept' : 'placed';
  return priorHoldAt ? 'lifted' : 'none';
}

/** What an owner is told when they try to resume or renew a posting under a hold. */
export const ADMIN_HOLD_MESSAGE =
  `This posting was taken down by ${brand.name} and cannot be put back up from here. Write to ${brand.email.support} if you think this is a mistake.`;
