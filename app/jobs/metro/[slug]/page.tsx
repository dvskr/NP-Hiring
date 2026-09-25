import { brand } from '@/config/brand';
import { Metadata } from 'next';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import ImmersiveImage from '@/components/ImmersiveImage';
import { MapPin, Building2, Shield, Users, Briefcase, ArrowRight, Bell, DollarSign, Video, Stethoscope, Activity } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import { PUBLISHED_LISTING_WHERE } from '@/lib/pseo/listing-where';
import { BEST_SORT_ORDER_BY } from '@/lib/utils/job-sort';
import { canonicalBucketWhere, COUNT_DISPLAY_FLOOR } from '@/lib/canonical-counts';
import { formatCount, pluralize, truncateOnWord } from '@/lib/display-text';
import { DESCRIPTION_MAX } from '@/lib/pseo/category-metadata';
import { getListingFacts, metroScopeWhere, MIX_MIN_POSTINGS_HUB, type ListingFacts } from '@/lib/pseo/listing-facts';
import {
  buildHubRecencySentence,
  buildHubSettingsSentence,
  buildLiveRolesBadge,
  buildMetroCategoriesSentence,
  buildMetroDescription,
  buildMetroEmployersFaq,
  buildMetroHeadlineSub,
  buildMetroTitle,
  buildMetroZeroJobsSentence,
  buildTerseWorkModeLine,
  formatK,
} from '@/lib/pseo/listing-narrative';
import { shouldIndexMetro } from '@/lib/pseo/render-gate';
import { getGatedLocationSalary, type GatedSalary } from '@/lib/salary-analytics';
import {
  EmployerRoster,
  PostedPay,
  employerSentence,
  postedPaySentence,
  type EmployerRosterVariant,
  type PostedPayVariant,
} from '@/components/seo/pseo';
import {
  getMetroCity,
  getAllMetroSlugs,
  getNearbyDisplayCities,
  firstSentence,
  METRO_DATA_LAST_REVIEWED,
  type MetroCity,
} from '@/lib/metro-data';
import JobCard from '@/components/JobCard';
import { JobListViewTracker } from '@/components/analytics/ViewTrackers';
import { Job } from '@/lib/types';
import BreadcrumbSchema from '@/components/BreadcrumbSchema';
import CategoryHero, { crumbsFromSchema } from '@/components/CategoryHero';
import CategoryFAQ from '@/components/CategoryFAQ';
import { stateDioramaSrc, stateDioramaBg } from '@/components/StateImage';
import { notFound } from 'next/navigation';

/* Local illustration set (public/images/**).
 *
 * This template used to pull ten distinct images from the retired remote
 * asset bucket (hero_wc_states, three bento illustrations and six clay
 * icons) and every one of them returned HTTP 400, so roughly thirteen
 * <Image> elements were broken on each of the 20 metro pages, the LCP hero
 * included. That is the same purge P0/P1 already applied to the sibling
 * surfaces (see app/jobs/state/[state]/page.tsx and the salary guide).
 *
 * Do not reintroduce brand.assets.storageBase here. The hero shows the
 * metro's own state diorama and the icon tiles use lucide glyphs, because no
 * local clay-icon artwork exists. tests/regressions/p2-metro-editorial-depth
 * pins both rules. */
const METRO_HERO_FALLBACK = { src: '/images/job-seekers/clinical-inperson.webp', bg: '#bfd4c2' };
const ART_PRACTICE = '/images/job-seekers/bento-guides.webp';
const ART_SALARY = '/images/job-seekers/bento-salary.webp';
const ART_GROWTH = '/images/employers/bento-analytics.webp';

/* ═══ Design Tokens: V2 Warm Diorama (clay) ═══ */
const clayCard: CSSProperties = {
  background: '#FFFFFF', borderRadius: '20px',
  border: '1px solid rgba(255,255,255,0.5)',
  boxShadow: '6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02)',
};

const INK = '#1A2E35';
const BODY = '#5A4A42';
const MUTED = '#7A6A62';
const ACCENT = '#BE185D';
const RULE = '1px solid rgba(0,0,0,0.06)';

/** Decorative glyphs for the bento bullet tiles, in a fixed order. */
const BULLET_GLYPHS = [Building2, Users, Shield, Video];

/** Listing cards shown before the "view all" link. */
const LISTING_TAKE = 10;
/**
 * GA4 item_list_name for the listings on every metro guide. The
 * view_item_list impression and each card's select_item read this one
 * constant, because GA4 joins a click to its impression on the name alone.
 * One name for every metro, so the item-list reports keep a single row for
 * this surface; the page path already says which metro it was.
 */
const METRO_GUIDE_LIST_NAME = 'Metro Guide Jobs';
/** Teaser length of the licensure note in the practice card. */
const LICENSURE_TEASER_MAX = 165;

export const revalidate = 3600;

interface PageProps {
  params: Promise<{ slug: string }>;
}

/** Only pre-generate the curated metro pages */
export async function generateStaticParams() {
  return getAllMetroSlugs().map(slug => ({ slug }));
}

/*
 * ── Data (thin plan METRO-M2 to M5) ────────────────────────────────────────
 *
 * Every metro count, employer, mix and pay figure comes from one cached
 * ListingFacts over canonicalBucketWhere(metroScopeWhere(metro)), the same
 * predicate app/sitemap.ts gates the metro URL on, so the page and the
 * sitemap can never disagree on inventory (M3). Pay is the gated median
 * inside those facts (n of 5 or more from 3 or more employers), never a
 * posting mean. The statewide comparison uses the bucket the state hub and
 * the salary guide use ({ state: name }) so the three surfaces agree.
 */
