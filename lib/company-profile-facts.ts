/**
 * lib/company-profile-facts.ts
 *
 * Pure tallies behind every data-backed block of `/companies/[slug]`
 * (PLAN.md C.4 item 7, thin-spec-4 3E: CO-C1 to CO-C6 plus the CO-B9
 * similar-employer fix). The profile already loads its own active rows
 * through `activeIndexableJobWhere()` for the job list, so this module
 * takes those rows and derives everything from them: no second query, and
 * no way for a sentence to disagree with the listings printed beneath it.
 *
 * Every selector is the one `lib/pseo/listing-facts.ts` uses for the other
 * page types (`selectStates`, `selectCities`, `selectWorkModeMix`,
 * `selectFieldMix`, `selectRecency`, `selectCategoryTop`), so a company
 * profile counts states, cities, work modes and taxonomy tags by exactly
 * the same rules a state hub or a city page does. The row shape below is a
 * structural superset of `ListingFactRow` for the same reason.
 *
 * Rules this module exists to enforce:
 *   - CO-B9: the dominant category comes from the specialty and APRN axes
 *     first and the setting axis second. It is never taken from `jobType`
 *     or `experience`, where "Full Time" wins on almost every profile and
 *     makes the same large employers "similar" to everyone.
 *   - a city is linked only when its own page would resolve the slug
 *     (`cityLinkResolves`) and the company alone already has
 *     `COMPANY_CITY_LINK_MIN_JOBS` rows there, which is a lower bound on
 *     the city page's own count, so a linked city can never 404 on the
 *     render gate.
 *   - a value that is zero is absent from the result rather than present
 *     as a zero, so the copy layer omits the clause instead of padding it.
 */
import { MIN_JOBS_FOR_LINK_LIST_ROW } from '@/lib/pseo/render-gate';
import {
  categoryLabelOf,
  jobTypeLabelOf,
  selectCities,
  selectFieldMix,
  selectRecency,
  selectStates,
  selectWorkModeMix,
  type FieldMix,
  type RecencyFacts,
  type StateCount,
  type WorkModeMix,
} from '@/lib/pseo/listing-facts';
import { CATEGORY_AXES } from '@/lib/pseo/taxonomy-registry';
import { CODE_TO_STATE, STATE_CODES } from '@/lib/pseo/setting-state-config';
import { buildCitySlug, cityLinkResolves } from '@/app/jobs/locations/[state]/directory';

/**
 * One profile holds a handful of rows, so every distribution floor here is
 * 1. The share and sample floors that protect a published PERCENTAGE do
 * not apply: these blocks print counts of the company's own listings, all
 * of which are visible on the same page.
 */
const COMPANY_MIX_MIN = 1;

/** Hiring states carried into the CO-C3 practice-rules block. */
export const COMPANY_TOP_STATES_LIMIT = 5;

/** Cities named in the CO-C5 block. */
export const COMPANY_CITY_LIMIT = 8;

/** A city is a link only at this many of the company's own rows (CO-C5). */
export const COMPANY_CITY_LINK_MIN_JOBS = MIN_JOBS_FOR_LINK_LIST_ROW;

/** Specialty labels named in the CO-C1 footprint sentence. */
export const COMPANY_TOP_SPECIALTY_LIMIT = 3;

/**
 * The projection the tallies read. A structural superset of
 * `ListingFactRow`: `normalizedMaxSalary` is added because the profile's
 * own pay block aggregates a range, not just a minimum.
 */
export interface CompanyProfileRow {
  city: string | null;
  state: string | null;
  stateCode: string | null;
  isRemote: boolean;
  isHybrid: boolean;
  jobType: string | null;
  categoryTags: string[];
  originalPostedAt: Date | null;
  createdAt: Date;
  newGradFriendly: boolean;
  normalizedMinSalary: number | null;
  normalizedMaxSalary: number | null;
  salaryIsEstimated: boolean;
}

/** A city the company posts in, with the slug only when the link resolves. */
export interface CompanyCityFact {
  name: string;
  stateCode: string | null;
  count: number;
  /** `/jobs/city/{slug}` target, or null when the city must stay unlinked. */
  slug: string | null;
}

export interface CompanyProfileFacts {
  /** Active rows the profile renders (the count every block agrees on). */
  total: number;
  /** Full state names, most postings first. */
  states: StateCount[];
  /** The hiring states CO-C3 explains the practice rules of. */
  topStates: StateCount[];
  cities: CompanyCityFact[];
  /** Specialty and APRN labels only, for the CO-C1 sentence. */
  topSpecialties: string[];
  workMode: WorkModeMix;
  jobTypes: FieldMix | null;
  recency: RecencyFacts | null;
  newGradFriendly: number;
  /** Rows with an employer-stated (not estimated) pay range. */
  disclosedPay: number;
  /** True when every row is remote and none carries a state (CO-meta). */
  allRemote: boolean;
  /**
   * CO-B9: the tag the similar-employer match runs on. Specialty or APRN
   * first, setting second, and never an employment-type or experience tag.
   */
  dominantCategory: string | null;
}

const SPECIALTY_TAGS: ReadonlySet<string> = new Set<string>([
  ...CATEGORY_AXES.specialty,
  ...CATEGORY_AXES.aprn,
]);

const SETTING_TAGS: ReadonlySet<string> = new Set<string>(CATEGORY_AXES.setting);

