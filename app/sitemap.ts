import { brand } from '@/config/brand'
import { MetadataRoute } from 'next'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { getAllPublishedSlugs } from '@/lib/blog'
import { METRO_CITIES, type MetroCity } from '@/lib/metro-data'
import { activeIndexableJobWhere } from '@/lib/active-job-filter'
// pSEO index gates (PLAN C.2): every inventory-gated section below reads
// the SAME pure function its page's robots call, over counts taken with the
// canonical predicate (lib/canonical-counts.ts) that lib/pseo/listing-facts.ts
// feeds every page with, so a sitemap URL can never be one the page renders
// noindex (outside the PSEO_STATS_MAX_AGE_HOURS window accepted for stored
// stats).
import { canonicalBucketWhere } from '@/lib/canonical-counts'
import {
  pseoStatsFreshnessThreshold,
  shouldIndexCategoryLanding,
  shouldIndexCompanyProfile,
  shouldIndexLocalListingPage,
  shouldIndexMetro,
  shouldIndexStateCityDirectory,
  type LocalListingIndexInput,
  type MetroIndexInput,
} from '@/lib/pseo/render-gate'
import { metroScopeWhere } from '@/lib/pseo/listing-facts'
import { landingBucketWhere } from '@/lib/pseo/landing-where'
// The state hub verdicts and the city and metro gate inputs come from the
// shared layer the pages and the aggregate-pseo cron read (distinct postings,
// the listing floor, the metro recency condition; indexing audit fixSoon 1
// and 8, CQ-07, CQ-08), so this file keeps no copy of any of them.
import { loadStateHubVerdicts, type StateHubVerdict } from '@/lib/pseo/state-hub-index'
import { cityIndexKey, loadCityIndexInputs, loadMetroIndexInput } from '@/lib/pseo/sitemap-index-inputs'
import { getPublishableSalaryGuideStates } from '@/lib/salary-analytics'
import { getAllLicenseGuideSlugs, getIndexableLicenseGuideSlugs, getLicenseGuideReviewedAt } from '@/lib/blog-license-guides'
import { ALL_CATEGORY_SLUGS } from '@/lib/pseo/taxonomy-registry'
// Drift-proof registries (P1 #7, P1 #18, P2 #4/#5/#6/#17, P5 A2/A7/A8):
// specialty slugs, JD-template ids, tool paths, comparison paths and report
// editions come from the same plain-data modules the pages render from, so
// the sitemap can never advertise a path the app would 404 on. The salary
// specialty list is the pages' own index verdict over the specialty config
// (FB-2): the same getSalarySpecialtyIndexBasis the page robots call.
import { getIndexableSalarySpecialtySlugs, SALARY_SPECIALTY_SLUGS_INDEXABLE_WITHOUT_DB, specialtyTagWhere } from '@/lib/salary-guide-specialty'
import { getSpecialtySalaryPage } from '@/app/salary-guide/specialty/specialty-config'
import { JD_TEMPLATES } from '@/lib/jd-templates'
import { TOOL_PATHS, TOOLS_HUB_PATH } from '@/app/tools/tools-registry'
import { COMPARE_HUB_PATH, COMPARE_PAGE_PATHS, COMPARE_REVIEW_DATE } from '@/lib/compare-data'
import { REPORTS_HUB_PATH, ALL_REPORTS } from '@/lib/reports/editions'
// P2 #12: per-state city directories. These helpers ARE the render gate:
// app/jobs/locations/[state]/page.tsx notFound()s on
// !shouldRenderStateCityDirectory and the locations hub links with the
// identical call, so reading them here keeps 404s out of the sitemap.
import {
  buildCitySlug,
  buildStateCityDirectory,
  cityLinkResolves,
  shouldRenderStateCityDirectory,
  tallyDirectoryCities,
} from '@/app/jobs/locations/[state]/directory'
// Name to code map shared with the directory page and the locations hub.
import { STATE_CODES } from '@/lib/pseo/setting-state-config'
// The profile route's own slug (display name), so a listed URL never 308s.
import { companyProfilePath, companySlugFor } from '@/lib/company-slug'
// Content lastmod (indexing audit CS-02): jobs by Job.contentChangedAt,
// code-authored pages by their copy dates; never a write or cron timestamp.
import { JOB_CONTENT_DATE_FIELDS, jobContentDate, latestJobContentDate, latestOf, pageContentDate } from '@/app/api/sitemaps/lastmod'
// FB-4 / fixSoon 15: the state artwork rides on the gated state entries.
import { stateDioramaSitemapImages } from '@/lib/image-seo'
// P2 #21: the budget guard pages the team channel, not only a log line.
import { sendDiscordMessage } from '@/lib/discord-notifier'

// GSC Fix: Cache sitemap for 1 hour. Without this, every Googlebot request to
// /sitemap.xml triggers a full DB scan across jobs, companies, and blog tables.
export const revalidate = 3600;

// SEO fix (B28): activeIndexableJobWhere() bakes `now` into its where clause,
// so it is computed per request inside sitemap(), never at module scope (a
// warm instance kept expired jobs in the sitemap that middleware served 410).

type SitemapEntry = MetadataRoute.Sitemap[number]

// ── Sitemap budget guard (P2 #21) ────────────────────────────────────────────
// Google rejects a sitemap over 50,000 URLs (the WHOLE file, not the excess),
// so crossing the cap silently stops recrawls sitewide. Thresholds are named
// here because the alert copy quotes them.
const SITEMAP_BUDGET_WARN = 40000;
const SITEMAP_BUDGET_CRITICAL = 48000;

