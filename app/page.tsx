import { Metadata } from 'next';

import { getSiteStats } from '@/lib/site-stats';
import { brand } from '@/config/brand';
import { STAT_SOURCES } from '@/lib/stats-sources';
import EmployerTrustSection from '@/components/EmployerTrustSection';
import FeaturedJobsSection from '@/components/FeaturedJobsSection';
import TopStatesSection from '@/components/TopStatesSection';
import HomepageHero from '@/components/HomepageHero';
import VideoJsonLd from '@/components/VideoJsonLd';
import HomepageBlogSection from '@/components/HomepageBlogSection';
import EmployerHowItWorks from '@/components/EmployerHowItWorks';
import dynamic from 'next/dynamic';

const STORAGE_BASE = brand.assets.storageBase;

// Below-fold interactive components — defer from critical bundle
const ExitIntentPopup = dynamic(() => import('@/components/ExitIntentPopup'));






// Revalidate every 60 seconds
export const revalidate = 60;

/**
 * Total job count for dynamic metadata. Reads the cached SiteStat snapshot
 * (refreshed hourly by the refresh-site-stats cron) instead of running a live
 * COUNT on every render of the hottest page on the site.
 */
async function getTotalJobCount(): Promise<number> {
  return (await getSiteStats()).totalJobs;
}

/**
 * Unique employer count for dynamic metadata — also from the cached snapshot
 * (avoids a `findMany({ distinct: ['employer'] })` per render).
 */
async function getUniqueEmployerCount(): Promise<number> {
  return (await getSiteStats()).totalCompanies;
}

/**
 * Generate dynamic metadata with job count
 */