/**
 * A row's full state name ("Texas"), from either the full-name `state`
 * column or the two-letter `stateCode`.
 *
 * This resolution is why the module owns it rather than leaving it to
 * `selectStates`, which reads `state` alone: a company whose rows carry
 * only `stateCode` would otherwise tally zero states, and the CO-C1
 * sentence would say "in remote roles with no listed state" directly above
 * a chip row naming the states. Both surfaces read this one function.
 */
export function resolveRowStateName(
  row: Pick<CompanyProfileRow, 'state' | 'stateCode'>,
): string | null {
  if (row.state && STATE_CODES[row.state]) return row.state;
  const code = (row.stateCode ?? row.state ?? '').toUpperCase();
  return CODE_TO_STATE[code] ?? null;
}

/** Distinct tags on a row: a repeated tag must not count the posting twice. */
function distinctTags(row: Pick<CompanyProfileRow, 'categoryTags'>): string[] {
  return [...new Set(row.categoryTags ?? [])];
}

/** Ranked tags of one axis: volume first, then slug for a stable ISR order. */
function rankTagsIn(
  rows: ReadonlyArray<Pick<CompanyProfileRow, 'categoryTags'>>,
  axis: ReadonlySet<string>,
): Array<{ slug: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const tag of distinctTags(row)) {
      if (axis.has(tag)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([slug, count]) => ({ slug, count }))
    .sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug));
}

/**
 * CO-B9. `dominantCategory` used to be the top tag across every axis, so
 * "Full Time" won on almost every profile and the same handful of large
 * employers surfaced as "similar" everywhere. Clinical intent lives on the
 * specialty and APRN axes; the setting axis (remote, inpatient, urgent
 * care) is the runner up. An employment type or an experience level is
 * never a similarity signal, so those axes are not consulted at all.
 */
export function selectDominantCategory(
  rows: ReadonlyArray<Pick<CompanyProfileRow, 'categoryTags'>>,
): string | null {
  const specialty = rankTagsIn(rows, SPECIALTY_TAGS);
  if (specialty.length > 0) return specialty[0].slug;
  const setting = rankTagsIn(rows, SETTING_TAGS);
  return setting.length > 0 ? setting[0].slug : null;
}

/** Specialty and APRN labels for the footprint sentence, most postings first. */
export function selectTopSpecialtyLabels(
  rows: ReadonlyArray<Pick<CompanyProfileRow, 'categoryTags'>>,
  limit: number = COMPANY_TOP_SPECIALTY_LIMIT,
): string[] {
  return rankTagsIn(rows, SPECIALTY_TAGS)
    .slice(0, limit)
    .map((entry) => categoryLabelOf(entry.slug));
}

/**
 * Cities the company posts in. The slug is present only when the round
 * trip through `/jobs/city/[slug]` resolves the same name back (the lossy
 * slug builder drops periods, apostrophes and internal hyphens) and the
 * company alone already clears the city page's own render floor.
 */
export function selectCompanyCities(
  rows: ReadonlyArray<Pick<CompanyProfileRow, 'city' | 'stateCode'>>,
  limit: number = COMPANY_CITY_LIMIT,
): CompanyCityFact[] {
  return selectCities(rows)
    .slice(0, limit)
    .map((city) => {
      const stateCode = city.stateCode;
      const linkable =
        stateCode !== null &&
        city.count >= COMPANY_CITY_LINK_MIN_JOBS &&
        cityLinkResolves(city.name, stateCode);
      return {
        name: city.name,
        stateCode,
        count: city.count,
        slug: linkable ? buildCitySlug(city.name, stateCode) : null,
      };
    });
}

/**
 * Rows whose pay range is employer stated rather than inferred or clamped.
 * The `salaryIsEstimated` veto is the same one the profile's pay snapshot
 * applies, so the "N of M list a pay range" count can never describe a
 * larger pool than the figures beside it.
 */
export function countDisclosedPay(
  rows: ReadonlyArray<
    Pick<CompanyProfileRow, 'normalizedMinSalary' | 'normalizedMaxSalary' | 'salaryIsEstimated'>
  >,
): number {
  return rows.filter(
    (row) =>
      !row.salaryIsEstimated &&
      (row.normalizedMinSalary ?? 0) > 0 &&
      (row.normalizedMaxSalary ?? 0) > 0,
  ).length;
}

/** Every fact the profile's blocks read, from the rows it already rendered. */
export function buildCompanyProfileFacts(
  rows: ReadonlyArray<CompanyProfileRow>,
  now: Date = new Date(),
): CompanyProfileFacts {
  const states = selectStates(rows.map((row) => ({ state: resolveRowStateName(row) })));
  const workMode = selectWorkModeMix(rows, COMPANY_MIX_MIN)
    ?? { total: 0, remote: 0, hybrid: 0, onsite: 0 };

  return {
    total: rows.length,
    states,
    topStates: states.slice(0, COMPANY_TOP_STATES_LIMIT),
    cities: selectCompanyCities(rows),
    topSpecialties: selectTopSpecialtyLabels(rows),
    workMode,
    jobTypes: selectFieldMix(rows.map((row) => jobTypeLabelOf(row.jobType)), {
      min: COMPANY_MIX_MIN,
      minLabeledShare: 0,
    }),
    recency: selectRecency(rows, now, COMPANY_MIX_MIN),
    newGradFriendly: rows.filter((row) => row.newGradFriendly).length,
    disclosedPay: countDisclosedPay(rows),
    allRemote: rows.length > 0 && rows.every((row) => row.isRemote) && states.length === 0,
    dominantCategory: selectDominantCategory(rows),
  };
}
