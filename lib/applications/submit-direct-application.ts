/**
 * One Easy Apply submission: the single routine behind
 * POST /api/applications/apply-direct (the site's apply form) and the AI
 * app's submit_application tool (lib/mcp), so the two can never apply
 * different rules to the same application.
 *
 * The caller authenticates the candidate and passes their Supabase id; every
 * body value arrives unvalidated and is checked here exactly as the route
 * always checked it. The answer is an outcome, never a thrown error, for
 * anything the candidate can fix; an unexpected failure still throws for the
 * caller's own 500 handling.
 *
 * One rule is the caller's to ask for: requireResume. The AI app asks for it,
 * because an application with no resume gives the employer a name and an
 * address and nothing to assess. The website form sends one or none, as it
 * always has.
 */
import { after } from 'next/server';
import type { JobScreeningQuestion, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { toOwnResumePath } from '@/lib/resume-storage';
import { requirementReason } from './auto-reject';
import { RESUME_REQUIRED_ERROR } from './resume-required';
import { decideSubmission } from './status-fields';

export { RESUME_REQUIRED_ERROR };

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Longest cover letter kept (components/InPlatformApplyForm.tsx stops input at the same cap). */
export const MAX_COVER_LETTER_LENGTH = 5000;

/** Strip all HTML tags to prevent XSS when employer views the cover letter */
function sanitizeText(text: string): string {
    return text
        .replace(/<[^>]*>/g, '')          // strip HTML tags
        .replace(/&lt;/g, '<')            // decode common entities
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/&#x2F;/g, '/')
        .replace(/javascript:/gi, '')     // strip javascript: protocol
        .replace(/on\w+\s*=/gi, '')       // strip inline event handlers
        .trim();
}

/**
 * Advisory-lock key that serializes submits for one candidate on one job, so
 * the "does an application already exist?" read and the upsert below cannot
 * interleave with a concurrent submit. Namespaced so it can never collide
 * with the job-alert lock in app/api/job-alerts/route.ts or any other
 * advisory lock taken on the same database.
 */
function applicationLockKey(userId: string, jobId: string): string {
    return `job_application:submit:${userId}:${jobId}`;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface DirectApplicationRequest {
    /** The signed-in candidate's Supabase auth id. */
    userId: string;
    jobId: unknown;
    coverLetter?: unknown;
    coverLetterUrl?: unknown;
    resumeUrl?: unknown;
    consent: unknown;
    screeningAnswers?: unknown;
    /** Refuse, before anything is written, an application with no resume. */
    requireResume?: boolean;
}

export interface SubmittedJob {
    id: string;
    title: string;
    employer: string;
}

type ApplicationRefusal = { ok: false; status: 400 | 403 | 404; error: string };

export type DirectApplicationOutcome =
    | {
          ok: true;
          applicationId: string;
          /** True only when this request created the row. */
          isNew: boolean;
          appliedAt: Date;
          autoRejected: boolean;
          autoRejectReason: string;
          job: SubmittedJob;
          hasResume: boolean;
      }
    | ApplicationRefusal;

function refuse(status: 400 | 403 | 404, error: string): ApplicationRefusal {
    return { ok: false, status, error };
}

const APPLY_JOB_SELECT = {
    id: true,
    title: true,
    employer: true,
    applyOnPlatform: true,
    isPublished: true,
    expiresAt: true,
    employerJobs: {
        select: {
            contactEmail: true,
            employerName: true,
            notifyOnApplication: true,
        },
    },
} satisfies Prisma.JobSelect;

const APPLICANT_SELECT = {
    id: true,
    firstName: true,
    lastName: true,
    email: true,
    resumeUrl: true,
    headline: true,
    yearsExperience: true,
} satisfies Prisma.UserProfileSelect;

type ValidatedAnswer = { questionId: string; questionText: string; answer: string };

/** An application that passed every check, as it will be stored. Nothing has been written. */
interface CheckedApplication {
    ok: true;
    jobId: string;
    job: Prisma.JobGetPayload<{ select: typeof APPLY_JOB_SELECT }>;
    profile: Prisma.UserProfileGetPayload<{ select: typeof APPLICANT_SELECT }>;
    questions: JobScreeningQuestion[];
    sanitizedCoverLetter: string | null;
    validCoverLetterUrl: string | null;
    applicationResumeUrl: string | null;
    validatedAnswers: ValidatedAnswer[] | null;
    autoReject: boolean;
    autoRejectReason: string;
}

// ── Checks ───────────────────────────────────────────────────────────────────

/**
 * Every check an application passes before anything is written: consent,
 * the documents, that the job is open and takes applications here, the
 * profile, the resume where the caller asks for one, and the screening
 * answers. It reads and never writes.
 */
async function checkApplication(input: DirectApplicationRequest): Promise<CheckedApplication | ApplicationRefusal> {
    const { userId, jobId, coverLetter, coverLetterUrl, resumeUrl, consent, screeningAnswers } = input;

    if (!jobId || typeof jobId !== 'string') {
        return refuse(400, 'jobId is required');
    }

    // GDPR consent is mandatory
    if (!consent) {
        return refuse(400, 'You must consent to sharing your data with the employer');
    }

    // Sanitize cover letter (XSS prevention + length cap)
    let sanitizedCoverLetter: string | null = null;
    if (coverLetter && typeof coverLetter === 'string') {
        sanitizedCoverLetter = sanitizeText(coverLetter).slice(0, MAX_COVER_LETTER_LENGTH) || null;
    }

    // SECURITY (APP-2): both values used to be stored after a host-suffix
    // check only, and the employer's applicant list signs the stored
    // resume with the service role, so an applicant could hand an employer
    // a fresh link to another user's file. A value now counts only when it
    // names a key in the applicant's own upload folder (/api/upload keys
    // every file there, cover letters included), and the bare key is
    // stored. That also accepts the bare key the form posts for a profile
    // resume or a cover letter, which the old URL parse refused.
    // Tests: tests/regressions/resume-ownership-writers.test.ts.
    let validResumeUrl: string | null = null;
    if (resumeUrl && typeof resumeUrl === 'string') {
        validResumeUrl = toOwnResumePath(resumeUrl, userId);
        if (!validResumeUrl) {
            return refuse(400, 'Invalid resume URL. Please upload your resume through the platform.');
        }
    }

    // Validate cover letter URL (if uploaded as PDF)
    let validCoverLetterUrl: string | null = null;
    if (coverLetterUrl && typeof coverLetterUrl === 'string') {
        validCoverLetterUrl = toOwnResumePath(coverLetterUrl, userId);
        if (!validCoverLetterUrl) {
            return refuse(400, 'Invalid cover letter URL. Please upload your cover letter through the platform.');
        }
    }

    // Verify the job exists and accepts platform applications
    const job = await prisma.job.findUnique({
        where: { id: jobId },
        select: APPLY_JOB_SELECT,
    });

    if (!job) {
        return refuse(404, 'Job not found');
    }

    if (!job.applyOnPlatform) {
        return refuse(400, 'This job does not accept platform applications');
    }

    if (!job.isPublished) {
        return refuse(400, 'This job is no longer active');
    }

    if (job.expiresAt && new Date(job.expiresAt) < new Date()) {
        return refuse(400, 'This job has expired');
    }

    // Get applicant profile
    const profile = await prisma.userProfile.findUnique({
        where: { supabaseId: userId },
        select: APPLICANT_SELECT,
    });

    if (!profile) {
        return refuse(403, 'User profile not found');
    }

    // Use provided (validated) resume URL, or fall back to profile resume.
    // The profile column is writable by its owner too (APP-2), so the
    // fallback passes the same check; a value outside the applicant's own
    // folder counts as no resume.
    const applicationResumeUrl = validResumeUrl || toOwnResumePath(profile.resumeUrl, userId);

    if (input.requireResume === true && !applicationResumeUrl) {
        return refuse(400, RESUME_REQUIRED_ERROR);
    }

    // Validate screening answers (if the job has questions)
    let validatedAnswers: ValidatedAnswer[] | null = null;
    let autoReject = false;
    let autoRejectReason = '';

    const questions = await prisma.jobScreeningQuestion.findMany({
        where: { jobId },
        orderBy: { sortOrder: 'asc' },
    });

    if (questions.length > 0 && Array.isArray(screeningAnswers)) {
        validatedAnswers = [];

        for (const q of questions) {
            const answer = (screeningAnswers as unknown[]).find(
                (a): a is { questionId: unknown; answer?: unknown } =>
                    a !== null && typeof a === 'object' && (a as { questionId?: unknown }).questionId === q.id
            );

            // Check required questions
            if (q.isRequired && (!answer || !answer.answer || String(answer.answer).trim() === '')) {
                return refuse(400, `Please answer: "${q.questionText}"`);
            }

            const typed = checkAnswerType(q, answer ? String(answer.answer).trim() : '');
            if (!typed.ok) {
                return refuse(400, typed.error);
            }
            const answerValue = typed.value;

            // Check knockout answers, a number in its canonical form on both sides.
            if (q.isKnockout && q.knockoutAnswer && answerValue.toLowerCase() === knockoutValue(q.questionType, q.knockoutAnswer).toLowerCase()) {
                autoReject = true;
                autoRejectReason = requirementReason(q.questionText);
            }

            validatedAnswers.push({
                questionId: q.id,
                questionText: q.questionText,
                answer: answerValue,
            });
        }
    } else if (questions.length > 0) {
        // Job has questions but no answers submitted: check if any are required
        const hasRequired = questions.some(q => q.isRequired);
        if (hasRequired) {
            return refuse(400, 'Please answer the required screening questions');
        }
    }

    return {
        ok: true,
        jobId,
        job,
        profile,
        questions,
        sanitizedCoverLetter,
        validCoverLetterUrl,
        applicationResumeUrl,
        validatedAnswers,
        autoReject,
        autoRejectReason,
    };
}

export type DirectApplicationCheck =
    | { ok: true; job: SubmittedJob; hasResume: boolean }
    | ApplicationRefusal;

/**
 * The checks of submitDirectApplication with none of what follows them: no
 * application is stored, nobody is emailed and nothing is scored. For an
 * account whose applications are tests (lib/mcp/server/test-accounts.ts).
 *
 * Whether an answer met the employer's knockout rule is not reported. A
 * check that said so could be repeated until an answer passed, which is the
 * one thing a candidate must not be able to learn.
 */
export async function checkDirectApplication(input: DirectApplicationRequest): Promise<DirectApplicationCheck> {
    const checked = await checkApplication(input);
    if (!checked.ok) return checked;
    return {
        ok: true,
        job: { id: checked.job.id, title: checked.job.title, employer: checked.job.employerJobs?.employerName || checked.job.employer },
        hasResume: !!checked.applicationResumeUrl,
    };
}

// ── Submission ───────────────────────────────────────────────────────────────

export async function submitDirectApplication(input: DirectApplicationRequest): Promise<DirectApplicationOutcome> {
    const checked = await checkApplication(input);
    if (!checked.ok) return checked;
    const { jobId, job, profile, questions, sanitizedCoverLetter, validCoverLetterUrl, applicationResumeUrl, validatedAnswers } = checked;
    const { userId } = input;

    // Upsert the application (don't duplicate if user already applied).
    // The existing row's state decides the status and whether anyone is
    // emailed (lib/applications/status-fields.ts decideSubmission).
    //
    // The same read also decides `isNew`, this routine's answer to "did this
    // request create the application?". ApplyButton counts a GA4
    // generate_lead only when it is true, because the route answers 200
    // for a first submit and a re-submit alike. The read and the write run
    // in one transaction behind a per-candidate, per-job advisory lock
    // (the pattern app/api/job-alerts/route.ts uses): without it, two
    // concurrent submits of one application (a second tab, a retried
    // request) could both read "no row" and both report a new
    // application for the single row the upsert leaves behind.
    const { application, isNew, decision } = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${applicationLockKey(userId, jobId)}))`;

        const existingApplication = await tx.jobApplication.findUnique({
            where: { userId_jobId: { userId, jobId } },
            select: { status: true, withdrawnAt: true, notes: true, consentGiven: true, sourceUrl: true },
        });
        const decided = decideSubmission(
            existingApplication,
            { autoReject: checked.autoReject, autoRejectReason: checked.autoRejectReason },
            questions,
        );
        const statusFields = decided.statusFields;

        const saved = await tx.jobApplication.upsert({
            where: {
                userId_jobId: { userId, jobId },
            },
            update: {
                coverLetter: sanitizedCoverLetter,
                coverLetterUrl: validCoverLetterUrl,
                resumeUrl: applicationResumeUrl,
                consentGiven: true,
                consentGivenAt: new Date(),
                withdrawnAt: null, // un-withdraw if re-applying
                // A recorded knockout keeps the answers that decided it.
                ...(validatedAnswers && !decided.priorAutoReject && { screeningAnswers: validatedAnswers }),
                ...statusFields,
            },
            create: {
                userId,
                jobId,
                coverLetter: sanitizedCoverLetter,
                coverLetterUrl: validCoverLetterUrl,
                resumeUrl: applicationResumeUrl,
                sourceUrl: 'platform',
                consentGiven: true,
                consentGivenAt: new Date(),
                ...(validatedAnswers && { screeningAnswers: validatedAnswers }),
                ...statusFields,
            },
        });
        return { application: saved, isNew: existingApplication === null, decision: decided };
    });

    const employerName = job.employerJobs?.employerName || job.employer;

    // Both emails announce a new application. A knockout rejection is not
    // one (the form already tells the candidate the outcome), and a repeat
    // submit on a live row (double click, second tab, connector retry) is not
    // news. Submitting over a tracked-only row is new (see decideSubmission).

    // Send notification email to the employer (fire-and-forget)
    const employerEmail = job.employerJobs?.contactEmail;
    const shouldNotify = job.employerJobs?.notifyOnApplication !== false; // default true
    if (employerEmail && shouldNotify && decision.isNewSubmission) {
        try {
            const { sendNewApplicationEmail } = await import('@/lib/email-service');
            await sendNewApplicationEmail({
                employerEmail,
                employerName,
                jobTitle: job.title,
                candidateName: [profile.firstName, profile.lastName].filter(Boolean).join(' ') || 'A candidate',
                candidateHeadline: profile.headline || undefined,
                candidateExperience: profile.yearsExperience || undefined,
                hasResume: !!applicationResumeUrl,
                hasCoverLetter: !!sanitizedCoverLetter,
            });
        } catch (emailError) {
            logger.error('Failed to send new application notification email', emailError);
            // Don't fail the request if email fails
        }
    }

    logger.info('Direct application submitted', {
        applicationId: application.id,
        jobId,
        userId,
    });

    // Send confirmation email to the CANDIDATE (fire-and-forget)
    if (profile.email && decision.isNewSubmission) {
        try {
            const { sendApplicationConfirmationEmail } = await import('@/lib/email-service');
            await sendApplicationConfirmationEmail({
                candidateEmail: profile.email,
                candidateName: [profile.firstName, profile.lastName].filter(Boolean).join(' ') || 'there',
                jobTitle: job.title,
                employerName,
                hasResume: !!applicationResumeUrl,
                hasCoverLetter: !!sanitizedCoverLetter,
            });
        } catch (confirmError) {
            logger.error('Failed to send application confirmation to candidate', confirmError);
        }
    }

    // Trigger AI candidate scoring in the background (audit B91).
    // after() keeps the invocation alive until scoring completes: a bare
    // fire-and-forget promise can be frozen with the function as soon as
    // the response returns on serverless, silently never computing the
    // score. Same pattern as the messaging routes' notification emails.
    if (!decision.autoReject) {
        after(
            import('@/lib/candidate-scorer')
                .then(({ scoreCandidate }) => scoreCandidate(application.id, jobId, userId))
                .catch(err => logger.error('AI candidate scoring failed', err))
        );
    }

    return {
        ok: true,
        applicationId: application.id,
        isNew,
        appliedAt: application.appliedAt,
        autoRejected: decision.autoReject,
        autoRejectReason: decision.autoRejectReason,
        job: { id: job.id, title: job.title, employer: employerName },
        hasResume: !!applicationResumeUrl,
    };
}

/**
 * The answer as its question type allows, or what to fix. The website's form
 * offers only valid answers, but the API and the AI app accept any string,
 * and a knockout rule compares exact text: "No, not yet" or "false" on a
 * Yes/No question slipped past a knockout answer of "No". A select answer is
 * stored as the option itself.
 */
function checkAnswerType(
    q: { questionText: string; questionType: string; options: string[] },
    value: string,
): { ok: true; value: string } | { ok: false; error: string } {
    if (value === '') return { ok: true, value };
    switch (q.questionType) {
        case 'boolean':
            return /^(yes|no)$/i.test(value)
                ? { ok: true, value }
                : { ok: false, error: `Please answer "${q.questionText}" with Yes or No.` };
        case 'number':
            // Stored in canonical form ("0.0" and "00" are "0"), so a knockout
            // rule compares numbers, not spellings.
            return Number.isFinite(Number(value))
                ? { ok: true, value: String(Number(value)) }
                : { ok: false, error: `Please answer "${q.questionText}" with a number.` };
        case 'select': {
            // A select with nothing to choose is answered as text, as on the form.
            if (!q.options || q.options.length === 0) return { ok: true, value };
            const option = q.options.find((o) => o.toLowerCase() === value.toLowerCase());
            return option !== undefined
                ? { ok: true, value: option }
                : { ok: false, error: `Please answer "${q.questionText}" with one of: ${q.options.join(', ')}.` };
        }
        default:
            return { ok: true, value };
    }
}

/** A knockout answer as an answer to its question is stored: a number in its canonical form, anything else as written. */
function knockoutValue(questionType: string, knockoutAnswer: string): string {
    if (questionType !== 'number') return knockoutAnswer;
    const trimmed = knockoutAnswer.trim();
    return trimmed !== '' && Number.isFinite(Number(trimmed)) ? String(Number(trimmed)) : knockoutAnswer;
}
