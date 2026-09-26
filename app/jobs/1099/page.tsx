import { brand } from '@/config/brand';
import { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import ImmersiveImage from '@/components/ImmersiveImage';
import CategoryHero, { crumbsFromSchema } from '@/components/CategoryHero';
import { Bell, BookOpen, ShieldCheck, ArrowRight } from 'lucide-react';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { BEST_SORT_ORDER_BY } from '@/lib/utils/job-sort';
import { buildCategoryWhereClause, CATEGORY_EXTRA_OR, CATEGORY_FILTERS } from '@/lib/filters';
import { canonicalBucketWhere, COUNT_DISPLAY_FLOOR } from '@/lib/canonical-counts';
import { formatCount, pluralize } from '@/lib/display-text';
import { STAT_SOURCES } from '@/lib/stats-sources';
import JobCard from '@/components/JobCard';
import { Job } from '@/lib/types';
import BreadcrumbSchema from '@/components/BreadcrumbSchema';
import { JobListViewTracker } from '@/components/analytics/ViewTrackers';
import CategoryLocationsExplore from '@/components/seo/CategoryLocationsExplore';
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
import { ALL_CATEGORY_SLUGS } from '@/lib/pseo/taxonomy-registry';
import { getListingFacts, type StateCount } from '@/lib/pseo/listing-facts';
import {
  NATIONAL_MEDIAN_SENTENCE,
  buildListingsAuthoritySentence,
  buildLowInventoryIntro,
  buildRecencySentence,
  buildRelatedCategorySub,
  buildRoleSetup,
  formatK,
} from '@/lib/pseo/listing-narrative';
import {
  buildCategoryLandingDescription,
  buildCategoryLandingTitle,
  categoryLandingRobots,
  labelNoun,
  labelSentence,
} from '@/lib/pseo/category-metadata';
import { getLandingAxisGuide } from '@/lib/pseo/category-axis-guide';
import { MIN_JOBS_FOR_INDEX } from '@/lib/pseo/render-gate';
import { CODE_TO_STATE, STATE_CODES, stateToSlug } from '@/lib/pseo/setting-state-config';

/* Design tokens: the clay surface this page has always used. */
const clayCard: React.CSSProperties = {
  background: '#FFFFFF', borderRadius: '20px',
  border: '1px solid rgba(255,255,255,0.5)',
  boxShadow: '6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02)',
};

/** Band grounds for the data bands; adjacent bands never share one. */
const MINT_STAGE = 'linear-gradient(180deg, #FDFBF7 0%, #E6FFFA 50%, #FDFBF7 100%)';
const PEACH_STAGE = 'linear-gradient(180deg, #FDFBF7 0%, #FFF3E8 50%, #FDFBF7 100%)';

export const revalidate = 3600;

const SLUG = '1099';
const LABEL = '1099';
/** Role noun for titles and headings. */
const NOUN = labelNoun(SLUG, LABEL);
/** Mid-sentence form of the label (the digits keep their form). */
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
const LIST_NAME = `${NOUN} Jobs`;

/**
 * Buckets the bespoke landings count with, so a sibling card here prints the
 * same number that page prints. Remote is the structured work-mode flag (the
 * clause behind /jobs?workMode=remote), not a title keyword sweep.
 */
const BESPOKE_BUCKETS: Record<string, Prisma.JobWhereInput> = {
  remote: { isRemote: true },
  inpatient: buildCategoryWhereClause('inpatient', { isRemote: { not: true } }),
};

/**
 * The category bucket for a slug. Slugs without a legacy keyword entry gate
 * on the precomputed categoryTags column, so a count can never degrade to
 * "all published jobs" (the shared template applies the same rule).
 */
function categoryWhere(slug: string): Prisma.JobWhereInput {
  const bespoke = BESPOKE_BUCKETS[slug];
  if (bespoke) return bespoke;
  const hasLegacyKeywordFilter =
    (CATEGORY_FILTERS[slug]?.length ?? 0) > 0 || (CATEGORY_EXTRA_OR[slug]?.length ?? 0) > 0;
  return hasLegacyKeywordFilter
    ? buildCategoryWhereClause(slug)
    : buildCategoryWhereClause(slug, { categoryTags: { has: slug } });
}

/** This page's bucket, composed onto the canonical predicate by every reader. */
const BUCKET = categoryWhere(SLUG);

/**
 * LAND-T3: the one facts load for this page. getListingFacts composes the
 * canonical predicate and is React cache()d on the scope key, so
 * generateMetadata and the page body share a single set of queries.
 */
function getFacts() {
  return getListingFacts(`category-landing:${SLUG}`, BUCKET);
}

async function getJobs(skip = 0, take = 10) {
  return prisma.job.findMany({
    where: canonicalBucketWhere(BUCKET),
    orderBy: BEST_SORT_ORDER_BY,
    skip,
    take,
  });
}

/** LAND-L6 related destinations; slugged cards carry a live canonical count. */
const EXPLORE_CARDS: ReadonlyArray<{ href: string; label: string; sub: string; icon: string; slug?: string }> = [
  { href: '/jobs/remote', label: 'Remote', sub: 'Work from home', icon: '/images/categories/nav/remote.webp', slug: 'remote' },
  { href: '/jobs/telehealth', label: 'Telehealth', sub: 'Virtual care', icon: '/images/categories/nav/telehealth.webp', slug: 'telehealth' },
  { href: '/jobs/locum-tenens', label: 'Locum Tenens', sub: 'Agency assignments', icon: '/images/categories/nav/locum-tenens.webp', slug: 'locum-tenens' },
  { href: '/jobs/per-diem', label: 'Per Diem', sub: 'Shift by shift', icon: '/images/categories/nav/per-diem.webp', slug: 'per-diem' },
  { href: '/salary-guide', label: 'Salary Guide', sub: 'Posted pay by state', icon: '/images/categories/nav/salary.webp' },
  { href: '/jobs/locations', label: 'By Location', sub: 'Browse every state', icon: '/images/categories/nav/location.webp' },
];

/** Live canonical counts for the slugged explore cards, in one Promise.all. */
async function getRelatedCounts(): Promise<Map<string, number>> {
  const slugs = EXPLORE_CARDS.flatMap((card) => (card.slug ? [card.slug] : []));
  const rows = await Promise.all(slugs.map(async (slug) => {
    try {
      return [slug, await prisma.job.count({ where: canonicalBucketWhere(categoryWhere(slug)) })] as const;
    } catch (error) {
      console.error(`[jobs/${SLUG}] sibling count failed for "${slug}":`, error);
      return [slug, null] as const;
    }
  }));
  return new Map(rows.flatMap(([slug, count]) => (count === null ? [] : [[slug, count] as [string, number]])));
}

/** Canonical full state name for a raw Job.state value, or null for a non-state. */
function canonicalStateName(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (STATE_CODES[value]) return value;
  return CODE_TO_STATE[value.toUpperCase()]
    ?? Object.keys(STATE_CODES).find((name) => name.toLowerCase() === value.toLowerCase())
    ?? null;
}

/** LAND-L2 places: the facts' states folded onto canonical names, each linked to its hub. */
function landingPlaces(states: readonly StateCount[]): LocationSpreadPlace[] {
  const counts = new Map<string, number>();
  for (const state of states) {
    const canonical = canonicalStateName(state.name);
    if (canonical) counts.set(canonical, (counts.get(canonical) ?? 0) + state.count);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => ({
      name,
      count,
      link: { href: `/jobs/state/${stateToSlug(name)}`, renders: count >= 1 },
    }));
}

/** A data band in this page's own chrome: stage ground, eyebrow, Lora H2, clay cards. */
function Band({ id, eyebrow, title, background, children }: {
  id: string; eyebrow: string; title: string; background: string; children: React.ReactNode;
}) {
  return (
    <div style={{ background }}>
      <section aria-labelledby={id} style={{ maxWidth: '1140px', margin: '0 auto', padding: '48px 24px 32px' }}>
        <ClayHead eyebrow={eyebrow} title={title} id={id} />
        {children}
      </section>
    </div>
  );
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const [facts, params] = await Promise.all([getFacts(), searchParams]);
  const page = Math.max(1, parseInt(params.page || '1', 10) || 1);
  const totalJobs = facts.total;
  const title = buildCategoryLandingTitle({ role: NOUN, totalJobs });
  const description = buildCategoryLandingDescription({
    role: NOUN,
    totalJobs,
    employerCount: facts.distinctEmployers,
    stateCount: landingPlaces(facts.states).length,
    medianK: facts.benchmark ? Math.round(facts.benchmark.median / 1000) : null,
  });
  const ogSubtitle = totalJobs >= COUNT_DISPLAY_FLOOR
    ? formatCount(totalJobs, 'open position')
    : 'Role overview, certification requirements and state links';

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
      url: `${brand.baseUrl}/jobs/1099`,
      images: [{
        url: `/api/og?type=page&title=${encodeURIComponent(`${NOUN} Jobs`)}&subtitle=${encodeURIComponent(ogSubtitle)}`,
        width: 1200,
        height: 630,
        alt: `${NOUN} Jobs`,
      }],
    },
    twitter: { card: 'summary_large_image', title, description },
    // Self canonical on page 1; paginated views canonical to page 1.
    alternates: { canonical: `${brand.baseUrl}/jobs/1099` },
    // thin-spec-1 8.3 / PLAN C.2: index page 1 only, at MIN_JOBS_FOR_INDEX or
    // more canonical jobs. Every other view stays follow and keeps its canonical.
    robots: categoryLandingRobots(totalJobs, page),
  };
}

