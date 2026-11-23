/**
 * AI-11: at the page limit the assistant used to see no "More results" line
 * and nothing saying results were cut off, so it could tell the person that
 * was all there is. The limit itself is gone since 2026-11-13 (a search
 * stopped at 160 results however many matched): every page can be asked
 * for, so what must hold now is that a page with more after it always says
 * so, and only the last page does not. Every name is fictional.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { brand } from '@/config/brand';

const db = vi.hoisted(() => ({
  job: { findMany: vi.fn(), count: vi.fn() },
  savedJob: { findMany: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ prisma: db }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { searchJobs } from '@/lib/mcp/tools/candidate-search';
import type { ToolContext } from '@/lib/mcp/server/types';

const ctx = {
  endpoint: 'candidate',
  access: null,
  baseUrl: brand.baseUrl,
  ip: '203.0.113.9',
  requestMeta: undefined,
} as unknown as ToolContext;

const ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'psychiatric-nurse-practitioner-11111111',
  title: 'Psychiatric Nurse Practitioner',
  employer: 'Acme Behavioral Health',
  location: 'Austin, TX',
  city: 'Austin',
  state: 'Texas',
  stateCode: 'TX',
  jobType: 'Full-Time',
  jobTypes: ['Full-Time'],
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
  description: 'Outpatient psychiatric care for adults.',
  descriptionSummary: 'Outpatient psychiatric care for adults.',
  benefits: [],
  setting: null,
  population: null,
  eligibleStateCodes: [],
  createdAt: new Date(),
  originalPostedAt: null,
  isFeatured: false,
  isVerifiedEmployer: false,
  experienceLabel: null,
  newGradFriendly: false,
  applyOnPlatform: false,
  sourceType: 'external',
  employerJobs: null,
  _count: { screeningQuestions: 0 },
};

beforeEach(() => {
  db.savedJob.findMany.mockResolvedValue([]);
});

/**
 * `total` open jobs, each from its own employer so none is folded into
 * another. The tool reads every match once, then the page's cards by id.
 */
async function textFor(page: number, total: number): Promise<string> {
  const table = Array.from({ length: total }, (_, i) => ({
    ...ROW,
    id: `11111111-1111-4111-8111-${String(i + 1).padStart(12, '0')}`,
    employer: `Acme Behavioral Health ${i + 1}`,
  }));
  db.job.findMany.mockImplementation(async (args: { where?: { AND?: [unknown, { id?: { in?: string[] } }] } }) => {
    const ids = args.where?.AND?.[1]?.id?.in;
    return ids ? table.filter((row) => ids.includes(row.id)) : table;
  });
  const outcome = await searchJobs.run({ page } as never, ctx);
  return (outcome as { text: string }).text;
}

describe('search_jobs never leaves the assistant to guess whether there is more', () => {
  it('points past what used to be the last reachable page, and cuts nothing off', async () => {
    const text = await textFor(20, 400);
    expect(text).toContain('More results: call search_jobs again with page 21.');
    expect(text).not.toMatch(/Only the first|are available here/);
  });

  it('says a page is the last one when it is', async () => {
    const text = await textFor(50, 400);
    expect(text).toContain('Showing 393 to 400');
    expect(text).not.toContain('More results');
    expect(text).toContain('That is the last page.');
  });

  it('keeps pointing to the next page on an early page, with no cut-off notice', async () => {
    const text = await textFor(3, 400);
    expect(text).toContain('More results: call search_jobs again with page 4.');
    expect(text).not.toContain('are available here');
  });

  it('adds no notice when the last page is also the end of the results', async () => {
    const text = await textFor(20, 155);
    expect(text).not.toContain('are available here');
  });
});
