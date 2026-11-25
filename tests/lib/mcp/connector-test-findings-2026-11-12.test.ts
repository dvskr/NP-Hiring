/**
 * get_job's location line, and analyze_offer against NP Hiring's published
 * pay figures:
 *
 *  - get_job wrote a remote job's location as "Remote (Remote)" on PMHNP
 *    Hiring's connector (live test, 2026-11-12): the place and the work mode
 *    are the same word for a fully remote role.
 *  - analyze_offer places an offer against the salary guide's own published
 *    figures (lib/salary-analytics.ts): below, within or above the middle
 *    half, next to the median, with the sample in employers. A state with no
 *    middle half (no median below 5 employers, a median but no quartiles
 *    from 5 to 9) is compared with all NP Hiring postings instead, and says
 *    why; with no middle half anywhere there is nothing to compare with.
 *
 * All fixtures are fictional, and shaped as the engine tiers them: quartiles
 * only at 10 or more employers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { brand } from '@/config/brand';

const { db, figures } = vi.hoisted(() => ({
  db: { job: { findFirst: vi.fn() }, savedJob: { findUnique: vi.fn() } },
  figures: { byState: new Map<string, unknown>(), board: null as unknown, remote: null as unknown },
}));

vi.mock('@/lib/prisma', () => ({ prisma: db }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/salary-analytics', () => ({
  getGatedLocationSalary: vi.fn(async (where: { state?: string; isRemote?: boolean } = {}) =>
    where.state ? figures.byState.get(where.state) ?? belowGate(2, 1) : where.isRemote ? figures.remote : figures.board,
  ),
  getGatedStateBenchmarks: vi.fn(async () => []),
}));

import { getJob } from '@/lib/mcp/tools/candidate-search';
import { analyzeOffer } from '@/lib/mcp/tools/candidate-calculators';
import { resetPayCacheForTests } from '@/lib/mcp/tools/np-pay';
import type { ToolContext } from '@/lib/mcp/server/types';
import type { FactsViewData } from '@/lib/mcp/widgets/src/contracts';

/** A full-tier figure (10 or more employers): median and quartiles. */
function published(median: number, p25: number, p75: number, postings: number, employers: number) {
  return {
    postings,
    employers,
    tier: 'full',
    gatePassed: true,
    median,
    p25,
    p75,
    medianK: Math.round(median / 1000),
    p25K: Math.round(p25 / 1000),
    p75K: Math.round(p75 / 1000),
  };
}

/** A median-tier figure (5 to 9 employers): a median, no quartiles. */
function medianOnly(median: number, postings: number, employers: number) {
  return {
    postings,
    employers,
    tier: 'median',
    gatePassed: true,
    median,
    p25: null,
    p75: null,
    medianK: Math.round(median / 1000),
    p25K: null,
    p75K: null,
  };
}

function belowGate(postings: number, employers: number) {
  return {
    postings,
    employers,
    tier: employers >= 3 ? 'countOnly' : 'none',
    gatePassed: false,
    median: null,
    p25: null,
    p75: null,
    medianK: null,
    p25K: null,
    p75K: null,
  };
}

const ctx = {
  endpoint: 'candidate',
  access: null,
  baseUrl: brand.baseUrl,
  ip: '203.0.113.9',
  requestMeta: undefined,
} as unknown as ToolContext;

const JOB_ID = '11111111-1111-4111-8111-111111111111';

function jobRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: JOB_ID,
    slug: `family-nurse-practitioner-${JOB_ID}`,
    title: 'Family Nurse Practitioner, Remote | West Virginia',
    employer: 'Acme Telehealth',
    location: 'Remote, West Virginia',
    city: null,
    state: 'West Virginia',
    stateCode: 'WV',
    isRemote: true,
    isHybrid: false,
    mode: 'Remote',
    jobType: 'Full-Time',
    displaySalary: null,
    normalizedMinSalary: null,
    normalizedMaxSalary: null,
    salaryRange: null,
    salaryPeriod: null,
    minSalary: null,
    maxSalary: null,
    salaryIsEstimated: false,
    salaryConfidence: 1,
    sourceType: 'external',
    originalPostedAt: null,
    createdAt: new Date('2026-11-12T00:00:00Z'),
    experienceLabel: null,
    newGradFriendly: false,
    minYearsExperience: null,
    applyOnPlatform: false,
    isVerifiedEmployer: false,
    description: 'Telehealth primary care for adults.',
    descriptionSummary: null,
    benefits: [],
    setting: null,
    population: null,
    _count: { screeningQuestions: 0 },
    ...overrides,
  };
}

const lines = (text: string): string[] => text.split('\n');
const rowsOf = (out: { structured?: unknown }) => (out.structured as FactsViewData).sections[0].rows;
const value = (out: { structured?: unknown }, label: string) => rowsOf(out).find((r) => r.label === label)?.value;

beforeEach(() => {
  vi.clearAllMocks();
  resetPayCacheForTests();
  figures.byState = new Map<string, unknown>([
    ['Missouri', published(118_500, 110_000, 155_000, 21, 12)],
    ['Kansas', medianOnly(131_000, 14, 7)],
  ]);
  figures.board = published(125_000, 112_000, 142_000, 840, 310);
  figures.remote = published(121_000, 108_000, 140_000, 96, 40);
});

