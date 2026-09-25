/**
 * Indexing policy follow-ups (branch fix/indexing-policy-and-ga-gaps).
 *
 * The pSEO thin-content release left five correctness handoffs in its
 * ledger. Each is pinned here by behaviour, with a source pin only where the
 * behaviour lives in a server component that cannot run without a database:
 *   1. the locations index counts every tile with its destination's own
 *      canonical bucket (no expired rows, one tile per jurisdiction, DC in,
 *      and DC never counted as a state)
 *   2. the sitemap lists a state city directory, the District of Columbia
 *      included, exactly when the page's own bucket and index gate say so
 *   3. the facts loader survives a non-array row result
 *   4. the setting x state narrative no longer restates practice authority
 *   5. the setting x state config drops its dead keywords field and its
 *      NEIGHBORING_STATES re-export
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { brand } from '@/config/brand';
import { getAllPublishedSlugs } from '@/lib/blog';
import { getPublishableSalaryGuideStates } from '@/lib/salary-analytics';
import {
    countJobsByJurisdiction,
    tallyDirectoryCities,
    type DirectoryGroupRow,
} from '@/app/jobs/locations/[state]/directory';
import { getListingFacts } from '@/lib/pseo/listing-facts';
import { buildPlainStateNarrative, buildSettingStateNarrative } from '@/lib/pseo/state-narrative';
import * as settingStateConfig from '@/lib/pseo/setting-state-config';
import sitemap from '@/app/sitemap';

vi.mock('@/lib/blog', () => ({ getAllPublishedSlugs: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/discord-notifier', () => ({
    sendDiscordMessage: vi.fn(async () => undefined),
    sendCronFailureAlert: vi.fn(async () => undefined),
}));
vi.mock('@/lib/salary-analytics', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/salary-analytics')>();
    return { ...actual, getPublishableSalaryGuideStates: vi.fn(), getGatedBenchmark: vi.fn() };
});

const { SETTING_CONFIGS, STATE_CODES } = settingStateConfig;
const ROOT = process.cwd();
const read =(rel: string): string => fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8');
const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const BASE = process.env.NEXT_PUBLIC_BASE_URL || brand.baseUrl;
const DC_DIRECTORY = `${BASE}/jobs/locations/district-of-columbia`;
const STAMP = new Date('2026-09-20T12:00:00.000Z');
const LATER = new Date('2026-09-22T08:00:00.000Z');

/** The global Prisma mock predates PseoStats; the sitemap reads it. */
const prismaMock = prisma as unknown as Record<string, unknown> & {
    pseoStats: { findMany: ReturnType<typeof vi.fn> };
};
prismaMock.pseoStats = { findMany: vi.fn() };

beforeEach(() => {
    vi.clearAllMocks();
});

/* ─── 1. locations index ───────────────────────────────────────────────── */

describe('countJobsByJurisdiction counts each tile with the state hub bucket', () => {
    it('sums the name half and the code half of one jurisdiction into one total', () => {
        const counts = countJobsByJurisdiction([
            { state: 'Texas', stateCode: 'TX', count: 5 },
            { state: 'Texas', stateCode: null, count: 2 },
            { state: null, stateCode: 'TX', count: 1 },
            { state: 'TX', stateCode: 'TX', count: 1 },
        ]);
        expect(counts.get('Texas')).toBe(9);
        expect(counts.size).toBe(1);
    });

    it('counts the District of Columbia as its own jurisdiction', () => {
        const counts = countJobsByJurisdiction([
            { state: 'District of Columbia', stateCode: 'DC', count: 4 },
            { state: 'Washington DC', stateCode: 'DC', count: 1 },
        ]);
        expect(counts.get('District of Columbia')).toBe(5);
        // Washington state shares no row with DC.
        expect(counts.has('Washington')).toBe(false);
    });

    it('compares exactly, like the database, and omits non-US and empty jurisdictions', () => {
        const counts = countJobsByJurisdiction([
            { state: 'texas', stateCode: null, count: 3 },
            { state: 'British Columbia', stateCode: 'BC', count: 6 },
            { state: 'Ohio', stateCode: 'OH', count: 0 },
        ]);
        expect([...counts.keys()]).toEqual([]);
    });
});

