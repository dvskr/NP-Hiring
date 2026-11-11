/**
 * The rule for what an ingest run may do with a stored job when a source
 * lists a posting the duplicate check resolved to it.
 *
 * The bug this pins: the renewal used to republish the stored job on every
 * match. When the match was a different posting (the same role under a new
 * id, or another source's copy), the job came back carrying a posting that no
 * longer existed, the presence sweep or the dead-link check took it down
 * again, and the next run put it back. The same revive also undid takedowns
 * the health checks never made. lib/health/renewal-decision.ts states the
 * four rules; each block below is one of them.
 */
import { describe, it, expect } from 'vitest';
import {
    decideRenewal,
    isOwnListing,
    renewalWrite,
    type IncomingListing,
    type RenewalContext,
    type StoredListing,
} from '@/lib/health/renewal-decision';
import { SOURCE_KIND, isEmployerDirectSource } from '@/lib/aggregators/source-kind';
import { aggregators } from '@/lib/aggregators/registry';

const stored = (over: Partial<StoredListing> = {}): StoredListing => ({
    isPublished: true,
    isAggregated: true,
    sourceProvider: 'adzuna',
    externalId: 'adzuna_1',
    healthConsecutiveMissing: 0,
    downBy: null,
    ...over,
});

/** A relisted copy the presence sweep took down. */
const downByPresence = (over: Partial<StoredListing> = {}): StoredListing =>
    stored({ isPublished: false, healthConsecutiveMissing: 3, downBy: 'presence', ...over });

/** An employer feed's posting a dead-link verdict took down. */
const downByDeadLink = (over: Partial<StoredListing> = {}): StoredListing =>
    stored({ isPublished: false, sourceProvider: 'lever', externalId: 'lever-acme-1', downBy: 'dead-link', ...over });

const incoming = (over: Partial<IncomingListing> = {}): IncomingListing => ({
    source: 'adzuna',
    externalId: 'adzuna_2',
    applyLink: 'https://relister.example/land/ad/2',
    ...over,
});

const context = (over: Partial<RenewalContext> = {}): RenewalContext => ({
    storedIdListedThisRun: false,
    sameIdentity: true,
    ...over,
});

const LISTED = context({ storedIdListedThisRun: true });
const SAME_JOB = context();
const NEAR_MISS = context({ sameIdentity: false });

const employerFeed = incoming({ source: 'greenhouse', externalId: 'gh_9', applyLink: 'https://ats.example/jobs/9' });
const relistedCopy = incoming({ source: 'adzuna', externalId: 'adzuna_7' });
const leverLookAlike = incoming({ source: 'lever', externalId: 'lever-acme-2', applyLink: 'https://ats.example/acme/2' });

describe('isOwnListing', () => {
    it('is the same source and the same external id', () => {
        expect(isOwnListing(stored(), incoming({ externalId: 'adzuna_1' }))).toBe(true);
    });

    it('is not a different id, another source, or a stored job with no id', () => {
        expect(isOwnListing(stored(), incoming())).toBe(false);
        expect(isOwnListing(stored(), incoming({ source: 'lever', externalId: 'adzuna_1' }))).toBe(false);
        expect(isOwnListing(stored({ externalId: null }), incoming({ externalId: null }))).toBe(false);
    });
});

