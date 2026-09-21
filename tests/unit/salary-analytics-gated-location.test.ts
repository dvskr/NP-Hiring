/**
 * The gated location salary helpers in lib/salary-analytics.ts (PLAN C.3):
 * n of 5 or more postings from 3 or more employers, or no figure at all.
 * Prisma is the global mock from tests/setup.ts; every case feeds
 * prisma.job.findMany a fixture and checks the verdict, the counts and the
 * predicate the query was composed with.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import {
  summarizeGatedSalary,
  getGatedLocationSalary,
  getGatedCitySalaries,
  getGatedBenchmarkRows,
  getPublishableSalaryGuideStates,
  type GatedSalary,
} from '@/lib/salary-analytics';
import { CONTRACT_CADENCE_PERIODS, SALARY_ANALYTICS_MIN_CONFIDENCE } from '@/lib/salary-utils';

interface FixtureRow {
  state: string | null;
  city?: string | null;
  employer: string | null;
  title: string | null;
  normalizedMinSalary: number | null;
  normalizedMaxSalary: number | null;
}

function row(employer: string | null, min: number, overrides: Partial<FixtureRow> = {}): FixtureRow {
  return {
    state: 'Texas',
    employer,
    title: 'Nurse Practitioner',
    normalizedMinSalary: min,
    normalizedMaxSalary: min,
    ...overrides,
  };
}

/** Five postings from three employers, midpoints 100k to 140k. */
const GATED_ROWS: FixtureRow[] = [
  row('Alpha Health', 100_000),
  row('Alpha Health', 110_000),
  row('Beta Clinic', 120_000),
  row('Gamma Care', 130_000),
  row('Gamma Care', 140_000),
];

const findMany = vi.mocked(prisma.job.findMany);

function mockRows(rows: FixtureRow[]): void {
  findMany.mockResolvedValueOnce(rows as never);
}

function expectBelowGate(result: GatedSalary): void {
  expect(result.gatePassed).toBe(false);
  expect(result.median).toBeNull();
  expect(result.p25).toBeNull();
  expect(result.p75).toBeNull();
  expect(result.medianK).toBeNull();
  expect(result.p25K).toBeNull();
  expect(result.p75K).toBeNull();
}

beforeEach(() => {
  findMany.mockReset();
});

describe('summarizeGatedSalary (pure)', () => {
  it('4 postings from 4 employers is below the gate with null figures', () => {
    const result = summarizeGatedSalary([
      row('A', 100_000), row('B', 110_000), row('C', 120_000), row('D', 130_000),
    ]);
    expect(result.postings).toBe(4);
    expect(result.employers).toBe(4);
    expectBelowGate(result);
  });

  it('5 postings from 2 employers is below the gate with null figures', () => {
    const result = summarizeGatedSalary([
      row('A', 100_000), row('A', 110_000), row('A', 120_000), row('B', 130_000), row('B', 140_000),
    ]);
    expect(result.postings).toBe(5);
    expect(result.employers).toBe(2);
    expectBelowGate(result);
  });

  it('5 postings from 3 employers passes with a true median and quartiles in dollars and $k', () => {
    const result = summarizeGatedSalary(GATED_ROWS);
    expect(result).toEqual<GatedSalary>({
      postings: 5,
      employers: 3,
      gatePassed: true,
      median: 120_000,
      p25: 110_000,
      p75: 130_000,
      medianK: 120,
      p25K: 110,
      p75K: 130,
    });
  });

  it('rounds $k to the nearest thousand from a range midpoint', () => {
    const result = summarizeGatedSalary([
      ...GATED_ROWS.slice(0, 2),
      row('Beta Clinic', 120_000, { normalizedMaxSalary: 122_500 }),
      ...GATED_ROWS.slice(3),
    ]);
    // Midpoints 100k, 110k, 121.25k, 130k, 140k: median 121,250 -> 121.
    expect(result.median).toBe(121_250);
    expect(result.medianK).toBe(121);
    expect(result.p75K).toBe(130);
  });

  it('rows without an employer or with a non-positive minimum never enter the sample', () => {
    const result = summarizeGatedSalary([
      ...GATED_ROWS,
      row(null, 200_000),
      row('Delta', 0),
      row('Delta', -5),
    ]);
    expect(result.postings).toBe(5);
    expect(result.employers).toBe(3);
    expect(result.median).toBe(120_000);
  });

  it('stateless rows count toward a sub-pool figure', () => {
    const result = summarizeGatedSalary(GATED_ROWS.map((r) => ({ ...r, state: null })));
    expect(result.gatePassed).toBe(true);
    expect(result.postings).toBe(5);
  });
});

