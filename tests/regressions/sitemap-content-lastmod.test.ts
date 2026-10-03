/**
 * Indexing audit, sitemap package: every sitemap dates a URL from its
 * content (CS-02, TECH-04, GFJ-10), agrees with the page's robots (FB-2,
 * fixSoon 17), carries the state artwork only on gated entries (FB-4,
 * fixSoon 15) and caches for the hour the routes regenerate on (CS-09).
 *
 *   1. The lastmod helpers (app/api/sitemaps/lastmod.ts).
 *   2. /api/sitemaps/jobs/[batch]: Job.contentChangedAt, never updatedAt.
 *   3. /api/sitemaps/cities/[batch]: the newest content date among the jobs
 *      each page lists, never PseoStats.updatedAt; omitted when unreadable.
 *   4. /api/sitemaps/index: each child dated by the newest lastmod inside it.
 *   5. /sitemap.xml: content dates everywhere, /blog from its newest listed
 *      post, copy dates on code-authored pages, each comparison page's later
 *      of its review and copy dates, each specialty salary page's own
 *      bucket date, the state hub verdicts
 *      (Rhode Island), the salary specialty verdicts, one URL per company
 *      display slug, and dioramas only on the gated state entries.
 *   6. vercel.json caches the sitemaps for the routes' own hour.
 *   7. Backlog 2.1: a page whose copy switches from the launch promo to the
 *      paid ladder at config.promoEndsAt changed at that instant, so once it
 *      has passed its lastmod is never earlier (PROMO_SWITCH_PATHS, the
 *      homepage's employer band); before it nothing changes. Sections 4 and
 *      5 pin the clock, because the sitemaps read it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

vi.mock('@/lib/blog', () => ({ getAllPublishedSlugs: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/discord-notifier', () => ({
    sendDiscordMessage: vi.fn(async () => undefined),
    sendCronFailureAlert: vi.fn(async () => undefined),
}));
vi.mock('@/lib/salary-analytics', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/salary-analytics')>();
    return { ...actual, getPublishableSalaryGuideStates: vi.fn() };
});
vi.mock('@/lib/salary-guide-specialty', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/salary-guide-specialty')>();
    return { ...actual, getIndexableSalarySpecialtySlugs: vi.fn() };
});
vi.mock('@/lib/pseo/state-hub-index', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/pseo/state-hub-index')>();
    return { ...actual, loadStateHubVerdicts: vi.fn() };
});

import { prisma } from '@/lib/prisma';
import { brand } from '@/config/brand';
import { config } from '@/lib/config';
import { getAllPublishedSlugs } from '@/lib/blog';
import { getPublishableSalaryGuideStates } from '@/lib/salary-analytics';
import { getIndexableSalarySpecialtySlugs, specialtyTagWhere } from '@/lib/salary-guide-specialty';
import { COMPARE_HUB_PATH, COMPARE_PAGE_PATHS, COMPARE_REVIEW_DATE } from '@/lib/compare-data';
import { loadStateHubVerdicts, type StateHubVerdict } from '@/lib/pseo/state-hub-index';
import { ALL_CATEGORY_CONFIGS } from '@/lib/pseo/category-city-template';
import { stateDioramaSrc } from '@/components/StateImage';
import {
    jobContentDate,
    lastmodTag,
    latestOf,
    newestPageContentDate,
    PAGE_CONTENT_DATES,
    pageContentDate,
    PROMO_SWITCH_PATHS,
    promoSwitchDate,
    withPromoSwitch,
} from '@/app/api/sitemaps/lastmod';
import { SITEMAP_CACHE_CONTROL } from '@/app/api/sitemaps/cache-control';
import {
    getIndexableLicenseGuideSlugs,
    getLicenseGuideReviewedAt,
    isBlogSlugIndexable,
    LICENSE_GUIDE_STATES,
} from '@/lib/blog-license-guides';
import { isLicenseGuideIndexable } from '@/lib/license-guide-facts';
import { LISTING_LASTMOD_QUERY_CAP, listingContentDates } from '@/app/api/sitemaps/listing-lastmod';
import sitemap from '@/app/sitemap';
import { GET as jobsSitemapGET } from '@/app/api/sitemaps/jobs/[batch]/route';
import { GET as citiesSitemapGET } from '@/app/api/sitemaps/cities/[batch]/route';
import { GET as sitemapIndexGET } from '@/app/api/sitemaps/index/route';

const ROOT = process.cwd();
const BASE = process.env.NEXT_PUBLIC_BASE_URL || brand.baseUrl;

const CREATED = new Date('2026-08-01T00:00:00.000Z');
const CONTENT = new Date('2026-09-26T09:30:00.000Z');
const RI_CONTENT = new Date('2026-09-24T12:00:00.000Z');
const COMPANY_CONTENT = new Date('2026-09-22T08:00:00.000Z');
/** A write timestamp: nothing may ever emit it. */
const WRITE_STAMP = new Date('2026-09-28T23:59:00.000Z');

/** Backlog 2.1: the launch promo's last day, its last millisecond, and the switch to the ladder. */
const PROMO_RUNNING = new Date('2026-12-31T12:00:00.000Z');
const SWITCH = new Date(config.promoEndsAt);
const LAST_PROMO_MS = new Date(SWITCH.getTime() - 1);
const AFTER_SWITCH = new Date(SWITCH.getTime() + 60 * 60 * 1000);

/**
 * The UTC day the engineering backlog release dates the pages whose copy it
 * changed (PAGE_CONTENT_DATES). A page is dated by the change that SHIPS it:
 * if the release ships on a later UTC day, move this and every entry that
 * carries it in app/api/sitemaps/lastmod.ts to the ship day in that commit.
 * Each such entry is pinned to this constant below, so a partial move fails.
 */
const BACKLOG_RELEASE_DAY = '2026-10-04';

