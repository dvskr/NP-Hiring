/**
 * lib/pseo/neighborhood-parent.ts
 *
 * City neighborhoods that job sources send as the city ("Irving Park", IL),
 * mapped to the city they belong to ("Chicago"). One table, read in two
 * places so a stored row and a directory tally agree:
 *   - at ingest, by lib/location-fallback.ts storedLocality, so a new row is
 *     filed under the parent city;
 *   - at read time, by lib/pseo/city-name-fold.ts foldCityName, so rows
 *     already stored under a neighborhood are tallied under the parent city.
 *
 * Deliberately a leaf module with no imports. lib/location-fallback.ts sits on
 * the ingest path, the job page and the employer job routes, and is built on
 * the slim city-slugs-edge set; importing lib/pseo/city-name-fold.ts from it
 * would load the full city dataset (lib/pseo/city-data/cities.ts, about 2 MB)
 * into every one of those modules.
 */

/**
 * Leading or trailing separators a location parser can leave on a city:
 * whitespace, commas, semicolons, slashes, hyphens and the en and em dash
 * (U+2013, U+2014, written as escapes so this file carries neither).
 */
export const EDGE_PUNCTUATION = /^[\s,;/\\\-–—]+|[\s,;/\\\-–—]+$/g;

/**
 * Neighborhoods that job sources send as the city, keyed by state code and
 * lowercase name. Chicago neighborhoods only, each checked against the
 * Illinois municipality names (Bridgeport, Chatham, Oakland, Riverdale,
 * Washington Park and Woodlawn are Illinois municipalities, so those
 * Chicago areas are left out on purpose).
 */
const NEIGHBORHOOD_PARENT: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  IL: {
    'albany park': 'Chicago',
    andersonville: 'Chicago',
    bronzeville: 'Chicago',
    bucktown: 'Chicago',
    'gold coast': 'Chicago',
    'humboldt park': 'Chicago',
    'hyde park': 'Chicago',
    'irving park': 'Chicago',
    'jefferson park': 'Chicago',
    'lincoln park': 'Chicago',
    'lincoln square': 'Chicago',
    'little village': 'Chicago',
    'logan square': 'Chicago',
    'near north side': 'Chicago',
    'near south side': 'Chicago',
    'near west side': 'Chicago',
    pilsen: 'Chicago',
    'portage park': 'Chicago',
    ravenswood: 'Chicago',
    'river north': 'Chicago',
    'rogers park': 'Chicago',
    'south loop': 'Chicago',
    streeterville: 'Chicago',
    'the loop': 'Chicago',
    'ukrainian village': 'Chicago',
    'west loop': 'Chicago',
    'wicker park': 'Chicago',
    wrigleyville: 'Chicago',
  },
};

/**
 * The city a neighborhood belongs to ("Irving Park", IL gives "Chicago"), or
 * null when the name is not a listed neighborhood of that state. Pure.
 */
export function neighborhoodParentOf(name: string | null | undefined, stateCode: string | null | undefined): string | null {
  const cleaned = name?.replace(EDGE_PUNCTUATION, '').replace(/\s+/g, ' ');
  if (!cleaned || !stateCode) return null;
  return NEIGHBORHOOD_PARENT[stateCode.trim().toUpperCase()]?.[cleaned.toLowerCase()] ?? null;
}
