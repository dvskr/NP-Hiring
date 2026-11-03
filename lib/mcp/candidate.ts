/**
 * The signed-in candidate's side of the MCP tools: starting, submitting and
 * tracking applications, the application tracker, withdrawals, saved jobs
 * and the profile status. Every query is scoped to the caller's own Supabase
 * id, which comes from a verified access token (lib/mcp/auth.ts), never from
 * a tool argument.
 *
 * Each write repeats the rules of the site route it mirrors:
 *   submit   lib/applications/submit-direct-application.ts (shared)
 *   track    POST /api/applications (a tracker row, never rewritten)
 *   withdraw DELETE /api/applications/withdraw (scrubs the cover letter,
 *            resume and employer notes, keeps the row as 'withdrawn')
 *   save     POST and DELETE /api/saved-jobs
 * Errors a candidate can act on come back as plain sentences (a string), and
 * the tool turns them into an error result.
 */
import { brand } from '@/config/brand';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { activeIndexableJobWhere } from '@/lib/active-job-filter';
import { calculateCompleteness } from '@/lib/profile-completeness';
import { toOwnResumePath } from '@/lib/resume-storage';
import { safeApplyHref } from '@/components/jobs/safe-external-href';
import { submitDirectApplication } from '@/lib/applications/submit-direct-application';
import type {
    ApplicationItem,
    ApplicationsView,
    ApplyResultView,
    ApplyView,
    JobListView,
    ScreeningQuestion,
    SubmitApplicationInput,
} from '@/lib/mcp/contracts';
import { mcpBaseUrl } from '@/lib/mcp/config';
import { REVIEW_SANDBOX_SOURCE_PROVIDER, isSandboxJob } from '@/lib/mcp/sandbox';
import {
    APPLICATION_STATUSES,
    APPLY_CONSENT_TEXT,
    COVER_LETTER_MAX,
    type ApplicationStatus,
} from '@/lib/mcp/tool-names';
import {
    JOB_SUMMARY_SELECT,
    applicationStatus,
    applicationStatusLabel,
    applyRouteValue,
    jobPageUrl,
    locationLabel,
    resumeFileName,
    toJobSummary,
    type JobSummaryRow,
} from '@/lib/mcp/format';
import { parseJobId, viewerJobStates, visibleJobWhere, type McpViewer } from '@/lib/mcp/jobs';

export const JOB_GONE = `This job is no longer available on ${brand.name}.`;
const APPLICATION_NOT_FOUND = 'No application of yours has that id.';

function siteUrl(path: string): string {
    return `${mcpBaseUrl()}${path}`;
}

/** Where the candidate adds or replaces a resume (the Personal tab of Settings). */
export function profileResumeUrl(): string {
    return siteUrl('/settings?tab=personal#section-resume');
}

const APPLY_SELECT = {
    ...JOB_SUMMARY_SELECT,
    applyLink: true,
    sourceType: true,
    screeningQuestions: {
        orderBy: { sortOrder: 'asc' },
        select: { id: true, questionText: true, questionType: true, options: true, isRequired: true },
    },
} as const;

const QUESTION_TYPES: ReadonlySet<ScreeningQuestion['type']> = new Set(['boolean', 'text', 'select', 'number']);

function toQuestion(row: {
    id: string;
    questionText: string;
    questionType: string;
    options: string[];
    isRequired: boolean;
}): ScreeningQuestion {
    // Knockout settings are employer-private and never leave the server.
    return {
        id: row.id,
        text: row.questionText,
        type: QUESTION_TYPES.has(row.questionType as ScreeningQuestion['type'])
            ? (row.questionType as ScreeningQuestion['type'])
            : 'text',
        options: row.options,
        required: row.isRequired,
    };
}

function blockedReasonFor(route: ApplyView['job']['applyRoute']): string | null {
    if (route === 'easy_apply') return null;
    if (route === 'none') return 'This job has no application link right now.';
    return "This employer takes applications on their own site.";
}

