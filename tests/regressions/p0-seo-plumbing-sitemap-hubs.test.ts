/**
 * Regression (content audit P0 #7) — four indexable pages were absent from
 * app/sitemap.ts entirely: /companies (the employer-directory hub — its
 * DETAIL pages were emitted, but the hub itself never advertised),
 * /for-programs (orphaned funnel page), and the /security +
 * /sub-processors trust/legal pages. Google discovered them only via
 * links, if at all.
 *
 * Behavioral: run the real sitemap() with mocked DB and assert all four
 * URLs are emitted with the priorities shipped — on BOTH the healthy path
 * and the degraded (DB-down) static-only fallback, since these are static
 * entries that must survive either branch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { brand } from '@/config/brand';
import sitemap from '@/app/sitemap';

vi.mock('@/lib/blog', () => ({
    getAllPublishedSlugs: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/lib/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const BASE = process.env.NEXT_PUBLIC_BASE_URL || brand.baseUrl;

const EXPECTED_ENTRIES = [
    { url: `${BASE}/companies`, priority: 0.7 },
    { url: `${BASE}/for-programs`, priority: 0.6 },
    { url: `${BASE}/security`, priority: 0.3 },
    { url: `${BASE}/sub-processors`, priority: 0.3 },
];

const mockHealthyDb = () => {
    vi.mocked(prisma.job.findFirst).mockResolvedValue(
        { updatedAt: new Date('2026-07-01T00:00:00Z') } as never,
    );
    vi.mocked(prisma.job.count).mockResolvedValue(5 as never);
    vi.mocked(prisma.job.groupBy).mockResolvedValue([] as never);
    vi.mocked(prisma.company.findMany).mockResolvedValue([] as never);
};

beforeEach(() => vi.clearAllMocks());

describe('P0 #7 — sitemap advertises the previously-missing hub/trust pages', () => {
    it('healthy path emits /companies, /for-programs, /security, /sub-processors', async () => {
        mockHealthyDb();
        const entries = await sitemap();
        const byUrl = new Map(entries.map((e) => [e.url, e]));

        for (const expected of EXPECTED_ENTRIES) {
            const entry = byUrl.get(expected.url);
            expect(entry, `${expected.url} missing from sitemap`).toBeDefined();
            expect(entry?.priority).toBe(expected.priority);
        }
    });

    it('degraded (DB-down) fallback still carries all four static entries', async () => {
        vi.mocked(prisma.job.findFirst).mockResolvedValue(
            { updatedAt: new Date('2026-07-01T00:00:00Z') } as never,
        );
        // Force the try block to fail so the static-only catch path returns.
        vi.mocked(prisma.job.count).mockRejectedValue(new Error('db down'));
        vi.mocked(prisma.job.groupBy).mockRejectedValue(new Error('db down'));
        vi.mocked(prisma.company.findMany).mockRejectedValue(new Error('db down'));

        const entries = await sitemap();
        const urls = new Set(entries.map((e) => e.url));
        for (const expected of EXPECTED_ENTRIES) {
            expect(urls.has(expected.url), `${expected.url} missing from degraded sitemap`).toBe(true);
        }
    });

    it('emits no duplicate URLs (companies hub must not collide with detail pages)', async () => {
        mockHealthyDb();
        const entries = await sitemap();
        const urls = entries.map((e) => e.url);
        expect(new Set(urls).size).toBe(urls.length);
    });
});