/** The pages whose rendered copy follows the promo clock today (packages M1 and M2 of backlog 2.1). */
const PROMO_SWITCH_PAGES = [
    '/pricing',
    '/for-employers',
    '/faq',
    '/for-employers/resources',
    '/for-employers/resources/how-to-hire',
    // Its post-a-job button reads "Post a Job: Free" only while the promo runs.
    '/for-employers/resources/job-description-guide',
    '/for-employers/resources/job-description-templates',
    '/for-employers/resources/job-description-templates/[id]',
    '/tools/salary-benchmark',
    '/tools/cost-per-hire-calculator',
    ...COMPARE_PAGE_PATHS,
];

/** The sitemaps read the clock (lastmods, the canonical predicate), so sections 4 and 5 pin it. */
function pinClock(at: Date): void {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at);
}

/** The global Prisma mock predates PseoStats; the primary sitemap reads it. */
const prismaMock = prisma as unknown as Record<string, unknown> & { pseoStats: { findMany: ReturnType<typeof vi.fn> } };
prismaMock.pseoStats = { findMany: vi.fn() };

type MaxArgs = { by?: readonly string[]; _max?: Record<string, boolean> };

function verdict(stateName: string, stateSlug: string, indexable: boolean): StateHubVerdict {
    return {
        stateName,
        stateSlug,
        indexable,
        postings: indexable ? 7 : 2,
        input: { activeJobs: indexable ? 7 : 2, distinctEmployers: indexable ? 3 : 1, liveDataSections: 5, page: 1 },
    };
}

/** The indexable license guides (lib/license-guide-facts.ts decides which). */
const INDEXABLE_GUIDE_SLUGS = getIndexableLicenseGuideSlugs();
const guideReviewedAt = (slug: string): string => getLicenseGuideReviewedAt(slug.replace(/^np-license-/, ''));
const INDEXABLE_GUIDE_ROWS = INDEXABLE_GUIDE_SLUGS.map((slug) => ({ slug, updated_at: guideReviewedAt(slug) }));
/** A guide that renders noindex today, or null once every state is verified. */
const NOINDEX_GUIDE_SLUG = LICENSE_GUIDE_STATES.map((s) => s.slug).find((slug) => !isBlogSlugIndexable(slug)) ?? null;
/** One day after the latest of 2026-09-30 and every indexable guide's review date. */
const NOINDEX_GUIDE_UPDATED_AT = new Date(
    Math.max(Date.parse('2026-09-30T00:00:00.000Z'), ...INDEXABLE_GUIDE_ROWS.map((row) => Date.parse(row.updated_at))) + 86_400_000,
).toISOString();

function mockPrimaryInventory(): void {
    vi.mocked(prisma.job.count).mockResolvedValue(10 as never);
    vi.mocked(prisma.job.findFirst).mockResolvedValue({ updatedAt: WRITE_STAMP } as never);
    vi.mocked(prisma.job.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.job.aggregate).mockResolvedValue({ _max: { contentChangedAt: CONTENT, createdAt: CREATED } } as never);
    vi.mocked(prisma.job.groupBy).mockImplementation((async (args: MaxArgs) => {
        const by = [...(args.by ?? [])].join(',');
        if (by === 'state') {
            return [
                { state: 'Rhode Island', _count: { state: 7 }, _max: { contentChangedAt: RI_CONTENT, createdAt: CREATED } },
                { state: 'Texas', _count: { state: 2 }, _max: { contentChangedAt: null, createdAt: CREATED } },
            ];
        }
        if (by === 'companyId') return [{ companyId: 'c1', _max: { contentChangedAt: COMPANY_CONTENT, createdAt: CREATED } }];
        return [];
    }) as never);
    vi.mocked(prisma.company.findMany).mockResolvedValue([
        // "MultiCare" and "Multicare" share the display slug "multicare";
        // the profile serves the row with more live jobs.
        { id: 'c1', name: 'MultiCare', normalizedName: 'multi-care', _count: { jobs: 9 } },
        { id: 'c2', name: 'Multicare', normalizedName: 'multicare', _count: { jobs: 8 } },
    ] as never);
    prismaMock.pseoStats.findMany.mockResolvedValue([
        { categorySlug: 'remote', totalJobs: 8, distinctEmployers: 4, indexable: true, updatedAt: WRITE_STAMP },
    ]);
    vi.mocked(loadStateHubVerdicts).mockResolvedValue(new Map([
        ['Rhode Island', verdict('Rhode Island', 'rhode-island', true)],
        ['Texas', verdict('Texas', 'texas', false)],
    ]));
    vi.mocked(getPublishableSalaryGuideStates).mockResolvedValue(new Set(['Rhode Island']));
    vi.mocked(getIndexableSalarySpecialtySlugs).mockResolvedValue(['family-practice']);
    vi.mocked(getAllPublishedSlugs).mockResolvedValue([
        { slug: 'post-a', updated_at: '2026-09-20T00:00:00.000Z' },
        { slug: 'post-b', updated_at: '2026-09-25T06:00:00.000Z' },
        // What the real function returns: every license guide not taken down,
        // dated by its review. Only the indexable ones are listed.
        ...INDEXABLE_GUIDE_ROWS,
        // A noindexed license guide, dated after every other row, so a test
        // catches it if it is ever listed or counted. Which guides are
        // noindexed follows lib/license-guide-facts.ts (owner decision 4).
        ...(NOINDEX_GUIDE_SLUG ? [{ slug: NOINDEX_GUIDE_SLUG, updated_at: NOINDEX_GUIDE_UPDATED_AT }] : []),
    ]);
}

beforeEach(() => {
    vi.clearAllMocks();
});

/* ─── 1. helpers ───────────────────────────────────────────────────────── */

