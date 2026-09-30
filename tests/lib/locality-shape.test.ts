/**
 * lib/locality.ts and the stored-city guard (indexing audit CQ-02): a town
 * name has a town's shape. The review found description fragments stored as
 * towns and published as JobPosting addressLocality: "s: Denver" (from
 * "Locations: Denver, CO"), "must reside in" (from "Location: Remote - must
 * reside in Texas"), "must be licensed in the state of" and "must hold an
 * active". None of them may pass, and no real town may fail.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  facilityCodeRemainder,
  hasTownNameShape,
  namesPlaceholderNotTown,
  namesRegionNotTown,
  namesSiteNotTown,
  namesStreetFragment,
  plausibleLocality,
} from '@/lib/locality';
import { datasetSpellingOf, resolveLocationFallback, storedLocality } from '@/lib/location-fallback';
import { resolveJobPlaces } from '@/app/jobs/[slug]/job-posting-facts';
import { CITIES } from '@/lib/pseo/city-data/cities';
import { foldCityName, neighborhoodParentOf } from '@/lib/pseo/city-name-fold';
import { neighborhoodParentOf as leafNeighborhoodParentOf } from '@/lib/pseo/neighborhood-parent';

const FRAGMENTS = [
  's: Denver',
  'must reside in',
  'must be licensed in the state of',
  'must hold an active',
  'or Canada',
  'Canada or',
  'located in',
  'years in Urgent Care',
];

describe('hasTownNameShape', () => {
  it.each(FRAGMENTS)('rejects the fragment "%s"', (value) => {
    expect(hasTownNameShape(value)).toBe(false);
  });

  it.each([
    'Denver', 'Lake in the Hills', 'King of Prussia', "Coeur d'Alene", 'Fond du Lac', 'Town and Country',
    'Isle of Palms', 'St. Louis', 'Winston-Salem', "O'Fallon", 'san antonio', 'NEW YORK',
  ])('accepts the town "%s"', (value) => {
    expect(hasTownNameShape(value)).toBe(true);
  });

  it('every dataset town passes under a plain name; only formal census names fail', () => {
    const failing = CITIES.filter((c) => !hasTownNameShape(c.name)).map((c) => c.name);
    // Formal designations a posting never writes: "Indianapolis city
    // (balance)", "Kailua CDP (Honolulu County)", "Kearns metro township".
    for (const name of failing) {
      expect(name).toMatch(/\(|\b(?:city|metro|township|urban|county|and)\b/);
    }
    for (const name of ['Indianapolis', 'Louisville', 'Lexington', 'Ventura', 'Juneau', 'Kailua', 'Butte', 'Paso Robles', 'Kearns']) {
      expect(hasTownNameShape(name)).toBe(true);
    }
  });
});

describe('plausibleLocality rejects every fragment, digit and street value', () => {
  it.each([...FRAGMENTS, '1730', '5100 Buckeyestown Pike', 'Suite 200', 'Main Campus', 'MMC'])('%s', (value) => {
    expect(plausibleLocality(value)).toBeNull();
  });

  it.each(['tbd', 'n/a', 'located in', 'austin'])('rejects a stored value that starts in lower case: %s', (value) => {
    expect(plausibleLocality(value)).toBeNull();
  });
});

describe('storedLocality: the last guard on every city ingest stores', () => {
  it.each([
    ['s: Denver', 'CO'],
    ['must reside in', 'TX'],
    ['must be licensed in the state of', 'FL'],
    ['must hold an active', 'FL'],
    ['1730', 'DC'],
    ['5100 Buckeyestown Pike Suite 200 Frederick', 'MD'],
    ['Urgent Care', 'FL'],
    ['or Canada', null],
  ])('drops "%s" (%s)', (city, stateCode) => {
    expect(storedLocality(city, stateCode)).toBeNull();
  });

  it('keeps a dataset town whose name carries a facility word', () => {
    expect(storedLocality('College Station', 'TX')).toBe('College Station');
    expect(storedLocality('Rockville Centre', 'NY')).toBe('Rockville Centre');
  });

  it('re-cases a lower-case town, trims a trailing dash and files a district under its town', () => {
    expect(storedLocality('san antonio', 'TX')).toBe('San Antonio');
    expect(storedLocality('austin', 'TX')).toBe('Austin');
    expect(storedLocality('tbd', 'TX')).toBeNull();
    expect(storedLocality('Boston-', 'MA')).toBe('Boston');
    expect(storedLocality('Uptown Dallas', 'TX')).toBe('Dallas');
    expect(storedLocality('Southwest Fort Worth', 'TX')).toBe('Fort Worth');
  });

  it('stores a known town in the dataset spelling the city pages count by', () => {
    expect(storedLocality('Saint Louis', 'MO')).toBe('St. Louis');
    expect(storedLocality('Ft. Worth', 'TX')).toBe('Fort Worth');
    expect(datasetSpellingOf('St. Louis', 'MO')).toBe('St. Louis');
    // No dataset town of that spelling: kept as written.
    expect(datasetSpellingOf('Saint Joseph', 'MI')).toBe('Saint Joseph');
  });

  it('every dataset town with a plain name is stored as written in its state', () => {
    const lost = CITIES
      .filter((c) => hasTownNameShape(c.name))
      .filter((c) => storedLocality(c.name, c.stateCode) !== c.name)
      .map((c) => `${c.name}, ${c.stateCode}`);
    expect(lost).toEqual([]);
  });
});

/**
 * Review round 3: a region of a state, or a described place, is not a town.
 * The parser read "Northern Virginia" as the town "Northern", "Upstate New
 * York" as "Upstate", and a "Location: Near Denver, CO" line as "Near
 * Denver"; each reached JobPosting addressLocality.
 */
