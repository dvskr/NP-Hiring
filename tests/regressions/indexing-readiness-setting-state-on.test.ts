/**
 * FB-1 switched ON (fixSoon 16, the day the owner re-admits setting x state
 * pages): the cities sitemap, the sitemap index and the page robots read the
 * stored strict verdict through one function, so they agree row for row.
 * The switch is mocked here; the shipped value is pinned off elsewhere.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/pseo/render-gate', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/pseo/render-gate')>();
    return {
        ...actual,
        SETTING_STATE_INDEXING_ENABLED: true,
        isSettingStateIndexable: (storedVerdict: boolean, enabled: boolean = true) => actual.isSettingStateIndexable(storedVerdict, enabled),
    };
});

// The index dates /sitemap.xml by its newest listed post too (CS-02); keep
// that read off the network.
vi.mock('@/lib/blog', () => ({ getAllPublishedSlugs: vi.fn(async () => []) }));

import { prisma } from '@/lib/prisma';
import { brand } from '@/config/brand';
import { GET as citiesSitemapGET } from '@/app/api/sitemaps/cities/[batch]/route';
import { GET as sitemapIndexGET } from '@/app/api/sitemaps/index/route';
import { resolveSettingStateIndexable } from '@/lib/pseo/setting-state-template';

const BASE = process.env.NEXT_PUBLIC_BASE_URL || brand.baseUrl;
const STAMP = new Date();

const SETTING_ROWS = [
    { categorySlug: 'remote', locationSlug: 'texas', totalJobs: 9, distinctEmployers: 5, indexable: true, updatedAt: STAMP },
    { categorySlug: 'remote', locationSlug: 'utah', totalJobs: 3, distinctEmployers: 1, indexable: false, updatedAt: STAMP },
    { categorySlug: 'not-a-setting', locationSlug: 'texas', totalJobs: 9, distinctEmployers: 5, indexable: true, updatedAt: STAMP },
];

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$queryRaw).mockImplementation((async (_strings: TemplateStringsArray, ...values: unknown[]) =>
        values[0] === 'setting-state' ? SETTING_ROWS : []) as never);
    vi.mocked(prisma.job.findFirst).mockResolvedValue({ updatedAt: STAMP } as never);
    vi.mocked(prisma.job.count).mockResolvedValue(600 as never);
});

describe('setting x state with the switch on', () => {
    it('the cities sitemap emits exactly the rows whose stored strict verdict is true', async () => {
        const response = await citiesSitemapGET(new Request('http://localhost/api/sitemaps/cities/0'), {
            params: Promise.resolve({ batch: '0' }),
        });
        const urls = [...(await response.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
        expect(urls).toEqual([`${BASE}/jobs/remote/texas`]);
    });

    it('the index counts the same rows, so it lists the one batch that holds them', async () => {
        const xml = await (await sitemapIndexGET()).text();
        const children = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
        expect(children.filter((c) => c.includes('/api/sitemaps/cities/'))).toEqual([`${BASE}/api/sitemaps/cities/0`]);
    });

    it('the page robots read the same verdict for the same row', () => {
        const [texas, utah] = SETTING_ROWS;
        expect(resolveSettingStateIndexable({ stored: texas, page: 1 })).toBe(true);
        expect(resolveSettingStateIndexable({ stored: utah, page: 1 })).toBe(false);
        expect(resolveSettingStateIndexable({ stored: null, page: 1 })).toBe(false);
    });
});
