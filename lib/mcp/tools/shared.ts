import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { activeIndexableJobWhere } from '@/lib/active-job-filter';
import { visibleTwinsOfCopiesWhere } from '@/lib/paid-post-twin-lookup';
import { normalizeDisplaySalary } from '@/lib/salary-display';
import { isEstimatedSalary } from '@/app/jobs/[slug]/job-posting-facts';
import { effectiveExperienceLabel, effectiveNewGradFriendly } from '@/lib/experience-label';
import { CODE_TO_STATE, STATE_CODES } from '@/lib/pseo/setting-state-config';
import { formatSalary, slugify } from '@/lib/utils';
import type { JobCard, WorkMode } from '@/lib/mcp/widgets/src/contracts';
import { BOARD_NAME } from './board-words';

/**
 * Helpers shared by the MCP tools. Every job the assistant sees goes through
 * activeIndexableJobWhere(), NP Hiring's "is this posting live" predicate
 * (published, not expired, not a repeated dead link, not excluded), so a job
 * the site hides is invisible to the assistant too. A list of results adds
 * the listing's own filters (buildWhereClause) on top of it.
 */

/** Where any job lookup starts. A function, so a long-lived process never keeps a stale "now". */
export function liveJobWhere(): Prisma.JobWhereInput {
  return activeIndexableJobWhere(new Date());
}

export const JOB_CARD_SELECT = {
  id: true,
  slug: true,
  title: true,
  employer: true,
  location: true,
  city: true,
  state: true,
  stateCode: true,
  isRemote: true,
  isHybrid: true,
  mode: true,
  jobType: true,
  displaySalary: true,
  normalizedMinSalary: true,
  normalizedMaxSalary: true,
  salaryRange: true,
  salaryPeriod: true,
  minSalary: true,
  maxSalary: true,
  // An estimated or conflicting figure is never quoted (isEstimatedSalary),
  // and a card says when the employer posted the job here (sourceType).
  salaryIsEstimated: true,
  salaryConfidence: true,
  sourceType: true,
  originalPostedAt: true,
  createdAt: true,
  experienceLabel: true,
  newGradFriendly: true,
  minYearsExperience: true,
  applyOnPlatform: true,
  isVerifiedEmployer: true,
} satisfies Prisma.JobSelect;

export type JobCardRow = Prisma.JobGetPayload<{ select: typeof JOB_CARD_SELECT }>;

export function jobUrl(baseUrl: string, job: { id: string; slug: string | null; title: string }): string {
  return `${baseUrl}/jobs/${job.slug || slugify(job.title, job.id)}`;
}

/** What a card says where the posting names no city and no state. */
export const PLACE_NOT_LISTED = 'City and state not listed';

/**
 * A location that names the country and nothing in it. A feed that gives no
 * location is stored with the country, and "United States" printed as a
 * job's place reads as if the posting had said where it is.
 */
const COUNTRY_ONLY_RE = /^(?:u\.?\s?s\.?(?:\s?a\.?)?|united states(?: of america)?)$/i;
const LOCATION_MAX = 80;

function displayLocation(job: JobCardRow): string {
  if (job.isRemote && !job.isHybrid) return 'Remote';
  if (job.city && (job.stateCode || job.state)) return `${job.city}, ${job.stateCode || job.state}`;
  if (job.state) return job.state;
  if (job.city?.trim()) return job.city.trim();
  // What the source wrote, when it is none of those: a clinic's name, a
  // building. It is the posting's own word for the place.
  const written = clipLine(job.location ?? '', LOCATION_MAX);
  return written !== '' && !COUNTRY_ONLY_RE.test(written) ? written : PLACE_NOT_LISTED;
}

/**
 * The work mode as a reader sees it, from the two flags the listing filters
 * on. Hybrid first: a hybrid role commonly carries isRemote too, and hybrid
 * is the more specific claim. A posting whose flags say neither but whose own
 * free-text mode says remote or hybrid is not called in person: a reader
 * forgives a missing field, not a wrong one.
 */
export function workModeLabel(job: Pick<JobCardRow, 'isRemote' | 'isHybrid' | 'mode'>): WorkMode {
  if (job.isHybrid) return 'Hybrid';
  if (job.isRemote) return 'Remote';
  const raw = (job.mode ?? '').toLowerCase();
  if (raw.includes('hybrid')) return 'Hybrid';
  if (raw.includes('remote')) return 'Remote';
  return 'In-Person';
}

