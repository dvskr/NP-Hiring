import { brand } from '@/config/brand';
import { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import ImmersiveImage from '@/components/ImmersiveImage';
import { BookOpen, Bell, ArrowRight, ShieldCheck } from 'lucide-react';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { BEST_SORT_ORDER_BY } from '@/lib/utils/job-sort';
import { buildCategoryWhereClause, CATEGORY_FILTERS, CATEGORY_EXTRA_OR } from '@/lib/filters';
import { canonicalBucketWhere, COUNT_DISPLAY_FLOOR } from '@/lib/canonical-counts';
import { formatCount, pluralize } from '@/lib/display-text';
import { STAT_SOURCES } from '@/lib/stats-sources';
import JobCard from '@/components/JobCard';
import { Job } from '@/lib/types';
import BreadcrumbSchema from '@/components/BreadcrumbSchema';
import { JobListViewTracker } from '@/components/analytics/ViewTrackers';
import CategoryHero, { crumbsFromSchema } from '@/components/CategoryHero';
import CategoryLocationsExplore from '@/components/seo/CategoryLocationsExplore';
import { ALL_CATEGORY_SLUGS } from '@/lib/pseo/taxonomy-registry';
import { CODE_TO_STATE, STATE_CODES, stateToSlug } from '@/lib/pseo/setting-state-config';
import { getListingFacts, type ListingFacts, type StateCount } from '@/lib/pseo/listing-facts';
import { MIN_JOBS_FOR_INDEX, shouldIndexListingPage } from '@/lib/pseo/render-gate';
import { getLandingAxisGuide } from '@/lib/pseo/category-axis-guide';
import {
  buildCategoryLandingDescription,
  buildCategoryLandingTitle,
  labelNoun,
  labelSentence,
} from '@/lib/pseo/category-metadata';
import {
  NATIONAL_MEDIAN_SENTENCE,
  buildListingsAuthoritySentence,
  buildLiveRolesBadge,
  buildLowInventoryIntro,
  buildPostedPaySentence,
  buildRecencySentence,
  buildRelatedCategorySub,
  buildRoleSetup,
  formatK,
} from '@/lib/pseo/listing-narrative';
import {
  ClayCard,
  ClayHead,
  ClayStyles,
  IconWell,
  LocationSpread,
  MarketSnapshot,
  PostedPay,
  clayDesc,
  clayLink,
  clayList,
  clayMeta,
  clayRow,
  employerSentence,
  postedPaySentence,
  type LocationSpreadPlace,
} from '@/components/seo/pseo';


/* Design Tokens */
const clayCard: React.CSSProperties = {
  background: '#FFFFFF', borderRadius: '20px',
  border: '1px solid rgba(255,255,255,0.5)',
  boxShadow: '6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02)',
};

/** Band grounds for the data bands; adjacent bands never share one. */
const MINT_STAGE = 'linear-gradient(180deg, #FDFBF7 0%, #E6FFFA 50%, #FDFBF7 100%)';
const PEACH_STAGE = 'linear-gradient(180deg, #FDFBF7 0%, #FFF3E8 50%, #FDFBF7 100%)';

export const revalidate = 3600;

const SLUG = 'community-health';
const LABEL = 'Community Health';
/** Role noun for titles and band heads, e.g. "Community Health NP". */
const NOUN = labelNoun(SLUG, LABEL);
/** Mid-sentence label, e.g. "community health". */
const MID = labelSentence(LABEL);

/**
 * GA4 item_list_name for this page's listings. The view_item_list impression
 * and every card's select_item both read this one constant, because GA4
 * joins a click to its impression on the list name alone and two spellings
 * would report a click-through rate of zero. The value is the name the
 * impression has always sent, so earlier reports stay on the same row.
 * Cards report their absolute position (skip + i), so a card on a later
 * page continues the count from the page before it.
 */
const LIST_NAME = `Community Health ${brand.niche.short} Jobs`;

/**
 * Category bucket. Slugs without a legacy keyword entry gate on the
 * precomputed categoryTags column so a sibling count never degrades to
 * "all published jobs" (same rule as lib/pseo/category-landing-template).
 */
function categoryWhere(slug: string): Prisma.JobWhereInput {
  const hasKeywords = (CATEGORY_FILTERS[slug]?.length ?? 0) > 0 || (CATEGORY_EXTRA_OR[slug]?.length ?? 0) > 0;
  return hasKeywords ? buildCategoryWhereClause(slug) : buildCategoryWhereClause(slug, { categoryTags: { has: slug } });
}

const COMMUNITY_HEALTH_FILTER = categoryWhere(SLUG);

/**
 * The one facts load per request (LAND-T3): getListingFacts composes the
 * canonical predicate and is React cache()d on the scope key, so
 * generateMetadata and the page body share a single set of queries.
 */
function getFacts(): Promise<ListingFacts> {
  return getListingFacts(`category-landing:${SLUG}`, COMMUNITY_HEALTH_FILTER);
}

async function getCommunityHealthJobs(skip: number = 0, take: number = 10) {
  return prisma.job.findMany({
    where: canonicalBucketWhere(COMMUNITY_HEALTH_FILTER),
    orderBy: BEST_SORT_ORDER_BY,
    skip,
    take,
  });
}

/** LAND-L6 destinations: this page's own explore cards, unchanged. */
interface ExploreCard { href: string; label: string; sub: string; icon: string }

const EXPLORE_CARDS: readonly ExploreCard[] = [
  { href: '/jobs/remote', label: 'Remote', sub: 'Work from home', icon: '/images/categories/nav/remote.webp' },
  { href: '/jobs/telehealth', label: 'Telehealth', sub: 'Virtual care', icon: '/images/categories/nav/telehealth.webp' },
  { href: '/jobs/inpatient', label: 'Inpatient', sub: 'Hospital roles', icon: '/images/categories/nav/inpatient.webp' },
  { href: '/jobs/outpatient', label: 'Outpatient', sub: 'Clinic-based', icon: '/images/categories/nav/outpatient.webp' },
  { href: '/salary-guide', label: 'Salary Guide', sub: '2026 pay data', icon: '/images/categories/nav/salary.webp' },
  { href: '/jobs/locations', label: 'By Location', sub: 'All 50 states', icon: '/images/categories/nav/location.webp' },
];

/** Taxonomy slug behind an explore card, or null for a non-category link. */
function exploreSlug(href: string): string | null {
  const slug = href.startsWith('/jobs/') ? href.slice('/jobs/'.length) : null;
  return slug && ALL_CATEGORY_SLUGS.includes(slug) ? slug : null;
}

/**
 * LAND-L6 live counts for the explore cards that point at a category
 * landing, in one Promise.all. A failed count logs and leaves the card
 * without a figure, so no card ever states a number the query did not
 * return.
 */
async function getExploreCounts(): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  await Promise.all(EXPLORE_CARDS.map(async (card) => {
    const slug = exploreSlug(card.href);
    if (!slug) return;
    try {
      counts.set(slug, await prisma.job.count({ where: canonicalBucketWhere(categoryWhere(slug)) }));
    } catch (error) {
      console.error(`[${SLUG}] explore count failed for "${slug}":`, error);
    }
  }));
  return counts;
}

