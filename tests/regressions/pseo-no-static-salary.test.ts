/**
 * pSEO: no static pay figure on the two listing templates (PLAN.md T0-3,
 * thin-spec 1 section 9.3, package W2-STATE).
 *
 * The category x state and category x city templates used to print a
 * hand-typed band (`config.salaryRange`, "$110K-150K") in the title, the
 * description, the hero and a bento card, and a posting mean (`_avg` over
 * minSalary / maxSalary, `rawAvgSalary`) at n = 1. Pay now comes from the
 * gated median (lib/salary-analytics.ts, 5 postings from 3 employers) or
 * the cited BLS figure, and from nothing else.
 *
 * Three layers:
 *   1. CONFIG: no SettingConfig carries a band.
 *   2. SOURCE: neither template (comments stripped) reads a band, a mean or
 *      a dollar literal.
 *   3. BEHAVIOUR: the state metadata builder, driven with a mocked database,
 *      prints a dollar figure only when the benchmark fixture is present,
 *      a count in the title only at COUNT_DISPLAY_FLOOR, and its robots
 *      verdict from the stored PseoStats flag while fresh and the live facts
 *      otherwise (the same function the cron and the sitemaps use).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Own module mock: the shared tests/setup.ts prisma stub has no `pseoStats`
// model and no `company` lookup, and the facts loader touches both.
vi.mock('@/lib/prisma', () => ({
    prisma: {
        job: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn(), aggregate: vi.fn() },
        company: { findMany: vi.fn() },
        pseoStats: { findMany: vi.fn(), findUnique: vi.fn() },
        $queryRaw: vi.fn(),
    },
}));

// The benchmark is the one figure source; everything else in the module
// stays real so the pool rules are not silently bypassed.
vi.mock('@/lib/salary-analytics', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/salary-analytics')>()),
    getGatedBenchmark: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getGatedBenchmark } from '@/lib/salary-analytics';
import { COUNT_DISPLAY_FLOOR } from '@/lib/canonical-counts';
import { SETTING_CONFIGS } from '@/lib/pseo/setting-state-config';
import { emptyListingFacts, type ListingFactRow, type ListingFacts } from '@/lib/pseo/listing-facts';
import type { BenchmarkRow } from '@/components/tools/benchmark-model';
import {
    buildSettingStateMetadata,
    resolveSettingStateIndexable,
    settingStateIndexFacts,
} from '@/lib/pseo/setting-state-template';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const STATE_TEMPLATE = 'lib/pseo/setting-state-template.tsx';
const CITY_TEMPLATE = 'lib/pseo/category-city-template.tsx';

/** En dash and em dash, built from code points so this file carries neither byte. */
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
/** "$95K", "$129,210", "$95,000": a dollar figure typed by hand in code. */
const DOLLAR_LITERAL = /\$\d{2,3}(?:,\d{3})*K?\b/;
/**
 * Identifiers of the retired band and mean readers. `avgSalary` is listed
 * for the state template only: components/CategoryFAQ.tsx keeps that prop
 * name for the gated median (W0-COPY), so the city template may still pass
 * it; the state template feeds its FAQ from listing-narrative and never
 * reads a figure under that name.
 */
const RETIRED_READERS = ['salaryRange', 'rawAvgSalary', 'colAdjustedSalary', '_avg', 'MedianFigure'];
const RETIRED_STATE_READERS = [...RETIRED_READERS, 'avgSalary'];

const SETTING_KEY = 'inpatient';
const STATE_SLUG = 'texas';
const LABEL = SETTING_CONFIGS[SETTING_KEY].label;
const HOUR_MS = 60 * 60 * 1000;

const BENCHMARK: BenchmarkRow = { scope: 'Texas', median: 128_000, p25: 115_000, p75: 142_000, postings: 6, employers: 3 };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const gatedBenchmark = vi.mocked(getGatedBenchmark);

function row(over: Partial<ListingFactRow> = {}): ListingFactRow {
    return {
        employer: 'Lakeside Health',
        companyId: null,
        city: 'Austin',
        state: 'Texas',
        stateCode: 'TX',
        isRemote: false,
        isHybrid: false,
        jobType: null,
        setting: null,
        categoryTags: [SETTING_KEY],
        originalPostedAt: null,
        createdAt: new Date(),
        newGradFriendly: false,
        salaryIsEstimated: true,
        normalizedMinSalary: null,
        ...over,
    };
}

/** Three listings from two employers in two cities, all posted now. */
function inventory(count: number): ListingFactRow[] {
    return Array.from({ length: count }, (_, i) => row({
        employer: i % 2 === 0 ? 'Lakeside Health' : 'Northwind Clinics',
        city: i % 2 === 0 ? 'Austin' : 'Dallas',
    }));
}

