/**
 * Location Parser
 * Parses and standardizes job locations
 */

import { prisma } from './prisma';
import { hasTownNameShape, plausibleLocality } from './locality';
import { CITY_SLUGS } from './pseo/city-data/city-slugs-edge';
import { buildCityDatasetSlug } from './pseo/city-data/slugify';

export interface ParsedLocation {
  city: string | null;
  state: string | null;
  stateCode: string | null;
  /**
   * ISO 3166-1 alpha-2 code of the country the string names. 'US' unless the
   * string itself names another country ("Toronto, ON", "Baghdad, Iraq").
   */
  country: string;
  isRemote: boolean;
  isHybrid: boolean;
  originalLocation: string;
  confidence: number; // 0-1
}

// State name to code mappings
const STATE_CODES: Record<string, string> = {
  'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR',
  'California': 'CA', 'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE',
  'Florida': 'FL', 'Georgia': 'GA', 'Hawaii': 'HI', 'Idaho': 'ID',
  'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA', 'Kansas': 'KS',
  'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
  'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS',
  'Missouri': 'MO', 'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH', 'Oklahoma': 'OK',
  'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT',
  'Vermont': 'VT', 'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV',
  'Wisconsin': 'WI', 'Wyoming': 'WY', 'District of Columbia': 'DC',
};

// Code to state name mappings
const CODE_TO_STATE: Record<string, string> = Object.entries(STATE_CODES)
  .reduce((acc, [state, code]) => ({ ...acc, [code]: state }), {} as Record<string, string>);

// Remote/Hybrid indicators (live-review item 1e).
//
// The previous keyword list treated substrings as remote proof and flagged
// verifiably onsite rows:
//   - 'united states' / 'nationwide' are COUNTRY markers, not work-mode
//     markers — 'Los Angeles, CA, United States' is an onsite location
//     (the Tia '- Onsite' rows were published as Remote through this).
//   - 'telehealth' / 'telepsychiatry' / 'virtual' are service-line words;
//     telehealth clinics hire onsite staff, and 'Virtual Care Center' is a
//     building name.
// A LOCATION string only proves remote when it carries a standalone
// remote / work-from-home token (word-boundary, not substring).
const REMOTE_LOCATION_RE = /\bremote\b|\bwork[\s-]?from[\s-]?home\b|\bwfh\b|\banywhere\b/i;

// 'flexible' alone describes a schedule, not a work mode — dropped.
const HYBRID_LOCATION_RE = /\bhybrid\b|\bpartial(?:ly)?[\s-]remote\b/i;

// District of Columbia abbreviations. Sources often write the District as
// "D.C.", but no pattern in parseLocation can read the dotted form: the
// code patterns need two bare letters and the name patterns reject dots.
// "Washington, D.C." therefore fell through to the state-name scan, which
// matched "Washington" and filed the listing under Washington state with no
// city, and "Washington D.C." (no comma) was skipped there as a compound
// city name and lost. Rewriting the token to the bare code "DC" lets the
// existing "City, ST" and state-code patterns resolve it to the District.
// Covers "D.C.", "D.C", "D. C." in any case; the lookbehind keeps it from
// matching inside a longer dotted abbreviation.
const DOTTED_DC_RE = /(?<![\w.])D\.\s?C\b\.?/gi;
// The bare state-code pattern reads upper-case pairs only (so ordinary
// words are never taken for codes), which lost "washington dc" typed in
// lower case. A "dc" directly after "Washington" is the District's code.
const WASHINGTON_LOWERCASE_DC_RE = /\b(washington\s*,?\s*)dc\b/gi;

function normalizeDistrictOfColumbia(text: string): string {
  return text
    .replace(DOTTED_DC_RE, 'DC')
    .replace(WASHINGTON_LOWERCASE_DC_RE, '$1DC');
}

// ── Street addresses (indexing audit CQ-02) ─────────────────────────────
// ATS feeds often put a full street address in the location field:
// "1730 Rhode Island Ave NW, Washington, DC, 20036" was filed as city
// "1730", state RI (the state-name scan matched the STREET name), and
// "5100 Buckeyestown Pike Suite 200 Frederick, MD 21704" kept the whole
// address as its city. A segment is only treated as an address when it
// starts with a house number, so place names that merely contain a
// street word ("Washington Court House", "Eagle Pass") are never cut.
const HOUSE_NUMBER_RE = /^\d+(?:-\d+)?[A-Za-z]?\s+/;
const STREET_SUFFIX_WORDS =
  'ave|avenue|st|street|blvd|boulevard|rd|road|dr|drive|pike|way|hwy|highway|ln|lane|ct|court|' +
  'pl|place|pkwy|parkway|ter|terrace|cir|circle|sq|square|trl|trail|tpke|turnpike|expy|expressway|' +
  'plz|plaza|broadway|row|loop|crossing|xing|run';
const STREET_DIRECTIONAL =
  '(?:n|s|e|w|ne|nw|se|sw|north|south|east|west|northeast|northwest|southeast|southwest)';
/** Last street-suffix word (plus an optional directional) inside an address segment. */
const STREET_SUFFIX_END_RE = new RegExp(
  `\\b(?:${STREET_SUFFIX_WORDS})\\b\\.?(?:\\s+${STREET_DIRECTIONAL}\\b\\.?)?`,
  'gi',
);
/** A state NAME immediately followed by a street suffix is a street ("Rhode Island Ave"). */
const FOLLOWED_BY_STREET_SUFFIX_RE = new RegExp(`^\\s+(?:${STREET_SUFFIX_WORDS})\\b`, 'i');
/** Suite / floor / unit designators; the city follows the last one. */
const UNIT_MARKER_RE =
  /\b(?:suite|ste|unit|bldg|building|room|rm|apt)\b\.?\s*#?\s*[A-Za-z]?\d+[A-Za-z]?\b|#\s*\d+[A-Za-z]?\b|\b\d+(?:st|nd|rd|th)\s+(?:floor|fl)\b\.?|\b(?:floor|fl)\.?\s+\d+\b/gi;

/**
 * Words that mark a facility or organisation rather than a place. Used only
 * where no state anchors the string (the last-resort city) and to drop a
 * facility prefix such as "Main Campus - Kansas City", so real city names
 * that contain these words ("College Station, TX") are unaffected.
 */
const FACILITY_WORD_RE =
  /\b(?:hospital|clinic|campus|specialists|associates|psychiatr(?:ic|y)|behavioral|healthcare|health|medical|practice|offices?|building|locations?|department|dept|facility|services|group|inc|llc|center|centre)\b/i;
/**
 * The subset of facility words no US place name contains. Applied to every
 * city candidate, so a practice named "SMG ... Specialists, VA" keeps its state but
 * never publishes the practice name as the city, while "College Station",
 * "Medical Lake" and "Rockville Centre" still parse.
 */
const STRONG_FACILITY_WORD_RE =
  /\b(?:hospital|clinic|campus|specialists|associates|psychiatr(?:ic|y)|behavioral|healthcare|practice|offices?|department|dept|facility|llc|inc|pllc|locations)\b/i;

function lastMatchEnd(re: RegExp, text: string): number {
  re.lastIndex = 0;
  let end = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    end = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++;
  }
  re.lastIndex = 0;
  return end;
}

/**
 * Strip a leading street address from a segment that starts with a house
 * number: "5100 Buckeyestown Pike Suite 200 Frederick" → "Frederick",
 * "1730 Rhode Island Ave NW" → "" (the segment was only an address).
 */