describe('getGatedLocationSalary', () => {
  it('returns gatePassed:false at 4 postings', async () => {
    mockRows(GATED_ROWS.slice(0, 4));
    const result = await getGatedLocationSalary({ state: 'Texas' });
    expect(result.postings).toBe(4);
    expectBelowGate(result);
  });

  it('returns gatePassed:false at 5 postings from 2 employers', async () => {
    mockRows([
      row('A', 100_000), row('A', 110_000), row('A', 120_000), row('B', 130_000), row('B', 140_000),
    ]);
    const result = await getGatedLocationSalary({ state: 'Texas' });
    expect(result.employers).toBe(2);
    expectBelowGate(result);
  });

  it('returns the gated figure at 5 postings from 3 employers', async () => {
    mockRows(GATED_ROWS);
    const result = await getGatedLocationSalary({ state: 'Texas' });
    expect(result.gatePassed).toBe(true);
    expect(result.medianK).toBe(120);
  });

  it('non-NP titles are dropped before the gate is counted', async () => {
    mockRows([
      ...GATED_ROWS.slice(0, 4),
      row('Gamma Care', 140_000, { title: 'Psychiatrist' }),
    ]);
    const result = await getGatedLocationSalary({ state: 'Texas' });
    expect(result.postings).toBe(4);
    expectBelowGate(result);
  });

  it('composes the analytics pool predicate (no estimated, no contract cadence) with the scope under AND', async () => {
    mockRows([]);
    await getGatedLocationSalary({ state: 'Texas' });

    expect(findMany).toHaveBeenCalledTimes(1);
    const { where } = findMany.mock.calls[0][0] as unknown as { where: { AND: unknown[] } };
    expect(where.AND).toHaveLength(2);
    expect(where.AND[0]).toMatchObject({
      isPublished: true,
      salaryIsEstimated: false,
      salaryConfidence: { gte: SALARY_ANALYTICS_MIN_CONFIDENCE },
      normalizedMinSalary: { not: null },
    });
    const pool = where.AND[0] as { AND: Array<{ OR: unknown[] }> };
    expect(JSON.stringify(pool.AND)).toContain(JSON.stringify([...CONTRACT_CADENCE_PERIODS]));
    expect(where.AND[1]).toEqual({ state: 'Texas' });
  });

  it('an empty pool is below the gate with zero counts', async () => {
    mockRows([]);
    const result = await getGatedLocationSalary({ state: 'Wyoming' });
    expect(result.postings).toBe(0);
    expect(result.employers).toBe(0);
    expectBelowGate(result);
  });
});

describe('getGatedCitySalaries', () => {
  it('returns only the cities that clear the gate, keyed by the stored city spelling', async () => {
    mockRows([
      ...GATED_ROWS.map((r) => ({ ...r, city: 'Austin' })),
      row('Alpha Health', 150_000, { city: 'Dallas' }),
      row('Beta Clinic', 160_000, { city: 'Dallas' }),
      row('Alpha Health', 170_000, { city: ' Houston ' }),
    ]);

    const cities = await getGatedCitySalaries('Texas');

    expect([...cities.keys()]).toEqual(['Austin']);
    const austin = cities.get('Austin');
    expect(austin?.gatePassed).toBe(true);
    expect(austin?.postings).toBe(5);
    expect(austin?.employers).toBe(3);
    expect(austin?.medianK).toBe(120);
  });

  it('runs one query scoped to the state with a city, selecting the city column', async () => {
    mockRows([]);
    await getGatedCitySalaries('Texas');

    expect(findMany).toHaveBeenCalledTimes(1);
    const args = findMany.mock.calls[0][0] as unknown as { where: { AND: unknown[] }; select: Record<string, boolean> };
    expect(args.where.AND[1]).toEqual({ state: 'Texas', city: { not: null } });
    expect(args.select).toMatchObject({ city: true, employer: true, title: true, normalizedMinSalary: true });
  });

  it('a city with 5 postings from one employer stays out of the map', async () => {
    mockRows(GATED_ROWS.map((r) => ({ ...r, employer: 'Solo System', city: 'Austin' })));
    const cities = await getGatedCitySalaries('Texas');
    expect(cities.size).toBe(0);
  });
});

describe('getGatedBenchmarkRows', () => {
  it('returns only the labeled sub-pools that clear the gate, in input order', async () => {
    // One findMany per sub-pool, issued in Object.entries order.
    mockRows(GATED_ROWS);
    mockRows(GATED_ROWS.slice(0, 3));
    mockRows(GATED_ROWS.map((r) => ({ ...r, normalizedMinSalary: 200_000, normalizedMaxSalary: 200_000 })));

    const rows = await getGatedBenchmarkRows({
      'Remote': { state: 'Texas', isRemote: true },
      'Hybrid': { state: 'Texas', isHybrid: true },
      'On site': { state: 'Texas', isRemote: false, isHybrid: false },
    });

    expect(findMany).toHaveBeenCalledTimes(3);
    expect(rows.map((r) => r.label)).toEqual(['Remote', 'On site']);
    expect(rows[0]).toMatchObject({ scope: 'Remote', median: 120_000, postings: 5, employers: 3 });
    expect(rows[1]).toMatchObject({ scope: 'On site', median: 200_000 });
  });

  it('passes each sub-pool where through as the AND partner of the analytics pool', async () => {
    mockRows([]);
    await getGatedBenchmarkRows({ 'Full-time': { state: 'Texas', jobType: 'Full-time' } });
    const { where } = findMany.mock.calls[0][0] as unknown as { where: { AND: unknown[] } };
    expect(where.AND[1]).toEqual({ state: 'Texas', jobType: 'Full-time' });
  });

  it('returns an empty list when no sub-pool clears the gate', async () => {
    mockRows([]);
    mockRows(GATED_ROWS.slice(0, 2));
    const rows = await getGatedBenchmarkRows({ A: {}, B: {} });
    expect(rows).toEqual([]);
  });
});

describe('getPublishableSalaryGuideStates', () => {
  it('holds the state names that clear the gate and nothing else', async () => {
    mockRows([
      ...GATED_ROWS,
      ...GATED_ROWS.slice(0, 4).map((r) => ({ ...r, state: 'Ohio' })),
      ...GATED_ROWS.map((r) => ({ ...r, state: 'Maine', employer: 'One System' })),
    ]);

    const states = await getPublishableSalaryGuideStates();

    expect(states).toEqual(new Set(['Texas']));
  });

  it('is empty when no state clears the gate', async () => {
    mockRows(GATED_ROWS.slice(0, 4));
    expect((await getPublishableSalaryGuideStates()).size).toBe(0);
  });
});
