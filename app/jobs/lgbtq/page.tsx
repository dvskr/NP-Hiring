import { brand } from '@/config/brand';
import { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import ImmersiveImage from '@/components/ImmersiveImage';
import { ArrowRight, Bell, BookOpen, ShieldCheck } from 'lucide-react';
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
import CategoryHero, { crumbsFromSchema } from '@/components/CategoryHero';
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

const clayCard: React.CSSProperties = { background: '#FFFFFF', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.5)', boxShadow: '6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02)' };

/** Band grounds for the data bands; adjacent bands never share one. */
const MINT_STAGE = 'linear-gradient(180deg, #FDFBF7 0%, #E6FFFA 50%, #FDFBF7 100%)';
const PEACH_STAGE = 'linear-gradient(180deg, #FDFBF7 0%, #FFF3E8 50%, #FDFBF7 100%)';

export const revalidate = 3600;

const SLUG = 'lgbtq';
const LABEL = 'LGBTQ+';
/** Role noun for titles and headings, e.g. "LGBTQ+ NP". */
const NOUN = labelNoun(SLUG, LABEL);
/** Mid-sentence form of the label; the acronym keeps its case. */
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
 * The bucket for a category slug. Slugs without a legacy keyword entry gate
 * on the precomputed categoryTags column, so a sibling count can never
 * degrade to "all published jobs".
 */
function categoryWhere(slug: string): Prisma.JobWhereInput {
  const hasLegacyKeywordFilter =
    (CATEGORY_FILTERS[slug]?.length ?? 0) > 0 || (CATEGORY_EXTRA_OR[slug]?.length ?? 0) > 0;
  return hasLegacyKeywordFilter
    ? buildCategoryWhereClause(slug)
    : buildCategoryWhereClause(slug, { categoryTags: { has: slug } });
}

/** This page's bucket, composed onto the canonical predicate by every reader. */
const LG_FILTER = categoryWhere(SLUG);

/** LAND-T3: the one facts load for this page, React cache()d on the scope key. */
function getFacts() {
  return getListingFacts(`category-landing:${SLUG}`, LG_FILTER);
}

/** Repo JSON-LD serializer: angle brackets escaped so no value can break out. */
const ldJson = (obj: unknown): string =>
  JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

async function getJobs(skip = 0, take = 10) {
  return prisma.job.findMany({ where: canonicalBucketWhere(LG_FILTER), orderBy: BEST_SORT_ORDER_BY, skip, take });
}

/**
 * One array drives the visible FAQ block AND the FAQPage schema. LAND-T15
 * truth pass: the uncited demand-trend claim is gone, and pay reaches
 * the page only through the gated section below.
 */
const faqs = [
  { q: `What is an LGBTQ+ affirming ${brand.niche.short} role?`, a: `LGBTQ+ affirming ${brand.niche.short} positions focus on culturally competent care for queer, transgender, and gender-diverse individuals. These roles involve training in minority stress, sexual and gender-minority health, and the unique health needs of LGBTQ+ communities.` },
  { q: 'What qualifications are needed?', a: 'An active APRN license, national NP certification, and DEA registration, plus training or experience in LGBTQ+ affirming care, gender-affirming treatment protocols, and culturally responsive practice.' },
  { q: `What settings hire LGBTQ+ affirming ${brand.niche.short}s?`, a: 'Community health centers, LGBTQ+ specialty clinics, sexual health and HIV programs, gender health clinics, student health services, telehealth platforms focused on queer communities, and health systems with dedicated LGBTQ+ programs.' },
  { q: `What does a gender-affirming ${brand.niche.short} do?`, a: `Gender-affirming ${brand.niche.short}s provide affirming clinical assessments for gender-diverse patients, support hormone therapy initiation and monitoring where their scope allows, and offer ongoing primary and preventive care within a trans-competent framework.` },
  { q: 'How do employers describe affirming care in a listing?', a: 'Listings vary widely. Some name gender-affirming services, PrEP or HIV care outright; others describe an inclusive patient population without a label. Read the full description, and ask about training, protocols and referral pathways when you interview.' },
];

/**
 * LAND-L6 related destinations. The cards keep the look they had; every
 * destination that is a taxonomy landing gains its live canonical count.
 */