/** The candidate's resume as the apply form would use it: only a key in their own upload folder counts. */
async function ownResume(userId: string): Promise<{ onFile: boolean; fileName: string | null; firstName: string | null; headline: string | null }> {
    const profile = await prisma.userProfile.findUnique({
        where: { supabaseId: userId },
        select: { firstName: true, headline: true, resumeUrl: true },
    });
    const path = toOwnResumePath(profile?.resumeUrl ?? null, userId);
    return {
        onFile: path !== null,
        fileName: resumeFileName(path),
        firstName: profile?.firstName ?? null,
        headline: profile?.headline ?? null,
    };
}

// ── start_application ────────────────────────────────────────────────────────

export async function startApplication(viewer: McpViewer, jobArg: string, draft?: string): Promise<ApplyView | string> {
    const jobId = parseJobId(jobArg);
    if (!jobId) return JOB_GONE;
    const job = await prisma.job.findFirst({ where: visibleJobWhere(jobId, viewer), select: APPLY_SELECT });
    if (!job) return JOB_GONE;

    const [resume, existing, states] = await Promise.all([
        ownResume(viewer.userId),
        prisma.jobApplication.findUnique({
            where: { userId_jobId: { userId: viewer.userId, jobId: job.id } },
            select: { id: true, status: true, withdrawnAt: true, appliedAt: true },
        }),
        viewerJobStates(viewer, [job.id]),
    ]);

    const route = applyRouteValue(job);
    const status: ApplicationStatus | null = existing ? applicationStatus(existing.status, existing.withdrawnAt) : null;

    return {
        view: 'apply',
        job: { ...toJobSummary(job, states.get(job.id) ?? null), applyRoute: route },
        candidate: { firstName: resume.firstName, headline: resume.headline },
        resume: { onFile: resume.onFile, fileName: resume.fileName },
        questions: route === 'easy_apply' ? job.screeningQuestions.map(toQuestion) : [],
        coverLetterDraft: (draft ?? '').slice(0, COVER_LETTER_MAX),
        coverLetterMax: COVER_LETTER_MAX,
        consentText: APPLY_CONSENT_TEXT,
        privacyUrl: siteUrl('/privacy'),
        profileUrl: profileResumeUrl(),
        employerApplyUrl: route === 'employer_site' || route === 'external' ? safeApplyHref(job.applyLink) : null,
        existingApplication:
            existing && status
                ? {
                      id: existing.id,
                      status,
                      statusLabel: applicationStatusLabel(status),
                      appliedAt: existing.appliedAt.toISOString(),
                  }
                : null,
        canSubmit: route === 'easy_apply',
        blockedReason: blockedReasonFor(route),
    };
}

// ── submit_application ───────────────────────────────────────────────────────

/** The shared routine's refusals, reworded where the site's wording assumes the apply form. */
const SUBMIT_REFUSALS: Readonly<Record<string, string>> = {
    'This job does not accept platform applications':
        "This employer takes applications on their own site, not through Easy Apply.",
    'This job is no longer active': JOB_GONE,
    'This job has expired': JOB_GONE,
    'Job not found': JOB_GONE,
    'User profile not found': `Your ${brand.name} profile could not be found. Sign in on ${brand.domain} once, then try again.`,
    'You must consent to sharing your data with the employer':
        'The candidate has to agree to share their profile, resume and cover letter with this employer first.',
};