function stripStreetAddress(segment: string): string {
  const afterUnit = lastMatchEnd(UNIT_MARKER_RE, segment);
  if (afterUnit >= 0) return segment.slice(afterUnit).trim();
  const afterSuffix = lastMatchEnd(STREET_SUFFIX_END_RE, segment);
  if (afterSuffix >= 0) return segment.slice(afterSuffix).trim();
  return '';
}

/** Spelled-out street words → the abbreviation, so format variants of one address compare equal. */
const STREET_WORD_CANONICAL: Readonly<Record<string, string>> = {
  avenue: 'ave', street: 'st', boulevard: 'blvd', road: 'rd', drive: 'dr', highway: 'hwy',
  lane: 'ln', court: 'ct', place: 'pl', parkway: 'pkwy', terrace: 'ter', circle: 'cir',
  square: 'sq', trail: 'trl', turnpike: 'tpke', expressway: 'expy', plaza: 'plz', crossing: 'xing',
  north: 'n', south: 's', east: 'e', west: 'w',
  northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw',
};

/**
 * The street address at the front of a location string, normalized for
 * comparison, or null when the string has none. "4200 Wisconsin Ave NW,
 * Washington, DC, 20016" → "4200 wisconsin ave nw"; "5100 Buckeyestown
 * Pike Suite 200 Frederick, MD 21704" → "5100 buckeyestown pike". Suite,
 * floor and unit designators are dropped (one building is one work site),
 * and spelled-out street words are abbreviated ("Avenue" → "ave"). The
 * deduplicator uses it so two clinics of one employer in the same city
 * never collapse into one posting.
 */
