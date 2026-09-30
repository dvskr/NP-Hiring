/**
 * lib/pseo/state-hub-index.ts: the state hub index input, shared by the hub
 * page, the aggregate-pseo cron (the strict category x state gate reads the
 * parent hub) and the primary sitemap (CQ-07, fixSoon 16).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/salary-analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/salary-analytics')>();
  return { ...actual, getPublishableSalaryGuideStates: vi.fn() };
});

import { prisma } from '@/lib/prisma';
import { getPublishableSalaryGuideStates } from '@/lib/salary-analytics';
import type { ListingFactRow } from '@/lib/pseo/listing-facts';
import { computeStateHubVerdicts, loadStateHubVerdicts } from '@/lib/pseo/state-hub-index';

const NOW = new Date('2026-09-28T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function factRow(over: Partial<ListingFactRow> = {}): ListingFactRow {
  return {
    employer: 'Alpha Health',
    title: 'Nurse Practitioner',
    companyId: null,
    city: 'Austin',
    state: 'Texas',
    stateCode: 'TX',
    isRemote: false,
    isHybrid: false,
    jobType: 'Full-Time',
    setting: 'Outpatient',
    categoryTags: ['primary-care'],
    originalPostedAt: new Date(NOW.getTime() - 3 * DAY_MS),
    createdAt: new Date(NOW.getTime() - 3 * DAY_MS),
    newGradFriendly: false,
    salaryIsEstimated: true,
    normalizedMinSalary: null,
    ...over,
  };
}

/** Texas: 8 postings from 4 employers in 4 cities, the mixes labeled. */
const TEXAS: ListingFactRow[] = [
  factRow(),
  factRow({ city: 'Dallas' }),
  factRow({ employer: 'Beta Clinic', city: 'Houston', isRemote: true }),
  factRow({ employer: 'Beta Clinic', city: 'Waco', title: 'Family Nurse Practitioner' }),
  factRow({ employer: 'Gamma Care', city: 'Austin', isHybrid: true }),
  factRow({ employer: 'Gamma Care', city: 'Dallas', title: 'Psychiatric Nurse Practitioner' }),
  factRow({ employer: 'Delta Medical', city: 'Houston' }),
  factRow({ employer: 'Delta Medical', city: 'Waco', title: 'Urgent Care Nurse Practitioner' }),
];

/** Kansas: 3 postings from 3 employers (indexed before the audit, noindex after). */
const KANSAS: ListingFactRow[] = [
  factRow({ state: 'Kansas', stateCode: 'KS', city: 'Wichita' }),
  factRow({ state: 'Kansas', stateCode: 'KS', city: 'Topeka', employer: 'Beta Clinic' }),
  factRow({ state: 'Kansas', stateCode: 'KS', city: 'Olathe', employer: 'Gamma Care' }),
];

describe('computeStateHubVerdicts', () => {
  it('a hub at the listing floor with enough live sections indexes; a 3-job hub does not', () => {
    const verdicts = computeStateHubVerdicts([...TEXAS, ...KANSAS], new Set(['Texas']), NOW);
    const texas = verdicts.get('Texas');
    expect(texas?.indexable).toBe(true);
    expect(texas?.postings).toBe(8);
    expect(texas?.stateSlug).toBe('texas');
    expect(texas?.input.distinctEmployers).toBe(4);
    const kansas = verdicts.get('Kansas');
    expect(kansas?.indexable).toBe(false);
    expect(kansas?.postings).toBe(3);
  });

  it('buckets a row under its hub by state name OR state code, as the hub page queries', () => {
    const coded = TEXAS.map((r) => ({ ...r, state: 'TX' }));
    const verdicts = computeStateHubVerdicts(coded, new Set(), NOW);
    expect(verdicts.get('Texas')?.postings).toBe(8);
  });

  it('exact duplicate rows count once', () => {
    const doubled = [...TEXAS, ...TEXAS];
    expect(computeStateHubVerdicts(doubled, new Set(), NOW).get('Texas')?.postings).toBe(8);
  });

  it('omits jurisdictions with no rows', () => {
    expect(computeStateHubVerdicts(TEXAS, new Set(), NOW).has('Maine')).toBe(false);
  });

  it('S7 counts only when the state publishes a median', () => {
    const withMedian = computeStateHubVerdicts(TEXAS, new Set(['Texas']), NOW).get('Texas');
    const without = computeStateHubVerdicts(TEXAS, new Set(), NOW).get('Texas');
    expect((withMedian?.input.liveDataSections ?? 0) - (without?.input.liveDataSections ?? 0)).toBe(1);
  });
});

describe('loadStateHubVerdicts', () => {
  const db = prisma as unknown as { job: { findMany: ReturnType<typeof vi.fn> } };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads one canonical row pool and the publishable states', async () => {
    db.job.findMany.mockResolvedValue(TEXAS);
    vi.mocked(getPublishableSalaryGuideStates).mockResolvedValue(new Set(['Texas']));
    const verdicts = await loadStateHubVerdicts(NOW);
    expect(verdicts.get('Texas')?.indexable).toBe(true);
    expect(db.job.findMany).toHaveBeenCalledTimes(1);
    const args = db.job.findMany.mock.calls[0][0] as { select: Record<string, boolean> };
    expect(args.select.title).toBe(true);
  });

  it('a failed salary lookup costs S7 only', async () => {
    db.job.findMany.mockResolvedValue(TEXAS);
    vi.mocked(getPublishableSalaryGuideStates).mockRejectedValue(new Error('salary down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const verdicts = await loadStateHubVerdicts(NOW);
    expect(verdicts.get('Texas')?.input.liveDataSections).toBe(
      computeStateHubVerdicts(TEXAS, new Set(), NOW).get('Texas')?.input.liveDataSections,
    );
  });

  it('a failed row query rejects, so the caller decides how to close', async () => {
    db.job.findMany.mockRejectedValue(new Error('db down'));
    vi.mocked(getPublishableSalaryGuideStates).mockResolvedValue(new Set());
    await expect(loadStateHubVerdicts(NOW)).rejects.toThrow('db down');
  });
});
