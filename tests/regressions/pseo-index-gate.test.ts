/**
 * pSEO index gates (PLAN C.2, package W1-SITEMAP).
 *
 * Robots, the sitemaps and the aggregation cron must read ONE predicate per
 * page type (lib/pseo/render-gate.ts) over counts taken with the canonical
 * job predicate, so a sitemap URL can never be one the page renders noindex.
 *
 * Three layers are pinned:
 *   1. Source: every sitemap filter imports a render-gate function or reads
 *      the cron's stored `indexable` / `distinctEmployers` columns; the old
 *      per-file copies (METRO_ADJACENT_CITIES, PSEO_STALENESS_HOURS, the
 *      `/post-job` entry) stay gone; the cron groups employers in one query
 *      and writes the two gate columns through $executeRaw (the generated
 *      client predates them and must not be regenerated on this branch).
 *   2. Config: the cron strips the location keys from each config's
 *      buildWhere to lift it to the whole category, so every config must keep
 *      `state` and `city` at the top level of the clause it returns.
 *   3. Behaviour: the primary sitemap, the cities batch route and the cron's
 *      Phase 1 run against fixtures and produce exactly the gated URLs and
 *      stored verdicts the gates prescribe.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { brand } from '@/config/brand';
import { SETTING_CONFIGS } from '@/lib/pseo/setting-state-config';
import { ALL_CATEGORY_CONFIGS } from '@/lib/pseo/category-city-template';
import { getAllLicenseGuideSlugs, LICENSE_GUIDE_REVIEWED_AT } from '@/lib/blog-license-guides';
import { PSEO_STATS_MAX_AGE_MS } from '@/lib/pseo/render-gate';
import type { ListingFactRow } from '@/lib/pseo/listing-facts';
import { getAllPublishedSlugs } from '@/lib/blog';
import { fetchNpAnalyticsRows, getPublishableSalaryGuideStates } from '@/lib/salary-analytics';
import sitemap from '@/app/sitemap';
import { GET as citiesSitemapGET } from '@/app/api/sitemaps/cities/[batch]/route';
import { GET as aggregatePseoGET } from '@/app/api/cron/aggregate-pseo/route';

vi.mock('@/lib/blog', () => ({ getAllPublishedSlugs: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/discord-notifier', () => ({
    sendDiscordMessage: vi.fn(async () => undefined),
    sendCronFailureAlert: vi.fn(async () => undefined),
}));
vi.mock('@/lib/salary-analytics', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/salary-analytics')>();
    return { ...actual, getPublishableSalaryGuideStates: vi.fn(), fetchNpAnalyticsRows: vi.fn() };
});
vi.mock('@/lib/auth/verify-cron-or-admin', () => ({ verifyCronOrAdmin: vi.fn(async () => null) }));
vi.mock('@/lib/cron/track', () => ({
    withCronTracking: vi.fn(async (_name: string, body: () => Promise<{ response: unknown }>) => (await body()).response),
}));
vi.mock('@/app/api/cron/aggregate-pseo/cursor', () => ({
    readCityCursor: vi.fn(async () => 0),
    persistCityCursor: vi.fn(async () => true),
    clampOffset: vi.fn((offset: number) => offset),
    computeNextOffset: vi.fn((start: number, done: number, total: number) => (start + done) % total),
}));
vi.mock('@/app/api/cron/aggregate-pseo/chain', () => ({
    dispatchSelfChain: vi.fn(() => false),
    MAX_CHAIN_DEPTH: 3,
}));
vi.mock('@/app/api/cron/aggregate-pseo/staleness', () => ({
    checkCategoryCityStaleness: vi.fn(async () => null),
}));

const ROOT = process.cwd();
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8');
const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SITEMAP = 'app/sitemap.ts';
const CITIES_ROUTE = 'app/api/sitemaps/cities/[batch]/route.ts';
const CRON_ROUTE = 'app/api/cron/aggregate-pseo/route.ts';
const POST_JOB_LAYOUT = 'app/post-job/layout.tsx';

const BASE = process.env.NEXT_PUBLIC_BASE_URL || brand.baseUrl;
const DAY_MS = 24 * 60 * 60 * 1000;
const STAMP = new Date('2026-09-18T12:00:00.000Z');

/** The prisma mock predates PseoStats and $executeRaw; add them for these suites. */
const prismaMock = prisma as unknown as Record<string, unknown> & {
    pseoStats: { findMany: ReturnType<typeof vi.fn>; createMany: ReturnType<typeof vi.fn> };
    $executeRaw: ReturnType<typeof vi.fn>;
};
prismaMock.pseoStats = { findMany: vi.fn(), createMany: vi.fn() };
prismaMock.$executeRaw = vi.fn();

