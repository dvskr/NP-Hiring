/**
 * lib/applications/submit-direct-application.ts: the review sandbox rules of
 * the one Easy Apply routine behind POST /api/applications/apply-direct and
 * the AI app's submit_application (lib/mcp/sandbox.ts).
 *
 * Pinned:
 *   - an unpublished job is refused unless it is a sandbox job AND the caller
 *     passed allowSandboxJob === true (only lib/mcp/candidate.ts does, and
 *     only for a reviewer account); nothing is written for a refusal;
 *   - a sandbox submission is never AI scored (no `after` call) and emails
 *     no employer; a published job is still scored;
 *   - the site route never forwards a request body's allowSandboxJob, so a
 *     browser cannot unlock a sandbox job.
 * Everything else about the routine is pinned by the route tests
 * (tests/regressions/resume-ownership-writers.test.ts and friends).
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

import { submitDirectApplication, type DirectApplicationRequest } from '@/lib/applications/submit-direct-application';
import { POST as applyDirect } from '@/app/api/applications/apply-direct/route';
import { REVIEW_SANDBOX_SOURCE_PROVIDER } from '@/lib/mcp/sandbox';
import { ME, SANDBOX_JOB_ID } from './fixtures';

const REFUSED_UNPUBLISHED = 'This job is no longer active';

function storedJob(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: SANDBOX_JOB_ID,
        title: 'Review Sandbox Nurse Practitioner',
        employer: 'NP Hiring Review',
        applyOnPlatform: true,
        isPublished: false,
        expiresAt: null,
        sourceProvider: REVIEW_SANDBOX_SOURCE_PROVIDER,
        employerJobs: null,
        ...overrides,
    };
}

function submission(overrides: Partial<DirectApplicationRequest> = {}): DirectApplicationRequest {
    return {
        userId: ME,
        jobId: SANDBOX_JOB_ID,
        coverLetter: 'Dear team',
        coverLetterUrl: undefined,
        resumeUrl: undefined,
        consent: true,
        screeningAnswers: [],
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

beforeEach(() => {
    h.job.findUnique.mockReset().mockResolvedValue(storedJob());
    h.userProfile.findUnique.mockReset().mockResolvedValue({
        id: 'profile-1',
        firstName: 'Riley',
        lastName: 'Reviewer',
        email: 'reviewer@example.com',
        resumeUrl: `local/${ME}/1700000000000-cv.pdf`,
        headline: null,
        yearsExperience: null,
    });
    h.jobScreeningQuestion.findMany.mockReset().mockResolvedValue([]);
    h.$executeRaw.mockReset().mockResolvedValue(1);
    h.txJobApplication.findUnique.mockReset().mockResolvedValue(null);
    h.txJobApplication.upsert.mockReset().mockResolvedValue({ id: 'app-sandbox', appliedAt: new Date('2026-10-28T09:00:00.000Z') });
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

describe('an unpublished job', () => {
    it.each([
        ['a sandbox job without allowSandboxJob', storedJob(), undefined],
        ['a sandbox job with allowSandboxJob false', storedJob(), false],
        ['a sandbox job with a truthy allowSandboxJob that is not true', storedJob(), 'true' as unknown as boolean],
        ['an ordinary unpublished job, even with allowSandboxJob', storedJob({ sourceProvider: null }), true],
        ['an unpublished job of another provider, even with allowSandboxJob', storedJob({ sourceProvider: 'greenhouse' }), true],
    ])('%s is refused, and nothing is written', async (_label, job, allowSandboxJob) => {
        h.job.findUnique.mockResolvedValue(job);
        const outcome = await submitDirectApplication(submission({ allowSandboxJob }));
        expect(outcome).toEqual({ ok: false, status: 400, error: REFUSED_UNPUBLISHED });
        expectNothingWritten();
    });

    it('a sandbox job with allowSandboxJob true is accepted', async () => {
        const outcome = await submitDirectApplication(submission({ allowSandboxJob: true }));
        expect(outcome).toMatchObject({ ok: true, applicationId: 'app-sandbox', isNew: true });
        expect(h.txJobApplication.upsert).toHaveBeenCalledTimes(1);
        expect(h.txJobApplication.upsert.mock.calls[0][0]).toMatchObject({
            where: { userId_jobId: { userId: ME, jobId: SANDBOX_JOB_ID } },
            create: { userId: ME, jobId: SANDBOX_JOB_ID, sourceUrl: 'platform', consentGiven: true },
        });
    });

    it('an expired sandbox job is still refused as expired', async () => {
        h.job.findUnique.mockResolvedValue(storedJob({ expiresAt: new Date('2020-01-01T00:00:00.000Z') }));
        const outcome = await submitDirectApplication(submission({ allowSandboxJob: true }));
        expect(outcome).toEqual({ ok: false, status: 400, error: 'This job has expired' });
        expectNothingWritten();
    });
});

describe('scoring and employer email', () => {
    it('a sandbox submission is never AI scored and emails no employer', async () => {
        const outcome = await submitDirectApplication(submission({ allowSandboxJob: true }));
        expect(outcome.ok).toBe(true);
        expect(h.after).not.toHaveBeenCalled();
        expect(h.scoreCandidate).not.toHaveBeenCalled();
        expect(h.sendNewApplicationEmail).not.toHaveBeenCalled();
    });

    it('a sandbox row is not scored even if it carries an employer row', async () => {
        h.job.findUnique.mockResolvedValue(
            storedJob({ employerJobs: { contactEmail: 'hiring@employer.example', employerName: 'Employer', notifyOnApplication: true } }),
        );
        await submitDirectApplication(submission({ allowSandboxJob: true }));
        expect(h.after).not.toHaveBeenCalled();
        expect(h.scoreCandidate).not.toHaveBeenCalled();
        // Only the scoring half is pinned here: the sandbox has no employer_jobs
        // row by design (scripts/mcp-review-sandbox.ts), so the employer email
        // rule is the ordinary one.
    });

    it('a published job is scored after the response, as before', async () => {
        h.job.findUnique.mockResolvedValue(storedJob({ id: 'job-1', isPublished: true, sourceProvider: null }));
        const outcome = await submitDirectApplication(submission({ jobId: 'job-1' }));
        expect(outcome.ok).toBe(true);
        expect(h.after).toHaveBeenCalledTimes(1);
        await h.after.mock.calls[0][0];
        expect(h.scoreCandidate).toHaveBeenCalledWith('app-sandbox', 'job-1', ME);
    });

    it('a published job of the sandbox provider is an ordinary job (only unpublished ones are sandbox jobs)', async () => {
        h.job.findUnique.mockResolvedValue(storedJob({ isPublished: true }));
        const outcome = await submitDirectApplication(submission());
        expect(outcome.ok).toBe(true);
        expect(h.after).toHaveBeenCalledTimes(1);
    });
});

describe('POST /api/applications/apply-direct cannot unlock the sandbox', () => {
    it('a request body allowSandboxJob is ignored: the sandbox job is refused and nothing is written', async () => {
        const response = await applyDirect(
            new NextRequest('http://localhost:3000/api/applications/apply-direct', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jobId: SANDBOX_JOB_ID, consent: true, allowSandboxJob: true }),
            }),
        );
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: REFUSED_UNPUBLISHED });
        expectNothingWritten();
    });
});
