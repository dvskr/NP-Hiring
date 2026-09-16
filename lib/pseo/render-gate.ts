/**
 * lib/pseo/render-gate.ts: pure, dependency-free render and index gates for
 * every pSEO surface (PLAN C.2).
 *
 * Robots, the sitemaps and the cross-link gates call the same function for a
 * page type, so a sitemap URL can never be one the page renders noindex
 * (outside the PSEO_STATS_MAX_AGE_HOURS freshness window already accepted).
 *
 * Every function takes plain numbers or facts (never a Prisma model) and
 * returns a boolean, so it is testable without a database or Next.js. A
 * non-finite input (NaN, an undefined coerced to a number) fails every
 * comparison and therefore gates closed.
 *
 * RENDER (200 versus 404) is a separate decision from INDEX. Only the
 * category x city page 404s below its floor (doorway reasoning below). Every
 * other type renders for users and answers `noindex, follow` when its index
 * gate fails, keeps its self canonical, and stays internally linked. Only
 * paginated pages canonical to page 1.
 */

/* ─── Category x city render gate (S4) ─────────────────────────────────── */

/**
 * Below MIN_JOBS_FOR_CATEGORY_CITY a combo is thin doorway content: near-
 * identical markup across thousands of URLs with no ranking equity. A
 * meta-robots noindex is not enough (Google still crawls and may not honor
 * it on doorway pages), so the page calls notFound() instead.
 *
 * Threshold = 3, aligned with the city page (app/jobs/city/[slug]/page.tsx),
 * the sitemap gate, and the seo_threshold_decision.md project memory (do NOT
 * raise, do NOT lower: all four thin-content specs re-examined it and agree).
 */
export const MIN_JOBS_FOR_CATEGORY_CITY = 3;

export function shouldRenderCategoryCity(
  jobCount: number,
  threshold: number = MIN_JOBS_FOR_CATEGORY_CITY,
): boolean {
  return jobCount >= threshold;
}

/* ─── Index thresholds (PLAN C.2 table) ────────────────────────────────── */

/**
 * Minimum canonical listings for any listing page (category landing,
 * category x state, category x city, city) to be indexable. Same value as
 * the category x city render gate: the doorway floor and the index floor
 * are one decision, so they share one constant.
 */
export const MIN_JOBS_FOR_INDEX = MIN_JOBS_FOR_CATEGORY_CITY;

/**
 * Minimum distinct employers behind a local listing page (category x city,
 * city). A page listing one employer's postings is a subset of that
 * employer's company page; the crawl's near-duplicate clusters were exactly
 * those pages. The gate reverses on its own when a second employer posts.
 */
export const MIN_EMPLOYERS_FOR_INDEX = 2;

/**
 * Independent data signals a category x state page must show beyond its
 * count before it indexes (see shouldIndexSettingState). Mirrors the old
 * category x city quality score (noindex below 25 points) but is computed
 * from facts the page actually renders.
 */
export const MIN_SETTING_STATE_INDEX_SIGNALS = 2;

/** State hub: canonical jobs in the state. */
export const MIN_JOBS_FOR_STATE_HUB_INDEX = 3;

/**
 * State hub: sections that rendered from in-state live aggregates (spec3
 * S1 to S7; S7 counts only when its salary gate passes). Deliberately
 * conservative; revisit after the first re-crawl, never below 3.
 */
export const MIN_DATA_SECTIONS_FOR_STATE_HUB_INDEX = 4;

/** Metro guide: canonical jobs inside the metro scope (metroScopeWhere). */
export const MIN_JOBS_FOR_METRO_INDEX = 3;

/** City directory: cities the directory can link (each at 3 or more jobs). */
export const MIN_LINKABLE_CITIES_FOR_DIRECTORY_INDEX = 3;

/**
 * Company profile: active jobs. Five is the floor the repo already uses for
 * "enough postings to say something" (BENCHMARK_MIN_POSTINGS,
 * COUNT_DISPLAY_FLOOR). A 1 to 4 job profile is mostly its job cards, which
 * duplicate the job detail pages. Kept separate from the listing floors so
 * the decisions stay uncoupled.
 */
export const MIN_ACTIVE_JOBS_FOR_COMPANY_INDEX = 5;

/** Salary guide state: the page renders at 1 or more active jobs (0 is 404). */
export const MIN_ACTIVE_JOBS_FOR_SALARY_GUIDE_INDEX = 1;

/** Live market snapshot blocks (license guides): render at 1 or more jobs. */
export const MIN_ACTIVE_JOBS_FOR_MARKET_SNAPSHOT = 1;

/**
 * Link-list rows (hub "open roles by category", salary guide setting links,
 * city "specialties here"): link a category x state or category x city row
 * only when its target renders and is not noindex for count. Same value as
 * the render gate, named for this use so a later change is deliberate.
 */