describe('namesRegionNotTown: regions and described places are not towns', () => {
  const REGIONS = [
    'Northern', 'Southern', 'South', 'West', 'East', 'Central', 'Upstate', 'Downstate', 'Middle', 'Coastal', 'Rural',
    'Northeast', 'Southwestern', 'Metro', 'Statewide',
    'Northern Virginia', 'Central Pennsylvania', 'Southeastern Michigan', 'Upstate New York',
    'Near Denver', 'Our Denver', 'Outside Denver', 'Around Austin', 'Metro Detroit',
    'Twin Cities', 'Inland Empire', 'Hudson Valley', 'Gulf Coast', 'Central Coast', 'Eastern Shore', 'NoVA', 'SoCal',
    'South Jersey',
  ];

  it.each(REGIONS)('%s', (value) => {
    expect(namesRegionNotTown(value)).toBe(true);
    expect(plausibleLocality(value)).toBeNull();
  });

  it.each([
    ['Northern', 'VA'], ['South', 'FL'], ['Upstate', 'NY'], ['West', 'TX'], ['Metro Detroit', 'MI'],
    ['Near Denver', 'CO'], ['Our Denver', 'CO'], ['Northern Virginia', 'VA'], ['Twin Cities', 'MN'],
  ])('storedLocality drops "%s" (%s)', (city, stateCode) => {
    expect(storedLocality(city, stateCode)).toBeNull();
  });

  it.each(['North Las Vegas', 'West New York', 'West Palm Beach', 'Central Islip', 'Upper Arlington', 'Middle River', 'South Bend'])(
    'a town that starts with a direction is still a town: %s',
    (value) => {
      expect(namesRegionNotTown(value)).toBe(false);
      expect(plausibleLocality(value)).toBe(value);
    },
  );

  it('rejects exactly one dataset town, Central, LA, which ingest still stores through the dataset check', () => {
    const regions = CITIES.filter((c) => namesRegionNotTown(c.name)).map((c) => `${c.name}, ${c.stateCode}`);
    expect(regions).toEqual(['Central, LA']);
    expect(storedLocality('Central', 'LA')).toBe('Central');
  });
});

