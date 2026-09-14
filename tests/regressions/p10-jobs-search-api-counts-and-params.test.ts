/**
 * P10 jobs-search-api regressions.
 *
 *  #1 filter-counts ran ~21 COUNT queries through a two-connection pool
 *     (12 to 19 s). It now fetches the facet-free rows once and tallies in
 *     memory with lib/filters.ts's own facet clauses. These tests pin that the
 *     tally equals the old per-facet COUNT formula (brute-forced here with the
 *     same evaluator over fixture rows), including the DB id-set path.
 *  #3 physician-specialty titles with a NULL professionClass leaked.
 *  #4 zero-result hint formatting / parsing.
 *  #5 /api/jobs page/limit garbage reached Prisma as NaN / negative skip.
 *  #6 malformed JSON to filter-counts answered 500.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';

vi.mock('@/lib/rate-limit', () => ({
  rateLimit: vi.fn(async () => null),
  RATE_LIMITS: { general: { limit: 1000, windowSeconds: 60 } },
}));

import { prisma } from '@/lib/prisma';
import {
  buildWhereClause,
  newGradWhereClause,
  minYearsQualifyClause,
  freshnessClause,
  anySalaryClause,
  salaryClause,
  telehealthSpecialtyClause,
  travelSpecialtyClause,
} from '@/lib/filters';
import { DEFAULT_FILTERS, type FilterCounts, type FilterState } from '@/types/filters';
import {
  COUNT_ROW_COLUMNS,
  computeFilterCounts,
  normalizeFilterCountsBody,
  planFilterCounts,
  tallyFilterCounts,
} from '@/app/api/jobs/filter-counts/compute-counts';
import { isMemoryEvaluable, matchesWhere, type MemoryRow } from '@/app/api/jobs/filter-counts/where-evaluator';
import { parsePagination } from '@/app/api/jobs/pagination';
import { formatZeroResultHint, readZeroResultHint } from '@/components/jobs/zero-result-hint';

const NOW = new Date('2026-09-13T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000);

let seq = 0;
function job(overrides: Partial<MemoryRow>): MemoryRow {
  seq += 1;
  return {
    id: `job-${seq}`,
    title: 'Psychiatric Nurse Practitioner',
    description: 'Outpatient psychiatry clinic.',
    employer: 'Mind Clinic',
    isPublished: true,
    professionClass: null,
    isRemote: false,
    isHybrid: false,
    jobType: 'Full-Time',
    normalizedMinSalary: null,
    normalizedMaxSalary: null,
    createdAt: daysAgo(10),
    originalPostedAt: daysAgo(10),
    experienceLevel: null,
    minYearsExperience: null,
    newGradFriendly: false,
    categoryTags: [],
    state: 'Texas',
    stateCode: 'TX',
    city: 'Austin',
    location: 'Austin, TX',
    ...overrides,
  };
}

const FIXTURE: MemoryRow[] = [
  job({ isRemote: true, jobType: 'Full-Time', normalizedMinSalary: 160000, originalPostedAt: daysAgo(1), createdAt: daysAgo(0.5) }),
  job({ isRemote: true, jobType: 'Part-Time', title: 'Telehealth PMHNP', minYearsExperience: 2 }),
  job({ isHybrid: true, jobType: null, description: 'Mix of telemedicine and in person', normalizedMaxSalary: 210000 }),
  job({ jobType: 'Contract', title: 'Travel Locum PMHNP', experienceLevel: 'Senior', minYearsExperience: 5 }),
  job({ jobType: 'Per Diem', title: 'New Grad PMHNP', newGradFriendly: true, originalPostedAt: null }),
  job({ isRemote: true, jobType: 'Full-Time', minYearsExperience: 0, experienceLevel: 'New Grad', state: 'California', stateCode: 'CA' }),
  job({ jobType: 'Full-Time', categoryTags: ['acute-care'], normalizedMinSalary: 120000, originalPostedAt: daysAgo(5) }),
  job({ title: 'PMHNP Director', minYearsExperience: 7, experienceLevel: 'Mid-Level', originalPostedAt: daysAgo(40) }),
  job({ isRemote: true, isHybrid: true, jobType: 'Full-Time', normalizedMinSalary: 100000, normalizedMaxSalary: 150000 }),
  job({ title: 'Obstetrician/Gynecologist- Hospitalist', professionClass: null }),
  job({ title: 'Remote PMHNP', employer: 'Other Co', isRemote: false }),
];

const ALL_COLUMNS: ReadonlySet<string> = new Set(Object.keys(FIXTURE[0]));
const rowsMatching = (where: Prisma.JobWhereInput) => {
  expect(isMemoryEvaluable(where, ALL_COLUMNS)).toBe(true);
  return FIXTURE.filter((row) => matchesWhere(where, row));
};
const count = (where: Prisma.JobWhereInput) => rowsMatching(where).length;

/** The pre-P10 route's formula: one COUNT per badge over per-facet bases. */
function bruteForceCounts(filters: FilterState): FilterCounts {
  const B = (f: FilterState) => buildWhereClause(f);
  const A = (a: Prisma.JobWhereInput, b: Prisma.JobWhereInput): Prisma.JobWhereInput => ({ AND: [a, b] });
  const wm = B({ ...filters, workMode: [] });
  const jt = rowsMatching(B({ ...filters, jobType: [] }));
  const sal = B({ ...filters, salaryMin: null });
  const po = B({ ...filters, postedWithin: null });
  const sp = B({ ...filters, specialty: [] });
  const el = rowsMatching(B({ ...filters, experienceLevel: [] }));
  const ng = B({ ...filters, newGradFriendly: null });
  const my = B({ ...filters, minYearsExperience: null });
  const byType = (t: string | null) => jt.filter((r) => r.jobType === t).length;
  const byLevel = (l: string) => el.filter((r) => r.experienceLevel === l).length;
  return {
    workMode: {
      remote: count(A(wm, { isRemote: true })),
      hybrid: count(A(wm, { isHybrid: true })),
      onsite: count(A(wm, { isRemote: false, isHybrid: false })),
    },
    jobType: { 'Full-Time': byType('Full-Time'), 'Part-Time': byType('Part-Time'), 'Contract': byType('Contract'), 'Per Diem': byType('Per Diem'), 'Other': byType(null) },
    salary: {
      any: count(A(sal, anySalaryClause())),
      over100k: count(A(sal, salaryClause(100000)!)),
      over150k: count(A(sal, salaryClause(150000)!)),
      over200k: count(A(sal, salaryClause(200000)!)),
    },
    postedWithin: {
      '24h': count(A(po, freshnessClause(NOW, '24h'))),
      '3d': count(A(po, freshnessClause(NOW, '3d'))),
      '7d': count(A(po, freshnessClause(NOW, '7d'))),
      '30d': count(A(po, freshnessClause(NOW, '30d'))),
    },
    specialty: { Telehealth: count(A(sp, telehealthSpecialtyClause())), Travel: count(A(sp, travelSpecialtyClause())) },
    experienceLevel: { 'New Grad': byLevel('New Grad'), 'Mid-Level': byLevel('Mid-Level'), 'Senior': byLevel('Senior') },
    newGradFriendly: count(A(ng, newGradWhereClause())),
    minYears: { 1: count(A(my, minYearsQualifyClause(1))), 2: count(A(my, minYearsQualifyClause(2))), 5: count(A(my, minYearsQualifyClause(5))) },
    total: count(B(filters)),
  };
}

