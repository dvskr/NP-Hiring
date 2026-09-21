import { cache } from 'react';
import type { Prisma } from '@prisma/client';
import { brand } from '@/config/brand';
import { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import Link from 'next/link';
import ImmersiveImage from '@/components/ImmersiveImage';
import {
  MapPin, Bell, DollarSign, Users, ArrowRight, Laptop, Shuffle, Hospital,
  Stethoscope, CalendarClock, ClipboardList, Briefcase,
} from 'lucide-react';
import CategoryHero, { crumbsFromSchema } from '@/components/CategoryHero';
import { stateDioramaSrc, stateDioramaBg } from '@/components/StateImage';
import { prisma } from '@/lib/prisma';
import { formatCount, indefiniteArticle, pluralize } from '@/lib/display-text';
import { JOB_LISTING_OMIT } from '@/lib/pseo/job-listing-omit';
import { BEST_SORT_ORDER_BY } from '@/lib/utils/job-sort';
import JobCard from '@/components/JobCard';
import BreadcrumbSchema from '@/components/BreadcrumbSchema';
import {
  stateToSlug, SETTING_CONFIGS, STATE_CODES, CODE_TO_STATE, URL_TO_STATE,
} from '@/lib/pseo/setting-state-config';
// P3 #9: the city-slug builder/guard pair the /jobs/city/[slug] route round-trips
// against; see cityLinkResolves for why building the slug is not enough.
// P4: MIN_CITY_JOBS_FOR_LINK is the inventory half of the same question. The
// two guards fail for different reasons: cityLinkResolves rejects a NAME the
// route cannot rebuild, MIN_CITY_JOBS_FOR_LINK rejects a city the route WILL
// resolve and then 404 on for lack of stock. Both are required.
// getStatesWithCityDirectory is the ONE eligibility answer for
// /jobs/locations/<state> (W2-LOCATIONS): a React cache()d map, keyed by the
// state name on Job.state, of every state whose directory actually renders.
// The hub reads it for its own directory link (HUB-S2) and for the nearby
// directories (HUB-S9) instead of re-deriving the rule, so a link here can
// never point at a directory that 404s.
import {
  MIN_CITY_JOBS_FOR_LINK,
  buildCitySlug,
  cityLinkResolves,
  getStatesWithCityDirectory,
  type StateCityDirectorySummary,
} from '@/app/jobs/locations/[state]/directory';
import { STATE_ELIGIBLE_CATEGORY_SLUGS } from '@/lib/pseo/taxonomy-registry';
import { buildPlainStateNarrative } from '@/lib/pseo/state-narrative';
import { METRO_CITIES } from '@/lib/metro-data';
import { Job } from '@/lib/types';
import { getStatePracticeAuthority } from '@/lib/state-practice-authority';
import { canonicalBucketWhere } from '@/lib/canonical-counts';
import { getListingFacts, type ListingFacts } from '@/lib/pseo/listing-facts';
import {
  CATEGORY_OVERLAP_NOTE,
  HUB_REFRESH_NOTE,
  HUB_REMOTE_LICENSURE_NOTE,
  buildBoardChecklistSentence,
  buildHubCategoriesSentence,
  buildHubCitiesSentences,
  buildHubDescription,
  buildHubEmployersSentence,
  buildHubFaqs,
  buildHubRecencySentence,
  buildHubScheduleSentence,
  buildHubSettingsSentence,
  buildHubTitle,
  buildHubWorkModeSentence,
  buildNewGradSentence,
  formatK,
} from '@/lib/pseo/listing-narrative';
import {
  MIN_JOBS_FOR_LINK_LIST_ROW,
  pseoStatsFreshnessThreshold,
  shouldIndexStateHub,
} from '@/lib/pseo/render-gate';
import { getNeighboringStates } from '@/lib/pseo/neighboring-states';
import { getNearbyStates, getPracticeEnvironment, isLicenseGuideLive } from '@/lib/pseo/practice-environment';
import { getPublishableSalaryGuideStates } from '@/lib/salary-analytics';
import { buildLicenseGuideSteps, getLicenseGuideState } from '@/lib/blog-license-guides';
import {
  ClayStyles,
  EmployerRoster,
  FAQ_SCHEMA_MIN_ENTRIES,
  LocationSpread,
  NearbyStatesTable,
  PostedPay,
  clayLink,
  clayList,
  clayMeta,
  clayRow,
  clayWell,
  postedPaySentence,
  type LocationSpreadPlace,
  type NearbyStateRow,
} from '@/components/seo/pseo';

/* Local illustration set (public/images/**). This page used to pull eight
   images from the retired remote asset bucket, every one of them returning
   HTTP 400, so the hero, three bento illustrations and four icon tiles were
   broken on all 51 state hubs. The hero now shows the state's own diorama
   (public/images/states/<slug>.png) and the bento pictures are local. */
const STATE_HERO_FALLBACK = { src: '/images/job-seekers/clinical-inperson.webp', bg: '#bfd4c2' };
const ART_PRACTICE = '/images/job-seekers/bento-guides.webp';
const ART_SALARY = '/images/job-seekers/bento-salary.webp';
const ART_RECENCY = '/images/employers/bento-analytics.webp';

const NP = brand.niche.short;

// force-dynamic removed: it overrides revalidate and defeats ISR caching.
// HUB-S6 prints HUB_REFRESH_NOTE ("refresh hourly"), which is only true
// while this stays at one hour.
export const revalidate = 3600;

const PAGE_SIZE = 10;

interface StatePageProps {
  params: Promise<{ state: string }>;
  searchParams: Promise<{ page?: string }>;
}

/**
 * Parse state from URL parameter
 * Handles: "california", "ca", "new-york", "ny"
 */
function parseStateParam(stateParam: string): { name: string; code: string } | null {
  const normalized = stateParam.toLowerCase().trim();

  // Try as state code (e.g., "ca")
  const upperCode = normalized.toUpperCase();
  if (CODE_TO_STATE[upperCode]) {
    return {
      name: CODE_TO_STATE[upperCode],
      code: upperCode,
    };
  }

  // Try as URL-friendly name (e.g., "california", "new-york")
  if (URL_TO_STATE[normalized]) {
    const stateName = URL_TO_STATE[normalized];
    return {
      name: stateName,
      code: STATE_CODES[stateName],
    };
  }

  // Try direct match with state name
  const directMatch = Object.keys(STATE_CODES).find(
    state => state.toLowerCase() === normalized
  );
  if (directMatch) {
    return {
      name: directMatch,
      code: STATE_CODES[directMatch],
    };
  }

  return null;
}

/** The state's job bucket: rows stored under the full name or the postal code. */
function stateBucketWhere(stateName: string, stateCode: string): Prisma.JobWhereInput {
  return { OR: [{ state: stateName }, { stateCode }] };
}

/**
 * The paginated listing, on the same canonical predicate as every count on
 * the page (PLAN T0-1), so "Positions in Texas (42)" and the cards agree.
 */
async function getStateJobs(stateName: string, stateCode: string, skip = 0, take = PAGE_SIZE) {
  return prisma.job.findMany({
    where: canonicalBucketWhere(stateBucketWhere(stateName, stateCode)),
    omit: JOB_LISTING_OMIT, // Perf1: cards don't use the full description body
    orderBy: BEST_SORT_ORDER_BY,
    skip,
    take,
  });
}

interface SettingStatsRow { categorySlug: string; totalJobs: number }

/**
 * HUB-S3 source: the state's setting-state PseoStats rows with inventory,
 * inside the freshness window. A stale row is dropped, never shown, and a
 * failed read renders no category section rather than a frozen one.
 */
async function getFreshSettingRows(stateSlug: string): Promise<SettingStatsRow[]> {
  try {
    return await prisma.pseoStats.findMany({
      where: {
        type: 'setting-state',
        locationSlug: stateSlug,
        totalJobs: { gte: 1 },
        updatedAt: { gte: pseoStatsFreshnessThreshold() },
      },
      select: { categorySlug: true, totalJobs: true },
      orderBy: { totalJobs: 'desc' },
    });
  } catch (error) {
    console.error(`[state-hub] setting-state rows failed for "${stateSlug}":`, error);
    return [];
  }
}

/** States whose salary guide publishes a gated median; empty on failure (S7 then does not count). */
async function getPublishableSalaryStates(): Promise<ReadonlySet<string>> {
  try {
    return await getPublishableSalaryGuideStates();
  } catch (error) {
    console.error('[state-hub] publishable salary states lookup failed:', error);
    return new Set();
  }
}

/**
 * HUB-S1 to S7 as the index gate counts them: each section's own builder
 * decides (null means the section is omitted) and S7 counts only when the
 * state publishes a gated median. This MUST stay identical to
 * countHubLiveDataSections in app/sitemap.ts (PLAN C.2: robots and the
 * sitemap read one predicate) until the count moves into the shared layer.
 */
function countHubLiveDataSections(stateName: string, facts: ListingFacts, publishesMedian: boolean): number {
  return [
    buildHubEmployersSentence({ stateName, facts }) !== null, // S1
    buildHubCitiesSentences(facts.cities) !== null, // S2
    buildHubCategoriesSentence(facts.categoryTop) !== null, // S3
    buildHubWorkModeSentence(facts.workMode) !== null, // S4
    buildHubSettingsSentence(facts.settings) !== null, // S5
    buildHubRecencySentence(facts.recency) !== null, // S6
    publishesMedian, // S7
  ].filter(Boolean).length;
}

interface CategoryRow { slug: string; label: string; count: number }

interface HubData {
  facts: ListingFacts;
  /** Fresh setting-state rows with inventory (HUB-S3 and the pill gate). */
  validSettingRows: SettingStatsRow[];
  /** The same rows with their display label; unlabeled (retired) slugs dropped. */
  categoryRows: CategoryRow[];
  liveDataSections: number;
}

/**
 * Everything generateMetadata and the page body share, loaded once per
 * request (React cache on the primitive slug). The canonical count inside
 * getListingFacts is the only query allowed to throw: a database error
 * surfaces as a 5xx, never as a false 404 or "0 jobs".
 */
const loadHubData = cache(async (stateName: string, stateCode: string, stateSlug: string): Promise<HubData> => {
  const [facts, validSettingRows, publishable] = await Promise.all([
    getListingFacts(`state:${stateSlug}`, stateBucketWhere(stateName, stateCode)),
    getFreshSettingRows(stateSlug),
    getPublishableSalaryStates(),
  ]);
  // Filter BEFORE slicing anywhere downstream so a stale row for a retired
  // slug (no SETTING_CONFIGS entry) costs a mention rather than silently
  // shrinking the list.
  const categoryRows = validSettingRows
    .map((row) => ({ slug: row.categorySlug, label: SETTING_CONFIGS[row.categorySlug]?.label, count: row.totalJobs }))
    .filter((row): row is CategoryRow => Boolean(row.label));
  return {
    facts,
    validSettingRows,
    categoryRows,
    liveDataSections: countHubLiveDataSections(stateName, facts, publishable.has(stateName)),
  };
});

/** Canonical job count per nearby state in one groupBy (HUB-S9); empty on failure. */
async function getNearbyStateCounts(stateName: string): Promise<Map<string, number>> {
  const neighbors = getNeighboringStates(stateName);
  if (neighbors.length === 0) return new Map();
  try {
    const groups = await prisma.job.groupBy({
      by: ['state'],
      where: canonicalBucketWhere({ state: { in: [...neighbors] } }),
      _count: { _all: true },
    });
    return new Map(groups.flatMap((g) => (g.state ? [[g.state, g._count._all] as const] : [])));
  } catch (error) {
    console.error(`[state-hub] nearby state counts failed for "${stateName}":`, error);
    return new Map();
  }
}

/**
 * Generate metadata for SEO (HUB-meta): the count only at the display
 * floor, the median or the employer count as the hook, a description
 * assembled from live facts within 155 characters, and robots from the
 * same gate the sitemap reads.
 */
export async function generateMetadata({ params, searchParams }: StatePageProps): Promise<Metadata> {
  try {
    const [{ state: stateParam }, sp] = await Promise.all([params, searchParams]);
    const page = Math.max(1, parseInt(sp.page || '1'));
    const stateInfo = parseStateParam(stateParam);

    if (!stateInfo) {
      return {
        title: 'State Not Found',
      };
    }

    const { name: stateName, code: stateCode } = stateInfo;
    const stateSlug = stateToSlug(stateName);
    const { facts, categoryRows, liveDataSections } = await loadHubData(stateName, stateCode, stateSlug);

    const title = buildHubTitle({
      stateName,
      stateCode,
      total: facts.total,
      distinctEmployers: facts.distinctEmployers,
      benchmark: facts.benchmark,
    });
    const description = buildHubDescription({
      stateName,
      facts,
      authorityDescription: getStatePracticeAuthority(stateName)?.description ?? null,
      topCategories: categoryRows.map((row) => row.label),
    });
    const indexable = shouldIndexStateHub({ activeJobs: facts.total, liveDataSections, page });

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        type: 'website',
        images: [{
          url: `/api/og?type=page&title=${encodeURIComponent(`${NP} Jobs in ${stateName}`)}&subtitle=${encodeURIComponent(`${formatCount(facts.total, `open ${NP} role`)} in ${stateCode}`)}`,
          width: 1200,
          height: 630,
          alt: `${NP} Jobs in ${stateName}`,
        }],
      },
      alternates: {
        // Canonical always points to page 1 (no ?page query): paginated
        // views are not indexable on their own (P3.5).
        // Canonical anchored on the normalized slug, NOT the request param.
        // /jobs/state/ny, /jobs/state/CA, /jobs/state/New%20York all resolve to
        // the same state but each would emit a different canonical if we used
        // the raw param, splintering the indexed forms.
        canonical: `${brand.baseUrl}/jobs/state/${stateSlug}`,
      },
      // PLAN C.2: index page 1 only with 3 or more canonical jobs AND 4 or
      // more live data sections (shouldIndexStateHub, the sitemap's gate).
      // Below it the page stays a 200 with a self canonical and follow.
      ...(!indexable && {
        robots: {
          index: false,
          follow: true,
        },
      }),
    };
  } catch (error) {
    console.error('Error generating metadata:', error);
    return {
      title: `${NP} Jobs by State`,
      description: `Browse ${brand.niche.descriptor} jobs by state, with the practice authority rules and the employers hiring in each one.`,
    };
  }
}

