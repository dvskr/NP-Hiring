/**
 * Input and output contracts of the NP Hiring MCP tools (lib/mcp/server.ts).
 *
 * The output schemas are also the data the widget renders: every tool with a
 * UI returns `structuredContent` shaped by one of the `*ViewSchema` objects
 * below, told apart by `view`. The widget imports this file as types only
 * (`import type`), so nothing here reaches its bundle; runtime constants it
 * needs live in lib/mcp/tool-names.ts.
 *
 * Directory rules these shapes keep (2026-10-25 research, docs/ai-apps):
 * no NPI, DEA, license numbers or EEO fields in or out; no employer-private
 * fields (notes, AI match score, contact email); an employer's apply link
 * only in signed-in results (the site shows it only to signed-in candidates).
 */
import { z } from 'zod';
import { CATEGORY_AXES } from '@/lib/pseo/taxonomy-registry';
import {
    APPLICATION_STATUSES,
    COVER_LETTER_MAX,
    SCREENING_ANSWER_MAX,
} from '@/lib/mcp/tool-names';

// ── Shared input pieces ────────────────────────────────────────────────────

/** A job id from search results, or the nphiring.com job URL (its slug ends in the id). */
export const jobIdInput = z
    .string()
    .trim()
    .min(1)
    .max(300)
    .describe('The job id from search_jobs, or the job URL on nphiring.com');

/** NP specialties and the APRN roles beyond NPs (lib/pseo/taxonomy-registry.ts). */
export const SPECIALTY_SLUGS = [...CATEGORY_AXES.specialty, ...CATEGORY_AXES.aprn] as const;

/** Care settings searchable as a category ('remote' is a work mode instead). */
export const SETTING_SLUGS = ['telehealth', 'inpatient', 'outpatient', 'urgent-care', 'home-health', 'travel'] as const;

export const WORK_MODE_VALUES = ['remote', 'hybrid', 'onsite'] as const;
export const JOB_TYPE_VALUES = ['full_time', 'part_time', 'contract', 'per_diem'] as const;
export const POSTED_WITHIN_VALUES = ['24h', '3d', '7d', '30d'] as const;
export const SORT_VALUES = ['relevance', 'newest', 'salary'] as const;

// ── Tool inputs ────────────────────────────────────────────────────────────

export const searchJobsInput = z.object({
    query: z
        .string()
        .trim()
        .max(200)
        .optional()
        .describe('Keywords such as a specialty, employer, setting or city, for example "pediatric urgent care"'),
    state: z
        .string()
        .trim()
        .min(2)
        .max(40)
        .optional()
        .describe('US state name or two-letter code, for example "Texas" or "TX"'),
    city: z.string().trim().min(2).max(80).optional().describe('City name. Use together with state.'),
    work_mode: z.array(z.enum(WORK_MODE_VALUES)).max(3).optional(),
    job_type: z.array(z.enum(JOB_TYPE_VALUES)).max(4).optional(),
    specialty: z.enum(SPECIALTY_SLUGS).optional().describe('NP specialty or APRN role'),
    setting: z.enum(SETTING_SLUGS).optional(),
    min_salary: z
        .number()
        .int()
        .min(20_000)
        .max(1_000_000)
        .optional()
        .describe('Minimum yearly pay in US dollars'),
    posted_within: z.enum(POSTED_WITHIN_VALUES).optional(),
    new_grad_friendly: z.boolean().optional().describe('Only jobs open to new graduate NPs'),
    max_years_required: z
        .number()
        .int()
        .min(0)
        .max(30)
        .optional()
        .describe("The candidate's years of NP experience; only jobs that require no more than this"),
    easy_apply_only: z.boolean().optional().describe('Only jobs that take Easy Apply applications on NP Hiring'),
    sort: z.enum(SORT_VALUES).optional(),
    page: z.number().int().min(1).max(20).optional(),
    limit: z.number().int().min(1).max(10).optional().describe('Jobs per page, 6 when omitted'),
});
export type SearchJobsInput = z.infer<typeof searchJobsInput>;

export const getJobInput = z.object({ job_id: jobIdInput });

export const practiceAuthorityInput = z.object({
    state: z.string().trim().min(2).max(40).describe('US state name or two-letter code'),
});

export const startApplicationInput = z.object({
    job_id: jobIdInput,
    cover_letter_draft: z
        .string()
        .max(COVER_LETTER_MAX)
        .optional()
        .describe('A cover letter drafted for this job. The candidate reviews and edits it before anything is sent.'),
});

