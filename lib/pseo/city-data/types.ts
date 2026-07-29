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
  /** Whether this area has a Health Professional Shortage Area designation */
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
  /** Estimated psychiatrist-to-population ratio category */
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
