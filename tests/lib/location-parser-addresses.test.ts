/**
 * Indexing audit CQ-02 / GFJ-09 / fixSoon 6-7: street addresses, "ST - City"
 * requisitions, facility names and non-US work sites.
 *
 * The live failures these pin (all fetched from production on 2026-09-28):
 *   - Sol Mental Health "1730 Rhode Island Ave NW, Washington, DC, 20036"
 *     was filed as city "1730", state RI (JSON-LD addressLocality "1730").
 *   - 15 Sol Mental Health rows kept a full street address as the city
 *     ("5100 Buckeyestown Pike Suite 200 Frederick").
 *   - 13 Thriveworks requisitions ("VA - Norfolk", "VA - Williamsburg", ...)
 *     lost their city, so they looked like duplicates of each other.
 *   - International SOS "CRNA - (Iraq)" rows carried US cities.
 */
import { describe, it, expect } from 'vitest';
import {
    parseLocation,
    detectNonUsWorkSite,
    resolveCountryValue,
    leadingStreetAddress,
    statesNamedIn,
} from '@/lib/location-parser';

function place(input: string) {
    const p = parseLocation(input);
    return { city: p.city, stateCode: p.stateCode };
}

describe('parseLocation: street addresses resolve to the city, never the street', () => {
    it.each([
        ['1730 Rhode Island Ave NW, Washington, DC, 20036', 'Washington', 'DC'],
        ['1730 Rhode Island Ave NW Washington DC 20036', 'Washington', 'DC'],
        ['5100 Buckeyestown Pike Suite 200 Frederick, MD 21704', 'Frederick', 'MD'],
        ['2273 Research Boulevard Suite 520 Rockville, MD 20850', 'Rockville', 'MD'],
        ['8403 Colesville Road Suite 1100 Silver Spring, MD  20910', 'Silver Spring', 'MD'],
        ['6700 Alexander Bell Drive\tSuite 200 Columbia, MD 21046', 'Columbia', 'MD'],
        ['400 East Pratt Street, 8th Floor, Baltimore, Maryland, 212', 'Baltimore', 'MD'],
        ['600 Third Avenue, 2nd Floor, New York, NY, 10016', 'New York', 'NY'],
        ['118-35 Queens Blvd STE 400 Forest Hills, NY 11375', 'Forest Hills', 'NY'],
        ['32 Court Street Suite 1107\tBrooklyn , NY 11201', 'Brooklyn', 'NY'],
        ['888 Veterans Memorial Hwy Suite 200 Hauppauge, NY 11788', 'Hauppauge', 'NY'],
        ['898 N Broadway Suite 100 Massapequa, NY 11758', 'Massapequa', 'NY'],
        ['425 Broadhollow Rd Suite 225\tMelville, NY 11747', 'Melville', 'NY'],
        ['41 Flatbush Ave 2nd Floor, Brooklyn, NY 11217', 'Brooklyn', 'NY'],
        ['1129 Northern Blvd., Suite 404, Manhasset, NY, 11030', 'Manhasset', 'NY'],
        ['2000 16th Street, Denver, Colorado, 80202', 'Denver', 'CO'],
        ["Crittenton Children's Center | Elm Ave | Kansas City | MO", 'Kansas City', 'MO'],
        ['Main Campus - Kansas City, MO', 'Kansas City', 'MO'],
    ])('%s → %s, %s', (input, city, stateCode) => {
        expect(place(input)).toEqual({ city, stateCode });
    });

    it('never takes a state from a street named after one', () => {
        const p = parseLocation('1730 Rhode Island Ave NW, Washington, DC, 20036');
        expect(p.state).toBe('District of Columbia');
        expect(p.stateCode).not.toBe('RI');
    });

    it('keeps a street-only address state-level rather than inventing a city', () => {
        expect(place('1730 Rhode Island Ave NW, DC')).toEqual({ city: null, stateCode: 'DC' });
    });

    it('does not cut place names that merely contain a street word', () => {
        expect(place('Washington Court House, OH')).toEqual({ city: 'Washington Court House', stateCode: 'OH' });
        expect(place('Eagle Pass, TX')).toEqual({ city: 'Eagle Pass', stateCode: 'TX' });
        expect(place('College Station, TX')).toEqual({ city: 'College Station', stateCode: 'TX' });
    });
});