/** One budget alert per severity per hour, per warm instance. */
const sitemapBudgetAlertSeen = new Map<string, number>();
const SITEMAP_ALERT_COOLDOWN_MS = 60 * 60 * 1000;

/**
 * Page the team channel when the primary sitemap approaches (or crosses) the
 * 50k cap. Fire-and-forget: a Discord outage must never break /sitemap.xml,
 * so the promise is voided and its rejection swallowed into a log line.
 * sendDiscordMessage() already no-ops when DISCORD_WEBHOOK_URL is unset.
 */
function notifySitemapBudget(severity: 'warn' | 'critical', entryCount: number): void {
  const last = sitemapBudgetAlertSeen.get(severity) ?? 0
  if (Date.now() - last < SITEMAP_ALERT_COOLDOWN_MS) return
  sitemapBudgetAlertSeen.set(severity, Date.now())

  const critical = severity === 'critical'
  void sendDiscordMessage('', [
    {
      title: critical ? '🚨 Sitemap over budget' : '⚠️ Sitemap approaching budget',
      description: critical
        ? `Primary sitemap is ${entryCount.toLocaleString()} entries (cap 50,000). Google may reject the whole file: split job pages into /api/sitemaps/jobs/[batch] now.`
        : `Primary sitemap is ${entryCount.toLocaleString()} entries (cap 50,000). Plan the split into /api/sitemaps/jobs/[batch] before ${SITEMAP_BUDGET_CRITICAL.toLocaleString()}.`,
      color: critical ? 0xff0000 : 0xffaa00,
    },
  ]).catch((err) =>
    logger.warn('[sitemap] budget Discord alert failed', { error: err instanceof Error ? err.message : String(err) }),
  )
}

// All 50 US states + DC
const US_STATES = [
  'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado',
  'connecticut', 'delaware', 'florida', 'georgia', 'hawaii', 'idaho',
  'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana',
  'maine', 'maryland', 'massachusetts', 'michigan', 'minnesota',
  'mississippi', 'missouri', 'montana', 'nebraska', 'nevada',
  'new-hampshire', 'new-jersey', 'new-mexico', 'new-york',
  'north-carolina', 'north-dakota', 'ohio', 'oklahoma', 'oregon',
  'pennsylvania', 'rhode-island', 'south-carolina', 'south-dakota',
  'tennessee', 'texas', 'utah', 'vermont', 'virginia', 'washington',
  'west-virginia', 'wisconsin', 'wyoming', 'district-of-columbia'
]

/** The sitemap's slug form of a Job.state name ("New York" to "new-york"). */
const slugify = (s: string): string => s.toLowerCase().replace(/\s+/g, '-')

/**
 * Company profiles: shouldIndexCompanyProfile indexes at 5 or more active
 * jobs, but this sitemap keeps the stricter floor of 8 it has carried until
 * the first re-crawl after the robots change ships (PLAN C.2). Delete this
 * constant and its clause then, so the gate function alone decides.
 */
const SITEMAP_COMPANY_MIN_JOBS_UNTIL_RECRAWL = 8

// ── pSEO gate reads ──────────────────────────────────────────────────────────

/**
 * A gate read that fails on its own omits its section (omitting a URL can
 * never advertise a noindex page) instead of degrading the whole sitemap to
 * static pages. The inventory queries the sections were already built on
 * keep the outer fail-fast behaviour.
 */
async function gateRead<T>(label: string, fallback: T, read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch (error) {
    logger.warn(`[sitemap] ${label} unavailable; omitting its pSEO URLs`, {
      error: error instanceof Error ? error.message : String(error),
    })
    return fallback
  }
}