export function leadingStreetAddress(location: string | null | undefined): string | null {
  if (!location) return null;
  const text = location.replace(/\s+/g, ' ').trim();
  const segment = text.split(/\s*[,|]\s*/).map((s) => s.trim()).find((s) => HOUSE_NUMBER_RE.test(s));
  if (!segment) return null;
  const rest = stripStreetAddress(segment);
  const street = rest ? segment.slice(0, segment.length - rest.length) : segment;
  UNIT_MARKER_RE.lastIndex = 0;
  const normalized = street
    .replace(UNIT_MARKER_RE, ' ')
    .toLowerCase()
    .replace(/[.#]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => STREET_WORD_CANONICAL[w] ?? w)
    .join(' ');
  UNIT_MARKER_RE.lastIndex = 0;
  // A bare number (everything after it was a unit designator) is not an address.
  return /^\S+\s+\S/.test(normalized) ? normalized : null;
}

function isAddressOnlySegment(segment: string): boolean {
  const s = segment.trim();
  if (!s) return true;
  if (HOUSE_NUMBER_RE.test(s)) return stripStreetAddress(s) === '';
  UNIT_MARKER_RE.lastIndex = 0;
  const unitOnly = s.replace(UNIT_MARKER_RE, '').trim() === '';
  UNIT_MARKER_RE.lastIndex = 0;
  return unitOnly;
}

/**
 * Turn the text in front of a state into a usable city, or null. Drops a
 * leading street address and unit, a parenthetical neighbourhood
 * ("Alexandria (Franconia)") and a facility prefix ("Main Campus - Kansas
 * City"). A candidate that still carries digits is not a city.
 */
function cleanCityCandidate(raw: string): string | null {
  let s = raw.replace(/\s+/g, ' ').trim().replace(/^[,\-–|\s]+|[,\-–|\s]+$/g, '');
  if (!s) return null;
  s = s.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  if (/\s[-–]\s/.test(s)) {
    const parts = s.split(/\s+[-–]\s+/).map((p) => p.trim()).filter(Boolean);
    const placeLike = parts.filter((p) => !FACILITY_WORD_RE.test(p) && !/\d/.test(p));
    if (placeLike.length > 0 && placeLike.length < parts.length) {
      s = placeLike[placeLike.length - 1];
    }
  }
  if (HOUSE_NUMBER_RE.test(s)) s = stripStreetAddress(s);
  s = s.replace(/^[,\-–|\s]+|[,\-–|\s]+$/g, '').trim();
  if (!s || /\d/.test(s) || STRONG_FACILITY_WORD_RE.test(s)) return null;
  // A list of places ("CA or NY", "Dallas / Houston", "MO; Overland Park")
  // or another state code is not one city. Punctuation is stripped before
  // the code check, so "MO;" or "(KS)" still reads as a state code.
  if (/[&/;]|\b(?:or|and)\b/.test(s)) return null;
  if (s.split(/\s+/).some((w) => {
    const bare = w.replace(/[^A-Za-z]/g, '');
    return /^[A-Z]{2}$/.test(bare) && !!CODE_TO_STATE[bare];
  })) return null;
  // A sentence fragment is not a town: "Remote - must reside in Texas" gave
  // the city "must reside in", "Locations: Denver" gave "s: Denver"
  // (lib/locality.ts hasTownNameShape: no ":" or ";", and no lower-case word
  // outside the particles of place names such as "Lake in the Hills").
  if (!hasTownNameShape(s)) return null;
  return s;
}

/** A standalone state token: a 2-letter code (any case) or a full state name. */
function resolveStateToken(token: string): { state: string; stateCode: string } | null {
  const t = token.trim();
  if (/^[A-Za-z]{2}$/.test(t)) {
    const code = t.toUpperCase();
    return CODE_TO_STATE[code] ? { state: CODE_TO_STATE[code], stateCode: code } : null;
  }
  const lower = t.toLowerCase().replace(/\s+/g, ' ');
  for (const [name, code] of Object.entries(STATE_CODES)) {
    if (name.toLowerCase() === lower) return { state: name, stateCode: code };
  }
  return null;
}

// ── Lists of places (reviewer regression on the CQ-02 parser) ────────────
// Postings list several work sites in one field: "Kansas City, MO; Overland
// Park, KS", "Vancouver, WA / Portland, OR", "CA or NY", "Seattle, WA,
// Portland, OR", "Remote - TX, FL, GA". The FIRST listed place is the
// posting's location (as it was before the street-address rewrite); the
// trailing-state rule below is only for one place written as an address.

/**
 * Separators between listed places. Lower-case "or" / "and" only, so the
 * Oregon code in "Portland, OR or Seattle, WA" is never read as one.
 */
const PLACE_LIST_SEPARATOR_RE = /\s*;\s*|\s*\/\s*|\s+(?:or|and)\s+|\s+&\s+/;
/** Segment separators inside one place: "City, ST", "Center | Elm Ave | City | ST". */
const SEGMENT_SEPARATOR_RE = /\s*[,|]\s*/;
/** A work-mode word left in a list ("Hybrid / Denver, CO") is not a place. */
const WORK_MODE_WORD_RE = /^(?:hybrid|remote|on[\s-]?site|in[\s-]person|flexible|telehealth|virtual)$/i;
/** A segment ending in a street suffix: the code after it is a directional ("Main St NE"). */
const ENDS_WITH_STREET_SUFFIX_RE = new RegExp(`\\b(?:${STREET_SUFFIX_WORDS})\\.?$`, 'i');
/** A trailing 5-digit ZIP inside a segment ("TX 78701"). */
const SEGMENT_ZIP_RE = /\s+\d{5}(?:-\d{4})?$/;

function splitSegments(text: string): string[] {
  return text
    .split(SEGMENT_SEPARATOR_RE)
    .map((s) => s.trim().replace(SEGMENT_ZIP_RE, '').trim())
    .filter((s) => s && !/^\d{5}(?:-\d{4})?$/.test(s));
}

function isBareStateCode(segment: string): boolean {
  return /^[A-Za-z]{2}$/.test(segment.trim());
}

/**
 * The state each whole segment names, by role, or null. A state NAME
 * directly followed by one more state segment is a city ("Washington, DC",
 * "Indiana, PA", "New York, NY"). A code is never a city ("CA, NY" lists two
 * states), and a run of three or more state segments is a list of states
 * ("TX, FL, GA", "Texas, Oklahoma, Kansas").
 */
function segmentStateRoles(segments: readonly string[]): Array<string | null> {
  const roles = segments.map((s) => resolveStateToken(s)?.stateCode ?? null);
  let i = 0;
  while (i < segments.length) {
    if (!roles[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < segments.length && roles[j + 1]) j++;
    if (j - i + 1 === 2 && !isBareStateCode(segments[i])) roles[i] = null;
    // "LA, CA" is Los Angeles, California, not Louisiana then California.
    // The "LA" segment becomes a city-role state token: stateRefsOf skips
    // it, the trailing CA wins, and the bare code is never stored as a city.
    if (j - i + 1 === 2 && segments[i].trim().toUpperCase() === 'LA' && roles[j] === 'CA') roles[i] = null;
    i = j + 1;
  }
  return roles;
}

/** One reference to a state in a place: a whole segment, or a code ending a segment. */
interface StateRef {
  index: number;
  stateCode: string;
  /** For "Overland Park KS": the text in front of the code. Null for a whole segment. */
  inlineBefore: string | null;
}

function stateRefsOf(segments: readonly string[]): StateRef[] {
  const roles = segmentStateRoles(segments);
  const refs: StateRef[] = [];
  segments.forEach((segment, index) => {
    const role = roles[index];
    if (role) {
      refs.push({ index, stateCode: role, inlineBefore: null });
      return;
    }
    if (resolveStateToken(segment)) return; // a state name in city role
    const m = segment.match(/^(.*\S)\s+([A-Z]{2})$/);
    if (!m || !CODE_TO_STATE[m[2]] || ENDS_WITH_STREET_SUFFIX_RE.test(m[1])) return;
    refs.push({ index, stateCode: m[2], inlineBefore: m[1] });
  });
  return refs;
}

/** The city for a state at segments[end]: the nearest earlier segment that is not only an address. */
function cityBefore(segments: readonly string[], end: number): string | null {
  for (let i = end - 1; i >= 0; i--) {
    const city = cleanCityCandidate(segments[i]);
    if (city || !isAddressOnlySegment(segments[i])) return city;
  }
  return null;
}

interface UsPlace {
  stateCode: string;
  city: string | null;
}

/**
 * One place written as text: "San Francisco, CA", "Portland, Oregon", a
 * street address, "ST - City", or several "City, ST" pairs joined by commas
 * (the first pair wins). Null when no US state is named.
 */
function parseUsPlace(toParse: string): UsPlace | null {
  const segments = splitSegments(toParse);

  // 0. Two or more state references ("Seattle, WA, Portland, OR", "TX, FL,
  //    GA", "Kansas City MO, Overland Park KS"): the first listed place.
  //    When every reference names one state and the first has no city
  //    ("100 Main St Suite 5 NE, Omaha, NE"), step 1 reads it instead.
  const refs = stateRefsOf(segments);
  if (refs.length >= 2) {
    const first = refs[0];
    const inlineCity = first.inlineBefore !== null ? cleanCityCandidate(first.inlineBefore) : null;
    const city = inlineCity ?? cityBefore(segments, first.index);
    const oneState = refs.every((r) => r.stateCode === first.stateCode);
    if (city || !oneState) return { stateCode: first.stateCode, city };
  }

  // 1. Trailing ", State" segment, the common ATS shape: "San Francisco, CA",
  //    "Portland, Oregon", and full addresses such as
  //    "1730 Rhode Island Ave NW, Washington, DC" or
  //    "Crittenton Children's Center | Elm Ave | Kansas City | MO".
  //    Every state reference agrees here (step 0 took the lists), so the
  //    city is the nearest earlier segment that is not only an address.
  if (segments.length >= 2) {
    const st = resolveStateToken(segments[segments.length - 1]);
    if (st) return { stateCode: st.stateCode, city: cityBefore(segments, segments.length - 1) };
  }

  // 2. "ST - City" (Thriveworks, some Workday tenants): "VA - Norfolk",
  //    "VA - Alexandria (Franconia)". Upper-case code only, so a word such
  //    as "Hybrid - Austin" never reads as a state.
  const stDashCity = toParse.match(/^([A-Z]{2})\s*[-–]\s*([^,|]+)$/);
  if (stDashCity && CODE_TO_STATE[stDashCity[1]]) {
    return { stateCode: stDashCity[1], city: cleanCityCandidate(stDashCity[2]) };
  }

  // 3. A 2-letter upper-case state code anywhere in the string. Every
  //    candidate is scanned and the first VALID one wins (the old code tested
  //    only the first pair, so "NW" in a street address hid the real "DC"
  //    after it).
  const codeMatch = Array.from(toParse.matchAll(/\b([A-Z]{2})\b/g)).find((m) => CODE_TO_STATE[m[1]]);
  if (codeMatch) {
    const beforeSegments = splitSegments(toParse.slice(0, codeMatch.index ?? 0));
    let city = cityBefore(beforeSegments, beforeSegments.length);
    if (city && city.length <= 2) city = null;
    return { stateCode: codeMatch[1], city };
  }

  // 4. A full state name inside the string. The match nearest the end wins
  //    (longest on a tie, so "West Virginia" beats "Virginia"), and a name
  //    followed by a street suffix is a street, not a state
  //    ("1730 Rhode Island Ave").
  let best: { code: string; index: number; end: number } | null = null;
  for (const [stateName, code] of Object.entries(STATE_CODES)) {
    const re = new RegExp(`\\b${escapeRegExp(stateName)}\\b`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(toParse)) !== null) {
      const end = m.index + m[0].length;
      if (FOLLOWED_BY_STREET_SUFFIX_RE.test(toParse.slice(end))) continue;
      if (!best || end > best.end || (end === best.end && m[0].length > best.end - best.index)) {
        best = { code, index: m.index, end };
      }
    }
  }
  if (!best) return null;
  const afterState = toParse.slice(best.end).trim().replace(/^,\s*/, '');
  // Text AFTER the state name with no comma anywhere means the name is part
  // of a compound city ("Colorado Springs", "Virginia Beach"): not a state.
  if (afterState && !toParse.includes(',')) return null;
  const beforeSegments = splitSegments(toParse.slice(0, best.index).trim().replace(/,\s*$/, ''));
  let city = cityBefore(beforeSegments, beforeSegments.length);
  if (city && city.length <= 2) city = null;
  return { stateCode: best.code, city };
}

/**
 * A listed item that is a bare place name ("Dallas" in "Dallas / Houston,
 * TX"), which shares the state of the next item. A place in another country
 * ("Toronto, ON" in "Toronto, ON; Seattle, WA") shares nothing, so the US
 * place after it keeps its own city.
 */
function isPlaceName(item: string): boolean {
  const t = item.trim();
  if (countryFromLocationSegments(t.split(/\s*[,|]\s*|\s+[-–]\s+/).map((s) => s.trim()).filter(Boolean))) {
    return false;
  }
  return !WORK_MODE_WORD_RE.test(t) && !FACILITY_WORD_RE.test(t) && cleanCityCandidate(t) !== null;
}

/**
 * The posting's US place when the text lists several: the first listed item
 * that names a state. Bare city names listed in front of it share its state
 * ("Dallas / Houston, TX"), so no single city is chosen.
 */
function parseUsPlaceList(toParse: string): UsPlace | null {
  const items = toParse
    .split(PLACE_LIST_SEPARATOR_RE)
    .map((s) => s.trim().replace(/^[,\-–|\s]+|[,\-–|\s]+$/g, ''))
    .filter(Boolean);
  // One item left once a stripped work-mode word is gone ("Remote /
  // Pittsburgh, PA" → "Pittsburgh, PA"): parse that item alone.
  if (items.length < 2) return parseUsPlace(items[0] ?? toParse);
  const places = items.map(parseUsPlace);
  const first = places.findIndex((p) => p !== null);
  if (first < 0) return null;
  const place = places[first]!;
  return items.slice(0, first).some(isPlaceName) ? { stateCode: place.stateCode, city: null } : place;
}

/**
 * Every US state a location string names: an upper-case code, a whole
 * segment that is a code in any case ("Austin, tx"), or a state name that is
 * not a street ("Rhode Island Ave"), not the first word of a longer place
 * name ("Kansas City", "Virginia Beach") and not the city in front of a
 * state ("Washington, DC"). The fix scripts use it so a posting that lists
 * several states is never called "wrong state" for storing one of them.
 */
export function statesNamedIn(location: string | null | undefined): Set<string> {
  const named = new Set<string>();
  if (!location) return named;
  const text = normalizeDistrictOfColumbia(location.replace(/\s+/g, ' ').trim());
  const items = text.split(PLACE_LIST_SEPARATOR_RE);
  for (const item of items) {
    const segments = splitSegments(item);
    const roles = segmentStateRoles(segments);
    segments.forEach((segment, i) => {
      if (roles[i]) {
        named.add(roles[i]!);
        return;
      }
      if (resolveStateToken(segment)) return; // a state name in city role
      for (const m of segment.matchAll(/\b([A-Z]{2})\b/g)) {
        if (CODE_TO_STATE[m[1]]) named.add(m[1]);
      }
      let masked = segment;
      for (const [name, code] of STATE_NAMES_LONGEST_FIRST) {
        const re = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'gi');
        for (const m of masked.matchAll(re)) {
          const after = masked.slice((m.index ?? 0) + m[0].length);
          if (FOLLOWED_BY_STREET_SUFFIX_RE.test(after) || /^\s+[A-Z][a-z]/.test(after)) continue;
          named.add(code);
        }
        masked = masked.replace(re, (s) => ' '.repeat(s.length));
      }
    });
  }
  return named;
}

/** State names, longest first, so "West Virginia" is read before "Virginia". */
const STATE_NAMES_LONGEST_FIRST: ReadonlyArray<readonly [string, string]> = Object.entries(STATE_CODES)
  .sort((a, b) => b[0].length - a[0].length);

// ── Countries (indexing audit CQ-02, owner decision: US jobs only) ───────
// Unambiguous country names and aliases → ISO 3166-1 alpha-2. Names that are
// also common US place names (Georgia the state; Lebanon PA, Jordan UT,
// Panama City FL, Cuba NY, Peru IN, Mexico MO, Poland OH, Norway ME,
// Denmark SC, Holland MI, Brazil IN, Turkey TX, Chad as a first name) are in
// AMBIGUOUS_COUNTRY_NAMES and only count in an unambiguous position.
const COUNTRY_NAMES: Readonly<Record<string, string>> = {
  'canada': 'CA', 'united kingdom': 'GB', 'uk': 'GB', 'u.k.': 'GB', 'great britain': 'GB',
  'england': 'GB', 'scotland': 'GB', 'wales': 'GB', 'northern ireland': 'GB', 'ireland': 'IE',
  'australia': 'AU', 'new zealand': 'NZ', 'india': 'IN', 'philippines': 'PH', 'iraq': 'IQ',
  'afghanistan': 'AF', 'kuwait': 'KW', 'qatar': 'QA', 'saudi arabia': 'SA', 'bahrain': 'BH',
  'oman': 'OM', 'united arab emirates': 'AE', 'uae': 'AE', 'israel': 'IL', 'germany': 'DE',
  'france': 'FR', 'spain': 'ES', 'italy': 'IT', 'netherlands': 'NL', 'belgium': 'BE',
  'switzerland': 'CH', 'austria': 'AT', 'sweden': 'SE', 'finland': 'FI', 'japan': 'JP',
  'south korea': 'KR', 'korea': 'KR', 'china': 'CN', 'singapore': 'SG', 'hong kong': 'HK',
  'argentina': 'AR', 'colombia': 'CO', 'chile': 'CL', 'costa rica': 'CR',
  'dominican republic': 'DO', 'jamaica': 'JM', 'bahamas': 'BS', 'nigeria': 'NG', 'kenya': 'KE',
  'south africa': 'ZA', 'ghana': 'GH', 'egypt': 'EG', 'pakistan': 'PK', 'bangladesh': 'BD',
  'vietnam': 'VN', 'thailand': 'TH', 'malaysia': 'MY', 'indonesia': 'ID', 'greece': 'GR',
  'portugal': 'PT', 'czech republic': 'CZ', 'czechia': 'CZ', 'romania': 'RO', 'hungary': 'HU',
  'ukraine': 'UA', 'djibouti': 'DJ', 'somalia': 'SO', 'syria': 'SY', 'yemen': 'YE',
  'libya': 'LY', 'haiti': 'HT', 'guatemala': 'GT', 'honduras': 'HN', 'el salvador': 'SV',
  'nicaragua': 'NI', 'ecuador': 'EC', 'bolivia': 'BO', 'venezuela': 'VE', 'uruguay': 'UY',
  'paraguay': 'PY', 'iceland': 'IS', 'greenland': 'GL', 'ethiopia': 'ET', 'uganda': 'UG',
  'rwanda': 'RW', 'tanzania': 'TZ', 'mali': 'ML', 'niger': 'NE', 'sudan': 'SD',
  'south sudan': 'SS', 'morocco': 'MA', 'tunisia': 'TN', 'algeria': 'DZ', 'nepal': 'NP',
  'sri lanka': 'LK', 'taiwan': 'TW', 'mexico': 'MX', 'jordan': 'JO', 'lebanon': 'LB',
  'panama': 'PA', 'cuba': 'CU', 'peru': 'PE', 'poland': 'PL', 'norway': 'NO', 'denmark': 'DK',
  'holland': 'NL', 'brazil': 'BR', 'turkey': 'TR', 'türkiye': 'TR', 'chad': 'TD',
};
const AMBIGUOUS_COUNTRY_NAMES: ReadonlySet<string> = new Set([
  'mexico', 'jordan', 'lebanon', 'panama', 'cuba', 'peru', 'poland', 'norway', 'denmark',
  'holland', 'brazil', 'turkey', 'chad', 'wales', 'niger',
  // Jamaica, Queens (Jamaica Hospital Medical Center) and Jamaica, VT.
  'jamaica',
]);
/**
 * Names that a description can use for a US place or facility as easily as
 * for the country: the ambiguous names above plus "Ireland Army Health
 * Clinic" (Fort Knox), "China Grove, NC", "India Hook, SC" and "Japan Town".
 * In a description they only count when the sentence ends on the name.
 */
const DESCRIPTION_GUARDED_NAMES: ReadonlySet<string> = new Set([
  ...AMBIGUOUS_COUNTRY_NAMES,
  'ireland', 'china', 'india', 'japan',
]);
// Canadian provinces and territories. Their 2-letter codes never collide
// with a US state code. "Ontario" is also a California city, so it (and its
// code) only counts after a city segment ("Toronto, Ontario", "Toronto, ON").
const CANADIAN_PROVINCES: ReadonlySet<string> = new Set([
  'ontario', 'quebec', 'québec', 'british columbia', 'alberta', 'manitoba', 'saskatchewan',
  'nova scotia', 'new brunswick', 'newfoundland', 'newfoundland and labrador',
  'prince edward island', 'yukon', 'northwest territories', 'nunavut',
  'on', 'qc', 'bc', 'ab', 'mb', 'sk', 'ns', 'nb', 'nl', 'pe', 'yt', 'nt', 'nu',
]);
/** Provinces that are also US place names: counted only after a city segment. */
const PROVINCES_NEEDING_CITY: ReadonlySet<string> = new Set(['ontario', 'on']);

/** Canada Post province and territory codes, upper case. None is a US state code. */
const CA_PROVINCE_CODES = 'ON|QC|BC|AB|MB|SK|NS|NB|NL|PE|YT|NT|NU';
const CA_PROVINCE_NAMES =
  'Ontario|Quebec|Québec|British Columbia|Alberta|Manitoba|Saskatchewan|Nova Scotia|New Brunswick|' +
  'Newfoundland(?: and Labrador)?|Prince Edward Island|Yukon|Northwest Territories|Nunavut';
/** Workday's Canadian shape: country, province, city ("CA-ON-Toronto", "CAN-BC-Vancouver"). */
const WORKDAY_CANADA_RE = new RegExp(`^CAN?-(${CA_PROVINCE_CODES})-(.+)$`);
/**
 * A province followed by Canada's ISO code: "Toronto, ON, CA", "Toronto,
 * Ontario, CA", "Vancouver, BC, CAN", "ON, CA" (what "Remote, ON, CA"
 * leaves). The final "CA" is Canada, not California.
 */
const PROVINCE_THEN_CANADA_CODE_RE = new RegExp(
  `^(?:(.+?),\\s*)?(${CA_PROVINCE_CODES}|${CA_PROVINCE_NAMES})\\s*,\\s*CAN?$`,
);

/**
 * Canada written with its ISO code, rewritten with the country name so the
 * code is never read as California: "CA-ON-Toronto" and "Toronto, ON, CA"
 * both become "Toronto, ON, Canada". Ontario is also a California city, so
 * "Ontario, CA" alone is California, and "... , Ontario, CA" is the province
 * only when a town name comes first ("Toronto, Ontario, CA"); after a street
 * address or a facility ("2200 E Inland Empire Blvd, Ontario, CA") it is the
 * California city. So it is after a California town: a posting that lists
 * two Inland Empire cities ("Chino, Ontario, CA", "Upland, Ontario, CA") is
 * a US job (isCaliforniaTownBeforeOntario).
 */
function rewriteCanadaIsoCode(text: string): string {
  const trimmed = text.replace(/^[,\-–|\s]+/, '');
  const workday = trimmed.match(WORKDAY_CANADA_RE);
  if (workday) return `${workday[2]}, ${workday[1]}, Canada`;
  const m = trimmed.match(PROVINCE_THEN_CANADA_CODE_RE);
  if (!m) return text;
  const [, before, province] = m;
  if (province === 'Ontario' && isCaliforniaTownBeforeOntario(before?.split(/\s*,\s*/).pop()?.trim() ?? '')) return text;
  return before ? `${before}, ${province}, Canada` : `${province}, Canada`;
}

/**
 * The towns around Ontario, California (the Inland Empire). Listed with
 * Ontario ("Chino, Ontario, CA"), they are a list of California cities.
 * Kept even when the city dataset has them, so the rule holds if the
 * dataset changes.
 */
const INLAND_EMPIRE_TOWNS: ReadonlySet<string> = new Set([
  'chino', 'chino hills', 'montclair', 'pomona', 'claremont', 'fontana', 'rialto', 'eastvale',
  'jurupa valley', 'corona', 'riverside', 'san bernardino', 'colton', 'rancho cucamonga', 'upland',
]);

/**
 * Towns in the province of Ontario whose names are also California towns
 * in the city dataset. "Windsor, Ontario, CA" is Windsor, Ontario, Canada
 * (a city of over 200,000), not two California towns.
 */
const ONTARIO_PROVINCE_TOWNS_NAMED_LIKE_CALIFORNIA: ReadonlySet<string> = new Set(['windsor', 'richmond']);

/**
 * True when the text in front of "Ontario, CA" makes it Ontario,
 * California: a street address or facility (anything plausibleLocality
 * rejects), an Inland Empire town, or another California town the city
 * dataset knows (unless that name is also a town in the province).
 */
function isCaliforniaTownBeforeOntario(town: string): boolean {
  if (!plausibleLocality(town)) return true;
  const key = town.toLowerCase().replace(/\s+/g, ' ');
  if (INLAND_EMPIRE_TOWNS.has(key)) return true;
  if (ONTARIO_PROVINCE_TOWNS_NAMED_LIKE_CALIFORNIA.has(key)) return false;
  return CITY_SLUGS.has(buildCityDatasetSlug(town, 'CA'));
}
/** United States plus its inhabited territories. Jobs there stay in scope. */
const US_COUNTRY_VALUES: ReadonlySet<string> = new Set([
  'us', 'usa', 'u.s.', 'u.s.a.', 'united states', 'united states of america', 'america',
  'pr', 'puerto rico', 'gu', 'guam', 'vi', 'u.s. virgin islands', 'us virgin islands',
  'virgin islands', 'as', 'american samoa', 'mp', 'northern mariana islands',
]);
const ISO2_NON_US: ReadonlySet<string> = new Set(Object.values(COUNTRY_NAMES));

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Country name alternation, longest first so "south korea" wins over "korea". */
const COUNTRY_ALTERNATION = Object.keys(COUNTRY_NAMES)
  .sort((a, b) => b.length - a.length)
  .map(escapeRegExp)
  .join('|');

/**
 * Resolve an ATS-supplied country value ("US", "us", "Canada", "United
 * States of America", ISO alpha-2 or alpha-3 style names) to 'US', a
 * non-US ISO code, or null when it is not recognised. Unknown values are
 * never treated as foreign.
 */
export function resolveCountryValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (!v) return null;
  if (US_COUNTRY_VALUES.has(v)) return 'US';
  if (COUNTRY_NAMES[v]) return COUNTRY_NAMES[v];
  if (/^[a-z]{2}$/.test(v) && ISO2_NON_US.has(v.toUpperCase())) return v.toUpperCase();
  if (v === 'can') return 'CA';
  if (v === 'gbr') return 'GB';
  if (v === 'ind') return 'IN';
  if (v === 'irq') return 'IQ';
  // USAJOBS writes overseas posts in Korea as "Korea, South".
  if (v === 'korea, south' || v === 'republic of korea') return 'KR';
  return null;
}

