import { brand } from '@/config/brand';
import { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { MapPin, Building2, Shield, TrendingUp, Users, Briefcase, ArrowRight, Bell, DollarSign, Video, Stethoscope } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import { BEST_SORT_ORDER_BY } from '@/lib/utils/job-sort';
import {
  getMetroCity,
  getAllMetroSlugs,
  getNearbyQueryCities,
  getNearbyDisplayCities,
  firstSentence,
  costOfLivingSplice,
  METRO_DATA_LAST_REVIEWED,
  type MetroCity,
} from '@/lib/metro-data';
import JobCard from '@/components/JobCard';
import { Job } from '@/lib/types';
import BreadcrumbSchema from '@/components/BreadcrumbSchema';
import CategoryHero from '@/components/CategoryHero';
import CategoryFAQ from '@/components/CategoryFAQ';
import { stateDioramaSrc, stateDioramaBg } from '@/components/StateImage';
import { notFound } from 'next/navigation';

/* Local illustration set (public/images/**).
 *
 * This template used to pull ten distinct images from the retired remote
 * asset bucket — hero_wc_states, three bento illustrations and six clay
 * icons — and every one of them returned HTTP 400, so roughly thirteen
 * <Image> elements were broken on each of the 20 metro pages, the LCP hero
 * included. That is the same purge P0/P1 already applied to the sibling
 * surfaces (see app/jobs/state/[state]/page.tsx and the salary guide); the
 * metro template was missed because it was reviewed as "assets untouched"
 * rather than by resolving the URLs.
 *
 * Do not reintroduce brand.assets.storageBase here. The hero now shows the
 * metro's own state diorama and the icon tiles use lucide glyphs, because no
 * local clay-icon artwork exists. tests/regressions/p2-metro-editorial-depth
 * pins both rules. */
const METRO_HERO_FALLBACK = { src: '/images/job-seekers/clinical-inperson.webp', bg: '#bfd4c2' };
const ART_PRACTICE = '/images/job-seekers/bento-guides.webp';
const ART_SALARY = '/images/job-seekers/bento-salary.webp';
const ART_GROWTH = '/images/employers/bento-analytics.webp';

/* ═══ Design Tokens — V2 Warm Diorama ═══ */
const clayCard: React.CSSProperties = {
  background: '#FFFFFF', borderRadius: '20px',
  border: '1px solid rgba(255,255,255,0.5)',
  boxShadow: '6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02)',
};

export const revalidate = 3600;

interface PageProps {
  params: Promise<{ slug: string }>;
}

/** Only pre-generate the 10 target metro pages */
export async function generateStaticParams() {
  return getAllMetroSlugs().map(slug => ({ slug }));
}

/*
 * Sentence splicing (firstSentence / costOfLivingSplice) lives in
 * lib/metro-data.ts next to the prose it operates on, so the rule about when
 * a leading capital may be lowered is unit-testable against all 20 records
 * rather than only assertable as "the helper exists".
 */

/** Truncate at a word boundary so the teaser never cuts mid-word. */
function truncateOnWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const clipped = text.slice(0, max);
  const lastSpace = clipped.lastIndexOf(' ');
  return `${(lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped).replace(/[,;:\s]+$/, '')}…`;
}

/**
 * Fetch job stats for a metro area.
 *
 * The adjacent-city list lives on the metro record (`nearbyCities`) rather
 * than in a hardcoded per-city branch here, so adding a metro is a data edit.
 * The query still ANDs on stateCode, which is why `nearbyCities` is
 * documented as same-state only — cross-state suburbs can never match.
 *
 * ── B33 LOCKSTEP with app/sitemap.ts ──────────────────────────────────────
 * app/sitemap.ts gates metro URLs on whether this same match finds ≥1 active
 * job, using its own METRO_ADJACENT_CITIES map. That map still carries only
 * the three original hand-coded sets — New York (Brooklyn, Queens, Bronx),
 * Tampa (St. Petersburg, Clearwater), and Dallas (Fort Worth, Plano,
 * Arlington) — while the authoritative list is now MetroCity.nearbyCities,
 * which also covers the 2026-07 metros. The mismatch is conservative: the
 * sitemap can only UNDER-count a metro's inventory and skip advertising it,
 * never advertise an empty page. app/sitemap.ts is owned by the SEO package;
 * the fix there is to derive METRO_ADJACENT_CITIES from METRO_CITIES instead
 * of restating it.
 *
 * ── WHY NEARBY CITIES MATCH EXACTLY AND THE METRO'S OWN NAME DOES NOT ──────
 * `totalJobs` from this query feeds the H1, the <title>, the hero badge and
 * the ItemList `numberOfItems`, so an over-count is a published falsehood
 * rather than a cosmetic bug.
 *
 * Adjacent cities therefore match with `equals`, the same predicate every
 * other city-scoped surface on this board uses (app/jobs/city/[slug],
 * lib/pseo/category-city-template, lib/pseo/city-employers). They used to
 * match with `contains`, which silently swept in unrelated municipalities
 * that merely contain the token: Houston's "Spring" also matched Big Spring,
 * Springtown and Spring Branch TX, and Philadelphia's "Chester" also matched
 * Rochester and Manchester PA — none of them inside either metro.
 *
 * The metro's OWN name keeps `contains` deliberately. There it is the point:
 * it is what folds Miami Beach and North Miami into Miami, and Chicago
 * Heights into Chicago — municipalities that really are in the metro and are
 * not worth enumerating one by one. No metro name on this board is a
 * substring of an unrelated same-state city, so it carries no bleed.
 *
 * The exact-match switch is one-directionally safe: it can only ever remove
 * rows, so the count can under-state inventory but can no longer over-state
 * it. Where a genuinely adjacent municipality is lost as a result (Chester
 * no longer sweeps in West Chester PA), name it in `nearbyCities` — that also
 * makes it visible in the caption, which `contains` never did.
 */
