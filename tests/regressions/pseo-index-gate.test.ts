/**
 * pSEO index gates (PLAN C.2, package W1-SITEMAP).
 *
 * Robots, the sitemaps and the aggregation cron must read ONE predicate per
 * page type (lib/pseo/render-gate.ts) over counts taken with the canonical
 * job predicate, so a sitemap URL can never be one the page renders noindex.
 *
 * Three layers are pinned:
 *   1. Source: every sitemap filter imports a render-gate function, reads
 *      the cron's stored `indexable` / `distinctEmployers` columns, or reads
 *      the shared gate inputs the pages themselves use
 *      (lib/pseo/state-hub-index.ts, lib/pseo/sitemap-index-inputs.ts); the
 *      old per-file copies (METRO_ADJACENT_CITIES, PSEO_STALENESS_HOURS, the
 *      `/post-job` entry, the hub section count) stay gone; the cron groups
 *      employers in one query and writes the two gate columns through
 *      $executeRaw.
 *   2. Config: the cron strips the location keys from each config's
 *      buildWhere to lift it to the whole category, so every config must keep
 *      `state` and `city` at the top level of the clause it returns.
 *   3. Behaviour: the primary sitemap, the cities batch route and the cron's
 *      Phase 1 run against fixtures and produce exactly the gated URLs and
 *      stored verdicts the gates prescribe.
 *
 * The app/sitemap.ts cases (the source block for that file and the primary
 * sitemap behaviour block) track the indexing-audit handoff that makes the
 * sitemap read the listing floor, the hub verdicts, the metro recency input
 * and the distinct-posting city inputs (package PSEO-A, CQ-06 to CQ-08).
 * They fail until that handoff lands: before it, the sitemap listed no hub
 * and no metro and still listed landings and cities the pages noindex.
 * The license guide cases likewise track the license guide package's
 * app/sitemap.ts handoff (owner decision 2: a guide is listed only once its
 * state's facts are verified), and fail until it lands.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { brand } from '@/config/brand';
import { SETTING_CONFIGS } from '@/lib/pseo/setting-state-config';
import { ALL_CATEGORY_CONFIGS } from '@/lib/pseo/category-city-template';
import { getAllLicenseGuideSlugs, getIndexableLicenseGuideSlugs, getLicenseGuideReviewedAt } from '@/lib/blog-license-guides';
import { PSEO_STATS_MAX_AGE_MS, shouldIndexLocalListingPage } from '@/lib/pseo/render-gate';
import type { ListingFactRow } from '@/lib/pseo/listing-facts';
import { computeStateHubVerdicts } from '@/lib/pseo/state-hub-index';
import { cityIndexKey, computeCityIndexInputs } from '@/lib/pseo/sitemap-index-inputs';
import { cityLinkResolves } from '@/app/jobs/locations/[state]/directory';
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

/** A setting in Texas: 6 fully remote postings from 4 employers in 4 role clusters. */
const TEXAS_SETTING_ROWS: ListingFactRow[] = [
    factRow({ title: 'Nurse Practitioner' }),
    factRow({ title: 'Nurse Practitioner', city: 'Lubbock' }),
    factRow({ employer: 'Beta Clinic', title: 'Nurse Practitioner' }),
    factRow({ employer: 'Beta Clinic', title: 'Nurse Practitioner', city: 'Amarillo' }),
    factRow({ employer: 'Gamma Care', title: 'Family Nurse Practitioner' }),
    factRow({ employer: 'Delta Medical', title: 'Psychiatric Nurse Practitioner', city: 'Lubbock' }),
];

/** The Texas hub: the setting's rows plus six on-site roles from two more employers. */
const TEXAS_HUB_ROWS: ListingFactRow[] = [
    ...TEXAS_SETTING_ROWS,
    ...['Austin', 'Dallas', 'Houston', 'Austin', 'Dallas', 'Houston'].map((city, i) =>
        factRow({ employer: i % 2 ? 'Epsilon Health' : 'Zeta Clinics', title: 'Primary Care Nurse Practitioner', city, isRemote: false })),
];

const posting = (employer: string, title: string, city: string, over: Partial<ListingFactRow> = {}): ListingFactRow =>
    factRow({ employer, title, city, ...over });

/**
 * The primary sitemap's canonical pool (the hub verdicts and the city page
 * inputs both read it), in Texas:
 *   Waco: 6 postings from 3 employers, at the listing floor.
 *   Amarillo: 4 postings from 3 employers, under it.
 *   Lubbock: 7 postings from 2 employers, under it.
 *   Temple: 5 rows from 4 employers, two of them one posting (exact
 *     duplicates), so 4 postings: under the floor, though the raw count is not.
 * The Texas hub is 21 postings from 4 employers.
 */