const EXPLORE_CARDS: ReadonlyArray<{ href: string; label: string; sub: string; icon?: string }> = [
  { href: '/jobs/community-health', label: 'Community Health', sub: 'FQHCs and underserved care' },
  { href: '/jobs/outpatient', label: 'Outpatient', sub: 'Clinic-based', icon: '/images/categories/nav/outpatient.webp' },
  { href: '/jobs/telehealth', label: 'Telehealth', sub: 'Virtual care', icon: '/images/categories/nav/telehealth.webp' },
  { href: '/jobs/pediatric', label: 'Pediatric', sub: 'Youth and family care' },
  { href: '/salary-guide', label: 'Salary Guide', sub: 'Posted pay by state', icon: '/images/categories/nav/salary.webp' },
  { href: '/jobs/locations', label: 'By Location', sub: 'Browse every state', icon: '/images/categories/nav/location.webp' },
];

/** Taxonomy slug a card points at, or null for a non-category destination. */
function cardSlug(href: string): string | null {
  const slug = href.startsWith('/jobs/') ? href.slice(6) : '';
  return ALL_CATEGORY_SLUGS.includes(slug) ? slug : null;
}

/** Live canonical counts for the explore cards that point at a landing. */
async function getRelatedCounts(): Promise<Map<string, number>> {
  const slugs = EXPLORE_CARDS.flatMap((card) => { const slug = cardSlug(card.href); return slug ? [slug] : []; });
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

/**
 * LAND-L2 places: the facts' states folded onto canonical names. This slug
 * has no /jobs/lgbtq/{state} sub-route, so every state links to its hub,
 * which renders for any state with a listing.
 */
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

/**
 * Title, description and robots come from lib/pseo/category-metadata.ts.
 * The old title appended its own " | Gender-Affirming Care" on top of the
 * brand suffix the root layout adds, which doubled the separator (B10).
 */
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
      url: `${brand.baseUrl}/jobs/lgbtq`,
      images: [{
        url: `/api/og?type=page&title=${encodeURIComponent(`${NOUN} Jobs`)}&subtitle=${encodeURIComponent(ogSubtitle)}`,
        width: 1200, height: 630, alt: `${NOUN} Jobs`,
      }],
    },
    alternates: { canonical: `${brand.baseUrl}/jobs/lgbtq` },
    robots: categoryLandingRobots(totalJobs, page),
  };
}

interface PageProps { searchParams: Promise<{ page?: string }>; }