const F = (overrides: Partial<FilterState>): FilterState => ({ ...DEFAULT_FILTERS, ...overrides });

const CASES: Array<[string, FilterState]> = [
  ['no filters', F({})],
  ['remote', F({ workMode: ['remote'] })],
  ['remote + Full-Time', F({ workMode: ['remote'], jobType: ['Full-Time'] })],
  ['search work mode suppressed by explicit facet', F({ search: 'remote', workMode: ['hybrid'] })],
  ['search state + text', F({ search: 'PMHNP in Texas' })],
  ['telehealth + salary + posted', F({ specialty: ['Telehealth'], salaryMin: 150000, postedWithin: '30d' })],
  ['slug specialty + travel + new grad', F({ specialty: ['acute-care', 'Travel'], newGradFriendly: true })],
  ['min years + legacy level + Other type', F({ minYearsExperience: 2, experienceLevel: ['Senior'], jobType: ['Other', 'Contract'] })],
  ['every facet at once', F({ workMode: ['remote', 'onsite'], jobType: ['Full-Time'], salaryMin: 100000, postedWithin: '7d', specialty: ['Telehealth'], experienceLevel: ['New Grad'], newGradFriendly: true, minYearsExperience: 1 })],
];

describe('#1 filter-counts in-memory tally equals the per-facet COUNT formula', () => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });

  it('fixture is non-trivial', () => {
    const all = bruteForceCounts(F({}));
    expect(all.total).toBe(FIXTURE.length - 1); // only the OB/GYN row is excluded
    expect(all.workMode.remote).toBeGreaterThan(1);
    expect(all.specialty.Telehealth).toBe(2);
    expect(bruteForceCounts(F({ workMode: ['remote'], jobType: ['Full-Time'] })).total).toBe(3);
  });

  it.each(CASES)('%s (all clauses in memory)', (_name, filters) => {
    const plan = planFilterCounts(filters, NOW);
    const base = rowsMatching(plan.baseWhere);
    expect(tallyFilterCounts(base, plan)).toEqual(bruteForceCounts(filters));
  });

  it.each(CASES)('%s (description and tag clauses resolved through id sets)', async (_name, filters) => {
    const plan = planFilterCounts(filters, NOW);
    const findIds = vi.fn(async (where: Prisma.JobWhereInput) => rowsMatching(where).map((r) => r.id));
    const findRows = vi.fn(async (where: Prisma.JobWhereInput) =>
      // Strip columns the real SELECT does not fetch, so an id-set miss would show.
      rowsMatching(where).map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => COUNT_ROW_COLUMNS.has(k))) as MemoryRow),
    );
    const counts = await computeFilterCounts(filters, { findRows, findIds }, NOW);
    expect(counts).toEqual(bruteForceCounts(filters));
    expect(findRows).toHaveBeenCalledTimes(1);
    expect(findIds).toHaveBeenCalledTimes(plan.dbClauses.length);
    // The Telehealth badge reads `description`, which the row SELECT omits.
    expect(plan.dbClauses).toContain(plan.options.telehealth);
    // Query budget: one row fetch plus a handful of id lookups, not ~21 COUNTs.
    expect(plan.dbClauses.length).toBeLessThanOrEqual(3);
  });
});

