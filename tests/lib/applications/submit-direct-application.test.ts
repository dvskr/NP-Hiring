/**
 * lib/applications/submit-direct-application.ts: the one Easy Apply routine
 * behind POST /api/applications/apply-direct and the AI app's
 * submit_application.
 *
 * Pinned:
 *   - an unpublished or expired job is refused and nothing is written, and a
 *     request body cannot unlock one through the site route;
 *   - checkDirectApplication runs the checks and writes and sends nothing
 *     (the AI app's test accounts);
 *   - requireResume refuses an application with no resume of the candidate's
 *     own, and the website, which does not ask for it, still accepts one;
 *   - an answer is checked against its question type, and a number is stored
 *     and compared with a knockout rule in its canonical form;
 *   - both emails go out for a new application only: not for a repeat submit
 *     on a live row, and not for a knockout;
 *   - a knockout recorded before decides the application again after a
 *     withdrawal, with no answer evaluated or stored;
 *   - a knockout answer on an application the employer already has does not
 *     reject it or touch the employer's notes.
 * The status helper itself is pinned in tests/lib/applications/status-fields-decide.test.ts.
 *
 * Prisma, the emails, the scorer and next/server's `after` are mocked;
 * nothing reaches a database or the network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
    job: { findUnique: vi.fn() },
    userProfile: { findUnique: vi.fn() },
    jobScreeningQuestion: { findMany: vi.fn() },
    txJobApplication: { findUnique: vi.fn(), upsert: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
    after: vi.fn(),
    scoreCandidate: vi.fn(),
    sendNewApplicationEmail: vi.fn(),
    sendApplicationConfirmationEmail: vi.fn(),
    getUser: vi.fn(),
    rateLimit: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
    prisma: {
        job: h.job,
        userProfile: h.userProfile,
        jobScreeningQuestion: h.jobScreeningQuestion,
        $transaction: h.$transaction,
    },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/email-service', () => ({
    sendNewApplicationEmail: h.sendNewApplicationEmail,
    sendApplicationConfirmationEmail: h.sendApplicationConfirmationEmail,
}));
vi.mock('@/lib/candidate-scorer', () => ({ scoreCandidate: h.scoreCandidate }));
vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: h.getUser } })),
}));
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: h.rateLimit,
    RATE_LIMITS: { applyDirect: { limit: 10, windowSeconds: 60 } },
}));
// `after` throws outside a real request scope; the rest of next/server stays real.
vi.mock('next/server', async (importOriginal) => ({
    ...(await importOriginal<typeof import('next/server')>()),
    after: h.after,
}));

import {
    RESUME_REQUIRED_ERROR,
    checkDirectApplication,
    submitDirectApplication,
    type DirectApplicationRequest,
} from '@/lib/applications/submit-direct-application';
import { AUTO_REJECT_NOTE_PREFIX } from '@/lib/applications/auto-reject';
import { POST as applyDirect } from '@/app/api/applications/apply-direct/route';

const ME = '11111111-2222-4333-8444-555555555555';
const JOB_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const OWN_RESUME = `local/${ME}/1700000000000-cv.pdf`;

function storedJob(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: JOB_ID,
        title: 'Family Nurse Practitioner',
        employer: 'Riverside Clinic',
        applyOnPlatform: true,
        isPublished: true,
        expiresAt: null,
        employerJobs: { contactEmail: 'hiring@clinic.example', employerName: 'Riverside Clinic', notifyOnApplication: true },
        ...overrides,
    };
}

function submission(overrides: Partial<DirectApplicationRequest> = {}): DirectApplicationRequest {
    return {
        userId: ME,
        jobId: JOB_ID,
        coverLetter: 'Dear team',
        consent: true,
        screeningAnswers: [],
        ...overrides,
    };
}

function question(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: 'q-license',
        jobId: JOB_ID,
        questionText: 'Do you hold an active NP license?',
        questionType: 'boolean',
        options: [],
        isRequired: true,
        isKnockout: true,
        knockoutAnswer: 'No',
        sortOrder: 0,
        ...overrides,
    };
}

function expectNothingWritten(): void {
    expect(h.$transaction).not.toHaveBeenCalled();
    expect(h.txJobApplication.upsert).not.toHaveBeenCalled();
    expect(h.after).not.toHaveBeenCalled();
    expect(h.sendNewApplicationEmail).not.toHaveBeenCalled();
    expect(h.sendApplicationConfirmationEmail).not.toHaveBeenCalled();
}

function upsertArgs(): { update: Record<string, unknown>; create: Record<string, unknown> } {
    expect(h.txJobApplication.upsert).toHaveBeenCalledTimes(1);
    return h.txJobApplication.upsert.mock.calls[0][0];
}

beforeEach(() => {
    h.job.findUnique.mockReset().mockResolvedValue(storedJob());
    h.userProfile.findUnique.mockReset().mockResolvedValue({
        id: 'profile-1',
        firstName: 'Riley',
        lastName: 'Candidate',
        email: 'riley@example.com',
        resumeUrl: OWN_RESUME,
        headline: null,
        yearsExperience: null,
    });
    h.jobScreeningQuestion.findMany.mockReset().mockResolvedValue([]);
    h.$executeRaw.mockReset().mockResolvedValue(1);
    h.txJobApplication.findUnique.mockReset().mockResolvedValue(null);
    h.txJobApplication.upsert.mockReset().mockResolvedValue({ id: 'app-1', appliedAt: new Date('2026-11-23T09:00:00.000Z') });
    h.$transaction.mockReset().mockImplementation((fn: (tx: unknown) => Promise<unknown>) =>
        fn({ $executeRaw: h.$executeRaw, jobApplication: h.txJobApplication }),
    );
    h.after.mockReset();
    h.scoreCandidate.mockReset().mockResolvedValue(undefined);
    h.sendNewApplicationEmail.mockReset().mockResolvedValue({ success: true });
    h.sendApplicationConfirmationEmail.mockReset().mockResolvedValue({ success: true });
    h.getUser.mockReset().mockResolvedValue({ data: { user: { id: ME } }, error: null });
    h.rateLimit.mockReset().mockResolvedValue(null);
});

describe('a job that is not open', () => {
    it.each([
        ['unpublished', storedJob({ isPublished: false }), 'This job is no longer active'],
        ['expired', storedJob({ expiresAt: new Date('2020-01-01T00:00:00.000Z') }), 'This job has expired'],
        ['not taking applications here', storedJob({ applyOnPlatform: false }), 'This job does not accept platform applications'],
    ])('an %s job is refused, and nothing is written', async (_label, job, error) => {
        h.job.findUnique.mockResolvedValue(job);
        const outcome = await submitDirectApplication(submission());
        expect(outcome).toEqual({ ok: false, status: 400, error });
        expectNothingWritten();
    });

    it('the site route takes no field that unlocks an unpublished job', async () => {
        h.job.findUnique.mockResolvedValue(storedJob({ isPublished: false }));
        const response = await applyDirect(
            new NextRequest('http://localhost:3000/api/applications/apply-direct', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jobId: JOB_ID, consent: true, allowSandboxJob: true, requireResume: false }),
            }),
        );
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'This job is no longer active' });
        expectNothingWritten();
    });
});

describe('checkDirectApplication', () => {
    it('runs the checks and writes, emails and scores nothing', async () => {
        const checked = await checkDirectApplication(submission({ requireResume: true }));
        expect(checked).toEqual({ ok: true, job: { id: JOB_ID, title: 'Family Nurse Practitioner', employer: 'Riverside Clinic' }, hasResume: true });
        expectNothingWritten();
    });

    it('refuses what a submission would refuse', async () => {
        h.userProfile.findUnique.mockResolvedValue({ id: 'p', firstName: null, lastName: null, email: 'x@example.com', resumeUrl: null, headline: null, yearsExperience: null });
        expect(await checkDirectApplication(submission({ requireResume: true }))).toEqual({ ok: false, status: 400, error: RESUME_REQUIRED_ERROR });
        expectNothingWritten();
    });

    it('does not report whether an answer meets a knockout rule', async () => {
        h.jobScreeningQuestion.findMany.mockResolvedValue([question()]);
        const checked = await checkDirectApplication(submission({ screeningAnswers: [{ questionId: 'q-license', answer: 'No' }] }));
        expect(checked).toEqual({ ok: true, job: expect.any(Object), hasResume: true });
        expect(JSON.stringify(checked)).not.toMatch(/reject|requirement/i);
    });
});

describe('requireResume', () => {
    it('refuses an application with no resume when the caller asks for one, before anything is written', async () => {
        h.userProfile.findUnique.mockResolvedValue({ id: 'p', firstName: 'R', lastName: null, email: 'r@example.com', resumeUrl: null, headline: null, yearsExperience: null });
        const outcome = await submitDirectApplication(submission({ requireResume: true }));
        expect(outcome).toEqual({ ok: false, status: 400, error: RESUME_REQUIRED_ERROR });
        expectNothingWritten();
    });

    it('a resume outside the candidate\'s own folder counts as none', async () => {
        h.userProfile.findUnique.mockResolvedValue({ id: 'p', firstName: 'R', lastName: null, email: 'r@example.com', resumeUrl: 'local/someone-else/1-cv.pdf', headline: null, yearsExperience: null });
        expect(await submitDirectApplication(submission({ requireResume: true }))).toEqual({ ok: false, status: 400, error: RESUME_REQUIRED_ERROR });
    });

    it('the website does not ask for one, and an application with no resume still goes through', async () => {
        h.userProfile.findUnique.mockResolvedValue({ id: 'p', firstName: 'R', lastName: null, email: 'r@example.com', resumeUrl: null, headline: null, yearsExperience: null });
        const outcome = await submitDirectApplication(submission());
        expect(outcome).toMatchObject({ ok: true, hasResume: false });
    });
});

describe('answers are checked against their question type', () => {
    it('a Yes or No question takes Yes or No only, so a knockout cannot be slipped past', async () => {
        h.jobScreeningQuestion.findMany.mockResolvedValue([question()]);
        const outcome = await submitDirectApplication(submission({ screeningAnswers: [{ questionId: 'q-license', answer: 'No, not yet' }] }));
        expect(outcome).toEqual({ ok: false, status: 400, error: 'Please answer "Do you hold an active NP license?" with Yes or No.' });
        expectNothingWritten();
    });

    it('a number is stored in its canonical form and meets a knockout rule written another way', async () => {
        h.jobScreeningQuestion.findMany.mockResolvedValue([
            question({ id: 'q-years', questionText: 'Years of NP experience?', questionType: 'number', knockoutAnswer: '0' }),
        ]);
        const outcome = await submitDirectApplication(submission({ screeningAnswers: [{ questionId: 'q-years', answer: '0.0' }] }));
        expect(outcome).toMatchObject({ ok: true, autoRejected: true, autoRejectReason: 'Does not meet requirement: Years of NP experience?' });
        expect(upsertArgs().create).toMatchObject({ screeningAnswers: [{ questionId: 'q-years', answer: '0' }], status: 'rejected' });
    });

    it('a select answer is stored as the option itself', async () => {
        h.jobScreeningQuestion.findMany.mockResolvedValue([
            question({ id: 'q-shift', questionText: 'Preferred shift?', questionType: 'select', options: ['Days', 'Nights'], isKnockout: false, knockoutAnswer: null }),
        ]);
        await submitDirectApplication(submission({ screeningAnswers: [{ questionId: 'q-shift', answer: 'nights' }] }));
        expect(upsertArgs().create).toMatchObject({ screeningAnswers: [{ questionId: 'q-shift', answer: 'Nights' }] });
    });
});

describe('emails go out for a new application only', () => {
    it('a first application emails the employer and the candidate, and is scored', async () => {
        const outcome = await submitDirectApplication(submission());
        expect(outcome).toMatchObject({ ok: true, isNew: true, autoRejected: false });
        expect(h.sendNewApplicationEmail).toHaveBeenCalledTimes(1);
        expect(h.sendApplicationConfirmationEmail).toHaveBeenCalledTimes(1);
        expect(h.after).toHaveBeenCalledTimes(1);
    });

    it('a repeat submit on a live application sends neither email', async () => {
        h.txJobApplication.findUnique.mockResolvedValue({ status: 'applied', withdrawnAt: null, notes: null, consentGiven: true, sourceUrl: 'platform' });
        const outcome = await submitDirectApplication(submission());
        expect(outcome).toMatchObject({ ok: true, isNew: false });
        expect(h.sendNewApplicationEmail).not.toHaveBeenCalled();
        expect(h.sendApplicationConfirmationEmail).not.toHaveBeenCalled();
    });

    it('applying again after a withdrawal is new again', async () => {
        h.txJobApplication.findUnique.mockResolvedValue({ status: 'withdrawn', withdrawnAt: new Date('2026-11-01'), notes: null, consentGiven: true, sourceUrl: 'platform' });
        await submitDirectApplication(submission());
        expect(upsertArgs().update).toMatchObject({ status: 'applied', withdrawnAt: null });
        expect(h.sendNewApplicationEmail).toHaveBeenCalledTimes(1);
    });

    it('submitting over a row the candidate only tracked is a first submission', async () => {
        h.txJobApplication.findUnique.mockResolvedValue({ status: 'applied', withdrawnAt: null, notes: null, consentGiven: false, sourceUrl: 'https://careers.example/apply' });
        await submitDirectApplication(submission());
        expect(h.sendNewApplicationEmail).toHaveBeenCalledTimes(1);
    });

    it('a knockout sends neither email and is not scored', async () => {
        h.jobScreeningQuestion.findMany.mockResolvedValue([question()]);
        const outcome = await submitDirectApplication(submission({ screeningAnswers: [{ questionId: 'q-license', answer: 'No' }] }));
        expect(outcome).toMatchObject({ ok: true, autoRejected: true });
        expect(h.sendNewApplicationEmail).not.toHaveBeenCalled();
        expect(h.sendApplicationConfirmationEmail).not.toHaveBeenCalled();
        expect(h.after).not.toHaveBeenCalled();
    });
});

describe('a knockout already recorded', () => {
    it('decides the application again after a withdrawal: rejected, the stored answers kept, nothing evaluated', async () => {
        h.jobScreeningQuestion.findMany.mockResolvedValue([question()]);
        // What a withdrawal leaves on a knockout row (lib/applications/withdraw.ts).
        h.txJobApplication.findUnique.mockResolvedValue({
            status: 'withdrawn',
            withdrawnAt: new Date('2026-11-02'),
            notes: AUTO_REJECT_NOTE_PREFIX,
            consentGiven: true,
            sourceUrl: 'platform',
        });
        const outcome = await submitDirectApplication(submission({ screeningAnswers: [{ questionId: 'q-license', answer: 'Yes' }] }));
        expect(outcome).toMatchObject({ ok: true, autoRejected: true, autoRejectReason: 'Does not meet a requirement for this role' });
        const { update } = upsertArgs();
        expect(update).toMatchObject({ status: 'rejected' });
        expect(update).not.toHaveProperty('screeningAnswers');
        expect(update).not.toHaveProperty('notes');
        expect(h.sendNewApplicationEmail).not.toHaveBeenCalled();
    });

    it('a rejected knockout submitted again stays as it is', async () => {
        h.jobScreeningQuestion.findMany.mockResolvedValue([question()]);
        h.txJobApplication.findUnique.mockResolvedValue({
            status: 'rejected',
            withdrawnAt: null,
            notes: `${AUTO_REJECT_NOTE_PREFIX}Does not meet requirement: Do you hold an active NP license?`,
            consentGiven: true,
            sourceUrl: 'platform',
        });
        const outcome = await submitDirectApplication(submission({ screeningAnswers: [{ questionId: 'q-license', answer: 'Yes' }] }));
        expect(outcome).toMatchObject({ ok: true, autoRejected: true, autoRejectReason: 'Does not meet requirement: Do you hold an active NP license?' });
        const { update } = upsertArgs();
        expect(update).not.toHaveProperty('status');
        expect(update).not.toHaveProperty('screeningAnswers');
    });
});

describe('an application the employer already has', () => {
    it('a knockout answer in a resubmission neither rejects it nor touches the employer\'s notes', async () => {
        h.jobScreeningQuestion.findMany.mockResolvedValue([question()]);
        h.txJobApplication.findUnique.mockResolvedValue({ status: 'interview', withdrawnAt: null, notes: 'Strong phone screen', consentGiven: true, sourceUrl: 'platform' });
        const outcome = await submitDirectApplication(submission({ screeningAnswers: [{ questionId: 'q-license', answer: 'No' }] }));
        expect(outcome).toMatchObject({ ok: true, autoRejected: false });
        const { update } = upsertArgs();
        expect(update).not.toHaveProperty('status');
        expect(update).not.toHaveProperty('notes');
        expect(update).toMatchObject({ screeningAnswers: [{ questionId: 'q-license', answer: 'No' }] });
    });

    it('a knockout on a tracked row puts its record above the notes already there', async () => {
        h.jobScreeningQuestion.findMany.mockResolvedValue([question()]);
        h.txJobApplication.findUnique.mockResolvedValue({ status: 'applied', withdrawnAt: null, notes: 'Referred by Dana', consentGiven: false, sourceUrl: null });
        await submitDirectApplication(submission({ screeningAnswers: [{ questionId: 'q-license', answer: 'No' }] }));
        expect(upsertArgs().update).toMatchObject({
            status: 'rejected',
            notes: `${AUTO_REJECT_NOTE_PREFIX}Does not meet requirement: Do you hold an active NP license?\nReferred by Dana`,
        });
    });
});