export async function submitApplication(viewer: McpViewer, input: SubmitApplicationInput): Promise<ApplyResultView | string> {
    const limited = await checkRateLimit(`mcp:submit:${viewer.userId}`, RATE_LIMITS.applyDirect);
    if (!limited.success) return 'Too many applications in a short time. Wait a minute and try again.';

    const jobId = parseJobId(input.job_id);
    if (!jobId) return JOB_GONE;
    // The job page gates the site's apply form; this is the same gate.
    const job = await prisma.job.findFirst({ where: visibleJobWhere(jobId, viewer), select: JOB_SUMMARY_SELECT });
    if (!job) return JOB_GONE;

    const outcome = await submitDirectApplication({
        userId: viewer.userId,
        jobId: job.id,
        coverLetter: input.cover_letter,
        coverLetterUrl: undefined,
        resumeUrl: undefined,
        consent: input.consent,
        screeningAnswers: (input.screening_answers ?? []).map((a) => ({ questionId: a.question_id, answer: a.answer })),
        allowSandboxJob: viewer.reviewer,
    });

    if (!outcome.ok) return SUBMIT_REFUSALS[outcome.error] ?? outcome.error;

    logger.info('[mcp] Easy Apply submitted', { applicationId: outcome.applicationId, jobId: job.id, userId: viewer.userId });

    const states = await viewerJobStates(viewer, [job.id]);
    return {
        view: 'apply-result',
        applicationId: outcome.applicationId,
        job: toJobSummary(job, states.get(job.id) ?? null),
        resubmitted: !outcome.isNew,
        // A resubmission keeps the first appliedAt; the result reports when it was updated.
        appliedAt: (outcome.isNew && outcome.appliedAt ? outcome.appliedAt : new Date()).toISOString(),
        myApplicationsUrl: siteUrl('/my-applications'),
    };
}

// ── track_employer_site_application ─────────────────────────────────────────

export interface TrackResult {
    applicationId: string;
    jobId: string;
    alreadyTracked: boolean;
    employerApplyUrl: string | null;
    myApplicationsUrl: string;
}

function prismaErrorCode(error: unknown): string | undefined {
    return (error as { code?: string } | null)?.code;
}

export async function trackEmployerSiteApplication(viewer: McpViewer, jobArg: string): Promise<TrackResult | string> {
    const jobId = parseJobId(jobArg);
    if (!jobId) return JOB_GONE;
    const job = await prisma.job.findFirst({
        where: visibleJobWhere(jobId, viewer),
        select: { id: true, applyLink: true, sourceType: true, applyOnPlatform: true },
    });
    if (!job) return JOB_GONE;

    const route = applyRouteValue(job);
    if (route === 'easy_apply') return 'This job takes Easy Apply. Use start_application, then submit_application.';
    if (route === 'none') return 'This job has no application link right now.';

    const employerApplyUrl = safeApplyHref(job.applyLink);
    const key = { userId_jobId: { userId: viewer.userId, jobId: job.id } };
    const existing = await prisma.jobApplication.findUnique({ where: key, select: { id: true } });
    if (existing) {
        return { applicationId: existing.id, jobId: job.id, alreadyTracked: true, employerApplyUrl, myApplicationsUrl: siteUrl('/my-applications') };
    }

    // Same row POST /api/applications writes: created once, then never rewritten.
    let createdId: string;
    try {
        const created = await prisma.jobApplication.create({
            data: { userId: viewer.userId, jobId: job.id, sourceUrl: employerApplyUrl },
            select: { id: true },
        });
        createdId = created.id;
    } catch (error) {
        if (prismaErrorCode(error) !== 'P2002') throw error;
        const raced = await prisma.jobApplication.findUnique({ where: key, select: { id: true } });
        if (!raced) throw error;
        return { applicationId: raced.id, jobId: job.id, alreadyTracked: true, employerApplyUrl, myApplicationsUrl: siteUrl('/my-applications') };
    }
    return { applicationId: createdId, jobId: job.id, alreadyTracked: false, employerApplyUrl, myApplicationsUrl: siteUrl('/my-applications') };
}

// ── list_my_applications ─────────────────────────────────────────────────────

export const DEFAULT_LIST_LIMIT = 20;