describe('a published job', () => {
    it('is kept live, and its misses cleared, when the fetch returned its own posting', () => {
        expect(decideRenewal(stored(), incoming({ externalId: 'adzuna_1' }), LISTED)).toBe('revive');
        // A look-alike was matched, and the stored id is in the same fetch.
        expect(decideRenewal(stored({ healthConsecutiveMissing: 2 }), incoming(), LISTED)).toBe('revive');
    });

    it('moves to the id the source now lists once the last presence check missed its own', () => {
        expect(decideRenewal(stored({ healthConsecutiveMissing: 1 }), incoming(), SAME_JOB)).toBe('take-over');
    });

    it('is only refreshed while it has no presence miss, or the look-alike is a near miss', () => {
        expect(decideRenewal(stored(), incoming(), SAME_JOB)).toBe('refresh');
        expect(decideRenewal(stored({ healthConsecutiveMissing: 2 }), incoming(), NEAR_MISS)).toBe('refresh');
    });

    it('is only refreshed by another source, by a posting with nothing to carry, and when a person posted it', () => {
        expect(decideRenewal(stored({ healthConsecutiveMissing: 2 }), employerFeed, SAME_JOB)).toBe('refresh');
        expect(decideRenewal(stored({ sourceProvider: 'lever', externalId: 'lever-acme-1' }), relistedCopy, SAME_JOB)).toBe('refresh');
        expect(decideRenewal(stored({ healthConsecutiveMissing: 2 }), incoming({ externalId: null }), SAME_JOB)).toBe('refresh');
        expect(decideRenewal(stored({ healthConsecutiveMissing: 2 }), incoming({ applyLink: null }), SAME_JOB)).toBe('refresh');
        const employerPost = stored({ isAggregated: false, sourceProvider: null, externalId: null });
        expect(decideRenewal(employerPost, employerFeed, SAME_JOB)).toBe('refresh');
    });
});

describe('rule 1: ingest brings back only what the health checks took down', () => {
    const own = incoming({ externalId: 'adzuna_1' });

    it('leaves a job that is down for any other reason, whatever a source lists', () => {
        const removed = stored({ isPublished: false, downBy: 'other' });
        expect(decideRenewal(removed, own, LISTED)).toBe('leave');
        expect(decideRenewal(removed, incoming(), SAME_JOB)).toBe('leave');
        expect(decideRenewal(removed, employerFeed, SAME_JOB)).toBe('leave');
        // Misses on record do not make it a presence takedown.
        expect(decideRenewal({ ...removed, healthConsecutiveMissing: 2 }, incoming(), SAME_JOB)).toBe('leave');
    });

    it('leaves a downed job whose cause was not read', () => {
        expect(decideRenewal(stored({ isPublished: false, downBy: null }), own, LISTED)).toBe('leave');
    });

    it('never touches an unpublished job an employer or an admin posted on the board', () => {
        const employerPost = stored({ isPublished: false, isAggregated: false, sourceProvider: null, externalId: null, downBy: 'dead-link' });
        expect(decideRenewal(employerPost, employerFeed, SAME_JOB)).toBe('leave');
        expect(decideRenewal(employerPost, relistedCopy, SAME_JOB)).toBe('leave');
    });
});

describe('rule 2: a job comes back as it is only on the source\'s word about the stored posting', () => {
    it('after the presence sweep, the source listing the stored id again is that word', () => {
        expect(decideRenewal(downByPresence(), incoming({ externalId: 'adzuna_1' }), LISTED)).toBe('revive');
        // The stored posting may never reach the duplicate check itself (the
        // freshness gate drops a posting older than it admits), so a
        // look-alike beside it brings the job back as it stands.
        expect(decideRenewal(downByPresence(), incoming(), LISTED)).toBe('revive');
    });

    it('after a dead-link verdict, an employer feed listing the stored id again is that word', () => {
        const own = incoming({ source: 'lever', externalId: 'lever-acme-1', applyLink: 'https://ats.example/acme/1' });
        expect(decideRenewal(downByDeadLink(), own, LISTED)).toBe('revive');
    });

    it('after a dead-link verdict, a relisting source still listing the stored id is not', () => {
        const deadRelisted = stored({ isPublished: false, downBy: 'dead-link' });
        expect(decideRenewal(deadRelisted, incoming({ externalId: 'adzuna_1' }), LISTED)).toBe('leave');
        // A look-alike beside the stale listing is judged on its own.
        expect(decideRenewal(deadRelisted, incoming(), LISTED)).toBe('take-over');
        expect(decideRenewal(deadRelisted, incoming(), context({ storedIdListedThisRun: true, sameIdentity: false }))).toBe('separate');
    });
});