function factRow(over: Partial<ListingFactRow> = {}): ListingFactRow {
    return {
        employer: 'Alpha Health',
        companyId: null,
        city: 'Waco',
        state: 'Texas',
        stateCode: 'TX',
        isRemote: true,
        isHybrid: false,
        jobType: 'full-time',
        setting: null,
        categoryTags: ['remote', 'full-time'],
        originalPostedAt: null,
        createdAt: new Date(Date.now() - 2 * DAY_MS),
        newGradFriendly: false,
        salaryIsEstimated: true,
        normalizedMinSalary: null,
        ...over,
    };
}

/** Six Texas rows: two employers, three cities, all posted this month. */
const TEXAS_ROWS: ListingFactRow[] = [
    factRow(),
    factRow({ employer: 'Beta Clinic' }),
    factRow({ city: 'Lubbock' }),
    factRow({ city: 'Lubbock', employer: 'Beta Clinic' }),
    factRow({ city: 'Amarillo' }),
    factRow({ city: 'Amarillo', employer: 'Beta Clinic' }),
];
/** Three California rows from one employer in one city: count passes, signals fail. */
const CALIFORNIA_ROWS: ListingFactRow[] = [0, 1, 2].map(() =>
    factRow({ state: 'California', stateCode: 'CA', city: 'Fresno' }),
);

/* ─── 1. Source assertions ─────────────────────────────────────────────── */

describe('app/sitemap.ts reads the render gates', () => {
    const src = read(SITEMAP);
    const code = stripComments(src);

    it.each([
        'shouldIndexListingPage',
        'shouldIndexLocalListingPage',
        'shouldIndexStateHub',
        'shouldIndexStateCityDirectory',
        'shouldIndexMetro',
        'shouldIndexCompanyProfile',
        'pseoStatsFreshnessThreshold',
    ])('imports and calls %s from lib/pseo/render-gate', (fn) => {
        expect(src).toMatch(new RegExp(`import \\{[^}]*\\b${fn}\\b[^}]*\\} from '@/lib/pseo/render-gate'`));
        expect(code).toMatch(new RegExp(`\\b${fn}\\(`));
    });

    it('metros share the page predicate: metroScopeWhere in, METRO_ADJACENT_CITIES out', () => {
        expect(src).toMatch(/import \{[^}]*\bmetroScopeWhere\b[^}]*\} from '@\/lib\/pseo\/listing-facts'/);
        expect(code).toContain('metroScopeWhere(metro)');
        expect(src).not.toContain('METRO_ADJACENT_CITIES');
        expect(code).not.toMatch(/city\s*\|\|\s*''\)\.toLowerCase\(\)\.includes\(/);
    });

    it('salary-guide states intersect the active-job set with the publishable set', () => {
        expect(src).toContain("import { getPublishableSalaryGuideStates } from '@/lib/salary-analytics'");
        const block = code.slice(code.indexOf('salaryGuideStatePages = US_STATES.filter'));
        expect(block).toContain('statesWithJobs.has(s) && publishableSalaryStates.has(s)');
    });

    it('city pages gate on distinct employers from a grouped employer query', () => {
        expect(code).toMatch(/by: \['city', 'state', 'employer'\]/);
        expect(code).toContain("shouldIndexLocalListingPage({ activeJobs: c._count.city, distinctEmployers })");
        expect(code).not.toMatch(/_count\.city < 3/);
    });

    it('category landings read the fresh category-landing row and gate on shouldIndexListingPage', () => {
        expect(code).toMatch(/type: 'category-landing', locationSlug: 'all', updatedAt: \{ gte: pseoStatsFreshnessThreshold\(\) \}/);
        expect(code).toContain('shouldIndexListingPage(row.totalJobs)');
    });

    it('company pages keep the 8-job floor until the re-crawl, expressed through the gate', () => {
        expect(code).toContain('SITEMAP_COMPANY_MIN_JOBS_UNTIL_RECRAWL = 8');
        expect(code).toContain('shouldIndexCompanyProfile(c._count.jobs) && c._count.jobs >= SITEMAP_COMPANY_MIN_JOBS_UNTIL_RECRAWL');
    });

    it('advertises all 51 license guides from the registry, in both the healthy and the degraded list', () => {
        expect(src).toContain("import { getAllLicenseGuideSlugs, LICENSE_GUIDE_REVIEWED_AT } from '@/lib/blog-license-guides'");
        expect(code.match(/\.\.\.licenseGuidePages,/g)?.length).toBe(2);
        expect(getAllLicenseGuideSlugs()).toHaveLength(51);
    });

    it('does not emit /post-job', () => {
        expect(code).not.toContain('/post-job');
    });

    it('inventory-gated sections default to empty in degraded mode', () => {
        for (const section of ['metroPages', 'categoryLandingPages', 'statePages', 'salaryGuideStatePages', 'stateCityDirectoryPages']) {
            expect(code).toContain(`let ${section}: MetadataRoute.Sitemap = []`);
        }
    });
});

