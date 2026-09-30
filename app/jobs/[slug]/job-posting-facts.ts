/**
 * app/jobs/[slug]/job-posting-facts.ts
 *
 * Pure facts behind the job detail page and its JobPosting markup (indexing
 * audit 2026-09: CS-03, GFJ-01, GFJ-02, GFJ-06, GFJ-07, GFJ-13, GFJ-15,
 * GFJ-16, H-03). One module decides, for the markup AND the visible page:
 *
 *   - whether a job really is 100% remote (isVerifiedFullyRemote). The stored
 *     isRemote flag alone is not trusted: stale rows carry TELECOMMUTE for
 *     on-site jobs, so the markup, the <title>, the OG card and the visible
 *     work-mode chip all read this one predicate;
 *   - which physical places a job names (resolveJobPlaces), one Place per
 *     location, facility names and split street addresses excluded;
 *   - which states a remote job is restricted to (resolveRemoteApplicantStates);
 *   - whether a JobPosting may be emitted at all (isJobPostingEligible): a job
 *     with neither a place nor a verified remote declaration keeps its page
 *     but emits no JobPosting, because an item without jobLocation or
 *     TELECOMMUTE is invalid for Google's job experience; a job whose
 *     description is a synthesized stub (isStubJobDescription, GFJ-04) emits
 *     no JobPosting and its page answers noindex, follow;
 *   - the clean role title Google asks for (cleanRoleTitle);
 *   - the employment types the chip shows and employmentType emits, every
 *     type the posting offers beside the stored one, omitted when unknown
 *     (resolveEmploymentTypes, mapEmploymentTypes);
 *   - whether the stored pay is an estimate the markup must not state
 *     (isEstimatedSalary);
 *   - the employer's requisition id (resolveRequisitionId);
 *   - the one posted date both the page and datePosted read (jobPostedAt).
 *
 * No database access: every function takes the row and returns a value, so
 * each rule is unit-testable. Other surfaces (the Indexing API submitter, the
 * job sitemap) can import isJobPostingEligible from here; it deliberately
 * lives outside components/JobStructuredData.tsx, which only the job page may
 * import (tests/regressions/indexing-safety.test.ts).
 */
import { parseLocation } from '@/lib/location-parser';
import { analyzeDescriptionStub, detectMode } from '@/lib/job-normalizer';
import { resolveJobType, statesW2Employment } from '@/lib/job-type-detection';
import { plausibleLocality } from '@/lib/locality';
import { resolveLocationFallback } from '@/lib/location-fallback';
import { CODE_TO_STATE, STATE_CODES } from '@/lib/pseo/setting-state-config';
import { SALARY_CONFLICT_CONFIDENCE } from '@/lib/salary-normalizer';

/** The row fields these rules read. A structural subset of the Job row. */
export interface JobPostingFactsInput {
  title: string;
  employer?: string | null;
  description?: string | null;
  location?: string | null;
  mode?: string | null;
  isRemote: boolean;
  isHybrid: boolean;
  city?: string | null;
  state?: string | null;
  stateCode?: string | null;
  country?: string | null;
}

/** One physical place a job names. `regionCode` is a two-letter US code. */
export interface JobPlace {
  locality: string | null;
  regionCode: string | null;
}

/* ─── State lookups ─────────────────────────────────────────────────────── */

const STATE_NAME_BY_LOWER: ReadonlyMap<string, string> = new Map(
  Object.keys(STATE_CODES).map((name) => [name.toLowerCase(), name]),
);

/** Two-letter code for a stored state value (a full name or a code), else null. */
export function toStateCode(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  if (CODE_TO_STATE[upper]) return upper;
  const name = STATE_NAME_BY_LOWER.get(trimmed.toLowerCase());
  return name ? STATE_CODES[name] : null;
}

/** Full state name for a two-letter code, else null. */
export function stateNameForCode(code: string | null | undefined): string | null {
  return code ? CODE_TO_STATE[code.toUpperCase()] ?? null : null;
}

/* ─── Listing country ───────────────────────────────────────────────────── */

const US_COUNTRY_VALUES: ReadonlySet<string> = new Set([
  'us', 'usa', 'u.s.', 'u.s.a.', 'united states', 'united states of america',
]);

/**
 * True unless the row names a country other than the US. Owner decision
 * 2026-09: non-US jobs are excluded at ingest and existing ones unpublished;
 * this guard keeps any stray one from emitting a US address it does not have.
 */
export function isUsListing(job: Pick<JobPostingFactsInput, 'country'>): boolean {
  const country = job.country?.trim().toLowerCase();
  return !country || US_COUNTRY_VALUES.has(country);
}

/* ─── Work mode ─────────────────────────────────────────────────────────── */

/**
 * Description markers that contradict a remote flag outright: a negated
 * remote statement, or an ATS "Remote Type: Onsite/Hybrid" field.
 */
const ONSITE_MARKER_RE =
  /\bnot\s+(?:a\s+)?(?:100\s*%|fully|completely|entirely)\s+remote\b|\bnot\s+(?:a\s+)?remote\s+(?:position|role|job|opportunity)\b|\bno\s+remote\s+(?:work|option|options)\b|\bremote\s*type\s*:?\s*(?:on[\s-]?site|hybrid)\b/i;

