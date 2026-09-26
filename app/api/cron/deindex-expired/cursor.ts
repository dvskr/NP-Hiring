/**
 * Resume point for app/api/cron/deindex-expired.
 *
 * THE BUG THIS FIXES. The cron used to take the most recently updated expired
 * jobs from a fixed 48 hour window, newest first, and record nothing about what
 * it had sent. Google takes a fixed number of removals per run from the
 * expired-job-removal lane in lib/search-indexing.ts, so every run spent that
 * number on the same newest expiries, and an expiry further back in the window
 * never reached Google at all. A run that failed or never fired lost its
 * expiries for good once the 48 hours rolled past them.
 *
 * THE CURSOR. The (updatedAt, id) of the last expired job whose removal a run
 * finished, kept in that run's cron_runs.metrics (written by withCronTracking in
 * lib/cron/track.ts), so no schema change is needed. Every successful run writes
 * one, carrying the previous value forward when it finished nothing, so the
 * newest successful run always holds the resume point. A failed run records no
 * metrics, so the run after it resumes from the last run that succeeded.
 *
 * A run moves the cursor only past jobs Google gave a final answer for
 * (advanceCursor says which answers are final). A job Google was not asked
 * about, or failed with nothing accepted after it, stays ahead of the cursor and
 * is offered again on the next run; IndexNow, offered the same batch, hears
 * about that job again too.
 *
 * WHY A CURSOR RATHER THAN THE LAST SUCCESSFUL RUN'S TIMESTAMP. A timestamp says
 * when a run happened, not how far it got. Whenever more expiries are waiting
 * than one run may send, a run that resumed from its predecessor's start time
 * would skip everything its predecessor could not fit. The cursor records
 * exactly where sending stopped, so the remainder carries over to the next run.
 * It also comes from the rows' own updatedAt values, so resuming never depends
 * on the cron's clock agreeing with the database's.
 *
 * WHY THE ID IS PART OF IT. The expiry sweeps flip jobs with one updateMany, and
 * Prisma stamps every row of it with the same updatedAt, so hundreds of jobs can
 * share one value. On updatedAt alone, a run that stopped partway through such a
 * group would either skip the rest of it (strictly after) or send the part it
 * already sent again (at or after). Ordering by (updatedAt, id) and resuming
 * strictly after the pair does neither.
 *
 * WHAT IS STILL LEFT OUT, ON PURPOSE:
 *  - Anything older than MAX_LOOKBACK_MS. After an outage longer than that, the
 *    run starts at the floor and reports how many expiries it passed over.
 *  - Anything updated within the last SETTLE_MS, which the next run picks up.
 *
 * WHAT "ONCE" MEANS. Once per update, not once per job. Every write to an
 * expired job after it was sent moves its updatedAt past the cursor, so the next
 * run offers it again, and it comes back after each later write too. That
 * repeats a removal and spends a share of the Google lane on it; it never skips
 * one. Ingest renewal (renewJob in lib/ingestion-service.ts) sees an expired
 * job on every ingest run whose source still lists it, so it leaves such a row
 * untouched: its age cap skips the write when the row is already unpublished,
 * and it never revives a job past its own expiresAt. Without those two guards
 * the job would be offered again after every such ingest run.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
    googleWasNotAsked,
    isGooglePolicyRefusal,
    type pingAllSearchEnginesBatchDeleted,
} from '@/lib/search-indexing';

/** The cron_runs.name this cron records under, and reads its cursor back from. */
export const DEINDEX_EXPIRED_CRON = 'deindex-expired';

/**
 * How far back a run reaches when the stored cursor is older, or absent.
 *
 * It bounds the catch up after an outage: a week is fourteen missed twice daily
 * runs. Past it, a removal is old enough that Google has usually recrawled the
 * dead page itself, and a longer reach would only spend the lane on the stalest
 * expiries while fresh ones wait.
 */
export const MAX_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Rows updated this recently are left for the next run.
 *
 * Prisma stamps updatedAt when it builds an update, before the database commits
 * it, so a row can become visible a moment after a row stamped later than it.
 * Without a margin, a run could move the cursor past a row whose update had not
 * committed yet, and nothing would ever read that row again. Five minutes is far
 * longer than one expiry updateMany should take to commit. The cost is that a
 * job flipped in the last five minutes waits for the next run.
 */
export const SETTLE_MS = 5 * 60 * 1000;

