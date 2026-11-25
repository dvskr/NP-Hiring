import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

/**
 * Records an employer's unlock of a candidate, the ProfileView row that spends
 * one of a posting's unlocks, and answers whether the row is in place.
 *
 * Both unlock routes act on the answer alone. The single unlock
 * (GET /api/employer/candidates/[id]) returns the full profile in the same
 * response, and the bulk unlock reports the candidate unlocked, only when it
 * is true: nothing is delivered without the row, and a written row is never
 * reported as a failure. The (viewerId, candidateId) unique key keeps the
 * write idempotent, so a concurrent first open lands on the same row and
 * spends nothing more. A failed write is read back, because a write can
 * commit and still fail on its way back.
 * tests/api/employer-candidate-unlock.test.ts
 */
export async function recordCandidateUnlock(
    viewerId: string,
    candidateId: string,
    employerJobId: string | null,
): Promise<boolean> {
    const key = { viewerId_candidateId: { viewerId, candidateId } };
    try {
        await prisma.profileView.upsert({
            where: key,
            update: { viewedAt: new Date() },
            create: { viewerId, candidateId, employerJobId },
        });
        return true;
    } catch (error) {
        logger.error('Candidate unlock write failed', error, { candidateId });
        try {
            return (await prisma.profileView.findUnique({ where: key, select: { id: true } })) !== null;
        } catch (readError) {
            logger.error('Candidate unlock read-back failed', readError, { candidateId });
            return false;
        }
    }
}
