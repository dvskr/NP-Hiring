import { Metadata } from 'next';

import { prisma } from '@/lib/prisma';
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

// Below-fold interactive components — defer from critical bundle
const ExitIntentPopup = dynamic(() => import('@/components/ExitIntentPopup'));






// Revalidate every 60 seconds
export const revalidate = 60;

/**
 * Get total job count for dynamic metadata
 */
async function getTotalJobCount(): Promise<number> {
  try {
    const count = await prisma.job.count({
      where: { isPublished: true },
    });
    return count;
  } catch {
    return 200; // Fallback
  }
}

/**
 * Get unique employer count for dynamic metadata
 */
async function getUniqueEmployerCount(): Promise<number> {
  try {
    const result = await prisma.job.findMany({
      where: { isPublished: true },
      distinct: ['employer'],
      select: { employer: true },
    });
    return result.length;
  } catch {
    return 500; // Fallback
  }
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
    title: `${jobCountDisplay} NP Jobs — Nurse Practitioner Job Board`,
    description: `Browse ${jobCountDisplay} NP jobs updated daily. Remote, telehealth & in-person nurse practitioner positions with salary transparency. Free for job seekers.`,
    openGraph: {
      title: `${jobCountDisplay} NP Jobs - Find Your Next Position`,
      description: `Browse ${jobCountDisplay} nurse practitioner jobs. Remote, hybrid, and in-person positions with salary transparency.`,
      images: [
        {
          url: 'https://sggccmqjzuimwlahocmy.supabase.co/storage/v1/object/public/site-assets/images/pages/pmhnp-job-board-homepage.webp',
          width: 1280,
          height: 900,
          alt: `NP Hiring job board homepage showing ${jobCountDisplay} nurse practitioner jobs from ${uniqueEmployerCount}+ companies across 50 states`,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      images: ['https://sggccmqjzuimwlahocmy.supabase.co/storage/v1/object/public/site-assets/images/pages/pmhnp-job-board-homepage.webp'],
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
              { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://nphiring.com' },
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
                name: "What is a Nurse Practitioner (NP)?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "A Nurse Practitioner (NP) is an Advanced Practice Registered Nurse (APRN) who holds a Master's (MSN) or Doctoral (DNP) degree on top of a BSN. NPs assess and diagnose patients, order and interpret tests, prescribe medications (including controlled substances in most states), and manage chronic and acute conditions. NPs specialize in one of several population focuses: Family (FNP), Adult-Gerontology (AGNP), Pediatric (PNP), Neonatal (NNP), Women's Health (WHNP), Acute Care (ACNP), or Psychiatric-Mental Health (PMHNP). All NPs must pass a national board exam in their specialty (ANCC or AANP).",
                },
              },
              {
                "@type": "Question",
                name: "How much do Nurse Practitioners make?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: `NPs earn an average annual salary of ${STAT_SOURCES.averageSalary.range} (${STAT_SOURCES.averageSalary.source}, ${STAT_SOURCES.averageSalary.asOf}). Pay varies by specialty and setting: FNPs $105–135k, AGNPs $115–145k, PMHNPs $130–180k, ACNPs $120–155k, and CRNAs $200–350k. Remote and telehealth positions add ~$10–25k. 1099/contract NPs can earn $80–$200/hour depending on niche and licensure breadth.`,
                },
              },
              {
                "@type": "Question",
                name: "What are the different NP specialties?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "NPs train in one of seven population foci: Family (FNP, ~70k jobs/yr), Adult-Gerontology Primary Care (AGPCNP), Adult-Gerontology Acute Care (AGACNP), Pediatric Primary Care (CPNP-PC), Pediatric Acute Care (CPNP-AC), Neonatal (NNP), Women's Health (WHNP), and Psychiatric-Mental Health (PMHNP). Beyond those, NPs sub-specialize in cardiology, oncology, dermatology, emergency, hospitalist, urgent care, and many more — typically through on-the-job training plus optional certifications.",
                },
              },
              {
                "@type": "Question",
                name: "What is the NP job outlook?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: `${STAT_SOURCES.blsGrowth2032.source} projects ${STAT_SOURCES.blsGrowth2032.formatted} employment growth for nurse practitioners through 2032 — among the fastest of any occupation. The US currently has ~355,000 licensed NPs and the BLS expects ~118,600 NP job openings per year through the decade. Demand drivers: physician shortages, an aging population, expanded telehealth, and Full Practice Authority being adopted in more states.`,
                },
              },
              {
                "@type": "Question",
                name: "How long does it take to become an NP?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "Becoming an NP typically takes 6–8 years total: 4 years for a BSN, 1–2 years of RN experience (strongly recommended, sometimes required), and 2–4 years for an MSN or DNP with NP specialization. Accelerated BSN-to-DNP and direct-entry programs (for non-nursing bachelor's holders) can shorten or restructure this timeline. After graduation, you must pass a national certification exam (ANCC or AANP) for your specialty and obtain state APRN licensure.",
                },
              },
              {
                "@type": "Question",
                name: "What is Full Practice Authority?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "Full Practice Authority (FPA) lets NPs evaluate patients, diagnose, order tests, and prescribe medications — independently, without a physician collaborative agreement. As of 2026, 27 states plus DC grant FPA to NPs. The rest are either 'Reduced Practice' (collaborative agreement required for at least one element of practice) or 'Restricted Practice' (career-long physician supervision required). FPA states generally have higher NP demand, more remote/telehealth roles, and easier private-practice paths.",
                },
              },
              {
                "@type": "Question",
                name: "Can NPs prescribe medication?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "Yes. NPs prescribe medications, including controlled substances (Schedule II–V), in all 50 states. In FPA states, NPs prescribe independently. In Reduced/Restricted states, prescribing may require a physician collaborative agreement or specific DEA registration. NPs must hold a DEA number to prescribe controlled substances. Common prescribing areas include hypertension, diabetes, mental health (PMHNP), pain, women's health, and pediatric care — varies by specialty.",
                },
              },
              {
                "@type": "Question",
                name: "What's the difference between an NP and a Physician (MD/DO)?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "NPs hold a Master's or Doctoral nursing degree (6–8 years total post-secondary) and train under a nursing-based 'wellness + diagnosis' model. Physicians hold an MD or DO (typically 11–15 years post-secondary including residency) and train under a disease-pathology model. In FPA states, NP and physician scope substantially overlap for primary care, mental health, and many specialties. NPs typically earn 40–60% of physician comp but reach independent practice 5–8 years sooner with much less debt.",
                },
              },
              {
                "@type": "Question",
                name: "What's the difference between an NP and an RN?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "All NPs are first RNs — but with an additional graduate degree (MSN or DNP), national NP certification, and state APRN licensure. RNs deliver care under physician/NP orders: assessment, medication administration, patient education, care coordination. NPs operate at a higher level: they diagnose, prescribe, and (in FPA states) practice independently. Pay reflects the difference: RNs ~$80k median, NPs ~$120–150k median.",
                },
              },
              {
                "@type": "Question",
                name: "Are there remote NP jobs?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "Yes. Roughly 30–40% of NP postings in 2026 offer remote or telehealth-first arrangements. Strongest remote markets: PMHNP (psychiatric telehealth — Talkiatry, Cerebral, Brightside), primary-care telehealth (Included Health, Hims/Hers, Forward), and chronic-care management (Heartbeat Health, Omada). Remote NP salaries typically run $120–180k base; CRNAs and AGACNPs remain mostly in-person. Multi-state licensure (Nurse Licensure Compact / APRN Compact) materially increases remote-job optionality.",
                },
              },
              {
                "@type": "Question",
                name: "Can NPs open a private practice?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "Yes, in all 50 states — though independence varies. In FPA states (27 + DC), NPs can open, own, and operate a practice without physician oversight. In Reduced/Restricted states, a collaborative agreement with a physician is required and may add 10–25% to overhead. Private-practice NPs typically earn $180–300k+ annually but carry business risk: insurance credentialing, malpractice coverage, EHR, billing, and staffing. Many NPs start with locum tenens or part-time independent contracting before going fully solo.",
                },
              },
              {
                "@type": "Question",
                name: "Are NPs eligible for loan forgiveness?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "Yes. The largest programs: HRSA's National Health Service Corps (NHSC) — up to $50,000 for 2 years in a designated Health Professional Shortage Area. The Nurse Corps Loan Repayment Program — up to 85% of nursing debt forgiven over 3 years for service in a critical-shortage facility. VA's Education Debt Reduction Program (EDRP) — up to $200,000 over 5 years for VA-employed NPs. Many states also run NP-specific loan repayment programs for rural and underserved areas.",
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
