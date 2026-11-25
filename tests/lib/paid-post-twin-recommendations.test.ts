/**
 * Stored recommendation batches can predate a listing's mark as a free copy
 * of a live paid post (lib/paid-post-twins.ts). The listings hide the copy
 * and its URL redirects, so the candidate dashboard's AI panel, its
 * rule-based fallback and the weekly digest email skip it too.
 *
 * The where clauses run for real against fixture rows
 * (tests/helpers/fake-prisma-where.ts). Every name is fictional.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db, mocks } = vi.hoisted(() => ({
  db: {
    job: { findMany: vi.fn() },
    candidateRecommendation: { findFirst: vi.fn(), findMany: vi.fn() },
    userProfile: { findUnique: vi.fn() },
    jobApplication: { count: vi.fn(), findMany: vi.fn() },
    jobAlert: { count: vi.fn() },
    emailLead: { findUnique: vi.fn() },
    employerMessage: { count: vi.fn() },
    profileView: { count: vi.fn() },
    $queryRawUnsafe: vi.fn(),
  },
  mocks: { sendAndLog: vi.fn(), aiEnabled: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ prisma: db }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'cand-1', email: 'person@example.test' } }, error: null }) },
  }),
}));
vi.mock('@/lib/ai/feature-flags', () => ({ isAiFeatureEnabled: mocks.aiEnabled }));
// Hands back the handler, so the weekly digest can run with a pass-through step.
vi.mock('@/lib/inngest/client', () => ({
  inngest: {
    createFunction: (config: unknown, handler: unknown) => ({ config, handler }),
    send: vi.fn(async () => undefined),
  },
}));
vi.mock('@/lib/email-service', () => ({ sendAndLog: mocks.sendAndLog }));
vi.mock('@/lib/outbound-kill-switch', () => ({ isOutboundPaused: () => false }));
vi.mock('@/lib/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/env')>()),
  getBaseUrl: () => 'https://board.example',
}));

import { fakeModel, type FakeTables, type Row } from '../helpers/fake-prisma-where';
import { GET as dashboardGET } from '@/app/api/dashboard/route';
import { recommendationDigestWeekly } from '@/lib/inngest/functions/recommendation-digest';

const DAY_MS = 24 * 60 * 60 * 1000;
const LATER = new Date(Date.now() + 30 * DAY_MS);

const PAID = '11111111-1111-4111-8111-111111111111';
const COPY = '22222222-2222-4222-8222-222222222222';
const LIVE = '33333333-3333-4333-8333-333333333333';

function listing(id: string, title: string, overrides: Row = {}): Row {
  return {
    id,
    slug: `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${id}`,
    title,
    employer: 'Example Wellness Group',
    location: 'Austin, TX',
    state: 'Texas',
    stateCode: 'TX',
    isRemote: false,
    isHybrid: false,
    displaySalary: null,
    salaryRange: null,
    normalizedMinSalary: null,
    normalizedMaxSalary: null,
    salaryPeriod: null,
    isPublished: true,
    expiresAt: LATER,
    shadowedByJobId: null,
    employerJobs: null,
    ...overrides,
  };
}

/** One rec per job, best rank first, as a batch is stored. */
function batch(supabaseId: string, jobIds: string[]): Row[] {
  return jobIds.map((jobId, index) => ({
    id: `rec-${supabaseId}-${jobId.slice(0, 4)}`,
    supabaseId,
    jobId,
    batchId: 'batch-fic',
    rank: index + 1,
    tier: 'external',
    dismissedAt: null,
    clickedAt: null,
    createdAt: new Date(Date.now() - DAY_MS),
  }));
}

let tables: FakeTables;

beforeEach(() => {
  vi.clearAllMocks();
  tables = {
    jobs: [
      listing(PAID, 'NP Outpatient', { sourceType: 'employer' }),
      listing(COPY, 'NP Outpatient', { shadowedByJobId: PAID }),
      listing(LIVE, 'NP Telehealth', { employer: 'Acme Health Group', isRemote: true }),
    ],
    // The batch was written before the copy was marked, so it holds the copy.
    recommendations: batch('cand-1', [COPY, LIVE]),
  };
  db.candidateRecommendation.findMany.mockImplementation((args) => fakeModel('candidateRecommendation', tables).findMany(args));
  db.candidateRecommendation.findFirst.mockResolvedValue({ batchId: 'batch-fic' });
  db.job.findMany.mockImplementation((args) => fakeModel('job', tables).findMany(args));
  db.userProfile.findUnique.mockResolvedValue(null);
  db.jobApplication.count.mockResolvedValue(0);
  db.jobApplication.findMany.mockResolvedValue([]);
  db.jobAlert.count.mockResolvedValue(0);
  db.emailLead.findUnique.mockResolvedValue(null);
  mocks.aiEnabled.mockResolvedValue(true);
  mocks.sendAndLog.mockResolvedValue({ success: true });
});

async function recommendedIds(): Promise<string[]> {
  const response = await dashboardGET(new Request('http://localhost:3000/api/dashboard'));
  expect(response.status).toBe(200);
  const data = await response.json() as { recommendedJobs: Array<{ id: string }> };
  return data.recommendedJobs.map((job) => job.id);
}

describe('stored recommendation batches skip a copy marked after they were written', () => {
  it('the dashboard AI panel', async () => {
    expect(await recommendedIds()).toEqual([LIVE]);
  });

  it('the dashboard\'s rule-based fallback', async () => {
    mocks.aiEnabled.mockResolvedValue(false);
    const ids = await recommendedIds();
    expect(ids).not.toContain(COPY);
    expect(ids).toEqual(expect.arrayContaining([PAID, LIVE]));
  });

  it('the weekly digest email', async () => {
    db.$queryRawUnsafe.mockResolvedValue([
      { supabase_id: 'cand-1', email: 'person@example.test', first_name: 'Avery', unsubscribe_token: 'tok-fic' },
    ]);
    const digest = recommendationDigestWeekly as unknown as {
      handler: (input: { step: { run: (id: string, fn: () => unknown) => unknown } }) => Promise<{ sent: number }>;
    };
    const result = await digest.handler({ step: { run: async (_id, fn) => fn() } });

    expect(result.sent).toBe(1);
    const [email, , meta] = mocks.sendAndLog.mock.calls[0] as [{ html: string }, string, { recIds: string[] }];
    expect(email.html).toContain(LIVE);
    expect(email.html).not.toContain(COPY);
    expect(meta.recIds).toEqual(['rec-cand-1-3333']);
  });
});
