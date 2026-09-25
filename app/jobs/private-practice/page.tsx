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
import { canonicalBucketWhere } from '@/lib/canonical-counts';
import { pluralize } from '@/lib/display-text';
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

const clayCard: React.CSSProperties = { background: '#FFFFFF', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.5)', boxShadow: '6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02)' };
/** Band grounds for the data bands; adjacent bands never share one. */
const MINT_STAGE = 'linear-gradient(180deg, #FDFBF7 0%, #E6FFFA 50%, #FDFBF7 100%)';
const PEACH_STAGE = 'linear-gradient(180deg, #FDFBF7 0%, #FFF3E8 50%, #FDFBF7 100%)';

export const revalidate = 3600;

const SLUG = 'private-practice';
const LABEL = 'Private Practice';
/** Role noun for titles and band heads, e.g. "Private Practice NP". */
const NOUN = labelNoun(SLUG, LABEL);
/** Mid-sentence label, e.g. "private practice". */
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
const LIST_NAME = 'Private Practice Jobs';

/**
 * Category bucket. Slugs without a legacy keyword entry gate on the
 * precomputed categoryTags column so a sibling count never degrades to
 * "all published jobs" (same rule as lib/pseo/category-landing-template).
 */
function categoryWhere(slug: string): Prisma.JobWhereInput {
  const hasKeywords = (CATEGORY_FILTERS[slug]?.length ?? 0) > 0 || (CATEGORY_EXTRA_OR[slug]?.length ?? 0) > 0;
  return hasKeywords ? buildCategoryWhereClause(slug) : buildCategoryWhereClause(slug, { categoryTags: { has: slug } });
}

const PP_FILTER = categoryWhere(SLUG);

/**
 * The one facts load per request (LAND-T3): getListingFacts composes the
 * canonical predicate and is React cache()d on the scope key, so
 * generateMetadata and the page body share a single set of queries.
 */
function getFacts(): Promise<ListingFacts> {
  return getListingFacts(`category-landing:${SLUG}`, PP_FILTER);
}

async function getJobs(skip = 0, take = 10) {
  return prisma.job.findMany({ where: canonicalBucketWhere(PP_FILTER), orderBy: BEST_SORT_ORDER_BY, skip, take });
}

/** LAND-L6 destinations: this page's own explore cards, unchanged. */
interface ExploreCard { href: string; label: string; sub: string }

