/**
 * NP's posting rule (lib/active-posting.ts): a posting is active while its
 * job is published and has not ended; no end date counts as live. Messaging
 * reads it since the owner's decision of 2026-11-25, in place of a featured
 * flag a new post never carries, and getEmployerActivePostings (the posting
 * tier, the unlock and InMail checks) reads the same clause.
 *
 * The query runs against fixture rows through tests/helpers/fake-row-where.ts.
 */
import { describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { activePostingJobWhere, isActivePostingJob } from '@/lib/active-posting';
import { getEmployerActivePostings } from '@/lib/tier-limits';
import { rowMatches } from '../helpers/fake-row-where';

const NOW = new Date('2026-11-25T12:00:00Z');

const JOBS: ReadonlyArray<readonly [string, { isPublished: boolean; expiresAt: Date | null }, boolean]> = [
    ['published and ending later', { isPublished: true, expiresAt: new Date('2026-12-20T00:00:00Z') }, true],
    ['published with no end date', { isPublished: true, expiresAt: null }, true],
    ['published and ended', { isPublished: true, expiresAt: new Date('2026-11-20T00:00:00Z') }, false],
    ['published and ending this instant', { isPublished: true, expiresAt: NOW }, false],
    ['unpublished', { isPublished: false, expiresAt: new Date('2026-12-20T00:00:00Z') }, false],
];

describe('the posting rule', () => {
    it.each(JOBS)('%s: the query and the loaded-row check agree', (_label, job, active) => {
        expect(rowMatches({ ...job }, activePostingJobWhere(NOW))).toBe(active);
        expect(isActivePostingJob(job, NOW)).toBe(active);
    });

    it('never reads the featured flag', () => {
        expect(JSON.stringify(activePostingJobWhere(NOW))).not.toContain('isFeatured');
        expect(rowMatches({ isPublished: true, expiresAt: null, isFeatured: false }, activePostingJobWhere(NOW))).toBe(true);
    });

    it('is the clause getEmployerActivePostings sends', async () => {
        vi.mocked(prisma.employerJob.findMany).mockResolvedValue([] as never);

        await getEmployerActivePostings('supabase-employer-fic');

        expect(vi.mocked(prisma.employerJob.findMany).mock.calls[0][0]?.where).toEqual({
            userId: 'supabase-employer-fic',
            job: { isPublished: true, OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }] },
        });
    });
});
