/**
 * Which jobs app/api/cron/index-urls submits, and from where it resumes.
 *
 * THE BUG THIS FIXES (GFJ-05). The cron used to take every published job
 * whose createdAt OR updatedAt fell in the last 25 hours. Ingest renewal and
 * source presence write updatedAt on every live job on every ingest run, and a
 * page view bumps it too, so every live job qualified every day: each run sent
 * the whole inventory to IndexNow and Bing, and up to the new-content lane's
 * share of it to Google as URL_UPDATED, for pages that had not changed. The
 * query also had no expiry, quarantine or dead-link filter, so it could name
 * URLs the middleware answers with 410.
 *
 * WHAT IT SELECTS NOW. A job is submitted when it is new (createdAt) or its
 * published content changed (contentChangedAt, written only on real content
 * edits) inside this run's window, and only when it is a page Google may hold
 * as a job posting:
 *  - activeIndexableJobWhere, in the query: published, unexpired, not a
 *    repeated dead link, not vetoed by the profession quarantine, the set the
 *    job sitemap lists, so every URL answers 200 rather than the middleware's
 *    410;
 *  - isSubmittableJobPosting, over the rows the query returns: the page emits
 *    a valid JobPosting item. That is the job page's own rule
 *    (isJobPostingEligible in app/jobs/[slug]/job-posting-facts.ts): a US
 *    listing with a physical place or a verified fully remote declaration,
 *    and a real description, not a synthesized stub (GFJ-04: a stub page
 *    answers noindex, so no engine is told about it). It parses location
 *    strings and descriptions, which SQL cannot, so it runs here, and a page
 *    that emits no JobPosting is never sent to an API that only accepts job
 *    posting pages.
 * updatedAt plays no part.
 *
 * THE WINDOW. [since, until), where since is the end of the newest successful
 * run's window, recorded in its cron_runs.metrics by withCronTracking, so
 * consecutive runs tile time with no overlap and no gap: a job is sent once
 * when it appears and once after each content change, never again for being
 * unchanged. until stops SETTLE_MS short of now, so a row stamped just before
 * the query but committed just after it falls in the next window instead of
 * between two. A run that fails records no metrics, so the next run reaches
 * back to the last one that succeeded, at most MAX_LOOKBACK_MS. With no usable
 * record (the first run) the window is the old 25 hours.
 *
 * WHAT IT DOES NOT DO. Google takes at most the new-content lane's per run
 * share, newest first; a busier window leaves the rest to the job sitemap,
 * which is the baseline discovery channel, rather than carrying it over.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { activeIndexableJobWhere } from '@/lib/active-job-filter';
import { isJobPostingEligible, type JobPostingFactsInput } from '@/app/jobs/[slug]/job-posting-facts';

/** The cron_runs.name this cron records under, and reads its last window from. */
export const INDEX_URLS_CRON = 'index-urls';

const HOUR_MS = 60 * 60 * 1000;

/** The window of a run with no usable predecessor: the old fixed 25 hours. */
export const FIRST_RUN_WINDOW_MS = 25 * HOUR_MS;

/**
 * Furthest back a run reaches after missed runs. A job older than this has
 * long been in the job sitemap; a new-content ping for it adds nothing.
 */
export const MAX_LOOKBACK_MS = 7 * 24 * HOUR_MS;

/** Rows stamped this recently are left for the next run's window. */
export const SETTLE_MS = 5 * 60 * 1000;

export interface SubmissionWindow {
    /** Inclusive lower bound. */
    readonly since: Date;
    /** Exclusive upper bound, and the resume point the next run reads back. */
    readonly until: Date;
}

function parseInstant(value: unknown): Date | null {
    if (typeof value !== 'string' && !(value instanceof Date)) return null;
    const at = new Date(value);
    return Number.isFinite(at.getTime()) ? at : null;
}

/** The window end a run recorded in its metrics, or null when it recorded none. */
export function windowEndFromMetrics(metrics: unknown): Date | null {
    if (typeof metrics !== 'object' || metrics === null || Array.isArray(metrics)) return null;
    return parseInstant((metrics as Record<string, unknown>).windowEnd);
}

/**
 * Where the newest successful run's window ended, or null on the first run.
 *
 * A run from before the window was recorded covered the 25 hours up to its own
 * start, so its startedAt is its window end. The row withCronTracking opened
 * for the current run is still marked unsuccessful, so it is never its own
 * predecessor. A read that fails throws on purpose: guessing a window would
 * either resend a day of URLs or skip one, while failing the run only defers
 * it to the next one.
 */
export async function readLastWindowEnd(): Promise<Date | null> {
    const last = await prisma.cronRun.findFirst({
        where: { name: INDEX_URLS_CRON, success: true },
        orderBy: { startedAt: 'desc' },
        select: { startedAt: true, metrics: true },
    });
    if (!last) return null;
    return windowEndFromMetrics(last.metrics) ?? parseInstant(last.startedAt);
}

export function planSubmissionWindow(lastEnd: Date | null, now: Date): SubmissionWindow {
    const end = now.getTime() - SETTLE_MS;
    const floor = now.getTime() - MAX_LOOKBACK_MS;
    const start = lastEnd === null ? now.getTime() - FIRST_RUN_WINDOW_MS : Math.max(lastEnd.getTime(), floor);
    // Never move the resume point backwards. A run fired again within
    // SETTLE_MS of the last one, or a recorded end ahead of this clock, gets
    // an empty window that ends where the last one did.
    return { since: new Date(start), until: new Date(Math.max(start, end)) };
}

/** New or content-changed inside the window, and live on the job sitemap's terms. */
export function submissionWhere(window: SubmissionWindow, now: Date): Prisma.JobWhereInput {
    const inWindow = { gte: window.since, lt: window.until };
    return {
        AND: [
            activeIndexableJobWhere(now),
            { OR: [{ createdAt: inWindow }, { contentChangedAt: inWindow }] },
        ],
    };
}

/**
 * True when the job page emits a valid JobPosting item for this row, by the
 * page's own rule. A row that fails keeps its page and its sitemap entry, but
 * the Indexing API accepts only job posting pages, so it is not submitted.
 */
export function isSubmittableJobPosting(job: JobPostingFactsInput): boolean {
    return isJobPostingEligible(job);
}
