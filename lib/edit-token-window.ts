/**
 * How long a job's edit token keeps working (P5.A, 2026-06-01; register 2.29).
 *
 * The edit token is a bearer credential in the edit page's address
 * (/jobs/edit/<token>), so a shared link, a browser history or a request log
 * can carry it; no email does (the emails link the dashboard token). It is
 * honoured while the job is published, and after that until
 * EDIT_TOKEN_GRACE_MS past the job's expiresAt. An unpublished job further
 * past its expiry than that, or one with no expiry at all (or one that does
 * not parse), refuses it, so an old link cannot reach a long dead post. The
 * invoice and receipt links do not take it at all. No flow mints a new token:
 * a renewal puts the post live again, which reopens the window.
 *
 * Every route that takes the token applies this one rule and gives the same
 * answer: GET /api/jobs/edit/[token] (the edit form), POST /api/jobs/update
 * (save) and DELETE /api/jobs/update (unpublish). The save and the unpublish
 * used to accept the token forever (tests/api/edit-token-window.test.ts).
 */
import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

/** How long after its expiresAt an unpublished job still takes its edit token. */
export const EDIT_TOKEN_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

/** The error every edit token route answers, with a 401, once the window has closed. */
export const EDIT_WINDOW_CLOSED_ERROR = 'Edit window has closed for this posting. See your options in your dashboard.';

/** The Job columns the rule reads, for a lookup that includes the job. */
export const EDIT_WINDOW_JOB_SELECT = { isPublished: true, expiresAt: true } as const;

export interface EditWindowJob {
    isPublished: boolean;
    expiresAt: Date | string | null;
}

/**
 * True when the job no longer takes its edit token. Written as "not within
 * the grace" so an expiry that does not parse (NaN) closes the window rather
 * than opening it.
 */
export function isEditWindowClosed(job: EditWindowJob, nowMs: number = Date.now()): boolean {
    if (job.isPublished) return false;
    const ageMs = job.expiresAt ? nowMs - new Date(job.expiresAt).getTime() : Number.POSITIVE_INFINITY;
    return !(ageMs <= EDIT_TOKEN_GRACE_MS);
}

/**
 * The 401 for a closed window, logged with the token's first four characters
 * only, so the raw credential never reaches log storage.
 */
export function editWindowClosedResponse(route: string, token: string, jobId: string): NextResponse {
    logger.warn(`[${route}] edit-token rejected: job too far past expiry`, {
        tokenPrefix: token.slice(0, 4),
        jobId,
    });
    return NextResponse.json({ error: EDIT_WINDOW_CLOSED_ERROR }, { status: 401 });
}