export default async function LgbtqPage({ searchParams }: PageProps) {
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
  const payRenders = postedPaySentence({ kind: 'category', slug: SLUG }, facts) !== null;
  const axisGuide = getLandingAxisGuide(SLUG);
  const isLowInventory = facts.total < MIN_JOBS_FOR_INDEX;
  const lowInventoryLinks = EXPLORE_CARDS.flatMap((card) => {
    const slug = cardSlug(card.href);
    const count = slug ? relatedCounts.get(slug) : undefined;
    return count !== undefined && count >= MIN_JOBS_FOR_INDEX ? [{ ...card, count }] : [];
  });
  const lowInventoryIntro = buildLowInventoryIntro({ label: MID, total: facts.total });
  const aanp = STAT_SOURCES.fullPracticeStates;

  const breadcrumbTrail = [
    { name: "Home", url: brand.baseUrl },
    { name: "Jobs", url: `${brand.baseUrl}/jobs` },
    { name: "LGBTQ+", url: `${brand.baseUrl}/jobs/lgbtq` },
  ];

  return (
    <div style={{ backgroundColor: '#FDFBF7' }}>
      <ClayStyles />
      <BreadcrumbSchema items={breadcrumbTrail} />
      <JobListViewTracker jobs={jobs.map((j: Job) => ({ id: j.id, title: j.title, employer: j.employer }))} listName={LIST_NAME} indexOffset={skip} />
      {jobs.length > 0 && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson({ '@context': 'https://schema.org', '@type': 'ItemList', name: `${NOUN} Jobs`, numberOfItems: facts.total, itemListElement: jobs.slice(0, 10).map((job: Job, idx: number) => ({ '@type': 'ListItem', position: idx + 1, name: job.title, url: `${brand.baseUrl}/jobs/${job.slug || job.id}` })) }) }} />
      )}

            {/* HERO */}
      <CategoryHero
        bgColor="#e0c7a9"
        heroImage="/images/categories/heroes/lgbtq.webp"
        heroAlt={`LGBTQ+ affirming ${brand.niche.short} care`}
        badgeText={`${facts.total} live ${pluralize(facts.total, 'role')} · updated today`}
        breadcrumbs={crumbsFromSchema(breadcrumbTrail)}
        indexLabel={`№ ${ALL_CATEGORY_SLUGS.indexOf('lgbtq') + 1} / ${ALL_CATEGORY_SLUGS.length}`}
        headlineLine1="LGBTQ+"
        headlineLine2={brand.niche.short}
        headlineSub="jobs in affirming care."
        stats={[
          { value: `${facts.total}`, label: pluralize(facts.total, 'position') },
          ...(facts.distinctEmployers > 0
            ? [{ value: `${facts.distinctEmployers}`, label: pluralize(facts.distinctEmployers, 'employer') }]
            : []),
          // T0-3: the gated median only. Below the publishing gate the stat is omitted.
          ...(facts.benchmark ? [{ value: formatK(facts.benchmark.median), label: 'median posted pay' }] : []),
        ]}
        description={`Gender-affirming and LGBTQ+-focused ${brand.niche.short} positions with inclusive, culturally competent care.`}
        ctaLabel="Browse LGBTQ+ Jobs"
        ctaHref="/jobs?category=lgbtq"
        secondaryCtaLabel="Set Alert"
        secondaryCtaHref="/job-alerts"
      />

      {/* 2. JOB LISTINGS */}
      <div style={{ maxWidth: '1440px', margin: '0 auto', padding: '32px 24px' }}>
        <div className="grid lg:grid-cols-4 gap-8">
          <div className="lg:col-span-3">
            <h2 className="font-lora mb-6" style={{ fontSize: '20px', fontWeight: 700, color: '#1A2E35' }}>LGBTQ+ Affirming Positions ({facts.total})</h2>
            {jobs.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">{jobs.map((job: Job, i: number) => (<JobCard key={job.id} job={job} listName={LIST_NAME} listIndex={skip + i} />))}</div>
            )}

            {/* LAND-L7 low inventory: the counted intro and the related
                categories that clear the index floor, with live counts.
                Many inclusive employers do not label their roles, so the
                block also points at the unfiltered board. */}
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
                ) : null}
                <p style={{ margin: '16px 0 0', fontSize: '14px', color: '#5A4A42' }}>
                  Many inclusive employers do not label their roles. <Link href="/jobs" style={clayLink}>Browse all {brand.niche.short} jobs</Link> and filter by employer.
                </p>
              </div>
            )}

            {jobs.length > 0 && (
              <div style={{ textAlign: 'center', marginTop: '32px' }}>
                <Link href="/jobs?category=lgbtq" className="cat-cta-primary" style={{ padding: '14px 32px', borderRadius: '14px', fontWeight: 700, fontSize: '14px', background: '#BE185D', color: '#fff', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '8px', boxShadow: '4px 4px 12px rgba(190,24,93,0.2)' }}>Browse All LGBTQ+ Jobs <ArrowRight size={16} /></Link>
              </div>
            )}
          </div>
          {/* Sidebar: the page's ONE alert CTA (T0-5). The employer list moved
              into the market snapshot band below. */}
          <div className="lg:col-span-1">
            <div className="cat-bento-card" style={{ ...clayCard, padding: '24px', background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)', border: '2px solid rgba(190,24,93,0.15)' }}>
              <Bell size={28} style={{ color: '#BE185D', marginBottom: '12px' }} />
              <h3 className="font-lora" style={{ fontSize: '18px', fontWeight: 700, color: '#831843', margin: '0 0 8px' }}>LGBTQ+ Alerts</h3>
              <p style={{ fontSize: '13px', color: '#BE185D', marginBottom: '16px', lineHeight: 1.6, fontWeight: 500 }}>New affirming care listings delivered to your inbox daily.</p>
              <Link href="/job-alerts" className="cat-cta-primary" style={{ display: 'block', textAlign: 'center', padding: '10px 20px', borderRadius: '10px', fontWeight: 700, fontSize: '13px', background: '#BE185D', color: '#fff', textDecoration: 'none' }}>Create Alert</Link>
            </div>
          </div>
        </div>
      </div>

      {/* LAND-L1 MARKET SNAPSHOT */}
      {snapshotRenders && (
        <Band id={`snapshot-${SLUG}`} eyebrow="Market Snapshot" title={`What current ${NOUN} listings show`} background="#FDFBF7">
          <MarketSnapshot slug={SLUG} label={MID} scope="nationwide" facts={facts} />
        </Band>
      )}

      {/* LAND-L2 WHERE THE LISTINGS ARE + LAND-L3 PRACTICE ENVIRONMENT. */}
      {locationCards > 0 && (
        <Band id={`locations-${SLUG}`} eyebrow="Locations" title={`Where ${NOUN} listings are`} background={MINT_STAGE}>
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

      {/* 3. BENTO GRID */}
      <div style={{ background: 'linear-gradient(180deg, #FDF2F8 0%, #FDF2F8 50%, #FDF2F8 100%)' }}>
        <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '48px 20px 40px' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#E86C2C', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>Why Choose LGBTQ+ Care</p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(26px, 3.5vw, 38px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '48px' }}>Affirming Care, Real Impact</h2>
          <div className="cat-bento-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '14px' }}>
            <div className="cat-bento-hero-1" style={{ ...clayCard, gridColumn: 'span 8', padding: '0', overflow: 'hidden', display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
              <div style={{ padding: '32px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}><h3 className="font-lora" style={{ fontSize: '20px', fontWeight: 700, color: '#1A2E35', margin: '0 0 10px' }}>Affirming Care</h3><p style={{ fontSize: '14px', color: '#5A4A42', lineHeight: 1.7, margin: 0 }}>Provide culturally competent care for LGBTQ+ individuals, addressing minority stress, identity-related concerns, and barriers to access.</p></div>
              <ImmersiveImage src="/images/categories/bento/lgbtq-affirm.webp" alt="Affirming counseling" minHeight={240} />
            </div>
            <div className="cat-bento-hero-2" style={{ ...clayCard, gridColumn: 'span 4', padding: '0', overflow: 'hidden', display: 'flex', flexDirection: 'column', textAlign: 'center' }}>
              <ImmersiveImage src="/images/categories/bento/lgbtq-inclusive.webp" alt="Inclusive health center" minHeight={200} />
              <div style={{ padding: '22px 22px 26px', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <h3 className="font-lora" style={{ fontSize: '17px', fontWeight: 700, color: '#1A2E35', margin: '0 0 8px' }}>Inclusive Settings</h3>
                <p style={{ fontSize: '13px', color: '#5A4A42', lineHeight: 1.6, margin: 0 }}>Work in organizations committed to equity, diversity, and inclusion.</p>
              </div>
            </div>
            <div className="cat-bento-card" style={{ ...clayCard, gridColumn: 'span 3', padding: '24px 18px', textAlign: 'center' }}><Image src="/images/categories/icons/lgbtq-affirm.webp" alt="" width={48} height={48} style={{ width: '48px', height: '48px', objectFit: 'contain', margin: '0 auto 14px', display: 'block' }} /><h3 style={{ fontSize: '14px', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}>Affirming Care</h3><p style={{ fontSize: '12px', color: '#7A6A62', margin: 0, lineHeight: 1.55 }}>Culturally competent care for LGBTQ+ communities.</p></div>
            <div className="cat-bento-card" style={{ ...clayCard, gridColumn: 'span 3', padding: '24px 18px', textAlign: 'center' }}><Image src="/images/categories/icons/lgbtq-gender.webp" alt="" width={48} height={48} style={{ width: '48px', height: '48px', objectFit: 'contain', margin: '0 auto 14px', display: 'block' }} /><h3 style={{ fontSize: '14px', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}>Gender Health</h3><p style={{ fontSize: '12px', color: '#7A6A62', margin: 0, lineHeight: 1.55 }}>Support gender-affirming treatment, hormone therapy, and preventive care.</p></div>
            <div className="cat-bento-card" style={{ ...clayCard, gridColumn: 'span 3', padding: '24px 18px', textAlign: 'center' }}><Image src="/images/categories/icons/lgbtq-safe.webp" alt="" width={48} height={48} style={{ width: '48px', height: '48px', objectFit: 'contain', margin: '0 auto 14px', display: 'block' }} /><h3 style={{ fontSize: '14px', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}>Safe Spaces</h3><p style={{ fontSize: '12px', color: '#7A6A62', margin: 0, lineHeight: 1.55 }}>Work in welcoming environments for all identities.</p></div>
            <div className="cat-bento-card" style={{ ...clayCard, gridColumn: 'span 3', padding: '24px 18px', textAlign: 'center' }}><Image src="/images/categories/icons/lgbtq-impact.webp" alt="" width={48} height={48} style={{ width: '48px', height: '48px', objectFit: 'contain', margin: '0 auto 14px', display: 'block' }} /><h3 style={{ fontSize: '14px', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}>Continuity</h3><p style={{ fontSize: '12px', color: '#7A6A62', margin: 0, lineHeight: 1.55 }}>Build long-term relationships with patients who value an affirming provider.</p></div>
          </div>
        </section>
      </div>

      {/* LAND-L4 POSTED PAY: the gated median. The bento cell that
          carried an uncited demand-trend claim is gone with it. */}
      {payRenders && (
        <Band id={`pay-${SLUG}`} eyebrow="Compensation" title={`What ${NOUN} listings post`} background="#FDFBF7">
          <div className="pseo-clay-split" style={{ gap: '14px', alignItems: 'stretch' }}>
            <PostedPay variant={{ kind: 'category', slug: SLUG }} facts={facts} />
            <div className="pseo-clay-card" style={{ ...clayCard, padding: 0, overflow: 'hidden', display: 'grid' }}>
              <ImmersiveImage src="/images/categories/bento/pediatric-salary.webp" alt={`LGBTQ+ affirming ${brand.niche.short} pay illustration`} minHeight={240} />
            </div>
          </div>
        </Band>
      )}

      {/* LAND-L5 HOW TO USE THIS PAGE */}
      {axisGuide && (
        <Band id={`guide-${SLUG}`} eyebrow="Using This Page" title="How to use this page" background={PEACH_STAGE}>
          <div className="pseo-clay-card" style={{ ...clayCard, padding: '28px', display: 'flex', gap: '20px', alignItems: 'flex-start', maxWidth: '860px', margin: '0 auto' }}>
            <IconWell icon={BookOpen} />
            <p style={{ ...clayDesc, fontSize: '15px', lineHeight: 1.75 }}>{axisGuide}</p>
          </div>
        </Band>
      )}

      {/* 4. BEFORE YOU APPLY */}
      <div style={{ background: 'linear-gradient(180deg, #FDFBF7 0%, #FFF8F0 50%, #FDFBF7 100%)' }}>
        <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '56px 20px' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#BE185D', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>Before You Apply</p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 34px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '40px' }}>What You Need</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px' }}>
            {[{ n: '01', t: 'NP Certification', d: 'Active national NP certification in your population focus.' }, { n: '02', t: 'State License', d: 'APRN licensure and prescriptive authority.' }, { n: '03', t: 'DEA Registration', d: 'Required for prescribing controlled substances.' }, { n: '04', t: 'Cultural Competency', d: 'Training in LGBTQ+ affirming care and gender health.' }].map(item => (
              <div key={item.n} className="cat-bento-card" style={{ ...clayCard, padding: '28px 24px', borderTop: '3px solid #BE185D' }}><span style={{ fontSize: '28px', fontWeight: 800, color: '#FCE7F3' }}>{item.n}</span><h3 style={{ fontSize: '15px', fontWeight: 700, color: '#1A2E35', marginTop: '12px', marginBottom: '8px' }}>{item.t}</h3><p style={{ fontSize: '13px', color: '#5A4A42', lineHeight: 1.6, margin: 0 }}>{item.d}</p></div>
            ))}
          </div>
        </section>
      </div>

      {/* 5. EXPLORE (LAND-L6): the same cards, now with live counts */}
      <div style={{ background: 'linear-gradient(180deg, #FDF2F8 0%, #FDF2F8 50%, #FDF2F8 100%)' }}>
        <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '56px 20px' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#E86C2C', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>Keep Exploring</p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 34px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '40px' }}>More Categories</h2>
          <div className="cat-explore-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
            {EXPLORE_CARDS.map(c => {
              const slug = cardSlug(c.href);
              const count = slug ? relatedCounts.get(slug) : undefined;
              return (
                <Link key={c.href} href={c.href} className="cat-bento-card" style={{ ...clayCard, padding: '24px 20px', textDecoration: 'none', textAlign: 'center', display: 'block' }}>
                  {c.icon && <Image src={c.icon} alt="" width={48} height={48} style={{ width: '48px', height: '48px', objectFit: 'contain', margin: '0 auto 12px', display: 'block' }} />}
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

      {/* By Location — pseoStats-gated internal links */}

      <CategoryLocationsExplore categorySlug="lgbtq" categoryLabel="LGBTQ+" />


      {/* 6. FAQ */}
      <div style={{ background: 'linear-gradient(180deg, #FDFBF7 0%, #FFF8F0 50%, #FDFBF7 100%)' }}>
        <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '56px 20px' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#BE185D', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>FAQ</p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 34px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '40px' }}>LGBTQ+ {brand.niche.short} Questions</h2>
          <div style={{ display: 'grid', gap: '16px' }}>{faqs.map((faq, idx) => (<div key={idx} className="cat-bento-card" style={{ ...clayCard, padding: '28px' }}><h3 style={{ fontSize: '16px', fontWeight: 700, color: '#1A2E35', margin: '0 0 10px' }}>{faq.q}</h3><p className="faq-answer" style={{ fontSize: '14px', color: '#5A4A42', lineHeight: 1.7, margin: 0 }}>{faq.a}</p></div>))}</div>
          {/* FAQPage schema from the SAME array the visible block renders. */}
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faqs.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) }) }} />
        </section>
      </div>

      {/* 7. RESPONSIVE CSS */}
      <style>{`
        .cat-cta-primary { transition: transform 0.25s ease, box-shadow 0.25s ease, filter 0.25s ease; }
        .cat-cta-primary:hover { transform: translateY(-3px); box-shadow: 0 10px 32px rgba(190,24,93,0.35) !important; filter: brightness(1.05); }
        .cat-bento-card { transition: transform 0.3s ease, box-shadow 0.3s ease; }
        .cat-bento-card:hover { transform: translateY(-4px); box-shadow: 8px 8px 24px rgba(0,0,0,0.1), -4px -4px 12px rgba(255,255,255,0.9), inset 1px 1px 2px rgba(255,255,255,0.6) !important; }
        .cat-stat-pill { transition: transform 0.2s ease, box-shadow 0.2s ease; }
        .cat-stat-pill:hover { transform: translateY(-2px) scale(1.02); box-shadow: 6px 6px 20px rgba(0,0,0,0.1), -3px -3px 10px rgba(255,255,255,0.9) !important; }
        @media (max-width: 768px) { .cat-hero-grid { grid-template-columns: 1fr !important; } .cat-stats-grid { grid-template-columns: repeat(2, 1fr) !important; } .cat-bento-grid { grid-template-columns: 1fr !important; } .cat-bento-hero-1, .cat-bento-hero-2, .cat-bento-hero-3, .cat-bento-cta { grid-column: span 1 !important; } .cat-bento-hero-1, .cat-bento-hero-3 { grid-template-columns: 1fr !important; } .cat-bento-grid > div { grid-column: span 1 !important; } .cat-explore-grid { grid-template-columns: repeat(2, 1fr) !important; } }
        @media (min-width: 769px) and (max-width: 1024px) { .cat-bento-grid { grid-template-columns: repeat(6, 1fr) !important; } .cat-bento-hero-1, .cat-bento-hero-3 { grid-column: span 6 !important; } .cat-bento-hero-2, .cat-bento-cta { grid-column: span 6 !important; } .cat-bento-grid > div:not(.cat-bento-hero-1):not(.cat-bento-hero-2):not(.cat-bento-hero-3):not(.cat-bento-cta) { grid-column: span 3 !important; } }
        @media (prefers-reduced-motion: reduce) { .cat-cta-primary, .cat-bento-card, .cat-stat-pill { transition: none; } .cat-cta-primary:hover, .cat-bento-card:hover, .cat-stat-pill:hover { transform: none; } }
      `}</style>
    </div>
  );
}
