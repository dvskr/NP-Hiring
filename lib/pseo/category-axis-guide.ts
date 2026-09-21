/**
 * lib/pseo/category-axis-guide.ts
 *
 * Per-axis editorial for the category surfaces: LAND-L5 ("How to use this
 * page") on the 45 landings and CC-K7 ("How this page is built") on the
 * category x city pages. Written ONCE PER AXIS, not per category, so the
 * largest axis (specialty, 17 of 45 landings) stays under the 50% sibling
 * boilerplate line while every category still gets a paragraph.
 *
 * TRUTH RULE: no figures, no market claims, no trend words. Each paragraph
 * explains how listings reach the page and what to check before applying.
 * Niche identity comes from brand.niche tokens.
 */
import { brand } from '@/config/brand';
import { CATEGORY_AXES } from './taxonomy-registry';

export type CategoryAxis = keyof typeof CATEGORY_AXES;

/** Axis of a taxonomy slug, or null for a slug outside the registry. */
export function getCategoryAxis(slug: string): CategoryAxis | null {
  for (const axis of Object.keys(CATEGORY_AXES) as CategoryAxis[]) {
    if ((CATEGORY_AXES[axis] as readonly string[]).includes(slug)) return axis;
  }
  return null;
}

/** Reader-facing axis names for grouped category lists (CITY-C2). */
export const CATEGORY_AXIS_LABELS: Readonly<Record<CategoryAxis, string>> = {
  setting: 'Setting',
  jobType: 'Job type',
  specialty: 'Specialty',
  aprn: 'APRN role',
  experience: 'Experience level',
  employerType: 'Employer type',
  population: 'Patient population',
};

const NP_PROSE = brand.niche.descriptor;

/** LAND-L5: one "How to use this page" paragraph per axis. */
export const LANDING_AXIS_GUIDE: Readonly<Record<CategoryAxis, string>> = {
  setting:
    'Listings here are grouped by where or how care is delivered, so a role can also appear under a specialty or a job type. Use the state links to narrow by licensure state, then open a listing to confirm the exact setting, schedule and any travel or technology requirements, since employers describe these differently. If nothing fits today, a job alert for this category emails you new matches.',
  jobType:
    "Listings here are grouped by employment arrangement, classified from each listing's own wording. Pay can be stated per year, per hour or per shift, so compare offers on the same basis, and check each listing for benefits, malpractice coverage and guaranteed hours. Confirm the arrangement with the employer before you accept.",
  specialty:
    "Listings here are grouped by clinical specialty, read from each listing's title and description, so a role can appear under more than one specialty. Check the certification each listing asks for against your own board certification, and use the state links to find openings in the states where you hold or plan to hold a license.",
  aprn:
    `This page covers an advanced practice role with its own certification and licensure path, separate from ${NP_PROSE} certification. Read each listing's credential requirements closely, and confirm state licensure and supervision rules with the state board before applying, since states set them individually.`,
  experience:
    'Listings here are grouped by the experience level each employer describes. That wording varies, so read the stated years of experience and any onboarding, preceptorship or supervision details rather than relying on the label alone. Save an alert to hear about new listings at this level.',
  employerType:
    'Listings here are grouped by the type of organization hiring. Benefits, loan repayment eligibility and credentialing timelines depend on the specific employer and site, so confirm them with the employer instead of assuming they apply to every listing of this type.',
  population:
    'Listings here are grouped by the patient population a role serves, based on how each listing describes the work. Read the full description for setting, schedule and the experience the employer expects with this population, and use the employer list on this page to see who is hiring now.',
};

/** LAND-L5 paragraph for a slug, or null off the registry. */
export function getLandingAxisGuide(slug: string): string | null {
  const axis = getCategoryAxis(slug);
  return axis ? LANDING_AXIS_GUIDE[axis] : null;
}

export interface CityAxisGuideContext {
  /** City display name, e.g. "Austin". */
  city: string;
  /** Category label as shown in headings, e.g. "Full-Time". */
  label: string;
  /** Mid-sentence form of the label, e.g. "full-time" or "LGBTQ+". */
  labelSentence: string;
}

/** CC-K7: one "How this page is built" paragraph per axis, city aware. */
const CITY_AXIS_GUIDE: Readonly<Record<CategoryAxis, (ctx: CityAxisGuideContext) => string>> = {
  jobType: ({ city, label }) =>
    `This page lists active postings in ${city} whose job type matches ${label}. Employers set the job type, so confirm schedule, benefits and contract terms in each listing before applying.`,
  setting: ({ labelSentence }) =>
    `Listings appear here when the posting names ${labelSentence} as its setting or the title makes that clear. Many roles span more than one setting, so check the full description.`,
  population: () =>
    'Listings appear here when the posting describes care for this population. Use the listing details to confirm the patient mix.',
  specialty: ({ city, labelSentence }) =>
    `Listings appear here when a posting in ${city} names ${labelSentence} work in its title or description. A role can sit under more than one specialty, so check the certification each listing asks for.`,
  aprn: ({ city, labelSentence }) =>
    `This page lists active ${labelSentence} postings in ${city}. The role has its own certification and licensure path, so read each listing's credential requirements and confirm state rules with the board.`,
  experience: ({ city, labelSentence }) =>
    `Listings appear here when an employer in ${city} describes the role at the ${labelSentence} level. That wording varies by employer, so read the stated years of experience and any onboarding details in each listing.`,
  employerType: ({ city, labelSentence }) =>
    `This page lists active postings in ${city} from ${labelSentence} employers. Benefits and credentialing timelines depend on the specific site, so confirm them with the employer.`,
};

/** CC-K7 paragraph for a slug, or null off the registry. */
export function buildCategoryCityAxisGuide(slug: string, ctx: CityAxisGuideContext): string | null {
  const axis = getCategoryAxis(slug);
  return axis ? CITY_AXIS_GUIDE[axis](ctx) : null;
}