/**
 * The United States written as one of the places in a location or a title:
 * "United States, Canada", "Canada, United States", "US, Canada", "Remote
 * (US, Canada)", "Canada/USA", "U.S. or Canada", "Canada and the US",
 * "Nurse Practitioner - US". It must stand as a list item (between list
 * separators, or after "in", "or", "and", "the" or "remote"), so a facility
 * abroad ("US Army Garrison, Germany", "USA Health Clinic") is not one. A
 * work-mode word may follow it, as Greenhouse and Lever office labels write
 * it: "US Remote, Canada Remote", "US (Remote)", "United States Remote", "US
 * Nationwide, Canada". The codes are case-sensitive, so the word "us" ("join
 * us") never counts. A posting that names the United States this way is a
 * US job (owner decision, 2026-09-29), whatever else it lists.
 */
const US_LIST_ITEM_RE =
  /(?:^|[([,;/|&:\-–]\s*|\b(?:in|or|and|the|In|Or|And|The|remote|Remote|REMOTE)\s+)(?:US|USA|U\.S\.(?:A\.)?|United States(?: of America)?|UNITED STATES(?: OF AMERICA)?|united states(?: of america)?)(?=\s*(?:$|[)\],;/|&:\-–.]|\(\s*(?:[Rr]emote|REMOTE)\s*\)|(?:or|and|only|Only|ONLY|[Rr]emote|REMOTE|[Nn]ationwide|NATIONWIDE)\b))/;

