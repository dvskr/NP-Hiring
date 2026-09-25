/**
 * Setting x State pSEO Template Factory
 *
 * Shared server component used by all /jobs/[setting]/[state] pages. Each
 * setting page provides the setting key and state slug; this factory handles
 * data fetching, rendering, and SEO metadata.
 *
 * Thin-content program (PLAN.md C.4 item 3, thin-spec 1 section 4): every
 * count on the page comes from one canonical facts loader
 * (lib/pseo/listing-facts.ts), every sentence from the pure builders in
 * lib/pseo/listing-narrative.ts, and every data section from the shared clay
 * components in components/seo/pseo. A section whose facts miss its floor
 * renders nothing; nothing here is padded or invented. Pay prints only
 * through the gated median or the cited BLS figure, never a typed band or a
 * posting mean. Robots read the cron's stored verdict (PseoStats.indexable)
 * while its row is fresh and the live facts through the same render-gate
 * function otherwise, so the page and the sitemaps cannot disagree.
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import type { CSSProperties } from 'react';
import type { Prisma } from '@prisma/client';
import ImmersiveImage from '@/components/ImmersiveImage';
import { getCitiesByState } from './city-data/cities';
import {
  isPseoStatsFresh,
  pseoStatsFreshnessThreshold,
  PSEO_STATS_MAX_AGE_HOURS,
  shouldIndexSettingState,
  type SettingStateIndexFacts,
  MIN_JOBS_FOR_CATEGORY_CITY } from './render-gate';
import { JOB_LISTING_OMIT } from './job-listing-omit';
import { BEST_SORT_ORDER_BY } from '@/lib/utils/job-sort';
import { brand } from '@/config/brand';
import { Bell, MapPin, Lightbulb, ArrowRight } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import { STAT_SOURCES } from '@/lib/stats-sources';
import JobCard from '@/components/JobCard';
// P2 #19: Breadcrumbs renders the VISIBLE trail and the BreadcrumbList
// JSON-LD from one items array, replacing the schema-only BreadcrumbSchema
// that used to sit here. Never render both: that emits two BreadcrumbList
// graphs for the same page.
import Breadcrumbs from '@/components/Breadcrumbs';
import CategoryHero from '@/components/CategoryHero';
import CategoryFAQ from '@/components/CategoryFAQ';
import { type CategorySlug } from './category-faq-data';
import { Job } from '@/lib/types';
import { JobListViewTracker, PseoPageViewTracker } from '@/components/analytics/ViewTrackers';
import {
  SettingConfig,
  SETTING_CONFIGS,
  resolveStateSlug,
  stateToSlug,
  getAllStateSlugs,
  STATE_CODES,
} from './setting-state-config';
import { getNeighboringStates } from './neighboring-states';
import { getCategoryAssets } from './category-asset-registry';
import { buildSettingStateNarrative } from './state-narrative';
// P2 #15: ONE freshness formatter for both pSEO templates; a local copy is
// how the city and state surfaces drift apart.
import { formatStatsBadge } from './category-city-template';
import { pluralize } from '@/lib/pseo/plural';
import { withListingQuarantine } from '@/lib/pseo/listing-where';
import { canonicalBucketWhere } from '@/lib/canonical-counts';
import { getListingFacts, type ListingFacts } from './listing-facts';
import {
  buildRecencySentence,
  buildRoleSetup,
  buildSettingStateDescription,
  buildSettingStateFaqs,
  buildSettingStateTitle,
  formatCountLabel,
  formatUtcDate,
  type FaqEntry,
} from './listing-narrative';
import {
  getPracticeEnvironment,
  isLicenseGuideLive,
  NLC_VERIFIED_LABEL,
  type PracticeEnvironment,
} from './practice-environment';
import { buildLicenseGuideFaq, getLicenseGuideState } from '@/lib/blog-license-guides';
import {
  ClayStyles,
  EmployerRoster,
  LocationSpread,
  PostedPay,
  PracticeCard,
  RoleSetup,
  postedPaySentence,
  type LocationSpreadPlace,
} from '@/components/seo/pseo';

// ─── Types ───────────────────────────────────────────────────────────────────

/** A cross-link pill: the target page, its label and its fresh canonical count. */
interface CountedLink {
  href: string;
  label: string;
  count: number;
}

/**
 * The PseoStats columns the robots decision reads, typed locally.
 *
 * WHY RAW: the generated Prisma client predates the `indexable` column
 * (prisma/migrations/20260916120000_pseo_stats_index_gate) and must not be
 * regenerated on this branch, so the stored verdict is only reachable through
 * a $queryRaw tagged template (parameterized; the column names are literals).
 */
