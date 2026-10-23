/**
 * lib/pseo/landing-verdicts.ts loadEmptyLandingSlugs: the landings known to
 * answer 404 now, for links written into content and page code
 * (lib/pseo/live-landing-links.ts, register 2.25).
 *
 * The aggregate-pseo cron writes a 'category-landing' row with the canonical
 * job count for every landing, and a landing renders from 1 job
 * (shouldRenderCategoryLanding). So a fresh row counting no job is a landing
 * that 404s; a row with a few jobs is a live (noindex) page; a landing with no
 * fresh row is unknown and is not listed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';

vi.mock('next/cache', () => ({ unstable_cache: (fn: (...args: unknown[]) => unknown) => fn }));
vi.mock('@/lib/prisma', () => ({ prisma: { pseoStats: { findMany: vi.fn() } } }));

import { loadEmptyLandingSlugs, readEmptyLandingSlugs } from '@/lib/pseo/landing-verdicts';

const findMany = vi.mocked(prisma.pseoStats.findMany);

beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('readEmptyLandingSlugs', () => {
    it('lists the fresh landing rows that count no job, and no other', async () => {
        findMany.mockResolvedValue([
            { categorySlug: 'adult-gerontology', totalJobs: 0 },
            { categorySlug: 'anesthesia', totalJobs: 4 },
            { categorySlug: 'private-practice', totalJobs: 0 },
            { categorySlug: 'family-practice', totalJobs: 120 },
        ] as never);

        await expect(readEmptyLandingSlugs()).resolves.toEqual(['adult-gerontology', 'private-practice']);
        const args = findMany.mock.calls[0][0] as { where: Record<string, unknown>; select: Record<string, boolean> };
        expect(args.where).toMatchObject({ type: 'category-landing', locationSlug: 'all' });
        expect(args.where.updatedAt).toEqual({ gte: expect.any(Date) });
        expect(args.where).not.toHaveProperty('indexable');
        expect(args.select).toEqual({ categorySlug: true, totalJobs: true });
    });

    it('an unreadable table is null, so every link stays', async () => {
        findMany.mockRejectedValue(new Error('db blip'));
        await expect(loadEmptyLandingSlugs('test')).resolves.toBeNull();
    });

    it('a readable table is a set', async () => {
        findMany.mockResolvedValue([{ categorySlug: 'adult-gerontology', totalJobs: 0 }] as never);
        await expect(loadEmptyLandingSlugs('test')).resolves.toEqual(new Set(['adult-gerontology']));
    });
});
