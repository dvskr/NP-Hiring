/**
 * lib/locality.ts: whether a stored city value reads as a town name
 * (indexing audit CQ-02).
 *
 * The city column held street numbers ("1730" from "1730 Rhode Island Ave
 * NW, Washington, DC"), street addresses ("5100 Buckeyestown Pike Suite 200
 * Frederick"), facility names ("MAIN CAMPUS", "AdventHealth Porter", "GBMC
 * Hospital") and acronyms ("MMC"). They reached the JobPosting
 * addressLocality, and the listing aggregates printed them: "led by 1730
 * (1)" on a Rhode Island specialty listing and "Top city: 1730." in its
 * meta description. The job page's markup (app/jobs/[slug]/
 * job-posting-facts.ts) and every listing tally (lib/pseo/listing-facts.ts
 * selectCities) read this one rule, so neither publishes such a value.
 *
 * A title puts a specialty, care setting or schedule in front of the state
 * as often as a town: "Nurse Practitioner - Urgent Care, FL", "NP,
 * Dermatology, AZ", "NP - Nights, AZ", "Nurse Practitioner, Per Diem, TX".
 * Read as "City, ST" they filed a job under the town "Urgent Care", so
 * those words are not a town either (NON_TOWN_TITLE_WORD_RE below). None of
 * the 4,135 towns in lib/pseo/city-data/cities.ts carries one of them
 * (tests/lib/job-normalizer-work-mode.test.ts checks this).
 *
 * A loose description reader also took sentence fragments for towns:
 * "Locations: Denver, CO" stored "s: Denver", "Location: Remote - must
 * reside in Texas" stored "must reside in". A town name has no ":" or ";"
 * and no lower-case word outside a few particles ("Lake in the Hills",
 * "King of Prussia", "Fond du Lac"), so those are rejected too
 * (hasTownNameShape).
 *
 * A region of a state is not a town either: "Northern Virginia" was stored
 * as the town "Northern", "South Florida" as "South", "Metro Detroit, MI"
 * as "Metro Detroit" and "Location: Near Denver, CO" as "Near Denver"
 * (namesRegionNotTown). So were a qualifier in front of a state name
 * ("Within Texas" stored "Within") and a region suffix ("Houston Metro, TX",
 * "DFW Metroplex, TX"). A placeholder ("Unknown, TX", "Coming Soon, TX",
 * "Location: See Description, CO") or a work arrangement ("Field-Based, TX",
 * "Home Based, TX") is not a town either (namesPlaceholderNotTown).
 *
 * Nor is a street ("Location: Main St, CO" stored "Main St", "Oak Ave, TX"
 * stored "Oak Ave"; namesStreetFragment), a bare site or district word
 * ("Field - New Jersey" stored "Field", "Location: Corporate, TX",
 * "Downtown, TX", "County Jail, TX") or a facility code in front of a place
 * ("MHC Nashville", "AH TAMPA PEPIN HEART INSTITUTE"; namesSiteNotTown). A
 * district word in front of a town names the town: "Downtown Atlanta" reads
 * as "Atlanta".
 *
 * Omission beats a wrong place: a real town whose name carries one of these
 * words ("College Station", "Medicine Lodge") is left out of a city list
 * rather than risk publishing a facility or a specialty as a city. Ingest
 * keeps such a town when the city dataset knows it in that state
 * (lib/location-fallback.ts storedLocality). Pure.
 */

/**
 * Words that mark a facility, practice, site, work mode or placeholder
 * rather than a town. The practice words ("Behavioral Associates", a group
 * named "... Specialists") match lib/location-parser.ts
 * STRONG_FACILITY_WORD_RE. The role words ("Nurse Practitioner- Terre
 * Haute", read from a title whose dash touches the role) mark a job title
 * left in front of the town; any credential ending in NP (NP, FNP, ARNP,
 * AGACNP) counts. "Institute" is a facility ("AH TAMPA PEPIN HEART
 * INSTITUTE"); no town in lib/pseo/city-data carries the word. Site words
 * such as "Field" are in SITE_WORD_RE.
 */