function arrange(input: { rows: ListingFactRow[]; benchmark: BenchmarkRow | null; stored?: { indexable: boolean; updatedAt: Date } | null }) {
    db.job.count.mockResolvedValue(input.rows.length);
    db.job.findMany.mockResolvedValue(input.rows);
    db.company.findMany.mockResolvedValue([]);
    db.pseoStats.findMany.mockResolvedValue([]);
    db.$queryRaw.mockResolvedValue(input.stored ? [input.stored] : []);
    gatedBenchmark.mockResolvedValue(input.benchmark);
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => { });
});

// ─── 1. config ───────────────────────────────────────────────────────────────

describe('SettingConfig carries no hand-typed band', () => {
    it('no setting x state config populates salaryRange', () => {
        for (const [key, config] of Object.entries(SETTING_CONFIGS)) {
            expect((config as { salaryRange?: unknown }).salaryRange, key).toBeUndefined();
        }
    });
});

// ─── 2. source ───────────────────────────────────────────────────────────────

describe('the two pSEO templates read no band and no posting mean', () => {
    for (const rel of [STATE_TEMPLATE, CITY_TEMPLATE]) {
        it(`${rel} carries none of the retired readers`, () => {
            const code = stripComments(read(rel));
            for (const reader of rel === STATE_TEMPLATE ? RETIRED_STATE_READERS : RETIRED_READERS) {
                expect(code, `${rel} still reads ${reader}`).not.toContain(reader);
            }
        });

        it(`${rel} types no dollar figure by hand`, () => {
            const code = stripComments(read(rel));
            expect(code, rel).not.toMatch(DOLLAR_LITERAL);
        });
    }

    it('the state template takes its pay copy from the shared gated section', () => {
        const src = read(STATE_TEMPLATE);
        expect(src).toMatch(/PostedPay[\s\S]{0,200}variant=\{\{ kind: 'category', slug: config\.slug \}\}/);
        expect(src).toContain("from './listing-facts'");
        expect(src).not.toMatch(/prisma\.job\.aggregate/);
        expect(src).not.toMatch(/prisma\.job\.groupBy/);
    });
});

// ─── 3. behaviour: metadata ──────────────────────────────────────────────────

describe('buildSettingStateMetadata prints a figure only from the gated benchmark', () => {
    it('below the gate the title and description carry no dollar sign', async () => {
        arrange({ rows: inventory(3), benchmark: null });

        const meta = await buildSettingStateMetadata(SETTING_KEY, STATE_SLUG, 1);

        expect(meta.title).toBe(`${LABEL} NP Jobs in Texas`);
        expect(String(meta.title)).not.toContain('$');
        expect(meta.description).toContain(`3 ${LABEL.toLowerCase()} NP openings in Texas from 2 employers.`);
        expect(meta.description).not.toContain('$');
        expect(meta.description!.length).toBeLessThanOrEqual(155);
        expect(meta).not.toHaveProperty('keywords');
    });

    it('with the benchmark the description states the median and nothing else prints pay', async () => {
        arrange({ rows: inventory(3), benchmark: BENCHMARK });

        const meta = await buildSettingStateMetadata(SETTING_KEY, STATE_SLUG, 1);

        expect(meta.description).toContain('Median posted pay $128K.');
        expect(meta.description!.match(/\$/g)).toHaveLength(1);
        expect(String(meta.title)).not.toContain('$');
        expect(meta.openGraph?.description).toBe(meta.description);
    });

    it('never prints "average", a dash or a spaced hyphen', async () => {
        arrange({ rows: inventory(3), benchmark: BENCHMARK });

        const meta = await buildSettingStateMetadata(SETTING_KEY, STATE_SLUG, 1);

        for (const text of [String(meta.title), meta.description ?? '']) {
            expect(text).not.toMatch(/average/i);
            expect(text).not.toMatch(DASHES);
            expect(text).not.toContain(' - ');
        }
    });

    it('carries the live count in the title only at COUNT_DISPLAY_FLOOR', async () => {
        arrange({ rows: inventory(COUNT_DISPLAY_FLOOR - 1), benchmark: null });
        const below = await buildSettingStateMetadata(SETTING_KEY, STATE_SLUG, 1);
        expect(String(below.title)).not.toMatch(/\d/);

        arrange({ rows: inventory(COUNT_DISPLAY_FLOOR), benchmark: null });
        const at = await buildSettingStateMetadata(SETTING_KEY, STATE_SLUG, 1);
        expect(at.title).toBe(`${LABEL} NP Jobs in Texas: ${COUNT_DISPLAY_FLOOR} Openings`);
        expect(String(at.title).length).toBeLessThanOrEqual(49);
    });

    it('keeps a self canonical and follow on every page, including noindex ones', async () => {
        arrange({ rows: inventory(1), benchmark: null });

        const meta = await buildSettingStateMetadata(SETTING_KEY, STATE_SLUG, 2);

        expect(meta.alternates?.canonical).toMatch(/\/jobs\/inpatient\/texas$/);
        expect(meta.robots).toEqual({ index: false, follow: true });
    });
});

