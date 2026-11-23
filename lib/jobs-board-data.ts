/**
 * The /jobs board's list and count, loaded once and shared (2026-11-23).
 *
 * app/jobs/page.tsx, its generateMetadata and GET /api/jobs all read through
 * here. Before, one filter click ran five listing queries: the page's list
 * and count, the metadata's count, then the browser's /api/jobs list and
 * count for the same view. Each carries the board's whole exclusion
 * predicate and took 0.8 s or more on the production database, through the
 * pool of two connections each instance had then. A few quick clicks, or one
 * crawler burst, filled the pool; the next read waited ten seconds and the
 * visitor got the error screen ("timeout exceeded when trying to connect").
 *
 * Three layers, outermost first:
 *
 *  1. A short in-process memo. Callers that ask for the same view together
 *     (the page, its metadata, the API call the browser makes straight after)
 *     share one promise. A failed read is dropped, so the next caller retries.
 *  2. The shared data cache (lib/data-cache.ts), for the views people share
 *     (isSharedBoardView): filters picked from the sidebar's own lists, a US
 *     state or "Remote" as the location, a handful of values at most. Their
 *     count and page 1 of their list are read from the database once a minute
 *     across all instances, and a visitor is served the cached copy while a
 *     refresh runs.
 *  3. The database, one query at a time per view in this instance (`.fresh`
 *     in lib/data-cache.ts).
 *
 * How old a served copy can be. The data cache hands back whatever it holds,
 * however old, and refreshes it behind the response. A copy up to
 * JOBS_BOARD_MAX_STALE_SECONDS old is served as it is. An older one (a view
 * nobody opened for a while) is not: the visitor waits for that refresh,
 * JOBS_BOARD_REFRESH_WAIT_MS at most, and gets the old copy only when the
 * database fails or takes longer. So unless the database is failing, a list
 * is at most about three minutes behind it, plus the minute the edge holds
 * the page (JOBS_BOARD_EDGE_CACHE in middleware.ts). A view with no copy and
 * a failing database still throws; app/jobs/page.tsx turns that into a 500
 * the edge never stores.
 *
 * Everything else skips layer 2 and reads the database: deeper pages,
 * free-text searches, a city or employer deep link, any value outside the
 * lists. Each is a one-off, mostly for crawlers, and the set has no end, so
 * caching them would only fill the cache. One consequence: the count may be
 * up to a minute older than a deeper page's rows, so the last page can be
 * off by one for that long (both are noindexed views).
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  EXPERIENCE_FILTER_BUCKETS,
  SPECIALTY_FILTER_OPTIONS,
  buildWhereClause,
  countActiveFilters,
  filtersToParams,
  isRemoteLocationAlias,
  parseFiltersFromParams,
  type RecruitmentFilterState,
} from '@/lib/filters';
import { buildJobsOrderBy, type JobSort } from '@/lib/utils/job-sort';
import { sharedCachedRead } from '@/lib/data-cache';
import { SALARY_FILTER_BUCKETS } from '@/config/niche/stats';
import { ALL_CATEGORY_SLUGS } from '@/lib/pseo/taxonomy-registry';
import { CODE_TO_STATE, STATE_CODES } from '@/lib/pseo/setting-state-config';

/** Seconds a cached board read is fresh; a new posting shows within about this long. */
export const JOBS_BOARD_CACHE_SECONDS = 60;

/** Oldest cached copy served as it is. Past this the visitor waits for the refresh. */
export const JOBS_BOARD_MAX_STALE_SECONDS = 180;

/** Longest a visitor waits for that refresh before the older copy is served instead. */
export const JOBS_BOARD_REFRESH_WAIT_MS = 2500;

/** Jobs per board page: the size the page renders and the browser asks for. */
export const JOBS_BOARD_PAGE_SIZE = 50;

/**
 * Most filter values a view can carry and still be kept in the shared cache.
 * Four covers what people bookmark and come back to (a state, a specialty, a
 * work mode, a job type), and a kept view is one that still answers from its
 * last copy when the database is busy. The lists are closed, so the set is
 * finite, and a new entry costs its maker one database read, which the pool
 * itself rations.
 */
export const JOBS_BOARD_SHARED_VIEW_MAX_FILTERS = 4;

/** Seconds callers in one instance share a read (the page, its metadata, the API). */
const MEMO_SECONDS = 15;

/** Most views one instance remembers at once; the oldest are dropped first. */
const MEMO_MAX_ENTRIES = 100;

const SORTS: readonly JobSort[] = ['best', 'newest', 'salary'];

