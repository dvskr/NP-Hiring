/**
 * lib/salary-analytics.ts on the salary engine (lib/salary-report/stats.ts,
 * PMHNP Hiring's rules since 2026-11-25). Invariants, not source shape:
 *
 *   - each employer counts once, at the median of the distinct ranges it
 *     advertises, however many postings it has; the n of every figure is
 *     its number of employers, and postings are context only;
 *   - tiers by employers: a median at 5, the 25th and 75th percentiles at
 *     10, no dollar figure below 5 (3 to 4 is a count only);
 *   - a missing or placeholder employer name counts as an employer of its
 *     own, never as one large anonymous employer, and aliases of one
 *     employer ("LifeStance", "LifeStance Health") count once;
 *   - the NP pool never carries CRNA, CNM or CNS pay: an unclassified row
 *     with such a title and a row the classifier put in an APRN class are
 *     both screened out before any figure is computed.
 *
 * Prisma is the global mock from tests/setup.ts; each case feeds
 * prisma.job.findMany a fixture and checks the verdict, the counts and the
 * predicate the query was composed with. All fixtures are fictional.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import {
  benchmarkRowOf,
  fetchNpAnalyticsRows,
  getGatedBenchmark,
  getGatedBenchmarkRows,
  getGatedCitySalaries,
  getGatedLocationSalary,
  getGatedMedianKForWhere,
  getGatedStateBenchmarks,
  getPublishableSalaryGuideStates,
  salaryEmployerIdentity,
  salaryPoolWhere,
  summarizeGatedSalary,
  type GatedSalary,
} from '@/lib/salary-analytics';
import {
  CONTRACT_CADENCE_PERIODS,
  NP_SALARY_ANALYTICS_SELECT,
  SALARY_ANALYTICS_MIN_CONFIDENCE,
} from '@/lib/salary-utils';
import { TIER_FULL_MIN_N, TIER_MEDIAN_MIN_N } from '@/lib/salary-report/stats';

interface FixtureRow {
  state: string | null;
  city?: string | null;
  employer: string | null;
  title: string | null;
  professionClass?: string | null;
  normalizedMinSalary: number | null;
  normalizedMaxSalary: number | null;
  salaryIsEstimated?: boolean | null;
}

const NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet', 'Kilo', 'Lima'];

function row(employer: string | null, pay: number, overrides: Partial<FixtureRow> = {}): FixtureRow {
  return {
    state: 'Texas',
    employer,
    title: 'Psychiatric Nurse Practitioner',
    professionClass: null,
    normalizedMinSalary: pay,
    normalizedMaxSalary: pay,
    ...overrides,
  };
}

/** One posting per employer: employer i advertises base + i * step. */
function spread(n: number, base = 100_000, step = 5_000, overrides: Partial<FixtureRow> = {}): FixtureRow[] {
  return Array.from({ length: n }, (_, i) => row(`Fixture ${NAMES[i]} Practice`, base + i * step, overrides));
}

const findMany = vi.mocked(prisma.job.findMany);

function mockRows(rows: FixtureRow[]): void {
  findMany.mockResolvedValueOnce(rows as never);
}

/** The where and select of the nth findMany call. */
function query(n = 0): { where: { AND: unknown[] }; select: Record<string, boolean> } {
  return findMany.mock.calls[n][0] as unknown as { where: { AND: unknown[] }; select: Record<string, boolean> };
}