const SAYS_IN_PERSON_RE = /in[\s-]?person|on[\s-]?site/i;

/**
 * The work mode a card states, or null when the posting gives no basis for
 * one. "In-Person" is the absence of both flags, and a posting with no city
 * and no state has an absence of everything: the role may well be remote, so
 * nothing is claimed. A posting whose own mode says on site keeps the label
 * wherever it is.
 */
function cardWorkMode(job: JobCardRow): WorkMode | null {
  const label = workModeLabel(job);
  if (label !== 'In-Person') return label;
  const hasPlace = Boolean(job.city?.trim() || job.state?.trim() || job.stateCode?.trim());
  return hasPlace || SAYS_IN_PERSON_RE.test(job.mode ?? '') ? 'In-Person' : null;
}

/**
 * A job's pay as its job page prints it, so a card never disagrees with the
 * page it links to (app/jobs/[slug]/page.tsx payLabel): the posting's own
 * figures and period through formatSalary, a range read with "to"
 * (normalizeDisplaySalary). An estimated or conflicting figure is not quoted
 * (CQ-02, the rule that also keeps it out of JobPosting.baseSalary). Where
 * the page has no figures, the stored display text the site's job card shows.
 */
export function jobPayText(
  job: Pick<JobCardRow, 'displaySalary' | 'minSalary' | 'maxSalary' | 'salaryPeriod' | 'salaryIsEstimated' | 'salaryConfidence'>,
): string | null {
  if (isEstimatedSalary(job)) return null;
  return normalizeDisplaySalary(formatSalary(job.minSalary, job.maxSalary, job.salaryPeriod)) || normalizeDisplaySalary(job.displaySalary);
}

const PART_TIME_SCHEDULE_RE = /^(?:part[\s-]?time|per[\s-]?diem|prn)$/i;
const YEARLY_PAY_RE = /\/\s*yr\b/i;

/**
 * Said beside yearly pay on a part-time, per diem or PRN posting. A posting
 * for a twenty hour week that states a yearly figure reads, with nothing
 * beside it, like an hourly rate multiplied out wrongly, or like low pay next
 * to a median of full-time salaries. The figure is the one listed for the
 * posting; this says what it is for.
 */
export const PART_TIME_YEARLY_PAY_NOTE = 'yearly pay as listed for a part-time schedule';

/** The same, at the length a job's own page of facts has room for. */
export const PART_TIME_YEARLY_PAY_DETAIL =
  'Pay note: that is yearly pay as listed for a part-time schedule, so it may be the pay for those hours and not a full-time salary. A state median is mostly full-time salaries, so the two are not like for like.';

function partTimeYearlyPayNote(job: Pick<JobCardRow, 'jobType'>, pay: string | null): string | null {
  if (!pay) return null;
  if (!PART_TIME_SCHEDULE_RE.test((job.jobType ?? '').trim())) return null;
  return YEARLY_PAY_RE.test(pay) ? PART_TIME_YEARLY_PAY_NOTE : null;
}

/** A card's pay for a line of text, with what the figure is for when that is not plain. */
export function payForLine(card: Pick<JobCard, 'pay' | 'payNote'>): string | null {
  if (!card.pay) return null;
  return card.payNote ? `${card.pay} (${card.payNote})` : card.pay;
}

/**
 * What the assistant is told about a posting an employer made on NP Hiring
 * itself. The website labels every such posting "Featured", whether or not
 * the employer paid, so the label says where the job was posted and nothing
 * about rank or payment.
 */
export const EMPLOYER_POSTED_LINE =
  `Posted by: the employer, on ${BOARD_NAME} itself. The website labels such a posting "Featured", which means only that the employer posted it here.`;

/**
 * A card's place with its work mode, for a line of text: "Austin, TX
 * (Hybrid)". A fully remote job's place already is "Remote", so the mode is
 * left off instead of printing "Remote (Remote)".
 */
export function placeWithWorkMode(card: Pick<JobCard, 'location' | 'workMode'>, max = 80): string {
  const location = clipLine(card.location, max);
  return card.workMode && card.workMode !== location ? `${location} (${card.workMode})` : location;
}

/**
 * One line of at most `max` characters, for text someone else wrote (a job
 * title, an applicant's headline) that goes into a list the model reads.
 */
export function clipLine(value: string, max: number): string {
  const line = value.replace(/\s+/g, ' ').trim();
  return line.length <= max ? line : `${line.slice(0, max - 3).trimEnd()}...`;
}