/**
 * Every column either consumer shows: the page's card fields (slug, the state
 * code for the list impression, the apply link) and the API's (salaryRange).
 * Never the full description (L-06, and the listing API's anti-scrape rule).
 */
const BOARD_ROW_SELECT = {
  id: true,
  slug: true,
  title: true,
  employer: true,
  location: true,
  city: true,
  state: true,
  stateCode: true,
  jobType: true,
  isRemote: true,
  isHybrid: true,
  displaySalary: true,
  normalizedMinSalary: true,
  normalizedMaxSalary: true,
  salaryPeriod: true,
  salaryRange: true,
  descriptionSummary: true,
  createdAt: true,
  isFeatured: true,
  isVerifiedEmployer: true,
  originalPostedAt: true,
  mode: true,
  applyLink: true,
  applyOnPlatform: true,
  sourceType: true,
  experienceLabel: true,
  newGradFriendly: true,
  employerJobs: { select: { companyLogoUrl: true } },
} as const satisfies Prisma.JobSelect;

/**
 * The selected columns, as part of the rows' cache key (after its shape
 * version). The data cache outlives a deploy, so without this a release that
 * adds a column would be handed rows cached by the release before it, without
 * that column.
 */
const BOARD_ROW_COLUMNS = Object.keys(BOARD_ROW_SELECT).join(',');

type BoardDbRow = Prisma.JobGetPayload<{ select: typeof BOARD_ROW_SELECT }>;

/**
 * One job on the board, in the shape the cache can hold: dates are ISO
 * strings (a cached value is JSON) and the employer's logo is a plain field.
 */
export type BoardJobRow = Omit<BoardDbRow, 'createdAt' | 'originalPostedAt' | 'employerJobs'> & {
  createdAt: string;
  originalPostedAt: string | null;
  companyLogoUrl: string | null;
};

/** A value with the time it was read from the database. */
interface Stamped<T> {
  value: T;
  readAt: number;
}

/** True for a cached entry that carries its read time; anything else is not trusted. */
function isStamped<T>(entry: unknown): entry is Stamped<T> {
  return typeof entry === 'object' && entry !== null && 'value' in entry
    && typeof (entry as { readAt?: unknown }).readAt === 'number';
}

function isoOrNull(value: Date | string | null | undefined): string | null {
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' ? value : null;
}

function toBoardRow(row: BoardDbRow): BoardJobRow {
  const { employerJobs, createdAt, originalPostedAt, ...rest } = row;
  return {
    ...rest,
    createdAt: isoOrNull(createdAt) ?? '',
    originalPostedAt: isoOrNull(originalPostedAt),
    companyLogoUrl: employerJobs?.companyLogoUrl || null,
  };
}

/** The sort a URL value means: an unknown one is the default, as buildJobsOrderBy reads it. */
export function normalizeBoardSort(sort: string | null | undefined): JobSort {
  return SORTS.find((known) => known === sort) ?? 'best';
}

/* ─── The view: its filters in one spelling, and its key ─────────────────── */

const REMOTE_LOCATION = 'Remote';
const STATE_NAME_BY_LOWERCASE: ReadonlyMap<string, string> = new Map(
  Object.keys(STATE_CODES).map((name) => [name.toLowerCase(), name]),
);
const KNOWN_STATE_CODES: ReadonlySet<string> = new Set(Object.keys(CODE_TO_STATE));

/** "Remote", a state name or a state code in the registry's spelling; null for anything else. */
function knownLocation(location: string): string | null {
  if (isRemoteLocationAlias(location)) return REMOTE_LOCATION;
  const upper = location.toUpperCase();
  if (KNOWN_STATE_CODES.has(upper)) return upper;
  return STATE_NAME_BY_LOWERCASE.get(location.toLowerCase()) ?? null;
}

/**
 * The filters with a recognised place in one spelling. The board matches a
 * state without regard to case and reads any spelling of "remote" as the
 * remote flag (buildWhereClause), so "texas", "TEXAS" and "Texas" are one
 * view with one result, and get one key.
 */
function canonicalView(filters: RecruitmentFilterState): RecruitmentFilterState {
  const location = filters.location ? knownLocation(filters.location) ?? filters.location : filters.location;
  const upperCode = filters.stateCode?.toUpperCase();
  const stateCode = upperCode && KNOWN_STATE_CODES.has(upperCode) ? upperCode : filters.stateCode;
  return { ...filters, location, stateCode };
}

