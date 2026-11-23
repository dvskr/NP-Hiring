/**
 * RELIAB-05 in the job seeker connector: the audit row written after an
 * assistant sends an application was started and never awaited, so a
 * function frozen after the reply lost it. It is now registered with
 * runAfterResponse (lib/after-response.ts), which keeps the invocation alive
 * until it settles. (The employer connector's two audit rows, for moving an
 * applicant and adding a note, are tested with that connector, which this
 * engine does not have yet.)
 *
 * runAfterResponse is replaced here by a recorder that does NOT run the task,
 * so the test sees that the write was handed over rather than fired and
 * dropped, then runs it. All fixtures are fictional.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { brand } from '@/config/brand';

const { db, pending, mocks, registered } = vi.hoisted(() => {
  const pending = new Map<string, Record<string, unknown>>();
  const registered: Array<{ label: string; task: () => unknown }> = [];
  const db = {
    auditLog: { create: vi.fn(async (_args: { data: Record<string, unknown> }) => ({})) },
    job: { findFirst: vi.fn(), findUnique: vi.fn() },
    userProfile: { findUnique: vi.fn() },
    jobApplication: { findUnique: vi.fn() },
    jobScreeningQuestion: { findMany: vi.fn(async () => []) },
    mcpPendingAction: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        pending.set(String(data.id), { subjectId: null, result: null, consumedAt: null, payload: null, ...data });
        return data;
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = pending.get(where.id);
        return row ? { ...row } : null;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; consumedAt?: null }; data: Record<string, unknown> }) => {
        const row = pending.get(where.id);
        if (!row || ('consumedAt' in where && row.consumedAt !== null)) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = pending.get(where.id)!;
        Object.assign(row, JSON.parse(JSON.stringify(data)));
        return row;
      }),
    },
  };
  const mocks = {
    submitDirectApplication: vi.fn(),
  };
  return { db, pending, mocks, registered };
});

vi.mock('@/lib/prisma', () => ({ prisma: db }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/after-response', () => ({
  runAfterResponse: (label: string, task: () => unknown) => { registered.push({ label, task }); },
}));
vi.mock('@/lib/applications/submit-direct-application', () => ({
  MAX_COVER_LETTER_LENGTH: 5000,
  submitDirectApplication: mocks.submitDirectApplication,
}));

import { prepareApplication, submitApplication } from '@/lib/mcp/tools/candidate-apply';
import type { ToolContext } from '@/lib/mcp/server/types';
import type { ApplyViewData } from '@/lib/mcp/widgets/src/contracts';

const JOB_ID = '11111111-2222-4333-8444-555555555555';

function ctx(role: string): ToolContext {
  return {
    endpoint: 'candidate',
    access: {
      grantId: 'grant-fic', clientId: 'client-fic', clientName: 'Claude', userId: 'user-fic-1',
      email: 'person@example.test', role, scopes: ['candidate'],
      resource: `${brand.baseUrl}/mcp`,
    },
    baseUrl: brand.baseUrl,
    ip: '203.0.113.9',
    requestMeta: undefined,
  };
}

/** The audit write was handed over, not run; running it writes the row. */
async function expectDeferredAudit(action: string) {
  expect(db.auditLog.create).not.toHaveBeenCalled();
  expect(registered).toHaveLength(1);
  await registered[0].task();
  expect(db.auditLog.create).toHaveBeenCalledTimes(1);
  expect(db.auditLog.create.mock.calls[0][0]).toMatchObject({ data: { action } });
}

beforeEach(() => {
  vi.clearAllMocks();
  pending.clear();
  registered.length = 0;
});

describe('connector audit rows outlive the reply', () => {
  it('submit_application', async () => {
    db.job.findFirst.mockResolvedValue({
      id: JOB_ID, slug: `pmhnp-${JOB_ID}`, title: 'PMHNP', employer: 'Fictional Health', location: 'Austin, TX',
      city: 'Austin', state: 'Texas', stateCode: 'TX', isRemote: false, isHybrid: false, mode: 'In-Person',
      jobType: 'Full-Time', displaySalary: null, normalizedMinSalary: null, normalizedMaxSalary: null,
      salaryRange: null, salaryPeriod: null, minSalary: null, maxSalary: null, originalPostedAt: null,
      createdAt: new Date('2026-10-20T00:00:00Z'), experienceLabel: null, newGradFriendly: false, applyOnPlatform: true,
    });
    db.userProfile.findUnique.mockResolvedValue({
      firstName: 'Avery', lastName: 'Example', email: 'person@example.test', headline: 'PMHNP',
      yearsExperience: 4, licenseStates: 'TX', certifications: 'PMHNP-BC', resumeUrl: 'uploads/user-fic-1/cv.pdf',
    });
    db.jobApplication.findUnique.mockResolvedValue(null);
    mocks.submitDirectApplication.mockResolvedValue({
      ok: true, applicationId: 'app-1', autoRejected: false, jobTitle: 'PMHNP', employerName: 'Fictional Health', hasResume: true,
    });
    const prepared = await prepareApplication.run({ job_id: JOB_ID }, ctx('job_seeker'));

    await submitApplication.run(
      { review_id: (prepared.structured as ApplyViewData).reviewId!, consent_to_share_profile: true },
      ctx('job_seeker'),
    );

    await expectDeferredAudit('application.submit.assistant');
  });
});
