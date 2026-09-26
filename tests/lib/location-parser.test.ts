import { describe, it, expect } from 'vitest';
import { parseLocation, type ParsedLocation } from '../../lib/location-parser';

// Table-driven cover for parseLocation. Each row lists only the fields it
// pins; rows that must parse EXACTLY as before list every derived field.

type Expected = Partial<Omit<ParsedLocation, 'originalLocation' | 'country'>>;

interface Case {
    input: string;
    expected: Expected;
}

function runTable(cases: readonly Case[]) {
    it.each(cases)('parses $input', ({ input, expected }) => {
        expect(parseLocation(input)).toMatchObject(expected);
    });
}

const ONSITE = { isRemote: false, isHybrid: false } as const;
const DISTRICT = { state: 'District of Columbia', stateCode: 'DC' } as const;
const WASHINGTON_DC = { ...ONSITE, ...DISTRICT, city: 'Washington', confidence: 1 } as const;
const WASHINGTON_STATE = { state: 'Washington', stateCode: 'WA' } as const;

// ── District of Columbia ─────────────────────────────────────────────────
// Dotted "D.C." used to match none of the parser's patterns: "Washington,
// D.C." fell into the state-name scan and was filed under Washington state
// with no city, and "Washington D.C." was skipped as a compound city name
// and lost. Every form below must resolve to the District.
describe('parseLocation: District of Columbia forms', () => {
    runTable([
        { input: 'Washington, D.C.', expected: WASHINGTON_DC },
        { input: 'Washington D.C.', expected: WASHINGTON_DC },
        { input: 'Washington, DC', expected: WASHINGTON_DC },
        { input: 'Washington DC', expected: WASHINGTON_DC },
        { input: 'Washington, District of Columbia', expected: WASHINGTON_DC },
        { input: 'Washington, district of columbia', expected: WASHINGTON_DC },
        { input: 'Washington, D.C', expected: WASHINGTON_DC },
        { input: 'Washington D.C', expected: WASHINGTON_DC },
        { input: 'Washington, D. C.', expected: WASHINGTON_DC },
        { input: 'Washington, D.C., United States', expected: WASHINGTON_DC },
        { input: 'Washington, DC, USA', expected: WASHINGTON_DC },
        { input: 'Washington DC, USA', expected: WASHINGTON_DC },
        { input: 'Washington D.C., USA', expected: WASHINGTON_DC },
        { input: 'Washington, D.C. 20001', expected: WASHINGTON_DC },
        { input: 'Washington, DC 20001', expected: WASHINGTON_DC },
        { input: 'Washington D.C. Metro Area', expected: WASHINGTON_DC },
        { input: 'Washington, DC Metro Area', expected: WASHINGTON_DC },
        { input: 'US-DC-Washington', expected: WASHINGTON_DC },
    ]);

    describe('keeps the city as written (the parser never re-cases a city)', () => {
        runTable([
            { input: 'WASHINGTON, DC', expected: { ...WASHINGTON_DC, city: 'WASHINGTON' } },
            { input: 'washington, d.c.', expected: { ...WASHINGTON_DC, city: 'washington' } },
            { input: 'washington dc', expected: { ...WASHINGTON_DC, city: 'washington' } },
        ]);
    });

    describe('with a work-mode marker', () => {
        runTable([
            { input: 'Remote - Washington, D.C.', expected: { ...WASHINGTON_DC, isRemote: true } },
            { input: 'Washington, D.C. (Remote)', expected: { ...WASHINGTON_DC, isRemote: true } },
            { input: 'Washington, D.C. - Remote', expected: { ...WASHINGTON_DC, isRemote: true } },
            { input: 'Hybrid - Washington, D.C.', expected: { ...WASHINGTON_DC, isHybrid: true } },
        ]);
    });

    describe('the District alone resolves the jurisdiction with no city', () => {
        const districtOnly = { ...ONSITE, ...DISTRICT, city: null, confidence: 0.8 };
        runTable([
            { input: 'D.C.', expected: districtOnly },
            { input: 'DC', expected: districtOnly },
            { input: 'District of Columbia', expected: districtOnly },
        ]);
    });
});