describe('the locations index reads the canonical buckets and the full jurisdiction list', () => {
    const src = read('app/jobs/locations/page.tsx');
    const code = stripComments(src);

    it('counts the remote banner and the hero total on canonicalBucketWhere', () => {
        expect(code).toContain('prisma.job.count({ where: canonicalBucketWhere({ isRemote: true }) })');
        expect(code).toContain('prisma.job.count({ where: canonicalBucketWhere({}) })');
    });

    it('builds the state grid from countJobsByJurisdiction over a (state, stateCode) grouping', () => {
        expect(code).toMatch(/by: \['state', 'stateCode'\],\s*where: canonicalBucketWhere\(/);
        expect(code).toContain('...countJobsByJurisdiction(');
    });

    it('derives its jurisdiction whitelist from STATE_CODES, so DC is in it', () => {
        expect(code).toContain('const US_STATES: ReadonlySet<string> = new Set(Object.keys(STATE_CODES));');
        expect(code).not.toContain("'Alabama','Alaska'");
        expect(Object.keys(STATE_CODES)).toContain('District of Columbia');
    });

    /*
     * With DC in the grid, stats.states.length counts a jurisdiction that is
     * not a state. Printed under a "state" label it would read "51 US states"
     * once every jurisdiction is hiring; the site's own wording elsewhere is
     * "50 states and DC" or "51 jurisdictions".
     */
    it('never counts the District of Columbia as a US state', () => {
        expect(code).not.toContain("formatCount(stats.states.length, 'US state')");
        expect(code).not.toMatch(/stats\.states\.length[^\n]*'States Hiring'/);
        // The constant must spell the STATE_CODES key exactly, or the filter
        // below silently excludes nothing.
        expect(code).toContain("const DISTRICT_OF_COLUMBIA = 'District of Columbia';");
        expect(STATE_CODES['District of Columbia']).toBe('DC');
        expect(code).toContain('const statesHiring = stats.states.filter((s) => s.name !== DISTRICT_OF_COLUMBIA).length;');
        expect(code).toContain("formatCount(statesHiring, 'US state')");
        expect(code).toContain("...(districtHiring ? ['the District of Columbia'] : [])");
        expect(code).toContain("{ count: statesHiring, label: 'States Hiring' }");
    });

    it('lists every hub it counts in the ItemList, so numberOfItems matches the elements', () => {
        expect(code).toContain('numberOfItems: stats.states.length');
        expect(code).toContain('itemListElement: stats.states.map(');
        expect(code).not.toMatch(/stats\.states\.slice\(/);
    });

    it('omits a zero hero tile instead of printing it', () => {
        expect(code).toMatch(/\.filter\(\(s\) => s\.count > 0\)\s*\.map\(\(s\) => \(\{ value: s\.count\.toLocaleString\(\), label: s\.label \}\)\)/);
        expect(code).toContain('stats={heroStats}');
    });
});

/* ─── 2. sitemap directories ───────────────────────────────────────────── */

function groupRow(city: string, state: string, count: number, newest: Date = STAMP) {
    return { city, state, _count: { city: count }, _max: { updatedAt: newest } };
}

function codeRow(city: string, state: string | null, stateCode: string, count: number, newest: Date = STAMP) {
    return { city, state, stateCode, _count: { city: count }, _max: { updatedAt: newest } };
}

type GroupByArgs = { by: readonly string[] };

function mockSitemap(byName: unknown[], byCode: unknown[]): void {
    vi.mocked(prisma.job.findFirst).mockResolvedValue({ updatedAt: STAMP } as never);
    vi.mocked(prisma.job.count).mockResolvedValue(10 as never);
    vi.mocked(prisma.job.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.job.aggregate).mockResolvedValue({ _count: { _all: 0 }, _max: { updatedAt: null } } as never);
    vi.mocked(prisma.company.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.job.groupBy).mockImplementation((async (args: GroupByArgs) => {
        const by = [...args.by].join(',');
        if (by === 'state') return [{ state: 'District of Columbia', _count: { state: 10 }, _max: { updatedAt: STAMP } }];
        if (by === 'city,state') return byName;
        if (by === 'city,state,stateCode') return byCode;
        return [];
    }) as never);
    prismaMock.pseoStats.findMany.mockResolvedValue([]);
    vi.mocked(getPublishableSalaryGuideStates).mockResolvedValue(new Set());
    vi.mocked(getAllPublishedSlugs).mockResolvedValue([]);
}

describe('tallyDirectoryCities rebuilds the directory page bucket from two groupings', () => {
    const named = (city: string, state: string, count: number, newest: Date | null = STAMP): DirectoryGroupRow =>
        ({ city, state, count, newest });
    const coded = (city: string, state: string | null, stateCode: string, count: number, newest: Date | null = STAMP): DirectoryGroupRow =>
        ({ city, state, stateCode, count, newest });

    it('adds the code half, merges one city across spellings, and never counts a row twice', () => {
        const tally = tallyDirectoryCities(
            [named('Washington', 'District of Columbia', 4), named('Georgetown', ' District of Columbia ', 3)],
            [
                // Already counted by the name grouping (trimmed state equals the name).
                coded('Washington', 'District of Columbia', 'DC', 4),
                coded('Georgetown', 'Washington DC', 'DC', 1, LATER),
                coded('Anacostia', null, 'DC', 3),
            ],
        );
        const dc = tally.get('District of Columbia');
        expect(dc?.rows).toEqual(
            expect.arrayContaining([
                { city: 'Washington', count: 4 },
                { city: 'Georgetown', count: 4 },
                { city: 'Anacostia', count: 3 },
            ]),
        );
        expect(dc?.rows).toHaveLength(3);
        expect(dc?.newest).toEqual(LATER);
    });

    it('ignores non-US names, unknown codes and rows without a city', () => {
        const tally = tallyDirectoryCities(
            [named('Vancouver', 'British Columbia', 9), { city: null, state: 'Texas', count: 5, newest: null }],
            [coded('Toronto', 'Ontario', 'ON', 4)],
        );
        expect([...tally.keys()]).toEqual([]);
    });
});

describe('the sitemap lists a directory exactly when the page would index it', () => {
    it('lists the District of Columbia directory from the name half alone at 3 linkable cities', async () => {
        mockSitemap(
            [
                groupRow('Washington', 'District of Columbia', 5),
                groupRow('Georgetown', 'District of Columbia', 3),
                groupRow('Anacostia', 'District of Columbia', 3),
            ],
            [],
        );
        const urls = (await sitemap()).map((e) => e.url);
        expect(urls).toContain(DC_DIRECTORY);
    });

    it('counts the code half the page counts, so a variant state spelling cannot drop the directory', async () => {
        const byName = [
            groupRow('Washington', 'District of Columbia', 4),
            groupRow('Georgetown', 'District of Columbia', 3),
            groupRow('Brookland', 'District of Columbia', 1),
        ];
        // Name half alone: 2 linkable cities, so the page renders noindex and
        // the sitemap rightly leaves it out.
        mockSitemap(byName, []);
        expect((await sitemap()).map((e) => e.url)).not.toContain(DC_DIRECTORY);

        // The page also counts rows stored under code DC with another state
        // spelling; with them Anacostia clears the link floor and the
        // directory indexes, so the sitemap must list it, dated by its newest row.
        mockSitemap(byName, [
            codeRow('Washington', 'District of Columbia', 'DC', 4),
            codeRow('Anacostia', 'DC', 'DC', 3, LATER),
        ]);
        const entries = await sitemap();
        const dc = entries.find((e) => e.url === DC_DIRECTORY);
        expect(dc, 'the District of Columbia directory is missing from the sitemap').toBeTruthy();
        expect(dc?.lastModified).toEqual(LATER);
    });

    it('keeps the index gate: a rendering directory with fewer than 3 linkable cities is not listed', async () => {
        mockSitemap(
            [
                groupRow('Washington', 'District of Columbia', 6),
                groupRow('Georgetown', 'District of Columbia', 2),
                groupRow('Brookland', 'District of Columbia', 1),
            ],
            [codeRow('Anacostia', 'DC', 'DC', 2)],
        );
        expect((await sitemap()).map((e) => e.url)).not.toContain(DC_DIRECTORY);
    });
});

/* ─── 3. facts loader ──────────────────────────────────────────────────── */

describe('getListingFacts survives a non-array row result', () => {
    it.each([
        ['undefined', undefined],
        ['an object', {}],
    ])('treats %s as an empty sample and keeps the counted total', async (label, value) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        vi.mocked(prisma.job.count).mockResolvedValue(7 as never);
        vi.mocked(prisma.job.findMany).mockResolvedValue(value as never);

        const facts = await getListingFacts(`followup:non-array:${label}`, { state: 'Texas' });

        expect(facts.total).toBe(7);
        expect(facts.distinctEmployers).toBe(0);
        expect(facts.cities).toEqual([]);
        expect(facts.topEmployers).toEqual([]);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('returned a non-array'));
        warn.mockRestore();
    });
});