const EXPLORE_CARDS: readonly ExploreCard[] = [
  { href: '/jobs/outpatient', label: 'Outpatient', sub: 'Clinic-based' },
  { href: '/jobs/telehealth', label: 'Telehealth', sub: 'Virtual care' },
  { href: '/jobs/1099', label: '1099 / Contract', sub: 'Independent work' },
  { href: '/jobs/remote', label: 'Remote', sub: 'Work from home' },
  { href: '/salary-guide', label: 'Salary Guide', sub: '2026 data' },
  { href: '/jobs/locations', label: 'By Location', sub: '50 states' },
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
 * LAND-L2 places. Private practice has no /jobs/private-practice/[state]
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
function buildFaqs(facts: ListingFacts) {
  const payAnswer = buildPostedPaySentence({ slug: SLUG, facts }) ?? NATIONAL_MEDIAN_SENTENCE;
  return [
    { q: `What types of private practice ${brand.niche.short} roles exist?`, a: 'Private practice roles include solo practice (you own and operate), group practice (you join an established multi-provider office), independent contractor work for a practice, and hybrid roles combining in-person and telehealth care. Each carries a different level of autonomy, risk and administrative load.' },
    { q: `How much do private practice ${brand.niche.short}s earn?`, a: payAnswer },
    { q: 'Do I need business experience for private practice?', a: `Employed and group practice roles focus on clinical work. Running your own practice adds billing, credentialing, marketing and operations, so read what each listing expects of you before you apply, and ask which of those the practice already handles.` },
    { q: 'What is needed to start a private practice?', a: 'You need an active APRN license, national NP certification, the practice arrangement your state requires (full practice authority or a collaborating physician agreement), DEA registration, an NPI number, malpractice coverage, an electronic health record, a place to see patients or a telehealth platform, and credentialing with the payers you plan to bill.' },
    { q: 'Is group practice or solo practice better?', a: 'Group practice brings referrals, shared overhead and administrative support. Solo practice gives you control of the schedule, the patient panel and the clinical approach, and puts the business risk on you. Which fits depends on the support you want and the risk you are willing to carry.' },
  ];
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const [facts, params] = await Promise.all([getFacts(), searchParams]);
  const page = Math.max(1, parseInt(params.page || '1', 10) || 1);
  const totalJobs = facts.total;
  return {
    title: buildCategoryLandingTitle({ role: NOUN, totalJobs, tagline: 'Solo and Group Roles' }),
    description: buildCategoryLandingDescription({
      role: NOUN,
      totalJobs,
      employerCount: facts.distinctEmployers,
      stateCount: canonicalStates(facts.states).length,
      medianK: facts.benchmark ? Math.round(facts.benchmark.median / 1000) : null,
    }),
    alternates: { canonical: `${brand.baseUrl}/jobs/private-practice` },
    // thin-spec-1 8.3 / PLAN C.2: index page 1 only at MIN_JOBS_FOR_INDEX or
    // more canonical jobs, through the same gate the sitemap reads. Every
    // other view keeps its canonical and stays follow.
    ...(!shouldIndexListingPage(totalJobs, page) && { robots: { index: false, follow: true } }),
  };
}

interface PageProps { searchParams: Promise<{ page?: string }>; }

export default async function PrivatePracticePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const skip = (Math.max(1, parseInt(params.page || '1', 10) || 1) - 1) * 10;
  const [facts, exploreCounts] = await Promise.all([getFacts(), getExploreCounts()]);
  const jobs = facts.total > 0 ? await getJobs(skip, 10) : [];

  const faqs = buildFaqs(facts);
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
    <div style={{ backgroundColor: '#FDFBF7' }}>
      <ClayStyles />
      <BreadcrumbSchema items={[{ name: "Home", url: brand.baseUrl }, { name: "Jobs", url: `${brand.baseUrl}/jobs` }, { name: "Private Practice", url: `${brand.baseUrl}/jobs/private-practice` }]} />
      <JobListViewTracker jobs={jobs.map((j: Job) => ({ id: j.id, title: j.title, employer: j.employer }))} listName={LIST_NAME} indexOffset={skip} />
      {jobs.length > 0 && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({ '@context': 'https://schema.org', '@type': 'ItemList', name: `Private Practice ${brand.niche.short} Jobs`, numberOfItems: facts.total, itemListElement: jobs.slice(0, 10).map((job: Job, idx: number) => ({ '@type': 'ListItem', position: idx + 1, name: job.title, url: `${brand.baseUrl}/jobs/${job.slug || job.id}` })) }) }} />
      )}

            {/* HERO */}
      <CategoryHero
        bgColor="#d4b0a3"
        heroImage="/images/categories/heroes/private-practice.webp"
        heroAlt={`Private practice ${brand.niche.short} office`}
        badgeText={facts.total > 0 ? buildLiveRolesBadge(facts.total) : `${brand.niche.long} Careers`}
        breadcrumbs={crumbsFromSchema([{ name: "Home", url: brand.baseUrl }, { name: "Jobs", url: `${brand.baseUrl}/jobs` }, { name: "Private Practice", url: `${brand.baseUrl}/jobs/private-practice` }])}
        indexLabel={`№ ${ALL_CATEGORY_SLUGS.indexOf('private-practice') + 1} / ${ALL_CATEGORY_SLUGS.length}`}
        headlineLine1="Private Practice"
        headlineLine2={brand.niche.short}
        headlineSub="jobs to own your practice."
        stats={[
          { value: `${facts.total}`, label: pluralize(facts.total, 'position') },
          ...(facts.distinctEmployers > 0 ? [{ value: `${facts.distinctEmployers}`, label: pluralize(facts.distinctEmployers, 'employer') }] : []),
          // The gated median only: below the publishing gate the stat is omitted.
          ...(facts.benchmark ? [{ value: formatK(facts.benchmark.median), label: 'median posted pay' }] : []),
        ]}
        description="Solo, group and independent contractor roles with clinical autonomy."
        ctaLabel="Browse Private Practice Jobs"
        ctaHref="/jobs?category=private-practice"
        secondaryCtaLabel="Set Alert"
        secondaryCtaHref="/job-alerts"
      />

      {/* 2. JOB LISTINGS */}
      <div style={{ maxWidth: '1440px', margin: '0 auto', padding: '32px 24px' }}>
        <div className="grid lg:grid-cols-4 gap-8">
          <div className="lg:col-span-3">
            <h2 className="font-lora mb-6" style={{ fontSize: '20px', fontWeight: 700, color: '#1A2E35' }}>Private Practice Positions ({facts.total})</h2>
            {jobs.length > 0 && (<div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">{jobs.map((job: Job, i: number) => (<JobCard key={job.id} job={job} listName={LIST_NAME} listIndex={skip + i} />))}</div>)}
            {isLowInventory && (<LowInventoryBlock total={facts.total} counts={exploreCounts} />)}
            {jobs.length > 0 && (<div style={{ textAlign: 'center', marginTop: '32px' }}><Link href="/jobs?category=private-practice" className="cat-cta-primary" style={{ padding: '14px 32px', borderRadius: '14px', fontWeight: 700, fontSize: '14px', background: '#BE185D', color: '#fff', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '8px', boxShadow: '4px 4px 12px rgba(190,24,93,0.2)' }}>Browse All Private Practice Jobs <ArrowRight size={16} /></Link></div>)}
          </div>
          <div className="lg:col-span-1">
            {/* The page's one alert CTA. Alert cadence: /api/cron/send-alerts
                runs in the daily group (config/cron-schedule.ts). */}
            <div style={{ ...clayCard, padding: '24px', background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)', border: '2px solid rgba(190,24,93,0.15)' }}><Bell size={28} style={{ color: '#BE185D', marginBottom: '12px' }} /><h3 className="font-lora" style={{ fontSize: '18px', fontWeight: 700, color: '#831843', margin: '0 0 8px' }}>Practice Alerts</h3><p style={{ fontSize: '13px', color: '#BE185D', marginBottom: '16px' }}>New private practice roles delivered daily.</p><Link href="/job-alerts" style={{ display: 'block', textAlign: 'center', padding: '10px 20px', borderRadius: '10px', fontWeight: 700, fontSize: '13px', background: '#BE185D', color: '#fff', textDecoration: 'none' }}>Create Alert</Link></div>
          </div>
        </div>
      </div>

      {/* LAND-L1 MARKET SNAPSHOT: who is hiring (the former sidebar employer
          list, now with the sentence and company links), how the roles are
          set up, and how current the listings are. */}
      {snapshotRenders && (
        <Band id="snapshot-private-practice" eyebrow="Market Snapshot" title={`What current ${NOUN} listings show`} background="#FDFBF7">
          <MarketSnapshot slug={SLUG} label={MID} scope="nationwide" facts={facts} />
        </Band>
      )}

      {/* LAND-L2 WHERE THE LISTINGS ARE + LAND-L3 PRACTICE ENVIRONMENT. */}
      {locationCards > 0 && (
        <Band id="locations-private-practice" eyebrow="Locations" title={`Where ${NOUN} listings are`} background={MINT_STAGE}>
          <div className={locationCards > 1 ? 'pseo-clay-grid pseo-clay-cols-2' : 'pseo-clay-grid'}>
            <LocationSpread variant={{ kind: 'landing' }} places={places} title="States with current listings" index={1} />
            {practiceSentence && <PracticeEnvironmentCard sentence={practiceSentence} />}
          </div>
        </Band>
      )}

      {/* 3. BENTO GRID */}
      <div style={{ background: 'linear-gradient(180deg, #FDF2F8 0%, #FDF2F8 50%, #FDF2F8 100%)' }}>
        <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '48px 20px 40px' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#E86C2C', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>Why Choose Private Practice</p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(26px, 3.5vw, 38px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '48px' }}>Build Your Own Practice</h2>
          <div className="cat-bento-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '14px' }}>
            <div className="cat-bento-hero-1" style={{ ...clayCard, gridColumn: 'span 8', padding: '0', overflow: 'hidden', display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
              <div style={{ padding: '32px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}><h3 className="font-lora" style={{ fontSize: '20px', fontWeight: 700, color: '#1A2E35', margin: '0 0 10px' }}>Your Own Practice</h3><p style={{ fontSize: '14px', color: '#5A4A42', lineHeight: 1.7, margin: 0 }}>Set your own schedule, clinical approach, and rates. Build lasting relationships with a patient panel you choose.</p></div>
              <ImmersiveImage src="/images/categories/bento/private-practice-office.webp" alt="Private practice office" minHeight={240} />
            </div>
            <div className="cat-bento-hero-2" style={{ ...clayCard, gridColumn: 'span 4', padding: '0', overflow: 'hidden', display: 'flex', flexDirection: 'column', textAlign: 'center' }}>
              <ImmersiveImage src="/images/categories/bento/private-practice-group.webp" alt="Group practice" minHeight={200} />
              <div style={{ padding: '22px 22px 26px', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <h3 className="font-lora" style={{ fontSize: '17px', fontWeight: 700, color: '#1A2E35', margin: '0 0 8px' }}>Group Practice</h3>
                <p style={{ fontSize: '13px', color: '#5A4A42', lineHeight: 1.6, margin: 0 }}>Join established groups with built-in referral networks.</p>
              </div>
            </div>
            <div className="cat-bento-card" style={{ ...clayCard, gridColumn: 'span 3', padding: '24px 18px', textAlign: 'center' }}><Image src="/images/categories/icons/private-practice-autonomy.webp" alt="" width={48} height={48} style={{ width: '48px', height: '48px', objectFit: 'contain', margin: '0 auto 14px', display: 'block' }} /><h3 style={{ fontSize: '14px', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}>Autonomy</h3><p style={{ fontSize: '12px', color: '#7A6A62', margin: 0, lineHeight: 1.55 }}>Set your schedule, rates, and clinical approach.</p></div>
            <div className="cat-bento-card" style={{ ...clayCard, gridColumn: 'span 3', padding: '24px 18px', textAlign: 'center' }}><Image src="/images/categories/icons/private-practice-earning.webp" alt="" width={48} height={48} style={{ width: '48px', height: '48px', objectFit: 'contain', margin: '0 auto 14px', display: 'block' }} /><h3 style={{ fontSize: '14px', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}>Your Own Rates</h3><p style={{ fontSize: '12px', color: '#7A6A62', margin: 0, lineHeight: 1.55 }}>Owners set rates and carry the practice overhead themselves.</p></div>
            <div className="cat-bento-card" style={{ ...clayCard, gridColumn: 'span 3', padding: '24px 18px', textAlign: 'center' }}><Image src="/images/categories/icons/private-practice-group.webp" alt="" width={48} height={48} style={{ width: '48px', height: '48px', objectFit: 'contain', margin: '0 auto 14px', display: 'block' }} /><h3 style={{ fontSize: '14px', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}>Group Practice</h3><p style={{ fontSize: '12px', color: '#7A6A62', margin: 0, lineHeight: 1.55 }}>Join groups with referral networks and shared overhead.</p></div>
            <div className="cat-bento-card" style={{ ...clayCard, gridColumn: 'span 3', padding: '24px 18px', textAlign: 'center' }}><Image src="/images/categories/icons/private-practice-hybrid.webp" alt="" width={48} height={48} style={{ width: '48px', height: '48px', objectFit: 'contain', margin: '0 auto 14px', display: 'block' }} /><h3 style={{ fontSize: '14px', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}>Telehealth Hybrid</h3><p style={{ fontSize: '12px', color: '#7A6A62', margin: 0, lineHeight: 1.55 }}>Combine in-person and virtual sessions.</p></div>
          </div>
        </section>
      </div>

      {/* LAND-L4 POSTED PAY: the gated median, or the counted below-gate
          sentence with the BLS cite. Replaces the salary bento cell. */}
      {payRenders && (
        <Band id="pay-private-practice" eyebrow="Compensation" title={`${NOUN} posted pay`} background="#FDFBF7">
          <div className="pseo-clay-split" style={{ gap: '14px', alignItems: 'stretch' }}>
            <PostedPay variant={{ kind: 'category', slug: SLUG }} facts={facts} />
            <div className="pseo-clay-card" style={{ ...clayCard, padding: 0, overflow: 'hidden', display: 'grid' }}>
              <ImmersiveImage src="/images/categories/bento/private-practice-salary.webp" alt="Private practice pay" minHeight={240} />
            </div>
          </div>
        </Band>
      )}

      {/* LAND-L5 HOW TO USE THIS PAGE: one paragraph per taxonomy axis. */}
      {axisGuide && (
        <Band id="guide-private-practice" eyebrow="Using This Page" title="How to use this page" background={PEACH_STAGE}>
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
            {[{ n: '01', t: 'NP Certification', d: 'Active national NP certification and state APRN licensure.' }, { n: '02', t: 'Practice Authority', d: 'Full practice authority or a collaborating physician agreement, depending on your state.' }, { n: '03', t: 'DEA and NPI', d: 'DEA registration and an NPI number for billing.' }, { n: '04', t: 'Malpractice Cover', d: 'An individual policy for independent practice.' }].map(item => (
              <div key={item.n} className="cat-bento-card" style={{ ...clayCard, padding: '28px 24px', borderTop: '3px solid #BE185D' }}><span style={{ fontSize: '28px', fontWeight: 800, color: '#FCE7F3' }}>{item.n}</span><h3 style={{ fontSize: '15px', fontWeight: 700, color: '#1A2E35', marginTop: '12px', marginBottom: '8px' }}>{item.t}</h3><p style={{ fontSize: '13px', color: '#5A4A42', lineHeight: 1.6, margin: 0 }}>{item.d}</p></div>
            ))}
          </div>
        </section>
      </div>

      {/* 5. EXPLORE (LAND-L6): the page's own cards, each category card
          carrying its live canonical count. */}
      <div style={{ background: 'linear-gradient(180deg, #FDF2F8 0%, #FDF2F8 50%, #FDF2F8 100%)' }}>
        <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '56px 20px' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#E86C2C', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>Keep Exploring</p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 34px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '40px' }}>More Categories</h2>
          <div className="cat-explore-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
            {EXPLORE_CARDS.map(c => {
              const slug = exploreSlug(c.href);
              const count = slug ? exploreCounts.get(slug) : undefined;
              return (
                <Link key={c.href} href={c.href} className="cat-bento-card" style={{ ...clayCard, padding: '24px 20px', textDecoration: 'none', textAlign: 'center' }}>
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

      <CategoryLocationsExplore categorySlug="private-practice" categoryLabel="Private Practice" />


      {/* 6. FAQ */}
      <div style={{ background: 'linear-gradient(180deg, #FDFBF7 0%, #FFF8F0 50%, #FDFBF7 100%)' }}>
        <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '56px 20px' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#BE185D', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>FAQ</p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 34px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '40px' }}>Private Practice {brand.niche.short} Questions</h2>
          <div style={{ display: 'grid', gap: '16px' }}>{faqs.map((faq, idx) => (<div key={idx} className="cat-bento-card" style={{ ...clayCard, padding: '28px' }}><h3 style={{ fontSize: '16px', fontWeight: 700, color: '#1A2E35', margin: '0 0 10px' }}>{faq.q}</h3><p className="faq-answer" style={{ fontSize: '14px', color: '#5A4A42', lineHeight: 1.7, margin: 0 }}>{faq.a}</p></div>))}</div>
          {faqs.length >= 2 && (
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faqs.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) }) }} />
          )}
        </section>
      </div>

      <style>{`
        .cat-cta-primary { transition: transform 0.25s ease, box-shadow 0.25s ease, filter 0.25s ease; }
        .cat-cta-primary:hover { transform: translateY(-3px); box-shadow: 0 10px 32px rgba(190,24,93,0.35) !important; filter: brightness(1.05); }
        .cat-bento-card { transition: transform 0.3s ease, box-shadow 0.3s ease; }
        .cat-bento-card:hover { transform: translateY(-4px); box-shadow: 8px 8px 24px rgba(0,0,0,0.1), -4px -4px 12px rgba(255,255,255,0.9), inset 1px 1px 2px rgba(255,255,255,0.6) !important; }
        @media (max-width: 768px) { .cat-hero-grid { grid-template-columns: 1fr !important; } .cat-bento-grid { grid-template-columns: 1fr !important; } .cat-bento-hero-1, .cat-bento-hero-2, .cat-bento-hero-3, .cat-bento-cta { grid-column: span 1 !important; } .cat-bento-hero-1, .cat-bento-hero-3 { grid-template-columns: 1fr !important; } .cat-bento-grid > div { grid-column: span 1 !important; } .cat-explore-grid { grid-template-columns: repeat(2, 1fr) !important; } }
        @media (min-width: 769px) and (max-width: 1024px) { .cat-bento-grid { grid-template-columns: repeat(6, 1fr) !important; } .cat-bento-hero-1, .cat-bento-hero-3 { grid-column: span 6 !important; } .cat-bento-hero-2, .cat-bento-cta { grid-column: span 6 !important; } .cat-bento-grid > div:not(.cat-bento-hero-1):not(.cat-bento-hero-2):not(.cat-bento-hero-3):not(.cat-bento-cta) { grid-column: span 3 !important; } }
        @media (prefers-reduced-motion: reduce) {
          .cat-cta-primary, .cat-bento-card { transition: none; }
          .cat-cta-primary:hover, .cat-bento-card:hover { transform: none; }
        }
      `}</style>
    </div>
  );
}