/**
 * True only when a job is 100% remote on every signal we hold. Google:
 * TELECOMMUTE is "for jobs in which the employee may or must work remotely
 * 100%". A false TELECOMMUTE puts an on-site job under Google's work from
 * home filter (GFJ-01), so every one of these must hold:
 *   1. the stored flags and mode agree: isRemote, not isHybrid, mode Remote;
 *   2. the stored LOCATION string itself carries a remote token ("Remote",
 *      "Remote, US", "TX - Remote", "Telecommute"). "Denver, CO", "United
 *      States" or a street address do not;
 *   3. the title and description do not read as on-site or hybrid;
 *   4. the description carries no negated or ATS on-site marker.
 * Omission beats a wrong claim: a genuinely remote job that fails one check
 * falls back to its physical place, or emits no JobPosting at all.
 */
export function isVerifiedFullyRemote(job: JobPostingFactsInput): boolean {
  if (!job.isRemote || job.isHybrid || job.mode !== 'Remote') return false;
  const location = job.location ?? '';
  const locationSaysRemote = parseLocation(location).isRemote || detectMode(location) === 'Remote';
  if (!locationSaysRemote) return false;
  const description = job.description ?? '';
  const textMode = detectMode(`${job.title} ${description}`);
  if (textMode === 'In-Person' || textMode === 'Hybrid') return false;
  return !ONSITE_MARKER_RE.test(description);
}

export type WorkModeLabel = 'Remote' | 'Hybrid' | 'In-Person';

/**
 * The work mode the page may show. "Remote" appears only when
 * isVerifiedFullyRemote passes, so the chip, the <title> and the markup
 * always agree; an unverified remote claim shows no mode at all.
 */
export function resolveWorkModeLabel(job: JobPostingFactsInput): string | null {
  if (isVerifiedFullyRemote(job)) return 'Remote';
  const raw = job.mode?.trim() || null;
  if (!raw) return job.isHybrid ? 'Hybrid' : null;
  if (/remote/i.test(raw)) return null;
  return raw;
}

/* ─── Physical places ───────────────────────────────────────────────────── */

/**
 * A stored city value only when it reads as a town name. Facility names
 * ("MAIN CAMPUS", "AdventHealth Porter", "GBMC Hospital"), acronyms ("MMC")
 * and placeholders are not addressLocality values; the skeptic review asked
 * that they never be emitted as one. The rule lives in lib/locality.ts so
 * the listing tallies (lib/pseo/listing-facts.ts selectCities) read it too.
 */
export { plausibleLocality };

/** A street number in the city column means the parser split an address. */
function looksLikeSplitAddress(city: string | null | undefined): boolean {
  return !!city && /\d/.test(city);
}

/**
 * Wording that names a state to exclude it: "Remote (excluding CA)",
 * "Remote - except California", "Remote - TX excluded", "All states except
 * New York", "not open to Texas residents". A state written with this
 * wording, in a location string or a title, is the place the job is NOT open
 * to, so it is never read as the job's place or applicant state (GFJ-07: a
 * wrong state hides the job from every eligible applicant).
 */
export const STATE_EXCLUSION_RE =
  /\b(?:except|excluding|exclud(?:e|es|ed)|exclusions?|other\s+than|outside(?:\s+of)?|not\s+(?:in|open|available|eligible))\b/i;

/** The place the stored columns name, or null when they name none. */
function placeFromColumns(job: JobPostingFactsInput): JobPlace | null {
  // FB-3 (the Sol rows): "1730 Rhode Island Ave NW, Washington, DC"
  // was parsed as city '1730', state RI. When the city is a street number
  // the state beside it came from the same broken split, so neither is kept.
  if (looksLikeSplitAddress(job.city)) return null;
  const regionCode = toStateCode(job.stateCode) ?? toStateCode(job.state);
  const locality = plausibleLocality(job.city);
  if (!locality && !regionCode) return null;
  // A state-only column can come from the location string's exclusion
  // wording ("Remote (excluding CA)" parsed as California).
  if (!locality && STATE_EXCLUSION_RE.test(job.location ?? '')) return null;
  return { locality, regionCode };
}

/** Separators a multi-location string uses ("Denver, CO; Aurora, CO"). */
const LOCATION_LIST_SPLIT_RE = /\s*(?:;|\||\n|\s\/\s|\s+or\s+|\s+&\s+)\s*/i;

/**
 * Places a location string lists, each needing a US state to count. None
 * when the string excludes a state ("Remote (excluding CA)"): the state it
 * names is where the job is not open.
 */
export function parseLocationList(location: string | null | undefined): JobPlace[] {
  if (!location || STATE_EXCLUSION_RE.test(location)) return [];
  const parts = location.split(LOCATION_LIST_SPLIT_RE).map((p) => p.trim()).filter(Boolean);
  const places: JobPlace[] = [];
  for (const part of parts) {
    const parsed = parseLocation(part);
    if (parsed.confidence < 0.8 || !parsed.stateCode || !CODE_TO_STATE[parsed.stateCode]) continue;
    if (looksLikeSplitAddress(parsed.city)) continue;
    places.push({ locality: plausibleLocality(parsed.city), regionCode: parsed.stateCode });
  }
  return places;
}