interface SettingStateGateRow {
  indexable: boolean;
  updatedAt: Date;
}

/** Listings per page; the count drives the pagination controls. */
const PAGE_SIZE = 10;

/**
 * GA4 item_list_name for the listings on every category x state page. The
 * view_item_list impression and each card's select_item read this one
 * constant, because GA4 joins a click to its impression on the name alone.
 * One name for the whole template rather than one per page, so the item-list
 * reports keep a single row for this surface instead of one per category and
 * state; both are already on the pseo_page_view event this page sends.
 */
const CATEGORY_STATE_LIST_NAME = 'Category State Jobs';

/** Pills shown in the "more job types" row. */
const MAX_OTHER_SETTING_PILLS = 12;

/** Nearby-state links offered on an empty listings page. */
const MAX_EMPTY_STATE_NEIGHBORS = 4;

// ─── Data Fetching ───────────────────────────────────────────────────────────

/** The listing cards: the same bucket the facts count, on the canonical predicate. */
async function getJobs(config: SettingConfig, stateName: string, skip = 0, take = PAGE_SIZE) {
  const where = withListingQuarantine(config.buildWhere(stateName) as Prisma.JobWhereInput);
  return prisma.job.findMany({
    where: canonicalBucketWhere(where),
    omit: JOB_LISTING_OMIT, // Perf1: don't pull the multi-KB description for cards
    orderBy: BEST_SORT_ORDER_BY,
    skip,
    take,
  });
}

/**
 * Every fact the page prints, from the one canonical loader. React cache()
 * dedupes the metadata and page calls on the scope key within a request. A
 * failed total count rethrows (PLAN C.3): a 5xx is retried by crawlers and
 * never removes a URL, while a false 0 would be written into the route cache
 * as a 404 for an hour across every setting x state URL.
 */
function getSettingStateFacts(config: SettingConfig, stateName: string, stateSlug: string): Promise<ListingFacts> {
  const where = withListingQuarantine(config.buildWhere(stateName) as Prisma.JobWhereInput);
  return getListingFacts(`setting-state:${config.slug}:${stateSlug}`, where);
}

/** The cron's stored index verdict for this combo, or null when unavailable. */
async function readStoredIndexVerdict(config: SettingConfig, stateSlug: string): Promise<SettingStateGateRow | null> {
  try {
    const rows = await prisma.$queryRaw<SettingStateGateRow[]>`
      SELECT "indexable", "updatedAt"
      FROM "PseoStats"
      WHERE "type" = 'setting-state'
        AND "categorySlug" = ${config.slug}
        AND "locationSlug" = ${stateSlug}
      LIMIT 1`;
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  } catch (error) {
    // A failed gate read must never take the page down: robots fall back to
    // the live facts, the same decision the cron would have stored.
    console.error(
      `[setting-state] stored index verdict unavailable for ${config.slug}/${stateSlug}; robots use the live facts (freshness window ${PSEO_STATS_MAX_AGE_HOURS}h):`,
      error,
    );
    return null;
  }
}

/** The facts shouldIndexSettingState reads, computed exactly as the cron computes them. */
export function settingStateIndexFacts(slug: string, facts: ListingFacts): SettingStateIndexFacts {
  return {
    totalJobs: facts.total,
    employerCount: facts.distinctEmployers,
    namedCityCount: facts.cities.length,
    hasBenchmark: facts.benchmark !== null,
    postedLast30Days: facts.recency.last30,
    roleSetupRenders: buildRoleSetup({ slug, facts }).rendered,
  };
}

/**
 * Robots verdict (PLAN C.2): only page 1 can index; a fresh PseoStats row
 * carries the cron's stored verdict, which the sitemaps also read; a stale
 * or missing row falls back to the live facts through the same function.
 */
export function resolveSettingStateIndexable(input: {
  stored: SettingStateGateRow | null;
  indexFacts: SettingStateIndexFacts;
  page: number;
  now?: number;
}): boolean {
  const { stored, indexFacts, page, now = Date.now() } = input;
  if (page !== 1) return false;
  if (stored && isPseoStatsFresh(stored.updatedAt, now)) return stored.indexable;
  return shouldIndexSettingState(indexFacts, page);
}