describe('parseLocation: "ST - City" requisitions (Thriveworks)', () => {
    it.each([
        ['VA - Norfolk', 'Norfolk'],
        ['VA - Williamsburg', 'Williamsburg'],
        ['VA - Short Pump', 'Short Pump'],
        ['VA - Alexandria (Franconia)', 'Alexandria'],
        ['VA - Virginia Beach (Great Neck)', 'Virginia Beach'],
        ['VA - Richmond (Markel)', 'Richmond'],
    ])('%s → %s, VA', (input, city) => {
        expect(place(input)).toEqual({ city, stateCode: 'VA' });
    });

    it('a remote "ST - Remote" posting keeps the state and no city', () => {
        const p = parseLocation('NY - Remote');
        expect(p).toMatchObject({ city: null, stateCode: 'NY', isRemote: true });
    });
});

describe('parseLocation: facility names and counts are not cities', () => {
    it.each(['SMG Psychiatric Specialists', '2 Locations', 'Multiple Locations', 'Aurora Psychiatric Hospital'])(
        '%s → no city',
        (input) => {
            expect(parseLocation(input).city).toBeNull();
        },
    );

    it('a facility in front of the state keeps the state only', () => {
        expect(place('SMG Psychiatric Specialists, VA')).toEqual({ city: null, stateCode: 'VA' });
    });
});

describe('parseLocation: country', () => {
    it.each([
        ['Toronto, ON', 'CA'],
        ['Toronto, Ontario, Canada', 'CA'],
        ['Baghdad, Iraq', 'IQ'],
        ['Iraq', 'IQ'],
        ['London, UK', 'GB'],
        ['Remote - Canada', 'CA'],
        ['Beirut, Lebanon', 'LB'],
    ])('%s → %s', (input, country) => {
        const p = parseLocation(input);
        expect(p.country).toBe(country);
        expect(p.stateCode).toBeNull();
    });

    it.each([
        'Lebanon, PA', 'Mexico, MO', 'Ontario, CA', 'Panama City, FL', 'Georgia', 'San Juan, Puerto Rico', 'Mexico',
        // Ontario, California: a bare province name needs a city before it.
        'Ontario', 'Hybrid - Ontario', 'Jamaica',
    ])(
        '%s stays in the United States',
        (input) => {
            expect(parseLocation(input).country).toBe('US');
        },
    );
});

