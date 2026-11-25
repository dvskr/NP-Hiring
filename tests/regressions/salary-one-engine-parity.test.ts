/**
 * One salary pool and one engine on every surface (salary build 2026-11,
 * spec Item 0). /reports used to run a second, looser pool (no title
 * screen, no confidence floor, hourly rows annualized), so its national
 * median could disagree with /salary-guide. Now the report, the state
 * pages' board-wide median and the hub's national row all read
 * fetchNpAnalyticsRows through the engine. Fed the same postings, they
 * print the same median, and a CRNA posting moves none of them.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { loadHiringReportSnapshot } from '@/lib/reports/queries';
import { fetchNpAnalyticsRows, getGatedLocationSalary } from '@/lib/salary-analytics';
import { summarizeBenchmarkPool } from '@/components/tools/benchmark-model';

interface FixtureRow {
    state: string | null;
    employer: string | null;
    title: string;
    professionClass: string | null;
    normalizedMinSalary: number;
    normalizedMaxSalary: number;
}

/** Twelve NP employers, one of them posting eight times. All fictional. */
const NP_ROWS: FixtureRow[] = [
    ...Array.from({ length: 12 }, (_, i) => ({
        state: i % 2 === 0 ? 'Texas' : 'Ohio',
        employer: `Clinic ${i + 1}`,
        title: 'Family Nurse Practitioner',
        professionClass: i % 3 === 0 ? null : 'np_eligible',
        normalizedMinSalary: 100_000 + i * 3_000,
        normalizedMaxSalary: 120_000 + i * 3_000,
    })),
    ...Array.from({ length: 8 }, () => ({
        state: 'Texas',
        employer: 'Clinic 1',
        title: 'Nurse Practitioner',
        professionClass: 'np_eligible',
        normalizedMinSalary: 100_000,
        normalizedMaxSalary: 120_000,
    })),
];

/** CRNA pay, classified and unclassified: never inside an NP figure. */
const CRNA_ROWS: FixtureRow[] = Array.from({ length: 6 }, (_, i) => ({
    state: 'Texas',
    employer: `Anesthesia Group ${i + 1}`,
    title: i % 2 === 0 ? 'CRNA' : 'Certified Registered Nurse Anesthetist',
    professionClass: i % 2 === 0 ? 'aprn_crna' : null,
    normalizedMinSalary: 220_000,
    normalizedMaxSalary: 260_000,
}));

function feed(rows: FixtureRow[]) {
    // The salary pool is the only findMany the report and the analytics read.
    vi.mocked(prisma.job.findMany).mockResolvedValue(rows as never);
    vi.mocked(prisma.job.count).mockResolvedValue(0 as never);
    vi.mocked(prisma.job.groupBy).mockResolvedValue([] as never);
}

describe('one salary engine across /reports, /salary-guide and the state pages', () => {
    beforeEach(() => vi.clearAllMocks());

    it('the report national median equals the pool national median and the state pages\' board median', async () => {
        feed(NP_ROWS);
        const report = await loadHiringReportSnapshot();
        const pool = summarizeBenchmarkPool(await fetchNpAnalyticsRows());
        const board = await getGatedLocationSalary();

        expect(report?.salary.national).not.toBeNull();
        expect(report?.salary.national?.median).toBe(pool.national?.median);
        expect(board.median).toBe(pool.national?.median);
        // n is employers: Clinic 1's eight extra postings add nothing.
        expect(report?.salary.national?.employers).toBe(12);
        expect(report?.salary.national?.tier).toBe('full');
    });

    it('CRNA postings, classified or not, move no NP figure on either surface', async () => {
        feed(NP_ROWS);
        const before = (await loadHiringReportSnapshot())?.salary.national?.median;
        feed([...NP_ROWS, ...CRNA_ROWS]);
        const after = await loadHiringReportSnapshot();
        const board = await getGatedLocationSalary();
        expect(after?.salary.national?.median).toBe(before);
        expect(after?.salary.national?.employers).toBe(12);
        expect(board.median).toBe(before);
    });

    it('both surfaces query the same composed pool predicate', async () => {
        // Each call stamps its own "now" into the expiry clauses.
        const stable = (where: unknown) => JSON.stringify(where).replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, 'NOW');
        feed(NP_ROWS);
        await loadHiringReportSnapshot();
        const reportWhere = stable(vi.mocked(prisma.job.findMany).mock.calls[0][0]?.where);
        vi.mocked(prisma.job.findMany).mockClear();
        await getGatedLocationSalary();
        const pageWhere = stable(vi.mocked(prisma.job.findMany).mock.calls[0][0]?.where);
        // The page composes `{}` as its extra scope, the report the same.
        expect(reportWhere).toBe(pageWhere);
        for (const clause of ['healthConsecutiveMissing', 'salaryConfidence', 'salaryPeriod', 'normalizedMaxSalary', 'professionClass']) {
            expect(reportWhere).toContain(clause);
        }
    });
});