function expectNoDollars(result: GatedSalary): void {
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

describe('the tiers count employers', () => {
  it('a median at 5 employers and the 25th to 75th percentile range at 10', () => {
    expect(TIER_MEDIAN_MIN_N).toBe(5);
    expect(TIER_FULL_MIN_N).toBe(10);
  });

  it('four employers is a count only, however many postings they have', () => {
    const forty = Array.from({ length: 40 }, (_, i) => row(`Fixture ${NAMES[i % 4]} Practice`, 120_000 + (i % 4) * 5_000));
    const result = summarizeGatedSalary(forty);
    expect(result).toMatchObject({ tier: 'countOnly', employers: 4, postings: 40 });
    expectNoDollars(result);
  });

  it('two employers is nothing at all', () => {
    const result = summarizeGatedSalary(spread(2));
    expect(result).toMatchObject({ tier: 'none', employers: 2 });
    expectNoDollars(result);
  });

  it('five to nine employers publish a median and no quartiles', () => {
    for (const n of [TIER_MEDIAN_MIN_N, TIER_FULL_MIN_N - 1]) {
      const result = summarizeGatedSalary(spread(n));
      expect(result).toMatchObject({ tier: 'median', gatePassed: true, employers: n, postings: n, p25: null, p75: null, p25K: null, p75K: null });
      expect(result.median).toBeGreaterThan(0);
      expect(result.medianK).toBeGreaterThan(0);
    }
    // 100k to 120k in 5k steps: the middle employer.
    expect(summarizeGatedSalary(spread(5)).median).toBe(110_000);
  });

  it('ten employers publish the 25th and 75th percentiles, on the $500 display grid, with $k from the same figure', () => {
    // 100k to 145k in 5k steps: interpolated percentiles 111,250 / 122,500 / 133,750.
    expect(summarizeGatedSalary(spread(10))).toEqual<GatedSalary>({
      postings: 10,
      employers: 10,
      tier: 'full',
      gatePassed: true,
      median: 122_500,
      p25: 111_500,
      p75: 134_000,
      medianK: 123,
      p25K: 112,
      p75K: 134,
    });
  });
});

describe('each employer counts once', () => {
  it('one employer posting the same range thirty times is one data point, not thirty', () => {
    const result = summarizeGatedSalary([
      ...Array.from({ length: 30 }, () => row('Fixture Big Network', 200_000)),
      ...spread(4),
    ]);
    // Per posting, the 200k employer would be 30 of 34 points and the median.
    expect(result).toMatchObject({ tier: 'median', employers: 5, postings: 34, median: 110_000 });
  });

  it('an employer with several distinct ranges counts at their median, a repeated range once', () => {
    const result = summarizeGatedSalary([
      row('Fixture Alpha Practice', 100_000),
      row('Fixture Alpha Practice', 140_000),
      row('Fixture Alpha Practice', 140_000),
      ...spread(4, 150_000).map((r, i) => ({ ...r, employer: `Fixture ${NAMES[i + 1]} Practice` })),
    ]);
    // Alpha sits at 120k (the median of 100k and 140k), below 150k to 165k.
    expect(result).toMatchObject({ employers: 5, postings: 7, median: 155_000 });
  });

  it('a missing or placeholder employer name counts as an employer of its own', () => {
    const result = summarizeGatedSalary([
      row('Confidential', 100_000),
      row('Confidential', 100_000),
      row('Company Not Listed', 105_000),
      row(null, 110_000),
      row('Fixture Alpha Practice', 115_000),
    ]);
    // Five employers, never "one large anonymous employer" plus one.
    expect(result).toMatchObject({ tier: 'median', employers: 5, postings: 5, median: 105_000 });
  });

  it('stateless rows count toward a sub-pool figure', () => {
    const result = summarizeGatedSalary(spread(5, 100_000, 5_000, { state: null }));
    expect(result).toMatchObject({ tier: 'median', employers: 5 });
  });
});

describe('the engine quarantine', () => {
  it('a single figure, estimated pay, a midpoint outside $50k to $500k, or a range wider than 3 to 1 never counts', () => {
    const result = summarizeGatedSalary([
      ...spread(4),
      row('Fixture Single Figure', 130_000, { normalizedMaxSalary: null }),
      row('Fixture Estimated', 130_000, { salaryIsEstimated: true }),
      row('Fixture Hourly Defect', 30_000),
      row('Fixture Annualization Defect', 900_000),
      row('Fixture Wide Range', 100_000, { normalizedMaxSalary: 400_000 }),
      row('Fixture Inverted', 150_000, { normalizedMaxSalary: 120_000 }),
    ]);
    expect(result).toMatchObject({ tier: 'countOnly', employers: 4, postings: 4 });
    expectNoDollars(result);
  });
});

describe('salaryEmployerIdentity', () => {
  it('merges the aliases of one employer and returns null for a missing or placeholder name', () => {
    expect(salaryEmployerIdentity('LifeStance')).toBe(salaryEmployerIdentity('LifeStance Health'));
    expect(salaryEmployerIdentity('LifeStance')).not.toBeNull();
    for (const name of [null, undefined, '', '   ', 'Confidential', 'Company Not Listed', 'Hiring Company']) {
      expect(salaryEmployerIdentity(name), String(name)).toBeNull();
    }
    expect(salaryEmployerIdentity('Fixture Alpha Practice')).not.toBe(salaryEmployerIdentity('Fixture Bravo Practice'));
  });
});

describe('fetchNpAnalyticsRows: the NP pool', () => {
  const NOW = new Date('2026-11-25T12:00:00Z');

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('queries salaryPoolWhere(np) AND the caller scope, selecting the screen columns', async () => {
    mockRows([]);
    await fetchNpAnalyticsRows({ state: 'Texas' });
    expect(findMany).toHaveBeenCalledTimes(1);
    const { where, select } = query();
    expect(where.AND).toHaveLength(2);
    expect(where.AND[0]).toEqual(salaryPoolWhere('np', NOW));
    expect(where.AND[1]).toEqual({ state: 'Texas' });
    expect(select).toEqual(NP_SALARY_ANALYTICS_SELECT);
    expect(select.professionClass).toBe(true);
  });

  it('the pool is the listing predicate AND the salary hygiene predicate for the NP class', () => {
    const pool = salaryPoolWhere('np', NOW) as { AND: [Record<string, unknown>, Record<string, unknown>] };
    expect(pool.AND).toHaveLength(2);
    // The listing predicate: published, live, past the dead-link check.
    expect(pool.AND[0]).toMatchObject({ isPublished: true });
    expect(pool.AND[0]).toHaveProperty('healthConsecutiveMissing');
    // The salary hygiene predicate: both bounds, employer-stated, confident,
    // annual cadence, and the NP class or an unclassified row.
    expect(pool.AND[1]).toMatchObject({
      isPublished: true,
      salaryIsEstimated: false,
      salaryConfidence: { gte: SALARY_ANALYTICS_MIN_CONFIDENCE },
      normalizedMinSalary: { not: null },
      normalizedMaxSalary: { not: null },
    });
    const hygiene = JSON.stringify(pool.AND[1]);
    expect(hygiene).toContain(JSON.stringify([...CONTRACT_CADENCE_PERIODS]));
    expect(hygiene).toContain('{"professionClass":"np_eligible"}');
    expect(hygiene).not.toContain('aprn_crna');
  });

  it('never carries a CRNA, CNM or CNS row, classified or not, and keeps an NP-classified row whatever its title', async () => {
    mockRows([
      ...spread(5),
      row('Fixture Anesthesia Group', 236_000, { title: 'CRNA, Certified Registered Nurse Anesthetist' }),
      row('Fixture Anesthesia Partners', 236_000, { title: 'Nurse Practitioner', professionClass: 'aprn_crna' }),
      row('Fixture Birth Center', 130_000, { title: 'Certified Nurse Midwife (CNM)' }),
      row('Fixture Hospital', 125_000, { title: 'Clinical Nurse Specialist' }),
      row('Fixture Psychiatry Group', 300_000, { title: 'Psychiatrist' }),
      row('Fixture Lead Practice', 128_000, { title: 'Clinical Lead', professionClass: 'np_eligible' }),
    ]);
    const rows = await fetchNpAnalyticsRows();
    expect(rows).toHaveLength(6);
    for (const kept of rows) {
      expect(kept.title, String(kept.title)).not.toMatch(/CRNA|Anesthetist|Midwife|Clinical Nurse Specialist|Psychiatrist/);
      expect(kept.professionClass).not.toBe('aprn_crna');
    }
    expect(rows.some((r) => r.title === 'Clinical Lead')).toBe(true);
  });

  it('hands over the alias-merged employer identity, and null for a placeholder', async () => {
    mockRows([row('LifeStance', 120_000), row('LifeStance Health', 130_000), row('Confidential', 140_000)]);
    const rows = await fetchNpAnalyticsRows();
    expect(rows[0].employer).toBe(rows[1].employer);
    expect(rows[0].employer).toBe(salaryEmployerIdentity('LifeStance Health'));
    expect(rows[2].employer).toBeNull();
  });
});

describe('getGatedLocationSalary', () => {
  it('counts two spellings of one employer once', async () => {
    // Five spellings, four employers: below the median tier.
    mockRows([row('LifeStance', 120_000), row('LifeStance Health', 125_000), ...spread(3)]);
    const result = await getGatedLocationSalary({ state: 'Texas' });
    expect(result).toMatchObject({ employers: 4, postings: 5, tier: 'countOnly' });
    expectNoDollars(result);
  });

  it('a CRNA posting cannot pull an NP median', async () => {
    mockRows([
      ...spread(5),
      ...Array.from({ length: 6 }, (_, i) => row(`Fixture Anesthesia ${NAMES[i]}`, 236_000, { title: 'Nurse Anesthetist (CRNA)' })),
    ]);
    const result = await getGatedLocationSalary({ state: 'Texas' });
    expect(result).toMatchObject({ employers: 5, median: 110_000, tier: 'median' });
  });

  it('two placeholder postings are two employers, not one anonymous one', async () => {
    mockRows([row('Confidential', 100_000), row('Confidential', 105_000), ...spread(3, 110_000)]);
    const result = await getGatedLocationSalary({ state: 'Texas' });
    expect(result).toMatchObject({ employers: 5, tier: 'median', median: 110_000 });
  });

  it('an empty pool has zero counts and no figure', async () => {
    mockRows([]);
    const result = await getGatedLocationSalary({ state: 'Wyoming' });
    expect(result).toMatchObject({ postings: 0, employers: 0, tier: 'none' });
    expectNoDollars(result);
  });
});

describe('benchmarkRowOf', () => {
  it('is null below the median tier and carries the tier and nullable quartiles above it', () => {
    expect(benchmarkRowOf('Texas', summarizeGatedSalary(spread(4)))).toBeNull();
    expect(benchmarkRowOf('Texas', summarizeGatedSalary(spread(5)))).toEqual({
      scope: 'Texas', tier: 'median', median: 110_000, p25: null, p75: null, postings: 5, employers: 5,
    });
    expect(benchmarkRowOf('Texas', summarizeGatedSalary(spread(10)))).toMatchObject({ tier: 'full', p25: 111_500, p75: 134_000, employers: 10 });
  });
});

describe('getGatedBenchmark and getGatedMedianKForWhere', () => {
  it('a row at the median tier, null below it; $k or 0', async () => {
    mockRows(spread(4));
    expect(await getGatedBenchmark({ state: 'Texas' })).toBeNull();
    mockRows(spread(5));
    expect(await getGatedBenchmark({ state: 'Texas' })).toMatchObject({ tier: 'median', median: 110_000, employers: 5 });
    mockRows(spread(4));
    expect(await getGatedMedianKForWhere({ state: 'Texas' })).toBe(0);
    mockRows(spread(5));
    expect(await getGatedMedianKForWhere({ state: 'Texas' })).toBe(110);
  });
});

describe('getGatedStateBenchmarks and getPublishableSalaryGuideStates', () => {
  it('hold the states at the median tier and nothing else, by employers not postings', async () => {
    const rows = [
      ...spread(5),
      // Ohio: twelve postings from four employers.
      ...Array.from({ length: 12 }, (_, i) => row(`Fixture ${NAMES[i % 4]} Practice`, 110_000, { state: 'Ohio' })),
      // Maine: ten postings from one system.
      ...spread(10, 100_000, 5_000, { state: 'Maine', employer: 'Fixture One System' }),
    ];
    mockRows(rows);
    expect((await getGatedStateBenchmarks()).map((r) => r.scope)).toEqual(['Texas']);
    mockRows(rows);
    expect(await getPublishableSalaryGuideStates()).toEqual(new Set(['Texas']));
  });

  it('read only rows with a state', async () => {
    mockRows([]);
    await getGatedStateBenchmarks();
    expect(query().where.AND[1]).toEqual({ state: { not: null } });
  });
});

describe('getGatedCitySalaries', () => {
  it('returns only the cities at the median tier, keyed by the stored city spelling, trimmed', async () => {
    mockRows([
      ...spread(5, 100_000, 5_000, { city: ' Austin ' }),
      ...spread(4, 150_000, 5_000, { city: 'Dallas' }),
      ...Array.from({ length: 8 }, () => row('Fixture Solo System', 170_000, { city: 'Houston' })),
    ]);
    const cities = await getGatedCitySalaries('Texas');
    expect([...cities.keys()]).toEqual(['Austin']);
    expect(cities.get('Austin')).toMatchObject({ tier: 'median', gatePassed: true, employers: 5, postings: 5, medianK: 110, p25: null, p75: null });
  });

  it('runs one query scoped to the state with a city, on the NP pool, selecting the city column', async () => {
    mockRows([]);
    await getGatedCitySalaries('Texas');
    expect(findMany).toHaveBeenCalledTimes(1);
    const { where, select } = query();
    expect(where.AND[1]).toEqual({ state: 'Texas', city: { not: null } });
    expect(JSON.stringify(where.AND[0])).toContain('{"professionClass":"np_eligible"}');
    expect(select).toMatchObject({ city: true, employer: true, title: true, professionClass: true, normalizedMinSalary: true, normalizedMaxSalary: true });
  });

  it('screens APRN rows out of a city figure too', async () => {
    mockRows([
      ...spread(4, 100_000, 5_000, { city: 'Austin' }),
      row('Fixture Anesthesia Group', 236_000, { city: 'Austin', title: 'CRNA' }),
    ]);
    expect((await getGatedCitySalaries('Texas')).size).toBe(0);
  });
});

describe('getGatedBenchmarkRows', () => {
  it('returns only the labeled sub-pools at the median tier, in input order', async () => {
    // One findMany per sub-pool, issued in Object.entries order.
    mockRows(spread(10));
    mockRows(spread(3));
    mockRows(spread(5, 200_000));
    const rows = await getGatedBenchmarkRows({
      Remote: { state: 'Texas', isRemote: true },
      Hybrid: { state: 'Texas', isHybrid: true },
      'On site': { state: 'Texas', isRemote: false, isHybrid: false },
    });
    expect(findMany).toHaveBeenCalledTimes(3);
    expect(rows.map((r) => r.label)).toEqual(['Remote', 'On site']);
    expect(rows[0]).toMatchObject({ scope: 'Remote', tier: 'full', employers: 10, p25: 111_500, p75: 134_000 });
    expect(rows[1]).toMatchObject({ scope: 'On site', tier: 'median', median: 210_000, p25: null, p75: null });
  });

  it('passes each sub-pool where through as the AND partner of the NP pool', async () => {
    mockRows([]);
    await getGatedBenchmarkRows({ 'Full-time': { state: 'Texas', jobType: 'Full-time' } });
    expect(query().where.AND[1]).toEqual({ state: 'Texas', jobType: 'Full-time' });
  });
});
