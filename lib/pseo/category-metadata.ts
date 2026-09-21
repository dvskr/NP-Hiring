/**
 * lib/pseo/category-metadata.ts
 *
 * Title, description and robots builders shared by the category landing
 * template and the 23 bespoke landing pages (thin-spec 1, section 6.2),
 * plus the label grammar every listing title needs (thin-spec 2, K9).
 *
 * Rules baked in here so no page re-derives them:
 *   - the root layout appends " | {brand.name}", so the page part of a
 *     title is capped at SERP_TITLE_MAX minus that suffix;
 *   - a live count appears in a title only at COUNT_DISPLAY_FLOOR or above
 *     (lib/canonical-counts.ts), never as "0 ... Jobs" or "1 ... Jobs";
 *   - descriptions are assembled clause by clause up to DESCRIPTION_MAX and
 *     never end mid-word;
 *   - no dashes; ranges read "to"; niche identity from brand.niche tokens.
 */
import { brand } from '@/config/brand';
import { COUNT_DISPLAY_FLOOR } from '@/lib/canonical-counts';
import { formatCount, truncateOnWord } from '@/lib/display-text';
import { shouldIndexListingPage } from './render-gate';
import { CATEGORY_AXES } from './taxonomy-registry';

/** SERP title budget before the layout template adds the brand suffix. */
export const SERP_TITLE_MAX = 60;
export const TITLE_SUFFIX_LENGTH = ` | ${brand.name}`.length;
export const TITLE_PAGE_PART_MAX = SERP_TITLE_MAX - TITLE_SUFFIX_LENGTH;
/** Meta description budget shared by every pSEO builder. */
export const DESCRIPTION_MAX = 155;

const STANDALONE_LABEL_SLUGS: ReadonlySet<string> = new Set(CATEGORY_AXES.aprn);

/**
 * Role noun for titles and H1s. APRN-axis labels already name the role
 * ("Nurse Anesthetist"), so they never gain the credential suffix that
 * would read "Nurse Anesthetist NP Jobs".
 */
export function labelNoun(slug: string, label: string): string {
  return STANDALONE_LABEL_SLUGS.has(slug) ? label : `${label} ${brand.niche.short}`;
}

/**
 * Mid-sentence form of a label: lowercase unless it carries an acronym, a
 * digit or a plus sign ("LGBTQ+", "VA", "1099" keep their case).
 */
export function labelSentence(label: string): string {
  return /[A-Z]{2,}|\d|\+/.test(label) ? label : label.toLowerCase();
}

/**
 * Join description clauses in order while the total stays within `max`.
 * The first clause that would overflow ends the assembly; a first clause
 * that alone overflows is cut on a word boundary. Falsy parts are skipped,
 * so callers can pass conditional clauses inline.
 */
export function assembleDescription(
  parts: ReadonlyArray<string | null | undefined | false>,
  max: number = DESCRIPTION_MAX,
): string {
  let out = '';
  for (const part of parts) {
    if (!part) continue;
    const next = out ? `${out} ${part}` : part;
    if (next.length > max) break;
    out = next;
  }
  if (!out) {
    const first = parts.find((part): part is string => Boolean(part));
    return first ? truncateOnWord(first, max) : '';
  }
  return out;
}

export interface CategoryLandingTitleInput {
  /** Role noun, e.g. "Family Practice Nurse Practitioner (FNP)" or "Remote NP". */
  role: string;
  /** Canonical live count for the category. */
  totalJobs: number;
  /** Optional claim-free tagline a bespoke page keeps instead of the count. */
  tagline?: string;
}

/** "{Role} Jobs", plus ": {n} Openings" at the display floor when it fits. */
export function buildCategoryLandingTitle(input: CategoryLandingTitleInput): string {
  const base = `${input.role} Jobs`;
  if (input.tagline) {
    const tagged = `${base}: ${input.tagline}`;
    return tagged.length <= TITLE_PAGE_PART_MAX ? tagged : base;
  }
  if (input.totalJobs < COUNT_DISPLAY_FLOOR) return base;
  const counted = `${base}: ${input.totalJobs} Openings`;
  return counted.length <= TITLE_PAGE_PART_MAX ? counted : base;
}

export interface CategoryLandingDescriptionInput {
  role: string;
  totalJobs: number;
  employerCount: number;
  stateCount: number;
  /** Gated median in whole thousands, or null below the publishing gate. */
  medianK: number | null;
}

/** Description assembly of thin-spec 1, section 6.2 (155 characters or fewer). */
export function buildCategoryLandingDescription(input: CategoryLandingDescriptionInput): string {
  const { role, totalJobs, employerCount, stateCount, medianK } = input;
  if (totalJobs < 1) {
    return assembleDescription([
      `${role} jobs: role overview, certification requirements and job alerts for new openings.`,
    ]);
  }
  const spread = stateCount >= 1 ? ` across ${formatCount(stateCount, 'state')}` : '';
  return assembleDescription([
    `${totalJobs} ${role} ${totalJobs === 1 ? 'opening' : 'openings'} from ${formatCount(employerCount, 'employer')}${spread}.`,
    medianK !== null && medianK > 0 ? `Median posted pay $${medianK}K.` : null,
    'Role overview, certification requirements and state links.',
  ]);
}

/**
 * Landing index rule (thin-spec 1, section 8.3; PLAN C.2): page 1 with at
 * least MIN_JOBS_FOR_INDEX canonical jobs. Read straight from render-gate's
 * shouldIndexListingPage, the one function the sitemap and the cross-link
 * gates also call for this page type, so the three can never drift.
 */
export function shouldIndexCategoryLanding(totalJobs: number, page: number = 1): boolean {
  return shouldIndexListingPage(totalJobs, page);
}

/** Robots object for generateMetadata; noindex pages stay follow. */
export function categoryLandingRobots(
  totalJobs: number,
  page: number = 1,
): { index: boolean; follow: boolean } {
  return { index: shouldIndexCategoryLanding(totalJobs, page), follow: true };
}
