/**
 * Tool names, labels and limits shared by the MCP server (lib/mcp) and the
 * widget bundle (lib/mcp/widgets). Plain values only: the widget imports this
 * file at runtime, so it must never pull zod, Prisma or a server module into
 * the bundle (lib/mcp/contracts.ts carries the schemas, imported there as
 * types only).
 */

export const TOOL = {
    searchJobs: 'search_jobs',
    getJob: 'get_job',
    practiceAuthority: 'get_state_practice_authority',
    profileStatus: 'get_my_profile_status',
    startApplication: 'start_application',
    submitApplication: 'submit_application',
    trackEmployerSiteApplication: 'track_employer_site_application',
    listApplications: 'list_my_applications',
    withdrawApplication: 'withdraw_application',
    saveJob: 'save_job',
    unsaveJob: 'unsave_job',
    listSavedJobs: 'list_saved_jobs',
} as const;

export type ToolName = (typeof TOOL)[keyof typeof TOOL];

/**
 * Longest cover letter kept. Equals MAX_COVER_LETTER_LENGTH in
 * lib/applications/submit-direct-application.ts, which truncates past it
 * (tests/mcp/contracts.test.ts pins the two together).
 */
export const COVER_LETTER_MAX = 5000;

/** Longest screening answer the connector accepts. */
export const SCREENING_ANSWER_MAX = 1000;

/** The status words My Applications shows (app/my-applications/page.tsx). */
export const APPLICATION_STATUS_LABELS = {
    applied: 'Applied',
    screening: 'Screening',
    interview: 'Interview',
    offered: 'Offered',
    hired: 'Hired',
    rejected: 'Not Selected',
    withdrawn: 'Withdrawn',
} as const;

export type ApplicationStatus = keyof typeof APPLICATION_STATUS_LABELS;

export const APPLICATION_STATUSES = Object.keys(APPLICATION_STATUS_LABELS) as [ApplicationStatus, ...ApplicationStatus[]];

/** The consent line the site's Easy Apply form shows (components/InPlatformApplyForm.tsx). */
export const APPLY_CONSENT_TEXT =
    'I consent to sharing my profile, resume, and cover letter with this employer. You may withdraw your application at any time.';
