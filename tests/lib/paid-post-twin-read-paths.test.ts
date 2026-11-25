/**
 * Read paths that reach a job by an id stored before the job was marked as a
 * free copy of a live paid post (lib/paid-post-twins.ts): the assistant tools,
 * which read findPublicJob and the saved list. The role is live and the
 * copy's URL redirects to the paid post, so these answer with that post
 * instead of calling the role closed.
 *
 * The where clauses run for real against fixture rows
 * (tests/helpers/fake-prisma-where.ts), so these pin behaviour, not shape.
 * Every name is fictional.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { brand } from '@/config/brand';

const { db } = vi.hoisted(() => ({
  db: {
    job: { findMany: vi.fn(), findFirst: vi.fn() },
    savedJob: { findMany: vi.fn(), count: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    userProfile: { findUnique: vi.fn() },
    jobAlert: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: db }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/applications/submit-direct-application', () => ({
  MAX_COVER_LETTER_LENGTH: 5000,
  submitDirectApplication: vi.fn(),
}));
vi.mock('@/lib/salary-analytics', () => ({
  getGatedLocationSalary: vi.fn(async () => ({
    postings: 0, employers: 0, gatePassed: false, median: null, p25: null, p75: null, medianK: null, p25K: null, p75K: null,
    topEmployerPostings: 0, heldByEmployerShare: false,
  })),
  getGatedStateBenchmarks: vi.fn(async () => []),
}));

import { fakeModel, type FakeTables, type Row } from '../helpers/fake-prisma-where';
import { activeIndexableJobWhere } from '@/lib/active-job-filter';
import { copiesWithVisibleTwinWhere, visibleTwinsOfCopiesWhere } from '@/lib/paid-post-twin-lookup';
import { findPublicJob, JOB_CARD_SELECT } from '@/lib/mcp/tools/shared';
import { saveJob, unsaveJob } from '@/lib/mcp/tools/candidate-account';
import { listSavedJobs } from '@/lib/mcp/tools/candidate-extras';
import type { ToolContext } from '@/lib/mcp/server/types';
import type { JobsViewData } from '@/lib/mcp/widgets/src/contracts';

/** The board's own role, so the site-wide exclusions keep every fixture listed. */
const ROLE = brand.niche.short;
const DAY_MS = 24 * 60 * 60 * 1000;
const LATER = new Date(Date.now() + 30 * DAY_MS);
const EARLIER = new Date(Date.now() - DAY_MS);

const PAID = '11111111-1111-4111-8111-111111111111';
const COPY = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const ENDED_PAID = '44444444-4444-4444-8444-444444444444';
const COPY_OF_ENDED = '55555555-5555-4555-8555-555555555555';
const EXPIRED_COPY = '66666666-6666-4666-8666-666666666666';
const UNPUBLISHED_COPY = '77777777-7777-4777-8777-777777777777';
const EASY_APPLY = '88888888-8888-4888-8888-888888888888';

const TITLE = `${ROLE}, Outpatient`;

function listing(id: string, overrides: Row = {}): Row {
  return {
    id,
    slug: `np-outpatient-${id}`,
    title: TITLE,
    employer: 'Example Wellness Group',
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
    salaryRange: null,
    salaryPeriod: null,
    minSalary: null,
    maxSalary: null,
    salaryIsEstimated: false,
    salaryConfidence: 1,
    sourceType: 'external',
    originalPostedAt: null,
    createdAt: new Date(Date.now() - 2 * DAY_MS),
    experienceLabel: null,
    newGradFriendly: false,
    minYearsExperience: null,
    applyOnPlatform: false,
    isVerifiedEmployer: false,
    isPublished: true,
    expiresAt: LATER,
    healthConsecutiveMissing: 0,
    shadowedByJobId: null,
    ...overrides,
  };
}

const paidPost = (id: string, overrides: Row = {}): Row => listing(id, { sourceType: 'employer', applyOnPlatform: true, ...overrides });

function freshTables(): FakeTables {
  return {
    jobs: [
      paidPost(PAID),
      listing(COPY, { shadowedByJobId: PAID }),
      listing(OTHER, { title: `${ROLE}, Telehealth`, employer: 'Acme Health Group', isRemote: true }),
      // A paid post past its expiry whose copies the hourly sync has not released yet.
      paidPost(ENDED_PAID, { expiresAt: EARLIER }),
      listing(COPY_OF_ENDED, { shadowedByJobId: ENDED_PAID }),
      // Copies that are gone themselves: their own URLs answer 410.
      listing(EXPIRED_COPY, { shadowedByJobId: PAID, expiresAt: EARLIER }),
      listing(UNPUBLISHED_COPY, { shadowedByJobId: PAID, isPublished: false }),
      paidPost(EASY_APPLY, { title: `${ROLE}, Inpatient` }),
    ],
  };
}

let tables: FakeTables = freshTables();

const ctx: ToolContext = {
  endpoint: 'candidate',
  access: {
    userId: 'user-fic-1',
    email: 'person@example.test',
    role: 'job_seeker',
    scopes: ['candidate'],
    resource: `${brand.baseUrl}/mcp`,
  } as ToolContext['access'],
  baseUrl: brand.baseUrl,
  ip: '203.0.113.9',
  requestMeta: undefined,
};