export async function generateMetadata(): Promise<Metadata> {
  const [totalJobs, uniqueEmployerCount] = await Promise.all([
    getTotalJobCount(),
    getUniqueEmployerCount(),
  ]);
  const jobCountDisplay = totalJobs > 1000
    ? `${(Math.floor(totalJobs / 100) * 100).toLocaleString()}+`
    : totalJobs.toLocaleString();

  return {
    // SEO Fix #7: trim title to ≤60 chars (Google SERP cap). Previous title
    // ran 77 chars and got truncated mid-phrase, costing CTR.
    title: `${jobCountDisplay} ${brand.niche.short} Jobs — ${brand.niche.long} Job Board`,
    description: `Browse ${jobCountDisplay} ${brand.niche.short} jobs updated daily. Remote, telehealth & in-person ${brand.niche.short} positions with salary transparency. Free for job seekers.`,
    openGraph: {
      title: `${jobCountDisplay} ${brand.niche.short} Jobs - Find Your Next Position`,
      description: `Browse ${jobCountDisplay} ${brand.niche.descriptor} jobs. Remote, hybrid, and in-person positions with salary transparency.`,
      images: [
        {
          url: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/pages/pmhnp-job-board-homepage.webp`,
          width: 1280,
          height: 900,
          alt: `${brand.name} job board homepage showing ${jobCountDisplay} ${brand.niche.descriptor} jobs from ${uniqueEmployerCount}+ companies across 50 states`,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      images: [`${STORAGE_BASE}/storage/v1/object/public/site-assets/images/pages/pmhnp-job-board-homepage.webp`],
    },
    alternates: {
      canonical: brand.baseUrl,
    },
  };
}

export default async function Home() {
  const totalJobs = await getTotalJobCount();
  const jobCountDisplay = totalJobs > 1000
    ? `${Math.floor(totalJobs / 100) * 100}+`
    : totalJobs.toLocaleString();

  return (
    <>
      {/* Structured data — outside content div to prevent hydration mismatch */}
      {/* Note: Organization schema is rendered site-wide in layout.tsx @graph.
          Removed standalone duplicate here to prevent conflicting signals in GSC. */}
      <VideoJsonLd pathname="/" />
      {/* BreadcrumbList schema — homepage */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: 'Home', item: brand.baseUrl },
            ],
          }),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: [
              {
                "@type": "Question",
                name: `What is an ${brand.niche.short}?`,
                acceptedAnswer: {
                  "@type": "Answer",
                  text: `An ${brand.niche.short} (${brand.niche.long}) is an advanced practice registered nurse (APRN) who assesses, diagnoses, and treats patients, prescribes medications including controlled substances, and manages care across the lifespan. They hold a Master's or Doctoral degree in nursing and are nationally board certified in a population focus such as family, adult-gerontology, pediatrics, or women's health.`,
                },
              },
              {
                "@type": "Question",
                name: `How much do ${brand.niche.short}s make?`,
                acceptedAnswer: {
                  // SEO Fix C5/C6: salary range pulled from lib/stats-sources.ts so the
                  // same number lands on homepage, blog FAQ, and About copy. Source +
                  // asOf appended in plain prose for verifiable citation.
                  "@type": "Answer",
                  text: `${brand.niche.short}s earn an average annual salary of ${STAT_SOURCES.averageSalary.range} based on the ${STAT_SOURCES.averageSalary.source} (${STAT_SOURCES.averageSalary.asOf}). Salaries range from ~$120,000 for new graduates to $200,000+ for experienced ${brand.niche.short}s in high-demand areas. Remote and telehealth positions typically pay $130,000–$200,000; private practice ${brand.niche.short}s can earn $200,000+ depending on caseload and overhead.`,
                },
              },
              {
                "@type": "Question",
                name: `What is the ${brand.niche.short} job outlook?`,
                acceptedAnswer: {
                  "@type": "Answer",
                  text: `The ${brand.niche.short} job outlook is strong: ${STAT_SOURCES.blsGrowth2032.source} projects ${STAT_SOURCES.blsGrowth2032.formatted} employment growth for nurse practitioners through 2032 — much faster than average. Roughly ${STAT_SOURCES.hrsaShortagePopulation.formatted} Americans live in federally designated Health Professional Shortage Areas (${STAT_SOURCES.hrsaShortagePopulation.source}, ${STAT_SOURCES.hrsaShortagePopulation.asOf}), so demand for ${brand.niche.short}s continues to expand alongside telehealth access.`,
                },
              },
              {
                "@type": "Question",
                name: `How long does it take to become an ${brand.niche.short}?`,
                acceptedAnswer: {
                  "@type": "Answer",
                  text: `Becoming an ${brand.niche.short} typically takes 6-8 years total: 4 years for a BSN, 1-2 years of RN experience (recommended), and 2-3 years for an MSN or DNP with ${brand.niche.short} specialization. Accelerated BSN-to-DNP programs can shorten this timeline. After graduation, you must pass a national ${brand.niche.short} certification exam (ANCC or AANP).`,
                },
              },
              {
                "@type": "Question",
                name: `Can ${brand.niche.short}s prescribe medication?`,
                acceptedAnswer: {
                  "@type": "Answer",
                  text: `Yes, ${brand.niche.short}s can prescribe medications including controlled substances in all 50 states. In states with full practice authority (34 states plus DC), ${brand.niche.short}s prescribe independently. In reduced or restricted practice states, a collaborative agreement with a physician may be required. What ${brand.niche.short}s prescribe follows their specialty — from antibiotics and antihypertensives to insulin, ADHD medications, and controlled pain medications.`,
                },
              },
              {
                "@type": "Question",
                name: `What is the difference between an ${brand.niche.short} and a physician?`,
                acceptedAnswer: {
                  "@type": "Answer",
                  text: `${brand.niche.short}s hold a Master's or Doctoral degree in nursing (2–4 years of graduate school), while physicians complete medical school plus a 3–7 year residency. Both can diagnose conditions and prescribe medications. In full practice authority states, ${brand.niche.short}s practice independently. ${brand.niche.short}s typically earn ${STAT_SOURCES.averageSalary.range} (${STAT_SOURCES.averageSalary.source}, ${STAT_SOURCES.averageSalary.asOf}) compared to physicians at $220,000+, but ${brand.niche.short}s reach full practice much faster with less educational debt.`,
                },
              },
              {
                "@type": "Question",
                name: `What does a ${brand.niche.descriptor} do on a typical workday?`,
                acceptedAnswer: {
                  "@type": "Answer",
                  text: `A typical ${brand.niche.short} workday includes seeing patients for scheduled evaluations and follow-ups, diagnosing and treating acute and chronic conditions, prescribing and adjusting medications, ordering and reviewing labs and imaging, collaborating with interdisciplinary teams, and documenting in EHR systems. Outpatient ${brand.niche.short}s typically see 15-25 patients per day, while inpatient roles involve rounding on hospitalized patients.`,
                },
              },
              {
                "@type": "Question",
                name: `Are there remote ${brand.niche.short} jobs?`,
                acceptedAnswer: {
                  "@type": "Answer",
                  text: `Yes, remote ${brand.niche.short} jobs are growing rapidly. Remote roles include telehealth patient care, medication management via video, utilization review, and clinical documentation. Salaries for remote ${brand.niche.short}s range from $130,000 to $200,000+, and national telehealth platforms and health systems hire in all 50 states.`,
                },
              },
              {
                "@type": "Question",
                name: `Can ${brand.niche.short}s own a private practice?`,
                acceptedAnswer: {
                  "@type": "Answer",
                  text: `Yes, ${brand.niche.short}s can own a private practice in all 50 states, though the level of independence varies. In the 34 states with Full Practice Authority, ${brand.niche.short}s can practice and prescribe without physician oversight. In restricted states, a collaborative agreement with a physician may be required. Private practice ${brand.niche.short}s can earn $180,000-$300,000+ annually, though they must manage business operations, insurance credentialing, and overhead costs.`,
                },
              },
              {
                "@type": "Question",
                name: `Which states have the highest demand for ${brand.niche.descriptor}s?`,
                acceptedAnswer: {
                  "@type": "Answer",
                  text: `The states with the highest demand for ${brand.niche.short}s in 2026 are California (2,500+ openings), Texas (2,240+), Florida (2,190+), New York (1,640+), and Tennessee (1,570+). Other high-demand states include Ohio, North Carolina, Georgia, Arizona, and Illinois. Full Practice Authority states generally have more job openings due to fewer practice restrictions.`,
                },
              },
              {
                "@type": "Question",
                name: `What are the most in-demand ${brand.niche.short} specializations?`,
                acceptedAnswer: {
                  "@type": "Answer",
                  text: `The most in-demand ${brand.niche.short} specializations include acute care (AGACNP), emergency (ENP), correctional health, geriatrics and long-term care, aesthetics and dermatology, and telehealth-focused chronic-care management. Dual certification (e.g., FNP plus an acute-care or specialty credential) is also increasingly valuable.`,
                },
              },
              {
                "@type": "Question",
                name: `Are ${brand.niche.short}s eligible for loan forgiveness or incentive programs?`,
                acceptedAnswer: {
                  "@type": "Answer",
                  text: `Yes, ${brand.niche.short}s working in designated Health Professional Shortage Areas (HPSAs) may qualify for HRSA's National Health Service Corps (NHSC) loan repayment, which offers up to $50,000 for a 2-year commitment. VA ${brand.niche.short}s may qualify for the Education Debt Reduction Program (EDRP). ${brand.niche.short}s in community health centers and rural areas often have additional state-level loan forgiveness programs available.`,
                },
              },
            ],
          }),
        }}
      />

      {/* SEO Fix #10: WebSite + SearchAction is already emitted globally
          from app/layout.tsx (lines 215-232) inside the @graph block.
          Re-emitting it here produced duplicate WebSite nodes that conflict
          on the same URL. Removed. */}
      {/* Main content */}
      <div style={{ background: 'linear-gradient(180deg, #FDFBF7 0%, #F5D5C4 15%, #F0C4AF 50%, #FDFBF7 100%)' }}>
        {/* 1. Hero — above the fold */}
        <HomepageHero jobCountDisplay={jobCountDisplay} />

        {/* 2. Employer Clay Dough Strip */}
        <EmployerTrustSection />


        {/* ── Remaining sections (being redesigned) ── */}
        <FeaturedJobsSection />

        {/* 4. Top States */}
        <TopStatesSection />

        {/* 5. Employer How It Works */}
        <EmployerHowItWorks />

        <HomepageBlogSection />

        <ExitIntentPopup />
      </div>
    </>
  );
}