/** Other settings with fresh inventory in this state (CS-S8), most listings first. */
async function loadOtherSettings(config: SettingConfig, stateSlug: string, threshold: Date): Promise<CountedLink[]> {
  const rows = await prisma.pseoStats.findMany({
    where: {
      type: 'setting-state',
      locationSlug: stateSlug,
      totalJobs: { gte: 1 },
      categorySlug: { not: config.slug },
      updatedAt: { gte: threshold },
    },
    select: { categorySlug: true, totalJobs: true },
  });
  return rows
    .flatMap((row): CountedLink[] => {
      const setting = SETTING_CONFIGS[row.categorySlug];
      if (!setting || setting.slug === config.slug) return [];
      return [{ href: `/jobs/${setting.slug}/${stateSlug}`, label: setting.label, count: row.totalJobs }];
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Nearby states where this setting has fresh inventory (CS-S7), most listings first. */
async function loadNearbyStates(config: SettingConfig, stateName: string, threshold: Date): Promise<CountedLink[]> {
  const nearby = getNeighboringStates(stateName).map((name) => ({ name, slug: stateToSlug(name) }));
  if (nearby.length === 0) return [];
  const rows = await prisma.pseoStats.findMany({
    where: {
      type: 'setting-state',
      categorySlug: config.slug,
      locationSlug: { in: nearby.map((n) => n.slug) },
      totalJobs: { gte: 1 },
      updatedAt: { gte: threshold },
    },
    select: { locationSlug: true, totalJobs: true },
  });
  const countBySlug = new Map(rows.map((row) => [row.locationSlug, row.totalJobs]));
  return nearby
    .flatMap((n): CountedLink[] => {
      const count = countBySlug.get(n.slug);
      return count ? [{ href: `/jobs/${config.slug}/${n.slug}`, label: n.name, count }] : [];
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * The cities the listings name (CS-S2), each joined to its dataset slug and
 * to the render gate of its category x city page: a city links only when
 * that page's fresh PseoStats row clears MIN_JOBS_FOR_CATEGORY_CITY (the
 * page 404s below it, so a link would be a link to a 404). Every city stays
 * in the sentence as plain text either way.
 */
async function loadCityPlaces(
  config: SettingConfig,
  stateCode: string | undefined,
  facts: ListingFacts,
  threshold: Date,
): Promise<LocationSpreadPlace[]> {
  const slugByName = new Map(
    (stateCode ? getCitiesByState(stateCode) : []).map((city) => [city.name.toLowerCase(), city.slug]),
  );
  const candidateSlugs = facts.cities.flatMap((city) => {
    const slug = slugByName.get(city.name.toLowerCase());
    return slug ? [slug] : [];
  });
  const validCityRows = candidateSlugs.length > 0
    ? await prisma.pseoStats.findMany({
        where: {
          type: 'category-city',
          categorySlug: config.slug,
          locationSlug: { in: candidateSlugs },
          totalJobs: { gte: MIN_JOBS_FOR_CATEGORY_CITY },
          updatedAt: { gte: threshold },
        },
        select: { locationSlug: true },
      })
    : [];
  const validCitySlugs = new Set(validCityRows.map((row) => row.locationSlug));
  return facts.cities.map((city): LocationSpreadPlace => {
    const slug = slugByName.get(city.name.toLowerCase());
    return {
      name: city.name,
      count: city.count,
      link: slug ? { href: `/jobs/${config.slug}/city/${slug}`, renders: validCitySlugs.has(slug) } : null,
    };
  });
}

/** The physician and compact answers the license guide publishes for this state (CS-S9). */
function licenseGuideAnswers(env: PracticeEnvironment | null): { physicianAnswer: string | null; nlcAnswer: string | null } {
  const row = env ? getLicenseGuideState(env.stateSlug) : null;
  if (!row) return { physicianAnswer: null, nlcAnswer: null };
  const faqs = buildLicenseGuideFaq(row);
  return {
    physicianAnswer: faqs.find((f) => /collaborating or supervising physician/i.test(f.name))?.text ?? null,
    nlcAnswer: faqs.find((f) => /Nurse Licensure Compact/i.test(f.name))?.text ?? null,
  };
}

/** The first sentence of a description, for the share card subtitle. */
function leadSentence(text: string): string {
  const end = text.indexOf('. ');
  return end === -1 ? text : text.slice(0, end + 1);
}

// ─── Metadata Generator ──────────────────────────────────────────────────────

export async function buildSettingStateMetadata(
  settingKey: string,
  stateSlug: string,
  page: number,
): Promise<Metadata> {
  const config = SETTING_CONFIGS[settingKey];
  const stateName = resolveStateSlug(stateSlug);
  if (!config || !stateName) return { title: 'Not Found' };

  const [facts, stored] = await Promise.all([
    getSettingStateFacts(config, stateName, stateSlug),
    readStoredIndexVerdict(config, stateSlug),
  ]);
  const basePath = `/jobs/${config.slug}/${stateSlug}`;
  const env = getPracticeEnvironment(stateName);
  const title = buildSettingStateTitle({ titleLabel: config.label, stateName, total: facts.total });
  const description = buildSettingStateDescription({
    label: config.label,
    slug: config.slug,
    stateName,
    facts,
    authorityDescription: env?.authorityDescription ?? null,
    statsAsOf: facts.computedAt,
  });
  const indexable = resolveSettingStateIndexable({
    stored,
    indexFacts: settingStateIndexFacts(config.slug, facts),
    page,
  });

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
      images: [{
        url: `/api/og?type=page&title=${encodeURIComponent(title)}&subtitle=${encodeURIComponent(leadSentence(description))}`,
        width: 1200,
        height: 630,
        alt: title,
      }],
    },
    alternates: {
      // Self canonical on every page; paginated views canonical to page 1.
      canonical: `${brand.baseUrl}${basePath}`,
    },
    // Noindex pages keep follow so PageRank flows through the internal links.
    robots: { index: indexable, follow: true },
  };
}

// ─── Static Params Generator ─────────────────────────────────────────────────

export function buildSettingStateStaticParams() {
  return getAllStateSlugs().map((slug) => ({ state: slug }));
}

// ─── Design Tokens (matched to category-city-template) ──────────────────────

const clayCard: CSSProperties = {
  background: '#FFFFFF', borderRadius: '20px',
  border: '1px solid rgba(255,255,255,0.5)',
  boxShadow: '6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02)',
};

const pillStyle: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '7px 16px', borderRadius: '12px',
  textDecoration: 'none', fontSize: '13px', fontWeight: 600, color: '#1A2E35', background: '#FFFFFF',
  border: '1px solid rgba(255,255,255,0.5)',
  boxShadow: '3px 3px 8px rgba(0,0,0,0.05), -2px -2px 6px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6)',
};

const crossLinkHeadingStyle: CSSProperties = {
  fontSize: '13px', fontWeight: 700, color: '#7A6A62', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '12px',
};

const bandEyebrowStyle: CSSProperties = {
  fontSize: '13px', fontWeight: 600, color: '#E86C2C', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px',
};

const bandHeadingStyle: CSSProperties = {
  fontSize: 'clamp(26px, 3.5vw, 38px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '32px',
};

const sidebarCardTitleStyle: CSSProperties = { fontSize: '15px', fontWeight: 800, color: '#1A2E35', margin: 0 };

/** Hover lift for the clay pills and the breadcrumb band chrome. Static, no interpolation. */
const PAGE_CSS = `
  .pseo-pill { transition: transform 0.25s ease, box-shadow 0.25s ease; cursor: pointer; }
  .pseo-pill:hover { transform: translateY(-3px) !important; box-shadow: 6px 6px 16px rgba(0,0,0,0.1), -3px -3px 10px rgba(255,255,255,0.9), inset 1px 1px 2px rgba(255,255,255,0.6) !important; }
  .pseo-pill:active { transform: translateY(-1px) !important; }
  /* Breadcrumb band: horizontal padding tracks CategoryHero's own
     (48px 56px 0, dropping to 32px 24px 0 under 900px). */
  .pseo-crumb-band { background: #faf6ef; padding: 24px 56px 0; }
  .pseo-crumb-band nav { margin-bottom: 0; }
  /* The current page is the H1 directly below, so its crumb is kept for
     assistive technology but not drawn (owner request, 2026-09-16). */
  .pseo-crumb-band nav ol li:last-child { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  @media (max-width: 900px) {
    .pseo-crumb-band { padding: 16px 24px 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .pseo-pill { transition: none; }
    .pseo-pill:hover { transform: none !important; }
  }
`;

// ─── Page Component ──────────────────────────────────────────────────────────

interface SettingStatePageProps {
  settingKey: string;
  stateSlug: string;
  page: number;
}

export default async function SettingStatePage({ settingKey, stateSlug, page }: SettingStatePageProps) {
  const config = SETTING_CONFIGS[settingKey];
  const stateName = resolveStateSlug(stateSlug);

  if (!config || !stateName) {
    const { notFound } = await import('next/navigation');
    notFound();
  }

  const skip = (page - 1) * PAGE_SIZE;

  // 1. The canonical facts (one loader, shared with generateMetadata).
  const facts = await getSettingStateFacts(config, stateName!, stateSlug);

  // A category x state combo with no matching jobs is a real 404: nothing
  // below is worth rendering for it.
  if (facts.total === 0) {
    const { notFound: notFoundFn } = await import('next/navigation');
    notFoundFn();
  }

  // 2. Listings and the cross-link inventory.
  const jobs = await getJobs(config, stateName!, skip, PAGE_SIZE);
  const totalPages = Math.ceil(facts.total / PAGE_SIZE);
  const basePath = `/jobs/${config.slug}/${stateSlug}`;
  const stateCode = STATE_CODES[stateName!];
  // The facts are recounted live on every render (ISR), so this is a real
  // recount time; the hero badge and the sources line read it.
  const statsAsOf = facts.computedAt;

  // Cross-links are gated on PseoStats.totalJobs of 1 or more so the page
  // never links Googlebot to an empty page, and on row freshness so a
  // silently failing aggregator cannot advertise pages whose jobs expired.
  // One window for every gate: PSEO_STATS_MAX_AGE_HOURS in render-gate.ts.
  const freshnessThreshold = pseoStatsFreshnessThreshold();
  const [otherSettings, nearbyStates, places] = await Promise.all([
    loadOtherSettings(config, stateSlug, freshnessThreshold),
    loadNearbyStates(config, stateName!, freshnessThreshold),
    loadCityPlaces(config, stateCode, facts, freshnessThreshold),
  ]);

  const assets = getCategoryAssets(config.slug);
  const env = getPracticeEnvironment(stateName!);
  const licenseGuideLive = env ? await isLicenseGuideLive(env.stateSlug) : false;

  // The two retired positional arguments of the narrative are ignored by the
  // builder; they stay until the signature is trimmed with its owner.
  const narrative = buildSettingStateNarrative(config.slug, stateName!, stateCode || '', 0, 0, facts.total);
  const recencySentence = buildRecencySentence(facts.recency);
  // The BLS figure is cited only on the below-gate pay branch; the sources
  // line names it only then.
  const paySentence = postedPaySentence({ kind: 'category', slug: config.slug }, facts);
  const citesBls = paySentence !== null && facts.benchmark === null;
  const extraSources = citesBls ? `; ${STAT_SOURCES.averageSalary.source}` : '';

  // CS-S9: ONE array feeds the visible accordion and the FAQPage JSON-LD
  // (CategoryFAQ builds both from customFaqs), so an entry that loses its
  // answer disappears from both at once.
  const stateFaqs: FaqEntry[] = buildSettingStateFaqs({
    label: config.label,
    stateName: stateName!,
    slug: config.slug,
    facts,
    ...licenseGuideAnswers(env),
  });
  // The Speakable '.faq-answer' selector is declared only when the FAQ band
  // renders, which is exactly when this array is non-empty (the band is
  // rendered from it and from nothing else).
  const rendersFaqAnswers = stateFaqs.length > 0;

  // P2 #19: ONE breadcrumb array drives the visible <nav> and the
  // BreadcrumbList JSON-LD (Breadcrumbs renders both); hrefs are relative
  // because the component prefixes the canonical origin itself.
  const breadcrumbItems = [
    { label: 'Home', href: '/' },
    { label: 'Jobs', href: '/jobs' },
    { label: config.label, href: `/jobs/${config.slug}` },
    { label: stateName! },
  ];

  const heroStats = [
    { value: `${facts.total}`, label: pluralize(facts.total, 'position') },
    // CS-T12: the distinct employer count, never the length of a capped list.
    ...(facts.distinctEmployers > 0
      ? [{ value: `${facts.distinctEmployers}`, label: pluralize(facts.distinctEmployers, 'employer') }]
      : []),
  ];

  return (
    <div style={{ backgroundColor: '#FDFBF7' }}>
      <style>{PAGE_CSS}</style>
      {/* Schemas */}
      {/* ItemList schema.
          B29: job titles are aggregator-sourced; escape < and > so a literal
          "</script>" in a title can never terminate this element early. */}
      {jobs.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'ItemList',
              name: `${config.label} ${brand.niche.short} Jobs in ${stateName}`,
              numberOfItems: facts.total,
              itemListElement: jobs.slice(0, PAGE_SIZE).map((job: Job, idx: number) => ({
                '@type': 'ListItem',
                position: idx + 1,
                name: job.title,
                url: `${brand.baseUrl}/jobs/${job.slug || job.id}`,
              })),
            })
              .replace(/</g, '\\u003c')
              .replace(/>/g, '\\u003e'),
          }}
        />
      )}
      {/* P2 #15: State (Place subtype) schema, the state-page counterpart of
          the city template's Place graph, so the page names the geography it
          is about in machine-readable form. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'State',
            name: stateName!,
            address: {
              '@type': 'PostalAddress',
              addressRegion: stateCode || stateName!,
              addressCountry: 'US',
            },
          })
            .replace(/</g, '\\u003c')
            .replace(/>/g, '\\u003e'),
        }}
      />
      {/* P2 #15 / P4: Speakable schema marks the answer summary and the FAQ
          answers for voice and AI consumption. Only selectors that ACTUALLY
          exist in the rendered markup are declared: #answer-summary is the
          intro of the hiring band below and renders unconditionally;
          '.faq-answer' is the <p> CategoryFAQAccordion renders per entry, so
          it is declared only when the FAQ array feeding that band is
          non-empty. dateModified is the real recount time. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'WebPage',
            name: `${config.label} ${brand.niche.short} Jobs in ${stateName}`,
            dateModified: statsAsOf.toISOString(),
            speakable: {
              '@type': 'SpeakableSpecification',
              cssSelector: rendersFaqAnswers
                ? ['#answer-summary', '.faq-answer']
                : ['#answer-summary'],
            },
            url: `${brand.baseUrl}${basePath}`,
          })
            .replace(/</g, '\\u003c')
            .replace(/>/g, '\\u003e'),
        }}
      />
      {/* Analytics */}
      <PseoPageViewTracker
        pageType="setting_state"
        category={config.slug}
        state={stateName!}
        jobCount={facts.total}
      />
      {/* indexOffset={skip} matches the cards' listIndex={skip + i}, so a
          card's impression and click report the same position. */}
      <JobListViewTracker
        jobs={jobs.map((j: Job) => ({ id: j.id, title: j.title, employer: j.employer }))}
        listName={CATEGORY_STATE_LIST_NAME}
        indexOffset={skip}
      />

      {/* P2 #19: visible, linked breadcrumb trail.
          CategoryHero's own `breadcrumbs` prop is deliberately empty below:
          it renders unlinked <span>s whose labels did not match the
          BreadcrumbList schema, and two Breadcrumb navs on one page is both
          a duplicate landmark and a duplicate-schema signal. */}
      <div className="pseo-crumb-band">
        <Breadcrumbs items={breadcrumbItems} />
      </div>

      {/* Hero */}
      <CategoryHero
        bgColor={assets.bgColor}
        heroImage={assets.heroImage}
        heroAlt={`${config.label} ${brand.niche.short} jobs in ${stateName}`}
        // P2 #15: freshness comes from when the counts were actually computed
        // (shared formatter with the city template).
        badgeText={formatStatsBadge(facts.total, statsAsOf)}
        breadcrumbs={[]}
        headlineLine1={config.label}
        headlineLine2={brand.niche.short}
        headlineSub={`jobs in ${stateName}.`}
        stats={heroStats}
        description={`${config.label} ${brand.niche.short} positions in ${stateName}. ${config.heroSubtitle}.`}
        ctaLabel={`Browse ${config.label} Jobs`}
        ctaHref={`/jobs/${config.slug}`}
        secondaryCtaLabel={`All ${stateName} Jobs`}
        secondaryCtaHref={`/jobs/state/${stateSlug}`}
      />

      <div className="container mx-auto px-4 py-8 md:py-12">
        <div className="max-w-7xl mx-auto">
          {/* Job Listings */}
          <div className="grid lg:grid-cols-4 gap-8">
            <div className="lg:col-span-3">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
                <h2 className="font-lora" style={{ fontSize: '20px', fontWeight: 700, color: '#1A2E35' }}>
                  {config.label} Positions in {stateName} ({facts.total})
                </h2>
                <Link href={`/jobs/${config.slug}`} style={{ fontSize: '13px', fontWeight: 600, color: '#BE185D', textDecoration: 'none' }}>
                  View All Jobs <ArrowRight size={12} style={{ display: 'inline', verticalAlign: 'middle' }} />
                </Link>
              </div>

              {jobs.length === 0 ? (
                <div className="text-center py-12 rounded-xl" style={{ ...clayCard, padding: '48px 24px' }}>
                  <MapPin className="h-12 w-12 mx-auto mb-4" style={{ color: '#7A6A62' }} />
                  <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#1A2E35', marginBottom: '8px' }}>
                    No {config.label.toLowerCase()} positions in {stateName} on this page
                  </h3>
                  <p style={{ fontSize: '14px', color: '#5A4A42', marginBottom: '16px' }}>
                    Start from page 1 or browse nearby states:
                  </p>
                  {nearbyStates.length > 0 && (
                    <div className="flex flex-wrap justify-center gap-2 mb-6">
                      {nearbyStates.slice(0, MAX_EMPTY_STATE_NEIGHBORS).map((neighbor) => (
                        <Link key={neighbor.href} href={neighbor.href}
                          className="px-3 py-1.5 text-sm rounded-lg" style={{ backgroundColor: '#FDF2F8', color: '#BE185D', fontWeight: 600 }}>
                          {formatCountLabel({ name: neighbor.label, count: neighbor.count })}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
                    {/* Absolute position (skip + i): page 2 continues the
                        count from page 1 rather than restarting it. */}
                    {jobs.map((job: Job, i: number) => (
                      <JobCard key={job.id} job={job} listName={CATEGORY_STATE_LIST_NAME} listIndex={skip + i} />
                    ))}
                  </div>

                  {totalPages > 1 && (
                    <div className="mt-8 flex items-center justify-center gap-4">
                      {page > 1 ? (
                        <Link href={`${basePath}?page=${page - 1}`} className="px-4 py-2 text-sm font-medium rounded-lg" style={{ ...clayCard, color: '#1A2E35', padding: '8px 16px' }}>
                          Previous
                        </Link>
                      ) : (
                        <span className="px-4 py-2 text-sm rounded-lg cursor-not-allowed" style={{ color: '#7A6A62', backgroundColor: '#F5F0EB' }}>Previous</span>
                      )}
                      <span className="text-sm" style={{ color: '#5A4A42' }}>Page {page} of {totalPages}</span>
                      {page < totalPages ? (
                        <Link href={`${basePath}?page=${page + 1}`} className="px-4 py-2 text-sm font-medium rounded-lg" style={{ ...clayCard, color: '#1A2E35', padding: '8px 16px' }}>
                          Next
                        </Link>
                      ) : (
                        <span className="px-4 py-2 text-sm rounded-lg cursor-not-allowed" style={{ color: '#7A6A62', backgroundColor: '#F5F0EB' }}>Next</span>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Sidebar: the ONE alert CTA on the page, then the category's
                tips and benefits, each rendered once. */}
            <div className="lg:col-span-1">
              {/* Alert CTA. "Delivered daily" is the send-alerts cron cadence
                  (config/cron-schedule.ts, daily group). */}
              <div style={{ ...clayCard, padding: '0', overflow: 'hidden', marginBottom: '20px', background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)', border: '2px solid rgba(190,24,93,0.15)' }}>
                <div style={{ padding: '24px' }}>
                  <Bell size={28} style={{ color: '#BE185D', marginBottom: '12px' }} />
                  <h3 className="font-lora" style={{ fontSize: '18px', fontWeight: 700, color: '#831843', margin: '0 0 8px' }}>
                    {config.label} Alerts
                  </h3>
                  <p style={{ fontSize: '13px', color: '#BE185D', marginBottom: '16px', lineHeight: 1.6, fontWeight: 500 }}>
                    New {config.label.toLowerCase()} {brand.niche.short} positions in {stateName}, delivered daily.
                  </p>
                  <Link href="/job-alerts" style={{
                    display: 'block', width: '100%', textAlign: 'center',
                    padding: '10px 20px', borderRadius: '10px', fontWeight: 700, fontSize: '13px',
                    background: '#BE185D', color: '#fff', textDecoration: 'none',
                    boxShadow: '3px 3px 8px rgba(190,24,93,0.15)',
                  }}>
                    Create Alert
                  </Link>
                </div>
              </div>

              {/* Tips */}
              <div style={{ ...clayCard, padding: '24px', marginBottom: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                  <Lightbulb size={20} style={{ color: '#BE185D' }} />
                  <h3 style={sidebarCardTitleStyle}>{config.label} Tips</h3>
                </div>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {config.tips.map((tip, i) => (
                    <li key={i} style={{ display: 'flex', gap: '8px', padding: '6px 0', borderBottom: i < config.tips.length - 1 ? '1px solid rgba(0,0,0,0.05)' : 'none', fontSize: '13px', color: '#5A4A42', lineHeight: 1.5 }}>
                      <span style={{ color: '#BE185D', fontWeight: 700 }}>&bull;</span>
                      <span>{tip}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Benefits */}
              <div style={{ ...clayCard, padding: '24px' }}>
                <h3 style={{ ...sidebarCardTitleStyle, marginBottom: '16px' }}>Why {config.label}?</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {config.benefits.map((b, i) => (
                    <div key={i}>
                      <div style={{ fontWeight: 700, fontSize: '13px', color: '#1A2E35' }}>{b.title}</div>
                      <p style={{ fontSize: '12px', marginTop: '4px', color: '#5A4A42', lineHeight: 1.5 }}>{b.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Hiring in {State}: the thin-content data sections (CS-S1 to S6) in
          the page's bento chrome. Each card is a shared clay section that
          renders nothing below its floor; the intro carries the category
          lead and the recency sentence (CS-S5) beside the category art. */}
      <section style={{ background: 'linear-gradient(180deg, #FFF8F0 0%, #FDFBF7 100%)', padding: '48px 0' }}>
        <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '0 20px' }}>
          <ClayStyles />
          <p style={bandEyebrowStyle}>Hiring in {stateName}</p>
          <h2 className="font-lora" style={bandHeadingStyle}>
            {config.label} Careers in {stateName}
          </h2>

          {/* P2 #15: the answer-summary block the Speakable schema points at. */}
          <div className="pseo-clay-split" style={{ ...clayCard, padding: 0, overflow: 'hidden', marginBottom: '20px' }}>
            <div id="answer-summary" data-speakable="true" style={{ padding: '32px 28px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '12px' }}>
              <h3 style={{ fontSize: '20px', fontWeight: 800, color: '#1A2E35', margin: 0 }}>
                {config.label} in {stateName}
              </h3>
              <p className="font-lora" style={{ fontSize: '15px', lineHeight: 1.7, color: '#3A4A53', margin: 0 }}>
                {narrative}
              </p>
              {recencySentence && (
                <p style={{ fontSize: '14px', lineHeight: 1.65, color: '#5A4A42', margin: 0 }}>{recencySentence}</p>
              )}
            </div>
            {assets.bentoImages[0] && (
              <ImmersiveImage src={assets.bentoImages[0]} alt={`${config.label} ${brand.niche.short}`} minHeight={240} />
            )}
          </div>

          <div className="pseo-clay-grid pseo-clay-cols-2">
            <EmployerRoster
              variant={{ kind: 'scoped', label: config.label, scope: `in ${stateName}` }}
              facts={facts}
            />
            <LocationSpread variant={{ kind: 'scoped', slug: config.slug }} places={places} />
            <RoleSetup slug={config.slug} facts={facts} />
            <PostedPay
              variant={{ kind: 'category', slug: config.slug }}
              facts={facts}
              salaryGuide={{ href: `/salary-guide/${stateSlug}`, label: `${stateName} ${brand.niche.short} salary guide`, renders: true }}
            />
            <PracticeCard
              env={env}
              variant={{ kind: 'licensure', slug: config.slug }}
              licenseGuideLive={licenseGuideLive}
              title={`Licensure and practice rules in ${stateName}`}
            />
          </div>

          {/* P2 #15: sources line. Only what this page actually renders is
              claimed: AANP for the practice card, the NCSBN roster for its
              compact sentence, BLS only when the pay card cites it. */}
          {env && (
            <p style={{ fontSize: '11px', color: '#A09080', textAlign: 'center', maxWidth: '760px', margin: '28px auto 0' }}>
              Sources: {STAT_SOURCES.fullPracticeStates.source} (practice authority); NCSBN Nurse Licensure Compact roster (verified {NLC_VERIFIED_LABEL}){extraSources}. Counts come from live listings on this board, recounted {formatUtcDate(statsAsOf)}.
            </p>
          )}
        </div>
      </section>

      {/* Cross-links (CS-S7, CS-S8): nearby states and other job types, each
          pill carrying its fresh canonical count, most listings first. */}
      {(nearbyStates.length > 0 || otherSettings.length > 0) && (
        <section style={{ background: 'linear-gradient(180deg, #FFF8F0 0%, #FDFBF7 100%)', padding: '40px 0' }}>
          <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '0 20px' }}>
            <div style={{ ...clayCard, padding: '28px 32px' }}>
              {nearbyStates.length > 0 && (
                <div style={otherSettings.length > 0 ? { marginBottom: '24px', paddingBottom: '24px', borderBottom: '1px solid rgba(0,0,0,0.06)' } : undefined}>
                  <h3 style={crossLinkHeadingStyle}>
                    {config.label} {brand.niche.short} jobs in nearby states
                  </h3>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {nearbyStates.map((neighbor) => (
                      <Link key={neighbor.href} href={neighbor.href} className="pseo-pill" style={pillStyle}>
                        {formatCountLabel({ name: neighbor.label, count: neighbor.count })} <ArrowRight size={12} style={{ color: '#BE185D' }} />
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {otherSettings.length > 0 && (
                <div>
                  <h3 style={crossLinkHeadingStyle}>
                    More job types in {stateName}
                  </h3>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {otherSettings.slice(0, MAX_OTHER_SETTING_PILLS).map((setting) => (
                      <Link key={setting.href} href={setting.href} className="pseo-pill" style={pillStyle}>
                        {formatCountLabel({ name: setting.label, count: setting.count })} <ArrowRight size={12} style={{ color: '#BE185D' }} />
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* FAQ (CS-S9): state-aware questions built from the facts above. The
          band renders only from this array, so the Speakable gate and the
          FAQPage schema can never outlive the answers. */}
      {rendersFaqAnswers && (
        <CategoryFAQ
          category={config.faqCategory as CategorySlug}
          totalJobs={facts.total}
          customFaqs={stateFaqs}
          heading={`${config.label} ${brand.niche.short} Jobs in ${stateName} FAQ`}
        />
      )}
    </div>
  );
}