/**
 * Review round 4: qualifiers, placeholders, work arrangements and region
 * suffixes still passed and were stored as the town: "Within Texas" stored
 * "Within", "Unknown, TX" stored "Unknown", "Field-Based, TX" stored
 * "Field-Based" and "Houston Metro, TX" stored "Houston Metro". Each reached
 * JobPosting addressLocality.
 */
describe('qualifiers, placeholders, work arrangements and region suffixes are not towns', () => {
  const NOT_TOWNS = [
    // A qualifier left in front of a state name.
    'Within', 'Across', 'Any', 'Several', 'Entire State',
    // Placeholders.
    'Unknown', 'Other', 'None', 'Confidential', 'Undisclosed', 'Not Specified', 'Coming Soon', 'Opening Soon',
    'See Description', 'Flexible',
    // Work arrangements.
    'Field Based', 'Field-Based', 'Home Based', 'Home-Based',
    // Region suffixes.
    'Houston Metro', 'Phoenix Metro', 'DFW Metroplex', 'Houston Suburbs',
  ];

  it.each(NOT_TOWNS)('plausibleLocality and storedLocality drop "%s"', (value) => {
    expect(plausibleLocality(value)).toBeNull();
    expect(storedLocality(value, 'TX')).toBeNull();
  });

  it.each(['Unknown', 'Coming Soon', 'See Description', 'Flexible', 'Field Based', 'Home-Based'])(
    'namesPlaceholderNotTown: %s',
    (value) => {
      expect(namesPlaceholderNotTown(value)).toBe(true);
    },
  );

  it.each(['Within', 'Across', 'Any', 'Several', 'Entire State', 'Within Texas', 'Houston Metro', 'DFW Metroplex', 'Houston Suburbs'])(
    'namesRegionNotTown: %s',
    (value) => {
      expect(namesRegionNotTown(value)).toBe(true);
    },
  );

  it('real towns that share a word keep their current results', () => {
    expect(plausibleLocality('Home')).toBe('Home');
    expect(storedLocality('Home', 'PA')).toBe('Home');
    expect(plausibleLocality('Mobile')).toBe('Mobile');
    expect(storedLocality('Mobile', 'AL')).toBe('Mobile');
    expect(plausibleLocality('Normal')).toBe('Normal');
    expect(storedLocality('Normal', 'IL')).toBe('Normal');
    expect(plausibleLocality('North Charleston')).toBe('North Charleston');
    expect(storedLocality('North Charleston', 'SC')).toBe('North Charleston');
    expect(plausibleLocality('Metro Detroit')).toBeNull();
    for (const town of ['Home', 'Mobile', 'Normal', 'North Charleston', 'Anytown Road']) {
      expect(namesPlaceholderNotTown(town)).toBe(false);
    }
  });

  it('no dataset town is a placeholder or a work arrangement', () => {
    const hits = CITIES.filter((c) => namesPlaceholderNotTown(c.name)).map((c) => `${c.name}, ${c.stateCode}`);
    expect(hits).toEqual([]);
  });
});

/**
 * Review round 5: "Field - New Jersey" (Clover Health) stored the town
 * "Field", and "AH TAMPA PEPIN HEART INSTITUTE" passed as a town. Both
 * reached JobPosting addressLocality and the job page <title>.
 */