// ─── 3. behaviour: robots ────────────────────────────────────────────────────

describe('robots read the stored PseoStats verdict while fresh, the live facts otherwise', () => {
    it('indexes page 1 from the live facts when no row is stored', async () => {
        // 3 jobs, 2 employers, 2 named cities, all posted now: 3 signals.
        arrange({ rows: inventory(3), benchmark: null });
        const meta = await buildSettingStateMetadata(SETTING_KEY, STATE_SLUG, 1);
        expect(meta.robots).toEqual({ index: true, follow: true });
    });

    it('a fresh stored verdict wins over the live facts in both directions', async () => {
        arrange({ rows: inventory(3), benchmark: null, stored: { indexable: false, updatedAt: new Date() } });
        expect((await buildSettingStateMetadata(SETTING_KEY, STATE_SLUG, 1)).robots).toEqual({ index: false, follow: true });

        arrange({ rows: inventory(1), benchmark: null, stored: { indexable: true, updatedAt: new Date() } });
        expect((await buildSettingStateMetadata(SETTING_KEY, STATE_SLUG, 1)).robots).toEqual({ index: true, follow: true });
    });

    it('a stale stored verdict is ignored and the live facts decide', async () => {
        const stale = new Date(Date.now() - 40 * HOUR_MS);
        arrange({ rows: inventory(1), benchmark: null, stored: { indexable: true, updatedAt: stale } });
        expect((await buildSettingStateMetadata(SETTING_KEY, STATE_SLUG, 1)).robots).toEqual({ index: false, follow: true });
    });

    it('a failed verdict read falls back to the live facts instead of failing the page', async () => {
        arrange({ rows: inventory(3), benchmark: null });
        db.$queryRaw.mockRejectedValue(new Error('gate column unavailable'));
        expect((await buildSettingStateMetadata(SETTING_KEY, STATE_SLUG, 1)).robots).toEqual({ index: true, follow: true });
    });

    it('a failed total count still rethrows (a 5xx never deindexes a URL)', async () => {
        arrange({ rows: inventory(3), benchmark: null });
        db.job.count.mockRejectedValue(new Error('PSEO_DB_OUTAGE_SENTINEL'));
        await expect(buildSettingStateMetadata(SETTING_KEY, STATE_SLUG, 1)).rejects.toThrow('PSEO_DB_OUTAGE_SENTINEL');
    });
});

describe('resolveSettingStateIndexable and settingStateIndexFacts', () => {
    const now = Date.now();
    const facts = (over: Partial<ListingFacts> = {}): ListingFacts => ({ ...emptyListingFacts(new Date(now)), ...over });
    const qualifying = settingStateIndexFacts(SETTING_KEY, facts({
        total: 3,
        distinctEmployers: 2,
        cities: [{ name: 'Austin', stateCode: 'TX', count: 2 }, { name: 'Dallas', stateCode: 'TX', count: 1 }],
    }));
    const thin = settingStateIndexFacts(SETTING_KEY, facts({ total: 3, distinctEmployers: 1 }));

    it('maps the facts exactly as the cron does', () => {
        const mapped = settingStateIndexFacts(SETTING_KEY, facts({
            total: 7,
            distinctEmployers: 4,
            cities: [{ name: 'Austin', stateCode: 'TX', count: 7 }],
            benchmark: BENCHMARK,
            recency: { total: 7, datedCount: 7, last7: 1, last30: 5, newestPostedAt: new Date(now) },
        }));
        expect(mapped).toEqual({
            totalJobs: 7,
            employerCount: 4,
            namedCityCount: 1,
            hasBenchmark: true,
            postedLast30Days: 5,
            roleSetupRenders: false,
        });
    });

    it('never indexes a paginated view', () => {
        expect(resolveSettingStateIndexable({ stored: { indexable: true, updatedAt: new Date(now) }, indexFacts: qualifying, page: 2, now })).toBe(false);
    });

    it('uses the stored verdict only while the row is fresh', () => {
        expect(resolveSettingStateIndexable({ stored: { indexable: false, updatedAt: new Date(now) }, indexFacts: qualifying, page: 1, now })).toBe(false);
        expect(resolveSettingStateIndexable({ stored: { indexable: true, updatedAt: new Date(now - 40 * HOUR_MS) }, indexFacts: thin, page: 1, now })).toBe(false);
        expect(resolveSettingStateIndexable({ stored: null, indexFacts: qualifying, page: 1, now })).toBe(true);
        expect(resolveSettingStateIndexable({ stored: null, indexFacts: thin, page: 1, now })).toBe(false);
    });
});
