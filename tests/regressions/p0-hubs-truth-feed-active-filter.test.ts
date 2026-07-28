/**
 * P0 hubs-truth regression guards — feed.xml serving expired/dead jobs
 * (content audit 2026-07, P0 #21) + live channel count (P0 #5).
 *
 * #21 — feed.xml queried on bare `isPublished: true`, so jobs that had
 *       expired or whose apply links had been dead for many consecutive
 *       health checks (and therefore 410 on the site) kept flowing to
 *       Google News, Feedly, and AI aggregators. The fix routes the query
 *       through activeIndexableJobWhere() — the same shared gate the
 *       sitemaps use (published + not expired + below the dead-link miss
 *       threshold).
 *
 * #5  — the channel description now interpolates the cached SiteStat
 *       counter instead of a fabricated hardcoded figure.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '@/lib/prisma';
import { DEAD_LINK_MISS_THRESHOLD } from '@/lib/active-job-filter';

vi.mock('@/lib/site-stats', () => ({
    getSiteStats: vi.fn().mockResolvedValue({
        totalJobs: 1234,
        totalCompanies: 321,
        totalSubscribers: 0,
    }),
}));

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const FEED_ROUTE = 'app/feed.xml/route.ts';

beforeEach(() => vi.clearAllMocks());

describe('P0 #21 static — feed.xml uses the shared indexable-job gate', () => {
    it('imports activeIndexableJobWhere and uses it as the where clause', () => {
        const src = read(FEED_ROUTE);
        expect(src).toMatch(
            /import\s*\{[^}]*\bactiveIndexableJobWhere\b[^}]*\}\s*from\s*'@\/lib\/active-job-filter'/,
        );
        expect(src).toMatch(/where:\s*activeIndexableJobWhere\(\)/);
        // The bare filter must stay dead.
        expect(src).not.toMatch(/where:\s*\{\s*isPublished:\s*true\s*\}/);
    });
});

describe('P0 #21 behavioral — the query excludes expired and dead-link jobs', () => {
    it('passes the full activeIndexableJobWhere() shape to prisma', async () => {
        vi.mocked(prisma.job.findMany).mockResolvedValue([] as never);

        const { GET } = await import('@/app/feed.xml/route');
        const res = await GET();
        expect(res.status).toBe(200);

        expect(prisma.job.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    isPublished: true,
                    healthConsecutiveMissing: { lt: DEAD_LINK_MISS_THRESHOLD },
                    OR: expect.arrayContaining([
                        { expiresAt: null },
                        { expiresAt: { gt: expect.any(Date) } },
                    ]),
                }),
            }),
        );
    });
});

describe('P0 #5 behavioral — channel description carries the live counter', () => {
    it('interpolates the rounded SiteStat total, not a fabricated figure', async () => {
        vi.mocked(prisma.job.findMany).mockResolvedValue([] as never);

        const { GET } = await import('@/app/feed.xml/route');
        const res = await GET();
        expect(res.status).toBe(200);

        const xml = await res.text();
        // Same rounding expression as the route (homepage pattern):
        // 1234 → floor(1234/100)*100 = "1,200+".
        const expectedDisplay = `${(Math.floor(1234 / 100) * 100).toLocaleString()}+`;
        expect(xml).toContain(`${expectedDisplay} positions`);
        expect(xml).not.toContain('10,000+');
        expect(xml).not.toContain('#1');
    });
});
