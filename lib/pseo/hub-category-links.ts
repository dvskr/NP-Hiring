/**
 * lib/pseo/hub-category-links.ts
 *
 * The /jobs hub's category links (indexing audit M-07). The hub's editorial
 * block linked seven landings from a hard-coded list (family practice, acute
 * care, anesthesia, midwifery, remote, telehealth, travel) and none of the
 * others: /jobs/urgent-care was linked from no sampled page, and a listed
 * landing that loses its inventory answers noindex (under the listing floor)
 * or 404 (at 0 jobs, TECH-06) while the hub kept linking it.
 *
 * The links are now built from the index verdicts
 * (lib/pseo/landing-verdicts.ts): every indexable category landing, grouped
 * by taxonomy axis, and no other. A landing joins the hub when it passes the
 * gate and leaves when it falls below it. Pure.
 */
import { CATEGORY_AXES } from './taxonomy-registry';

export type HubCategoryAxis = keyof typeof CATEGORY_AXES;

export interface HubCategoryLink {
  slug: string;
  href: string;
  label: string;
}

export interface HubCategoryGroup {
  axis: HubCategoryAxis;
  title: string;
  links: HubCategoryLink[];
}

/** Axis order and headings on the hub: the specialties lead, as the board's core. */
export const HUB_AXIS_HEADINGS: ReadonlyArray<readonly [HubCategoryAxis, string]> = [
  ['specialty', 'Specialties'],
  ['aprn', 'APRN roles'],
  ['setting', 'Work settings'],
  ['jobType', 'Job types'],
  ['experience', 'Experience levels'],
  ['employerType', 'Employer types'],
  ['population', 'Patient populations'],
];

/** Labels a title-cased slug gets wrong (acronyms, hyphenated terms, the APRN roles). */
const LABEL_OVERRIDES: Readonly<Record<string, string>> = {
  anesthesia: 'Nurse Anesthesia (CRNA)',
  midwifery: 'Nurse Midwifery (CNM)',
  'clinical-nurse-specialist': 'Clinical Nurse Specialist (CNS)',
  'women-health': "Women's Health",
  'adult-gerontology': 'Adult-Gerontology',
  'palliative-hospice': 'Palliative and Hospice',
  'full-time': 'Full-Time',
  'part-time': 'Part-Time',
  'entry-level': 'Entry-Level',
  'mid-career': 'Mid-Career',
  '1099': '1099 Contractor',
  va: 'VA',
  lgbtq: 'LGBTQ+',
};

/** The link text for a category slug ("urgent-care" reads "Urgent Care"). */
export function hubCategoryLabel(slug: string): string {
  return (
    LABEL_OVERRIDES[slug] ??
    slug
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  );
}

/**
 * The mid-sentence form of a label: lower case, keeping acronyms and
 * figures as written ("Nurse Anesthesia (CRNA)" reads "nurse anesthesia
 * (CRNA)", "VA" stays "VA").
 */
export function hubCategoryProse(label: string): string {
  return label
    .split(' ')
    .map((word) => (/[A-Z]{2,}|\d/.test(word) ? word : word.toLowerCase()))
    .join(' ');
}

/**
 * Every indexable landing, grouped by axis in HUB_AXIS_HEADINGS order and in
 * the registry's order within an axis. An axis with no indexable landing is
 * left out; an empty set gives no group at all.
 */
export function selectHubCategoryGroups(indexable: ReadonlySet<string>): HubCategoryGroup[] {
  return HUB_AXIS_HEADINGS.flatMap(([axis, title]): HubCategoryGroup[] => {
    const links = (CATEGORY_AXES[axis] as readonly string[])
      .filter((slug) => indexable.has(slug))
      .map((slug) => ({ slug, href: `/jobs/${slug}`, label: hubCategoryLabel(slug) }));
    return links.length > 0 ? [{ axis, title, links }] : [];
  });
}

/** The axes the FAQ answer names, with the noun each clause starts with. */
const FAQ_AXES: ReadonlyArray<readonly [HubCategoryAxis, string]> = [
  ['specialty', 'specialties'],
  ['aprn', 'APRN roles'],
  ['setting', 'work settings'],
  ['jobType', 'job types'],
];

/** Examples named per axis in the FAQ answer. */
const FAQ_EXAMPLES_PER_AXIS = 4;

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The answer to "Which specialties and job types can I browse?", naming only
 * categories whose landing is indexable now (the hub links each of them), so
 * the FAQ never promises a page that answers noindex or 404. Clauses are
 * separated by semicolons because each one already lists names with commas.
 */
export function buildHubCategoryFaqAnswer(groups: readonly HubCategoryGroup[]): string {
  const clauses = FAQ_AXES.flatMap(([axis, noun]) => {
    const group = groups.find((g) => g.axis === axis);
    if (!group) return [];
    const names = group.links.slice(0, FAQ_EXAMPLES_PER_AXIS).map((link) => hubCategoryProse(link.label));
    return [`${noun} such as ${joinNames(names)}`];
  });
  const filters = 'The filters on this page narrow the board by specialty, work setting, job type and location.';
  if (clauses.length === 0) return filters;
  const list = clauses.length === 1
    ? clauses[0]
    : `${clauses.slice(0, -1).join('; ')}; and ${clauses[clauses.length - 1]}`;
  return `Categories with their own page of current openings include ${list}. ${filters}`;
}
