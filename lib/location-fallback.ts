/**
 * lib/location-fallback.ts: where a posting's work site can be recovered
 * when its location field names no place (indexing audit CS-03, GFJ-02,
 * plan fixSoon 6).
 *
 * About 42 live jobs had no city, no state and no remote declaration, so
 * their JobPosting carried no jobLocation. Their location field said "2
 * Locations", "United States" or a facility name, but the place was written
 * elsewhere: in the title ("Nurse Practitioner - Denver, CO (Hybrid)",
 * "Nurse Practitioner- Terre Haute, IN - Hybrid Remote", "... Advance
 * Practice Provider, Iowa, Remote"), on a labelled line ("Location |
 * New York, New York", "Primary Location: St. Joseph, MI"), in a street
 * address at the top of the description ("2000 16th Street, Denver,
 * Colorado, 80202") or in a "work in City, State" phrase ("to work in St.
 * Joseph, Michigan").
 *
 * Ingest (lib/job-normalizer.ts) and the one-off repair script
 * (scripts/indexing-fixes/backfill-job-locations.ts through
 * planLocationBackfill) both call resolveLocationFallback, so new rows
 * arrive with the place and old rows converge on the same answer.
 *
 * The title has authority. It is the visible H1, so a jobLocation that
 * disagrees with it is false location data (audit CQ-02, GFJ-02). The
 * address at the top of a DaVita description is often another clinic: the
 * posting titled "Nurse Practitioner- Freehold, NJ- Hybrid Remote" opens
 * with "267 W Merrick Rd, Freeport, New York", and "Springboro/Miamisburg,
 * OH" opens with a Westerville address. So:
 *   1. A place the title names ("City, ST" with a known or confirmed town,
 *      a state name, or a bare state code segment such as
 *      "Midtown/Buckhead - GA") wins.
 *   2. Any other source (the Workday detail location, a labelled line, a top
 *      address line, a "work in" phrase) counts only when it agrees with the
 *      title: when the title names a state, a candidate in another state is
 *      skipped, and its city is kept only when the title names that city too.
 *   3. When the title names no place at all, the first other source that
 *      resolves to a US state wins.
 *
 * Never the first state name anywhere in the description: the skeptic review
 * found it wrong for Nashville (read as Virginia), Oklahoma City (read as
 * Texas) and Marion, AR (read as Virginia). A candidate whose city is not a
 * plausible town name (lib/locality.ts: role words, facility words, digits)
 * is rejected whole, so "Nurse Practitioner- Terre Haute" never becomes a
 * city. A title writes a specialty, setting, schedule, program or region in
 * front of the state as often as a town ("Nurse Practitioner - Urgent Care,
 * FL", "NP - Nights, AZ", "Float Pool, TX", "Greater Houston, TX"), so a
 * title town counts only when the city dataset (lib/pseo/city-data) knows it
 * in that state or the description writes it with that state; otherwise the
 * state is kept and the town is dropped. Two states in a row ("Georgia,
 * Alabama", "Ohio, Indiana") are two states, unless the dataset has a town
 * of exactly that name in the second one ("Washington, DC", "Indiana, PA").
 * A "work in City, State" phrase keeps its town only when the dataset knows
 * it or the title names it. Omission beats a wrong place.
 *
 * A labelled line needs a real label ("Location:", "Locations:", "Work
 * Location |", or the label alone on its line), and a top line counts as an
 * address only when it is shaped like one (a house number and a street
 * word, or a state and ZIP): "Locations: Denver, CO" once stored the town
 * "s: Denver", and "1 year of experience, must hold an active Florida
 * license" filed a job under Florida. A remote location line ("Location:
 * Remote - must reside in Texas") names a residence or licence requirement,
 * not a work site, so it is skipped. storedLocality is the last guard on
 * every city ingest stores, whatever its source.
 *
 * Pure: no database, no network.
 */
