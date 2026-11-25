/**
 * The salary engine (lib/salary-report/stats.ts, ported from PMHNP Hiring)
 * and the benchmark model over it (components/tools/benchmark-model.ts).
 * Invariants over fixtures, not source shape:
 *   - ten postings from one employer are one data point;
 *   - 4 employers publish no median, 5 a median and no quartiles, 10 the
 *     quartiles too;
 *   - an estimated row, a single figure (no max), a $40k midpoint, a 3.5x
 *     range and a $600k midpoint are each excluded;
 *   - a placeholder employer counts as an employer of its own;
 *   - display rounding is the $500 grid, then thousands.
 */
import { describe, it, expect } from 'vitest';
import {
    cleanSalaryRows,
    displayThousands,
    medianAdvertisedK,
    medianAdvertisedSummaryK,
    ONE_EMPLOYER_NOTE,
    percentile,
    roundDisplayDollars,
    summarizeMidpoints,
    TIER_RULE_NOTE,
    type SalaryRow,
} from '@/lib/salary-report/stats';
import {
    BENCHMARK_FULL_MIN_EMPLOYERS,
    BENCHMARK_MIN_EMPLOYERS,
    classifyOffer,
    summarizeBenchmarkPool,
    summarizeBenchmarks,
    summarizePool,
    summarizeScope,
    type BenchmarkInputRow,
} from '@/components/tools/benchmark-model';

const row = (employer: string | null, min: number, max: number | null = min + 20_000, state: string | null = 'Texas'): BenchmarkInputRow => ({
    state,
    employer,
    normalizedMinSalary: min,
    normalizedMaxSalary: max,
});

/** n employers, each with one posting, midpoints 110k, 112k, 114k ... */
function employers(n: number, state = 'Texas'): BenchmarkInputRow[] {
    return Array.from({ length: n }, (_, i) => row(`Employer ${i + 1}`, 100_000 + i * 2_000, 120_000 + i * 2_000, state));
}

describe('each employer counts once', () => {
    it('ten postings from one employer are one data point, at the median of its distinct ranges', () => {
        const flood = Array.from({ length: 10 }, (_, i) => row('Big Health System', 100_000 + (i % 3) * 10_000));
        const clean = cleanSalaryRows(flood);
        expect(clean.midpoints).toHaveLength(1);
        expect(clean.postings).toBe(10);
        // Distinct ranges: 100k-120k, 110k-130k, 120k-140k; midpoints 110k, 120k, 130k.
        expect(clean.midpoints[0]).toBe(120_000);
    });

    it('one employer flooding a state cannot move its median, however many postings it adds', () => {
        const base = employers(5);
        const median = summarizePool(base)?.median;
        const flooded = [...base, ...Array.from({ length: 40 }, () => row('Employer 1', 300_000, 320_000))];
        const after = summarizePool(flooded);
        // Employer 1 now has two distinct ranges; it still counts once.
        expect(after?.employers).toBe(5);
        expect(after?.median).not.toBeUndefined();
        expect(Math.abs((after?.median ?? 0) - (median ?? 0))).toBeLessThanOrEqual(2_000);
    });

    it('names that differ only in case, punctuation or legal form are one employer', () => {
        const clean = cleanSalaryRows([row('LifeStance Health, Inc.', 120_000), row('lifestance health', 140_000)]);
        expect(clean.midpoints).toHaveLength(1);
    });

    it('a missing or placeholder employer counts as an employer of its own', () => {
        const clean = cleanSalaryRows([row(null, 100_000), row('Confidential', 110_000), row('Company Not Listed', 120_000), row('', 130_000)]);
        expect(clean.midpoints).toHaveLength(4);
    });
});

