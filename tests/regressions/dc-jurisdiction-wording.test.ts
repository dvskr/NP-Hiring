/**
 * The District of Columbia is a jurisdiction, not a state (indexing-policy
 * follow-up, 2026-09).
 *
 * The locations index now builds its grid from STATE_CODES, so DC gets a hub
 * tile, a city directory link and a sitemap entry beside the 50 states. Every
 * surface that reach extends to must word DC's kind truthfully:
 *   1. isDistrictOfColumbia picks out exactly one STATE_CODES jurisdiction
 *   2. the city directory page calls DC a jurisdiction and its feed
 *      districtwide, and the nearby card (Maryland and Virginia list DC) is
 *      not titled "state directories"
 *   3. the plain hub narrative names the jurisdiction instead of saying "the
 *      state" or "a state median"
 * The locations index figures themselves are pinned in
 * tests/regressions/p10-pseo-jobs-quarantine-crumbs-copy.test.ts (section 5).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { ClayCard } from '@/components/seo/pseo';
import { STATE_CODES } from '@/lib/pseo/setting-state-config';
import { buildPlainStateNarrative } from '@/lib/pseo/state-narrative';
import { isDistrictOfColumbia } from '@/app/jobs/locations/[state]/directory';
import StateCityDirectoryPage from '@/app/jobs/locations/[state]/page';

vi.mock('@/lib/salary-analytics', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/salary-analytics')>();
    return {
        ...actual,
        getGatedBenchmark: vi.fn(async () => null),
        getGatedCitySalaries: vi.fn(async () => new Map()),
    };
});

const DC = 'District of Columbia';

type GroupByArgs = { by: readonly string[] };

/** Every element in the tree that `match` accepts. */
function collect(node: unknown, match: (el: React.ReactElement) => boolean, out: React.ReactElement[] = []): React.ReactElement[] {
    if (Array.isArray(node)) {
        for (const child of node) collect(child, match, out);
        return out;
    }
    if (!React.isValidElement(node)) return out;
    if (match(node)) out.push(node);
    collect((node.props as { children?: unknown }).children, match, out);
    return out;
}

/** The literal text an element's children spell out. */
function textOf(node: unknown): string {
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(textOf).join('');
    if (!React.isValidElement(node)) return '';
    return textOf((node.props as { children?: unknown }).children);
}

const paragraphs = (tree: unknown): string[] => collect(tree, (el) => el.type === 'p').map(textOf);

const cityRow = (city: string, count: number) => ({ city, _count: { city: count } });
const stateCityRow = (city: string, state: string, count: number) => ({ city, state, _count: { city: count } });

/**
 * The page's own city grouping for `cities`, plus a (city, state) grouping
 * in which DC, Maryland and Virginia each clear the directory gate.
 */
function mockDirectory(cities: ReadonlyArray<ReturnType<typeof cityRow>>): void {
    vi.mocked(prisma.job.count).mockResolvedValue(12 as never);
    vi.mocked(prisma.job.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.job.groupBy).mockImplementation((async (args: GroupByArgs) => {
        const by = [...args.by].join(',');
        if (by === 'city') return cities;
        if (by === 'city,state') {
            return [
                stateCityRow('Washington', DC, 5), stateCityRow('Georgetown', DC, 3), stateCityRow('Anacostia', DC, 3),
                stateCityRow('Rockville', 'Maryland', 4), stateCityRow('Bethesda', 'Maryland', 3), stateCityRow('Frederick', 'Maryland', 3),
                stateCityRow('Arlington', 'Virginia', 4), stateCityRow('Richmond', 'Virginia', 3), stateCityRow('Norfolk', 'Virginia', 3),
            ];
        }
        return [];
    }) as never);
}

const renderDirectory = (slug: string) => StateCityDirectoryPage({ params: Promise.resolve({ state: slug }) });

beforeEach(() => {
    vi.clearAllMocks();
});

describe('1. isDistrictOfColumbia', () => {
    it('is true for exactly one STATE_CODES jurisdiction, the District of Columbia', () => {
        expect(Object.keys(STATE_CODES).filter(isDistrictOfColumbia)).toEqual([DC]);
    });

    it('is false for Washington state, the bare code and names outside the table', () => {
        for (const name of ['Washington', 'Maryland', 'DC', 'Washington DC', '', 'constructor']) {
            expect(isDistrictOfColumbia(name), name).toBe(false);
        }
    });
});

describe('2. the city directory page words DC as a jurisdiction', () => {
    it('the District of Columbia directory never calls DC a state', async () => {
        mockDirectory([cityRow('Washington', 5), cityRow('Georgetown', 3), cityRow('Anacostia', 3)]);
        const text = paragraphs(await renderDirectory('district-of-columbia'));

        const authority = text.find((p) => p.includes('which shapes how much'));
        expect(authority).toContain('District of Columbia is a Full Practice Authority jurisdiction, which shapes');
        expect(authority).not.toMatch(/Authority state\b/);
        expect(text).toContain('Districtwide');
        expect(text).not.toContain('Statewide');
        expect(text).toContain('The districtwide feed, including remote roles open to District of Columbia licensees.');
    });

    it('a state directory keeps its state wording', async () => {
        mockDirectory([cityRow('Rockville', 4), cityRow('Bethesda', 3), cityRow('Frederick', 3)]);
        const text = paragraphs(await renderDirectory('maryland'));

        expect(text.find((p) => p.includes('which shapes how much'))).toMatch(/Maryland is a .+ state, which shapes/);
        expect(text).toContain('Statewide');
        expect(text).toContain('The statewide feed, including remote roles open to Maryland licensees.');
    });

    it('the nearby card on Maryland lists the DC directory without calling it a state directory', async () => {
        mockDirectory([cityRow('Rockville', 4), cityRow('Bethesda', 3), cityRow('Frederick', 3)]);
        const tree = await renderDirectory('maryland');

        const nearby = collect(tree, (el) => el.type === ClayCard && (el.props as { chip?: string }).chip === 'Nearby');
        expect(nearby).toHaveLength(1);
        const card = nearby[0].props as { title: string; children?: unknown };
        expect(card.title).toBe('Nearby directories');
        expect(card.title).not.toMatch(/\bstates?\b/i);
        const hrefs = collect(card.children, (el) => typeof (el.props as { href?: unknown }).href === 'string')
            .map((el) => (el.props as { href: string }).href);
        expect(hrefs).toContain('/jobs/locations/district-of-columbia');
    });
});

describe('3. the plain hub narrative names the jurisdiction', () => {
    const base = {
        stateCode: 'DC',
        totalJobs: 6,
        uniqueEmployerCount: 3,
        topCityNames: ['Washington'],
    };

    it('says "in District of Columbia" and "a median", never "the state" or "a state median"', () => {
        const text = buildPlainStateNarrative({ ...base, stateName: DC, topCategoryLabels: ['Family Practice'], medianSalaryK: 0 });
        expect(text).toContain('Family Practice roles carry the deepest live inventory in District of Columbia.');
        expect(text).toContain('Not enough District of Columbia postings disclose pay to publish a median,');
        expect(text).not.toMatch(/\bin the state\b|\bstate median\b/);
    });

    it('holds for every jurisdiction, not only DC', () => {
        for (const [stateName, stateCode] of Object.entries(STATE_CODES)) {
            const text = buildPlainStateNarrative({ ...base, stateName, stateCode, topCategoryLabels: ['Remote'], medianSalaryK: 0 });
            expect(text, stateName).toContain(`deepest live inventory in ${stateName}.`);
            expect(text, stateName).not.toMatch(/\bin the state\b|\bstate median\b/);
        }
    });
});