describe('lastmod helpers', () => {
    it('latestOf keeps the newest valid date and skips missing and invalid ones', () => {
        expect(latestOf(null, undefined, new Date('nope'))).toBeNull();
        expect(latestOf(CREATED, CONTENT, null)).toEqual(CONTENT);
    });

    it('a job is dated by its content change, or by createdAt before the column reached it', () => {
        expect(jobContentDate({ contentChangedAt: CONTENT, createdAt: CREATED })).toEqual(CONTENT);
        expect(jobContentDate({ contentChangedAt: null, createdAt: CREATED })).toEqual(CREATED);
        expect(jobContentDate(undefined)).toBeNull();
    });

    it('code-authored pages carry a real calendar day, and unknown pages none', () => {
        // While the promo runs, so every page is dated by its copy alone.
        for (const [pagePath, day] of Object.entries(PAGE_CONTENT_DATES)) {
            expect(day, pagePath).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect(pageContentDate(pagePath, PROMO_RUNNING)?.toISOString().slice(0, 10), pagePath).toBe(day);
        }
        expect(pageContentDate('/not-a-page', PROMO_RUNNING)).toBeUndefined();
        expect(newestPageContentDate(PROMO_RUNNING)?.toISOString().slice(0, 10)).toBe(Object.values(PAGE_CONTENT_DATES).sort().pop());
    });

    it('2.1: the promo switch covers exactly the pages whose copy follows the promo clock', () => {
        expect([...PROMO_SWITCH_PATHS].sort()).toEqual([...PROMO_SWITCH_PAGES].sort());
        // Every comparison page states our price in its capability table.
        for (const pagePath of COMPARE_PAGE_PATHS) expect(PROMO_SWITCH_PATHS.has(pagePath), pagePath).toBe(true);
        // The hub renders only titles and descriptions, so its copy does not switch.
        expect(PROMO_SWITCH_PATHS.has(COMPARE_HUB_PATH)).toBe(false);
        expect(promoSwitchDate(LAST_PROMO_MS)).toBeNull();
        expect(promoSwitchDate(SWITCH)).toEqual(SWITCH);
        expect(promoSwitchDate(AFTER_SWITCH)).toEqual(SWITCH);
    });

    it('2.1: up to the last promo millisecond every page keeps its copy date, the switch pages included', () => {
        for (const pagePath of new Set([...Object.keys(PAGE_CONTENT_DATES), ...PROMO_SWITCH_PATHS])) {
            const day = PAGE_CONTENT_DATES[pagePath];
            const expected = day ? new Date(`${day}T00:00:00.000Z`) : undefined;
            expect(pageContentDate(pagePath, LAST_PROMO_MS), pagePath).toEqual(expected);
        }
        expect(newestPageContentDate(LAST_PROMO_MS)).toEqual(newestPageContentDate(PROMO_RUNNING));
    });

    it('2.1: from config.promoEndsAt a switch page is dated no earlier than the switch; every other page keeps its copy date', () => {
        for (const at of [SWITCH, AFTER_SWITCH]) {
            for (const pagePath of PROMO_SWITCH_PATHS) {
                // Every copy date predates the switch, so the switch dates them all.
                expect(pageContentDate(pagePath, at), pagePath).toEqual(SWITCH);
            }
            for (const [pagePath, day] of Object.entries(PAGE_CONTENT_DATES)) {
                if (PROMO_SWITCH_PATHS.has(pagePath)) continue;
                expect(pageContentDate(pagePath, at), pagePath).toEqual(new Date(`${day}T00:00:00.000Z`));
            }
            expect(newestPageContentDate(at)).toEqual(SWITCH);
            expect(pageContentDate('/not-a-page', at)).toBeUndefined();
        }
        // Every comparison page has a copy date of its own now (the AANP page
        // had none until its price sentence was corrected), and the switch
        // still dates each of them once it has passed.
        for (const pagePath of COMPARE_PAGE_PATHS) {
            const copyDate = new Date(`${PAGE_CONTENT_DATES[pagePath]}T00:00:00.000Z`);
            expect(pageContentDate(pagePath, LAST_PROMO_MS), pagePath).toEqual(copyDate);
            expect(copyDate.getTime(), pagePath).toBeLessThan(SWITCH.getTime());
            expect(pageContentDate(pagePath, SWITCH), pagePath).toEqual(SWITCH);
        }
    });

    it('2.1: withPromoSwitch raises a listing date only once the switch has passed, and never invents one', () => {
        const later = new Date(SWITCH.getTime() + 86_400_000);
        expect(withPromoSwitch(CONTENT, LAST_PROMO_MS)).toEqual(CONTENT);
        expect(withPromoSwitch(CONTENT, SWITCH)).toEqual(SWITCH);
        expect(withPromoSwitch(later, AFTER_SWITCH)).toEqual(later);
        // An unread date stays unread: the switch is a lower bound, not a content date.
        expect(withPromoSwitch(undefined, AFTER_SWITCH)).toBeUndefined();
        expect(withPromoSwitch(null, AFTER_SWITCH)).toBeUndefined();
        expect(withPromoSwitch(new Date('nope'), AFTER_SWITCH)).toBeUndefined();
    });

    it('pages whose rendered copy or links this release changed carry its date, so Google recrawls them', () => {
        // /press and /tools/licensure-checker now link the scope of practice
        // explorer, /tools/licensure-checker dropped the "All 50 states
        // classified" claim (so did /resources, which changed again since; see
        // the next test), the revenue calculator card points at
        // /scope-of-practice, and the cost of living comparator links a
        // curated metro's guide (CQ-13, L-05). The Indeed comparison's
        // licensure row and advantage now link the scope of practice explorer
        // (CQ-13; so do the ENP Network page's, which changed again since:
        // see the comparison test below), and the specialty salary template's
        // config and content were rewritten.
        for (const pagePath of [
            '/press',
            '/tools/licensure-checker',
            '/tools/private-practice-revenue-calculator',
            '/tools/cost-of-living-comparison',
            '/compare/np-hiring-vs-indeed',
            '/salary-guide/specialty/[specialty]',
        ]) {
            expect(PAGE_CONTENT_DATES[pagePath], pagePath).toBe('2026-09-29');
        }
    });

    it('backlog 2.2: /resources and /for-programs carry the day they began rendering the posts served from code', () => {
        // Both read blog_posts directly, which holds no rows in production, so
        // the article grids and the program guide card rendered nothing. They
        // now read through lib/blog.ts, which serves those posts from code.
        for (const pagePath of ['/resources', '/for-programs']) {
            expect(PAGE_CONTENT_DATES[pagePath], pagePath).toBe(BACKLOG_RELEASE_DAY);
            // Neither page's copy follows the promo clock, so the switch never
            // dates it: the copy date stands on both sides of the promo end.
            expect(PROMO_SWITCH_PATHS.has(pagePath), pagePath).toBe(false);
            for (const at of [PROMO_RUNNING, AFTER_SWITCH]) {
                expect(pageContentDate(pagePath, at), pagePath).toEqual(new Date(`${BACKLOG_RELEASE_DAY}T00:00:00.000Z`));
            }
        }
    });

    it('backlog 2.1: the AANP and ENP Network comparisons carry the day their price sentences were put right', () => {
        // Both pages changed what they print WHILE the promo runs: the AANP
        // page dated our own price to the competitor review ("both public, as
        // of <review date>", five weeks before the promo and the ladder went
        // public) and said "a NP salary guide"; the ENP Network page said
        // "hiring a NP". The Indeed page's copy did not change.
        for (const pagePath of ['/compare/np-hiring-vs-aanp-jobcenter', '/compare/np-hiring-vs-enp-network']) {
            expect(PAGE_CONTENT_DATES[pagePath], pagePath).toBe(BACKLOG_RELEASE_DAY);
            expect(pageContentDate(pagePath, PROMO_RUNNING), pagePath).toEqual(new Date(`${BACKLOG_RELEASE_DAY}T00:00:00.000Z`));
            // Its price statements still switch at the promo end, which dates it afterwards.
            expect(pageContentDate(pagePath, AFTER_SWITCH), pagePath).toEqual(SWITCH);
        }
        expect(PAGE_CONTENT_DATES['/compare/np-hiring-vs-indeed']).toBe('2026-09-29');
    });

    it('lastmodTag emits a W3C datetime, or nothing for a missing date', () => {
        expect(lastmodTag(CONTENT)).toBe(`\n    <lastmod>${CONTENT.toISOString()}</lastmod>`);
        expect(lastmodTag(null)).toBe('');
    });

    it('listing lastmods stop querying past the cap, leaving the rest undated', async () => {
        vi.mocked(prisma.job.aggregate).mockResolvedValue({ _max: { contentChangedAt: CONTENT, createdAt: CREATED } } as never);
        const keys = Array.from({ length: LISTING_LASTMOD_QUERY_CAP + 2 }, () => ({
            type: 'category-city' as const,
            categorySlug: 'remote',
            locationSlug: 'new-york-ny',
        }));
        const dates = await listingContentDates(keys);
        expect(vi.mocked(prisma.job.aggregate)).toHaveBeenCalledTimes(LISTING_LASTMOD_QUERY_CAP);
        expect(dates.slice(0, LISTING_LASTMOD_QUERY_CAP).every((d) => d?.getTime() === CONTENT.getTime())).toBe(true);
        expect(dates.slice(LISTING_LASTMOD_QUERY_CAP)).toEqual([null, null]);
    });
});