function placeKey(place: JobPlace): string {
  return `${(place.locality ?? '').toLowerCase()}|${place.regionCode ?? ''}`;
}

/**
 * True when the location string's one place names the town the columns
 * leave out, in the columns' own state: Thriveworks stores "VA -
 * Chesterfield" with state Virginia and no city, so without it every
 * Thriveworks posting in Virginia read as "Virginia" alone (M-04).
 */
function locationAddsTown(primary: JobPlace | null, listed: readonly JobPlace[]): boolean {
  if (!primary || primary.locality || listed.length !== 1) return false;
  const [only] = listed;
  return only.locality !== null && only.regionCode === primary.regionCode;
}

/**
 * Every physical place the job names: the stored columns first, then any
 * further places a multi-location string lists. A place already covered by
 * a more specific one (same state, no town) is dropped. Empty for non-US
 * rows and for rows whose only location data is a facility or placeholder.
 */
export function resolveJobPlaces(job: JobPostingFactsInput): JobPlace[] {
  if (!isUsListing(job)) return [];
  const candidates: JobPlace[] = [];
  const primary = placeFromColumns(job);
  if (primary) candidates.push(primary);
  const listed = parseLocationList(job.location);
  // A single listed place only restates the columns; the columns win. When
  // the columns are empty, a single cleanly parsed place still counts, and
  // so does one that adds the town to a state-only row (the same-state
  // filter below then drops the state-only place).
  if (listed.length > 1 || !primary || locationAddsTown(primary, listed)) candidates.push(...listed);

  const seen = new Set<string>();
  const unique: JobPlace[] = [];
  for (const place of candidates) {
    const key = placeKey(place);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(place);
  }
  return unique.filter(
    (place) =>
      place.locality !== null ||
      !unique.some((other) => other !== place && other.locality !== null && other.regionCode === place.regionCode),
  );
}

/**
 * The place the job title (the visible H1) names, read by the rule ingest
 * uses (lib/location-fallback.ts resolveLocationFallback, title source
 * only): "Denver, CO" in "Nurse Practitioner - Denver, CO (Hybrid)" when the
 * city dataset knows the town in that state or the description writes it
 * with that state, else the state alone ("..., Iowa, Remote"). A specialty
 * or a program where the town would go ("Urgent Care, MA", "Float Pool,
 * TX") is never a town. Null when the title names no US place, for a
 * non-US row, or when the title excludes a state ("PMHNP - Anywhere except
 * CA - Remote", "Remote PMHNP (Texas excluded)").
 */
export function titleNamedPlace(job: Pick<JobPostingFactsInput, 'title' | 'description' | 'country'>): JobPlace | null {
  if (!isUsListing(job) || !job.title || STATE_EXCLUSION_RE.test(job.title)) return null;
  const found = resolveLocationFallback({ title: job.title, description: job.description });
  if (!found || found.source !== 'title' || !CODE_TO_STATE[found.stateCode]) return null;
  return { locality: found.city, regionCode: found.stateCode };
}

/* ─── Remote applicant states ───────────────────────────────────────────── */

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Longest names first so "West Virginia" wins over "Virginia".
const STATE_NAMES_BY_LENGTH = Object.keys(STATE_CODES).sort((a, b) => b.length - a.length);
const STATE_NAME_ALT = STATE_NAMES_BY_LENGTH.map(escapeRegExp).join('|');
// Title Case and UPPER CASE spellings, matched case-sensitively so ordinary
// lowercase words ("in", "or", "me") are never read as state codes.
const TITLE_STATE_NAME_ALT = [...STATE_NAMES_BY_LENGTH, ...STATE_NAMES_BY_LENGTH.map((n) => n.toUpperCase())]
  .map(escapeRegExp)
  .join('|');
// "PA" is left out on purpose: in a job title it far more often means
// physician assistant ("Remote NP/PA") than Pennsylvania. The full name, or
// a location string, still resolves Pennsylvania.
const TITLE_STATE_CODE_ALT = Object.keys(CODE_TO_STATE).filter((code) => code !== 'PA').join('|');
const STATE_TOKEN = `\\b(?:${TITLE_STATE_NAME_ALT}|${TITLE_STATE_CODE_ALT})\\b`;

function toStateCodeToken(token: string): string | null {
  return toStateCode(token.replace(/[^A-Za-z\s]/g, ' ').replace(/\s+/g, ' '));
}

/**
 * States listed directly after a remote token ("Remote TX", "Remote (CA,
 * NV)", "REMOTE IN TEXAS"). The preposition is read in either case, so the
 * all-caps "IN" before a state is never Indiana; a bare "Remote IN" still is.
 */
function statesAfterRemote(rest: string): string[] {
  const codes: string[] = [];
  let cursor = rest;
  const lead = new RegExp(`^[\\s,:(\\-–]*(?:(?:in|within|from|IN|WITHIN|FROM)\\s+(?=${STATE_TOKEN}))?(${STATE_TOKEN})`);
  const next = new RegExp(`^\\s*(?:,|/|&|\\band\\b|\\bor\\b)\\s*(${STATE_TOKEN})`);
  let match = cursor.match(lead);
  while (match) {
    const code = toStateCodeToken(match[1]);
    if (code) codes.push(code);
    cursor = cursor.slice(match[0].length);
    match = cursor.match(next);
  }
  return codes;
}

