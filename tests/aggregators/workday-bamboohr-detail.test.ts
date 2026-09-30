/**
 * Adapter fixes from the indexing audit:
 *   - Workday rows stored "2 Locations" / "United States" as their location,
 *     so 12 DaVita and other rows had no city or state and no JobPosting
 *     jobLocation (CS-03 / fixSoon 6).
 *   - BambooHR rows published a title-plus-metadata stub as the description
 *     (GFJ-04: Televero Health, 137 characters).
 */
import { describe, it, expect } from 'vitest';
import {
    parseWorkdayDetail,
    resolveWorkdayLocation,
    isVagueWorkdayLocation,
} from '@/lib/aggregators/workday';
import {
    parseCompensationText,
    buildBambooHrLocation,
    buildBambooHrRawJob,
    parseBambooHrDetail,
    bambooHrCountry,
} from '@/lib/aggregators/bamboohr';
import { analyzeDescriptionStub } from '@/lib/job-normalizer';

describe('Workday detail locations', () => {
    const detail = parseWorkdayDetail({
        jobPostingInfo: {
            jobDescription: '<p>Full description</p>',
            startDate: '2026-09-20',
            location: 'Denver, CO',
            additionalLocations: ['Aurora, CO', ' ', 7],
            country: { descriptor: 'United States of America', id: 'abc' },
            jobRequisitionLocation: { descriptor: 'Denver, CO', country: { alpha2Code: 'US', descriptor: 'United States of America' } },
        },
    });

    it('reads the primary location, the other sites and the country', () => {
        expect(detail).toMatchObject({
            description: '<p>Full description</p>',
            primaryLocation: 'Denver, CO',
            additionalLocations: ['Aurora, CO'],
            country: 'US',
        });
        expect(detail.realPostedDate?.startsWith('2026-09-20')).toBe(true);
    });

    it.each(['2 Locations', '12 Locations', 'Multiple Locations', 'United States', 'United States of America', ''])(
        '"%s" names no place',
        (text) => expect(isVagueWorkdayLocation(text)).toBe(true),
    );

    it('files a "2 Locations" hit under the detail endpoint primary location, then its other sites', () => {
        // CS-03: the further sites are joined after the primary one, so the
        // job page emits one jobLocation Place per site.
        expect(resolveWorkdayLocation('2 Locations', detail)).toBe('Denver, CO; Aurora, CO');
        expect(resolveWorkdayLocation('United States', detail)).toBe('Denver, CO; Aurora, CO');
        expect(resolveWorkdayLocation('2 Locations', { primaryLocation: 'Denver, CO' })).toBe('Denver, CO');
    });

    it('keeps a search hit that already names a place', () => {
        expect(resolveWorkdayLocation('Grand Rapids, MI', { primaryLocation: 'Denver, CO' })).toBe('Grand Rapids, MI');
        expect(resolveWorkdayLocation('Grand Rapids, MI', detail)).toBe('Grand Rapids, MI; Aurora, CO');
    });

    it('joins only further sites that name a US place, once each', () => {
        expect(resolveWorkdayLocation('2 Locations', {
            primaryLocation: 'Denver, CO',
            additionalLocations: ['Denver, CO', 'Aurora, CO', 'Main Campus', '2 Locations', 'Aurora, CO', 'Toronto, Ontario, Canada'],
        })).toBe('Denver, CO; Aurora, CO');
    });

    it('stays honest when the detail endpoint has nothing either', () => {
        expect(resolveWorkdayLocation('2 Locations', { primaryLocation: undefined })).toBe('2 Locations');
        expect(resolveWorkdayLocation('', {})).toBe('United States');
    });

    it('tolerates an empty or malformed detail response', () => {
        expect(parseWorkdayDetail(null)).toMatchObject({ description: '', additionalLocations: [] });
        expect(parseWorkdayDetail({ jobPostingInfo: { location: 42 } }).primaryLocation).toBeUndefined();
    });
});