/* ─── 2. jobs batch ────────────────────────────────────────────────────── */

/**
 * The job batch reads its rows, then screens them for stub descriptions
 * (GFJ-04, app/api/sitemaps/job-batches.ts) in a second read that selects
 * the description. Every row here carries a full description.
 */
function mockJobBatchRows(rows: ReadonlyArray<{ id: string; title: string }>): void {
    const fullDescription = 'Provide primary care to adult and pediatric patients in a busy outpatient clinic, '
        + 'including assessment, diagnosis, treatment planning and patient education, with a supportive team.';
    vi.mocked(prisma.job.findMany).mockImplementation((async (args: { select?: Record<string, boolean> }) =>
        args.select?.description
            ? rows.map((row) => ({ id: row.id, title: row.title, description: fullDescription }))
            : rows) as never);
}

describe('/api/sitemaps/jobs/[batch] dates each job by its content (GFJ-10)', () => {
    async function jobsXml(): Promise<Response> {
        return jobsSitemapGET(new Request('http://localhost/api/sitemaps/jobs/0'), { params: Promise.resolve({ batch: '0' }) });
    }

    it('emits contentChangedAt, or createdAt for a row the column has not reached; no changefreq or priority', async () => {
        vi.mocked(prisma.job.count).mockResolvedValue(2 as never);
        const rows = [
            { id: '11111111-1111-1111-1111-111111111111', title: 'Family NP', slug: 'family-np-1', contentChangedAt: CONTENT, createdAt: CREATED, updatedAt: WRITE_STAMP },
            { id: '22222222-2222-2222-2222-222222222222', title: 'Psych NP', slug: 'psych-np-2', contentChangedAt: null, createdAt: CREATED, updatedAt: WRITE_STAMP },
        ];
        mockJobBatchRows(rows);
        const response = await jobsXml();
        const xml = await response.text();
        expect(xml).toContain(`<loc>${BASE}/jobs/family-np-1</loc>\n    <lastmod>${CONTENT.toISOString()}</lastmod>`);
        expect(xml).toContain(`<loc>${BASE}/jobs/psych-np-2</loc>\n    <lastmod>${CREATED.toISOString()}</lastmod>`);
        expect(xml).not.toContain(WRITE_STAMP.toISOString());
        expect(xml).not.toContain('<changefreq>');
        expect(xml).not.toContain('<priority>');
        expect(response.headers.get('Cache-Control')).toBe(SITEMAP_CACHE_CONTROL);
        const select = (vi.mocked(prisma.job.findMany).mock.calls[0][0] as { select: Record<string, boolean> }).select;
        expect(select).toMatchObject({ contentChangedAt: true, createdAt: true });
        expect(select).not.toHaveProperty('updatedAt');
    });
});

/* ─── 3. cities batch ──────────────────────────────────────────────────── */

