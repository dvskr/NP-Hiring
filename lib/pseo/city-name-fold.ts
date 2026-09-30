/**
 * lib/pseo/city-name-fold.ts
 *
 * City names as the state city directories tally them (CQ-08). Job rows carry
 * the city string their source sent, and three kinds of spelling reached the
 * live directories as separate "cities":
 *   - parser leftovers with trailing punctuation ("Boston-" beside "Boston",
 *     "Belmont-", "Pembroke-", "South Deerfield-" in Massachusetts);
 *   - a district named with its city ("Uptown Dallas", "Southwest Fort
 *     Worth" in Texas);
 *   - a city neighborhood on its own ("Irving Park", "Lincoln Park" in
 *     Illinois, both Chicago).
 * foldCityName maps each to the city it belongs to, so a directory lists
 * Chicago once with its neighborhoods' roles instead of listing the
 * neighborhoods as towns. The fold is deliberately conservative: a name that
 * is itself a place in the city dataset for that state is never folded
 * ("North Richland Hills" stays, "West Palm Beach" stays), and the
 * neighborhood list holds only Chicago neighborhoods whose names no Illinois
 * municipality shares. The source rows are not rewritten here: ingest files
 * new rows under the parent city through the same table
 * (neighborhoodParentOf in lib/pseo/neighborhood-parent.ts, read by
 * lib/location-fallback.ts storedLocality).
 */
import { getCityByNameState } from './city-data/cities';
import { EDGE_PUNCTUATION, neighborhoodParentOf } from './neighborhood-parent';

/**
 * Re-exported so callers that already read the table through this module keep
 * working. The table itself lives in lib/pseo/neighborhood-parent.ts, a leaf
 * module the ingest path can import without loading the full city dataset.
 */
export { neighborhoodParentOf } from './neighborhood-parent';

/** District words that prefix a city name ("Uptown Dallas"). */
const DISTRICT_PREFIX = /^(downtown|uptown|midtown|southwest|southeast|northwest|northeast)\s+(.+)$/i;

function isDatasetPlace(name: string, stateCode: string): boolean {
  return getCityByNameState(name, stateCode) !== undefined;
}

/**
 * The city a stored city string belongs to, within one state. Returns the
 * input (trimmed) when no rule applies.
 */
export function foldCityName(city: string, stateCode: string): string {
  const cleaned = city.replace(EDGE_PUNCTUATION, '');
  if (!cleaned) return city.trim();
  const code = stateCode.trim().toUpperCase();
  const neighborhoodParent = neighborhoodParentOf(cleaned, code);
  if (neighborhoodParent) return neighborhoodParent;
  const district = cleaned.match(DISTRICT_PREFIX);
  if (district && !isDatasetPlace(cleaned, code)) {
    const parent = getCityByNameState(district[2], code);
    if (parent) return parent.name;
  }
  return cleaned;
}
