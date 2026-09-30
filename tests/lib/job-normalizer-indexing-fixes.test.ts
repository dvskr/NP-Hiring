/**
 * Indexing audit fixes at the normalizer (CQ-02, GFJ-04, owner decision on
 * non-US jobs). Each case is a shape that reached production:
 *   - Sol Mental Health published "$30k/yr" (header) and 48000 (JobPosting)
 *     because "CEU budget of $1,500 annually" was read as the salary and
 *     then clamped up, while the posting said "Compensation $140,000 -
 *     $228,400+".
 *   - Televero Health (BambooHR) published a 137-character title plus
 *     metadata stub as a full JobPosting.
 *   - International SOS "CRNA - (Iraq)" rows were published under US cities.
 */
import { describe, it, expect } from 'vitest';
import {
    extractSalary,
    normalizeJobWithReason,
    analyzeDescriptionStub,
    STUB_PROSE_FLOOR,
} from '@/lib/job-normalizer';

const LONG_BODY =
    'We are seeking a psychiatric nurse practitioner to provide medication management and ' +
    'psychiatric evaluations for adults in our outpatient practice. You will collaborate with ' +
    'therapists and a supervising psychiatrist, document visits in our EHR and take part in weekly ' +
    'case reviews. Requirements include an active PMHNP license, board certification and two years ' +
    'of experience. The schedule is Monday to Friday with no call.';

const SOL_DESCRIPTION =
    'Sol Mental Health is hiring a Licensed Psychiatric Nurse Practitioner (PMHNP) in D.C.\n' +
    `${LONG_BODY}\n` +
    'Benefits: medical, dental and vision coverage, 401k with match, and a CEU budget of $1,500 annually.\n' +
    'Compensation $140,000 - $228,400+ depending on experience.';

function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        title: 'Psychiatric Clinician',
        company: 'Sol Mental Health',
        location: '1730 Rhode Island Ave NW, Washington, DC, 20036',
        description: SOL_DESCRIPTION,
        applyLink: 'https://jobs.example.com/sol/123',
        externalId: 'sol-123',
        ...overrides,
    };
}

describe('extractSalary: pay comes from the stated range, not a benefit figure', () => {
    it('skips the CEU budget and reads the compensation line', () => {
        expect(extractSalary(SOL_DESCRIPTION)).toMatchObject({ min: 140000, max: 228400, period: 'year', stated: true });
    });

    it.each([
        ['Annual CME allowance of $2,500 per year. Salary: $130,000 per year.', 130000],
        ['Relocation stipend $5,000 annually; base salary $118,000 annually.', 118000],
        ['401k match up to 4%, $55/hr for all visits.', 55],
    ])('%s → min %s', (text, min) => {
        expect(extractSalary(text).min).toBe(min);
    });

    it('returns nothing when the only amounts are benefits', () => {
        expect(extractSalary('We offer a CEU budget of $1,500 annually and a $5,000 sign-on bonus.').min).toBeNull();
    });

    // A benefit in the NEXT clause or sentence says nothing about the amount
    // before it. The first cut of the benefit check read a fixed 15 chars
    // after every amount and dropped all six of these employer figures.
    it.each([
        ['Salary range: $120,000 to $150,000 per year. 401k match.', { min: 120000, max: 150000, period: 'year' }],
        ['Earn up to $250k annually plus bonus', { min: null, max: 250000, period: 'year' }],
        ['$120,000 - $150,000 per year plus bonus', { min: 120000, max: 150000, period: 'year' }],
        ['$60 - $75 per hour + CME', { min: 60, max: 75, period: 'hour' }],
        [
            'Pay range $100,900.80 - $312,000.00 annually. CME budget $3,000 per year.',
            { min: 100900.8, max: 312000, period: 'year' },
        ],
        ['Compensation: $65/hr. PTO and 401(k).', { min: 65, max: null, period: 'hour' }],
    ])('keeps the employer figure when a benefit follows in its own clause: %s', (text, expected) => {
        expect(extractSalary(text)).toMatchObject({ ...expected, stated: true });
    });

    it.each([
        '$5,000 sign-on bonus',
        'up to $10,000 in relocation assistance',
        'We offer a $3,000 CME allowance and a $2,500 annual CEU budget.',
        'Eligible for $40,000 per year in loan repayment.',
    ])('still reads an amount named as a benefit as no salary: %s', (text) => {
        expect(extractSalary(text)).toMatchObject({ min: null, max: null });
    });

    it('marks a magnitude-only range as not stated', () => {
        expect(extractSalary('Pay range $120,000 - $150,000 for this role').stated).toBe(true);
        expect(extractSalary('Offering $120,000 - $150,000 for this role').stated).toBe(false);
    });

    // The pay-transparency label with a colon. The old prefix allowed only
    // one of "range", "of", "is" or ":", so "range:" fell through to the
    // unlabelled branch and these read as not stated.
    it.each([
        ['Pay Range: $107,785.60 - $312,000.00', { min: 107785.6, max: 312000, period: 'year' }],
        ['Salary Range: $120,000 - $140,000', { min: 120000, max: 140000, period: 'year' }],
        ['Compensation Range: $50 - $70', { min: 50, max: 70, period: 'hour' }],
        ['Base pay range: $130,000 to $150,000', { min: 130000, max: 150000, period: 'year' }],
        ['Salary is: $125,000 - $145,000', { min: 125000, max: 145000, period: 'year' }],
        ['Wages: $55 - $65', { min: 55, max: 65, period: 'hour' }],
    ])('reads "%s" as a stated range', (text, expected) => {
        expect(extractSalary(text)).toMatchObject({ ...expected, stated: true });
    });

    it('does not read a pay label inside another word', () => {
        expect(extractSalary('Prepay $120,000 - $150,000 for this role').stated).toBe(false);
    });
});