function getMetroFacts(metro: MetroCity): Promise<ListingFacts> {
  return getListingFacts(`metro:${metro.slug}`, metroScopeWhere(metro));
}

interface StateFigures {
  total: number;
  salary: GatedSalary;
}

async function getStateFigures(metro: MetroCity, now: Date): Promise<StateFigures> {
  const [total, salary] = await Promise.all([
    prisma.job.count({ where: canonicalBucketWhere({ state: metro.state }, now) }),
    getGatedLocationSalary({ state: metro.state }),
  ]);
  return { total, salary };
}

/*
 * The listing rows. The canonical predicate already carries the profession
 * quarantine (GLOBAL_EXCLUSIONS) and the published flag; PUBLISHED_LISTING_WHERE
 * is spread into the bucket as well so the quarantine is visible at the
 * call site (tests/regressions/p10-pseo-jobs-quarantine-crumbs-copy pins
 * it). The two clauses select the same rows.
 */
async function getMetroListings(metro: MetroCity, now: Date): Promise<Job[]> {
  const rows = await prisma.job.findMany({
    where: canonicalBucketWhere({ ...PUBLISHED_LISTING_WHERE, ...metroScopeWhere(metro) }, now),
    orderBy: BEST_SORT_ORDER_BY,
    take: LISTING_TAKE,
  });
  return rows as Job[];
}

/*
 * ── What this page publishes from lib/metro-data.ts (thin plan C.5) ────────
 *
 * METRO-M7 is the owner's editorial review of that file, so this page decides
 * what it is willing to publish from a record rather than editing the record.
 * C.5 lets a sentence state a figure or a market fact only when a named
 * function or a cited source stands behind it, and nothing in lib/metro-data.ts
 * has one: the file's own header says its economic index readings render
 * unsourced. A record sentence is therefore published only when it asserts
 * none of the four families that file cannot source.
 *
 * Long editorial prose is filtered sentence by sentence, so one unsourced
 * clause costs one sentence rather than the whole paragraph. The short bullets
 * and FAQ entries carry a single claim each, so they are kept or dropped whole.
 * Nothing is reworded: an unsourced sentence is omitted, never padded.
 */

/** A percentage, a dollar figure, a population magnitude or a size ranking. */
const CLAIM_QUANTITY = /\d\s*(?:%|percent)\b|\$\s*\d|\b\d[\d.,]*[\s-]*(?:M\+|million\b|billion\b)|\b\d+(?:st|nd|rd|th)[- ]largest\b/i;
/** A living-expense or housing level. No source on this board publishes one. */
const CLAIM_EXPENSE = /\bcosts?\b|\baffordab\w+\b|\bcheaper\b/i;
/** A pay level. Only the gated median may state one, through PostedPay. */
const CLAIM_PAY = /\bsalar\w+\b|\bwages?\b|\bearnings\b|\bpaying\b|\bpurchasing power\b|\btake-home\b|\bpaycheck\b/i;
/** A ranking or a growth-rate claim about the market. */
const CLAIM_RANK = /\bfastest\b|\bfast[- ]growing\b|\brapid\w*\b|\bboom\w*\b|\brank(?:s|ed|ing)?\b|\bone of the (?:largest|biggest|best|top|most|highest|strongest|deepest|fastest)\b|\bamong the (?:highest|largest|best|top|most)\b|\bleast saturated\b|\bpopulation growth\b|\bgrowing population\b/i;

/** True when a record sentence asserts no unsourced figure and no market claim. */
function isPublishable(text: string): boolean {
  return !CLAIM_QUANTITY.test(text)
    && !CLAIM_EXPENSE.test(text)
    && !CLAIM_PAY.test(text)
    && !CLAIM_RANK.test(text);
}

/**
 * The publishable sentences of an editorial note, in record order, or '' when
 * none survive. Notes are authored without mid-sentence periods (the same rule
 * lib/metro-data.ts firstSentence relies on), so splitting on the period is safe.
 */
function publishableProse(note: string): string {
  return note.split(/(?<=\.)\s+/).filter(isPublishable).join(' ');
}

interface PublishedSubMarket { name: string; note: string }