import { parseLocation } from './location-parser';
import {
  facilityCodeRemainder,
  hasTownNameShape,
  namesNonTownTitleWord,
  namesPlaceholderNotTown,
  namesRegionNotTown,
  namesSiteNotTown,
  namesStreetFragment,
  plausibleLocality,
} from './locality';
import { CITY_SLUGS } from './pseo/city-data/city-slugs-edge';
import { buildCityDatasetSlug } from './pseo/city-data/slugify';
import { neighborhoodParentOf } from './pseo/neighborhood-parent';

export type LocationFallbackSource =
  | 'workday_detail'
  | 'title'
  | 'description_label'
  | 'description_address'
  | 'description_phrase';

export interface LocationFallback {
  source: LocationFallbackSource;
  /** The text the place was read from, for logs and the repair script. */
  evidence: string;
  city: string | null;
  state: string | null;
  stateCode: string;
  /** "City, ST", or the state name when no city was named. */
  label: string;
}

const US_STATE_NAMES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware',
  'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky',
  'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi',
  'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico',
  'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania',
  'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont',
  'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming', 'District of Columbia',
];
/** Longest first, so "West Virginia" is read before "Virginia". */
const STATE_NAME_ALTERNATION = [...US_STATE_NAMES].sort((a, b) => b.length - a.length).join('|');
const US_STATE_NAME_RE = new RegExp(`^(?:${STATE_NAME_ALTERNATION})$`, 'i');
const STATE_NAME_MENTION_RE = new RegExp(`\\b(?:${STATE_NAME_ALTERNATION})\\b`, 'gi');
const UPPER_CODE_RE = /\b[A-Z]{2}\b/g;

/**
 * Two-letter state codes that are also a credential, a department or a
 * common abbreviation in a nursing job title: "NP/PA", "MD", "OR" (operating
 * room), "ID" (infectious disease), "VA" (Veterans Affairs), "LA" (Los
 * Angeles), "MA" (medical assistant), "MS", "ME", "CT" (cardiothoracic),
 * "MT". Standing alone they never file a job under a state; after a town
 * ("Pittsburgh, PA", "Richmond, VA") they do.
 */
const AMBIGUOUS_TITLE_CODES = new Set(['PA', 'MD', 'OR', 'ID', 'VA', 'LA', 'MA', 'MS', 'ME', 'CT', 'MT']);

/**
 * Title segment separators: a dash with whitespace on at least one side
 * ("Practitioner- Terre Haute", "IN - Hybrid", "NJ- Hybrid"), a bar, a
 * middle dot or bullet, or a bracket. A hyphen inside a word ("Winston-Salem")
 * is not a separator.
 */