describe('app/api/sitemaps/cities/[batch]/route.ts reads the stored verdicts', () => {
    const src = read(CITIES_ROUTE);
    const code = stripComments(src);

    it('imports the freshness window and the local listing gate from render-gate', () => {
        expect(src).toContain("import { pseoStatsFreshnessThreshold, shouldIndexLocalListingPage } from '@/lib/pseo/render-gate'");
        expect(src).not.toMatch(/PSEO_STALENESS_HOURS\s*=/);
        expect(src).not.toMatch(/MIN_SETTING_STATE_SITEMAP_JOBS/);
    });

    it('selects indexable and distinctEmployers through $queryRaw (the client predates the columns)', () => {
        expect(code).toContain('prisma.$queryRaw<PseoStatsRow[]>`');
        expect(code).toMatch(/SELECT "categorySlug", "locationSlug", "totalJobs", "distinctEmployers", "indexable", "updatedAt"/);
        expect(code).toContain('AND "updatedAt" >= ${pseoStatsFreshnessThreshold()}');
        expect(code).not.toMatch(/prisma\.pseoStats\.findMany/);
    });

    it('category x city rows pass through shouldIndexLocalListingPage; setting x state rows through indexable', () => {
        expect(code).toContain('shouldIndexLocalListingPage({ activeJobs: row.totalJobs, distinctEmployers: row.distinctEmployers })');
        expect(code).toContain('if (!row.indexable) continue;');
        expect(code).not.toMatch(/totalJobs: \{ gte/);
    });
});

describe('app/post-job/layout.tsx is noindex, follow with a self canonical', () => {
    const src = read(POST_JOB_LAYOUT);

    it('sets robots noindex, follow and keeps the canonical', () => {
        expect(src).toContain('robots: { index: false, follow: true }');
        expect(src).toContain('canonical: `${brand.baseUrl}/post-job`');
    });
});

describe('app/api/cron/aggregate-pseo/route.ts computes and stores the gate columns', () => {
    const src = read(CRON_ROUTE);
    const code = stripComments(src);

    it('imports the three gates it stores verdicts for', () => {
        expect(src).toMatch(/import \{[\s\S]*?shouldIndexListingPage,[\s\S]*?shouldIndexLocalListingPage,[\s\S]*?shouldIndexSettingState,[\s\S]*?\} from '@\/lib\/pseo\/render-gate'/);
    });

    it('groups employers once per category (state, city, employer) instead of per row', () => {
        expect(code).toMatch(/by: \['state', 'city', 'employer'\]/);
        expect(code).toMatch(/by: \['employer'\]/);
        expect(code).toContain('selectEmployers(');
        expect(code).not.toMatch(/prisma\.job\.aggregate\(/);
        expect(code).not.toMatch(/_avg/);
    });

    it('writes distinctEmployers and indexable through $executeRaw with bound parameters', () => {
        expect(code).toContain('prisma.$executeRaw`');
        expect(code).toContain('"distinctEmployers" = v."distinctEmployers"');
        expect(code).toContain('"indexable" = v."indexable"');
        expect(code).toContain('${row.distinctEmployers}::int, ${row.indexable}::boolean');
        expect(code).not.toMatch(/\$executeRawUnsafe|\$queryRawUnsafe/);
    });

    it("writes a 'category-landing' row per slug at locationSlug 'all'", () => {
        expect(code).toContain("const LANDING_LOCATION_SLUG = 'all'");
        expect(code).toContain("type: 'category-landing'");
        expect(code).toContain('ALL_CATEGORY_SLUGS.map((slug) => async () => [await aggregateCategoryLanding(slug, now)])');
    });

    it('keeps the rotating cursor, the chain and the duration guard', () => {
        expect(code).toContain('readCityCursor(totalCities)');
        expect(code).toContain('persistCityCursor(nextOffset)');
        expect(code).toContain('dispatchSelfChain({ nextOffset, chainDepth })');
        expect(code).toContain('export const maxDuration = 300');
        expect(code).toContain('TIME_BUDGET_MS');
    });
});

/* ─── 2. Config invariant behind the cron's category lift ──────────────── */

describe('every config keeps its location keys at the top level of buildWhere', () => {
    const PROBE = 'zz-location-probe-zz';
    const withoutLocation = (where: Record<string, unknown>): Record<string, unknown> =>
        Object.fromEntries(Object.entries(where).filter(([key]) => key !== 'state' && key !== 'city'));

    it.each(Object.keys(SETTING_CONFIGS))('SETTING_CONFIGS.%s', (slug) => {
        const where = SETTING_CONFIGS[slug].buildWhere(PROBE);
        expect(where).toHaveProperty('state');
        expect(JSON.stringify(withoutLocation(where))).not.toContain(PROBE);
    });

    it.each(Object.keys(ALL_CATEGORY_CONFIGS))('ALL_CATEGORY_CONFIGS.%s', (slug) => {
        const where = ALL_CATEGORY_CONFIGS[slug].buildWhere(PROBE, PROBE);
        expect(where).toHaveProperty('state');
        expect(where).toHaveProperty('city');
        expect(JSON.stringify(withoutLocation(where))).not.toContain(PROBE);
    });
});

/* ─── 3. Behaviour: the primary sitemap ────────────────────────────────── */

type GroupByArgs = { by: readonly string[] };
type AggregateArgs = { where?: { AND?: Array<{ OR?: Array<{ city?: { contains?: string } }> }> } };

function mockSitemapInventory() {
    vi.mocked(prisma.job.findFirst).mockResolvedValue({ updatedAt: STAMP } as never);
    vi.mocked(prisma.job.count).mockResolvedValue(5 as never);
    vi.mocked(prisma.job.findMany).mockResolvedValue([...TEXAS_ROWS, ...CALIFORNIA_ROWS] as never);
    vi.mocked(prisma.job.groupBy).mockImplementation((async (args: GroupByArgs) => {
        const by = [...args.by].join(',');
        if (by === 'state') {
            return [
                { state: 'Texas', _count: { state: 6 }, _max: { updatedAt: STAMP } },
                { state: 'California', _count: { state: 3 }, _max: { updatedAt: STAMP } },
            ];
        }
        if (by === 'city,state') {
            return [
                { city: 'Waco', state: 'Texas', _count: { city: 4 }, _max: { updatedAt: STAMP } },
                { city: 'Lubbock', state: 'Texas', _count: { city: 3 }, _max: { updatedAt: STAMP } },
                { city: 'Amarillo', state: 'Texas', _count: { city: 3 }, _max: { updatedAt: STAMP } },
                { city: 'Fresno', state: 'California', _count: { city: 3 }, _max: { updatedAt: STAMP } },
                { city: 'Bakersfield', state: 'California', _count: { city: 1 }, _max: { updatedAt: STAMP } },
                { city: 'Modesto', state: 'California', _count: { city: 1 }, _max: { updatedAt: STAMP } },
            ];
        }
        if (by === 'city,state,employer') {
            return [
                { city: 'Waco', state: 'Texas', employer: 'Alpha Health', _count: { _all: 2 } },
                { city: 'Waco', state: 'Texas', employer: 'Beta Clinic', _count: { _all: 2 } },
                { city: 'Lubbock', state: 'Texas', employer: 'Alpha Health', _count: { _all: 3 } },
                { city: 'Amarillo', state: 'Texas', employer: 'Alpha Health', _count: { _all: 2 } },
                { city: 'Amarillo', state: 'Texas', employer: 'Beta Clinic', _count: { _all: 1 } },
                { city: 'Fresno', state: 'California', employer: 'Gamma Care', _count: { _all: 3 } },
            ];
        }
        return [];
    }) as never);
    vi.mocked(prisma.job.aggregate).mockImplementation((async (args: AggregateArgs) => {
        const city = args.where?.AND?.[1]?.OR?.[0]?.city?.contains;
        const activeJobs = city === 'Dallas' ? 3 : city === 'Miami' ? 2 : 0;
        return { _count: { _all: activeJobs }, _max: { updatedAt: activeJobs > 0 ? STAMP : null } };
    }) as never);
    vi.mocked(prisma.company.findMany).mockResolvedValue([
        { id: 'c1', normalizedName: 'alpha health', _count: { jobs: 8 } },
        { id: 'c2', normalizedName: 'beta-clinic', _count: { jobs: 7 } },
    ] as never);
    prismaMock.pseoStats.findMany.mockResolvedValue([
        { categorySlug: 'remote', totalJobs: 3, updatedAt: STAMP },
        { categorySlug: 'telehealth', totalJobs: 2, updatedAt: STAMP },
    ]);
    vi.mocked(getPublishableSalaryGuideStates).mockResolvedValue(new Set(['Texas']));
    vi.mocked(getAllPublishedSlugs).mockResolvedValue([
        { slug: 'np-license-texas', updated_at: '2026-08-01T00:00:00.000Z' },
        { slug: 'some-post', updated_at: '2026-07-01T00:00:00.000Z' },
    ]);
}

describe('primary sitemap emits exactly the URLs the page gates index', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSitemapInventory();
    });

    it('never lists /post-job and never lists a URL twice', async () => {
        const entries = await sitemap();
        const urls = entries.map((e) => e.url);
        expect(urls).not.toContain(`${BASE}/post-job`);
        expect(new Set(urls).size).toBe(urls.length);
    });

    it('lists all 51 license guides once, with the DB updated_at where a row exists', async () => {
        const entries = await sitemap();
        const byUrl = new Map(entries.map((e) => [e.url, e]));
        for (const slug of getAllLicenseGuideSlugs()) {
            expect(byUrl.has(`${BASE}/blog/${slug}`), slug).toBe(true);
        }
        expect(byUrl.get(`${BASE}/blog/np-license-texas`)?.lastModified).toEqual(new Date('2026-08-01T00:00:00.000Z'));
        expect(byUrl.get(`${BASE}/blog/np-license-alabama`)?.lastModified).toEqual(new Date(LICENSE_GUIDE_REVIEWED_AT));
        expect(byUrl.has(`${BASE}/blog/some-post`)).toBe(true);
    });

    it('state hubs: 6 jobs with 5 live sections index, 3 jobs with 2 sections do not', async () => {
        const urls = (await sitemap()).map((e) => e.url);
        expect(urls).toContain(`${BASE}/jobs/state/texas`);
        expect(urls).not.toContain(`${BASE}/jobs/state/california`);
    });

    it('salary-guide states: only a state with jobs AND a published median', async () => {
        const urls = (await sitemap()).map((e) => e.url);
        expect(urls).toContain(`${BASE}/salary-guide/texas`);
        expect(urls).not.toContain(`${BASE}/salary-guide/california`);
    });

    it('metros: shouldIndexMetro over metroScopeWhere (3 jobs in, 2 jobs out)', async () => {
        const urls = (await sitemap()).map((e) => e.url);
        expect(urls).toContain(`${BASE}/jobs/metro/dallas-tx`);
        expect(urls).not.toContain(`${BASE}/jobs/metro/miami-fl`);
    });

    it('category landings: only slugs with a fresh row at 3 or more jobs', async () => {
        const urls = (await sitemap()).map((e) => e.url);
        expect(urls).toContain(`${BASE}/jobs/remote`);
        expect(urls).not.toContain(`${BASE}/jobs/telehealth`);
        expect(urls).not.toContain(`${BASE}/jobs/inpatient`);
    });

    it('city directories: 3 linkable cities index, a rendering directory with 1 does not', async () => {
        const urls = (await sitemap()).map((e) => e.url);
        expect(urls).toContain(`${BASE}/jobs/locations/texas`);
        expect(urls).not.toContain(`${BASE}/jobs/locations/california`);
    });

    it('city pages: 3 or more jobs from 2 or more employers only', async () => {
        const urls = (await sitemap()).map((e) => e.url);
        expect(urls).toContain(`${BASE}/jobs/city/waco-tx`);
        expect(urls).toContain(`${BASE}/jobs/city/amarillo-tx`);
        expect(urls).not.toContain(`${BASE}/jobs/city/lubbock-tx`);
        expect(urls).not.toContain(`${BASE}/jobs/city/fresno-ca`);
    });

    it('company pages: the 8-job floor holds until the re-crawl', async () => {
        const urls = (await sitemap()).map((e) => e.url);
        expect(urls).toContain(`${BASE}/companies/alpha-health`);
        expect(urls).not.toContain(`${BASE}/companies/beta-clinic`);
    });

    it('degraded mode advertises no inventory-gated page type but keeps the license guides', async () => {
        vi.mocked(prisma.job.count).mockRejectedValue(new Error('db down'));
        const urls = (await sitemap()).map((e) => e.url);
        for (const prefix of ['/jobs/state/', '/salary-guide/texas', '/jobs/metro/', '/jobs/locations/texas', '/jobs/city/', '/companies/alpha']) {
            expect(urls.some((u) => u.includes(prefix)), prefix).toBe(false);
        }
        expect(urls.filter((u) => u.includes('/blog/np-license-'))).toHaveLength(51);
        expect(urls).not.toContain(`${BASE}/jobs/remote`);
    });
});