// ── Washington state ─────────────────────────────────────────────────────
// Pinned to the exact output from before the District fix: none of these
// may move.
describe('parseLocation: Washington state forms (unchanged by the District fix)', () => {
    const seattle = { ...ONSITE, ...WASHINGTON_STATE, city: 'Seattle', confidence: 1 };
    runTable([
        { input: 'Seattle, Washington', expected: seattle },
        { input: 'Seattle, WA', expected: seattle },
        { input: 'Seattle Washington', expected: seattle },
        { input: 'Seattle, WA, USA', expected: seattle },
        { input: 'Seattle, WA 98101', expected: seattle },
        { input: 'Hybrid - Seattle, WA', expected: { ...seattle, isHybrid: true } },
        { input: 'Spokane, Washington', expected: { ...seattle, city: 'Spokane' } },
        { input: 'Spokane, WA', expected: { ...seattle, city: 'Spokane' } },
        { input: 'Vancouver, WA', expected: { ...seattle, city: 'Vancouver' } },
        { input: 'Tacoma, Washington, United States', expected: { ...seattle, city: 'Tacoma' } },
        { input: 'Washington, WA', expected: { ...seattle, city: 'Washington' } },
    ]);

    // "Washington" with nothing else is ambiguous between the state and the
    // District. Today it is read as Washington state with no city, at the
    // parser's 0.8 state-only confidence; the District needs an explicit
    // "DC", "D.C." or "District of Columbia".
    describe('bare "Washington" stays Washington state with no city', () => {
        const stateOnly = { ...ONSITE, ...WASHINGTON_STATE, city: null, confidence: 0.8 };
        const remoteStateOnly = { ...stateOnly, isRemote: true };
        runTable([
            { input: 'Washington', expected: stateOnly },
            { input: 'washington', expected: stateOnly },
            { input: 'Washington, USA', expected: stateOnly },
            { input: 'WA', expected: stateOnly },
            { input: 'Remote - Washington', expected: remoteStateOnly },
            { input: 'Remote, Washington', expected: remoteStateOnly },
            { input: 'Washington (Remote)', expected: remoteStateOnly },
            { input: 'Remote - WA', expected: remoteStateOnly },
        ]);
    });
});

describe('parseLocation: places named Washington in other states', () => {
    const place = (city: string, state: string, stateCode: string): Expected =>
        ({ ...ONSITE, city, state, stateCode, confidence: 1 });
    runTable([
        { input: 'Washington, PA', expected: place('Washington', 'Pennsylvania', 'PA') },
        { input: 'Washington, Pennsylvania', expected: place('Washington', 'Pennsylvania', 'PA') },
        { input: 'Washington, NC', expected: place('Washington', 'North Carolina', 'NC') },
        { input: 'Washington, MO', expected: place('Washington', 'Missouri', 'MO') },
        { input: 'Washington Court House, OH', expected: place('Washington Court House', 'Ohio', 'OH') },
        { input: 'Washington Crossing, PA', expected: place('Washington Crossing', 'Pennsylvania', 'PA') },
        { input: 'Washington Township, NJ', expected: place('Washington Township', 'New Jersey', 'NJ') },
        { input: 'Port Washington, NY', expected: place('Port Washington', 'New York', 'NY') },
        { input: 'Port Washington, New York', expected: place('Port Washington', 'New York', 'NY') },
        { input: 'Fort Washington, MD', expected: place('Fort Washington', 'Maryland', 'MD') },
        { input: 'Mount Washington, KY', expected: place('Mount Washington', 'Kentucky', 'KY') },
        { input: 'Bethesda, MD', expected: place('Bethesda', 'Maryland', 'MD') },
        { input: 'Arlington, Virginia', expected: place('Arlington', 'Virginia', 'VA') },
    ]);
});

// ── Pre-existing cases ───────────────────────────────────────────────────

describe('parseLocation: standard patterns', () => {
    runTable([
        { input: 'Austin, TX', expected: { city: 'Austin', stateCode: 'TX', state: 'Texas', confidence: 1.0 } },
        { input: 'Portland, Oregon', expected: { city: 'Portland', stateCode: 'OR', state: 'Oregon' } },
        // "City, state" in lower case
        { input: 'Denver, colorado', expected: { city: 'Denver', stateCode: 'CO' } },
        { input: 'New York, NY', expected: { city: 'New York', stateCode: 'NY' } },
        { input: 'Kansas City, MO', expected: { city: 'Kansas City', stateCode: 'MO' } },
        { input: 'Virginia Beach, VA', expected: { city: 'Virginia Beach', stateCode: 'VA' } },
        { input: 'Charleston, West Virginia', expected: { city: 'Charleston', stateCode: 'WV' } },
    ]);
});

