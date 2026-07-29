/**
 * lib/pseo/city-employers.ts — P1 #13
 *
 * 87.6% of the cities in lib/pseo/city-data/cities.ts carry an EMPTY
 * `healthcareSystems` array, and the repair in scripts/repair-city-data-
 * collisions.mjs emptied more of them (they held a same-named city's hospital
 * systems from another state). The "Healthcare" block on city pages therefore
 * rendered a bare negative — "No major healthcare systems listed for this
 * area." — on the large majority of pages.
 *
 * The job table already knows who is actually hiring in each city, so this
 * module answers the question from live data instead of a static list:
 * group the city's ACTIVE postings by employer and report the real names with
 * their real open-role counts.
 *
 * Rules this module exists to enforce:
 *   • Only names that appear on live postings. Nothing is invented, and no
 *     national brand is assumed to have a local presence.
 *   • Below MIN_CITY_EMPLOYERS distinct employers the module returns [] so the
 *     surface omits the block. A one-employer list reads like a directory and
 *     a padded list would be a lie — omit, never pad.
 *   • "Active" is the repo's single definition (lib/active-job-filter.ts):
 *     published, unexpired, and not a repeatedly-dead apply link. A page that
 *     says "hiring now" must not be counting expired postings.
 *
 * Query shape mirrors the state-level version in setting-state-template.tsx.
 */
import { cache } from 'react';
import { prisma } from '@/lib/prisma';
import { activeIndexableJobWhere } from '@/lib/active-job-filter';
import { findCanonicalName, normalizeCompanyName } from '@/lib/company-normalizer';

/**
 * Fewer distinct employers than this and the block is omitted entirely.
 * One employer is a directory entry, not a market signal.
 */
export const MIN_CITY_EMPLOYERS = 2;

/** How many employers a surface shows at most. */
export const CITY_EMPLOYER_LIMIT = 6;

/**
 * groupBy is taken before canonical merging collapses aliases ("LifeStance"
 * and "LifeStance Health" are one employer), so we over-fetch to keep the
 * post-merge list full.
 */
const GROUP_BY_OVERSHOOT = 4;

export interface CityEmployer {
  /** Display name, exactly as it appears on the postings (or its canonical form). */
  name: string;
  /** Number of active postings in this city under that employer. */
  openRoles: number;
}

/** Shape of a `prisma.job.groupBy({ by: ['employer'] })` row. */
export interface EmployerGroupRow {
  employer: string | null;
  _count: { employer: number };
}

/**
 * The identity two spellings must agree on to be treated as one employer.
 *
 * The canonical name comes FIRST, and that ordering is the whole point:
 * KNOWN_COMPANIES lists aliases that deliberately do NOT normalize alike.
 * Keying on normalizeCompanyName() alone splits them — verified against the
 * live normalizer, which maps "Talkspace" → "talkspace" but "Talkspace
 * Psychiatry" → "talkspace-psychiatry", "VA Health" → "va" but "VA Hospital"
 * → "va-hospital", "BlueSky Telepsych" → "blue-sky-telepsych" but
 * "blueskytelepsych" → itself, and "Lyra Health" → "lyra" but "lyrahealth" →
 * itself. Each of those pairs resolves to ONE canonical company, so under a
 * normalize-only key the same display name would render twice, with the
 * postings split across the two rows and a duplicate React key in the list.
 *
 * The normalized form remains the fallback for the (far more common) employers
 * KNOWN_COMPANIES has never heard of, and the raw lowercase form the last
 * resort for names the normalizer reduces to nothing.
 */
function employerIdentity(raw: string, canonical: string | null): string {
  if (canonical) return `canonical:${canonical}`;
  return normalizeCompanyName(raw) || raw.toLowerCase();
}

/**
 * Merge raw groupBy rows into display-ready employers.
 *
 * Pure — no DB — so the gating rules are unit-testable without a database.
 * Rows for the same real employer under different spellings are merged via
 * lib/company-normalizer.ts; the display name is that employer's canonical
 * name when we know one, otherwise the longest spelling seen (the normalizer's
 * documented convention, since the longest form carries the most context).
 */
export function selectCityEmployers(
  rows: readonly EmployerGroupRow[],
  limit: number = CITY_EMPLOYER_LIMIT,
  min: number = MIN_CITY_EMPLOYERS,
): CityEmployer[] {
  const merged = new Map<string, { name: string; openRoles: number }>();

  for (const row of rows) {
    const raw = row.employer?.trim();
    if (!raw) continue;
    const count = row._count?.employer ?? 0;
    if (count <= 0) continue;

    const canonical = findCanonicalName(raw);
    const key = employerIdentity(raw, canonical);
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, { name: canonical ?? raw, openRoles: count });
      continue;
    }
    existing.openRoles += count;
    // A canonical bucket already holds that company's canonical name — every
    // row in it resolves to the same one. Everywhere else the longest spelling
    // wins, since it carries the most context.
    if (!canonical && raw.length > existing.name.length) existing.name = raw;
  }

  // Every bucket is one employer and every employer appears in one bucket, so
  // `name` is unique across the result — which is what lets the city template
  // use it as the React key of the rendered <li>.

  // Below the floor the caller must render nothing at all.
  if (merged.size < min) return [];

  return [...merged.values()]
    .sort((a, b) => b.openRoles - a.openRoles || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/**
 * Employers with active postings in a city, most roles first.
 *
 * Returns [] — meaning "render nothing" — when the city has fewer than
 * MIN_CITY_EMPLOYERS distinct employers hiring, or when the query fails. The
 * block is decorative context; it must never take a page down with it.
 *
 * Arguments are primitives so React's `cache()` actually dedupes repeat calls
 * within a single render.
 */
export const getTopCityEmployers = cache(async function getTopCityEmployers(
  cityName: string,
  stateName: string,
  limit: number = CITY_EMPLOYER_LIMIT,
): Promise<CityEmployer[]> {
  if (!cityName?.trim() || !stateName?.trim()) return [];

  try {
    const rows = await prisma.job.groupBy({
      by: ['employer'],
      where: {
        ...activeIndexableJobWhere(),
        city: { equals: cityName, mode: 'insensitive' },
        state: { equals: stateName, mode: 'insensitive' },
      },
      _count: { employer: true },
      orderBy: { _count: { employer: 'desc' } },
      take: limit * GROUP_BY_OVERSHOOT,
    });
    return selectCityEmployers(rows as unknown as EmployerGroupRow[], limit);
  } catch (error) {
    console.error(`[city-employers] groupBy failed for ${cityName}, ${stateName}:`, error);
    return [];
  }
});