/**
 * The states written directly before a remote token, every state of a list
 * included, in title order: "Oregon, Remote" and "TX Remote" give one,
 * "OR/WA - Remote" and "Oregon or Washington, Remote" give both. Reading
 * only the last one told Google a job open in Oregon and Washington was
 * open in Washington alone (GFJ-07). "Washington, DC" is DC, not a list.
 */
function statesBeforeRemote(before: string): string[] {
  const codes: string[] = [];
  let cursor = before.replace(/\bWashington,?\s+(?=D\.?C\.?(?![A-Za-z]))/g, '');
  let match = cursor.match(new RegExp(`(${STATE_TOKEN})[\\s,:(\\-–]*$`));
  while (match) {
    const code = toStateCodeToken(match[1]);
    if (code && !codes.includes(code)) codes.unshift(code);
    cursor = cursor.slice(0, match.index);
    match = cursor.match(new RegExp(`(${STATE_TOKEN})\\s*(?:\\/|,|&|\\band\\b|\\bor\\b)\\s*$`));
  }
  return codes;
}

/** US states a title ties to its remote token. Uppercase codes only. */
export function statesNearRemoteToken(title: string | null | undefined): string[] {
  if (!title) return [];
  const codes: string[] = [];
  const remoteRe = /\bremote\b/gi;
  let match: RegExpExecArray | null;
  while ((match = remoteRe.exec(title)) !== null) {
    codes.push(...statesBeforeRemote(title.slice(0, match.index)));
    codes.push(...statesAfterRemote(title.slice(match.index + match[0].length)));
  }
  return codes;
}

/** "California license required", "Texas licensed", "Licensed in Maryland", "WA licensure". */
const LICENSE_WORD = '(?:[Ll]icen[sc](?:e|ed|ure)|LICEN[SC](?:E|ED|URE))';
const LICENSE_STATE_RE = new RegExp(
  `(${STATE_TOKEN})\\s+${LICENSE_WORD}\\b|\\b${LICENSE_WORD}\\s+in\\s+(?:the\\s+state\\s+of\\s+)?(${STATE_TOKEN})`,
  'g',
);

/**
 * US states a title names as the license the job requires ("FNP - Women's
 * Health - California license required"). Uppercase codes only, as in
 * statesNearRemoteToken; "PA license" is a physician assistant license.
 */
export function statesNamedAsLicense(title: string | null | undefined): string[] {
  if (!title) return [];
  const codes: string[] = [];
  for (const match of title.matchAll(LICENSE_STATE_RE)) {
    const code = toStateCodeToken(match[1] ?? match[2] ?? '');
    if (code) codes.push(code);
  }
  return codes;
}

/**
 * Two-letter codes that, written bare in a job title, far more often mean
 * something else: a credential or a service ("MD/DO/NP", "MA", "MS Clinic",
 * "ID Clinic", "CT Surgery", "VA Clinic", "ND") or an English word in an
 * all-caps title ("NP OR PA", "IN CLINIC", "OK", "HI", "ME"). Beside a
 * remote token or a license word ("Remote OR", "MD license required"), or
 * listed beside another state ("OR/WA", "ME, NH", "MD/DC/VA"), they still
 * name the state. "PA" is never read as a state code in a title.
 */
const WORD_LIKE_TITLE_CODES: ReadonlySet<string> = new Set([
  'CT', 'HI', 'ID', 'IN', 'MA', 'MD', 'ME', 'MS', 'ND', 'OK', 'OR', 'VA',
]);
const TITLE_STATE_TOKEN_RE = new RegExp(STATE_TOKEN, 'g');
/** What joins the states of a list ("OR/WA", "OR, WA", "OR and WA"). */
const STATE_LIST_SEPARATOR = String.raw`\s*(?:\/|,|&|\band\b|\bor\b)\s*`;
const STATE_LISTED_BEFORE_RE = new RegExp(`${STATE_TOKEN}${STATE_LIST_SEPARATOR}$`);
const STATE_LISTED_AFTER_RE = new RegExp(`^${STATE_LIST_SEPARATOR}${STATE_TOKEN}`);

/** True when the token at `index` is one item of a list of states ("OR/WA"). */
function isListedWithState(title: string, index: number, length: number): boolean {
  return STATE_LISTED_BEFORE_RE.test(title.slice(0, index)) || STATE_LISTED_AFTER_RE.test(title.slice(index + length));
}

/**
 * Every US state a title names, anywhere in it: a full state name, a state
 * code, a state beside the remote token or the license the job requires
 * ("North Carolina | Telehealth PMHNP", "CA License", "PMHNP - California
 * and Texas license required" gives CA and TX). Uppercase codes, each
 * once. A bare code in WORD_LIKE_TITLE_CODES counts only when it is listed
 * beside another state ("Telehealth PMHNP - OR/WA" gives OR and WA, while
 * "MD, DO, NP or PA" and "ID Clinic" give none).
 * Callers use it to tell a title that ties the job to one state from one
 * that names several, which then names no single place.
 */
