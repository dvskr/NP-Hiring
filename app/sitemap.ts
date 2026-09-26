import { brand } from '@/config/brand'
import { MetadataRoute } from 'next'
import type { Prisma } from '@prisma/client'
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
  shouldIndexCompanyProfile,
  shouldIndexListingPage,
  shouldIndexLocalListingPage,
  shouldIndexMetro,
  shouldIndexStateCityDirectory,
  shouldIndexStateHub,
} from '@/lib/pseo/render-gate'
import { metroScopeWhere, selectEmployers, tallyListingFacts, type ListingFactRow } from '@/lib/pseo/listing-facts'
import {
  buildHubCategoriesSentence,
  buildHubCitiesSentences,
  buildHubEmployersSentence,
  buildHubRecencySentence,
  buildHubSettingsSentence,
  buildHubWorkModeSentence,
} from '@/lib/pseo/listing-narrative'
import { getPublishableSalaryGuideStates } from '@/lib/salary-analytics'
import { getAllLicenseGuideSlugs, LICENSE_GUIDE_REVIEWED_AT } from '@/lib/blog-license-guides'
import { ALL_CATEGORY_SLUGS } from '@/lib/pseo/taxonomy-registry'
// Drift-proof registries (P1 #7, P1 #18, P2 #4/#5/#6/#17, P5 A2/A7/A8):
// specialty slugs, JD-template ids, tool paths, comparison paths and report
// editions come from the same plain-data modules the pages render from, so
// the sitemap can never advertise a path the app would 404 on.
import { SALARY_SPECIALTY_SLUGS } from '@/app/salary-guide/specialty/specialty-config'
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

// State name-to-code lookup for slug generation
const STATE_NAME_TO_CODE: Record<string, string> = {
  'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR',
  'California': 'CA', 'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE',
  'Florida': 'FL', 'Georgia': 'GA', 'Hawaii': 'HI', 'Idaho': 'ID',
  'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA', 'Kansas': 'KS',
  'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
  'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS',
  'Missouri': 'MO', 'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH', 'Oklahoma': 'OK',
  'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT',
  'Vermont': 'VT', 'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV',
  'Wisconsin': 'WI', 'Wyoming': 'WY', 'District of Columbia': 'DC',
}

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

/** A fresh 'category-landing' PseoStats row (locationSlug 'all', PLAN C.2). */
interface LandingStatsRow {
  categorySlug: string
  totalJobs: number
  updatedAt: Date
}

/**
 * Category landings: one 'category-landing' row per slug written by
 * aggregate-pseo from the canonical predicate, read inside the
 * PSEO_STATS_MAX_AGE_HOURS window. The landing indexes through
 * shouldIndexListingPage over that count, the same function its robots call
 * (lib/pseo/category-metadata.ts); no fresh row means not advertised.
 */
