/**
 * app/jobs/[slug]/job-page-meta.ts
 *
 * <title> and meta description for a job detail page (indexing audit
 * 2026-09, M-04 and M-09), and the hero's location line. Pure: the page
 * passes resolved facts in.
 *
 * M-04: titles were `${title}, ${location}`.slice(0, 65), which cut words in
 * half ("Advocate Heal") and dropped the employer, so one employer's
 * same-city postings collapsed to identical titles. The title is now built
 * from parts: the employer and the place are always kept (the place is what
 * tells one employer's postings of the same role apart: LifeStance lists
 * the same role in dozens of towns). What gives way is the brand suffix
 * first, then the role, only ever between whole role units that still name
 * the job, never mid-word.
 *
 * M-09: descriptions were the first 158 characters of the posting, usually
 * the employer's mission paragraph, identical across its postings and cut
 * mid-word. They are now assembled from the job's own facts in whole
 * sentences.
 */
import { brand } from '@/config/brand';
import { displayText, joinWithAnd, truncateOnWord } from '@/lib/display-text';
import {
  STATE_EXCLUSION_RE,
  isStubJobDescription,
  isUsListing,
  isVerifiedFullyRemote,
  resolveJobPlaces,
  resolveRemoteApplicantStates,
  stateNameForCode,
  statesNamedAsLicense,
  statesNamedInTitle,
  statesNearRemoteToken,
  titleNamedPlace,
  toStateCode,
  type JobPlace,
  type JobPostingFactsInput,
} from '@/app/jobs/[slug]/job-posting-facts';

/** Characters before the layout's " | NP Hiring" template suffix. */
export const JOB_TITLE_MAX = 70;
/** The layout's title template suffix (app/layout.tsx: `%s | ${brand.name}`). */
const BRAND_TITLE_SUFFIX = ` | ${brand.name}`;
/**
 * The longest title that still fits once it drops the brand suffix
 * (jobPageTitleMetadata): the same total length a JOB_TITLE_MAX title
 * reaches with the suffix. A role unit is worth more than the brand name.
 */
export const JOB_TITLE_ABSOLUTE_MAX = JOB_TITLE_MAX + BRAND_TITLE_SUFFIX.length;
/** Meta description budget; Google shows about this much on desktop. */
export const JOB_META_DESCRIPTION_MAX = 158;
/**
 * A remote job restricted to this many states or fewer names them in its
 * title ("Remote, OR", "Remote, CA and NV"); more read as plain "Remote".
 */
export const REMOTE_TITLE_MAX_STATES = 2;

