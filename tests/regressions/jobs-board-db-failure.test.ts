/**
 * 2026-11-18: middleware.ts holds page 1 of /jobs at the edge for a minute for
 * every visitor (JOBS_BOARD_EDGE_CACHE), and the edge stores any 200 it gets.
 * So a failed database read on /jobs must never answer 200:
 *
 *  - The job list failing used to render the empty fallback board at 200
 *    (the browser does not refetch on load), which the edge would then serve
 *    to everyone as "no jobs". The page now rethrows, so the render answers
 *    500, which the edge never stores, and visitors keep the last good copy.
 *  - The metadata's job count failing reached a visitor as the "Something went
 *    wrong" page inside a 200 (production 2026-11-18 05:48 UTC, digest
 *    3466345125): the metadata resolves after the status has gone out. It now
 *    falls back to a title and description without the number.
 *
 * Renders the real page against a Prisma mock; nothing reaches a database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
    prisma: {
        job: { count: vi.fn(), findMany: vi.fn() },
        $queryRaw: vi.fn(),
    },
}));

import { prisma } from '@/lib/prisma';
import JobsPage, { generateMetadata } from '@/app/jobs/page';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

/** The pg pool's message when no connection frees up in time. */
const POOL_TIMEOUT = 'timeout exceeded when trying to connect';

function board(searchParams: Record<string, string> = {}) {
    return { searchParams: Promise.resolve(searchParams) };
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => { });
    db.$queryRaw.mockResolvedValue([]);
});

describe('/jobs answers an error, never a 200 board, when its database read fails', () => {
    it('a failed job list rejects the render instead of returning the empty board', async () => {
        db.job.findMany.mockRejectedValue(new Error(POOL_TIMEOUT));
        db.job.count.mockResolvedValue(638);
        await expect(JobsPage(board())).rejects.toThrow(POOL_TIMEOUT);
    });

    it('a failed job count rejects the render too', async () => {
        db.job.findMany.mockResolvedValue([]);
        db.job.count.mockRejectedValue(new Error(POOL_TIMEOUT));
        await expect(JobsPage(board())).rejects.toThrow(POOL_TIMEOUT);
    });

    it('a filtered view fails the same way', async () => {
        db.job.findMany.mockRejectedValue(new Error(POOL_TIMEOUT));
        db.job.count.mockResolvedValue(12);
        await expect(JobsPage(board({ q: 'telehealth' }))).rejects.toThrow(POOL_TIMEOUT);
    });

    it('a working database still renders the board', async () => {
        db.job.findMany.mockResolvedValue([]);
        db.job.count.mockResolvedValue(0);
        await expect(JobsPage(board())).resolves.toBeTruthy();
    });
});

describe('/jobs metadata survives a failed job count', () => {
    it('drops the number from the title and description instead of throwing', async () => {
        db.job.count.mockRejectedValue(new Error(POOL_TIMEOUT));
        const metadata = await generateMetadata(board());
        expect(String(metadata.title)).toMatch(/^[^\d]+ Jobs Near Me$/);
        expect(String(metadata.description)).toMatch(/^Search [^\d]+$/);
        expect(metadata.robots).toBeUndefined();
        expect(metadata.alternates?.canonical).toMatch(/\/jobs$/);
    });

    it('a filtered title also drops the number', async () => {
        db.job.count.mockRejectedValue(new Error(POOL_TIMEOUT));
        const metadata = await generateMetadata(board({ workMode: 'remote' }));
        expect(String(metadata.title)).toMatch(/^Remote [^\d]+ Jobs$/);
        expect(String(metadata.description)).toMatch(/^Find remote [^\d]+$/);
    });

    it('a page number cannot be range-checked without a count, so it is not 404d here', async () => {
        db.job.count.mockRejectedValue(new Error(POOL_TIMEOUT));
        const metadata = await generateMetadata(board({ page: '5' }));
        expect(String(metadata.title)).toContain('(Page 5)');
        expect(metadata.robots).toEqual({ index: false, follow: true });
    });

    it('a working count keeps the number', async () => {
        db.job.count.mockResolvedValue(638);
        const metadata = await generateMetadata(board());
        expect(String(metadata.title)).toMatch(/^[^\d]+ Jobs Near Me: 638 Openings$/);
        // P7 D6: the title never repeats a niche token ("NP & NP").
        expect(String(metadata.title)).not.toMatch(/(\b\w+\b) & \1\b/);
        expect(String(metadata.description)).toContain('Search 638 ');
    });
});
