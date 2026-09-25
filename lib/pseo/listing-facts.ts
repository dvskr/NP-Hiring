/**
 * lib/pseo/listing-facts.ts
 *
 * The ONE facts loader behind every data-backed section of the pSEO thin
 * content program (PLAN C.3). A page scope (a category, a category in a
 * state, a city, a metro, a company) resolves to one Prisma bucket clause;
 * this module composes it on the canonical predicate, pulls one capped
 * findMany with a minimal select, and tallies everything in JS:
 * employers, cities, states, work mode, job types, settings, category
 * tags, recency, new-grad flags, disclosed pay and the gated benchmark.
 *
 * Rules the module exists to enforce:
 *   - every count comes from canonicalBucketWhere(), composed through AND so
 *     the caller's own OR (for example withTagFallback) never clobbers the
 *     expiry gate;
 *   - the loader is React cache()d on the primitive scope key, so
 *     generateMetadata and the page body share one query per request;
 *   - a failed section query logs and comes back empty (the section then
 *     omits itself); a failed TOTAL count rethrows so a page 5xxs instead
 *     of turning a database error into a false 404 or "0 jobs";
 *   - company links only for employers whose rows share one companyId and
 *     whose Company row still has active jobs (a company page 410s at zero);
 *   - recency reads originalPostedAt with createdAt as the fallback, never
 *     an employer refresh timestamp;
 *   - jobType and setting labels come from the existing vocabularies;
 *     unknown raw values are dropped, never title-cased into new labels.
 *
 * The selectors are pure so the floors are unit-testable without a database.
 */
import { cache } from 'react';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { canonicalBucketWhere, canonicalEmployerWhere } from '@/lib/canonical-counts';
import { findCanonicalName, normalizeCompanyName } from '@/lib/company-normalizer';
import { selectCityEmployers, type EmployerGroupRow } from '@/lib/pseo/city-employers';
import { getGatedBenchmark } from '@/lib/salary-analytics';
import type { BenchmarkRow } from '@/components/tools/benchmark-model';
import { EMPLOYER_SETTING_TAGS } from '@/lib/pseo/category-tagger';
import { canonicalizeJobType } from '@/lib/job-normalizer';
import { categoryFilterLabel } from '@/lib/filters';
import { SETTING_CONFIGS } from '@/lib/pseo/setting-state-config';
import { ALL_CATEGORY_SLUGS } from '@/lib/pseo/taxonomy-registry';
import { getNearbyQueryCities, type MetroCity } from '@/lib/metro-data';

// ─── Floors (PLAN C.0) ──────────────────────────────────────────────────────

/** Mix floor on pages that only exist at 3 or more listings. */
export const MIX_MIN_POSTINGS_LISTING = 3;
/** Mix floor on hubs, salary and company pages. */
export const MIX_MIN_POSTINGS_HUB = 5;
/** A labeled-field mix also needs this share of rows labeled. */
export const MIX_MIN_LABELED_SHARE = 0.5;
/** Recency block floor on hubs and metros. */
export const RECENCY_MIN_POSTINGS_HUB = 3;
/** Hard cap on rows pulled for in-memory aggregation. */
export const LISTING_FACTS_ROW_CAP = 2000;
/** Employers carried on the facts object (the roster shows at most this many). */
export const TOP_EMPLOYERS_LIMIT = 8;
/** Distribution rows carried per labeled field. */
export const TOP_LIST_LIMIT = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

// ─── Shapes ─────────────────────────────────────────────────────────────────

export interface LabeledCount { label: string; count: number }
export interface CityCount { name: string; stateCode: string | null; count: number }
export interface StateCount { name: string; count: number }
export interface WorkModeMix { total: number; remote: number; hybrid: number; onsite: number }
export interface FieldMix { total: number; labeledTotal: number; top: LabeledCount[] }
export interface RecencyFacts {
  total: number;
  /** Rows carrying an employer-stated first-posted date. */
  datedCount: number;
  last7: number;
  last30: number;
  newestPostedAt: Date | null;
}
export interface EmployerTally { name: string; count: number; companyId: string | null }
export interface EmployerFact { name: string; count: number; companyPath: string | null }