interface PageProps {
  searchParams: Promise<{ page?: string }>;
}

export default async function IndependentContractorJobsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page || '1', 10) || 1);
  const limit = 10;
  const skip = (page - 1) * limit;

  const [facts, relatedCounts] = await Promise.all([getFacts(), getRelatedCounts()]);
  const jobs = facts.total > 0 ? await getJobs(skip, limit) : [];

  // Data bands, each rendered only when its own builder returns something.
  const places = landingPlaces(facts.states);
  const states: StateCount[] = places.map(({ name, count }) => ({ name, count }));
  const snapshotRenders =
    employerSentence({ kind: 'scoped', label: MID, scope: 'nationwide' }, facts) !== null
    || buildRoleSetup({ slug: SLUG, facts }).rendered
    || buildRecencySentence(facts.recency) !== null;
  const practiceSentence = buildListingsAuthoritySentence({ slug: SLUG, states, total: facts.total });
  const locationCards = [places.length > 0, practiceSentence !== null].filter(Boolean).length;
  const paySentence = postedPaySentence({ kind: 'category', slug: SLUG }, facts);
  const axisGuide = getLandingAxisGuide(SLUG);
  const isLowInventory = facts.total < MIN_JOBS_FOR_INDEX;
  // LAND-L7: the siblings that clear the index floor, with their live counts.
  const lowInventoryLinks = EXPLORE_CARDS.flatMap((card) => {
    const count = card.slug ? relatedCounts.get(card.slug) : undefined;
    return count !== undefined && count >= MIN_JOBS_FOR_INDEX ? [{ ...card, count }] : [];
  });
  const lowInventoryIntro = buildLowInventoryIntro({ label: MID, total: facts.total });
  const aanp = STAT_SOURCES.fullPracticeStates;

  // LAND-T15: the pay answer carries the gated median, or the cited national
  // median when the publishing gate fails. The self-employment tax rate and
  // every other tax figure live in /resources/1099-vs-w2, which owns them.
  const icFaqs = [
    {
      question: `What is a 1099 ${brand.niche.short} position?`,
      answer: `A 1099 ${brand.niche.short} works as an independent contractor rather than a W-2 employee, and receives a 1099-NEC form instead of a W-2. You set your own schedule, pay your own self-employment tax, and fund your own benefits and malpractice coverage. The rate a listing quotes is a gross rate with none of that attached.`,
    },
    {
      question: `What do 1099 ${brand.niche.short} roles pay?`,
      answer: `${paySentence ?? NATIONAL_MEDIAN_SENTENCE} A 1099 rate is quoted gross, so model self-employment tax, health insurance, malpractice coverage and retirement contributions before you compare it with a W-2 offer. The 1099 versus W-2 guide on this site works through that comparison.`,
    },
    {
      question: `What are the tax advantages of 1099 ${brand.niche.short} work?`,
      answer: `Independent contractors can deduct qualifying business expenses, which commonly include a home office, mileage, professional development, malpractice insurance, health insurance premiums, retirement plan contributions, equipment and professional memberships. The rules and the limits are set by the IRS and change between tax years, so confirm them with a tax professional.`,
    },
    {
      question: `Should new graduate ${brand.niche.short}s take 1099 positions?`,
      answer: `A W-2 position that names mentorship, malpractice coverage and benefits is usually the better first role. Independent contracting asks for clinical confidence and the business discipline to invoice, insure and file for yourself, which is easier to carry once you have practised for a while.`,
    },
    {
      question: `What do 1099 ${brand.niche.short}s need to set up?`,
      answer: `Independent contractors commonly form an LLC or PLLC for liability protection, obtain individual malpractice insurance, open a business bank account, obtain an EIN from the IRS, register for quarterly estimated tax payments, open a retirement plan such as a SEP-IRA or Solo 401(k), and arrange health insurance. Confirm what your state and your contract require before you sign.`,
    },
  ];

  // One array drives the BreadcrumbList JSON-LD and the hero's linked trail.
  const breadcrumbTrail = [
    { name: "Home", url: brand.baseUrl },
    { name: "Jobs", url: `${brand.baseUrl}/jobs` },
    { name: "1099 / Independent Contractor", url: `${brand.baseUrl}/jobs/1099` },
  ];

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#FDFBF7' }}>
      <ClayStyles />
      <BreadcrumbSchema items={breadcrumbTrail} />
      {jobs.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            // Job titles are employer-supplied, so the serialized JSON-LD goes
            // through the repo's \u003c escape chain.
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'ItemList',
              name: `${NOUN} Jobs`,
              numberOfItems: facts.total,
              itemListElement: jobs.slice(0, 10).map((job: Job, idx: number) => ({
                '@type': 'ListItem',
                position: idx + 1,
                name: job.title,
                url: `${brand.baseUrl}/jobs/${job.slug || job.id}`,
              })),
            }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e'),
          }}
        />
      )}
      <JobListViewTracker jobs={jobs.map((j: Job) => ({ id: j.id, title: j.title, employer: j.employer }))} listName={LIST_NAME} indexOffset={skip} />

      {/* ═══ HERO ═══ */}
      <CategoryHero
        bgColor="#f6dfa7"
        heroImage="/images/categories/bento/1099-tax.webp"
        heroAlt={`${brand.niche.short} independent contractor workspace`}
        badgeText={`${facts.total} live ${pluralize(facts.total, 'role')} · updated today`}
        breadcrumbs={crumbsFromSchema(breadcrumbTrail)}
        indexLabel={`№ ${String(ALL_CATEGORY_SLUGS.indexOf('1099') + 1).padStart(2, '0')} / ${ALL_CATEGORY_SLUGS.length}`}
        headlineLine1="1099"
        headlineLine2={brand.niche.short}
        headlineSub="jobs on your terms."
        stats={[
          ...(facts.total > 0
            ? [{ value: `${facts.total}`, label: pluralize(facts.total, 'position') }]
            : []),
          ...(facts.distinctEmployers > 0
            ? [{ value: `${facts.distinctEmployers}`, label: pluralize(facts.distinctEmployers, 'employer') }]
            : []),
          // The gated median only (T0-3): below the publishing gate the stat is omitted.
          ...(facts.benchmark ? [{ value: formatK(facts.benchmark.median), label: 'median posted pay' }] : []),
        ]}
        description={`Independent contractor ${brand.niche.short} roles, with the schedule, setting and gross rate named in each listing.`}
        ctaLabel="Browse jobs"
        ctaHref="/jobs?category=1099"
        secondaryCtaLabel="Set alert"
        secondaryCtaHref="/job-alerts"
      />

      {/* ═══ JOB LISTINGS ═══ */}
      <div style={{ maxWidth: '1440px', margin: '0 auto', padding: '32px 24px' }}>
        <div className="grid lg:grid-cols-4 gap-8">
          <div className="lg:col-span-3">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-lora" style={{ fontSize: '20px', fontWeight: 700, color: '#1A2E35' }}>1099 Positions ({facts.total})</h2>
              <Link href="/jobs" className="text-sm font-medium hover:opacity-80 transition-opacity" style={{ color: 'var(--color-primary)' }}>View All Jobs →</Link>
            </div>
            {jobs.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
                {jobs.map((job: Job, i: number) => (<JobCard key={job.id} job={job} listName={LIST_NAME} listIndex={skip + i} />))}
              </div>
            )}

            {/* LAND-L7 low inventory: the counted intro, then the related
                categories that clear the index floor with their live counts. */}
            {isLowInventory && (
              <div style={{ ...clayCard, padding: '32px 28px', marginTop: facts.total > 0 ? '24px' : 0 }}>
                <p style={{ ...clayDesc, fontSize: '15px', margin: 0 }}>
                  {lowInventoryLinks.length > 0
                    ? lowInventoryIntro
                    : lowInventoryIntro.split(' These related categories')[0]}
                </p>
                {lowInventoryLinks.length > 0 ? (
                  <ul className="pseo-clay-list" style={clayList}>
                    {lowInventoryLinks.map((card, i) => (
                      <li key={card.href} style={clayRow(i === lowInventoryLinks.length - 1)}>
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
            )}

            {jobs.length > 0 && (
              <div style={{ textAlign: 'center', marginTop: '32px' }}>
                <Link href="/jobs?category=1099" className="cat-cta-primary" style={{ padding: '14px 32px', borderRadius: '14px', fontWeight: 700, fontSize: '14px', background: '#BE185D', color: '#fff', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '8px', boxShadow: '4px 4px 12px rgba(190,24,93,0.2)' }}>
                  Browse All 1099 Jobs <ArrowRight size={16} />
                </Link>
              </div>
            )}
          </div>

          {/* Sidebar: the page's ONE alert CTA (T0-5). Alert cadence:
              /api/cron/send-alerts runs in the daily group
              (config/cron-schedule.ts), so "daily" is true here. */}
          <div className="lg:col-span-1">
            <div className="cat-bento-card" style={{ ...clayCard, padding: '0', overflow: 'hidden', background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)', border: '2px solid rgba(190,24,93,0.15)' }}>
              <div style={{ padding: '24px' }}>
                <Bell size={28} style={{ color: '#BE185D', marginBottom: '12px' }} />
                <h3 className="font-lora" style={{ fontSize: '18px', fontWeight: 700, color: '#831843', margin: '0 0 8px' }}>1099 Alerts</h3>
                <p style={{ fontSize: '13px', color: '#BE185D', marginBottom: '16px', lineHeight: 1.6, fontWeight: 500 }}>New {MID} listings delivered to your inbox daily.</p>
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
        <Band id={`snapshot-${SLUG}`} eyebrow="Market Snapshot" title={`What current ${NOUN} listings show`} background="#FDFBF7">
          <MarketSnapshot slug={SLUG} label={MID} scope="nationwide" facts={facts} />
        </Band>
      )}

      {/* LAND-L2 WHERE THE LISTINGS ARE + LAND-L3 PRACTICE ENVIRONMENT. */}
      {locationCards > 0 && (
        <Band id={`locations-${SLUG}`} eyebrow="Locations" title={`Where ${NOUN} listings are`} background={PEACH_STAGE}>
          <div className={locationCards > 1 ? 'pseo-clay-grid pseo-clay-cols-2' : 'pseo-clay-grid'}>
            <LocationSpread variant={{ kind: 'landing' }} places={places} title="States with current listings" index={1} />
            {practiceSentence && (
              <ClayCard chip="Practice authority" index={2} icon={ShieldCheck} title="Practice environment of current listings" desc={practiceSentence}>
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
            )}
          </div>
        </Band>
      )}

      {/* ═══ BENTO: Why Choose 1099 ═══ */}
      <div style={{ background: 'linear-gradient(180deg, #FDF2F8 0%, #FDF2F8 50%, #FDF2F8 100%)' }}>
        <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '48px 20px 40px' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#E86C2C', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>Why Choose 1099</p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(26px, 3.5vw, 38px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '8px' }}>Built for Independence</h2>
          <p style={{ fontSize: '15px', color: '#5A4A42', textAlign: 'center', maxWidth: '480px', margin: '0 auto 48px', lineHeight: 1.6 }}>Independent contracting trades employer benefits for schedule control and a gross rate you manage yourself.</p>

          <div className="cat-bento-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '14px' }}>
            {/* ROW 1: Gross rate (8) + Tax treatment (4) */}
            <div className="cat-bento-hero-1 cat-bento-card" style={{ ...clayCard, gridColumn: 'span 8', padding: '0', overflow: 'hidden', display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
              <div style={{ padding: '32px 28px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <h3 style={{ fontSize: '20px', fontWeight: 800, color: '#1A2E35', margin: '0 0 8px' }}>A Gross Rate You Manage</h3>
                <p style={{ fontSize: '14px', color: '#5A4A42', margin: 0, lineHeight: 1.6 }}>A 1099 contract carries no employer payroll tax, no employer-funded benefits and no employer malpractice cover. What the rate is worth to you depends on what you fund yourself, so model it before you sign.</p>
              </div>
              <ImmersiveImage src="/images/categories/bento/contract-flexibility.webp" alt={`1099 ${brand.niche.short} independent workspace`} minHeight={240} />
            </div>

            <div className="cat-bento-hero-2 cat-bento-card" style={{ ...clayCard, gridColumn: 'span 4', padding: '0', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <ImmersiveImage src="/images/categories/bento/locum-pay.webp" alt="1099 tax planning" minHeight={200} />
              <div style={{ padding: '24px 22px', flex: 1 }}>
                <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#1A2E35', margin: '0 0 6px' }}>Tax Treatment</h3>
                <p style={{ fontSize: '12.5px', color: '#7A6A62', margin: 0, lineHeight: 1.5 }}>
                  Deduct qualifying business expenses and contribute to a retirement plan of your own. The IRS sets the rules and the limits, so confirm them for the current tax year.
                </p>
              </div>
            </div>

            {/* ROW 2: 4 compact cards (3 cols each) */}
            <div className="cat-bento-card" style={{ ...clayCard, gridColumn: 'span 3', padding: '24px 18px', textAlign: 'center' }}>
              <Image src="/images/categories/icons/1099-schedule.webp" alt="" width={48} height={48} style={{ width: '48px', height: '48px', objectFit: 'contain', margin: '0 auto 14px', display: 'block' }} />
              <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}>Schedule Control</h3>
              <p style={{ fontSize: '12px', color: '#7A6A62', margin: 0, lineHeight: 1.55 }}>Set your own hours, work with more than one client, and control your patient volume.</p>
            </div>
            <div className="cat-bento-card" style={{ ...clayCard, gridColumn: 'span 3', padding: '24px 18px', textAlign: 'center' }}>
              <Image src="/images/categories/icons/1099-autonomy.webp" alt="" width={48} height={48} style={{ width: '48px', height: '48px', objectFit: 'contain', margin: '0 auto 14px', display: 'block' }} />
              <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}>Clinical Autonomy</h3>
              <p style={{ fontSize: '12px', color: '#7A6A62', margin: 0, lineHeight: 1.55 }}>Choose your clinical focus, treatment approach, and patient population.</p>
            </div>
            <div className="cat-bento-card" style={{ ...clayCard, gridColumn: 'span 3', padding: '24px 18px', textAlign: 'center' }}>
              <Image src="/images/categories/icons/1099-multi.webp" alt="" width={48} height={48} style={{ width: '48px', height: '48px', objectFit: 'contain', margin: '0 auto 14px', display: 'block' }} />
              <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}>Multi-Client</h3>
              <p style={{ fontSize: '12px', color: '#7A6A62', margin: 0, lineHeight: 1.55 }}>Contract with several practices at once to diversify your income streams.</p>
            </div>
            <div className="cat-bento-card" style={{ ...clayCard, gridColumn: 'span 3', padding: '24px 18px', textAlign: 'center' }}>
              <Image src="/images/categories/icons/1099-llc.webp" alt="" width={48} height={48} style={{ width: '48px', height: '48px', objectFit: 'contain', margin: '0 auto 14px', display: 'block' }} />
              <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}>LLC Protection</h3>
              <p style={{ fontSize: '12px', color: '#7A6A62', margin: 0, lineHeight: 1.55 }}>Operate under an LLC for liability protection and business tax flexibility.</p>
            </div>
          </div>
        </section>
      </div>

      {/* LAND-L4 POSTED PAY: the gated median, which replaced the page's
          salary card and its comparison claim. Nothing prints below the gate
          except the counted sentence with the cited national median. */}
      {paySentence && (
        <Band id={`pay-${SLUG}`} eyebrow="Compensation" title={`What ${NOUN} listings post`} background="#FDFBF7">
          <div className="pseo-clay-split" style={{ gap: '14px', alignItems: 'stretch' }}>
            <PostedPay variant={{ kind: 'category', slug: SLUG }} facts={facts} />
            <div className="pseo-clay-card" style={{ ...clayCard, padding: 0, overflow: 'hidden', display: 'grid' }}>
              <ImmersiveImage src="/images/categories/bento/1099-salary.webp" alt={`1099 ${brand.niche.short} pay illustration`} minHeight={240} />
            </div>
          </div>
        </Band>
      )}

      {/* LAND-L5 HOW TO USE THIS PAGE: the paragraph for this taxonomy axis,
          plus the guide that owns the 1099 versus W-2 tax figures. */}
      {axisGuide && (
        <Band id={`guide-${SLUG}`} eyebrow="Using This Page" title="How to use this page" background={MINT_STAGE}>
          <div
            className="pseo-clay-card"
            style={{ ...clayCard, padding: '28px', display: 'flex', gap: '20px', alignItems: 'flex-start', maxWidth: '860px', margin: '0 auto' }}
          >
            <IconWell icon={BookOpen} />
            <div>
              <p style={{ ...clayDesc, fontSize: '15px', lineHeight: 1.75 }}>{axisGuide}</p>
              <p style={{ margin: '12px 0 0', fontSize: '14px' }}>
                <Link href="/resources/1099-vs-w2" style={clayLink}>Compare 1099 and W-2 {brand.niche.short} offers</Link>
              </p>
            </div>
          </div>
        </Band>
      )}

      {/* ═══ BEFORE YOU APPLY ═══ */}
      <div style={{ background: 'linear-gradient(180deg, #FDFBF7 0%, #FFF8F0 50%, #FDFBF7 100%)' }}>
        <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '56px 20px' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#BE185D', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>Before You Apply</p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 34px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '40px' }}>Setting Up as a 1099 {brand.niche.short}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px' }}>
            {[
              { step: '01', title: 'Form an LLC', text: 'Create an LLC or PLLC for liability protection and tax flexibility before you sign your first contract.' },
              { step: '02', title: 'Get Insurance', text: 'Secure individual malpractice insurance and health coverage through the marketplace or a spouse\'s plan.' },
              { step: '03', title: 'Tax Setup', text: 'Obtain an EIN, open a business bank account, and register for quarterly estimated tax payments with the IRS.' },
              { step: '04', title: 'Retirement Plan', text: 'Open a retirement plan of your own, such as a SEP-IRA or a Solo 401(k).' },
            ].map(r => (
              <div key={r.step} className="cat-bento-card" style={{ ...clayCard, padding: '28px 24px', borderTop: '3px solid #BE185D' }}>
                <span style={{ fontSize: '28px', fontWeight: 800, color: '#FCE7F3', display: 'block', marginBottom: '12px', fontFamily: 'var(--font-mono)' }}>{r.step}</span>
                <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#1A2E35', marginBottom: '8px' }}>{r.title}</h3>
                <p style={{ fontSize: '13px', color: '#5A4A42', lineHeight: 1.6, margin: 0 }}>{r.text}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* ═══ EXPLORE MORE (LAND-L6): the same cards, now with live counts ═══ */}
      <div style={{ background: 'linear-gradient(180deg, #FDF2F8 0%, #FDF2F8 50%, #FDF2F8 100%)' }}>
        <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '56px 20px' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#E86C2C', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>Keep Exploring</p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 34px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '40px' }}>More Ways to Find Your Next Role</h2>
          <div className="cat-explore-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
            {EXPLORE_CARDS.map(c => {
              const count = c.slug ? relatedCounts.get(c.slug) : undefined;
              return (
                <Link key={c.href} href={c.href} className="cat-bento-card" style={{ ...clayCard, padding: '24px 20px', textDecoration: 'none', display: 'block', textAlign: 'center' }}>
                  <Image src={c.icon} alt="" width={48} height={48} style={{ width: '48px', height: '48px', objectFit: 'contain', margin: '0 auto 12px', display: 'block' }} />
                  <span style={{ fontSize: '15px', fontWeight: 700, color: '#1A2E35', display: 'block', marginBottom: '4px' }}>{c.label}</span>
                  <span style={{ fontSize: '12px', color: '#7A6A62', display: 'block' }}>{c.sub}</span>
                  {count !== undefined && count >= 1 && (
                    <span style={{ fontSize: '12px', fontWeight: 700, color: '#BE185D', display: 'block', marginTop: '6px' }}>{buildRelatedCategorySub(count)}</span>
                  )}
                </Link>
              );
            })}
          </div>
        </section>
      </div>

      {/* By Location: pseoStats-gated internal links */}
      <CategoryLocationsExplore categorySlug="1099" categoryLabel="1099" />

      {/* ═══ FAQ: one array feeds the visible answers and the FAQPage JSON-LD ═══ */}
      <div style={{ background: 'linear-gradient(180deg, #FDFBF7 0%, #FFF8F0 50%, #FDFBF7 100%)' }}>
        <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '56px 20px' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#BE185D', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>FAQ</p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 34px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '40px' }}>1099 {brand.niche.short} Questions</h2>
          <div style={{ display: 'grid', gap: '16px' }}>
            {icFaqs.map((faq, idx) => (
              <div key={idx} className="cat-bento-card" style={{ ...clayCard, padding: '28px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#1A2E35', margin: '0 0 10px' }}>{faq.question}</h3>
                <p className="faq-answer" style={{ fontSize: '14px', color: '#5A4A42', lineHeight: 1.7, margin: 0 }}>{faq.answer}</p>
              </div>
            ))}
          </div>
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: icFaqs.map(f => ({ '@type': 'Question', name: f.question, acceptedAnswer: { '@type': 'Answer', text: f.answer } })) }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e') }} />
        </section>
      </div>

      {/* ═══ Responsive + Hover CSS ═══ */}
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
