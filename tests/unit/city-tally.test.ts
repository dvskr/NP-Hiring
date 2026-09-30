/**
 * CQ-02 (indexing audit): listing aggregates and city tallies skip stored
 * city values that are not towns. The city column held street numbers
 * ("1730"), facilities ("MAIN CAMPUS"), work modes ("Remote") and
 * placeholders ("Multiple Locations"); every tally read it raw, so such a
 * value could be named in a "led by" line, counted as a city hiring, linked
 * from a directory or the locations hub, and submitted by app/sitemap.ts as
 * /jobs/city/remote-tx. lib/pseo/city-tally.ts is the one rule, and a real
 * town whose name carries a facility word ("College Station, TX") still
 * counts because the city dataset knows it.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import { CITIES } from '@/lib/pseo/city-data/cities';
import { isTallyCity, tallyCityName } from '@/lib/pseo/city-tally';
import {
    buildCitySlug,
    buildStateCityDirectory,
    cityLinkResolves,
    foldDirectoryCityRows,
    parseCitySlugToName,
    shouldRenderStateCityDirectory,
    summarizeStateDirectories,
    tallyDirectoryCities,
} from '@/app/jobs/locations/[state]/directory';
import { selectCities } from '@/lib/pseo/listing-facts';
import { getMetroCity } from '@/lib/metro-data';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const NOT_TOWNS: ReadonlyArray<readonly [string, string]> = [
    ['1730', 'RI'],
    ['5100 Buckeyestown Pike Suite 200 Frederick', 'MD'],
    ['MAIN CAMPUS', 'SC'],
    ['GBMC Hospital', 'MD'],
    ['Remote', 'TX'],
    ['Hybrid', 'CA'],
    ['Multiple Locations', 'TX'],
    ['Urgent Care', 'FL'],
    ['must reside in', 'TX'],
    ['s: Denver', 'CO'],
    ['MMC', 'ME'],
];

describe('tallyCityName', () => {
    it.each(NOT_TOWNS)('%s, %s is not a town', (city, code) => {
        expect(tallyCityName(city, code)).toBeNull();
        expect(isTallyCity(city, code)).toBe(false);
    });

    it('keeps a town-shaped name, trimmed of trailing punctuation', () => {
        expect(tallyCityName('Austin', 'TX')).toBe('Austin');
        expect(tallyCityName('Boston-', 'MA')).toBe('Boston');
        expect(tallyCityName('King of Prussia', 'PA')).toBe('King of Prussia');
        expect(tallyCityName('Austin')).toBe('Austin');
    });

    it('keeps a dataset town whose name carries a facility word, in its own state only', () => {
        expect(tallyCityName('College Station', 'TX')).toBe('College Station');
        expect(tallyCityName('State College', 'pa')).toBe('State College');
        expect(tallyCityName('Brooklyn Center', 'MN')).toBe('Brooklyn Center');
        expect(tallyCityName('Rockville Centre', 'NY')).toBe('Rockville Centre');
        // Not in that state's dataset, or no state to check it against.
        expect(tallyCityName('College Station', 'OH')).toBeNull();
        expect(tallyCityName('College Station')).toBeNull();
        expect(tallyCityName('College Station', 'Texas')).toBeNull();
    });

    it('every town in the city dataset counts, census forms included', () => {
        expect(CITIES.length).toBeGreaterThan(4000);
        const failing = CITIES.filter((c) => !isTallyCity(c.name, c.stateCode)).map((c) => `${c.name}, ${c.stateCode}`);
        // The one exception is a formal census name no posting writes, whose
        // dataset slug drops the slash; postings write "Louisville", which
        // counts. Its /jobs/city link never resolved anyway (see below).
        expect(failing).toEqual(['Louisville/Jefferson County metro government (balance), KY']);
        expect(isTallyCity('Louisville', 'KY')).toBe(true);
        expect(isTallyCity('Kearns metro township', 'UT')).toBe(true);
        expect(isTallyCity('Woodlawn CDP (Baltimore County)', 'MD')).toBe(true);
    });
});

describe('cityLinkResolves vetoes a value that is not a town', () => {
    it.each(NOT_TOWNS)('%s, %s is never linked', (city, code) => {
        expect(cityLinkResolves(city, code)).toBe(false);
    });

    it('"Remote, TX" round-trips cleanly, so only the town check stops the link (and the sitemap URL)', () => {
        expect(parseCitySlugToName(buildCitySlug('Remote', 'TX'))).toBe('Remote');
        expect(cityLinkResolves('Remote', 'TX')).toBe(false);
    });

    it('gives every dataset town the answer the slug round-trip alone gives', () => {
        const changed = CITIES.filter((c) => {
            const slug = buildCitySlug(c.name, c.stateCode);
            const roundTrip = !!slug && (!!getMetroCity(slug) || parseCitySlugToName(slug)?.toLowerCase() === c.name.trim().toLowerCase());
            return cityLinkResolves(c.name, c.stateCode) !== roundTrip;
        });
        expect(changed.map((c) => c.slug)).toEqual([]);
        expect(cityLinkResolves('College Station', 'TX')).toBe(true);
    });
});

describe('the state city directory skips values that are not towns', () => {
    const rows = [
        { city: 'Houston', count: 9 },
        { city: 'Remote', count: 14 },
        { city: 'Multiple Locations', count: 6 },
        { city: 'College Station', count: 4 },
        { city: '1730', count: 3 },
        { city: 'Austin', count: 2 },
    ];

    it('foldDirectoryCityRows drops them before folding', () => {
        const folded = foldDirectoryCityRows(rows, 'TX');
        expect(folded.map((r) => r.city).sort()).toEqual(['Austin', 'College Station', 'Houston']);
    });

    it('they are never linked, named, counted as tracked cities or added to the job total', () => {
        const directory = buildStateCityDirectory(foldDirectoryCityRows(rows, 'TX'), {
            canLink: (row) => cityLinkResolves(row.city, 'TX'),
        });
        expect(directory.linkable.map((r) => r.city)).toEqual(['Houston', 'College Station']);
        expect(directory.emerging.map((r) => r.city)).toEqual(['Austin']);
        expect(directory.trackedCities).toBe(3);
        expect(directory.cityJobs).toBe(15);
    });

    it('a state carried only by junk values has no directory', () => {
        const junkOnly = [
            { city: 'Houston', count: 5 },
            { city: 'Remote', count: 7 },
            { city: 'Multiple Locations', count: 4 },
        ];
        const directory = buildStateCityDirectory(foldDirectoryCityRows(junkOnly, 'TX'), {
            canLink: (row) => cityLinkResolves(row.city, 'TX'),
        });
        expect(directory.trackedCities).toBe(1);
        expect(shouldRenderStateCityDirectory(directory)).toBe(false);
        expect(summarizeStateDirectories(junkOnly.map((r) => ({ ...r, state: 'Texas' }))).has('Texas')).toBe(false);
    });

    it('the sitemap tally (tallyDirectoryCities) drops them too', () => {
        const tallied = tallyDirectoryCities([
            { city: 'Houston', state: 'Texas', count: 5, newest: null },
            { city: 'Remote', state: 'Texas', count: 8, newest: null },
        ]);
        expect(tallied.get('Texas')?.rows.map((r) => r.city)).toEqual(['Houston']);
    });
});

describe('listing aggregates (selectCities) name only towns', () => {
    it('keeps College Station and drops the junk values, whatever their volume', () => {
        const cities = selectCities([
            { city: 'Remote', stateCode: 'TX' },
            { city: 'Remote', stateCode: 'TX' },
            { city: 'Remote', stateCode: 'TX' },
            { city: 'College Station', stateCode: 'TX' },
            { city: 'College Station', stateCode: 'TX' },
            { city: 'Multiple Locations', stateCode: 'TX' },
            { city: 'Houston', stateCode: 'TX' },
        ]);
        expect(cities).toEqual([
            { name: 'College Station', stateCode: 'TX', count: 2 },
            { name: 'Houston', stateCode: 'TX', count: 1 },
        ]);
    });
});

describe('the pages read the rule', () => {
    it('the city page counts only towns for its nearby links and directory verdict, and never indexes a non-town slug', () => {
        const src = read('app/jobs/city/[slug]/page.tsx');
        expect(src).toContain("import { isTallyCity } from '@/lib/pseo/city-tally'");
        expect(src).toContain('row.city && isTallyCity(row.city, city.stateCode)');
        expect(src).toContain('const indexable = isTallyCity(parsed.cityName, stateCode) && shouldIndexLocalListingPage({');
    });

    it('the locations hub counts only towns as cities hiring, and its top-city tiles are filled after the veto', () => {
        const src = read('app/jobs/locations/page.tsx');
        expect(src).toContain('isTallyCity(r.city, STATE_CODES[r.state])');
        expect(src).toContain('take: TOP_CITY_CANDIDATES');
        expect(src).toContain('.slice(0, TOP_CITY_TILES)');
    });

    it('the directory helpers and the listing facts import the one rule', () => {
        expect(read('app/jobs/locations/[state]/directory.ts')).toContain("import { isTallyCity } from '@/lib/pseo/city-tally'");
        expect(read('lib/pseo/listing-facts.ts')).toContain("import { tallyCityName } from '@/lib/pseo/city-tally'");
    });
});
