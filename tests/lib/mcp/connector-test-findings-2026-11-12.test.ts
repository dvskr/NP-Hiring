/**
 * get_job's location line, and analyze_offer against NP Hiring's published
 * pay figures:
 *
 *  - get_job wrote a remote job's location as "Remote (Remote)" on PMHNP
 *    Hiring's connector (live test, 2026-11-12): the place and the work mode
 *    are the same word for a fully remote role.
 *  - analyze_offer places an offer against the salary guide's own published
 *    figures (lib/salary-analytics.ts): below, within or above the middle
 *    half, next to the median, with the sample. A state whose figure is not
 *    published is compared with all NP Hiring postings instead, and says why;
 *    with nothing published there is nothing to compare with.
 *
 * All fixtures are fictional.
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

function published(median: number, p25: number, p75: number, postings: number, employers: number) {
  return {
    postings,
    employers,
    gatePassed: true,
    median,
    p25,
    p75,
    medianK: Math.round(median / 1000),
    p25K: Math.round(p25 / 1000),
    p75K: Math.round(p75 / 1000),
    topEmployerPostings: 2,
    heldByEmployerShare: false,
  };
}

function belowGate(postings: number, employers: number) {
  return {
    postings,
    employers,
    gatePassed: false,
    median: null,
    p25: null,
    p75: null,
    medianK: null,
    p25K: null,
    p75K: null,
    topEmployerPostings: 1,
    heldByEmployerShare: false,
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
  figures.byState = new Map([['Missouri', published(118_500, 110_000, 155_000, 21, 9)]]);
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
    expect(out.text).toContain(`Median advertised pay on ${brand.name} postings in Missouri: $119k`);
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
    expect(value(out, 'Postings compared')).toBe('21');
    expect((out.structured as FactsViewData).subtitle).toBe('Compared with Missouri');
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
    expect(out.text).toMatch(/No median is published for Wyoming/);
    expect(out.text).toContain(`This uses all ${brand.name} postings instead.`);
  });

  it('refuses when nothing is published to compare with', async () => {
    figures.board = belowGate(3, 2);
    await expect(analyzeOffer.run({ amount: 130_000, period: 'annual' }, ctx)).rejects.toThrow(/nothing to compare the offer with/);
  });

  it('never calls the site-wide figure national', async () => {
    const out = await analyzeOffer.run({ amount: 130_000, period: 'annual' }, ctx);
    expect(out.text).not.toMatch(/national/i);
  });
});
