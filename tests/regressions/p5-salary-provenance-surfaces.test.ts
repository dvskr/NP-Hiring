/**
 * Regression guards — competitive teardown A4 (salary-provenance package).
 *
 * Competitors date-stamp their salary surfaces (Vivian: "Last updated on
 * … . Based on active jobs on Vivian.com"; Indeed: "…salaries … updated
 * …"). This board's equivalent is components/SalaryProvenance.tsx, one
 * shared component wired onto every salary surface (hub, 51 state pages,
 * specialty index + detail pages, calculator footnote), assembled from
 * three honest claim kinds:
 *
 *   1. Cited stats: source + vintage from STAT_SOURCES metadata
 *      (lib/stats-sources.ts) — never re-typed.
 *   2. Live snapshot basis: "Based on N active postings with disclosed
 *      salary…" where N comes from the aggregate query the page already
 *      runs, rendered only when N clears the surface's EXISTING
 *      minimum-sample gate (omit, never fabricate).
 *   3. Editorial review dates: literals a human bumps on real review —
 *      NEVER render time (B54 / P0 #23: `new Date()` freshness is
 *      fabricated freshness).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { brand } from '@/config/brand';
import { STAT_SOURCES } from '@/lib/stats-sources';
import {
    buildProvenanceSentences,
    formatStatVintage,
} from '@/components/SalaryProvenance';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * Comments are stripped before absence assertions: the component and the
 * state page each carry comments NAMING the fabricated-freshness defect
 * they guard against, and those mentions must not satisfy (or fail) a
 * check about published code. Same pattern as
 * p2-data-accuracy-stats-and-guides.test.ts.
 */
const stripComments = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const COMPONENT = 'components/SalaryProvenance.tsx';
const HUB = 'app/salary-guide/page.tsx';
const STATE_PAGE = 'app/salary-guide/[state]/page.tsx';
const SPECIALTY_DETAIL = 'app/salary-guide/specialty/[specialty]/page.tsx';
const SPECIALTY_INDEX = 'app/salary-guide/specialty/page.tsx';
const CALCULATOR = 'components/SalaryCalculator.tsx';

describe('A4 — formatStatVintage renders STAT_SOURCES asOf shapes without Date()', () => {
    it('formats a YYYY-MM vintage as "Month YYYY"', () => {
        expect(formatStatVintage('2024-05')).toBe('May 2024');
    });

    it('formats a bare YYYY vintage as the year alone', () => {
        expect(formatStatVintage('2025')).toBe('2025');
    });

    it('formats a full YYYY-MM-DD review literal as a readable date', () => {
        expect(formatStatVintage('2026-07-28')).toBe('July 28, 2026');
    });

    it('passes unrecognized input through instead of guessing', () => {
        expect(formatStatVintage('Q3 FY24')).toBe('Q3 FY24');
        expect(formatStatVintage('2024-13')).toBe('2024-13');
    });

    it('handles every real STAT_SOURCES asOf without falling back', () => {
        for (const [key, stat] of Object.entries(STAT_SOURCES)) {
            const formatted = formatStatVintage(stat.asOf);
            expect(
                /^([A-Z][a-z]+ )?\d{4}$/.test(formatted),
                `${key} asOf '${stat.asOf}' should format to a vintage, got '${formatted}'`,
            ).toBe(true);
        }
    });
});

