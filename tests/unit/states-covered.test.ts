/**
 * lib/states-covered.ts: the one "States Covered" figure (indexing audit
 * M-08). /about showed a hardcoded 50 while the board listed jobs in 44
 * states; the figure is now measured under the canonical predicate, counts
 * the 50 states only, and is null (omitted) when it cannot be read.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
    prisma: { job: { groupBy: vi.fn() } },
}));

import { prisma } from '@/lib/prisma';
import { canonicalActiveJobWhere } from '@/lib/canonical-counts';
import { getStatesCovered, US_STATE_ONLY_CODES } from '@/lib/states-covered';

const groupBy = prisma.job.groupBy as unknown as ReturnType<typeof vi.fn>;

describe('US_STATE_ONLY_CODES', () => {
    it('holds the 50 states and not the District of Columbia', () => {
        expect(US_STATE_ONLY_CODES).toHaveLength(50);
        expect(new Set(US_STATE_ONLY_CODES).size).toBe(50);
        expect(US_STATE_ONLY_CODES).not.toContain('DC');
        expect(US_STATE_ONLY_CODES).toEqual(expect.arrayContaining(['CA', 'TX', 'NY', 'AK', 'HI', 'WY']));
    });
});

describe('getStatesCovered', () => {
    beforeEach(() => vi.clearAllMocks());

    it('counts distinct states among canonical live jobs', async () => {
        groupBy.mockResolvedValue([{ stateCode: 'CA' }, { stateCode: 'TX' }, { stateCode: 'NY' }]);
        const now = new Date('2026-09-29T12:00:00Z');

        await expect(getStatesCovered(now)).resolves.toBe(3);

        const args = groupBy.mock.calls[0][0];
        expect(args.by).toEqual(['stateCode']);
        expect(args.where).toEqual({
            AND: [canonicalActiveJobWhere(now), { stateCode: { in: [...US_STATE_ONLY_CODES] } }],
        });
    });

    it('reports zero when no state has a live job', async () => {
        groupBy.mockResolvedValue([]);
        await expect(getStatesCovered()).resolves.toBe(0);
    });

    it('returns null on a read error, so the surface omits the figure', async () => {
        groupBy.mockRejectedValue(new Error('db down'));
        const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            await expect(getStatesCovered()).resolves.toBeNull();
            expect(spy).toHaveBeenCalledWith('[states-covered] state count failed:', 'db down');
        } finally {
            spy.mockRestore();
        }
    });
});
