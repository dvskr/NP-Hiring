/**
 * Indexing audit CQ-15 on the salary-guide surfaces: every published
 * posted-pay median runs under the employer-share cap, and a sample the cap
 * alone withholds is described as what it is, never as "too small".
 *
 * The cap's arithmetic is unit tested in tests/unit/salary-guide-gate.test.ts
 * and its reach through lib/salary-analytics.ts in
 * tests/unit/salary-analytics-gated-location.test.ts. These guards pin the
 * page wiring the unit tests cannot reach.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const HUB = 'app/salary-guide/page.tsx';
const STATE = 'app/salary-guide/[state]/page.tsx';

describe('/salary-guide hub', () => {
    const src = read(HUB);

    it('computes the state table under the cap, not the bare benchmark gate', () => {
        expect(src).toContain('summarizeCappedBenchmarks(npRows)');
        expect(code(src)).not.toMatch(/\bsummarizeBenchmarks\(/);
    });

    it('lists cap-held states separately, with counts and without a figure or an employer name', () => {
        expect(src).toContain('employerHeldStates.map((s) =>');
        expect(src).toContain('({s.topEmployerPostings} of {s.jobCount} from one employer)');
        // The cap trips above MAX_EMPLOYER_SHARE_PERCENT, so a held state can
        // sit anywhere from just over that share to all of it: "most" would be
        // false at 41 to 50% (the audit's own Virginia case is 13 of 26).
        expect(src).toContain('States where one employer posts more than {MAX_EMPLOYER_SHARE_PERCENT}% of the pay data');
        expect(src).not.toContain('posts most of the pay data');
        expect(src).toContain('so a median would lean heavily on that one employer&apos;s pay scale.');
        expect(src).not.toContain('mostly reflect');
        // Held states never fall into the "too few postings" list.
        expect(src).toContain('const listedNames = new Set([...gatedStates, ...employerHeldStates].map((s) => s.state));');
    });

    it('the table note states the cap beside the existing gate', () => {
        expect(src).toContain('with no single employer contributing more than {MAX_EMPLOYER_SHARE_PERCENT}% of them');
    });

    it('the section still renders when every sizable state is held', () => {
        expect(src).toContain('{(stateSalaries.length > 0 || employerHeldStates.length > 0) && (');
    });

    it('the BLS vintage in the hero and methodology derives from STAT_SOURCES, never a literal', () => {
        expect(src).toContain('const NATIONAL_SALARY_VINTAGE = formatStatVintage(NATIONAL_SALARY.asOf);');
        expect(src).not.toContain('(BLS OEWS, May 2024)');
        expect(src).not.toContain('(BLS OEWS, May 2025)');
    });
});

describe('/salary-guide/[state]', () => {
    const src = read(STATE);

    it('reads the employer split from the gated location salary', () => {
        expect(src).toContain('Promise<GatedSalaryDetail>');
        expect(src).toContain('salaryData.heldByEmployerShare');
    });

    it('a cap hold gets its own FAQ answer and stat tile instead of "Sample too small"', () => {
        expect(src).toContain('buildEmployerShareHoldSentence({');
        expect(src).toContain("value: 'Not published',");
        expect(src).toContain('published when none exceeds ${MAX_EMPLOYER_SHARE_PERCENT}%');
        // The below-gate branch is unchanged for genuinely small samples.
        expect(src).toContain('Sample too small');
    });

    it('every gate description on the page names the cap beside the size gate', () => {
        // The setting rows and the city medians both run under the cap
        // (getGatedBenchmarkRows and getGatedCitySalaries), so a lede that
        // named only the size gate would give a false reason for a held row.
        expect(src).toContain('published only at ${BENCHMARK_MIN_POSTINGS} or more postings from ${BENCHMARK_MIN_EMPLOYERS} or more employers, with no single employer above ${MAX_EMPLOYER_SHARE_PERCENT}% of them. Rows overlap');
        expect(src).toContain('a median is published at ${BENCHMARK_MIN_POSTINGS} or more postings with disclosed pay from ${BENCHMARK_MIN_EMPLOYERS} or more employers, with no single employer above ${MAX_EMPLOYER_SHARE_PERCENT}% of them.');
        expect(src).toContain('sub: `Published at ${BENCHMARK_MIN_POSTINGS} or more postings from ${BENCHMARK_MIN_EMPLOYERS} or more employers, none above ${MAX_EMPLOYER_SHARE_PERCENT}%`,');
        expect(src).not.toContain('posting publishing gate works');
    });

    it('does not print a tag-derived remote count beside the structured work-mode split', () => {
        expect(src).toContain("const WORK_ARRANGEMENT_TAG_SLUGS: ReadonlySet<string> = new Set(['remote']);");
        expect(src).toContain('.filter((row) => !WORK_ARRANGEMENT_TAG_SLUGS.has(row.categorySlug))');
    });
});
