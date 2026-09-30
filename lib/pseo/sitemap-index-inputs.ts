/**
 * lib/pseo/sitemap-index-inputs.ts
 *
 * The inputs the primary sitemap (app/sitemap.ts) hands to the city page and
 * metro guide index gates, computed the way the pages compute their own:
 * distinct postings (lib/pseo/posting-clusters.ts, indexing audit fixSoon 8),
 * distinct employers, and for metros the postings first posted in the last
 * 30 days (CQ-08). A sitemap that counted raw rows, or skipped the recency
 * condition, could list a page that renders `noindex, follow`.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { canonicalBucketWhere } from '@/lib/canonical-counts';
import type { MetroCity } from '@/lib/metro-data';
import { countPostings, type PostingRow } from './posting-clusters';
import { metroScopeWhere, selectRecency } from './listing-facts';
import type { LocalListingIndexInput, MetroIndexInput } from './render-gate';
import { STATE_CODES } from './setting-state-config';

const CODE_BY_NAME: ReadonlyMap<string, string> = new Map(Object.entries(STATE_CODES));
const NAME_BY_CODE: ReadonlyMap<string, string> = new Map(Object.entries(STATE_CODES).map(([name, code]) => [code, name]));

/**
 * Lookup key for a city page: the state code and the city name the page
 * queries, lowercased. The sitemap passes the stored city it groups on;
 * cityLinkResolves has already proved that its trimmed form is the name the
 * page parses back from the slug, so both are trimmed here.
 */
export function cityIndexKey(city: string, stateCode: string): string {
  return `${stateCode.trim().toUpperCase()}|${city.trim().toLowerCase()}`;
}

/**
 * The jurisdiction a row belongs to under the city page's own exact match,
 * `state = name OR stateCode = code` (Prisma equality: no trim, case
 * sensitive): by state name first, then by code. A row both halves would
 * place in two jurisdictions counts toward the name's only, which can
 * undercount the other page (its gate closes), never overcount one.
 */
function rowStateCode(row: Pick<PostingRow, 'state' | 'stateCode'>): string | null {
  const byName = row.state ? CODE_BY_NAME.get(row.state) : undefined;
  if (byName) return byName;
  return row.stateCode && NAME_BY_CODE.has(row.stateCode) ? row.stateCode : null;
}

/**
 * City page gate inputs from a canonical row pool, keyed by cityIndexKey. A
 * row counts toward (its stored city, its jurisdiction) exactly as the city
 * page's bucket reads it: the city compared case-insensitively and NOT
 * trimmed (Prisma `equals` with mode insensitive), so a "Waco " row, which
 * the Waco page never lists, never lifts Waco over the floor either. Pure.
 */
export function computeCityIndexInputs(rows: ReadonlyArray<PostingRow>): Map<string, LocalListingIndexInput> {
  const byCity = new Map<string, PostingRow[]>();
  for (const row of rows) {
    const city = row.city;
    const code = rowStateCode(row);
    if (!city || !city.trim() || !code) continue;
    // Deliberately not cityIndexKey: that key trims, and this side must not.
    const key = `${code}|${city.toLowerCase()}`;
    const bucket = byCity.get(key);
    if (bucket) bucket.push(row);
    else byCity.set(key, [row]);
  }
  return new Map(
    [...byCity].map(([key, cityRows]): [string, LocalListingIndexInput] => {
      const counts = countPostings(cityRows);
      return [key, { activeJobs: counts.postings, distinctEmployers: counts.employers }];
    }),
  );
}

const POSTING_ROW_SELECT = {
  employer: true,
  title: true,
  city: true,
  state: true,
  stateCode: true,
} as const satisfies Prisma.JobSelect;

/** Memory guard; the canonical pool is about one thousand rows today. */
const ROW_CAP = 10_000;

/**
 * Every city page's gate input from one canonical row query. Allowed to
 * throw: the sitemap's gateRead omits the section on failure.
 */
export async function loadCityIndexInputs(now: Date = new Date()): Promise<Map<string, LocalListingIndexInput>> {
  const rows = await prisma.job.findMany({
    where: canonicalBucketWhere({ city: { not: null } }, now),
    select: POSTING_ROW_SELECT,
    take: ROW_CAP,
  });
  return computeCityIndexInputs(Array.isArray(rows) ? rows : []);
}

/**
 * A metro guide's gate input over the shared metroScopeWhere: distinct
 * postings and the rows first posted in the last 30 days (the page reads
 * facts.distinctPostings and facts.recency.last30 from the same scope).
 */
export async function loadMetroIndexInput(metro: MetroCity, now: Date = new Date()): Promise<MetroIndexInput> {
  const rows = await prisma.job.findMany({
    where: canonicalBucketWhere(metroScopeWhere(metro), now),
    select: { ...POSTING_ROW_SELECT, originalPostedAt: true, createdAt: true },
    take: ROW_CAP,
  });
  const list = Array.isArray(rows) ? rows : [];
  return {
    activeJobs: countPostings(list).postings,
    postedLast30Days: selectRecency(list, now, 0)?.last30 ?? 0,
  };
}
