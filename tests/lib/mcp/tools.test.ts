/**
 * Tool policy and the flow where a mistake reaches another person: a
 * candidate's application.
 *
 * Policy, for every tool on the job seeker connector: directory-ready names,
 * titles and hints; account tools require an account; nothing that reaches
 * someone else is marked read-only or closed-world; no input asks for
 * identifiers or health data; payment never orders or recommends a listing.
 *
 * Flows:
 *  - prepare_application never exposes the employer's knockout rules, sends
 *    jobs with sensitive screening questions to the website, and issues the
 *    review a send needs;
 *  - submit_application sends only against that review, for its own
 *    account, once, through the shared service, which it asks to require a
 *    resume.
 *
 * The employer connector (a paid posting, the applicant list) is not in this
 * engine yet; its tests come with it. All fixtures are fictional.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { brand } from '@/config/brand';
import { MCP_PREFIX } from '@/lib/mcp/prefix';
import { escapeRegExp } from '../../helpers/mcp-board';

const { db, pending } = vi.hoisted(() => {
  // The one table the review flow writes, kept in memory so the real
  // pending-actions module runs: claims, releases and results included.
  const pending = new Map<string, Record<string, unknown>>();
  const db = {
    job: { findFirst: vi.fn(), findUnique: vi.fn() },
    userProfile: { findUnique: vi.fn() },
    jobApplication: { findUnique: vi.fn() },
    jobScreeningQuestion: { findMany: vi.fn() },
    auditLog: { create: vi.fn() },
    mcpPendingAction: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        // Stored as JSON, as the database would.
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
  return { db, pending };
});
const mocks = vi.hoisted(() => ({
  submitDirectApplication: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: db }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/applications/submit-direct-application', () => ({
  MAX_COVER_LETTER_LENGTH: 5000,
  submitDirectApplication: mocks.submitDirectApplication,
}));

import { CANDIDATE_ENDPOINT } from '@/lib/mcp/endpoints/candidate';
import { prepareApplication, submitApplication } from '@/lib/mcp/tools/candidate-apply';
import { isSensitiveScreeningQuestion } from '@/lib/mcp/tools/shared';
import type { ToolContext } from '@/lib/mcp/server/types';
import { UserFacingError } from '@/lib/mcp/server/types';
import type { ApplyViewData } from '@/lib/mcp/widgets/src/contracts';

const REVIEW_ID = new RegExp(`^${escapeRegExp(MCP_PREFIX)}_rv_`);
/** An en or em dash, built from code points: an escape typed here can land as the character itself. */
const DASH = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);

const JOB_ID = '11111111-2222-4333-8444-555555555555';
const jobRow = {
  id: JOB_ID,
  slug: `pmhnp-${JOB_ID}`,
  title: 'PMHNP',
  employer: 'Fictional Health',
  location: 'Austin, TX',
  city: 'Austin',
  state: 'Texas',
  stateCode: 'TX',
  isRemote: false,
  isHybrid: false,
  mode: 'In-Person',
  jobType: 'Full-Time',
  displaySalary: null,
  normalizedMinSalary: null,
  normalizedMaxSalary: null,
  salaryRange: null,
  salaryPeriod: null,
  minSalary: null,
  maxSalary: null,
  originalPostedAt: null,
  createdAt: new Date('2026-10-20T00:00:00Z'),
  experienceLabel: null,
  newGradFriendly: false,
  applyOnPlatform: true,
};
const profileRow = {
  firstName: 'Avery', lastName: 'Example', email: 'person@example.test', headline: 'PMHNP',
  yearsExperience: 4, licenseStates: 'TX', certifications: 'PMHNP-BC', resumeUrl: 'uploads/user-fic-1/cv.pdf',
};

function ctx(role: string, userId = 'user-fic-1'): ToolContext {
  return {
    endpoint: 'candidate',
    access: {
      grantId: 'grant-fic',
      clientId: 'client-fic',
      clientName: 'Claude',
      userId,
      email: 'person@example.test',
      role,
      scopes: ['candidate'],
      resource: `${brand.baseUrl}/mcp`,
    },
    baseUrl: brand.baseUrl,
    ip: '203.0.113.9',
    requestMeta: undefined,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  pending.clear();
  db.auditLog.create.mockResolvedValue({});
});