export const screeningAnswerInput = z.object({
    question_id: z.string().min(1).max(64),
    answer: z.string().max(SCREENING_ANSWER_MAX),
});

export const submitApplicationInput = z.object({
    job_id: jobIdInput,
    cover_letter: z.string().max(COVER_LETTER_MAX).optional(),
    screening_answers: z.array(screeningAnswerInput).max(50).optional(),
    consent: z
        .literal(true)
        .describe(
            'true only after the candidate agreed to share their NP Hiring profile, resume and cover letter with this employer',
        ),
});
export type SubmitApplicationInput = z.infer<typeof submitApplicationInput>;

export const jobOnlyInput = z.object({ job_id: jobIdInput });

export const listApplicationsInput = z.object({
    status: z.enum(APPLICATION_STATUSES).optional(),
    limit: z.number().int().min(1).max(50).optional().describe('20 when omitted'),
});

export const withdrawApplicationInput = z.object({
    application_id: z.string().trim().min(1).max(64).describe('The application id from list_my_applications'),
});

export const listSavedJobsInput = z.object({
    limit: z.number().int().min(1).max(50).optional().describe('20 when omitted'),
});

export const emptyInput = z.object({});

// ── Shared output pieces ───────────────────────────────────────────────────

export const APPLY_ROUTES = ['easy_apply', 'employer_site', 'external', 'none'] as const;
export type ApplyRouteValue = (typeof APPLY_ROUTES)[number];

export const jobSummarySchema = z.object({
    id: z.string(),
    title: z.string(),
    employer: z.string(),
    /** "Austin, TX", "Remote" or the stored location line. */
    location: z.string(),
    workMode: z.enum(['Remote', 'Hybrid', 'On site']).nullable(),
    /** As stored: "Full-Time", "Part-Time", "Contract", "Per Diem". */
    jobType: z.string().nullable(),
    /** Display pay without dashes, for example "$128k to $146k/yr". */
    pay: z.string().nullable(),
    payIsEstimate: z.boolean(),
    experience: z.string().nullable(),
    newGradFriendly: z.boolean(),
    /** ISO 8601. */
    postedAt: z.string(),
    easyApply: z.boolean(),
    /** The job page on nphiring.com; null for a reviewer sandbox job. */
    url: z.string().nullable(),
    /** A reviewer sandbox job (only ever shown to reviewer accounts). */
    sandbox: z.boolean(),
    /** Null when signed out. */
    saved: z.boolean().nullable(),
    /** The candidate's application status for this job; null when none or signed out. */
    applicationStatus: z.enum(APPLICATION_STATUSES).nullable(),
});
export type JobSummary = z.infer<typeof jobSummarySchema>;

export const screeningQuestionSchema = z.object({
    id: z.string(),
    text: z.string(),
    type: z.enum(['boolean', 'text', 'select', 'number']),
    options: z.array(z.string()),
    required: z.boolean(),
});
export type ScreeningQuestion = z.infer<typeof screeningQuestionSchema>;

export const applicationRefSchema = z.object({
    id: z.string(),
    status: z.enum(APPLICATION_STATUSES),
    statusLabel: z.string(),
    appliedAt: z.string(),
});

// ── Views (structuredContent of tools with a UI) ───────────────────────────

export const jobListViewSchema = z.object({
    view: z.literal('job-list'),
    heading: z.string(),
    /** Plain words for the filters applied, for example "Remote", "Texas", "$150k+/yr". */
    filters: z.array(z.string()),
    total: z.number().int(),
    page: z.number().int(),
    totalPages: z.number().int(),
    jobs: z.array(jobSummarySchema),
    /** search_jobs arguments for the next page, or null on the last page and for saved jobs. */
    nextPageArgs: searchJobsInput.nullable(),
    /** The same search on nphiring.com. */
    browseUrl: z.string(),
    signedIn: z.boolean(),
});
export type JobListView = z.infer<typeof jobListViewSchema>;

export const jobDetailSchema = jobSummarySchema.extend({
    summary: z.string().nullable(),
    /** Plain text, newlines kept. */
    description: z.string(),
    descriptionTruncated: z.boolean(),
    setting: z.string().nullable(),
    population: z.string().nullable(),
    benefits: z.array(z.string()),
    experienceNote: z.string().nullable(),
    applyRoute: z.enum(APPLY_ROUTES),
    screeningQuestionCount: z.number().int(),
    /** ISO 8601, when the posting last changed. */
    updatedAt: z.string().nullable(),
});
export type JobDetail = z.infer<typeof jobDetailSchema>;