/** The minimal Job projection the loader selects and the tally consumes. */
export interface ListingFactRow {
  employer: string | null;
  companyId: string | null;
  city: string | null;
  state: string | null;
  stateCode: string | null;
  isRemote: boolean;
  isHybrid: boolean;
  jobType: string | null;
  setting: string | null;
  categoryTags: string[];
  originalPostedAt: Date | null;
  createdAt: Date;
  newGradFriendly: boolean;
  salaryIsEstimated: boolean;
  normalizedMinSalary: number | null;
}

export interface ListingFacts {
  /** Canonical count for the scope (a separate COUNT, never the sample size). */
  total: number;
  distinctEmployers: number;
  topEmployers: EmployerFact[];
  cities: CityCount[];
  states: StateCount[];
  workMode: WorkModeMix;
  jobTypes: FieldMix;
  settings: FieldMix;
  categoryTop: LabeledCount[];
  recency: RecencyFacts;
  newGradFriendly: number;
  /** Rows with an employer-stated (not estimated) normalized salary. */
  salaryDisclosedCount: number;
  /** Gated median row, or null below 5 postings from 3 employers. */
  benchmark: BenchmarkRow | null;
  computedAt: Date;
  /** True when the row cap truncated the tally sample (mixes are then a sample). */
  sampled: boolean;
}

const LISTING_FACT_SELECT = {
  employer: true,
  companyId: true,
  city: true,
  state: true,
  stateCode: true,
  isRemote: true,
  isHybrid: true,
  jobType: true,
  setting: true,
  categoryTags: true,
  originalPostedAt: true,
  createdAt: true,
  newGradFriendly: true,
  salaryIsEstimated: true,
  normalizedMinSalary: true,
} as const satisfies Prisma.JobSelect;

// ─── Pure selectors ─────────────────────────────────────────────────────────

/** Remote wins, then hybrid, else on site. Null below `min` rows. */
export function selectWorkModeMix(
  rows: ReadonlyArray<Pick<ListingFactRow, 'isRemote' | 'isHybrid'>>,
  min: number = MIX_MIN_POSTINGS_HUB,
): WorkModeMix | null {
  if (rows.length < min) return null;
  const mix: WorkModeMix = { total: rows.length, remote: 0, hybrid: 0, onsite: 0 };
  for (const row of rows) {
    if (row.isRemote) mix.remote += 1;
    else if (row.isHybrid) mix.hybrid += 1;
    else mix.onsite += 1;
  }
  return mix;
}

/** True when a mix clears the postings floor. */
export function workModeQualifies(mix: WorkModeMix, min: number): boolean {
  return mix.total >= min;
}

export interface FieldMixOptions {
  /** Labeled rows required (default: the hub floor). */
  min?: number;
  /** Labeled share of all rows required (default MIX_MIN_LABELED_SHARE). */
  minLabeledShare?: number;
  limit?: number;
}

/**
 * Distribution of a labeled field. `values` are already-resolved labels
 * (null for unlabeled or unknown rows). Null below the labeled floor or the
 * labeled share; rows sort by volume then label for a stable order.
 */