describe('get_job location line', () => {
  it('writes a fully remote job as "Remote", once', async () => {
    db.job.findFirst.mockResolvedValue(jobRow());
    const out = await getJob.run({ job_id: JOB_ID }, ctx);
    expect(lines(out.text)).toContain('Location: Remote');
    expect(out.text).not.toContain('Remote (Remote)');
  });

  it('still adds the work mode when it says something the place does not', async () => {
    db.job.findFirst.mockResolvedValue(
      jobRow({ location: 'Austin, TX', city: 'Austin', state: 'Texas', stateCode: 'TX', isRemote: false, isHybrid: true, mode: 'Hybrid' }),
    );
    const out = await getJob.run({ job_id: JOB_ID }, ctx);
    expect(lines(out.text)).toContain('Location: Austin, TX (Hybrid)');
  });

  it('quotes a published state median as advertised pay on the site, and never a national one', async () => {
    db.job.findFirst.mockResolvedValue(jobRow({ state: 'Missouri', stateCode: 'MO', city: 'Columbia', isRemote: false, mode: 'In-Person' }));
    const out = await getJob.run({ job_id: JOB_ID }, ctx);
    // With its n: employers, each counted once, never a posting count.
    expect(out.text).toContain(`Median advertised pay on ${brand.name} postings in Missouri: $119k, across 12 employers that disclose pay`);
    expect(out.text).not.toMatch(/national|US median/i);
    expect((out.structured as { job: { nationalMedianK: number } }).job.nationalMedianK).toBe(0);
  });
});

describe('analyze_offer against the published figures', () => {
  it('places an offer within the middle half, next to the median and the sample', async () => {
    const out = await analyzeOffer.run({ amount: 150_000, period: 'annual', state: 'MO' }, ctx);
    expect((out.structured as FactsViewData).title).toBe('Within the middle half of advertised pay');
    expect(value(out, '25th percentile')).toBe('$110,000');
    expect(value(out, 'Median')).toBe('$118,500');
    expect(value(out, '75th percentile')).toBe('$155,000');
    // The sample is employers, each counted once; postings are not the n.
    expect(value(out, 'Employers compared')).toBe('12');
    expect(rowsOf(out).map((r) => r.label)).not.toContain('Postings compared');
    expect((out.structured as FactsViewData).subtitle).toBe('Compared with Missouri');
    expect(out.text).toMatch(/Each employer counts once/);
    expect(out.text).not.toMatch(/40%|counted per posting/);
  });

  it('compares a state with a median but no middle half with all postings, quoting its median and the rule', async () => {
    const out = await analyzeOffer.run({ amount: 130_000, period: 'annual', state: 'Kansas' }, ctx);
    expect((out.structured as FactsViewData).subtitle).toBe(`Compared with all ${brand.name} postings`);
    expect(out.text).toContain('For Kansas, the median is $131k across 7 employers that disclose pay, with no 25th to 75th percentile range yet: that appears once at least 10 employers disclose pay.');
    expect(out.text).not.toMatch(/No median is published for Kansas/);
    expect(out.text).toContain(`This uses all ${brand.name} postings instead.`);
  });

  it('refuses with the reason when the only figure left has a median but no middle half', async () => {
    figures.board = medianOnly(125_000, 30, 8);
    await expect(analyzeOffer.run({ amount: 130_000, period: 'annual' }, ctx)).rejects.toThrow(
      `For all ${brand.name} postings, the median is $125k across 8 employers that disclose pay, with no 25th to 75th percentile range yet: that appears once at least 10 employers disclose pay. So there is nothing to compare the offer with right now.`,
    );
  });

  it('says below or above the middle half at its edges', async () => {
    expect((await analyzeOffer.run({ amount: 109_999, period: 'annual', state: 'Missouri' }, ctx)).structured).toMatchObject({
      title: 'Below the middle half of advertised pay',
    });
    expect((await analyzeOffer.run({ amount: 155_001, period: 'annual', state: 'Missouri' }, ctx)).structured).toMatchObject({
      title: 'Above the middle half of advertised pay',
    });
  });

  it('reads an hourly offer as a year of the hours given', async () => {
    const out = await analyzeOffer.run({ amount: 60, period: 'hourly', hours_per_week: 40, state: 'MO' }, ctx);
    expect(value(out, 'Offer ($60.00 an hour, 40 hours a week)')).toBe('$124,800 a year');
  });

  it('compares a state with no published figure with all postings, and says why', async () => {
    const out = await analyzeOffer.run({ amount: 130_000, period: 'annual', state: 'Wyoming' }, ctx);
    expect((out.structured as FactsViewData).subtitle).toBe(`Compared with all ${brand.name} postings`);
    // Wyoming's fixture is 1 employer: the reason is in employers, never postings.
    expect(out.text).toContain('No median is published for Wyoming: 1 employer discloses pay, and a median needs at least 5.');
    expect(out.text).toContain(`This uses all ${brand.name} postings instead.`);
  });

  it('refuses when nothing is published to compare with', async () => {
    figures.board = belowGate(3, 2);
    await expect(analyzeOffer.run({ amount: 130_000, period: 'annual' }, ctx)).rejects.toThrow(/nothing to compare the offer with/);
    await expect(analyzeOffer.run({ amount: 130_000, period: 'annual' }, ctx)).rejects.toThrow(/2 employers disclose pay, and a median needs at least 5/);
  });

  it('never calls the site-wide figure national', async () => {
    const out = await analyzeOffer.run({ amount: 130_000, period: 'annual' }, ctx);
    expect(out.text).not.toMatch(/national/i);
  });
});
