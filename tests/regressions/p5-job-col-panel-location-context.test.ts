/**
 * P5 A5 — per-job location / cost-of-living context on the job detail page.
 *
 * What is pinned here and why:
 *
 *   (1) The module renders ONLY on a (city, state) dataset match — never by
 *       bare city name (411 names are shared across states) and never with
 *       substituted values (cities.ts "never refill a null" rule).
 *
 *   (2) The COL-adjusted figure reuses colAdjusted() from
 *       components/tools/col-model.ts — the SAME formula as the pSEO
 *       aggregation cron — and is NEVER produced for `salaryIsEstimated`
 *       rows: three production codepaths write inferred numbers into
 *       normalizedMin/MaxSalary and flag the row instead of nulling it, so
 *       an adjusted version of that number would be an invented salary.
 *
 *   (3) The /jobs/city link carries BOTH established guards: the
 *       cityLinkResolves slug round-trip AND live inventory >=
 *       MIN_CITY_JOBS_FOR_LINK. Either alone still emits links that 404
 *       (lossy names like "St. Louis"; thin cities under the MIN_JOBS gate).
 *
 *   (4) The page renders the module in the MAIN column (visible at every
 *       breakpoint — the P2 #2 mobile rule) and stays on ISR: no Dynamic
 *       API crept in with the new DB count.
 *
 *   (5) The comparator link is the PLAIN tool path:
 *       app/tools/cost-of-living-comparison reads no searchParams and
 *       CostOfLivingComparator takes no URL params, so a prefill query
 *       string would be dead weight at best and a cache-splitting URL at
 *       worst. If the tool grows param support, update the component and
 *       this pin together.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
    buildJobLocationContext,
    resolveJobCityRecord,
    MIN_PLAUSIBLE_ANNUAL_SALARY,
    type JobLocationInput,
} from '@/components/JobLocationContext';
import { colAdjusted, NATIONAL_COL_INDEX } from '@/components/tools/col-model';
import {
    MIN_CITY_JOBS_FOR_LINK,
    buildCitySlug,
    cityLinkResolves,
} from '@/app/jobs/locations/[state]/directory';
import { getCityByNameState } from '@/lib/pseo/city-data/cities';
import { getStatePracticeAuthority } from '@/lib/state-practice-authority';

const ROOT = process.cwd();
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');
/** Source with comments stripped so documentation cannot satisfy a code pin. */
const readCode = (rel: string): string =>
    read(rel)
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');

const JOB_PAGE = 'app/jobs/[slug]/page.tsx';
const COMPONENT = 'components/JobLocationContext.tsx';

/** A job in a city with a clean, round-trippable name and known dataset row. */
function houstonJob(overrides: Partial<JobLocationInput> = {}): JobLocationInput {
    return {
        city: 'Houston',
        state: 'Texas',
        stateCode: 'TX',
        normalizedMinSalary: 110000,
        normalizedMaxSalary: 140000,
        salaryIsEstimated: false,
        ...overrides,
    };
}

describe('P5 A5 (1) — dataset match is by (city, state), or nothing renders', () => {
    it('returns null for a city the dataset does not carry', () => {
        expect(buildJobLocationContext(houstonJob({ city: 'Nowhereville' }), 10)).toBeNull();
    });

    it('returns null when the job has no city at all', () => {
        expect(buildJobLocationContext(houstonJob({ city: null }), 10)).toBeNull();
    });

    it('same-named cities resolve to their own state record, not a name-only winner', () => {
        // Portland OR (index 125) vs Portland ME (index 99) — a name-only
        // lookup collapses these onto one record; (name, state) must not.
        const or = buildJobLocationContext(
            houstonJob({ city: 'Portland', state: 'Oregon', stateCode: 'OR' }),
            0,
        );
        const me = buildJobLocationContext(
            houstonJob({ city: 'Portland', state: 'Maine', stateCode: 'ME' }),
            0,
        );
        expect(or).not.toBeNull();
        expect(me).not.toBeNull();
        expect(or!.colIndex).toBe(getCityByNameState('Portland', 'OR')!.costOfLivingIndex);
        expect(me!.colIndex).toBe(getCityByNameState('Portland', 'ME')!.costOfLivingIndex);
        expect(or!.colIndex).not.toBe(me!.colIndex);
        expect(or!.stateName).toBe('Oregon');
        expect(me!.stateName).toBe('Maine');
    });

    it('falls back to the full state name when the job row has no stateCode', () => {
        const record = resolveJobCityRecord('Portland', null, 'Maine');
        expect(record?.stateCode).toBe('ME');
    });

    it('reads the COL delta off the record, relative to the national average', () => {
        const model = buildJobLocationContext(houstonJob(), 0)!;
        const record = getCityByNameState('Houston', 'TX')!;
        expect(model.colIndex).toBe(record.costOfLivingIndex);
        expect(model.colDeltaPct).toBe(Math.round(record.costOfLivingIndex - NATIONAL_COL_INDEX));
    });
});