function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function keyOf(view: RecruitmentFilterState): string {
  const pairs = [...filtersToParams(view).entries()]
    .sort(([aKey, aValue], [bKey, bValue]) => compareText(aKey, bKey) || compareText(aValue, bValue))
    // A value ticked twice narrows nothing more: one pair, one key.
    .filter(([key, value], index, sorted) => {
      const previous = index > 0 ? sorted[index - 1] : undefined;
      return !previous || previous[0] !== key || previous[1] !== value;
    });
  return new URLSearchParams(pairs).toString();
}

/**
 * The view's filters as one canonical string: the URL contract
 * (filtersToParams) with its pairs sorted, so the same view always has the
 * same key whatever order or spelling its values arrived in. The readers
 * parse it back with parseFiltersFromParams, so a key says everything about
 * its result.
 */
export function boardFiltersKey(filters: RecruitmentFilterState): string {
  return keyOf(canonicalView(filters));
}

/* ─── Which views the shared cache keeps ─────────────────────────────────── */

const WORK_MODES: ReadonlySet<string> = new Set(['remote', 'hybrid', 'onsite']);
const JOB_TYPES: ReadonlySet<string> = new Set(['Full-Time', 'Part-Time', 'Contract', 'Per Diem', 'Other']);
const SPECIALTIES: ReadonlySet<string> = new Set([
  ...SPECIALTY_FILTER_OPTIONS.map((option) => option.value),
  'Telehealth',
  'Travel',
]);
const EXPERIENCE_LEVELS: ReadonlySet<string> = new Set(['New Grad', 'Mid-Level', 'Senior']);
const POSTED_WINDOWS: ReadonlySet<string> = new Set(['24h', '3d', '7d', '30d']);
const SALARY_FLOORS: ReadonlySet<number> = new Set(SALARY_FILTER_BUCKETS.map((bucket) => bucket.value));
const EXPERIENCE_YEARS: ReadonlySet<number> = new Set<number>(EXPERIENCE_FILTER_BUCKETS);
const CATEGORIES: ReadonlySet<string> = new Set(ALL_CATEGORY_SLUGS);

function allKnown(values: readonly string[] | undefined, known: ReadonlySet<string>): boolean {
  return (values ?? []).every((value) => known.has(value));
}

function isUnsetOrKnown<T>(value: T | null | undefined, known: ReadonlySet<T>): boolean {
  return value === null || value === undefined || known.has(value);
}

/**
 * True for a view the shared cache keeps: every filter value comes from a
 * closed list (the sidebar's own options, a US state or "Remote"), and there
 * are only a few of them. A search phrase, a city, an employer name or any
 * value typed into the URL by hand has no such list, so anyone could mint
 * cache entries without end; those views are read from the database each
 * time (the memo above still shares one read between their callers).
 *
 * Which views are kept changes only how often the database is read, never
 * what a view returns.
 */
export function isSharedBoardView(filters: RecruitmentFilterState): boolean {
  const view = canonicalView(filters);
  if (view.search.trim() || view.cityExact || view.employer) return false;
  if (countActiveFilters(view) > JOBS_BOARD_SHARED_VIEW_MAX_FILTERS) return false;
  const isKnownPlace = !view.location || knownLocation(view.location) === view.location;
  return isKnownPlace
    && isUnsetOrKnown(view.stateCode || null, KNOWN_STATE_CODES)
    && isUnsetOrKnown(view.category || null, CATEGORIES)
    && isUnsetOrKnown(view.postedWithin || null, POSTED_WINDOWS)
    && isUnsetOrKnown(view.salaryMin || null, SALARY_FLOORS)
    && isUnsetOrKnown(view.minYearsExperience, EXPERIENCE_YEARS)
    && allKnown(view.workMode, WORK_MODES)
    && allKnown(view.jobType, JOB_TYPES)
    && allKnown(view.specialty, SPECIALTIES)
    && allKnown(view.experienceLevel, EXPERIENCE_LEVELS);
}

/* ─── The two reads ──────────────────────────────────────────────────────── */

function whereOf(filtersKey: string): Prisma.JobWhereInput {
  return buildWhereClause(parseFiltersFromParams(new URLSearchParams(filtersKey)));
}

async function readBoardCount(filtersKey: string): Promise<Stamped<number>> {
  const value = await prisma.job.count({ where: whereOf(filtersKey) });
  return { value, readAt: Date.now() };
}

async function readBoardRows(filtersKey: string, sort: JobSort, page: number, limit: number): Promise<Stamped<BoardJobRow[]>> {
  const rows = await prisma.job.findMany({
    where: whereOf(filtersKey),
    orderBy: buildJobsOrderBy(sort),
    skip: (page - 1) * limit,
    take: limit,
    select: BOARD_ROW_SELECT,
  });
  return { value: rows.map(toBoardRow), readAt: Date.now() };
}