describe('normalizeJobWithReason: a labelled range beats a conflicting structured value', () => {
    it('takes the Sentara "Pay Range:" figure over a predicted structured salary', () => {
        const result = normalizeJobWithReason(
            raw({
                location: 'Virginia Beach, VA',
                description: `${LONG_BODY}\nPay Range: $107,785.60 - $312,000.00`,
                minSalary: 48000,
                maxSalary: 60000,
                salaryPeriod: 'annual',
            }),
            'adzuna',
        );
        const job = result.job!;
        // Whole dollars: jobs.min_salary is an integer column.
        expect(job.minSalary).toBe(107786);
        expect(job.maxSalary).toBe(312000);
        expect(job.salaryIsEstimated).toBe(true);
    });
});

describe('normalizeJobWithReason: Sol Mental Health row', () => {
    it('stores the stated range and the real District location', () => {
        const result = normalizeJobWithReason(raw(), 'greenhouse');
        expect(result.job).not.toBeNull();
        const job = result.job!;
        expect(job.minSalary).toBe(140000);
        expect(job.maxSalary).toBe(228400);
        expect(job.normalizedMinSalary).toBe(140000);
        expect(job.city).toBe('Washington');
        expect(job.stateCode).toBe('DC');
    });

    it('replaces an implausible structured value with the stated range', () => {
        const result = normalizeJobWithReason(raw({ minSalary: 1500, maxSalary: 1500, salaryPeriod: 'annual' }), 'adzuna');
        expect(result.job!.minSalary).toBe(140000);
        expect(result.job!.maxSalary).toBe(228400);
    });

    it('prefers the stated range over a conflicting structured value, flagged approximate', () => {
        const result = normalizeJobWithReason(raw({ minSalary: 48000, maxSalary: 48000, salaryPeriod: 'annual' }), 'adzuna');
        const job = result.job!;
        expect(job.minSalary).toBe(140000);
        expect(job.salaryIsEstimated).toBe(true);
        expect(job.salaryConfidence ?? 1).toBeLessThan(0.8);
    });

    it('keeps an agreeing structured value at full confidence', () => {
        const result = normalizeJobWithReason(raw({ minSalary: 140000, maxSalary: 228400, salaryPeriod: 'annual' }), 'adzuna');
        expect(result.job!.salaryIsEstimated).toBe(false);
        expect(result.job!.normalizedMaxSalary).toBe(228400);
    });
});