describe('rule 3: a different posting takes a downed job over only when it is the same job exactly', () => {
    it('the same source under a new id, whichever health check took the job down', () => {
        expect(decideRenewal(downByPresence(), incoming(), SAME_JOB)).toBe('take-over');
        expect(decideRenewal(downByDeadLink(), leverLookAlike, SAME_JOB)).toBe('take-over');
    });

    it('an employer\'s own feed, for a relisted copy or for a posting another employer system closed', () => {
        expect(decideRenewal(downByPresence(), employerFeed, SAME_JOB)).toBe('take-over');
        expect(decideRenewal(downByDeadLink(), employerFeed, SAME_JOB)).toBe('take-over');
    });

    it('never without an external id and an apply link to carry', () => {
        expect(decideRenewal(downByPresence(), incoming({ externalId: null }), SAME_JOB)).toBe('leave');
        expect(decideRenewal(downByPresence(), incoming({ externalId: '' }), SAME_JOB)).toBe('leave');
        expect(decideRenewal(downByPresence(), incoming({ applyLink: null }), SAME_JOB)).toBe('leave');
    });
});

describe('rule 4: a posting that may not take a downed job over', () => {
    it('is stored on its own when it is a near miss from the same source or from an employer feed', () => {
        expect(decideRenewal(downByPresence(), incoming(), NEAR_MISS)).toBe('separate');
        expect(decideRenewal(downByDeadLink(), leverLookAlike, NEAR_MISS)).toBe('separate');
        expect(decideRenewal(downByPresence(), employerFeed, NEAR_MISS)).toBe('separate');
    });

    it('is dropped when it is a relisted copy from another source, exact or not', () => {
        expect(decideRenewal(downByDeadLink(), relistedCopy, SAME_JOB)).toBe('leave');
        expect(decideRenewal(downByDeadLink(), relistedCopy, NEAR_MISS)).toBe('leave');
        const closedRelisted = downByPresence({ sourceProvider: 'doccafe', externalId: 'doccafe-1' });
        expect(decideRenewal(closedRelisted, relistedCopy, SAME_JOB)).toBe('leave');
    });
});

describe('renewalWrite', () => {
    const now = new Date('2026-11-11T12:00:00.000Z');

    it('refresh touches the timestamp and nothing else', () => {
        expect(renewalWrite('refresh', incoming(), now)).toEqual({ updatedAt: now });
    });

    it('revive publishes and clears the presence misses, keeping the stored identity', () => {
        expect(renewalWrite('revive', incoming({ externalId: 'adzuna_1' }), now)).toEqual({
            isPublished: true,
            updatedAt: now,
            healthConsecutiveMissing: 0,
            healthLastSeenAt: now,
        });
    });

    it('take-over points the job at the live posting, whole, and queues its link for the next check', () => {
        expect(renewalWrite('take-over', incoming({ sourceSite: 'site-a' }), now)).toEqual({
            isPublished: true,
            updatedAt: now,
            sourceProvider: 'adzuna',
            externalId: 'adzuna_2',
            applyLink: 'https://relister.example/land/ad/2',
            sourceSite: 'site-a',
            healthConsecutiveMissing: 0,
            healthLastSeenAt: now,
            lastLinkCheckedAt: null,
        });
    });

    it('take-over clears a source site the listed posting does not state', () => {
        expect(renewalWrite('take-over', incoming(), now).sourceSite).toBeNull();
        expect(renewalWrite('take-over', incoming({ sourceSite: null }), now).sourceSite).toBeNull();
    });
});

describe('source kinds', () => {
    it('classifies every registered source', () => {
        for (const source of Object.keys(aggregators)) {
            expect(SOURCE_KIND[source as keyof typeof SOURCE_KIND], source).toMatch(/^(employer-direct|relisting)$/);
        }
    });

    it('treats an unknown or missing source as not employer-direct', () => {
        expect(isEmployerDirectSource('greenhouse')).toBe(true);
        expect(isEmployerDirectSource('adzuna')).toBe(false);
        expect(isEmployerDirectSource('some-new-board')).toBe(false);
        expect(isEmployerDirectSource(null)).toBe(false);
        expect(isEmployerDirectSource(undefined)).toBe(false);
    });
});