/** Facts states folded onto canonical full names; unknown values dropped. */
function canonicalStates(states: readonly StateCount[]): StateCount[] {
  const counts = new Map<string, number>();
  for (const row of states) {
    const raw = row.name.trim();
    const name = STATE_CODES[raw] ? raw : CODE_TO_STATE[raw.toUpperCase()] ?? null;
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + row.count);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * LAND-L2 places. Community health has no /jobs/community-health/[state]
 * spoke, so each state links to its hub, which renders for any state with
 * a job.
 */
function landingPlaces(states: readonly StateCount[]): LocationSpreadPlace[] {
  return states.map((state) => ({
    name: state.name,
    count: state.count,
    link: { href: `/jobs/state/${stateToSlug(state.name)}`, renders: state.count >= 1 },
  }));
}

interface BandProps {
  id: string;
  eyebrow: string;
  title: string;
  background: string;
  children: React.ReactNode;
}

/** A data band in the page's own chrome: stage ground, eyebrow, Lora H2, clay cards. */
function Band({ id, eyebrow, title, background, children }: BandProps) {
  return (
    <div style={{ background }}>
      <section aria-labelledby={id} style={{ maxWidth: '1140px', margin: '0 auto', padding: '48px 24px 32px' }}>
        <ClayHead eyebrow={eyebrow} title={title} id={id} />
        {children}
      </section>
    </div>
  );
}

/** LAND-L3: the AANP classification of the listings' states, cited and linked. */
function PracticeEnvironmentCard({ sentence }: { sentence: string }) {
  const aanp = STAT_SOURCES.fullPracticeStates;
  return (
    <ClayCard chip="Practice authority" index={2} icon={ShieldCheck} title="Practice environment of current listings" desc={sentence}>
      <ul className="pseo-clay-list" style={clayList}>
        <li style={clayRow(false)}>
          <span>Classification</span>
          <a href={aanp.sourceUrl} target="_blank" rel="noopener noreferrer" style={clayLink}>{aanp.source}</a>
        </li>
        <li style={clayRow(true)}>
          <Link href="/resources/fpa-guide" style={clayLink}>Full practice authority guide</Link>
        </li>
      </ul>
    </ClayCard>
  );
}

interface LowInventoryBlockProps {
  total: number;
  counts: Map<string, number>;
}

/**
 * LAND-L7 (0 to 2 listings): the counted intro, then the explore
 * categories that clear the index floor with their live counts. The
 * sidebar alert card beside it is the page's one alert CTA.
 */
function LowInventoryBlock({ total, counts }: LowInventoryBlockProps) {
  const intro = buildLowInventoryIntro({ label: MID, total });
  const open = EXPLORE_CARDS.flatMap((card) => {
    const slug = exploreSlug(card.href);
    const count = slug ? counts.get(slug) : undefined;
    return count !== undefined && count >= MIN_JOBS_FOR_INDEX ? [{ ...card, count }] : [];
  });
  // The builder's trailer introduces the list; with no category at the
  // floor there is nothing to introduce, so only the count sentence prints.
  const lead = open.length > 0 ? intro : intro.split(' These related categories')[0];
  return (
    <div style={{ ...clayCard, padding: '32px 28px', marginTop: total > 0 ? '24px' : 0 }}>
      <p style={{ ...clayDesc, fontSize: '15px', margin: 0 }}>{lead}</p>
      {open.length > 0 ? (
        <ul className="pseo-clay-list" style={clayList}>
          {open.map((card, i) => (
            <li key={card.href} style={clayRow(i === open.length - 1)}>
              <Link href={card.href} style={clayLink}>{card.label}</Link>
              <span style={clayMeta}>{buildRelatedCategorySub(card.count)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ margin: '16px 0 0', fontSize: '14px' }}>
          <Link href="/jobs" style={clayLink}>Browse all {brand.niche.short} jobs</Link>
        </p>
      )}
    </div>
  );
}

/**
 * FAQ entries. One array feeds the visible cards and the FAQPage JSON-LD,
 * so an answer can never be in the schema without being on the page. The
 * pay answer is the gated LAND-L4 sentence, or the cited national median
 * when this category publishes no figure of its own.
 */
function buildCommunityHealthFaqs(facts: ListingFacts) {
  const payAnswer = buildPostedPaySentence({ slug: SLUG, facts }) ?? NATIONAL_MEDIAN_SENTENCE;
  return [
    {
      question: `What do community health ${brand.niche.short}s do?`,
      answer: `Community health ${brand.niche.short}s provide primary and preventive care in FQHCs, community health centers, and public health clinics. They manage chronic conditions, treat acute illness, deliver screenings and preventive services, and work alongside behavioral health, dental, and social work teams to provide integrated, whole-person care to underserved populations.`,
    },
    { question: `How much do community health ${brand.niche.short}s earn?`, answer: payAnswer },
    {
      question: 'Do community health positions qualify for loan repayment?',
      answer: 'It depends on the employer, the site and the federal program rules in force when you apply. Ask each employer whether its site takes part in a loan repayment or forgiveness program, and confirm the current requirements with the program itself before you rely on them.',
    },
    {
      question: `What qualifications are needed for community health ${brand.niche.short} roles?`,
      answer: 'You need an active APRN license and national NP certification, and most listings ask for DEA registration. Experience with diverse patient populations helps, and some listings name a second language or accept newly certified applicants with structured supervision, so read what each posting asks for.',
    },
  ];
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const [facts, params] = await Promise.all([getFacts(), searchParams]);
  const page = Math.max(1, parseInt(params.page || '1', 10) || 1);
  const totalJobs = facts.total;
  const title = buildCategoryLandingTitle({ role: NOUN, totalJobs, tagline: 'FQHC and Public Health' });
  const description = buildCategoryLandingDescription({
    role: NOUN,
    totalJobs,
    employerCount: facts.distinctEmployers,
    stateCount: canonicalStates(facts.states).length,
    medianK: facts.benchmark ? Math.round(facts.benchmark.median / 1000) : null,
  });
  // The OG subtitle carries the live count only at the display floor and
  // never a freshness claim.
  const ogSubtitle = totalJobs >= COUNT_DISPLAY_FLOOR
    ? formatCount(totalJobs, 'open position')
    : 'FQHC, public health and community health center roles';
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
      url: `${brand.baseUrl}/jobs/community-health`,
      images: [{
        url: `/api/og?type=page&title=${encodeURIComponent(`${NOUN} Jobs`)}&subtitle=${encodeURIComponent(ogSubtitle)}`,
        width: 1200, height: 630, alt: `${NOUN} Jobs`,
      }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
    alternates: { canonical: `${brand.baseUrl}/jobs/community-health` },
    // thin-spec-1 8.3 / PLAN C.2: index page 1 only at MIN_JOBS_FOR_INDEX or
    // more canonical jobs, through the same gate the sitemap reads. Every
    // other view keeps its canonical and stays follow.
    ...(!shouldIndexListingPage(totalJobs, page) && { robots: { index: false, follow: true } }),
  };
}

interface PageProps {
  searchParams: Promise<{ page?: string }>;
}

export default async function CommunityHealthJobsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page || '1', 10) || 1);
  const limit = 10;
  const skip = (page - 1) * limit;

  const [facts, exploreCounts] = await Promise.all([getFacts(), getExploreCounts()]);
  const jobs = facts.total > 0 ? await getCommunityHealthJobs(skip, limit) : [];

  const communityHealthFaqs = buildCommunityHealthFaqs(facts);
  const states = canonicalStates(facts.states);
  const places = landingPlaces(states);
  const practiceSentence = buildListingsAuthoritySentence({ slug: SLUG, states, total: facts.total });
  const snapshotRenders =
    employerSentence({ kind: 'scoped', label: MID, scope: 'nationwide' }, facts) !== null
    || buildRoleSetup({ slug: SLUG, facts }).rendered
    || buildRecencySentence(facts.recency) !== null;
  const locationCards = [places.length > 0, practiceSentence !== null].filter(Boolean).length;
  const payRenders = postedPaySentence({ kind: 'category', slug: SLUG }, facts) !== null;
  const axisGuide = getLandingAxisGuide(SLUG);
  const isLowInventory = facts.total < MIN_JOBS_FOR_INDEX;

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#FDFBF7' }}>
      <ClayStyles />
      <BreadcrumbSchema items={[
        { name: "Home", url: brand.baseUrl },
        { name: "Jobs", url: `${brand.baseUrl}/jobs` },
        { name: "Community Health", url: `${brand.baseUrl}/jobs/community-health` }
      ]} />
      {communityHealthFaqs.length >= 2 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'FAQPage',
              mainEntity: communityHealthFaqs.map((faq) => ({
                '@type': 'Question',
                name: faq.question,
                acceptedAnswer: { '@type': 'Answer', text: faq.answer },
              })),
            }),
          }}
        />
      )}
      {jobs.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'ItemList',
              name: `Community Health ${brand.niche.short} Jobs`,
              numberOfItems: facts.total,
              itemListElement: jobs.slice(0, 10).map((job: Job, idx: number) => ({
                '@type': 'ListItem',
                position: idx + 1,
                name: job.title,
                url: `${brand.baseUrl}/jobs/${job.slug || job.id}`,
              })),
            }),
          }}
        />
      )}
      <JobListViewTracker jobs={jobs.map((j: Job) => ({ id: j.id, title: j.title, employer: j.employer }))} listName={LIST_NAME} indexOffset={skip} />

      {/* HERO */}
      <CategoryHero
        bgColor="#5b7455"
        heroImage="/images/categories/heroes/community-health.webp"
        heroAlt={`Community health ${brand.niche.short} integrated care`}
        badgeText={facts.total > 0 ? buildLiveRolesBadge(facts.total) : `${brand.niche.long} Careers`}
        breadcrumbs={crumbsFromSchema([{ name: "Home", url: brand.baseUrl }, { name: "Jobs", url: `${brand.baseUrl}/jobs` }, { name: "Community Health", url: `${brand.baseUrl}/jobs/community-health` }])}
        indexLabel={`№ ${ALL_CATEGORY_SLUGS.indexOf('community-health') + 1} / ${ALL_CATEGORY_SLUGS.length}`}
        headlineLine1="Community Health"
        headlineLine2={brand.niche.short}
        headlineSub="jobs, FQHC & public health."
        stats={[
          { value: `${facts.total}`, label: pluralize(facts.total, 'position') },
          ...(facts.distinctEmployers > 0 ? [{ value: `${facts.distinctEmployers}`, label: pluralize(facts.distinctEmployers, 'employer') }] : []),
          // The gated median only: below the publishing gate the stat is omitted.
          ...(facts.benchmark ? [{ value: formatK(facts.benchmark.median), label: 'median posted pay' }] : []),
        ]}
        description="FQHC, community health center and public health positions with integrated care teams."
        ctaLabel="Browse Community Health Jobs"
        ctaHref="/jobs?category=community-health"
        secondaryCtaLabel="Set Alert"
        secondaryCtaHref="/job-alerts"
      />

      {/* JOB LISTINGS */}
      <div style={{ maxWidth: '1440px', margin: '0 auto', padding: '32px 24px' }}>
        <div className="grid lg:grid-cols-4 gap-8">
          <div className="lg:col-span-3">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-lora" style={{ fontSize: '20px', fontWeight: 700, color: '#1A2E35' }}>Community Health Positions ({facts.total})</h2>
              <Link href="/jobs" className="text-sm font-medium hover:opacity-80 transition-opacity" style={{ color: 'var(--color-primary)' }}>View All Jobs</Link>
            </div>
            {jobs.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
                {jobs.map((job: Job, i: number) => (<JobCard key={job.id} job={job} listName={LIST_NAME} listIndex={skip + i} />))}
              </div>
            )}
            {isLowInventory && (<LowInventoryBlock total={facts.total} counts={exploreCounts} />)}
            {jobs.length > 0 && (
              <div style={{ textAlign: 'center', marginTop: '32px' }}>
                <Link href="/jobs?category=community-health" className="cat-cta-primary" style={{ padding: '14px 32px', borderRadius: '14px', fontWeight: 700, fontSize: '14px', background: '#BE185D', color: '#fff', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '8px', boxShadow: '4px 4px 12px rgba(190,24,93,0.2)' }}>
                  Browse All Community Health Jobs <ArrowRight size={16} />
                </Link>
              </div>
            )}
          </div>
          {/* Sidebar: the page's one alert CTA. Alert cadence:
              /api/cron/send-alerts runs in the daily group. */}
          <div className="lg:col-span-1">
            <div className="cat-bento-card" style={{ ...clayCard, padding: '0', overflow: 'hidden', background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)', border: '2px solid rgba(190,24,93,0.15)' }}>
              <div style={{ padding: '24px' }}>
                <Bell size={28} style={{ color: '#BE185D', marginBottom: '12px' }} />
                <h3 className="font-lora" style={{ fontSize: '18px', fontWeight: 700, color: '#831843', margin: '0 0 8px' }}>Community Health Alerts</h3>
                <p style={{ fontSize: '13px', color: '#BE185D', marginBottom: '16px', lineHeight: 1.6, fontWeight: 500 }}>New community health roles delivered daily.</p>
                <Link href="/job-alerts" className="cat-cta-primary" style={{ display: 'block', width: '100%', textAlign: 'center', padding: '10px 20px', borderRadius: '10px', fontWeight: 700, fontSize: '13px', background: '#BE185D', color: '#fff', textDecoration: 'none', boxShadow: '3px 3px 8px rgba(190,24,93,0.15)' }}>Create Alert</Link>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* LAND-L1 MARKET SNAPSHOT: who is hiring (the former sidebar employer
          list, now with the sentence and company links), how the roles are
          set up, and how current the listings are. */}
      {snapshotRenders && (
        <Band id="snapshot-community-health" eyebrow="Market Snapshot" title={`What current ${NOUN} listings show`} background="#FDFBF7">
          <MarketSnapshot slug={SLUG} label={MID} scope="nationwide" facts={facts} />
        </Band>
      )}

      {/* LAND-L2 WHERE THE LISTINGS ARE + LAND-L3 PRACTICE ENVIRONMENT. */}
      {locationCards > 0 && (
        <Band id="locations-community-health" eyebrow="Locations" title={`Where ${NOUN} listings are`} background={MINT_STAGE}>
          <div className={locationCards > 1 ? 'pseo-clay-grid pseo-clay-cols-2' : 'pseo-clay-grid'}>
            <LocationSpread variant={{ kind: 'landing' }} places={places} title="States with current listings" index={1} />
            {practiceSentence && <PracticeEnvironmentCard sentence={practiceSentence} />}
          </div>
        </Band>
      )}

      {/* BENTO: Why Choose Community Health */}
      <div style={{ background: 'linear-gradient(180deg, #FDF2F8 0%, #FDF2F8 50%, #FDF2F8 100%)' }}>
        <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '48px 20px 40px' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#E86C2C', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>Why Choose Community Health</p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(26px, 3.5vw, 38px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '8px' }}>Built for Underserved Communities</h2>
          <p style={{ fontSize: '15px', color: '#5A4A42', textAlign: 'center', maxWidth: '480px', margin: '0 auto 48px', lineHeight: 1.6 }}>Community health roles put primary care alongside behavioral health, dental and social work teams in one setting.</p>

          <div className="cat-bento-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '14px' }}>
            {/* ROW 1: FQHC Settings (8) + Community Impact (4) */}
            <div className="cat-bento-hero-1 cat-bento-card" style={{ ...clayCard, gridColumn: 'span 8', padding: '0', overflow: 'hidden', display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
              <div style={{ padding: '32px 28px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <h3 style={{ fontSize: '20px', fontWeight: 800, color: '#1A2E35', margin: '0 0 8px' }}>FQHC Settings</h3>
                <p style={{ fontSize: '14px', color: '#5A4A42', margin: 0, lineHeight: 1.6 }}>
                  Work in Federally Qualified Health Centers and community health centers, alongside integrated primary care, behavioral health and social work teams.
                </p>
              </div>
              <ImmersiveImage src="/images/categories/bento/community-health-fqhc.webp" alt="FQHC community health center" minHeight={240} />
            </div>

            <div className="cat-bento-hero-2 cat-bento-card" style={{ ...clayCard, gridColumn: 'span 4', padding: '0', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <ImmersiveImage src="/images/categories/bento/community-health-impact.webp" alt="Community health impact" minHeight={200} />
              <div style={{ padding: '24px 22px', flex: 1 }}>
                <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#1A2E35', margin: '0 0 6px' }}>Community Impact</h3>
                <p style={{ fontSize: '12.5px', color: '#7A6A62', margin: 0, lineHeight: 1.5 }}>Care for patients in your own community, in settings built around access.</p>
              </div>
            </div>

            {/* ROW 2: 4 clay icon cards (3 cols each) */}
            <div className="cat-bento-card" style={{ ...clayCard, gridColumn: 'span 3', padding: '24px 18px', textAlign: 'center' }}>
              <Image src="/images/categories/icons/community-health-clinic.webp" alt="" width={48} height={48} style={{ width: '48px', height: '48px', objectFit: 'contain', margin: '0 auto 14px', display: 'block' }} />
              <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}>Clinic-Based Care</h3>
              <p style={{ fontSize: '12px', color: '#7A6A62', margin: 0, lineHeight: 1.55 }}>Outpatient settings with continuing patient panels.</p>
            </div>
            <div className="cat-bento-card" style={{ ...clayCard, gridColumn: 'span 3', padding: '24px 18px', textAlign: 'center' }}>
              <Image src="/images/categories/icons/community-health-diversity.webp" alt="" width={48} height={48} style={{ width: '48px', height: '48px', objectFit: 'contain', margin: '0 auto 14px', display: 'block' }} />
              <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}>Diverse Populations</h3>
              <p style={{ fontSize: '12px', color: '#7A6A62', margin: 0, lineHeight: 1.55 }}>Serve diverse, multilingual communities with culturally responsive care.</p>
            </div>
            <div className="cat-bento-card" style={{ ...clayCard, gridColumn: 'span 3', padding: '24px 18px', textAlign: 'center' }}>
              <Image src="/images/categories/icons/community-health-grant.webp" alt="" width={48} height={48} style={{ width: '48px', height: '48px', objectFit: 'contain', margin: '0 auto 14px', display: 'block' }} />
              <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}>Grant-Funded Roles</h3>
              <p style={{ fontSize: '12px', color: '#7A6A62', margin: 0, lineHeight: 1.55 }}>Some posts are funded through health center grants; the listing will say.</p>
            </div>
            <div className="cat-bento-card" style={{ ...clayCard, gridColumn: 'span 3', padding: '24px 18px', textAlign: 'center' }}>
              <Image src="/images/categories/icons/community-health-heart.webp" alt="" width={48} height={48} style={{ width: '48px', height: '48px', objectFit: 'contain', margin: '0 auto 14px', display: 'block' }} />
              <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}>Loan Repayment</h3>
              <p style={{ fontSize: '12px', color: '#7A6A62', margin: 0, lineHeight: 1.55 }}>Ask whether the site takes part in a federal loan repayment program.</p>
            </div>
          </div>
        </section>
      </div>

      {/* LAND-L4 POSTED PAY: the gated median, or the counted below-gate
          sentence with the BLS cite. Replaces the salary bento cell. */}
      {payRenders && (
        <Band id="pay-community-health" eyebrow="Compensation" title={`${NOUN} posted pay`} background="#FDFBF7">
          <div className="pseo-clay-split" style={{ gap: '14px', alignItems: 'stretch' }}>
            <PostedPay variant={{ kind: 'category', slug: SLUG }} facts={facts} />
            <div className="pseo-clay-card" style={{ ...clayCard, padding: 0, overflow: 'hidden', display: 'grid' }}>
              <ImmersiveImage src="/images/categories/bento/community-health-salary.webp" alt={`Community health ${brand.niche.short} pay`} minHeight={240} />
            </div>
          </div>
        </Band>
      )}

      {/* LAND-L5 HOW TO USE THIS PAGE: one paragraph per taxonomy axis. */}
      {axisGuide && (
        <Band id="guide-community-health" eyebrow="Using This Page" title="How to use this page" background={PEACH_STAGE}>
          <div className="pseo-clay-card" style={{ ...clayCard, padding: '28px', display: 'flex', gap: '20px', alignItems: 'flex-start', maxWidth: '860px', margin: '0 auto' }}>
            <IconWell icon={BookOpen} />
            <p style={{ ...clayDesc, fontSize: '15px', lineHeight: 1.75 }}>{axisGuide}</p>
          </div>
        </Band>
      )}

      {/* BEFORE YOU APPLY */}
      <div style={{ background: 'linear-gradient(180deg, #FDFBF7 0%, #FFF8F0 50%, #FDFBF7 100%)' }}>
        <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '56px 20px' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#BE185D', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>Before You Apply</p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 34px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '40px' }}>What You Need to Know</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px' }}>
              <div key="01" className="cat-bento-card" style={{ ...clayCard, padding: '28px 24px', borderTop: '3px solid #BE185D' }}>
                <span style={{ fontSize: '28px', fontWeight: 800, color: '#FCE7F3', display: 'block', marginBottom: '12px' }}>01</span>
                <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#1A2E35', marginBottom: '8px' }}>NP Certification</h3>
                <p style={{ fontSize: '13px', color: '#5A4A42', lineHeight: 1.6, margin: 0 }}>An active APRN license and national NP certification.</p>
              </div>
              <div key="02" className="cat-bento-card" style={{ ...clayCard, padding: '28px 24px', borderTop: '3px solid #BE185D' }}>
                <span style={{ fontSize: '28px', fontWeight: 800, color: '#FCE7F3', display: 'block', marginBottom: '12px' }}>02</span>
                <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#1A2E35', marginBottom: '8px' }}>Cultural Competency</h3>
                <p style={{ fontSize: '13px', color: '#5A4A42', lineHeight: 1.6, margin: 0 }}>Experience with diverse patient populations, and any second language a listing names.</p>
              </div>
              <div key="03" className="cat-bento-card" style={{ ...clayCard, padding: '28px 24px', borderTop: '3px solid #BE185D' }}>
                <span style={{ fontSize: '28px', fontWeight: 800, color: '#FCE7F3', display: 'block', marginBottom: '12px' }}>03</span>
                <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#1A2E35', marginBottom: '8px' }}>DEA Registration</h3>
                <p style={{ fontSize: '13px', color: '#5A4A42', lineHeight: 1.6, margin: 0 }}>Listings state whether DEA registration to prescribe controlled substances is required.</p>
              </div>
              <div key="04" className="cat-bento-card" style={{ ...clayCard, padding: '28px 24px', borderTop: '3px solid #BE185D' }}>
                <span style={{ fontSize: '28px', fontWeight: 800, color: '#FCE7F3', display: 'block', marginBottom: '12px' }}>04</span>
                <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#1A2E35', marginBottom: '8px' }}>Loan Programs</h3>
                <p style={{ fontSize: '13px', color: '#5A4A42', lineHeight: 1.6, margin: 0 }}>Check whether the employer site takes part in a federal loan repayment program.</p>
              </div>
          </div>
        </section>
      </div>

      {/* EXPLORE MORE (LAND-L6): the page's own cards, each category card
          carrying its live canonical count. */}
      <div style={{ background: 'linear-gradient(180deg, #FDF2F8 0%, #FDF2F8 50%, #FDF2F8 100%)' }}>
        <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '56px 20px' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#E86C2C', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>Keep Exploring</p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 34px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '40px' }}>More Ways to Find Your Next Role</h2>
          <div className="cat-explore-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
            {EXPLORE_CARDS.map(c => {
              const slug = exploreSlug(c.href);
              const count = slug ? exploreCounts.get(slug) : undefined;
              return (
                <Link key={c.href} href={c.href} className="cat-bento-card" style={{ ...clayCard, padding: '24px 20px', textDecoration: 'none', display: 'block', textAlign: 'center' }}>
                  <Image src={c.icon} alt="" width={48} height={48} style={{ width: '48px', height: '48px', objectFit: 'contain', margin: '0 auto 12px', display: 'block' }} />
                  <span style={{ fontSize: '15px', fontWeight: 700, color: '#1A2E35', display: 'block', marginBottom: '4px' }}>{c.label}</span>
                  <span style={{ fontSize: '12px', color: '#7A6A62', display: 'block' }}>{c.sub}</span>
                  {count !== undefined && count >= 1 && (<span style={{ ...clayMeta, display: 'block', marginTop: '8px' }}>{buildRelatedCategorySub(count)}</span>)}
                </Link>
              );
            })}
          </div>
        </section>
      </div>

      {/* By Location: pseoStats-gated internal links */}

      <CategoryLocationsExplore categorySlug="community-health" categoryLabel="Community Health" />


      {/* FAQ */}
      <div style={{ background: 'linear-gradient(180deg, #FDFBF7 0%, #FFF8F0 50%, #FDFBF7 100%)' }}>
        <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '56px 20px' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#BE185D', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>FAQ</p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 34px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '40px' }}>Community Health {brand.niche.short} Questions</h2>
          <div style={{ display: 'grid', gap: '16px' }}>
            {communityHealthFaqs.map((faq, idx) => (
              <div key={idx} className="cat-bento-card" style={{ ...clayCard, padding: '28px 28px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#1A2E35', margin: '0 0 10px' }}>{faq.question}</h3>
                <p className="faq-answer" style={{ fontSize: '14px', color: '#5A4A42', lineHeight: 1.7, margin: 0 }}>{faq.answer}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Responsive + Hover CSS */}
      <style>{`
        .cat-cta-primary { transition: transform 0.25s ease, box-shadow 0.25s ease, filter 0.25s ease; }
        .cat-cta-primary:hover { transform: translateY(-3px); box-shadow: 0 10px 32px rgba(190,24,93,0.35) !important; filter: brightness(1.05); }
        .cat-bento-card { transition: transform 0.3s ease, box-shadow 0.3s ease; }
        .cat-bento-card:hover { transform: translateY(-4px); box-shadow: 8px 8px 24px rgba(0,0,0,0.1), -4px -4px 12px rgba(255,255,255,0.9), inset 1px 1px 2px rgba(255,255,255,0.6) !important; }
        .cat-stat-pill { transition: transform 0.2s ease, box-shadow 0.2s ease; }
        .cat-stat-pill:hover { transform: translateY(-2px) scale(1.02); box-shadow: 6px 6px 20px rgba(0,0,0,0.1), -3px -3px 10px rgba(255,255,255,0.9) !important; }
        @media (max-width: 768px) {
          .cat-hero-grid { grid-template-columns: 1fr !important; }
          .cat-stats-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .cat-bento-grid { grid-template-columns: 1fr !important; }
          .cat-bento-hero-1, .cat-bento-hero-2, .cat-bento-hero-3, .cat-bento-cta { grid-column: span 1 !important; }
          .cat-bento-hero-1, .cat-bento-hero-3 { grid-template-columns: 1fr !important; }
          .cat-bento-grid > div { grid-column: span 1 !important; }
          .cat-explore-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
      @media (min-width: 769px) and (max-width: 1024px) {
          .cat-bento-grid { grid-template-columns: repeat(6, 1fr) !important; }
          .cat-bento-hero-1, .cat-bento-hero-3 { grid-column: span 6 !important; }
          .cat-bento-hero-2, .cat-bento-cta { grid-column: span 6 !important; }
          .cat-bento-grid > div:not(.cat-bento-hero-1):not(.cat-bento-hero-2):not(.cat-bento-hero-3):not(.cat-bento-cta) { grid-column: span 3 !important; }
        }
        @media (prefers-reduced-motion: reduce) {
          .cat-cta-primary, .cat-bento-card, .cat-stat-pill { transition: none; }
          .cat-cta-primary:hover, .cat-bento-card:hover, .cat-stat-pill:hover { transform: none; }
        }
      `}</style>
    </div>
  );
}