describe('A4 — buildProvenanceSentences claims exactly what its inputs support', () => {
    it('does not repeat a vintage the source string already names (OEWS)', () => {
        // Arrange: the OEWS entry's source ends in "May 2024" already.
        const stat = STAT_SOURCES.averageSalary;

        // Act
        const [sentence] = buildProvenanceSentences({ cited: [stat] });

        // Assert: one "May 2024", not "…May 2024 (May 2024)".
        expect(sentence).toContain(stat.source);
        expect(sentence.match(/May 2024/g)).toHaveLength(1);
    });

    it('appends the vintage when the source string does not name it (AANP)', () => {
        const stat = STAT_SOURCES.fullPracticeStates;

        const [sentence] = buildProvenanceSentences({ cited: [stat] });

        expect(sentence).toContain(`${stat.source} (${formatStatVintage(stat.asOf)})`);
    });

    it('omits the live sentence below the minimum-sample gate — never fabricates', () => {
        const sentences = buildProvenanceSentences({ live: { count: 2, minimum: 3 } });

        expect(sentences).toHaveLength(0);
    });

    it('omits the live sentence for a zero-row snapshot even with minimum 0', () => {
        const sentences = buildProvenanceSentences({ live: { count: 0, minimum: 0 } });

        expect(sentences).toHaveLength(0);
    });

    it('states the snapshot basis with the board name once the gate clears', () => {
        const [sentence] = buildProvenanceSentences({ live: { count: 1234, minimum: 3 } });

        expect(sentence).toBe(
            `Based on 1,234 active postings with disclosed salary on ${brand.name}, recomputed as postings are ingested daily.`,
        );
    });

    it('renders a review date only from the literal it was given', () => {
        const sentences = buildProvenanceSentences({ reviewedOn: '2026-07-28' });

        expect(sentences).toEqual(['Figures last reviewed July 28, 2026.']);
    });

    it('renders nothing at all from empty inputs', () => {
        expect(buildProvenanceSentences({})).toHaveLength(0);
        expect(buildProvenanceSentences({ cited: [] })).toHaveLength(0);
    });
});

describe('A4 — the component itself cannot fabricate freshness', () => {
    const src = stripComments(read(COMPONENT));

    it('is a server component (no "use client" directive)', () => {
        expect(src).not.toContain("'use client'");
    });

    it('never constructs a Date — a render-time "today" is the P0 #23 defect', () => {
        expect(src).not.toContain('new Date(');
        expect(src).not.toContain('Date.now(');
    });

    it('carries no hand-typed salary figures of its own', () => {
        // Every dollar amount on a provenance line must arrive via props.
        expect(src).not.toMatch(/\$\d/);
    });
});

describe('A4 — every salary surface renders the shared provenance line', () => {
    it('the hub stamps the Quick Answer with cited vintage + live basis + review literal', () => {
        const src = read(HUB);
        expect(src).toContain("import SalaryProvenance from '@/components/SalaryProvenance'");
        expect(src).toContain('cited={[NATIONAL_SALARY]}');
        expect(src).toContain('live={{ count: overallStats.jobsWithSalary, minimum: 1 }}');
        // The review date is the SAME literal the Article dateModified uses,
        // so the visible stamp and the schema cannot disagree.
        expect(src).toContain('reviewedOn={LAST_REVIEWED_DATE}');
    });

    it('the hub also states the state table’s own snapshot basis', () => {
        const src = read(HUB);
        const renders = src.match(/<SalaryProvenance/g) ?? [];
        expect(renders.length).toBeGreaterThanOrEqual(2);
    });

    it('the state template ([state] → 51 pages) states its live basis, no fake date', () => {
        const src = read(STATE_PAGE);
        expect(src).toContain("import SalaryProvenance from '@/components/SalaryProvenance'");
        expect(src).toContain('live={{ count: salaryData.jobCount, minimum: 1 }}');
        // B54: this page has no editorial review literal, so it must not
        // pass one — and must still omit Article dates entirely (comments
        // documenting that rule don't count as published code).
        const code = stripComments(src);
        expect(code).not.toContain('reviewedOn=');
        expect(code).not.toContain('dateModified');
    });

    it('the specialty detail template gates its live basis on MIN_LIVE_JOBS', () => {
        const src = read(SPECIALTY_DETAIL);
        expect(src).toContain("import SalaryProvenance from '@/components/SalaryProvenance'");
        expect(src).toContain('cited={[median]}');
        expect(src).toContain(
            'live={hasLive ? { count: live.jobCount, minimum: MIN_LIVE_JOBS } : undefined}',
        );
    });

    it('the specialty index cites the benchmark median’s source + vintage', () => {
        const src = read(SPECIALTY_INDEX);
        expect(src).toContain("import SalaryProvenance from '@/components/SalaryProvenance'");
        expect(src).toContain('cited={[median]}');
    });

    it('the calculator footnote names the BLS vintage from STAT_SOURCES metadata', () => {
        const src = read(CALCULATOR);
        expect(src).toContain('formatStatVintage(STAT_SOURCES.averageSalary.asOf)');
        // The P0 #22 honesty phrasing stays intact.
        expect(src).toContain('live job postings on {brand.name}');
        expect(src).not.toContain('10,000+');
    });
});