describe('"Field" and "Institute" are not towns', () => {
  it.each(['Field', 'AH TAMPA PEPIN HEART INSTITUTE', 'Heart Institute', 'Moffitt Institute'])('plausibleLocality drops "%s"', (value) => {
    expect(plausibleLocality(value)).toBeNull();
  });

  it.each([['Field', 'NJ'], ['AH TAMPA PEPIN HEART INSTITUTE', 'FL']])('storedLocality drops "%s" (%s)', (city, stateCode) => {
    expect(storedLocality(city, stateCode)).toBeNull();
  });

  it('a town that only contains the letters still passes', () => {
    for (const town of ['Springfield', 'Deerfield', 'Bloomfield Hills', 'Mansfield', 'Tampa']) {
      expect(plausibleLocality(town), town).toBe(town);
    }
    expect(storedLocality('Springfield', 'IL')).toBe('Springfield');
    expect(storedLocality('Tampa', 'FL')).toBe('Tampa');
  });

  it('no dataset town carries either word, so no known town is lost', () => {
    const hits = CITIES.filter((c) => /\b(?:field|institutes?)\b/i.test(c.name)).map((c) => `${c.name}, ${c.stateCode}`);
    expect(hits).toEqual([]);
  });
});

/**
 * Review round 6: street names, bare site, district and custody words and
 * facility codes still passed and were stored as the town. Probed through
 * ingest: "Location: Main St, CO" stored "Main St", "Oak Ave, TX" stored "Oak
 * Ave", "Location: Corporate, TX", "Downtown, TX" and "County Jail, TX"
 * stored the word. On the live site Clover Health's "Field - New Jersey"
 * rows read "(Field, NJ)", the Mental Health Cooperative rows "(MHC
 * Nashville, TN)", and AdventHealth's "AH TAMPA PEPIN HEART INSTITUTE" row
 * carried a site code as its city. Each reached JobPosting addressLocality
 * and the page <title>.
 */
