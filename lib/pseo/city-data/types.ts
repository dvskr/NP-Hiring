/**
 * City Data Types for pSEO Pages
 * 
 * Comprehensive type definitions for the ~3,200 US cities
 * that underpin the 50K programmatic page strategy.
 */

export interface CityData {
  /** City name, e.g., "New York" */
  name: string;
  /** Full state name, e.g., "New York" */
  state: string;
  /** State abbreviation, e.g., "NY" */
  stateCode: string;
  /** URL slug: "new-york-ny" */
  slug: string;
  /** 2020 Census population */
  population: number;
  /** Cost of living index (national avg = 100) */
  costOfLivingIndex: number;
  /**
   * Latitude. `null` when the stored value was proven to belong to a
   * same-named city in another state and was removed — see
   * scripts/repair-city-data-collisions.mjs. Never substitute a guess.
   */
  lat: number | null;
  /** Longitude. `null` under the same rule as `lat`. */
  lng: number | null;
  /**
   * Metro area name (MSA), e.g., "New York-Newark-Jersey City". `null` when
   * unknown OR when the stored value was proven to be a same-named city's
   * metro in another state and was removed. Renderers must omit the metro
   * line rather than substitute anything.
   */
  metroArea: string | null;
  /**
   * Whether this area carries the donor board's BEHAVIORAL-HEALTH-discipline
   * HRSA Health Professional Shortage Area designation.
   *
   * ⚠ NOT an all-NP or primary-care shortage signal (P2 #7). HRSA designates
   * HPSAs per discipline; this column was generated for the behavioral-health
   * niche, and the generator plus its source dataset are gone (see the header
   * of ./cities.ts), so neither the vintage nor the exact designation type can
   * be re-verified from this repo. Consequences for renderers:
   *
   *   - LABEL IT. Never surface it as a bare "shortage area" / "HPSA" claim.
   *     Every visible label, meta description, FAQ answer, OG param and schema
   *     string must name the DISCIPLINE (see lib/pseo/category-city-template
   *     .tsx and lib/pseo/setting-state-template.tsx for the corrected copy).
   *   - GATE IT. Labelling alone is NOT sufficient, and this is the rule that
   *     is easy to miss: 2,650 of the 4,135 cities carry the flag, so a
   *     correctly-labelled but ungated surface still publishes a
   *     behavioral-health designation across all 42 categories — a
   *     behavioral-health HPSA in the SERP snippet of
   *     /jobs/dermatology/city/houston-tx is the donor niche on an all-NP URL,
   *     which is exactly what tests/regressions/niche-copy-debt.test.ts
   *     exists to suppress. Route every such surface through
   *     `shortageIsOnTopic` (affirmative claims) or `categoryOwnsShortageData`
   *     (surfaces that report both polarities), both exported from
   *     lib/pseo/category-city-template.tsx. Reading the raw boolean is only
   *     legitimate for internal signals that publish nothing — the page
   *     quality and market-demand scores.
   *   - NHSC Loan Repayment eligibility follows the designation's discipline
   *     at NHSC-approved sites — it does not generalise to every NP specialty.
   *   - The national-level shortage stat lives in lib/stats-sources.ts
   *     (`hrsaShortagePopulation`, re-sourced to PRIMARY CARE). This per-city
   *     column has NOT been re-sourced and the two must not be conflated.
   *
   * TO FIX PROPERLY: add a separate `primaryCareShortage` column sourced from
   * HRSA's "Designated Health Professional Shortage Areas — Primary Care" file
   * (data.hrsa.gov), keyed by (city, state) rather than city name alone, and
   * migrate the all-NP surfaces onto it. Do not repurpose this field.
   */
  mentalHealthShortage: boolean;
  /**
   * Major healthcare systems / behavioral health employers in the area.
   * Empty for most cities, and emptied wherever the stored list was proven to
   * be a same-named city's employers in another state. Surfaces must omit the
   * block when empty — never pad it. Live employer names come from the job
   * table instead: lib/pseo/city-employers.ts.
   */
  healthcareSystems: string[];
  /**
   * Nearby city slugs for cross-linking. Emptied where the neighbour list was
   * derived from coordinates that turned out to belong to another state.
   */
  nearbyCities: string[];
  /**
   * Estimated psychiatrist-to-population ratio category — another donor
   * behavioral-health column with no surviving generator or source (same
   * caveat as `mentalHealthShortage`). It currently feeds only the composite
   * market-demand index in category-city-template.tsx; do not render it as a
   * standalone, sourced statistic about NP supply.
   */
  providerRatio: 'critical' | 'low' | 'moderate' | 'adequate';
  /** Median household income */
  medianIncome: number;
  /** Population rank within state (1 = largest) */
  stateRank: number;
}

export interface MetroArea {
  /** Metro area name */
  name: string;
  /** URL slug */
  slug: string;
  /** Constituent city slugs */
  cities: string[];
  /** Total metro population */
  population: number;
  /** Primary state(s) */
  states: string[];
}