/** True when a location or title names the United States as one of its places (see US_LIST_ITEM_RE). */
export function namesUnitedStatesAsPlace(text: string | null | undefined): boolean {
  return !!text && US_LIST_ITEM_RE.test(text);
}

/**
 * Words and names that are not a town when a location string holds nothing
 * else: world regions and placeholders ("Worldwide", "EMEA", "North
 * America"), military post codes ("APO AE"), and the name of a country, a
 * Canadian province or a US territory ("Puerto Rico", "Guam").
 */
const REGION_OR_PLACEHOLDER_RE =
  /^(?:worldwide|world\s+wide|global(?:ly)?|international|anywhere|everywhere|multiple|various|tbd|unknown|n\/?a|emea|apac|apj|latam|amer|americas|north\s+america|south\s+america|central\s+america|latin\s+america|europe|asia|asia\s+pacific|africa|oceania|middle\s+east|caribbean|pacific)$/i;
const MILITARY_POST_RE = /\b(?:APO|FPO|DPO)\b/;

/**
 * True when a location string with no state in it can stand as a city on
 * its own ("Colorado Springs" after a county was stripped). A list fragment
 * ("or Canada", "Canada or"), a region, a country, a province, a territory,
 * a military post code or anything plausibleLocality rejects is not.
 */