describe('#1 where-evaluator follows SQL three-valued logic', () => {
  const row = { id: 'r', minYearsExperience: null, jobType: 'Full-Time', title: 'Senior PMHNP', tags: ['a'] } as MemoryRow;
  const cols = new Set(['minYearsExperience', 'jobType', 'title', 'tags']);

  it('treats comparisons against NULL as UNKNOWN, including under NOT', () => {
    expect(matchesWhere({ minYearsExperience: { lte: 5 } }, row)).toBe(false);
    expect(matchesWhere({ NOT: { minYearsExperience: { lte: 5 } } }, row)).toBe(false);
    expect(matchesWhere({ minYearsExperience: null }, row)).toBe(true);
    expect(matchesWhere({ OR: [{ minYearsExperience: { lte: 5 } }, { jobType: 'Full-Time' }] }, row)).toBe(true);
    expect(matchesWhere({ OR: [] }, row)).toBe(false);
    expect(matchesWhere({ AND: [] }, row)).toBe(true);
  });

  it('matches insensitive contains, in, has', () => {
    expect(matchesWhere({ title: { contains: 'senior pmhnp', mode: 'insensitive' } }, row)).toBe(true);
    expect(matchesWhere({ title: { contains: 'senior pmhnp' } }, row)).toBe(false);
    expect(matchesWhere({ jobType: { in: ['Contract', 'Full-Time'] } }, row)).toBe(true);
    expect(matchesWhere({ tags: { has: 'a' } }, row)).toBe(true);
  });

  it('refuses shapes it does not model so they go to the database', () => {
    expect(isMemoryEvaluable({ description: { contains: 'x' } }, cols)).toBe(false);
    expect(isMemoryEvaluable({ jobType: { not: 'Full-Time' } }, cols)).toBe(false);
    expect(isMemoryEvaluable({ company: { is: null } }, cols)).toBe(false);
    expect(isMemoryEvaluable({ title: { search: 'x' } }, cols)).toBe(false);
    expect(isMemoryEvaluable({ jobType: { not: null } }, cols)).toBe(true);
  });
});