describe('stub descriptions (GFJ-04)', () => {
    const TELEVERO_STUB =
        'PMHNP, Remote TX Part Time, Up to 90 an Hour\nEmployer: Televero Health\nDepartment: Clinical\n' +
        'Employment: Part-Time\nLocation: United States';

    it('flags the Televero title-plus-metadata stub', () => {
        const a = analyzeDescriptionStub(TELEVERO_STUB, 'PMHNP, Remote TX Part Time, Up to 90 an Hour');
        expect(a).toMatchObject({ isStub: true, proseLength: 0, titleLines: 1, metadataLines: 4 });
    });

    it('rejects it at ingest with normalizer_stub_description', () => {
        const result = normalizeJobWithReason(
            {
                title: 'PMHNP, Remote TX Part Time, Up to 90 an Hour',
                employer: 'Televero Health',
                location: 'United States',
                description: TELEVERO_STUB,
                applyLink: 'https://televerohealth.bamboohr.com/careers/63',
                externalId: 'bamboohr-televerohealth-63',
            },
            'bamboohr',
        );
        expect(result.job).toBeNull();
        expect(result.rejectionReason).toBe('normalizer_stub_description');
    });

    it('accepts the same header when a real description follows it', () => {
        const a = analyzeDescriptionStub(`${TELEVERO_STUB}\n\n${LONG_BODY}`, 'PMHNP, Remote TX Part Time, Up to 90 an Hour');
        expect(a.isStub).toBe(false);
        expect(a.proseLength).toBeGreaterThanOrEqual(STUB_PROSE_FLOOR);
    });

    it('accepts a short plain paragraph that is a real description', () => {
        const a = analyzeDescriptionStub(
            'We are seeking a Psychiatric Nurse Practitioner to join our outpatient clinic full time.',
            'Psychiatric Nurse Practitioner',
        );
        expect(a.isStub).toBe(false);
    });

    it('rejects a description that only repeats the title', () => {
        expect(analyzeDescriptionStub('Family Nurse Practitioner\nFamily Nurse Practitioner', 'Family Nurse Practitioner').isStub).toBe(true);
    });
});