describe('detectNonUsWorkSite', () => {
    it('catches the International SOS Iraq rows despite their US city', () => {
        const hit = detectNonUsWorkSite({
            title: 'Certified Registered Nurse Anesthetist - (Iraq)',
            location: 'Philadelphia, PA',
            description: 'Must be able to relocate to Iraq for the duration of the project.',
        });
        expect(hit).toMatchObject({ country: 'IQ', evidence: 'title' });
    });

    it('reads a work-site phrase in the description', () => {
        expect(
            detectNonUsWorkSite({
                title: 'Certified Registered Nurse Anesthetist',
                location: 'Philadelphia, PA',
                description: 'Candidates must be able to relocate to Iraq for the duration of the project.',
            }),
        ).toMatchObject({ country: 'IQ', evidence: 'description' });
        expect(
            detectNonUsWorkSite({ title: 'NP', description: 'This position is located in Erbil, Iraq.' }),
        ).toMatchObject({ country: 'IQ' });
    });

    it('uses an ATS country field', () => {
        expect(detectNonUsWorkSite({ title: 'NP', atsCountry: 'ca' })).toMatchObject({ country: 'CA', evidence: 'ats_country' });
        expect(detectNonUsWorkSite({ title: 'NP', atsCountry: 'Germany' })).toMatchObject({ country: 'DE' });
        expect(detectNonUsWorkSite({ title: 'NP', atsCountry: ['Canada'] })).toMatchObject({ country: 'CA' });
    });

    it('reads a foreign location string', () => {
        expect(detectNonUsWorkSite({ title: 'Nurse Practitioner', location: 'Toronto, ON' })).toMatchObject({
            country: 'CA',
            evidence: 'location',
        });
    });

    it.each([
        { title: 'Psychiatric Nurse Practitioner - Georgia', location: 'Atlanta, GA' },
        { title: 'Nurse Practitioner', location: 'Lebanon, PA', description: 'Relocate to Lebanon, PA and join our clinic.' },
        { title: 'Nurse Practitioner', location: 'Albuquerque', description: 'Relocation to New Mexico is supported.' },
        { title: 'Family NP - Jordan Valley Medical Center', location: 'West Jordan, UT' },
        { title: 'PMHNP (US & Canada)', location: 'Remote' },
        { title: 'Nurse Practitioner', description: 'Our parent company also runs clinics in Canada and the UK.' },
        { title: 'NP', atsCountry: 'US' },
        { title: 'NP', atsCountry: 'United States of America' },
        { title: 'NP', atsCountry: 'Puerto Rico' },
        { title: 'NP', atsCountry: ['United States', 'Canada'] },
        { title: 'NP', atsCountry: 'Narnia' },
    ])('keeps a US posting in scope: %o', (input) => {
        expect(detectNonUsWorkSite(input)).toBeNull();
    });

    // US places and facilities whose names start with a country name. The
    // first cut dropped every one of these at ingest.
    it.each([
        { description: 'This position is located in Panama City, FL.' },
        { description: 'Work location: Ireland Army Health Clinic, Fort Knox, Kentucky' },
        { description: 'The position is located at Jamaica Hospital Medical Center in Queens.' },
        { description: 'This role is based at Holland Hospital.' },
        { description: 'The position is located in China Grove, NC.' },
        { description: 'The position is located in Mexico Beach.' },
        { description: 'The role is based in India Hook.' },
        { description: 'The position is located in Japan Town.' },
        { description: 'The job is located in Mexico Beach, near Panama City.' },
        { title: 'Nurse Practitioner - Jamaica' },
        { title: 'Nurse Practitioner', location: 'Ontario' },
        { title: 'Nurse Practitioner', location: 'Hybrid - Ontario' },
        { title: 'Nurse Practitioner', location: 'Jamaica' },
        // A town-like name that ends the sentence still stays US when the
        // location field names a state: Lebanon, NH is Dartmouth.
        { title: 'Nurse Practitioner', location: 'Lebanon, NH', description: 'The position is located in Lebanon.' },
        // Only a capitalised city may sit between the phrase and a country.
        { title: 'Nurse Practitioner', description: 'Work location: remote, UK hours not required.' },
    ])('keeps a US place named like a country in scope: %o', (input) => {
        expect(detectNonUsWorkSite({ title: 'Nurse Practitioner', ...input })).toBeNull();
    });

    it.each([
        [{ description: 'Candidates must relocate to Iraq for the project.' }, 'IQ', 'description'],
        [{ title: 'CRNA - (Iraq)' }, 'IQ', 'title'],
        [{ location: 'Erbil, Iraq' }, 'IQ', 'location'],
        [{ location: 'Toronto, ON' }, 'CA', 'location'],
        [{ location: 'Toronto, Ontario' }, 'CA', 'location'],
        [{ location: 'Kingston, Jamaica' }, 'JM', 'location'],
        [{ description: 'This position is located in Erbil, Iraq.' }, 'IQ', 'description'],
        [{ description: 'Must be willing to relocate to Ireland.' }, 'IE', 'description'],
        [{ description: 'You must be willing to deploy to Iraq for 90 days.' }, 'IQ', 'description'],
        [{ description: 'Must be able to deploy to Iraq.' }, 'IQ', 'description'],
        [{ description: 'The selected candidate will be stationed in Kuwait.' }, 'KW', 'description'],
        [{ description: 'You will be deployed to Afghanistan for six months.' }, 'AF', 'description'],
    ])('still catches a real foreign work site: %o', (input, country, evidence) => {
        expect(detectNonUsWorkSite({ title: 'Nurse Practitioner', ...input })).toMatchObject({ country, evidence });
    });

    // US postings about veterans and military families. The first cut read
    // "deployed to" and "stationed in" as the hire's work site, and the
    // unpublish script would have pinned these rows off the site for good.
    it.each([
        { location: 'Tampa, FL', description: 'Serve veterans who deployed to Iraq and Afghanistan.' },
        { description: 'Prior deployment in Kuwait preferred.' },
        { description: 'We support military families stationed in Germany.' },
        { description: 'Candidates must reside in Canada or the United States.' },
        { description: 'Candidates must reside in Canada, or the US.' },
        { description: 'Patients include service members who will deploy to Kuwait.' },
        { description: 'Care for soldiers stationed at Fort Bragg who deployed to Germany.' },
    ])('keeps a US posting that mentions service abroad in scope: %o', (input) => {
        expect(detectNonUsWorkSite({ title: 'Psychiatric Nurse Practitioner', ...input })).toBeNull();
    });
});