const SITEMAP_TEXAS_ROWS: ListingFactRow[] = [
    posting('Alpha Health', 'Family Nurse Practitioner', 'Waco'),
    posting('Alpha Health', 'Psychiatric Nurse Practitioner', 'Waco'),
    posting('Beta Clinic', 'Family Nurse Practitioner', 'Waco'),
    posting('Beta Clinic', 'Urgent Care Nurse Practitioner', 'Waco'),
    posting('Gamma Care', 'Family Nurse Practitioner', 'Waco'),
    posting('Gamma Care', 'Psychiatric Nurse Practitioner', 'Waco'),
    posting('Alpha Health', 'Family Nurse Practitioner', 'Amarillo'),
    posting('Alpha Health', 'Psychiatric Nurse Practitioner', 'Amarillo'),
    posting('Beta Clinic', 'Family Nurse Practitioner', 'Amarillo'),
    posting('Gamma Care', 'Family Nurse Practitioner', 'Amarillo'),
    ...['Family', 'Psychiatric', 'Urgent Care', 'Pediatric', 'Geriatric'].map((kind) =>
        posting('Alpha Health', `${kind} Nurse Practitioner`, 'Lubbock')),
    posting('Beta Clinic', 'Family Nurse Practitioner', 'Lubbock'),
    posting('Beta Clinic', 'Psychiatric Nurse Practitioner', 'Lubbock'),
    posting('Alpha Health', 'Family Nurse Practitioner', 'Temple'),
    posting('Alpha Health', 'Family Nurse Practitioner', 'Temple'),
    posting('Beta Clinic', 'Family Nurse Practitioner', 'Temple'),
    posting('Gamma Care', 'Family Nurse Practitioner', 'Temple'),
    posting('Delta Medical', 'Family Nurse Practitioner', 'Temple'),
];

/** The pool the sitemap's state hub and city page gates read by default. */
const SITEMAP_POOL: ListingFactRow[] = [...SITEMAP_TEXAS_ROWS, ...CALIFORNIA_ROWS];

const daysAgo = (days: number): Date => new Date(Date.now() - days * DAY_MS);

/** Rows inside each metro's scope (metroScopeWhere), keyed by the metro's city. */
const METRO_ROWS: Record<string, ListingFactRow[]> = {
    // 3 distinct postings, one first posted 5 days ago: indexes.
    Dallas: [
        posting('Alpha Health', 'Family Nurse Practitioner', 'Dallas', { originalPostedAt: daysAgo(5) }),
        posting('Beta Clinic', 'Family Nurse Practitioner', 'Plano', { originalPostedAt: daysAgo(60) }),
        posting('Gamma Care', 'Psychiatric Nurse Practitioner', 'Dallas', { originalPostedAt: daysAgo(60) }),
    ],
    // 3 rows, two of them one posting: 2 distinct postings, under the floor.
    Miami: [
        posting('Alpha Health', 'Family Nurse Practitioner', 'Miami', { state: 'Florida', stateCode: 'FL' }),
        posting('Alpha Health', 'Family Nurse Practitioner', 'Miami', { state: 'Florida', stateCode: 'FL' }),
        posting('Beta Clinic', 'Family Nurse Practitioner', 'Miami', { state: 'Florida', stateCode: 'FL' }),
    ],
    // CQ-08: 3 distinct postings, none first posted in the last 30 days.
    Nashville: ['Alpha Health', 'Beta Clinic', 'Gamma Care'].map((employer) =>
        posting(employer, 'Family Nurse Practitioner', 'Nashville', {
            state: 'Tennessee', stateCode: 'TN', originalPostedAt: daysAgo(45), createdAt: daysAgo(45),
        })),
};

/* ─── 1. Source assertions ─────────────────────────────────────────────── */