describe('non-US work sites are excluded at ingest (owner decision)', () => {
    it('rejects the International SOS Iraq rows', () => {
        const result = normalizeJobWithReason(
            {
                title: 'Certified Registered Nurse Anesthetist - (Iraq)',
                company: 'International SOS',
                location: 'Philadelphia, PA',
                description: `${LONG_BODY}\nMust be able to relocate to Iraq for the duration of the project.`,
                applyLink: 'https://jobs.smartrecruiters.com/InternationalSOS/123',
                externalId: 'smartrecruiters-internationalsos-123',
            },
            'smartrecruiters',
        );
        expect(result.job).toBeNull();
        expect(result.rejectionReason).toBe('normalizer_non_us_location');
    });

    it('rejects on an ATS country field', () => {
        const result = normalizeJobWithReason(raw({ location: 'Toronto', country: 'ca', description: LONG_BODY }), 'smartrecruiters');
        expect(result.rejectionReason).toBe('normalizer_non_us_location');
    });

    it('keeps US jobs, including towns named like countries', () => {
        const result = normalizeJobWithReason(raw({ location: 'Lebanon, PA', description: LONG_BODY, country: 'us' }), 'smartrecruiters');
        expect(result.job).not.toBeNull();
        expect(result.job!.country).toBe('US');
    });

    // US postings whose work-site sentence names a place or facility that
    // starts with a country name. Each was dropped at ingest by the first cut.
    it.each([
        ['Panama City, FL', 'This position is located in Panama City, FL.'],
        ['Fort Knox, KY', 'Work location: Ireland Army Health Clinic, Fort Knox, Kentucky'],
        ['Jamaica, NY', 'The position is located at Jamaica Hospital Medical Center in Queens.'],
    ])('keeps the US posting at %s', (location, sentence) => {
        const result = normalizeJobWithReason(
            raw({ location, description: `${LONG_BODY}\n${sentence}`, country: undefined }),
            'greenhouse',
        );
        expect(result.rejectionReason).not.toBe('normalizer_non_us_location');
        expect(result.job).not.toBeNull();
    });

    // A US posting about veterans. The first cut of the work-site phrase
    // read "deployed to Iraq" as the hire's work site and rejected it.
    it.each([
        'Serve veterans who deployed to Iraq and Afghanistan.',
        'Prior deployment in Kuwait preferred.',
        'We support military families stationed in Germany.',
        'Candidates must reside in Canada or the United States.',
    ])('keeps the Tampa, FL posting that says: %s', (sentence) => {
        const result = normalizeJobWithReason(
            raw({
                title: 'Psychiatric Mental Health Nurse Practitioner',
                location: 'Tampa, FL',
                description: `${LONG_BODY}\n${sentence}`,
                country: undefined,
            }),
            'greenhouse',
        );
        expect(result.rejectionReason).not.toBe('normalizer_non_us_location');
        expect(result.job).not.toBeNull();
        expect(result.job!.stateCode).toBe('FL');
    });

    it('keeps them even when the location field is empty', () => {
        const result = normalizeJobWithReason(
            raw({ location: '', description: `${LONG_BODY}\nThis position is located in Panama City, FL.` }),
            'greenhouse',
        );
        expect(result.rejectionReason).not.toBe('normalizer_non_us_location');
    });

    // Owner decision 2026-09-29: a posting that includes the United States
    // among its locations is a US job. The review reproduced each of these
    // as a normalizer_non_us_location rejection.
    it.each([
        { location: 'United States, Canada' },
        { location: 'Canada, United States' },
        { location: 'US, Canada' },
        { location: 'Remote (US, Canada)' },
        { title: 'Psychiatric NP - US, Canada', location: 'Canada' },
        { title: 'Psychiatric NP - Remote (US, Canada)', location: 'Remote' },
        { location: 'United States, Canada', country: 'ca' },
        // Review round 4: "US Remote" is a common Greenhouse and Lever office label.
        { location: 'US Remote, Canada Remote' },
    ])('keeps a posting that lists the United States: %o', (over) => {
        const result = normalizeJobWithReason(
            raw({ title: 'Psychiatric Clinician', description: LONG_BODY, country: undefined, ...over }),
            'greenhouse',
        );
        expect(result.rejectionReason).toBeUndefined();
        expect(result.job!.country).toBe('US');
    });

    it.each([
        { location: 'Remote - Canada' },
        { location: 'Toronto, ON' },
        { location: 'Baghdad, Iraq' },
        { title: 'CRNA - (Iraq)', location: 'Remote' },
        // Review round 3: kept before, two of them under a false California.
        { location: 'Remote (Canada)' },
        { location: 'Toronto, ON, CA' },
        { location: 'Toronto, Ontario, CA' },
        { location: 'Vancouver, BC, CA' },
        { location: 'CA-ON-Toronto' },
    ])('still rejects a posting with no US place: %o', (over) => {
        const result = normalizeJobWithReason(
            raw({ description: LONG_BODY, country: undefined, ...over }),
            'greenhouse',
        );
        expect(result.rejectionReason).toBe('normalizer_non_us_location');
    });

    it.each([
        ['Remote (US, Canada)', null, null],
        ['United States, Canada', null, null],
        ['Ontario, CA', 'Ontario', 'CA'],
        ['Dublin, CA', 'Dublin', 'CA'],
        ['Hybrid (Ontario)', null, null],
    ])('keeps %s as a US job (%s, %s)', (location, city, stateCode) => {
        const result = normalizeJobWithReason(
            raw({ location, description: LONG_BODY, country: undefined }),
            'greenhouse',
        );
        expect(result.rejectionReason).toBeUndefined();
        expect(result.job).toMatchObject({ country: 'US', city, stateCode });
    });
});