/**
 * Owner decision (2026-09-29): a posting that includes the United States
 * among its locations is a US job and is kept; only a posting with no US
 * place is excluded. The review reproduced every input below as a rejection
 * (country 'CA'): the US marker was stripped before the last segment was
 * read, and a bare "US" in a title was not recognised.
 */
describe('a posting that lists the United States among its places is a US job', () => {
    const LISTS_US = [
        'United States, Canada',
        'Canada, United States',
        'US, Canada',
        'Canada, US',
        'Remote (US, Canada)',
        'Remote - US or Canada',
        'US or Canada',
        'Canada or US',
        'Canada/USA',
        'U.S. or Canada',
        'Canada and the United States',
        'United States of America, Canada',
    ];

    it.each(LISTS_US)('parseLocation keeps country US: %s', (location) => {
        expect(parseLocation(location)).toMatchObject({ country: 'US', city: null, stateCode: null });
    });

    it.each(LISTS_US)('the location is kept: %s', (location) => {
        expect(detectNonUsWorkSite({ title: 'Psychiatric Nurse Practitioner', location })).toBeNull();
    });

    it.each([
        'Psychiatric NP - US, Canada',
        'Psychiatric NP - Remote (US, Canada)',
        'NP - U.S. or Canada',
        'NP (Canada/USA)',
        'PMHNP | USA & Canada',
        'Nurse Practitioner - Remote in the US or Canada',
    ])('the title is kept: %s', (title) => {
        expect(detectNonUsWorkSite({ title })).toBeNull();
        expect(detectNonUsWorkSite({ title, location: 'Remote' })).toBeNull();
    });

    it('is kept even when the ATS country names only the other place', () => {
        expect(detectNonUsWorkSite({ title: 'NP', location: 'United States, Canada', atsCountry: 'ca' })).toBeNull();
        expect(detectNonUsWorkSite({ title: 'Psychiatric NP - US, Canada', location: 'Toronto, ON', atsCountry: 'CA' })).toBeNull();
    });

    it('a location naming only the United States does not outvote an ATS country (adapters default to it)', () => {
        expect(detectNonUsWorkSite({ title: 'NP', location: 'United States', atsCountry: 'ca' }))
            .toMatchObject({ country: 'CA', evidence: 'ats_country' });
    });

    it.each([
        [{ location: 'Remote - Canada' }, 'CA', 'location'],
        [{ location: 'Canada' }, 'CA', 'location'],
        [{ location: 'Toronto, ON' }, 'CA', 'location'],
        [{ location: 'Baghdad, Iraq' }, 'IQ', 'location'],
        [{ title: 'CRNA - (Iraq)' }, 'IQ', 'title'],
        // A US facility abroad is not the United States as a place.
        [{ location: 'US Army Garrison, Germany' }, 'DE', 'location'],
        [{ title: 'Nurse Practitioner - US Army Health Clinic, Germany' }, 'DE', 'title'],
    ])('a posting with no US place is still excluded: %o', (input, country, evidence) => {
        expect(detectNonUsWorkSite({ title: 'Nurse Practitioner', ...input })).toMatchObject({ country, evidence });
    });

    it('the word "us" is never the country', () => {
        expect(parseLocation('Join us in Toronto, Canada').country).toBe('CA');
        expect(detectNonUsWorkSite({ title: 'Join us - Nurse Practitioner', location: 'Toronto, ON' })).toMatchObject({ country: 'CA' });
    });

    it('a US place listed after a foreign one keeps its own city', () => {
        expect(place('Toronto, ON; Seattle, WA')).toEqual({ city: 'Seattle', stateCode: 'WA' });
        expect(place('Remote, Canada / Seattle, WA')).toEqual({ city: 'Seattle', stateCode: 'WA' });
        // Bare US towns in front still share the state (unchanged).
        expect(place('Dallas / Houston, TX')).toEqual({ city: null, stateCode: 'TX' });
    });
});