describe('street names, site and district words and facility codes are not towns', () => {
  const STREETS = [
    'Main St', 'Main St.', 'Main Street', 'N Main St', 'Main St E', 'Oak Avenue', 'Oak Ave', 'Elm Avenue', 'Market Street',
    'Park Avenue', 'Sunset Blvd', 'Mill Rd', 'Lakeview Dr', 'Hwy', 'Highway', 'Route', 'County Road', 'PO Box', 'Box',
  ];
  const SITES = [
    'Field', 'Field -', 'Corporate', 'Main', 'Downtown', 'Uptown', 'Midtown', 'Westside', 'Eastside', 'West Side',
    'County Jail', 'Harris County Jail', 'Jail', 'Prison', 'State Prison', 'Detention', 'Detention Center',
  ];
  const CODES = [
    'AH TAMPA', 'AH ORLANDO', 'AH TAMPA PEPIN HEART INSTITUTE', 'MHC Nashville', 'MHC Cookeville', 'GBMC Towson',
    'SJAGA - Mercy Care Chamblee', 'UES & Brooklyn', 'MHC NASHVILLE', 'NW Portland',
  ];

  it.each(STREETS)('street "%s": plausibleLocality and storedLocality drop it', (value) => {
    expect(namesStreetFragment(value)).toBe(true);
    expect(plausibleLocality(value)).toBeNull();
    expect(storedLocality(value, 'CO')).toBeNull();
  });

  it.each(SITES)('site word "%s": plausibleLocality and storedLocality drop it', (value) => {
    expect(namesSiteNotTown(value)).toBe(true);
    expect(plausibleLocality(value)).toBeNull();
    expect(storedLocality(value, 'TX')).toBeNull();
  });

  it.each(CODES)('facility code "%s": plausibleLocality drops it', (value) => {
    expect(namesSiteNotTown(value)).toBe(true);
    expect(plausibleLocality(value)).toBeNull();
  });

  it('a district or a coded site in front of a known town is filed under the town', () => {
    expect(plausibleLocality('Downtown Atlanta')).toBe('Atlanta');
    expect(plausibleLocality('Uptown Dallas')).toBe('Dallas');
    expect(storedLocality('Downtown Atlanta', 'GA')).toBe('Atlanta');
    expect(storedLocality('MHC Nashville', 'TN')).toBe('Nashville');
    expect(storedLocality('MHC Cookeville', 'TN')).toBe('Cookeville');
    expect(storedLocality('AH TAMPA', 'FL')).toBe('Tampa');
    expect(facilityCodeRemainder('MHC Nashville')).toBe('Nashville');
    expect(facilityCodeRemainder('AH TAMPA')).toBe('TAMPA');
    // Not a known town behind the code: nothing is stored.
    expect(storedLocality('AH TAMPA PEPIN HEART INSTITUTE', 'FL')).toBeNull();
    expect(storedLocality('GBMC Hospital', 'MD')).toBeNull();
  });

  it('real towns that share a word or a shape still pass', () => {
    for (const town of [
      'Federal Way', 'Indian Trail', 'Temple Terrace', 'Miller Place', 'Mountlake Terrace', 'Franklin Square', 'Fox Crossing',
      'Sugarland Run', 'Parkway', 'Box Elder', 'Pike Creek Valley', 'Springfield', 'Deerfield', 'Mansfield', 'St. Paul',
      'Home', 'Mobile', 'Normal', 'Allen', 'Broadway', 'West Hollywood', 'South Portland', 'Southfield', 'Kansas City',
      'EL PASO', 'LA JOLLA', 'ST LOUIS', 'FT WORTH', 'NEW YORK', 'SALT LAKE CITY', 'RYE BROOK',
    ]) {
      expect(namesStreetFragment(town), town).toBe(false);
      expect(namesSiteNotTown(town), town).toBe(false);
      expect(plausibleLocality(town), town).toBe(town);
    }
    expect(storedLocality('Box Elder', 'SD')).toBe('Box Elder');
    expect(storedLocality('Federal Way', 'WA')).toBe('Federal Way');
    expect(storedLocality('Home', 'PA')).toBe('Home');
  });

  it('no dataset town is a street, a site word or a facility code, in any case', () => {
    const hits = CITIES.filter(
      (c) =>
        namesStreetFragment(c.name) ||
        namesSiteNotTown(c.name) ||
        namesStreetFragment(c.name.toUpperCase()) ||
        namesSiteNotTown(c.name.toUpperCase()),
    ).map((c) => `${c.name}, ${c.stateCode}`);
    expect(hits).toEqual([]);
  });

  it('a labelled line or title keeps the state and drops the street or site word', () => {
    for (const [description, stateCode] of [
      ['Location: Main St, CO', 'CO'],
      ['Location: Field, TX', 'TX'],
      ['Location: Corporate, TX', 'TX'],
      ['Location: County Jail, TX', 'TX'],
      ['Location: AH TAMPA PEPIN HEART INSTITUTE, FL', 'FL'],
    ] as const) {
      expect(resolveLocationFallback({ title: 'Nurse Practitioner', description }), description).toMatchObject({
        city: null,
        stateCode,
      });
    }
    expect(resolveLocationFallback({ title: 'Nurse Practitioner', description: 'Location: MHC Nashville, TN' })).toMatchObject({
      city: 'Nashville',
      stateCode: 'TN',
    });
    expect(resolveLocationFallback({ title: 'Nurse Practitioner - Field, TX', description: '' })).toMatchObject({
      source: 'title',
      city: null,
      stateCode: 'TX',
    });
  });

  it('the live rows reach JobPosting addressLocality without the false town', () => {
    const place = (city: string, state: string, stateCode: string, location: string) =>
      resolveJobPlaces({ title: 'Nurse Practitioner', location, city, state, stateCode, isRemote: false, isHybrid: false });
    expect(place('Field -', 'New Jersey', 'NJ', 'Field - New Jersey')).toEqual([{ locality: null, regionCode: 'NJ' }]);
    expect(place('Field -', 'Georgia', 'GA', 'Field - Georgia')).toEqual([{ locality: null, regionCode: 'GA' }]);
    expect(place('MHC Nashville', 'Tennessee', 'TN', 'MHC Nashville, TN')).toEqual([{ locality: null, regionCode: 'TN' }]);
    expect(place('Main St', 'Colorado', 'CO', 'Main St, CO')).toEqual([{ locality: null, regionCode: 'CO' }]);
    expect(place('Downtown Atlanta', 'Georgia', 'GA', 'Downtown Atlanta, GA')).toEqual([{ locality: 'Atlanta', regionCode: 'GA' }]);
    expect(place('Denver', 'Colorado', 'CO', 'Denver, CO')).toEqual([{ locality: 'Denver', regionCode: 'CO' }]);
  });
});