export function statesNamedInTitle(title: string | null | undefined): string[] {
  if (!title) return [];
  const codes = new Set<string>([...statesNearRemoteToken(title), ...statesNamedAsLicense(title)]);
  for (const match of title.matchAll(TITLE_STATE_TOKEN_RE)) {
    const code = toStateCodeToken(match[0]);
    if (!code) continue;
    const wordLike = match[0].length === 2 && WORD_LIKE_TITLE_CODES.has(code);
    if (wordLike && !isListedWithState(title, match.index ?? 0, match[0].length)) continue;
    codes.add(code);
  }
  return [...codes];
}

/**
 * Full names of the states a verified-remote job is restricted to (GFJ-07),
 * read from the two sources the employer wrote: the location string ("Remote
 * - TX", "Texas (Remote)") and a state written next to the title's remote
 * token ("FNP, Remote TX", "Oregon, Remote"). The stored state column is
 * NOT read on its own: for remote rows it can come from enrichment of the
 * description (a headquarters address), and a wrong state would hide the job
 * from every eligible applicant. Empty means nationwide. A source that
 * excludes a state ("Remote (excluding CA)", "All states except California,
 * Remote") is not read at all: the state it names is the one the job is NOT
 * open to.
 */
export function resolveRemoteApplicantStates(job: JobPostingFactsInput): string[] {
  const codes = new Set<string>();
  const location = STATE_EXCLUSION_RE.test(job.location ?? '') ? '' : job.location ?? '';
  for (const place of parseLocationList(location)) {
    if (place.regionCode) codes.add(place.regionCode);
  }
  const whole = parseLocation(location);
  if (whole.stateCode && whole.confidence >= 0.8 && CODE_TO_STATE[whole.stateCode] && !looksLikeSplitAddress(whole.city)) {
    codes.add(whole.stateCode);
  }
  // A list after the location's own remote token ("Remote - CA, NV"), which
  // the single-place parse above reads only in part.
  for (const code of statesNearRemoteToken(location)) codes.add(code);
  if (!STATE_EXCLUSION_RE.test(job.title)) for (const code of statesNearRemoteToken(job.title)) codes.add(code);
  return [...codes].map((code) => CODE_TO_STATE[code]).filter((name): name is string => Boolean(name));
}

/* ─── Eligibility ───────────────────────────────────────────────────────── */

/**
 * True when a JobPosting item for this job would carry Google's required
 * location: a physical jobLocation, or TELECOMMUTE plus
 * applicantLocationRequirements for a verified fully remote job. A job
 * without one keeps an indexable page (web search does not need the rich
 * result) but emits no JobPosting (CS-03, GFJ-02).
 */
export function hasJobPostingLocation(job: JobPostingFactsInput): boolean {
  if (!isUsListing(job)) return false;
  return isVerifiedFullyRemote(job) || resolveJobPlaces(job).length > 0;
}

/**
 * True when the stored description is a synthesized stub rather than the
 * employer's posting (GFJ-04): the title and "Employer: / Department: /
 * Location:" metadata only, or almost no prose at all. It is the same test
 * ingest rejects with (analyzeDescriptionStub, lib/job-normalizer.ts). Rows
 * stored before that gate (the three Televero BambooHR stubs) render with
 * no JobPosting and `noindex, follow` until the adapter fetches the full
 * posting: Google does not allow "job postings with incomplete job
 * descriptions", and the page has nothing else to offer a searcher.
 */
export function isStubJobDescription(job: Pick<JobPostingFactsInput, 'title' | 'description'>): boolean {
  return analyzeDescriptionStub(job.description, job.title).isStub;
}

/**
 * True when the page may emit a JobPosting item: a US listing with a real
 * description and Google's required location. The job page, JobStructuredData
 * and the Indexing API submitter (app/api/cron/index-urls) all read this one
 * rule, so nothing is submitted as a job posting that the page does not mark
 * up as one.
 */
export function isJobPostingEligible(job: JobPostingFactsInput): boolean {
  return hasJobPostingLocation(job) && !isStubJobDescription(job);
}

/* ─── Employment type (GFJ-06) ──────────────────────────────────────────── */

const EMPLOYMENT_TYPE_BY_KEY: Readonly<Record<string, readonly string[]>> = {
  fulltime: ['FULL_TIME'],
  permanent: ['FULL_TIME'],
  parttime: ['PART_TIME'],
  contract: ['CONTRACTOR'],
  contractor: ['CONTRACTOR'],
  perdiem: ['PER_DIEM'],
  prn: ['PER_DIEM'],
  travel: ['TEMPORARY'],
  temporary: ['TEMPORARY'],
  temp: ['TEMPORARY'],
  internship: ['INTERN'],
  intern: ['INTERN'],
  // A locum tenens NP is an independent contractor on a fixed-term
  // assignment; Google accepts more than one employmentType.
  locumtenens: ['CONTRACTOR', 'TEMPORARY'],
  locums: ['CONTRACTOR', 'TEMPORARY'],
  locum: ['CONTRACTOR', 'TEMPORARY'],
  volunteer: ['VOLUNTEER'],
};