beforeEach(() => {
  vi.clearAllMocks();
  tables = freshTables();
  // Each call reads the current fixtures, so a test can replace rows.
  db.job.findMany.mockImplementation((args) => fakeModel('job', tables).findMany(args));
  db.job.findFirst.mockImplementation((args) => fakeModel('job', tables).findFirst(args));
  db.savedJob.upsert.mockResolvedValue({});
  db.savedJob.deleteMany.mockResolvedValue({ count: 1 });
});

async function idsOf(where: object): Promise<string[]> {
  const rows = await fakeModel('job', tables).findMany({ where, select: { id: true } });
  return rows.map((row) => String(row.id));
}

describe('the stand-in predicates', () => {
  const ALL = [PAID, COPY, OTHER, ENDED_PAID, COPY_OF_ENDED, EXPIRED_COPY, UNPUBLISHED_COPY, EASY_APPLY];

  it('find only live copies whose paid post the listings show', async () => {
    expect(await idsOf(copiesWithVisibleTwinWhere(ALL))).toEqual([COPY]);
  });

  it('lead from a copy to its paid post and nowhere else', async () => {
    expect(await idsOf(visibleTwinsOfCopiesWhere([COPY]))).toEqual([PAID]);
    // The paid post ended, or the copy itself is gone: nothing stands in.
    expect(await idsOf(visibleTwinsOfCopiesWhere([COPY_OF_ENDED]))).toEqual([]);
    expect(await idsOf(visibleTwinsOfCopiesWhere([EXPIRED_COPY]))).toEqual([]);
    expect(await idsOf(visibleTwinsOfCopiesWhere([UNPUBLISHED_COPY]))).toEqual([]);
    // A listing that is nobody's copy has no stand-in.
    expect(await idsOf(visibleTwinsOfCopiesWhere([OTHER]))).toEqual([]);
  });

  it('only ever stand in with a posting activeIndexableJobWhere lists, never with a copy', async () => {
    const visible = await idsOf(activeIndexableJobWhere());
    expect(visible).toEqual([PAID, OTHER, EASY_APPLY]);
    expect(visible).toContain((await idsOf(visibleTwinsOfCopiesWhere([COPY])))[0]);
  });
});

describe('findPublicJob, behind get_job, save_job and prepare_application', () => {
  it('answers a copy id or a pasted copy URL with the paid post', async () => {
    expect(await findPublicJob(COPY, { id: true, title: true })).toEqual({ id: PAID, title: TITLE });
    const pasted = `${brand.baseUrl}/jobs/np-outpatient-${COPY}?utm_source=chat`;
    expect(await findPublicJob(pasted, { id: true })).toEqual({ id: PAID });
  });

  it('selects the caller\'s fields on the paid post too', async () => {
    const card = await findPublicJob(COPY, JOB_CARD_SELECT);
    expect(Object.keys(card ?? {}).sort()).toEqual(Object.keys(JOB_CARD_SELECT).sort());
  });

  it('asks once for a live job and once more only after a miss', async () => {
    await findPublicJob(OTHER, { id: true });
    expect(db.job.findFirst).toHaveBeenCalledTimes(1);
    db.job.findFirst.mockClear();
    expect(await findPublicJob(EXPIRED_COPY, { id: true })).toBeNull();
    expect(await findPublicJob(COPY_OF_ENDED, { id: true })).toBeNull();
    expect(db.job.findFirst).toHaveBeenCalledTimes(4);
  });
});

describe('the saved list', () => {
  it('save_job on a copy saves the paid post', async () => {
    const outcome = await saveJob.run({ job_id: COPY }, ctx);
    expect(db.savedJob.upsert).toHaveBeenCalledWith({
      where: { userId_jobId: { userId: 'user-fic-1', jobId: PAID } },
      create: { userId: 'user-fic-1', jobId: PAID },
      update: {},
    });
    expect(outcome.structured).toEqual({ saved: true, jobId: PAID });
  });

  it('save_job still refuses a copy whose paid post has ended', async () => {
    await expect(saveJob.run({ job_id: COPY_OF_ENDED }, ctx)).rejects.toThrow(/no longer open/);
    expect(db.savedJob.upsert).not.toHaveBeenCalled();
  });

  it('unsave_job by a copy id also removes the paid post and rows held under the post\'s other copies', async () => {
    const outcome = await unsaveJob.run({ job_id: COPY }, ctx);
    // Only this account's rows are ever in reach.
    expect(db.savedJob.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-fic-1', jobId: { in: [COPY, PAID, EXPIRED_COPY, UNPUBLISHED_COPY] } },
    });
    expect(outcome.structured).toEqual({ saved: false, jobId: PAID });
  });

  it('list_saved_jobs shows a copy saved before its mark as the live paid post', async () => {
    db.savedJob.findMany.mockResolvedValue([{ jobId: COPY }, { jobId: OTHER }]);
    db.savedJob.count.mockResolvedValue(2);
    const outcome = await listSavedJobs.run({}, ctx);
    const view = outcome.structured as JobsViewData;
    expect(view.jobs.map((job) => job.id)).toEqual([PAID, OTHER]);
  });
});