/**
 * PSEO-A handoff 8: a Chicago neighborhood sent as the city ("Irving Park",
 * "Lincoln Park" in IL) was stored as a town, so city pages counted it apart
 * from Chicago. Ingest now files it under Chicago through the same table the
 * directories fold by (neighborhoodParentOf in lib/pseo/neighborhood-parent.ts,
 * re-exported by lib/pseo/city-name-fold.ts).
 */
describe('storedLocality files a listed city neighborhood under its city', () => {
  it.each([
    ['Irving Park', 'IL'], ['Lincoln Park', 'IL'], ['lincoln park', 'IL'], ['Wicker Park-', 'IL'], ['The Loop', 'IL'],
  ])('"%s" (%s) is stored as Chicago', (city, stateCode) => {
    expect(storedLocality(city, stateCode)).toBe('Chicago');
  });

  it('the table is keyed by state: the same name elsewhere is left alone', () => {
    expect(neighborhoodParentOf('Lincoln Park', 'IL')).toBe('Chicago');
    expect(neighborhoodParentOf('Lincoln Park', 'MI')).toBeNull();
    expect(storedLocality('Lincoln Park', 'MI')).toBe('Lincoln Park');
    expect(neighborhoodParentOf('Chicago', 'IL')).toBeNull();
    expect(neighborhoodParentOf('Irving Park', null)).toBeNull();
  });

  it('a real Illinois town is still stored as written', () => {
    expect(storedLocality('Chicago', 'IL')).toBe('Chicago');
    expect(storedLocality('Oak Park', 'IL')).toBe('Oak Park');
    expect(storedLocality('Evanston', 'IL')).toBe('Evanston');
  });

  it('agrees with the read-time fold for every listed neighborhood', () => {
    for (const name of ['Albany Park', 'Hyde Park', 'Logan Square', 'River North', 'Streeterville']) {
      expect(storedLocality(name, 'IL'), name).toBe(foldCityName(name, 'IL'));
    }
  });
});

/**
 * The neighborhood table is a leaf module. lib/location-fallback.ts is on the
 * ingest path, the job page and the employer job routes (through
 * lib/job-page-indexing.ts); importing lib/pseo/city-name-fold.ts from it
 * loaded the full city dataset (lib/pseo/city-data/cities.ts, about 2 MB) into
 * every one of them and pushed the post-free route import past the test
 * timeout.
 */
describe('the neighborhood table stays off the full city dataset', () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

  it('lib/pseo/neighborhood-parent.ts has no imports', () => {
    const src = read('lib/pseo/neighborhood-parent.ts');
    expect(src).not.toMatch(/^\s*import\b/m);
    expect(src).not.toMatch(/\brequire\(/);
    expect(src).not.toMatch(/^\s*export\s[^;]*\bfrom\s/m);
  });

  it('lib/location-fallback.ts imports neither city-name-fold nor the full city dataset', () => {
    const src = read('lib/location-fallback.ts');
    expect(src).not.toMatch(/from\s+['"][^'"]*pseo\/city-name-fold['"]/);
    expect(src).not.toMatch(/from\s+['"][^'"]*city-data\/cities['"]/);
    expect(src).toContain("import { neighborhoodParentOf } from './pseo/neighborhood-parent';");
  });

  it('city-name-fold re-exports the same table the ingest guard reads', () => {
    expect(neighborhoodParentOf).toBe(leafNeighborhoodParentOf);
  });
});
