/**
 * Workday search terms and title pre-screen (lib/aggregators/search-terms/
 * workday.ts).
 *
 * The board lists every NP specialty plus CRNA, CNM and CNS, but until
 * 2026-11-12 the Workday adapter searched with the six psychiatric terms it
 * inherited and pre-screened titles on psychiatric words, so about 3,400
 * open NP/APRN postings at tenants already on the list were never fetched.
 * These tests pin the role terms and the pre-screen that replaced them.
 */
import { describe, it, expect } from 'vitest';
import {
    WORKDAY_SEARCH_TERMS,
    passesWorkdayTitlePrefilter,
} from '@/lib/aggregators/search-terms/workday';
import { classifyRelevance } from '@/lib/utils/job-filter';

describe('WORKDAY_SEARCH_TERMS', () => {
    it('searches for every role the board lists, not only psychiatric ones', () => {
        for (const term of [
            'Nurse Practitioner',
            'APRN',
            'Advanced Practice Provider',
            'Nurse Anesthetist',
            'Nurse Midwife',
            'Clinical Nurse Specialist',
        ]) {
            expect(WORKDAY_SEARCH_TERMS).toContain(term);
        }
    });

    it('keeps the psychiatric terms', () => {
        expect(WORKDAY_SEARCH_TERMS).toContain('PMHNP');
        expect(WORKDAY_SEARCH_TERMS).toContain('Psychiatric Nurse Practitioner');
    });

    it('has no duplicate term', () => {
        expect(new Set(WORKDAY_SEARCH_TERMS).size).toBe(WORKDAY_SEARCH_TERMS.length);
    });
});

describe('passesWorkdayTitlePrefilter', () => {
    const fetched = [
        'Nurse Practitioner - Cardiology',
        'Family Nurse Practitioner',
        'APRN Cardiology',
        'ARNP - Urgent Care',
        'CRNA',
        'Certified Registered Nurse Anesthetist, Full-time, Days',
        'Certified Nurse Midwife',
        'CNM - Labor and Delivery',
        'Clinical Nurse Specialist - Oncology',
        'Advanced Practice Provider - Neurosurgery',
        'Advanced Practice Registered Nurse (APRN)- Psychiatry Department',
        'APP - Hospital Medicine',
        'Hospitalist NP/PA',
        'Acute Care NP',
        'Neonatal NNP',
        'PMHNP',
        'Psychiatric Mental Health Provider',
    ];
    for (const title of fetched) {
        it(`fetches details for: ${title}`, () => {
            expect(passesWorkdayTitlePrefilter(title)).toBe(true);
        });
    }

    // Abbreviations match on word boundaries only.
    const skipped = [
        'Inpatient Registered Nurse',
        'Application Analyst',
        'Licensed Practical Nurse',
        'Appointment Scheduler',
        'Registered Nurse - ICU',
        'Physician - Family Medicine',
        'Environmental Services Technician',
    ];
    for (const title of skipped) {
        it(`skips the detail fetch for: ${title}`, () => {
            expect(passesWorkdayTitlePrefilter(title)).toBe(false);
        });
    }

    it('is at least as permissive as the relevance gate on NP/APRN titles', () => {
        // A title the central gate accepts on its own must never be dropped
        // here, before the gate sees it.
        const titles = [
            'Nurse Practitioner',
            'Nurse Practitioner/Physician Assistant, Cardiology',
            'Advanced Practice Provider - Neurosurgery',
            'Certified Nurse Midwife',
            'Clinical Nurse Specialist - Oncology',
            'CRNA',
            'APRN Cardiology',
            'Acute Care NP',
            'Family Nurse Practitioner',
        ];
        for (const title of titles) {
            expect(classifyRelevance(title, '', '').passes).toBe(true);
            expect(passesWorkdayTitlePrefilter(title)).toBe(true);
        }
    });
});

describe('single-state tenants give a facility-name location a state', () => {
    it('appends the state to a facility name or a bare city', async () => {
        const { withTenantState } = await import('@/lib/aggregators/workday');
        expect(withTenantState('Anna Jaques Hospital', 'MA')).toBe('Anna Jaques Hospital, MA');
        expect(withTenantState('Oklahoma City', 'OK')).toBe('Oklahoma City, OK');
    });

    it('leaves a location alone when it already names a state, is vague, or the tenant has no state', async () => {
        const { withTenantState } = await import('@/lib/aggregators/workday');
        expect(withTenantState('Tulsa, OK', 'OK')).toBe('Tulsa, OK');
        expect(withTenantState('Kansas City, MO', 'KS')).toBe('Kansas City, MO');
        expect(withTenantState('2 Locations', 'OK')).toBe('2 Locations');
        expect(withTenantState('United States', 'OK')).toBe('United States');
        expect(withTenantState('Avon Hospital', undefined)).toBe('Avon Hospital');
    });

    it('every tenant state is a two-letter code', async () => {
        const { WORKDAY_TENANTS } = await import('@/lib/aggregators/tenants/workday');
        const withState = WORKDAY_TENANTS.filter((t) => t.state !== undefined);
        expect(withState.length).toBeGreaterThan(20);
        for (const t of withState) expect(t.state).toMatch(/^[A-Z]{2}$/);
    });
});
