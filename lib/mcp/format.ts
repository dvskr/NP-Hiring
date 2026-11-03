/**
 * Row-to-contract formatting for the MCP tools: the same display rules the
 * site's job cards and job page use (no dashes in pay, "Remote" for a remote
 * job, the job page URL from its slug), in one place for every tool.
 */
import { formatDisplaySalary, normalizeDisplaySalary } from '@/lib/salary-display';
import { slugify } from '@/lib/utils';
import { resolveApplyRoute, type ApplyRoute } from '@/lib/direct-apply';
import { APPLICATION_STATUS_LABELS, APPLICATION_STATUSES, type ApplicationStatus } from '@/lib/mcp/tool-names';
import type { ApplyRouteValue, JobSummary } from '@/lib/mcp/contracts';
import { mcpBaseUrl } from '@/lib/mcp/config';
import { isSandboxJob } from '@/lib/mcp/sandbox';

/** The job columns every summary needs (a Prisma `select`). */
export const JOB_SUMMARY_SELECT = {
    id: true,
    title: true,
    slug: true,
    employer: true,
    location: true,
    city: true,
    state: true,
    stateCode: true,
    isRemote: true,
    isHybrid: true,
    jobType: true,
    displaySalary: true,
    normalizedMinSalary: true,
    normalizedMaxSalary: true,
    salaryPeriod: true,
    salaryIsEstimated: true,
    experienceLabel: true,
    newGradFriendly: true,
    originalPostedAt: true,
    createdAt: true,
    applyOnPlatform: true,
    isPublished: true,
    sourceProvider: true,
} as const;

export interface JobSummaryRow {
    id: string;
    title: string;
    slug: string | null;
    employer: string;
    location: string;
    city: string | null;
    state: string | null;
    stateCode: string | null;
    isRemote: boolean;
    isHybrid: boolean;
    jobType: string | null;
    displaySalary: string | null;
    normalizedMinSalary: number | null;
    normalizedMaxSalary: number | null;
    salaryPeriod: string | null;
    salaryIsEstimated: boolean;
    experienceLabel: string | null;
    newGradFriendly: boolean;
    originalPostedAt: Date | null;
    createdAt: Date;
    applyOnPlatform: boolean;
    isPublished: boolean;
    sourceProvider: string | null;
}

export interface ViewerJobState {
    saved: boolean;
    applicationStatus: ApplicationStatus | null;
}

/** The job page on the site, or null for a sandbox job (its page answers 410). */
export function jobPageUrl(job: Pick<JobSummaryRow, 'id' | 'slug' | 'title' | 'isPublished' | 'sourceProvider'>): string | null {
    if (isSandboxJob(job)) return null;
    return `${mcpBaseUrl()}/jobs/${job.slug || slugify(job.title, job.id)}`;
}

export function locationLabel(job: Pick<JobSummaryRow, 'location' | 'city' | 'state' | 'stateCode' | 'isRemote'>): string {
    const region = job.stateCode || job.state;
    if (job.city && region) return `${job.city}, ${region}`;
    if (job.isRemote) return 'Remote';
    return job.location;
}

/** The site's Work Mode facet: remote, hybrid, or neither (on site). */
export function workModeLabel(job: Pick<JobSummaryRow, 'isRemote' | 'isHybrid'>): JobSummary['workMode'] {
    if (job.isRemote) return 'Remote';
    if (job.isHybrid) return 'Hybrid';
    return 'On site';
}

/** Display pay, never with a dash (the owner's copy rule; see lib/salary-display.ts). */
export function payLabel(
    job: Pick<JobSummaryRow, 'displaySalary' | 'normalizedMinSalary' | 'normalizedMaxSalary' | 'salaryPeriod'>,
): string | null {
    return (
        normalizeDisplaySalary(job.displaySalary) ??
        formatDisplaySalary(job.normalizedMinSalary, job.normalizedMaxSalary, job.salaryPeriod)
    );
}

export function postedAt(job: Pick<JobSummaryRow, 'originalPostedAt' | 'createdAt'>): string {
    return (job.originalPostedAt ?? job.createdAt).toISOString();
}

export function toJobSummary(job: JobSummaryRow, viewer: ViewerJobState | null): JobSummary {
    return {
        id: job.id,
        title: job.title,
        employer: job.employer,
        location: locationLabel(job),
        workMode: workModeLabel(job),
        jobType: job.jobType,
        pay: payLabel(job),
        payIsEstimate: job.salaryIsEstimated,
        experience: job.experienceLabel,
        newGradFriendly: job.newGradFriendly,
        postedAt: postedAt(job),
        easyApply: job.applyOnPlatform,
        url: jobPageUrl(job),
        sandbox: isSandboxJob(job),
        saved: viewer ? viewer.saved : null,
        applicationStatus: viewer ? viewer.applicationStatus : null,
    };
}

const APPLY_ROUTE_VALUES: Readonly<Record<ApplyRoute, ApplyRouteValue>> = {
    'easy-apply': 'easy_apply',
    'employer-site': 'employer_site',
    external: 'external',
    none: 'none',
};

export function applyRouteValue(job: { applyLink: string | null; sourceType: string | null; applyOnPlatform: boolean }): ApplyRouteValue {
    return APPLY_ROUTE_VALUES[resolveApplyRoute(job)];
}

/** A stored status as one of the known statuses ('applied' for anything unknown, as My Applications shows it). */
export function applicationStatus(status: string | null | undefined, withdrawnAt?: Date | null): ApplicationStatus {
    if (withdrawnAt) return 'withdrawn';
    return (APPLICATION_STATUSES as readonly string[]).includes(status ?? '') ? (status as ApplicationStatus) : 'applied';
}

export function applicationStatusLabel(status: ApplicationStatus): string {
    return APPLICATION_STATUS_LABELS[status];
}

/**
 * The file's own name from a stored resume key
 * (`<prefix>/<userId>/<timestamp>-<name>`, lib/supabase-storage.ts), or null.
 */
export function resumeFileName(storedPath: string | null | undefined): string | null {
    if (!storedPath) return null;
    const last = storedPath.split('/').pop() ?? '';
    const name = last.replace(/^\d+-/, '');
    return name.length > 0 ? name : null;
}

/** Plain text clipped at a paragraph or sentence boundary near `max`. */
export function clipText(text: string, max: number): { text: string; truncated: boolean } {
    if (text.length <= max) return { text, truncated: false };
    const slice = text.slice(0, max);
    const cut = Math.max(slice.lastIndexOf('\n\n'), slice.lastIndexOf('. '));
    const end = cut > max * 0.6 ? cut + 1 : max;
    return { text: slice.slice(0, end).trimEnd(), truncated: true };
}

/** "Mon D, YYYY" in US English, for tool result text. */
export function formatDate(value: Date | string): string {
    const date = typeof value === 'string' ? new Date(value) : value;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
