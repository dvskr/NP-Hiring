/**
 * The NP Hiring MCP server: twelve tools and one widget resource, built per
 * request for one host profile (lib/mcp/config.ts) and one caller.
 *
 * Every tool carries a title and all four annotations, because Claude's
 * directory requires a title plus readOnlyHint or destructiveHint and
 * ChatGPT's requires readOnlyHint, destructiveHint and openWorldHint as
 * explicit booleans. Every result carries plain text content too: hosts
 * without the widget, and Claude's model (which does not see
 * structuredContent), read the text.
 *
 * Tool descriptions say what the tool does and when to use it, and nothing
 * that steers the model toward a tool the user did not ask for (both
 * directories reject that as prompt injection).
 */
import { McpServer, ResourceTemplate, type CallToolResult } from '@modelcontextprotocol/server';
import { RESOURCE_MIME_TYPE, registerAppResource, registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import { brand } from '@/config/brand';
import { logger } from '@/lib/logger';
import {
    applicationsViewSchema,
    applyResultViewSchema,
    applyViewSchema,
    emptyInput,
    getJobInput,
    jobDetailViewSchema,
    jobListViewSchema,
    jobOnlyInput,
    listApplicationsInput,
    listSavedJobsInput,
    practiceAuthorityInput,
    practiceAuthorityOutput,
    profileStatusOutput,
    savedJobOutput,
    searchJobsInput,
    startApplicationInput,
    submitApplicationInput,
    trackApplicationOutput,
    withdrawApplicationInput,
    withdrawApplicationOutput,
    type ApplicationsView,
    type JobListView,
} from '@/lib/mcp/contracts';
import { mcpBaseUrl, type McpHostProfile } from '@/lib/mcp/config';
import { TOOL, type ToolName } from '@/lib/mcp/tool-names';
import { hasScopes, requiredScopes, signInRequiredResult, type McpPrincipal } from '@/lib/mcp/auth';
import { getJobDetail, searchJobs } from '@/lib/mcp/jobs';
import {
    JOB_GONE,
    listApplications,
    listSavedJobs,
    profileStatus,
    saveJob,
    startApplication,
    submitApplication,
    trackEmployerSiteApplication,
    unsaveJob,
    withdrawApplication,
} from '@/lib/mcp/candidate';
import { practiceAuthorityFor } from '@/lib/mcp/practice-authority';
import { formatDate } from '@/lib/mcp/format';
import { WIDGET_HTML, WIDGET_VERSION } from '@/lib/mcp/widgets/generated/widget-html';

export const SERVER_VERSION = '1.0.0';

/** The widget's URI carries its build hash, so a host never reuses a stale copy (OpenAI's cache advice). */
export const WIDGET_URI = `ui://np-hiring/widget-${WIDGET_VERSION}.html`;

/**
 * Server instructions. Hosts may read only the start, so the essentials come
 * first (OpenAI: the first 512 characters).
 */
export const SERVER_INSTRUCTIONS = [
    `${brand.name} (${brand.domain}) lists ${brand.niche.long.toLowerCase()} and APRN jobs across the United States.`,
    'Use search_jobs to find jobs and get_job for one job.',
    `Applying needs the candidate's ${brand.name} sign-in. For an Easy Apply job, call start_application to show the review,`,
    'then call submit_application only after the candidate has reviewed it and agreed to share their profile, resume and cover letter with the employer.',
    "Other jobs continue on the employer's site: start_application gives the link and track_employer_site_application adds the job to the candidate's tracker.",
    'Never ask the candidate for an NPI, DEA or Social Security number, a license number or EEO details.',
].join(' ');

interface ToolAnnotationsFull {
    title: string;
    readOnlyHint: boolean;
    destructiveHint: boolean;
    openWorldHint: boolean;
    idempotentHint: boolean;
}

function readOnly(title: string): ToolAnnotationsFull {
    return { title, readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true };
}

function write(title: string, options: { destructive: boolean; openWorld: boolean }): ToolAnnotationsFull {
    return { title, readOnlyHint: false, destructiveHint: options.destructive, openWorldHint: options.openWorld, idempotentHint: true };
}

function text(value: string): CallToolResult['content'] {
    return [{ type: 'text', text: value }];
}

function errorResult(message: string): CallToolResult {
    return { isError: true, content: text(message) };
}

const UNEXPECTED = `${brand.name} could not complete this request. Try again in a moment.`;

/** One line per job, ids included so the model can follow up. */
function jobListText(view: JobListView): string {
    if (view.jobs.length === 0) return `No ${view.heading} match this search.`;
    const lines = view.jobs.map((job, index) => {
        const parts = [job.title, job.employer, job.location, job.pay, job.jobType, job.easyApply ? 'Easy Apply' : null]
            .filter(Boolean)
            .join(', ');
        return `${index + 1}. ${parts} (id ${job.id})`;
    });
    const header =
        view.heading === 'Saved jobs'
            ? `${view.total} saved ${view.total === 1 ? 'job' : 'jobs'}.`
            : `${view.total} ${view.heading}. Page ${view.page} of ${view.totalPages}.`;
    const more = view.nextPageArgs ? ` More results: search_jobs with page ${view.page + 1}.` : '';
    return `${header}\n${lines.join('\n')}\n${more ? `${more.trim()}\n` : ''}On ${brand.name}: ${view.browseUrl}`;
}

function applicationsText(view: ApplicationsView): string {
    if (view.applications.length === 0) return 'No applications yet.';
    const lines = view.applications.map(
        (a) => `${a.title}, ${a.employer}: ${a.statusLabel}, applied ${formatDate(a.appliedAt)} (application id ${a.id})`,
    );
    return `${view.total} ${view.total === 1 ? 'application' : 'applications'}.\n${lines.join('\n')}`;
}

/**
 * Host-specific tool `_meta`: the widget link for UI tools, ChatGPT's
 * compatibility keys and its per-tool auth declaration (securitySchemes,
 * mirrored in _meta, which OpenAI reads for SDKs that cannot add top-level
 * tool fields).
 */
function toolMeta(
    profile: McpHostProfile,
    name: ToolName,
    ui: { invoking: string; invoked: string } | null,
): Record<string, unknown> {
    const scopes = requiredScopes(name);
    const meta: Record<string, unknown> = {};
    if (ui) meta.ui = { resourceUri: WIDGET_URI };
    if (profile.id === 'chatgpt') {
        meta.securitySchemes = scopes ? [{ type: 'oauth2', scopes: [...scopes] }] : [{ type: 'noauth' }];
        // The widget also calls tools without a UI of their own (withdraw,
        // save, track), so every tool is reachable from it.
        meta['openai/widgetAccessible'] = true;
        if (ui) {
            meta['openai/outputTemplate'] = WIDGET_URI;
            meta['openai/toolInvocation/invoking'] = ui.invoking;
            meta['openai/toolInvocation/invoked'] = ui.invoked;
        }
    }
    return meta;
}

function widgetResourceMeta(profile: McpHostProfile): Record<string, unknown> {
    const ui: Record<string, unknown> = {
        // The widget fetches nothing and loads no file; Claude's host fonts are
        // the only outside resource it may use (applyHostFonts).
        csp: {
            connectDomains: [],
            resourceDomains: profile.id === 'claude' ? ['https://assets.claude.ai'] : [],
        },
        prefersBorder: false,
    };
    if (profile.widgetDomain) ui.domain = profile.widgetDomain;
    const meta: Record<string, unknown> = { ui };
    if (profile.id === 'chatgpt') {
        meta['openai/widgetDescription'] = `${brand.name} jobs, job details, the Easy Apply review and the candidate's application tracker.`;
        meta['openai/widgetPrefersBorder'] = false;
        meta['openai/widgetDomain'] = profile.widgetDomain;
        meta['openai/widgetCSP'] = {
            connect_domains: [],
            resource_domains: [],
            // openExternal targets: only the site itself (employer apply links
            // still open after ChatGPT's own confirmation).
            redirect_domains: [mcpBaseUrl()],
        };
    }
    return meta;
}

/**
 * Builds the server for one request. `principal` is the verified caller, or
 * null when the request carried no token (lib/mcp/handler.ts).
 */
export function createNpHiringMcpServer(profile: McpHostProfile, principal: McpPrincipal | null): McpServer {
    const server = new McpServer(
        { name: 'np-hiring', title: brand.name, version: SERVER_VERSION, websiteUrl: mcpBaseUrl() },
        { instructions: SERVER_INSTRUCTIONS },
    );

    /** Runs a tool body, turning an unexpected failure into a plain error result. */
    const guarded = async (name: ToolName, run: () => Promise<CallToolResult>): Promise<CallToolResult> => {
        try {
            return await run();
        } catch (error) {
            logger.error(`[mcp] ${name} failed`, error, { host: profile.id });
            return errorResult(UNEXPECTED);
        }
    };

    /** A candidate tool: no principal or a missing scope never reaches `run`. */
    const asCandidate = (name: ToolName, run: (who: McpPrincipal) => Promise<CallToolResult>): Promise<CallToolResult> =>
        guarded(name, async () => {
            const needed = requiredScopes(name) ?? [];
            if (!principal || !hasScopes(principal, needed)) {
                // Claude's gate answered 401 or 403 before this point, so only
                // ChatGPT (or a direct caller) gets here.
                return signInRequiredResult(profile, principal !== null);
            }
            return run(principal);
        });

    const viewer = principal ? { userId: principal.userId, reviewer: principal.reviewer } : null;

    // ── Public tools ───────────────────────────────────────────────────────

    registerAppTool(
        server,
        TOOL.searchJobs,
        {
            title: `Search ${brand.niche.short} jobs`,
            description:
                `Search ${brand.niche.long.toLowerCase()} and APRN jobs listed on ${brand.name} (${brand.domain}). ` +
                'Use this when the candidate wants jobs by specialty, state or city, work mode, schedule, pay, posting date or keywords. ' +
                'Returns up to 10 jobs per page with pay, location, posting date and whether the job takes Easy Apply. ' +
                `Only ${brand.name}'s own listings are searched.`,
            inputSchema: searchJobsInput,
            outputSchema: jobListViewSchema,
            annotations: readOnly(`Search ${brand.niche.short} jobs`),
            _meta: toolMeta(profile, TOOL.searchJobs, { invoking: 'Searching jobs', invoked: 'Jobs found' }),
        },
        (args) =>
            guarded(TOOL.searchJobs, async () => {
                const view = await searchJobs(args, viewer);
                if (typeof view === 'string') return errorResult(view);
                return { content: text(jobListText(view)), structuredContent: view };
            }),
    );

    registerAppTool(
        server,
        TOOL.getJob,
        {
            title: 'Get job details',
            description:
                `Get the full details of one ${brand.name} job: pay, location, schedule, setting, experience, benefits, the description and how to apply. ` +
                'Use this when the candidate asks about a specific job from search results or shares a job link from nphiring.com.',
            inputSchema: getJobInput,
            outputSchema: jobDetailViewSchema,
            annotations: readOnly('Get job details'),
            _meta: toolMeta(profile, TOOL.getJob, { invoking: 'Opening the job', invoked: 'Job details ready' }),
        },
        (args) =>
            guarded(TOOL.getJob, async () => {
                const job = await getJobDetail(args.job_id, viewer);
                if (!job) return errorResult(JOB_GONE);
                const facts = [
                    `${job.title} at ${job.employer}, ${job.location}.`,
                    job.pay ? `Pay: ${job.payIsEstimate ? 'about ' : ''}${job.pay}.` : null,
                    job.jobType ? `Schedule: ${job.jobType}.` : null,
                    job.experience ? `Experience: ${job.experience}.` : null,
                    job.applyRoute === 'easy_apply'
                        ? `Takes Easy Apply on ${brand.name}.`
                        : job.applyRoute === 'none'
                          ? 'No application link right now.'
                          : "Applications continue on the employer's site.",
                    job.url ? `Job page: ${job.url}` : null,
                    '',
                    job.description,
                ].filter((line) => line !== null);
                return {
                    content: text(facts.join('\n')),
                    structuredContent: { view: 'job-detail', job, signedIn: viewer !== null },
                };
            }),
    );

    server.registerTool(
        TOOL.practiceAuthority,
        {
            title: 'Check state practice authority',
            description:
                `Look up the practice authority of ${brand.niche.long.toLowerCase()}s in a US state: AANP's tier (full, reduced or restricted) and what that state requires. ` +
                'Use this when the candidate asks whether a state allows independent NP practice.',
            inputSchema: practiceAuthorityInput,
            outputSchema: practiceAuthorityOutput,
            annotations: readOnly('Check state practice authority'),
            _meta: toolMeta(profile, TOOL.practiceAuthority, null),
        },
        (args) =>
            guarded(TOOL.practiceAuthority, async () => {
                const answer = practiceAuthorityFor(args.state);
                if (typeof answer === 'string') return errorResult(answer);
                return {
                    content: text(
                        `AANP classifies ${answer.state} as ${answer.label.toLowerCase()}. ${answer.details} Source: ${answer.source}, ${answer.sourceUrl}`,
                    ),
                    structuredContent: answer,
                };
            }),
    );

    // ── Candidate tools (sign-in required) ─────────────────────────────────

    server.registerTool(
        TOOL.profileStatus,
        {
            title: `Check my ${brand.name} profile`,
            description:
                `Check the signed-in candidate's ${brand.name} profile before applying: name, headline, experience, specialties, ` +
                'license states, whether a resume is on file and what the profile is missing.',
            inputSchema: emptyInput,
            outputSchema: profileStatusOutput,
            annotations: readOnly(`Check my ${brand.name} profile`),
            _meta: toolMeta(profile, TOOL.profileStatus, null),
        },
        () =>
            asCandidate(TOOL.profileStatus, async (who) => {
                const status = await profileStatus(who);
                if (typeof status === 'string') return errorResult(status);
                const lines = [
                    `Profile ${status.completeness}% complete.`,
                    status.headline ? `Headline: ${status.headline}.` : null,
                    status.resume.onFile ? `Resume on file: ${status.resume.fileName ?? 'yes'}.` : 'No resume on the profile.',
                    status.missing.length > 0 ? `Missing: ${status.missing.join('; ')}.` : null,
                    `Edit the profile: ${status.profileUrl}`,
                ].filter(Boolean);
                return { content: text(lines.join('\n')), structuredContent: status };
            }),
    );

    registerAppTool(
        server,
        TOOL.startApplication,
        {
            title: 'Start an application',
            description:
                'Open the application review for one job, without submitting anything. For an Easy Apply job it shows the resume on file, ' +
                'a cover letter the candidate can edit (pass your draft as cover_letter_draft), the screening questions and the consent line. ' +
                "For any other job it returns the employer's application link. Use this when the candidate wants to apply to a job.",
            inputSchema: startApplicationInput,
            outputSchema: applyViewSchema,
            annotations: readOnly('Start an application'),
            _meta: toolMeta(profile, TOOL.startApplication, { invoking: 'Preparing the application', invoked: 'Application ready to review' }),
        },
        (args) =>
            asCandidate(TOOL.startApplication, async (who) => {
                const view = await startApplication(who, args.job_id, args.cover_letter_draft);
                if (typeof view === 'string') return errorResult(view);
                const questions = view.questions.map(
                    (q) => `${q.required ? '(required) ' : ''}${q.text} [question id ${q.id}, ${q.type}${q.options.length ? `: ${q.options.join(' / ')}` : ''}]`,
                );
                const lines = view.canSubmit
                    ? [
                          `Ready to review: ${view.job.title} at ${view.job.employer}.`,
                          view.resume.onFile ? `Resume on file: ${view.resume.fileName ?? 'yes'}.` : `No resume on the profile. Add one at ${view.profileUrl}`,
                          view.existingApplication
                              ? `Already applied on ${formatDate(view.existingApplication.appliedAt)} (${view.existingApplication.statusLabel}). Submitting again updates it.`
                              : null,
                          questions.length > 0 ? `Screening questions:\n${questions.join('\n')}` : 'No screening questions.',
                          `Consent the candidate must give: "${view.consentText}"`,
                      ]
                    : [
                          `${view.job.title} at ${view.job.employer}: ${view.blockedReason ?? ''}`.trim(),
                          view.employerApplyUrl ? `Employer application: ${view.employerApplyUrl}` : null,
                      ];
                return { content: text(lines.filter(Boolean).join('\n')), structuredContent: view };
            }),
    );

    registerAppTool(
        server,
        TOOL.submitApplication,
        {
            title: 'Submit an Easy Apply application',
            description:
                `Send the candidate's Easy Apply application for one job to the employer through ${brand.name}, with the resume on their profile, ` +
                'the cover letter and the screening answers. Call it only after the candidate reviewed the application and agreed to share their ' +
                'profile, resume and cover letter with this employer (consent: true). Submitting again updates the existing application.',
            inputSchema: submitApplicationInput,
            outputSchema: applyResultViewSchema,
            annotations: write('Submit an Easy Apply application', { destructive: true, openWorld: true }),
            _meta: toolMeta(profile, TOOL.submitApplication, { invoking: 'Sending the application', invoked: 'Application sent' }),
        },
        (args) =>
            asCandidate(TOOL.submitApplication, async (who) => {
                const view = await submitApplication(who, args);
                if (typeof view === 'string') return errorResult(view);
                const verb = view.resubmitted ? 'Updated the application' : 'Application sent';
                return {
                    content: text(
                        `${verb}: ${view.job.title} at ${view.job.employer} on ${formatDate(view.appliedAt)} (application id ${view.applicationId}). Track it at ${view.myApplicationsUrl}`,
                    ),
                    structuredContent: view,
                };
            }),
    );

    server.registerTool(
        TOOL.trackEmployerSiteApplication,
        {
            title: 'Track an employer site application',
            description:
                "Add a job that takes applications on the employer's own site to the candidate's My applications tracker on " +
                `${brand.name}. Use this when the candidate says they applied, or opens the employer's application. It sends nothing to the employer.`,
            inputSchema: jobOnlyInput,
            outputSchema: trackApplicationOutput,
            annotations: write('Track an employer site application', { destructive: false, openWorld: false }),
            _meta: toolMeta(profile, TOOL.trackEmployerSiteApplication, null),
        },
        (args) =>
            asCandidate(TOOL.trackEmployerSiteApplication, async (who) => {
                const tracked = await trackEmployerSiteApplication(who, args.job_id);
                if (typeof tracked === 'string') return errorResult(tracked);
                return {
                    content: text(
                        `${tracked.alreadyTracked ? 'Already in' : 'Added to'} My applications.${tracked.employerApplyUrl ? ` Employer application: ${tracked.employerApplyUrl}` : ''}`,
                    ),
                    structuredContent: tracked,
                };
            }),
    );

    registerAppTool(
        server,
        TOOL.listApplications,
        {
            title: 'List my applications',
            description:
                `List the signed-in candidate's ${brand.name} applications with each one's status (applied, screening, interview, offered, hired, not selected or withdrawn), newest first.`,
            inputSchema: listApplicationsInput,
            outputSchema: applicationsViewSchema,
            annotations: readOnly('List my applications'),
            _meta: toolMeta(profile, TOOL.listApplications, { invoking: 'Loading applications', invoked: 'Applications loaded' }),
        },
        (args) =>
            asCandidate(TOOL.listApplications, async (who) => {
                const view = await listApplications(who, args.status, args.limit);
                return { content: text(applicationsText(view)), structuredContent: view };
            }),
    );

    server.registerTool(
        TOOL.withdrawApplication,
        {
            title: 'Withdraw an application',
            description:
                "Withdraw one of the candidate's applications. The employer still sees it, marked withdrawn, and its cover letter text and " +
                'resume are removed. This cannot be undone. Use this only when the candidate asks to withdraw.',
            inputSchema: withdrawApplicationInput,
            outputSchema: withdrawApplicationOutput,
            annotations: write('Withdraw an application', { destructive: true, openWorld: false }),
            _meta: toolMeta(profile, TOOL.withdrawApplication, null),
        },
        (args) =>
            asCandidate(TOOL.withdrawApplication, async (who) => {
                const result = await withdrawApplication(who, args.application_id);
                if (typeof result === 'string') return errorResult(result);
                return {
                    content: text(`Withdrew the application to ${result.jobTitle} at ${result.employer}.`),
                    structuredContent: result,
                };
            }),
    );

    server.registerTool(
        TOOL.saveJob,
        {
            title: 'Save a job',
            description: `Save a job to the candidate's ${brand.name} saved jobs.`,
            inputSchema: jobOnlyInput,
            outputSchema: savedJobOutput,
            annotations: write('Save a job', { destructive: false, openWorld: false }),
            _meta: toolMeta(profile, TOOL.saveJob, null),
        },
        (args) =>
            asCandidate(TOOL.saveJob, async (who) => {
                const result = await saveJob(who, args.job_id);
                if (typeof result === 'string') return errorResult(result);
                return { content: text('Saved.'), structuredContent: result };
            }),
    );

    server.registerTool(
        TOOL.unsaveJob,
        {
            title: 'Remove a saved job',
            description: `Remove a job from the candidate's ${brand.name} saved jobs.`,
            inputSchema: jobOnlyInput,
            outputSchema: savedJobOutput,
            annotations: write('Remove a saved job', { destructive: false, openWorld: false }),
            _meta: toolMeta(profile, TOOL.unsaveJob, null),
        },
        (args) =>
            asCandidate(TOOL.unsaveJob, async (who) => {
                const result = await unsaveJob(who, args.job_id);
                if (typeof result === 'string') return errorResult(result);
                return { content: text('Removed from saved jobs.'), structuredContent: result };
            }),
    );

    registerAppTool(
        server,
        TOOL.listSavedJobs,
        {
            title: 'List my saved jobs',
            description: `List the jobs the signed-in candidate saved on ${brand.name}, newest first. Jobs that have closed are left out.`,
            inputSchema: listSavedJobsInput,
            outputSchema: jobListViewSchema,
            annotations: readOnly('List my saved jobs'),
            _meta: toolMeta(profile, TOOL.listSavedJobs, { invoking: 'Loading saved jobs', invoked: 'Saved jobs loaded' }),
        },
        (args) =>
            asCandidate(TOOL.listSavedJobs, async (who) => {
                const view = await listSavedJobs(who, args.limit);
                return { content: text(jobListText(view)), structuredContent: view };
            }),
    );

    // ── The widget ─────────────────────────────────────────────────────────

    const resourceMeta = widgetResourceMeta(profile);
    const description = `${brand.name} job search, job details, Easy Apply and the application tracker.`;
    registerAppResource(
        server,
        `${brand.name} jobs`,
        WIDGET_URI,
        { description, _meta: resourceMeta },
        async () => ({
            contents: [{ uri: WIDGET_URI, mimeType: RESOURCE_MIME_TYPE, text: WIDGET_HTML, _meta: resourceMeta }],
        }),
    );
    // A conversation that listed tools before a deploy still holds the old
    // widget URI; any version answers with the current widget instead of
    // "resource not found".
    server.registerResource(
        `${brand.name} jobs (earlier version)`,
        new ResourceTemplate('ui://np-hiring/widget-{version}.html', { list: undefined }),
        { description, mimeType: RESOURCE_MIME_TYPE, _meta: resourceMeta },
        async (uri) => ({
            contents: [{ uri: uri.href, mimeType: RESOURCE_MIME_TYPE, text: WIDGET_HTML, _meta: resourceMeta }],
        }),
    );

    return server;
}
