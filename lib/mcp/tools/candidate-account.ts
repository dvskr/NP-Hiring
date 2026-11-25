import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { sanitizeJobAlert } from '@/lib/sanitize';
import { withdrawApplication } from '@/lib/applications/withdraw';
import { createJobAlert } from '@/lib/job-alerts/create-alert';
import type { ApplicationRow, ApplicationsViewData } from '@/lib/mcp/widgets/src/contracts';
import { defineTool, requireAccess, UserFacingError } from '@/lib/mcp/server/types';
import { BOARD_NAME, roleJobsProse } from './board-words';
import { clipLine, findPublicJob, jobUrl, parseJobRef } from './shared';

/** The schedules the alert form stores and the digest matches exactly (app/job-alerts/page.tsx). */
const JOB_TYPES = ['Full-Time', 'Part-Time', 'Contract', 'Per Diem'] as const;

const STATUS_FILTERS = ['applied', 'screening', 'interview', 'offered', 'hired', 'rejected', 'withdrawn'] as const;

export const listMyApplications = defineTool({
  name: 'list_my_applications',
  title: 'List my applications',
  description:
    `List the person's job applications on ${BOARD_NAME} with each one's current status (applied, screening, interview, offered, hired, not selected, withdrawn) and dates, newest first.`,
  input: {
    status: z.enum(STATUS_FILTERS).optional().describe('Only applications in this status.'),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  auth: 'required',
  widget: 'applications',
  invoking: 'Loading your applications',
  invoked: 'Applications loaded',
  async run(args, ctx) {
    const access = requireAccess(ctx);
    const now = new Date();
    const rows = await prisma.jobApplication.findMany({
      where: { userId: access.userId, ...(args.status ? { status: args.status } : {}) },
      orderBy: { appliedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        status: true,
        appliedAt: true,
        statusUpdatedAt: true,
        withdrawnAt: true,
        sourceUrl: true,
        consentGiven: true,
        job: {
          select: { id: true, slug: true, title: true, employer: true, location: true, isPublished: true, expiresAt: true },
        },
      },
    });

    const applications: ApplicationRow[] = rows.map((row) => {
      const live = row.job.isPublished && (!row.job.expiresAt || row.job.expiresAt > now);
      return {
        id: row.id,
        // A withdrawn row may predate the status column being set with it.
        status: row.withdrawnAt ? 'withdrawn' : row.status,
        appliedAt: row.appliedAt.toISOString(),
        statusUpdatedAt: row.statusUpdatedAt?.toISOString() ?? null,
        submittedOnPlatform: row.sourceUrl === 'platform' || row.consentGiven,
        // Employer-written or scraped, so bounded as on every other card.
        job: {
          id: row.job.id,
          title: clipLine(row.job.title, 150),
          employer: clipLine(row.job.employer, 100),
          location: row.job.location ? clipLine(row.job.location, 80) : row.job.location,
          url: live ? jobUrl(ctx.baseUrl, row.job) : null,
          live,
        },
      };
    });

    const structured: ApplicationsViewData = {
      view: 'applications',
      applications,
      manageUrl: `${ctx.baseUrl}/my-applications`,
    };
    const text =
      applications.length === 0
        ? `No ${args.status ? `${args.status} ` : ''}applications yet. Use search_jobs to find openings.`
        : [
            `${applications.length} application${applications.length === 1 ? '' : 's'}${args.status ? ` in ${args.status}` : ''}, newest first:`,
            ...applications.map(
              (a) =>
                `${a.job.title} at ${a.job.employer}: ${a.status}, applied ${a.appliedAt.slice(0, 10)}${a.submittedOnPlatform ? '' : ' (tracked click to the employer site)'}${a.job.live ? '' : ', posting closed'}. application_id: ${a.id}`,
            ),
            `Manage on ${BOARD_NAME}: ${structured.manageUrl}`,
          ].join('\n');
    return { text, structured };
  },
});

export const withdrawMyApplication = defineTool({
  name: 'withdraw_application',
  title: 'Withdraw an application',
  description:
    'Withdraw one of the person\'s applications. This removes the cover letter text and the resume link from it and marks it withdrawn. The employer still sees the application, marked "Withdrawn", with the person\'s name on it, and a cover letter uploaded as a file stays attached. ' +
    'For when the person asks to withdraw a specific application.',
  input: {
    application_id: z.string().trim().min(1).max(100).describe('The application_id from list_my_applications.'),
    confirm: z.literal(true).describe('True only when the person has confirmed they want to withdraw this application.'),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: true },
  auth: 'required',
  widget: 'applications',
  invoking: 'Withdrawing the application',
  invoked: 'Application withdrawn',
  async run(args, ctx) {
    const access = requireAccess(ctx);
    const result = await withdrawApplication(access.userId, args.application_id);
    if (!result.ok) {
      throw new UserFacingError(
        result.status === 404 || result.status === 403
          ? 'That application was not found on this account.'
          : result.error,
      );
    }
    // Answer with the refreshed list, so the card shows the new state.
    const list = await listMyApplications.run({}, ctx);
    return {
      ...list,
      text: `Withdrawn. The cover letter text and the resume link were removed from it. The employer still sees it, marked "Withdrawn", with the person's name on it, and a cover letter uploaded as a file stays attached.\n${list.text}`,
    };
  },
});

export const saveJob = defineTool({
  name: 'save_job',
  title: 'Save a job',
  description: `Save an open job to the person's ${BOARD_NAME} saved jobs. Saving a job that is already saved changes nothing.`,
  // Adding only. Removal is unsave_job, marked destructive: OpenAI's
  // directory keeps destructiveHint false for additive writes and wants each
  // operation as its own tool, and its scan flagged the old saved: false.
  input: {
    job_id: z.string().trim().min(1).max(500),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  auth: 'required',
  invoking: 'Saving the job',
  invoked: 'Saved jobs updated',
  async run(args, ctx) {
    const access = requireAccess(ctx);
    const jobId = parseJobRef(args.job_id);
    if (!jobId) throw new UserFacingError(`That is not a ${BOARD_NAME} job id.`);
    // Only a live job can be saved. SavedJob has no foreign key, so without
    // this check any string would become a dead row on the saved page.
    const job = await findPublicJob(jobId, { id: true, title: true, employer: true });
    if (!job) throw new UserFacingError('That job is no longer open, so it was not saved.');
    await prisma.savedJob.upsert({
      where: { userId_jobId: { userId: access.userId, jobId: job.id } },
      create: { userId: access.userId, jobId: job.id },
      update: {},
    });
    return {
      text: `Saved ${job.title} at ${job.employer}. Saved jobs: ${ctx.baseUrl}/saved`,
      structured: { saved: true, jobId: job.id },
    };
  },
});

export const unsaveJob = defineTool({
  name: 'unsave_job',
  title: 'Remove a saved job',
  description:
    `Remove a job from the person's ${BOARD_NAME} saved jobs. A job that has closed since it was saved cannot be saved again. ` +
    'For when the person asks to take a job off their saved list.',
  input: {
    job_id: z.string().trim().min(1).max(500),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: true },
  auth: 'required',
  invoking: 'Removing the saved job',
  invoked: 'Saved jobs updated',
  async run(args, ctx) {
    const access = requireAccess(ctx);
    const jobId = parseJobRef(args.job_id);
    if (!jobId) throw new UserFacingError(`That is not a ${BOARD_NAME} job id.`);
    // By the saved id itself, open or closed: a job that has closed since it
    // was saved still comes off the list. Saving a free copy's id stores the
    // paid post it duplicates (save_job, lib/paid-post-twins.ts), so removing
    // by the copy's id reaches that row as well. The other way round too: the
    // website may have saved the copy itself, which list_saved_jobs shows as
    // its paid post, so removing that post clears its copies' rows. Only this
    // account's rows are ever in reach.
    const live = await findPublicJob(jobId, { id: true });
    const posts = [...new Set([jobId, ...(live ? [live.id] : [])])];
    const copies = await prisma.job.findMany({ where: { shadowedByJobId: { in: posts } }, select: { id: true } });
    const ids = [...new Set([...posts, ...copies.map((copy) => copy.id)])];
    const { count } = await prisma.savedJob.deleteMany({ where: { userId: access.userId, jobId: { in: ids } } });
    return {
      text: count > 0 ? 'Removed from saved jobs.' : 'That job was not in the saved jobs.',
      structured: { saved: false, jobId: live?.id ?? jobId },
    };
  },
});

export const createMyJobAlert = defineTool({
  name: 'create_job_alert',
  title: 'Create a job alert',
  description:
    `Email the person new ${roleJobsProse()} that match their criteria, daily or weekly, at their ${BOARD_NAME} account address. ` +
    `Alert emails list jobs that apply directly with the employer: postings made on ${BOARD_NAME} and jobs on an employer's own application system. ` +
    'Every alert email has a one-click unsubscribe.',
  input: {
    keyword: z.string().trim().max(80).optional(),
    job_location: z.string().trim().max(80).optional().describe('State or "City, ST" where the jobs should be.'),
    // The exact values the website's alert form stores and the digest
    // matcher compares against (lib/job-alerts-service.ts jobMatchesAlert).
    work_mode: z.enum(['Remote', 'Hybrid', 'In-Person']).optional(),
    job_type: z.enum(JOB_TYPES).optional(),
    min_salary: z.number().int().min(0).max(1_000_000).optional().describe('Minimum annual pay in US dollars.'),
    frequency: z.enum(['daily', 'weekly']).describe('How often to email.'),
    // Creating an alert turns email back on for an address that had switched
    // it off, so it waits for the person's own yes, as a withdrawal does.
    confirm: z
      .literal(true)
      .describe('True only when the person has confirmed the alert\'s criteria and how often it emails.'),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  auth: 'required',
  invoking: 'Setting up the alert',
  invoked: 'Alert created',
  async run(args, ctx) {
    const access = requireAccess(ctx);
    // The same sanitizer the signup forms run, then the shared creator.
    const clean = sanitizeJobAlert({
      email: access.email,
      keyword: args.keyword,
      location: args.job_location,
      mode: args.work_mode,
      jobType: args.job_type,
      minSalary: args.min_salary,
      frequency: args.frequency,
    });
    if (!clean.email) throw new UserFacingError('Your account has no email address to send alerts to.');
    const result = await createJobAlert({
      email: clean.email,
      keyword: clean.keyword || null,
      location: clean.location || null,
      mode: clean.mode || null,
      jobType: clean.jobType || null,
      minSalary: clean.minSalary ?? null,
      maxSalary: null,
      frequency: clean.frequency || args.frequency,
      newsletterOptIn: false,
      // The address is the signed-in account's own (the OAuth grant's user),
      // so this is the owner asking, as with a signed-in session on the site.
      callerOwnsEmail: true,
    });
    const criteria = [
      clean.keyword ? `"${clean.keyword}"` : '',
      clean.mode ? clean.mode.toLowerCase() : '',
      clean.jobType ?? '',
      roleJobsProse(),
      clean.location ? `in ${clean.location}` : '',
      clean.minSalary ? `paying $${Math.round(clean.minSalary / 1000)}k or more` : '',
    ]
      .filter(Boolean)
      .join(' ');
    const verb = result.reactivated ? 'Turned back on' : result.created ? 'Created' : 'Already set up';
    return {
      text: `${verb}: a ${result.alert.frequency} alert for ${criteria || `new ${roleJobsProse()}`}, sent to ${access.email}. Manage alerts: ${ctx.baseUrl}/job-alerts/manage`,
      structured: { alertId: result.alert.id, frequency: result.alert.frequency, reactivated: result.reactivated },
    };
  },
});