/* ─── 4. Behaviour: the cities batch route ─────────────────────────────── */

describe('cities batch route emits only rows whose stored verdict says index', () => {
    const queryRaw = () => vi.mocked(prisma.$queryRaw);

    beforeEach(() => {
        vi.clearAllMocks();
        queryRaw().mockImplementation((async (_strings: TemplateStringsArray, ...values: unknown[]) => {
            const type = values[0];
            if (type === 'category-city') {
                return [
                    { categorySlug: 'remote', locationSlug: 'new-york-ny', totalJobs: 3, distinctEmployers: 2, indexable: true, updatedAt: STAMP },
                    { categorySlug: 'remote', locationSlug: 'waco-tx', totalJobs: 3, distinctEmployers: 1, indexable: false, updatedAt: STAMP },
                    { categorySlug: 'remote', locationSlug: 'lubbock-tx', totalJobs: 2, distinctEmployers: 2, indexable: false, updatedAt: STAMP },
                ];
            }
            if (type === 'setting-state') {
                return [
                    { categorySlug: 'remote', locationSlug: 'texas', totalJobs: 5, distinctEmployers: 3, indexable: true, updatedAt: STAMP },
                    { categorySlug: 'remote', locationSlug: 'california', totalJobs: 5, distinctEmployers: 3, indexable: false, updatedAt: STAMP },
                ];
            }
            return [];
        }) as never);
    });

    async function batchZero(): Promise<string> {
        const response = await citiesSitemapGET(new Request('http://localhost/api/sitemaps/cities/0'), {
            params: Promise.resolve({ batch: '0' }),
        });
        return response.text();
    }

    it('category x city: 3 jobs from 2 employers in; one employer or 2 jobs out', async () => {
        const xml = await batchZero();
        expect(xml).toContain(`${BASE}/jobs/remote/city/new-york-ny`);
        expect(xml).not.toContain('/jobs/remote/city/waco-tx');
        expect(xml).not.toContain('/jobs/remote/city/lubbock-tx');
    });

    it('setting x state: the stored indexable flag decides, not the count', async () => {
        const xml = await batchZero();
        expect(xml).toContain(`${BASE}/jobs/remote/texas`);
        expect(xml).not.toContain('/jobs/remote/california');
    });

    it('both reads bind the type and the 36-hour freshness threshold as parameters', async () => {
        await batchZero();
        const calls = queryRaw().mock.calls as unknown as Array<[TemplateStringsArray, ...unknown[]]>;
        expect(calls.map((c) => c[1]).sort()).toEqual(['category-city', 'setting-state']);
        for (const call of calls) {
            const threshold = call[2];
            expect(threshold).toBeInstanceOf(Date);
            const age = Date.now() - (threshold as Date).getTime();
            expect(Math.abs(age - PSEO_STATS_MAX_AGE_MS)).toBeLessThan(60_000);
            expect(call[0].join('?')).toContain('"indexable"');
        }
    });
});