const NON_LOCALITY_RE =
  /hospital|campus|medical|clinic|health|\binstitutes?\b|\bcent(?:er|re)s?\b|\bsuite\b|\bste\b|\bbuilding\b|\bbldg\b|\bfloor\b|\buniversity\b|\bcollege\b|\boffices?\b|\bsites?\b|\blocations?\b|\bremote\b|\bhybrid\b|\bon-?site\b|\bvirtual\b|\btelehealth\b|\bmultiple\b|\bvarious\b|\bnationwide\b|\bheadquarters\b|\bhq\b|\bdepartment\b|\bunit\b|\bspecialists?\b|\bassociates\b|\bpsychiatr(?:ic|y)\b|\bbehavioral\b|\bpractice\b|\bfacility\b|\bllc\b|\binc\b|\bpllc\b|\bnurses?\b|\bpractitioners?\b|\bphysicians?\b|\bassistants?\b|\bproviders?\b|\b[a-z]{0,5}np\b|\baprn\b|\bcrna\b/i;

/**
 * Specialty, care setting, schedule, engagement and region words that a job
 * title or a location line writes where a town would go ("Urgent Care, FL",
 * "Pediatrics, GA", "Nights, AZ", "Full Time, CA", "Greater Houston Area,
 * TX"). Whole words only, so "Travelers Rest",
 * "Tempe" and "Mountain Home" still read as towns; "Lead" (a South Dakota
 * town) and "Home" are deliberately absent.
 */
