/**
 * P10 jobs-search-api regressions.
 *
 *  #1 filter-counts ran ~21 COUNT queries through a two-connection pool
 *     (12 to 19 s). It now fetches the facet-free rows once and tallies in
 *     memory with lib/filters.ts's own facet clauses. These tests pin that the
 *     tally equals the old per-facet COUNT formula (brute-forced here with the
 *     same evaluator over fixture rows), including the DB id-set path.
 *     Since 2026-11-19 it also counts each registry specialty and each
 *     employer type: the sidebar showed those two sections without numbers
 *     because the route never reported them.
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
  recruitmentTypeClause,
  specialtyClause,
  telehealthSpecialtyClause,
  travelSpecialtyClause,
  SPECIALTY_FILTER_OPTIONS,
  type RecruitmentFilterState,
} from '@/lib/filters';
import { DEFAULT_FILTERS, type FilterCounts } from '@/types/filters';
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
    // A non-null column (default 0): /jobs search reads the dead-link gate.
    healthConsecutiveMissing: 0,
    // The linked company as the counts SELECT loads it: null = no company.
    company: null,
    ...overrides,
  };
}

const DIRECT = { recruitmentType: 'direct_hire' };
const STAFFING = { recruitmentType: 'staffing_agency' };
const UNCLASSIFIED = { recruitmentType: null };

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
  // Employer types and registry specialties: tagged rows match by tag,
  // untagged rows through the title keywords of the legacy arm.
  job({ title: 'Family Nurse Practitioner', company: DIRECT, isRemote: true, jobType: 'Contract' }),
  job({ title: 'Nurse Practitioner', categoryTags: ['family-practice'], company: DIRECT, jobType: 'Part-Time' }),
  job({ title: 'Pediatric Nurse Practitioner', company: STAFFING, normalizedMinSalary: 130000 }),
  job({ title: 'Nurse Practitioner (FNP) Urgent Care', categoryTags: ['urgent-care'], company: UNCLASSIFIED }),
  job({ title: 'Cardiology NP', categoryTags: ['cardiology'], company: STAFFING, isHybrid: true, newGradFriendly: true }),
  job({ title: 'Dermatology Nurse Practitioner', company: UNCLASSIFIED, originalPostedAt: daysAgo(2) }),
];

const ALL_COLUMNS: ReadonlySet<string> = new Set([...Object.keys(FIXTURE[0]), 'company.recruitmentType']);
const rowsMatching = (where: Prisma.JobWhereInput) => {
  expect(isMemoryEvaluable(where, ALL_COLUMNS)).toBe(true);
  return FIXTURE.filter((row) => matchesWhere(where, row));
};
const count = (where: Prisma.JobWhereInput) => rowsMatching(where).length;

/** The pre-P10 route's formula: one COUNT per badge over per-facet bases. */
function bruteForceCounts(filters: RecruitmentFilterState): FilterCounts {
  const B = (f: RecruitmentFilterState) => buildWhereClause(f);
  const A = (a: Prisma.JobWhereInput, b: Prisma.JobWhereInput): Prisma.JobWhereInput => ({ AND: [a, b] });
  const wm = B({ ...filters, workMode: [] });
  const jt = rowsMatching(B({ ...filters, jobType: [] }));
  const sal = B({ ...filters, salaryMin: null });
  const po = B({ ...filters, postedWithin: null });
  const sp = B({ ...filters, specialty: [] });
  const el = rowsMatching(B({ ...filters, experienceLevel: [] }));
  const ng = B({ ...filters, newGradFriendly: null });
  const my = B({ ...filters, minYearsExperience: null });
  const rt = B({ ...filters, recruitmentType: null });
  const bySpecialty = Object.fromEntries(
    SPECIALTY_FILTER_OPTIONS.map(({ value }) => [value, count(A(sp, specialtyClause([value])!))]),
  );
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
    specialty: {
      Telehealth: count(A(sp, telehealthSpecialtyClause())),
      Travel: count(A(sp, travelSpecialtyClause())),
      ...bySpecialty,
    },
    experienceLevel: { 'New Grad': byLevel('New Grad'), 'Mid-Level': byLevel('Mid-Level'), 'Senior': byLevel('Senior') },
    newGradFriendly: count(A(ng, newGradWhereClause())),
    minYears: { 1: count(A(my, minYearsQualifyClause(1))), 2: count(A(my, minYearsQualifyClause(2))), 5: count(A(my, minYearsQualifyClause(5))) },
    recruitmentType: {
      direct_hire: count(A(rt, recruitmentTypeClause('direct_hire'))),
      staffing_agency: count(A(rt, recruitmentTypeClause('staffing_agency'))),
      unclassified: count(A(rt, recruitmentTypeClause('unclassified'))),
    },
    total: count(B(filters)),
  };
}

