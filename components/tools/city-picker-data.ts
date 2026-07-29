/**
 * Builds the city option list for the cost-of-living comparator (P2 #5).
 *
 * SERVER ONLY — it imports the 4,135-city dataset
 * (lib/pseo/city-data/cities.ts, read-only), which must never reach the
 * browser. The server page calls this once and passes the trimmed result to
 * the client comparator.
 *
 * Why the list is trimmed: shipping every city as a <select> option would put
 * a few hundred kilobytes of markup on a landing page for no benefit. The
 * dropdown carries the largest cities per state plus every city that has
 * enough salaried postings of its own to beat the state average, which is
 * where the comparison is actually informative.
 */
import { CITIES } from '@/lib/pseo/city-data/cities';
import { buildCitySlug, cityLinkResolves } from '@/app/jobs/locations/[state]/directory';
import { CITY_SAMPLE_THRESHOLD, type NominalBasis } from './col-model';

export interface SalaryAggregate {
  /** Average of posting midpoints, annual USD. */
  nominal: number;
  /** Number of salaried postings behind the average. */
  sample: number;
}

export interface CityOption {
  slug: string;
  name: string;
  state: string;
  stateCode: string;
  /** Cost-of-living index from the board's city dataset (100 = national average). */
  col: number;
  nominal: number;
  basis: NominalBasis;
  sample: number;
  /**
   * `/jobs/city/<slug>` when that page is known to render, else null.
   * See `cityJobsHref` — an ungated link here is an internal link to a 404.
   */
  jobsHref: string | null;
}

/**
 * The city page's URL, or null when linking it would land on a 404.
 *
 * app/jobs/city/[slug]/page.tsx hard-404s in two ways this picker can reach:
 *
 *  1. It calls notFound() below MIN_JOBS (3) live postings.
 *  2. It does not look the slug up — it rebuilds a city NAME by splitting on
 *     hyphens and title-casing, then matches that against the stored `city`
 *     column. 101 of the 4,135 dataset names ("St. Louis", "Winston-Salem",
 *     "Lee's Summit") round-trip to a different string and match zero rows.
 *     `cityLinkResolves` is the repo's existing guard for exactly this, reused
 *     here rather than reimplemented so the rule cannot drift.
 *
 * The picker admits the 15 largest cities per state on state-average fallback
 * alone, so cities with 0-2 postings are certainly present. `basis === 'city'`
 * is the honest proxy for (1): it means the city cleared
 * CITY_SAMPLE_THRESHOLD postings that disclose pay, and those are a subset of
 * the published postings the city page counts, so the count gate is already met.
 * A state-basis city has no verified inventory of its own and gets no jobs link.
 *
 * The href is built with `buildCitySlug`, NOT with the dataset's own `slug`
 * field. Those disagree for 120 of the 4,135 records — the dataset stores
 * "Oklahoma City" as `oklahoma-ok` and "Salt Lake City" as `salt-lake-ut` —
 * and the city route parses whatever is in the URL. Linking the dataset slug
 * would send "Oklahoma City" to a page that searches for "Oklahoma" and 404s,
 * which the round-trip check cannot catch because it validates a different
 * string. The dataset `slug` stays the picker's identity key; only this href
 * is route-derived.
 */
export function cityJobsHref(
  city: { name: string; stateCode: string },
  basis: NominalBasis,
): string | null {
  if (basis !== 'city') return null;
  if (!cityLinkResolves(city.name, city.stateCode)) return null;
  const routeSlug = buildCitySlug(city.name, city.stateCode);
  return routeSlug ? `/jobs/city/${routeSlug}` : null;
}

/**
 * `"{lowercased city}|{lowercased full state name}"` → city slug.
 *
 * Built once per process. The dataset's own `getCityByNameState` falls back to
 * a linear scan when given a full state name, and the salary aggregation below
 * resolves hundreds of (city, state) pairs — this index keeps that O(1).
 * Resolving by name AND state is mandatory: 411 city names are shared across
 * states in this dataset (see lib/pseo/city-data/cities.ts).
 */
const SLUG_BY_NAME_STATE: ReadonlyMap<string, string> = new Map(
  CITIES.map((city) => [`${city.name.toLowerCase()}|${city.state.toLowerCase()}`, city.slug]),
);

/** Resolve a free-text (city, state) pair to a dataset slug, or null. */
export function resolveCitySlug(city: string | null, state: string | null): string | null {
  if (!city || !state) return null;
  return SLUG_BY_NAME_STATE.get(`${city.trim().toLowerCase()}|${state.trim().toLowerCase()}`) ?? null;
}

export interface BuildCityOptionsInput {
  /** How many of each state's largest cities to always include. */
  perState: number;
  /** City-level salary aggregates keyed by city slug. */
  cityNominals: ReadonlyMap<string, SalaryAggregate>;
  /** State-level salary aggregates keyed by full state name. */
  stateNominals: ReadonlyMap<string, SalaryAggregate>;
}

/**
 * Returns the comparator's option list, sorted by state then city name.
 * Cities with no city-level and no state-level salary data are dropped —
 * an option that can only render "no data" is not worth the bytes.
 */
export function buildCityOptions(input: BuildCityOptionsInput): CityOption[] {
  const { perState, cityNominals, stateNominals } = input;

  const byState = new Map<string, typeof CITIES>();
  for (const city of CITIES) {
    const bucket = byState.get(city.state);
    if (bucket) bucket.push(city);
    else byState.set(city.state, [city]);
  }

  const selected = new Map<string, (typeof CITIES)[number]>();
  for (const cities of byState.values()) {
    const ranked = [...cities].sort((a, b) => b.population - a.population);
    for (const city of ranked.slice(0, perState)) selected.set(city.slug, city);
  }
  // Always keep a city that carries its own salary sample, however small it is.
  for (const city of CITIES) {
    if (cityNominals.has(city.slug)) selected.set(city.slug, city);
  }

  const options: CityOption[] = [];
  for (const city of selected.values()) {
    if (city.costOfLivingIndex <= 0) continue;

    const own = cityNominals.get(city.slug);
    const fallback = stateNominals.get(city.state);

    let nominal = 0;
    let basis: NominalBasis = 'state';
    let sample = 0;

    if (own && own.sample >= CITY_SAMPLE_THRESHOLD && own.nominal > 0) {
      nominal = own.nominal;
      basis = 'city';
      sample = own.sample;
    } else if (fallback && fallback.nominal > 0) {
      nominal = fallback.nominal;
      basis = 'state';
      sample = fallback.sample;
    } else {
      continue;
    }

    options.push({
      slug: city.slug,
      name: city.name,
      state: city.state,
      stateCode: city.stateCode,
      col: city.costOfLivingIndex,
      nominal,
      basis,
      sample,
      jobsHref: cityJobsHref(city, basis),
    });
  }

  return options.sort((a, b) =>
    a.state === b.state ? a.name.localeCompare(b.name) : a.state.localeCompare(b.state),
  );
}

/**
 * Picks two sensible default selections: the highest and lowest
 * cost-of-living options among the largest cities present, so the tool
 * renders a meaningful comparison before the visitor touches anything.
 * Deterministic (no clock, no randomness) so server and client agree.
 */
export function pickDefaultPair(options: readonly CityOption[]): [string, string] | null {
  if (options.length < 2) return null;
  const sorted = [...options].sort((a, b) => a.col - b.col);
  const cheapest = sorted[0];
  const priciest = sorted[sorted.length - 1];
  if (cheapest.slug === priciest.slug) return null;
  return [priciest.slug, cheapest.slug];
}