/** A lastmod read that fails leaves the entry undated rather than guessing (CS-02). */
async function dateRead(label: string, read: () => Promise<Date | null>): Promise<Date | undefined> {
  try {
    return (await read()) ?? undefined
  } catch (error) {
    logger.warn(`[sitemap] ${label} unavailable; omitting its lastmod`, {
      error: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }
}

/** A fresh 'category-landing' PseoStats row (locationSlug 'all', PLAN C.2). */
interface LandingStatsRow {
  categorySlug: string
  totalJobs: number
  distinctEmployers: number
  /** The cron's stored shouldIndexCategoryLanding verdict over distinct postings. */
  indexable: boolean
  /** The cron's heartbeat: the freshness filter reads it; it is never a lastmod. */
  updatedAt: Date
}

/**
 * Category landings: one 'category-landing' row per slug written by
 * aggregate-pseo from the landing's own bucket, read inside the
 * PSEO_STATS_MAX_AGE_HOURS window. A landing is listed only when the row's
 * stored verdict (the listing floor over distinct postings, the function its
 * robots call through lib/pseo/category-metadata.ts) is true AND the row's
 * counts still clear shouldIndexCategoryLanding, so a row written before a
 * floor change can never list a landing the page now noindexes. No fresh
 * row means not advertised.
 */
async function fetchFreshLandingRows(): Promise<Map<string, LandingStatsRow>> {
  const rows = await prisma.pseoStats.findMany({
    where: { type: 'category-landing', locationSlug: 'all', updatedAt: { gte: pseoStatsFreshnessThreshold() } },
    select: { categorySlug: true, totalJobs: true, distinctEmployers: true, indexable: true, updatedAt: true },
  })
  return new Map((Array.isArray(rows) ? rows : []).map((row) => [row.categorySlug, row]))
}

/**
 * States whose /salary-guide/[state] publishes a gated median, as sitemap
 * slugs. getPublishableSalaryGuideStates() returns Job.state names and is
 * the same gate over the same pool as the page's shouldIndexSalaryGuideState
 * (lib/salary-analytics.ts), so the guide and the sitemap cannot disagree.
 */
async function fetchPublishableSalaryStateSlugs(): Promise<Set<string>> {
  const names = await getPublishableSalaryGuideStates()
  return new Set([...names].map((name) => slugify(name.trim())))
}

/**
 * A metro guide's lastmod: the newest content change among the canonical
 * jobs inside the shared metro scope (thin-spec-3 M3). The index decision
 * reads loadMetroIndexInput (distinct postings and the 30-day recency count).
 */
async function metroContentDate(metro: MetroCity, now: Date): Promise<Date | null> {
  return latestJobContentDate(canonicalBucketWhere(metroScopeWhere(metro), now))
}

/**
 * Primary sitemap: core pages, blog, state pages, category landings, metros,
 * cities, directories and companies. Category x City and Category x State
 * pages are served via /api/sitemaps/cities/[batch] (see API routes).
 * This keeps each sitemap under Google's 50K URL limit.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || brand.baseUrl
  const now = new Date()

  // Shared filter: published, not expired, and not a repeated dead link (S6).
  // Computed per-request (B28) so `now` is never stale on warm instances.
  // Used by the company block and the sanity floor. The company profile's
  // robots and 404 gate read this same helper on purpose (thin-spec-4 5.5
  // keeps robots, this sitemap and the 404 gate on one count); the pSEO gates
  // count with canonicalBucketWhere, and the middleware's company 410 gate
  // re-implements those canonical semantics at the edge. The two predicates
  // are numerically identical today (both carry GLOBAL_EXCLUSIONS).
  const ACTIVE_JOB_WHERE = activeIndexableJobWhere()

  // CS-02: the pages whose main content is the live job list (/, /jobs,
  // /companies, /jobs/locations) or figures computed from all of it (the
  // salary guide hub, the specialty hub, the reports) are dated by the newest
  // content change among live jobs. Undated when that read fails, never
  // "now": a guessed date is the defect this replaces.
  const latestJobDate = await dateRead('latest job content date', () => latestJobContentDate(ACTIVE_JOB_WHERE))

  // Static pages. Deliberately NOT listed: /post-job (thin-spec-4 O1: its
  // server HTML is an empty client form, so app/post-job/layout.tsx renders
  // `noindex, follow`; /for-employers and /pricing carry the intent),
  // /job-alerts (noindexed bare subscription form, audit 15), /testimonials
  // (notFound()s until a consented testimonial is featured) and
  // /jobs/new-grad (a registry category slug: categoryLandingPages emits it
  // when its landing indexes; a second static entry duplicated the <loc>).
  // Code-authored pages carry their copy date (pageContentDate, CS-02).
  const staticPages: MetadataRoute.Sitemap = [
    { url: baseUrl, lastModified: latestJobDate, changeFrequency: 'daily', priority: 1.0 },
    { url: `${baseUrl}/jobs`, lastModified: latestJobDate, changeFrequency: 'hourly', priority: 0.9 },
    { url: `${baseUrl}/for-employers`, lastModified: pageContentDate('/for-employers'), changeFrequency: 'weekly', priority: 0.7 },
    { url: `${baseUrl}/for-job-seekers`, lastModified: pageContentDate('/for-job-seekers'), changeFrequency: 'weekly', priority: 0.7 },
    { url: `${baseUrl}/about`, lastModified: pageContentDate('/about'), changeFrequency: 'monthly', priority: 0.5 },
    // P1 #8 (E-E-A-T): /editorial-policy is the indexable trust page every
    // stat-bearing article cites via brand.editorial.policyPath.
    { url: `${baseUrl}/editorial-policy`, lastModified: pageContentDate('/editorial-policy'), changeFrequency: 'monthly', priority: 0.5 },
    { url: `${baseUrl}/faq`, lastModified: pageContentDate('/faq'), changeFrequency: 'monthly', priority: 0.5 },
    { url: `${baseUrl}/contact`, lastModified: pageContentDate('/contact'), changeFrequency: 'monthly', priority: 0.4 },
    { url: `${baseUrl}/terms`, lastModified: pageContentDate('/terms'), changeFrequency: 'yearly', priority: 0.3 },
    { url: `${baseUrl}/privacy`, lastModified: pageContentDate('/privacy'), changeFrequency: 'yearly', priority: 0.3 },
    { url: `${baseUrl}/pricing`, lastModified: pageContentDate('/pricing'), changeFrequency: 'monthly', priority: 0.7 },
    // Content audit P0 #7: the employer-directory hub, the program-director
    // funnel and the two trust/legal pages were indexable but unadvertised.
    { url: `${baseUrl}/companies`, lastModified: latestJobDate, changeFrequency: 'daily', priority: 0.7 },
    { url: `${baseUrl}/for-programs`, lastModified: pageContentDate('/for-programs'), changeFrequency: 'monthly', priority: 0.6 },
    { url: `${baseUrl}/security`, lastModified: pageContentDate('/security'), changeFrequency: 'yearly', priority: 0.3 },
    { url: `${baseUrl}/sub-processors`, lastModified: pageContentDate('/sub-processors'), changeFrequency: 'yearly', priority: 0.3 },
    // Content audit P2 #9 (trust cluster): both `index: true`, footer-linked
    // from components/Footer.tsx; same orphan class as P0 #7.
    { url: `${baseUrl}/accessibility`, lastModified: pageContentDate('/accessibility'), changeFrequency: 'yearly', priority: 0.3 },
    { url: `${baseUrl}/press`, lastModified: pageContentDate('/press'), changeFrequency: 'monthly', priority: 0.4 },
  ]

  // /blog lists the posts, so its lastmod is the newest listed post's
  // (CS-02), set once the posts are read; undated until then.
  let blogHubLastmod: Date | undefined
  const blogHubPage = (): SitemapEntry => ({
    url: `${baseUrl}/blog`,
    lastModified: blogHubLastmod,
    changeFrequency: 'weekly',
    priority: 0.9,
  })

  // Inventory-gated sections default to EMPTY. Each of these page types
  // renders `noindex, follow` below its index gate (lib/pseo/render-gate.ts),
  // and with the DB down we cannot tell which pass, so the degraded-mode
  // fallback used by the outer catch advertises none of them rather than a
  // noindex page (the GSC defect the gates exist to remove). Directories
  // additionally hard-404 below their render gate.
  let metroPages: MetadataRoute.Sitemap = []
  let categoryLandingPages: MetadataRoute.Sitemap = []
  let statePages: MetadataRoute.Sitemap = []
  let salaryGuideStatePages: MetadataRoute.Sitemap = []
  let stateCityDirectoryPages: MetadataRoute.Sitemap = []

  // License guides (PLAN C.2, thin-spec-4 3C; audit CQ-03 / FB-2): listed
  // from the registry that renders them (lib/blog-license-guides.ts), so the
  // list cannot depend on the blog table being readable. Only a guide whose
  // state's facts are verified in lib/license-guide-facts.ts is listed: every
  // other guide renders "noindex, follow" from the same predicate, so none is
  // listed until the research pass verifies a state. The skip set holds all
  // 51, so a guide synced into blog_posts is never listed through the blog
  // rows either. lastmod is the guide's own review date (the series review,
  // or its latest fact check if later), or a synced row's updated_at when
  // that is later (applied inside the try block, which also drops a guide an
  // editor took down, since its URL answers 404).
  const licenseGuideSlugs = getIndexableLicenseGuideSlugs()
  const licenseGuideSlugSet = new Set(getAllLicenseGuideSlugs())
  const licenseGuideReviewedAt = (slug: string): Date =>
    new Date(getLicenseGuideReviewedAt(slug.replace(/^np-license-/, '')))
  const licenseGuidePage = (slug: string, lastModified: Date): SitemapEntry => ({
    url: `${baseUrl}/blog/${slug}`,
    lastModified,
    changeFrequency: 'monthly',
    priority: 0.7,
  })
  let licenseGuidePages: MetadataRoute.Sitemap = licenseGuideSlugs.map((slug) => licenseGuidePage(slug, licenseGuideReviewedAt(slug)))

  // Other landing pages. The salary guide hub prints medians computed from
  // live postings, so it is dated like the listings; the rest are copy.
  const landingPages: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/salary-guide`, lastModified: latestJobDate, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${baseUrl}/resources`, lastModified: pageContentDate('/resources'), changeFrequency: 'weekly', priority: 0.8 },
    { url: `${baseUrl}/jobs/locations`, lastModified: latestJobDate, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${baseUrl}/resources/fpa-guide`, lastModified: pageContentDate('/resources/fpa-guide'), changeFrequency: 'monthly', priority: 0.8 },
    { url: `${baseUrl}/resources/private-practice-guide`, lastModified: pageContentDate('/resources/private-practice-guide'), changeFrequency: 'monthly', priority: 0.8 },
    { url: `${baseUrl}/resources/1099-vs-w2`, lastModified: pageContentDate('/resources/1099-vs-w2'), changeFrequency: 'monthly', priority: 0.8 },
  ]

  // Repo-authored clusters that always render in full (no soft-404 risk),
  // each with a self canonical and no `robots: { index: false }`: the tools
  // hub and its pages (P2 #4/#5/#6/#17), the comparison cluster (P5 A2),
  // the scope-of-practice hub (P5 A4), the market reports (P5 A7/A8, whose
  // bodies recompute from live inventory so the newest-job date is the
  // honest lastmod), the salary specialty pages (P1 #7, live medians,
  // listed only while their own index verdict holds) and the employer
  // content hub (P1 #18). Leaving any of them out would be the orphan defect
  // P0 #7 fixed. /admin/companies and /api/admin/* from the same waves are
  // deliberately NOT here.
  const toolPages: MetadataRoute.Sitemap = [
    { url: `${baseUrl}${TOOLS_HUB_PATH}`, lastModified: pageContentDate(TOOLS_HUB_PATH), changeFrequency: 'monthly', priority: 0.8 },
    ...TOOL_PATHS.map(path => ({
      url: `${baseUrl}${path}`,
      lastModified: pageContentDate(path),
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    })),
  ]
  // A comparison page is dated by its claims review (COMPARE_REVIEW_DATE),
  // or by a later copy or link change recorded in PAGE_CONTENT_DATES (CQ-13
  // relinked the Indeed and ENP Network licensure rows). The hub renders only
  // each profile's meta title and description, so the review date holds.
  const P5_CONTENT_DATE = new Date(COMPARE_REVIEW_DATE)
  const comparePages: MetadataRoute.Sitemap = [
    { url: `${baseUrl}${COMPARE_HUB_PATH}`, lastModified: P5_CONTENT_DATE, changeFrequency: 'monthly', priority: 0.6 },
    ...COMPARE_PAGE_PATHS.map(path => ({
      url: `${baseUrl}${path}`,
      lastModified: latestOf(P5_CONTENT_DATE, pageContentDate(path)) ?? P5_CONTENT_DATE,
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    })),
  ]
  const scopeOfPracticePages: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/scope-of-practice`, lastModified: pageContentDate('/scope-of-practice'), changeFrequency: 'monthly', priority: 0.8 },
  ]
  const reportPages: MetadataRoute.Sitemap = [
    { url: `${baseUrl}${REPORTS_HUB_PATH}`, lastModified: latestJobDate, changeFrequency: 'weekly', priority: 0.7 },
    ...ALL_REPORTS.map(report => ({
      url: `${baseUrl}${report.path}`,
      lastModified: latestJobDate,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
  ]
  // FB-2: a specialty page is listed only while it indexes. The page robots
  // and this list call the same verdict (getSalarySpecialtyIndexBasis,
  // lib/salary-guide-specialty.ts), so they cannot disagree; with the
  // database unreachable only the slugs that index on a cited occupation
  // median alone are listed.
  const salarySpecialtySlugs = await gateRead(
    'salary specialty verdicts',
    [...SALARY_SPECIALTY_SLUGS_INDEXABLE_WITHOUT_DB],
    getIndexableSalarySpecialtySlugs,
  )
  // CS-02: each specialty page renders only its own specialty's jobs
  // (specialtyTagWhere) and the shared specialty template, so it is dated by
  // the newest content change among those jobs, or by the template's copy
  // date when that is later; never by a job in another specialty. The hub
  // aggregates across every specialty, so it keeps the site-wide date.
  const specialtyTemplateDate = pageContentDate('/salary-guide/specialty/[specialty]')
  const specialtyLastmods = await Promise.all(salarySpecialtySlugs.map((slug) => {
    const page = getSpecialtySalaryPage(slug)
    return page
      ? dateRead(`${slug} specialty lastmod`, () => latestJobContentDate(canonicalBucketWhere(specialtyTagWhere(page.slug), now)))
      : Promise.resolve(undefined)
  }))
  const salarySpecialtyPages: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/salary-guide/specialty`, lastModified: latestJobDate, changeFrequency: 'weekly', priority: 0.7 },
    ...salarySpecialtySlugs.map((slug, i) => ({
      url: `${baseUrl}/salary-guide/specialty/${slug}`,
      lastModified: latestOf(specialtyLastmods[i], specialtyTemplateDate) ?? undefined,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
  ]
  const employerResourcePages: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/for-employers/resources`, lastModified: pageContentDate('/for-employers/resources'), changeFrequency: 'monthly', priority: 0.7 },
    { url: `${baseUrl}/for-employers/resources/how-to-hire`, lastModified: pageContentDate('/for-employers/resources/how-to-hire'), changeFrequency: 'monthly', priority: 0.7 },
    { url: `${baseUrl}/for-employers/resources/job-description-guide`, lastModified: pageContentDate('/for-employers/resources/job-description-guide'), changeFrequency: 'monthly', priority: 0.7 },
    { url: `${baseUrl}/for-employers/resources/job-description-templates`, lastModified: pageContentDate('/for-employers/resources/job-description-templates'), changeFrequency: 'monthly', priority: 0.7 },
    ...JD_TEMPLATES.map(t => ({
      url: `${baseUrl}/for-employers/resources/job-description-templates/${t.id}`,
      lastModified: pageContentDate('/for-employers/resources/job-description-templates/[id]'),
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    })),
  ]

  // Category x State pages are handled by /api/sitemaps/cities/[batch] (which
  // emits both category x city AND setting x state URLs from the PseoStats
  // index-gate columns). Kept empty here so no <loc> is duplicated across
  // sitemap files.
  const categoryStatePages: MetadataRoute.Sitemap = [];

  try {
    // Blog pages. The license guides are emitted from the registry above,
    // so they are filtered out here and a guide is never listed twice; a
    // DB-synced guide only lends its updated_at to the registry entry.
    const blogSlugs = await getAllPublishedSlugs();
    const blogUpdatedAt = new Map(blogSlugs.map((post) => [post.slug, new Date(post.updated_at)]));
    // A guide an editor took down (an unpublished blog_posts row for its
    // slug) answers 404 from getPostBySlug, and getAllPublishedSlugs leaves
    // it out for that reason. So only an indexable guide that function still
    // returns is listed. It returns every guide not taken down, from the DB
    // or the code fallback, and fails open when a read fails, so no live
    // guide is dropped. The registry default above covers the outer catch.
    licenseGuidePages = licenseGuideSlugs
      .filter((slug) => blogUpdatedAt.has(slug))
      .map((slug) => {
        const reviewed = licenseGuideReviewedAt(slug)
        const synced = blogUpdatedAt.get(slug)
        return licenseGuidePage(slug, synced && synced > reviewed ? synced : reviewed)
      });
    const blogPages: MetadataRoute.Sitemap = blogSlugs
      .filter((post) => !licenseGuideSlugSet.has(post.slug))
      .map((post) => ({
        url: `${baseUrl}/blog/${post.slug}`,
        // An unparseable updated_at leaves the post undated (an invalid Date would throw in Next's serializer).
        lastModified: latestOf(new Date(post.updated_at)) ?? undefined,
        changeFrequency: 'weekly',
        priority: 0.8,
      }));
    blogHubLastmod = latestOf(...[...blogPages, ...licenseGuidePages].map((page) => page.lastModified as Date | undefined)) ?? undefined;

    // GSC Fix (P3.8): job-detail URLs live in /api/sitemaps/jobs/[batch];
    // the count feeds only the sanity floor at the bottom.
    const activeJobCount = await prisma.job.count({ where: ACTIVE_JOB_WHERE });

    // Category landings (thin-spec-1 8.3, indexing audit fixSoon 1 and
    // CQ-06): gated on the cron's fresh 'category-landing' row, its stored
    // verdict AND the listing floor over its counts (shouldIndexCategoryLanding,
    // 5 or more postings from 3 or more employers). Each listed landing is
    // dated by the newest content change among the jobs in its bucket
    // (landingBucketWhere), not by the cron run that wrote the row.
    const landingRows = await gateRead('category-landing stats', new Map<string, LandingStatsRow>(), fetchFreshLandingRows)
    const listedLandingSlugs = ALL_CATEGORY_SLUGS.filter((slug) => {
      const row = landingRows.get(slug)
      if (!row || !row.indexable || !shouldIndexCategoryLanding({ activeJobs: row.totalJobs, distinctEmployers: row.distinctEmployers })) return false
      return true
    })
    const landingLastmods = await Promise.all(listedLandingSlugs.map((slug) =>
      dateRead(`${slug} landing lastmod`, () => latestJobContentDate(canonicalBucketWhere(landingBucketWhere(slug), now)))))
    categoryLandingPages = listedLandingSlugs.map((slug, i) => (
      { url: `${baseUrl}/jobs/${slug}`, lastModified: landingLastmods[i], changeFrequency: 'daily' as const, priority: 0.9 }
    ))

    // State inventory: canonical jobs per state, plus the newest content
    // change among the jobs feeding each page (B27, CS-02: real per-page
    // lastmod instead of one site-wide date or a write timestamp). The
    // slugify pattern matches US_STATES slugs ("New York" to "new-york").
    const stateJobCounts = await prisma.job.groupBy({
      by: ['state'],
      where: canonicalBucketWhere({ state: { not: null } }, now),
      _count: { state: true },
      _max: JOB_CONTENT_DATE_FIELDS,
    });
    const stateLastmod = new Map<string, Date>();
    const stateActiveJobs = new Map<string, number>();
    for (const r of stateJobCounts) {
      const slug = slugify((r.state || '').trim());
      stateActiveJobs.set(slug, (stateActiveJobs.get(slug) ?? 0) + r._count.state);
      const newest = latestOf(stateLastmod.get(slug), jobContentDate(r._max));
      if (newest) stateLastmod.set(slug, newest);
    }
    const statesWithJobs = new Set(stateActiveJobs.keys());
    const publishableSalaryStates = await gateRead('salary benchmarks', new Set<string>(), fetchPublishableSalaryStateSlugs);

    // State hubs (thin-spec-3 section 7, CQ-07): the page renders at 1 or
    // more jobs and indexes through shouldIndexStateHub at the listing floor
    // (5 or more distinct postings from 3 or more employers) with 4 or more
    // live data sections. loadStateHubVerdicts computes that verdict with the
    // hub page's own rules (lib/pseo/state-hub-index.ts, which the
    // aggregate-pseo cron also reads), so a listed hub is always one the page
    // indexes, and every hub the page indexes is listed (fixSoon 17: Rhode
    // Island indexed while missing here). A failed read omits every hub,
    // never lists a noindex one. Both state surfaces carry the state's
    // diorama, the artwork they render, on their already gated entries
    // (FB-4, fixSoon 15), so no image is offered for a page Google should
    // not index.
    const hubVerdicts = await gateRead('state hub verdicts', new Map<string, StateHubVerdict>(), () => loadStateHubVerdicts(now));
    const indexableHubSlugs = new Set([...hubVerdicts.values()].filter((verdict) => verdict.indexable).map((verdict) => verdict.stateSlug));
    statePages = US_STATES.filter((state) => indexableHubSlugs.has(state)).map(state => ({
      url: `${baseUrl}/jobs/state/${state}`,
      lastModified: stateLastmod.get(state) ?? latestJobDate,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
      images: stateDioramaSitemapImages(state, baseUrl),
    }));

    // /salary-guide/[state] renders at 1 or more active jobs (its own 404
    // gate, getStateActiveJobCount) and indexes only when it publishes a
    // gated median (shouldIndexSalaryGuideState). The active-job set keeps
    // 404s out; the publishable set keeps noindex pages out.
    salaryGuideStatePages = US_STATES.filter(s => statesWithJobs.has(s) && publishableSalaryStates.has(s)).map(state => ({
      url: `${baseUrl}/salary-guide/${state}`,
      lastModified: stateLastmod.get(state) ?? latestJobDate,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
      images: stateDioramaSitemapImages(state, baseUrl),
    }));

    // Metro guides (thin-spec-3 M3, CQ-08): one inventory predicate for page
    // and sitemap, canonicalBucketWhere over the shared metroScopeWhere,
    // gated by shouldIndexMetro over the page's own input (3 or more
    // distinct postings, at least 1 first posted in the last 30 days). The
    // former in-sitemap adjacency copy and its `contains` matcher are gone
    // with it (B33 drift resolved). A failed gate read omits every metro.
    const metroLastmods = await Promise.all(METRO_CITIES.map((metro) =>
      dateRead(`${metro.slug} metro lastmod`, () => metroContentDate(metro, now))));
    const metroIndexInputs = await gateRead('metro index inputs', [] as MetroIndexInput[], () =>
      Promise.all(METRO_CITIES.map((metro) => loadMetroIndexInput(metro, now))));
    metroPages = METRO_CITIES.flatMap((metro, i) => {
      const indexInput = metroIndexInputs[i];
      if (!indexInput || !shouldIndexMetro(indexInput)) return [];
      return [{
        url: `${baseUrl}/jobs/metro/${metro.slug}`,
        lastModified: metroLastmods[i] ?? latestJobDate,
        changeFrequency: 'weekly' as const,
        priority: 0.8,
      }];
    });

    // P2 #12: per-state city directories. A SEPARATE groupBy from
    // `topCities` below (that one is capped and volume-ordered; a truncated
    // tail would understate `trackedCities`, the render gate's input).
    // Gated the way app/jobs/locations/[state]/page.tsx gates itself:
    // canonical predicate, STATE_CODES, cityLinkResolves,
    // shouldRenderStateCityDirectory, plus the shouldIndexStateCityDirectory
    // index gate the page robots read.
    //
    // The page counts `state = name OR stateCode = code`. The first grouping
    // is the name half; the second supplies the code half, which the name
    // grouping alone never saw. Without it a jurisdiction whose rows store a
    // variant state spelling under the right code (District of Columbia rows
    // stored as "DC" or "Washington DC") could render and index on the page
    // while this sitemap left it out. tallyDirectoryCities merges the halves
    // without counting a row twice.
    const directoryCityRows = await prisma.job.groupBy({
      by: ['city', 'state'],
      where: canonicalBucketWhere({ city: { not: null }, state: { not: null } }, now),
      _count: { city: true },
      _max: JOB_CONTENT_DATE_FIELDS,
    });
    const directoryCodeRows = await prisma.job.groupBy({
      by: ['city', 'state', 'stateCode'],
      where: canonicalBucketWhere({ city: { not: null }, stateCode: { in: Object.values(STATE_CODES) } }, now),
      _count: { city: true },
      _max: JOB_CONTENT_DATE_FIELDS,
    });
    const directoryCities = tallyDirectoryCities(
      directoryCityRows.map((row) => ({
        city: row.city,
        state: row.state,
        count: row._count.city,
        newest: jobContentDate(row._max),
      })),
      directoryCodeRows.map((row) => ({
        city: row.city,
        state: row.state,
        stateCode: row.stateCode,
        count: row._count.city,
        newest: jobContentDate(row._max),
      })),
    );
    // US_STATES (the 50 states plus the District of Columbia, the same
    // jurisdictions as STATE_CODES) is a belt-and-braces guard on the slug.
    const usStateSlugs = new Set(US_STATES);
    stateCityDirectoryPages = Object.entries(STATE_CODES)
      .map(([stateName, stateCode]) => {
        const slug = slugify(stateName);
        if (!usStateSlugs.has(slug)) return null;
        const cities = directoryCities.get(stateName);
        const directory = buildStateCityDirectory(cities?.rows ?? [], {
          canLink: (row) => cityLinkResolves(row.city, stateCode),
        });
        if (!shouldRenderStateCityDirectory(directory)) return null;
        if (!shouldIndexStateCityDirectory({ linkableCities: directory.linkable.length })) return null;
        return {
          url: `${baseUrl}/jobs/locations/${slug}`,
          lastModified: cities?.newest ?? latestJobDate,
          changeFrequency: 'weekly' as const,
          priority: 0.7,
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);

    // City pages, bounded with `take: 2000` so cold-cache regeneration never
    // pulls an unbounded distribution into memory; the tail beyond the cap
    // is under the index floor anyway.
    const topCities = await prisma.job.groupBy({
      by: ['city', 'state'],
      where: canonicalBucketWhere({ city: { not: null }, state: { not: null } }, now),
      _count: { city: true },
      _max: JOB_CONTENT_DATE_FIELDS,
      orderBy: { _count: { city: 'desc' } },
      take: 2000,
    })
    // The city page's own gate input per (city, jurisdiction): distinct
    // postings (exact duplicate rows collapsed) and distinct employers, from
    // the shared layer (fixSoon 8). A failed read omits every city page.
    const cityIndexInputs = await gateRead('city index inputs', new Map<string, LocalListingIndexInput>(), () => loadCityIndexInputs(now))

    // P7 runtime fix D4: slugs go through buildCitySlug (trim-safe, the form
    // the city route parses), metro-consolidated slugs are dropped (their
    // /jobs/city URL 308s to the metro twin metroPages already emits),
    // cityLinkResolves vetoes slugs whose lossy round-trip cannot match the
    // stored name ("St. Louis"), and dirty twins ("Boston" + "Boston ")
    // dedupe by slug keeping the freshest lastModified.
    const metroTwinSlugs = new Set(METRO_CITIES.map(m => m.slug));
    const cityPageBySlug = new Map<string, { url: string; lastModified: Date | undefined; changeFrequency: 'weekly'; priority: number }>();
    for (const c of topCities) {
      if (!c.city || !c.state) continue;
      const stateVal = c.state.trim();
      const code = stateVal.length === 2 ? stateVal.toUpperCase() : STATE_CODES[stateVal] || null;
      if (!code) continue;
      // City page index gate (PLAN C.2, CQ-08): the listing floor, 5 or more
      // distinct postings from 3 or more employers, through the same
      // shouldIndexLocalListingPage call the page robots make on its facts.
      const indexInput = cityIndexInputs.get(cityIndexKey(c.city, code));
      if (!indexInput || !shouldIndexLocalListingPage(indexInput)) continue;
      const slug = buildCitySlug(c.city, code);
      if (!slug) continue;
      if (metroTwinSlugs.has(slug)) continue;
      if (!cityLinkResolves(c.city, code)) continue;
      // B27 / CS-02: real per-city freshness, the newest content change
      // among that city's jobs.
      const existing = cityPageBySlug.get(slug);
      const lastModified = latestOf(existing?.lastModified, jobContentDate(c._max)) ?? latestJobDate;
      cityPageBySlug.set(slug, {
        url: `${baseUrl}/jobs/city/${slug}`,
        lastModified,
        changeFrequency: 'weekly' as const,
        priority: 0.7,
      });
    }
    const cityPages: MetadataRoute.Sitemap = [...cityPageBySlug.values()]

    // Company pages: rows that exist in the Company table (regex slugs from
    // job.employer once produced 2,265 dead 404s in GSC) and clear the
    // profile index gate, listed at the profile route's own display-name slug
    // (lib/company-slug.ts) so no listed URL 308s.
    const companiesWithJobs = await prisma.company.findMany({
      where: {
        jobs: {
          some: ACTIVE_JOB_WHERE,
        },
      },
      select: {
        id: true,
        name: true,
        normalizedName: true,
        _count: {
          select: {
            jobs: {
              where: ACTIVE_JOB_WHERE,
            },
          },
        },
      },
    });
    // B27 / CS-02: per-company lastmod, the newest content change among each
    // company's active jobs, in ONE query.
    const companyLastmodRows = await prisma.job.groupBy({
      by: ['companyId'],
      where: { ...ACTIVE_JOB_WHERE, companyId: { not: null } },
      _max: JOB_CONTENT_DATE_FIELDS,
    });
    const companyLastmod = new Map<string, Date>();
    for (const r of companyLastmodRows) {
      const newest = jobContentDate(r._max);
      if (r.companyId && newest) companyLastmod.set(r.companyId, newest);
    }
    // Rows that share a display slug (names differing by case or punctuation
    // alone) are one profile: keep the row the profile route picks
    // (pickCompanyForSlug: more live jobs, then the name that sorts first by
    // plain code unit), so one URL is listed once, for the row it serves.
    const companyBySlug = new Map<string, (typeof companiesWithJobs)[number]>();
    for (const c of companiesWithJobs) {
      const slug = companySlugFor(c);
      const held = companyBySlug.get(slug);
      if (!held || c._count.jobs > held._count.jobs || (c._count.jobs === held._count.jobs && c.name < held.name)) companyBySlug.set(slug, c);
    }
    const companyPages: MetadataRoute.Sitemap = [...companyBySlug.values()]
      // Company index gate (PLAN C.2): shouldIndexCompanyProfile (5 or more
      // active jobs, the profile's robots) plus the stricter floor this
      // sitemap keeps until the first re-crawl.
      .filter(c => shouldIndexCompanyProfile(c._count.jobs) && c._count.jobs >= SITEMAP_COMPANY_MIN_JOBS_UNTIL_RECRAWL)
      .map(c => ({
        url: `${baseUrl}${companyProfilePath(c)}`,
        lastModified: companyLastmod.get(c.id) ?? latestJobDate,
        changeFrequency: 'weekly' as const,
        priority: 0.6,
      }))

    const all = [
      ...staticPages,
      blogHubPage(),
      ...metroPages,
      ...categoryLandingPages,
      ...landingPages,
      ...toolPages,
      ...comparePages,
      ...scopeOfPracticePages,
      ...reportPages,
      ...employerResourcePages,
      ...statePages,
      ...salaryGuideStatePages,
      ...salarySpecialtyPages,
      ...categoryStatePages,
      ...stateCityDirectoryPages,
      ...cityPages,
      ...companyPages,
      ...licenseGuidePages,
      ...blogPages,
      // jobPages intentionally omitted: served by /api/sitemaps/jobs/[batch]
    ]

    // GSC Fix (P3.8) and P2 #21: the 50k cap rejects the whole file, so both
    // thresholds log and page the team channel before it is reached.
    if (all.length > SITEMAP_BUDGET_WARN) {
      logger.warn(`[sitemap] Primary sitemap is ${all.length} entries, approaching Google's 50k limit. Plan to split job pages into /api/sitemaps/jobs/[batch] before exceeding ${SITEMAP_BUDGET_CRITICAL}.`);
      notifySitemapBudget('warn', all.length);
    }
    if (all.length > SITEMAP_BUDGET_CRITICAL) {
      logger.error(`[sitemap] Primary sitemap is ${all.length} entries. Google may reject the whole sitemap (50k cap). Splitting job pages into batches is now mandatory.`);
      notifySitemapBudget('critical', all.length);
    }
    // Sanity floor: zero active jobs means the DB silently failed; fail fast
    // and let the outer catch return the static-only sitemap.
    if (activeJobCount === 0) {
      throw new Error('Sitemap: 0 active jobs returned. DB likely degraded; aborting to avoid empty sitemap.');
    }

    return all
  } catch (error) {
    logger.error('Error generating sitemap, returning static pages only:', error)
    return [
      ...staticPages,
      blogHubPage(),
      ...metroPages,
      ...categoryLandingPages,
      ...landingPages,
      ...toolPages,
      ...comparePages,
      ...scopeOfPracticePages,
      ...reportPages,
      ...employerResourcePages,
      ...statePages,
      ...salaryGuideStatePages,
      ...salarySpecialtyPages,
      ...categoryStatePages,
      ...licenseGuidePages,
      // stateCityDirectoryPages intentionally omitted: empty in degraded
      // mode by design (see its declaration).
    ]
  }
}