/**
 * Review round 3: a region of a state was stored as the town and reached
 * JobPosting addressLocality ("Northern Virginia" stored the town
 * "Northern", "Metro Detroit, MI" stored "Metro Detroit", a "Location: Near
 * Denver, CO" line stored "Near Denver"). The state is kept, the town is not.
 */
describe('a region of a state is never stored as the town', () => {
    it.each([
        ['Northern Virginia', 'VA'],
        ['South Florida', 'FL'],
        ['Central Texas', 'TX'],
        ['Upstate New York', 'NY'],
        ['West Michigan', 'MI'],
        ['Southern California', 'CA'],
        ['Metro Detroit, MI', 'MI'],
        ['Northern Virginia, VA', 'VA'],
        ['Twin Cities, MN', 'MN'],
        ['Near Denver, CO', 'CO'],
    ])('location %s → no city, %s', (location, stateCode) => {
        const result = normalizeJobWithReason(
            raw({ location, description: LONG_BODY, country: undefined }),
            'greenhouse',
        );
        expect(result.job).toMatchObject({ city: null, stateCode });
    });

    it.each([
        ['Location: Near Denver, CO', 'CO'],
        ['Location: Our Denver, CO clinic', 'CO'],
        ['Location: West Texas', 'TX'],
        ['Location: Metro Detroit, MI', 'MI'],
    ])('a labelled description line "%s" keeps the state %s and no town', (line, stateCode) => {
        const result = normalizeJobWithReason(
            raw({ location: 'United States', description: `${line}\n\n${LONG_BODY}`, country: undefined }),
            'greenhouse',
        );
        expect(result.job).toMatchObject({ city: null, stateCode });
    });

    // Review round 4: a qualifier, a placeholder, a work arrangement or a
    // region suffix was stored as the town ("Within", "Unknown",
    // "Field-Based", "Houston Metro").
    it.each([
        'Within Texas',
        'Remote - Within Texas',
        'Unknown, TX',
        'Houston Metro, TX',
        'Field-Based, TX',
    ])('location %s → no city, TX', (location) => {
        const result = normalizeJobWithReason(
            raw({ location, description: LONG_BODY, country: undefined }),
            'greenhouse',
        );
        expect(result.job).toMatchObject({ city: null, stateCode: 'TX' });
    });

    it('a labelled line "Location: Field Based, TX" keeps Texas and no town', () => {
        const result = normalizeJobWithReason(
            raw({ location: 'United States', description: `Location: Field Based, TX\n\n${LONG_BODY}`, country: undefined }),
            'greenhouse',
        );
        expect(result.job).toMatchObject({ city: null, stateCode: 'TX' });
    });

    it('a real town is still stored: Central, LA, West New York, NJ and North Las Vegas, NV', () => {
        for (const [location, city, stateCode] of [
            ['Central, LA', 'Central', 'LA'],
            ['West New York, NJ', 'West New York', 'NJ'],
            ['North Las Vegas, NV', 'North Las Vegas', 'NV'],
            ['Upper Arlington, OH', 'Upper Arlington', 'OH'],
        ]) {
            const result = normalizeJobWithReason(
                raw({ location, description: LONG_BODY, country: undefined }),
                'greenhouse',
            );
            expect(result.job).toMatchObject({ city, stateCode });
        }
    });
});

/**
 * Review round 6: a street name, a bare site, district or custody word or a
 * facility code was stored as the town ("Location: Main St, CO" stored "Main
 * St", "Oak Ave, TX" stored "Oak Ave", "Location: Corporate, TX" stored
 * "Corporate"; Clover Health's "Field - New Jersey" and the Mental Health
 * Cooperative's "MHC Nashville, TN" reached the page title). The state is
 * kept; a district or a coded site of a known town is filed under the town.
 */
