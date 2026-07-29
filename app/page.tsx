import { Metadata } from 'next';
import Link from 'next/link';
import { Bell, Building2, Calculator, Receipt, ShieldCheck, Stethoscope, type LucideIcon } from 'lucide-react';

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

// P0 OG sweep: the previous OG image lived in an unpopulated Supabase
// bucket and 400'd on every social share. Bare /api/og renders the
// board's edge-generated homepage card (logo, headline, live-stat row) —
// same pattern as app/for-employers/page.tsx.
const HOME_OG_IMAGE = `${brand.baseUrl}/api/og`;

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
          url: HOME_OG_IMAGE,
          width: 1200,
          height: 630,
          alt: `${brand.name} job board — ${jobCountDisplay} ${brand.niche.descriptor} jobs from ${uniqueEmployerCount}+ companies across 50 states`,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      images: [HOME_OG_IMAGE],
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

        {/* 4b. Free career tools — P2 #14 */}
        <FreeToolsBand />

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

/* ═══════════════════════════════════════════════════════════════════════════
   P2 #14 — Free career tools band.

   The homepage linked none of the board's free tools: the salary calculator,
   the state licensure checker and the practice guides were reachable only from
   the footer or the header's "Resources" pill. These are the highest-intent
   non-job entry points on the site and the strongest reason for a candidate to
   come back between job searches, so they get a band of their own.

   TRUTH RULE: every entry points at a route that exists TODAY, and
   tests/regressions/p2-mesh-directories-home-tools-band.test.ts asserts a
   page.tsx exists for each one — a renamed tool fails the gate loudly instead
   of shipping a dead homepage link.
   ═══════════════════════════════════════════════════════════════════════════ */

interface FreeTool {
  href: string;
  label: string;
  blurb: string;
  icon: LucideIcon;
  /** Set when the destination is an interactive tool rather than a guide. */
  interactive?: boolean;
}

const FREE_TOOLS: readonly FreeTool[] = [
  {
    href: '/salary-guide',
    label: `${brand.niche.short} Salary Calculator`,
    blurb: 'Filter live posted pay by state, experience and setting.',
    icon: Calculator,
    interactive: true,
  },
  {
    href: '/tools/licensure-checker',
    label: 'Licensure Checker',
    blurb: 'Pick a state for requirements, practice authority and timeline.',
    icon: Stethoscope,
    interactive: true,
  },
  {
    href: '/tools/1099-vs-w2-calculator',
    label: '1099 vs W-2 Calculator',
    blurb: 'What contract pay really nets after self-employment tax.',
    icon: Receipt,
    interactive: true,
  },
  {
    href: '/resources/fpa-guide',
    label: 'Full Practice Authority Guide',
    blurb: 'All 50 states classified full, reduced or restricted.',
    icon: ShieldCheck,
  },
  {
    href: '/resources/private-practice-guide',
    label: 'Private Practice Startup',
    blurb: 'LLC, credentialing, EHR and malpractice, step by step.',
    icon: Building2,
  },
  {
    href: '/job-alerts',
    label: 'Job Alerts',
    blurb: `New ${brand.niche.short} roles emailed as they are indexed.`,
    icon: Bell,
  },
];

function FreeToolsBand() {
  return (
    <section
      aria-labelledby="free-tools-heading"
      style={{ maxWidth: '1200px', margin: '0 auto', padding: '56px 20px' }}
    >
      <div style={{ maxWidth: '640px', marginBottom: '28px' }}>
        <p
          style={{
            fontSize: '12px',
            fontWeight: 700,
            color: '#BE185D',
            textTransform: 'uppercase',
            letterSpacing: '0.15em',
            margin: '0 0 8px',
          }}
        >
          Always free
        </p>
        <h2
          id="free-tools-heading"
          className="font-lora"
          style={{
            fontSize: 'clamp(24px, 4vw, 36px)',
            fontWeight: 700,
            color: '#1A2E35',
            margin: '0 0 10px',
            lineHeight: 1.15,
          }}
        >
          Free {brand.niche.short} career tools
        </h2>
        <p style={{ fontSize: '15px', color: '#5A4A42', margin: 0, lineHeight: 1.6 }}>
          No account, no paywall. Work out what a role should pay, what your state requires, and what
          contract work actually nets — before you apply.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {FREE_TOOLS.map((tool) => {
          const ToolIcon = tool.icon;
          return (
            <Link key={tool.href} href={tool.href} className="tool-card group" style={{ textDecoration: 'none' }}>
              <div
                style={{
                  height: '100%',
                  background: '#FFFFFF',
                  borderRadius: '20px',
                  border: '1px solid rgba(255,255,255,0.6)',
                  boxShadow:
                    '6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6)',
                  padding: '22px',
                  transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                }}
              >
                <div
                  style={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '14px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: '#FDF2F8',
                    border: '1px solid rgba(190,24,93,0.12)',
                    marginBottom: '14px',
                  }}
                >
                  <ToolIcon size={21} style={{ color: '#BE185D' }} aria-hidden="true" />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '6px' }}>
                  <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#1A2E35', margin: 0, lineHeight: 1.3 }}>
                    {tool.label}
                  </h3>
                  {tool.interactive && (
                    <span
                      style={{
                        fontSize: '10px',
                        fontWeight: 700,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        color: '#BE185D',
                        background: '#FDF2F8',
                        border: '1px solid rgba(190,24,93,0.15)',
                        borderRadius: '8px',
                        padding: '3px 7px',
                      }}
                    >
                      Interactive
                    </span>
                  )}
                </div>
                <p style={{ fontSize: '13.5px', color: '#7A6A62', margin: '0 0 14px', lineHeight: 1.55 }}>
                  {tool.blurb}
                </p>
                <span
                  style={{
                    fontSize: '13px',
                    fontWeight: 700,
                    color: '#BE185D',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                  }}
                >
                  Open
                  <span className="group-hover:translate-x-1 transition-transform" aria-hidden="true">→</span>
                </span>
              </div>
            </Link>
          );
        })}
      </div>

      {/* The tools hub carries the calculators that did not fit above
          (salary benchmark, cost-of-living comparison). Linking the hub rather
          than every tool keeps this band stable as that set grows. */}
      <p style={{ marginTop: '20px', fontSize: '14px' }}>
        <Link href="/tools" style={{ color: '#BE185D', fontWeight: 700, textDecoration: 'none' }}>
          Browse every free {brand.niche.short} tool →
        </Link>
      </p>

      <style>{`
        .tool-card:hover > div,
        .tool-card:focus-visible > div {
          transform: translateY(-4px);
          box-shadow: 10px 10px 24px rgba(0,0,0,0.09), -5px -5px 14px rgba(255,255,255,0.9), inset 1px 1px 2px rgba(255,255,255,0.6);
        }
        @media (prefers-reduced-motion: reduce) {
          .tool-card:hover > div,
          .tool-card:focus-visible > div { transform: none; }
        }
      `}</style>
    </section>
  );
}