export const MIN_JOBS_FOR_LINK_LIST_ROW = MIN_JOBS_FOR_CATEGORY_CITY;

/* ─── PseoStats freshness ───────────────────────────────────────────────── */

/**
 * Maximum age of a PseoStats row before the sitemaps, the hub link lists and
 * the templates stop trusting it. 36h = 6x the 6h aggregate-pseo cron
 * cadence ("15 0,6,12,18 * * *" in vercel.json / config/cron-schedule.ts):
 * several missed runs are tolerated, and sustained aggregator failure is
 * caught before Google indexes pages whose jobs already expired.
 *
 * Owned here (PLAN C.2) so the local PSEO_STALENESS_HOURS copies in
 * app/api/sitemaps/cities/[batch]/route.ts and
 * lib/pseo/setting-state-template.tsx can import one value and never drift.
 */
export const PSEO_STATS_MAX_AGE_HOURS = 36;

export const PSEO_STATS_MAX_AGE_MS = PSEO_STATS_MAX_AGE_HOURS * 60 * 60 * 1000;

/** True when a PseoStats row's updatedAt is inside the freshness window. */
export function isPseoStatsFresh(updatedAt: Date, now: number = Date.now()): boolean {
  return now - updatedAt.getTime() <= PSEO_STATS_MAX_AGE_MS;
}

/** The lower bound for an `updatedAt: { gte: ... }` Prisma clause. */
export function pseoStatsFreshnessThreshold(now: number = Date.now()): Date {
  return new Date(now - PSEO_STATS_MAX_AGE_MS);
}

/* ─── Index gates ───────────────────────────────────────────────────────── */

function isFirstPage(page: number): boolean {
  return page === 1;
}

/**
 * Category landing (always renders) and the count half of every listing
 * page: index only page 1 with MIN_JOBS_FOR_INDEX or more canonical jobs.
 * Paginated pages stay `noindex, follow` and canonical to page 1.
 */
export function shouldIndexListingPage(jobCount: number, page: number = 1): boolean {
  return isFirstPage(page) && jobCount >= MIN_JOBS_FOR_INDEX;
}

/** Facts a category x state page renders, computed live and by the cron. */
export interface SettingStateIndexFacts {
  /** Canonical jobs for the setting in the state. */
  totalJobs: number;
  /** Distinct employers behind them. */
  employerCount: number;
  /** Cities named on the page (S2). */
  namedCityCount: number;
  /** A gated posted-pay benchmark rendered (S4). */
  hasBenchmark: boolean;
  /** Jobs posted in the last 30 days (S5). */
  postedLast30Days: number;
  /** The role-setup section rendered at least one dimension (S3). */
  roleSetupRenders: boolean;
}

const SIGNAL_MIN_EMPLOYERS = MIN_EMPLOYERS_FOR_INDEX;
const SIGNAL_MIN_NAMED_CITIES = 2;
const SIGNAL_MIN_POSTED_LAST_30_DAYS = 1;

/**
 * How many independent data signals a category x state page shows beyond
 * its count. Exposed so the cron can store the verdict and an admin view
 * can explain it.
 */
export function countSettingStateIndexSignals(facts: SettingStateIndexFacts): number {
  return [
    facts.employerCount >= SIGNAL_MIN_EMPLOYERS,
    facts.namedCityCount >= SIGNAL_MIN_NAMED_CITIES,
    facts.hasBenchmark === true,
    facts.postedLast30Days >= SIGNAL_MIN_POSTED_LAST_30_DAYS,
    facts.roleSetupRenders === true,
  ].filter(Boolean).length;
}

/**
 * Category x state (`/jobs/{category}/{state}`): renders at 1 or more jobs
 * (0 stays 404); indexes at MIN_JOBS_FOR_INDEX or more jobs AND at least
 * MIN_SETTING_STATE_INDEX_SIGNALS of {employers of 2 or more, named cities
 * of 2 or more, benchmark, posted in the last 30 days, role-setup rendered}.
 * The cron stores the same verdict in PseoStats.indexable for the sitemap.
 */
export function shouldIndexSettingState(facts: SettingStateIndexFacts, page: number = 1): boolean {
  if (!shouldIndexListingPage(facts.totalJobs, page)) return false;
  return countSettingStateIndexSignals(facts) >= MIN_SETTING_STATE_INDEX_SIGNALS;
}

export interface LocalListingIndexInput {
  /** Canonical jobs on the page. */
  activeJobs: number;
  /** Distinct employers behind them (PseoStats.distinctEmployers for the sitemap). */
  distinctEmployers: number;
  /** Defaults to 1. */
  page?: number;
}