const F = (overrides: Partial<RecruitmentFilterState>): RecruitmentFilterState => ({ ...DEFAULT_FILTERS, ...overrides });

describe('the /jobs base where drops dead links (EDGE-CRONS handoff 20)', () => {
  it('a row at the dead-link threshold is not counted; one miss short of it is', () => {
    const where = buildWhereClause(F({}));
    expect(isMemoryEvaluable(where, ALL_COLUMNS)).toBe(true);
    expect(matchesWhere(where, job({ healthConsecutiveMissing: 5 }))).toBe(false);
    expect(matchesWhere(where, job({ healthConsecutiveMissing: 4 }))).toBe(true);
  });
});

const CASES: Array<[string, RecruitmentFilterState]> = [
  ['no filters', F({})],
  ['remote', F({ workMode: ['remote'] })],
  ['remote + Full-Time', F({ workMode: ['remote'], jobType: ['Full-Time'] })],
  ['search work mode suppressed by explicit facet', F({ search: 'remote', workMode: ['hybrid'] })],
  ['search state + text', F({ search: 'PMHNP in Texas' })],
  ['telehealth + salary + posted', F({ specialty: ['Telehealth'], salaryMin: 150000, postedWithin: '30d' })],
  ['slug specialty + travel + new grad', F({ specialty: ['acute-care', 'Travel'], newGradFriendly: true })],
  ['min years + legacy level + Other type', F({ minYearsExperience: 2, experienceLevel: ['Senior'], jobType: ['Other', 'Contract'] })],
  ['every facet at once', F({ workMode: ['remote', 'onsite'], jobType: ['Full-Time'], salaryMin: 100000, postedWithin: '7d', specialty: ['Telehealth'], experienceLevel: ['New Grad'], newGradFriendly: true, minYearsExperience: 1 })],
  ['registry specialties', F({ specialty: ['family-practice', 'pediatric'] })],
  ['employer type: direct', F({ recruitmentType: 'direct_hire' })],
  ['employer type: unclassified + specialty + remote', F({ recruitmentType: 'unclassified', specialty: ['dermatology', 'Telehealth'], workMode: ['remote', 'onsite'] })],
];

