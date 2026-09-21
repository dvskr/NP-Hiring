/**
 * Helpers for the per-state city directory (P2 #12, thin-content DIR-L1 to L8).
 *
 * The repo carries 4,135 city records (lib/pseo/city-data/cities.ts) but the
 * only city links anywhere on the site were the top 12 on /jobs/locations, so
 * every other city page was reachable from the sitemap and nothing else. These
 * helpers decide, from live inventory alone, which cities a state directory may
 * LINK and which it may only MENTION.
 *
 * The gating arithmetic (buildStateCityDirectory, shouldRenderStateCityDirectory,
 * selectCityDetails, summarizeStateDirectories) is pure so it is unit-testable
 * without a database or a server-component render. The one loader at the
 * bottom (getStatesWithCityDirectory) is shared by the directory page (DIR-L6),
 * the locations hub and the state hub so every "does this state have a
 * directory" answer reads one predicate. Every importer of this module is a
 * server module (the loader pulls in the Prisma client).
 */
import { cache } from 'react';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { canonicalBucketWhere } from '@/lib/canonical-counts';
import { getMetroCity } from '@/lib/metro-data';
import { selectCityEmployers, type EmployerGroupRow } from '@/lib/pseo/city-employers';
import { selectWorkModeMix, type WorkModeMix } from '@/lib/pseo/listing-facts';
import { STATE_CODES, stateToSlug } from '@/lib/pseo/setting-state-config';

/**
 * A city page calls notFound() below 3 jobs (app/jobs/city/[slug]/page.tsx,
 * lib/pseo/related-cities.ts, the sitemap gate, and MIN_JOBS_FOR_CATEGORY_CITY
 * all use the same number, see memory seo_threshold_decision.md). Linking a
 * city under this threshold would be an internal link to a known 404.
 */
export const MIN_CITY_JOBS_FOR_LINK = 3;

/** A directory with nothing to link is not a directory. */
export const MIN_LINKABLE_CITIES = 1;

/**
 * A directory with one linkable city and nothing else to say is a thin
 * doorway. Requiring three cities carrying inventory means the page always has
 * a real local picture to describe.
 */
export const MIN_TRACKED_CITIES = 3;

/** Employers named on one city card (DIR-L2). */
export const CITY_CARD_EMPLOYER_LIMIT = 3;

export interface CityJobRow {
  /** City name exactly as stored on the job rows. */
  city: string;
  /** Live count of canonical active jobs in that city. */
  count: number;
}

export interface StateCityDirectory {
  /** Cities at or above the link threshold, safe to link, ranked by volume. */
  linkable: CityJobRow[];
  /**
   * Cities carrying 1 to 2 openings. Rendered as plain text with their real
   * count, never as links: their city pages 404 by design.
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
  /** Override the link threshold (tests only; production uses the constant). */
  minLinkJobs?: number;
  /**
   * Extra per-city veto applied on top of the volume threshold. A city that
   * clears the count but fails this predicate is demoted to `emerging`
   * (named, never linked) rather than dropped, see `cityLinkResolves`.
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
 * render a 404 rather than a near-empty page, and the hub does not link them:
 * the two decisions read the same function so they cannot drift. The INDEX
 * decision is separate (shouldIndexStateCityDirectory in lib/pseo/render-gate.ts).
 */
export function shouldRenderStateCityDirectory(directory: StateCityDirectory): boolean {
  return (
    directory.linkable.length >= MIN_LINKABLE_CITIES &&
    directory.trackedCities >= MIN_TRACKED_CITIES
  );
}

/**
 * City slug in the exact form app/jobs/city/[slug]/page.tsx builds and parses
 * (`buildCitySlug` there). Kept identical so a linked city always resolves;
 * a mismatch here is a soft 404.
 */
export function buildCitySlug(cityName: string, stateCode: string): string {
  const sanitized = cityName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!sanitized) return '';
  return `${sanitized}-${stateCode.toLowerCase()}`;
}

/**
 * Mirror of `parseCitySlug` in app/jobs/city/[slug]/page.tsx, the half of the
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
 * stored name carrying a period, apostrophe, hyphen or parenthesis ("St. Louis",
 * "Winston-Salem", "Lee's Summit", "Coeur d'Alene", "Sault Ste. Marie")
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
 * The state bucket alone (name OR code), for callers that compose the
 * canonical predicate themselves (getListingFacts does).
 */
export function stateBucketWhere(stateName: string, stateCode: string): Prisma.JobWhereInput {
  return { OR: [{ state: stateName }, { stateCode }] };
}

/**
 * Canonical active jobs located in one state (PLAN T0-1: every count on the
 * directory, the locations hub and app/sitemap.ts reads this one predicate).
 *
 * canonicalBucketWhere nests the bucket under `AND` beside the canonical
 * clause, so the state `OR` can never clobber the expiry gate that
 * canonicalActiveJobWhere carries inside its own `AND`. The obvious
 * `{ ...activeIndexableJobWhere(), OR: [...] }` is the trap this replaces: that
 * helper's top-level `OR` IS the expiry pair, and a sibling `OR` key silently
 * deleted it, so every "live" number counted expired postings.
 */