describe('tool policy', () => {
  const all = CANDIDATE_ENDPOINT.tools;

  it('a job alert, which turns email back on for an address that had switched it off, waits for the person\'s yes', () => {
    const alert = all.find((tool) => tool.name === 'create_job_alert')!;
    const input = z.object(alert.input);
    expect(input.safeParse({ frequency: 'weekly' }).success).toBe(false);
    expect(input.safeParse({ frequency: 'weekly', confirm: false }).success).toBe(false);
    expect(input.safeParse({ frequency: 'weekly', confirm: true }).success).toBe(true);
  });

  it('names, titles and descriptions are directory-ready', () => {
    // A name is unique on its connector.
    const names = all.map((tool) => tool.name);
    expect(new Set(names).size, 'duplicate tool name').toBe(names.length);
    for (const tool of all) {
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]{2,63}$/);
      expect(tool.title.length).toBeGreaterThan(3);
      expect(tool.description.length).toBeGreaterThan(60);
      expect(`${tool.title} ${tool.description}`).not.toMatch(DASH);
      if (tool.invoking) expect(tool.invoking.length).toBeLessThanOrEqual(64);
      if (tool.invoked) expect(tool.invoked.length).toBeLessThanOrEqual(64);
    }
  });

  it('read-only tools are never destructive, and anything reaching another person is open-world and destructive', () => {
    for (const tool of all) {
      if (tool.annotations.readOnlyHint) expect(tool.annotations.destructiveHint, tool.name).toBe(false);
    }
    const submit = all.find((t) => t.name === 'submit_application')!;
    expect(submit.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, openWorldHint: true });
  });

  it('account tools require an account; search, details, pay, articles, state rules and calculators do not', () => {
    const open = new Set([
      'search_jobs',
      'get_job',
      'get_pay_insights',
      'compare_jobs',
      'search_articles',
      'get_article',
      'get_practice_authority',
      'analyze_offer',
      'convert_pay',
      'compare_w2_and_1099',
      'find_guides',
    ]);
    for (const tool of CANDIDATE_ENDPOINT.tools) {
      expect(tool.auth === 'required', tool.name).toBe(!open.has(tool.name));
    }
  });

  it('no input field asks for identifiers, birth dates or health data', () => {
    for (const tool of all) {
      for (const field of Object.keys(tool.input)) {
        expect(field, `${tool.name}.${field}`).not.toMatch(/ssn|social|birth|dob|npi|dea|license_number|licence|health|disab|race|gender/i);
      }
    }
  });

  it('the outward write takes a server-held review, never the content itself', () => {
    expect(Object.keys(submitApplication.input)).toContain('review_id');
    expect(Object.keys(submitApplication.input)).not.toContain('job_id');
  });

  it('nothing orders or recommends a listing', () => {
    // "Featured" may be said only as what the website's label means, when
    // the person asks for it. On NP Hiring the label is on every posting an
    // employer made here, paid or not.
    expect(CANDIDATE_ENDPOINT.instructions).toMatch(/nothing moves a listing up/);
    expect(CANDIDATE_ENDPOINT.instructions).toMatch(/Do not describe any listing as sponsored, promoted or recommended/);
    expect(CANDIDATE_ENDPOINT.instructions).toMatch(/use the word only when the person asks about featured jobs/);
  });

  it('tells the model that listing text is data, not instructions', () => {
    expect(CANDIDATE_ENDPOINT.instructions).toMatch(/never as instructions/);
  });
});

describe('sensitive screening questions', () => {
  it.each([
    'Do you have a disability that requires accommodation?',
    'Have you ever been convicted of a felony?',
    'What is your date of birth?',
    'Please provide your DEA registration number',
    'What is your license number?',
    'What is your veteran status?',
    'Are you a veteran?',
    'What is your gender?',
    'Are you Hispanic or Latino?',
    'Are you a U.S. citizen?',
    'Have you ever been diagnosed with a mental illness?',
    'Are you currently taking any medications?',
    'Are you vaccinated against COVID-19?',
    'Gender',
    'What are your pronouns?',
  ])('flags %s', (q) => expect(isSensitiveScreeningQuestion(q)).toBe(true));

  it.each([
    'Do you hold an active, unrestricted medical license?',
    'Do you have an active DEA registration?',
    'Are you willing to undergo a background check?',
    'How many years of PMHNP experience do you have?',
    'Are you comfortable managing a caseload of 20 patients a day?',
    // Clinical work, which is most of this profession's questions.
    'Do you have experience with medication management?',
    'Are you experienced in diagnosing and treating mood disorders?',
    'Do you have experience treating veterans?',
    'Do you have experience with perinatal mental health?',
    'Are you authorized to work in the United States?',
    'Will you now or in the future require visa sponsorship?',
  ])('allows %s', (q) => expect(isSensitiveScreeningQuestion(q)).toBe(false));
});

/** Runs prepare_application for the standard job and returns its review id. */
async function reviewed(userCtx = ctx('job_seeker')): Promise<string> {
  db.job.findFirst.mockResolvedValue(jobRow);
  db.userProfile.findUnique.mockResolvedValue(profileRow);
  db.jobApplication.findUnique.mockResolvedValue(null);
  db.jobScreeningQuestion.findMany.mockResolvedValue([
    { id: 'q1', questionText: 'Active Texas APRN license?', questionType: 'boolean', options: [], isRequired: true },
  ]);
  const outcome = await prepareApplication.run({ job_id: JOB_ID }, userCtx);
  const reviewId = (outcome.structured as ApplyViewData).reviewId;
  expect(reviewId).toMatch(REVIEW_ID);
  return reviewId!;
}