export async function listApplications(
    viewer: McpViewer,
    status: ApplicationStatus | undefined,
    limit: number = DEFAULT_LIST_LIMIT,
): Promise<ApplicationsView> {
    const now = new Date();
    const statusWhere =
        status === undefined
            ? {}
            : status === 'withdrawn'
              ? { OR: [{ status: 'withdrawn' }, { withdrawnAt: { not: null } }] }
              : { status, withdrawnAt: null };

    // Candidate-visible columns only, the allowlist GET /api/applications keeps
    // (employer notes and the AI assessment never leave the server).
    const [rows, counts] = await Promise.all([
        prisma.jobApplication.findMany({
            where: { userId: viewer.userId, ...statusWhere },
            orderBy: { appliedAt: 'desc' },
            take: limit,
            select: {
                id: true,
                jobId: true,
                appliedAt: true,
                status: true,
                withdrawnAt: true,
                sourceUrl: true,
                job: {
                    select: {
                        id: true,
                        title: true,
                        slug: true,
                        employer: true,
                        location: true,
                        city: true,
                        state: true,
                        stateCode: true,
                        isRemote: true,
                        isPublished: true,
                        expiresAt: true,
                        sourceProvider: true,
                    },
                },
            },
        }),
        // Grouped by withdrawnAt too, so the summary applies the list's
        // withdrawn rule (withdrawnAt wins over a status an employer set later).
        prisma.jobApplication.groupBy({
            by: ['status', 'withdrawnAt'],
            where: { userId: viewer.userId },
            _count: { _all: true },
        }),
    ]);

    const applications: ApplicationItem[] = rows.map((row) => {
        const rowStatus = applicationStatus(row.status, row.withdrawnAt);
        const sandbox = isSandboxJob(row.job);
        const open = sandbox || (row.job.isPublished && (!row.job.expiresAt || row.job.expiresAt > now));
        return {
            id: row.id,
            jobId: row.jobId,
            title: row.job.title,
            employer: row.job.employer,
            location: locationLabel(row.job),
            appliedAt: row.appliedAt.toISOString(),
            status: rowStatus,
            statusLabel: applicationStatusLabel(rowStatus),
            easyApply: row.sourceUrl === 'platform',
            jobUrl: open ? jobPageUrl(row.job) : null,
            jobOpen: open,
            canWithdraw: rowStatus !== 'withdrawn',
        };
    });

    const countByStatus = new Map<ApplicationStatus, number>();
    for (const group of counts) {
        const key = applicationStatus(group.status, group.withdrawnAt);
        countByStatus.set(key, (countByStatus.get(key) ?? 0) + group._count._all);
    }
    const summary = APPLICATION_STATUSES.filter((s) => (countByStatus.get(s) ?? 0) > 0).map((s) => ({
        status: s,
        label: applicationStatusLabel(s),
        count: countByStatus.get(s) ?? 0,
    }));

    return {
        view: 'applications',
        applications,
        summary,
        total: summary.reduce((sum, item) => sum + item.count, 0),
        myApplicationsUrl: siteUrl('/my-applications'),
    };
}

// ── withdraw_application ─────────────────────────────────────────────────────

export interface WithdrawResult {
    applicationId: string;
    status: 'withdrawn';
    jobTitle: string;
    employer: string;
}

export async function withdrawApplication(viewer: McpViewer, applicationId: string): Promise<WithdrawResult | string> {
    const application = await prisma.jobApplication.findUnique({
        where: { id: applicationId },
        select: { userId: true, jobId: true, job: { select: { title: true, employer: true } } },
    });
    // Another candidate's application answers exactly like a missing one.
    if (!application || application.userId !== viewer.userId) return APPLICATION_NOT_FOUND;

    // Scrub personal data but keep the record (the withdraw route's GDPR rule).
    await prisma.jobApplication.update({
        where: { id: applicationId },
        data: {
            coverLetter: null,
            resumeUrl: null,
            status: 'withdrawn',
            withdrawnAt: new Date(),
            notes: null,
        },
    });

    logger.info('[mcp] Application withdrawn', { applicationId, userId: viewer.userId, jobId: application.jobId });

    return { applicationId, status: 'withdrawn', jobTitle: application.job.title, employer: application.job.employer };
}

// ── save_job, unsave_job, list_saved_jobs ────────────────────────────────────

export async function saveJob(viewer: McpViewer, jobArg: string): Promise<{ jobId: string; saved: true } | string> {
    const jobId = parseJobId(jobArg);
    if (!jobId) return JOB_GONE;
    const job = await prisma.job.findFirst({ where: visibleJobWhere(jobId, viewer), select: { id: true } });
    if (!job) return JOB_GONE;
    await prisma.savedJob.upsert({
        where: { userId_jobId: { userId: viewer.userId, jobId: job.id } },
        create: { userId: viewer.userId, jobId: job.id },
        update: {},
    });
    return { jobId: job.id, saved: true };
}

