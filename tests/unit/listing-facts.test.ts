/**
 * lib/pseo/listing-facts.ts (PLAN C.3): the pure selectors are pinned at
 * their floors without a database, and the loader runs against the global
 * Prisma mock (tests/setup.ts) to prove the composition rules: one findMany
 * per scope with a minimal select and the row cap, canonicalBucketWhere
 * composed through AND so the caller's own OR is never clobbered, section
 * failures logged with console.error and returned empty, the total-count
 * failure rethrown, and company links only for companies with active jobs.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getGatedBenchmark } from '@/lib/salary-analytics';
import type { MetroCity } from '@/lib/metro-data';
import {
  LISTING_FACTS_ROW_CAP,
  MIX_MIN_LABELED_SHARE,
  MIX_MIN_POSTINGS_HUB,
  MIX_MIN_POSTINGS_LISTING,
  TOP_EMPLOYERS_LIMIT,
  TOP_LIST_LIMIT,
  companyProfilePath,
  emptyListingFacts,
  fieldMixQualifies,
  getListingFacts,
  jobTypeLabelOf,
  metroScopeWhere,
  postedAtOf,
  selectCategoryTop,
  selectCities,
  selectEmployers,
  selectFieldMix,
  selectRecency,
  selectStates,
  selectWorkModeMix,
  settingLabelOf,
  tallyListingFacts,
  workModeQualifies,
  type ListingFactRow,
} from '@/lib/pseo/listing-facts';

vi.mock('@/lib/salary-analytics', () => ({ getGatedBenchmark: vi.fn() }));

const NOW = new Date('2026-09-16T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * DAY_MS);

function row(overrides: Partial<ListingFactRow> = {}): ListingFactRow {
  return {
    employer: 'Sunrise Clinic',
    companyId: null,
    city: 'Austin',
    state: 'Texas',
    stateCode: 'TX',
    isRemote: false,
    isHybrid: false,
    jobType: null,
    setting: null,
    categoryTags: [],
    originalPostedAt: null,
    createdAt: daysAgo(40),
    newGradFriendly: false,
    salaryIsEstimated: false,
    normalizedMinSalary: null,
    ...overrides,
  };
}

function rows(count: number, overrides: Partial<ListingFactRow> = {}): ListingFactRow[] {
  return Array.from({ length: count }, () => row(overrides));
}

describe('floors match PLAN C.0', () => {
  it('listing floor 3, hub floor 5, labeled share 0.5', () => {
    expect(MIX_MIN_POSTINGS_LISTING).toBe(3);
    expect(MIX_MIN_POSTINGS_HUB).toBe(5);
    expect(MIX_MIN_LABELED_SHARE).toBe(0.5);
  });
});

describe('selectWorkModeMix', () => {
  it('returns null below the hub floor by default', () => {
    expect(selectWorkModeMix(rows(MIX_MIN_POSTINGS_HUB - 1))).toBeNull();
    expect(selectWorkModeMix(rows(MIX_MIN_POSTINGS_HUB))).not.toBeNull();
  });

  it('honours the listing floor when asked', () => {
    expect(selectWorkModeMix(rows(MIX_MIN_POSTINGS_LISTING - 1), MIX_MIN_POSTINGS_LISTING)).toBeNull();
    expect(selectWorkModeMix(rows(MIX_MIN_POSTINGS_LISTING), MIX_MIN_POSTINGS_LISTING)?.total).toBe(3);
  });

  it('remote wins over hybrid, the rest is on site', () => {
    const mix = selectWorkModeMix([
      row({ isRemote: true, isHybrid: true }),
      row({ isRemote: true }),
      row({ isHybrid: true }),
      row(),
      row(),
    ]);
    expect(mix).toEqual({ total: 5, remote: 2, hybrid: 1, onsite: 2 });
    expect(workModeQualifies(mix!, 5)).toBe(true);
    expect(workModeQualifies(mix!, 6)).toBe(false);
  });
});

describe('selectFieldMix', () => {
  it('returns null below the labeled floor', () => {
    expect(selectFieldMix(['A', 'A', 'B', 'B'])).toBeNull();
    expect(selectFieldMix(['A', 'A', 'B', 'B', 'C'])).not.toBeNull();
  });

  it('returns null when fewer than half the rows are labeled', () => {
    const fiveOfEleven = ['A', 'A', 'A', 'B', 'B', null, null, null, null, null, null];
    expect(selectFieldMix(fiveOfEleven)).toBeNull();
    const fiveOfTen = fiveOfEleven.slice(0, 10);
    expect(selectFieldMix(fiveOfTen)?.labeledTotal).toBe(5);
  });

  it('treats blank strings as unlabeled and sorts by volume then label', () => {
    const mix = selectFieldMix(['Zeta', 'Alpha', 'Alpha', 'Beta', 'Beta', '  ', null], { min: 3 });
    expect(mix).toEqual({
      total: 7,
      labeledTotal: 5,
      top: [{ label: 'Alpha', count: 2 }, { label: 'Beta', count: 2 }, { label: 'Zeta', count: 1 }],
    });
  });

  it('caps the distribution at the list limit', () => {
    const values = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    expect(selectFieldMix(values, { min: 1 })?.top).toHaveLength(TOP_LIST_LIMIT);
    expect(selectFieldMix(values, { min: 1, limit: 2 })?.top).toHaveLength(2);
  });

  it('fieldMixQualifies fails on an empty sample', () => {
    expect(fieldMixQualifies({ total: 0, labeledTotal: 0, top: [] }, 0)).toBe(false);
  });
});

describe('selectRecency', () => {
  it('returns null below the requested floor', () => {
    expect(selectRecency([], NOW)).toBeNull();
    expect(selectRecency(rows(2), NOW, 3)).toBeNull();
  });

  it('reads originalPostedAt first and createdAt as the fallback', () => {
    const sample = [
      row({ originalPostedAt: daysAgo(2), createdAt: daysAgo(60) }),
      row({ originalPostedAt: daysAgo(20), createdAt: daysAgo(1) }),
      row({ originalPostedAt: null, createdAt: daysAgo(10) }),
      row({ originalPostedAt: null, createdAt: daysAgo(90) }),
    ];
    const recency = selectRecency(sample, NOW);
    expect(recency).toEqual({ total: 4, datedCount: 2, last7: 1, last30: 3, newestPostedAt: daysAgo(2) });
    expect(postedAtOf(sample[1])).toEqual(daysAgo(20));
    expect(postedAtOf(sample[2])).toEqual(daysAgo(10));
  });
});

describe('selectEmployers', () => {
  it('merges spellings of one employer and reports the distinct count', () => {
    const { employers, distinct } = selectEmployers([
      row({ employer: 'LifeStance Health' }),
      row({ employer: 'Lifestance' }),
      row({ employer: 'LifeStance Health' }),
      row({ employer: 'Moon Health' }),
      row({ employer: '  ' }),
      row({ employer: null }),
    ]);
    expect(distinct).toBe(2);
    expect(employers).toEqual([
      { name: 'LifeStance Health', count: 3, companyId: null },
      { name: 'Moon Health', count: 1, companyId: null },
    ]);
  });

  it('carries a company id only when every id-bearing row of the bucket agrees', () => {
    const { employers } = selectEmployers([
      row({ employer: 'Alpha Clinic', companyId: 'c1' }),
      row({ employer: 'Alpha Clinic', companyId: null }),
      row({ employer: 'Beta Clinic', companyId: 'c2' }),
      row({ employer: 'Beta Clinic', companyId: 'c3' }),
      row({ employer: 'Gamma Clinic' }),
    ]);
    expect(employers).toEqual([
      { name: 'Alpha Clinic', count: 2, companyId: 'c1' },
      { name: 'Beta Clinic', count: 2, companyId: null },
      { name: 'Gamma Clinic', count: 1, companyId: null },
    ]);
  });

  it('caps the roster at the employer limit while keeping the full distinct count', () => {
    const sample = Array.from({ length: TOP_EMPLOYERS_LIMIT + 3 }, (_, i) => row({ employer: `Clinic ${String(i).padStart(2, '0')}` }));
    const { employers, distinct } = selectEmployers(sample);
    expect(employers).toHaveLength(TOP_EMPLOYERS_LIMIT);
    expect(distinct).toBe(TOP_EMPLOYERS_LIMIT + 3);
  });
});

describe('selectCities and selectStates', () => {
  it('group case-insensitively and sort by volume then name', () => {
    expect(selectCities([
      row({ city: 'Dallas', stateCode: 'tx' }),
      row({ city: 'austin', stateCode: 'TX' }),
      row({ city: 'Austin', stateCode: 'TX' }),
      row({ city: 'Austin', stateCode: 'MN' }),
      row({ city: null }),
    ])).toEqual([
      { name: 'austin', stateCode: 'TX', count: 2 },
      { name: 'Austin', stateCode: 'MN', count: 1 },
      { name: 'Dallas', stateCode: 'TX', count: 1 },
    ]);
    expect(selectStates([row({ state: 'Ohio' }), row({ state: 'Texas' }), row({ state: 'Texas' }), row({ state: '' })]))
      .toEqual([{ name: 'Texas', count: 2 }, { name: 'Ohio', count: 1 }]);
  });
});

describe('label resolution', () => {
  it('keeps only settings in the employer vocabulary', () => {
    expect(settingLabelOf('Outpatient')).toBe('Outpatient');
    expect(settingLabelOf('Space Station')).toBeNull();
    expect(settingLabelOf(null)).toBeNull();
  });

  it('drops job type sentinels and canonicalizes the rest', () => {
    expect(jobTypeLabelOf('OTHER')).toBeNull();
    expect(jobTypeLabelOf(null)).toBeNull();
    expect(typeof jobTypeLabelOf('FULL_TIME')).toBe('string');
  });

  it('counts only registry category tags and labels them from the config', () => {
    expect(selectCategoryTop([
      row({ categoryTags: ['remote', 'not-a-slug'] }),
      row({ categoryTags: ['remote', 'full-time'] }),
    ])).toEqual([{ label: 'Remote', count: 2 }, { label: 'Full-Time', count: 1 }]);
  });
});

describe('tallyListingFacts and emptyListingFacts', () => {
  it('produce a zero shape with no nulls where a section expects a mix', () => {
    const empty = emptyListingFacts(NOW);
    expect(empty).toMatchObject({
      total: 0,
      distinctEmployers: 0,
      topEmployers: [],
      cities: [],
      states: [],
      workMode: { total: 0, remote: 0, hybrid: 0, onsite: 0 },
      jobTypes: { total: 0, labeledTotal: 0, top: [] },
      settings: { total: 0, labeledTotal: 0, top: [] },
      categoryTop: [],
      recency: { total: 0, datedCount: 0, last7: 0, last30: 0, newestPostedAt: null },
      newGradFriendly: 0,
      salaryDisclosedCount: 0,
      benchmark: null,
      sampled: false,
      computedAt: NOW,
    });
  });

  it('counts disclosed pay only on employer-stated normalized salaries', () => {
    const tally = tallyListingFacts([
      row({ normalizedMinSalary: 120000, salaryIsEstimated: false }),
      row({ normalizedMinSalary: 120000, salaryIsEstimated: true }),
      row({ normalizedMinSalary: null, salaryIsEstimated: false }),
      row({ newGradFriendly: true }),
    ], NOW);
    expect(tally.salaryDisclosedCount).toBe(1);
    expect(tally.newGradFriendly).toBe(1);
    expect(tally.workMode.total).toBe(4);
  });
});

describe('scope helpers', () => {
  it('metroScopeWhere pins the state and folds nearby cities into one OR', () => {
    const metro = {
      city: 'Miami',
      stateCode: 'FL',
      nearbyCities: ['Hialeah'],
      nearbyCityAliases: ['Coral Gables', 'Hialeah'],
    } as unknown as MetroCity;
    expect(metroScopeWhere(metro)).toEqual({
      stateCode: { equals: 'FL', mode: 'insensitive' },
      OR: [
        { city: { contains: 'Miami', mode: 'insensitive' } },
        { city: { equals: 'Hialeah', mode: 'insensitive' } },
        { city: { equals: 'Coral Gables', mode: 'insensitive' } },
      ],
    });
  });

  it('companyProfilePath matches the sitemap kebab form', () => {
    expect(companyProfilePath('one medical')).toBe('/companies/one-medical');
  });
});

describe('getListingFacts loader', () => {
  const findMany = prisma.job.findMany as unknown as Mock;
  const count = prisma.job.count as unknown as Mock;
  const companyFindMany = prisma.company.findMany as unknown as Mock;
  const benchmark = getGatedBenchmark as unknown as Mock;

  beforeEach(() => {
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(0);
    companyFindMany.mockResolvedValue([]);
    benchmark.mockResolvedValue(null);
  });

  it('composes the canonical predicate through AND so the bucket OR survives', async () => {
    const bucket: Prisma.JobWhereInput = {
      OR: [{ categoryTags: { has: 'remote' } }, { title: { contains: 'remote', mode: 'insensitive' } }],
    };
    await getListingFacts('test:or-clobber', bucket);

    const where = findMany.mock.calls[0][0].where as Prisma.JobWhereInput;
    expect(where.OR).toBeUndefined();
    expect(where.AND).toHaveLength(2);
    const [canonical, composed] = where.AND as Prisma.JobWhereInput[];
    expect(composed).toBe(bucket);
    expect(canonical.isPublished).toBe(true);
    expect(canonical.OR).toBeUndefined();
    const nested = canonical.AND as Prisma.JobWhereInput[];
    expect(nested.some((clause) => Array.isArray(clause.OR) && clause.OR.some((c) => c.expiresAt === null))).toBe(true);

    expect(count.mock.calls[0][0].where).toEqual(where);
    expect(benchmark).toHaveBeenCalledWith(where);
  });

  it('issues one capped findMany with the minimal select', async () => {
    await getListingFacts('test:one-query', { state: 'Texas' });

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(count).toHaveBeenCalledTimes(1);
    const args = findMany.mock.calls[0][0];
    expect(args.take).toBe(LISTING_FACTS_ROW_CAP);
    expect(Object.keys(args.select).sort()).toEqual([
      'categoryTags', 'city', 'companyId', 'createdAt', 'employer', 'isHybrid', 'isRemote', 'jobType',
      'newGradFriendly', 'normalizedMinSalary', 'originalPostedAt', 'salaryIsEstimated', 'setting', 'state', 'stateCode',
    ]);
    expect(args.select.description).toBeUndefined();
    expect(args.select.title).toBeUndefined();
  });

  it('tallies rows and links only companies that still have active jobs', async () => {
    findMany.mockResolvedValue([
      row({ employer: 'Sunrise Clinic', companyId: 'c1' }),
      row({ employer: 'Sunrise Clinic', companyId: 'c1' }),
      row({ employer: 'Moon Health', companyId: 'c2' }),
    ]);
    count.mockResolvedValue(3);
    companyFindMany.mockResolvedValue([{ id: 'c1', normalizedName: 'sunrise clinic' }]);

    const facts = await getListingFacts('test:company-paths', {});

    expect(facts.total).toBe(3);
    expect(facts.distinctEmployers).toBe(2);
    expect(facts.topEmployers).toEqual([
      { name: 'Sunrise Clinic', count: 2, companyPath: '/companies/sunrise-clinic' },
      { name: 'Moon Health', count: 1, companyPath: null },
    ]);
    expect(facts.sampled).toBe(false);

    const companyWhere = companyFindMany.mock.calls[0][0].where as Prisma.CompanyWhereInput;
    const [ids, active] = companyWhere.AND as Prisma.CompanyWhereInput[];
    expect(ids).toEqual({ id: { in: ['c1', 'c2'] } });
    expect(active).toEqual({ jobs: { some: expect.objectContaining({ isPublished: true }) } });
  });

  it('skips the company lookup when no employer carries an id', async () => {
    findMany.mockResolvedValue([row(), row({ employer: 'Moon Health' })]);
    count.mockResolvedValue(2);

    const facts = await getListingFacts('test:no-ids', {});

    expect(companyFindMany).not.toHaveBeenCalled();
    expect(facts.topEmployers.every((e) => e.companyPath === null)).toBe(true);
  });

  it('logs a failed row query with console.error and returns empty sections', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    findMany.mockRejectedValue(new Error('rows exploded'));
    count.mockResolvedValue(7);

    const facts = await getListingFacts('test:rows-fail', {});

    expect(facts.total).toBe(7);
    expect(facts.topEmployers).toEqual([]);
    expect(facts.cities).toEqual([]);
    expect(facts.workMode.total).toBe(0);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('row query failed'), expect.any(Error));
    expect(logSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('logs a failed benchmark query and publishes no figure', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    benchmark.mockRejectedValue(new Error('benchmark exploded'));

    const facts = await getListingFacts('test:benchmark-fail', {});

    expect(facts.benchmark).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('benchmark query failed'), expect.any(Error));
    errorSpy.mockRestore();
  });

  it('logs a failed company lookup and leaves every path null', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    findMany.mockResolvedValue([row({ companyId: 'c1' })]);
    count.mockResolvedValue(1);
    companyFindMany.mockRejectedValue(new Error('company exploded'));

    const facts = await getListingFacts('test:company-fail', {});

    expect(facts.topEmployers).toEqual([{ name: 'Sunrise Clinic', count: 1, companyPath: null }]);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('company lookup failed'), expect.any(Error));
    errorSpy.mockRestore();
  });

  it('rethrows a failed total count so the page 5xxs instead of claiming zero', async () => {
    count.mockRejectedValue(new Error('count exploded'));

    await expect(getListingFacts('test:count-fail', {})).rejects.toThrow('count exploded');
  });

  it('flags a sample as truncated when the row cap is hit and the count exceeds it', async () => {
    findMany.mockResolvedValue(rows(LISTING_FACTS_ROW_CAP));
    count.mockResolvedValue(LISTING_FACTS_ROW_CAP + 5);

    const facts = await getListingFacts('test:sampled', {});

    expect(facts.sampled).toBe(true);
    expect(facts.total).toBe(LISTING_FACTS_ROW_CAP + 5);
    expect(facts.workMode.total).toBe(LISTING_FACTS_ROW_CAP);
  });
});