function isStandaloneTownName(text: string): boolean {
  const lower = text.toLowerCase().replace(/\s+/g, ' ').trim();
  if (REGION_OR_PLACEHOLDER_RE.test(lower) || MILITARY_POST_RE.test(text)) return false;
  if (US_COUNTRY_VALUES.has(lower) || COUNTRY_NAMES[lower] || CANADIAN_PROVINCES.has(lower)) return false;
  return hasTownNameShape(text) && plausibleLocality(text) !== null;
}

/**
 * The non-US country a free-text LOCATION names, or null. Only the final
 * segment counts ("Toronto, Ontario, Canada", "Baghdad, Iraq", "Remote -
 * Canada", "Remote (Canada)"; brackets around it are ignored), and only
 * when no US state was parsed from the same string, so "Lebanon, PA" and
 * "Mexico, MO" stay American. Segments are never split on a bracket, so
 * "Hybrid (Ontario)" stays one segment and is not the province.
 */
function countryFromLocationSegments(segments: readonly string[]): string | null {
  if (segments.length === 0) return null;
  const last = segments[segments.length - 1]
    .toLowerCase()
    .replace(/[()[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (CANADIAN_PROVINCES.has(last)) {
    // "Ontario" alone (or "Hybrid - Ontario") is Ontario, California.
    if (PROVINCES_NEEDING_CITY.has(last) && segments.length < 2) return null;
    return 'CA';
  }
  const code = COUNTRY_NAMES[last];
  if (!code) return null;
  if (AMBIGUOUS_COUNTRY_NAMES.has(last) && segments.length < 2) return null;
  return code;
}

/**
 * Parse a location string into structured data
 */
export function parseLocation(location: string): ParsedLocation {
  const result: ParsedLocation = {
    city: null,
    state: null,
    stateCode: null,
    country: 'US',
    isRemote: false,
    isHybrid: false,
    originalLocation: location || '',
    confidence: 0.3, // Default low confidence
  };

  // Handle null/undefined/empty
  if (!location || typeof location !== 'string') {
    return result;
  }

  // Normalize input
  const normalized = location.trim();
  if (!normalized) {
    return result;
  }

  result.originalLocation = normalized;
  const lower = normalized.toLowerCase();

  // Check for hybrid FIRST — 'partial remote' contains 'remote', and a hybrid
  // role is by definition not fully remote, so the two flags stay mutually
  // exclusive (isRemote=true means fully remote downstream: /jobs/remote,
  // JobPosting TELECOMMUTE).
  if (HYBRID_LOCATION_RE.test(lower)) {
    result.isHybrid = true;
    result.confidence = 0.7;
  } else if (REMOTE_LOCATION_RE.test(lower)) {
    result.isRemote = true;
    result.confidence = 0.7;
  }

  // ── Pre-clean: strip remote/hybrid/country markers to isolate city/state ──
  let cleaned = normalized
    // Tabs and runs of spaces from ATS address fields ("Drive\tSuite 200").
    .replace(/\s+/g, ' ')
    // Remove "Remote -", "Remote:", "Remote –", "(Remote)" etc.
    .replace(/\b(remote|telehealth|telepsychiatry|virtual|work from home|wfh|hybrid|flexible)\s*[-–:]\s*/gi, '')
    .replace(/\(\s*(remote|telehealth|virtual|hybrid|flexible)\s*\)/gi, '')
    .replace(/[-–]\s*(remote|telehealth|virtual|hybrid|flexible)\b/gi, '')
    .replace(/\b(remote|telehealth|telepsychiatry|virtual|work from home|wfh)\b/gi, '')
    // Remove "HQ:", "Headquarters:"
    .replace(/\b(hq|headquarters)\s*[:]\s*/gi, '')
    .trim();

  cleaned = normalizeDistrictOfColumbia(cleaned);

  // Handle Workday "US-ST-City" format → "City, ST" (BEFORE stripping "US")
  cleaned = cleaned.replace(/^US-([A-Z]{2})-(.+)$/i, '$2, $1');
  // Canada written with its ISO code ("CA-ON-Toronto", "Toronto, ON, CA"):
  // the code is Canada, never California.
  cleaned = rewriteCanadaIsoCode(cleaned);

  // Now remove country markers
  cleaned = cleaned
    .replace(/,?\s*\b(united states|usa|us|u\.s\.a?\.|nationwide|anywhere)\b/gi, '')
    // Strip county names: "Colorado Springs, El Paso County" → "Colorado Springs"
    // Also handles "Raleigh, Wake County" and "San Diego, San Diego County"
    .replace(/,\s*[A-Z][a-zA-Z\s'-]+ County\b/gi, '')
    // Strip borough/neighborhood qualifiers: "Grand Central, Manhattan" → keep as-is
    .replace(/,\s*,/g, ',') // clean double commas
    .trim()
    // Trailing ZIP code, including a truncated one ("Baltimore, Maryland, 212").
    .replace(/[,\s]+\d{3,5}(?:-\d{4})?$/, '')
    .replace(/\s+,/g, ',')
    .trim()
    .replace(/^[,\-–\s]+|[,\-–\s]+$/g, ''); // trim delimiters

  // If nothing is left after stripping mode/country markers there is no
  // city/state to extract — return what we have. (Previously only the remote
  // case returned here; now that 'United States' alone no longer implies
  // remote, falling through would mis-file the country name as a city.)
  if (!cleaned) {
    return result;
  }

  // If cleaned string is different, use it for parsing; otherwise use original
  const toParse = cleaned || normalized;

  // A US place: one "City, ST", a street address, "ST - City", or the first
  // of several listed places ("Kansas City, MO; Overland Park, KS").
  const place = parseUsPlaceList(toParse);
  if (place) {
    result.stateCode = place.stateCode;
    result.state = CODE_TO_STATE[place.stateCode];
    result.city = place.city;
    result.confidence = place.city ? 1.0 : 0.8;
    return result;
  }

  // No US state anywhere. A string that lists the United States as one of
  // its places ("United States, Canada", "Remote (US, Canada)") is a US
  // posting: the US marker was stripped above, so without this the other
  // country was recorded ('CA') and stored on a job that is open in the US.
  if (namesUnitedStatesAsPlace(normalized)) {
    return result;
  }

  // Otherwise record a non-US country the string names.
  const foreign = countryFromLocationSegments(
    toParse.split(/\s*[,|]\s*|\s+[-–]\s+/).map((s) => s.trim()).filter(Boolean),
  );
  if (foreign) {
    result.country = foreign;
    return result;
  }

  // If we still have nothing parsed, return low confidence
  if (!result.city && !result.state && !result.isRemote && !result.isHybrid) {
    // Last resort: if toParse has a clean string that looks like a city name
    // (e.g., "Colorado Springs" after county stripping), use it as city.
    // Facility names ("SMG ... Specialists", "Behavioral Associates"), counts
    // ("Multiple Locations"), what a stripped country leaves of a list ("US
    // or Canada" gives "or Canada"), regions ("Worldwide", "North America"),
    // territories ("Puerto Rico") and post codes ("APO AE") are not cities:
    // each reached the JobPosting addressLocality before (indexing audit
    // CQ-02).
    if (
      toParse &&
      toParse.length > 2 &&
      /^[A-Za-z\s'.-]+$/.test(toParse) &&
      !FACILITY_WORD_RE.test(toParse) &&
      isStandaloneTownName(toParse)
    ) {
      result.city = toParse;
      result.confidence = 0.5;
    } else {
      result.confidence = 0.3;
    }
  }

  return result;
}

// ── Non-US work sites (owner decision: US jobs only) ────────────────────

export interface NonUsWorkSite {
  /** ISO 3166-1 alpha-2 code of the work-site country. */
  country: string;
  /** Which field proved it, for the rejection log. */
  evidence: 'ats_country' | 'location' | 'title' | 'description';
  /** The matched text. */
  matched: string;
}

const US_MARKER_IN_TITLE_RE = /\b(?:united states|usa|u\.s\.a?\.?|us-based|nationwide)\b/i;

/** Any non-US country named in a location string, as a whole word. */
const NON_US_COUNTRY_IN_TEXT_RE = new RegExp(`\\b(?:${COUNTRY_ALTERNATION})\\b`, 'i');

/**
 * A location that lists the United States beside another country: "United
 * States, Canada", "Canada, United States", "US or Canada", "Remote (US,
 * Canada)". Such a posting is a US job even when the ATS country field
 * describes only its other, primary place. A location that names the United
 * States alone does not override an ATS country: several adapters write
 * "United States" when the place is unknown.
 */
function listsUsBesideAnotherCountry(location: string): boolean {
  return namesUnitedStatesAsPlace(location) && NON_US_COUNTRY_IN_TEXT_RE.test(location);
}

/** Every non-US country named in a title as its own segment: "CRNA - (Iraq)". */
const TITLE_COUNTRY_RE = new RegExp(
  `(?:^|[(\\[|,:\\-–]\\s*|\\b(?:in|to)\\s+)(${COUNTRY_ALTERNATION})(?=\\s*(?:$|[)\\]|,:\\-–]))`,
  'gi',
);

/**
 * Description phrases that state where the employee will work. Mentions of a
 * country anywhere else (an employer's other offices, a CME trip) are not
 * evidence, so only these forms count. Deployment and station wording counts
 * only when it is addressed to the hire ("Must be willing to deploy to", "You
 * will be stationed in", "The selected candidate will deploy to"): US
 * postings describe patients and families that way ("Serve veterans who
 * deployed to Iraq", "those who will deploy to Kuwait", "military families
 * stationed in Germany", "Prior deployment in Kuwait preferred").
 */
const HIRE_SUBJECT =
  '(?:you|candidates?|applicants?|providers?|(?:the\\s+)?(?:selected\\s+|successful\\s+)?(?:candidate|applicant|provider|hire))';
const WORK_SITE_PHRASE =
  '(?:relocat(?:e|ion)\\s+to|' +
  `(?:${HIRE_SUBJECT}\\s+(?:will|must)|must)\\s+(?:be\\s+)?(?:willing\\s+to\\s+|able\\s+to\\s+|required\\s+to\\s+)?` +
  '(?:deploy|be\\s+deployed|be\\s+stationed)\\s+(?:to|in|at)|' +
  '(?:position|role|job|assignment|contract|post)\\s+(?:is\\s+|will\\s+be\\s+)?(?:located|based)\\s+(?:in|at)|' +
  'must\\s+(?:reside|live|be\\s+located|be\\s+based)\\s+in|' +
  '(?:work|job|duty)\\s+(?:location|site|station)\\s*[:\\-])';
// An optional "City, " of at most three words may sit between the phrase
// and the country ("relocate to Erbil, Iraq"). It is captured (group 1) so
// the caller can require capitalised words: the regex runs case-insensitive
// for the phrase, which would otherwise let "[A-Z]" match any word.
const DESCRIPTION_COUNTRY_RE = new RegExp(
  `${WORK_SITE_PHRASE}\\s*(?:the\\s+)?(?:([A-Z][\\w.'-]*(?:\\s+[A-Z][\\w.'-]*){0,2}),\\s*)?(${COUNTRY_ALTERNATION})\\b`,
  'gi',
);
const US_STATE_NAMES_RE = new RegExp(
  `^\\s*,?\\s*(?:[A-Z]{2}\\b|${Object.keys(STATE_CODES).map(escapeRegExp).join('|')})`,
);
/**
 * A capitalised word right after the name makes it part of a place or
 * facility name: "Panama City", "Jamaica Hospital", "Ireland Army Health
 * Clinic", "China Grove", "Mexico Beach", "India Hook". Case-sensitive on
 * purpose, so "relocate to Iraq for the project" still counts.
 */
const FOLLOWED_BY_PROPER_NOUN_RE = /^\s+[A-Z][a-z]/;
/** The sentence, line or parenthesis ends right after the name. */
const FOLLOWED_BY_SENTENCE_END_RE = /^[ \t]*(?:[.;!?)\r\n]|$)/;
/**
 * The country is one of two allowed places, the other being the US: "must
 * reside in Canada or the United States" is a US-eligible posting.
 */
const FOLLOWED_BY_US_ALTERNATIVE_RE =
  /^\s*(?:,\s*(?:(?:[Oo]r|[Aa]nd|&)\s+)?|(?:[Oo]r|[Aa]nd|&)\s+|\/\s*)(?:the\s+)?(?:US\b|USA\b|U\.S\.(?:A\.)?|[Uu]nited\s+[Ss]tates\b|America\b)/;
/** Every word of a "City, " prefix starts with a capital letter. */
const CAPITALISED_WORDS_RE = /^[A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*)*$/;

function isRealCountryMention(text: string, name: string, matchEnd: number): boolean {
  const lower = name.toLowerCase();
  // "New Mexico" is a state; "Mexico, MO" and "Lebanon, PA" are US towns.
  if (lower === 'mexico' && /\bnew\s+$/i.test(text.slice(Math.max(0, matchEnd - name.length - 4), matchEnd - name.length))) {
    return false;
  }
  const after = text.slice(matchEnd, matchEnd + 24);
  if (US_STATE_NAMES_RE.test(after)) return false;
  if (FOLLOWED_BY_PROPER_NOUN_RE.test(after)) return false;
  return true;
}

/**
 * A description work-site match that really names a foreign country, or
 * false. Guarded names ("Lebanon", "Jamaica", "China") only count when the
 * sentence ends on them and the location field names no US state: "The
 * position is located in Lebanon." on a "Lebanon, NH" posting is
 * Dartmouth, not Beirut.
 */
function isDescriptionCountryMatch(
  description: string,
  m: RegExpMatchArray,
  locationHasUsState: boolean,
): boolean {
  const cityPrefix = m[1];
  const name = m[2];
  const lower = name.toLowerCase();
  if (cityPrefix && !CAPITALISED_WORDS_RE.test(cityPrefix)) return false;
  const end = (m.index ?? 0) + m[0].length;
  if (FOLLOWED_BY_US_ALTERNATIVE_RE.test(description.slice(end))) return false;
  if (DESCRIPTION_GUARDED_NAMES.has(lower)) {
    if (locationHasUsState) return false;
    if (!FOLLOWED_BY_SENTENCE_END_RE.test(description.slice(end))) return false;
  }
  return isRealCountryMention(description, name, end);
}

/**
 * Decide whether a posting's work site is outside the United States.
 * Evidence, strongest first:
 *   1. an ATS country field that resolves to a non-US country;
 *   2. a location string whose final segment is a non-US country or a
 *      Canadian province, with no US state parsed from it;
 *   3. a title segment naming a non-US country ("CRNA - (Iraq)"), unless
 *      the title also names the United States;
 *   4. a description phrase stating the work site ("must be able to
 *      relocate to Iraq for the duration of the project").
 * Georgia never counts (it is a US state first), and names that are also
 * US towns only count in positions where a town cannot appear.
 *
 * A posting that lists the United States among its places is a US job and
 * is kept (owner decision, 2026-09-29), whatever else it lists: a title such
 * as "Nurse Practitioner - US, Canada" or "NP - Remote (US, Canada)", a
 * location such as "United States, Canada", "US Remote, Canada Remote" or
 * "Remote (US, Canada)", or an
 * ATS country list with the US in it. These are read before the ATS country,
 * which may describe only the posting's primary place. Only a posting with
 * no US place at all is excluded.
 * Returns null for a US or undetermined posting.
 */
export function detectNonUsWorkSite(input: {
  title?: string | null;
  description?: string | null;
  location?: string | null;
  atsCountry?: unknown;
}): NonUsWorkSite | null {
  const title = input.title ?? '';
  if (namesUnitedStatesAsPlace(title)) return null;
  if (input.location && listsUsBesideAnotherCountry(input.location)) return null;

  const atsValues = Array.isArray(input.atsCountry) ? input.atsCountry : [input.atsCountry];
  const resolved = atsValues.map(resolveCountryValue).filter((c): c is string => c !== null);
  if (resolved.length > 0 && resolved.every((c) => c !== 'US')) {
    const first = atsValues.find((v) => resolveCountryValue(v) !== null);
    return { country: resolved[0], evidence: 'ats_country', matched: String(first) };
  }
  // The ATS lists several countries and the United States is one of them.
  if (resolved.includes('US') && resolved.some((c) => c !== 'US')) return null;

  let locationHasUsState = false;
  if (input.location) {
    // parseLocation keeps country 'US' for a string that names the United
    // States as a place, so only a location with no US place is excluded.
    const parsed = parseLocation(input.location);
    if (parsed.country !== 'US' && !parsed.stateCode) {
      return { country: parsed.country, evidence: 'location', matched: input.location };
    }
    locationHasUsState = parsed.stateCode !== null;
  }

  if (title && !US_MARKER_IN_TITLE_RE.test(title)) {
    for (const m of title.matchAll(TITLE_COUNTRY_RE)) {
      const name = m[1];
      const lower = name.toLowerCase();
      // "Nurse Practitioner - Jamaica" is Queens; "- Lebanon" may be NH.
      if (AMBIGUOUS_COUNTRY_NAMES.has(lower)) continue;
      const end = (m.index ?? 0) + m[0].length;
      if (!isRealCountryMention(title, name, end)) continue;
      return { country: COUNTRY_NAMES[lower], evidence: 'title', matched: name };
    }
  }

  const description = input.description ?? '';
  if (description) {
    for (const m of description.matchAll(DESCRIPTION_COUNTRY_RE)) {
      if (!isDescriptionCountryMatch(description, m, locationHasUsState)) continue;
      return { country: COUNTRY_NAMES[m[2].toLowerCase()], evidence: 'description', matched: m[0].trim() };
    }
  }

  return null;
}

/** Stored location columns a location rewrite can change. */
const LOCATION_COLUMNS = ['city', 'state', 'stateCode', 'country', 'isRemote', 'isHybrid'] as const;

function locationChanged(
  before: Partial<Record<(typeof LOCATION_COLUMNS)[number], unknown>>,
  after: ParsedLocation,
): boolean {
  return LOCATION_COLUMNS.some((k) => (before[k] ?? null) !== (after[k] ?? null));
}

/**
 * Parse all locations for jobs where state is null
 */
export async function parseAllLocations(): Promise<{
  processed: number;
  parsed: number;
  remote: number;
}> {
  const stats = {
    processed: 0,
    parsed: 0,
    remote: 0,
  };

  try {
    // Get all jobs where state is null
    const jobs = await prisma.job.findMany({
      where: {
        state: null,
      },
      select: {
        id: true,
        location: true,
        city: true,
        state: true,
        stateCode: true,
        country: true,
        isRemote: true,
        isHybrid: true,
      },
    });

    console.log(`[Location Parser] Found ${jobs.length} jobs to process`);

    // Process in batches of 100
    const batchSize = 100;
    for (let i = 0; i < jobs.length; i += batchSize) {
      const batch = jobs.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (job) => {
          try {
            const parsed = parseLocation(job.location);
            stats.processed++;

            if (parsed.isRemote) {
              stats.remote++;
            }

            if (parsed.state || parsed.city) {
              stats.parsed++;
            }

            // Update the job. contentChangedAt moves only when a rendered
            // location column actually changes.
            await prisma.job.update({
              where: { id: job.id },
              data: {
                city: parsed.city,
                state: parsed.state,
                stateCode: parsed.stateCode,
                country: parsed.country,
                isRemote: parsed.isRemote,
                isHybrid: parsed.isHybrid,
                ...(locationChanged(job, parsed) ? { contentChangedAt: new Date() } : {}),
              },
            });
          } catch (error) {
            console.error(`[Location Parser] Error processing job ${job.id}:`, error);
          }
        })
      );

      // Log progress
      if ((i + batchSize) % 500 === 0 || i + batchSize >= jobs.length) {
        console.log(`[Location Parser] Progress: ${Math.min(i + batchSize, jobs.length)}/${jobs.length}`);
      }
    }

    console.log(`[Location Parser] Complete: Processed ${stats.processed}, Parsed ${stats.parsed}, Remote ${stats.remote}`);

    return stats;
  } catch (error) {
    console.error('[Location Parser] Fatal error:', error);
    throw error;
  }
}

/**
 * Parse and save location for a specific job
 */
export async function parseJobLocation(jobId: string): Promise<ParsedLocation> {
  try {
    // Fetch the job
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        location: true,
        city: true,
        state: true,
        stateCode: true,
        country: true,
        isRemote: true,
        isHybrid: true,
      },
    });

    if (!job) {
      throw new Error(`Job with ID ${jobId} not found`);
    }

    // Parse the location
    const parsed = parseLocation(job.location);

    // Save to database
    await prisma.job.update({
      where: { id: jobId },
      data: {
        city: parsed.city,
        state: parsed.state,
        stateCode: parsed.stateCode,
        country: parsed.country,
        isRemote: parsed.isRemote,
        isHybrid: parsed.isHybrid,
        ...(locationChanged(job, parsed) ? { contentChangedAt: new Date() } : {}),
      },
    });

    console.log(`[Location Parser] Parsed job ${jobId}: ${JSON.stringify(parsed)}`);

    return parsed;
  } catch (error) {
    console.error(`[Location Parser] Error parsing job location:`, error);
    throw error;
  }
}