describe('/api/sitemaps/cities/[batch] dates each page from the jobs it lists (CS-02)', () => {
    beforeEach(() => {
        vi.mocked(prisma.$queryRaw).mockImplementation((async (_strings: TemplateStringsArray, ...values: unknown[]) =>
            values[0] === 'category-city'
                ? [{ categorySlug: 'remote', locationSlug: 'new-york-ny', totalJobs: 6, distinctEmployers: 3, indexable: true, updatedAt: WRITE_STAMP }]
                : []) as never);
    });

    async function citiesXml(): Promise<{ xml: string; response: Response }> {
        const response = await citiesSitemapGET(new Request('http://localhost/api/sitemaps/cities/0'), { params: Promise.resolve({ batch: '0' }) });
        return { xml: await response.text(), response };
    }

    it('reads the newest content date over the page own bucket, never PseoStats.updatedAt', async () => {
        vi.mocked(prisma.job.aggregate).mockResolvedValue({ _max: { contentChangedAt: CONTENT, createdAt: CREATED } } as never);
        const { xml, response } = await citiesXml();
        expect(xml).toContain(`<loc>${BASE}/jobs/remote/city/new-york-ny</loc>\n    <lastmod>${CONTENT.toISOString()}</lastmod>`);
        expect(xml).not.toContain(WRITE_STAMP.toISOString().slice(0, 10));
        expect(xml).not.toContain('<changefreq>');
        expect(response.headers.get('Cache-Control')).toBe(SITEMAP_CACHE_CONTROL);
        // The bucket is the category x city template's own clause, inside the canonical predicate.
        const where = (vi.mocked(prisma.job.aggregate).mock.calls[0][0] as { where: { AND: unknown[] } }).where;
        expect(where.AND[1]).toEqual(ALL_CATEGORY_CONFIGS.remote.buildWhere('New York', 'New York'));
        // A stable row order keeps every URL in its batch between requests.
        const sql = (vi.mocked(prisma.$queryRaw).mock.calls[0][0] as unknown as TemplateStringsArray).join('?');
        expect(sql).toContain('ORDER BY "categorySlug", "locationSlug"');
    });

    it('an unreadable content date leaves the URL listed but undated', async () => {
        vi.mocked(prisma.job.aggregate).mockRejectedValue(new Error('db blip'));
        const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { xml } = await citiesXml();
        errors.mockRestore();
        expect(xml).toContain(`<loc>${BASE}/jobs/remote/city/new-york-ny</loc>\n  </url>`);
        expect(xml).not.toContain('<lastmod>');
    });
});

/* ─── 4. sitemap index ─────────────────────────────────────────────────── */

