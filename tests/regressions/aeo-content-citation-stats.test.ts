/**
 * Regression guards — citation-trust sweep B4 + B51 + B56 (aeo-content).
 *
 * The board previously published THREE disagreeing national salary
 * figures across its citation surfaces: the homepage FAQ cited the BLS
 * OEWS figure from lib/stats-sources.ts while the job-page widgets and
 * the salary guide hardcoded values from an earlier OEWS vintage (a
 * flat $K figure and an invented range). Healthcare YMYL content that
 * quotes different salary numbers on different pages is a direct
 * E-E-A-T hit.
 *
 * The fix made lib/stats-sources.ts the single source of truth:
 *   - the UI constants in config/niche/stats.ts DERIVE from
 *     STAT_SOURCES.averageSalary;
 *   - app/salary-guide/page.tsx reads STAT_SOURCES for its national
 *     salary / growth / shortage / FPA claims;
 *   - fabricated donor-era figures (the 158k-to-165k salary trend row,
 *     the mental-health-HPSA "123 million" population, the "6,203
 *     providers needed" count, the "34 states + DC" FPA claim, and the
 *     "10,000+ jobs analyzed" boast) were removed or replaced with
 *     cited/live values;
 *   - (B56) the Article publisher logo now references /logo.png — the
 *     previously referenced /logo.svg does not exist in public/.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { STAT_SOURCES } from '@/lib/stats-sources';
import {
    CAREER_PULSE_STATS,
    NATIONAL_AVG_SALARY_K,
    SALARY_COMPARISON_NATIONAL_AVG_K,
    SALARY_INSIGHTS_DEFAULT_NATIONAL_AVG_K,
    STATE_FAQ_NATIONAL_AVG_SALARY_TEXT,
} from '@/config/niche/stats';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const DERIVED_K = Math.round(Number(STAT_SOURCES.averageSalary.value) / 1000);

describe('B4 — UI salary constants derive from the cited BLS figure', () => {
    it('NATIONAL_AVG_SALARY_K matches STAT_SOURCES.averageSalary', () => {
        expect(NATIONAL_AVG_SALARY_K).toBe(DERIVED_K);
    });

    it('the job-page comparison denominators agree with the cited figure', () => {
        expect(SALARY_COMPARISON_NATIONAL_AVG_K).toBe(DERIVED_K);
        expect(SALARY_INSIGHTS_DEFAULT_NATIONAL_AVG_K).toBe(DERIVED_K);
    });

    it('the state-FAQ display string is the cited formatted value', () => {
        expect(STATE_FAQ_NATIONAL_AVG_SALARY_TEXT).toBe(STAT_SOURCES.averageSalary.formatted);
    });

    it('career-pulse pebbles quote only derived figures', () => {
        const salaryPebble = CAREER_PULSE_STATS.find((s) => /salary/i.test(s.label));
        const growthPebble = CAREER_PULSE_STATS.find((s) => /growth/i.test(s.label));
        expect(salaryPebble?.value).toBe(`$${DERIVED_K}K`);
        expect(growthPebble?.value).toBe(STAT_SOURCES.blsGrowth2032.formatted);
    });

    it('config/niche/stats.ts contains no hardcoded dollar salary figure', () => {
        const src = read('config/niche/stats.ts');
        // Dollar amounts are allowed only for the query-coupled filter
        // buckets ($100k/$150k/$200k thresholds) or when they equal the
        // figure derived from STAT_SOURCES — never a re-hardcoded
        // national average from some other vintage.
        const dollarLiterals = src.match(/\$\d[\d,]*/g) ?? [];
        const allowedPrefixes = ['$100', '$150', '$200', `$${DERIVED_K}`];
        for (const lit of dollarLiterals) {
            const ok = allowedPrefixes.some((p) => lit.startsWith(p));
            expect(ok, `unexpected hardcoded dollar literal in config/niche/stats.ts: ${lit}`).toBe(true);
        }
    });
});

describe('B51 — salary guide quotes the single cited figure', () => {
    const src = read('app/salary-guide/page.tsx');

    it('imports STAT_SOURCES and derives its headline figures', () => {
        expect(src).toContain("from '@/lib/stats-sources'");
        expect(src).toContain('STAT_SOURCES.averageSalary');
        expect(src).toContain('STAT_SOURCES.fullPracticeStates');
        expect(src).toContain('STAT_SOURCES.hrsaShortagePopulation');
    });

    it('no longer hardcodes the stale 126K-era national average', () => {
        expect(src).not.toContain('$126');
        expect(src).not.toContain('126,000');
    });

    it('no longer carries the fabricated donor-era figures', () => {
        expect(src).not.toContain('$158');       // donor salary-trend row
        expect(src).not.toContain('34 states');  // wrong FPA count (AANP says 27 + DC)
        expect(src).not.toContain('123 million'); // donor mental-health HPSA population
        expect(src).not.toContain('6,203');      // donor provider-shortage count
        expect(src).not.toContain('10,000+');    // fabricated jobs-analyzed boast
    });

    it('B56 — Article publisher logo references an existing asset', () => {
        expect(src).not.toContain('logo.svg');
        expect(src).toContain('/logo.png');
        expect(fs.existsSync(path.join(ROOT, 'public', 'logo.png'))).toBe(true);
    });
});