/**
 * Review round 4: the United States followed by a work-mode word. Greenhouse
 * and Lever offices are often labelled "US Remote" or "Remote US", and the
 * gate read "US Remote, Canada Remote" as Canada (normalizer_non_us_location),
 * so ingest dropped the job and unpublish-non-us-jobs.ts would have pinned a
 * stored one unpublished.
 */
describe('the United States followed by a work-mode word is still a US place', () => {
    const US_WITH_MODE = [
        'US Remote, Canada Remote',
        'Canada Remote, US Remote',
        'US (Remote), Canada (Remote)',
        'United States Remote, Canada Remote',
        'US Remote | Canada Remote',
        'US Nationwide, Canada',
    ];

    it.each(US_WITH_MODE)('parseLocation keeps country US: %s', (location) => {
        expect(parseLocation(location).country).toBe('US');
    });

    it.each(US_WITH_MODE)('the location is kept: %s', (location) => {
        expect(detectNonUsWorkSite({ title: 'Psychiatric Nurse Practitioner', location })).toBeNull();
    });

    it('a title listing "US Remote" keeps the posting whatever the location says', () => {
        expect(detectNonUsWorkSite({ title: 'Nurse Practitioner - US Remote, Canada Remote', location: 'Toronto, ON' })).toBeNull();
    });

    it.each([
        [{ location: 'Canada Remote' }, 'CA', 'location'],
        [{ location: 'Remote - Canada' }, 'CA', 'location'],
        [{ title: 'Nurse Practitioner - US Army Garrison, Germany', location: 'Remote' }, 'DE', 'title'],
    ])('a posting with no US place is still excluded: %o', (input, country, evidence) => {
        expect(detectNonUsWorkSite({ title: 'Nurse Practitioner', ...input })).toMatchObject({ country, evidence });
    });

    it('a US facility abroad, or the word "us" before a work-mode word, is not the United States', () => {
        expect(detectNonUsWorkSite({ title: 'Nurse Practitioner', location: 'USA Health Clinic, Germany' }))
            .toMatchObject({ country: 'DE' });
        expect(detectNonUsWorkSite({ title: 'Join us remote - Nurse Practitioner', location: 'Toronto, ON' }))
            .toMatchObject({ country: 'CA' });
    });
});

/**
 * Review round 3: Canadian shapes the gate still kept. "Remote (Canada)"
 * was kept as a US job (the brackets hid the country), "Toronto, ON, CA"
 * and "Toronto, Ontario, CA" were filed under California (the ISO code
 * read as the state), and Workday's "CA-ON-Toronto" became California with
 * the city "ON-Toronto". Each is Canada, never California.
 */
describe('Canada written in brackets or with its ISO code is Canada, never California', () => {
    const CANADA = [
        'Remote (Canada)',
        'Remote [Canada]',
        'Toronto, ON, CA',
        'Toronto, Ontario, CA',
        'Vancouver, BC, CA',
        'Calgary, AB, CA',
        'Montreal, QC, CA',
        'Halifax, NS, CA',
        'Toronto, ON, CAN',
        'Remote - Toronto, ON, CA',
        'Remote, ON, CA',
        'ON, CA',
        'CA-ON-Toronto',
        'CAN-BC-Vancouver',
    ];

    it.each(CANADA)('parseLocation: %s → country CA, no US state or city', (location) => {
        expect(parseLocation(location)).toMatchObject({ country: 'CA', stateCode: null, city: null });
    });

    it.each(CANADA)('detectNonUsWorkSite excludes %s', (location) => {
        expect(detectNonUsWorkSite({ title: 'Psychiatric Nurse Practitioner', location }))
            .toMatchObject({ country: 'CA', evidence: 'location' });
    });

    it.each([
        ['Remote (US, Canada)', null, null],
        ['United States, Canada', null, null],
        ['Ontario, CA', 'Ontario', 'CA'],
        ['Dublin, CA', 'Dublin', 'CA'],
        ['Hybrid (Ontario)', null, null],
        ['Remote (Ontario)', null, null],
        ['Remote - Ontario, CA', 'Ontario', 'CA'],
        // Ontario, California after a street address or a facility.
        ['2200 E Inland Empire Blvd, Ontario, CA', 'Ontario', 'CA'],
        ['Kaiser Permanente Ontario Medical Center, Ontario, CA', 'Ontario', 'CA'],
        ['US-CA-Los Angeles', 'Los Angeles', 'CA'],
    ])('%s stays in the United States (%s, %s)', (location, city, stateCode) => {
        expect(parseLocation(location)).toMatchObject({ country: 'US', city, stateCode });
        expect(detectNonUsWorkSite({ title: 'Psychiatric Nurse Practitioner', location })).toBeNull();
    });
});

