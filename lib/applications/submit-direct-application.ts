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
 */
import { after } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { toOwnResumePath } from '@/lib/resume-storage';
import { isSandboxJob } from '@/lib/mcp/sandbox';
import { buildApplicationStatusFields } from './status-fields';

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
    coverLetter: unknown;
    coverLetterUrl: unknown;
    resumeUrl: unknown;
    consent: unknown;
    screeningAnswers: unknown;
    /**
     * Accept an unpublished review sandbox job (lib/mcp/sandbox.ts). Only the
     * AI app sets it, and only for a reviewer account.
     */
    allowSandboxJob?: boolean;
}

export interface SubmittedJob {
    id: string;
    title: string;
    employer: string;
}

export type DirectApplicationOutcome =
    | {
          ok: true;
          applicationId: string;
          /** True only when this request created the row (see step 5b). */
          isNew: boolean;
          appliedAt: Date;
          autoRejected: boolean;
          autoRejectReason: string;
          job: SubmittedJob;
      }
    | { ok: false; status: 400 | 403 | 404; error: string };

function refuse(status: 400 | 403 | 404, error: string): DirectApplicationOutcome {
    return { ok: false, status, error };
}

// ── Submission ───────────────────────────────────────────────────────────────

export async function submitDirectApplication(input: DirectApplicationRequest): Promise<DirectApplicationOutcome> {
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

    // 3. Verify the job exists and accepts platform applications
    const job = await prisma.job.findUnique({
        where: { id: jobId },
        select: {
            id: true,
            title: true,
            employer: true,
            applyOnPlatform: true,
            isPublished: true,
            expiresAt: true,
            sourceProvider: true,
            employerJobs: {
                select: {
                    contactEmail: true,
                    employerName: true,
                    notifyOnApplication: true,
                },
            },
        },
    });

    if (!job) {
        return refuse(404, 'Job not found');
    }

    if (!job.applyOnPlatform) {
        return refuse(400, 'This job does not accept platform applications');
    }

    // A review sandbox job is unpublished by design; only a caller that
    // vouches for a reviewer account may reach it (lib/mcp/sandbox.ts).
    const sandboxJob = isSandboxJob({ isPublished: job.isPublished, sourceProvider: job.sourceProvider ?? null });
    if (!job.isPublished && !(sandboxJob && input.allowSandboxJob === true)) {
        return refuse(400, 'This job is no longer active');
    }

    if (job.expiresAt && new Date(job.expiresAt) < new Date()) {
        return refuse(400, 'This job has expired');
    }

    // 4. Get applicant profile
    const profile = await prisma.userProfile.findUnique({
        where: { supabaseId: userId },
        select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            resumeUrl: true,
            headline: true,
            yearsExperience: true,
        },
    });

    if (!profile) {
        return refuse(403, 'User profile not found');
    }

    // Use provided (validated) resume URL, or fall back to profile resume.
    // The profile column is writable by its owner too (APP-2), so the
    // fallback passes the same check; a value outside the applicant's own
    // folder counts as no resume.
    const applicationResumeUrl = validResumeUrl || toOwnResumePath(profile.resumeUrl, userId);

    // 5a. Validate screening answers (if the job has questions)
    let validatedAnswers: { questionId: string; questionText: string; answer: string }[] | null = null;
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

            const answerValue = answer ? String(answer.answer).trim() : '';

            // Check knockout answers
            if (q.isKnockout && q.knockoutAnswer && answerValue.toLowerCase() === q.knockoutAnswer.toLowerCase()) {
                autoReject = true;
                autoRejectReason = `Does not meet requirement: ${q.questionText}`;
            }

            validatedAnswers.push({
                questionId: q.id,
                questionText: q.questionText,
                answer: answerValue,
            });
        }
    } else if (questions.length > 0) {
        // Job has questions but no answers submitted — check if any are required
        const hasRequired = questions.some(q => q.isRequired);
        if (hasRequired) {
            return refuse(400, 'Please answer the required screening questions');
        }
    }

    // 5b. Upsert the application (don't duplicate if user already applied).
    // The existing row's state decides the status: a withdrawn application
    // that is re-submitted becomes active again (see status-fields.ts).
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
    const { application, isNew } = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${applicationLockKey(userId, jobId)}))`;

        const existingApplication = await tx.jobApplication.findUnique({
            where: { userId_jobId: { userId, jobId } },
            select: { status: true, withdrawnAt: true },
        });
        const statusFields = buildApplicationStatusFields(existingApplication, autoReject, autoRejectReason);

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
                ...(validatedAnswers && { screeningAnswers: validatedAnswers }),
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
        return { application: saved, isNew: existingApplication === null };
    });

    // 6. Send notification email to the employer (fire-and-forget)
    const employerEmail = job.employerJobs?.contactEmail;
    const shouldNotify = job.employerJobs?.notifyOnApplication !== false; // default true
    if (employerEmail && shouldNotify) {
        try {
            const { sendNewApplicationEmail } = await import('@/lib/email-service');
            await sendNewApplicationEmail({
                employerEmail,
                employerName: job.employerJobs?.employerName || job.employer,
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

    // 7. Send confirmation email to the CANDIDATE (fire-and-forget)
    if (profile.email) {
        try {
            const { sendApplicationConfirmationEmail } = await import('@/lib/email-service');
            await sendApplicationConfirmationEmail({
                candidateEmail: profile.email,
                candidateName: [profile.firstName, profile.lastName].filter(Boolean).join(' ') || 'there',
                jobTitle: job.title,
                employerName: job.employerJobs?.employerName || job.employer,
                hasResume: !!applicationResumeUrl,
                hasCoverLetter: !!sanitizedCoverLetter,
            });
        } catch (confirmError) {
            logger.error('Failed to send application confirmation to candidate', confirmError);
        }
    }

    // 8. Trigger AI candidate scoring in the background (audit B91).
    // after() keeps the invocation alive until scoring completes — a bare
    // fire-and-forget promise can be frozen with the function as soon as
    // the response returns on serverless, silently never computing the
    // score. Same pattern as the messaging routes' notification emails.
    // A sandbox job has no employer to read a score, so it is never scored.
    if (!autoReject && !sandboxJob) {
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
        autoRejected: autoReject,
        autoRejectReason,
        job: { id: job.id, title: job.title, employer: job.employerJobs?.employerName || job.employer },
    };
}
