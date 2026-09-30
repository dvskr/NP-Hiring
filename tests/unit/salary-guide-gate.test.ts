/**
 * The employer-share cap on published posted-pay medians (indexing audit
 * CQ-15, lib/salary-guide-gate.ts). The benchmark gate (5 postings from 3
 * employers) never asked how the postings split; /salary-guide/virginia
 * published a "state" median while one employer held about half the roles.
 * A median now publishes only when no employer contributes more than
 * MAX_EMPLOYER_SHARE_PERCENT of the postings behind it.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { MAX_EMPLOYER_SHARE_PERCENT as POLICY_MAX_EMPLOYER_SHARE_PERCENT } from '@/lib/salary-guide-policy';
import {
    applyEmployerShareCap,
    buildEmployerShareHoldSentence,
    clearsEmployerShareCap,
    employerConcentration,
    employerConcentrationByScope,
    MAX_EMPLOYER_SHARE_PERCENT,
    summarizeCappedBenchmarkPool,
    summarizeCappedBenchmarks,
    summarizeCappedPool,
} from '@/lib/salary-guide-gate';
import { summarizeBenchmarks, type BenchmarkInputRow } from '@/components/tools/benchmark-model';

function row(employer: string | null, min: number, state: string | null = 'Virginia'): BenchmarkInputRow {
    return { state, employer, normalizedMinSalary: min, normalizedMaxSalary: min };
}

/** n rows from one employer, each with a distinct midpoint. */
function rowsFrom(employer: string, n: number, base: number, state: string | null = 'Virginia'): BenchmarkInputRow[] {
    return Array.from({ length: n }, (_, i) => row(employer, base + i * 1_000, state));
}