describe('parseLocation: a string with no state names no city unless it is a town', () => {
    // The last-resort branch used to publish these as the city, and they
    // reached JSON-LD addressLocality.
    it.each([
        'US or Canada', 'Canada or US', 'Worldwide', 'Global', 'EMEA', 'Americas', 'North America',
        'Puerto Rico', 'Guam', 'APO AE', 'Multiple', 'Various',
    ])('%s → no city', (input) => {
        expect(parseLocation(input).city).toBeNull();
    });

    it('a town name standing alone is still read as the city', () => {
        expect(parseLocation('Colorado Springs').city).toBe('Colorado Springs');
    });
});

describe('parseLocation never returns a sentence fragment as the city', () => {
    it.each([
        ['Remote - must reside in Texas', 'TX'],
        ['must reside in Texas', 'TX'],
        ['Remote, must be licensed in the state of Florida', 'FL'],
        ['s: Denver, CO', 'CO'],
    ])('%s → no city, %s', (input, stateCode) => {
        expect(place(input)).toEqual({ city: null, stateCode });
    });

    it('keeps real towns, including lower-case input and particles', () => {
        expect(place('san antonio, tx')).toEqual({ city: 'san antonio', stateCode: 'TX' });
        expect(place('Lake in the Hills, IL')).toEqual({ city: 'Lake in the Hills', stateCode: 'IL' });
        expect(place("Coeur d'Alene, ID")).toEqual({ city: "Coeur d'Alene", stateCode: 'ID' });
        expect(place('King of Prussia, PA')).toEqual({ city: 'King of Prussia', stateCode: 'PA' });
        expect(place('Boston-, MA')).toEqual({ city: 'Boston', stateCode: 'MA' });
    });
});

describe('leadingStreetAddress', () => {
    it.each([
        ['4200 Wisconsin Ave NW, Washington, DC, 20016', '4200 wisconsin ave nw'],
        ['1730 Rhode Island Ave NW, Washington, DC, 20036', '1730 rhode island ave nw'],
        ['5100 Buckeyestown Pike Suite 200 Frederick, MD 21704', '5100 buckeyestown pike'],
        ['118-35 Queens Blvd STE 400 Forest Hills, NY 11375', '118-35 queens blvd'],
        ['400 East Pratt Street, 8th Floor, Baltimore, Maryland, 212', '400 e pratt st'],
    ])('%s → %s', (input, expected) => {
        expect(leadingStreetAddress(input)).toBe(expected);
    });

    it('reads spelled-out and abbreviated forms of one address as equal', () => {
        expect(leadingStreetAddress('4200 Wisconsin Avenue Northwest, Washington, DC'))
            .toBe(leadingStreetAddress('4200 Wisconsin Ave. NW, Washington, DC 20016'));
    });

    it.each(['Washington, DC', 'Denver, Colorado, United States', 'VA - Norfolk', 'Remote', '', null])(
        'is null without a street address: %s',
        (input) => {
            expect(leadingStreetAddress(input)).toBeNull();
        },
    );
});

describe('resolveCountryValue', () => {
    it.each([
        ['us', 'US'], ['USA', 'US'], ['United States of America', 'US'], ['Guam', 'US'],
        ['ca', 'CA'], ['Canada', 'CA'], ['GB', 'GB'], ['india', 'IN'], ['', null], ['Atlantis', null],
    ])('%s → %s', (input, expected) => {
        expect(resolveCountryValue(input)).toBe(expected);
    });

    it('ignores non-string values', () => {
        expect(resolveCountryValue(undefined)).toBeNull();
        expect(resolveCountryValue(42)).toBeNull();
    });
});

