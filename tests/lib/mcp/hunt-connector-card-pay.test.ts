/**
 * The connector's job card prints pay as NP Hiring's job page does
 * (app/jobs/[slug]/page.tsx payLabel), so a card never disagrees with the
 * page it links to: the posting's own figures and period through
 * formatSalary, a range read with "to". An estimated or conflicting figure is
 * not quoted at all (CQ-02), as the page leaves it off its pay line and out
 * of JobPosting.baseSalary.
 *
 * The mocked read applies the tool's own select to full rows, so a column the
 * select leaves out never reaches the card. Every name is fictional.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { brand } from '@/config/brand';

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  job: { findMany: vi.fn(), count: vi.fn() },
  savedJob: { findMany: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ prisma: db }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { searchJobs } from '@/lib/mcp/tools/candidate-search';
import { normalizeDisplaySalary } from '@/lib/salary-display';
import { formatSalary } from '@/lib/utils';
import type { ToolContext } from '@/lib/mcp/server/types';
import type { JobsViewData } from '@/lib/mcp/widgets/src/contracts';

const ctx = {
  endpoint: 'candidate',
  access: null,
  baseUrl: brand.baseUrl,
  ip: '203.0.113.9',
  requestMeta: undefined,
} as unknown as ToolContext;

function row(id: string, overrides: Row): Row {
  return {
    id,
    slug: `family-nurse-practitioner-${id}`,
    title: 'Family Nurse Practitioner',
    employer: 'Acme Community Health',
    location: 'Austin, TX',
    city: 'Austin',
    state: 'Texas',
    stateCode: 'TX',
    jobType: 'Full-Time',
    isRemote: false,
    isHybrid: false,
    mode: 'In-Person',
    displaySalary: null,
    normalizedMinSalary: null,
    normalizedMaxSalary: null,
    salaryPeriod: null,
    salaryRange: null,
    minSalary: null,
    maxSalary: null,
    salaryIsEstimated: false,
    salaryConfidence: 1,
    sourceType: 'external',
    createdAt: new Date(),
    originalPostedAt: null,
    isVerifiedEmployer: false,
    experienceLabel: null,
    newGradFriendly: false,
    minYearsExperience: null,
    applyOnPlatform: false,
    ...overrides,
  };
}

/** Only the selected columns, as the database returns them. */
function project(full: Row, select: Row): Row {
  return Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, full[k]]));
}

const STATED = row('11111111-1111-4111-8111-111111111111', {
  employer: 'Riverside Clinic',
  title: 'Family Nurse Practitioner',
  minSalary: 130000,
  maxSalary: 155000,
  salaryPeriod: 'annual',
  displaySalary: '$130k-$155k/yr',
});
const HOURLY = row('22222222-2222-4222-8222-222222222222', {
  employer: 'Hillcrest Urgent Care',
  title: 'Urgent Care Nurse Practitioner',
  minSalary: 65,
  maxSalary: 80,
  salaryPeriod: 'hourly',
});
const ESTIMATED = row('33333333-3333-4333-8333-333333333333', {
  employer: 'Lakeside Health',
  title: 'Acute Care Nurse Practitioner',
  minSalary: 150000,
  maxSalary: 180000,
  salaryPeriod: 'annual',
  displaySalary: '$150k to $180k/yr',
  salaryIsEstimated: true,
});
const LOW_CONFIDENCE = row('44444444-4444-4444-8444-444444444444', {
  employer: 'Summit Pediatrics',
  title: 'Pediatric Nurse Practitioner',
  minSalary: 120000,
  maxSalary: 140000,
  salaryPeriod: 'annual',
  salaryConfidence: 0.3,
});
const DISPLAY_ONLY = row('55555555-5555-4555-8555-555555555555', {
  employer: 'Valley Family Health',
  title: 'Primary Care Nurse Practitioner',
  displaySalary: '$58k-$75k',
});

let rows: Row[];

beforeEach(() => {
  rows = [STATED, HOURLY, ESTIMATED, LOW_CONFIDENCE, DISPLAY_ONLY];
  db.job.findMany.mockImplementation(async ({ select }: { select: Row }) => rows.map((r) => project(r, select)));
  db.job.count.mockResolvedValue(rows.length);
  db.savedJob.findMany.mockResolvedValue([]);
});

async function cards() {
  const outcome = await searchJobs.run({} as never, ctx);
  const byId = new Map((outcome.structured as JobsViewData).jobs.map((card) => [card.id, card]));
  return (r: Row) => byId.get(r.id as string)!;
}

const pageLabel = (r: Row) => normalizeDisplaySalary(formatSalary(r.minSalary as number, r.maxSalary as number, r.salaryPeriod as string));

describe('the connector job card shows pay as the job page does', () => {
  it('prints the posting\'s own figures as the job page\'s pay line does', async () => {
    const card = await cards();
    expect(card(STATED).pay).toBe(pageLabel(STATED));
    expect(card(STATED).pay).toBe('$130k to $155k/yr');
    expect(card(HOURLY).pay).toBe(pageLabel(HOURLY));
  });

  it('never quotes an estimated or conflicting figure', async () => {
    const card = await cards();
    expect(card(ESTIMATED).pay).toBeNull();
    expect(card(LOW_CONFIDENCE).pay).toBeNull();
  });

  it('falls back to the stored display text, read with "to", where the page has no figures', async () => {
    const card = await cards();
    expect(card(DISPLAY_ONLY).pay).toBe('$58k to $75k');
  });
});
