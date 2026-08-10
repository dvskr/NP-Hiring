import { brand } from '@/config/brand'
import { MetadataRoute } from 'next'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { getAllPublishedSlugs } from '@/lib/blog'
import { METRO_CITIES } from '@/lib/metro-data'
import { activeIndexableJobWhere } from '@/lib/active-job-filter'
import { ALL_CATEGORY_SLUGS } from '@/lib/pseo/taxonomy-registry'
// P1 #7: by-specialty salary pages — slugs derive from the same config
// array that renders the pages, so the sitemap can never advertise a
// specialty the route would 404. Plain-data import (no components).
import { SALARY_SPECIALTY_SLUGS } from '@/app/salary-guide/specialty/specialty-config'
// P1 #18: employer JD-template detail pages. Same drift-proof pattern as the
// specialty slugs above — ids come from the frozen registry that
// generateStaticParams() renders from, so the sitemap can never advertise a
// template id the route would notFound() on. Plain-data module (its only
// import is config/brand), so this is safe to pull into the sitemap route.
import { JD_TEMPLATES } from '@/lib/jd-templates'
// P2 #4/#5/#6/#17: the free-tools cluster. Same drift-proof pattern as the
// specialty slugs and JD-template ids above — paths come from the registry the
// /tools hub and the /resources tools band render from, so the sitemap can
// never advertise a tool path the app would 404 on. Plain-data module (its
// only import is config/brand), so this is safe to pull into the sitemap route.
import { TOOL_PATHS, TOOLS_HUB_PATH } from '@/app/tools/tools-registry'
// P2 #12: per-state city directories (/jobs/locations/<state>). These helpers
// ARE the render gate — app/jobs/locations/[state]/page.tsx notFound()s on
// !shouldRenderStateCityDirectory, and app/jobs/locations/page.tsx decides
// which states to link with the identical call. Reading the same functions here
// is what keeps the sitemap from submitting a directory that 404s.
import {
  buildStateCityDirectory,
  cityLinkResolves,
  shouldRenderStateCityDirectory,
} from '@/app/jobs/locations/[state]/directory'
// Name→code map used by BOTH the directory page and the locations hub when
// resolving a state's code. Using the same source here means same input →
// same verdict on all three surfaces.
import { STATE_CODES } from '@/lib/pseo/setting-state-config'
// P2 #21: the sitemap budget guard below pages the team channel instead of
// only writing a log line nobody reads.
import { sendDiscordMessage } from '@/lib/discord-notifier'
// P5 A2: vs-competitor comparison pages. Same drift-proof pattern as the
// tools/specialty/JD-template registries above — COMPARE_PAGE_PATHS maps over
// the COMPETITOR_PROFILES array the hub's cards render from, and
// tests/regressions/p5-comparison-pages-routes.test.ts pins a physical route
// folder per slug in both directions, so the sitemap can never advertise a
// comparison the app would 404 on. Plain-data module (its imports are the
// same registries this file already pulls in).
import { COMPARE_HUB_PATH, COMPARE_PAGE_PATHS, COMPARE_REVIEW_DATE } from '@/lib/compare-data'
// P5 A7/A8: market reports. Paths come from the edition registry the /reports
// hub renders from (tests/regressions/p5-market-reports-model.test.ts pins a
// route folder per edition). Plain-data module (imports config/brand only).
import { REPORTS_HUB_PATH, ALL_REPORTS } from '@/lib/reports/editions'

// GSC Fix: Cache sitemap for 1 hour. Without this, every Googlebot request to
// /sitemap.xml triggers a full DB scan across jobs, companies, and blog tables.
export const revalidate = 3600;

// SEO fix (B28): activeIndexableJobWhere() bakes `now` into the returned
// Prisma where-clause. It used to be frozen here at MODULE scope, so a warm
// serverless instance kept comparing expiresAt against its cold-start time —
// jobs that expired since then stayed in the sitemap while middleware served
// their URLs as 410. It is now computed per-request inside sitemap().