describe('parseLocation: lists of places are not a city', () => {
    // A list of states or cities never becomes one junk city. Where the list
    // names several states, the FIRST listed one is the posting's state.
    it.each([
        ['Remote - CA, NY', { city: null, stateCode: 'CA' }],
        ['CA or NY', { city: null, stateCode: 'CA' }],
        ['Dallas / Houston, TX', { city: null, stateCode: 'TX' }],
        ['Dallas and Fort Worth, TX', { city: null, stateCode: 'TX' }],
    ])('%s', (input, expected) => {
        expect(place(input)).toEqual(expected);
    });
});

describe('parseLocation: several listed places resolve to the first (reviewer regression)', () => {
    // Each of these came out as a junk city or the last-listed state from the
    // first street-address rewrite; b393f53 read the first place.
    it.each([
        ['Kansas City, MO; Overland Park, KS', 'Kansas City', 'MO'],
        ['Phoenix, AZ; Tucson, AZ', 'Phoenix', 'AZ'],
        ['Vancouver, WA / Portland, OR', 'Vancouver', 'WA'],
        ['Remote - TX, FL, GA', null, 'TX'],
        ['TX, FL, GA', null, 'TX'],
        ['Seattle, WA, Portland, OR', 'Seattle', 'WA'],
        ['Portland, OR or Seattle, WA', 'Portland', 'OR'],
        ['Portland, Oregon, Seattle, Washington', 'Portland', 'OR'],
        ['Kansas City MO, Overland Park KS', 'Kansas City', 'MO'],
        ['Overland Park KS, Kansas City, MO', 'Overland Park', 'KS'],
        ['Texas, Oklahoma, Kansas', null, 'TX'],
        ['Hybrid / Denver, CO', 'Denver', 'CO'],
        ['Remote / Pittsburgh, PA', 'Pittsburgh', 'PA'],
        ['Multiple Locations / Denver, CO', 'Denver', 'CO'],
        ['Hospital and Clinics, Iowa City, IA', 'Iowa City', 'IA'],
    ])('%s → %s, %s', (input, city, stateCode) => {
        expect(place(input)).toEqual({ city, stateCode });
    });

    it('never stores a list separator or a state code inside the city', () => {
        for (const input of ['Kansas City, MO; Overland Park, KS', 'Phoenix, AZ; Tucson, AZ', 'Seattle, WA, Portland, OR']) {
            const { city } = parseLocation(input);
            expect(city ?? '').not.toMatch(/[;/]|\b[A-Z]{2}\b/);
        }
    });

    it('still reads one place written with a state-named city', () => {
        expect(place('Washington, DC')).toEqual({ city: 'Washington', stateCode: 'DC' });
        expect(place('Indiana, PA')).toEqual({ city: 'Indiana', stateCode: 'PA' });
        expect(place('New York, NY')).toEqual({ city: 'New York', stateCode: 'NY' });
        expect(place('Spokane, Washington')).toEqual({ city: 'Spokane', stateCode: 'WA' });
    });

    it('reads a directional after a street as part of the address, not a state', () => {
        expect(place('100 Main St NE, Washington, DC')).toEqual({ city: 'Washington', stateCode: 'DC' });
        expect(place('100 Main St Suite 5 NE, Omaha, NE')).toEqual({ city: 'Omaha', stateCode: 'NE' });
    });

    it('keeps the ZIP of a listed place out of the state', () => {
        expect(place('Austin, TX 78701, Dallas, TX 75201')).toEqual({ city: 'Austin', stateCode: 'TX' });
    });
});

