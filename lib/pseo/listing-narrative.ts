/**
 * lib/pseo/listing-narrative.ts
 *
 * Pure sentence builders for every data-backed copy template in the pSEO
 * thin-content plan (PLAN.md C.4): state hubs (HUB), city pages (CITY),
 * category-state (CS), category-city (CC), category landings (LAND), city
 * directories (DIR), metros (METRO), salary guides (SAL, SPEC) and company
 * profiles (CO). Builders take ListingFacts (lib/pseo/listing-facts.ts) or
 * dataset rows and return `string | null`; null means "render nothing",
 * and the FAQ builders drop the matching entry in the same decision.
 *
 * Copy rules enforced here: professional English, no dashes, ranges read
 * "to"; every count pluralized; zero clauses omitted, never printed as
 * "0 hybrid"; "median" never "average"; the board median is never called
 * national and the BLS figure is cited inline; anesthesia and midwifery
 * never receive the NP median; absolute UTC dates; niche identity from
 * brand.niche tokens. No database access.
 */
import { brand } from '@/config/brand';
import { STAT_SOURCES } from '@/lib/stats-sources';
import { COUNT_DISPLAY_FLOOR } from '@/lib/canonical-counts';
import { BENCHMARK_MIN_EMPLOYERS, BENCHMARK_MIN_POSTINGS, type BenchmarkRow } from '@/components/tools/benchmark-model';
import { formatCount, indefiniteArticle, isAre, joinWithAnd, pluralize, wasWere } from '@/lib/display-text';
import {
  getAuthorityLabel, getStatePracticeAuthority, STATE_PRACTICE_AUTHORITY, type PracticeAuthority,
} from '@/lib/state-practice-authority';
import { MIN_JOBS_FOR_CATEGORY_CITY } from './render-gate';
import { CATEGORY_AXES } from './taxonomy-registry';
import { CODE_TO_STATE } from './setting-state-config';
import { getCategoryAxis } from './category-axis-guide';
import { assembleDescription, TITLE_PAGE_PART_MAX } from './category-metadata';
import {
  nlcMembershipPhrase, nlcSentence, nlcShort, type PracticeEnvironment,
} from './practice-environment';
import {
  fieldMixQualifies, MIX_MIN_POSTINGS_HUB, MIX_MIN_POSTINGS_LISTING,
  RECENCY_MIN_POSTINGS_HUB, type EmployerFact, type FieldMix, type LabeledCount, type ListingFacts,
  type RecencyFacts, type StateCount, type WorkModeMix,
} from './listing-facts';

const NP = brand.niche.short;
const NP_PROSE = brand.niche.descriptor;
const NP_PROSE_PLURAL = `${NP_PROSE}s`;

export interface NamedCount { name: string; count: number }
export interface FaqEntry { question: string; answer: string }
type EmployerFacts = Pick<ListingFacts, 'total' | 'distinctEmployers' | 'topEmployers'>;

// ─── Formatting helpers ─────────────────────────────────────────────────────