// ── Sitemap budget guard (P2 #21) ────────────────────────────────────────────
// Google rejects a sitemap over 50,000 URLs — the WHOLE file, not the excess —
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
 * sendDiscordMessage() already no-ops (with a console warning) when
 * DISCORD_WEBHOOK_URL is unset, so dev and preview stay silent.
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
        ? `Primary sitemap is ${entryCount.toLocaleString()} entries (cap 50,000). Google may reject the whole file — split job pages into /api/sitemaps/jobs/[batch] now.`
        : `Primary sitemap is ${entryCount.toLocaleString()} entries (cap 50,000). Plan the split into /api/sitemaps/jobs/[batch] before ${SITEMAP_BUDGET_CRITICAL.toLocaleString()}.`,
      color: critical ? 0xff0000 : 0xffaa00,
    },
  ]).catch((err) =>
    logger.warn('[sitemap] budget Discord alert failed', { error: err instanceof Error ? err.message : String(err) }),
  )
}

// B33: metro-page adjacency sets — MUST mirror getMetroStats in
// app/jobs/metro/[slug]/page.tsx, which widens these three metros to
// adjacent cities when counting inventory. Only used to decide whether a
// metro has ≥1 active job before advertising it in the sitemap.
const METRO_ADJACENT_CITIES: Record<string, string[]> = {
  'New York': ['Brooklyn', 'Queens', 'Bronx'],
  'Tampa': ['St. Petersburg', 'Clearwater'],
  'Dallas': ['Fort Worth', 'Plano', 'Arlington'],
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

// Category landing-page slugs come from the drift-guarded registry
// (lib/pseo/taxonomy-registry.ts). Registry adoption also fixed a real
// drift bug: /jobs/behavioral-health existed as a page but was missing
// from the hand-maintained axis arrays this replaced, so it was never
// advertised in the sitemap.

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

/**
 * Primary sitemap — core pages, jobs, blog, state pages, category×state pages.
 * Category × City pages are served via /api/sitemaps/cities/[batch] (see API routes).
 * This keeps each sitemap under Google's 50K URL limit.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || brand.baseUrl

  // Shared filter: published, not expired, and not a repeated dead link (S6).
  // Computed per-request (B28) so `now` is never stale on warm instances.
  const ACTIVE_JOB_WHERE = activeIndexableJobWhere()

  // GSC Fix (P1.4): use the actual latest job date, or "now" as a safe live
  // fallback. Previously hard-coded "2026-03-01" — a stale stamp made every
  // sitemap entry look 2+ months old and signaled "this site isn't being
  // maintained" to Google. The outer try/catch at the bottom of this function
  // still catches DB-wide failure and returns a static-only sitemap.
  let latestJobDate = new Date();
  const latestJob = await prisma.job.findFirst({
    where: { isPublished: true },
    orderBy: { updatedAt: 'desc' },
    select: { updatedAt: true },
  });
  if (latestJob) latestJobDate = latestJob.updatedAt;

  const STATIC_CONTENT_DATE = new Date('2026-05-04');

  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    { url: baseUrl, lastModified: latestJobDate, changeFrequency: 'daily', priority: 1.0 },
    { url: `${baseUrl}/jobs`, lastModified: latestJobDate, changeFrequency: 'hourly', priority: 0.9 },
    { url: `${baseUrl}/blog`, lastModified: latestJobDate, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${baseUrl}/post-job`, lastModified: STATIC_CONTENT_DATE, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${baseUrl}/for-employers`, lastModified: STATIC_CONTENT_DATE, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${baseUrl}/for-job-seekers`, lastModified: STATIC_CONTENT_DATE, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${baseUrl}/about`, lastModified: STATIC_CONTENT_DATE, changeFrequency: 'monthly', priority: 0.5 },
    // P1 #8 (E-E-A-T): /editorial-policy is the trust page every stat-bearing
    // article and salary page cites via brand.editorial.policyPath. It is
    // explicitly `robots: { index: true, follow: true }` and is the target of
    // sitewide byline links, so it must be advertised — an authorship/sourcing
    // policy Google never crawls does nothing for E-E-A-T.
    { url: `${baseUrl}/editorial-policy`, lastModified: STATIC_CONTENT_DATE, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${baseUrl}/faq`, lastModified: STATIC_CONTENT_DATE, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${baseUrl}/contact`, lastModified: STATIC_CONTENT_DATE, changeFrequency: 'monthly', priority: 0.4 },
    // /job-alerts removed from sitemap (audit 15 thin-pages CRITICAL):
    // page is a bare subscription form (~240 words of UI labels). Now
    // noindexed via app/job-alerts/layout.tsx. Leaving the sitemap entry
    // in place would surface as a "Submitted URL marked noindex" warning
    // in GSC. Footer link on every page provides the discovery path.
    { url: `${baseUrl}/terms`, lastModified: STATIC_CONTENT_DATE, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${baseUrl}/privacy`, lastModified: STATIC_CONTENT_DATE, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${baseUrl}/pricing`, lastModified: STATIC_CONTENT_DATE, changeFrequency: 'monthly', priority: 0.7 },
    // Content audit P0 #7: these four indexable pages were missing from the
    // sitemap entirely. /companies is the employer-directory hub (DB-driven,
    // refreshed as inventory changes — company detail pages are emitted
    // further down, but the hub itself was never advertised); /for-programs
    // is the program-director funnel (footer-linked from every page);
    // /security and /sub-processors are trust/legal pages that get the same
    // treatment as /terms and /privacy.
    { url: `${baseUrl}/companies`, lastModified: latestJobDate, changeFrequency: 'daily', priority: 0.7 },
    { url: `${baseUrl}/for-programs`, lastModified: STATIC_CONTENT_DATE, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${baseUrl}/security`, lastModified: STATIC_CONTENT_DATE, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${baseUrl}/sub-processors`, lastModified: STATIC_CONTENT_DATE, changeFrequency: 'yearly', priority: 0.3 },
    // Content audit P2 #9 (trust cluster): /accessibility and /press are both
    // `robots: { index: true, follow: true }`. Declaring a page indexable and
    // then advertising it nowhere — no sitemap entry, no inbound link — is the
    // same orphan defect P0 #7 fixed for /for-programs. Footer links added in
    // components/Footer.tsx alongside these entries.
    //
    // /testimonials is deliberately NOT listed: it notFound()s until an
    // employer testimonial has been consented to AND featured, so a sitemap
    // entry would submit a URL that 404s on an empty board.
    { url: `${baseUrl}/accessibility`, lastModified: STATIC_CONTENT_DATE, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${baseUrl}/press`, lastModified: STATIC_CONTENT_DATE, changeFrequency: 'monthly', priority: 0.4 },
    // Content hub pages
    // /jobs/new-grad is NOT listed here: 'new-grad' is a registry category
    // slug, so categoryLandingPages below already emits it (daily, 0.9).
    // A second static entry produced a duplicate <loc> in the same sitemap
    // — the exact duplicate-URL quality hit the categoryStatePages comment
    // warns about. (The /new-grad → /jobs/new-grad redirect note lives on:
    // sitemaps must submit the canonical destination, which the registry
    // entry does.)
  ]

  // Metro landing pages — DB-gated below (B33) so metros with zero active
  // inventory are not advertised (their pages render an editorial shell with
  // an empty job list — a soft-404 magnet when submitted via sitemap). This
  // `let`-bound default (all metros) is the degraded-mode fallback used by
  // the outer catch when the DB is unhealthy.
  let metroPages: MetadataRoute.Sitemap = METRO_CITIES.map(m => ({
    url: `${baseUrl}/jobs/metro/${m.slug}`,
    lastModified: latestJobDate,
    changeFrequency: 'weekly' as const,
    priority: 0.8,
  }))

  // Category landing pages
  const categoryLandingPages: MetadataRoute.Sitemap = ALL_CATEGORY_SLUGS.map(slug => ({
    url: `${baseUrl}/jobs/${slug}`,
    lastModified: latestJobDate,
    changeFrequency: 'daily',
    priority: 0.9,
  }))

  // Other landing pages
  const landingPages: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/salary-guide`, lastModified: STATIC_CONTENT_DATE, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${baseUrl}/resources`, lastModified: STATIC_CONTENT_DATE, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${baseUrl}/jobs/locations`, lastModified: latestJobDate, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${baseUrl}/resources/fpa-guide`, lastModified: STATIC_CONTENT_DATE, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${baseUrl}/resources/private-practice-guide`, lastModified: STATIC_CONTENT_DATE, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${baseUrl}/resources/1099-vs-w2`, lastModified: STATIC_CONTENT_DATE, changeFrequency: 'monthly', priority: 0.8 },
  ]

  // Free-tools cluster (P2 #4, #5, #6, #17) — the /tools hub plus one page per
  // registry entry. NOT DB-gated, for the same reason as the specialty and
  // employer-resource pages: every tool is a repo-authored page whose shell
  // always renders in full (the live-pay sections gate themselves at render
  // time), so there is no soft-404 risk. All five set an explicit self-canonical
  // and none carry `robots: { index: false }`, so declaring them indexable and
  // advertising them nowhere would be the orphan defect P0 #7 fixed.
  const toolPages: MetadataRoute.Sitemap = [
    { url: `${baseUrl}${TOOLS_HUB_PATH}`, lastModified: STATIC_CONTENT_DATE, changeFrequency: 'monthly', priority: 0.8 },
    ...TOOL_PATHS.map(path => ({
      url: `${baseUrl}${path}`,
      lastModified: STATIC_CONTENT_DATE,
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    })),
  ]

  // P5 A2/A4/A7/A8: comparison cluster, scope-of-practice hub, and market
  // reports. NOT DB-gated, same reasoning as the tools cluster above: every
  // page is repo-authored and always renders in full (the report pages
  // degrade to their editorial shell when the live snapshot is unavailable —
  // they never notFound()), so there is no soft-404 risk. All set explicit
  // self-canonicals and none carry `robots: { index: false }`, so leaving
  // them out would be the orphan defect P0 #7 fixed. /admin/companies and
  // /api/admin/* from the same wave are deliberately NOT here.
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
  // Report bodies recompute from live inventory on each revalidate, so the
  // newest-job date is the honest lastmod (B27), not the publish date.
  const reportPages: MetadataRoute.Sitemap = [
    { url: `${baseUrl}${REPORTS_HUB_PATH}`, lastModified: latestJobDate, changeFrequency: 'weekly', priority: 0.7 },
    ...ALL_REPORTS.map(report => ({
      url: `${baseUrl}${report.path}`,
      lastModified: latestJobDate,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
  ]

  // Salary-guide specialty pages (P1 #7). NOT DB-gated on purpose: unlike
  // the state pages (which notFound() with zero inventory), a specialty
  // page's premium-band content is config-derived and always renders, so
  // there is no soft-404 risk when a category has no salary-bearing jobs.
  // Live sections gate themselves at render time.
  const salarySpecialtyPages: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/salary-guide/specialty`, lastModified: latestJobDate, changeFrequency: 'weekly', priority: 0.7 },
    ...SALARY_SPECIALTY_SLUGS.map(slug => ({
      url: `${baseUrl}/salary-guide/specialty/${slug}`,
      lastModified: latestJobDate,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
  ]

  // Employer content hub (P1 #18) — /for-employers/resources, its three
  // editorial guides, and one detail page per JD-template skeleton.
  // NOT DB-gated: every page here is repo-authored static content that
  // always renders in full, so there is no soft-404 risk (unlike the
  // inventory-driven state/metro/city pages gated in the try block).
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

  // State pages — DB-gated below in the try block so empty states never
  // ship to Google. These `let`-bound defaults are the degraded-mode
  // fallback used by the outer catch when the DB is unhealthy.
  let statePages: MetadataRoute.Sitemap = US_STATES.map(state => ({
    url: `${baseUrl}/jobs/state/${state}`,
    lastModified: latestJobDate,
    changeFrequency: 'weekly',
    priority: 0.8,
  }))

  // Salary guide state pages — same gating treatment.
  let salaryGuideStatePages: MetadataRoute.Sitemap = US_STATES.map(state => ({
    url: `${baseUrl}/salary-guide/${state}`,
    lastModified: latestJobDate,
    changeFrequency: 'weekly',
    priority: 0.8,
  }))

  // Per-state city directories (P2 #12) — DB-gated below in the try block.
  //
  // Unlike statePages/metroPages above, the degraded-mode default here is
  // EMPTY, not "all of them": whether /jobs/locations/<state> renders at all is
  // a pure function of live inventory (≥1 linkable city AND ≥3 tracked cities),
  // and roughly half the states fail it. With the DB down we cannot tell which,
  // and the page hard-404s on the ones that fail — so the safe fallback is to
  // advertise none rather than submit ~25 URLs that 404.
  let stateCityDirectoryPages: MetadataRoute.Sitemap = []

  // Category × State pages — handled by /api/sitemaps/cities/[batch] (which
  // emits both category×city AND setting×state URLs via pseoStats with
  // totalJobs ≥ 1). Keep this empty here to avoid duplicating URLs across
  // sitemaps — Google treats duplicate <loc> entries across sitemap files as
  // a quality signal hit.
  const categoryStatePages: MetadataRoute.Sitemap = [];

  try {
    // Blog pages
    const blogSlugs = await getAllPublishedSlugs();
    const blogPages: MetadataRoute.Sitemap = blogSlugs.map((post) => ({
      url: `${baseUrl}/blog/${post.slug}`,
      lastModified: new Date(post.updated_at),
      changeFrequency: 'weekly',
      priority: 0.8,
    }));

    // GSC Fix (P3.8): Job-detail URLs are now served by /api/sitemaps/jobs/[batch]
    // (BATCH_SIZE=25000) and listed in /api/sitemaps/index. Keeping them out of
    // the primary sitemap leaves headroom under Google's 50K-URL cap regardless
    // of ingestion-volume bumps. We still need an active-jobs count for the
    // per-section sanity floor below.
    const activeJobCount = await prisma.job.count({ where: ACTIVE_JOB_WHERE });

    // GSC Fix: gate state and salary-guide-state URLs on actual job presence.
    // The page handlers now notFound() on empty states, but the sitemap also
    // needs to stop advertising them — otherwise Google keeps re-crawling
    // and the URL bounces between "indexed → 404 → not indexed" until the
    // state has data again. The state.toLowerCase().replace pattern matches
    // US_STATES slugs (e.g. "Wyoming" → "wyoming", "New York" → "new-york").
    // B27: each groupBy also pulls _max.updatedAt so every section carries a
    // REAL per-page lastmod (the newest job feeding that page) instead of
    // flattening everything to one site-wide date — over-claiming freshness
    // erodes Google's trust in lastmod across the whole property.
    const stateJobCounts = await prisma.job.groupBy({
      by: ['state'],
      where: { ...ACTIVE_JOB_WHERE, state: { not: null } },
      _count: { state: true },
      _max: { updatedAt: true },
    });
    const stateSalaryCounts = await prisma.job.groupBy({
      by: ['state'],
      where: { ...ACTIVE_JOB_WHERE, state: { not: null }, normalizedMinSalary: { not: null } },
      _count: { state: true },
      _max: { updatedAt: true },
    });
    const slugify = (s: string) => s.toLowerCase().replace(/\s+/g, '-');
    const stateLastmod = new Map<string, Date>();
    for (const r of stateJobCounts) {
      if (r._max.updatedAt) stateLastmod.set(slugify((r.state || '').trim()), r._max.updatedAt);
    }
    const stateSalaryLastmod = new Map<string, Date>();
    for (const r of stateSalaryCounts) {
      if (r._max.updatedAt) stateSalaryLastmod.set(slugify((r.state || '').trim()), r._max.updatedAt);
    }
    const statesWithJobs = new Set(stateJobCounts.map(r => slugify((r.state || '').trim())));
    const statesWithSalary = new Set(stateSalaryCounts.map(r => slugify((r.state || '').trim())));
    statePages = US_STATES.filter(s => statesWithJobs.has(s)).map(state => ({
      url: `${baseUrl}/jobs/state/${state}`,
      lastModified: stateLastmod.get(state) ?? latestJobDate,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    }));
    salaryGuideStatePages = US_STATES.filter(s => statesWithSalary.has(s)).map(state => ({
      url: `${baseUrl}/salary-guide/${state}`,
      lastModified: stateSalaryLastmod.get(state) ?? latestJobDate,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    }));

    // B33: metro sitemap gate — only advertise metros with ≥1 active job.
    // Mirrors the inventory match in app/jobs/metro/[slug]/page.tsx
    // getMetroStats (city `contains` + stateCode match, widened by the
    // METRO_ADJACENT_CITIES sets above), on top of the indexable-job filter.
    const metroCityRows = await prisma.job.groupBy({
      by: ['city', 'stateCode'],
      where: { ...ACTIVE_JOB_WHERE, city: { not: null }, stateCode: { not: null } },
      _count: { _all: true },
      _max: { updatedAt: true },
    });
    metroPages = METRO_CITIES
      .map(m => {
        const cityNeedles = [m.city, ...(METRO_ADJACENT_CITIES[m.city] ?? [])].map(c => c.toLowerCase());
        const matching = metroCityRows.filter(row =>
          (row.stateCode || '').toLowerCase() === m.stateCode.toLowerCase() &&
          cityNeedles.some(needle => (row.city || '').toLowerCase().includes(needle))
        );
        if (matching.length === 0) return null;
        const newest = matching.reduce<Date | null>((acc, row) =>
          row._max.updatedAt && (!acc || row._max.updatedAt > acc) ? row._max.updatedAt : acc, null);
        return {
          url: `${baseUrl}/jobs/metro/${m.slug}`,
          lastModified: newest ?? latestJobDate,
          changeFrequency: 'weekly' as const,
          priority: 0.8,
        };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);

    // P2 #12: which states earn a /jobs/locations/<state> city directory.
    //
    // Deliberately a SEPARATE groupBy from `topCities` below: that one carries
    // `take: 2000` and a volume ordering, and a truncated tail would understate
    // `trackedCities` — the exact input to the ≥3 gate — so a qualifying state
    // could silently drop out of the sitemap as the dataset grows.
    //
    // Grouped and gated identically to app/jobs/locations/page.tsx: same
    // active-indexable predicate, same STATE_CODES lookup, same cityLinkResolves
    // veto, same shouldRenderStateCityDirectory verdict. The directory page
    // matches `state = name OR stateCode = code`, a superset of this grouping,
    // so a state that qualifies here always qualifies there — the sitemap can
    // never submit a directory that 404s, and never advertises one the hub
    // itself declines to link.
    const directoryCityRows = await prisma.job.groupBy({
      by: ['city', 'state'],
      where: { ...ACTIVE_JOB_WHERE, city: { not: null }, state: { not: null } },
      _count: { city: true },
      _max: { updatedAt: true },
    });
    const directoryRowsByState = new Map<string, { city: string; count: number }[]>();
    const directoryLastmod = new Map<string, Date>();
    for (const row of directoryCityRows) {
      if (!row.city || !row.state) continue;
      const stateName = row.state.trim();
      const bucket = directoryRowsByState.get(stateName);
      const entry = { city: row.city, count: row._count.city };
      if (bucket) bucket.push(entry);
      else directoryRowsByState.set(stateName, [entry]);
      // B27-style real per-page freshness: newest job anywhere in that state.
      const seen = directoryLastmod.get(stateName);
      if (row._max.updatedAt && (!seen || row._max.updatedAt > seen)) {
        directoryLastmod.set(stateName, row._max.updatedAt);
      }
    }
    // US_STATES is the sitemap's existing US-only slug whitelist — it keeps
    // non-US groupings ("British Columbia") out, the same job the hub's inline
    // set does for its links.
    const usStateSlugs = new Set(US_STATES);
    stateCityDirectoryPages = Object.entries(STATE_CODES)
      .map(([stateName, stateCode]) => {
        const slug = slugify(stateName);
        if (!usStateSlugs.has(slug)) return null;
        const directory = buildStateCityDirectory(directoryRowsByState.get(stateName) ?? [], {
          canLink: (row) => cityLinkResolves(row.city, stateCode),
        });
        if (!shouldRenderStateCityDirectory(directory)) return null;
        return {
          url: `${baseUrl}/jobs/locations/${slug}`,
          lastModified: directoryLastmod.get(stateName) ?? latestJobDate,
          changeFrequency: 'weekly' as const,
          priority: 0.7,
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);

    // Top city pages (DB-driven, only active non-expired jobs).
    //
    // Bounded with `take: 2000` so cold-cache sitemap regeneration can't
    // pull an unbounded city/state distribution into memory if the dataset
    // grows. 2000 is well above the 28 city-eligible taxonomies × any
    // plausible per-city threshold and still loads in milliseconds; pages
    // beyond the cap are extremely thin (<3 jobs) and would be filtered
    // out anyway by the downstream `_count.city >= 3` guard.
    const topCities = await prisma.job.groupBy({
      by: ['city', 'state'],
      where: { ...ACTIVE_JOB_WHERE, city: { not: null }, state: { not: null } },
      _count: { city: true },
      _max: { updatedAt: true },
      orderBy: { _count: { city: 'desc' } },
      take: 2000,
    })

    const cityPages: MetadataRoute.Sitemap = topCities
      .filter(c => c.city && c.state)
      // GSC Fix: Only include cities with ≥3 active jobs to prevent submitting
      // thin city pages that get flagged as soft 404 or crawled-not-indexed.
      .filter(c => c._count.city >= 3)
      .map(c => {
        const stateVal = c.state!.trim();
        const code = stateVal.length === 2 ? stateVal.toUpperCase() : STATE_NAME_TO_CODE[stateVal] || null;
        if (!code) return null;
        const slug = `${c.city!.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${code.toLowerCase()}`;
        return {
          url: `${baseUrl}/jobs/city/${slug}`,
          // B27: real per-city freshness — newest job in that city.
          lastModified: c._max.updatedAt ?? latestJobDate,
          changeFrequency: 'weekly' as const,
          priority: 0.7,
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null)

    // Company pages — only include companies that:
    // 1. Actually exist in the Company table (so normalizedName matches what the page uses)
    // 2. Have ≥5 active jobs (fewer = thin page → GSC soft 404)
    // GSC Fix: Previously generated slugs from job.employer via regex, causing slug mismatches
    // with Company.normalizedName → 2,265 dead 404s in GSC.
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
    // B27: per-company lastmod — newest active job per company in ONE query
    // instead of flattening every company page to the site-wide date.
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
      .filter(c => c._count.jobs >= 8) // Only companies with ≥8 active jobs (tightened from 5 to reduce thin pages)
      .map(c => ({
        // B30: emit the canonical kebab form only. Legacy rows still store
        // space-form normalizedName ("life stance") — a raw interpolation
        // produced literal-space URLs that are invalid in sitemap XML and
        // that middleware 410'd in kebab form. Single-space→hyphen is the
        // exact inverse of the page resolver's legacy fallback
        // (app/companies/[slug]/page.tsx: slug.replace(/-/g, ' ')), so the
        // emitted URL always round-trips to the stored row.
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
      ...blogPages,
      // jobPages intentionally omitted — served by /api/sitemaps/jobs/[batch]
    ]

    // GSC Fix (P3.8): sitemap budget guard. Google's per-sitemap limit is
    // 50,000 URLs. We exceed it silently, the entire sitemap is rejected and
    // ALL pages stop being recrawled. Log loudly when we approach the cap so
    // ops can split into batches before that happens.
    //
    // P2 #21: the log lines alone were invisible — nobody reads Vercel
    // function logs for a route that renders once an hour, and by the time
    // anyone noticed the cap had been crossed the whole sitemap would already
    // be rejected. Both thresholds now also page the team channel.
    if (all.length > SITEMAP_BUDGET_WARN) {
      logger.warn(`[sitemap] Primary sitemap is ${all.length} entries — approaching Google's 50k limit. Plan to split job pages into /api/sitemaps/jobs/[batch] before exceeding ${SITEMAP_BUDGET_CRITICAL}.`);
      notifySitemapBudget('warn', all.length);
    }
    if (all.length > SITEMAP_BUDGET_CRITICAL) {
      logger.error(`[sitemap] Primary sitemap is ${all.length} entries — Google may reject the whole sitemap (50k cap). Splitting job pages into batches is now mandatory.`);
      notifySitemapBudget('critical', all.length);
    }
    // Per-section sanity floors — if any of these collapse to 0 unexpectedly,
    // the DB query likely silently failed and we'd be poisoning Google with
    // a near-empty sitemap. Better to fail-fast and let the outer catch return
    // the static-only sitemap.
    if (activeJobCount === 0) {
      throw new Error('Sitemap: 0 active jobs returned — DB likely degraded; aborting to avoid empty sitemap.');
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
      // stateCityDirectoryPages intentionally omitted — see its declaration:
      // it is empty in degraded mode by design.
    ]
  }
}
