/**
 * Renewal and contentChangedAt (indexing audit fixSoon 5 and 6).
 *
 * A renewal that finds the posting unchanged must not move
 * contentChangedAt; a real enrichment or a revival must. Renewal also heals
 * two stored defects: a location text that names no place ("2 Locations")
 * and work-mode flags that contradict the stored mode.
 */
import { describe, it, expect } from 'vitest';
import { buildRenewalEnrichmentDelta, shouldStampContentChange } from '@/lib/ingestion-service';

const base = {
    description: 'x'.repeat(400),
    descriptionSummary: null,
    minSalary: null,
    maxSalary: null,
    salaryPeriod: null,
    salaryRange: null,
    displaySalary: null,
    normalizedMinSalary: null,
    normalizedMaxSalary: null,
    city: 'Denver',
    state: 'Colorado',
    stateCode: 'CO',
    jobType: 'Full-Time',
    mode: 'In-Person',
    experienceLevel: null,
    setting: 'Outpatient',
    population: 'Adults',
    benefits: [] as string[],
    location: 'Denver, CO',
    isRemote: false,
    isHybrid: false,
};

describe('shouldStampContentChange', () => {
    it('does not stamp a plain "still listed" renewal', () => {
        const delta = buildRenewalEnrichmentDelta(base, {
            description: 'x'.repeat(400),
            location: 'Denver, CO',
            mode: 'In-Person',
            isRemote: false,
            isHybrid: false,
        });
        expect(delta).toEqual({});
        expect(shouldStampContentChange(delta, true)).toBe(false);
    });

    it('stamps when the renewal fills or replaces a rendered field', () => {
        const delta = buildRenewalEnrichmentDelta(base, { minSalary: 120000, maxSalary: 150000, salaryPeriod: 'annual' });
        expect(delta).toMatchObject({ minSalary: 120000, maxSalary: 150000 });
        expect(shouldStampContentChange(delta, true)).toBe(true);
    });

    it('stamps a revival of an unpublished row even with an empty delta', () => {
        expect(shouldStampContentChange({}, false)).toBe(true);
    });
});

describe('buildRenewalEnrichmentDelta: location text that names no place', () => {
    const vague = { ...base, location: '2 Locations', city: null, state: null, stateCode: null };

    it('replaces "2 Locations" with the fresh primary location and fills city/state', () => {
        const delta = buildRenewalEnrichmentDelta(vague, {
            location: 'Denver, CO',
            city: 'Denver',
            state: 'Colorado',
            stateCode: 'CO',
        });
        expect(delta).toMatchObject({ location: 'Denver, CO', city: 'Denver', state: 'Colorado', stateCode: 'CO' });
    });

    it('never overwrites a location that already names a place', () => {
        const delta = buildRenewalEnrichmentDelta(base, { location: 'Aurora, CO' });
        expect(delta.location).toBeUndefined();
    });

    it('keeps a vague text when the fresh one is vague too', () => {
        const delta = buildRenewalEnrichmentDelta(vague, { location: 'United States' });
        expect(delta.location).toBeUndefined();
    });
});

describe('buildRenewalEnrichmentDelta: work-mode flags follow the mode', () => {
    it('clears a stale isRemote on an In-Person row (TELECOMMUTE on an on-site job)', () => {
        const delta = buildRenewalEnrichmentDelta({ ...base, isRemote: true }, {});
        expect(delta).toMatchObject({ isRemote: false, isHybrid: false });
    });

    it('resolves both flags set on a Hybrid row to hybrid only', () => {
        const delta = buildRenewalEnrichmentDelta({ ...base, mode: 'Hybrid', isRemote: true, isHybrid: true }, {});
        expect(delta).toMatchObject({ isRemote: false, isHybrid: true });
    });

    it('with no mode, both flags set resolves to hybrid (never TELECOMMUTE)', () => {
        const delta = buildRenewalEnrichmentDelta({ ...base, mode: null, isRemote: true, isHybrid: true }, {});
        expect(delta).toMatchObject({ isRemote: false, isHybrid: true });
    });

    it('a mode filled on renewal brings its flags with it', () => {
        const delta = buildRenewalEnrichmentDelta({ ...base, mode: null }, { mode: 'Remote' });
        expect(delta).toMatchObject({ mode: 'Remote', isRemote: true, isHybrid: false });
    });

    it('leaves consistent flags alone', () => {
        expect(buildRenewalEnrichmentDelta({ ...base, mode: 'Remote', isRemote: true }, {})).toEqual({});
    });

    it('callers that do not pass the flags keep the old behaviour', () => {
        const legacy = Object.fromEntries(
            Object.entries(base).filter(([k]) => !['isRemote', 'isHybrid', 'location'].includes(k)),
        ) as Omit<typeof base, 'isRemote' | 'isHybrid' | 'location'>;
        expect(buildRenewalEnrichmentDelta(legacy, {})).toEqual({});
    });
});
