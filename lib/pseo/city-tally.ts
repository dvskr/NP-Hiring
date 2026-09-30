/**
 * lib/pseo/city-tally.ts: whether a stored Job.city value may be counted,
 * named or linked as a town by a pSEO listing (indexing audit CQ-02).
 *
 * The city column held street numbers ("1730"), addresses, facility and
 * site names ("MAIN CAMPUS", "Multiple Locations") and work modes
 * ("Remote"). Every listing tally read the column raw: the "led by" and
 * "Top city" lines (lib/pseo/listing-facts.ts selectCities), the state city
 * directories and the locations hub (app/jobs/locations/[state]/
 * directory.ts), the "Cities Hiring" figure, the nearby city links on a city
 * page and the city URLs app/sitemap.ts lists (cityLinkResolves). So a
 * value such as "Remote, TX" could be counted as a city, named, linked and
 * submitted as /jobs/city/remote-tx.
 *
 * The rule is the one ingest already stores by (lib/location-fallback.ts
 * storedLocality), without its re-spelling:
 *   1. a value that reads as a town name (plausibleLocality, lib/locality.ts)
 *      counts, trimmed of trailing punctuation;
 *   2. otherwise a value the city dataset knows in that state counts as
 *      written. plausibleLocality drops a real town whose name carries a
 *      facility word ("College Station, TX", "State College, PA", "Brooklyn
 *      Center, MN", "Rockville Centre, NY"), and those are real markets;
 *   3. anything else (a street number, a facility, a work mode, a specialty,
 *      a sentence fragment) is left out of every tally, list and link.
 *
 * Every town in lib/pseo/city-data passes, so a dataset-driven link is never
 * vetoed (tests/unit/city-tally.test.ts checks all 4,135). Pure.
 */
import { isKnownTown } from '@/lib/location-fallback';
import { plausibleLocality } from '@/lib/locality';

/** A two-letter US jurisdiction code, the form isKnownTown reads. */
const STATE_CODE_RE = /^[A-Z]{2}$/;

/**
 * The name a tally counts a stored city under, or null when the value is not
 * a town (see the rules above). `stateCode` is the row's jurisdiction code;
 * without it only the town-name shape rule applies.
 */
export function tallyCityName(city: string | null | undefined, stateCode?: string | null): string | null {
  const plausible = plausibleLocality(city);
  if (plausible) return plausible;
  const code = stateCode?.trim().toUpperCase() ?? '';
  const cleaned = city?.trim().replace(/[\s,;:.\-]+$/, '').trim() ?? '';
  if (!cleaned || !STATE_CODE_RE.test(code)) return null;
  // The dataset's own spellings include census forms the shape rule rejects
  // ("Kearns metro township", "Woodlawn CDP (Baltimore County)"); a value the
  // dataset files under that state is a town whatever its shape.
  return isKnownTown(cleaned, code) ? cleaned : null;
}

/** True when a stored city value may be counted, named or linked as a town. */
export function isTallyCity(city: string | null | undefined, stateCode?: string | null): boolean {
  return tallyCityName(city, stateCode) !== null;
}