describe('BambooHR compensation', () => {
    it.each([
        ['85 to 90 an hour', { minSalary: 85, maxSalary: 90, salaryPeriod: 'hour' }],
        ['$120,000 - $140,000 annually', { minSalary: 120000, maxSalary: 140000, salaryPeriod: 'year' }],
        ['Up to $95/hr', { minSalary: null, maxSalary: 95, salaryPeriod: 'hour' }],
        ['$130k salary', { minSalary: 130000, maxSalary: null, salaryPeriod: 'year' }],
        ['Competitive', { minSalary: null, maxSalary: null, salaryPeriod: null }],
        [null, { minSalary: null, maxSalary: null, salaryPeriod: null }],
    ])('%s', (text, expected) => {
        expect(parseCompensationText(text)).toEqual(expected);
    });
});

describe('BambooHR location', () => {
    it('reads atsLocation, which the old adapter ignored (Televero: Dallas, Texas)', () => {
        expect(buildBambooHrLocation({ id: '63', jobOpeningName: 'PMHNP' }, { atsLocation: { city: 'Dallas', state: 'Texas' } }))
            .toBe('Dallas, Texas');
    });

    it('marks locationType 1 as remote, keeping the state', () => {
        expect(buildBambooHrLocation({ id: '63', jobOpeningName: 'PMHNP' }, { locationType: '1', atsLocation: { city: 'Dallas', state: 'Texas' } }))
            .toBe('Remote - Texas');
    });

    it('marks locationType 2 as hybrid', () => {
        expect(buildBambooHrLocation({ id: '1', jobOpeningName: 'PMHNP', locationType: 2, location: { city: 'Tulsa', state: 'OK' } }))
            .toBe('Hybrid - Tulsa, OK');
    });

    it('reads the country for the non-US gate', () => {
        expect(bambooHrCountry({ id: '1', jobOpeningName: 'x' }, { atsLocation: { country: 'Canada' } })).toBe('Canada');
    });
});

describe('BambooHR raw job', () => {
    const tenant = { slug: 'televerohealth', name: 'Televero Health' };
    const listJob = {
        id: '63',
        jobOpeningName: 'PMHNP, Remote TX Part Time, Up to 90 an Hour',
        departmentLabel: 'Clinical',
        employmentStatusLabel: 'Part-Time',
    };
    const description =
        '<p>Televero Health is hiring a part-time psychiatric nurse practitioner to provide telepsychiatry ' +
        'evaluations and medication management for patients across Texas. You will work 20 hours a week, ' +
        'document in our EHR and meet weekly with the medical director.</p><ul><li>Active PMHNP License in Texas</li>' +
        '<li>Board certification</li><li>Two years of psychiatric experience</li></ul>';

    it('builds the job from the detail description, pay and location, never the metadata stub', () => {
        const detail = parseBambooHrDetail({
            result: {
                jobOpening: {
                    description,
                    compensation: '85 to 90 an hour',
                    locationType: '1',
                    atsLocation: { city: 'Dallas', state: 'Texas', country: 'United States' },
                },
            },
        });
        const job = buildBambooHrRawJob(tenant, listJob, detail);
        expect(job).not.toBeNull();
        expect(job).toMatchObject({
            externalId: 'bamboohr-televerohealth-63',
            location: 'Remote - Texas',
            minSalary: 85,
            maxSalary: 90,
            salaryPeriod: 'hour',
            country: 'United States',
            jobType: 'Part-Time',
        });
        expect(String(job!.description)).not.toContain('Employer: Televero Health');
        expect(analyzeDescriptionStub(String(job!.description), listJob.jobOpeningName).isStub).toBe(false);
    });

    it('skips an opening whose detail could not be read', () => {
        expect(buildBambooHrRawJob(tenant, listJob, null)).toBeNull();
        expect(buildBambooHrRawJob(tenant, listJob, { description: '   ' })).toBeNull();
    });

    it('reads both detail envelopes', () => {
        expect(parseBambooHrDetail({ jobOpening: { description: 'x' } })).toEqual({ description: 'x' });
        expect(parseBambooHrDetail({ result: {} })).toBeNull();
        expect(parseBambooHrDetail('nope')).toBeNull();
    });
});
