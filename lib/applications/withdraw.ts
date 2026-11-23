import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { notesAfterWithdrawal } from './auto-reject';

/**
 * Withdraw one of the candidate's own applications and scrub what they sent
 * (GDPR right to erasure). The single routine behind
 * DELETE /api/applications/withdraw (My Applications) and the AI app's
 * withdraw_application tool, so the two cannot drift.
 *
 * What it does, as the My Applications dialog describes it
 * (tests/regressions/p2-seeker-ux-static.test.ts pins both):
 *  - the cover letter text and the resume link are cleared, and the row is
 *    marked withdrawn; the employer still sees it, marked "Withdrawn", with
 *    the candidate's name on it;
 *  - a cover letter uploaded as a file stays attached (coverLetterUrl is
 *    kept), and so do the screening answers;
 *  - the employer's notes are cleared, except the bare record a knockout
 *    left on a row it rejected (lib/applications/auto-reject.ts): without it,
 *    withdrawing and applying again evaluated the answers afresh, so a
 *    candidate could try answers until one passed.
 */
export type WithdrawOutcome = { ok: true } | { ok: false; status: 400 | 403 | 404; error: string };

export async function withdrawApplication(userId: string, applicationId: unknown): Promise<WithdrawOutcome> {
    if (!applicationId || typeof applicationId !== 'string') {
        return { ok: false, status: 400, error: 'applicationId is required' };
    }

    // Verify the application belongs to this user
    const application = await prisma.jobApplication.findUnique({
        where: { id: applicationId },
        select: { userId: true, jobId: true, status: true, notes: true },
    });

    if (!application) {
        return { ok: false, status: 404, error: 'Application not found' };
    }

    if (application.userId !== userId) {
        return { ok: false, status: 403, error: 'You can only withdraw your own applications' };
    }

    // Scrub personal data but keep the record for analytics (GDPR-compliant)
    await prisma.jobApplication.update({
        where: { id: applicationId },
        data: {
            coverLetter: null,
            resumeUrl: null,
            status: 'withdrawn',
            withdrawnAt: new Date(),
            notes: notesAfterWithdrawal(application),
        },
    });

    logger.info('Application withdrawn (GDPR)', {
        applicationId,
        userId,
        jobId: application.jobId,
    });

    return { ok: true };
}