describe('statesNamedIn', () => {
    it.each([
        ['Kansas City, MO; Overland Park, KS', ['KS', 'MO']],
        ['Vancouver, WA / Portland, OR', ['OR', 'WA']],
        ['Remote - TX, FL, GA', ['FL', 'GA', 'TX']],
        ['Seattle, WA, Portland, OR', ['OR', 'WA']],
        ['Charleston, West Virginia', ['WV']],
        ['Austin, tx', ['TX']],
        ['Spokane, Washington, United States', ['WA']],
    ])('%s → %o', (input, expected) => {
        expect([...statesNamedIn(input)].sort()).toEqual(expected);
    });

    it('does not count a street, a compound place name or a city in front of a state', () => {
        expect([...statesNamedIn('1730 Rhode Island Ave NW, Washington, DC, 20036')]).toEqual(['DC']);
        expect(statesNamedIn('Kansas City, Missouri').has('KS')).toBe(false);
        expect(statesNamedIn('Virginia Beach, VA').has('VA')).toBe(true);
        expect(statesNamedIn('Charleston, West Virginia').has('VA')).toBe(false);
        expect(statesNamedIn(null).size).toBe(0);
    });
});

/**
 * Review fix (non-US filter): "X, Ontario, CA" was rewritten to Canada for
 * any town X, so a posting that lists two Inland Empire cities ("Chino,
 * Ontario, CA") was rejected at ingest as non-US and would have been
 * unpublished by unpublish-non-us-jobs.ts. A California town before
 * "Ontario, CA" makes it Ontario, California.
 */
describe('a California town before "Ontario, CA" keeps it in California', () => {
    it.each([
        'Chino, Ontario, CA',
        'Upland, Ontario, CA',
        'Rancho Cucamonga, Ontario, CA',
        'Montclair, Ontario, CA',
        'Remote - Fontana, Ontario, CA',
        // A California town the city dataset knows, outside the list.
        'Los Angeles, Ontario, CA',
    ])('%s stays a US job in California', (location) => {
        expect(parseLocation(location)).toMatchObject({ country: 'US', stateCode: 'CA' });
        expect(detectNonUsWorkSite({ title: 'Psychiatric Nurse Practitioner', location })).toBeNull();
    });

    it.each([
        'Toronto, Ontario, CA',
        'Ottawa, Ontario, CA',
        'Mississauga, Ontario, CA',
        // Named like a California town, but a city in the province.
        'Windsor, Ontario, CA',
        'CA-ON-Toronto',
    ])('%s is still Canada', (location) => {
        expect(parseLocation(location)).toMatchObject({ country: 'CA', stateCode: null, city: null });
        expect(detectNonUsWorkSite({ title: 'Psychiatric Nurse Practitioner', location }))
            .toMatchObject({ country: 'CA', evidence: 'location' });
    });

    it('"Ontario, CA" alone is still Ontario, California', () => {
        expect(place('Ontario, CA')).toEqual({ city: 'Ontario', stateCode: 'CA' });
    });
});

/**
 * Review fix (wrong state regression): two bare codes are two states
 * ("CA, NY"), so "LA, CA" (Los Angeles, California) was filed under
 * Louisiana. b393f53 gave city "LA", state CA.
 */
describe('"LA, CA" is California, not Louisiana', () => {
    it('reads the state as CA and stores no bare code as the city', () => {
        expect(parseLocation('LA, CA')).toMatchObject({ stateCode: 'CA', state: 'California', country: 'US' });
        expect(place('LA, CA')).toEqual({ city: null, stateCode: 'CA' });
        expect(place('Remote - LA, CA')).toEqual({ city: null, stateCode: 'CA' });
        expect(place('LA, CA 90012')).toEqual({ city: null, stateCode: 'CA' });
    });

    it('other code pairs are still two states, the first listed', () => {
        expect(place('CA, NY')).toEqual({ city: null, stateCode: 'CA' });
        expect(place('CA, LA')).toEqual({ city: null, stateCode: 'CA' });
        expect(place('LA, TX')).toEqual({ city: null, stateCode: 'LA' });
    });

    it('a list of three codes that ends in LA is unchanged', () => {
        expect(place('Remote: TX, OK, LA')).toEqual({ city: null, stateCode: 'TX' });
        expect(place('TX, OK, LA')).toEqual({ city: null, stateCode: 'TX' });
    });

    it('Louisiana places are unchanged', () => {
        expect(place('New Orleans, LA')).toEqual({ city: 'New Orleans', stateCode: 'LA' });
        expect(place('Central, LA')).toEqual({ city: 'Central', stateCode: 'LA' });
    });
});