async function getMetroStats(metro: MetroCity) {
  const { city, stateCode } = metro;
  const where = {
    isPublished: true,
    OR: [
      { city: { contains: city, mode: 'insensitive' as const } },
      // Query list, not display list: it carries alternate spellings
      // ("St. Paul" for "Saint Paul") that must never reach visible copy.
      ...getNearbyQueryCities(metro).map((nearby) => ({
        city: { equals: nearby, mode: 'insensitive' as const },
      })),
    ],
    stateCode: { equals: stateCode, mode: 'insensitive' as const },
  };

  const [totalJobs, salaryData, topEmployers, recentJobs] = await Promise.all([
    prisma.job.count({ where }),
    prisma.job.aggregate({
      where: { ...where, normalizedMinSalary: { not: null }, normalizedMaxSalary: { not: null } },
      _avg: { normalizedMinSalary: true, normalizedMaxSalary: true },
    }),
    prisma.job.groupBy({
      by: ['employer'],
      where,
      _count: { employer: true },
      orderBy: { _count: { employer: 'desc' } },
      take: 8,
    }),
    prisma.job.findMany({
      where,
      orderBy: BEST_SORT_ORDER_BY,
      take: 10,
    }),
  ]);

  const avgMin = salaryData._avg.normalizedMinSalary || 0;
  const avgMax = salaryData._avg.normalizedMaxSalary || 0;
  const avgSalary = Math.round((avgMin + avgMax) / 2 / 1000);

  return {
    totalJobs,
    avgSalary,
    topEmployers: topEmployers.map(e => ({ name: e.employer, count: e._count.employer })),
    recentJobs: recentJobs as Job[],
  };
}

