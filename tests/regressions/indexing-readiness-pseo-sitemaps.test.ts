/**
 * Indexing readiness (2026-09 audit, FB-1): the cities sitemap and the
 * sitemap index agree, list nothing the pages noindex, and the index lists
 * no empty cities child (Search Console reports an empty urlset as a sitemap
 * with no entries).
 *
 * With SETTING_STATE_INDEXING_ENABLED off (the shipped state) neither route
 * reads the setting x state rows at all. The switched-on behaviour is pinned
 * in indexing-readiness-setting-state-on.test.ts, which mocks the switch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The index dates /sitemap.xml by its newest listed post too (CS-02); keep
// that read off the network.
vi.mock('@/lib/blog', () => ({ getAllPublishedSlugs: vi.fn(async () => []) }));

import { prisma } from '@/lib/prisma';
import { brand } from '@/config/brand';
import { SETTING_STATE_INDEXING_ENABLED } from '@/lib/pseo/render-gate';
import { GET as citiesSitemapGET } from '@/app/api/sitemaps/cities/[batch]/route';
import { GET as sitemapIndexGET } from '@/app/api/sitemaps/index/route';

const BASE = process.env.NEXT_PUBLIC_BASE_URL || brand.baseUrl;
const STAMP = new Date();

type StatsRow = {
    categorySlug: string;
    locationSlug: string;
    totalJobs: number;
    distinctEmployers: number;
    indexable: boolean;
    updatedAt: Date;
};

let categoryCityRows: StatsRow[] = [];
let settingStateRows: StatsRow[] = [];

const queryRaw = () => vi.mocked(prisma.$queryRaw);

beforeEach(() => {
    vi.clearAllMocks();
    categoryCityRows = [];
    settingStateRows = [
        { categorySlug: 'remote', locationSlug: 'texas', totalJobs: 9, distinctEmployers: 5, indexable: true, updatedAt: STAMP },
    ];
    queryRaw().mockImplementation((async (_strings: TemplateStringsArray, ...values: unknown[]) => {
        if (values[0] === 'category-city') return categoryCityRows;
        if (values[0] === 'setting-state') return settingStateRows;
        return [];
    }) as never);
    vi.mocked(prisma.job.findFirst).mockResolvedValue({ updatedAt: STAMP } as never);
    vi.mocked(prisma.job.count).mockResolvedValue(600 as never);
});

async function batchUrls(batch = '0'): Promise<string[]> {
    const response = await citiesSitemapGET(new Request(`http://localhost/api/sitemaps/cities/${batch}`), {
        params: Promise.resolve({ batch }),
    });
    const xml = await response.text();
    return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}

async function indexChildren(): Promise<string[]> {
    const response = await sitemapIndexGET();
    const xml = await response.text();
    return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}

describe('FB-1: the setting x state section is off', () => {
    it('ships switched off', () => {
        expect(SETTING_STATE_INDEXING_ENABLED).toBe(false);
    });

    it('the cities sitemap emits no /jobs/{setting}/{state} URL and never reads those rows', async () => {
        const urls = await batchUrls();
        expect(urls.some((u) => /\/jobs\/remote\/texas$/.test(u))).toBe(false);
        const types = queryRaw().mock.calls.map((call) => call[1]);
        expect(types).not.toContain('setting-state');
    });

    it('the sitemap index does not count them either', async () => {
        await indexChildren();
        const types = queryRaw().mock.calls.map((call) => call[1]);
        expect(types).not.toContain('setting-state');
    });
});

describe('the index lists a cities child only when the batch carries URLs', () => {
    it('no passing row: no cities child, while batch 0 still answers an empty urlset', async () => {
        categoryCityRows = [
            // Old-floor row (3 jobs from 2 employers) stored true before the audit.
            { categorySlug: 'remote', locationSlug: 'los-angeles-ca', totalJobs: 3, distinctEmployers: 2, indexable: true, updatedAt: STAMP },
        ];
        const children = await indexChildren();
        expect(children).toContain(`${BASE}/sitemap.xml`);
        expect(children.some((c) => c.includes('/api/sitemaps/cities/'))).toBe(false);
        expect(children.some((c) => c.includes('/api/sitemaps/jobs/0'))).toBe(true);
        const response = await citiesSitemapGET(new Request('http://localhost/api/sitemaps/cities/0'), {
            params: Promise.resolve({ batch: '0' }),
        });
        expect(response.status).toBe(200);
        expect(await batchUrls()).toEqual([]);
    });

    it('one passing row: exactly one cities child, and the batch holds exactly that URL', async () => {
        categoryCityRows = [
            { categorySlug: 'remote', locationSlug: 'new-york-ny', totalJobs: 6, distinctEmployers: 3, indexable: true, updatedAt: STAMP },
            { categorySlug: 'remote', locationSlug: 'chicago-il', totalJobs: 6, distinctEmployers: 3, indexable: false, updatedAt: STAMP },
        ];
        const children = await indexChildren();
        expect(children.filter((c) => c.includes('/api/sitemaps/cities/'))).toEqual([`${BASE}/api/sitemaps/cities/0`]);
        expect(await batchUrls()).toEqual([`${BASE}/jobs/remote/city/new-york-ny`]);
    });

    it('a failed count lists no cities child and is not cached', async () => {
        queryRaw().mockRejectedValue(new Error('db down'));
        const response = await sitemapIndexGET();
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        const xml = await response.text();
        expect(xml).not.toContain('/api/sitemaps/cities/');
    });
});