describe('/api/sitemaps/index dates each child by the newest lastmod inside it', () => {
    const lastmodOf = (xml: string, loc: string): string | null =>
        xml.match(new RegExp(`<loc>${loc.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}</loc>(?:\\s*<lastmod>([^<]+)</lastmod>)?`))?.[1] ?? null;

    beforeEach(() => {
        pinClock(PROMO_RUNNING);
        vi.mocked(prisma.$queryRaw).mockImplementation((async (_strings: TemplateStringsArray, ...values: unknown[]) =>
            values[0] === 'category-city'
                ? [{ categorySlug: 'remote', locationSlug: 'new-york-ny', totalJobs: 6, distinctEmployers: 3, indexable: true }]
                : []) as never);
        vi.mocked(prisma.job.count).mockResolvedValue(600 as never);
        vi.mocked(prisma.job.findFirst).mockResolvedValue({ updatedAt: WRITE_STAMP } as never);
        vi.mocked(prisma.job.aggregate).mockResolvedValue({ _max: { contentChangedAt: CONTENT, createdAt: CREATED } } as never);
        // The jobs child is dated from the rows its batch lists.
        mockJobBatchRows([
            { id: '11111111-1111-1111-1111-111111111111', title: 'Family NP', slug: 'family-np-1', contentChangedAt: CONTENT, createdAt: CREATED },
        ] as never);
        // A noindexed guide is not in /sitemap.xml, so it cannot date it. Which
        // guides are noindexed follows lib/license-guide-facts.ts (owner
        // decision 4), so the fixture picks one that is noindexed now.
        const noindexedGuide = LICENSE_GUIDE_STATES.map((s) => s.slug).find((slug) => !isBlogSlugIndexable(slug));
        vi.mocked(getAllPublishedSlugs).mockResolvedValue([
            { slug: 'post-a', updated_at: '2026-09-20T00:00:00.000Z' },
            ...(noindexedGuide ? [{ slug: noindexedGuide, updated_at: '2026-10-05T00:00:00.000Z' }] : []),
        ]);
    });

    it('the jobs and cities children carry their newest content date; the primary child the newest of its sources', async () => {
        const response = await sitemapIndexGET();
        const xml = await response.text();
        const newestPrimary = latestOf(CONTENT, new Date('2026-09-20T00:00:00.000Z'), newestPageContentDate());
        expect(lastmodOf(xml, `${BASE}/sitemap.xml`)).toBe(newestPrimary!.toISOString());
        expect(lastmodOf(xml, `${BASE}/api/sitemaps/jobs/0`)).toBe(CONTENT.toISOString());
        expect(lastmodOf(xml, `${BASE}/api/sitemaps/cities/0`)).toBe(CONTENT.toISOString());
        expect(xml).not.toContain(WRITE_STAMP.toISOString());
        expect(xml).not.toContain('2026-10-05');
        expect(response.headers.get('Cache-Control')).toBe(SITEMAP_CACHE_CONTROL);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('a newer listed blog post dates the primary child', async () => {
        // Derived, not literal: the post only proves the point while it is
        // newer than every other source the primary child reads (the jobs'
        // CONTENT stamp and the page copy dates, which move to the ship day
        // each release). A hard-coded day silently stops testing anything
        // once BACKLOG_RELEASE_DAY passes it.
        const newest = latestOf(CONTENT, newestPageContentDate(PROMO_RUNNING))!;
        const newer = new Date(newest.getTime() + 24 * 60 * 60 * 1000).toISOString();
        vi.mocked(getAllPublishedSlugs).mockResolvedValue([{ slug: 'post-new', updated_at: newer }]);
        const xml = await (await sitemapIndexGET()).text();
        expect(lastmodOf(xml, `${BASE}/sitemap.xml`)).toBe(newer);
    });

    it('2.1: once the promo has ended, the primary child is dated no earlier than the switch its pages made', async () => {
        // Jobs (CONTENT) and the blog (2026-09-20) are older than the switch.
        vi.setSystemTime(LAST_PROMO_MS);
        const before = await (await sitemapIndexGET()).text();
        expect(lastmodOf(before, `${BASE}/sitemap.xml`)).toBe(latestOf(CONTENT, newestPageContentDate(PROMO_RUNNING))!.toISOString());
        vi.setSystemTime(AFTER_SWITCH);
        const after = await (await sitemapIndexGET()).text();
        expect(lastmodOf(after, `${BASE}/sitemap.xml`)).toBe(SWITCH.toISOString());
        // The other children list no switch page, so their dates do not move.
        expect(lastmodOf(after, `${BASE}/api/sitemaps/jobs/0`)).toBe(CONTENT.toISOString());
        expect(lastmodOf(after, `${BASE}/api/sitemaps/cities/0`)).toBe(CONTENT.toISOString());
    });

    it('an unreadable content date omits the lastmod, never guesses "today", and does not degrade the index', async () => {
        vi.mocked(prisma.job.aggregate).mockRejectedValue(new Error('db blip'));
        vi.mocked(prisma.job.findMany).mockRejectedValue(new Error('db blip'));
        const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const response = await sitemapIndexGET();
        const xml = await response.text();
        errors.mockRestore();
        expect(xml).toContain(`<loc>${BASE}/sitemap.xml</loc>`);
        expect(xml).toContain(`<loc>${BASE}/api/sitemaps/jobs/0</loc>`);
        expect(xml).not.toContain('<lastmod>');
        expect(response.headers.get('Cache-Control')).toBe(SITEMAP_CACHE_CONTROL);
    });
});

/* ─── 5. primary sitemap ───────────────────────────────────────────────── */

describe('/sitemap.xml dates from content and agrees with the page robots', () => {
    beforeEach(() => {
        pinClock(PROMO_RUNNING);
        mockPrimaryInventory();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const byUrl = async () => new Map((await sitemap()).map((entry) => [entry.url, entry]));

    it('listing pages carry the newest content date among their jobs', async () => {
        const entries = await byUrl();
        expect(entries.get(BASE)?.lastModified).toEqual(CONTENT);
        expect(entries.get(`${BASE}/jobs`)?.lastModified).toEqual(CONTENT);
        expect(entries.get(`${BASE}/jobs/remote`)?.lastModified).toEqual(CONTENT);
        expect(entries.get(`${BASE}/jobs/state/rhode-island`)?.lastModified).toEqual(RI_CONTENT);
    });

    it('never asks for a write timestamp', async () => {
        await sitemap();
        const maxArgs = [...vi.mocked(prisma.job.groupBy).mock.calls, ...vi.mocked(prisma.job.aggregate).mock.calls]
            .map((call) => (call[0] as MaxArgs)._max)
            .filter(Boolean);
        expect(maxArgs.length).toBeGreaterThanOrEqual(5);
        for (const max of maxArgs) expect(max).toEqual({ contentChangedAt: true, createdAt: true });
        expect(vi.mocked(prisma.job.findFirst)).not.toHaveBeenCalled();
    });

    it('/blog is dated by its newest listed post or indexable guide; a noindexed guide is neither listed nor counted', async () => {
        const entries = await byUrl();
        const newestListed = latestOf(
            new Date('2026-09-25T06:00:00.000Z'),
            ...INDEXABLE_GUIDE_SLUGS.map((slug) => new Date(guideReviewedAt(slug))),
        );
        expect(entries.get(`${BASE}/blog`)?.lastModified).toEqual(newestListed);
        expect(entries.get(`${BASE}/blog`)?.lastModified).not.toEqual(new Date(NOINDEX_GUIDE_UPDATED_AT));
        if (NOINDEX_GUIDE_SLUG) expect(entries.has(`${BASE}/blog/${NOINDEX_GUIDE_SLUG}`)).toBe(false);
    });

    it('an indexable guide is dated by its review, or by a later synced row', async () => {
        const [first] = INDEXABLE_GUIDE_SLUGS;
        expect(first).toBeDefined();
        const later = new Date(Date.parse(guideReviewedAt(first)) + 86_400_000).toISOString();
        vi.mocked(getAllPublishedSlugs).mockResolvedValue(
            INDEXABLE_GUIDE_ROWS.map((row) => (row.slug === first ? { slug: first, updated_at: later } : row)),
        );
        const entries = await byUrl();
        expect(entries.get(`${BASE}/blog/${first}`)?.lastModified).toEqual(new Date(later));
        for (const slug of INDEXABLE_GUIDE_SLUGS.slice(1, 4)) {
            expect(entries.get(`${BASE}/blog/${slug}`)?.lastModified, slug).toEqual(new Date(guideReviewedAt(slug)));
        }
    });

    it('an indexable guide an editor took down (missing from getAllPublishedSlugs) is not listed', async () => {
        const [takenDown, ...live] = INDEXABLE_GUIDE_SLUGS;
        expect(takenDown).toBeDefined();
        vi.mocked(getAllPublishedSlugs).mockResolvedValue([
            { slug: 'post-a', updated_at: '2026-09-20T00:00:00.000Z' },
            ...INDEXABLE_GUIDE_ROWS.filter((row) => row.slug !== takenDown),
        ]);
        const urls = [...(await byUrl()).keys()];
        expect(urls).not.toContain(`${BASE}/blog/${takenDown}`);
        const listedGuides = urls.filter((url) => url.includes('/blog/np-license-')).map((url) => url.slice(`${BASE}/blog/`.length)).sort();
        expect(listedGuides).toEqual([...live].sort());
    });

    it('an unreadable blog index keeps every indexable guide listed from the registry', async () => {
        vi.mocked(getAllPublishedSlugs).mockRejectedValue(new Error('blog_posts unreadable'));
        const urls = [...(await byUrl()).keys()];
        const listedGuides = urls.filter((url) => url.includes('/blog/np-license-')).map((url) => url.slice(`${BASE}/blog/`.length)).sort();
        expect(listedGuides).toEqual([...INDEXABLE_GUIDE_SLUGS].sort());
    });

    it('code-authored pages carry their copy date, and no entry is undated when every read succeeds', async () => {
        const entries = await sitemap();
        const map = new Map(entries.map((entry) => [entry.url, entry]));
        expect(map.get(`${BASE}/pricing`)?.lastModified).toEqual(pageContentDate('/pricing'));
        expect(map.get(`${BASE}/tools/salary-benchmark`)?.lastModified).toEqual(pageContentDate('/tools/salary-benchmark'));
        const undated = entries.filter((entry) => !entry.lastModified).map((entry) => entry.url);
        expect(undated, 'a listed page has no content date (add it to PAGE_CONTENT_DATES)').toEqual([]);
    });

    it('backlog 2.2: /resources and /for-programs are listed with the day they began rendering posts from code, before and after the promo end', async () => {
        for (const at of [PROMO_RUNNING, AFTER_SWITCH]) {
            vi.setSystemTime(at);
            const entries = await byUrl();
            for (const pagePath of ['/resources', '/for-programs']) {
                expect(entries.get(`${BASE}${pagePath}`)?.lastModified, pagePath).toEqual(new Date(`${BACKLOG_RELEASE_DAY}T00:00:00.000Z`));
            }
        }
    });

    it('a comparison page carries the later of its claims review and its own copy change; the hub keeps the review date', async () => {
        const entries = await byUrl();
        const reviewed = new Date(COMPARE_REVIEW_DATE);
        // Each page's copy changed after the review: CQ-13 relinked the Indeed
        // and ENP Network pages, and the AANP and ENP Network price sentences
        // were corrected since. The review date is not moved for a copy edit
        // that re-checked no claim, so the copy date is what the sitemap emits.
        for (const pagePath of COMPARE_PAGE_PATHS) {
            expect(entries.get(`${BASE}${pagePath}`)?.lastModified, pagePath).toEqual(pageContentDate(pagePath));
            expect(pageContentDate(pagePath)!.getTime(), pagePath).toBeGreaterThan(reviewed.getTime());
        }
        expect(entries.get(`${BASE}/compare/np-hiring-vs-aanp-jobcenter`)?.lastModified)
            .toEqual(new Date(`${BACKLOG_RELEASE_DAY}T00:00:00.000Z`));
        // The hub prints no price and no corrected sentence: the review date stands.
        expect(entries.get(`${BASE}${COMPARE_HUB_PATH}`)?.lastModified).toEqual(reviewed);
    });

    it('2.1: until the promo ends, no page is dated by the switch', async () => {
        vi.setSystemTime(LAST_PROMO_MS);
        const entries = await byUrl();
        for (const pagePath of ['/pricing', '/for-employers', '/faq', '/for-employers/resources', '/tools/cost-per-hire-calculator']) {
            expect(entries.get(`${BASE}${pagePath}`)?.lastModified, pagePath).toEqual(pageContentDate(pagePath, PROMO_RUNNING));
        }
        expect(entries.get(`${BASE}/compare/np-hiring-vs-aanp-jobcenter`)?.lastModified)
            .toEqual(pageContentDate('/compare/np-hiring-vs-aanp-jobcenter', PROMO_RUNNING));
        expect(entries.get(BASE)?.lastModified).toEqual(CONTENT);
        const dates = [...entries.values()].map((entry) => (entry.lastModified as Date | undefined)?.getTime());
        expect(dates).not.toContain(SWITCH.getTime());
    });

    it('2.1: from the promo end, every page whose copy switched is dated at the switch, and no other page moves', async () => {
        vi.setSystemTime(AFTER_SWITCH);
        const entries = await byUrl();
        const switched = PROMO_SWITCH_PAGES.filter((pagePath) => !pagePath.includes('[id]'));
        for (const pagePath of switched) {
            expect(entries.get(`${BASE}${pagePath}`)?.lastModified, pagePath).toEqual(SWITCH);
        }
        const templatePages = [...entries.values()].filter((entry) => entry.url.includes('/job-description-templates/'));
        expect(templatePages.length).toBeGreaterThan(0);
        for (const entry of templatePages) expect(entry.lastModified, entry.url).toEqual(SWITCH);
        // Pages whose copy does not follow the promo clock keep their dates.
        expect(entries.get(`${BASE}/about`)?.lastModified).toEqual(pageContentDate('/about', PROMO_RUNNING));
        expect(entries.get(`${BASE}/tools/licensure-checker`)?.lastModified)
            .toEqual(pageContentDate('/tools/licensure-checker', PROMO_RUNNING));
        expect(entries.get(`${BASE}${COMPARE_HUB_PATH}`)?.lastModified).toEqual(new Date(COMPARE_REVIEW_DATE));
        expect(entries.get(`${BASE}/jobs`)?.lastModified).toEqual(CONTENT);
        // The homepage's employer band switched too, and its jobs (CONTENT) are older.
        expect(entries.get(BASE)?.lastModified).toEqual(SWITCH);
    });

    it('2.1: after the switch a newer job still dates the homepage, and an unread one leaves it undated', async () => {
        vi.setSystemTime(AFTER_SWITCH);
        const newerJob = new Date(SWITCH.getTime() + 30 * 60 * 1000);
        vi.mocked(prisma.job.aggregate).mockResolvedValue({ _max: { contentChangedAt: newerJob, createdAt: CREATED } } as never);
        expect((await byUrl()).get(BASE)?.lastModified).toEqual(newerJob);

        vi.mocked(prisma.job.aggregate).mockRejectedValue(new Error('db blip'));
        const entries = await byUrl();
        expect(entries.has(BASE)).toBe(true);
        expect(entries.get(BASE)?.lastModified).toBeUndefined();
        // Code-authored switch pages need no read: they still carry the switch.
        expect(entries.get(`${BASE}/pricing`)?.lastModified).toEqual(SWITCH);
    });

    it('a specialty salary page is dated by its own specialty bucket, not by the site-wide newest job', async () => {
        // Both after the template's copy date, so only the bucket read can decide.
        const siteWide = new Date('2026-09-29T20:00:00.000Z');
        const ownBucket = new Date('2026-09-29T10:00:00.000Z');
        const familyBucket = specialtyTagWhere('family-practice');
        vi.mocked(prisma.job.aggregate).mockImplementation((async (args: { where?: { AND?: unknown[] } }) => ({
            _max: {
                contentChangedAt: isDeepStrictEqual(args.where?.AND?.[1], familyBucket) ? ownBucket : siteWide,
                createdAt: CREATED,
            },
        })) as never);
        const entries = await byUrl();
        expect(entries.get(`${BASE}/salary-guide/specialty/family-practice`)?.lastModified).toEqual(ownBucket);
        // The hub and the home page aggregate across every job.
        expect(entries.get(`${BASE}/salary-guide/specialty`)?.lastModified).toEqual(siteWide);
        expect(entries.get(BASE)?.lastModified).toEqual(siteWide);
        // The bucket read is the canonical predicate over the page's own tag clause.
        const bucketCalls = vi.mocked(prisma.job.aggregate).mock.calls
            .map((call) => (call[0] as { where: { AND?: unknown[] } }).where)
            .filter((where) => isDeepStrictEqual(where.AND?.[1], familyBucket));
        expect(bucketCalls).toHaveLength(1);
    });

    it('a specialty salary page whose jobs predate the template rewrite carries the template copy date', async () => {
        // The default mock dates every bucket CONTENT (2026-09-26), before the template date.
        const entries = await byUrl();
        const templateDate = pageContentDate('/salary-guide/specialty/[specialty]');
        expect(templateDate!.getTime()).toBeGreaterThan(CONTENT.getTime());
        expect(entries.get(`${BASE}/salary-guide/specialty/family-practice`)?.lastModified).toEqual(templateDate);
    });

    it('fixSoon 17: every hub the shared verdict indexes is listed (Rhode Island), and no other', async () => {
        const urls = [...(await byUrl()).keys()];
        expect(urls).toContain(`${BASE}/jobs/state/rhode-island`);
        expect(urls).not.toContain(`${BASE}/jobs/state/texas`);
    });

    it('fixSoon 15: the diorama rides only on the gated state hub and salary guide entries', async () => {
        const entries = await sitemap();
        const withImages = entries.filter((entry) => (entry.images ?? []).length > 0);
        expect(withImages.map((entry) => entry.url).sort()).toEqual([
            `${BASE}/jobs/state/rhode-island`,
            `${BASE}/salary-guide/rhode-island`,
        ]);
        for (const entry of withImages) expect(entry.images).toEqual([`${BASE}${stateDioramaSrc('rhode-island')}`]);
    });

    it('FB-2: salary specialty pages are exactly the indexable verdicts; the license guides listed are exactly the indexable ones', async () => {
        const urls = (await sitemap()).map((entry) => entry.url);
        const specialties = urls.filter((url) => url.includes('/salary-guide/specialty/'));
        expect(specialties).toEqual([`${BASE}/salary-guide/specialty/family-practice`]);
        expect(urls).toContain(`${BASE}/salary-guide/specialty`);
        const listedGuides = urls.filter((url) => url.includes('/blog/np-license-')).map((url) => url.slice(`${BASE}/blog/`.length)).sort();
        expect(listedGuides).toEqual([...getIndexableLicenseGuideSlugs()].sort());
        // Each is listed once.
        expect(new Set(listedGuides).size).toBe(listedGuides.length);
        // Owner decision 4: exactly the guides isLicenseGuideIndexable
        // (lib/license-guide-facts.ts) admits are listed, and every other
        // guide, which renders noindex, is absent.
        const admitted = LICENSE_GUIDE_STATES.filter((s) => isLicenseGuideIndexable(s.code));
        expect(admitted.length).toBeGreaterThan(0);
        expect(listedGuides).toEqual(admitted.map((s) => s.slug).sort());
        for (const s of LICENSE_GUIDE_STATES.filter((st) => !isLicenseGuideIndexable(st.code))) {
            expect(urls, s.slug).not.toContain(`${BASE}/blog/${s.slug}`);
        }
    });

    it('lists one company URL per display slug, for the row the profile serves', async () => {
        const entries = await sitemap();
        const companies = entries.filter((entry) => entry.url.includes('/companies/'));
        expect(companies.map((entry) => entry.url)).toEqual([`${BASE}/companies/multicare`]);
        expect(companies[0].lastModified).toEqual(COMPANY_CONTENT);
    });

    it('an unreadable content date leaves listing pages undated instead of degrading the sitemap', async () => {
        vi.mocked(prisma.job.aggregate).mockRejectedValue(new Error('db blip'));
        const entries = await byUrl();
        expect(entries.get(BASE)?.lastModified).toBeUndefined();
        expect(entries.has(`${BASE}/jobs/state/rhode-island`)).toBe(true);
        expect(entries.has(`${BASE}/companies/multicare`)).toBe(true);
    });
});

/* ─── 6. CDN caching ───────────────────────────────────────────────────── */

describe('CS-09: the CDN holds a sitemap for the hour the routes regenerate on', () => {
    const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')) as {
        headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
    };

    it('/sitemap.xml carries the shared policy', () => {
        const rule = vercel.headers.find((entry) => entry.source === '/sitemap.xml');
        expect(rule?.headers).toEqual([{ key: 'Cache-Control', value: SITEMAP_CACHE_CONTROL }]);
        expect(SITEMAP_CACHE_CONTROL).toContain('s-maxage=3600');
        expect(SITEMAP_CACHE_CONTROL).not.toContain('604800');
    });

    it('no override on /api/sitemaps/*, so the handlers (and the degraded no-store) decide', () => {
        expect(vercel.headers.some((entry) => entry.source.startsWith('/api/sitemaps'))).toBe(false);
    });
});