describe('app/sitemap.ts reads the render gates', () => {
    const src = read(SITEMAP);
    const code = stripComments(src);

    it.each([
        'shouldIndexCategoryLanding',
        'shouldIndexLocalListingPage',
        'shouldIndexStateCityDirectory',
        'shouldIndexMetro',
        'shouldIndexCompanyProfile',
        'pseoStatsFreshnessThreshold',
    ])('imports and calls %s from lib/pseo/render-gate', (fn) => {
        expect(src).toMatch(new RegExp(`import \\{[^}]*\\b${fn}\\b[^}]*\\} from '@/lib/pseo/render-gate'`));
        expect(code).toMatch(new RegExp(`\\b${fn}\\(`));
    });

    it('state hubs read the shared hub verdicts, never a sitemap copy of the hub gate input (CQ-07)', () => {
        expect(src).toContain("import { loadStateHubVerdicts, type StateHubVerdict } from '@/lib/pseo/state-hub-index'");
        expect(code).toContain('loadStateHubVerdicts(now)');
        // The verdict is shouldIndexStateHub over the hub page's own input:
        // distinct postings, distinct employers and the live section count.
        expect(stripComments(read('lib/pseo/state-hub-index.ts'))).toContain('indexable: shouldIndexStateHub(input)');
        // The copies that dropped distinctEmployers (every hub failed closed) are gone.
        expect(code).not.toMatch(/function countHubLiveDataSections|HUB_FACT_SELECT|fetchHubFactRowsByState/);
        expect(code).not.toContain('shouldIndexStateHub(');
    });

    it('metros share the page predicate: metroScopeWhere in, METRO_ADJACENT_CITIES out', () => {
        expect(src).toMatch(/import \{[^}]*\bmetroScopeWhere\b[^}]*\} from '@\/lib\/pseo\/listing-facts'/);
        expect(code).toContain('metroScopeWhere(metro)');
        expect(src).not.toContain('METRO_ADJACENT_CITIES');
        expect(code).not.toMatch(/city\s*\|\|\s*''\)\.toLowerCase\(\)\.includes\(/);
    });

    it('metros gate on the page input: distinct postings and the 30-day recency count (CQ-08)', () => {
        expect(src).toMatch(/import \{[^}]*\bloadMetroIndexInput\b[^}]*\} from '@\/lib\/pseo\/sitemap-index-inputs'/);
        expect(code).toContain('loadMetroIndexInput(metro, now)');
        expect(code).toContain('shouldIndexMetro(indexInput)');
        // The raw count alone left postedLast30Days undefined: every metro failed closed.
        expect(code).not.toContain('shouldIndexMetro({ activeJobs: inventory.activeJobs })');
    });

    it('salary-guide states intersect the active-job set with the publishable set', () => {
        expect(src).toContain("import { getPublishableSalaryGuideStates } from '@/lib/salary-analytics'");
        const block = code.slice(code.indexOf('salaryGuideStatePages = US_STATES.filter'));
        expect(block).toContain('statesWithJobs.has(s) && publishableSalaryStates.has(s)');
    });

    it('city pages gate on the page input: distinct postings and employers per (city, jurisdiction) (fixSoon 8)', () => {
        expect(src).toMatch(/import \{[^}]*\bcityIndexKey\b[^}]*\bloadCityIndexInputs\b[^}]*\} from '@\/lib\/pseo\/sitemap-index-inputs'/);
        expect(code).toContain('loadCityIndexInputs(now)');
        expect(code).toContain('cityIndexInputs.get(cityIndexKey(c.city, code))');
        expect(code).toContain('shouldIndexLocalListingPage(indexInput)');
        // Raw row counts (exact duplicates included) and the grouped employer copy are gone.
        expect(code).not.toContain('activeJobs: c._count.city');
        expect(code).not.toMatch(/by: \['city', 'state', 'employer'\]/);
        expect(code).not.toMatch(/_count\.city < 3/);
    });

    it('category landings read the fresh category-landing row: its stored verdict AND the listing floor (CQ-06)', () => {
        expect(code).toMatch(/type: 'category-landing', locationSlug: 'all', updatedAt: \{ gte: pseoStatsFreshnessThreshold\(\) \}/);
        expect(code).toContain('select: { categorySlug: true, totalJobs: true, distinctEmployers: true, indexable: true, updatedAt: true }');
        expect(code).toContain('!row.indexable || !shouldIndexCategoryLanding({ activeJobs: row.totalJobs, distinctEmployers: row.distinctEmployers })');
        // The 3-job count gate the landing robots no longer read.
        expect(code).not.toContain('shouldIndexListingPage');
    });

    it('company pages keep the 8-job floor until the re-crawl, expressed through the gate', () => {
        expect(code).toContain('SITEMAP_COMPANY_MIN_JOBS_UNTIL_RECRAWL = 8');
        expect(code).toContain('shouldIndexCompanyProfile(c._count.jobs) && c._count.jobs >= SITEMAP_COMPANY_MIN_JOBS_UNTIL_RECRAWL');
    });

    it('advertises the indexable license guides from the registry, in both the healthy and the degraded list', () => {
        // Owner decision 2: every guide stays live but noindexed until its
        // state's facts are verified, so the sitemap reads the same
        // predicate as the robots tag (getIndexableLicenseGuideSlugs).
        expect(src).toMatch(/import \{[^}]*\bgetIndexableLicenseGuideSlugs\b[^}]*\} from '@\/lib\/blog-license-guides'/);
        expect(code).toContain('getIndexableLicenseGuideSlugs()');
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

    it('imports the freshness window, the local listing gate and the FB-1 switch from render-gate', () => {
        expect(src).toMatch(/import \{[^}]*\bpseoStatsFreshnessThreshold\b[^}]*\bshouldIndexLocalListingPage\b[^}]*\} from '@\/lib\/pseo\/render-gate'/);
        expect(src).toMatch(/import \{[^}]*\bisSettingStateIndexable\b[^}]*\bSETTING_STATE_INDEXING_ENABLED\b[^}]*\} from '@\/lib\/pseo\/render-gate'/);
        expect(src).not.toMatch(/PSEO_STALENESS_HOURS\s*=/);
        expect(src).not.toMatch(/MIN_SETTING_STATE_SITEMAP_JOBS/);
    });

    it('selects indexable and distinctEmployers through $queryRaw (the client predates the columns)', () => {
        expect(code).toContain('prisma.$queryRaw<PseoStatsRow[]>`');
        // updatedAt is the freshness filter only, never a lastmod (CS-02).
        expect(code).toMatch(/SELECT "categorySlug", "locationSlug", "totalJobs", "distinctEmployers", "indexable"\r?\n/);
        expect(code).toContain('AND "updatedAt" >= ${pseoStatsFreshnessThreshold()}');
        expect(code).not.toMatch(/prisma\.pseoStats\.findMany/);
    });

    it('category x city rows need the stored verdict AND the listing floor; setting x state rows the switch and the verdict', () => {
        expect(code).toContain('shouldIndexLocalListingPage({ activeJobs: row.totalJobs, distinctEmployers: row.distinctEmployers })');
        expect(code).toContain('if (!row.indexable) continue;');
        expect(code).toContain('if (!SETTING_STATE_INDEXING_ENABLED) return urls;');
        expect(code).toContain('if (!isSettingStateIndexable(row.indexable)) continue;');
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
        expect(src).toMatch(/import \{[\s\S]*?shouldIndexCategoryLanding,[\s\S]*?shouldIndexLocalListingPage,[\s\S]*?shouldIndexSettingState,[\s\S]*?\} from '@\/lib\/pseo\/render-gate'/);
        // The strict setting gate reads the parent hub verdicts, loaded once per run.
        expect(src).toContain("import { loadStateHubVerdicts, type StateHubVerdict } from '@/lib/pseo/state-hub-index'");
        expect(code).toContain('const hubs = await loadHubVerdictsOrNone(now)');
    });

    it('groups once per category (state, city, employer, title) instead of per row, and counts distinct postings', () => {
        expect(code).toMatch(/by: \['state', 'city', 'employer', 'title'\]/);
        expect(code).toContain('selectEmployers(');
        expect(code).toContain('countPostings(');
        expect(code).toContain('landingBucketWhere(slug)');
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
/** canonicalBucketWhere nests the bucket at AND[1]; a metro scope's first OR arm names the metro city. */
type ScopedArgs = {
    where?: { AND?: Array<{ OR?: Array<{ city?: { contains?: string } }> }> };
    select?: Record<string, boolean>;
};
const metroCityOf = (args: ScopedArgs | undefined): string | undefined => args?.where?.AND?.[1]?.OR?.[0]?.city?.contains;

/**
 * Job row reads: a metro scope gets its METRO_ROWS; every other read (the
 * state hub pool, the city page inputs) gets `pool`.
 */
function mockJobRows(pool: ListingFactRow[]) {
    vi.mocked(prisma.job.findMany).mockImplementation((async (args: ScopedArgs) => {
        const metroCity = metroCityOf(args);
        return metroCity !== undefined ? METRO_ROWS[metroCity] ?? [] : pool;
    }) as never);
}

function mockSitemapInventory() {
    vi.mocked(prisma.job.findFirst).mockResolvedValue({ updatedAt: STAMP } as never);
    vi.mocked(prisma.job.count).mockResolvedValue(5 as never);
    mockJobRows(SITEMAP_POOL);
    vi.mocked(prisma.job.groupBy).mockImplementation((async (args: GroupByArgs) => {
        const by = [...args.by].join(',');
        if (by === 'state') {
            return [
                { state: 'Texas', _count: { state: 22 }, _max: { updatedAt: STAMP } },
                { state: 'California', _count: { state: 3 }, _max: { updatedAt: STAMP } },
            ];
        }
        if (by === 'city,state') {
            // Raw row counts: the directories and the city page lastmod read them.
            return [
                { city: 'Lubbock', state: 'Texas', _count: { city: 7 }, _max: { updatedAt: STAMP } },
                { city: 'Waco', state: 'Texas', _count: { city: 6 }, _max: { updatedAt: STAMP } },
                { city: 'Temple', state: 'Texas', _count: { city: 5 }, _max: { updatedAt: STAMP } },
                { city: 'Amarillo', state: 'Texas', _count: { city: 4 }, _max: { updatedAt: STAMP } },
                { city: 'Fresno', state: 'California', _count: { city: 3 }, _max: { updatedAt: STAMP } },
                { city: 'Bakersfield', state: 'California', _count: { city: 1 }, _max: { updatedAt: STAMP } },
                { city: 'Modesto', state: 'California', _count: { city: 1 }, _max: { updatedAt: STAMP } },
            ];
        }
        return [];
    }) as never);
    vi.mocked(prisma.job.aggregate).mockImplementation((async (args: ScopedArgs) => {
        // Raw rows per metro (the lastmod read): Miami's 3 include a duplicate.
        const rows = METRO_ROWS[metroCityOf(args) ?? ''] ?? [];
        return { _count: { _all: rows.length }, _max: { updatedAt: rows.length > 0 ? STAMP : null } };
    }) as never);
    vi.mocked(prisma.company.findMany).mockResolvedValue([
        // Both slug inputs (display name and dedup key) so the company link
        // resolves to the same /companies/{slug} under either path builder.
        { id: 'c1', name: 'Alpha Health', normalizedName: 'alpha health', _count: { jobs: 8 } },
        { id: 'c2', name: 'Beta Clinic', normalizedName: 'beta-clinic', _count: { jobs: 7 } },
    ] as never);
    // The stored category-landing rows (the cron writes the verdict over
    // distinct postings; totalJobs is the row count).
    prismaMock.pseoStats.findMany.mockResolvedValue([
        { categorySlug: 'remote', totalJobs: 6, distinctEmployers: 3, indexable: true, updatedAt: STAMP },
        // Written at the old 3-job floor: the counts fail the listing floor.
        { categorySlug: 'telehealth', totalJobs: 3, distinctEmployers: 3, indexable: true, updatedAt: STAMP },
        // CQ-06: 16 jobs from 2 employers (the audit's contract landing).
        { categorySlug: 'contract', totalJobs: 16, distinctEmployers: 2, indexable: true, updatedAt: STAMP },
        // The counts pass, but the cron found duplicate rows and stored false.
        { categorySlug: 'per-diem', totalJobs: 8, distinctEmployers: 4, indexable: false, updatedAt: STAMP },
    ]);
    vi.mocked(getPublishableSalaryGuideStates).mockResolvedValue(new Set(['Texas']));
    vi.mocked(getAllPublishedSlugs).mockResolvedValue([
        { slug: 'np-license-texas', updated_at: '2026-08-01T00:00:00.000Z' },
        { slug: 'some-post', updated_at: '2026-07-01T00:00:00.000Z' },
        // What the real function also returns: every other license guide not
        // taken down, served from code and dated by its review. The sitemap
        // lists a guide only while it is returned here AND indexable.
        ...getAllLicenseGuideSlugs()
            .filter((slug) => slug !== 'np-license-texas')
            .map((slug) => ({ slug, updated_at: getLicenseGuideReviewedAt(slug.replace(/^np-license-/, '')) })),
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

    it('lists exactly the indexable license guides, once each, and never a noindexed guide through its blog row', async () => {
        const entries = await sitemap();
        const urls = entries.map((e) => e.url);
        const byUrl = new Map(entries.map((e) => [e.url, e]));
        // Owner decision 2: a guide indexes only once its state's facts are
        // verified (lib/license-guide-facts.ts); the robots tag and this
        // sitemap read the same predicate.
        const indexable = getIndexableLicenseGuideSlugs();
        const listed = urls.filter((u) => u.includes('/blog/np-license-')).map((u) => u.split('/blog/')[1]).sort();
        expect(listed).toEqual([...indexable].sort());
        // np-license-texas also has a blog_posts row: it must not re-enter
        // through the blog list while its guide is noindexed.
        expect(byUrl.has(`${BASE}/blog/np-license-texas`)).toBe(indexable.includes('np-license-texas'));
        expect(byUrl.has(`${BASE}/blog/some-post`)).toBe(true);
    });

    it('state hubs: exactly the hubs the shared hub gate indexes (CQ-07: the listing floor and 4 live sections)', async () => {
        // Preconditions over the same pool: Texas clears the floor (21
        // postings from 4 employers); California is 3 rows from 1 employer.
        const verdicts = computeStateHubVerdicts(SITEMAP_POOL, new Set(['Texas']));
        expect(verdicts.get('Texas')?.input).toMatchObject({ activeJobs: 21, distinctEmployers: 4 });
        expect(verdicts.get('Texas')?.input.liveDataSections).toBeGreaterThanOrEqual(4);
        expect(verdicts.get('Texas')?.indexable).toBe(true);
        expect(verdicts.get('California')?.indexable).toBe(false);
        const urls = (await sitemap()).map((e) => e.url);
        expect(urls).toContain(`${BASE}/jobs/state/texas`);
        expect(urls).not.toContain(`${BASE}/jobs/state/california`);
        // Agreement both ways: listed hubs are exactly the indexable verdicts.
        const listed = urls.filter((u) => u.includes('/jobs/state/')).map((u) => u.split('/jobs/state/')[1]).sort();
        const indexable = [...verdicts.values()].filter((v) => v.indexable).map((v) => v.stateSlug).sort();
        expect(listed).toEqual(indexable);
    });

    it('state hubs: a hub under the employer floor stays out (6 jobs from 2 employers)', async () => {
        mockJobRows([...TEXAS_ROWS, ...CALIFORNIA_ROWS]);
        expect(computeStateHubVerdicts([...TEXAS_ROWS, ...CALIFORNIA_ROWS], new Set(['Texas'])).get('Texas')?.indexable).toBe(false);
        const urls = (await sitemap()).map((e) => e.url);
        expect(urls.some((u) => u.includes('/jobs/state/'))).toBe(false);
    });

    it('state hubs: a failed verdict read omits every hub and nothing else', async () => {
        vi.mocked(prisma.job.findMany).mockImplementation((async (args: ScopedArgs) => {
            if (args?.select?.categoryTags) throw new Error('hub pool unavailable');
            const metroCity = metroCityOf(args);
            return metroCity !== undefined ? METRO_ROWS[metroCity] ?? [] : SITEMAP_POOL;
        }) as never);
        const urls = (await sitemap()).map((e) => e.url);
        expect(urls.some((u) => u.includes('/jobs/state/'))).toBe(false);
        expect(urls).toContain(`${BASE}/jobs/city/waco-tx`);
        expect(urls).toContain(`${BASE}/jobs/metro/dallas-tx`);
    });

    it('salary-guide states: only a state with jobs AND a published median', async () => {
        const urls = (await sitemap()).map((e) => e.url);
        expect(urls).toContain(`${BASE}/salary-guide/texas`);
        expect(urls).not.toContain(`${BASE}/salary-guide/california`);
    });

    it('metros: shouldIndexMetro over the page input (CQ-08: 3 or more distinct postings, 1 or more posted in the last 30 days)', async () => {
        const urls = (await sitemap()).map((e) => e.url);
        // 3 distinct postings, one first posted 5 days ago.
        expect(urls).toContain(`${BASE}/jobs/metro/dallas-tx`);
        // 3 rows, 2 distinct postings.
        expect(urls).not.toContain(`${BASE}/jobs/metro/miami-fl`);
        // 3 distinct postings, none posted in the last 30 days.
        expect(urls).not.toContain(`${BASE}/jobs/metro/nashville-tn`);
    });

    it('metros: a failed gate read omits every metro', async () => {
        vi.mocked(prisma.job.findMany).mockImplementation((async (args: ScopedArgs) => {
            if (metroCityOf(args) !== undefined) throw new Error('metro scope unavailable');
            return SITEMAP_POOL;
        }) as never);
        const urls = (await sitemap()).map((e) => e.url);
        expect(urls.some((u) => u.includes('/jobs/metro/'))).toBe(false);
        expect(urls).toContain(`${BASE}/jobs/state/texas`);
    });

    it('category landings: the stored verdict AND the listing floor (5 or more jobs from 3 or more employers)', async () => {
        const urls = (await sitemap()).map((e) => e.url);
        expect(urls).toContain(`${BASE}/jobs/remote`);
        // 3 jobs: under the floor whatever the stored verdict says.
        expect(urls).not.toContain(`${BASE}/jobs/telehealth`);
        // 2 employers (CQ-06: the contract landing).
        expect(urls).not.toContain(`${BASE}/jobs/contract`);
        // The counts pass, the stored verdict is false.
        expect(urls).not.toContain(`${BASE}/jobs/per-diem`);
        // No fresh row at all.
        expect(urls).not.toContain(`${BASE}/jobs/inpatient`);
    });

    it('city directories: 5 linkable cities index (FB-1, M-05); 4 or 1 do not', async () => {
        const urls = (await sitemap()).map((e) => e.url);
        // Texas has 4 linkable cities in this fixture: below the raised floor.
        expect(urls).not.toContain(`${BASE}/jobs/locations/texas`);
        expect(urls).not.toContain(`${BASE}/jobs/locations/california`);
        vi.mocked(prisma.job.groupBy).mockImplementation((async (args: GroupByArgs) => {
            const by = [...args.by].join(',');
            if (by === 'city,state') {
                return ['Waco', 'Lubbock', 'Amarillo', 'Austin', 'Dallas'].map((city) => ({
                    city, state: 'Texas', _count: { city: 3 }, _max: { updatedAt: STAMP },
                }));
            }
            return [];
        }) as never);
        expect((await sitemap()).map((e) => e.url)).toContain(`${BASE}/jobs/locations/texas`);
    });

    it('city pages: the listing floor over distinct postings, 5 or more from 3 or more employers', async () => {
        // Preconditions: the page inputs, and Temple, whose raw count (5 rows
        // from 4 employers) would clear the floor while its page, counting
        // distinct postings, answers noindex.
        const inputs = computeCityIndexInputs(SITEMAP_POOL);
        expect(inputs.get(cityIndexKey('Waco', 'TX'))).toEqual({ activeJobs: 6, distinctEmployers: 3 });
        expect(inputs.get(cityIndexKey('Amarillo', 'TX'))).toEqual({ activeJobs: 4, distinctEmployers: 3 });
        expect(inputs.get(cityIndexKey('Lubbock', 'TX'))).toEqual({ activeJobs: 7, distinctEmployers: 2 });
        expect(inputs.get(cityIndexKey('Temple', 'TX'))).toEqual({ activeJobs: 4, distinctEmployers: 4 });
        expect(shouldIndexLocalListingPage({ activeJobs: 5, distinctEmployers: 4 })).toBe(true);
        expect(cityLinkResolves('Temple', 'TX')).toBe(true);

        const urls = (await sitemap()).map((e) => e.url);
        expect(urls).toContain(`${BASE}/jobs/city/waco-tx`);
        expect(urls).not.toContain(`${BASE}/jobs/city/amarillo-tx`);
        expect(urls).not.toContain(`${BASE}/jobs/city/lubbock-tx`);
        expect(urls).not.toContain(`${BASE}/jobs/city/temple-tx`);
        expect(urls).not.toContain(`${BASE}/jobs/city/fresno-ca`);
    });

    it('company pages: the 8-job floor holds until the re-crawl', async () => {
        const urls = (await sitemap()).map((e) => e.url);
        expect(urls).toContain(`${BASE}/companies/alpha-health`);
        expect(urls).not.toContain(`${BASE}/companies/beta-clinic`);
    });

    it('degraded mode advertises no inventory-gated page type but keeps the indexable license guides', async () => {
        vi.mocked(prisma.job.count).mockRejectedValue(new Error('db down'));
        const urls = (await sitemap()).map((e) => e.url);
        for (const prefix of ['/jobs/state/', '/salary-guide/texas', '/jobs/metro/', '/jobs/locations/texas', '/jobs/city/', '/companies/alpha']) {
            expect(urls.some((u) => u.includes(prefix)), prefix).toBe(false);
        }
        expect(urls.filter((u) => u.includes('/blog/np-license-'))).toHaveLength(getIndexableLicenseGuideSlugs().length);
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
                    { categorySlug: 'remote', locationSlug: 'new-york-ny', totalJobs: 6, distinctEmployers: 3, indexable: true, updatedAt: STAMP },
                    { categorySlug: 'remote', locationSlug: 'waco-tx', totalJobs: 3, distinctEmployers: 1, indexable: false, updatedAt: STAMP },
                    { categorySlug: 'remote', locationSlug: 'lubbock-tx', totalJobs: 2, distinctEmployers: 2, indexable: false, updatedAt: STAMP },
                    // Written by the old cron at the old floor: the counts fail the listing floor.
                    { categorySlug: 'remote', locationSlug: 'los-angeles-ca', totalJobs: 3, distinctEmployers: 2, indexable: true, updatedAt: STAMP },
                    // Counts pass, but the cron found duplicate rows and stored false.
                    { categorySlug: 'remote', locationSlug: 'chicago-il', totalJobs: 6, distinctEmployers: 3, indexable: false, updatedAt: STAMP },
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

    it('category x city: the stored verdict AND the listing floor (5 jobs from 3 employers)', async () => {
        const xml = await batchZero();
        expect(xml).toContain(`${BASE}/jobs/remote/city/new-york-ny`);
        expect(xml).not.toContain('/jobs/remote/city/waco-tx');
        expect(xml).not.toContain('/jobs/remote/city/lubbock-tx');
        expect(xml).not.toContain('/jobs/remote/city/los-angeles-ca');
        expect(xml).not.toContain('/jobs/remote/city/chicago-il');
    });

    it('setting x state: nothing while the FB-1 switch is off, even a stored true verdict', async () => {
        const xml = await batchZero();
        expect(xml).not.toContain('/jobs/remote/texas');
        expect(xml).not.toContain('/jobs/remote/california');
    });

    it('the category x city read binds the type and the 36-hour freshness threshold; setting x state is not read', async () => {
        await batchZero();
        const calls = queryRaw().mock.calls as unknown as Array<[TemplateStringsArray, ...unknown[]]>;
        expect(calls.map((c) => c[1]).sort()).toEqual(['category-city']);
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
        // The hub pool read (lib/pseo/state-hub-index.ts) selects the listing
        // facts columns, categoryTags among them; the per-category gate reads
        // select a narrower projection. The hub has twice the setting's jobs.
        vi.mocked(prisma.job.findMany).mockImplementation((async (args: { select?: Record<string, boolean> }) =>
            args?.select?.categoryTags ? TEXAS_HUB_ROWS : TEXAS_SETTING_ROWS) as never);
        vi.mocked(prisma.job.groupBy).mockResolvedValue([] as never);
        vi.mocked(fetchNpAnalyticsRows).mockResolvedValue([]);
        vi.mocked(getPublishableSalaryGuideStates).mockResolvedValue(new Set(['Texas']));
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

    it('setting x state stores the strict verdict: 6 postings from 4 employers under an indexable hub twice its size', async () => {
        const response = await aggregatePseoGET(new NextRequest('http://localhost/api/cron/aggregate-pseo?mode=state'));
        const body = await response.json();
        expect(findRow('setting-state', 'remote', 'texas')).toEqual(['setting-state', 'remote', 'texas', 6, 4, true]);
        expect(findRow('setting-state', 'remote', 'california')).toEqual(['setting-state', 'remote', 'california', 0, 0, false]);
        // The switch is reported beside the count of stored true verdicts.
        expect(body.settingStateIndexingEnabled).toBe(false);
        expect(body.settingStateStrictPassCount).toBeGreaterThan(0);
    });

    it('a setting that is its whole hub stores false (CQ-01: Utah, Rhode Island)', async () => {
        vi.mocked(prisma.job.findMany).mockImplementation((async (args: { select?: Record<string, boolean> }) =>
            args?.select?.categoryTags ? TEXAS_SETTING_ROWS : TEXAS_SETTING_ROWS) as never);
        await aggregatePseoGET(new NextRequest('http://localhost/api/cron/aggregate-pseo?mode=state'));
        expect(findRow('setting-state', 'remote', 'texas')?.[5]).toBe(false);
    });

    it('a failed hub load closes every setting x state verdict of the run', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.mocked(prisma.job.findMany).mockImplementation((async (args: { select?: Record<string, boolean> }) => {
            if (args?.select?.categoryTags) throw new Error('hub pool unavailable');
            return TEXAS_SETTING_ROWS;
        }) as never);
        await aggregatePseoGET(new NextRequest('http://localhost/api/cron/aggregate-pseo?mode=state'));
        expect(findRow('setting-state', 'remote', 'texas')?.[5]).toBe(false);
    });

    it("category landing: one row query over the shared landing bucket gives the count, employers and verdict; row keyed 'all'", async () => {
        await aggregatePseoGET(new NextRequest('http://localhost/api/cron/aggregate-pseo?mode=state'));
        expect(findRow('category-landing', 'remote', 'all')).toEqual(['category-landing', 'remote', 'all', 6, 4, true]);
        const created = prismaMock.pseoStats.createMany.mock.calls.flatMap((call) => (call[0] as { data: unknown[] }).data);
        expect(created).toContainEqual(expect.objectContaining({ type: 'category-landing', categorySlug: 'remote', locationSlug: 'all', totalJobs: 6 }));
    });

    it('category landing: a single-employer landing stores false whatever its size (CQ-06)', async () => {
        const oneEmployer = TEXAS_SETTING_ROWS.map((r) => ({ ...r, employer: 'International SOS' }));
        vi.mocked(prisma.job.findMany).mockImplementation((async (args: { select?: Record<string, boolean> }) =>
            args?.select?.categoryTags ? TEXAS_HUB_ROWS : oneEmployer) as never);
        await aggregatePseoGET(new NextRequest('http://localhost/api/cron/aggregate-pseo?mode=state'));
        expect(findRow('category-landing', 'anesthesia', 'all')?.[5]).toBe(false);
    });

    it('never issues a per-row count or aggregate', async () => {
        await aggregatePseoGET(new NextRequest('http://localhost/api/cron/aggregate-pseo?mode=state'));
        expect(vi.mocked(prisma.job.count)).not.toHaveBeenCalled();
        expect(vi.mocked(prisma.job.aggregate)).not.toHaveBeenCalled();
    });
});