const TITLE_SEGMENT_SPLIT_RE = /\s*[-–—]\s+|\s+[-–—]\s*|\s*[|·•]\s*|[()[\]]/;
/** A town name as written in a title: capitalised words, no digits. */
const TITLE_CITY_RE = /^[A-Z][A-Za-z .'-]*$/;

/**
 * A labelled location line: "Location: Denver, CO", "Locations: Denver,
 * CO", "Work Location | New York, New York", "Primary Location is St.
 * Joseph, MI", or the label alone on its line with the place on the next
 * ("Location" then "Denver, CO"). The label must end in a separator, "is"
 * or a line break: without one, "Locations: Denver, CO" was read as
 * "Location" + "s: Denver, CO" and stored the town "s: Denver".
 */
const LABELLED_LOCATION_RE =
  /^[ \t]*(?:primary\s+|work\s+|job\s+)?locations?(?:[ \t]*[:|\-–][ \t]*|[ \t]+is[ \t]+|[ \t]*\r?\n\s*)(\S.{2,99})$/gim;
const WORK_IN_PHRASE_RE =
  /\b(?:work|working|located|based|position|clinic|office|practice|site)\s+(?:is\s+)?(?:in|at)\s+((?:[A-Z][A-Za-z.'-]*\s?){1,4},\s*(?:[A-Z]{2}\b|[A-Z][a-z]+(?:\s[A-Z][a-z]+)?))/g;
/** Only the top of a description carries the work-site address. */
const ADDRESS_LINE_WINDOW = 6;

/**
 * A street address line at the top of a description: a house number, then a
 * street name ending in a street word that is followed by a comma, a
 * direction, a unit or the end of the text ("2000 16th Street, Denver,
 * Colorado, 80202", "267 W Merrick Rd, Freeport, New York", "5100
 * Buckeyestown Pike Suite 200 Frederick, MD 21704"), or a line ending in a
 * state and a 5-digit ZIP. A line such as "1 year of experience, must hold
 * an active Florida license" starts with a number too but is not an
 * address, and its state is a licence, not a work site.
 */
const STREET_ADDRESS_LINE_RE = new RegExp(
  '^\\s*\\d{1,6}[A-Za-z]?(?:-\\d{1,6})?\\s+(?:[A-Za-z0-9.\'#-]+\\s+){0,5}?' +
    '(?:st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|pkwy|parkway|way|ln|lane|hwy|highway|pike|ct|court|' +
    'pl|place|cir|circle|ter|terrace|trl|trail|plz|plaza|sq|square|loop|broadway|row|crossing|tpke|turnpike|expy|expressway)' +
    '\\.?(?=\\s*(?:,|$|(?:n|s|e|w|ne|nw|se|sw|north|south|east|west)\\b|(?:suite|ste|unit|bldg|building|floor|fl|room|rm)\\b|#))',
  'i',
);
const STATE_ZIP_LINE_RE = new RegExp(
  `,\\s*(?:[A-Z]{2}|${STATE_NAME_ALTERNATION})\\s*,?\\s*\\d{5}(?:-\\d{4})?\\b`,
);

/** True for a street address line (see STREET_ADDRESS_LINE_RE). */
export function isStreetAddressLine(line: string): boolean {
  return /^\s*\d/.test(line) && (STREET_ADDRESS_LINE_RE.test(line) || STATE_ZIP_LINE_RE.test(line));
}

interface UsPlace {
  city: string | null;
  state: string | null;
  stateCode: string;
}

/**
 * City dataset slugs that look like a state-named town but belong to a town
 * whose name ends in "City": the dataset drops that word from the slug
 * ("kansas-mo" is Kansas City, "michigan-in" is Michigan City). Without this
 * list "Kansas, Missouri" in a title would read as a town "Kansas" in
 * Missouri. The dataset is frozen (lib/pseo/city-data/cities.ts header), and
 * tests/lib/job-normalizer-work-mode.test.ts checks this list against it.
 */
const CITY_SUFFIX_DROPPED_SLUGS: ReadonlySet<string> = new Set([
  'arkansas-ks', 'california-ca', 'florida-fl', 'iowa-ia', 'kansas-ks', 'kansas-mo',
  'maryland-md', 'michigan-in', 'missouri-tx', 'oklahoma-ok', 'oregon-or', 'texas-tx',
]);

/**
 * Towns the city dataset files under a formal name that no job title
 * writes: consolidated city and county governments and census places
 * ("Nashville-Davidson", "Urban Honolulu", "Indianapolis city (balance)").
 * Keyed by the slug of the common name, valued by the dataset slug;
 * tests/lib/job-normalizer-work-mode.test.ts checks every value against
 * CITY_SLUGS.
 */
export const COMMON_NAME_TOWN_SLUGS: Readonly<Record<string, string>> = {
  'athens-ga': 'athens-clarke-county-ga',
  'augusta-ga': 'augusta-richmond-county-ga',
  'bull-run-va': 'bull-run-cdp-prince-william-county-va',
  'butte-mt': 'butte-silver-bow-balance-mt',
  'el-sobrante-ca': 'el-sobrante-cdp-contra-costa-county-ca',
  'fairwood-wa': 'fairwood-cdp-king-county-wa',
  'hartsville-tn': 'hartsvilletrousdale-county-tn',
  'honolulu-hi': 'urban-honolulu-hi',
  'indianapolis-in': 'indianapolis-city-balance-in',
  'kailua-hi': 'kailua-cdp-honolulu-county-hi',
  'kearns-ut': 'kearns-metro-township-ut',
  'lakeside-ca': 'lakeside-cdp-san-diego-county-ca',
  'lexington-ky': 'lexington-fayette-urban-county-ky',
  'macon-ga': 'macon-bibb-county-ga',
  'magna-ut': 'magna-metro-township-ut',
  'midway-fl': 'midway-cdp-santa-rosa-county-fl',
  'milford-ct': 'milford-city-balance-ct',
  'nashville-tn': 'nashville-davidson-tn',
  'paso-robles-ca': 'el-paso-de-robles-paso-robles-ca',
  'pine-ridge-fl': 'pine-ridge-cdp-citrus-county-fl',
  'rose-hill-va': 'rose-hill-cdp-fairfax-county-va',
  'spring-valley-ca': 'spring-valley-cdp-san-diego-county-ca',
  'ventura-ca': 'san-buenaventura-ventura-ca',
  'woodlawn-md': 'woodlawn-cdp-baltimore-county-md',
  'woodlawn-va': 'woodlawn-cdp-fairfax-county-va',
};

/** Spellings a title uses for the dataset's "St.", "Fort" and "Mount". */
const TOWN_NAME_SPELLINGS: ReadonlyArray<[RegExp, string]> = [
  [/^Saint\s+/i, 'St. '],
  [/^Ft\.?\s+/i, 'Fort '],
  [/^Mt\.?\s+/i, 'Mount '],
];

/**
 * The dataset slugs a town name can be filed under: as written, without
 * apostrophes ("Lees Summit"), without a trailing "City", "Village" or
 * "Town" (the dataset drops it: "kansas-mo" is Kansas City), and with a
 * common spelling ("Saint Louis" as "St. Louis").
 */
function datasetSlugsOf(name: string, stateCode: string): string[] {
  const base = name.trim().replace(/\s+/g, ' ');
  const forms = [base, base.replace(/['’]/g, ''), base.replace(/\s+(?:City|Village|Town)$/i, '')];
  for (const [re, spelling] of TOWN_NAME_SPELLINGS) {
    if (re.test(base)) forms.push(base.replace(re, spelling));
  }
  return forms.map((form) => buildCityDatasetSlug(form, stateCode)).filter(Boolean);
}

/**
 * True when a full state name is also a real town in the given state:
 * "Washington, DC", "Indiana, PA", "New York, NY", "Oregon, WI". Otherwise
 * a state name in front of another state is a second state ("Georgia,
 * Alabama"), never a town.
 */
export function isTownNamedLikeState(name: string, stateCode: string): boolean {
  if (!US_STATE_NAME_RE.test(name.trim())) return false;
  const slug = buildCityDatasetSlug(name.trim(), stateCode);
  return CITY_SLUGS.has(slug) && !CITY_SUFFIX_DROPPED_SLUGS.has(slug);
}

/**
 * True when the city dataset (lib/pseo/city-data, 4,135 US towns) has this
 * town in this state. A title writes a specialty, a program, a schedule or
 * a region where a town would go as often as a town ("Float Pool, TX",
 * "Sign On Bonus, TX", "Greater Houston, TX", "Ortho, OH"); no word list
 * can name them all, so a title town must be a known town or be confirmed
 * by the description (see titleCityOf).
 */
export function isKnownTown(name: string, stateCode: string): boolean {
  if (US_STATE_NAME_RE.test(name.trim())) return isTownNamedLikeState(name, stateCode);
  return datasetSlugsOf(name, stateCode).some(
    (slug) => CITY_SLUGS.has(slug) || Object.prototype.hasOwnProperty.call(COMMON_NAME_TOWN_SLUGS, slug),
  );
}

/**
 * The dataset's spelling of a known town written another way: "Saint Louis"
 * as "St. Louis", "Ft. Worth" as "Fort Worth", "Mt. Pleasant" as "Mount
 * Pleasant". City pages count rows by the dataset name, so a row stored as
 * written would be missing from them. The name as written is returned when
 * the dataset files it under that spelling, or when no variant matches.
 */
export function datasetSpellingOf(name: string, stateCode: string): string {
  const base = name.trim().replace(/\s+/g, ' ');
  if (CITY_SLUGS.has(buildCityDatasetSlug(base, stateCode))) return base;
  for (const [re, spelling] of TOWN_NAME_SPELLINGS) {
    if (!re.test(base)) continue;
    const variant = base.replace(re, spelling);
    if (CITY_SLUGS.has(buildCityDatasetSlug(variant, stateCode))) return variant;
  }
  return base;
}

/** A district word in front of a town name, as lib/pseo/city-name-fold.ts reads it. */
const DISTRICT_PREFIX_RE = /^(?:downtown|uptown|midtown|southwest|southeast|northwest|northeast)\s+(.+)$/i;

/** "san antonio" as "San Antonio": a lower-case source value, re-cased for the dataset check. */
function titleCaseWords(value: string): string {
  return value.replace(/(^|[\s-])([a-z])/g, (_m, sep: string, ch: string) => `${sep}${ch.toUpperCase()}`);
}

/**
 * The city value ingest may store for a place in `stateCode`, or null
 * (indexing audit CQ-02: no junk city reaches the city column, the city
 * tallies or JobPosting addressLocality). A town the city dataset knows in
 * that state is kept, even when a facility word is part of its name
 * ("College Station", "Rockville Centre"), in the dataset's spelling
 * ("Saint Louis" as "St. Louis", "Ft. Worth" as "Fort Worth") so the city
 * pages count it; a lower-case source value the dataset knows is stored
 * re-cased ("san antonio" as "San Antonio"); a district of a known town is
 * filed under the town ("Uptown Dallas" as "Dallas"), a site behind a
 * facility code under its town ("MHC Nashville" as "Nashville", "AH TAMPA"
 * as "Tampa"), and a listed city neighborhood under its city ("Irving
 * Park", IL as "Chicago"; the table in lib/pseo/neighborhood-parent.ts).
 * Anything else must pass plausibleLocality: digits, street names ("Main
 * St"), site words ("Field", "Corporate", "County Jail"), facility and
 * specialty words, sentence fragments ("must reside in", "s: Denver") and
 * list debris ("or Canada") are dropped, and the state is kept.
 */
export function storedLocality(city: string | null | undefined, stateCode: string | null | undefined): string | null {
  const cleaned = city?.replace(/\s+/g, ' ').trim().replace(/^[\s,;:.\-–]+|[\s,;:.\-–]+$/g, '').trim();
  if (!cleaned || /\d/.test(cleaned)) return null;
  if (stateCode) {
    // A lower-case source value is compared, and stored, re-cased.
    const candidate = /[A-Z]/.test(cleaned) ? cleaned : titleCaseWords(cleaned);
    if (hasTownNameShape(cleaned) && isKnownTown(candidate, stateCode)) return datasetSpellingOf(candidate, stateCode);
    // "Uptown Dallas", "Southwest Fort Worth": a district of a known town is filed under the town.
    const district = cleaned.match(DISTRICT_PREFIX_RE);
    if (district && isKnownTown(district[1], stateCode)) return datasetSpellingOf(district[1], stateCode);
    // "MHC Nashville", "AH TAMPA": a site behind a facility code is filed under its known town.
    const coded = facilityCodeRemainder(cleaned);
    if (coded) {
      const town = /[a-z]/.test(coded) ? coded : titleCaseWords(coded.toLowerCase());
      if (hasTownNameShape(town) && isKnownTown(town, stateCode)) return datasetSpellingOf(town, stateCode);
    }
    // "Irving Park", "Lincoln Park" (IL): a city neighborhood is filed under its city,
    // the same table the directories fold by (lib/pseo/neighborhood-parent.ts, a leaf
    // module: importing lib/pseo/city-name-fold.ts here would load the full city dataset).
    const parent = neighborhoodParentOf(cleaned, stateCode);
    if (parent) return datasetSpellingOf(parent, stateCode);
  }
  return plausibleLocality(cleaned);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The state name for a code ("NJ" gives "New Jersey"), or null. */
function stateNameOf(stateCode: string): string | null {
  const p = parseLocation(stateCode);
  return p.stateCode === stateCode ? p.state : null;
}

/**
 * True when the description writes this town with its state, as the DaVita
 * postings do ("join our team in Freehold, NJ", "Location: Lead, South
 * Dakota"). Exact case, so "Home, in" is not "Home, IN".
 */
function descriptionNamesTown(description: string, town: string, stateCode: string): boolean {
  const stateName = stateNameOf(stateCode);
  const state = stateName ? `${stateCode}|${escapeRegExp(stateName)}` : stateCode;
  return new RegExp(`(?:^|[^A-Za-z])${escapeRegExp(town)},?\\s+(?:${state})(?![A-Za-z])`).test(description);
}

/** The state code a whole token names ("GA", "Iowa", "New Jersey"), or null. */
function stateCodeOfToken(token: string): string | null {
  const t = token.trim();
  const isCode = /^[A-Z]{2}$/.test(t);
  if (!isCode && !US_STATE_NAME_RE.test(t)) return null;
  const p = parseLocation(t);
  if (p.country !== 'US' || !p.stateCode) return null;
  return isCode && p.stateCode !== t ? null : p.stateCode;
}

/**
 * A US place, or null when the text names no US state or names a city that
 * is not a plausible town ("Nurse Practitioner- Terre Haute", "MAIN
 * CAMPUS", a street number). A specialty, setting, schedule, region,
 * placeholder, work arrangement, street name, site or district word or
 * facility code where the town would be ("Urgent Care, FL", "Greater
 * Houston Area, TX", "West Texas", "Near Denver, CO", "Houston Metro, TX",
 * "Coming Soon, TX", "Field Based, TX", "Main St, CO", "Field, TX", "County
 * Jail, TX", "AH TAMPA PEPIN HEART INSTITUTE, FL") keeps the state and
 * drops the town. The city comes back cleaned.
 */
function usPlaceFrom(text: string): UsPlace | null {
  const p = parseLocation(text);
  if (p.country !== 'US' || !p.stateCode) return null;
  const stateOnly: UsPlace = { city: null, state: p.state, stateCode: p.stateCode };
  if (!p.city) return stateOnly;
  // The ingest guard: a known town is kept (re-cased, in the dataset
  // spelling) even with a facility word in its name ("College Station").
  const city = storedLocality(p.city, p.stateCode);
  if (city) return { ...stateOnly, city };
  const keepsState =
    namesNonTownTitleWord(p.city) ||
    namesRegionNotTown(p.city) ||
    namesPlaceholderNotTown(p.city) ||
    namesStreetFragment(p.city) ||
    namesSiteNotTown(p.city);
  return keepsState ? stateOnly : null;
}

/**
 * The town in front of a state in a title ("Springboro/Miamisburg" reads as
 * "Springboro"), or null. It must read as a town (no role, facility,
 * specialty, setting or schedule word: lib/locality.ts), and it must be a
 * town the city dataset knows in that state or one the description writes
 * with that state. A state name is a town only when the dataset has it
 * ("Washington, DC"), never "Georgia" in front of Alabama.
 */
function titleCityOf(text: string | undefined, stateCode: string, description: string): string | null {
  const first = (text ?? '').split('/')[0].trim();
  if (!TITLE_CITY_RE.test(first)) return null;
  const city = plausibleLocality(first);
  if (!city) return null;
  if (isKnownTown(city, stateCode)) return city;
  if (US_STATE_NAME_RE.test(city)) return null;
  return descriptionNamesTown(description, city, stateCode) ? city : null;
}

/**
 * Places the title names, in title order: "City, ST" pairs (the town right
 * in front of the state, first of a slash pair; see titleCityOf), then
 * whole segments or comma parts that are a state name or an unambiguous
 * state code. A state name directly followed by another state is a town
 * only when the city dataset has that town ("Washington, DC", "Indiana,
 * PA"); otherwise both are states ("Georgia, Alabama"). Bare codes are
 * skipped in an all-capitals title ("NURSE PRACTITIONER - OR"), where "IN"
 * or "OR" is as likely a word. The description, when given, can confirm a
 * town the dataset does not know.
 */
export function titleLocationCandidates(title: string, description = ''): string[] {
  const allCaps = !/[a-z]/.test(title) && /[A-Z]{3,}/.test(title);
  const out: string[] = [];
  for (const segment of title.split(TITLE_SEGMENT_SPLIT_RE)) {
    const parts = (segment ?? '').split(',').map((s) => s.trim());
    parts.forEach((part, i) => {
      const stateCode = stateCodeOfToken(part);
      if (!stateCode) return;
      const nextCode = i + 1 < parts.length ? stateCodeOfToken(parts[i + 1]) : null;
      // The town of "Washington, DC": read with the state that follows.
      if (nextCode && isTownNamedLikeState(part, nextCode)) return;
      const city = i > 0 ? titleCityOf(parts[i - 1], stateCode, description) : null;
      if (city) {
        out.push(`${city}, ${part}`);
        return;
      }
      if (part.length === 2 && (allCaps || AMBIGUOUS_TITLE_CODES.has(part))) return;
      out.push(part);
    });
  }
  return out;
}

/**
 * Every state the title mentions, loosely: a state name anywhere ("Northern
 * Virginia", "New Jersey NP") and an upper-case state code ("Freehold NJ").
 * An ambiguous code counts only right after a town-like word ("Richmond
 * VA"), so "NP/PA" names no state. Used only to veto other sources, so a
 * false mention can only lose a place, never file a job under a wrong one.
 */
export function titleStateMentions(title: string): Set<string> {
  const codes = new Set<string>();
  for (const m of title.matchAll(STATE_NAME_MENTION_RE)) {
    const code = stateCodeOfToken(m[0]);
    if (code) codes.add(code);
  }
  for (const m of title.matchAll(UPPER_CODE_RE)) {
    const code = stateCodeOfToken(m[0]);
    if (!code) continue;
    if (AMBIGUOUS_TITLE_CODES.has(code)) {
      const before = title.slice(0, m.index).match(/([A-Za-z][A-Za-z.'-]*),?\s+$/);
      if (!before || !plausibleLocality(before[1]) || !/^[A-Z]/.test(before[1])) continue;
    }
    codes.add(code);
  }
  return codes;
}

/** True when the title names this town ("St. Joseph" in "NP/PA - Inpatient Psychiatry - St. Joseph"). */
function titleNamesCity(title: string, city: string): boolean {
  return new RegExp(`(?:^|[^A-Za-z])${escapeRegExp(city)}(?:$|[^A-Za-z])`, 'i').test(title);
}

/** Candidates other than the title, in order of trust (see the header). */
function otherCandidatesOf(input: {
  description: string | null | undefined;
  workdayPrimaryLocation?: string | null;
}): Array<{ source: LocationFallbackSource; text: string }> {
  const description = input.description ?? '';
  const candidates: Array<{ source: LocationFallbackSource; text: string }> = [];
  if (input.workdayPrimaryLocation) candidates.push({ source: 'workday_detail', text: input.workdayPrimaryLocation });
  LABELLED_LOCATION_RE.lastIndex = 0;
  for (const m of description.matchAll(LABELLED_LOCATION_RE)) candidates.push({ source: 'description_label', text: m[1] });
  for (const line of description.split('\n').slice(0, ADDRESS_LINE_WINDOW)) {
    if (isStreetAddressLine(line)) candidates.push({ source: 'description_address', text: line.trim() });
  }
  WORK_IN_PHRASE_RE.lastIndex = 0;
  for (const m of description.matchAll(WORK_IN_PHRASE_RE)) candidates.push({ source: 'description_phrase', text: m[1] });
  return candidates;
}

function toFallback(source: LocationFallbackSource, evidence: string, place: UsPlace): LocationFallback {
  return {
    source,
    evidence,
    city: place.city,
    state: place.state,
    stateCode: place.stateCode,
    label: place.city ? `${place.city}, ${place.stateCode}` : place.state ?? place.stateCode,
  };
}

/** The first title place, preferring one that names a town. */
function titlePlaceOf(title: string, description: string): LocationFallback | null {
  const places = titleLocationCandidates(title, description)
    .map((text) => ({ text, place: usPlaceFrom(text) }))
    .filter((c): c is { text: string; place: UsPlace } => c.place !== null);
  const best = places.find((c) => c.place.city) ?? places[0];
  return best ? toFallback('title', best.text, best.place) : null;
}

/**
 * A "work in City, State" phrase is the loosest source: "based at Mercy,
 * OH" names a hospital, "located in Greater Houston, TX" a region. Its town
 * counts only when the city dataset knows it or the title names it too;
 * otherwise only the state is kept. Labelled lines, top address lines and
 * the Workday location name a place by construction and keep their town.
 */
function phraseTownChecked(source: LocationFallbackSource, place: UsPlace, title: string): UsPlace {
  if (source !== 'description_phrase' || !place.city) return place;
  if (isKnownTown(place.city, place.stateCode) || titleNamesCity(title, place.city)) return place;
  return { ...place, city: null };
}

/**
 * Where the posting's work site is, or null. Callers decide when to use it:
 * ingest only for a location field that names no US state on a row that is
 * not fully remote.
 */
export function resolveLocationFallback(input: {
  title: string;
  description: string | null | undefined;
  workdayPrimaryLocation?: string | null;
}): LocationFallback | null {
  const title = input.title ?? '';
  const fromTitle = titlePlaceOf(title, input.description ?? '');
  if (fromTitle?.city) return fromTitle;

  const titleStates = titleStateMentions(title);
  if (fromTitle) titleStates.add(fromTitle.stateCode);

  for (const c of otherCandidatesOf(input)) {
    // A remote location line ("Location: Remote - must reside in Texas",
    // "Location: Remote, must be licensed in the state of Florida") names a
    // residence or licence requirement, not a work site.
    if (parseLocation(c.text).isRemote) continue;
    const found = usPlaceFrom(c.text);
    if (!found) continue;
    const place = phraseTownChecked(c.source, found, title);
    if (titleStates.size === 0) return toFallback(c.source, c.text, place);
    // The title names a state: another state contradicts the H1.
    if (!titleStates.has(place.stateCode)) continue;
    // Same state, and the title names this town too: the source refines it.
    if (place.city && titleNamesCity(title, place.city)) return toFallback(c.source, c.text, place);
    // Same state, another town: only the state is certain.
    if (!fromTitle) return toFallback(c.source, c.text, { ...place, city: null });
  }
  return fromTitle;
}

/** True when a location field names a US state (so no fallback is needed). */
export function locationNamesUsState(location: string | null | undefined): boolean {
  return !!parseLocation(location ?? '').stateCode;
}
