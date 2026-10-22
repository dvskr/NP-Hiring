/**
 * Register 2.26, drift guards: one talent pool rule and one set of candidate
 * alert limits.
 *
 * The talent pool rule (a job seeker's profile, visible to employers and open
 * to offers) was written by hand in seven places, and only the candidate
 * alert cron also checked that the account was not deleted. The soft delete
 * clears both flags, so the gap was latent, but each copy could drift on its
 * own. Every pool read now takes lib/candidate-pool.ts, deletion check
 * included.
 *
 * The candidate alert caps were declared twice, in the settings route and in
 * the daily digest cron, with two different list splitters. Both now take
 * lib/candidate-alert-filters.ts.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { talentPoolWhere, isInTalentPool } from '@/lib/candidate-pool';
import {
    MAX_ALERT_SPECIALTIES,
    MAX_ALERT_STATES,
    joinAlertList,
    splitAlertList,
} from '@/lib/candidate-alert-filters';
import { SPECIALTY_PRESETS, LICENSE_STATE_OPTIONS } from '@/config/niche/credentials';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** Every route that reads candidates out of the talent pool. */
const POOL_READERS = [
    'app/api/employer/candidates/route.ts',
    'app/api/employer/candidates/[id]/route.ts',
    'app/api/employer/candidates/[id]/resume/route.ts',
    'app/api/employer/profiles/unlock-bulk/route.ts',
    'app/api/employer/talent/search/route.ts',
    'app/api/employer/saved-candidates/route.ts',
    'app/api/cron/candidate-alerts/route.ts',
];

const ALERT_FILTER_USERS = [
    'app/api/employer/candidate-alerts/route.ts',
    'app/api/cron/candidate-alerts/route.ts',
];

describe('talentPoolWhere', () => {
    it('is a visible job seeker, open to offers, whose account is not deleted', () => {
        expect(talentPoolWhere()).toEqual({
            role: 'job_seeker',
            profileVisible: true,
            openToOffers: true,
            deletedAt: null,
        });
    });

    it('hands each query its own object, so one route cannot change the rule for the next', () => {
        const first = talentPoolWhere() as Record<string, unknown>;
        first.openToOffers = false;
        first.OR = [{ firstName: 'Ada' }];
        expect(talentPoolWhere()).toEqual({
            role: 'job_seeker',
            profileVisible: true,
            openToOffers: true,
            deletedAt: null,
        });
    });
});

describe('isInTalentPool', () => {
    const member = { role: 'job_seeker', profileVisible: true, openToOffers: true, deletedAt: null };

    it('accepts a live pool member', () => {
        expect(isInTalentPool(member)).toBe(true);
    });

    it('refuses a hidden, closed, deleted or non job seeker profile', () => {
        expect(isInTalentPool({ ...member, profileVisible: false })).toBe(false);
        expect(isInTalentPool({ ...member, openToOffers: false })).toBe(false);
        expect(isInTalentPool({ ...member, deletedAt: new Date('2026-10-01T00:00:00Z') })).toBe(false);
        expect(isInTalentPool({ ...member, role: 'employer' })).toBe(false);
        expect(isInTalentPool({ ...member, role: 'admin' })).toBe(false);
    });
});

describe('every talent pool read uses the shared rule', () => {
    for (const file of POOL_READERS) {
        it(file, () => {
            const src = read(file);
            expect(src).toMatch(/import \{[^}]*\btalentPoolWhere\b[^}]*\} from '@\/lib\/candidate-pool'/);
            expect(src).toContain('talentPoolWhere()');
            // No hand-written copy of the rule is left beside it.
            expect(src).not.toMatch(/role:\s*'job_seeker'/);
            expect(src).not.toMatch(/openToOffers:\s*true/);
        });
    }

    // Review of 2.26 (L4): the AI search's vector query picks its top matches
    // in SQL before talent search filters them with talentPoolWhere(), so a
    // query that left out a pool condition spent slots on profiles the route
    // then drops. Its SQL carries the whole rule.
    it("the candidate vector query's SQL carries every condition of the rule", () => {
        const src = read('lib/ai/vector-search.ts');
        const sql = src.slice(src.indexOf('FROM candidate_embeddings ce'), src.indexOf('ORDER BY ce.embedding'));
        for (const condition of ['up.deleted_at IS NULL', 'up.profile_visible = true', 'up.open_to_offers = true', "up.role = 'job_seeker'"]) {
            expect(sql, condition).toContain(condition);
        }
    });

    it('the message route checks a new thread recipient with the same rule', () => {
        const src = read('app/api/employer/messages/route.ts');
        expect(src).toMatch(/import \{[^}]*\bisInTalentPool\b[^}]*\} from '@\/lib\/candidate-pool'/);
        expect(src).toContain('isInTalentPool(recipient)');
        expect(src).not.toMatch(/recipient\.role === 'job_seeker'/);
    });
});

describe('candidate alert limits', () => {
    it('allow every state, and twice the specialty presets so stored values from older lists still save', () => {
        expect(MAX_ALERT_STATES).toBe(LICENSE_STATE_OPTIONS.length);
        expect(MAX_ALERT_SPECIALTIES).toBe(SPECIALTY_PRESETS.length * 2);
    });

    it('splitAlertList trims, drops empty entries and keeps at most the cap', () => {
        expect(splitAlertList(' CA, ,OR,,TX ', 2)).toEqual(['CA', 'OR']);
        expect(splitAlertList(',,', 5)).toEqual([]);
        expect(splitAlertList(null, 5)).toEqual([]);
        expect(splitAlertList('', 5)).toEqual([]);
    });

    it('joinAlertList stores unique entries, and null for no filter', () => {
        expect(joinAlertList(['CA', 'OR', 'CA'])).toBe('CA,OR');
        expect(joinAlertList([])).toBeNull();
        expect(joinAlertList(undefined)).toBeNull();
    });

    for (const file of ALERT_FILTER_USERS) {
        it(`${file} takes the limits from the shared module`, () => {
            const src = read(file);
            expect(src).toContain("from '@/lib/candidate-alert-filters'");
            expect(src).not.toMatch(/const MAX_ALERT_(SPECIALTIES|STATES)\s*=/);
            expect(src).not.toMatch(/function (split|join)AlertList/);
        });
    }
});