/** "September 9, 2026" in UTC (ISR pages never print relative dates). */
export function formatUtcDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** "Sep 9" in UTC, for descriptions. */
export function formatUtcDateShort(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/**
 * The noun for a jurisdiction's kind: "state" for the 50 states,
 * "jurisdiction" for the District of Columbia, which is not a state (AANP
 * lists Washington, D.C. apart from the 50 states, and the repo rule is
 * tests/regressions/dc-jurisdiction-wording.test.ts). Keyed by the STATE_CODES
 * code, as isDistrictOfColumbia in app/jobs/locations/[state]/directory.ts
 * is, so no second spelling of the name can drift; lib does not import app.
 */
function jurisdictionNoun(stateCode: string | undefined): 'state' | 'jurisdiction' {
  return stateCode === 'DC' ? 'jurisdiction' : 'state';
}

/** Own-key test, so an inherited key such as "constructor" never reads as a jurisdiction. */
function hasOwnKey(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/** The jurisdiction's AANP tier from its own dataset row, or null off the dataset. */
function aanpTierOf(stateName: string): PracticeAuthority | null {
  return hasOwnKey(STATE_PRACTICE_AUTHORITY, stateName) ? STATE_PRACTICE_AUTHORITY[stateName].authority : null;
}

/** aanpTierOf for a builder that has only the two-letter code. */
function aanpTierOfCode(stateCode: string): PracticeAuthority | null {
  return hasOwnKey(CODE_TO_STATE, stateCode) ? aanpTierOf(CODE_TO_STATE[stateCode]) : null;
}

/**
 * "AANP classification: Full Practice." The one tier clause every meta
 * description and hero deck prints; null (clause omitted) off the dataset.
 *
 * WHY it names AANP's tier and nothing else: these descriptions used to print
 * the caller's tier text as a bare fact, and every caller passed the dataset's
 * `description`, so the state hub hero and three meta descriptions read "Full
 * Practice Authority state." for Connecticut, New York and every other
 * full-tier jurisdiction whose verified details describe a transition period
 * before independent practice. The tier is AANP's classification, so the
 * clause attributes it and states no rule; what a state requires is its
 * `details`, printed in the page's practice section. The same wording as the
 * job page's location panel ("AANP classification: Restricted Practice"), and
 * no noun, so the District of Columbia is never called a state.
 */
function aanpClassificationClause(tier: PracticeAuthority | null): string | null {
  return tier ? `AANP classification: ${getAuthorityLabel(tier)}.` : null;
}

/** "Full", "full" or "FULL" (the metro records' Title Case tier) as the tier key; null for anything else. */
function tierFromName(name: string): PracticeAuthority | null {
  const key = name.toLowerCase();
  return key === 'full' || key === 'reduced' || key === 'restricted' ? key : null;
}

/** "$120K" from 120_000. */
export function formatK(dollars: number): string {
  return `$${Math.round(dollars / 1000)}K`;
}

/** "$129,210" from 129_210. */
export function formatDollars(dollars: number): string {
  return `$${Math.round(dollars).toLocaleString('en-US')}`;
}

/** "Texas (4)" for pills and inline lists. */
export function formatCountLabel(item: { label: string; count: number } | NamedCount): string {
  const text = 'label' in item ? item.label : item.name;
  return `${text} (${item.count})`;
}

function countList(items: ReadonlyArray<{ label: string; count: number } | NamedCount>, limit = 3): string {
  return joinWithAnd(items.slice(0, limit).map(formatCountLabel));
}

const BLS_REFERENCE = `${STAT_SOURCES.averageSalary.formatted} (${STAT_SOURCES.averageSalary.source})`;
/** "May 2024" from the entry's own asOf, so the short cite can never drift from the long one. */
const BLS_AS_OF_LABEL = new Date(`${STAT_SOURCES.averageSalary.asOf}-01T00:00:00Z`)
  .toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
/** Short inline cite for metadata, where the full source string would never fit the budget. */
const BLS_SHORT_REFERENCE = `${STAT_SOURCES.averageSalary.formatted} (${STAT_SOURCES.averageSalary.source.split(',')[0]}, ${BLS_AS_OF_LABEL})`;
/** BLS sentence for category-state S4. */
export const NATIONAL_MEDIAN_SENTENCE = `Nationally, ${NP_PROSE_PLURAL} earn a median annual wage of ${BLS_REFERENCE}.`;
/** BLS reference sentence for city C5 and category-city K3. */
export const NATIONAL_REFERENCE_SENTENCE = `For reference, the national median wage for ${NP_PROSE_PLURAL} is ${BLS_REFERENCE}.`;
/** B8: the board-wide median is never called "national". */
export const BOARD_MEDIAN_LABEL = `Median across all ${brand.name} postings`;
/** Categories that never receive the NP median (their pay pool is a different profession). */
export const NP_MEDIAN_EXCLUDED_SLUGS: ReadonlySet<string> = new Set(['anesthesia', 'midwifery']);

export function receivesNpMedian(slug: string | null | undefined): boolean {
  return !slug || !NP_MEDIAN_EXCLUDED_SLUGS.has(slug);
}

// ─── Work mode clauses ──────────────────────────────────────────────────────

type ModeKey = 'remote' | 'hybrid' | 'onsite';
const MODE_LABEL: Record<ModeKey, string> = { remote: 'remote', hybrid: 'hybrid', onsite: 'on site' };
const MODE_LABEL_CITY: Record<ModeKey, string> = { remote: 'remote', hybrid: 'hybrid', onsite: 'in person' };

function nonZeroModes(mix: WorkModeMix, order: ModeKey[]): Array<{ key: ModeKey; n: number }> {
  return order.map((key) => ({ key, n: mix[key] })).filter((m) => m.n > 0);
}

/** HUB-S4 shape: "{r} of {n} open roles are remote, {h} are hybrid and {o} are on site." */
function hubModeSentence(mix: WorkModeMix, subject: string): string {
  const modes = nonZeroModes(mix, ['remote', 'hybrid', 'onsite']);
  if (modes.length === 1) return `All ${mix.total} ${subject} are ${MODE_LABEL[modes[0].key]}.`;
  const [first, ...rest] = modes;
  const clauses = [
    `${first.n} of ${mix.total} ${subject} ${isAre(first.n)} ${MODE_LABEL[first.key]}`,
    ...rest.map((m) => `${m.n} ${isAre(m.n)} ${MODE_LABEL[m.key]}`),
  ];
  return `${joinWithAnd(clauses)}.`;
}

/** CITY-C3 shape: "Of the {n} {subject}, {a} are in person, {b} are hybrid and {c} are remote." */
function cityModeSentence(mix: WorkModeMix, subject: string): string {
  const modes = nonZeroModes(mix, ['onsite', 'hybrid', 'remote']);
  if (modes.length === 1) return `All ${mix.total} ${subject} are ${MODE_LABEL_CITY[modes[0].key]}.`;
  const clauses = modes.map((m) => `${m.n} ${isAre(m.n)} ${MODE_LABEL_CITY[m.key]}`);
  return `Of the ${mix.total} ${subject}, ${joinWithAnd(clauses)}.`;
}

/** CS-S3 shape: "{r} of {n} are remote, {h} hybrid and {o} on site." */
function compactModeSentence(mix: WorkModeMix): string {
  const modes = nonZeroModes(mix, ['remote', 'hybrid', 'onsite']);
  if (modes.length === 1) return `All ${mix.total} are ${MODE_LABEL[modes[0].key]}.`;
  const [first, ...rest] = modes;
  const clauses = [
    `${first.n} of ${mix.total} ${isAre(first.n)} ${MODE_LABEL[first.key]}`,
    ...rest.map((m) => `${m.n} ${MODE_LABEL[m.key]}`),
  ];
  return `${joinWithAnd(clauses)}.`;
}

// ─── Employers (HUB-S1, CITY-C1, CS-S1, LAND-L1, CC-K1, DIR-L2, METRO-M4) ───

function topTie(top: readonly EmployerFact[]): { names: string[]; count: number } {
  const count = top[0].count;
  return { names: top.filter((e) => e.count === count).slice(0, 3).map((e) => e.name), count };
}

/** HUB-S1, rendered at 2 or more employers. */
export function buildHubEmployersSentence(input: { stateName: string; facts: EmployerFacts }): string | null {
  const { stateName, facts } = input;
  if (facts.distinctEmployers < 2 || facts.topEmployers.length === 0) return null;
  const shown = facts.topEmployers.slice(0, 3);
  const named = shown.map((e, i) => `${e.name} (${i === 0 ? formatCount(e.count, 'role') : e.count})`);
  const first = `The employers with the most open ${NP} roles in ${stateName} right now are ${joinWithAnd(named)}.`;
  const others = facts.distinctEmployers - shown.length;
  const remaining = facts.total - shown.reduce((sum, e) => sum + e.count, 0);
  if (others < 1 || remaining < 1) return first;
  return `${first} ${formatCount(others, 'other employer')} ${others === 1 ? 'accounts' : 'account'} for the remaining ${formatCount(remaining, 'posting')}.`;
}

/** CITY-C1, rendered at 2 or more employers. */
export function buildCityEmployersSentence(input: { city: string; facts: EmployerFacts }): string | null {
  const { city, facts } = input;
  if (facts.distinctEmployers < 2 || facts.topEmployers.length === 0) return null;
  const e = facts.distinctEmployers;
  if (facts.topEmployers[0].count === 1) return `${e} employers each have one active ${NP} listing in ${city}.`;
  const tie = topTie(facts.topEmployers);
  const leader = tie.names.length > 1
    ? `${joinWithAnd(tie.names)} have the most, with ${tie.count} each.`
    : `${tie.names[0]} has the most, with ${formatCount(tie.count, 'listing')}.`;
  return `${e} employers have active ${NP} listings in ${city} right now. ${leader}`;
}

/**
 * CS-S1 (scope "in Texas") and LAND-L1 (scope "nationwide"), rendered at
 * 1 or more employers. A single employer is named outright.
 */
export function buildScopedEmployersSentence(input: { label: string; scope: string; facts: EmployerFacts }): string | null {
  const { label, scope, facts } = input;
  if (facts.distinctEmployers < 1 || facts.topEmployers.length === 0) return null;
  const n = facts.total;
  if (facts.distinctEmployers === 1) {
    const employer = facts.topEmployers[0].name;
    return n === 1
      ? `The only current ${label} listing ${scope} is posted by ${employer}.`
      : `All ${n} current ${label} listings ${scope} are posted by ${employer}.`;
  }
  const tie = topTie(facts.topEmployers);
  const leader = tie.names.length > 1
    ? `${joinWithAnd(tie.names)} have the most, with ${tie.count} each.`
    : `${tie.names[0]} has the most, with ${tie.count}.`;
  return `${formatCount(n, 'listing')} ${scope} ${n === 1 ? 'comes' : 'come'} from ${facts.distinctEmployers} employers. ${leader}`;
}

/** CC-K1, rendered at 2 or more employers within the category pool. */
export function buildCategoryCityEmployersSentence(
  input: { labelSentence: string; city: string; facts: EmployerFacts },
): string | null {
  const { labelSentence, city, facts } = input;
  if (facts.distinctEmployers < 2 || facts.topEmployers.length === 0) return null;
  const tie = topTie(facts.topEmployers);
  const leader = tie.names.length > 1
    ? `${joinWithAnd(tie.names)} lead with ${tie.count} each.`
    : `${tie.names[0]} leads with ${tie.count}.`;
  return `${facts.distinctEmployers} employers have active ${labelSentence} listings in ${city}. ${leader}`;
}

/** DIR-L2 card line, rendered at 2 or more employers. */
export function buildCityCardHiringLine(employers: readonly NamedCount[]): string | null {
  if (employers.length < 2) return null;
  return `Hiring: ${countList(employers)}`;
}

/** DIR-L2 statewide line (same floor as HUB-S1). */
export function buildStatewideEmployersSentence(input: { stateName: string; facts: EmployerFacts }): string | null {
  const { stateName, facts } = input;
  if (facts.distinctEmployers < 2 || facts.topEmployers.length === 0) return null;
  return `Across ${stateName}, the employers with the most open roles are ${joinWithAnd(facts.topEmployers.slice(0, 3).map((e) => e.name))}.`;
}

// ─── Locations (HUB-S2, HUB-S9, CS-S2, LAND-L2, CC-K4, DIR-L1, L6, L7) ────────

export interface HubCitiesSentences { spread: string; subThreshold: string | null }

/** HUB-S2, rendered at 2 or more cities. Sub-threshold cities are named, never linked. */
export function buildHubCitiesSentences(
  cities: readonly NamedCount[],
  minLinkJobs: number = MIN_JOBS_FOR_CATEGORY_CITY,
): HubCitiesSentences | null {
  if (cities.length < 2) return null;
  const [lead, ...rest] = cities.slice(0, 3);
  const followers = rest.length ? `, followed by ${countList(rest)}` : '';
  const spread = `Open roles are spread across ${formatCount(cities.length, 'city', 'cities')}. ${lead.name} leads with ${lead.count}${followers}.`;
  const named = new Set(cities.slice(0, 3).map((c) => c.name));
  const small = cities.filter((c) => c.count < minLinkJobs && !named.has(c.name)).slice(0, 8);
  const subThreshold = small.length
    ? `Cities with fewer than ${minLinkJobs} open roles: ${joinWithAnd(small.map((c) => c.name))}.`
    : null;
  return { spread, subThreshold };
}

/** CS-S2, rendered at 1 city (2 for remote and telehealth, where one address is not a location signal). */
export function buildScopedCitiesSentence(input: { slug: string; cities: readonly NamedCount[] }): string | null {
  const { slug, cities } = input;
  const min = slug === 'remote' || slug === 'telehealth' ? 2 : 1;
  if (cities.length < min) return null;
  if (cities.length === 1) return `Every listing with a stated location is in ${cities[0].name}.`;
  return `Listings with a stated location are spread across ${cities.length} cities, led by ${countList(cities)}.`;
}

/** LAND-L2, rendered at 1 or more states. */
export function buildLandingStatesSentence(states: readonly StateCount[]): string | null {
  if (states.length === 0) return null;
  if (states.length === 1) return `Every current listing with a state is in ${states[0].name}.`;
  return `Current listings span ${states.length} states, led by ${countList(states)}.`;
}

export interface AcrossStateInput {
  city: string;
  stateName: string;
  labelSentence: string;
  cityCount: number;
  /** Fresh setting-state count, or null when the category is not state eligible. */
  stateCount: number | null;
  otherCities: readonly NamedCount[];
}

/** CC-K4: the city's share of the state pool and the other cities with listings. */
export function buildCategoryAcrossStateSentences(input: AcrossStateInput): { share: string | null; others: string | null } {
  const { city, stateName, labelSentence, cityCount, stateCount, otherCities } = input;
  const share = stateCount !== null && stateCount >= cityCount && cityCount > 0
    ? `${city} accounts for ${cityCount} of the ${formatCount(stateCount, `active ${labelSentence} listing`)} in ${stateName}.`
    : null;
  const others = otherCities.length
    ? `Other ${stateName} cities with ${labelSentence} listings: ${countList(otherCities, 7)}.`
    : null;
  return { share, others };
}

/** DIR-L1, one sentence per metro area with 2 or more tracked cities. */
export function buildMetroAreaSentence(input: { metroArea: string; cities: readonly NamedCount[] }): string | null {
  if (input.cities.length < 2) return null;
  return `In the ${input.metroArea} metro area, open roles are split across ${countList(input.cities)}.`;
}

/** DIR-L6, rendered at 1 or more nearby directories. */
export function buildNearbyDirectoriesSentence(rows: ReadonlyArray<{ name: string; cities: number }>): string | null {
  if (rows.length === 0) return null;
  const parts = rows.map((r, i) => `${r.name} (${i === 0 ? `${formatCount(r.cities, 'city', 'cities')} hiring` : r.cities})`);
  return `Nearby directories: ${parts.join(', ')}.`;
}

/** DIR-L7 link text. */
export function buildMetroGuideLine(input: { city: string; count: number }): string {
  return `${input.city} metro guide (${formatCount(input.count, 'open role')} across the metro)`;
}

/** One nearby state for HUB-S9. */
export interface NearbyStateCount {
  name: string;
  count: number;
  /**
   * @deprecated Ignored. The tier comes from the state's own dataset row, so
   * the dataset's "Full Practice Authority" never prints beside a state whose
   * details describe a transition period. Kept optional only so existing
   * callers compile; stop passing it.
   */
  authorityDescription?: string;
}

/**
 * HUB-S9, rendered at 1 or more nearby states with jobs; wording says
 * "nearby", never "borders". Each state's tier is AANP's name for it, and the
 * sentence attributes it to AANP.
 */
export function buildNearbyStatesSentence(rows: ReadonlyArray<NearbyStateCount>): string | null {
  const live = rows.filter((r) => r.count >= 1).slice(0, 3);
  if (live.length === 0) return null;
  const parts = live.map((r) => {
    const tier = aanpTierOf(r.name);
    return `${r.name} (${formatCount(r.count, 'role')}${tier ? `, ${getAuthorityLabel(tier)}` : ''})`;
  });
  return `Nearby states with open ${NP} roles on this site, with AANP's classification of each: ${joinWithAnd(parts)}.`;
}

export const NEARBY_STATES_NOTE =
  "If you live near a state line, compare each state's own practice rules before applying, not only its AANP classification, because those rules change how a role is structured and what paperwork you file.";

// ─── Mixes (HUB-S4, HUB-S5, CITY-C3, CS-S3, CC-K2, DIR-L4, METRO-M5) ─────────

/** HUB-S4 work mode, rendered at the hub floor. */
export function buildHubWorkModeSentence(mix: WorkModeMix, min: number = MIX_MIN_POSTINGS_HUB): string | null {
  return mix.total >= min && mix.total > 0 ? hubModeSentence(mix, 'open roles') : null;
}

/** HUB-S4 schedule, rendered when the job-type mix clears the hub floor and share. */
export function buildHubScheduleSentence(jobTypes: FieldMix, min: number = MIX_MIN_POSTINGS_HUB): string | null {
  if (!fieldMixQualifies(jobTypes, min) || jobTypes.top.length === 0) return null;
  const [lead, ...rest] = jobTypes.top.slice(0, 3);
  const tail = rest.length ? `, then ${countList(rest)}` : '';
  return `Where employers list a schedule, ${lead.label} leads with ${lead.count}${tail}.`;
}

export const HUB_REMOTE_LICENSURE_NOTE =
  'Remote roles still name the states they require licensure in, so check each posting before applying.';

/** HUB-S5 (and METRO-M5), rendered at the hub floor with half the rows labeled. */
export function buildHubSettingsSentence(settings: FieldMix, min: number = MIX_MIN_POSTINGS_HUB): string | null {
  if (!fieldMixQualifies(settings, min) || settings.top.length === 0) return null;
  const [lead, ...rest] = settings.top.slice(0, 3);
  if (rest.length === 0) return `All ${settings.labeledTotal} postings that name a clinical setting name ${lead.label}.`;
  return `Among the ${settings.labeledTotal} postings that name a clinical setting, ${lead.label} appears most often (${lead.count}), followed by ${countList(rest)}.`;
}

/** CITY-C3 and CC-K2 work mode; `subject` is plural, e.g. "active NP listings in Austin". */
export function buildListingWorkModeSentence(
  input: { mix: WorkModeMix; subject: string; min?: number },
): string | null {
  const { mix, subject, min = MIX_MIN_POSTINGS_LISTING } = input;
  return mix.total >= min && mix.total > 0 ? cityModeSentence(mix, subject) : null;
}

/** CITY-C3 settings: 2 or more distinct labels covering at least half the listings. */
export function buildListingSettingsSentence(settings: FieldMix, min: number = MIX_MIN_POSTINGS_LISTING): string | null {
  if (!fieldMixQualifies(settings, min) || settings.top.length < 2) return null;
  return `Clinical settings named in these listings include ${countList(settings.top)}.`;
}

/** CITY-C3 job type: labeled rows covering at least half the listings. */
export function buildListingJobTypesSentence(jobTypes: FieldMix, min: number = MIX_MIN_POSTINGS_LISTING): string | null {
  if (!fieldMixQualifies(jobTypes, min) || jobTypes.top.length === 0) return null;
  const clauses = jobTypes.top.slice(0, 3).map((t) => `${t.count} ${isAre(t.count)} ${t.label}`);
  return `By job type, ${joinWithAnd(clauses)}.`;
}

export interface RoleSetup {
  workMode: string | null;
  jobType: string | null;
  setting: string | null;
  /** True when at least one dimension rendered (feeds the index gate). */
  rendered: boolean;
}

const SKIP_WORK_MODE: ReadonlySet<string> = new Set(['remote', 'telehealth']);
const SKIP_JOB_TYPE: ReadonlySet<string> = new Set([...CATEGORY_AXES.jobType, 'travel']);
const SKIP_SETTING: ReadonlySet<string> = new Set([
  ...CATEGORY_AXES.setting.filter((s) => !SKIP_WORK_MODE.has(s) && s !== 'travel'),
  ...CATEGORY_AXES.employerType,
]);

/**
 * CS-S3 / LAND-L1 / CC-K2 "How these roles are set up". Each dimension
 * needs `min` classified rows and the labeled share; the dimension the
 * page is already about is skipped because it would restate the filter.
 * Counts, never percentages: every page here sits below the share sample.
 */
export function buildRoleSetup(
  input: { slug: string; facts: Pick<ListingFacts, 'workMode' | 'jobTypes' | 'settings'>; min?: number },
): RoleSetup {
  const { slug, facts, min = MIX_MIN_POSTINGS_LISTING } = input;
  const workMode = !SKIP_WORK_MODE.has(slug) && facts.workMode.total >= min && facts.workMode.total > 0
    ? compactModeSentence(facts.workMode)
    : null;
  const jobType = !SKIP_JOB_TYPE.has(slug) && fieldMixQualifies(facts.jobTypes, min) && facts.jobTypes.top.length > 0
    ? rankedPair(facts.jobTypes.top, (a) => `${a.label} is the most common arrangement (${a.count})`)
    : null;
  const setting = !SKIP_SETTING.has(slug) && fieldMixQualifies(facts.settings, min) && facts.settings.top.length > 0
    ? rankedPair(facts.settings.top, (a) => `The most common setting is ${a.label} (${a.count})`)
    : null;
  return { workMode, jobType, setting, rendered: Boolean(workMode || jobType || setting) };
}

function rankedPair(top: readonly LabeledCount[], lead: (a: LabeledCount) => string): string {
  const [a, b] = top;
  return b ? `${lead(a)}, followed by ${b.label} (${b.count}).` : `${lead(a)}.`;
}

/** DIR-L4 and METRO-M5: "{o} on site, {r} remote, {h} hybrid" with zero parts omitted; needs 2 modes. */
export function buildTerseWorkModeLine(mix: WorkModeMix, min: number = MIX_MIN_POSTINGS_LISTING): string | null {
  const modes = nonZeroModes(mix, ['onsite', 'remote', 'hybrid']);
  if (mix.total < min || modes.length < 2) return null;
  return modes.map((m) => `${m.n} ${MODE_LABEL[m.key]}`).join(', ');
}

/** METRO-M5 categories sentence, rendered at 1 or more tagged rows. */
export function buildMetroCategoriesSentence(categoryTop: readonly LabeledCount[]): string | null {
  if (categoryTop.length === 0) return null;
  const noun = categoryTop.length === 1 ? 'category' : 'categories';
  return `Most common ${noun} here: ${countList(categoryTop)}. A posting can count in more than one.`;
}

/** HUB-S3, rendered at 2 or more fresh rows. */
export function buildHubCategoriesSentence(rows: readonly LabeledCount[]): string | null {
  const live = rows.filter((r) => r.count >= 1).slice(0, 3);
  if (live.length < 2) return null;
  const clauses = live.map((r, i) => `${r.label} has ${i === 0 ? formatCount(r.count, 'open role') : r.count}`);
  return `By category, ${joinWithAnd(clauses)}.`;
}

export const CATEGORY_OVERLAP_NOTE =
  'A posting can count toward more than one category, for example a remote full-time role counts in both.';

/** CITY-C2 intro. */
export function buildCityCategoriesIntro(city: string): string {
  return `Listings in ${city} fall into these categories. A listing can appear in more than one category, so the counts overlap.`;
}

// ─── Recency (HUB-S6, CITY-C4, CS-S5, CC-K2) ─────────────────────────────────

/** HUB-S6, rendered at the hub recency floor with a newest date. */
export function buildHubRecencySentence(recency: RecencyFacts, min: number = RECENCY_MIN_POSTINGS_HUB): string | null {
  if (recency.total < min || !recency.newestPostedAt) return null;
  const newest = `The newest was posted on ${formatUtcDate(recency.newestPostedAt)}.`;
  const roles = `of ${recency.total} open roles`;
  if (recency.last30 === 0) return `None ${roles} were posted in the last 30 days. ${newest}`;
  if (recency.last7 === 0) return `${recency.last30} ${roles} ${wasWere(recency.last30)} posted in the last 30 days. ${newest}`;
  return `${recency.last7} ${roles} ${wasWere(recency.last7)} posted in the last 7 days and ${recency.last30} in the last 30 days. ${newest}`;
}

/** HUB-S6 new-grad clause, omitted at 0. */
export function buildNewGradSentence(newGradFriendly: number): string | null {
  if (newGradFriendly < 1) return null;
  return `${formatCount(newGradFriendly, 'posting')} ${newGradFriendly === 1 ? 'says' : 'say'} the employer is open to new graduates.`;
}

/** True of the hub: revalidate = 3600. Never "daily". */
export const HUB_REFRESH_NOTE = 'Counts on this page refresh hourly from active postings.';

/** CITY-C4 and CC-K2 freshness, rendered when at least one row carries a first-posted date. */
export function buildFreshnessSentence(recency: RecencyFacts): string | null {
  if (recency.datedCount < 1 || !recency.newestPostedAt) return null;
  const date = formatUtcDate(recency.newestPostedAt);
  const n = formatCount(recency.total, 'listing');
  if (recency.last30 === 0) return `None of the ${n} were first posted in the last 30 days; the most recent was first posted on ${date}.`;
  return `${recency.last30} of the ${n} ${wasWere(recency.last30)} first posted in the last 30 days. The most recent was first posted on ${date}.`;
}

/** CS-S5 and LAND-L1 recency, rendered when a newest date exists. */
export function buildRecencySentence(recency: RecencyFacts): string | null {
  if (!recency.newestPostedAt) return null;
  const date = formatUtcDate(recency.newestPostedAt);
  if (recency.last30 === 0) return `The newest listing was posted on ${date}.`;
  return `${recency.last30} of these ${formatCount(recency.total, 'listing')} ${wasWere(recency.last30)} posted in the last 30 days, and the newest was posted on ${date}.`;
}

// ─── Pay (HUB-S7, METRO-M2, CS-S4, LAND-L4, CITY-C5, CC-K3, DIR-L3, CO-C2) ───

type PayFacts = Pick<ListingFacts, 'benchmark' | 'salaryDisclosedCount'>;

function gateFailClause(scope: string): string {
  return `Fewer than ${BENCHMARK_MIN_POSTINGS} listings from at least ${BENCHMARK_MIN_EMPLOYERS} employers ${scope} disclose annual pay, so this page does not publish a local figure.`;
}

function medianClause(row: BenchmarkRow, scope: string, subject = 'listings'): string {
  return `Across ${row.postings} ${subject} from ${row.employers} employers that disclose annual pay, the median ${scope} is ${formatDollars(row.median)}. The middle half falls between ${formatDollars(row.p25)} and ${formatDollars(row.p75)}.`;
}

/**
 * HUB-S7 and METRO-M2: one paragraph, always rendered. The below-gate
 * branch counts postings that state a salary and cites BLS; it never
 * prints a figure of its own.
 */
export function buildHubPayParagraph(
  input: { scopeName: string; scopeNoun: 'state' | 'metro'; facts: PayFacts },
): string {
  const { scopeName, scopeNoun, facts } = input;
  const row = facts.benchmark;
  if (row) {
    return `The median posted salary for ${NP} roles in ${scopeName} is ${formatK(row.median)}, and the middle half of postings runs ${formatK(row.p25)} to ${formatK(row.p75)}. It is based on ${row.postings} postings from ${row.employers} employers that list annual pay. Hourly, estimated and non-${NP} postings are excluded.`;
  }
  const d = facts.salaryDisclosedCount;
  const bls = `The national median for ${NP_PROSE_PLURAL} is ${BLS_REFERENCE}.`;
  if (d < 1) return `No current posting in ${scopeName} states a salary, so this site publishes no ${scopeNoun} figure. ${bls}`;
  return `${formatCount(d, 'posting')} in ${scopeName} ${d === 1 ? 'states' : 'state'} a salary, which is below the minimum of ${BENCHMARK_MIN_POSTINGS} postings from ${BENCHMARK_MIN_EMPLOYERS} employers this site requires before publishing a ${scopeNoun} figure. ${bls}`;
}

/** CS-S4 and LAND-L4: benchmark branch, else a cited BLS sentence, else nothing. */
export function buildPostedPaySentence(input: { slug: string; facts: PayFacts & Pick<ListingFacts, 'total'> }): string | null {
  const { slug, facts } = input;
  const row = facts.benchmark;
  if (row) {
    return `Across ${row.postings} listings from ${row.employers} employers that state an annual salary, the median posted pay is ${formatK(row.median)}. The middle half of those listings ${row.postings === 1 ? 'falls' : 'fall'} between ${formatK(row.p25)} and ${formatK(row.p75)}.`;
  }
  const d = facts.salaryDisclosedCount;
  if (d < 1 || !receivesNpMedian(slug)) return null;
  return `${d} of ${formatCount(facts.total, 'listing')} ${d === 1 ? 'states' : 'state'} an annual salary. This site publishes a median only once at least ${BENCHMARK_MIN_POSTINGS} listings from ${BENCHMARK_MIN_EMPLOYERS} employers do, so compare pay listing by listing. ${NATIONAL_MEDIAN_SENTENCE}`;
}

/** CITY-C5: always one paragraph, two branches, national reference in both. */
export function buildCityPayParagraph(input: { city: string; benchmark: BenchmarkRow | null }): string {
  const scope = `in ${input.city}`;
  const local = input.benchmark ? medianClause(input.benchmark, scope) : gateFailClause(scope);
  return `${local} ${NATIONAL_REFERENCE_SENTENCE}`;
}

/** CC-K3: category pool, else the city pool with a disclaimer, else the gate-fail sentence. */
export function buildCategoryCityPayParagraph(
  input: { slug: string; labelSentence: string; city: string; categoryBenchmark: BenchmarkRow | null; cityBenchmark: BenchmarkRow | null },
): string {
  const { slug, labelSentence, city, categoryBenchmark, cityBenchmark } = input;
  const reference = receivesNpMedian(slug) ? ` ${NATIONAL_REFERENCE_SENTENCE}` : '';
  if (categoryBenchmark) return `${medianClause(categoryBenchmark, `in ${city}`, `${labelSentence} listings`)}${reference}`;
  if (cityBenchmark) {
    return `Not enough ${labelSentence} listings disclose pay. ${medianClause(cityBenchmark, `across all ${NP} listings in ${city}`)}${reference}`;
  }
  return `${gateFailClause(`in ${city}`)}${reference}`;
}

/** DIR-L3 card line, gate passed only. */
export function buildCityCardPayLine(benchmark: BenchmarkRow | null): string | null {
  if (!benchmark) return null;
  return `Median posted pay ${formatK(benchmark.median)} (${formatCount(benchmark.postings, 'posting')})`;
}

/** CO-C2 below the snapshot floor: a count sentence, never a figure. */
export function buildCompanyPaySentence(input: { company: string; total: number; disclosed: number }): string {
  const { company, total, disclosed } = input;
  if (disclosed >= 1) return `${disclosed} of ${formatCount(total, 'open role')} ${disclosed === 1 ? 'lists' : 'list'} a pay range.`;
  return `None of ${company}'s current ${NP} listings on ${brand.name} state a pay range.`;
}

// ─── Licensure (CS-S6, CITY-C6, CC-K6, HUB-S8, SAL-S1, CO-C3, LAND-L3, SPEC-P2) ─

const APRN_CERTIFICATION: Readonly<Record<string, string>> = {
  anesthesia: 'CRNA certification is administered by NBCRNA.',
  midwifery: 'CNM certification is administered by AMCB.',
};

export interface LicensureSentences {
  classification: string;
  nlc: string | null;
  /** The board sentence; the component links `boardName` inside it. */
  board: string;
  certification: string | null;
}

/**
 * "AANP classifies Texas as a restricted practice state." followed by the
 * state's verified details. The one lead-in every practice paragraph and
 * practice FAQ answer uses. The District of Columbia reads "a full practice
 * jurisdiction", never "state" (see jurisdictionNoun).
 *
 * The first sentence names the AANP tier and attributes it; it states no
 * rule. Every claim about what THIS state requires (a physician, an
 * agreement, a transition period, a way out of one) comes from `details`.
 * These answers used to lead with getAuthorityLabel's old text ("Restricted
 * Practice (Physician Supervision Required)"), which put a tier rule directly
 * in front of details that contradict it, for example Virginia's practice
 * agreement with its autonomous practice designation. The same strings feed
 * FAQPage JSON-LD, so the schema says exactly what the page says.
 */
function classifiedDetails(env: PracticeEnvironment): string {
  return `AANP classifies ${env.stateName} as a ${env.authorityShort} ${jurisdictionNoun(env.stateCode)}. ${env.details}`;
}

/** CS-S6: classification, compact status, board and (APRN only) certification. */
export function buildLicensureSentences(env: PracticeEnvironment, slug?: string): LicensureSentences {
  return {
    classification: classifiedDetails(env),
    nlc: nlcSentence(env.stateName),
    board: `Applications, fees and renewal rules come from the ${env.boardName}.`,
    certification: slug ? APRN_CERTIFICATION[slug] ?? null : null,
  };
}

/** CITY-C6 paragraph. */
export function buildPracticingInStateParagraph(env: PracticeEnvironment): string {
  const nlc = nlcSentence(env.stateName);
  return [
    classifiedDetails(env),
    nlc,
    `APRN licensure is issued by the ${env.boardName}. Check the board's current checklist before accepting a role, because requirements and fees change.`,
  ].filter(Boolean).join(' ');
}

/** CC-K6: C6 plus the role's certification clause. */
export function buildPracticingAsRoleParagraph(env: PracticeEnvironment, certification: string): string {
  return `${buildPracticingInStateParagraph(env)} Certification for this role: ${certification}.`;
}

/** HUB-S8 closing sentence. */
export function buildBoardChecklistSentence(boardName: string): string {
  return `Forms, fees and processing times change, so work from the ${boardName} checklist.`;
}

/** SAL-S1 paragraph (the guide link is rendered by the component). */
export function buildSalaryPracticeEnvironmentParagraph(env: PracticeEnvironment, nlcVerifiedLabel: string): string {
  return `${classifiedDetails(env)} ${env.stateName} ${nlcMembershipPhrase(env.nlcStatus)} the Nurse Licensure Compact (verified against the NCSBN roster on ${nlcVerifiedLabel}). Licensure applications run through the ${env.boardName}.`;
}

/**
 * CO-C3 one line per hiring state. The tier is AANP's own name for it (the
 * company page's intro attributes the column to AANP), never the dataset's
 * "Full Practice Authority" in front of details that describe a transition
 * period; the state's rule is its details.
 */
export function buildCompanyStatePracticeLine(env: PracticeEnvironment): string {
  return `${env.stateName}: ${env.authorityLabel}, ${nlcShort(env.nlcStatus)}. ${env.details}`;
}

interface AuthorityBuckets { full: number; reduced: number; restricted: number; known: number; fullNames: string[] }

function bucketByAuthority(states: readonly StateCount[]): AuthorityBuckets {
  const b: AuthorityBuckets = { full: 0, reduced: 0, restricted: 0, known: 0, fullNames: [] };
  for (const s of states) {
    const auth = getStatePracticeAuthority(s.name);
    if (!auth) continue;
    b[auth.authority] += s.count;
    b.known += s.count;
    if (auth.authority === 'full') b.fullNames.push(s.name);
  }
  return b;
}

/** Non-zero AANP buckets in full, reduced, restricted order (zero clauses are omitted). */
function nonZeroAuthorityBuckets(b: AuthorityBuckets): Array<{ n: number; label: string }> {
  return [
    { n: b.full, label: 'full practice states' },
    { n: b.reduced, label: 'reduced practice states' },
    { n: b.restricted, label: 'restricted practice states' },
  ].filter((bucket) => bucket.n > 0);
}

/** LAND-L3, never on the APRN axis; needs the listing floor and 2 or more states. */
export function buildListingsAuthoritySentence(
  input: { slug: string; states: readonly StateCount[]; total: number; min?: number },
): string | null {
  const { slug, states, total, min = MIX_MIN_POSTINGS_LISTING } = input;
  if (getCategoryAxis(slug) === 'aprn' || total < min || states.length < 2) return null;
  const b = bucketByAuthority(states);
  if (b.known < 1) return null;
  const [lead, ...rest] = nonZeroAuthorityBuckets(b);
  const clauses = [
    `${lead.n} of the ${b.known} listings with a state ${isAre(lead.n)} in ${lead.label}`,
    ...rest.map((bucket) => `${bucket.n} in ${bucket.label}`),
  ];
  return `By AANP's state classification, ${joinWithAnd(clauses)}.`;
}

/** SPEC-P2, rendered at 5 or more openings with a known state. */
export function buildSpecialtyAuthoritySentence(
  input: { label: string; states: readonly StateCount[]; min?: number },
): string | null {
  const { label, states, min = MIX_MIN_POSTINGS_HUB } = input;
  const b = bucketByAuthority(states);
  if (b.known < min) return null;
  const fullNames = b.fullNames.length ? ` (${joinWithAnd(b.fullNames.slice(0, 4))})` : '';
  // AANP's tier name, "full practice", never "full practice authority": the
  // named states can include Connecticut or New York, whose verified details
  // describe a transition period before independent practice.
  const clauses = [
    b.full > 0 ? `${b.full} ${isAre(b.full)} in full practice states${fullNames}` : null,
    b.reduced > 0 ? `${b.reduced} in reduced practice states` : null,
    b.restricted > 0 ? `${b.restricted} in restricted practice states` : null,
  ].filter((c): c is string => c !== null);
  return `Of the ${b.known} open ${label} roles with a listed state, ${joinWithAnd(clauses)}, using the AANP classification.`;
}

// ─── Small blocks (LAND-L6, L7, METRO, SAL, SPEC, CO, DIR-L5) ───────────────

/** LAND-L6 card subtitle. */
export function buildRelatedCategorySub(count: number): string {
  return count >= 1 ? formatCount(count, 'open role') : 'Role overview';
}

/** LAND-L7 intro for 0 to 2 listings; the sibling list and alert follow it. */
export function buildLowInventoryIntro(input: { label: string; total: number }): string {
  const { label, total } = input;
  const lead = total === 0
    ? `There are no current ${label} listings.`
    : `There ${isAre(total)} ${formatCount(total, `current ${label} listing`)}.`;
  return `${lead} These related categories have more openings right now:`;
}

/** METRO-M1 zero-job copy (no "added daily"). */
export function buildMetroZeroJobsSentence(city: string): string {
  return `There are no open ${city} roles on this site right now. Set an alert and we will email you when one is posted.`;
}

/** METRO hero: "jobs in TX." (H1 reads "{City} NP jobs in TX."). */
export function buildMetroHeadlineSub(stateCode: string): string {
  return `jobs in ${stateCode}.`;
}

/** Hero badge without a freshness claim. */
export function buildLiveRolesBadge(total: number): string {
  return formatCount(total, 'live role');
}

/** SAL hero summary, two branches. */
export function buildSalaryStateSummary(input: { stateName: string; benchmark: BenchmarkRow | null }): string {
  const { stateName, benchmark } = input;
  if (benchmark) {
    return `Median posted pay for ${NP_PROSE_PLURAL} in ${stateName}, from ${benchmark.postings} postings with disclosed pay across ${benchmark.employers} employers.`;
  }
  return `Open ${NP_PROSE} roles in ${stateName}, the state's practice rules, and how pay data is published here.`;
}

/** SAL-S4 "What employers are hiring for", zero clauses omitted. */
export function buildHiringForSentence(
  facts: Pick<ListingFacts, 'total' | 'distinctEmployers' | 'workMode' | 'recency' | 'newGradFriendly'>,
): string | null {
  if (facts.total < 1) return null;
  const modes = nonZeroModes(facts.workMode, ['remote', 'hybrid', 'onsite']).map((m) => `${m.n} ${MODE_LABEL[m.key]}`);
  const recency = facts.recency.newestPostedAt
    ? `${facts.recency.last30 > 0 ? `${facts.recency.last30} ${wasWere(facts.recency.last30)} added in the last 30 days; the` : 'The'} newest was posted on ${formatUtcDate(facts.recency.newestPostedAt)}.`
    : null;
  return [
    `${formatCount(facts.total, 'open role')} from ${formatCount(facts.distinctEmployers, 'employer')}.`,
    modes.length ? `${modes.join(', ')}.` : null,
    recency,
    facts.newGradFriendly > 0 ? `${facts.newGradFriendly} ${isAre(facts.newGradFriendly)} marked open to new graduates.` : null,
  ].filter(Boolean).join(' ');
}

/** SAL-S5 table cell for states below the gate. */
export const SALARY_NEARBY_NOT_PUBLISHED = 'Not published (sample below minimum)';

/** SAL-S5 table caption. */
export function buildSalaryNearbyCaption(nlcVerifiedLabel: string): string {
  return `Practice classifications from AANP; compact status verified against the NCSBN roster on ${nlcVerifiedLabel}; medians from ${brand.name} postings with disclosed pay, published at ${BENCHMARK_MIN_POSTINGS} or more postings from ${BENCHMARK_MIN_EMPLOYERS} or more employers.`;
}

/** SPEC CTA line, count based; null at 0. */
export function buildSpecialtyCtaLine(input: { label: string; total: number }): string | null {
  if (input.total < 1) return null;
  return `${formatCount(input.total, `${input.label} opening`)} ${isAre(input.total)} live right now.`;
}

/** CO-C1 hiring footprint. */
export function buildCompanyFootprintSentence(input: {
  company: string; total: number; states: readonly StateCount[]; topSpecialties: readonly string[]; newestPostedAt: Date | null;
}): string | null {
  const { company, total, states, topSpecialties, newestPostedAt } = input;
  if (total < 1) return null;
  const where = states.length ? `in ${joinWithAnd(states.slice(0, 3).map((s) => s.name))}` : 'in remote roles with no listed state';
  return [
    `${company} has ${formatCount(total, `open ${NP_PROSE} role`)} on ${brand.name} ${where}.`,
    topSpecialties.length ? `Most openings are for ${joinWithAnd(topSpecialties.slice(0, 3))}.` : null,
    newestPostedAt ? `The newest was posted on ${formatUtcDate(newestPostedAt)}.` : null,
  ].filter(Boolean).join(' ');
}

/** One-sentence claim CTA (CO deletions). */
export const COMPANY_CLAIM_CTA = 'Hiring here? Ask to claim this profile.';

/** DIR-L5 editorial. */
export function buildDirectoryHowToUse(minCityJobs: number): string {
  return `Each city card links to that city's own job page once it carries ${minCityJobs} or more open roles. Smaller markets are listed by name under Also hiring, and every one of their roles is in the statewide feed. Counts refresh hourly from active postings.`;
}

// ─── FAQ arrays (one array feeds the accordion and FAQPage) ─────────────────

function faq(question: string, answer: string | null | undefined): FaqEntry | null {
  return answer ? { question, answer } : null;
}

function compact(entries: ReadonlyArray<FaqEntry | null>): FaqEntry[] {
  return entries.filter((e): e is FaqEntry => e !== null);
}

export interface HubFaqInput {
  stateName: string;
  facts: ListingFacts;
  env: PracticeEnvironment | null;
  categoryRows: readonly LabeledCount[];
  /** First step names from buildLicenseGuideSteps, or [] when S8 does not render. */
  stepNames: readonly string[];
}

/** HUB-S10: seven conditional questions. */
export function buildHubFaqs(input: HubFaqInput): FaqEntry[] {
  const { stateName, facts, env, categoryRows, stepNames } = input;
  const categories = buildHubCategoriesSentence(categoryRows);
  const employers = buildHubEmployersSentence({ stateName, facts });
  const cities = facts.cities.length
    ? `${facts.cities[0].name} has the most open ${NP} roles in ${stateName} (${facts.cities[0].count})${facts.cities.length > 1 ? `, followed by ${countList(facts.cities.slice(1, 3))}` : ''}.`
    : null;
  const remote = facts.workMode.total >= MIX_MIN_POSTINGS_HUB && facts.workMode.remote >= 1
    ? `${facts.workMode.remote} of ${facts.workMode.total} open ${stateName} roles ${isAre(facts.workMode.remote)} listed as remote. Each posting names the states it requires licensure in.`
    : null;
  const steps = stepNames.length >= 2 && env
    ? `The first steps are to ${lowerFirst(stepNames[0])} and ${lowerFirst(stepNames[1])}. Applications run through the ${env.boardName}.`
    : null;
  return compact([
    faq(`How many ${NP} jobs are in ${stateName}?`, [
      `There ${isAre(facts.total)} ${formatCount(facts.total, `open ${NP} role`)} in ${stateName} on ${brand.name}.`,
      categories, 'Counts refresh hourly.',
    ].filter(Boolean).join(' ')),
    // AANP is the source of the tier, not of the details (those were verified
    // against each state's own law), so the attribution sits on the tier.
    faq(`What is the practice authority in ${stateName}?`, env ? classifiedDetails(env) : null),
    faq(`What is the median ${NP} salary in ${stateName}?`, buildHubPayParagraph({ scopeName: stateName, scopeNoun: 'state', facts })),
    faq(`Which cities in ${stateName} have the most ${NP} jobs?`, cities),
    faq(`Which employers are hiring ${NP}s in ${stateName}?`, employers),
    faq(`Are remote ${NP} roles available in ${stateName}?`, remote),
    faq(`How do I get licensed as ${indefiniteArticle(NP)} ${NP} in ${stateName}?`, steps),
  ]);
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

export interface CityFaqInput {
  city: string;
  stateCode: string;
  facts: ListingFacts;
  env: PracticeEnvironment | null;
  /** CITY-C2 top labels, or [] when that section does not render. */
  categoryLabels: readonly string[];
}

/** CITY-C8: five conditional questions built only from rendered values. */
export function buildCityFaqs(input: CityFaqInput): FaqEntry[] {
  const { city, stateCode, facts, env, categoryLabels } = input;
  const employers = buildCityEmployersSentence({ city, facts });
  const settings = buildListingSettingsSentence(facts.settings);
  const kinds = categoryLabels.length || settings
    ? [categoryLabels.length ? `Listings in ${city} include ${joinWithAnd(categoryLabels.slice(0, 3))} roles.` : null, settings].filter(Boolean).join(' ')
    : null;
  return compact([
    faq(`How many ${NP} jobs are open in ${city}, ${stateCode}?`, [
      `There ${isAre(facts.total)} ${formatCount(facts.total, `active ${NP} listing`)} in ${city}${facts.distinctEmployers >= 2 ? ` from ${facts.distinctEmployers} employers` : ''}.`,
      buildFreshnessSentence(facts.recency),
    ].filter(Boolean).join(' ')),
    faq(`What do ${NP} listings in ${city} pay?`, buildCityPayParagraph({ city, benchmark: facts.benchmark })),
    faq(`What kinds of ${NP} roles are listed in ${city}?`, kinds),
    faq(`Which employers are hiring ${NP}s in ${city}?`, employers ? `${employers} ${countList(facts.topEmployers, 6)}.` : null),
    faq(`What license do I need to practice in ${city}?`, env ? buildPracticingInStateParagraph(env) : null),
  ]);
}

export interface SettingStateFaqInput {
  label: string;
  stateName: string;
  slug: string;
  facts: ListingFacts;
  /** Physician and compact answers from buildLicenseGuideFaq, when the row exists. */
  physicianAnswer: string | null;
  nlcAnswer: string | null;
}

/** CS-S9: four conditional questions. */
export function buildSettingStateFaqs(input: SettingStateFaqInput): FaqEntry[] {
  const { label, stateName, slug, facts, physicianAnswer, nlcAnswer } = input;
  const scope = `in ${stateName}`;
  const howMany = [buildScopedEmployersSentence({ label, scope, facts }), buildRecencySentence(facts.recency)]
    .filter(Boolean).join(' ');
  return compact([
    faq(`How many ${label} ${NP} jobs are open in ${stateName}?`, howMany || null),
    faq(`What do ${label} ${NP} jobs in ${stateName} pay?`, facts.benchmark ? buildPostedPaySentence({ slug, facts }) : null),
    // The same question the license guide answers ("collaborating or
    // supervising"): its verdict ("Yes." for Texas, Georgia or Tennessee,
    // whose details name supervision) must never read as a yes to a
    // collaborating-only question.
    faq(`Do ${NP}s need a collaborating or supervising physician in ${stateName}?`, physicianAnswer),
    faq(`Is ${stateName} part of the Nurse Licensure Compact?`, nlcAnswer),
  ]);
}

export interface CategoryCityFaqInput {
  slug: string;
  label: string;
  labelSentence: string;
  city: string;
  stateName: string;
  facts: ListingFacts;
  cityBenchmark: BenchmarkRow | null;
  env: PracticeEnvironment | null;
  /** Qualification answer body from the template's credential facts. */
  qualifications: string | null;
}

/** CC-K8: the rebuilt category-city FAQ. */
export function buildCategoryCityFaqs(input: CategoryCityFaqInput): FaqEntry[] {
  const { slug, label, labelSentence, city, stateName, facts, cityBenchmark, env, qualifications } = input;
  const employers = buildCategoryCityEmployersSentence({ labelSentence, city, facts });
  const howMany = [
    `There ${isAre(facts.total)} ${formatCount(facts.total, `active ${labelSentence} listing`)} in ${city}${facts.distinctEmployers >= 2 ? ` from ${facts.distinctEmployers} employers` : ''}.`,
    buildFreshnessSentence(facts.recency),
  ].filter(Boolean).join(' ');
  return compact([
    faq(`How many ${label} ${NP} jobs are in ${city}?`, howMany),
    faq(`What do ${labelSentence} listings in ${city} pay?`, buildCategoryCityPayParagraph({ slug, labelSentence, city, categoryBenchmark: facts.benchmark, cityBenchmark })),
    faq(`Does ${stateName} allow ${NP}s full practice authority?`, env ? `${classifiedDetails(env)} See the practice section on this page for the compact status and board.` : null),
    faq(`Which employers are hiring ${labelSentence} roles in ${city}?`, employers ? `${employers} ${countList(facts.topEmployers, 6)}.` : null),
    faq(`What qualifications do I need for ${labelSentence} jobs in ${city}?`, qualifications),
  ]);
}

export interface DirectoryFaqInput {
  stateName: string;
  cities: readonly NamedCount[];
  facts: EmployerFacts;
  minCityJobs: number;
}

/** DIR-L8. */
export function buildDirectoryFaqs(input: DirectoryFaqInput): FaqEntry[] {
  const { stateName, cities, facts, minCityJobs } = input;
  return compact([
    faq(`Which ${stateName} cities have the most ${NP} openings?`, cities.length ? `${countList(cities, 5)}.` : null),
    faq(`Which employers are hiring ${NP}s across ${stateName}?`, buildStatewideEmployersSentence({ stateName, facts })),
    faq('Why do some cities not have their own page?', buildDirectoryHowToUse(minCityJobs)),
  ]);
}

/** METRO-M6, rendered when the employer card renders (2 or more employers). */
export function buildMetroEmployersFaq(input: { city: string; employers: readonly NamedCount[] }): FaqEntry | null {
  if (input.employers.length < 2) return null;
  return {
    question: `Which employers are hiring ${NP}s in the ${input.city} area?`,
    answer: `Employers with open ${NP} roles in the ${input.city} area right now include ${countList(input.employers, 6)}.`,
  };
}

/** SAL-S6 additions; the employers question needs 2 or more companies. */
export function buildSalaryStateFaqAdditions(
  input: { env: PracticeEnvironment; nlcVerifiedLabel: string; topEmployers: readonly NamedCount[] },
): FaqEntry[] {
  const { env, nlcVerifiedLabel, topEmployers } = input;
  return compact([
    faq(`Does ${env.stateName} give ${NP_PROSE_PLURAL} full practice authority?`, classifiedDetails(env)),
    faq(`Is ${env.stateName} part of the Nurse Licensure Compact?`, `${env.stateName} ${nlcMembershipPhrase(env.nlcStatus)} the Nurse Licensure Compact, verified against the NCSBN roster on ${nlcVerifiedLabel}.`),
    faq(`Which employers have the most open ${NP} roles in ${env.stateName}?`, topEmployers.length >= 2 ? `${countList(topEmployers)}.` : null),
  ]);
}

/** SPEC FAQ additions, each only when its section renders. */
export function buildSpecialtyFaqAdditions(
  input: { credential: string; statesSentence: string | null; workMode: WorkModeMix | null },
): FaqEntry[] {
  const { credential, statesSentence, workMode } = input;
  const remote = workMode && workMode.total >= MIX_MIN_POSTINGS_HUB
    ? (workMode.remote > 0
      ? `${workMode.remote} of ${formatCount(workMode.total, `open ${credential} role`)} ${isAre(workMode.remote)} listed as remote.`
      : `None of the ${formatCount(workMode.total, `open ${credential} role`)} ${isAre(workMode.total)} listed as remote right now.`)
    : null;
  return compact([
    faq(`Where are ${credential} jobs open right now?`, statesSentence),
    faq(`Do ${credential} roles on ${brand.name} offer remote work?`, remote),
  ]);
}

export interface CompanyFaqInput {
  company: string;
  total: number;
  states: readonly StateCount[];
  disclosed: number;
  workMode: WorkModeMix;
  newGradFriendly: number;
}

/** CO-C6: five conditional questions. */
export function buildCompanyFaqs(input: CompanyFaqInput): FaqEntry[] {
  const { company, total, states, disclosed, workMode, newGradFriendly } = input;
  const remoteAnswer = total >= 1
    ? (workMode.remote === total
      ? `Yes. All ${formatCount(total, `current ${NP} listing`)} from ${company} ${isAre(total)} remote.`
      : workMode.remote > 0
        ? `${workMode.remote} of ${company}'s ${formatCount(total, `current ${NP} listing`)} ${isAre(workMode.remote)} remote.`
        : `None of ${company}'s current ${NP} listings ${isAre(total)} remote.`)
    : null;
  return compact([
    faq(`How many ${NP_PROSE} jobs does ${company} have open?`, total >= 1 ? `${company} has ${formatCount(total, `open ${NP_PROSE} role`)} on ${brand.name}.` : null),
    faq(`Where is ${company} hiring ${NP_PROSE_PLURAL}?`, states.length ? `${company} is hiring in ${countList(states, 5)}.` : null),
    faq(`Does ${company} list pay on its ${NP} jobs?`, total >= 1 ? buildCompanyPaySentence({ company, total, disclosed }) : null),
    faq(`Are ${company}'s ${NP} roles remote?`, remoteAnswer),
    faq(`Does ${company} hire new graduate ${NP}s?`, newGradFriendly >= 1 ? `${newGradFriendly} of its current listings ${isAre(newGradFriendly)} marked open to new graduates.` : null),
  ]);
}

// ─── Titles and descriptions (HUB, CITY-C9, CS, CC-K9, DIR, METRO, SAL, CO) ──

function countPrefix(n: number): string {
  return n >= COUNT_DISPLAY_FLOOR ? `${n} ` : '';
}

/** HUB-meta title: count at the display floor; median or employer count as the hook. */
export function buildHubTitle(input: { stateName: string; stateCode: string; total: number; distinctEmployers: number; benchmark: BenchmarkRow | null }): string {
  const { stateName, stateCode, total, distinctEmployers, benchmark } = input;
  const base = `${countPrefix(total)}${NP} Jobs in ${stateName} (${stateCode})`;
  return benchmark
    ? `${base}: ${formatK(benchmark.median)} Median Pay`
    : `${base}: ${formatCount(distinctEmployers, 'Employer')} Hiring`;
}

/**
 * The retired tier-text input of the HUB, CS and CC description builders.
 * Every caller passed the dataset's `description`, which is "Full Practice
 * Authority" for each full-tier jurisdiction; the builders now take the tier
 * from the jurisdiction's own dataset row instead.
 */
interface RetiredAuthorityText {
  /**
   * @deprecated Ignored. The tier clause comes from the jurisdiction's own
   * dataset row (aanpClassificationClause), so no caller text, and never
   * "Full Practice Authority", can print. Kept optional only so existing call
   * sites compile; stop passing it.
   */
  authorityDescription?: string | null;
}

/**
 * HUB-meta description, which is also the state hub's visible hero deck. The
 * tier clause is AANP's classification of this state, attributed, never a
 * rule (see aanpClassificationClause).
 */
export function buildHubDescription(
  input: { stateName: string; facts: ListingFacts; topCategories: readonly string[] } & RetiredAuthorityText,
): string {
  const { stateName, facts, topCategories } = input;
  const cities = facts.cities.slice(0, 2).map((c) => c.name);
  return assembleDescription([
    `${formatCount(facts.total, `open ${NP_PROSE} role`)} in ${stateName} from ${formatCount(facts.distinctEmployers, 'employer')}${cities.length ? `, led by ${joinWithAnd(cities)}` : ''}.`,
    aanpClassificationClause(aanpTierOf(stateName)),
    facts.benchmark ? `Median posted pay ${formatK(facts.benchmark.median)}.` : null,
    topCategories.length ? `Top categories: ${joinWithAnd(topCategories.slice(0, 2))}.` : null,
  ]);
}

/** CITY-C9 title: count first at the floor, then the first suffix that fits SERP width. */
export function buildCityTitle(input: { displayName: string; stateCode: string; total: number; distinctEmployers: number; benchmark: BenchmarkRow | null }): string {
  const { displayName, stateCode, total, distinctEmployers, benchmark } = input;
  const base = `${countPrefix(total)}${NP} Jobs in ${displayName}, ${stateCode}`;
  const suffixes = [
    benchmark ? `: ${formatK(benchmark.median)} Median` : null,
    distinctEmployers >= 2 ? ` from ${distinctEmployers} Employers` : null,
  ];
  for (const suffix of suffixes) {
    if (suffix && `${base}${suffix}`.length <= TITLE_PAGE_PART_MAX) return `${base}${suffix}`;
  }
  return base;
}

/** CITY-C9 description. */
export function buildCityDescription(input: { displayName: string; stateName: string; facts: ListingFacts }): string {
  const { displayName, stateName, facts } = input;
  const top1 = facts.topEmployers[0]?.name;
  const from = facts.distinctEmployers >= 2 && top1
    ? ` from ${facts.distinctEmployers} employers, including ${top1}`
    : top1 ? ` from ${top1}` : '';
  const flexible = facts.workMode.remote + facts.workMode.hybrid;
  return assembleDescription([
    `${formatCount(facts.total, `active ${NP} listing`)} in ${displayName}, ${stateName}${from}.`,
    flexible > 0 ? `${flexible} ${flexible === 1 ? 'offers' : 'offer'} remote or hybrid work.` : 'All are in person.',
    facts.recency.newestPostedAt ? `Newest posted ${formatUtcDateShort(facts.recency.newestPostedAt)}.` : null,
  ]);
}

/** CS-meta title: "{Label} NP Jobs in {State}" plus the count at the floor when it fits. */
export function buildSettingStateTitle(input: { titleLabel: string; stateName: string; total: number }): string {
  const { titleLabel, stateName, total } = input;
  const base = `${titleLabel} ${NP} Jobs in ${stateName}`;
  if (total < COUNT_DISPLAY_FLOOR) return base;
  for (const candidate of [`${base}: ${total} Openings`, `${base} (${total})`]) {
    if (candidate.length <= TITLE_PAGE_PART_MAX) return candidate;
  }
  return base;
}

/** CS-meta description assembly; the tier clause as in buildHubDescription. */
export function buildSettingStateDescription(input: {
  label: string; slug: string; stateName: string; facts: ListingFacts; statsAsOf: Date | null;
} & RetiredAuthorityText): string {
  const { label, slug, stateName, facts, statsAsOf } = input;
  const topCity = facts.cities[0] && slug !== 'remote' && slug !== 'telehealth' ? facts.cities[0].name : null;
  return assembleDescription([
    `${facts.total} ${label.toLowerCase()} ${NP} ${facts.total === 1 ? 'opening' : 'openings'} in ${stateName} from ${formatCount(facts.distinctEmployers, 'employer')}.`,
    facts.benchmark ? `Median posted pay ${formatK(facts.benchmark.median)}.` : null,
    topCity ? `Top city: ${topCity}.` : null,
    aanpClassificationClause(aanpTierOf(stateName)),
    statsAsOf ? `Updated ${formatUtcDateShort(statsAsOf)}.` : null,
  ]);
}

/** CC-K9 title; the open count appears only at the display floor. */
export function buildCategoryCityTitle(input: { labelNoun: string; city: string; stateCode: string; total: number }): string {
  const { labelNoun, city, stateCode, total } = input;
  const base = `${labelNoun} Jobs in ${city}, ${stateCode}`;
  return total >= COUNT_DISPLAY_FLOOR ? `${base} (${total} Open)` : base;
}

/** CC-K9 description; the tier clause as in buildHubDescription, keyed by the state code. */
export function buildCategoryCityDescription(input: {
  labelSentence: string; city: string; stateCode: string; facts: ListingFacts;
} & RetiredAuthorityText): string {
  const { labelSentence, city, stateCode, facts } = input;
  const top1 = facts.topEmployers[0]?.name;
  const flexible = facts.workMode.remote + facts.workMode.hybrid;
  const settings = facts.settings.top.slice(0, 2).map((s) => s.label);
  const mixClause = flexible > 0
    ? `${flexible} ${isAre(flexible)} hybrid or remote.`
    : settings.length >= 2 ? `Settings include ${joinWithAnd(settings)}.` : null;
  return assembleDescription([
    `${formatCount(facts.total, `active ${labelSentence} listing`)} in ${city}, ${stateCode}${facts.distinctEmployers >= 2 && top1 ? ` from ${facts.distinctEmployers} employers, led by ${top1}` : ''}.`,
    mixClause,
    aanpClassificationClause(aanpTierOfCode(stateCode)),
  ]);
}

/** DIR-meta title (the count that the description and stat tile also use). */
export function buildDirectoryTitle(input: { stateName: string; trackedCities: number }): string {
  return `${NP} Jobs by City in ${input.stateName}: ${formatCount(input.trackedCities, 'City', 'Cities')} Hiring`;
}

/** DIR-meta description. */
export function buildDirectoryDescription(input: { stateName: string; totalStateJobs: number; trackedCities: number; leadCities: readonly string[] }): string {
  const { stateName, totalStateJobs, trackedCities, leadCities } = input;
  return assembleDescription([
    `${formatCount(totalStateJobs, `open ${NP_PROSE} role`)} across ${formatCount(trackedCities, `${stateName} city`, `${stateName} cities`)}${leadCities.length ? `, led by ${joinWithAnd(leadCities.slice(0, 2))}` : ''}.`,
    'See live counts and employers city by city.',
  ]);
}

/** METRO-meta title. */
export function buildMetroTitle(input: { city: string; stateCode: string; total: number; year: number }): string {
  return `${countPrefix(input.total)}${NP} Jobs in ${input.city}, ${input.stateCode} (${input.year})`;
}

/**
 * METRO-meta description from reviewed geography, never the hero fragment;
 * also the metro page's visible hero deck. The tier clause is AANP's
 * classification, attributed, as in buildHubDescription. It used to read "New
 * York is a full practice state.", a bare fact about practicing there,
 * although New York's details describe a transition period. `practiceAuthority`
 * is the metro record's tier, pinned to the dataset by
 * p2-metro-editorial-depth.test.ts.
 */
export function buildMetroDescription(input: {
  city: string; stateCode: string; stateName: string; practiceAuthority: string; nearbyCities: readonly string[]; subMarkets: readonly string[]; benchmark: BenchmarkRow | null;
}): string {
  const { city, stateCode, practiceAuthority, nearbyCities, subMarkets, benchmark } = input;
  return assembleDescription([
    `Open ${NP} roles in ${city}, ${stateCode}${nearbyCities.length ? ` and nearby ${joinWithAnd(nearbyCities.slice(0, 2))}` : ''}.`,
    aanpClassificationClause(tierFromName(practiceAuthority)),
    benchmark ? `Median posted pay ${formatK(benchmark.median)}.` : null,
    subMarkets.length ? `Hiring across ${joinWithAnd(subMarkets.slice(0, 2))}.` : null,
  ]);
}

/** SAL-meta title per gate. */
export function buildSalaryStateTitle(input: { stateName: string; stateCode: string; benchmark: BenchmarkRow | null; year: number }): string {
  const { stateName, stateCode, benchmark, year } = input;
  return benchmark
    ? `${NP} Salary in ${stateName} (${stateCode}): ${formatDollars(benchmark.median)} Median, ${year}`
    : `${NP} Jobs and Pay Data in ${stateName} (${stateCode}), ${year}`;
}

/**
 * SAL-meta description per gate. Below the gate the tier clause is AANP's
 * classification, attributed, as in buildHubDescription. Above it the pay
 * sentence alone runs past 100 characters, so the attributed clause could
 * never fit the budget beside the open-role count; the tier is left to the
 * page's practice section rather than printed unattributed ("9 open roles,
 * full practice." read as a fact about practicing in the state).
 */
export function buildSalaryStateDescription(input: { env: PracticeEnvironment; facts: ListingFacts }): string {
  const { env, facts } = input;
  const row = facts.benchmark;
  if (row) {
    return assembleDescription([
      `Median posted ${NP} pay in ${env.stateName} is ${formatDollars(row.median)} across ${row.postings} postings from ${row.employers} employers, middle half ${formatDollars(row.p25)} to ${formatDollars(row.p75)}.`,
      `${formatCount(facts.total, 'open role')}.`,
    ]);
  }
  return assembleDescription([
    `${formatCount(facts.total, `open ${NP} role`)} in ${env.stateName} from ${formatCount(facts.distinctEmployers, 'employer')}.`,
    aanpClassificationClause(env.authority),
    `${env.stateName} ${nlcMembershipPhrase(env.nlcStatus)} the Nurse Licensure Compact.`,
    `Pay median published at ${BENCHMARK_MIN_POSTINGS} or more disclosed postings.`,
  ]);
}

/** CO-meta title with the state suffix rules of thin-spec 4. */
export function buildCompanyTitle(input: { company: string; states: readonly StateCount[]; allRemote: boolean }): string {
  const { company, states, allRemote } = input;
  const base = `${company} ${NP} Jobs`;
  const suffix = states.length === 1 ? ` in ${states[0].name}`
    : states.length === 2 ? ` in ${states[0].name} and ${states[1].name}`
      : states.length >= 3 ? ` in ${states.length} States`
        : allRemote ? ' (Remote)' : '';
  return `${base}${suffix}`.length <= TITLE_PAGE_PART_MAX ? `${base}${suffix}` : base;
}

/** CO-meta description built from the profile's own rows. */
export function buildCompanyDescription(input: {
  company: string; total: number; states: readonly StateCount[]; topSpecialty: string | null; disclosed: number;
}): string {
  const { company, total, states, topSpecialty, disclosed } = input;
  return assembleDescription([
    `${company} has ${formatCount(total, `open ${NP_PROSE} role`)} on ${brand.name}${states.length ? ` in ${joinWithAnd(states.slice(0, 2).map((s) => s.name))}` : ''}${topSpecialty ? `, mostly ${topSpecialty}` : ''}.`,
    `${disclosed} of ${total} ${disclosed === 1 ? 'lists' : 'list'} pay.`,
    'Apply from each listing.',
  ]);
}

/** SPEC-meta description; the NP median is attached only to NP roles. */
export function buildSpecialtyDescription(input: { role: string; total: number; benchmark: BenchmarkRow | null; isNicheRole: boolean }): string {
  const { role, total, benchmark, isNicheRole } = input;
  return assembleDescription([
    `${role} salary guide: ${formatCount(total, 'open role')} on ${brand.name}${benchmark ? `, board median ${formatDollars(benchmark.median)} across ${benchmark.postings} postings with disclosed pay` : ''}.`,
    isNicheRole ? `National all-${NP} median ${BLS_SHORT_REFERENCE}.` : null,
  ]);
}

/** Convenience for pluralizing a noun the specs write as pluralize(n, noun). */
export { pluralize };