describe('#1 filter-counts in-memory tally equals the per-facet COUNT formula', () => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });

  it('fixture is non-trivial', () => {
    const all = bruteForceCounts(F({}));
    expect(all.total).toBe(FIXTURE.length - 1); // only the OB/GYN row is excluded
    expect(all.workMode.remote).toBeGreaterThan(1);
    // CQ-05 / fixSoon 11: Telehealth is the telehealth category predicate, a
    // telehealth title on a FULLY remote job, never a description keyword:
    // the hybrid "Mix of telemedicine and in person" row no longer counts.
    expect(all.specialty.Telehealth).toBe(1);
    expect(bruteForceCounts(F({ workMode: ['remote'], jobType: ['Full-Time'] })).total).toBe(3);
    // One tagged row and one untagged FNP title each; the "(FNP) Urgent
    // Care" row is tagged urgent-care only, so its title keyword does not
    // count (the legacy arm reads untagged rows alone).
    expect(all.specialty['family-practice']).toBe(2);
    expect(all.specialty.pediatric).toBe(1);
    expect(all.specialty.cardiology).toBe(1);
    expect(all.specialty.oncology).toBe(0);
    expect(all.recruitmentType).toEqual({ direct_hire: 2, staffing_agency: 2, unclassified: all.total - 4 });
  });

  it('counts every registry specialty in memory, from the title and the stored tags', () => {
    const plan = planFilterCounts(F({}), NOW);
    expect(Object.keys(plan.specialtyOptions).sort()).toEqual(SPECIALTY_FILTER_OPTIONS.map((o) => o.value).sort());
    for (const [slug, clause] of Object.entries(plan.specialtyOptions)) {
      expect(isMemoryEvaluable(clause, COUNT_ROW_COLUMNS), slug).toBe(true);
    }
    for (const clause of Object.values(plan.recruitmentOptions)) {
      expect(isMemoryEvaluable(clause, COUNT_ROW_COLUMNS)).toBe(true);
    }
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
    // The Telehealth badge no longer reads `description` (CQ-05): it tallies
    // in memory from title, tags and the work mode like every other badge.
    expect(plan.dbClauses).not.toContain(plan.options.telehealth);
    expect(plan.dbClauses).not.toContain(plan.options.travel);
    // Query budget: one row fetch, with no id lookup for the 17 specialty
    // badges or the employer-type badges (they read the title, the tags and
    // the company the row SELECT already loads), never ~21 COUNTs.
    for (const clause of [...Object.values(plan.specialtyOptions), ...Object.values(plan.recruitmentOptions)]) {
      expect(plan.dbClauses).not.toContain(clause);
    }
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

  it('evaluates a company relation filter against the company the row carries', () => {
    const withCompany = new Set(['company', 'company.recruitmentType']);
    const direct = { company: { is: { recruitmentType: 'direct_hire' } } };
    const noCompany = { company: { is: null } };
    const unclassified = { company: { is: { recruitmentType: null } } };
    for (const clause of [direct, noCompany, unclassified, recruitmentTypeClause('unclassified')]) {
      expect(isMemoryEvaluable(clause, withCompany)).toBe(true);
    }
    const none = { id: 'a', company: null } as MemoryRow;
    const unset = { id: 'b', company: { recruitmentType: null } } as MemoryRow;
    const hire = { id: 'c', company: { recruitmentType: 'direct_hire' } } as MemoryRow;
    expect([none, unset, hire].map((r) => matchesWhere(direct, r))).toEqual([false, false, true]);
    expect([none, unset, hire].map((r) => matchesWhere(noCompany, r))).toEqual([true, false, false]);
    expect([none, unset, hire].map((r) => matchesWhere(unclassified, r))).toEqual([false, true, false]);
    expect([none, unset, hire].map((r) => matchesWhere(recruitmentTypeClause('unclassified'), r))).toEqual([true, true, false]);
  });

  it('leaves relation filters it cannot model to the database', () => {
    const withCompany = new Set(['company', 'company.recruitmentType']);
    // Under NOT, SQL's answer for a job with no company depends on the
    // subquery Prisma writes, so the evaluator does not guess.
    expect(isMemoryEvaluable({ NOT: { company: { is: null } } }, withCompany)).toBe(false);
    expect(isMemoryEvaluable({ NOT: [{ OR: [{ company: { is: { recruitmentType: null } } }] }] }, withCompany)).toBe(false);
    expect(isMemoryEvaluable({ company: { isNot: null } }, withCompany)).toBe(false);
    expect(isMemoryEvaluable({ company: { is: { name: 'Acme' } } }, withCompany)).toBe(false);
    expect(isMemoryEvaluable({ company: { is: { recruitmentType: 'direct_hire' } } }, new Set(['company']))).toBe(false);
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

  it('keeps the employer-type filter, so the total and every badge honor it', () => {
    expect(normalizeFilterCountsBody({ recruitmentType: 'direct_hire' })!.recruitmentType).toBe('direct_hire');
    expect(normalizeFilterCountsBody({ recruitmentType: 'unclassified' })!.recruitmentType).toBe('unclassified');
    for (const bad of ['agency', 5, ['direct_hire'], null, undefined]) {
      expect(normalizeFilterCountsBody({ recruitmentType: bad })!.recruitmentType, String(bad)).toBeNull();
    }
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