export async function unsaveJob(viewer: McpViewer, jobArg: string): Promise<{ jobId: string; saved: false } | string> {
    const jobId = parseJobId(jobArg);
    if (!jobId) return JOB_GONE;
    await prisma.savedJob.deleteMany({ where: { userId: viewer.userId, jobId } });
    return { jobId, saved: false };
}

export async function listSavedJobs(viewer: McpViewer, limit: number = DEFAULT_LIST_LIMIT): Promise<JobListView> {
    const saved = await prisma.savedJob.findMany({
        where: { userId: viewer.userId },
        orderBy: { savedAt: 'desc' },
        take: limit,
        select: { jobId: true },
    });
    const ids = saved.map((row) => row.jobId);
    const visible = viewer.reviewer
        ? { OR: [activeIndexableJobWhere(), { isPublished: false, sourceProvider: REVIEW_SANDBOX_SOURCE_PROVIDER }] }
        : activeIndexableJobWhere();
    const rows: JobSummaryRow[] =
        ids.length === 0
            ? []
            : await prisma.job.findMany({ where: { AND: [{ id: { in: ids } }, visible] }, select: JOB_SUMMARY_SELECT });
    const byId = new Map(rows.map((row) => [row.id, row]));
    // Saved order, newest first; a job that closed since it was saved drops out.
    const ordered = ids.map((id) => byId.get(id)).filter((row): row is JobSummaryRow => row !== undefined);
    const states = await viewerJobStates(viewer, ordered.map((row) => row.id));

    return {
        view: 'job-list',
        heading: 'Saved jobs',
        filters: [],
        total: ordered.length,
        page: 1,
        totalPages: 1,
        jobs: ordered.map((row) => toJobSummary(row, states.get(row.id) ?? null)),
        nextPageArgs: null,
        browseUrl: siteUrl('/saved'),
        signedIn: true,
    };
}

// ── get_my_profile_status ────────────────────────────────────────────────────

export interface ProfileStatus {
    firstName: string | null;
    headline: string | null;
    yearsExperience: number | null;
    specialties: string[];
    licenseStates: string[];
    resume: { onFile: boolean; fileName: string | null };
    completeness: number;
    missing: string[];
    profileUrl: string;
}

function splitList(value: string | null): string[] {
    return (value ?? '')
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
}

/**
 * The profile facts a candidate needs before applying. Federal registration
 * numbers are read only to score completeness (the dashboard's rule) and are
 * never returned, and neither is a "missing" item that names one.
 */
export async function profileStatus(viewer: McpViewer): Promise<ProfileStatus | string> {
    const profile = await prisma.userProfile.findUnique({
        where: { supabaseId: viewer.userId },
        select: {
            firstName: true,
            lastName: true,
            phone: true,
            headline: true,
            addressLine1: true,
            city: true,
            state: true,
            zipCode: true,
            npiNumber: true,
            deaNumber: true,
            resumeUrl: true,
            bio: true,
            specialties: true,
            licenseStates: true,
            yearsExperience: true,
            skills: true,
            _count: {
                select: {
                    licenses: true,
                    certificationRecords: true,
                    education: true,
                    workExperience: true,
                    screeningAnswers: true,
                    openEndedResponses: true,
                    candidateReferences: true,
                },
            },
        },
    });
    if (!profile) return `Your ${brand.name} profile could not be found.`;

    const completeness = calculateCompleteness(profile);
    const resumePath = toOwnResumePath(profile.resumeUrl, viewer.userId);
    const missing = [...completeness.missingItems]
        .sort((a, b) => b.weight - a.weight)
        .map((item) => item.label)
        .filter((label) => !/\b(NPI|DEA)\b/.test(label))
        .slice(0, 5);

    return {
        firstName: profile.firstName,
        headline: profile.headline,
        yearsExperience: profile.yearsExperience,
        specialties: splitList(profile.specialties),
        licenseStates: splitList(profile.licenseStates),
        resume: { onFile: resumePath !== null, fileName: resumeFileName(resumePath) },
        completeness: completeness.percentage,
        missing,
        profileUrl: siteUrl('/settings'),
    };
}