/** Sub-markets whose note survives the filter. A bare name is not published. */
function publishedSubMarkets(metro: MetroCity): PublishedSubMarket[] {
  const reviewed = metro.subMarkets.map((sub) => ({ name: sub.name, note: publishableProse(sub.note) }));
  return reviewed.filter((sub) => sub.note !== '');
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const metro = getMetroCity(slug);
  if (!metro) return { title: 'Not Found' };

  const facts = await getMetroFacts(metro);

  // Count only at the display floor; the year keeps the title distinct from
  // the city hub. Description from reviewed geography (nearby cities and
  // sub-market names) plus the gated median, never the hero fragment.
  const title = buildMetroTitle({
    city: metro.city,
    stateCode: metro.stateCode,
    total: facts.total,
    year: new Date().getUTCFullYear(),
  });
  const description = truncateOnWord(buildMetroDescription({
    city: metro.city,
    stateCode: metro.stateCode,
    stateName: metro.state,
    practiceAuthority: metro.practiceAuthority,
    nearbyCities: getNearbyDisplayCities(metro),
    subMarkets: publishedSubMarkets(metro).map((sub) => sub.name),
    benchmark: facts.benchmark,
  }), DESCRIPTION_MAX);

  // /api/og/city is the generator built for a place page. Only params that
  // route reads are passed: `city` (headline), `jobs` (open positions tile)
  // and `salary` only when the metro median clears the gate, so the card
  // drops the tile rather than showing a figure this board cannot source.
  // `category` and `shortage` are deliberately absent: a metro guide is
  // all-specialty and carries no behavioral-health designation.
  const ogParams = new URLSearchParams({
    city: `${metro.city}, ${metro.stateCode}`,
    jobs: String(facts.total),
    ...(facts.benchmark !== null && { salary: formatK(facts.benchmark.median) }),
  });
  const ogImageUrl = `/api/og/city?${ogParams.toString()}`;
  const socialTitle = `${brand.niche.short} Jobs in ${metro.city}, ${metro.stateCode}`;

  return {
    title,
    description,
    // METRO-M1: the metro indexes at 3 or more canonical jobs (the sitemap
    // reads the same function); below that it stays rendered, linked and
    // followed with a self canonical.
    robots: shouldIndexMetro({ activeJobs: facts.total })
      ? { index: true, follow: true }
      : { index: false, follow: true },
    openGraph: {
      title: socialTitle,
      description,
      type: 'website',
      images: [{
        url: ogImageUrl,
        width: 1200, height: 630,
        alt: socialTitle,
      }],
    },
    twitter: {
      card: 'summary_large_image',
      title: socialTitle,
      description,
      images: [ogImageUrl],
    },
    alternates: {
      canonical: `${brand.baseUrl}/jobs/metro/${slug}`,
    },
  };
}

/* ── Derived copy ─────────────────────────────────────────────────────────── */

interface HeroStat { value: string; label: string }

/** Hero footer stats; a zero count and a below-gate pay figure are omitted, never padded. */
function buildHeroStats(metro: MetroCity, facts: ListingFacts, state: StateFigures): HeroStat[] {
  const stats: HeroStat[] = [];
  if (facts.total >= 1) stats.push({ value: String(facts.total), label: pluralize(facts.total, 'position') });
  if (facts.benchmark) {
    stats.push({ value: formatK(facts.benchmark.median), label: 'median posted pay' });
  } else if (state.total >= 1) {
    stats.push({ value: String(state.total), label: `${metro.stateCode} openings` });
  }
  stats.push({ value: metro.practiceAuthority, label: 'practice auth' });
  return stats;
}

/** "$4K above" / "$4K below" the statewide median, only when both gates pass. */
function buildPayGapValue(metroRow: ListingFacts['benchmark'], state: GatedSalary): string | null {
  if (!metroRow || !state.gatePassed || state.medianK === null) return null;
  const diff = Math.round(metroRow.median / 1000) - state.medianK;
  if (diff === 0) return 'Same as statewide';
  return `$${Math.abs(diff)}K ${diff > 0 ? 'above' : 'below'}`;
}

interface SnapshotRow {
  label: string;
  value: string;
  /** A bare count renders large; a phrase renders at body size. */
  figure: boolean;
  accent?: boolean;
}

/** METRO-M5: every row is a live count under its own floor; zero rows are absent. */
function buildSnapshotRows(metro: MetroCity, facts: ListingFacts, state: StateFigures): SnapshotRow[] {
  const rows: SnapshotRow[] = [];
  if (facts.total >= 1) rows.push({ label: `Open ${brand.niche.short} roles here`, value: String(facts.total), figure: true });
  if (state.total >= 1) rows.push({ label: `All ${metro.state} roles`, value: String(state.total), figure: true });
  const payGap = buildPayGapValue(facts.benchmark, state.salary);
  if (payGap) rows.push({ label: 'Posted pay vs. statewide', value: payGap, figure: false, accent: true });
  const workMode = buildTerseWorkModeLine(facts.workMode, MIX_MIN_POSTINGS_HUB);
  if (workMode) rows.push({ label: 'Work mode', value: workMode, figure: false });
  if (facts.newGradFriendly >= 1) rows.push({ label: 'Open to new graduates', value: String(facts.newGradFriendly), figure: true });
  return rows;
}

interface GettingStartedStep { step: string; title: string; text: string }

function buildSteps(metro: MetroCity, facts: ListingFacts, licensureNote: string): GettingStartedStep[] {
  const apply = facts.total >= 1
    ? `Browse the ${formatCount(facts.total, 'open position')} in the ${metro.city} area above and set an alert for new listings.`
    : `Set an alert for ${metro.city} and we will email you when a role is posted.`;
  const authority = `${metro.state} has ${metro.practiceAuthority} Practice Authority.`;
  return [
    { step: '01', title: 'Licensure', text: licensureNote ? `${authority} ${firstSentence(licensureNote)}.` : authority },
    { step: '02', title: 'Apply', text: apply },
  ];
}

const bentoEyebrow: CSSProperties = {
  fontSize: '13px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px',
};
const bentoTitle: CSSProperties = { fontSize: '20px', fontWeight: 800, color: INK, margin: '0 0 8px' };
const bentoBody: CSSProperties = { fontSize: '14px', color: BODY, margin: 0, lineHeight: 1.6 };
const sidebarLink: CSSProperties = { fontSize: '13px', color: ACCENT, textDecoration: 'none', fontWeight: 500 };
const primaryButton: CSSProperties = {
  padding: '12px 24px', borderRadius: '12px', fontWeight: 700, fontSize: '14px',
  background: ACCENT, color: '#fff', textDecoration: 'none', display: 'inline-block',
};