describe('tiers by number of employers', () => {
    it('4 employers: a count only, no dollar figure', () => {
        const { row: published, summary } = summarizeScope('Texas', employers(4));
        expect(published).toBeNull();
        expect(summary).toEqual({ tier: 'countOnly', n: 4 });
        expect(medianAdvertisedK(employers(4))).toBe(0);
        expect(medianAdvertisedSummaryK(employers(4))).toEqual({ medianK: 0, n: 0 });
    });

    it('2 employers: nothing at all', () => {
        expect(summarizeScope('Texas', employers(2)).summary).toEqual({ tier: 'none', n: 2 });
    });

    it('5 employers: a median and no quartiles', () => {
        const published = summarizePool(employers(BENCHMARK_MIN_EMPLOYERS));
        expect(published).toMatchObject({ tier: 'median', employers: 5, p25: null, p75: null });
        expect(published?.median).toBe(114_000);
        expect(classifyOffer(150_000, published!)).toBeNull();
    });

    it('10 employers: the 25th and 75th percentiles too', () => {
        const published = summarizePool(employers(BENCHMARK_FULL_MIN_EMPLOYERS));
        expect(published?.tier).toBe('full');
        expect(published?.employers).toBe(10);
        expect(published?.p25).not.toBeNull();
        expect(published?.p75).not.toBeNull();
        expect((published?.p25 as number) <= (published?.median as number)).toBe(true);
        expect((published?.median as number) <= (published?.p75 as number)).toBe(true);
        expect(classifyOffer(1_000, published!)).toBe('below');
        expect(classifyOffer(1_000_000, published!)).toBe('above');
    });

    it('a state below the tier is left out of the state rows; the national row pools every row', () => {
        const rows = [...employers(5, 'Texas'), ...employers(2, 'Ohio').map((r) => ({ ...r, employer: `Ohio ${r.employer}` })), row('Remote Co', 130_000, 150_000, null)];
        const { states, national } = summarizeBenchmarkPool(rows);
        expect(states.map((s) => s.scope)).toEqual(['Texas']);
        expect(national?.employers).toBe(8);
        // summarizeBenchmarks leaves the stateless row out of its national row.
        expect(summarizeBenchmarks(rows).national?.employers).toBe(7);
    });
});

describe('quarantine', () => {
    const fiveGood = employers(5);
    const excludedCases: Array<[string, SalaryRow]> = [
        ['an estimated row', { employer: 'Estimate Co', normalizedMinSalary: 120_000, normalizedMaxSalary: 140_000, salaryIsEstimated: true }],
        ['a single figure with no max', { employer: 'Single Figure Co', normalizedMinSalary: 130_000, normalizedMaxSalary: null }],
        ['a $40k midpoint', { employer: 'Low Co', normalizedMinSalary: 35_000, normalizedMaxSalary: 45_000 }],
        ['a 3.5x range', { employer: 'Wide Co', normalizedMinSalary: 60_000, normalizedMaxSalary: 210_000 }],
        ['a $600k midpoint', { employer: 'High Co', normalizedMinSalary: 590_000, normalizedMaxSalary: 610_000 }],
        ['a max below the min', { employer: 'Inverted Co', normalizedMinSalary: 140_000, normalizedMaxSalary: 120_000 }],
    ];
    for (const [label, bad] of excludedCases) {
        it(`excludes ${label}`, () => {
            const clean = cleanSalaryRows([...fiveGood, bad]);
            expect(clean.midpoints).toHaveLength(5);
            expect(summarizeMidpoints(clean.midpoints).n).toBe(5);
        });
    }

    it('counts a quarantined row as quarantined, and a missing bound as missing data', () => {
        const clean = cleanSalaryRows([excludedCases[0][1], excludedCases[1][1], excludedCases[2][1]]);
        expect(clean.quarantined).toBe(2);
        expect(clean.postings).toBe(0);
    });
});

describe('percentiles and display rounding', () => {
    it('interpolates linearly between ranks', () => {
        expect(percentile([100, 200], 50)).toBe(150);
        expect(percentile([100, 200, 300, 400], 25)).toBe(175);
        expect(Number.isNaN(percentile([], 50))).toBe(true);
    });

    it('rounds to the $500 grid, then to thousands, so a title and a hero agree', () => {
        expect(roundDisplayDollars(152_300)).toBe(152_500);
        expect(displayThousands(152_300)).toBe(153);
        expect(summarizePool(employers(5))?.median).toBe(roundDisplayDollars(114_000));
    });

    it('states the counting and tier rules in plain words, without dashes', () => {
        expect(ONE_EMPLOYER_NOTE).toMatch(/Each employer counts once/);
        expect(TIER_RULE_NOTE).toContain('at least 5 employers');
        expect(TIER_RULE_NOTE).toContain('at least 10 do');
        expect(`${ONE_EMPLOYER_NOTE} ${TIER_RULE_NOTE}`).not.toMatch(/[–—]|\bearn|average/i);
    });
});