describe('P5 A5 (2) — COL-adjusted pay reuses col-model and refuses inferred salaries', () => {
    it('adjusts the posted range with the shared colAdjusted formula', () => {
        const model = buildJobLocationContext(houstonJob(), 0)!;
        const col = getCityByNameState('Houston', 'TX')!.costOfLivingIndex;
        expect(model.adjustedSalary).toEqual({
            nominalMin: 110000,
            nominalMax: 140000,
            adjustedMin: Math.round(colAdjusted(110000, col)),
            adjustedMax: Math.round(colAdjusted(140000, col)),
        });
    });

    it('salaryIsEstimated rows get NO adjusted figure', () => {
        const model = buildJobLocationContext(houstonJob({ salaryIsEstimated: true }), 0)!;
        expect(model).not.toBeNull();
        expect(model.adjustedSalary).toBeNull();
    });

    it('missing or implausible ranges get NO adjusted figure', () => {
        expect(
            buildJobLocationContext(houstonJob({ normalizedMinSalary: null }), 0)!.adjustedSalary,
        ).toBeNull();
        expect(
            buildJobLocationContext(houstonJob({ normalizedMaxSalary: null }), 0)!.adjustedSalary,
        ).toBeNull();
        // Below the annual floor (mirrors the gte-30000 guard the page's own
        // state-average aggregate applies to the same columns).
        expect(
            buildJobLocationContext(
                houstonJob({
                    normalizedMinSalary: MIN_PLAUSIBLE_ANNUAL_SALARY - 1,
                    normalizedMaxSalary: MIN_PLAUSIBLE_ANNUAL_SALARY - 1,
                }),
                0,
            )!.adjustedSalary,
        ).toBeNull();
        // Inverted range.
        expect(
            buildJobLocationContext(
                houstonJob({ normalizedMinSalary: 140000, normalizedMaxSalary: 110000 }),
                0,
            )!.adjustedSalary,
        ).toBeNull();
    });

    it('the practice-environment line is the dataset entry verbatim, or absent', () => {
        const model = buildJobLocationContext(houstonJob(), 0)!;
        expect(model.authority).toEqual(getStatePracticeAuthority('Texas'));
        expect(model.authority?.details).toContain('Texas');
    });
});

describe('P5 A5 (3) — the city link carries both guards; other links use route slug forms', () => {
    it('links the city page only at/above the shared inventory threshold', () => {
        const below = buildJobLocationContext(houstonJob(), MIN_CITY_JOBS_FOR_LINK - 1)!;
        expect(below.cityJobsHref).toBeNull();
        const at = buildJobLocationContext(houstonJob(), MIN_CITY_JOBS_FOR_LINK)!;
        expect(at.cityJobsHref).toBe(`/jobs/city/${buildCitySlug('Houston', 'TX')}`);
    });

    it('never links a lossy-slug city, however much inventory it has', () => {
        // "St. Louis" fails the round-trip (st-louis-mo parses back to
        // "St Louis") and is not one of the curated metro slugs.
        expect(cityLinkResolves('St. Louis', 'MO')).toBe(false);
        const model = buildJobLocationContext(
            houstonJob({ city: 'St. Louis', state: 'Missouri', stateCode: 'MO' }),
            100,
        )!;
        expect(model).not.toBeNull();
        expect(model.cityJobsHref).toBeNull();
    });

    it('state links use the /jobs/state and /salary-guide slug form, multi-word safe', () => {
        const model = buildJobLocationContext(
            houstonJob({ city: 'New York', state: 'New York', stateCode: 'NY' }),
            0,
        )!;
        expect(model.stateJobsHref).toBe('/jobs/state/new-york');
        expect(model.salaryGuideHref).toBe('/salary-guide/new-york');
    });

    it('the comparator link is the plain tool path — no prefill params exist to use', () => {
        const model = buildJobLocationContext(houstonJob(), 0)!;
        expect(model.comparatorHref).toBe('/tools/cost-of-living-comparison');
        expect(model.comparatorHref).not.toContain('?');
        // The tool page must still be param-free before anyone adds a query
        // string here: it takes no searchParams today.
        const toolPage = readCode('app/tools/cost-of-living-comparison/page.tsx');
        expect(toolPage).not.toMatch(/searchParams/);
    });

    it('the component gates through the shared constants, never bare literals', () => {
        const src = readCode(COMPONENT);
        expect(src).toMatch(/cityJobCount\s*>=\s*MIN_CITY_JOBS_FOR_LINK/);
        expect(src).toMatch(/cityLinkResolves\(/);
        expect(src).not.toMatch(/cityJobCount\s*>=?\s*\d/);
    });
});

describe('P5 A5 (4) — page integration: main column, every breakpoint, ISR intact', () => {
    const pageSrc = () => readCode(JOB_PAGE);

    it('the page renders the module and builds its model from the shared builder', () => {
        const src = pageSrc();
        expect(src).toMatch(/from '@\/components\/JobLocationContext'/);
        expect(src).toMatch(/buildJobLocationContext\(/);
        expect(src).toMatch(/<JobLocationContext\s+model=\{locationContext\}/);
    });

    it('the module is not hidden behind a desktop-only wrapper', () => {
        const src = pageSrc();
        const usage = src.indexOf('<JobLocationContext');
        expect(usage).toBeGreaterThan(-1);
        // The enclosing markup immediately around the module must not carry
        // the `hidden lg:` pattern that P2 #2 removed from this page.
        const surrounding = src.slice(Math.max(0, usage - 600), usage + 200);
        expect(surrounding).not.toMatch(/hidden lg:/);
    });

    it('the inventory count mirrors the city page predicate and stays inside the fan-out', () => {
        const src = pageSrc();
        // Same shape getCityStats uses on app/jobs/city/[slug]/page.tsx.
        expect(src).toMatch(
            /isPublished:\s*true,\s*city:\s*\{\s*equals:\s*job\.city,\s*mode:\s*'insensitive'\s*\},\s*OR:\s*\[\s*\{\s*state:\s*locationCityRecord\.state\s*\},\s*\{\s*stateCode:\s*locationCityRecord\.stateCode\s*\},?\s*\]/,
        );
    });

    it('ISR is untouched: revalidate stays 3600 and no Dynamic API crept in', () => {
        const src = pageSrc();
        expect(src).toMatch(/export const revalidate = 3600/);
        expect(src).not.toMatch(/\b(?:cookies|headers)\s*\(/);
    });
});