/**
 * Category x city and city pages (render at 3 or more, unchanged): index
 * page 1 only with MIN_JOBS_FOR_INDEX or more jobs from
 * MIN_EMPLOYERS_FOR_INDEX or more distinct employers. Replaces the old
 * `getPageQualityScore`, which read donor columns that said nothing about
 * the page's own content.
 */
export function shouldIndexLocalListingPage(input: LocalListingIndexInput): boolean {
  return (
    isFirstPage(input.page ?? 1) &&
    input.activeJobs >= MIN_JOBS_FOR_INDEX &&
    input.distinctEmployers >= MIN_EMPLOYERS_FOR_INDEX
  );
}

export interface StateHubIndexInput {
  /** Canonical jobs in the state. */
  activeJobs: number;
  /** Sections that rendered from in-state live aggregates. */
  liveDataSections: number;
  /** Defaults to 1. */
  page?: number;
}

/**
 * State hub (`/jobs/state/{state}`, renders at 1 or more): index page 1 with
 * MIN_JOBS_FOR_STATE_HUB_INDEX or more jobs AND
 * MIN_DATA_SECTIONS_FOR_STATE_HUB_INDEX or more live data sections. The
 * sitemap reads the same predicate (replacing its `>= 1` state gate).
 */
export function shouldIndexStateHub(input: StateHubIndexInput): boolean {
  return (
    isFirstPage(input.page ?? 1) &&
    input.activeJobs >= MIN_JOBS_FOR_STATE_HUB_INDEX &&
    input.liveDataSections >= MIN_DATA_SECTIONS_FOR_STATE_HUB_INDEX
  );
}

export interface StateCityDirectoryIndexInput {
  /** Cities the directory links (each at 3 or more jobs). */
  linkableCities: number;
}

/**
 * City directory (`/jobs/locations/{state}`; render rule unchanged): index
 * with MIN_LINKABLE_CITIES_FOR_DIRECTORY_INDEX or more linkable cities. A
 * directory with one or two duplicates the hub's city grid.
 */
export function shouldIndexStateCityDirectory(input: StateCityDirectoryIndexInput): boolean {
  return input.linkableCities >= MIN_LINKABLE_CITIES_FOR_DIRECTORY_INDEX;
}

export interface MetroIndexInput {
  /** Canonical jobs inside metroScopeWhere(metro). */
  activeJobs: number;
}

/**
 * Metro guide (`/jobs/metro/{slug}`; renders for every curated slug): index
 * with MIN_JOBS_FOR_METRO_INDEX or more canonical metro jobs. The sitemap
 * reads the same predicate through the shared metroScopeWhere.
 */
export function shouldIndexMetro(input: MetroIndexInput): boolean {
  return input.activeJobs >= MIN_JOBS_FOR_METRO_INDEX;
}

export interface SalaryGuideStateIndexInput {
  /** Active jobs in the state (the page's own 404 count). */
  activeJobs: number;
  /** The posted-pay median cleared the publishing gate (GatedSalary.gatePassed). */
  salaryGatePassed: boolean;
}

/**
 * Salary guide state (`/salary-guide/{state}`, renders at 1 or more jobs):
 * index only when the page publishes a median. Below the gate the page
 * cannot answer "NP salary in {State}" from repo data, so it renders
 * `noindex, follow`. The sitemap uses getPublishableSalaryGuideStates()
 * (lib/salary-analytics.ts), which is the same gate over the same pool.
 */
export function shouldIndexSalaryGuideState(input: SalaryGuideStateIndexInput): boolean {
  return input.activeJobs >= MIN_ACTIVE_JOBS_FOR_SALARY_GUIDE_INDEX && input.salaryGatePassed === true;
}

/**
 * Company profile (`/companies/{slug}`; 0 stays 410 in middleware and 404 in
 * the page): index with MIN_ACTIVE_JOBS_FOR_COMPANY_INDEX or more active
 * jobs; `noindex, follow` for 1 to 4. The sitemap keeps its `>= 8` filter
 * until the re-crawl, then lowers to this constant.
 */
export function shouldIndexCompanyProfile(activeJobs: number): boolean {
  return activeJobs >= MIN_ACTIVE_JOBS_FOR_COMPANY_INDEX;
}

/**
 * Live market snapshot (license guides LIC-L3 and similar blocks): render
 * at MIN_ACTIVE_JOBS_FOR_MARKET_SNAPSHOT or more jobs, else the alert
 * sentence. A render gate, not an index gate: license guides always index.
 */
export function shouldRenderMarketSnapshot(activeJobs: number): boolean {
  return activeJobs >= MIN_ACTIVE_JOBS_FOR_MARKET_SNAPSHOT;
}