/** Decorative icon chip (the rose chip the rest of the page uses); the heading carries the meaning. */
const iconChip: React.CSSProperties = {
  width: '48px', height: '48px', borderRadius: '14px', flexShrink: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)',
};

/** Work-mode glyphs for the HUB-S4 icon well row; zero buckets are omitted. */
const WORK_MODE_TILES = [
  { key: 'remote', Icon: Laptop, label: 'Remote' },
  { key: 'hybrid', Icon: Shuffle, label: 'Hybrid' },
  { key: 'onsite', Icon: Hospital, label: 'On site' },
] as const;

/** The board name inside a sentence, linked to the board site. */
function withBoardLink(text: string, boardName: string, boardUrl: string): React.ReactNode {
  const at = text.indexOf(boardName);
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <a href={boardUrl} rel="nofollow noopener" style={clayLink}>{boardName}</a>
      {text.slice(at + boardName.length)}
    </>
  );
}

/**
 * State-specific job listings page
 */
export default async function StateJobsPage({ params, searchParams }: StatePageProps) {
  const [{ state: stateParam }, sp] = await Promise.all([params, searchParams]);
  const stateInfo = parseStateParam(stateParam);

  if (!stateInfo) {
    notFound();
  }

  const { name: stateName, code: stateCode } = stateInfo;

  // 308 redirect any non-canonical form (state code, mixed case, encoded
  // space) to the canonical hyphenated lowercase slug. parseStateParam
  // accepts ny / CA / New%20York all as valid; without this redirect each
  // form would render its own copy of the page with conflicting canonicals.
  const stateSlug = stateToSlug(stateName);
  if (stateParam !== stateSlug) {
    const qs = new URLSearchParams(sp as Record<string, string>).toString();
    permanentRedirect(`/jobs/state/${stateSlug}${qs ? `?${qs}` : ''}`);
  }
  const page = Math.max(1, parseInt(sp.page || '1'));
  const skip = (page - 1) * PAGE_SIZE;

  // Fetch all data in parallel for content enrichment
  const [jobs, hub, nearbyCounts, licenseGuideLive, cityDirectories] = await Promise.all([
    getStateJobs(stateName, stateCode, skip, PAGE_SIZE),
    loadHubData(stateName, stateCode, stateSlug),
    getNearbyStateCounts(stateName),
    isLicenseGuideLive(stateSlug),
    getStatesWithCityDirectory(),
  ]);
  const { facts, validSettingRows, categoryRows } = hub;

  // GSC Fix: empty-state guard. Metadata-level noindex is not enough on
  // its own: the page would still render a "0 active positions" shell
  // that Google classifies as soft 404. Pull the plug entirely when there
  // is nothing to show. Mirrors lib/pseo/setting-state-template.tsx.
  if (facts.total === 0) {
    notFound();
  }

  // The two counts the hero and the listings print.
  const stats = { totalJobs: facts.total, uniqueEmployerCount: facts.distinctEmployers };
  const totalPages = Math.ceil(stats.totalJobs / PAGE_SIZE);
  const basePath = `/jobs/state/${stateSlug}`;

  // GSC Fix (P1.5): only render setting pills for setting x state combos
  // that actually have a fresh row with 1 or more active jobs. HUB-S3:
  // a pill LINKS /jobs/{slug}/{state} only at MIN_JOBS_FOR_LINK_LIST_ROW,
  // because a category x state page with 1 to 2 jobs renders noindex;
  // smaller categories stay as plain text with their count.
  // P1 #16 (state side): the pill list derives from the registry's
  // state-eligible set instead of a hardcoded slug array.
  const validSettingSlugs = new Set(validSettingRows.map(r => r.categorySlug));
  const settingCounts = new Map(validSettingRows.map((r) => [r.categorySlug, r.totalJobs]));
  const categoryPills = STATE_ELIGIBLE_CATEGORY_SLUGS
    .filter((slug) => validSettingSlugs.has(slug))
    .map((slug) => {
      const count = settingCounts.get(slug) ?? 0;
      return {
        slug,
        label: SETTING_CONFIGS[slug]?.label ?? slug,
        count,
        linkable: count >= MIN_JOBS_FOR_LINK_LIST_ROW,
      };
    });
  const categoryStateHref = (slug: string): string | null =>
    categoryPills.some((pill) => pill.slug === slug && pill.linkable) ? `/jobs/${slug}/${stateSlug}` : null;
  const categoriesSentence = buildHubCategoriesSentence(categoryRows);

  // P3 #9 / P4: a city gets a link only when it survives BOTH gates: the
  // slug round-trip (cityLinkResolves) and the MIN_CITY_JOBS_FOR_LINK
  // inventory floor the city route 404s below. Rejected cities keep their
  // real name and count (the narrative and HUB-S2 still name them) but
  // carry an empty slug so no surface points at a known 404.
  const citiesWithJobs = facts.cities.map((city) => {
    const name = city.name;
    const linkable =
      city.count >= MIN_CITY_JOBS_FOR_LINK && cityLinkResolves(name, stateCode);
    return {
      name,
      count: city.count,
      slug: linkable ? buildCitySlug(name, stateCode) : '',
    };
  });
  // Metro guides in this state (editorial pages at /jobs/metro/[slug]),
  // linked from the Explore section so the metro pages are not orphans.
  const stateMetros = METRO_CITIES.filter((m) => m.state === stateName);
  // A curated metro is served at /jobs/metro/<slug> (the city route 308s there).
  const metroSlugs = new Set(stateMetros.map((m) => m.slug));
  const cityPlaces: LocationSpreadPlace[] = citiesWithJobs.map((c) => ({
    name: c.name,
    count: c.count,
    link: c.slug ? { href: metroSlugs.has(c.slug) ? `/jobs/metro/${c.slug}` : `/jobs/city/${c.slug}`, renders: true } : null,
  }));
  const citiesSentences = buildHubCitiesSentences(facts.cities, MIN_CITY_JOBS_FOR_LINK);
  // HUB-S2 directory link, only when /jobs/locations/{state} renders: the
  // shared map IS the directory page's own decision, so the two cannot drift.
  const directoryLink = {
    href: `/jobs/locations/${stateSlug}`,
    renders: cityDirectories.has(stateName),
    label: `See every ${stateName} city with open roles`,
  };

  // P1 #11: deterministic per-state narrative built from practice authority
  // data, the gated median, live category and city inventory and NLC
  // membership. All figures come from the facts loader or repo regulatory data.
  const topCategoryLabels = categoryRows.slice(0, 3).map((row) => row.label);
  const stateNarrative = buildPlainStateNarrative({
    stateName,
    stateCode,
    totalJobs: stats.totalJobs,
    medianSalaryK: facts.benchmark ? Math.round(facts.benchmark.median / 1000) : 0,
    uniqueEmployerCount: stats.uniqueEmployerCount,
    topCategoryLabels,
    topCityNames: citiesWithJobs.slice(0, 3).map((c) => c.name),
  });

  // HUB-S4 to S7 render decisions, each from its own builder.
  const workModeSentence = buildHubWorkModeSentence(facts.workMode);
  const scheduleSentence = buildHubScheduleSentence(facts.jobTypes);
  const workModeTiles = WORK_MODE_TILES
    .map((tile) => ({ ...tile, count: facts.workMode[tile.key] }))
    .filter((tile) => tile.count > 0);
  const remoteHref = categoryStateHref('remote');
  const telehealthHref = categoryStateHref('telehealth');
  const settingsSentence = buildHubSettingsSentence(facts.settings);
  const recencySentence = buildHubRecencySentence(facts.recency);
  const newGradSentence = buildNewGradSentence(facts.newGradFriendly);
  const newGradHref = categoryStateHref('new-grad') ?? '/jobs/new-grad';
  const payVariant = { kind: 'location', scopeName: stateName, scopeNoun: 'state' } as const;
  const paySentence = postedPaySentence(payVariant, facts);

  // Practice authority (bento) and licensure path (HUB-S8) from the datasets.
  const practiceAuthority = getStatePracticeAuthority(stateName);
  const practiceEnv = getPracticeEnvironment(stateName);
  const licenseState = getLicenseGuideState(stateSlug);
  const licenseSteps = licenseState ? buildLicenseGuideSteps(licenseState) : [];

  // HUB-S9: nearby states with their canonical counts; the table links a
  // hub only at 1 or more jobs (its own render gate).
  const nearbyRows: NearbyStateRow[] = getNearbyStates(stateName).map((env) => {
    const count = nearbyCounts.get(env.stateName) ?? 0;
    return { env, jobs: count, link: { href: `/jobs/state/${env.stateSlug}`, renders: count >= 1 } };
  });
  const nearbyWithJobs = nearbyRows.filter((row) => row.jobs >= 1).sort((a, b) => b.jobs - a.jobs);
  // HUB-S9 continued: the nearby states that publish a city directory of
  // their own, in the same order as the table. Eligibility is the shared
  // map's, never re-derived here.
  const nearbyDirectories = nearbyWithJobs
    .map((row) => cityDirectories.get(row.env.stateName))
    .filter((summary): summary is StateCityDirectorySummary => Boolean(summary));

  // P2 #1: the page most about this state leads with the state's own
  // 1024x1024 diorama instead of one generic map illustration shared by
  // all 51 hubs. CategoryHero renders it `object-fit: contain` over a panel
  // painted `bgColor`, so the panel takes the artwork's own sampled backdrop
  // and the square art blends into it rather than sitting in coloured bars.
  // Every slug this route can reach has a file (pinned by the regression
  // test); the fallback keeps a state without artwork on a real local image.
  const dioramaSrc = stateDioramaSrc(stateSlug);
  const heroImage = dioramaSrc ?? STATE_HERO_FALLBACK.src;
  const heroBgColor = dioramaSrc ? stateDioramaBg(stateSlug) : STATE_HERO_FALLBACK.bg;
  // HUB-removals: the generic hero description is replaced by the live
  // summary the metadata also carries (employers, cities, authority, median).
  const heroDescription = buildHubDescription({
    stateName,
    facts,
    authorityDescription: practiceAuthority?.description ?? null,
    topCategories: topCategoryLabels,
  });

  // ONE array feeds both the visible FAQ accordion and the FAQPage JSON-LD
  // (HUB-S10): every entry inside buildHubFaqs is conditional on the facts
  // it cites, so a question whose render condition fails is absent from
  // the markup and the schema at once, and the schema can never emit a
  // stub that mismatches the visible answer (B48/B52).
  const stateFaqs = [
    ...buildHubFaqs({
      stateName,
      facts,
      env: practiceEnv,
      categoryRows,
      stepNames: licenseSteps.map((step) => step.name),
    }),
  ];

  const crumbs = [
    { name: 'Home', url: brand.baseUrl },
    { name: 'Jobs', url: `${brand.baseUrl}/jobs` },
    { name: stateName, url: `${brand.baseUrl}/jobs/state/${stateSlug}` },
  ];

  /* Design Tokens */
  const clayCard: React.CSSProperties = {
    background: '#FFFFFF', borderRadius: '20px',
    border: '1px solid rgba(255,255,255,0.5)',
    boxShadow: '6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02)',
  };
  const pill: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '7px 16px', borderRadius: '12px',
    textDecoration: 'none', fontSize: '13px', fontWeight: 600, color: '#1A2E35', background: '#FFFFFF',
    border: '1px solid rgba(255,255,255,0.5)',
    boxShadow: '3px 3px 8px rgba(0,0,0,0.05), -2px -2px 6px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6)',
  };
  const eyebrow: React.CSSProperties = {
    fontSize: '13px', fontWeight: 600, color: '#E86C2C', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px',
  };
  const bandTitle: React.CSSProperties = {
    fontSize: 'clamp(24px, 3.2vw, 34px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '40px',
  };
  const cardTitle: React.CSSProperties = { fontSize: '17px', fontWeight: 800, color: '#1A2E35', margin: 0 };
  const cardHead: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' };
  const body: React.CSSProperties = { fontSize: '14px', color: '#5A4A42', margin: '0 0 10px', lineHeight: 1.65 };
  const muted: React.CSSProperties = { fontSize: '12.5px', color: '#7A6A62', margin: 0, lineHeight: 1.5 };

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#FDFBF7' }}>
      <ClayStyles />
      <BreadcrumbSchema items={crumbs} />
      {jobs.length > 0 && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
          '@context': 'https://schema.org', '@type': 'ItemList',
          name: `${NP} Jobs in ${stateName}`, numberOfItems: stats.totalJobs,
          itemListElement: jobs.slice(0, 10).map((job: Job, idx: number) => ({
            '@type': 'ListItem', position: idx + 1, name: job.title,
            url: `${brand.baseUrl}/jobs/${job.slug || job.id}`,
          })),
        }) }} />
      )}
      {/* AggregateOffer node removed (P1 #11 truth sweep, 2026-07): it
          emitted lowPrice and highPrice as plus or minus 20% of a mean that
          traced to no source. schema.org lowPrice / highPrice mean the
          cheapest and dearest offer in the set, so no page-level band is a
          truthful reading here; JobPosting.baseSalary is emitted per job on
          the detail pages. Omit rather than fabricate. The only salary
          figure this page prints is the gated median from
          lib/pseo/listing-facts.ts, single-sourced into the FAQPage JSON-LD
          from the visible accordion. */}

      {/* HERO */}
      <CategoryHero
        bgColor={heroBgColor}
        heroImage={heroImage}
        heroAlt={dioramaSrc
          ? `Illustrated diorama representing ${stateName}`
          : `${NP} jobs across the United States`}
        badgeText={`${stats.totalJobs} live ${pluralize(stats.totalJobs, 'role')} · updated today`}
        breadcrumbs={crumbsFromSchema(crumbs)}
        headlineLine1={NP}
        headlineLine2="Jobs"
        headlineSub={`in ${stateName}.`}
        stats={[
          { value: `${stats.totalJobs}`, label: pluralize(stats.totalJobs, 'position') },
          // The stat is dropped rather than padded below the publishing
          // gate: the only figure ever shown is the gated median.
          ...(facts.benchmark
            ? [{ value: formatK(facts.benchmark.median), label: 'median pay' }]
            : []),
          { value: `${stats.uniqueEmployerCount}`, label: pluralize(stats.uniqueEmployerCount, 'employer') },
        ]}
        description={heroDescription}
        ctaLabel={`Browse ${stateName} Jobs`}
        ctaHref="#listings"
        secondaryCtaLabel="Set Alert"
        secondaryCtaHref="/job-alerts"
      />

      {/* JOB LISTINGS: 4-col grid */}
      <div style={{ maxWidth: '1440px', margin: '0 auto', padding: '32px 24px' }}>
        <div className="grid lg:grid-cols-4 gap-8">
          <div className="lg:col-span-3">
            <div className="flex items-center justify-between mb-6">
              <h2 id="listings" className="font-lora" style={{ fontSize: '20px', fontWeight: 700, color: '#1A2E35' }}>
                Positions in {stateName} ({stats.totalJobs})
              </h2>
              <Link href="/jobs" className="text-sm font-medium hover:opacity-80 transition-opacity" style={{ color: '#BE185D' }}>View All Jobs →</Link>
            </div>
            {jobs.length === 0 ? (
              <div className="text-center py-12 rounded-xl" style={{ ...clayCard, padding: '48px 24px' }}>
                <MapPin className="h-12 w-12 mx-auto mb-4" style={{ color: '#7A6A62' }} />
                <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#1A2E35', marginBottom: '8px' }}>No positions on page {page}</h3>
                <p style={{ fontSize: '14px', color: '#5A4A42', marginBottom: '16px' }}>
                  <Link href={basePath} style={clayLink}>Start from the first page of {stateName} listings</Link>
                  {nearbyWithJobs.length > 0 ? ', or check nearby states:' : '.'}
                </p>
                {nearbyWithJobs.length > 0 && (
                  <div className="flex flex-wrap justify-center gap-2 mb-6">
                    {nearbyWithJobs.slice(0, 4).map((row) => (
                      <Link key={row.env.stateCode} href={`/jobs/state/${row.env.stateSlug}`} className="cat-bento-card"
                        style={{ padding: '6px 14px', borderRadius: '12px', backgroundColor: '#FDF2F8', color: '#BE185D', fontWeight: 600, fontSize: '13px', textDecoration: 'none' }}>
                        {row.env.stateName} ({row.jobs})
                      </Link>
                    ))}
                  </div>
                )}
                <Link href="/jobs/remote" className="cat-cta-primary" style={{ padding: '12px 28px', borderRadius: '14px', fontWeight: 700, fontSize: '14px', background: '#BE185D', color: '#fff', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '8px', boxShadow: '4px 4px 12px rgba(190,24,93,0.2)' }}>Browse Remote Jobs <ArrowRight size={16} /></Link>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
                  {jobs.map((job: Job) => (<JobCard key={job.id} job={job} />))}
                </div>

                {totalPages > 1 && (
                  <div className="mt-8 flex items-center justify-center gap-4">
                    {page > 1 ? (
                      <Link href={`${basePath}?page=${page - 1}`} className="px-4 py-2 text-sm font-medium rounded-lg" style={{ ...clayCard, color: '#1A2E35', padding: '8px 16px' }}>
                        ← Previous
                      </Link>
                    ) : (
                      <span className="px-4 py-2 text-sm rounded-lg cursor-not-allowed" style={{ color: '#7A6A62', backgroundColor: '#F5F0EB' }}>← Previous</span>
                    )}
                    <span className="text-sm" style={{ color: '#5A4A42' }}>Page {page} of {totalPages}</span>
                    {page < totalPages ? (
                      <Link href={`${basePath}?page=${page + 1}`} className="px-4 py-2 text-sm font-medium rounded-lg" style={{ ...clayCard, color: '#1A2E35', padding: '8px 16px' }}>
                        Next →
                      </Link>
                    ) : (
                      <span className="px-4 py-2 text-sm rounded-lg cursor-not-allowed" style={{ color: '#7A6A62', backgroundColor: '#F5F0EB' }}>Next →</span>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
          {/* Sidebar: the one alert CTA on the page, then HUB-S1 */}
          <div className="lg:col-span-1">
            {/* "Delivered daily" is the send-alerts cron cadence
                (config/cron-schedule.ts, daily group), not a claim about how
                often listings are added. */}
            <div className="cat-bento-card" style={{ ...clayCard, padding: '0', overflow: 'hidden', marginBottom: '20px', background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)', border: '2px solid rgba(190,24,93,0.15)' }}>
              <div style={{ padding: '24px' }}>
                <Bell size={28} style={{ color: '#BE185D', marginBottom: '12px' }} />
                <h3 className="font-lora" style={{ fontSize: '18px', fontWeight: 700, color: '#831843', margin: '0 0 8px' }}>{stateName} Alerts</h3>
                <p style={{ fontSize: '13px', color: '#BE185D', marginBottom: '16px', lineHeight: 1.6, fontWeight: 500 }}>New {stateName} listings delivered daily.</p>
                <Link href={`/job-alerts?location=${encodeURIComponent(stateName)}`} className="cat-cta-primary" style={{ display: 'block', width: '100%', textAlign: 'center', padding: '10px 20px', borderRadius: '10px', fontWeight: 700, fontSize: '13px', background: '#BE185D', color: '#fff', textDecoration: 'none', boxShadow: '3px 3px 8px rgba(190,24,93,0.15)' }}>Create Alert</Link>
              </div>
            </div>
            {/* HUB-S1: named employers with counts, company links only where
                the company still has active jobs; nothing below 2 employers. */}
            <EmployerRoster
              variant={{ kind: 'hub', stateName }}
              facts={facts}
              title={`Who is hiring in ${stateName}`}
              className="cat-bento-card"
            />
          </div>
        </div>
      </div>

      {/* HUB-S2 and S3: where the roles are, by city and by category */}
      {(citiesSentences || categoriesSentence) && (
        <div style={{ padding: '8px 0 48px' }}>
          <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '0 20px' }}>
            <p style={eyebrow}>Live inventory</p>
            <h2 className="font-lora" style={bandTitle}>Where the {NP} roles in {stateName} are</h2>
            <div className={`pseo-clay-grid${citiesSentences && categoriesSentence ? ' pseo-clay-cols-2' : ''}`}>
              <LocationSpread
                variant={{ kind: 'hub', minLinkJobs: MIN_CITY_JOBS_FOR_LINK }}
                places={cityPlaces}
                directory={directoryLink}
                title={`Where in ${stateName} the roles are`}
                className="cat-bento-card"
              />
              {categoriesSentence && (
                <div className="cat-bento-card" style={{ ...clayCard, padding: '24px' }}>
                  <div style={cardHead}>
                    <span aria-hidden="true" style={iconChip}>
                      <Briefcase size={22} style={{ color: '#BE185D' }} />
                    </span>
                    <h3 style={cardTitle}>Open roles by category</h3>
                  </div>
                  <p style={body}>{categoriesSentence}</p>
                  <p style={muted}>{CATEGORY_OVERLAP_NOTE}</p>
                  {categoryPills.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '16px' }}>
                      {categoryPills.map((setting) => setting.linkable ? (
                        <Link key={setting.slug} href={`/jobs/${setting.slug}/${stateSlug}`} className="pseo-pill" style={pill}>
                          {setting.label} <span style={clayMeta}>{setting.count}</span>
                        </Link>
                      ) : (
                        <span key={setting.slug} style={{ ...pill, color: '#7A6A62', boxShadow: 'none', background: '#F9F7F1' }}>
                          {setting.label} <span style={clayMeta}>{setting.count}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* BENTO: State Overview */}
      <div style={{ background: 'linear-gradient(180deg, #FFF8F0 0%, #FDFBF7 100%)', padding: '48px 0' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '0 20px' }}>
          <p style={eyebrow}>{stateName} Overview</p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(26px, 3.5vw, 38px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '20px' }}>Working as {indefiniteArticle(NP)} {NP} in {stateName}</h2>

          {/* P1 #11: per-state narrative block, deterministic prose built from
              practice authority data, the gated median, live category and
              city inventory and NLC membership. */}
          <p style={{ fontSize: '15px', color: '#5A4A42', maxWidth: '820px', margin: '0 auto 48px', lineHeight: 1.8 }}>{stateNarrative}</p>

          <div className="cat-bento-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '14px' }}>
            {/* ROW 1: Practice Authority (8col) + HUB-S7 posted pay (4col) */}
            {practiceAuthority && (
              <div className="cat-bento-hero-1" style={{ ...clayCard, gridColumn: paySentence ? 'span 8' : 'span 12', padding: '0', overflow: 'hidden', display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                <div style={{ padding: '32px 28px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <h3 style={{ fontSize: '20px', fontWeight: 800, color: '#1A2E35', margin: '0 0 8px' }}>Practice Authority</h3>
                  <p style={{ fontSize: '14px', color: '#5A4A42', margin: '0 0 12px', lineHeight: 1.6 }}>
                    {practiceAuthority.details}
                  </p>
                  <span style={{ display: 'inline-block', width: 'fit-content', padding: '4px 14px', borderRadius: '12px', fontSize: '12px', fontWeight: 700, background: practiceAuthority.authority === 'full' ? '#D1FAE5' : practiceAuthority.authority === 'reduced' ? '#FEF3C7' : '#FEE2E2', color: practiceAuthority.authority === 'full' ? '#065F46' : practiceAuthority.authority === 'reduced' ? '#92400E' : '#991B1B' }}>
                    {practiceAuthority.description}
                  </span>
                </div>
                <ImmersiveImage src={ART_PRACTICE} alt="" minHeight={240} />
              </div>
            )}

            {/* HUB-S7: the gated median with its middle half, or below the
                gate the counted sentence with the BLS cite; nothing when no
                posting states a salary. The picture sits in its own frame so
                the pay card is never nested inside a second clay surface. */}
            {paySentence && (
              <div className="cat-bento-hero-2" style={{ gridColumn: 'span 4', display: 'grid', gap: '14px', alignContent: 'start' }}>
                <div className="cat-bento-card" style={{ ...clayCard, padding: '0', overflow: 'hidden', display: 'grid' }}>
                  <ImmersiveImage src={ART_SALARY} alt="" minHeight={200} />
                </div>
                <PostedPay
                  variant={payVariant}
                  facts={facts}
                  title={`Posted pay in ${stateName}`}
                  salaryGuide={{ href: `/salary-guide/${stateSlug}`, renders: true, label: `See the ${stateName} salary guide` }}
                  className="cat-bento-card"
                />
              </div>
            )}

            {/* ROW 2: HUB-S4 work mode and schedule, an icon well per work
                mode with a live count (zero buckets omitted). Replaces the
                four generic setting tiles. The glyphs are decorative; the
                heading and the sentences carry the meaning. */}
            {workModeSentence && (
              <div className="cat-bento-wide cat-bento-card" style={{ ...clayCard, gridColumn: 'span 12', padding: '28px' }}>
                <div style={cardHead}>
                  <h3 style={cardTitle}>Work mode and schedule</h3>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
                  {workModeTiles.map(({ key, Icon, label, count }) => (
                    <div key={key} style={{ ...clayWell, justifyContent: 'flex-start', gap: '12px', padding: '10px 18px 10px 10px', borderRadius: '16px' }}>
                      <span aria-hidden="true" style={iconChip}>
                        <Icon size={22} style={{ color: '#BE185D' }} />
                      </span>
                      <span style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontSize: '20px', fontWeight: 800, color: '#1A2E35', lineHeight: 1.1 }}>{count}</span>
                        <span style={{ fontSize: '11px', fontWeight: 600, color: '#7A6A62', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
                      </span>
                    </div>
                  ))}
                </div>
                <p style={body}>{workModeSentence}</p>
                {scheduleSentence && <p style={body}>{scheduleSentence}</p>}
                {facts.workMode.remote > 0 && <p style={muted}>{HUB_REMOTE_LICENSURE_NOTE}</p>}
                {(remoteHref || telehealthHref) && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '16px' }}>
                    {remoteHref && (
                      <Link href={remoteHref} className="pseo-pill" style={pill}>Remote {NP} roles in {stateName} <ArrowRight size={12} style={{ color: '#BE185D' }} /></Link>
                    )}
                    {telehealthHref && (
                      <Link href={telehealthHref} className="pseo-pill" style={pill}>Telehealth {NP} roles in {stateName} <ArrowRight size={12} style={{ color: '#BE185D' }} /></Link>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ROW 3: HUB-S5 clinical settings (4col) + HUB-S6 recency (8col,
                replaces the Growth card and the second alert card) */}
            {settingsSentence && (
              <div className="cat-bento-card" style={{ ...clayCard, gridColumn: 'span 4', padding: '24px 22px' }}>
                <div style={cardHead}>
                  <span aria-hidden="true" style={iconChip}>
                    <Stethoscope size={22} style={{ color: '#BE185D' }} />
                  </span>
                  <h3 style={cardTitle}>Clinical settings named in postings</h3>
                </div>
                <p style={{ ...body, margin: 0 }}>{settingsSentence}</p>
                <ul style={clayList}>
                  {facts.settings.top.slice(0, 4).map((row, i, all) => (
                    <li key={row.label} style={clayRow(i === all.length - 1)}>
                      <span>{row.label}</span>
                      <span style={clayMeta}>{formatCount(row.count, 'posting')}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {recencySentence && (
              <div className="cat-bento-hero-3 cat-bento-card" style={{ ...clayCard, gridColumn: settingsSentence ? 'span 8' : 'span 12', padding: '0', overflow: 'hidden', display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                <div style={{ padding: '32px 28px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <span aria-hidden="true" style={{ ...iconChip, marginBottom: '16px' }}>
                    <CalendarClock size={22} style={{ color: '#BE185D' }} />
                  </span>
                  <h3 style={{ fontSize: '20px', fontWeight: 800, color: '#1A2E35', margin: '0 0 8px' }}>How current the listings are</h3>
                  <p style={body}>{recencySentence}</p>
                  {newGradSentence && (
                    <p style={body}>
                      {newGradSentence}{' '}
                      <Link href={newGradHref} style={clayLink}>See new graduate {NP} roles</Link>
                    </p>
                  )}
                  <p style={muted}>{HUB_REFRESH_NOTE}</p>
                </div>
                <ImmersiveImage src={ART_RECENCY} alt="" minHeight={240} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* HUB-S8 licensure path + HUB-S9 nearby states compared */}
      {(licenseState || nearbyWithJobs.length > 0) && (
        <div style={{ background: 'linear-gradient(180deg, #FDFBF7 0%, #FFF8F0 100%)', padding: '48px 0' }}>
          <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '0 20px' }}>
            <p style={eyebrow}>Licensure and nearby states</p>
            <h2 className="font-lora" style={bandTitle}>Practicing in {stateName}</h2>
            <div className={`pseo-clay-grid${licenseState && nearbyWithJobs.length > 0 ? ' pseo-clay-cols-2' : ''}`}>
              {licenseState && (
                <div className="cat-bento-card" style={{ ...clayCard, padding: '28px' }}>
                  <div style={cardHead}>
                    <span aria-hidden="true" style={iconChip}>
                      <ClipboardList size={22} style={{ color: '#BE185D' }} />
                    </span>
                    <h3 style={cardTitle}>Licensure path in {stateName}</h3>
                  </div>
                  {/* Step names only while the state's license guide is
                      published (the guide carries the step text and the
                      procedure schema); the full text renders here only
                      when the guide is not live. */}
                  <ol style={{ margin: 0, padding: '0 0 0 20px', fontSize: '14px', color: '#5A4A42', lineHeight: 1.65, display: 'grid', gap: '8px' }}>
                    {licenseSteps.map((step) => (
                      <li key={step.name}>
                        <span style={{ fontWeight: 700, color: '#1A2E35' }}>{step.name}</span>
                        {!licenseGuideLive && <span style={{ display: 'block' }}>{step.text}</span>}
                      </li>
                    ))}
                  </ol>
                  <p style={{ ...body, margin: '16px 0 0' }}>
                    {withBoardLink(buildBoardChecklistSentence(licenseState.boardName), licenseState.boardName, licenseState.boardUrl)}
                  </p>
                  <ul style={clayList}>
                    {licenseGuideLive && (
                      <li style={clayRow(false)}>
                        <Link href={`/blog/${licenseState.slug}`} style={clayLink}>Read the {stateName} {NP} license guide</Link>
                      </li>
                    )}
                    <li style={clayRow(false)}>
                      <Link href="/tools/licensure-checker" style={clayLink}>Check licensure requirements by state</Link>
                    </li>
                    <li style={clayRow(true)}>
                      <Link href="/resources/fpa-guide" style={clayLink}>Full practice authority guide</Link>
                    </li>
                  </ul>
                </div>
              )}
              {nearbyWithJobs.length > 0 && (
                <div>
                  <NearbyStatesTable rows={nearbyRows} variant="hub" caption={`Nearby states with open ${NP} roles`} />
                  {/* HUB-S9 city directories nearby: one pill per nearby
                      state that publishes its own /jobs/locations page. */}
                  {nearbyDirectories.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '16px' }}>
                      {nearbyDirectories.map((summary) => (
                        <Link key={summary.slug} href={`/jobs/locations/${summary.slug}`} className="pseo-pill" style={pill}>
                          Cities in {summary.name} <span style={clayMeta}>{formatCount(summary.linkableCities, 'city', 'cities')}</span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* EXPLORE: metro guides + resources */}
      <div style={{ background: 'linear-gradient(180deg, #FDFBF7 0%, #FFF8F0 50%, #FDFBF7 100%)' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '56px 20px' }}>
          <p style={eyebrow}>Explore</p>
          <h2 className="font-lora" style={bandTitle}>More {NP} Opportunities in {stateName}</h2>

          {/* Cross-Links Card */}
          <div style={{ ...clayCard, padding: '28px 32px' }}>

            {/* Metro Guides: editorial metro landing pages in this state */}
            {stateMetros.length > 0 && (
              <div style={{ marginBottom: '24px', paddingBottom: '24px', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#7A6A62', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '12px' }}>
                  {stateName} Metro Guides
                </h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {stateMetros.map((m) => (
                    <Link key={m.slug} href={`/jobs/metro/${m.slug}`} className="pseo-pill" style={pill}>
                      {m.city} {NP} Guide <ArrowRight size={12} style={{ color: '#BE185D' }} />
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Resources: clay row */}
            <div>
              <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#7A6A62', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '12px' }}>
                Explore More
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                <Link href={`/salary-guide/${stateSlug}`}
                  className="pseo-resource"
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 16px', borderRadius: '14px', textDecoration: 'none', background: '#FFFFFF', border: '1px solid rgba(255,255,255,0.5)', boxShadow: '4px 4px 10px rgba(0,0,0,0.05), -2px -2px 6px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6)' }}>
                  <DollarSign size={18} style={{ color: '#BE185D', flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: '#1A2E35' }}>{stateName} Salary Guide</div>
                    <div style={{ fontSize: '11px', color: '#7A6A62', marginTop: '2px' }}>Posted pay and practice environment</div>
                  </div>
                </Link>
                <Link href="/jobs/locations"
                  className="pseo-resource"
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 16px', borderRadius: '14px', textDecoration: 'none', background: '#FFFFFF', border: '1px solid rgba(255,255,255,0.5)', boxShadow: '4px 4px 10px rgba(0,0,0,0.05), -2px -2px 6px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6)' }}>
                  <MapPin size={18} style={{ color: '#BE185D', flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: '#1A2E35' }}>All Locations</div>
                    <div style={{ fontSize: '11px', color: '#7A6A62', marginTop: '2px' }}>Every state and city with open roles</div>
                  </div>
                </Link>
                <Link href="/jobs"
                  className="pseo-resource"
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 16px', borderRadius: '14px', textDecoration: 'none', background: '#FFFFFF', border: '1px solid rgba(255,255,255,0.5)', boxShadow: '4px 4px 10px rgba(0,0,0,0.05), -2px -2px 6px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6)' }}>
                  <Users size={18} style={{ color: '#BE185D', flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: '#1A2E35' }}>All {NP} Jobs</div>
                    <div style={{ fontSize: '11px', color: '#7A6A62', marginTop: '2px' }}>Nationwide listings</div>
                  </div>
                </Link>
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* FAQ (HUB-S10) */}
      {stateFaqs.length > 0 && (
        <div style={{ background: 'linear-gradient(180deg, #FDF2F8 0%, #FDF2F8 50%, #FDF2F8 100%)' }}>
          <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '56px 20px' }}>
            <p style={{ ...eyebrow, color: '#BE185D' }}>FAQ</p>
            <h2 className="font-lora" style={bandTitle}>{NP} Jobs in {stateName}</h2>
            <div style={{ display: 'grid', gap: '12px' }}>
              {stateFaqs.map((faq, idx) => (
                <details key={faq.question} className="faq-accordion" style={{ ...clayCard, overflow: 'hidden' }} open={idx === 0}>
                  <summary style={{ padding: '20px 28px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', listStyle: 'none', fontSize: '16px', fontWeight: 700, color: '#1A2E35', lineHeight: 1.4 }}>
                    <span>{faq.question}</span>
                    <span className="faq-chevron" style={{ flexShrink: 0, width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', background: '#FDF2F8', color: '#BE185D', fontSize: '18px', fontWeight: 700 }}>+</span>
                  </summary>
                  <div style={{ padding: '0 28px 20px' }}>
                    <p className="faq-answer" style={{ fontSize: '14px', color: '#5A4A42', lineHeight: 1.7, margin: 0 }}>{faq.answer}</p>
                  </div>
                </details>
              ))}
            </div>
            {/* FAQPage only at 2 or more entries; angle brackets escaped so no
                answer can close this element early (repo convention). */}
            {stateFaqs.length >= FAQ_SCHEMA_MIN_ENTRIES && (
              <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: stateFaqs.map(f => ({ '@type': 'Question', name: f.question, acceptedAnswer: { '@type': 'Answer', text: f.answer } })) }).replace(/</g, '\\u003c') }} />
            )}
          </section>
        </div>
      )}

      {/* RESPONSIVE CSS (static string, no interpolation) */}
      <style>{`
        .cat-cta-primary { transition: transform 0.25s ease, box-shadow 0.25s ease, filter 0.25s ease; }
        .cat-cta-primary:hover { transform: translateY(-3px); box-shadow: 0 10px 32px rgba(190,24,93,0.35) !important; filter: brightness(1.05); }
        .cat-bento-card { transition: transform 0.3s ease, box-shadow 0.3s ease; }
        .cat-bento-card:hover { transform: translateY(-4px); box-shadow: 8px 8px 24px rgba(0,0,0,0.1), -4px -4px 12px rgba(255,255,255,0.9), inset 1px 1px 2px rgba(255,255,255,0.6) !important; }
        .pseo-pill { transition: transform 0.25s ease, box-shadow 0.25s ease; }
        .pseo-pill:hover { transform: translateY(-3px); box-shadow: 6px 6px 20px rgba(0,0,0,0.1), -3px -3px 10px rgba(255,255,255,0.9), inset 1px 1px 2px rgba(255,255,255,0.6) !important; }
        .pseo-pill:active { transform: translateY(-1px); }
        .pseo-resource { transition: transform 0.25s ease, box-shadow 0.25s ease; }
        .pseo-resource:hover { transform: translateY(-4px); box-shadow: 8px 8px 24px rgba(0,0,0,0.1), -4px -4px 12px rgba(255,255,255,0.9), inset 1px 1px 2px rgba(255,255,255,0.6) !important; }
        .pseo-resource:active { transform: translateY(-1px); }
        .faq-accordion { transition: box-shadow 0.3s ease; }
        .faq-accordion:hover { box-shadow: 8px 8px 24px rgba(0,0,0,0.08), -4px -4px 12px rgba(255,255,255,0.9), inset 1px 1px 2px rgba(255,255,255,0.6) !important; }
        .faq-accordion summary::-webkit-details-marker { display: none; }
        .faq-accordion summary::marker { display: none; content: ''; }
        .faq-accordion[open] .faq-chevron { transform: rotate(45deg); background: #BE185D; color: #fff; }
        .faq-chevron { transition: transform 0.3s ease, background 0.3s ease, color 0.3s ease; }
        @media (prefers-reduced-motion: reduce) {
          .cat-cta-primary, .cat-bento-card, .pseo-pill, .pseo-resource, .faq-accordion, .faq-chevron { transition: none; }
          .cat-cta-primary:hover, .cat-bento-card:hover, .pseo-pill:hover, .pseo-resource:hover { transform: none; }
        }
        @media (max-width: 768px) {
          .cat-bento-grid { grid-template-columns: 1fr !important; }
          .cat-bento-hero-1, .cat-bento-hero-2, .cat-bento-hero-3, .cat-bento-wide { grid-column: span 1 !important; }
          .cat-bento-hero-1, .cat-bento-hero-3 { grid-template-columns: 1fr !important; }
          .cat-bento-grid > div { grid-column: span 1 !important; }
        }
        @media (min-width: 769px) and (max-width: 1024px) {
          .cat-bento-grid { grid-template-columns: repeat(6, 1fr) !important; }
          .cat-bento-hero-1, .cat-bento-hero-3, .cat-bento-wide { grid-column: span 6 !important; }
          .cat-bento-hero-2 { grid-column: span 6 !important; }
          .cat-bento-grid > div:not(.cat-bento-hero-1):not(.cat-bento-hero-2):not(.cat-bento-hero-3):not(.cat-bento-wide) { grid-column: span 3 !important; }
        }
      `}</style>
    </div>
  );
}
