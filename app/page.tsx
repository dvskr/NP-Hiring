import { Metadata } from 'next';

import { getSiteStats } from '@/lib/site-stats';
import { brand } from '@/config/brand';
import EmployerTrustSection from '@/components/EmployerTrustSection';
import FeaturedJobsSection from '@/components/FeaturedJobsSection';
import TopStatesSection from '@/components/TopStatesSection';
import HomepageHero from '@/components/HomepageHero';
import VideoJsonLd from '@/components/VideoJsonLd';
import HomepageBlogSection from '@/components/HomepageBlogSection';
import HomepageFAQ from '@/components/HomepageFAQ';
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
      {/* FAQ schema + visible FAQ content now live together in
          components/HomepageFAQ.tsx (audit F11): one array feeds both the
          JSON-LD and the rendered accordion so they cannot diverge, and every
          stat derives from lib/stats-sources.ts or live per-state job counts.
          Rendered below with the other page sections. */}

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

        {/* 6. FAQ — visible accordion + FAQ JSON-LD from one array (F11) */}
        <HomepageFAQ />

        <ExitIntentPopup />
      </div>
    </>
  );
}