/**
 * Google employmentType for a stored jobType, or undefined when the type is
 * unknown. employmentType is only recommended, so an unknown type is omitted
 * rather than defaulted to FULL_TIME (163 live rows had no type).
 */
export function mapEmploymentType(jobType: string | null | undefined): string | string[] | undefined {
  if (!jobType) return undefined;
  const key = jobType.toLowerCase().replace(/[^a-z]/g, '');
  const values = EMPLOYMENT_TYPE_BY_KEY[key];
  if (!values) return undefined;
  return values.length === 1 ? values[0] : [...values];
}

/** Google values a type maps to, as one comparable key ("" when unknown). */
function employmentKey(jobType: string): string {
  return [mapEmploymentType(jobType) ?? []].flat().join('+');
}

/** The key of a stored Contract (Google CONTRACTOR). */
const CONTRACTOR_KEY = 'CONTRACTOR';

/**
 * Every employment type the page shows and the markup emits (H-03): the
 * stored type first, then any other schedule the posting offers beside it
 * ("Full-time or part-time schedules available"). The row stores one
 * jobType (filters and alerts key on it), so the second type is re-derived
 * here from the title and description through resolveJobType. It is added
 * only when that derivation also finds the stored type, so a stale or
 * ATS-supplied value is never contradicted, only completed. One exception:
 * a stored Contract on a posting that states W-2 employment (a row stored
 * before the H-03 fix, such as "Fee For Service (W2)") is never shown or
 * emitted; the page shows what the posting states instead, or no type.
 * Empty when the row has no type.
 */
export function resolveEmploymentTypes(job: {
  jobType?: string | null;
  title: string;
  description?: string | null;
}): string[] {
  const stored = job.jobType?.trim();
  if (!stored) return [];
  const storedKey = employmentKey(stored);
  if (!storedKey) return [stored];
  const offered = resolveJobType({ canonicalAts: null, title: job.title, description: job.description }).types;
  if (storedKey === CONTRACTOR_KEY && statesW2Employment(job.title, job.description)) return [...offered];
  if (!offered.some((type) => employmentKey(type) === storedKey)) return [stored];
  const others = offered.filter((type) => {
    const key = employmentKey(type);
    return key !== '' && key !== storedKey;
  });
  return [stored, ...others];
}

/**
 * JobPosting.employmentType for the page's types: one value, an array when
 * the posting offers several ("FULL_TIME", "PART_TIME"), or undefined when
 * none is known.
 */
export function mapEmploymentTypes(types: readonly string[]): string | string[] | undefined {
  const values = [...new Set(types.flatMap((type) => [mapEmploymentType(type) ?? []].flat()))];
  if (values.length === 0) return undefined;
  return values.length === 1 ? values[0] : values;
}

/** The chip text for the page's types: "Full-Time", or "Full-Time or Part-Time". */
export function employmentTypeLabel(types: readonly string[]): string | null {
  return types.length > 0 ? types.join(' or ') : null;
}

/* ─── Estimated pay (CQ-02) ─────────────────────────────────────────────── */

/**
 * True when the row's pay is flagged as not the employer's stated figure:
 * salaryIsEstimated (the ingest structured-vs-text conflict flag, or a source
 * range marked estimated or predicted), or a confidence at or below the
 * conflict floor (SALARY_CONFLICT_CONFIDENCE, lib/salary-normalizer.ts).
 * Google defines baseSalary as the employer's figure, "not an estimate", so
 * the markup omits it, and the meta description does not quote it.
 */
export function isEstimatedSalary(job: { salaryIsEstimated?: boolean | null; salaryConfidence?: number | null }): boolean {
  if (job.salaryIsEstimated === true) return true;
  return typeof job.salaryConfidence === 'number' && job.salaryConfidence <= SALARY_CONFLICT_CONFIDENCE;
}

/* ─── Requisition id (GFJ-13) ───────────────────────────────────────────── */

const UUID_TAIL_RE = /-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * The hiring organization's own id for the job, parsed from the ingest
 * externalId (`{provider}-{tenant}-{atsId}`). Only employer ATS sources
 * qualify: an id minted by a third-party board (Adzuna, the fantastic-jobs
 * feed, DocCafe, HealthcareerCenter) or by this site is not the employer's
 * identifier, so it yields null and the property is omitted.
 */
export function resolveRequisitionId(externalId: string | null | undefined): string | null {
  const id = externalId?.trim();
  if (!id) return null;
  const provider = id.slice(0, id.indexOf('-')).toLowerCase();
  const tail = (re: RegExp): string | null => id.match(re)?.[1] ?? null;
  let value: string | null = null;
  switch (provider) {
    case 'greenhouse':
    case 'smartrecruiters':
    case 'bamboohr':
      value = tail(/-(\d+)$/);
      break;
    case 'lever':
    case 'ashby':
      value = tail(UUID_TAIL_RE);
      break;
    case 'workable':
      value = tail(/-([A-Za-z0-9]+)$/);
      break;
    case 'jazzhr':
      value = tail(/-([A-Za-z0-9_]+)$/);
      break;
    case 'workday': {
      // The Workday path segment is "{Title-Words}_{RequisitionId}".
      const underscore = id.lastIndexOf('_');
      value = underscore > 0 ? id.slice(underscore + 1) : null;
      break;
    }
    case 'usajobs':
      value = tail(/^usajobs-(\d+)$/i);
      break;
    default:
      value = null;
  }
  if (!value || value.length > 64 || !/^[A-Za-z0-9_-]+$/.test(value) || !/\d/.test(value)) return null;
  return value;
}