export interface DeindexCursor {
    /** updatedAt of the last job whose removal a run finished, as ISO 8601. */
    readonly updatedAt: string;
    /** That job's id, which orders the jobs that share one updatedAt. */
    readonly id: string;
}

/** A stored cursor, or null for anything that is not a well formed one. */
export function parseCursor(value: unknown): DeindexCursor | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const { updatedAt, id } = value as Record<string, unknown>;
    if (typeof updatedAt !== 'string' || typeof id !== 'string' || id.length === 0) return null;
    const at = new Date(updatedAt);
    if (!Number.isFinite(at.getTime())) return null;
    return { updatedAt: at.toISOString(), id };
}

/** The cursor a run recorded in its metrics, or null when it recorded none. */
export function cursorFromMetrics(metrics: unknown): DeindexCursor | null {
    if (typeof metrics !== 'object' || metrics === null || Array.isArray(metrics)) return null;
    return parseCursor((metrics as Record<string, unknown>).cursor);
}

/**
 * The cursor of the newest successful run, or null on the first run.
 *
 * The row withCronTracking opened for the current run is still marked
 * unsuccessful, so it is never its own predecessor. A read that fails throws on
 * purpose: falling back to the lookback floor would send up to a week of
 * removals a second time, while failing the run only defers them.
 */
export async function readLastCursor(): Promise<DeindexCursor | null> {
    const lastSuccess = await prisma.cronRun.findFirst({
        where: { name: DEINDEX_EXPIRED_CRON, success: true },
        orderBy: { startedAt: 'desc' },
        select: { metrics: true },
    });
    return lastSuccess ? cursorFromMetrics(lastSuccess.metrics) : null;
}

export interface DeindexWindow {
    /** Oldest updatedAt a run may reach back to. */
    readonly floor: Date;
    /** Newest updatedAt a run may take; anything later waits for the next run. */
    readonly ceiling: Date;
    /** Where this run resumes, or null to start at the floor. */
    readonly resumeAfter: DeindexCursor | null;
    /** The stored cursor when it had fallen behind the floor, otherwise null. */
    readonly staleCursor: DeindexCursor | null;
}

export function planWindow(cursor: DeindexCursor | null, now: Date): DeindexWindow {
    const floor = new Date(now.getTime() - MAX_LOOKBACK_MS);
    const ceiling = new Date(now.getTime() - SETTLE_MS);
    const withinLookback =
        cursor !== null && new Date(cursor.updatedAt).getTime() >= floor.getTime();
    return {
        floor,
        ceiling,
        resumeAfter: withinLookback ? cursor : null,
        staleCursor: cursor !== null && !withinLookback ? cursor : null,
    };
}

/**
 * The jobs whose removal this cron owns.
 *
 * Only aggregated jobs (a sourceProvider), because an employer posted job may be
 * published again. Only jobs that had a public URL (a slug). And only jobs whose
 * expiry has passed (Audit 25 M-2): the dead link and source presence crons
 * unpublish too, and fire their own job.health.flipped events for de-indexing,
 * so without this gate their jobs would be submitted twice from the same Google
 * quota. A passed expiresAt narrows the set to expiry driven unpublishes.
 */
export function expiredJobFilter(now: Date): Prisma.JobWhereInput {
    return {
        isPublished: false,
        slug: { not: null },
        sourceProvider: { not: null },
        expiresAt: { not: null, lt: now },
    };
}

/** Strictly after the cursor in (updatedAt, id) order. */
function strictlyAfter(cursor: DeindexCursor): Prisma.JobWhereInput {
    const at = new Date(cursor.updatedAt);
    return {
        OR: [{ updatedAt: { gt: at } }, { updatedAt: at, id: { gt: cursor.id } }],
    };
}

/** Expired jobs this run may send: after the resume point, inside the window. */
export function pendingJobsWhere(window: DeindexWindow, now: Date): Prisma.JobWhereInput {
    return {
        AND: [
            expiredJobFilter(now),
            { updatedAt: { gte: window.floor, lte: window.ceiling } },
            ...(window.resumeAfter ? [strictlyAfter(window.resumeAfter)] : []),
        ],
    };
}

/**
 * Expired jobs a stale cursor never reached before they fell behind the floor.
 * The run cannot send them any more, so it counts them for its report.
 */
