/**
 * What an employer may search and filter on in the talent pool
 * (lib/candidate-pool.ts).
 *
 * The candidate list's free-text search matched lastName, bio, state, city
 * and certifications for every employer, so q=<surname> answering "Anna N."
 * confirmed a surname only an unlock or an admin sees. The rules run here
 * against a fixture row, so the clauses themselves decide. The pool rule
 * itself is pinned by tests/regressions/talent-pool-shared-rules.test.ts.
 *
 * All fixtures are fictional.
 */
import { describe, expect, it } from 'vitest';
import {
    candidateAccessTier,
    candidateTextSearchClauses,
    seesPostingTierFields,
    type CandidateAccessTier,
} from '@/lib/candidate-pool';
import { rowMatches, type Row } from '../helpers/fake-row-where';

const anna: Row = {
    role: 'job_seeker', profileVisible: true, openToOffers: true, deletedAt: null,
    firstName: 'Anna', lastName: 'Nguyenfic', headline: 'Outpatient family nurse practitioner',
    specialties: 'Family Practice (FNP), Telehealth', preferredWorkMode: 'Remote',
    certifications: 'ANCC FNP-BC', bio: 'Fluent in Tagalog.', state: 'TX', city: 'Austin',
};

const searchMatches = (q: string, tier: CandidateAccessTier) =>
    rowMatches(anna, { OR: candidateTextSearchClauses(q, tier) });

describe('candidateAccessTier', () => {
    it('ranks admin over posting over browse', () => {
        expect(candidateAccessTier({ isAdmin: true, hasActivePosting: false })).toBe('admin');
        expect(candidateAccessTier({ isAdmin: false, hasActivePosting: true })).toBe('posting');
        expect(candidateAccessTier({ isAdmin: false, hasActivePosting: false })).toBe('browse');
    });

    it('lets only posting and admin viewers filter on posting-tier fields', () => {
        expect(seesPostingTierFields('browse')).toBe(false);
        expect(seesPostingTierFields('posting')).toBe(true);
        expect(seesPostingTierFields('admin')).toBe(true);
    });
});

describe('candidateTextSearchClauses', () => {
    const fieldsOf = (tier: CandidateAccessTier) =>
        candidateTextSearchClauses('x', tier).map((clause) => Object.keys(clause)[0]);

    it('searches only the fields each tier can read', () => {
        expect(fieldsOf('browse')).toEqual(['firstName', 'headline', 'specialties', 'preferredWorkMode']);
        expect(fieldsOf('posting')).toEqual(['firstName', 'headline', 'specialties', 'preferredWorkMode', 'certifications']);
        expect(fieldsOf('admin')).toEqual([
            'firstName', 'headline', 'specialties', 'preferredWorkMode', 'certifications',
            'lastName', 'bio', 'state', 'city',
        ]);
    });

    it('a surname search finds nothing for an employer, with or without a posting', () => {
        expect(searchMatches('nguyenfic', 'browse')).toBe(false);
        expect(searchMatches('nguyenfic', 'posting')).toBe(false);
        expect(searchMatches('nguyenfic', 'admin')).toBe(true);
    });

    it('bio and location are searchable by admins only', () => {
        for (const q of ['tagalog', 'austin', 'TX']) {
            expect(searchMatches(q, 'posting')).toBe(false);
            expect(searchMatches(q, 'admin')).toBe(true);
        }
    });

    it('certifications need a posting', () => {
        expect(searchMatches('ANCC', 'browse')).toBe(false);
        expect(searchMatches('ANCC', 'posting')).toBe(true);
    });

    it('the public fields stay searchable for everyone, case-insensitively', () => {
        for (const q of ['anna', 'outpatient', 'telehealth', 'REMOTE']) {
            expect(searchMatches(q, 'browse')).toBe(true);
        }
    });
});