export const jobDetailViewSchema = z.object({
    view: z.literal('job-detail'),
    job: jobDetailSchema,
    signedIn: z.boolean(),
});
export type JobDetailView = z.infer<typeof jobDetailViewSchema>;

export const applyViewSchema = z.object({
    view: z.literal('apply'),
    job: jobSummarySchema.extend({ applyRoute: z.enum(APPLY_ROUTES) }),
    candidate: z.object({
        firstName: z.string().nullable(),
        headline: z.string().nullable(),
    }),
    resume: z.object({
        onFile: z.boolean(),
        /** The uploaded file's own name, for example "Jane-Doe-CV.pdf". */
        fileName: z.string().nullable(),
    }),
    questions: z.array(screeningQuestionSchema),
    coverLetterDraft: z.string(),
    coverLetterMax: z.number().int(),
    consentText: z.string(),
    privacyUrl: z.string(),
    /** Where the candidate adds or replaces their resume. */
    profileUrl: z.string(),
    /** The employer's application page (employer site and external jobs only). */
    employerApplyUrl: z.string().nullable(),
    existingApplication: applicationRefSchema.nullable(),
    /** True when the job can take an Easy Apply submission right now. */
    canSubmit: z.boolean(),
    /** Why it cannot, in plain words; null when it can. */
    blockedReason: z.string().nullable(),
});
export type ApplyView = z.infer<typeof applyViewSchema>;

export const applyResultViewSchema = z.object({
    view: z.literal('apply-result'),
    applicationId: z.string(),
    job: jobSummarySchema,
    /** False for a first submission; true when an existing application was updated. */
    resubmitted: z.boolean(),
    appliedAt: z.string(),
    myApplicationsUrl: z.string(),
});
export type ApplyResultView = z.infer<typeof applyResultViewSchema>;

export const applicationItemSchema = z.object({
    id: z.string(),
    jobId: z.string(),
    title: z.string(),
    employer: z.string(),
    location: z.string(),
    appliedAt: z.string(),
    status: z.enum(APPLICATION_STATUSES),
    statusLabel: z.string(),
    /** Sent through Easy Apply (false: tracked after applying on the employer's site). */
    easyApply: z.boolean(),
    jobUrl: z.string().nullable(),
    jobOpen: z.boolean(),
    canWithdraw: z.boolean(),
});
export type ApplicationItem = z.infer<typeof applicationItemSchema>;

export const applicationsViewSchema = z.object({
    view: z.literal('applications'),
    applications: z.array(applicationItemSchema),
    /** Count per status label, in pipeline order, only statuses present. */
    summary: z.array(z.object({ status: z.enum(APPLICATION_STATUSES), label: z.string(), count: z.number().int() })),
    total: z.number().int(),
    myApplicationsUrl: z.string(),
});
export type ApplicationsView = z.infer<typeof applicationsViewSchema>;

export type WidgetView = JobListView | JobDetailView | ApplyView | ApplyResultView | ApplicationsView;

// ── Outputs of tools without a UI ──────────────────────────────────────────

export const practiceAuthorityOutput = z.object({
    state: z.string(),
    authority: z.enum(['full', 'reduced', 'restricted']),
    /** AANP's tier name: "Full Practice", "Reduced Practice" or "Restricted Practice". */
    label: z.string(),
    /** What the state itself requires. */
    details: z.string(),
    /** What AANP means by the tier. */
    tierDefinition: z.string(),
    source: z.string(),
    sourceUrl: z.string(),
});

export const profileStatusOutput = z.object({
    firstName: z.string().nullable(),
    headline: z.string().nullable(),
    yearsExperience: z.number().int().nullable(),
    specialties: z.array(z.string()),
    licenseStates: z.array(z.string()),
    resume: z.object({ onFile: z.boolean(), fileName: z.string().nullable() }),
    /** Profile completeness, 0 to 100, as the site's dashboard scores it. */
    completeness: z.number().int(),
    missing: z.array(z.string()),
    profileUrl: z.string(),
});

export const trackApplicationOutput = z.object({
    applicationId: z.string(),
    jobId: z.string(),
    alreadyTracked: z.boolean(),
    employerApplyUrl: z.string().nullable(),
    myApplicationsUrl: z.string(),
});

export const withdrawApplicationOutput = z.object({
    applicationId: z.string(),
    status: z.literal('withdrawn'),
    jobTitle: z.string(),
    employer: z.string(),
});

export const savedJobOutput = z.object({
    jobId: z.string(),
    saved: z.boolean(),
});