/* ─── 4. setting x state narrative ─────────────────────────────────────── */

describe('buildSettingStateNarrative leaves practice authority to the practice card', () => {
    const REMOVED_SENTENCE = /\bgrants (?:full|reduced|restricted) practice authority\b|in its (?:full|reduced|restricted) practice category|applies state-specific practice rules|independent prescribing without physician oversight/;

    it('no setting and no jurisdiction gets the authority sentence', () => {
        const offenders: string[] = [];
        for (const key of Object.keys(SETTING_CONFIGS)) {
            for (const [stateName, stateCode] of Object.entries(STATE_CODES)) {
                const text = buildSettingStateNarrative(key, stateName, stateCode, 0, 0, 4);
                if (REMOVED_SENTENCE.test(text)) offenders.push(`${key}/${stateName}`);
            }
        }
        expect(offenders).toEqual([]);
    });

    it('keeps the setting lead and the live count, and the six-argument signature', () => {
        expect(buildSettingStateNarrative.length).toBe(6);
        const text = buildSettingStateNarrative('remote', 'Texas', 'TX', 0, 0, 3);
        expect(text).toMatch(/^Remote .* listings for Texas/);
        expect(text).toContain('The 3 active postings reflect');
        // The retired parameters change nothing.
        expect(buildSettingStateNarrative('remote', 'Texas', 'TX', 140, 9, 3)).toBe(text);
    });

    it('the plain state hub narrative still states the classification (it has no practice card)', () => {
        const text = buildPlainStateNarrative({
            stateName: 'Texas',
            stateCode: 'TX',
            totalJobs: 12,
            uniqueEmployerCount: 4,
            topCategoryLabels: [],
            topCityNames: [],
        });
        expect(text).toMatch(/AANP places Texas in its restricted practice category/);
    });
});

/* ─── 5. setting x state config ────────────────────────────────────────── */

describe('setting x state config carries no dead fields', () => {
    // `salaryRange` stays declared for now: two ratchet tests read it through
    // the type. Its doc in lib/pseo/setting-state-config.ts says what unblocks it.
    it('no config carries a keywords list any more', () => {
        for (const [key, config] of Object.entries(SETTING_CONFIGS)) {
            expect(Object.prototype.hasOwnProperty.call(config, 'keywords'), key).toBe(false);
        }
        expect(stripComments(read('lib/pseo/setting-state-config.ts'))).not.toMatch(/\bkeywords\s*\??:/);
    });

    it('the NEIGHBORING_STATES re-export is gone (lib/pseo/neighboring-states.ts is the one copy)', () => {
        expect(Object.keys(settingStateConfig)).not.toContain('NEIGHBORING_STATES');
        expect(read('lib/pseo/setting-state-config.ts')).not.toMatch(/export \{ NEIGHBORING_STATES \}/);
    });
});