export function passedOverWhere(
    staleCursor: DeindexCursor,
    window: DeindexWindow,
    now: Date,
): Prisma.JobWhereInput {
    return {
        AND: [
            expiredJobFilter(now),
            strictlyAfter(staleCursor),
            { updatedAt: { lt: window.floor } },
        ],
    };
}

/** One job as it was offered to the search engines. */
export interface OfferedJob {
    readonly id: string;
    readonly updatedAt: Date;
    readonly url: string;
}

type GoogleResult = Awaited<ReturnType<typeof pingAllSearchEnginesBatchDeleted>>['google'][number];

/**
 * Why the cursor stopped short of the end of the batch.
 *  - google-not-asked: Google was never asked about a job, because the lane was
 *    already spent in this process or no credential was there to ask with.
 *    Everything from that job on carries over to the next run.
 *  - google-rejected-every-url: Google refused every job it was asked about. That
 *    is what a key Search Console does not recognize, a key that will not
 *    exchange, or an outage looks like, so the whole batch is offered again.
 *  - google-failed-after-last-success: Google accepted some jobs, then failed
 *    every job it was asked about after the last one it accepted. That is what
 *    the project's daily quota running out partway through a batch (a 429), or
 *    a network or server fault that starts partway through, looks like. Nothing
 *    after the failures shows Google working again, so the cursor stops just
 *    after the last accepted job and the failed tail carries over to the next
 *    run.
 */
export type CursorHold =
    | 'google-not-asked'
    | 'google-rejected-every-url'
    | 'google-failed-after-last-success';

export interface CursorAdvance {
    /** The cursor to record for this run. */
    readonly cursor: DeindexCursor | null;
    /** Jobs the cursor moved past, which the next run will not offer again. */
    readonly completed: number;
    readonly hold: CursorHold | null;
}

/**
 * Move the cursor past each offered job, in order, for which Google has given a
 * final answer: accepted, refused as out of scope, or failed on its own while a
 * later job in the batch went through. Stop at the first job Google was never
 * asked about, and just after the last job Google accepted when every job it was
 * asked about after that one failed. Hold the cursor where it was when Google
 * refused every job it was asked about.
 *
 * A failure is final only when Google accepted a later job in the same batch,
 * which shows Google was working and the fault belongs to that one URL. So a
 * single job Google keeps failing does not stall every removal behind it until
 * the lookback floor passes it: failing at the end of a batch, it is offered
 * again at the head of the next one, and passed there once a job after it goes
 * through. A failure with no success after it proves nothing about the URL,
 * because a quota that ran out or an outage that began partway through the batch
 * fails every URL from that point on, so those jobs carry over instead. A scope
 * refusal makes no request and is final wherever it falls, so the cursor also
 * moves past scope refusals that directly follow the last accepted job.
 *
 * `google` must hold one result per offered job in the same order, as
 * pingAllSearchEnginesBatchDeleted returns them; a missing or mismatched result
 * stops the cursor, because it cannot show that Google was asked about that job.
 */
export function advanceCursor(
    previous: DeindexCursor | null,
    offered: readonly OfferedJob[],
    google: readonly GoogleResult[],
): CursorAdvance {
    let finished = 0;
    while (finished < offered.length) {
        const result = google[finished];
        if (!result || result.url !== offered[finished].url || googleWasNotAsked(result)) break;
        finished++;
    }

    const answered = google.slice(0, finished);
    const asked = answered.filter((result) => !isGooglePolicyRefusal(result));
    if (asked.length > 0 && !asked.some((result) => result.success)) {
        return { cursor: previous, completed: 0, hold: 'google-rejected-every-url' };
    }
    if (finished === 0) {
        return { cursor: previous, completed: 0, hold: offered.length > 0 ? 'google-not-asked' : null };
    }

    // Just after the last accepted job (the start of the batch when Google was
    // asked about none, every answer being a scope refusal), then past the scope
    // refusals that follow it. Some job was accepted or refused on scope, so
    // end is at least 1.
    let end = answered.map((result) => result.success).lastIndexOf(true) + 1;
    while (end < finished && isGooglePolicyRefusal(answered[end])) end++;

    const last = offered[end - 1];
    return {
        cursor: { updatedAt: last.updatedAt.toISOString(), id: last.id },
        completed: end,
        hold:
            end < finished
                ? 'google-failed-after-last-success'
                : end < offered.length
                  ? 'google-not-asked'
                  : null,
    };
}