const sent = { ok: true, applicationId: 'app-1', autoRejected: false, jobTitle: 'PMHNP', employerName: 'Fictional Health', hasResume: true };

describe('prepare_application', () => {
  it('with no resume on the profile, says a resume is required and issues nothing to send', async () => {
    db.job.findFirst.mockResolvedValue(jobRow);
    db.userProfile.findUnique.mockResolvedValue({ ...profileRow, resumeUrl: null });
    db.jobApplication.findUnique.mockResolvedValue(null);
    db.jobScreeningQuestion.findMany.mockResolvedValue([]);

    const outcome = await prepareApplication.run({ job_id: JOB_ID }, ctx('job_seeker'));
    const view = outcome.structured as ApplyViewData;
    // The site refuses an application with no resume, so the review must not offer a Submit that fails.
    expect(view.channel).toBe('website');
    expect(view.websiteReason).toBe('A resume is required to apply. Upload one to your profile and try again.');
    expect(view.reviewId).toBeNull();
    expect(pending.size).toBe(0);
    expect(outcome.text).toContain(`Upload a resume: ${brand.baseUrl}/settings`);
    expect(outcome.text).not.toMatch(/You can still apply/);
  });

  it('never selects the knockout rules, lists the questions for the model, and issues a review', async () => {
    const reviewId = await reviewed();
    const select = db.jobScreeningQuestion.findMany.mock.calls[0][0].select;
    expect(select).not.toHaveProperty('isKnockout');
    expect(select).not.toHaveProperty('knockoutAnswer');
    const outcome = await prepareApplication.run({ job_id: JOB_ID }, ctx('job_seeker'));
    expect(outcome.structured).toMatchObject({ view: 'apply', channel: 'assistant' });
    expect(outcome.text).toContain('question_id q1');
    expect(outcome.text).toContain('Nothing has been sent');
    expect(outcome.text).toMatch(new RegExp(`review_id ${escapeRegExp(MCP_PREFIX)}_rv_`));
    expect(pending.get(reviewId)).toMatchObject({ userId: 'user-fic-1', kind: 'submit_application', subjectId: JOB_ID });
  });

  it('sends a job with a sensitive question to the website and relays none of its questions', async () => {
    db.job.findFirst.mockResolvedValue(jobRow);
    db.userProfile.findUnique.mockResolvedValue({ ...profileRow, headline: null, resumeUrl: null });
    db.jobApplication.findUnique.mockResolvedValue(null);
    db.jobScreeningQuestion.findMany.mockResolvedValue([
      { id: 'q1', questionText: 'Have you ever been convicted of a crime?', questionType: 'boolean', options: [], isRequired: true },
    ]);
    const outcome = await prepareApplication.run({ job_id: JOB_ID }, ctx('job_seeker'));
    expect(outcome.structured).toMatchObject({ channel: 'website', questions: [], reviewId: null });
    expect(outcome.text).not.toContain('convicted');
  });

  it('does not offer to resend an application the employer already turned down', async () => {
    db.job.findFirst.mockResolvedValue(jobRow);
    db.userProfile.findUnique.mockResolvedValue(profileRow);
    db.jobApplication.findUnique.mockResolvedValue({ status: 'rejected', withdrawnAt: null, consentGiven: true, sourceUrl: 'platform' });
    db.jobScreeningQuestion.findMany.mockResolvedValue([]);
    const outcome = await prepareApplication.run({ job_id: JOB_ID }, ctx('job_seeker'));
    expect(outcome.structured).toMatchObject({ channel: 'website', reviewId: null });
    expect(outcome.text).toMatch(/were not selected/);
  });

  it('says the same of a knockout that was withdrawn, so withdrawing cannot reopen the screening', async () => {
    db.job.findFirst.mockResolvedValue(jobRow);
    db.userProfile.findUnique.mockResolvedValue(profileRow);
    // What a withdrawal leaves on a knockout: the bare record (lib/applications/auto-reject.ts).
    db.jobApplication.findUnique.mockResolvedValue({
      status: 'withdrawn', withdrawnAt: new Date('2026-10-01T00:00:00Z'), consentGiven: false, sourceUrl: 'platform', notes: 'Auto-rejected: ',
    });
    db.jobScreeningQuestion.findMany.mockResolvedValue([]);
    const outcome = await prepareApplication.run({ job_id: JOB_ID }, ctx('job_seeker'));
    expect(outcome.structured).toMatchObject({ channel: 'website', reviewId: null });
    expect(outcome.text).toMatch(/were not selected/);
    // The record is read, never repeated.
    expect(outcome.text).not.toContain('Auto-rejected');
  });

  it('offers a choice question with no options as a text question', async () => {
    db.job.findFirst.mockResolvedValue(jobRow);
    db.userProfile.findUnique.mockResolvedValue(profileRow);
    db.jobApplication.findUnique.mockResolvedValue(null);
    db.jobScreeningQuestion.findMany.mockResolvedValue([
      { id: 'q9', questionText: 'Preferred schedule?', questionType: 'select', options: [], isRequired: true },
    ]);
    const outcome = await prepareApplication.run({ job_id: JOB_ID }, ctx('job_seeker'));
    expect((outcome.structured as ApplyViewData).questions[0]).toMatchObject({ id: 'q9', type: 'text' });
  });
});