describe('parseLocation: remote patterns', () => {
    runTable([
        { input: 'Remote', expected: { isRemote: true, city: null } },
        { input: 'Remote - Austin, TX', expected: { isRemote: true, city: 'Austin', stateCode: 'TX' } },
        { input: 'Austin, TX (Remote)', expected: { isRemote: true, city: 'Austin', stateCode: 'TX' } },
        { input: 'Work From Home', expected: { isRemote: true } },
        { input: 'Anywhere', expected: { isRemote: true, city: null } },
        // Live-review item 1e: 'telehealth' / 'virtual' are service-line
        // words, not work-mode proof. Telehealth clinics hire onsite staff,
        // and these substrings marked verifiably onsite rows as remote. The
        // city and state still parse; the remote flag now requires a
        // standalone remote token.
        { input: 'Telehealth - Denver, CO', expected: { isRemote: false, city: 'Denver', stateCode: 'CO' } },
        { input: 'Virtual, United States', expected: { isRemote: false } },
    ]);
});

describe('parseLocation: hybrid patterns', () => {
    runTable([
        { input: 'Hybrid - Seattle, WA', expected: { isHybrid: true, city: 'Seattle', stateCode: 'WA' } },
        { input: 'Hybrid', expected: { isHybrid: true, isRemote: false, city: null } },
    ]);
});

describe('parseLocation: HQ and Workday patterns', () => {
    runTable([
        { input: 'HQ: Chicago, IL', expected: { city: 'Chicago', stateCode: 'IL' } },
        { input: 'US-TX-Austin', expected: { city: 'Austin', stateCode: 'TX' } },
        { input: 'US-CA-San Francisco', expected: { city: 'San Francisco', stateCode: 'CA' } },
    ]);
});

describe('parseLocation: country suffix patterns', () => {
    runTable([
        { input: 'Austin, TX, United States', expected: { city: 'Austin', stateCode: 'TX' } },
        { input: 'Denver, CO, USA', expected: { city: 'Denver', stateCode: 'CO' } },
    ]);
});

describe('parseLocation: edge cases', () => {
    runTable([
        { input: '', expected: { confidence: 0.3, city: null } },
        { input: null as unknown as string, expected: { city: null } },
        { input: 'California', expected: { state: 'California', stateCode: 'CA', city: null } },
        { input: 'TX', expected: { stateCode: 'TX', state: 'Texas' } },
        // Live-review item 1e: country and coverage markers are not remote
        // markers. 'Los Angeles, CA, United States' was flagged remote through
        // the 'united states' substring, and the Tia '- Onsite' rows shipped
        // TELECOMMUTE structured data this way. A bare country string is
        // simply unknown.
        { input: 'Nationwide', expected: { isRemote: false, city: null } },
        { input: 'United States', expected: { isRemote: false, city: null } },
        { input: 'Los Angeles, CA, United States', expected: { isRemote: false, city: 'Los Angeles', stateCode: 'CA' } },
        // Puerto Rico is not in STATE_CODES, so no state is inferred.
        { input: 'San Juan, Puerto Rico', expected: { state: null } },
    ]);

    it('records the trimmed input as originalLocation', () => {
        expect(parseLocation('  Washington, D.C.  ').originalLocation).toBe('Washington, D.C.');
    });
});

describe('parseLocation: Adzuna county format', () => {
    runTable([
        { input: 'Colorado Springs, El Paso County', expected: { city: 'Colorado Springs' } },
        { input: 'Raleigh, Wake County', expected: { city: 'Raleigh' } },
        { input: 'San Diego, San Diego County', expected: { city: 'San Diego' } },
        { input: 'Orlando, Orange County', expected: { city: 'Orlando' } },
        { input: 'Springfield, Greene County', expected: { city: 'Springfield' } },
    ]);
});