/** Separator characters a cut must never leave dangling at the end. */
const DANGLING_END_RE = /[\s·,;:(&/|+-]+$/;

/**
 * Where a long role may be shortened: between two role units, never inside
 * one ("Nurse Practitioner/ Physician Assistant", "NP, Cardiology", "NP or
 * PA"). A slash between digits ("24/7") is not a unit boundary.
 */
const ROLE_UNIT_BOUNDARY_RE = /(?<!\d)\s*\/\s*(?!\d)|,\s+|\s+(?:or|and|&)\s+/gi;

/**
 * A shortened role must still name the job it advertises. Without one of
 * these head terms a cut can read as a different job ("Behavioral Health
 * Nurse" is an RN role). `[A-Z]{0,5}NP` covers NP and every NP credential
 * abbreviation (FNP, AGACNP, WHNP and the rest) in one alternative.
 */
const ROLE_HEAD_TERM_RE = new RegExp(
  `\\b(?:${[
    'Nurse Practitioner', 'Practitioner', '[A-Z]{0,5}NP',
    'APRN', 'ARNP', 'CRNP', 'CRNA', 'CNM', 'CNS', 'Physician Assistant', 'PA-C',
    'Advanced Practice Provider', 'Provider', 'Midwife', 'Anesthetist',
  ].join('|')})\\b`,
  'i',
);

/**
 * An NP role term: "Nurse Practitioner", NP or an NP credential (FNP,
 * PMHNP, AGACNP, "PMHNP-BC"), APRN, ARNP or CRNP. On an NP board the
 * <title> must keep one whenever the stored role has one: "Mental Health
 * Provider (Psychiatric PA or NP)" cut to "Mental Health Provider", or
 * "Physician Assistant or Nurse Practitioner" cut to "Physician Assistant",
 * advertises a different job.
 */
const NP_ROLE_RE =
  /\b(?:nurse[\s-]+practitioners?|[A-Z]{0,5}NP(?:-[A-Z]{1,3})?|APRN|ARNP|CRNP|APN|advanced\s+practice\s+(?:registered\s+)?nurses?)\b/i;

/** A remote token in a stored location string or a role title. */
const REMOTE_TOKEN_RE = /\b(?:remote|telecommute|telecommuting|work\s+from\s+home|wfh)\b/i;

/** An innermost parenthetical, with the whitespace before it. */
const PARENTHETICAL_GROUP_RE = /\s*\([^()]*\)/g;

function clip(text: string, max: number): string {
  return truncateOnWord(text, max).replace(DANGLING_END_RE, '');
}

/**
 * The role without its parentheticals, except one that carries the role's
 * only NP term: "Psychiatric Nurse Practitioner (PMHNP)" gives "Psychiatric
 * Nurse Practitioner", but "Psychiatric-Mental Health (NP/PA) (Monthly
 * Travel)" keeps "(NP/PA)", or it would name no role at all.
 */
function stripParentheticals(text: string): string {
  const tidy = (value: string): string => value.replace(/\s+/g, ' ').trim();
  const bare = tidy(text.replace(PARENTHETICAL_GROUP_RE, ''));
  const keepNpGroup = NP_ROLE_RE.test(text) && !NP_ROLE_RE.test(bare);
  return tidy(text.replace(PARENTHETICAL_GROUP_RE, (group) => (keepNpGroup && NP_ROLE_RE.test(group) ? group : '')));
}

/** True when every "(" in the text is closed. */
function hasBalancedParentheses(text: string): boolean {
  return text.split('(').length === text.split(')').length;
}

/**
 * "Remote" for a verified remote job, with the states it is restricted to
 * when there are at most REMOTE_TITLE_MAX_STATES ("Remote, OR"). Two
 * Thriveworks postings of one role, one for Oregon and one for Texas, then
 * get different titles, the same way on-site postings differ by town. When
 * neither the location string nor the title's remote token names a state,
 * the one state the title names anywhere ("North Carolina | Telehealth
 * PMHNP", "California license required") is the place: cleanRoleTitle takes
 * it out of the role, so without it two such postings for different states
 * would share one title. Not when the title excludes a state ("Remote PMHNP
 * (excluding California)", "All states except New York"): the one state it
 * names is then the place the job is NOT open to, so the title reads plain
 * "Remote".
 */
function remoteTitleLocation(job: JobPostingFactsInput): string {
  const codes = resolveRemoteApplicantStates(job)
    .map((name) => toStateCode(name))
    .filter((code): code is string => Boolean(code));
  if (codes.length === 0) {
    const named = statesNamedInTitle(job.title);
    return named.length === 1 && !STATE_EXCLUSION_RE.test(job.title) ? `Remote, ${named[0]}` : 'Remote';
  }
  if (codes.length > REMOTE_TITLE_MAX_STATES) return 'Remote';
  return `Remote, ${joinWithAnd(codes)}`;
}

function cityAndState(place: JobPlace): string {
  return displayText(place.regionCode ? `${place.locality}, ${place.regionCode}` : place.locality);
}

/**
 * The one state a title ties the job to when nothing else names a place:
 * next to its remote token ("NP, Remote TX", "..., Arizona, Remote") or
 * as the license it requires ("California license required"). Empty when
 * the title names none, names more than one state anywhere ("California
 * and Texas license required", "licensed in Oregon or Washington"), or
 * excludes a state ("Remote PMHNP - Texas excluded").
 */
function singleTitleState(title: string): string {
  if (STATE_EXCLUSION_RE.test(title)) return '';
  const codes = new Set([...statesNearRemoteToken(title), ...statesNamedAsLicense(title)]);
  if (codes.size !== 1 || statesNamedInTitle(title).length !== 1) return '';
  const [code] = codes;
  return stateNameForCode(code) ?? '';
}

/**
 * True when the title names no state other than `regionCode`. A title that
 * names several ("CA, TX or FL license required") ties the job to none of
 * them, so the one the title reader picked is not the job's place.
 */
function titleNamesOnlyState(title: string, regionCode: string | null): boolean {
  return statesNamedInTitle(title).every((code) => code === regionCode);
}

/**
 * The place a title or card names: "Remote" (or "Remote, ST") only for a
 * verified fully remote job; else "City, ST" from the stored place; else,
 * when the stored place has no town, the town the job's title names in the
 * same state ("Nurse Practitioner - Denver, CO (Hybrid)"); else the state's
 * name, from the stored place, the title's place or the one state the title
 * ties the job to ("NP, Remote TX", "California license required"); else
 * ''. Never "Remote" for a job whose location is merely unknown (CS-03).
 * M-04: the same role at one employer in two places must get two titles,
 * and the role title is cleaned of the place (cleanRoleTitle), so the place
 * has to come back here.
 */
export function resolveTitleLocation(job: JobPostingFactsInput): string {
  if (isVerifiedFullyRemote(job)) return remoteTitleLocation(job);
  if (!isUsListing(job)) return '';
  const [first] = resolveJobPlaces(job);
  if (first?.locality) return cityAndState(first);
  const named = titleNamedPlace(job);
  // A town the title names is read with its own state; a state alone counts
  // only when the title names no other state.
  const namedUsable = named !== null && (named.locality !== null || titleNamesOnlyState(job.title, named.regionCode));
  if (named && namedUsable && (!first || named.regionCode === first.regionCode)) {
    return named.locality ? cityAndState(named) : stateNameForCode(named.regionCode) ?? '';
  }
  if (first) return stateNameForCode(first.regionCode) ?? '';
  return singleTitleState(job.title);
}

/**
 * The hero's location line. The stored location string is shown as the
 * employer wrote it, except that a remote token ("Remote", "Telecommute")
 * is shown only for a verified fully remote job (GFJ-01): otherwise the line
 * names the job's resolved place, as the title and the markup do, or is
 * empty.
 */
export function resolveHeroLocation(job: JobPostingFactsInput): string {
  const written = displayText(job.location);
  if (!REMOTE_TOKEN_RE.test(written) || isVerifiedFullyRemote(job)) return written;
  return resolveTitleLocation(job);
}

function containsIgnoringCase(haystack: string, needle: string): boolean {
  return needle.length > 0 && haystack.toLowerCase().includes(needle.toLowerCase());
}

/**
 * Every whole-unit prefix of a role that still names the role (a head
 * term), shortest first. "Nurse Practitioner, Cardiology, Heart Failure
 * Clinic" gives "Nurse Practitioner" and "Nurse Practitioner, Cardiology".
 * A boundary inside a kept parenthetical ("(NP/PA)") is not a cut: the
 * prefix would leave a "(" open.
 */
function roleUnitCuts(role: string): string[] {
  const cuts = [...role.matchAll(ROLE_UNIT_BOUNDARY_RE)]
    .map((match) => role.slice(0, match.index).replace(DANGLING_END_RE, '').trim())
    .filter((prefix) => prefix.length > 0 && hasBalancedParentheses(prefix) && ROLE_HEAD_TERM_RE.test(prefix));
  return [...new Set(cuts)].sort((a, b) => a.length - b.length);
}

/**
 * The longest leading run of whole role units that fits `budget` and still
 * names the role (a head term), or null when no such cut exists.
 * "Gastroenterology Nurse Practitioner/ Physician Assistant" shortens to
 * "Gastroenterology Nurse Practitioner"; "Adult Gerontology Acute Care Nurse
 * Practitioner" has no unit boundary, so it never shortens.
 */
export function shortenRoleAtUnitBoundary(role: string, budget: number): string | null {
  const fitting = roleUnitCuts(role).filter((cut) => cut.length <= budget);
  return fitting.length > 0 ? fitting[fitting.length - 1] : null;
}

/**
 * The " (Place)" part for one form of the role. Skipped when that form
 * already names the place (no "Remote NP ... (Remote)"); a role that says
 * "Remote" keeps only the states of a "Remote, ST" place ("(OR)").
 */
function placeSuffix(roleForm: string, location: string): string {
  if (!location || containsIgnoringCase(roleForm, location)) return '';
  const remoteStates = /^Remote, (.+)$/.exec(location);
  if (remoteStates && REMOTE_TOKEN_RE.test(roleForm)) return ` (${remoteStates[1]})`;
  return ` (${location})`;
}

/**
 * "{Role} at {Employer} ({Place})". The employer and the place are always
 * kept: the place is what tells one employer's postings of the same role
 * apart (LifeStance lists one role in dozens of towns; Thriveworks one
 * remote role per state). What gives way, in order:
 *   1. the role's parentheticals ("(FNP)", "(NP/PA)"), while the title fits
 *      JOB_TITLE_MAX with the brand suffix, except one that holds the
 *      role's only NP term;
 *   2. the brand suffix: a title up to JOB_TITLE_ABSOLUTE_MAX drops it
 *      (jobPageTitleMetadata) rather than lose a role unit, so "Nurse
 *      Practitioner, Behavioral Health" stays distinct from the same
 *      employer's other units in the same town;
 *   3. trailing role units, cut only between whole units and only while
 *      the rest still names the job (a head term), longest first.
 * The role is never cut inside a unit or mid-word, so when nothing fits,
 * the shortest of those titles is returned even past the budget: a longer
 * title that names the job and its place beats a short one that names a
 * different job ("Adult Gerontology Acute Care at ...") or collides with
 * the same role in another place. A role that names the NP role never
 * gives way to a form that does not ("Physician Assistant or Nurse
 * Practitioner" is never cut to "Physician Assistant").
 */
export function buildJobPageTitle(input: { roleTitle: string; employer: string; location: string }): string {
  const role = displayText(input.roleTitle).trim();
  const employer = displayText(input.employer).trim();
  const shortRole = stripParentheticals(role) || role;
  const suffix = employer ? ` at ${employer}` : '';
  const compose = (form: string): string => `${form}${suffix}${placeSuffix(form, input.location)}`;
  const namesNp = (form: string): boolean => !NP_ROLE_RE.test(role) || NP_ROLE_RE.test(form);
  const shortForms = [...new Set([shortRole, ...roleUnitCuts(shortRole).reverse()])].filter(namesNp);

  // The full role (parentheticals and all) is kept only with the brand
  // suffix; every shortened form may trade the suffix for length.
  const candidates = [
    ...(shortRole !== role ? [{ title: compose(role), max: JOB_TITLE_MAX }] : []),
    ...(shortForms.length > 0 ? shortForms : [role]).map((form) => ({
      title: compose(form),
      max: JOB_TITLE_ABSOLUTE_MAX,
    })),
  ];
  const fitting = candidates.find((candidate) => candidate.title.length <= candidate.max);
  if (fitting) return fitting.title;
  return candidates.reduce((shortest, candidate) => (candidate.title.length < shortest.title.length ? candidate : shortest)).title;
}

/**
 * The page's `title` metadata. A title longer than JOB_TITLE_MAX (it kept a
 * whole role unit and the place instead) is returned as absolute, so the
 * layout's " | NP Hiring" template suffix does not stack on top of it.
 */
export function jobPageTitleMetadata(title: string): string | { absolute: string } {
  return title.length > JOB_TITLE_MAX ? { absolute: title } : title;
}

/**
 * The page's robots metadata (GFJ-04), or null for the default
 * (index, follow). A synthesized stub description ("<role>, Remote TX ... /
 * Employer: / Department: / Location:") is not a complete posting: the page
 * stays reachable for anyone who follows a link, but it is kept out of the
 * index, and buildJobPostingSchema emits no JobPosting for it, until the
 * adapter stores the employer's full description. isJobPostingEligible
 * reads the same rule, so index-urls never submits it either.
 */
export function jobPageRobots(
  job: Pick<JobPostingFactsInput, 'title' | 'description'>,
): { index: false; follow: true } | null {
  return isStubJobDescription(job) ? { index: false, follow: true } : null;
}

export interface JobMetaDescriptionInput {
  roleTitle: string;
  employer: string;
  /**
   * From resolveTitleLocation; empty for a verified remote job, whose lead
   * sentence names its states from remoteStates instead.
   */
  location: string;
  /** From resolveWorkModeLabel. */
  workMode: string | null;
  /** States a remote job is restricted to (full names). */
  remoteStates: readonly string[];
  jobType: string | null;
  /** The hero's formatted pay, only when the employer stated it. */
  payLabel: string | null;
  postedAt: Date;
  applyOnPlatform: boolean;
  /** The row's plain-text summary, if any. */
  summary: string | null;
}

const BOILERPLATE_SENTENCE_RE = /\b(?:we believe|our mission|our vision|equal opportunity|eeo\b|is committed to|are committed to|affirmative action)/i;

/** The first whole, role-relevant sentence of the stored summary, else null. */
export function firstSummarySentence(summary: string | null | undefined): string | null {
  if (!summary) return null;
  const text = summary
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/(?:\.{3}|…)\s*$/, '')
    .trim();
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [];
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!/^[A-Z]/.test(sentence)) continue;
    if (sentence.length < 30 || sentence.length > 150) continue;
    if (BOILERPLATE_SENTENCE_RE.test(sentence)) continue;
    return displayText(sentence);
  }
  return null;
}

function formatPostedDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function leadSentence(input: JobMetaDescriptionInput, role: string, employer: string): string {
  if (input.workMode === 'Remote') {
    const states = input.remoteStates.length > 0 ? ` open to applicants in ${joinWithAnd([...input.remoteStates])}` : '';
    return `${role} at ${employer}, a fully remote role${states}.`;
  }
  if (input.location && input.workMode === 'Hybrid') return `${role} at ${employer}, a hybrid role in ${input.location}.`;
  if (input.location) return `${role} at ${employer} in ${input.location}.`;
  return `${role} at ${employer}.`;
}

function factsSentence(input: JobMetaDescriptionInput): string | null {
  const jobType = input.jobType?.trim() || null;
  if (jobType && input.payLabel) return `${jobType} position paying ${input.payLabel}.`;
  if (input.payLabel) return `Posted pay: ${input.payLabel}.`;
  if (jobType) return `${jobType} position.`;
  return null;
}

/**
 * Whole sentences in priority order, each added only while the total fits:
 * who and where, the type and posted pay, the posted date, one sentence of
 * the summary, where to apply. Only the lead is ever cut, and then on a word
 * boundary.
 */
export function buildJobMetaDescription(input: JobMetaDescriptionInput): string {
  const role = displayText(input.roleTitle).trim();
  const employer = displayText(input.employer).trim();
  const lead = leadSentence(input, role, employer);
  if (lead.length >= JOB_META_DESCRIPTION_MAX) return clip(lead, JOB_META_DESCRIPTION_MAX);

  const optional = [
    factsSentence(input),
    `Posted ${formatPostedDate(input.postedAt)}.`,
    firstSummarySentence(input.summary),
    input.applyOnPlatform ? `Apply on ${brand.name}.` : `Apply on the employer's site.`,
  ].filter((sentence): sentence is string => Boolean(sentence));

  let description = lead;
  for (const sentence of optional) {
    const next = `${description} ${sentence}`;
    if (next.length <= JOB_META_DESCRIPTION_MAX) description = next;
  }
  return description;
}