/** A message as a sentence ending in exactly one full stop. */
export function sentence(value: string): string {
  return `${value.trim().replace(/[.\s]+$/, '')}.`;
}

/** Titles and employer names are employer-written or scraped, so bounded. */
const TITLE_MAX = 150;
const EMPLOYER_MAX = 100;

/** The experience line a card shows, as the site's job card shows it. */
function experienceLine(job: JobCardRow): string | null {
  const label = effectiveExperienceLabel(job);
  if (label) return label;
  return effectiveNewGradFriendly(job) ? 'New grad welcome' : null;
}

export function toJobCard(job: JobCardRow, baseUrl: string): JobCard {
  const pay = jobPayText(job);
  return {
    id: job.id,
    title: clipLine(job.title, TITLE_MAX),
    employer: clipLine(job.employer, EMPLOYER_MAX),
    location: displayLocation(job),
    workMode: cardWorkMode(job),
    jobType: job.jobType,
    pay,
    payNote: partTimeYearlyPayNote(job, pay),
    postedAt: (job.originalPostedAt ?? job.createdAt)?.toISOString() ?? null,
    experience: experienceLine(job),
    easyApply: job.applyOnPlatform === true,
    employerPosted: job.sourceType === 'employer',
    verifiedEmployer: job.isVerifiedEmployer === true,
    url: jobUrl(baseUrl, job),
  };
}

const UUID_PATTERN = /([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i;

/**
 * A job reference from the model: an id, a slug, or a job URL on this site.
 * Slugs end in the job's UUID, so every accepted form reduces to one.
 */
export function parseJobRef(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 500) return null;
  const match = UUID_PATTERN.exec(trimmed);
  return match ? match[1].toLowerCase() : null;
}

/**
 * A live job on this site, by id, slug or URL, or null. A free copy of a role
 * its employer is paying to feature is hidden and its URL redirects to the
 * paid post (lib/paid-post-twins.ts), so a copy's id or pasted URL answers
 * with that post, not "no longer open". Callers get the post's own id back.
 * The second query runs only when the first one misses.
 */
export async function findPublicJob<S extends Prisma.JobSelect>(ref: string, select: S) {
  const id = parseJobRef(ref);
  if (!id) return null;
  const job = await prisma.job.findFirst({ where: { AND: [liveJobWhere(), { id }] }, select });
  if (job) return job;
  return prisma.job.findFirst({ where: visibleTwinsOfCopiesWhere([id]), select });
}

/** "TX", "tx", "Texas" and "texas" all name Texas; "DC" names the District of Columbia. */
export function resolveStateName(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const byCode = CODE_TO_STATE[trimmed.toUpperCase()];
  if (byCode) return byCode;
  const lower = trimmed.toLowerCase();
  return Object.keys(STATE_CODES).find((name) => name.toLowerCase() === lower) ?? null;
}

/** The two-letter code for a state name, or null. */
export function stateCodeFor(stateName: string): string | null {
  return STATE_CODES[stateName] ?? null;
}

/**
 * The text without its <script> or <style> blocks: what such a block holds
 * is never prose. A single pass with indexOf, because job descriptions are
 * scraped and a signed-out caller can ask for any of them: a lazy regex
 * over a page of unclosed tags takes time quadratic in its length.
 */
function withoutBlocks(value: string, tag: 'script' | 'style'): string {
  const lower = value.toLowerCase();
  const open = `<${tag}`;
  const close = `</${tag}`;
  let out = '';
  let at = 0;
  for (;;) {
    const start = lower.indexOf(open, at);
    if (start < 0) return out + value.slice(at);
    out += value.slice(at, start);
    const end = lower.indexOf(close, start + open.length);
    // Never closed: the rest of the text is the block.
    if (end < 0) return out;
    const after = lower.indexOf('>', end);
    if (after < 0) return out;
    at = after + 1;
  }
}

/** Plain text for the conversation: tags stripped, entities decoded, whitespace tidied. */
export function plainText(value: string | null | undefined): string {
  if (!value) return '';
  return withoutBlocks(withoutBlocks(value, 'script'), 'style')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

export function truncate(value: string, max: number): { text: string; truncated: boolean } {
  if (value.length <= max) return { text: value, truncated: false };
  const cut = value.slice(0, max);
  const lastBreak = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('. '));
  return { text: `${cut.slice(0, lastBreak > max * 0.6 ? lastBreak + 1 : max).trim()}...`, truncated: true };
}

export { isSensitiveScreeningQuestion } from '@/lib/ai/sensitive-screening';