describe('a street, a site word or a facility code is never stored as the town', () => {
    const ingest = (over: Record<string, unknown>) =>
        normalizeJobWithReason(raw({ description: LONG_BODY, country: undefined, ...over }), 'greenhouse').job;

    it.each([
        ['Location: Main St, CO', 'CO'],
        ['Location: Main Street, CO', 'CO'],
        ['Location: N Main St, CO', 'CO'],
        ['Location: Oak Avenue, TX', 'TX'],
        ['Location: Field, TX', 'TX'],
        ['Location: Corporate, TX', 'TX'],
        ['Location: Main, TX', 'TX'],
        ['Location: Downtown, TX', 'TX'],
        ['Location: Uptown, TX', 'TX'],
        ['Location: Midtown, GA', 'GA'],
        ['Location: Westside, TX', 'TX'],
        ['Location: County Jail, TX', 'TX'],
        ['Location: Prison, TX', 'TX'],
        ['Location: Field - New Jersey', 'NJ'],
        ['Location: AH TAMPA PEPIN HEART INSTITUTE, FL', 'FL'],
    ])('a labelled description line "%s" keeps %s and no town', (line, stateCode) => {
        const job = ingest({ location: 'United States', description: `${line}\n\n${LONG_BODY}` });
        expect(job).toMatchObject({ city: null, stateCode });
    });

    it.each([
        ['Main Street, CO', 'CO'],
        ['Oak Ave, TX', 'TX'],
        ['N Main St, CO', 'CO'],
        ['Field - New Jersey', 'NJ'],
        ['Field - Georgia', 'GA'],
        ['Field, TX', 'TX'],
        ['Corporate, TX', 'TX'],
        ['Downtown, TX', 'TX'],
        ['County Jail, TX', 'TX'],
    ])('location %s → no city, %s', (location, stateCode) => {
        expect(ingest({ location })).toMatchObject({ city: null, stateCode });
    });

    it('a district or a coded site of a known town is stored as the town', () => {
        expect(ingest({ location: 'MHC Nashville, TN' })).toMatchObject({ city: 'Nashville', stateCode: 'TN' });
        expect(ingest({ location: 'MHC Cookeville, TN' })).toMatchObject({ city: 'Cookeville', stateCode: 'TN' });
        expect(ingest({ location: 'Downtown Atlanta, GA' })).toMatchObject({ city: 'Atlanta', stateCode: 'GA' });
        expect(ingest({ location: 'United States', description: `Location: MHC Nashville, TN\n\n${LONG_BODY}` }))
            .toMatchObject({ city: 'Nashville', stateCode: 'TN', location: 'Nashville, TN' });
    });

    it('a street before the town still gives the town, and real towns keep their names', () => {
        expect(ingest({ location: 'Main St, Denver, CO' })).toMatchObject({ city: 'Denver', stateCode: 'CO' });
        expect(ingest({ location: "Crittenton Children's Center   |   Elm Ave   |   Kansas City   |   MO" }))
            .toMatchObject({ city: 'Kansas City', stateCode: 'MO' });
        for (const [location, city, stateCode] of [
            ['Home, PA', 'Home', 'PA'],
            ['Mobile, AL', 'Mobile', 'AL'],
            ['Federal Way, WA', 'Federal Way', 'WA'],
            ['Indian Trail, NC', 'Indian Trail', 'NC'],
            ['Box Elder, SD', 'Box Elder', 'SD'],
        ]) {
            expect(ingest({ location }), location).toMatchObject({ city, stateCode });
        }
        expect(ingest({ location: 'United States', description: `Location: Home, PA\n\n${LONG_BODY}` }))
            .toMatchObject({ city: 'Home', stateCode: 'PA' });
    });
});

describe('job type reads the title first', () => {
    it('a "Full Time" title beats a "per diem" mention in the body', () => {
        const result = normalizeJobWithReason(
            raw({
                title: 'Nurse Practitioner Behavioral Health - Full Time',
                description: `${LONG_BODY}\nPer diem shifts are also available at our other sites.`,
                location: 'Wauwatosa, WI',
            }),
            'workday',
        );
        expect(result.job!.jobType).toBe('Full-Time');
    });
});