async function fetchFreshLandingRows(): Promise<Map<string, LandingStatsRow>> {
  const rows = await prisma.pseoStats.findMany({
    where: { type: 'category-landing', locationSlug: 'all', updatedAt: { gte: pseoStatsFreshnessThreshold() } },
    select: { categorySlug: true, totalJobs: true, updatedAt: true },
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
 * Mirror of the private LISTING_FACT_SELECT in lib/pseo/listing-facts.ts:
 * the projection tallyListingFacts() consumes for the state hub gate.
 */
const HUB_FACT_SELECT = {
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
} as const satisfies Prisma.JobSelect

/** Memory guard; the canonical pool is about one thousand rows today. */
const HUB_FACT_ROW_CAP = 10_000

/** Newest-first canonical rows with a state, bucketed by the state's slug. */
async function fetchHubFactRowsByState(now: Date): Promise<Map<string, ListingFactRow[]>> {
  const rows: ListingFactRow[] = await prisma.job.findMany({
    where: canonicalBucketWhere({ state: { not: null } }, now),
    select: HUB_FACT_SELECT,
    orderBy: { createdAt: 'desc' },
    take: HUB_FACT_ROW_CAP,
  })
  const byState = new Map<string, ListingFactRow[]>()
  for (const row of Array.isArray(rows) ? rows : []) {
    if (typeof row.state !== 'string' || row.state.trim() === '') continue
    const slug = slugify(row.state.trim())
    const bucket = byState.get(slug)
    if (bucket) bucket.push(row)
    else byState.set(slug, [row])
  }
  return byState
}

/**
 * How many of the hub's live data sections (thin-spec-3 S1 to S7) render
 * for a state. Each is decided by the sentence builder the page renders it
 * with (null means the section is omitted), so this is the page's own count;
 * S7 (posted pay) counts only when the state publishes a gated median.
 */
function countHubLiveDataSections(
  rows: readonly ListingFactRow[],
  activeJobs: number,
  publishesMedian: boolean,
  now: Date,
): number {
  const tally = tallyListingFacts(rows, now)
  const stateName = rows[0]?.state?.trim() ?? ''
  const employerFacts = {
    total: activeJobs,
    distinctEmployers: tally.distinctEmployers,
    topEmployers: tally.topEmployers.map(({ name, count }) => ({ name, count, companyPath: null })),
  }
  return [
    buildHubEmployersSentence({ stateName, facts: employerFacts }) !== null, // S1
    buildHubCitiesSentences(tally.cities) !== null, // S2
    buildHubCategoriesSentence(tally.categoryTop) !== null, // S3
    buildHubWorkModeSentence(tally.workMode) !== null, // S4
    buildHubSettingsSentence(tally.settings) !== null, // S5
    buildHubRecencySentence(tally.recency) !== null, // S6
    publishesMedian, // S7
  ].filter(Boolean).length
}

/** Canonical inventory inside the shared metro scope (thin-spec-3 M3). */
async function metroInventory(metro: MetroCity, now: Date): Promise<{ activeJobs: number; newest: Date | null }> {
  const agg = await prisma.job.aggregate({
    where: canonicalBucketWhere(metroScopeWhere(metro), now),
    _count: { _all: true },
    _max: { updatedAt: true },
  })
  return { activeJobs: agg?._count?._all ?? 0, newest: agg?._max?.updatedAt ?? null }
}

/** Lookup key for a (state, city) bucket, case-insensitive like the page query. */
const cityEmployerKey = (state: string, city: string): string =>
  `${state.trim().toLowerCase()}|${city.trim().toLowerCase()}`

/**
 * Distinct employers per (state, city) from one grouped query, merged with
 * the same selectEmployers() alias rule the city page's facts use, so the
 * sitemap's shouldIndexLocalListingPage input is the page's own.
 */
async function fetchDistinctEmployersByCity(now: Date): Promise<Map<string, number>> {
  const groups = await prisma.job.groupBy({
    by: ['city', 'state', 'employer'],
    where: canonicalBucketWhere({ city: { not: null }, state: { not: null } }, now),
    _count: { _all: true },
  })
  const rowsByCity = new Map<string, { employer: string | null; companyId: null }[]>()
  for (const group of Array.isArray(groups) ? groups : []) {
    if (!group.city || !group.state) continue
    const key = cityEmployerKey(group.state, group.city)
    const bucket = rowsByCity.get(key)
    const row = { employer: group.employer, companyId: null }
    if (bucket) bucket.push(row)
    else rowsByCity.set(key, [row])
  }
  return new Map([...rowsByCity].map(([key, rows]) => [key, selectEmployers(rows).distinct]))
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

  // GSC Fix (P1.4): the newest job date, or "now" as a safe live fallback,
  // instead of a hard-coded stamp that made every entry look months old.
  let latestJobDate = new Date();
  const latestJob = await prisma.job.findFirst({
    where: { isPublished: true },
    orderBy: { updatedAt: 'desc' },
    select: { updatedAt: true },
  });
  if (latestJob) latestJobDate = latestJob.updatedAt;

  const STATIC_CONTENT_DATE = new Date('2026-05-04');

  // Static pages. Deliberately NOT listed: /post-job (thin-spec-4 O1: its
  // server HTML is an empty client form, so app/post-job/layout.tsx renders
  // `noindex, follow`; /for-employers and /pricing carry the intent),
  // /job-alerts (noindexed bare subscription form, audit 15), /testimonials
  // (notFound()s until a consented testimonial is featured) and
  // /jobs/new-grad (a registry category slug: categoryLandingPages emits it
  // when its landing indexes; a second static entry duplicated the <loc>).
  const staticPages: MetadataRoute.Sitemap = [
    { url: baseUrl, lastModified: latestJobDate, changeFrequency: 'daily', priority: 1.0 },
    { url: `${baseUrl}/jobs`, lastModified: latestJobDate, changeFrequency: 'hourly', priority: 0.9 },
    { url: `${baseUrl}/blog`, lastModified: latestJobDate, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${baseUrl}/for-employers`, lastModified: STATIC_CONTENT_DATE, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${baseUrl}/for-job-seekers`, lastModified: STATIC_CONTENT_DATE, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${baseUrl}/about`, lastModified: STATIC_CONTENT_DATE, changeFrequency: 'monthly', priority: 0.5 },
    // P1 #8 (E-E-A-T): /editorial-policy is the indexable trust page every
    // stat-bearing article cites via brand.editorial.policyPath.
    { url: `${baseUrl}/editorial-policy`, lastModified: STATIC_CONTENT_DATE, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${baseUrl}/faq`, lastModified: STATIC_CONTENT_DATE, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${baseUrl}/contact`, lastModified: STATIC_CONTENT_DATE, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${baseUrl}/terms`, lastModified: STATIC_CONTENT_DATE, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${baseUrl}/privacy`, lastModified: STATIC_CONTENT_DATE, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${baseUrl}/pricing`, lastModified: STATIC_CONTENT_DATE, changeFrequency: 'monthly', priority: 0.7 },
    // Content audit P0 #7: the employer-directory hub, the program-director
    // funnel and the two trust/legal pages were indexable but unadvertised.
    { url: `${baseUrl}/companies`, lastModified: latestJobDate, changeFrequency: 'daily', priority: 0.7 },
    { url: `${baseUrl}/for-programs`, lastModified: STATIC_CONTENT_DATE, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${baseUrl}/security`, lastModified: STATIC_CONTENT_DATE, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${baseUrl}/sub-processors`, lastModified: STATIC_CONTENT_DATE, changeFrequency: 'yearly', priority: 0.3 },
    // Content audit P2 #9 (trust cluster): both `index: true`, footer-linked
    // from components/Footer.tsx; same orphan class as P0 #7.
    { url: `${baseUrl}/accessibility`, lastModified: STATIC_CONTENT_DATE, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${baseUrl}/press`, lastModified: STATIC_CONTENT_DATE, changeFrequency: 'monthly', priority: 0.4 },
  ]

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

  // License guides (PLAN C.2, thin-spec-4 3C): all 51 come from the registry
  // that renders them (lib/blog-license-guides.ts), so the count cannot
  // depend on the blog table being readable, and they always index. A guide
  // an editor synced into blog_posts takes its DB updated_at as lastmod
  // (applied inside the try block); the rest carry the series review date.
  const licenseGuideSlugs = getAllLicenseGuideSlugs()
  const licenseGuideSlugSet = new Set(licenseGuideSlugs)
  const licenseGuideReviewedAt = new Date(LICENSE_GUIDE_REVIEWED_AT)
  const licenseGuidePage = (slug: string, lastModified: Date): SitemapEntry => ({
    url: `${baseUrl}/blog/${slug}`,
    lastModified,
    changeFrequency: 'monthly',
    priority: 0.7,
  })
  let licenseGuidePages: MetadataRoute.Sitemap = licenseGuideSlugs.map((slug) => licenseGuidePage(slug, licenseGuideReviewedAt))

  // Other landing pages
  const landingPages: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/salary-guide`, lastModified: STATIC_CONTENT_DATE, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${baseUrl}/resources`, lastModified: STATIC_CONTENT_DATE, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${baseUrl}/jobs/locations`, lastModified: latestJobDate, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${baseUrl}/resources/fpa-guide`, lastModified: STATIC_CONTENT_DATE, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${baseUrl}/resources/private-practice-guide`, lastModified: STATIC_CONTENT_DATE, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${baseUrl}/resources/1099-vs-w2`, lastModified: STATIC_CONTENT_DATE, changeFrequency: 'monthly', priority: 0.8 },
  ]

  // Repo-authored clusters that always render in full (no soft-404 risk),
  // each with a self canonical and no `robots: { index: false }`: the tools
  // hub and its pages (P2 #4/#5/#6/#17), the comparison cluster (P5 A2),
  // the scope-of-practice hub (P5 A4), the market reports (P5 A7/A8, whose
  // bodies recompute from live inventory so the newest-job date is the
  // honest lastmod), the salary specialty pages (P1 #7, config-derived
  // bands) and the employer content hub (P1 #18). Leaving any of them out
  // would be the orphan defect P0 #7 fixed. /admin/companies and
  // /api/admin/* from the same waves are deliberately NOT here.
  const toolPages: MetadataRoute.Sitemap = [
    { url: `${baseUrl}${TOOLS_HUB_PATH}`, lastModified: STATIC_CONTENT_DATE, changeFrequency: 'monthly', priority: 0.8 },
    ...TOOL_PATHS.map(path => ({
      url: `${baseUrl}${path}`,
      lastModified: STATIC_CONTENT_DATE,
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    })),
  ]
  const P5_CONTENT_DATE = new Date(COMPARE_REVIEW_DATE)
  const comparePages: MetadataRoute.Sitemap = [
    { url: `${baseUrl}${COMPARE_HUB_PATH}`, lastModified: P5_CONTENT_DATE, changeFrequency: 'monthly', priority: 0.6 },
    ...COMPARE_PAGE_PATHS.map(path => ({
      url: `${baseUrl}${path}`,
      lastModified: P5_CONTENT_DATE,
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    })),
  ]
  const scopeOfPracticePages: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/scope-of-practice`, lastModified: P5_CONTENT_DATE, changeFrequency: 'monthly', priority: 0.8 },
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
  const salarySpecialtyPages: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/salary-guide/specialty`, lastModified: latestJobDate, changeFrequency: 'weekly', priority: 0.7 },
    ...SALARY_SPECIALTY_SLUGS.map(slug => ({
      url: `${baseUrl}/salary-guide/specialty/${slug}`,
      lastModified: latestJobDate,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
  ]
  const employerResourcePages: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/for-employers/resources`, lastModified: STATIC_CONTENT_DATE, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${baseUrl}/for-employers/resources/how-to-hire`, lastModified: STATIC_CONTENT_DATE, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${baseUrl}/for-employers/resources/job-description-guide`, lastModified: STATIC_CONTENT_DATE, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${baseUrl}/for-employers/resources/job-description-templates`, lastModified: STATIC_CONTENT_DATE, changeFrequency: 'monthly', priority: 0.7 },
    ...JD_TEMPLATES.map(t => ({
      url: `${baseUrl}/for-employers/resources/job-description-templates/${t.id}`,
      lastModified: STATIC_CONTENT_DATE,
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
    licenseGuidePages = licenseGuideSlugs.map((slug) => licenseGuidePage(slug, blogUpdatedAt.get(slug) ?? licenseGuideReviewedAt));
    const blogPages: MetadataRoute.Sitemap = blogSlugs
      .filter((post) => !licenseGuideSlugSet.has(post.slug))
      .map((post) => ({
        url: `${baseUrl}/blog/${post.slug}`,
        lastModified: new Date(post.updated_at),
        changeFrequency: 'weekly',
        priority: 0.8,
      }));

    // GSC Fix (P3.8): job-detail URLs live in /api/sitemaps/jobs/[batch];
    // the count feeds only the sanity floor at the bottom.
    const activeJobCount = await prisma.job.count({ where: ACTIVE_JOB_WHERE });

    // Category landings (thin-spec-1 8.3): gated on the cron's fresh
    // 'category-landing' row through shouldIndexListingPage.
    const landingRows = await gateRead('category-landing stats', new Map<string, LandingStatsRow>(), fetchFreshLandingRows)
    categoryLandingPages = ALL_CATEGORY_SLUGS.flatMap((slug) => {
      const row = landingRows.get(slug)
      if (!row || !shouldIndexListingPage(row.totalJobs)) return []
      return [{ url: `${baseUrl}/jobs/${slug}`, lastModified: row.updatedAt, changeFrequency: 'daily' as const, priority: 0.9 }]
    })

    // State inventory: canonical jobs per state, plus the newest job feeding
    // each page (B27: real per-page lastmod instead of one site-wide date,
    // because over-claiming freshness erodes Google's trust in lastmod).
    // The slugify pattern matches US_STATES slugs ("New York" to "new-york").
    const stateJobCounts = await prisma.job.groupBy({
      by: ['state'],
      where: canonicalBucketWhere({ state: { not: null } }, now),
      _count: { state: true },
      _max: { updatedAt: true },
    });
    const stateLastmod = new Map<string, Date>();
    const stateActiveJobs = new Map<string, number>();
    for (const r of stateJobCounts) {
      const slug = slugify((r.state || '').trim());
      stateActiveJobs.set(slug, (stateActiveJobs.get(slug) ?? 0) + r._count.state);
      const seen = stateLastmod.get(slug);
      if (r._max.updatedAt && (!seen || r._max.updatedAt > seen)) stateLastmod.set(slug, r._max.updatedAt);
    }
    const statesWithJobs = new Set(stateActiveJobs.keys());
    const publishableSalaryStates = await gateRead('salary benchmarks', new Set<string>(), fetchPublishableSalaryStateSlugs);

    // State hubs (thin-spec-3 section 7): the page renders at 1 or more jobs
    // and indexes through shouldIndexStateHub over its canonical count and
    // the live data sections it renders, counted here with the same
    // builders. A hub that misses the gate renders `noindex, follow`.
    const hubRowsByState = await gateRead('state hub facts', new Map<string, ListingFactRow[]>(), () => fetchHubFactRowsByState(now));
    statePages = US_STATES.filter((state) => {
      const rows = hubRowsByState.get(state) ?? [];
      const activeJobs = stateActiveJobs.get(state) ?? 0;
      if (rows.length === 0) return false;
      const liveDataSections = countHubLiveDataSections(rows, activeJobs, publishableSalaryStates.has(state), now);
      return shouldIndexStateHub({ activeJobs, liveDataSections });
    }).map(state => ({
      url: `${baseUrl}/jobs/state/${state}`,
      lastModified: stateLastmod.get(state) ?? latestJobDate,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
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
    }));

    // Metro guides (thin-spec-3 M3): one inventory predicate for page and
    // sitemap, canonicalBucketWhere over the shared metroScopeWhere, gated
    // by shouldIndexMetro. The former in-sitemap adjacency copy and its
    // `contains` matcher are gone with it (B33 drift resolved).
    const metroInventories = await Promise.all(METRO_CITIES.map((metro) => metroInventory(metro, now)));
    metroPages = METRO_CITIES.flatMap((metro, i) => {
      const inventory = metroInventories[i];
      if (!shouldIndexMetro({ activeJobs: inventory.activeJobs })) return [];
      return [{
        url: `${baseUrl}/jobs/metro/${metro.slug}`,
        lastModified: inventory.newest ?? latestJobDate,
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
      _max: { updatedAt: true },
    });
    const directoryCodeRows = await prisma.job.groupBy({
      by: ['city', 'state', 'stateCode'],
      where: canonicalBucketWhere({ city: { not: null }, stateCode: { in: Object.values(STATE_CODES) } }, now),
      _count: { city: true },
      _max: { updatedAt: true },
    });
    const directoryCities = tallyDirectoryCities(
      directoryCityRows.map((row) => ({
        city: row.city,
        state: row.state,
        count: row._count.city,
        newest: row._max.updatedAt,
      })),
      directoryCodeRows.map((row) => ({
        city: row.city,
        state: row.state,
        stateCode: row.stateCode,
        count: row._count.city,
        newest: row._max.updatedAt,
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
      _max: { updatedAt: true },
      orderBy: { _count: { city: 'desc' } },
      take: 2000,
    })
    const cityEmployers = await fetchDistinctEmployersByCity(now)

    // P7 runtime fix D4: slugs go through buildCitySlug (trim-safe, the form
    // the city route parses), metro-consolidated slugs are dropped (their
    // /jobs/city URL 308s to the metro twin metroPages already emits),
    // cityLinkResolves vetoes slugs whose lossy round-trip cannot match the
    // stored name ("St. Louis"), and dirty twins ("Boston" + "Boston ")
    // dedupe by slug keeping the freshest lastModified.
    const metroTwinSlugs = new Set(METRO_CITIES.map(m => m.slug));
    const cityPageBySlug = new Map<string, { url: string; lastModified: Date; changeFrequency: 'weekly'; priority: number }>();
    for (const c of topCities) {
      if (!c.city || !c.state) continue;
      // City page index gate (PLAN C.2): MIN_JOBS_FOR_INDEX or more canonical
      // jobs from MIN_EMPLOYERS_FOR_INDEX or more distinct employers, the
      // same shouldIndexLocalListingPage call the page robots make.
      const distinctEmployers = cityEmployers.get(cityEmployerKey(c.state, c.city)) ?? 0;
      if (!shouldIndexLocalListingPage({ activeJobs: c._count.city, distinctEmployers })) continue;
      const stateVal = c.state.trim();
      const code = stateVal.length === 2 ? stateVal.toUpperCase() : STATE_NAME_TO_CODE[stateVal] || null;
      if (!code) continue;
      const slug = buildCitySlug(c.city, code);
      if (!slug) continue;
      if (metroTwinSlugs.has(slug)) continue;
      if (!cityLinkResolves(c.city, code)) continue;
      // B27: real per-city freshness, the newest job in that city.
      const lastModified = c._max.updatedAt ?? latestJobDate;
      const existing = cityPageBySlug.get(slug);
      if (!existing || lastModified > existing.lastModified) {
        cityPageBySlug.set(slug, {
          url: `${baseUrl}/jobs/city/${slug}`,
          lastModified,
          changeFrequency: 'weekly' as const,
          priority: 0.7,
        });
      }
    }
    const cityPages: MetadataRoute.Sitemap = [...cityPageBySlug.values()]

    // Company pages: rows that exist in the Company table (so normalizedName
    // matches what the page resolves; regex slugs from job.employer once
    // produced 2,265 dead 404s in GSC) and clear the profile index gate.
    const companiesWithJobs = await prisma.company.findMany({
      where: {
        jobs: {
          some: ACTIVE_JOB_WHERE,
        },
      },
      select: {
        id: true,
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
    // B27: per-company lastmod, the newest active job per company in ONE query.
    const companyLastmodRows = await prisma.job.groupBy({
      by: ['companyId'],
      where: { ...ACTIVE_JOB_WHERE, companyId: { not: null } },
      _max: { updatedAt: true },
    });
    const companyLastmod = new Map<string, Date>();
    for (const r of companyLastmodRows) {
      if (r.companyId && r._max.updatedAt) companyLastmod.set(r.companyId, r._max.updatedAt);
    }
    const companyPages: MetadataRoute.Sitemap = companiesWithJobs
      // Company index gate (PLAN C.2): shouldIndexCompanyProfile (5 or more
      // active jobs, the profile's robots) plus the stricter floor this
      // sitemap keeps until the first re-crawl.
      .filter(c => shouldIndexCompanyProfile(c._count.jobs) && c._count.jobs >= SITEMAP_COMPANY_MIN_JOBS_UNTIL_RECRAWL)
      .map(c => ({
        // B30: canonical kebab form only. Legacy rows store space-form
        // normalizedName ("life stance"); single-space to hyphen is the exact
        // inverse of the page resolver's legacy fallback, so the URL always
        // round-trips to the stored row.
        url: `${baseUrl}/companies/${c.normalizedName.replace(/ /g, '-')}`,
        lastModified: companyLastmod.get(c.id) ?? latestJobDate,
        changeFrequency: 'weekly' as const,
        priority: 0.6,
      }))

    const all = [
      ...staticPages,
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