export function activeJobsInStateWhere(
  stateName: string,
  stateCode: string,
  now?: Date,
): Prisma.JobWhereInput {
  return canonicalBucketWhere(stateBucketWhere(stateName, stateCode), now);
}

/* ─── Per-city card facts (DIR-L2, DIR-L4) ────────────────────────────────── */

/** One job row of the state pool, the minimal select the card lines need. */
export interface CityDetailRow {
  city: string | null;
  employer: string | null;
  isRemote: boolean;
  isHybrid: boolean;
}

export interface CityDetail {
  /**
   * Employers with open roles in the city, most roles first, aliases merged
   * through lib/pseo/city-employers.ts; [] below MIN_CITY_EMPLOYERS so the
   * card omits the line rather than naming one employer as a market.
   */
  employers: Array<{ name: string; count: number }>;
  /** Work mode split over the city's rows, or null below the card floor. */
  workMode: WorkModeMix | null;
}

/**
 * Group the state's rows by city and derive what each city card prints:
 * the DIR-L2 employer line and the DIR-L4 work mode split. Pure; keyed by
 * the trimmed city spelling, so look a card up with `city.trim()`.
 */
export function selectCityDetails(
  rows: readonly CityDetailRow[],
  minLinkJobs: number = MIN_CITY_JOBS_FOR_LINK,
): Map<string, CityDetail> {
  const byCity = new Map<string, CityDetailRow[]>();
  for (const row of rows) {
    const city = row.city?.trim();
    if (!city) continue;
    byCity.set(city, [...(byCity.get(city) ?? []), row]);
  }
  const details = new Map<string, CityDetail>();
  for (const [city, cityRows] of byCity) {
    const tallies = new Map<string, number>();
    for (const row of cityRows) {
      const employer = row.employer?.trim();
      if (!employer) continue;
      tallies.set(employer, (tallies.get(employer) ?? 0) + 1);
    }
    const groupRows: EmployerGroupRow[] = [...tallies].map(([employer, n]) => ({
      employer,
      _count: { employer: n },
    }));
    details.set(city, {
      employers: selectCityEmployers(groupRows, CITY_CARD_EMPLOYER_LIMIT).map((e) => ({
        name: e.name,
        count: e.openRoles,
      })),
      workMode: selectWorkModeMix(cityRows, minLinkJobs),
    });
  }
  return details;
}

/* ─── Which states have a directory (DIR-L6, hub S2 link) ─────────────────── */

/** One `groupBy(['city', 'state'])` row of the canonical pool. */
export interface StateCityRow {
  city: string | null;
  state: string | null;
  count: number;
}

/** A state that renders its own /jobs/locations/<slug> directory. */
export interface StateCityDirectorySummary {
  name: string;
  slug: string;
  /** Cities the directory links (each at MIN_CITY_JOBS_FOR_LINK or more). */
  linkableCities: number;
  /** Distinct cities carrying at least one active role. */
  trackedCities: number;
}

/**
 * Every state whose directory renders, keyed by the state name stored on
 * Job.state, with the same build and gate the directory page applies
 * (STATE_CODES for the code, cityLinkResolves as the veto,
 * shouldRenderStateCityDirectory as the gate). The page matches
 * `state = name OR stateCode = code`, a superset of this grouping, so a
 * state that qualifies here always renders there. Pure.
 */
export function summarizeStateDirectories(
  rows: readonly StateCityRow[],
): Map<string, StateCityDirectorySummary> {
  const rowsByState = new Map<string, CityJobRow[]>();
  for (const row of rows) {
    const stateName = row.state?.trim();
    if (!stateName || !row.city) continue;
    rowsByState.set(stateName, [...(rowsByState.get(stateName) ?? []), { city: row.city, count: row.count }]);
  }
  const summaries = new Map<string, StateCityDirectorySummary>();
  for (const [stateName, stateCode] of Object.entries(STATE_CODES)) {
    const directory = buildStateCityDirectory(rowsByState.get(stateName) ?? [], {
      canLink: (row) => cityLinkResolves(row.city, stateCode),
    });
    if (!shouldRenderStateCityDirectory(directory)) continue;
    summaries.set(stateName, {
      name: stateName,
      slug: stateToSlug(stateName),
      linkableCities: directory.linkable.length,
      trackedCities: directory.trackedCities,
    });
  }
  return summaries;
}

/**
 * The states with a rendering city directory, from one canonical
 * `groupBy(['city', 'state'])`. React cache() dedupes it within a request.
 * The block it feeds is navigation, so a query failure logs and yields an
 * empty map (the section omits itself) instead of taking the page down.
 */
export const getStatesWithCityDirectory = cache(
  async (): Promise<Map<string, StateCityDirectorySummary>> => {
    try {
      const rows = await prisma.job.groupBy({
        by: ['city', 'state'],
        where: canonicalBucketWhere({ city: { not: null }, state: { not: null } }),
        _count: { city: true },
      });
      return summarizeStateDirectories(
        rows.map((row) => ({ city: row.city, state: row.state, count: row._count.city })),
      );
    } catch (error) {
      console.error('[state-city-directory] directory groupBy failed:', error);
      return new Map();
    }
  },
);
