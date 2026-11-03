/**
 * Job search and job detail for the MCP tools, built on the site's own
 * listing rules so a job the website hides is never shown in Claude or
 * ChatGPT either:
 *   - search: buildWhereClause (lib/filters.ts: published, the profession
 *     quarantine, the dead-link gate, the search intent) plus "not expired";
 *   - detail: activeIndexableJobWhere (lib/active-job-filter.ts), the
 *     predicate the sitemaps and the job page's 410 gate read.
 *
 * Ordering never favours a paid or employer post (both directories ban paid
 * placement): "relevance" is the quality score then recency, without the
 * employer-first lead or isFeatured that the site's default "best" sort has.
 * A review sandbox job is added only for a reviewer account (lib/mcp/sandbox.ts).
 */
import type { Prisma } from '@prisma/client';
import { brand } from '@/config/brand';
import { prisma } from '@/lib/prisma';
import { buildWhereClause, categoryFilterLabel, filtersToParams, type RecruitmentFilterState } from '@/lib/filters';
import { activeIndexableJobWhere } from '@/lib/active-job-filter';
import { buildJobsOrderBy } from '@/lib/utils/job-sort';
import { CATEGORY_AXES } from '@/lib/pseo/taxonomy-registry';
import { CODE_TO_STATE, STATE_CODES } from '@/lib/pseo/setting-state-config';
import { htmlToReadableText } from '@/lib/sanitize';
import type { JobDetail, JobListView, SearchJobsInput } from '@/lib/mcp/contracts';
import { mcpBaseUrl } from '@/lib/mcp/config';
import { REVIEW_SANDBOX_SOURCE_PROVIDER } from '@/lib/mcp/sandbox';
import {
    JOB_SUMMARY_SELECT,
    applicationStatus,
    applyRouteValue,
    clipText,
    toJobSummary,
    type JobSummaryRow,
    type ViewerJobState,
} from '@/lib/mcp/format';
import type { ApplicationStatus } from '@/lib/mcp/tool-names';

/** Who is asking: null when signed out. */
export interface McpViewer {
    userId: string;
    reviewer: boolean;
}

export const DEFAULT_PAGE_SIZE = 6;

/** Longest description returned by get_job (a tool result must stay small). */
export const DESCRIPTION_MAX = 6000;

const JOB_TYPE_LABELS: Readonly<Record<NonNullable<SearchJobsInput['job_type']>[number], string>> = {
    full_time: 'Full-Time',
    part_time: 'Part-Time',
    contract: 'Contract',
    per_diem: 'Per Diem',
};

const WORK_MODE_FILTER_LABELS: Readonly<Record<NonNullable<SearchJobsInput['work_mode']>[number], string>> = {
    remote: 'Remote',
    hybrid: 'Hybrid',
    onsite: 'On site',
};

const POSTED_WITHIN_LABELS: Readonly<Record<NonNullable<SearchJobsInput['posted_within']>, string>> = {
    '24h': 'Last 24 hours',
    '3d': 'Last 3 days',
    '7d': 'Last 7 days',
    '30d': 'Last 30 days',
};

const SPECIALTY_FACET_SLUGS: ReadonlySet<string> = new Set<string>(CATEGORY_AXES.specialty);

/** The candidate's own job ids are never longer than this (Job.id is a 36-character UUID). */
const UUID_AT_END = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

/**
 * The job id inside a tool argument: a bare id, a job slug, or a job page URL
 * (every slug ends in its id, lib/utils.ts slugify). Null when none is there.
 */
export function parseJobId(value: string): string | null {
    const trimmed = value.trim();
    let path = trimmed;
    if (/^https?:\/\//i.test(trimmed)) {
        try {
            path = new URL(trimmed).pathname;
        } catch {
            return null;
        }
    }
    const match = UUID_AT_END.exec(path);
    return match ? match[1].toLowerCase() : null;
}

/** A US state name or two-letter code as { name, code }, or null. */
export function resolveState(value: string): { name: string; code: string } | null {
    const trimmed = value.trim();
    const upper = trimmed.toUpperCase();
    if (CODE_TO_STATE[upper]) return { name: CODE_TO_STATE[upper], code: upper };
    const name = Object.keys(STATE_CODES).find((state) => state.toLowerCase() === trimmed.toLowerCase());
    return name ? { name, code: STATE_CODES[name] } : null;
}

/** Every stored spelling of a state: the name or the code, in either column. */
function stateClause(state: { name: string; code: string }): Prisma.JobWhereInput {
    return {
        OR: [
            { stateCode: { equals: state.code, mode: 'insensitive' } },
            { state: { equals: state.name, mode: 'insensitive' } },
            { state: { equals: state.code, mode: 'insensitive' } },
        ],
    };
}

