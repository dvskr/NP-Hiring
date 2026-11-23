/**
 * After SEEKER-25, the shared application service sends the employer's "new
 * application" email and the candidate's confirmation only for a new
 * application that passes the screening questions, and the employer's email
 * only when they have not switched it off. The candidate connector still
 * promised "The employer is emailed right away" (tool description and the
 * apply card) and, after a send, "The employer has been notified and the
 * person will get a confirmation email": untrue for a resubmission over a
 * live application and for an employer who turned notifications off.
 *
 * All fixtures are fictional; the application service is mocked.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { brand } from '@/config/brand';
import { MCP_PREFIX } from '@/lib/mcp/prefix';
import { useTestBoard } from '../../helpers/mcp-board';

const { db, pending, mocks } = vi.hoisted(() => {
  const pending = new Map<string, Record<string, unknown>>();
  const db = {
    job: { findFirst: vi.fn(), findUnique: vi.fn() },
    userProfile: { findUnique: vi.fn() },
    jobApplication: { findUnique: vi.fn() },
    jobScreeningQuestion: { findMany: vi.fn() },
    auditLog: { create: vi.fn(async () => ({})) },
    mcpPendingAction: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const payload = data.payload === undefined ? null : JSON.parse(JSON.stringify(data.payload));
        pending.set(String(data.id), { subjectId: null, result: null, consumedAt: null, ...data, payload });
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
  return { db, pending, mocks: { submitDirectApplication: vi.fn() } };
});

vi.mock('@/lib/prisma', () => ({ prisma: db }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/applications/submit-direct-application', () => ({
  MAX_COVER_LETTER_LENGTH: 5000,
  submitDirectApplication: mocks.submitDirectApplication,
}));

import { prepareApplication, submitApplication } from '@/lib/mcp/tools/candidate-apply';
import { renderApply, renderSubmitted } from '@/lib/mcp/widgets/src/views/apply';
import type { ToolContext } from '@/lib/mcp/server/types';
import type { ApplyViewData, JobCard } from '@/lib/mcp/widgets/src/contracts';

const JOB_ID = '11111111-2222-4333-8444-555555555555';
const jobRow = {
  id: JOB_ID, slug: `pmhnp-${JOB_ID}`, title: 'PMHNP', employer: 'Fictional Health', location: 'Austin, TX',
  city: 'Austin', state: 'Texas', stateCode: 'TX', isRemote: false, isHybrid: false, mode: 'In-Person',
  jobType: 'Full-Time', displaySalary: null, normalizedMinSalary: null, normalizedMaxSalary: null,
  salaryRange: null, salaryPeriod: null, minSalary: null, maxSalary: null, originalPostedAt: null,
  createdAt: new Date('2026-10-20T00:00:00Z'), experienceLabel: null, newGradFriendly: false, applyOnPlatform: true,
};
const BASE = brand.baseUrl;
const ctx: ToolContext = {
  endpoint: 'candidate',
  access: {
    grantId: 'grant-fic', clientId: 'client-fic', clientName: 'Claude', userId: 'user-fic-1',
    email: 'person@example.test', role: 'job_seeker', scopes: ['candidate'], resource: `${BASE}/mcp`,
  },
  baseUrl: BASE,
  ip: '203.0.113.9',
  requestMeta: undefined,
};
const EMAIL_PROMISE = /emailed right away|has been notified|confirmation email|confirmation is on its way/i;

beforeAll(() => {
  // The apply cards read the board they belong to.
  useTestBoard();
});

beforeEach(() => {
  vi.clearAllMocks();
  pending.clear();
  db.job.findFirst.mockResolvedValue(jobRow);
  db.userProfile.findUnique.mockResolvedValue({
    firstName: 'Avery', lastName: 'Example', email: 'person@example.test', headline: 'PMHNP',
    yearsExperience: 4, licenseStates: 'TX', certifications: 'PMHNP-BC', resumeUrl: 'uploads/user-fic-1/cv.pdf',
  });
  db.jobScreeningQuestion.findMany.mockResolvedValue([]);
  // Already applied on the website: the service updates the row and sends no email.
  db.jobApplication.findUnique.mockResolvedValue({ status: 'applied', withdrawnAt: null, consentGiven: true, sourceUrl: 'platform' });
  mocks.submitDirectApplication.mockResolvedValue({
    ok: true, applicationId: 'app-1', autoRejected: false, jobTitle: 'PMHNP', employerName: 'Fictional Health', hasResume: true,
  });
});

describe('the connector promises no email the service may not send', () => {
  it('the submit tool tells the assistant when the employer is emailed, not "right away"', () => {
    expect(submitApplication.description).not.toMatch(EMAIL_PROMISE);
    expect(submitApplication.description).toMatch(/meets its screening requirements, unless they have switched those emails off/);
  });

  it('after a send, the reply says where the application is, and claims no email', async () => {
    const prepared = await prepareApplication.run({ job_id: JOB_ID }, ctx);
    const reviewId = (prepared.structured as ApplyViewData).reviewId!;

    const outcome = await submitApplication.run({ review_id: reviewId, consent_to_share_profile: true }, ctx);

    expect(mocks.submitDirectApplication).toHaveBeenCalledTimes(1);
    expect(outcome.text).toContain("it is on the employer's applicant list now");
    expect(outcome.text).not.toMatch(EMAIL_PROMISE);
  });

  it('the apply card and its confirmation make no email promise either', () => {
    const job: JobCard = {
      id: JOB_ID, title: 'PMHNP', employer: 'Fictional Health', location: 'Austin, TX', workMode: 'In-Person',
      jobType: 'Full-Time', pay: null, postedAt: null, experience: null, easyApply: true, verifiedEmployer: false,
      url: `${BASE}/jobs/pmhnp-${JOB_ID}`,
    };
    const data: ApplyViewData = {
      view: 'apply', job, channel: 'assistant', websiteReason: null, reviewId: `${MCP_PREFIX}_rv_fictional`,
      profile: { name: 'Avery Example', email: 'avery@example.test', headline: null, yearsExperience: null, licenseStates: null, certifications: null, hasResume: true },
      questions: [], coverLetterDraft: '', coverLetterMax: 5000, warnings: [], existingStatus: 'applied',
      profileUrl: `${BASE}/settings`, resumeUrl: `${BASE}/settings`,
    };
    const form = renderApply(data, { coverLetter: '', answers: {}, consent: false, errors: {}, busy: null, formError: null }).__safe;
    const done = renderSubmitted({ view: 'apply', submitted: true, applicationId: 'a1', job, autoRejected: false, trackUrl: `${BASE}/my-applications` }).__safe;

    expect(form).toContain('Nothing is sent until you press Submit.');
    expect(form).not.toMatch(EMAIL_PROMISE);
    expect(done).toContain('is now with Fictional Health');
    expect(done).not.toMatch(EMAIL_PROMISE);
  });
});