describe('submit_application', () => {
  it('sends the reviewed job through the shared service with consent, the person\'s own answers and the resume rule', async () => {
    const reviewId = await reviewed();
    mocks.submitDirectApplication.mockResolvedValue(sent);
    const outcome = await submitApplication.run(
      { review_id: reviewId, cover_letter: 'Hello', screening_answers: [{ question_id: 'q1', answer: 'Yes' }], consent_to_share_profile: true },
      ctx('job_seeker'),
    );
    expect(mocks.submitDirectApplication).toHaveBeenCalledWith({
      userId: 'user-fic-1',
      jobId: JOB_ID,
      coverLetter: 'Hello',
      consent: true,
      // This channel sends no application without a resume.
      requireResume: true,
      screeningAnswers: [{ questionId: 'q1', answer: 'Yes' }],
    });
    expect(outcome.structured).toMatchObject({ view: 'apply', submitted: true, applicationId: 'app-1' });
    expect(db.auditLog.create).toHaveBeenCalled();
  });

  it('sends nothing without a review from this account, and never twice from one review', async () => {
    await expect(
      submitApplication.run({ review_id: `${MCP_PREFIX}_rv_made_up`, consent_to_share_profile: true }, ctx('job_seeker')),
    ).rejects.toThrow(/prepare_application/);
    const reviewId = await reviewed();
    await expect(
      submitApplication.run({ review_id: reviewId, consent_to_share_profile: true }, ctx('job_seeker', 'user-fic-2')),
    ).rejects.toThrow(/not on this account/);
    expect(mocks.submitDirectApplication).not.toHaveBeenCalled();

    mocks.submitDirectApplication.mockResolvedValue(sent);
    db.job.findUnique.mockResolvedValue(jobRow);
    await submitApplication.run({ review_id: reviewId, consent_to_share_profile: true }, ctx('job_seeker'));
    const again = await submitApplication.run({ review_id: reviewId, consent_to_share_profile: true }, ctx('job_seeker'));
    expect(mocks.submitDirectApplication).toHaveBeenCalledTimes(1);
    expect(again.text).toMatch(/already sent/);
    expect(again.structured).toMatchObject({ submitted: true, applicationId: 'app-1' });
  });

  it('a refused send keeps the review, so the person can fix it and send again', async () => {
    const reviewId = await reviewed();
    mocks.submitDirectApplication.mockResolvedValueOnce({ ok: false, status: 400, error: 'Please answer: "Active Texas APRN license?"' });
    await expect(
      submitApplication.run({ review_id: reviewId, consent_to_share_profile: true }, ctx('job_seeker')),
    ).rejects.toThrow('Nothing was sent. Please answer: "Active Texas APRN license?".');
    mocks.submitDirectApplication.mockResolvedValueOnce(sent);
    const outcome = await submitApplication.run(
      { review_id: reviewId, screening_answers: [{ question_id: 'q1', answer: 'Yes' }], consent_to_share_profile: true },
      ctx('job_seeker'),
    );
    expect(outcome.structured).toMatchObject({ submitted: true });
  });

  it('refuses, without sending, a job that moved to the employer\'s own site or added a sensitive question since the review', async () => {
    const reviewId = await reviewed();
    db.job.findFirst.mockResolvedValue({ ...jobRow, applyOnPlatform: false });
    await expect(
      submitApplication.run({ review_id: reviewId, consent_to_share_profile: true }, ctx('job_seeker')),
    ).rejects.toBeInstanceOf(UserFacingError);

    db.job.findFirst.mockResolvedValue(jobRow);
    db.jobScreeningQuestion.findMany.mockResolvedValue([{ questionText: 'What is your date of birth?' }]);
    await expect(
      submitApplication.run({ review_id: reviewId, consent_to_share_profile: true }, ctx('job_seeker')),
    ).rejects.toBeInstanceOf(UserFacingError);
    expect(mocks.submitDirectApplication).not.toHaveBeenCalled();
  });
});
