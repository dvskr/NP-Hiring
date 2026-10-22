/**
 * Register 2.18: a job alert's minimum salary keeps the jobs the /jobs salary
 * filter keeps.
 *
 * The two used different rules. /jobs (salaryClause in lib/filters.ts) keeps
 * a job whose low or high figure reaches the minimum and drops a job that
 * posts no pay. The digest kept a job whose high figure reached it, plus jobs
 * with no pay. A posting with one figure ("$130,000/yr" stores no high
 * figure) was therefore left out of a $100k+ alert although /jobs listed it,
 * and the digest's "View All Matching Jobs" link (/jobs?salaryMin=) showed a
 * different set from the email. The digest now uses salaryClause itself.
 * A maximum has no /jobs filter, and its rule is unchanged.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Prisma } from '@prisma/client';

vi.mock('resend', () => ({
    Resend: class {
        emails = { send: vi.fn() };
        batch = { send: vi.fn() };
    },
}));

import { alertSalaryConditions } from '@/lib/job-alerts-service';
import { salaryClause } from '@/lib/filters';

type Row = { id: string; normalizedMinSalary: number | null; normalizedMaxSalary: number | null };

/** A `where` as Prisma reads it for these shapes: AND, OR, gte, lte and null equality. */
function matches(row: Row, where: Prisma.JobWhereInput): boolean {
    return Object.entries(where).every(([key, condition]) => {
        if (key === 'AND') return (condition as Prisma.JobWhereInput[]).every((branch) => matches(row, branch));
        if (key === 'OR') return (condition as Prisma.JobWhereInput[]).some((branch) => matches(row, branch));
        const value = row[key as keyof Row] as number | null;
        if (condition === null) return value === null;
        const { gte, lte } = condition as { gte?: number; lte?: number };
        if (value === null) return false;
        if (gte !== undefined && value < gte) return false;
        if (lte !== undefined && value > lte) return false;
        return true;
    });
}

const JOBS: readonly Row[] = [
    { id: 'range-above', normalizedMinSalary: 120000, normalizedMaxSalary: 150000 },
    { id: 'range-straddles', normalizedMinSalary: 90000, normalizedMaxSalary: 110000 },
    { id: 'range-below', normalizedMinSalary: 70000, normalizedMaxSalary: 90000 },
    { id: 'single-figure', normalizedMinSalary: 130000, normalizedMaxSalary: null },
    { id: 'ceiling-only', normalizedMinSalary: null, normalizedMaxSalary: 140000 },
    { id: 'no-pay', normalizedMinSalary: null, normalizedMaxSalary: null },
];

const kept = (conditions: readonly Prisma.JobWhereInput[]): string[] =>
    JOBS.filter((job) => conditions.every((condition) => matches(job, condition))).map((job) => job.id);

describe('alertSalaryConditions', () => {
    it('keeps for a minimum exactly what the /jobs salary filter keeps', () => {
        const board = kept([salaryClause(100000)!]);
        expect(kept(alertSalaryConditions({ minSalary: 100000 }))).toEqual(board);
        expect(board).toEqual(['range-above', 'range-straddles', 'single-figure', 'ceiling-only']);
    });

    it('keeps a single-figure posting the old digest rule dropped, and drops a job with no pay', () => {
        const ids = kept(alertSalaryConditions({ minSalary: 100000 }));
        expect(ids).toContain('single-figure');
        expect(ids).not.toContain('no-pay');
    });

    it('adds no salary condition when the alert has no salary', () => {
        expect(alertSalaryConditions({})).toEqual([]);
        expect(alertSalaryConditions({ minSalary: null, maxSalary: null })).toEqual([]);
    });

    it('keeps the maximum rule as it was: a low figure at or under it, or no pay', () => {
        expect(kept(alertSalaryConditions({ maxSalary: 100000 }))).toEqual(['range-straddles', 'range-below', 'no-pay']);
    });
});