/* ─── Posted date (GFJ-16) ──────────────────────────────────────────────── */

/**
 * The employer's original posting date, falling back to the date the row was
 * created. The visible "Posted …" line and JobPosting.datePosted both read
 * this, so the page and the markup never show two different dates.
 */
export function jobPostedAt(job: { originalPostedAt?: Date | string | null; createdAt: Date | string }): Date {
  const raw = job.originalPostedAt || job.createdAt;
  return raw instanceof Date ? raw : new Date(raw);
}

/* ─── Clean role title (GFJ-15) ─────────────────────────────────────────── */

const PAY_OR_BONUS_RE =
  /\$|\bbonus\b|\bsign[\s-]?on\b|\bsigning\b|\brelocation\b|\bup\s+to\s+\$?\d|\b\d[\d,.]*\s*(?:k\b|\/\s*(?:hr|hour|yr|year)\b|an?\s+hour\b|per\s+(?:hour|year|visit|shift)\b|hourly\b|annually\b)/i;
const JOB_CODE_RE = /(?:^|\s)#\s*\d|\b(?:req(?:uisition)?|job)\s*(?:id|code|no\.?|number)?\s*[:#]?\s*[a-z]{0,3}[-\s]?\d{3,}\b|\b[A-Z]{1,3}-?\d{4,}\b/i;
const COUNTY_RE = /^[a-z .'-]+\bcounty$/i;
const STATE_NAMES_RE = new RegExp(`\\b(?:${STATE_NAME_ALT})\\b`, 'gi');

/** Words that carry work mode, schedule type or place, never the role. */
const NOISE_WORDS: ReadonlySet<string> = new Set([
  'remote', 'hybrid', 'onsite', 'on', 'site', 'in', 'person', 'inperson', 'telecommute', 'wfh',
  'work', 'from', 'home', 'fully', '100', '100%',
  'full', 'part', 'time', 'fulltime', 'parttime', 'ft', 'pt', 'per', 'diem', 'prn',
  'contract', 'contractor', 'locum', 'locums', 'tenens', 'temporary', 'temp', 'w2', '1099',
  'united', 'states', 'usa', 'us', 'nationwide', 'and', 'or',
]);

function lower(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/** The row fields the role title rules read. */
type TitleContext = Pick<JobPostingFactsInput, 'city' | 'state' | 'stateCode' | 'employer' | 'description' | 'country'>;

/**
 * True when a segment is the town: the city itself, or a slash pair that
 * starts with it ("Springboro/Miamisburg" when the town is Springboro).
 */
function isTownSegment(low: string, city: string | null | undefined): boolean {
  const town = lower(city);
  if (!town) return false;
  return low === town || (low.includes('/') && low.split('/')[0].trim() === town);
}

/**
 * The row's context with the town its title names ("Nurse Practitioner,
 * Parkersburg, WV", "Springboro/Miamisburg, OH") standing in for an empty
 * city column (titleNamedPlace), so that town is read as a place and never
 * kept as a role word.
 */
function withTitleTown(title: string, job: TitleContext): TitleContext {
  if (job.city?.trim()) return job;
  const town = titleNamedPlace({ title, description: job.description, country: job.country })?.locality;
  return town ? { ...job, city: town } : job;
}

/** True when a title segment names only a place, a mode, a schedule or pay. */
function isNoiseSegment(segment: string, job: TitleContext): boolean {
  const trimmed = segment.trim().replace(/^[\s,:;·|\-–—]+|[\s,:;·|\-–—]+$/g, '');
  if (!trimmed) return true;
  if (PAY_OR_BONUS_RE.test(trimmed) || JOB_CODE_RE.test(trimmed)) return true;
  const low = trimmed.toLowerCase();
  if (low === lower(job.employer) || isTownSegment(low, job.city) || low === lower(job.state) || low === lower(job.stateCode)) {
    return true;
  }
  if (COUNTY_RE.test(trimmed)) return true;

  // Drop mode and schedule words, then ask whether a place is all that is left.
  // A bare separator token ("-" in "Remote - Oregon") carries nothing.
  const tokens = trimmed.split(/[\s,/&+()]+/).filter(Boolean);
  const meaningful = tokens.filter(
    (t) => /[a-z0-9]/i.test(t) && !NOISE_WORDS.has(t.toLowerCase().replace(/[^a-z0-9%]/g, '')),
  );
  const remainder = meaningful.join(' ').replace(/-+$/, '').trim();
  if (!remainder) return true;
  const withoutStates = remainder
    .replace(STATE_NAMES_RE, ' ')
    .split(/\s+/)
    .filter((t) => t && !(t === t.toUpperCase() && CODE_TO_STATE[t.replace(/[^A-Z]/g, '')] && t.replace(/[^A-Z]/g, '').length === 2))
    .join(' ')
    .trim();
  if (!withoutStates) return true;
  return isTownAndStateSegment(trimmed);
}

/** "Denver, CO" or "Newark, NJ (Hybrid)": a town with its state is a place. */
function isTownAndStateSegment(segment: string): boolean {
  const placeText = segment
    .replace(/\b(?:hybrid|remote|on[\s-]?site|in[\s-]?person)\b/gi, '')
    .replace(/^[\s,\-–]+|[\s,\-–]+$/g, '')
    .trim();
  if (!/^[A-Za-z .'-]+,\s*[A-Za-z .]+$/.test(placeText)) return false;
  const parsed = parseLocation(placeText);
  return parsed.confidence >= 1 && !!parsed.city && !!parsed.stateCode;
}

const MAJOR_SEPARATOR_RE = /\s+[-–—|·]\s+|\s*[|·]\s*|\s*[–—]\s*|\s+-(?=\S)|(?<=\S)-\s+/;
/**
 * A comma between segments. A thousands separator ("$150,000", "1,000 Bed
 * Hospital") is not one, so a number is never cut in half.
 */
const MINOR_SEPARATOR_RE = /\s*(?:(?<!\d),|,(?!\d{3}(?!\d)))\s*/;
/** An innermost parenthetical, with the whitespace before it. */
const PARENTHETICAL_RE = /(\s*)\(([^()]*)\)/g;
/** Stands in for a kept parenthetical while the separators are split. */
const MASK_RE = /\u0001(\d+)\u0001/g;

/**
 * The role segments of a stretch of title text: split on the major
 * separators, then on commas, every noise segment dropped. A whole "Town,
 * ST" segment is judged as one place before the comma split, which would
 * otherwise leave the town behind as a role word. `unmask` restores the
 * parentheticals masked out of `text`, so a separator inside one never
 * splits it.
 */
function roleSegments(text: string, job: TitleContext, unmask: (masked: string) => string): string[] {
  const kept: string[] = [];
  for (const major of text.split(MAJOR_SEPARATOR_RE).map((s) => s.trim()).filter(Boolean)) {
    if (isTownAndStateSegment(unmask(major))) continue;
    const minors = major.split(MINOR_SEPARATOR_RE).map((s) => unmask(s.trim())).filter(Boolean);
    const keptMinors = minors.filter((minor) => !isNoiseSegment(minor, job));
    if (keptMinors.length > 0) kept.push(keptMinors.join(', '));
  }
  return kept;
}

/**
 * The job's role title for JobPosting.title: Google wants "the title of the
 * job (not the title of the posting)" and no "job codes, addresses, dates,
 * salaries, or company names". Separator-delimited segments that carry only
 * pay, a bonus, a job code, a place, a work mode or a schedule type are
 * dropped ("FNP, Remote TX Part Time, Up to 90 an Hour" becomes "FNP").
 * A parenthetical is cleaned by the same rules on its own: one holding only
 * noise goes ("(Remote - Oregon)"), one holding a role keeps just that
 * ("(NP - Outpatient)" becomes "(NP, Outpatient)"), and a separator inside
 * it never splits the title. A thousands separator is never read as a
 * comma, so "Up to $150,000" goes whole. Role segments ("Behavioral
 * Health", "Evenings") stay, joined with ", " so no dash separator is left
 * (house style covers structured data), and every word stays whole. The
 * town is the row's city, or, when the city column is empty, the town the
 * title itself names (titleNamedPlace), so "Nurse Practitioner, Parkersburg,
 * WV" becomes "Nurse Practitioner" even before ingest backfills the city.
 * When every segment would go, the stored title is returned with its
 * separators normalised.
 */
export function cleanRoleTitle(title: string, row: TitleContext = {}): string {
  const original = title.replace(/\s+/g, ' ').trim();
  if (!original) return original;
  const job = withTitleTown(original, row);

  // Clean and mask each parenthetical, innermost first, so the separator
  // split below can neither cut one open nor leave a stray "(".
  const groups: string[] = [];
  const unmask = (text: string): string => text.replace(MASK_RE, (_m, i: string) => groups[Number(i)] ?? '');
  let masked = original;
  for (let previous = ''; previous !== masked; ) {
    previous = masked;
    masked = masked.replace(PARENTHETICAL_RE, (_whole, lead: string, inner: string) => {
      // A dropped group leaves a space, so the words around it never join.
      if (isNoiseSegment(unmask(inner), job)) return ' ';
      const inside = roleSegments(inner, job, unmask);
      if (inside.length === 0) return ' ';
      groups.push(`(${inside.join(', ')})`);
      return `${lead}\u0001${groups.length - 1}\u0001`;
    });
  }

  // Every matched pair is masked by now, so a "(" or ")" still present has no
  // partner ("Nurse Practitioner (Remote", a title cut short at the ATS). It
  // is read as a separator, never kept to unbalance the title.
  const unpaired = masked.replace(/\s*[()]\s*/g, ' - ');
  const joined = roleSegments(unpaired, job, unmask).join(', ').replace(/\s+/g, ' ').trim();
  if (joined) return joined;
  return original.split(MAJOR_SEPARATOR_RE).map((s) => s.trim()).filter(Boolean).join(', ');
}
