/**
 * What an ingest run may do with a stored job when a source lists a posting
 * the duplicate check resolved to it.
 *
 * WHY THIS EXISTS. The renewal used to republish the stored job on every
 * match. That is right only when the source listed the stored job's own
 * posting again. When the match was a different posting (the same role under
 * a new id, or another source's copy of it), the stored job came back still
 * carrying the external id and the apply link of a posting that no longer
 * existed. The source-presence sweep or the dead-link check then took it down
 * again, and the next ingest run put it back: a lap or more a day for as long
 * as a look-alike posting stayed listed. Between laps the job page served a
 * dead apply link, and every lap sent the search engines a removal and a
 * return for the same URL. The same revive also undid takedowns that had
 * nothing to do with the health checks: a job enough people reported, or one
 * a cleanup removed, came back with the next run of its source.
 *
 * THE RULES.
 *
 *  1. Ingest brings back only what the health checks took down (the presence
 *     sweep, the dead-link check). A job that is down for any other reason
 *     stays down, whatever a source lists.
 *  2. A job comes back as it is only on the source's word about the stored
 *     posting itself: the fetch returned the stored job's own external id.
 *     After a dead-link verdict that word counts only from an employer's own
 *     feed: a relisting source can go on listing a posting whose page is
 *     gone, and the recovery re-probes decide that case.
 *  3. A different posting takes the job over, so that the job carries a
 *     posting that is live, only when it is the same job by exact identity
 *     (title, employer and location, normalized). The duplicate check also
 *     matches near misses, and a near miss can be another opening: the same
 *     title in a city spelled almost alike. Taking the job over with one
 *     would put that opening's apply link under this job's title and place.
 *  4. A different posting that may not take a downed job over is stored as a
 *     job of its own when it stands on its own: the same source listing a
 *     look-alike under a new id, or an employer's own feed. A relisted copy
 *     from another source is dropped as before: it never brings back, or
 *     stands in for, a job its own source closed.
 *
 * A published job is otherwise refreshed as before.
 *
 * Pure on purpose: the caller reads the row and writes the result
 * (renewExistingJob in lib/ingestion-service.ts).
 */
import { isEmployerDirectSource } from '@/lib/aggregators/source-kind';

/**
 * - revive: publish the job as it stands and clear its presence misses.
 * - take-over: point the job at the listed posting, then as revive.
 * - refresh: touch a published job; nothing about its state changes.
 * - leave: write nothing; the posting is dropped as a duplicate.
 * - separate: write nothing; the posting is not this job's and is stored as
 *   a job of its own.
 */
export type RenewalAction = 'revive' | 'take-over' | 'refresh' | 'leave' | 'separate';

/**
 * What took an unpublished job down, as far as the renewal can tell:
 * the presence sweep, a dead-link verdict, or anything else (a person, a
 * report threshold, a cleanup, an expiry).
 */
export type TakedownCause = 'presence' | 'dead-link' | 'other';

/** The stored job, as the renewal reads it. */
export interface StoredListing {
    isPublished: boolean;
    /** True for a job the ingest pipeline stored (sourceType 'external'). */
    isAggregated: boolean;
    sourceProvider: string | null;
    externalId: string | null;
    /** Consecutive presence checks of its source that did not return its id. */
    healthConsecutiveMissing: number;
    /** What took it down. Read only for an unpublished job; null for a published one. */
    downBy: TakedownCause | null;
}

/** The posting a source just listed. */
export interface IncomingListing {
    source: string;
    externalId: string | null;
    applyLink: string | null;
    /** The site the source says the posting came from, or null when it does not say. */
    sourceSite?: string | null;
}

export interface RenewalContext {
    /**
     * True when the posting comes from the stored job's own source and that
     * source's fetch, this run, returned the stored job's external id. The
     * fetch can return it without this posting being it (a look-alike was
     * matched first), and without the stored posting reaching the duplicate
     * check at all (the freshness gate drops a posting older than it admits).
     */
    storedIdListedThisRun: boolean;
    /** True when the posting and the stored job have the same normalized title, employer and location. */
    sameIdentity: boolean;
}

/** The posting the stored job was made from: the same source and the same external id. */
export function isOwnListing(stored: StoredListing, incoming: IncomingListing): boolean {
    return (
        stored.externalId !== null &&
        stored.externalId !== '' &&
        stored.sourceProvider === incoming.source &&
        stored.externalId === incoming.externalId
    );
}

export function decideRenewal(
    stored: StoredListing,
    incoming: IncomingListing,
    context: RenewalContext,
): RenewalAction {
    const own = isOwnListing(stored, incoming);
    const listed = own || context.storedIdListedThisRun;
    const sameSource = stored.sourceProvider === incoming.source;
    // A take-over rewrites the job's external id and apply link, and a
    // posting stored on its own is tracked by both.
    const canCarry = Boolean(incoming.externalId) && Boolean(incoming.applyLink);

    if (stored.isPublished) {
        // The source returned the stored posting itself, as this posting or
        // beside it: the job is live as it stands.
        if (listed) return 'revive';
        // The same source lists the same job under another id, and the last
        // presence check missed the stored id too: move to the id that is
        // live before the sweep takes the job down. A job with no miss yet
        // waits for that check.
        if (
            sameSource &&
            stored.isAggregated &&
            canCarry &&
            context.sameIdentity &&
            stored.healthConsecutiveMissing > 0
        ) {
            return 'take-over';
        }
        return 'refresh';
    }

    // Rule 1. Never a job an employer or an admin posted, and never a job
    // the health checks did not take down.
    if (!stored.isAggregated || stored.downBy === null || stored.downBy === 'other') return 'leave';

    // Rule 2.
    if (listed) {
        if (stored.downBy === 'presence' || isEmployerDirectSource(stored.sourceProvider)) return 'revive';
        // A relisting source still lists a posting whose page a link check
        // found dead. That posting does not bring the job back; a look-alike
        // beside it is judged below like any other.
        if (own) return 'leave';
    }

    if (!canCarry) return 'leave';

    // Rules 3 and 4. The stored posting is gone. Another posting of the
    // source, or an employer's own feed, is live.
    if (sameSource || isEmployerDirectSource(incoming.source)) {
        return context.sameIdentity ? 'take-over' : 'separate';
    }
    return 'leave';
}

/**
 * The identity, publish and presence columns an action writes. The caller
 * adds whatever the fresh copy improves (buildRenewalEnrichmentDelta).
 */
export function renewalWrite(
    action: 'revive' | 'take-over' | 'refresh',
    incoming: IncomingListing,
    now: Date,
): Record<string, unknown> {
    if (action === 'refresh') return { updatedAt: now };

    // The source just returned this posting: it is published, and it has no
    // presence miss against it.
    const seen = {
        isPublished: true,
        updatedAt: now,
        healthConsecutiveMissing: 0,
        healthLastSeenAt: now,
    };
    if (action === 'revive') return seen;

    return {
        ...seen,
        // The job now carries the listed posting, whole: its source, id,
        // link and the site the source names for it.
        sourceProvider: incoming.source,
        externalId: incoming.externalId,
        applyLink: incoming.applyLink,
        sourceSite: incoming.sourceSite ?? null,
        // The dead-link check reads the least recently checked first, and a
        // null first of all: the new link is probed on its next run.
        lastLinkCheckedAt: null,
    };
}
