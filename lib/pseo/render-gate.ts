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
 * RENDER (200 versus 404) is a separate decision from INDEX. The category x
 * city page 404s below its floor (doorway reasoning below; 0 jobs included,
 * TECH-07), and a category landing (`/jobs/{category}`, the shared template
 * and the bespoke pages alike) 404s at 0 canonical jobs (TECH-06: an empty
 * "0 positions" page answering 200 is the soft-404 pattern Google keeps
 * crawling); from 1 to the listing floor it renders `noindex, follow`.
 * Every other type renders for users and answers `noindex, follow` when its
 * index gate fails, keeps its self canonical, and stays internally linked.
 * Metro guides keep rendering at 0 jobs: they carry reviewed editorial
 * content and every curated metro is linked from /jobs/locations and the
 * state hubs, so a 404 would turn those links into dead ends. PAGINATION (TECH-08): every page N >= 2 of a
 * listing is its OWN canonical (`?page=N`, never page 1) and answers
 * `noindex, follow` in its meta robots, the same verdict the middleware's
 * X-Robots-Tag sends; a page past the last one is a 404
 * (lib/pseo/listing-pagination.tsx owns the rule).
 *
 * COUNTS (indexing audit fixSoon 8): every index gate below counts distinct
 * postings, not rows. Exact duplicate rows (the same employer, normalized
 * title, city and state) are one posting, and the strict category x state
 * gate also counts role clusters (one employer's role across locations).
 * lib/pseo/posting-clusters.ts owns both definitions.
 */

/* ─── Category x city render gate (S4) ─────────────────────────────────── */

/**
 * Below MIN_JOBS_FOR_CATEGORY_CITY a combo is thin doorway content: near-
 * identical markup across thousands of URLs with no ranking equity. A
 * meta-robots noindex is not enough (Google still crawls and may not honor
 * it on doorway pages), so the page calls notFound() instead.
 *
 * Threshold = 3, aligned with the city page (app/jobs/city/[slug]/page.tsx),
 * the link gates, and the seo_threshold_decision.md project memory (do NOT
 * raise, do NOT lower: all four thin-content specs re-examined it and agree).
 * This is the RENDER floor only; the index floor is the listing floor below.
 */
export const MIN_JOBS_FOR_CATEGORY_CITY = 3;

export function shouldRenderCategoryCity(
  jobCount: number,
  threshold: number = MIN_JOBS_FOR_CATEGORY_CITY,
): boolean {
  return jobCount >= threshold;
}

/* ─── Category landing render gate (TECH-06) ───────────────────────────── */

/** A category landing renders at this many canonical jobs or more; below, 404. */
export const MIN_JOBS_FOR_CATEGORY_LANDING_RENDER = 1;

/**
 * Whether a category landing (`/jobs/{category}`) renders at all. At 0
 * canonical jobs it calls notFound(): the page would only say "0 positions".
 * From 1 up to the listing floor it renders `noindex, follow`
 * (shouldIndexCategoryLanding). Links to a landing must use the same count
 * so no internal link lands on the 404.
 */
export function shouldRenderCategoryLanding(totalJobs: number): boolean {
  return totalJobs >= MIN_JOBS_FOR_CATEGORY_LANDING_RENDER;
}

/* ─── Thresholds (PLAN C.2 table, raised by the 2026-09 indexing audit) ─── */

/**
 * The count half of the old listing gate, kept at the category x city render
 * floor: shouldIndexListingPage reads it, and the low-inventory copy of the
 * landings uses it to decide which sibling categories are worth naming. No
 * page type indexes on it alone any more; see the listing floor below.
 */
export const MIN_JOBS_FOR_INDEX = MIN_JOBS_FOR_CATEGORY_CITY;

/**
 * The listing floor (indexing audit fixSoon 1, CQ-06 to CQ-08): state hubs,
 * category landings, city pages and category x city pages index only with at
 * least this many distinct postings ...
 */
export const MIN_POSTINGS_FOR_LISTING_INDEX = 5;

/**
 * ... from at least this many distinct employers. Three or four postings,
 * or one or two staffing firms, restate what the state hub and the company
 * pages already say; the audit found exactly those pages in the near-
 * duplicate clusters. The gate reopens on its own as inventory grows.
 */
export const MIN_EMPLOYERS_FOR_LISTING_INDEX = 3;

/** State hub: distinct postings in the state (the listing floor). */
export const MIN_JOBS_FOR_STATE_HUB_INDEX = MIN_POSTINGS_FOR_LISTING_INDEX;

/** State hub: distinct employers in the state (the listing floor). */
export const MIN_EMPLOYERS_FOR_STATE_HUB_INDEX = MIN_EMPLOYERS_FOR_LISTING_INDEX;

/**
 * State hub: sections that rendered from in-state live aggregates (spec3
 * S1 to S7; S7 counts only when its salary gate passes). Deliberately
 * conservative; revisit after the first re-crawl, never below 3.
 */
export const MIN_DATA_SECTIONS_FOR_STATE_HUB_INDEX = 4;

/** Metro guide: distinct postings inside the metro scope (metroScopeWhere). */
export const MIN_JOBS_FOR_METRO_INDEX = 3;

/**
 * Metro guide: postings first posted in the last 30 days (the recency
 * facts' `last30`, which read originalPostedAt with createdAt as the
 * fallback). A metro whose every role is older than that describes a market
 * that is not hiring now (CQ-08: Nashville, three roles, none recent).
 */
export const MIN_RECENT_POSTINGS_FOR_METRO_INDEX = 1;

/**
 * City directory: cities the directory can link (each at 3 or more jobs).
 * Raised from 3 to 5 (FB-1, M-05): a directory with fewer linkable cities
 * repeats the state hub's city grid and competes with the hub for the same
 * "NP jobs in {State}" query, so it stays a `noindex, follow` navigation page.
 */
export const MIN_LINKABLE_CITIES_FOR_DIRECTORY_INDEX = 5;

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

/* ─── Category x state (setting x state) ───────────────────────────────── */

/**
 * FB-1 switch for every `/jobs/{setting}/{state}` page. While it is false no
 * setting x state page indexes, whatever its stored verdict: robots answer
 * `noindex, follow` (the page stays live, canonical and linked), the cities
 * sitemap skips the whole setting x state section, and the sitemap index
 * counts none of it. It lives in code, not in PseoStats, so it takes effect
 * at deploy instead of after the next 6-hourly aggregate-pseo run.
 *
 * The cron keeps storing the strict verdict (shouldIndexSettingState) in
 * PseoStats.indexable, so the owner can see which pages would re-enter
 * before turning this on (fixSoon 16: re-admit only after the first crawl of
 * the hubs, metros and jobs has settled in Search Console).
 */
export const SETTING_STATE_INDEXING_ENABLED = false;

/** Strict setting x state gate (CQ-01, fixSoon 16): distinct postings. */
export const MIN_POSTINGS_FOR_SETTING_STATE_INDEX = MIN_POSTINGS_FOR_LISTING_INDEX;

/** Strict setting x state gate: distinct employers. */
export const MIN_EMPLOYERS_FOR_SETTING_STATE_INDEX = 3;

/** Strict setting x state gate: distinct role clusters (employer plus normalized title). */
export const MIN_ROLE_CLUSTERS_FOR_SETTING_STATE_INDEX = 3;

/** Strict setting x state gate: the largest employer's share of the postings, at most. */
export const MAX_TOP_EMPLOYER_SHARE_FOR_SETTING_STATE_INDEX = 0.5;

/**
 * Strict setting x state gate: the setting's postings as a share of the
 * parent state hub's postings, at most. A setting that holds (nearly) every
 * job of its state is the hub again under another URL (the audit's Utah and
 * Rhode Island pages were 100 percent copies of their hubs).
 */
export const MAX_HUB_SHARE_FOR_SETTING_STATE_INDEX = 0.7;

/**
 * Strict setting x state gate: postings first posted in the last 30 days, at
 * least (skeptic 2's hard requirement). A page whose every role is older
 * describes a market that is not hiring now (/jobs/1099/massachusetts passed
 * the old gate with four MedElite postings, the newest 39 days old).
 */
export const MIN_RECENT_POSTINGS_FOR_SETTING_STATE_INDEX = 1;

/**
 * Sibling de-duplication: two passing settings in one state whose counted
 * job sets overlap this much or more (shared jobs over the smaller set) are
 * one page twice; only the larger indexes (the audit's outpatient/ohio and
 * a specialty page for Ohio listed the same 10 LifeStance jobs).
 * lib/pseo/setting-state-index.ts dedupeSiblingSettingStates applies it.
 */
export const MAX_SIBLING_OVERLAP_FOR_SETTING_STATE_INDEX = 0.7;

/**
 * Settings whose name is a work mode. Their gate facts count only fully
 * remote rows (isRemote and not isHybrid, the structured work mode), never
 * the category tag, which description keywords also set (CQ-05: remote pages
 * listing only hybrid roles).
 */
export const STRUCTURED_REMOTE_SETTING_SLUGS: readonly string[] = ['remote', 'telehealth'];

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
 * The count half of a listing gate: page 1 with MIN_JOBS_FOR_INDEX or more
 * canonical jobs. Paginated pages stay `noindex, follow` with their own canonical, not
 * page 1. Not an index gate on its own any more: category landings read
 * shouldIndexCategoryLanding, which adds the listing floor.
 */
export function shouldIndexListingPage(jobCount: number, page: number = 1): boolean {
  return isFirstPage(page) && jobCount >= MIN_JOBS_FOR_INDEX;
}

export interface ListingFloorInput {
  /** Distinct postings (exact duplicate rows collapsed). */
  activeJobs: number;
  /** Distinct employers behind them. */
  distinctEmployers: number;
}

/** The listing floor alone: 5 or more distinct postings from 3 or more employers. */
export function meetsListingFloor(input: ListingFloorInput): boolean {
  return (
    input.activeJobs >= MIN_POSTINGS_FOR_LISTING_INDEX &&
    input.distinctEmployers >= MIN_EMPLOYERS_FOR_LISTING_INDEX
  );
}

export interface CategoryLandingIndexInput extends ListingFloorInput {
  /** Defaults to 1. */
  page?: number;
}

/**
 * Category landing (`/jobs/{category}`, always renders): index page 1 at
 * the listing floor. The aggregate-pseo cron stores the same verdict on the
 * 'category-landing' PseoStats row (PseoStats.indexable), which is what the
 * primary sitemap should read.
 */
export function shouldIndexCategoryLanding(input: CategoryLandingIndexInput): boolean {
  return isFirstPage(input.page ?? 1) && meetsListingFloor(input);
}

/** Facts the strict category x state gate reads (cron and tests). */
export interface SettingStateIndexFacts {
  /**
   * Distinct postings for the setting in the state. For the work-mode
   * settings (STRUCTURED_REMOTE_SETTING_SLUGS) only fully remote rows count.
   */
  postings: number;
  /** Distinct employers behind them. */
  employers: number;
  /** Distinct (employer, normalized title) pairs behind them. */
  roleClusters: number;
  /** Postings held by the largest employer. */
  topEmployerPostings: number;
  /** The parent /jobs/state hub's own index verdict (shouldIndexStateHub). */
  hubIndexable: boolean;
  /** Distinct postings on the parent state hub. */
  hubPostings: number;
  /**
   * Counted rows first posted in the last 30 days (originalPostedAt, else
   * createdAt: the recency the listing facts use).
   */
  postedLast30Days: number;
}

/**
 * Category x state (`/jobs/{category}/{state}`): renders at 1 or more jobs
 * (0 stays 404). The strict gate of CQ-01 and fixSoon 16: page 1 only, and
 * every one of
 *   - MIN_POSTINGS_FOR_SETTING_STATE_INDEX or more distinct postings,
 *   - MIN_EMPLOYERS_FOR_SETTING_STATE_INDEX or more employers,
 *   - MIN_ROLE_CLUSTERS_FOR_SETTING_STATE_INDEX or more role clusters,
 *   - the largest employer at MAX_TOP_EMPLOYER_SHARE_FOR_SETTING_STATE_INDEX
 *     of the postings or less,
 *   - an indexable parent state hub,
 *   - the setting at MAX_HUB_SHARE_FOR_SETTING_STATE_INDEX of the hub's
 *     postings or less,
 *   - MIN_RECENT_POSTINGS_FOR_SETTING_STATE_INDEX or more postings first
 *     posted in the last 30 days.
 * The old "3 jobs plus any 2 of 5 soft signals" rule is gone: named cities,
 * role setup and recency are satisfied by almost any three postings.
 *
 * One more rule needs every setting of the state at once, so the cron
 * applies it after this gate: of two passing siblings that share
 * MAX_SIBLING_OVERLAP_FOR_SETTING_STATE_INDEX or more of their jobs, only
 * the larger keeps its verdict (dedupeSiblingSettingStates in
 * lib/pseo/setting-state-index.ts).
 *
 * This is the verdict the cron stores. Whether a page actually indexes is
 * isSettingStateIndexable(stored verdict), which also reads the FB-1 switch.
 */
export function shouldIndexSettingState(facts: SettingStateIndexFacts, page: number = 1): boolean {
  if (!isFirstPage(page)) return false;
  if (!(facts.postedLast30Days >= MIN_RECENT_POSTINGS_FOR_SETTING_STATE_INDEX)) return false;
  if (facts.postings < MIN_POSTINGS_FOR_SETTING_STATE_INDEX) return false;
  if (facts.employers < MIN_EMPLOYERS_FOR_SETTING_STATE_INDEX) return false;
  if (facts.roleClusters < MIN_ROLE_CLUSTERS_FOR_SETTING_STATE_INDEX) return false;
  if (!(facts.topEmployerPostings / facts.postings <= MAX_TOP_EMPLOYER_SHARE_FOR_SETTING_STATE_INDEX)) return false;
  if (facts.hubIndexable !== true) return false;
  return facts.hubPostings > 0 && facts.postings / facts.hubPostings <= MAX_HUB_SHARE_FOR_SETTING_STATE_INDEX;
}

/**
 * Whether a category x state page indexes, from the cron's stored verdict:
 * only while SETTING_STATE_INDEXING_ENABLED is on. Every reader of the
 * stored setting-state `indexable` flag (page robots, the cities sitemap,
 * the sitemap index, link lists that promise an indexable target, the admin
 * coverage count) goes through this, so the switch reaches all of them at
 * deploy. tests/regressions/setting-state-switch-readers.test.ts finds the
 * readers by what they select and pins each one to this function.
 */
export function isSettingStateIndexable(
  storedVerdict: boolean,
  enabled: boolean = SETTING_STATE_INDEXING_ENABLED,
): boolean {
  return enabled === true && storedVerdict === true;
}

export interface LocalListingIndexInput extends ListingFloorInput {
  /** Defaults to 1. */
  page?: number;
}

/**
 * Category x city and city pages (render at 3 or more, unchanged): index
 * page 1 only at the listing floor. The city page is the parent of its
 * category x city pages, so both read one floor; a child indexing below its
 * parent's floor would invert the hierarchy.
 */
export function shouldIndexLocalListingPage(input: LocalListingIndexInput): boolean {
  return isFirstPage(input.page ?? 1) && meetsListingFloor(input);
}

export interface StateHubIndexInput {
  /** Distinct postings in the state. */
  activeJobs: number;
  /**
   * Distinct employers in the state. Optional only so a caller that has not
   * been updated yet still compiles: an absent count gates CLOSED, so such a
   * caller (a sitemap) can under-list hubs but never list a noindex hub.
   */
  distinctEmployers?: number;
  /** Sections that rendered from in-state live aggregates. */
  liveDataSections: number;
  /** Defaults to 1. */
  page?: number;
}

/**
 * State hub (`/jobs/state/{state}`, renders at 1 or more): index page 1 at
 * the listing floor (CQ-07) AND MIN_DATA_SECTIONS_FOR_STATE_HUB_INDEX or
 * more live data sections. lib/pseo/state-hub-index.ts computes the input
 * for the page, the cron and the sitemap from one set of rules.
 */
export function shouldIndexStateHub(input: StateHubIndexInput): boolean {
  return (
    isFirstPage(input.page ?? 1) &&
    input.activeJobs >= MIN_JOBS_FOR_STATE_HUB_INDEX &&
    (input.distinctEmployers ?? Number.NaN) >= MIN_EMPLOYERS_FOR_STATE_HUB_INDEX &&
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
 * directory with fewer duplicates the hub's city grid.
 */
export function shouldIndexStateCityDirectory(input: StateCityDirectoryIndexInput): boolean {
  return input.linkableCities >= MIN_LINKABLE_CITIES_FOR_DIRECTORY_INDEX;
}

export interface MetroIndexInput {
  /** Distinct postings inside metroScopeWhere(metro). */
  activeJobs: number;
  /**
   * Postings first posted in the last 30 days. Optional only so a caller
   * that has not been updated yet still compiles: an absent count gates
   * CLOSED (under-listing, never a noindex URL in a sitemap).
   */
  postedLast30Days?: number;
}

/**
 * Metro guide (`/jobs/metro/{slug}`; renders for every curated slug): index
 * with MIN_JOBS_FOR_METRO_INDEX or more distinct postings, at least
 * MIN_RECENT_POSTINGS_FOR_METRO_INDEX of them posted in the last 30 days.
 */
export function shouldIndexMetro(input: MetroIndexInput): boolean {
  return (
    input.activeJobs >= MIN_JOBS_FOR_METRO_INDEX &&
    (input.postedLast30Days ?? Number.NaN) >= MIN_RECENT_POSTINGS_FOR_METRO_INDEX
  );
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
 * sentence. A render gate, not an index gate.
 */
export function shouldRenderMarketSnapshot(activeJobs: number): boolean {
  return activeJobs >= MIN_ACTIVE_JOBS_FOR_MARKET_SNAPSHOT;
}
