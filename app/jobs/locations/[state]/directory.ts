/**
 * Pure helpers for the per-state city directory (P2 #12).
 *
 * The repo carries 4,135 city records (lib/pseo/city-data/cities.ts) but the
 * only city links anywhere on the site were the top 12 on /jobs/locations, so
 * every other city page was reachable from the sitemap and nothing else. These
 * helpers decide, from live inventory alone, which cities a state directory may
 * LINK and which it may only MENTION.
 *
 * Split into a non-route module so the gating arithmetic is unit-testable
 * without a database or a server-component render.
 */
import type { Prisma } from '@prisma/client';
import { activeIndexableJobWhere } from '@/lib/active-job-filter';
import { getMetroCity } from '@/lib/metro-data';

/**
 * A city page calls notFound() below 3 jobs (app/jobs/city/[slug]/page.tsx,
 * lib/pseo/related-cities.ts, the sitemap gate, and MIN_JOBS_FOR_CATEGORY_CITY
 * all use the same number — see memory seo_threshold_decision.md). Linking a
 * city under this threshold would be an internal link to a known 404.
 */
export const MIN_CITY_JOBS_FOR_LINK = 3;

/** A directory with nothing to link is not a directory. */
export const MIN_LINKABLE_CITIES = 1;

/**
 * …and a directory with one linkable city and nothing else to say is a thin
 * doorway. Requiring three cities carrying inventory means the page always has
 * a real local picture to describe.
 */
export const MIN_TRACKED_CITIES = 3;

export interface CityJobRow {
  /** City name exactly as stored on the job rows. */
  city: string;
  /** Live count of active, indexable jobs in that city. */
  count: number;
}

export interface StateCityDirectory {
  /** Cities at or above the link threshold — safe to link, ranked by volume. */
  linkable: CityJobRow[];
  /**
   * Cities carrying 1–2 openings. Rendered as plain text with their real count,
   * never as links: their city pages 404 by design.
   */
  emerging: CityJobRow[];
  /** Distinct cities with at least one active job. */
  trackedCities: number;
  /** Sum of active jobs across every tracked city. */
  cityJobs: number;
}

/** Volume first, then alphabetical so equal-count cities have a stable order. */
function byVolumeThenName(a: CityJobRow, b: CityJobRow): number {
  return b.count - a.count || a.city.localeCompare(b.city);
}

export interface StateCityDirectoryOptions {
  /** Override the link threshold (tests only — production uses the constant). */
  minLinkJobs?: number;
  /**
   * Extra per-city veto applied on top of the volume threshold. A city that
   * clears the count but fails this predicate is demoted to `emerging`
   * (named, never linked) rather than dropped — see `cityLinkResolves`.
   */
  canLink?: (row: CityJobRow) => boolean;
}

export function buildStateCityDirectory(
  rows: readonly CityJobRow[],
  options: StateCityDirectoryOptions = {},
): StateCityDirectory {
  const minLinkJobs = options.minLinkJobs ?? MIN_CITY_JOBS_FOR_LINK;
  const canLink = options.canLink ?? (() => true);
  const usable = rows.filter((row) => row.city.trim().length > 0 && row.count > 0);
  const isLinkable = (row: CityJobRow) => row.count >= minLinkJobs && canLink(row);
  return {
    linkable: usable.filter(isLinkable).sort(byVolumeThenName),
    emerging: usable.filter((row) => !isLinkable(row)).sort(byVolumeThenName),
    trackedCities: usable.length,
    cityJobs: usable.reduce((sum, row) => sum + row.count, 0),
  };
}

/**
 * Whether a state earns its own city directory URL. States that fail this
 * render a 404 rather than a near-empty page, and the hub does not link them —
 * the two decisions read the same function so they cannot drift.
 */
export function shouldRenderStateCityDirectory(directory: StateCityDirectory): boolean {
  return (
    directory.linkable.length >= MIN_LINKABLE_CITIES &&
    directory.trackedCities >= MIN_TRACKED_CITIES
  );
}

/**
 * City slug in the exact form app/jobs/city/[slug]/page.tsx builds and parses
 * (`buildCitySlug` there). Kept identical so a linked city always resolves —
 * a mismatch here is a soft 404.
 */
export function buildCitySlug(cityName: string, stateCode: string): string {
  const sanitized = cityName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!sanitized) return '';
  return `${sanitized}-${stateCode.toLowerCase()}`;
}

/**
 * Mirror of `parseCitySlug` in app/jobs/city/[slug]/page.tsx — the half of the
 * round-trip that actually gates resolution. That route does NOT look the slug
 * up; it rebuilds a city NAME by splitting on hyphens and title-casing each
 * segment, then matches that string against the stored `city` column
 * (`equals`, insensitive). Returns null for a slug the route's regex rejects.
 */
export function parseCitySlugToName(slug: string): string | null {
  const match = slug.toLowerCase().trim().match(/^(.+)-([a-z]{2})$/);
  if (!match) return null;
  return match[1]
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Whether linking this city actually lands on a page that finds its jobs.
 *
 * `buildCitySlug` is lossy: every character outside [a-z0-9] collapses to a
 * hyphen, and the city route's parser turns hyphens back into spaces. So any
 * stored name carrying a period, apostrophe, hyphen or parenthesis — "St. Louis",
 * "Winston-Salem", "Lee's Summit", "Coeur d'Alene", "Sault Ste. Marie" —
 * round-trips to a DIFFERENT string, matches zero rows in getCityStats, and
 * hard-404s on the MIN_JOBS gate. 101 of the 4,135 names in
 * lib/pseo/city-data/cities.ts are affected.
 *
 * Curated metro slugs are exempt: /jobs/metro/<slug> is served from
 * lib/metro-data.ts by exact slug match and never re-parses a name.
 */
export function cityLinkResolves(cityName: string, stateCode: string): boolean {
  const slug = buildCitySlug(cityName, stateCode);
  if (!slug) return false;
  if (getMetroCity(slug)) return true;
  const parsedBack = parseCitySlugToName(slug);
  return parsedBack !== null && parsedBack.toLowerCase() === cityName.trim().toLowerCase();
}

/**
 * Active, indexable jobs located in one state.
 *
 * Built with a nested AND rather than `{ ...activeIndexableJobWhere(), OR: [...] }`:
 * the helper already owns a top-level `OR` (its expiry pair, pinned by
 * tests/seo/sitemap-active-jobs.test.ts), so spreading it beside a sibling `OR`
 * key silently DELETES the expiry gate and counts expired postings as live.
 */
export function activeJobsInStateWhere(
  stateName: string,
  stateCode: string,
  now?: Date,
): Prisma.JobWhereInput {
  return {
    AND: [
      activeIndexableJobWhere(now),
      { OR: [{ state: stateName }, { stateCode }] },
    ],
  };
}