export default async function MetroLandingPage({ params }: PageProps) {
  const { slug } = await params;
  const metro = getMetroCity(slug);
  if (!metro) notFound();

  const now = new Date();
  const [facts, state, recentJobs] = await Promise.all([
    getMetroFacts(metro),
    getStateFigures(metro, now),
    getMetroListings(metro, now),
  ]);

  const nearbyCities = getNearbyDisplayCities(metro);
  const scopeName = `the ${metro.city} area`;

  // Everything this page quotes from the record passes the publish filter
  // above. A dropped bullet, sentence or question is simply absent.
  const metroBullets = metro.whyThisMetro.filter(isPublishable).slice(0, 4);
  const bulletSpan = Math.floor(12 / Math.max(metroBullets.length, 1));
  const subMarkets = publishedSubMarkets(metro);
  const careDemand = publishableProse(metro.careDemandContext);
  const licensureNote = publishableProse(metro.licensureNote);

  // METRO-M4 and M6: the employer card needs 2 or more employers; the FAQ
  // entry answered from it joins the reviewed questions before the single
  // array reaches CategoryFAQ, so the accordion and the FAQPage node stay in
  // lockstep. CategoryFAQ drops the schema node below two entries by itself.
  const rosterVariant: EmployerRosterVariant = { kind: 'city', city: scopeName };
  const rosterRenders = employerSentence(rosterVariant, facts) !== null;
  const employersFaq = rosterRenders
    ? buildMetroEmployersFaq({ city: metro.city, employers: facts.topEmployers })
    : null;
  const reviewedFaqs = metro.faqs.filter((entry) => isPublishable(entry.question) && isPublishable(entry.answer));
  const faqs = employersFaq ? [...reviewedFaqs, employersFaq] : reviewedFaqs;

  // METRO-M2: the gated median paragraph, or the counted below-gate sentence
  // with the BLS cite; nothing when no posting states a salary.
  const payVariant: PostedPayVariant = { kind: 'location', scopeName, scopeNoun: 'metro' };
  const payRenders = postedPaySentence(payVariant, facts) !== null;

  const recencySentence = buildHubRecencySentence(facts.recency);
  const snapshotRows = buildSnapshotRows(metro, facts, state);
  const categoriesSentence = buildMetroCategoriesSentence(facts.categoryTop);
  const settingsSentence = buildHubSettingsSentence(facts.settings);
  const snapshotRenders = snapshotRows.length > 0 || categoriesSentence !== null || settingsSentence !== null;

  // The state hub and the salary guide both 404 below one canonical job, so
  // every link to them is gated on the statewide count.
  const stateLinksRender = state.total >= 1;
  const stateHubLabel = `All ${metro.state} Jobs${state.total >= COUNT_DISPLAY_FLOOR ? ` (${state.total})` : ''}`;

  // Hero art: the metro's own state diorama, with the artwork's baked
  // backdrop behind it so the panel never frames the illustration in a
  // clashing colour. Every state carrying a metro ships a diorama today; the
  // fallback exists so adding a metro can never blank the LCP element.
  const dioramaSrc = stateDioramaSrc(metro.stateSlug);
  const heroImage = dioramaSrc ?? METRO_HERO_FALLBACK.src;
  const heroBgColor = dioramaSrc ? stateDioramaBg(metro.stateSlug) : METRO_HERO_FALLBACK.bg;

  // The hero deck is the shared builder, not the record's opening paragraph:
  // every clause in it is sourced (the reviewed geography, the practice
  // authority this board publishes, and the gated median or nothing).
  const heroDeck = buildMetroDescription({
    city: metro.city,
    stateCode: metro.stateCode,
    stateName: metro.state,
    practiceAuthority: metro.practiceAuthority,
    nearbyCities,
    subMarkets: subMarkets.map((sub) => sub.name),
    benchmark: facts.benchmark,
  });

  const crumbs = [
    { name: 'Home', url: brand.baseUrl },
    { name: 'Jobs', url: `${brand.baseUrl}/jobs` },
    { name: metro.state, url: `${brand.baseUrl}/jobs/state/${metro.stateSlug}` },
    { name: `${metro.city} ${brand.niche.short} Jobs`, url: `${brand.baseUrl}/jobs/metro/${slug}` },
  ];

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#FDFBF7' }}>
      {/* Breadcrumb Schema */}
      <BreadcrumbSchema items={crumbs} />
      <JobListViewTracker
        jobs={recentJobs.map((j: Job) => ({ id: j.id, title: j.title, employer: j.employer }))}
        listName={METRO_GUIDE_LIST_NAME}
      />

      {/*
        FAQPage schema is NOT emitted here. <CategoryFAQ customFaqs={faqs} />
        at the bottom of this page already renders a FAQPage node built from the
        exact same array, and a page carrying two FAQPage blocks with identical
        mainEntity is a duplicate-schema warning in Rich Results. One source,
        one node: the visible accordion and the schema stay in lockstep.
      */}
      {/* ItemList schema */}
      {recentJobs.length > 0 && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
          '@context': 'https://schema.org', '@type': 'ItemList',
          name: `${brand.niche.short} Jobs in ${metro.city}, ${metro.stateCode}`,
          numberOfItems: facts.total,
          itemListElement: recentJobs.slice(0, 6).map((job: Job, idx: number) => ({
            '@type': 'ListItem', position: idx + 1, name: job.title,
            url: `${brand.baseUrl}/jobs/${job.slug || job.id}`,
          })),
        }) }} />
      )}
      {/* ═══ HERO ═══ */}
      <CategoryHero
        bgColor={heroBgColor}
        heroImage={heroImage}
        heroAlt={`${brand.niche.short} jobs in ${metro.city}, ${metro.stateCode}`}
        badgeText={facts.total >= 1 ? buildLiveRolesBadge(facts.total) : `${metro.city} metro guide`}
        breadcrumbs={crumbsFromSchema(crumbs)}
        headlineLine1={metro.city}
        headlineLine2={brand.niche.short}
        headlineSub={buildMetroHeadlineSub(metro.stateCode)}
        stats={buildHeroStats(metro, facts, state)}
        description={heroDeck}
        ctaLabel={`View All ${metro.city} Jobs`}
        ctaHref={`/jobs?location=${encodeURIComponent(metro.city)}`}
        secondaryCtaLabel="Set Alert"
        secondaryCtaHref={`/job-alerts?location=${encodeURIComponent(metro.city)}`}
      />

      {/* ═══ JOB LISTINGS ═══ */}
      <div style={{ maxWidth: '1440px', margin: '0 auto', padding: '32px 24px' }}>
        <div className="grid lg:grid-cols-4 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-lora" style={{ fontSize: '20px', fontWeight: 700, color: INK }}>
                {nearbyCities.length > 0 ? `${metro.city}-area positions` : `${metro.city} positions`}
                {facts.total >= 1 ? ` (${facts.total})` : ''}
              </h2>
              <Link
                href={`/jobs?location=${encodeURIComponent(metro.city)}`}
                className="text-sm font-medium hover:opacity-80 transition-opacity"
                style={{ color: ACCENT }}
              >
                View All Jobs →
              </Link>
            </div>
            {/* Truth note: the count folds in the metro's adjacent cities, so
                say so rather than letting the number read as city-limits only.
                METRO-M1: the caption explains an inventory, so it is gated on
                one, and a metro with nothing open makes no freshness claim. */}
            {facts.total >= 1 && (
              <p style={{ fontSize: '12px', color: '#A09080', margin: '0 0 20px', lineHeight: 1.5 }}>
                {nearbyCities.length > 0
                  ? `This count includes ${metro.city} plus nearby ${nearbyCities.slice(0, 4).join(', ')}. Browsing by location filters to ${metro.city} itself.`
                  : `Live ${metro.city} listings, refreshed hourly.`}
              </p>
            )}

            {recentJobs.length === 0 ? (
              /* METRO-M1 zero-job state: the page stays rendered (it is linked
                 from the state hub and the directory) with no freshness claim. */
              <div className="text-center py-12 rounded-xl" style={{ ...clayCard, padding: '48px 24px' }}>
                <Briefcase className="h-12 w-12 mx-auto mb-4" style={{ color: '#A09080' }} />
                <h3 className="text-lg font-semibold mb-2" style={{ color: INK }}>
                  No positions at this time
                </h3>
                <p className="mb-6" style={{ color: BODY }}>
                  {buildMetroZeroJobsSentence(metro.city)}
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 20px', justifyContent: 'center', alignItems: 'center' }}>
                  <Link href="/jobs" className="metro-cta" style={primaryButton}>
                    Browse All Jobs
                  </Link>
                  {stateLinksRender && (
                    <Link href={`/jobs/state/${metro.stateSlug}`} style={sidebarLink}>
                      All {metro.state} jobs
                    </Link>
                  )}
                  <Link href="/jobs/locations" style={sidebarLink}>
                    Browse by location
                  </Link>
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
                  {/* One unpaginated slice, so the map index is the position. */}
                  {recentJobs.map((job: Job, i: number) => (
                    <JobCard key={job.id} job={job} listName={METRO_GUIDE_LIST_NAME} listIndex={i} />
                  ))}
                </div>

                {/* Browse All CTA */}
                <div style={{ textAlign: 'center', marginTop: '32px' }}>
                  <Link href={`/jobs?location=${encodeURIComponent(metro.city)}`} className="metro-cta" style={{
                    padding: '14px 32px', borderRadius: '14px', fontWeight: 700, fontSize: '14px',
                    background: ACCENT, color: '#fff', textDecoration: 'none',
                    display: 'inline-flex', alignItems: 'center', gap: '8px',
                    boxShadow: '4px 4px 12px rgba(190,24,93,0.2)',
                  }}>
                    View All Jobs in {metro.city} <ArrowRight size={16} />
                  </Link>
                </div>
              </>
            )}
          </div>

          {/* Sidebar */}
          <div className="lg:col-span-1">
            {/* Job Alert CTA: the one alert card on the page */}
            <div className="metro-card" style={{ ...clayCard, padding: '24px', background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)', border: '2px solid rgba(190,24,93,0.15)', marginBottom: '20px' }}>
              <Bell size={28} style={{ color: ACCENT, marginBottom: '12px' }} />
              <h3 className="font-lora" style={{ fontSize: '18px', fontWeight: 700, color: '#831843', margin: '0 0 8px' }}>
                Get {metro.city} Job Alerts
              </h3>
              <p style={{ fontSize: '13px', color: ACCENT, marginBottom: '16px', lineHeight: 1.6, fontWeight: 500 }}>
                New {metro.city} listings, delivered to your inbox.
              </p>
              <Link
                href={`/job-alerts?location=${encodeURIComponent(metro.city)}`}
                className="metro-cta" style={{ display: 'block', width: '100%', textAlign: 'center', padding: '10px 20px', borderRadius: '10px', fontWeight: 700, fontSize: '13px', background: ACCENT, color: '#fff', textDecoration: 'none', boxShadow: '3px 3px 8px rgba(190,24,93,0.15)' }}
              >
                Create Alert
              </Link>
            </div>

            {/* METRO-M4: who is hiring, 2 or more employers, company links only
                where the profile has active jobs. */}
            {rosterRenders && (
              <div style={{ marginBottom: '20px' }}>
                <EmployerRoster variant={rosterVariant} facts={facts} className="metro-card" />
              </div>
            )}

            {/* Quick Links */}
            <div className="metro-card" style={{ ...clayCard, padding: '24px', marginBottom: '20px' }}>
              <h3 style={{ fontSize: '15px', fontWeight: 800, color: INK, margin: '0 0 16px' }}>Explore More</h3>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {[
                  { href: `/jobs/state/${metro.stateSlug}`, icon: '📍', label: stateHubLabel, renders: stateLinksRender },
                  { href: `/salary-guide/${metro.stateSlug}`, icon: '💰', label: `${metro.state} Salary Guide`, renders: stateLinksRender },
                  { href: '/jobs/remote', icon: '🏠', label: `Remote ${brand.niche.short} Jobs`, renders: true },
                  { href: '/jobs/telehealth', icon: '💻', label: 'Telehealth Positions', renders: true },
                ].filter((link) => link.renders).map(link => (
                  <li key={link.href} style={{ padding: '6px 0' }}>
                    <Link href={link.href} style={sidebarLink}>
                      {link.icon} {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ BENTO GRID: Why Choose This Metro ═══ */}
      <div style={{ background: '#FDF2F8' }}>
        <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '48px 20px 40px' }}>
          <p style={{ ...bentoEyebrow, color: '#E86C2C' }}>
            Why This Market
          </p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(26px, 3.5vw, 38px)', fontWeight: 700, color: INK, textAlign: 'center', marginBottom: '8px' }}>Why {brand.niche.short}s Choose {metro.city}
          </h2>
          <p style={{ fontSize: '15px', color: BODY, textAlign: 'center', maxWidth: '480px', margin: '0 auto 48px', lineHeight: 1.6 }}>
            {metro.practiceAuthority} practice authority
            {facts.total >= 1 ? ` · ${formatCount(facts.total, 'open role')} right now` : ''}
          </p>

          <div className="metro-bento-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '14px' }}>
            {/* ROW 1: Practice Authority (8, or 12 alone) + listing recency (4) */}
            <div className="metro-bento-wide metro-card" style={{ ...clayCard, gridColumn: recencySentence ? 'span 8' : 'span 12', padding: '0', overflow: 'hidden', display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
              <div style={{ padding: '32px 28px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <h3 style={bentoTitle}>{metro.practiceAuthority} Practice Authority</h3>
                {licensureNote && (
                  <p style={bentoBody}>
                    {truncateOnWord(licensureNote, LICENSURE_TEASER_MAX, '…')}
                  </p>
                )}
              </div>
              <ImmersiveImage src={ART_PRACTICE} alt="" minHeight={240} />
            </div>

            {recencySentence && (
              <div className="metro-bento-side metro-card" style={{ ...clayCard, gridColumn: 'span 4', padding: '0', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <ImmersiveImage src={ART_GROWTH} alt="" minHeight={200} />
                <div style={{ padding: '24px 22px', flex: 1 }}>
                  <h3 style={{ fontSize: '16px', fontWeight: 800, color: INK, margin: '0 0 6px' }}>How current the listings are</h3>
                  <p style={{ fontSize: '12.5px', color: MUTED, margin: 0, lineHeight: 1.5 }}>
                    {recencySentence}
                  </p>
                </div>
              </div>
            )}

            {/* ROW 2: the `whyThisMetro` bullets that clear the publish filter,
                up to four. The row is sized by how many survive, so it always
                fills the twelve columns instead of leaving a ragged gap.
                The four clay icons that used to sit here were remote-bucket
                URLs returning 400; no local clay-icon artwork exists, so these
                are lucide glyphs on the same rose chip the rest of the page
                uses. They are decorative (the bullet carries the meaning), so
                the glyph is aria-hidden and no alt text is invented for it. */}
            {metroBullets.map((text, i) => {
              const Icon = BULLET_GLYPHS[i % BULLET_GLYPHS.length];
              return (
                <div key={text} className="metro-bento-cell metro-card" style={{ ...clayCard, gridColumn: `span ${bulletSpan}`, padding: '24px 18px', textAlign: 'center' }}>
                  <span aria-hidden="true" style={{ width: '48px', height: '48px', borderRadius: '14px', margin: '0 auto 14px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)' }}>
                    <Icon size={22} style={{ color: ACCENT }} />
                  </span>
                  {/* The measure is capped so a wide tile (one or two
                      surviving bullets) does not run a single line the full
                      width of the grid. */}
                  <p style={{ fontSize: '12px', color: MUTED, margin: '0 auto', lineHeight: 1.55, maxWidth: '52ch' }}>{text}</p>
                </div>
              );
            })}

            {/* ROW 3: METRO-M2 posted pay (8) + picture (4), only when the pay
                paragraph renders. PostedPay is a clay card itself, so its
                wrapper is a bare grid cell rather than a second surface. */}
            {payRenders && (
              <>
                <div className="metro-bento-wide" style={{ gridColumn: 'span 8', display: 'grid' }}>
                  <PostedPay
                    variant={payVariant}
                    facts={facts}
                    salaryGuide={{ href: `/salary-guide/${metro.stateSlug}`, renders: stateLinksRender, label: `${metro.state} salary guide` }}
                    className="metro-card"
                  />
                </div>
                <div className="metro-bento-side metro-card" style={{ ...clayCard, gridColumn: 'span 4', padding: '0', overflow: 'hidden' }}>
                  <ImmersiveImage src={ART_SALARY} alt="" minHeight={240} style={{ height: '100%' }} />
                </div>
              </>
            )}
          </div>
        </section>
      </div>

      {/* ═══ MARKET STRUCTURE: care demand + sub-markets + live snapshot ═══ */}
      <div style={{ background: 'linear-gradient(180deg, #FDF2F8 0%, #FFFFFF 45%, #FDFBF7 100%)' }}>
        <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '56px 20px 48px' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: ACCENT, textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '8px' }}>
            Inside the metro
          </p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(26px, 3.5vw, 38px)', fontWeight: 700, color: INK, margin: '0 0 32px', maxWidth: '18ch', lineHeight: 1.15 }}>
            How the {metro.city} market is put together
          </h2>

          <div className="grid lg:grid-cols-12 gap-8 lg:gap-10">
            {/* Left rail: who lives here + the live snapshot */}
            <div className="lg:col-span-5">
              {careDemand && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                    <Users size={18} style={{ color: '#E86C2C' }} />
                    <h3 style={{ fontSize: '15px', fontWeight: 800, color: INK, margin: 0 }}>Who you will be caring for</h3>
                  </div>
                  <p style={{ fontSize: '15px', color: BODY, lineHeight: 1.75, margin: '0 0 24px' }}>
                    {careDemand}
                  </p>
                </>
              )}

              {/* Live snapshot (METRO-M5): a clay card; every figure is a
                  count from live listings under its own floor, never an
                  estimate, and a row below its floor is absent. */}
              {snapshotRenders && (
                <div className="metro-card" style={{ ...clayCard, padding: '26px 24px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '18px' }}>
                    <Activity size={18} style={{ color: ACCENT }} />
                    <h3 style={{ fontSize: '13px', fontWeight: 800, color: INK, margin: 0, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                      Live market snapshot
                    </h3>
                  </div>
                  {snapshotRows.length > 0 && (
                    <dl style={{ margin: 0, display: 'grid', gap: '14px' }}>
                      {snapshotRows.map((row, i) => (
                        <div key={row.label} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '16px', borderTop: i === 0 ? undefined : RULE, paddingTop: i === 0 ? undefined : '14px' }}>
                          <dt style={{ fontSize: '13px', color: MUTED }}>{row.label}</dt>
                          <dd style={{
                            fontSize: row.figure ? '22px' : '14px',
                            fontWeight: 800,
                            color: row.accent ? ACCENT : INK,
                            margin: 0,
                            textAlign: 'right',
                            fontFamily: row.figure ? 'var(--font-mono)' : undefined,
                          }}>
                            {row.value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {categoriesSentence && (
                    <p style={{ fontSize: '13px', color: BODY, margin: '18px 0 0', lineHeight: 1.6 }}>{categoriesSentence}</p>
                  )}
                  {settingsSentence && (
                    <p style={{ fontSize: '13px', color: BODY, margin: '10px 0 0', lineHeight: 1.6 }}>{settingsSentence}</p>
                  )}
                  <p style={{ fontSize: '11px', color: '#A09080', margin: '18px 0 0', lineHeight: 1.6 }}>
                    Counted from live listings on this board and refreshed hourly, not from a national survey.
                    {facts.benchmark ? ' Pay figures use only listings that post an annual salary, so they lag the full market.' : ''}
                  </p>
                </div>
              )}
            </div>

            {/* Right rail: sub-market structure */}
            <div className="lg:col-span-7">
              {subMarkets.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                  <MapPin size={18} style={{ color: ACCENT }} />
                  <h3 style={{ fontSize: '15px', fontWeight: 800, color: INK, margin: 0 }}>Where the jobs are</h3>
                </div>
              )}
              {/* role="list" keeps list semantics in Safari, which drops them
                  when list-style is none. */}
              <ol role="list" style={{ listStyle: 'none', margin: 0, padding: 0, borderLeft: subMarkets.length > 0 ? '2px solid rgba(190,24,93,0.18)' : undefined }}>
                {subMarkets.map((sub, i) => (
                  <li key={sub.name} style={{ position: 'relative', padding: '0 0 22px 24px' }}>
                    <span aria-hidden="true" style={{
                      position: 'absolute', left: '-9px', top: '2px', width: '16px', height: '16px',
                      borderRadius: '50%', background: '#FFFFFF', border: `2px solid ${ACCENT}`,
                      display: 'block',
                    }} />
                    <h4 style={{ fontSize: '15px', fontWeight: 700, color: INK, margin: '0 0 5px' }}>
                      <span style={{ color: ACCENT, fontFamily: 'var(--font-mono)', fontSize: '12px', marginRight: '8px' }}>
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      {sub.name}
                    </h4>
                    <p style={{ fontSize: '13.5px', color: BODY, lineHeight: 1.7, margin: 0 }}>{sub.note}</p>
                  </li>
                ))}
              </ol>

              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginTop: '4px', padding: '14px 16px', borderRadius: '14px', background: 'rgba(190,24,93,0.05)' }}>
                <Shield size={16} style={{ color: ACCENT, flexShrink: 0, marginTop: '2px' }} />
                <p style={{ fontSize: '12px', color: MUTED, margin: 0, lineHeight: 1.6 }}>
                  Practice authority follows the state, not the metro. {metro.state} is a{' '}
                  {metro.practiceAuthority === 'Full' ? 'full' : metro.practiceAuthority.toLowerCase()}-practice
                  {' '}jurisdiction on the AANP State Practice Environment map. Editorial content for this metro was last reviewed {METRO_DATA_LAST_REVIEWED}.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* ═══ GETTING STARTED ═══ */}
      <div style={{ background: 'linear-gradient(180deg, #FDF2F8 0%, #E6FFFA 50%, #FDF2F8 100%)' }}>
        <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '56px 20px' }}>
          <p style={{ ...bentoEyebrow, color: ACCENT }}>
            Before You Apply
          </p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 34px)', fontWeight: 700, color: INK, textAlign: 'center', marginBottom: '40px' }}>
            Getting Started in {metro.city}
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px' }}>
            {buildSteps(metro, facts, licensureNote).map(r => (
              <div key={r.step} className="metro-card" style={{ ...clayCard, padding: '28px 24px', borderTop: `3px solid ${ACCENT}` }}>
                <span style={{ fontSize: '28px', fontWeight: 800, color: '#FCE7F3', display: 'block', marginBottom: '12px', fontFamily: 'var(--font-mono)' }}>{r.step}</span>
                <h3 style={{ fontSize: '15px', fontWeight: 700, color: INK, marginBottom: '8px' }}>{r.title}</h3>
                <p style={{ fontSize: '13px', color: BODY, lineHeight: 1.6, margin: 0 }}>{r.text}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* ═══ EXPLORE MORE ═══ */}
      <div style={{ background: 'linear-gradient(180deg, #FFF8F0 0%, #FFF3E8 50%, #FFF8F0 100%)' }}>
        <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '56px 20px' }}>
          <p style={{ ...bentoEyebrow, color: '#E86C2C' }}>
            Keep Exploring
          </p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 34px)', fontWeight: 700, color: INK, textAlign: 'center', marginBottom: '40px' }}>
            More Ways to Find Your Next Role
          </h2>
          <div className="metro-explore-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
            {/* Same purge as the bento tiles above: six dead clay-icon URLs
                replaced with lucide glyphs. Decorative, so aria-hidden; each
                tile's label and sub-label already name the destination. */}
            {[
              { href: `/jobs/state/${metro.stateSlug}`, label: `${metro.state} Jobs`, sub: `All ${metro.stateCode} positions`, Icon: MapPin, renders: stateLinksRender },
              { href: '/jobs/remote', label: 'Remote', sub: 'Work from anywhere', Icon: Video, renders: true },
              { href: '/jobs/new-grad', label: 'New Grad', sub: 'Entry-level roles', Icon: Briefcase, renders: true },
              { href: '/jobs/telehealth', label: 'Telehealth', sub: 'Virtual patient care', Icon: Stethoscope, renders: true },
              { href: `/salary-guide/${metro.stateSlug}`, label: 'Salary Guide', sub: `${metro.state} pay data`, Icon: DollarSign, renders: stateLinksRender },
              { href: '/jobs/locations', label: 'By Location', sub: 'All 50 states', Icon: Building2, renders: true },
            ].filter((card) => card.renders).map(({ href, label, sub, Icon }) => (
              <Link key={href} href={href} className="metro-card" style={{ ...clayCard, padding: '24px 20px', textDecoration: 'none', display: 'block', textAlign: 'center' }}>
                <span aria-hidden="true" style={{ width: '48px', height: '48px', borderRadius: '14px', margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)' }}>
                  <Icon size={22} style={{ color: ACCENT }} />
                </span>
                <span style={{ fontSize: '15px', fontWeight: 700, color: INK, display: 'block', marginBottom: '4px' }}>{label}</span>
                <span style={{ fontSize: '12px', color: MUTED, display: 'block' }}>{sub}</span>
              </Link>
            ))}
          </div>
        </section>
      </div>

      {/* ═══ FAQ (METRO-M6 joins the reviewed questions; one array, one FAQPage node) ═══ */}
      <CategoryFAQ
        category="metro"
        totalJobs={facts.total}
        customFaqs={faqs}
        heading={`${metro.city} ${brand.niche.short} Jobs FAQ`}
      />

      {/* ═══ Hover + Responsive CSS ═══ */}
      <style>{`
        .metro-cta { transition: transform 0.25s ease, box-shadow 0.25s ease, filter 0.25s ease; }
        .metro-cta:hover { transform: translateY(-3px); box-shadow: 0 10px 32px rgba(190,24,93,0.35) !important; filter: brightness(1.05); }
        .metro-card { transition: transform 0.3s ease, box-shadow 0.3s ease; }
        .metro-card:hover { transform: translateY(-4px); box-shadow: 8px 8px 24px rgba(0,0,0,0.1), -4px -4px 12px rgba(255,255,255,0.9), inset 1px 1px 2px rgba(255,255,255,0.6) !important; }
        @media (prefers-reduced-motion: reduce) {
          .metro-cta, .metro-card { transition: none; }
          .metro-cta:hover, .metro-card:hover { transform: none; }
        }
        @media (max-width: 768px) {
          .metro-bento-grid { grid-template-columns: 1fr !important; }
          .metro-bento-grid > div { grid-column: span 1 !important; }
          .metro-bento-wide { grid-template-columns: 1fr !important; }
          .metro-explore-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
        @media (min-width: 769px) and (max-width: 1024px) {
          .metro-bento-grid { grid-template-columns: repeat(6, 1fr) !important; }
          .metro-bento-wide, .metro-bento-side { grid-column: span 6 !important; }
          .metro-bento-cell { grid-column: span 3 !important; }
        }
      `}</style>
    </div>
  );
}