/**
 * Each read through the shared cache, and past it with `.fresh` (one query
 * per view at a time in this instance, see lib/data-cache.ts).
 */
const boardCount = sharedCachedRead(readBoardCount, ['jobs-board-count', 'v1'], JOBS_BOARD_CACHE_SECONDS);
const boardRows = sharedCachedRead(readBoardRows, ['jobs-board-rows', 'v1', BOARD_ROW_COLUMNS], JOBS_BOARD_CACHE_SECONDS);

/* ─── Serving a cached copy ──────────────────────────────────────────────── */

/** `work`, or a rejection once `milliseconds` pass without an answer. `work` keeps running. */
function withinBudget<T>(work: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`no answer from the database within ${milliseconds} ms`)),
      milliseconds,
    );
    work.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

/**
 * The cached copy while it is recent. Past JOBS_BOARD_MAX_STALE_SECONDS the
 * visitor waits for the read that replaces it (`refresh` joins the one the
 * data cache has just started behind its answer, so the query runs once) and
 * gets the old copy only when that read fails or outlasts
 * JOBS_BOARD_REFRESH_WAIT_MS. An entry without a read time is not a copy at
 * all: the database answers, or throws.
 */
async function recentOrRefreshed<T>(
  cached: () => Promise<Stamped<T>>,
  refresh: () => Promise<Stamped<T>>,
): Promise<T> {
  const entry: unknown = await cached();
  if (!isStamped<T>(entry)) return (await refresh()).value;
  if (Date.now() - entry.readAt <= JOBS_BOARD_MAX_STALE_SECONDS * 1000) return entry.value;
  try {
    return (await withinBudget(refresh(), JOBS_BOARD_REFRESH_WAIT_MS)).value;
  } catch (error) {
    console.error('[jobs-board] no fresh read; serving the last cached copy:', error);
    return entry.value;
  }
}

/* ─── The memo: callers of one view share one load ───────────────────────── */

const memo = new Map<string, { expiresAt: number; value: Promise<unknown> }>();

/** Drops what has expired, then the oldest entries past the cap. */
function sweepMemo(now: number): void {
  for (const [key, entry] of memo) {
    if (entry.expiresAt <= now) memo.delete(key);
  }
  for (const key of memo.keys()) {
    if (memo.size <= MEMO_MAX_ENTRIES) break;
    memo.delete(key);
  }
}

/** One in-flight or just-finished load per key within this instance. */
function memoized<T>(key: string, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = memo.get(key);
  if (hit && hit.expiresAt > now) return hit.value as Promise<T>;

  const value = load();
  // Deleted first so the entry moves to the end: the map's order is then the
  // order of use, which is what sweepMemo trims by.
  memo.delete(key);
  memo.set(key, { expiresAt: now + MEMO_SECONDS * 1000, value });
  // A failed load must not be handed to the next caller.
  value.catch(() => {
    if (memo.get(key)?.value === value) memo.delete(key);
  });
  sweepMemo(now);
  return value;
}

/** Forgets this instance's shared loads. For tests. */
export function clearBoardMemo(): void {
  memo.clear();
}

/** Views this instance is holding a load for. For tests. */
export function boardMemoSize(): number {
  return memo.size;
}

/* ─── The loader ─────────────────────────────────────────────────────────── */

/** Jobs matching the filters: the board's total, whatever page or sort is shown. */
export function loadBoardCount(filters: RecruitmentFilterState): Promise<number> {
  const filtersKey = boardFiltersKey(filters);
  return memoized(`count|${filtersKey}`, async () => {
    if (!isSharedBoardView(filters)) return (await boardCount.fresh(filtersKey)).value;
    return recentOrRefreshed(() => boardCount(filtersKey), () => boardCount.fresh(filtersKey));
  });
}

/** One page of the board, in the order `sort` names. */
export function loadBoardRows(
  filters: RecruitmentFilterState,
  sort: string | null | undefined,
  page: number,
  limit: number,
): Promise<BoardJobRow[]> {
  const filtersKey = boardFiltersKey(filters);
  const safeSort = normalizeBoardSort(sort);
  return memoized(`rows|${filtersKey}|${safeSort}|${page}|${limit}`, async () => {
    const isFirstPage = page === 1 && limit === JOBS_BOARD_PAGE_SIZE;
    if (!isFirstPage || !isSharedBoardView(filters)) {
      return (await boardRows.fresh(filtersKey, safeSort, page, limit)).value;
    }
    return recentOrRefreshed(
      () => boardRows(filtersKey, safeSort, page, limit),
      () => boardRows.fresh(filtersKey, safeSort, page, limit),
    );
  });
}