describe('the cap constant', () => {
    it('sits inside the 40 to 50% band the audit asked for, below the one-employer median point', () => {
        expect(MAX_EMPLOYER_SHARE_PERCENT).toBeGreaterThanOrEqual(40);
        expect(MAX_EMPLOYER_SHARE_PERCENT).toBeLessThanOrEqual(50);
    });

    it('the gate re-exports the one value the import-free policy module defines', () => {
        expect(MAX_EMPLOYER_SHARE_PERCENT).toBe(POLICY_MAX_EMPLOYER_SHARE_PERCENT);
    });

    it('the policy module imports nothing, so client components and pure copy builders can state the rule', () => {
        // lib/salary-guide-gate.ts reaches lib/company-normalizer.ts, which
        // imports the Prisma client; a browser bundle must never follow it.
        const src = fs.readFileSync(path.join(process.cwd(), 'lib/salary-guide-policy.ts'), 'utf8');
        expect(src).not.toMatch(/^\s*import\s/m);
        expect(src).not.toMatch(/\brequire\(/);
        expect(src).toContain('export const MAX_EMPLOYER_SHARE_PERCENT = 40;');
    });
});

describe('clearsEmployerShareCap', () => {
    it('passes at exactly the cap and fails one posting above it (integer arithmetic, no float edge)', () => {
        expect(clearsEmployerShareCap({ postings: 5, topEmployerPostings: 2 })).toBe(true); // 40%
        expect(clearsEmployerShareCap({ postings: 5, topEmployerPostings: 3 })).toBe(false); // 60%
        expect(clearsEmployerShareCap({ postings: 15, topEmployerPostings: 6 })).toBe(true); // 40%
        expect(clearsEmployerShareCap({ postings: 15, topEmployerPostings: 7 })).toBe(false);
        expect(clearsEmployerShareCap({ postings: 35, topEmployerPostings: 14 })).toBe(true);
    });

    it('the audit case: 13 of 26 from one employer is held', () => {
        expect(clearsEmployerShareCap({ postings: 26, topEmployerPostings: 13 })).toBe(false);
    });

    it('an empty sample never clears', () => {
        expect(clearsEmployerShareCap({ postings: 0, topEmployerPostings: 0 })).toBe(false);
    });
});

describe('employerConcentration', () => {
    it('counts only benchmark-eligible rows: an employer and a positive minimum', () => {
        const c = employerConcentration([
            row('Alpha', 100_000),
            row('Alpha', 110_000),
            row('Beta', 120_000),
            row(null, 130_000),
            row('  ', 130_000),
            row('Gamma', 0),
        ]);
        expect(c).toEqual({ postings: 3, employers: 2, topEmployerPostings: 2 });
    });

    it('pools stateless rows with the rest', () => {
        const c = employerConcentration([row('Alpha', 100_000, null), row('Beta', 110_000, 'Ohio')]);
        expect(c.postings).toBe(2);
    });

    it('merges alias spellings of one employer, so a name variant cannot dodge the cap', () => {
        const c = employerConcentration([
            row('LifeStance Health', 100_000),
            row('Lifestance', 110_000),
            row('LifeStance Health, Inc.', 120_000),
            row('Beta Clinic', 130_000),
            row('Gamma Care', 140_000),
        ]);
        expect(c.employers).toBe(3);
        expect(c.topEmployerPostings).toBe(3);
        expect(clearsEmployerShareCap(c)).toBe(false);
    });

    it('groups by scope, skipping rows with no scope', () => {
        const byScope = employerConcentrationByScope([
            ...rowsFrom('Alpha', 2, 100_000, 'Ohio'),
            row('Beta', 120_000, 'Ohio'),
            row('Alpha', 130_000, null),
        ]);
        expect([...byScope.keys()]).toEqual(['Ohio']);
        expect(byScope.get('Ohio')).toEqual({ postings: 3, employers: 2, topEmployerPostings: 2 });
    });
});

describe('summarizeCappedBenchmarks', () => {
    /** 26 Virginia postings from 5 employers, 13 of them from one employer. */
    const VIRGINIA = [
        ...rowsFrom('Thrive Clinic', 13, 150_000),
        ...rowsFrom('Beta', 4, 160_000),
        ...rowsFrom('Gamma', 3, 170_000),
        ...rowsFrom('Delta', 3, 140_000),
        ...rowsFrom('Epsilon', 3, 145_000),
    ];
    /** 10 Ohio postings from 3 employers, none above 40%. */
    const OHIO = [
        ...rowsFrom('Alpha', 4, 120_000, 'Ohio'),
        ...rowsFrom('Beta', 3, 125_000, 'Ohio'),
        ...rowsFrom('Gamma', 3, 130_000, 'Ohio'),
    ];

    it('the uncapped gate passes Virginia, the cap holds it and names why', () => {
        expect(summarizeBenchmarks(VIRGINIA).states.map((s) => s.scope)).toEqual(['Virginia']);
        const capped = summarizeCappedBenchmarks([...VIRGINIA, ...OHIO]);
        expect(capped.states.map((s) => s.scope)).toEqual(['Ohio']);
        expect(capped.heldStates).toEqual([
            { scope: 'Virginia', concentration: { postings: 26, employers: 5, topEmployerPostings: 13 } },
        ]);
    });

    it('keeps the uncapped row untouched for a scope that clears the cap', () => {
        const capped = summarizeCappedBenchmarks(OHIO);
        expect(capped.states).toEqual(summarizeBenchmarks(OHIO).states);
        expect(capped.heldStates).toEqual([]);
    });

    it('a scope below the benchmark gate is not "held": it never passed the gate', () => {
        const capped = summarizeCappedBenchmarks(rowsFrom('Solo', 7, 100_000, 'Maine'));
        expect(capped.states).toEqual([]);
        expect(capped.heldStates).toEqual([]);
        expect(capped.national).toBeNull();
        expect(capped.nationalHeld).toBeNull();
    });

    it('judges the pooled row over every scoped row, and reports a cap hold on it', () => {
        const dominated = [
            ...rowsFrom('Big System', 9, 100_000, 'Ohio'),
            row('Beta', 150_000, 'Ohio'),
            row('Gamma', 160_000, 'Iowa'),
        ];
        const capped = summarizeCappedBenchmarks(dominated);
        expect(summarizeBenchmarks(dominated).national).not.toBeNull();
        expect(capped.national).toBeNull();
        expect(capped.nationalHeld).toEqual({ postings: 11, employers: 3, topEmployerPostings: 9 });
    });

    it('applyEmployerShareCap is idempotent over an already-capped summary', () => {
        const rows = [...VIRGINIA, ...OHIO];
        const once = summarizeCappedBenchmarks(rows);
        const twice = applyEmployerShareCap(once, rows);
        expect(twice.states).toEqual(once.states);
        expect(twice.national).toEqual(once.national);
    });
});

describe('summarizeCappedPool and summarizeCappedBenchmarkPool', () => {
    it('the pool counts stateless rows toward the pooled figure', () => {
        const rows = [
            ...rowsFrom('Alpha', 2, 100_000, null),
            ...rowsFrom('Beta', 2, 110_000, null),
            row('Gamma', 120_000, null),
        ];
        const { national, nationalHeld } = summarizeCappedPool(rows);
        expect(national?.postings).toBe(5);
        expect(nationalHeld).toBeNull();
    });

    it('the pool withholds a figure one employer dominates', () => {
        const rows = [...rowsFrom('Alpha', 4, 100_000, null), row('Beta', 110_000), row('Gamma', 120_000)];
        const { national, nationalHeld } = summarizeCappedPool(rows);
        expect(national).toBeNull();
        expect(nationalHeld?.topEmployerPostings).toBe(4);
    });

    it('the widget-shaped pool: capped states over scoped rows, capped national over all rows', () => {
        const rows = [
            ...rowsFrom('Alpha', 2, 100_000, 'Ohio'),
            ...rowsFrom('Beta', 2, 110_000, 'Ohio'),
            row('Gamma', 120_000, 'Ohio'),
            row('Delta', 130_000, null),
        ];
        const { national, states } = summarizeCappedBenchmarkPool(rows);
        expect(states.map((s) => s.scope)).toEqual(['Ohio']);
        expect(national?.postings).toBe(6);
    });
});

describe('buildEmployerShareHoldSentence', () => {
    const sentence = buildEmployerShareHoldSentence({
        scopeName: 'Virginia',
        concentration: { postings: 26, employers: 5, topEmployerPostings: 13 },
    });

    it('names the failing condition with the sample counts and the cap', () => {
        expect(sentence).toContain('26 postings in Virginia disclose annual pay across 5 employers');
        expect(sentence).toContain('one employer accounts for 13 of them');
        expect(sentence).toContain(`more than ${MAX_EMPLOYER_SHARE_PERCENT}% of the postings`);
    });

    it('prints no dollar figure and follows the house style (no dashes)', () => {
        expect(sentence).not.toMatch(/\$/);
        expect(sentence).not.toMatch(/[–—]| - /);
        expect(sentence).not.toMatch(/\baverage\b/i);
    });
});