/** Also fetch statewide stats for comparison */
async function getStateStats(stateCode: string) {
  const stateJobs = await prisma.job.count({
    where: { isPublished: true, stateCode: { equals: stateCode, mode: 'insensitive' } },
  });
  const stateSalary = await prisma.job.aggregate({
    where: {
      isPublished: true,
      stateCode: { equals: stateCode, mode: 'insensitive' },
      normalizedMinSalary: { not: null },
      normalizedMaxSalary: { not: null },
    },
    _avg: { normalizedMinSalary: true, normalizedMaxSalary: true },
  });
  const avgMin = stateSalary._avg.normalizedMinSalary || 0;
  const avgMax = stateSalary._avg.normalizedMaxSalary || 0;
  return {
    totalJobs: stateJobs,
    avgSalary: Math.round((avgMin + avgMax) / 2 / 1000),
  };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const metro = getMetroCity(slug);
  if (!metro) return { title: 'Not Found' };

  const stats = await getMetroStats(metro);

  // Title trimmed to <60 chars for SERP display. Salary/licensure/employer
  // detail moved to the description; longer "Top Employers (YYYY)" suffix
  // was reliably truncated mid-phrase.
  const title = `${stats.totalJobs > 0 ? `${stats.totalJobs} ` : ''}${brand.niche.short} Jobs in ${metro.city}, ${metro.stateCode} (${new Date().getFullYear()})`;
  // Description capped at ~155 chars to avoid SERP truncation. Full hero
  // copy still renders on the page for users.
  const description = [
    `Find ${brand.niche.short} jobs in ${metro.city}, ${metro.stateCode}.`,
    `${metro.practiceAuthority} practice authority.`,
    stats.avgSalary > 0 ? `Avg salary $${stats.avgSalary}K.` : '',
    `${metro.heroDescription.slice(0, 70).trim()}.`,
  ].filter(Boolean).join(' ').slice(0, 158);

  // P4 (b): the metro card used to come from the general-purpose /api/og
  // `type=page` mode — a title plus a prose subtitle. /api/og/city is the
  // generator built for a place page: identical chrome since P3 #8
  // (app/api/og/og-theme.tsx), plus the open-positions and salary fact tiles
  // that a subtitle string can only approximate.
  //
  // Only params that route actually reads are passed:
  //   • `city`     — headline second line ("in {city}, {ST}").
  //   • `jobs`     — "Open Positions" tile, the live count already in `stats`.
  //   • `salary`   — "Salary Range" tile, omitted when no metro posting
  //                  discloses pay so the card drops the tile rather than
  //                  showing a band this board cannot source.
  //   • `category` — deliberately NOT passed: a metro guide is all-specialty,
  //                  so the generator renders the plain "{niche} Jobs"
  //                  headline with no category chip.
  //   • `shortage` — deliberately NOT passed. That badge is the
  //                  behavioral-health HPSA designation, which P3 kept gated to
  //                  the single category it describes; a category-less metro
  //                  page can never be on topic for it.
  // Practice authority and cost of living stay in the description (and on the
  // page); the card is not the place to compress two regulated claims into a
  // line of unlabelled text.
  const ogParams = new URLSearchParams({
    city: `${metro.city}, ${metro.stateCode}`,
    jobs: String(stats.totalJobs),
    ...(stats.avgSalary > 0 && { salary: `$${stats.avgSalary}K` }),
  });
  const ogImageUrl = `/api/og/city?${ogParams.toString()}`;

  return {
    title,
    description,
    keywords: [
      `${brand.niche.short.toLowerCase()} jobs ${metro.city.toLowerCase()}`,
      `${brand.niche.descriptor} jobs ${metro.city.toLowerCase()}`,
      `${brand.niche.short.toLowerCase()} salary ${metro.city.toLowerCase()}`,
      `${brand.niche.descriptor} jobs ${metro.stateCode.toLowerCase()}`,
    ],
    openGraph: {
      title: `${brand.niche.short} Jobs in ${metro.city}, ${metro.stateCode}`,
      description,
      type: 'website',
      images: [{
        url: ogImageUrl,
        width: 1200, height: 630,
        alt: `${brand.niche.short} Jobs in ${metro.city}, ${metro.stateCode}`,
      }],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${brand.niche.short} Jobs in ${metro.city}, ${metro.stateCode}`,
      description,
      images: [ogImageUrl],
    },
    alternates: {
      canonical: `${brand.baseUrl}/jobs/metro/${slug}`,
    },
  };
}

export default async function MetroLandingPage({ params }: PageProps) {
  const { slug } = await params;
  const metro = getMetroCity(slug);
  if (!metro) notFound();

  const [stats, stateStats] = await Promise.all([
    getMetroStats(metro),
    getStateStats(metro.stateCode),
  ]);

  // Live comparison figures — DB aggregation only, never a stored estimate.
  const nearbyCities = getNearbyDisplayCities(metro);
  const shareOfState = stateStats.totalJobs > 0
    ? Math.round((stats.totalJobs / stateStats.totalJobs) * 100)
    : null;
  const salaryGap = stats.avgSalary > 0 && stateStats.avgSalary > 0
    ? stats.avgSalary - stateStats.avgSalary
    : null;

  // Hero art: the metro's own state diorama, with the artwork's baked
  // backdrop behind it so the panel never frames the illustration in a
  // clashing colour. Every state carrying a metro ships a diorama today; the
  // fallback exists so adding a metro can never blank the LCP element.
  const dioramaSrc = stateDioramaSrc(metro.stateSlug);
  const heroImage = dioramaSrc ?? METRO_HERO_FALLBACK.src;
  const heroBgColor = dioramaSrc ? stateDioramaBg(metro.stateSlug) : METRO_HERO_FALLBACK.bg;

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#FDFBF7' }}>
      {/* Breadcrumb Schema */}
      <BreadcrumbSchema items={[
        { name: "Home", url: brand.baseUrl },
        { name: "Jobs", url: `${brand.baseUrl}/jobs` },
        { name: metro.state, url: `${brand.baseUrl}/jobs/state/${metro.stateSlug}` },
        { name: `${metro.city} ${brand.niche.short} Jobs`, url: `${brand.baseUrl}/jobs/metro/${slug}` },
      ]} />

      {/*
        FAQPage schema is NOT emitted here. <CategoryFAQ customFaqs={metro.faqs} />
        at the bottom of this page already renders a FAQPage node built from the
        exact same array, and a page carrying two FAQPage blocks with identical
        mainEntity is a duplicate-schema warning in Rich Results. One source,
        one node — the visible accordion and the schema stay in lockstep.
      */}
      {/* ItemList schema */}
      {stats.recentJobs.length > 0 && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
          '@context': 'https://schema.org', '@type': 'ItemList',
          name: `${brand.niche.short} Jobs in ${metro.city}, ${metro.stateCode}`,
          numberOfItems: stats.totalJobs,
          itemListElement: stats.recentJobs.slice(0, 6).map((job: Job, idx: number) => ({
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
        badgeText={`${stats.totalJobs} live roles · updated today`}
        breadcrumbs={['Careers', metro.state, metro.city]}
        headlineLine1={metro.city}
        headlineLine2={brand.niche.short}
        headlineSub={`jobs in ${metro.stateCode}, find your fit.`}
        stats={[
          { value: `${stats.totalJobs}`, label: 'positions' },
          // TRUTH RULE: no invented fallback salary. When this metro's live
          // listings carry no posted pay, show the statewide inventory instead
          // of a made-up band.
          stats.avgSalary > 0
            ? { value: `$${stats.avgSalary}k`, label: 'avg posted pay' }
            : { value: `${stateStats.totalJobs}`, label: `${metro.stateCode} openings` },
          { value: metro.practiceAuthority, label: 'practice auth' },
        ]}
        description={metro.heroDescription}
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
              <h2 className="font-lora" style={{ fontSize: '20px', fontWeight: 700, color: '#1A2E35' }}>
                {nearbyCities.length > 0 ? `${metro.city}-area positions` : `${metro.city} positions`} ({stats.totalJobs})
              </h2>
              <Link
                href={`/jobs?location=${encodeURIComponent(metro.city)}`}
                className="text-sm font-medium hover:opacity-80 transition-opacity"
                style={{ color: '#BE185D' }}
              >
                View All Jobs →
              </Link>
            </div>
            {/* Truth note: the count folds in the metro's adjacent cities, so
                say so rather than letting the number read as city-limits only. */}
            <p style={{ fontSize: '12px', color: '#A09080', margin: '0 0 20px', lineHeight: 1.5 }}>
              {nearbyCities.length > 0
                ? `Counts ${metro.city} plus nearby ${nearbyCities.slice(0, 4).join(', ')}. Browsing by location filters to ${metro.city} itself.`
                : `Live ${metro.city} listings, refreshed hourly.`}
            </p>

            {stats.recentJobs.length === 0 ? (
              <div className="text-center py-12 rounded-xl" style={{ ...clayCard, padding: '48px 24px' }}>
                <Briefcase className="h-12 w-12 mx-auto mb-4" style={{ color: '#A09080' }} />
                <h3 className="text-lg font-semibold mb-2" style={{ color: '#1A2E35' }}>
                  No positions at this time
                </h3>
                <p className="mb-6" style={{ color: '#5A4A42' }}>
                  New {metro.city} {brand.niche.short} openings are added daily. Set an alert or check back soon.</p>
                <Link
                  href="/jobs"
                  className="metro-cta"
                  style={{ padding: '12px 24px', borderRadius: '12px', fontWeight: 700, fontSize: '14px', background: '#BE185D', color: '#fff', textDecoration: 'none', display: 'inline-block' }}
                >
                  Browse All Jobs
                </Link>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
                  {stats.recentJobs.map((job: Job) => (
                    <JobCard key={job.id} job={job} />
                  ))}
                </div>

                {/* Browse All CTA */}
                <div style={{ textAlign: 'center', marginTop: '32px' }}>
                  <Link href={`/jobs?location=${encodeURIComponent(metro.city)}`} className="metro-cta" style={{
                    padding: '14px 32px', borderRadius: '14px', fontWeight: 700, fontSize: '14px',
                    background: '#BE185D', color: '#fff', textDecoration: 'none',
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
            {/* Job Alert CTA */}
            <div className="metro-card" style={{ ...clayCard, padding: '24px', background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)', border: '2px solid rgba(190,24,93,0.15)', marginBottom: '20px' }}>
              <Bell size={28} style={{ color: '#BE185D', marginBottom: '12px' }} />
              <h3 className="font-lora" style={{ fontSize: '18px', fontWeight: 700, color: '#831843', margin: '0 0 8px' }}>
                Get {metro.city} Job Alerts
              </h3>
              <p style={{ fontSize: '13px', color: '#BE185D', marginBottom: '16px', lineHeight: 1.6, fontWeight: 500 }}>
                New {metro.city} listings delivered to your inbox daily.
              </p>
              <Link
                href={`/job-alerts?location=${encodeURIComponent(metro.city)}`}
                className="metro-cta" style={{ display: 'block', width: '100%', textAlign: 'center', padding: '10px 20px', borderRadius: '10px', fontWeight: 700, fontSize: '13px', background: '#BE185D', color: '#fff', textDecoration: 'none', boxShadow: '3px 3px 8px rgba(190,24,93,0.15)' }}
              >
                Create Alert
              </Link>
            </div>

            {/* Top Employers */}
            {stats.topEmployers.length > 0 && (
              <div className="metro-card" style={{ ...clayCard, padding: '24px', marginBottom: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                  <Building2 size={20} style={{ color: '#BE185D' }} />
                  <h3 style={{ fontSize: '15px', fontWeight: 800, color: '#1A2E35', margin: 0 }}>Top Employers</h3>
                </div>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {stats.topEmployers.map((employer, i) => (
                    <li key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: i < stats.topEmployers.length - 1 ? '1px solid rgba(0,0,0,0.05)' : 'none' }}>
                      <span style={{ fontSize: '13px', color: '#5A4A42', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{employer.name}</span>
                      <span style={{ fontSize: '12px', fontWeight: 700, color: '#BE185D', marginLeft: '8px', whiteSpace: 'nowrap' }}>
                        {employer.count} {employer.count === 1 ? 'job' : 'jobs'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Salary Insights */}
            {stats.avgSalary > 0 && (
              <div className="metro-card" style={{ ...clayCard, padding: '24px', marginBottom: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                  <TrendingUp size={20} style={{ color: '#34D399' }} />
                  <h3 style={{ fontSize: '15px', fontWeight: 800, color: '#1A2E35', margin: 0 }}>Salary Insights</h3>
                </div>
                <div style={{ fontSize: '32px', fontWeight: 800, color: '#1A2E35', lineHeight: 1 }}>${stats.avgSalary}k</div>
                <div style={{ fontSize: '13px', color: '#7A6A62', marginTop: '4px' }}>Average annual salary</div>
                <p style={{ fontSize: '11px', color: '#A09080', marginTop: '12px' }}>Based on {metro.city} {brand.niche.short} positions with salary data.</p>
              </div>
            )}

            {/* Quick Links */}
            <div className="metro-card" style={{ ...clayCard, padding: '24px', marginBottom: '20px' }}>
              <h3 style={{ fontSize: '15px', fontWeight: 800, color: '#1A2E35', margin: '0 0 16px' }}>Explore More</h3>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {[
                  { href: `/jobs/state/${metro.stateSlug}`, icon: '📍', label: `All ${metro.state} Jobs (${stateStats.totalJobs})` },
                  { href: `/salary-guide/${metro.stateSlug}`, icon: '💰', label: `${metro.state} Salary Guide` },
                  { href: '/jobs/remote', icon: '🏠', label: `Remote ${brand.niche.short} Jobs` },
                  { href: '/jobs/telehealth', icon: '💻', label: 'Telehealth Positions' },
                ].map(link => (
                  <li key={link.href} style={{ padding: '6px 0' }}>
                    <Link href={link.href} style={{ fontSize: '13px', color: '#BE185D', textDecoration: 'none', fontWeight: 500 }}>
                      {link.icon} {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ BENTO GRID — Why Choose This Metro ═══ */}
      <div style={{ background: 'linear-gradient(180deg, #FDF2F8 0%, #FDF2F8 50%, #FDF2F8 100%)' }}>
        <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '48px 20px 40px' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#E86C2C', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>
            Why This Market
          </p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(26px, 3.5vw, 38px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '8px' }}>Why {brand.niche.short}s Choose {metro.city}
          </h2>
          <p style={{ fontSize: '15px', color: '#5A4A42', textAlign: 'center', maxWidth: '480px', margin: '0 auto 48px', lineHeight: 1.6 }}>
            {metro.practiceAuthority} Practice Authority · {metro.avgCostOfLiving} cost of living · {metro.population.split(' ')[0]} population
          </p>

          <div className="metro-bento-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '14px' }}>
            {/* ROW 1: Practice Authority (8) + Cost of Living (4) */}
            <div className="metro-bento-hero-1 metro-card" style={{ ...clayCard, gridColumn: 'span 8', padding: '0', overflow: 'hidden', display: 'grid', gridTemplateColumns: '1fr 1fr', alignItems: 'center' }}>
              <div style={{ padding: '32px 28px' }}>
                <h3 style={{ fontSize: '20px', fontWeight: 800, color: '#1A2E35', margin: '0 0 8px' }}>{metro.practiceAuthority} Practice Authority</h3>
                <p style={{ fontSize: '14px', color: '#5A4A42', margin: 0, lineHeight: 1.6 }}>
                  {truncateOnWord(metro.licensureNote, 165)}
                </p>
              </div>
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)', padding: '16px' }}>
                <Image src={ART_PRACTICE} alt="" width={280} height={280} style={{ width: '100%', maxWidth: '280px', height: 'auto', borderRadius: '12px' }} />
              </div>
            </div>

            <div className="metro-bento-hero-2 metro-card" style={{ ...clayCard, gridColumn: 'span 4', padding: '0', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <div style={{ flex: '0 0 auto', background: 'linear-gradient(145deg, #FFFBEB, #FEF3C7)', padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Image src={ART_GROWTH} alt="" width={280} height={200} style={{ width: '100%', maxWidth: '200px', height: 'auto', borderRadius: '10px' }} />
              </div>
              <div style={{ padding: '24px 22px', flex: 1 }}>
                <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#1A2E35', margin: '0 0 6px' }}>Cost of Living</h3>
                <p style={{ fontSize: '12.5px', color: '#7A6A62', margin: 0, lineHeight: 1.5 }}>
                  {metro.avgCostOfLiving} — {costOfLivingSplice(metro)}.
                </p>
              </div>
            </div>

            {/* ROW 2: the first four `whyThisMetro` bullets.
                The four clay icons that used to sit here were remote-bucket
                URLs returning 400; no local clay-icon artwork exists, so these
                are lucide glyphs on the same rose chip the rest of the page
                uses. They are decorative — the bullet carries the meaning — so
                the glyph is aria-hidden and no alt text is invented for it. */}
            {[
              { Icon: DollarSign, text: metro.whyThisMetro[0] },
              { Icon: Building2, text: metro.whyThisMetro[1] },
              { Icon: Users, text: metro.whyThisMetro[2] },
              { Icon: Video, text: metro.whyThisMetro[3] },
            ].map(({ Icon, text }, i) => (
              <div key={i} className="metro-card" style={{ ...clayCard, gridColumn: 'span 3', padding: '24px 18px', textAlign: 'center' }}>
                <span aria-hidden="true" style={{ width: '48px', height: '48px', borderRadius: '14px', margin: '0 auto 14px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)' }}>
                  <Icon size={22} style={{ color: '#BE185D' }} />
                </span>
                <p style={{ fontSize: '12px', color: '#7A6A62', margin: 0, lineHeight: 1.55 }}>{text}</p>
              </div>
            ))}

            {/* ROW 3: Salary (8) + Alert CTA (4) */}
            <div className="metro-bento-hero-3 metro-card" style={{ ...clayCard, gridColumn: 'span 8', padding: '0', overflow: 'hidden', display: 'grid', gridTemplateColumns: '1fr 1fr', alignItems: 'center' }}>
              <div style={{ padding: '32px 28px' }}>
                <TrendingUp size={28} style={{ color: '#BE185D', marginBottom: '16px' }} />
                <h3 style={{ fontSize: '20px', fontWeight: 800, color: '#1A2E35', margin: '0 0 8px' }}>Salary Outlook</h3>
                <p style={{ fontSize: '14px', color: '#5A4A42', margin: 0, lineHeight: 1.6 }}>
                  {stats.avgSalary > 0
                    ? `${metro.city} ${brand.niche.short} listings with posted pay average $${stats.avgSalary}k`
                    : `${metro.city} ${brand.niche.short} listings do not yet post enough salary data to average`}
                  {' — '}{costOfLivingSplice(metro)}.
                </p>
              </div>
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(145deg, #FFF7ED, #FFEDD5)', padding: '16px' }}>
                <Image src={ART_SALARY} alt="" width={280} height={280} style={{ width: '100%', maxWidth: '280px', height: 'auto', borderRadius: '12px' }} />
              </div>
            </div>

            <div className="metro-bento-cta metro-card" style={{
              ...clayCard, gridColumn: 'span 4', padding: '28px 22px',
              display: 'flex', flexDirection: 'column', justifyContent: 'center',
              background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)', border: '2px solid rgba(190,24,93,0.15)',
            }}>
              <Bell size={28} style={{ color: '#BE185D', marginBottom: '14px' }} />
              <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#831843', margin: '0 0 6px' }}>Job Alerts</h3>
              <p style={{ fontSize: '13px', color: '#BE185D', margin: '0 0 16px', lineHeight: 1.6, fontWeight: 500 }}>
                New {metro.city} listings delivered to your inbox — be first to apply.
              </p>
              <Link href={`/job-alerts?location=${encodeURIComponent(metro.city)}`} className="metro-cta" style={{
                padding: '10px 20px', borderRadius: '10px', fontWeight: 700, fontSize: '13px',
                background: '#BE185D', color: '#fff', textDecoration: 'none',
                display: 'inline-flex', alignItems: 'center', gap: '6px', width: 'fit-content',
                boxShadow: '3px 3px 8px rgba(190,24,93,0.15)',
              }}>
                Create Alert <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </section>
      </div>

      {/* ═══ MARKET STRUCTURE — care demand + sub-markets + live snapshot ═══ */}
      <div style={{ background: 'linear-gradient(180deg, #FDF2F8 0%, #FFFFFF 45%, #FDFBF7 100%)' }}>
        <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '56px 20px 48px' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#BE185D', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '8px' }}>
            Inside the metro
          </p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(26px, 3.5vw, 38px)', fontWeight: 700, color: '#1A2E35', margin: '0 0 32px', maxWidth: '18ch', lineHeight: 1.15 }}>
            How the {metro.city} market is put together
          </h2>

          <div className="grid lg:grid-cols-12 gap-8 lg:gap-10">
            {/* Left rail — who lives here + the live snapshot */}
            <div className="lg:col-span-5">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <Users size={18} style={{ color: '#E86C2C' }} />
                <h3 style={{ fontSize: '15px', fontWeight: 800, color: '#1A2E35', margin: 0 }}>Who you&rsquo;ll be caring for</h3>
              </div>
              <p style={{ fontSize: '15px', color: '#5A4A42', lineHeight: 1.75, margin: '0 0 24px' }}>
                {metro.careDemandContext}
              </p>

              {/* Live snapshot — every figure below is DB aggregation, not an estimate. */}
              <div style={{ background: '#1A2E35', borderRadius: '20px', padding: '26px 24px', boxShadow: '8px 8px 24px rgba(26,46,53,0.18)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '18px' }}>
                  <TrendingUp size={18} style={{ color: '#86c1a8' }} />
                  <h3 style={{ fontSize: '13px', fontWeight: 800, color: '#FFFFFF', margin: 0, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                    Live market snapshot
                  </h3>
                </div>
                <dl style={{ margin: 0, display: 'grid', gap: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '16px' }}>
                    <dt style={{ fontSize: '13px', color: '#B7C7CC' }}>Open {brand.niche.short} roles here</dt>
                    <dd style={{ fontSize: '22px', fontWeight: 800, color: '#FFFFFF', margin: 0, fontFamily: 'var(--font-mono)' }}>{stats.totalJobs}</dd>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '16px', borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: '14px' }}>
                    <dt style={{ fontSize: '13px', color: '#B7C7CC' }}>All {metro.state} roles</dt>
                    <dd style={{ fontSize: '22px', fontWeight: 800, color: '#FFFFFF', margin: 0, fontFamily: 'var(--font-mono)' }}>{stateStats.totalJobs}</dd>
                  </div>
                  {shareOfState !== null && (
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '16px', borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: '14px' }}>
                      <dt style={{ fontSize: '13px', color: '#B7C7CC' }}>Share of the state&rsquo;s listings</dt>
                      <dd style={{ fontSize: '22px', fontWeight: 800, color: '#86c1a8', margin: 0, fontFamily: 'var(--font-mono)' }}>{shareOfState}%</dd>
                    </div>
                  )}
                  {salaryGap !== null && (
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '16px', borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: '14px' }}>
                      <dt style={{ fontSize: '13px', color: '#B7C7CC' }}>Posted pay vs statewide</dt>
                      <dd style={{ fontSize: '22px', fontWeight: 800, color: salaryGap >= 0 ? '#86c1a8' : '#F0B27A', margin: 0, fontFamily: 'var(--font-mono)' }}>
                        {salaryGap >= 0 ? '+' : '−'}${Math.abs(salaryGap)}k
                      </dd>
                    </div>
                  )}
                </dl>
                <p style={{ fontSize: '11px', color: '#8FA3A9', margin: '18px 0 0', lineHeight: 1.6 }}>
                  Counted from live listings on this board and refreshed hourly — not a national survey.
                  {stats.avgSalary > 0 ? ' Pay figures use only listings that post a salary, so they lag the full market.' : ''}
                </p>
              </div>
            </div>

            {/* Right rail — sub-market structure */}
            <div className="lg:col-span-7">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                <MapPin size={18} style={{ color: '#BE185D' }} />
                <h3 style={{ fontSize: '15px', fontWeight: 800, color: '#1A2E35', margin: 0 }}>Where the jobs actually are</h3>
              </div>
              {/* role="list" keeps list semantics in Safari, which drops them
                  when list-style is none. */}
              <ol role="list" style={{ listStyle: 'none', margin: 0, padding: 0, borderLeft: '2px solid rgba(190,24,93,0.18)' }}>
                {metro.subMarkets.map((sub, i) => (
                  <li key={sub.name} style={{ position: 'relative', padding: '0 0 22px 24px' }}>
                    <span aria-hidden="true" style={{
                      position: 'absolute', left: '-9px', top: '2px', width: '16px', height: '16px',
                      borderRadius: '50%', background: '#FFFFFF', border: '2px solid #BE185D',
                      display: 'block',
                    }} />
                    <h4 style={{ fontSize: '15px', fontWeight: 700, color: '#1A2E35', margin: '0 0 5px' }}>
                      <span style={{ color: '#BE185D', fontFamily: 'var(--font-mono)', fontSize: '12px', marginRight: '8px' }}>
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      {sub.name}
                    </h4>
                    <p style={{ fontSize: '13.5px', color: '#5A4A42', lineHeight: 1.7, margin: 0 }}>{sub.note}</p>
                  </li>
                ))}
              </ol>

              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginTop: '4px', padding: '14px 16px', borderRadius: '14px', background: 'rgba(190,24,93,0.05)' }}>
                <Shield size={16} style={{ color: '#BE185D', flexShrink: 0, marginTop: '2px' }} />
                <p style={{ fontSize: '12px', color: '#7A6A62', margin: 0, lineHeight: 1.6 }}>
                  Practice authority follows the state, not the metro — {metro.state} is a{' '}
                  {metro.practiceAuthority === 'Full' ? 'full' : metro.practiceAuthority.toLowerCase()}-practice
                  {' '}jurisdiction on the AANP State Practice Environment map. Editorial for this metro last reviewed {METRO_DATA_LAST_REVIEWED}.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* ═══ GETTING STARTED ═══ */}
      <div style={{ background: 'linear-gradient(180deg, #FDF2F8 0%, #E6FFFA 50%, #FDF2F8 100%)' }}>
        <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '56px 20px' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#BE185D', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>
            Before You Apply
          </p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 34px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '40px' }}>
            Getting Started in {metro.city}
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px' }}>
            {[
              { step: '01', title: 'Licensure', text: `${metro.state} has ${metro.practiceAuthority} Practice Authority. ${firstSentence(metro.licensureNote)}.` },
              { step: '02', title: 'Cost of Living', text: `${metro.city} cost of living is ${metro.avgCostOfLiving}. ${firstSentence(metro.costOfLivingNote)}.` },
              { step: '03', title: 'Top Settings', text: `Popular settings include ${metro.topSettings.slice(0, 3).join(', ')}. Explore all options.` },
              { step: '04', title: 'Apply', text: `Browse ${stats.totalJobs}+ positions in ${metro.city} and set up job alerts to be first to apply.` },
            ].map(r => (
              <div key={r.step} className="metro-card" style={{ ...clayCard, padding: '28px 24px', borderTop: '3px solid #BE185D' }}>
                <span style={{ fontSize: '28px', fontWeight: 800, color: '#FCE7F3', display: 'block', marginBottom: '12px', fontFamily: 'var(--font-mono)' }}>{r.step}</span>
                <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#1A2E35', marginBottom: '8px' }}>{r.title}</h3>
                <p style={{ fontSize: '13px', color: '#5A4A42', lineHeight: 1.6, margin: 0 }}>{r.text}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* ═══ EXPLORE MORE ═══ */}
      <div style={{ background: 'linear-gradient(180deg, #FFF8F0 0%, #FFF3E8 50%, #FFF8F0 100%)' }}>
        <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '56px 20px' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#E86C2C', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>
            Keep Exploring
          </p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 34px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '40px' }}>
            More Ways to Find Your Next Role
          </h2>
          <div className="metro-explore-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
            {/* Same purge as the bento tiles above: six dead clay-icon URLs
                replaced with lucide glyphs. Decorative, so aria-hidden — each
                tile's label and sub-label already name the destination. */}
            {[
              { href: `/jobs/state/${metro.stateSlug}`, label: `${metro.state} Jobs`, sub: `All ${metro.stateCode} positions`, Icon: MapPin },
              { href: '/jobs/remote', label: 'Remote', sub: 'Work from anywhere', Icon: Video },
              { href: '/jobs/new-grad', label: 'New Grad', sub: 'Entry-level roles', Icon: Briefcase },
              { href: '/jobs/telehealth', label: 'Telehealth', sub: 'Virtual patient care', Icon: Stethoscope },
              { href: `/salary-guide/${metro.stateSlug}`, label: 'Salary Guide', sub: `${metro.state} comp data`, Icon: DollarSign },
              { href: '/jobs/locations', label: 'By Location', sub: 'All 50 states', Icon: Building2 },
            ].map(({ href, label, sub, Icon }) => (
              <Link key={href} href={href} className="metro-card" style={{ ...clayCard, padding: '24px 20px', textDecoration: 'none', display: 'block', textAlign: 'center' }}>
                <span aria-hidden="true" style={{ width: '48px', height: '48px', borderRadius: '14px', margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)' }}>
                  <Icon size={22} style={{ color: '#BE185D' }} />
                </span>
                <span style={{ fontSize: '15px', fontWeight: 700, color: '#1A2E35', display: 'block', marginBottom: '4px' }}>{label}</span>
                <span style={{ fontSize: '12px', color: '#7A6A62', display: 'block' }}>{sub}</span>
              </Link>
            ))}
          </div>
        </section>
      </div>

      {/* ═══ FAQ ═══ */}
      <CategoryFAQ category="metro" totalJobs={stats.totalJobs} customFaqs={metro.faqs} />

      {/* ═══ Hover + Responsive CSS ═══ */}
      <style>{`
        .metro-cta { transition: transform 0.25s ease, box-shadow 0.25s ease, filter 0.25s ease; }
        .metro-cta:hover { transform: translateY(-3px); box-shadow: 0 10px 32px rgba(190,24,93,0.35) !important; filter: brightness(1.05); }
        .metro-card { transition: transform 0.3s ease, box-shadow 0.3s ease; }
        .metro-card:hover { transform: translateY(-4px); box-shadow: 8px 8px 24px rgba(0,0,0,0.1), -4px -4px 12px rgba(255,255,255,0.9), inset 1px 1px 2px rgba(255,255,255,0.6) !important; }
        @media (max-width: 768px) {
          .metro-bento-grid { grid-template-columns: 1fr !important; }
          .metro-bento-hero-1, .metro-bento-hero-2, .metro-bento-hero-3, .metro-bento-cta { grid-column: span 1 !important; }
          .metro-bento-hero-1, .metro-bento-hero-3 { grid-template-columns: 1fr !important; }
          .metro-bento-grid > div { grid-column: span 1 !important; }
          .metro-explore-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
        @media (min-width: 769px) and (max-width: 1024px) {
          .metro-bento-grid { grid-template-columns: repeat(6, 1fr) !important; }
          .metro-bento-hero-1, .metro-bento-hero-3 { grid-column: span 6 !important; }
          .metro-bento-hero-2, .metro-bento-cta { grid-column: span 6 !important; }
          .metro-bento-grid > div:not(.metro-bento-hero-1):not(.metro-bento-hero-2):not(.metro-bento-hero-3):not(.metro-bento-cta) { grid-column: span 3 !important; }
        }
      `}</style>
    </div>
  );
}
