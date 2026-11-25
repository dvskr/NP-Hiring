import type { Prisma } from '@prisma/client';

/**
 * NP's posting rule: an employer's posting is active while its job is
 * published and has not expired; a job with no expiry counts as live.
 *
 * getEmployerActivePostings (lib/tier-limits.ts: the talent pool's posting
 * tier, and the unlock and InMail checks) and messaging read it here, so an
 * active posting means one thing everywhere. A featured flag is not part of
 * it: a new post here is never featured, only a renewal or an admin sets it.
 * tests/lib/active-posting.test.ts
 */
export function activePostingJobWhere(now: Date = new Date()): Prisma.JobWhereInput {
    return {
        isPublished: true,
        OR: [
            { expiresAt: null },
            { expiresAt: { gt: now } },
        ],
    };
}

/** The same rule for a job already loaded. */
export function isActivePostingJob(
    job: { readonly isPublished: boolean; readonly expiresAt: Date | null },
    now: Date = new Date(),
): boolean {
    return job.isPublished && (job.expiresAt === null || job.expiresAt > now);
}