describe('#6 filter-counts body handling', () => {
  beforeEach(() => vi.mocked(prisma.job.findMany).mockReset());

  const post = (body: string) =>
    new NextRequest('http://localhost:3000/api/jobs/filter-counts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body,
    });

  it('answers 400 for malformed JSON and non-object bodies without touching the database', async () => {
    const { POST } = await import('@/app/api/jobs/filter-counts/route');
    for (const body of ['{not json', '[1,2]', '"text"', 'null']) {
      const res = await POST(post(body));
      expect(res.status, body).toBe(400);
    }
    expect(prisma.job.findMany).not.toHaveBeenCalled();
  });

  it('answers 200 for wrong-typed fields by treating them as inactive', async () => {
    const { POST } = await import('@/app/api/jobs/filter-counts/route');
    vi.mocked(prisma.job.findMany).mockResolvedValue([] as never);
    const res = await POST(post(JSON.stringify({ page: 'abc', salaryMin: 'x', workMode: 42, minYearsExperience: '3' })));
    expect(res.status).toBe(200);
    expect(((await res.json()) as FilterCounts).total).toBe(0);
  });

  it('normalizes untrusted fields', () => {
    expect(normalizeFilterCountsBody(null)).toBeNull();
    expect(normalizeFilterCountsBody([])).toBeNull();
    const n = normalizeFilterCountsBody({ salaryMin: 'x', workMode: ['remote', 7], search: 5, newGradFriendly: 'true', minYearsExperience: -1, postedWithin: '7d' })!;
    expect(n.salaryMin).toBeNull();
    expect(n.workMode).toEqual(['remote']);
    expect(n.search).toBe('');
    expect(n.newGradFriendly).toBeNull();
    expect(n.minYearsExperience).toBeNull();
    expect(n.postedWithin).toBe('7d');
    expect(normalizeFilterCountsBody({ salaryMin: '150000', minYearsExperience: 2 })).toMatchObject({ salaryMin: 150000, minYearsExperience: 2 });
  });
});

describe('#3 physician-specialty titles on unclassified rows are excluded', () => {
  const visible = (title: string, professionClass: string | null = null) =>
    matchesWhere(buildWhereClause(F({})), job({ title, professionClass }));

  it('hides physician-only specialty titles', () => {
    expect(visible('Obstetrician/Gynecologist- Hospitalist')).toBe(false);
    expect(visible('Anesthesiologist')).toBe(false);
    expect(visible('Radiologist, Remote')).toBe(false);
  });

  it('keeps NP roles that name the specialty and classified rows', () => {
    expect(visible('Nurse Practitioner, OB/GYN Hospitalist')).toBe(true);
    expect(visible('APRN supporting Gynecologist practice')).toBe(true);
    expect(visible('CRNA with Anesthesiologist team')).toBe(true);
    expect(visible('Psychiatric Nurse Practitioner')).toBe(true);
    expect(visible('Obstetrician/Gynecologist- Hospitalist', 'np_eligible')).toBe(true);
  });
});

describe('#5 /api/jobs pagination parsing', () => {
  const p = (qs: string) => parsePagination(new URLSearchParams(qs));

  it('clamps garbage to page 1 and the default limit', () => {
    for (const qs of ['page=abc&limit=1', 'page=0&limit=1', 'page=-1&limit=1', 'page=1.5&limit=1']) {
      expect(p(qs), qs).toEqual({ page: 1, limit: 1 });
    }
    expect(p('limit=abc')).toEqual({ page: 1, limit: 20 });
    expect(p('limit=-5')).toEqual({ page: 1, limit: 20 });
    expect(p('limit=100000')).toEqual({ page: 1, limit: 50 });
    expect(p('page=99999&limit=1')).toEqual({ page: 99999, limit: 1 });
    expect(p('page=1e9')).toEqual({ page: 1, limit: 20 });
    expect(p('page=9999999999999')).toEqual({ page: 100000, limit: 20 });
  });
});

describe('#4 zero-result hint', () => {
  it('reads only well-formed hints and formats them without dashes', () => {
    const hint = readZeroResultHint({ zeroResultHint: { removedConstraint: 'text', removedLabel: 'text "zzqxv"', availableCount: 1234 } });
    expect(hint).not.toBeNull();
    const sentence = formatZeroResultHint(hint!);
    expect(sentence).toBe('Removing text "zzqxv" from your search shows 1,234 jobs.');
    expect(sentence).not.toMatch(/[‒-―-]/);
    expect(formatZeroResultHint({ ...hint!, availableCount: 1 })).toMatch(/shows 1 job\.$/);
    expect(readZeroResultHint(undefined)).toBeNull();
    expect(readZeroResultHint({ zeroResultHint: { removedConstraint: 'text', removedLabel: 'x', availableCount: 0 } })).toBeNull();
    expect(readZeroResultHint({ zeroResultHint: { removedConstraint: 'other', removedLabel: 'x', availableCount: 3 } })).toBeNull();
  });
});