const NON_TOWN_TITLE_WORD_RE =
  /\b(?:\w+olog(?:y|ist)s?|care|medicine|pediatrics?|paediatrics?|orthop(?:a)?edics?|hospice|palliative|geriatrics?|outpatient|inpatient|ambulatory|emergency|urgent|primary|internal|family|surgery|surgical|critical|acute|intensive|neonatal|[np]?icu|obstetrics?|ob\s*\/?\s*gyn|wound|dialysis|addiction|women'?s|correctional|days|nights|weekends?|evenings|overnights?|shifts?|full[\s-]?time|part[\s-]?time|per[\s-]+diem|prn|locums?|travel|temporary|contract|residency|fellowship|new\s+grads?|telepsych\w*|telemedicine|area|regions?|regional|greater|statewide)\b/i;

/** Longest stored value that can still be one town name. */
const MAX_LOCALITY_LENGTH = 40;

/**
 * A direction or qualifier standing alone where the town would be: the
 * parser reads "Northern Virginia" as the town "Northern" in VA, "South
 * Florida" as "South", "Upstate New York" as "Upstate" and "West Texas" as
 * "West". The one dataset town of such a name (Central, LA) is still stored
 * at ingest, which checks the city dataset first (lib/location-fallback.ts
 * storedLocality).
 */
const REGION_QUALIFIER_ONLY_RE =
  /^(?:(?:north|south|east|west)(?:ern)?|(?:north|south)(?:east|west)(?:ern)?|central|middle|mid|upper|lower|upstate|downstate|coastal|rural|metro|throughout|statewide|within|across|any|all|several|entire|anywhere|everywhere)$/i;

/**
 * A lead word that makes the rest a description of a place, not its name:
 * "Near Denver", "Our Denver", "Metro Detroit", and a qualifier the parser
 * leaves in front of a state name ("Within Texas" read as the town "Within",
 * "Across Texas", "Entire State").
 */
const NOT_A_TOWN_LEAD_RE =
  /^(?:near|nearby|our|outside|around|throughout|metro|within|across|any|all|several|entire|anywhere|everywhere|surrounding)\s/i;

/** A region suffix after a town name: "Houston Metro", "DFW Metroplex", "Houston Suburbs". */
const REGION_SUFFIX_RE = /\s(?:metro|metroplex|suburbs?)$/i;

/**
 * A placeholder or a work arrangement written where the town would be:
 * "Unknown, TX", "Confidential, TX", "Coming Soon, TX", "Location: See
 * Description, CO", "Location: Flexible, CO", "Field-Based, TX", "Home Based,
 * TX". None is the name of a town in lib/pseo/city-data
 * (tests/lib/locality-shape.test.ts).
 */
const PLACEHOLDER_NOT_TOWN_RE =
  /^(?:unknown|none|other|others|confidential|undisclosed|not\s+specified|unspecified|not\s+applicable|tba|to\s+be\s+determined|coming\s+soon|opening\s+soon|see\s+(?:description|below|above)|flexible|anytown)$|\b(?:field|home)[\s-]?based\b/i;

/**
 * True when the value is a placeholder or a work arrangement, not a town
 * (see PLACEHOLDER_NOT_TOWN_RE). Such a value in front of a state keeps the
 * state and drops the town (lib/location-fallback.ts).
 */
export function namesPlaceholderNotTown(value: string | null | undefined): boolean {
  const text = value?.replace(/\s+/g, ' ').trim() ?? '';
  return !!text && PLACEHOLDER_NOT_TOWN_RE.test(text);
}

/**
 * A street, not a town: a value ending in a street suffix, optionally
 * followed by a direction ("Main St", "N Main St", "Oak Avenue", "Elm Ave",
 * "Market Street", "Main St E"), or a route or post box on its own ("Route",
 * "Hwy", "County Road", "PO Box"). The suffix list is narrow on purpose:
 * towns in lib/pseo/city-data end in Way, Trail, Square, Terrace, Place,
 * Crossing, Run and Parkway ("Federal Way", "Indian Trail", "Temple
 * Terrace", "Miller Place", "Fox Crossing", "Sugarland Run", "Parkway") and
 * one starts with Box ("Box Elder"); none of them matches
 * (tests/lib/locality-shape.test.ts).
 */
const STREET_FRAGMENT_RE =
  /(?:^|\s)(?:st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|pkwy|hwy|highway|ct|pl|cir|pike|tpke|expy|plz)\.?(?:\s+(?:n|s|e|w|ne|nw|se|sw)\.?)?$|^(?:route|rte|hwy|highway|interstate|(?:us|state|county)\s+(?:route|road|highway|hwy|rd|rte)|p\.?\s*o\.?\s*box|box)$/i;

/** Trailing list or sentence punctuation a stored value can carry ("Main St.", "Field -"). */
const EDGE_PUNCTUATION_RE = /^[\s,;:.\-–]+|[\s,;:.\-–]+$/g;

function tidy(value: string | null | undefined): string {
  return value?.replace(/\s+/g, ' ').replace(EDGE_PUNCTUATION_RE, '').trim() ?? '';
}

/**
 * True when the value is a street name rather than a town (see
 * STREET_FRAGMENT_RE). Such a value in front of a state keeps the state and
 * drops the town (lib/location-fallback.ts).
 */
export function namesStreetFragment(value: string | null | undefined): boolean {
  const text = tidy(value);
  return !!text && STREET_FRAGMENT_RE.test(text);
}

/**
 * A site, campus, district or custody word where the town would be: "Field"
 * (a field role: Clover Health's "Field - New Jersey"), "Corporate", "Main"
 * (a main site), "Downtown", "Uptown", "Midtown", "Westside", "County
 * Jail", "Prison". No town in lib/pseo/city-data carries one of these words
 * (tests/lib/locality-shape.test.ts); "Springfield", "Deerfield" and "Maine"
 * do not match a whole word.
 */
const SITE_WORD_RE =
  /\b(?:field|corporate|main|jail|prison|detention|penitentiary|downtown|uptown|midtown|(?:west|east|north|south)side)\b|^(?:west|east|north|south)\s+side$/i;

/**
 * A district word in front of a town names that town: "Downtown Atlanta" is
 * Atlanta, "Uptown Dallas" is Dallas. Directions are left out: "West
 * Hollywood" and "South Portland" are towns in their own right.
 */
const DISTRICT_LEAD_RE = /^(?:downtown|uptown|midtown)\s+(?=\S)/i;

/**
 * Two-letter words that start a real town name in capitals ("EL PASO", "LA
 * JOLLA", "ST LOUIS", "FT WORTH", "MT VERNON", "ON TOP OF THE WORLD"). Any
 * other two-letter word in front of an all-capitals value is a facility or
 * site code ("AH TAMPA" is an AdventHealth site).
 */
const TOWN_LEAD_PARTICLES: ReadonlySet<string> = new Set([
  'EL', 'LA', 'LE', 'DE', 'DU', 'DA', 'DI', 'ST', 'MT', 'FT', 'PT', 'OX', 'ON',
]);

/**
 * The value after a facility or site code in front of it, or null when it
 * has none: "MHC Nashville" gives "Nashville", "GBMC Hospital" gives
 * "Hospital", "SJAGA - Mercy Care Chamblee" gives "Mercy Care Chamblee",
 * "AH TAMPA" gives "TAMPA". A code is an all-capitals word of two to five
 * letters in front of a mixed-case value, or, in an all-capitals value, a
 * two-letter word other than a place-name particle ("EL PASO", "ST LOUIS")
 * or a word of three to five letters with no vowel ("MHC NASHVILLE"). No
 * town in lib/pseo/city-data starts with a code.
 */
export function facilityCodeRemainder(value: string | null | undefined): string | null {
  const text = tidy(value);
  const m = text.match(/^([A-Z]{2,5})(?:\s*[-–/&|]\s*|\s+)(\S.*)$/);
  if (!m) return null;
  const [, code, rest] = m;
  if (/[a-z]/.test(rest)) return rest;
  if (code.length === 2) return TOWN_LEAD_PARTICLES.has(code) ? null : rest;
  return /[AEIOUY]/.test(code) ? null : rest;
}

/**
 * True when the value names a site, campus, district or custody facility,
 * or starts with a facility code, rather than a town: "Field", "Corporate",
 * "Main", "Downtown", "Midtown", "County Jail", "Prison", "Downtown
 * Atlanta" (a district of a town), "MHC Nashville", "AH TAMPA". Such a
 * value in front of a state keeps the state and drops the town
 * (lib/location-fallback.ts); ingest files a district or a coded site under
 * its town when the city dataset knows that town (storedLocality).
 */
export function namesSiteNotTown(value: string | null | undefined): boolean {
  const text = tidy(value);
  return !!text && (SITE_WORD_RE.test(text) || facilityCodeRemainder(text) !== null);
}

const STATE_NAME_ALTERNATION =
  'Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|' +
  'Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|' +
  'Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|' +
  'North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|' +
  'South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming';

/**
 * A qualifier in front of a state name, kept whole when the state follows
 * as a code ("Northern Virginia, VA", "Central Pennsylvania, PA"). A plain
 * direction is left out: "West New York" is a New Jersey town.
 */
const REGION_OF_STATE_RE = new RegExp(
  `^(?:(?:north|south|east|west)ern|(?:north|south)(?:east|west)(?:ern)?|central|middle|upstate|downstate|coastal|rural)\\s+(?:${STATE_NAME_ALTERNATION})$`,
  'i',
);

/**
 * Named regions a location writes where a town would go ("Twin Cities, MN",
 * "Inland Empire, CA", "Hudson Valley, NY", "Gulf Coast, TX"). None is the
 * name of a town in lib/pseo/city-data (tests/lib/locality-shape.test.ts).
 */
const NAMED_REGIONS: ReadonlySet<string> = new Set([
  'twin cities', 'quad cities', 'tri-cities', 'tri cities', 'tri-state', 'inland empire', 'hudson valley',
  'lehigh valley', 'central valley', 'rio grande valley', 'coachella valley', 'san fernando valley',
  'silicon valley', 'eastern shore', 'central coast', 'gulf coast', 'space coast', 'treasure coast',
  'front range', 'western slope', 'upper peninsula', 'hampton roads', 'research triangle', 'south jersey',
  'north jersey', 'central jersey', 'socal', 'norcal', 'nova', 'lowcountry', 'low country', 'delmarva',
  'tidewater', 'hill country', 'permian basin', 'east bay', 'south bay', 'north bay', 'north shore',
  'south shore', 'main line',
]);

/**
 * True when the value names a region of a state, or describes a place
 * rather than naming it: a direction or qualifier alone ("Northern",
 * "South", "Upstate", "Central", "Within", "Across"), a qualifier in front of
 * a state name ("Northern Virginia"), a named region ("Twin Cities", "Inland
 * Empire", "NoVA"), a lead word such as "Near", "Our", "Outside", "Metro" or
 * "Within" ("Near Denver", "Our Denver", "Metro Detroit", "Within Texas") or
 * a region suffix ("Houston Metro", "DFW Metroplex", "Houston Suburbs").
 * Such a value in front of a state keeps the state and drops the town
 * (lib/location-fallback.ts).
 */
export function namesRegionNotTown(value: string | null | undefined): boolean {
  const text = value?.replace(/\s+/g, ' ').trim() ?? '';
  if (!text) return false;
  return (
    REGION_QUALIFIER_ONLY_RE.test(text) ||
    NOT_A_TOWN_LEAD_RE.test(text) ||
    REGION_SUFFIX_RE.test(text) ||
    REGION_OF_STATE_RE.test(text) ||
    NAMED_REGIONS.has(text.toLowerCase())
  );
}

/**
 * Lower-case words a US place name can carry between capitalised words
 * ("Lake in the Hills", "King of Prussia", "Fond du Lac", "Town and
 * Country", "Isle of Palms"). Any other lower-case word marks a sentence
 * fragment ("must reside in", "must hold an active"), not a town.
 */
const PLACE_NAME_PARTICLES: ReadonlySet<string> = new Set([
  'de', 'del', 'della', 'des', 'du', 'of', 'in', 'the', 'and', 'la', 'le', 'los', 'las', 'on', 'by', 'upon', 'en', 'y',
  // "Town 'n' Country, FL"
  "'n'", '’n’',
]);

/** A word written with the French elided article: "d'Alene" in "Coeur d'Alene". */
const ELIDED_ARTICLE_WORD_RE = /^d['’][A-Z]/;

/**
 * Words of a sentence, never of a place name. Only read for a value typed
 * all in lower case ("san antonio" is a town typed that way; "must reside
 * in" and "or canada" are not).
 */
const SENTENCE_WORD_RE =
  /^(?:a|an|or|to|at|as|is|are|be|been|must|should|will|would|can|may|reside|residing|live|living|hold|holding|have|has|active|licensed|license|licenses|licensure|state|states|experience|years?|months?|weeks?|hours?|preferred|required|requires?|candidates?|applicants?|you|your|we|our|this|that|for|with|from|per|any|all|not|no|only|within|remote|hybrid|onsite|position|role|job|located|based|work|working)$/;

/**
 * True when the value is shaped like a place name: no label or list
 * punctuation (":" or ";"), a capital first letter, no lower-case word
 * outside the particles above, and no particle as its last word (a town
 * name never ends in "in" or "of"). A value typed all in lower case
 * ("austin", "san antonio") is read as a name unless it carries a sentence
 * word. Rejects description fragments that a loose reader took for a town:
 * "s: Denver" (from "Locations: Denver, CO"), "must reside in" (from
 * "Remote - must reside in Texas"), "must hold an active" (from "1 year of
 * experience, must hold an active Florida license") and "or Canada" (what
 * "US or Canada" leaves once the US is stripped). Every town in
 * lib/pseo/city-data under the name a posting writes passes
 * (tests/lib/locality-shape.test.ts).
 */
export function hasTownNameShape(value: string | null | undefined): boolean {
  const text = value?.trim() ?? '';
  if (!text || /[:;]/.test(text) || !/^[A-Za-z]/.test(text)) return false;
  const words = text.split(/\s+/);
  if (PLACE_NAME_PARTICLES.has(words[words.length - 1])) return false;
  if (!/[A-Z]/.test(text)) return !words.some((word) => SENTENCE_WORD_RE.test(word));
  if (!/^[A-Z]/.test(text)) return false;
  return words.every(
    (word) => /^[A-Z]/.test(word) || PLACE_NAME_PARTICLES.has(word) || ELIDED_ARTICLE_WORD_RE.test(word),
  );
}

/**
 * True when the value names a specialty, care setting, schedule or region
 * ("Urgent Care", "Per Diem", "Nights", "Greater Houston Area"). Such a
 * value in front of a state is a title or location-line part, so a reader
 * keeps the state and drops the town (lib/location-fallback.ts).
 */
export function namesNonTownTitleWord(value: string | null | undefined): boolean {
  return !!value && NON_TOWN_TITLE_WORD_RE.test(value);
}

/**
 * The stored city value, trimmed of trailing punctuation, when it reads as a
 * town name; null for a street number, address or street name ("Main St",
 * "Oak Ave"; namesStreetFragment), a facility, site or district word or a
 * facility code ("Field", "Corporate", "County Jail", "MHC Nashville", "AH
 * TAMPA"; namesSiteNotTown), a specialty, care setting, schedule or region,
 * an all-capitals acronym, a placeholder or work arrangement ("Unknown",
 * "Coming Soon", "Field Based"; namesPlaceholderNotTown), a sentence
 * fragment (hasTownNameShape), a region of a state or a described place
 * ("Northern", "South", "Near Denver", "Metro Detroit", "Within", "Houston
 * Metro"; namesRegionNotTown), a value that starts in lower case ("tbd",
 * "n/a", "located in"; ingest re-cases a lower-case town the city dataset
 * knows before it stores it) or an over-long value. A district word in
 * front of a town gives the town ("Downtown Atlanta" gives "Atlanta").
 */
export function plausibleLocality(city: string | null | undefined): string | null {
  const trimmed = city?.trim().replace(/[\s,;:.\-]+$/, '').trim();
  const cleaned = trimmed?.replace(DISTRICT_LEAD_RE, '');
  if (!cleaned || cleaned.length > MAX_LOCALITY_LENGTH) return null;
  if (/\d/.test(cleaned)) return null;
  if (!/^[A-Z]/.test(cleaned) || !hasTownNameShape(cleaned)) return null;
  if (NON_LOCALITY_RE.test(cleaned)) return null;
  if (namesNonTownTitleWord(cleaned)) return null;
  if (/^[A-Z]{2,5}$/.test(cleaned)) return null;
  if (namesRegionNotTown(cleaned)) return null;
  if (namesPlaceholderNotTown(cleaned)) return null;
  if (namesStreetFragment(cleaned) || namesSiteNotTown(cleaned)) return null;
  return cleaned;
}