export function selectFieldMix(
  values: ReadonlyArray<string | null | undefined>,
  options: FieldMixOptions = {},
): FieldMix | null {
  const { min = MIX_MIN_POSTINGS_HUB, minLabeledShare = MIX_MIN_LABELED_SHARE, limit = TOP_LIST_LIMIT } = options;
  const counts = new Map<string, number>();
  for (const value of values) {
    const label = value?.trim();
    if (!label) continue;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const labeledTotal = [...counts.values()].reduce((sum, n) => sum + n, 0);
  const mix: FieldMix = {
    total: values.length,
    labeledTotal,
    top: [...counts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, limit),
  };
  return fieldMixQualifies(mix, min, minLabeledShare) ? mix : null;
}

/** True when a labeled mix clears both the count floor and the share floor. */
export function fieldMixQualifies(
  mix: FieldMix,
  min: number,
  minLabeledShare: number = MIX_MIN_LABELED_SHARE,
): boolean {
  if (mix.labeledTotal < min) return false;
  if (mix.total === 0) return false;
  return mix.labeledTotal / mix.total >= minLabeledShare;
}

/** Posted date of a row: the employer's first-posted date, else ingest time. */
export function postedAtOf(row: Pick<ListingFactRow, 'originalPostedAt' | 'createdAt'>): Date {
  return row.originalPostedAt ?? row.createdAt;
}

/** Recency tallies; null below `min` rows or when no row has a date. */
export function selectRecency(
  rows: ReadonlyArray<Pick<ListingFactRow, 'originalPostedAt' | 'createdAt'>>,
  now: Date = new Date(),
  min: number = 1,
): RecencyFacts | null {
  if (rows.length < min) return null;
  const facts: RecencyFacts = { total: rows.length, datedCount: 0, last7: 0, last30: 0, newestPostedAt: null };
  const cutoff7 = now.getTime() - 7 * DAY_MS;
  const cutoff30 = now.getTime() - 30 * DAY_MS;
  for (const row of rows) {
    if (row.originalPostedAt) facts.datedCount += 1;
    const posted = postedAtOf(row);
    const t = posted.getTime();
    if (Number.isNaN(t)) continue;
    if (t >= cutoff7) facts.last7 += 1;
    if (t >= cutoff30) facts.last30 += 1;
    if (!facts.newestPostedAt || t > facts.newestPostedAt.getTime()) facts.newestPostedAt = posted;
  }
  return facts;
}

/**
 * The identity two spellings must agree on to be one employer. Mirrors the
 * private rule inside lib/pseo/city-employers.ts (canonical name first,
 * then the normalizer's form, then the raw lowercase form) so the company
 * ids collected here land on the same buckets selectCityEmployers builds.
 */
function employerIdentity(raw: string): string {
  const canonical = findCanonicalName(raw);
  if (canonical) return `canonical:${canonical}`;
  return normalizeCompanyName(raw) || raw.toLowerCase();
}

/**
 * Ranked employers with the company id their rows share. Wraps
 * selectCityEmployers (alias merging, volume-then-name order) with no
 * employer floor: the narrative decides whether one employer is worth a
 * sentence. `companyId` is set only when every row of the bucket that
 * carries an id carries the SAME id.
 */
export function selectEmployers(
  rows: ReadonlyArray<Pick<ListingFactRow, 'employer' | 'companyId'>>,
  limit: number = TOP_EMPLOYERS_LIMIT,
): { employers: EmployerTally[]; distinct: number } {
  const groups = new Map<string, { count: number; identity: string }>();
  const idsByIdentity = new Map<string, Set<string>>();
  const namesByIdentity = new Map<string, Set<string>>();
  for (const row of rows) {
    const raw = row.employer?.trim();
    if (!raw) continue;
    const group = groups.get(raw) ?? { count: 0, identity: employerIdentity(raw) };
    group.count += 1;
    groups.set(raw, group);
    const names = namesByIdentity.get(group.identity) ?? new Set<string>();
    names.add(raw);
    const canonical = findCanonicalName(raw);
    if (canonical) names.add(canonical);
    namesByIdentity.set(group.identity, names);
    if (row.companyId) {
      const ids = idsByIdentity.get(group.identity) ?? new Set<string>();
      ids.add(row.companyId);
      idsByIdentity.set(group.identity, ids);
    }
  }
  const groupRows: EmployerGroupRow[] = [...groups.entries()].map(([employer, g]) => ({
    employer,
    _count: { employer: g.count },
  }));
  const merged = selectCityEmployers(groupRows, Number.MAX_SAFE_INTEGER, 0);
  const identityByName = new Map<string, string>();
  for (const [identity, names] of namesByIdentity) {
    for (const name of names) identityByName.set(name, identity);
  }
  const employers = merged.slice(0, limit).map((employer): EmployerTally => {
    const identity = identityByName.get(employer.name);
    const ids = identity ? idsByIdentity.get(identity) : undefined;
    return {
      name: employer.name,
      count: employer.openRoles,
      companyId: ids && ids.size === 1 ? [...ids][0] : null,
    };
  });
  return { employers, distinct: merged.length };
}

/** Rows grouped by (city, stateCode), volume then name. */
export function selectCities(rows: ReadonlyArray<Pick<ListingFactRow, 'city' | 'stateCode'>>): CityCount[] {
  const counts = new Map<string, CityCount>();
  for (const row of rows) {
    const name = row.city?.trim();
    if (!name) continue;
    const stateCode = row.stateCode?.trim().toUpperCase() || null;
    const key = `${name.toLowerCase()}|${stateCode ?? ''}`;
    const entry = counts.get(key) ?? { name, stateCode, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Rows grouped by full state name, volume then name. */
export function selectStates(rows: ReadonlyArray<Pick<ListingFactRow, 'state'>>): StateCount[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const name = row.state?.trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

const KNOWN_SETTING_LABELS: ReadonlySet<string> = new Set(Object.keys(EMPLOYER_SETTING_TAGS));
const CATEGORY_SLUG_SET: ReadonlySet<string> = new Set(ALL_CATEGORY_SLUGS);

/** Setting label when the stored value is in the employer vocabulary, else null. */
export function settingLabelOf(setting: string | null | undefined): string | null {
  const value = setting?.trim();
  return value && KNOWN_SETTING_LABELS.has(value) ? value : null;
}

/** Canonical job type label, or null for unknown or sentinel values. */
export function jobTypeLabelOf(jobType: string | null | undefined): string | null {
  return canonicalizeJobType(jobType);
}

/** Display label for a taxonomy slug (config label first, filter label second). */
export function categoryLabelOf(slug: string): string {
  return SETTING_CONFIGS[slug]?.label ?? categoryFilterLabel(slug);
}

/** Top taxonomy tags across rows; unknown tags are dropped. */
export function selectCategoryTop(
  rows: ReadonlyArray<Pick<ListingFactRow, 'categoryTags'>>,
  limit: number = TOP_LIST_LIMIT,
): LabeledCount[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const tag of row.categoryTags ?? []) {
      if (CATEGORY_SLUG_SET.has(tag)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([slug, count]) => ({ label: categoryLabelOf(slug), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit);
}

/** The full in-memory tally over a row sample (no database). */
export function tallyListingFacts(
  rows: ReadonlyArray<ListingFactRow>,
  now: Date = new Date(),
): Omit<ListingFacts, 'total' | 'benchmark' | 'computedAt' | 'sampled' | 'topEmployers'> & {
  topEmployers: EmployerTally[];
} {
  const { employers, distinct } = selectEmployers(rows);
  return {
    distinctEmployers: distinct,
    topEmployers: employers,
    cities: selectCities(rows),
    states: selectStates(rows),
    workMode: selectWorkModeMix(rows, 0) ?? { total: 0, remote: 0, hybrid: 0, onsite: 0 },
    jobTypes: selectFieldMix(rows.map((r) => jobTypeLabelOf(r.jobType)), { min: 0, minLabeledShare: 0 })
      ?? { total: rows.length, labeledTotal: 0, top: [] },
    settings: selectFieldMix(rows.map((r) => settingLabelOf(r.setting)), { min: 0, minLabeledShare: 0 })
      ?? { total: rows.length, labeledTotal: 0, top: [] },
    categoryTop: selectCategoryTop(rows),
    recency: selectRecency(rows, now, 0)
      ?? { total: 0, datedCount: 0, last7: 0, last30: 0, newestPostedAt: null },
    newGradFriendly: rows.filter((r) => r.newGradFriendly).length,
    salaryDisclosedCount: rows.filter((r) => !r.salaryIsEstimated && r.normalizedMinSalary !== null).length,
  };
}

/** Facts for a scope with no rows (also the shape sections receive on failure). */
export function emptyListingFacts(now: Date = new Date()): ListingFacts {
  return { ...tallyListingFacts([], now), topEmployers: [], total: 0, benchmark: null, computedAt: now, sampled: false };
}

// ─── Scope helpers ──────────────────────────────────────────────────────────

/**
 * Metro job scope, shared by the metro page and the sitemap so they can
 * never disagree on inventory: the metro's own name matches by `contains`
 * (it folds North Miami into Miami), adjacent cities match exactly, and
 * everything is pinned to the metro's state. Returns the BUCKET only; wrap
 * it in canonicalBucketWhere() (getListingFacts does) for counts.
 */
export function metroScopeWhere(metro: MetroCity): Prisma.JobWhereInput {
  return {
    stateCode: { equals: metro.stateCode, mode: 'insensitive' },
    OR: [
      { city: { contains: metro.city, mode: 'insensitive' } },
      ...getNearbyQueryCities(metro).map((nearby): Prisma.JobWhereInput => ({
        city: { equals: nearby, mode: 'insensitive' },
      })),
    ],
  };
}

/** `/companies/{slug}` in the kebab form app/sitemap.ts emits. */
export function companyProfilePath(normalizedName: string): string {
  return `/companies/${normalizedName.replace(/ /g, '-')}`;
}

// ─── Loader ─────────────────────────────────────────────────────────────────

async function fetchRows(scopeKey: string, where: Prisma.JobWhereInput): Promise<ListingFactRow[]> {
  try {
    const rows = await prisma.job.findMany({
      where,
      select: LISTING_FACT_SELECT,
      orderBy: { createdAt: 'desc' },
      take: LISTING_FACTS_ROW_CAP,
    });
    // The types promise an array, but a driver fault or a partial test double
    // (a bare vi.fn() resolves undefined) can hand back anything, and
    // tallyListingFacts would then throw "rows is not iterable" out of every
    // page that reads facts. Treat it like a failed query instead: the
    // sections omit themselves and the separately counted total still stands.
    if (Array.isArray(rows)) return rows;
    console.warn(`[listing-facts] row query for scope "${scopeKey}" returned a non-array; treating it as empty`);
    return [];
  } catch (error) {
    console.error(`[listing-facts] row query failed for scope "${scopeKey}":`, error);
    return [];
  }
}

async function fetchBenchmark(scopeKey: string, where: Prisma.JobWhereInput): Promise<BenchmarkRow | null> {
  try {
    return await getGatedBenchmark(where);
  } catch (error) {
    console.error(`[listing-facts] benchmark query failed for scope "${scopeKey}":`, error);
    return null;
  }
}

/** Company profile paths for ids whose Company row still has active jobs. */
async function resolveCompanyPaths(
  scopeKey: string,
  companyIds: readonly string[],
  now: Date,
): Promise<Map<string, string>> {
  if (companyIds.length === 0) return new Map();
  try {
    const companies = await prisma.company.findMany({
      where: { AND: [{ id: { in: [...companyIds] } }, canonicalEmployerWhere(now)] },
      select: { id: true, normalizedName: true },
    });
    return new Map(companies.map((c) => [c.id, companyProfilePath(c.normalizedName)]));
  } catch (error) {
    console.error(`[listing-facts] company lookup failed for scope "${scopeKey}":`, error);
    return new Map();
  }
}

async function computeListingFacts(scopeKey: string, bucket: Prisma.JobWhereInput): Promise<ListingFacts> {
  const now = new Date();
  const where = canonicalBucketWhere(bucket, now);
  // The count is the only query allowed to throw: fetchRows and
  // fetchBenchmark never reject, so a count failure surfaces as a 5xx
  // instead of a page that claims zero inventory.
  const [total, rows, benchmark] = await Promise.all([
    prisma.job.count({ where }),
    fetchRows(scopeKey, where),
    fetchBenchmark(scopeKey, where),
  ]);
  const tally = tallyListingFacts(rows, now);
  const companyIds = tally.topEmployers.flatMap((e) => (e.companyId ? [e.companyId] : []));
  const companyPaths = await resolveCompanyPaths(scopeKey, companyIds, now);
  return {
    ...tally,
    topEmployers: tally.topEmployers.map(({ name, count, companyId }) => ({
      name,
      count,
      companyPath: companyId ? companyPaths.get(companyId) ?? null : null,
    })),
    total,
    benchmark,
    computedAt: now,
    sampled: rows.length >= LISTING_FACTS_ROW_CAP && total > rows.length,
  };
}

/*
 * React cache() dedupes on argument identity, and a fresh where object per
 * call would never hit. The bucket is therefore parked under its scope key
 * for the synchronous instant between registering it and the cached loader
 * reading it (an async function runs to its first await synchronously), so
 * the cache key stays a primitive. Callers must use one key per distinct
 * bucket, for example "state:texas" or "category-city:remote:austin-tx".
 */
const pendingBuckets = new Map<string, Prisma.JobWhereInput>();

const loadListingFacts = cache(async (scopeKey: string): Promise<ListingFacts> => {
  const bucket = pendingBuckets.get(scopeKey);
  pendingBuckets.delete(scopeKey);
  if (!bucket) throw new Error(`[listing-facts] no bucket registered for scope "${scopeKey}"`);
  return computeListingFacts(scopeKey, bucket);
});

/**
 * Facts for a scope. `where` is the caller's bucket clause (category tag
 * fallback, state, city, metro); the canonical predicate is composed here.
 */
export function getListingFacts(scopeKey: string, where: Prisma.JobWhereInput): Promise<ListingFacts> {
  pendingBuckets.set(scopeKey, where);
  const facts = loadListingFacts(scopeKey);
  // A cache hit skips the loader, so clear the parked bucket either way.
  pendingBuckets.delete(scopeKey);
  return facts;
}
