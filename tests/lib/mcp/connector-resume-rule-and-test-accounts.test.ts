/**
 * Two things the second live test of the job seeker connector (2026-11-13)
 * read as one missing guard.
 *
 * The resume rule. prepare_application refused a job that takes
 * applications here when the profile had no resume, and for a job on the
 * employer's own site said only "open the job page to apply there", while
 * get_my_profile said a resume was "required to apply". Read together that
 * was two rules. Both tools now state one rule in the same sentence, the
 * review says when a job is never sent the profile, and the profile check
 * says whether an application can be sent yet.
 *
 * Test accounts. A reviewer, or the owner, told to "apply to the first job
 * that takes applications here" sent a real application to a real employer.
 * An account the operator lists in MCP_TEST_ACCOUNTS has its application
 * checked like any other and then nothing is stored or sent, and every
 * surface says so. No caller can put an account on that list.
 *
 * The board's address and namespace are the active pack's. All fixtures are
 * fictional; the application service is mocked.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { brand } from '@/config/brand';
import { MCP_PREFIX } from '@/lib/mcp/prefix';
import { escapeRegExp, useTestBoard } from '../../helpers/mcp-board';

const { db, pending, service } = vi.hoisted(() => {
  const pending = new Map<string, Record<string, unknown>>();
  const db = {
    job: { findFirst: vi.fn(), findUnique: vi.fn() },
    userProfile: { findUnique: vi.fn() },
    jobApplication: { findUnique: vi.fn() },
    jobScreeningQuestion: { findMany: vi.fn() },
    auditLog: { create: vi.fn(async () => ({})) },
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
        // Stored as JSON, as the database would.
        Object.assign(row, JSON.parse(JSON.stringify(data)));
        return row;
      }),
    },
  };
  return { db, pending, service: { submitDirectApplication: vi.fn(), checkDirectApplication: vi.fn() } };
});
const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));

vi.mock('@/lib/prisma', () => ({ prisma: db }));
vi.mock('@/lib/logger', () => ({ logger: log }));
vi.mock('@/lib/applications/submit-direct-application', () => ({
  MAX_COVER_LETTER_LENGTH: 5000,
  submitDirectApplication: service.submitDirectApplication,
  checkDirectApplication: service.checkDirectApplication,
}));

import { PROFILE_NOT_SENT, RESUME_RULE, prepareApplication, submitApplication } from '@/lib/mcp/tools/candidate-apply';
import { getMyProfile } from '@/lib/mcp/tools/candidate-extras';
import { isTestAccount } from '@/lib/mcp/server/test-accounts';
import { CANDIDATE_ENDPOINT } from '@/lib/mcp/endpoints/candidate';
import { renderApply, renderSubmitted } from '@/lib/mcp/widgets/src/views/apply';
import type { ToolContext } from '@/lib/mcp/server/types';
import type { ApplyViewData, FactsViewData, SubmittedApplicationData } from '@/lib/mcp/widgets/src/contracts';

const JOB_ID = '11111111-2222-4333-8444-555555555555';
const BASE = brand.baseUrl;
const TESTER = 'reviewer@example.test';
const REVIEW_ID = new RegExp(`^${escapeRegExp(MCP_PREFIX)}_rv_`);

const jobRow = (overrides: Record<string, unknown> = {}) => ({
  id: JOB_ID, slug: `pmhnp-${JOB_ID}`, title: 'PMHNP', employer: 'Fictional Health', location: 'Austin, TX',
  city: 'Austin', state: 'Texas', stateCode: 'TX', isRemote: false, isHybrid: false, mode: 'In-Person',
  jobType: 'Full-Time', displaySalary: null, normalizedMinSalary: null, normalizedMaxSalary: null,
  salaryRange: null, salaryPeriod: null, minSalary: null, maxSalary: null, salaryIsEstimated: false,
  sourceType: 'employer', originalPostedAt: null, createdAt: new Date('2026-10-20T00:00:00Z'),
  experienceLabel: null, newGradFriendly: false, applyOnPlatform: true, isVerifiedEmployer: false,
  ...overrides,
});

const profileRow = (overrides: Record<string, unknown> = {}) => ({
  firstName: 'Avery', lastName: 'Example', email: 'person@example.test', headline: 'PMHNP',
  yearsExperience: 4, licenseStates: 'TX', certifications: 'PMHNP-BC', resumeUrl: 'uploads/user-fic-1/cv.pdf',
  ...overrides,
});

function ctx(email = 'person@example.test'): ToolContext {
  return {
    endpoint: 'candidate',
    access: {
      grantId: 'grant-fic', clientId: 'client-fic', clientName: 'Claude', userId: 'user-fic-1',
      email, role: 'job_seeker', scopes: ['candidate'], resource: `${BASE}/mcp`,
    },
    baseUrl: BASE,
    ip: '203.0.113.9',
    requestMeta: undefined,
  };
}

const review = async (context = ctx()) => {
  const outcome = await prepareApplication.run({ job_id: JOB_ID }, context);
  return { text: outcome.text, view: outcome.structured as ApplyViewData };
};

beforeAll(() => {
  // The apply cards read the board they belong to.
  useTestBoard();
});

beforeEach(() => {
  vi.clearAllMocks();
  pending.clear();
  delete process.env.MCP_TEST_ACCOUNTS;
  db.job.findFirst.mockResolvedValue(jobRow());
  db.job.findUnique.mockResolvedValue(jobRow());
  db.userProfile.findUnique.mockResolvedValue(profileRow());
  db.jobApplication.findUnique.mockResolvedValue(null);
  db.jobScreeningQuestion.findMany.mockResolvedValue([]);
  service.submitDirectApplication.mockResolvedValue({
    ok: true, applicationId: 'app-1', autoRejected: false, jobTitle: 'PMHNP', employerName: 'Fictional Health', hasResume: true,
  });
  service.checkDirectApplication.mockResolvedValue({ ok: true, jobTitle: 'PMHNP', employerName: 'Fictional Health' });
});

afterEach(() => {
  delete process.env.MCP_TEST_ACCOUNTS;
});

// ── One resume rule ──────────────────────────────────────────────────────────

describe('the resume rule reads the same in the review and in the profile check', () => {
  it('a job that takes applications here, and no resume: the rule, no review, and where to upload one', async () => {
    db.userProfile.findUnique.mockResolvedValue(profileRow({ resumeUrl: null }));
    const { text, view } = await review();

    expect(view.channel).toBe('website');
    expect(view.reviewId).toBeNull();
    expect(pending.size).toBe(0);
    expect(text).toContain(RESUME_RULE);
    expect(text).toContain('No review was issued');
    expect(text).toContain(`Upload a resume: ${BASE}/settings`);
    expect(text).not.toMatch(/can still apply/i);
  });

  it('the profile check says the same sentence, and that nothing can be sent yet', async () => {
    db.userProfile.findUnique.mockResolvedValue(profileRow({ resumeUrl: null }));
    const outcome = await getMyProfile.run({}, ctx());
    const card = outcome.structured as FactsViewData;

    expect(outcome.text).toContain(RESUME_RULE);
    expect(outcome.text).toMatch(/Can an application be sent from this conversation now: no\./);
    expect(card.title).toBe('A resume is needed before you can apply here');
    const needed = card.sections.find((section) => section.heading === 'Needed before you can apply')!;
    expect(needed.rows).toHaveLength(1);
    expect(needed.rows[0]).toMatchObject({ label: 'Resume', emphasis: true });
    expect(needed.rows[0].value).toContain(RESUME_RULE);
    // A requirement is not listed as something merely worth adding.
    const worthAdding = card.sections.find((section) => section.heading === 'Worth adding')!;
    expect(worthAdding.rows.map((row) => row.label)).not.toContain('Resume');
  });

  it('with a resume on file the profile check says an application can be sent, and needs nothing', async () => {
    const outcome = await getMyProfile.run({}, ctx());
    const card = outcome.structured as FactsViewData;
    expect(outcome.text).toMatch(/Can an application be sent from this conversation now: yes/);
    expect(card.title).toBe('Ready to apply');
    expect(card.sections.find((section) => section.heading === 'Needed before you can apply')!.rows).toEqual([]);
  });

  it('a job on the employer\'s own site is never sent the profile, and the review says so whatever the profile holds', async () => {
    db.job.findFirst.mockResolvedValue(jobRow({ applyOnPlatform: false, sourceType: 'external' }));
    for (const resumeUrl of [null, 'uploads/user-fic-1/cv.pdf']) {
      db.userProfile.findUnique.mockResolvedValue(profileRow({ resumeUrl }));
      const { text, view } = await review();
      expect(view.channel).toBe('website');
      expect(view.reviewId).toBeNull();
      expect(text).toContain('This employer takes applications on its own site.');
      expect(text).toContain(PROFILE_NOT_SENT);
      // The missing resume is not what stands in the way of this job.
      expect(text).not.toContain('Upload a resume');
      expect(text).not.toContain(RESUME_RULE);
    }
  });

  it('the profile check says the same about jobs on an employer\'s own site', async () => {
    const outcome = await getMyProfile.run({}, ctx());
    expect(outcome.text).toContain(PROFILE_NOT_SENT);
    expect((outcome.structured as FactsViewData).notes).toContain(PROFILE_NOT_SENT);
  });

  it('a review that is issued always has a resume to name', async () => {
    const { text, view } = await review();
    expect(view.channel).toBe('assistant');
    expect(view.reviewId).toMatch(REVIEW_ID);
    expect(text).toContain('and the resume on file');
    expect(text).not.toContain('and no resume');
  });

  it('both tools and the instructions tell the model the rule before it calls anything', () => {
    expect(prepareApplication.description).toMatch(/without one no review_id is issued/);
    expect(getMyProfile.description).toMatch(/whether an application can be sent from this conversation yet/);
    expect(CANDIDATE_ENDPOINT.instructions).toMatch(/never offer to send without it/);
    expect(CANDIDATE_ENDPOINT.instructions).toMatch(/not sent for a job on the employer's own site/);
  });
});

// ── Test accounts ────────────────────────────────────────────────────────────

describe('which accounts are test accounts', () => {
  it('is nobody unless the operator lists an account', () => {
    expect(isTestAccount({ email: TESTER, userId: 'user-fic-1' })).toBe(false);
    for (const empty of ['', ' ', ',', ' , ; ']) {
      process.env.MCP_TEST_ACCOUNTS = empty;
      expect(isTestAccount({ email: TESTER, userId: 'user-fic-1' }), JSON.stringify(empty)).toBe(false);
      // An account with nothing to match is not matched by a list with nothing in it.
      expect(isTestAccount({ email: '', userId: '' })).toBe(false);
      expect(isTestAccount({ email: null, userId: null })).toBe(false);
      expect(isTestAccount({})).toBe(false);
    }
  });

  it('matches a listed address exactly, whatever its capitals or the separators around it', () => {
    process.env.MCP_TEST_ACCOUNTS = ' Reviewer@Example.test, second@example.test;third@example.test\nfourth@example.test ';
    for (const email of [TESTER, 'REVIEWER@EXAMPLE.TEST', ' second@example.test ', 'third@example.test', 'fourth@example.test']) {
      expect(isTestAccount({ email }), email).toBe(true);
    }
    // Part of a listed address, or an address that contains one, is not listed.
    for (const email of ['viewer@example.test', 'reviewer@example.test.evil.example', 'example.test', '@', '*']) {
      expect(isTestAccount({ email }), email).toBe(false);
    }
  });

  it('matches a listed account id, which is the entry that cannot change under an account', () => {
    process.env.MCP_TEST_ACCOUNTS = 'A1B2C3D4-0000-4000-8000-000000000001';
    expect(isTestAccount({ email: 'anyone@example.test', userId: 'a1b2c3d4-0000-4000-8000-000000000001' })).toBe(true);
    expect(isTestAccount({ email: 'anyone@example.test', userId: 'a1b2c3d4-0000-4000-8000-000000000002' })).toBe(false);
    // An address is never read as an id, nor an id as an address.
    expect(isTestAccount({ email: 'a1b2c3d4-0000-4000-8000-000000000001@example.test', userId: 'other' })).toBe(false);
  });

  it('cannot be set by anything a tool call carries', () => {
    for (const tool of [prepareApplication, submitApplication]) {
      for (const field of Object.keys(tool.input)) expect(field, `${tool.name}.${field}`).not.toMatch(/test|dry|sandbox|mode/i);
    }
  });
});

describe('a test account\'s application', () => {
  const submit = async (context: ToolContext) => {
    const prepared = await review(context);
    const outcome = await submitApplication.run(
      { review_id: prepared.view.reviewId!, consent_to_share_profile: true, cover_letter: 'A short letter.' },
      context,
    );
    return { prepared, outcome, data: outcome.structured as SubmittedApplicationData };
  };

  it('is checked and never sent: the shared write is not called, and nothing is audited as an application', async () => {
    process.env.MCP_TEST_ACCOUNTS = TESTER;
    const { outcome, data } = await submit(ctx(TESTER));

    expect(service.checkDirectApplication).toHaveBeenCalledTimes(1);
    // Checked exactly as a real one is sent, the resume rule included.
    expect(service.checkDirectApplication.mock.calls[0][0]).toMatchObject({
      userId: 'user-fic-1', jobId: JOB_ID, consent: true, coverLetter: 'A short letter.', requireResume: true,
    });
    expect(service.submitDirectApplication).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
    expect(data).toMatchObject({ view: 'apply', submitted: true, test: true, applicationId: null, autoRejected: false });
    expect(outcome.text).toMatch(/^Test only: nothing was sent to Fictional Health and no application was stored\./);
    expect(outcome.text).not.toMatch(/Application sent|applicant list now/);
  });

  it('says so on the review before anything is pressed, and on the card after', async () => {
    process.env.MCP_TEST_ACCOUNTS = TESTER;
    const { prepared, data } = await submit(ctx(TESTER));

    expect(prepared.view.testAccount).toBe(true);
    expect(prepared.text).toMatch(/This is a test account: an application from it is checked exactly as any other, and then nothing is stored and the employer receives nothing\./);
    const form = renderApply(prepared.view, { coverLetter: '', answers: {}, consent: false, errors: {}, busy: null, formError: null }).__safe;
    expect(form).toContain('This is a test account.');
    expect(form).toContain('Check the application');
    expect(form).not.toContain('Submit application');
    const done = renderSubmitted(data).__safe;
    expect(done).toContain('Test only: nothing was sent');
    expect(done).not.toMatch(/Application sent|is now with/);
  });

  it('is refused for the same reasons a real one is, and the review can then be used again', async () => {
    process.env.MCP_TEST_ACCOUNTS = TESTER;
    service.checkDirectApplication.mockResolvedValueOnce({ ok: false, status: 400, error: 'Please answer the required screening questions' });
    const prepared = await review(ctx(TESTER));
    const args = { review_id: prepared.view.reviewId!, consent_to_share_profile: true as const };

    await expect(submitApplication.run(args, ctx(TESTER))).rejects.toThrow('Nothing was sent. Please answer the required screening questions.');
    const second = await submitApplication.run(args, ctx(TESTER));
    expect((second.structured as SubmittedApplicationData).test).toBe(true);
  });

  it('answers a repeated call from the same review as the same test, with nothing checked twice', async () => {
    process.env.MCP_TEST_ACCOUNTS = TESTER;
    const { prepared } = await submit(ctx(TESTER));
    const again = await submitApplication.run({ review_id: prepared.view.reviewId!, consent_to_share_profile: true }, ctx(TESTER));

    expect((again.structured as SubmittedApplicationData).test).toBe(true);
    expect(again.text).toMatch(/^Test only: nothing was sent/);
    expect(service.checkDirectApplication).toHaveBeenCalledTimes(1);
    expect(service.submitDirectApplication).not.toHaveBeenCalled();
  });

  it('leaves a line in the log that the test ran, with no applicant text in it', async () => {
    process.env.MCP_TEST_ACCOUNTS = TESTER;
    await submit(ctx(TESTER));
    const line = log.info.mock.calls.find((call) => /test application/i.test(String(call[0])));
    expect(line).toBeDefined();
    expect(JSON.stringify(line)).not.toMatch(/A short letter|Avery|example\.test/);
  });

  it('does not change anything for an account that is not listed', async () => {
    process.env.MCP_TEST_ACCOUNTS = TESTER;
    const { prepared, outcome, data } = await submit(ctx('person@example.test'));

    expect(prepared.view.testAccount).toBeUndefined();
    expect(prepared.text).not.toMatch(/test account/i);
    expect(service.submitDirectApplication).toHaveBeenCalledTimes(1);
    expect(service.checkDirectApplication).not.toHaveBeenCalled();
    expect(data.test).toBeUndefined();
    expect(data.applicationId).toBe('app-1');
    expect(outcome.text).toContain("it is on the employer's applicant list now");
  });

  it('is not offered a test of a job it could not apply to anyway', async () => {
    process.env.MCP_TEST_ACCOUNTS = TESTER;
    db.job.findFirst.mockResolvedValue(jobRow({ applyOnPlatform: false, sourceType: 'external' }));
    const { text, view } = await review(ctx(TESTER));
    expect(view.testAccount).toBeUndefined();
    expect(text).not.toMatch(/test account/i);
  });

  it('is described to the model in the instructions', () => {
    expect(CANDIDATE_ENDPOINT.instructions).toMatch(/test account, tell the person that submitting checks the application and delivers nothing/);
  });
});