function notExpired(now: Date): Prisma.JobWhereInput {
    return { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
}

export interface ResolvedSearch {
    filters: RecruitmentFilterState;
    extra: Prisma.JobWhereInput[];
    /** The state the search is limited to, when one was given. */
    state: { name: string; code: string } | null;
    heading: string;
    chips: string[];
}

/**
 * The search_jobs arguments as the site's filter state plus the clauses the
 * filter state cannot express. A string error when the arguments contradict
 * each other or name an unknown state.
 */
export function resolveSearch(args: SearchJobsInput, now: Date = new Date()): ResolvedSearch | string {
    const workMode = new Set(args.work_mode ?? []);
    const extra: Prisma.JobWhereInput[] = [notExpired(now)];
    const chips: string[] = [];

    let state: { name: string; code: string } | null = null;
    if (args.state) {
        if (args.state.trim().toLowerCase() === 'remote') {
            workMode.add('remote');
        } else {
            state = resolveState(args.state);
            if (!state) return `"${args.state}" is not a US state. Use a state name or its two-letter code.`;
            extra.push(stateClause(state));
        }
    }
    if (args.city && !state) return 'A city search needs the state too.';

    const specialtyIsFacet = args.specialty ? SPECIALTY_FACET_SLUGS.has(args.specialty) : false;
    const categoryFromSpecialty = args.specialty && !specialtyIsFacet ? args.specialty : null;
    if (categoryFromSpecialty && args.setting) {
        return 'Search one APRN role or one setting at a time.';
    }

    if (args.easy_apply_only) extra.push({ applyOnPlatform: true });

    const filters: RecruitmentFilterState = {
        search: args.query ?? '',
        workMode: [...workMode],
        jobType: (args.job_type ?? []).map((value) => JOB_TYPE_LABELS[value]),
        specialty: specialtyIsFacet && args.specialty ? [args.specialty] : [],
        experienceLevel: [],
        newGradFriendly: args.new_grad_friendly ? true : null,
        minYearsExperience: args.max_years_required ?? null,
        salaryMin: args.min_salary ?? null,
        postedWithin: args.posted_within ?? null,
        location: null,
        cityExact: args.city ?? null,
        stateCode: null,
        employer: null,
        category: categoryFromSpecialty ?? args.setting ?? null,
        recruitmentType: null,
    };

    const roleLabel = args.specialty ? categoryFilterLabel(args.specialty) : null;
    const place = state ? (args.city ? `${args.city}, ${state.code}` : state.name) : null;
    const heading = [roleLabel ? `${roleLabel} jobs` : `${brand.niche.short} jobs`, place ? `in ${place}` : null]
        .filter(Boolean)
        .join(' ');

    if (args.query) chips.push(`"${args.query}"`);
    for (const mode of workMode) chips.push(WORK_MODE_FILTER_LABELS[mode]);
    for (const type of args.job_type ?? []) chips.push(JOB_TYPE_LABELS[type]);
    if (args.setting) chips.push(categoryFilterLabel(args.setting));
    if (args.min_salary) chips.push(`$${Math.round(args.min_salary / 1000)}k+/yr`);
    if (args.posted_within) chips.push(POSTED_WITHIN_LABELS[args.posted_within]);
    if (args.new_grad_friendly) chips.push('New grad welcome');
    if (typeof args.max_years_required === 'number') {
        chips.push(`Up to ${args.max_years_required} ${args.max_years_required === 1 ? 'year' : 'years'} required`);
    }
    if (args.easy_apply_only) chips.push('Easy Apply');

    return { filters, extra, state, heading, chips };
}

function orderFor(sort: SearchJobsInput['sort']): Prisma.JobOrderByWithRelationInput[] {
    if (sort === 'newest') return buildJobsOrderBy('newest');
    if (sort === 'salary') return buildJobsOrderBy('salary');
    return [
        { qualityScore: 'desc' },
        { originalPostedAt: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
    ];
}

/** The viewer's saved and applied state for a set of jobs (empty for a signed-out viewer). */
export async function viewerJobStates(
    viewer: McpViewer | null,
    jobIds: string[],
): Promise<Map<string, ViewerJobState>> {
    const states = new Map<string, ViewerJobState>();
    if (!viewer || jobIds.length === 0) return states;
    const [saved, applications] = await Promise.all([
        prisma.savedJob.findMany({
            where: { userId: viewer.userId, jobId: { in: jobIds } },
            select: { jobId: true },
        }),
        prisma.jobApplication.findMany({
            where: { userId: viewer.userId, jobId: { in: jobIds } },
            select: { jobId: true, status: true, withdrawnAt: true },
        }),
    ]);
    const savedIds = new Set(saved.map((row) => row.jobId));
    const statusById = new Map<string, ApplicationStatus>(
        applications.map((row) => [row.jobId, applicationStatus(row.status, row.withdrawnAt)]),
    );
    for (const id of jobIds) {
        states.set(id, { saved: savedIds.has(id), applicationStatus: statusById.get(id) ?? null });
    }
    return states;
}

export async function searchJobs(args: SearchJobsInput, viewer: McpViewer | null): Promise<JobListView | string> {
    const resolved = resolveSearch(args);
    if (typeof resolved === 'string') return resolved;

    const limit = args.limit ?? DEFAULT_PAGE_SIZE;
    const page = args.page ?? 1;
    const base = buildWhereClause(resolved.filters);
    const where: Prisma.JobWhereInput = { AND: [base, ...resolved.extra] };

    const [rows, total] = await Promise.all([
        prisma.job.findMany({
            where,
            orderBy: orderFor(args.sort),
            skip: (page - 1) * limit,
            take: limit,
            select: JOB_SUMMARY_SELECT,
        }),
        prisma.job.count({ where }),
    ]);

    // Reviewer accounts see the matching sandbox jobs first, on page 1 only.
    let sandboxRows: JobSummaryRow[] = [];
    if (viewer?.reviewer && page === 1) {
        sandboxRows = await prisma.job.findMany({
            where: {
                AND: [
                    { ...base, isPublished: false, sourceProvider: REVIEW_SANDBOX_SOURCE_PROVIDER },
                    ...resolved.extra,
                ],
            },
            orderBy: { createdAt: 'asc' },
            take: limit,
            select: JOB_SUMMARY_SELECT,
        });
    }

    const shown = [...sandboxRows, ...rows].slice(0, Math.max(limit, sandboxRows.length));
    const states = await viewerJobStates(viewer, shown.map((row) => row.id));
    const totalPages = Math.max(1, Math.ceil(total / limit));
    // The same search on /jobs: its location box matches a state name or code.
    const params = filtersToParams({ ...resolved.filters, location: resolved.state?.name ?? null });

    return {
        view: 'job-list',
        heading: resolved.heading,
        filters: resolved.chips,
        total: total + sandboxRows.length,
        page,
        totalPages,
        jobs: shown.map((row) => toJobSummary(row, viewer ? (states.get(row.id) ?? null) : null)),
        nextPageArgs: page < totalPages && page < 20 ? { ...args, page: page + 1 } : null,
        browseUrl: `${mcpBaseUrl()}/jobs${params.toString() ? `?${params.toString()}` : ''}`,
        signedIn: viewer !== null,
    };
}

const JOB_DETAIL_SELECT = {
    ...JOB_SUMMARY_SELECT,
    description: true,
    descriptionSummary: true,
    setting: true,
    population: true,
    benefits: true,
    experienceQualifier: true,
    applyLink: true,
    sourceType: true,
    contentChangedAt: true,
    updatedAt: true,
    _count: { select: { screeningQuestions: true } },
} as const;

/** The where clause for one job the viewer may see (a sandbox job only for a reviewer). */
export function visibleJobWhere(jobId: string, viewer: McpViewer | null): Prisma.JobWhereInput {
    if (viewer?.reviewer) {
        return {
            id: jobId,
            OR: [
                activeIndexableJobWhere(),
                { isPublished: false, sourceProvider: REVIEW_SANDBOX_SOURCE_PROVIDER },
            ],
        };
    }
    return { id: jobId, ...activeIndexableJobWhere() };
}

export async function getJobDetail(jobArg: string, viewer: McpViewer | null): Promise<JobDetail | null> {
    const jobId = parseJobId(jobArg);
    if (!jobId) return null;
    const row = await prisma.job.findFirst({ where: visibleJobWhere(jobId, viewer), select: JOB_DETAIL_SELECT });
    if (!row) return null;

    const states = await viewerJobStates(viewer, [row.id]);
    const summary = toJobSummary(row, viewer ? (states.get(row.id) ?? null) : null);
    const description = clipText(htmlToReadableText(row.description), DESCRIPTION_MAX);
    const changed = row.contentChangedAt ?? null;

    return {
        ...summary,
        // Employer-authored text: shown as written, like the site's job page.
        summary: row.descriptionSummary,
        description: description.text,
        descriptionTruncated: description.truncated,
        setting: row.setting,
        population: row.population,
        benefits: row.benefits,
        experienceNote: row.experienceQualifier,
        applyRoute: applyRouteValue(row),
        screeningQuestionCount: row._count.screeningQuestions,
        updatedAt: changed ? changed.toISOString() : null,
    };
}