/* ─── 5. Behaviour: the cron's Phase 1 (setting x state and landings) ──── */

describe('aggregate-pseo Phase 1 stores the gate verdicts the pages compute live', () => {
    /** Reassemble the VALUES tuples bound into one UPDATE statement. */
    function writtenRows(): unknown[][] {
        const rows: unknown[][] = [];
        for (const call of prismaMock.$executeRaw.mock.calls as unknown as Array<[TemplateStringsArray, Date, { values: unknown[] }]>) {
            const flat = call[2].values;
            for (let i = 0; i + 5 < flat.length; i += 6) rows.push(flat.slice(i, i + 6));
        }
        return rows;
    }
    const findRow = (type: string, categorySlug: string, locationSlug: string) =>
        writtenRows().find((r) => r[0] === type && r[1] === categorySlug && r[2] === locationSlug);

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(prisma.job.findMany).mockResolvedValue(TEXAS_ROWS as never);
        vi.mocked(prisma.job.groupBy).mockResolvedValue([
            { employer: 'Alpha Health', _count: { _all: 2 } },
            { employer: 'Beta Clinic', _count: { _all: 1 } },
        ] as never);
        vi.mocked(fetchNpAnalyticsRows).mockResolvedValue([]);
        prismaMock.pseoStats.createMany.mockResolvedValue({ count: 0 });
        prismaMock.$executeRaw.mockResolvedValue(0);
    });

    it('runs the state-only mode to completion', async () => {
        const response = await aggregatePseoGET(new NextRequest('http://localhost/api/cron/aggregate-pseo?mode=state'));
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.mode).toBe('state');
        expect(body.settingStateCount).toBe(Object.keys(SETTING_CONFIGS).length * 51);
        expect(body.categoryLandingCount).toBeGreaterThan(0);
    });

    it('setting x state: 6 jobs from 2 employers in 3 cities is indexable; an empty state is not', async () => {
        await aggregatePseoGET(new NextRequest('http://localhost/api/cron/aggregate-pseo?mode=state'));
        expect(findRow('setting-state', 'remote', 'texas')).toEqual(['setting-state', 'remote', 'texas', 6, 2, true]);
        expect(findRow('setting-state', 'remote', 'california')).toEqual(['setting-state', 'remote', 'california', 0, 0, false]);
    });

    it("category landing: one grouped employer query gives the count and distinct employers; row keyed 'all'", async () => {
        await aggregatePseoGET(new NextRequest('http://localhost/api/cron/aggregate-pseo?mode=state'));
        expect(findRow('category-landing', 'remote', 'all')).toEqual(['category-landing', 'remote', 'all', 3, 2, true]);
        const landingGroupBys = vi.mocked(prisma.job.groupBy).mock.calls.filter(
            (call) => JSON.stringify((call[0] as GroupByArgs).by) === JSON.stringify(['employer']),
        );
        expect(landingGroupBys.length).toBeGreaterThan(0);
        const created = prismaMock.pseoStats.createMany.mock.calls.flatMap((call) => (call[0] as { data: unknown[] }).data);
        expect(created).toContainEqual(expect.objectContaining({ type: 'category-landing', categorySlug: 'remote', locationSlug: 'all', totalJobs: 3 }));
    });

    it('never issues a per-row count or aggregate', async () => {
        await aggregatePseoGET(new NextRequest('http://localhost/api/cron/aggregate-pseo?mode=state'));
        expect(vi.mocked(prisma.job.count)).not.toHaveBeenCalled();
        expect(vi.mocked(prisma.job.aggregate)).not.toHaveBeenCalled();
    });
});
