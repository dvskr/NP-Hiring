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
    title: `${jobCountDisplay} ${brand.niche.short} Jobs: ${brand.niche.long} Job Board`,
    description: `Browse ${jobCountDisplay} ${brand.niche.short} jobs updated daily. Remote, telehealth, and in-person ${brand.niche.short} positions with salary transparency. Free for job seekers.`,
    openGraph: {
      title: `${jobCountDisplay} ${brand.niche.short} Jobs: Find Your Next Position`,
      description: `Browse ${jobCountDisplay} ${brand.niche.descriptor} jobs. Remote, hybrid, and in-person positions with salary transparency.`,
      images: [
        {
          url: HOME_OG_IMAGE,
          width: 1200,
          height: 630,
          alt: `${brand.name} job board: ${jobCountDisplay} ${brand.niche.descriptor} jobs from ${uniqueEmployerCount}+ companies across 50 states`,
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
        <HomepageHero />

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
  /** Clay chip label — what kind of thing opens (mirrors the blog tape's category chip). */
  chip: string;
}

const FREE_TOOLS: readonly FreeTool[] = [
  {
    href: '/salary-guide',
    label: `${brand.niche.short} Salary Calculator`,
    blurb: 'Filter live posted pay by state, experience, and setting.',
    icon: Calculator,
    chip: 'Calculator',
  },
  {
    href: '/tools/licensure-checker',
    label: 'Licensure Checker',
    blurb: 'Select a state to see requirements, practice authority, and timeline.',
    icon: Stethoscope,
    chip: 'Checker',
  },
  {
    href: '/tools/1099-vs-w2-calculator',
    label: '1099 vs W-2 Calculator',
    blurb: 'See what contract pay actually nets after self-employment tax.',
    icon: Receipt,
    chip: 'Calculator',
  },
  {
    href: '/resources/fpa-guide',
    label: 'Full Practice Authority Guide',
    blurb: 'All 50 states classified as full, reduced, or restricted.',
    icon: ShieldCheck,
    chip: 'Guide',
  },
  {
    href: '/resources/private-practice-guide',
    label: 'Private Practice Startup',
    blurb: 'LLC, credentialing, EHR, and malpractice, step by step.',
    icon: Building2,
    chip: 'Guide',
  },
  {
    href: '/job-alerts',
    label: 'Job Alerts',
    blurb: `New ${brand.niche.short} roles emailed as they are indexed.`,
    icon: Bell,
    chip: 'Alerts',
  },
];

/* ── Sticker-card system (owner direction, 2026-09-10) ──
 * Every card on the marketing surfaces shares ONE anatomy, first shipped on
 * the blog "reading tape" (components/HomepageBlogSection.tsx) and the
 * featured-jobs strip: white face, 2px #7A1C2B border, hard 5px offset
 * shadow, clay pastel chip, Lora title, muted blurb, and a decorative
 * accent bar beside the action word. The chip fills and bar widths below are
 * the SAME constants the tape uses so the two sections rhyme exactly.
 *
 * STAGE: this band sits between the peach state grid and the powder-blue
 * employer band, so it gets its own stage — blush + berry dot-grid — rather
 * than inheriting the page gradient (which made it read as a continuation
 * of the states section) or repeating the tape's cream line-grid.
 *
 * Static CSS only — NO template interpolations in style blocks (styled-jsx
 * dynamic styles deadlock Turbopack; see project memory). */
const TOOL_CHIP_FILLS = ['#D5F5F1', '#FBCFE8', '#FDE3C8', '#B9EBD6'];
const TOOL_BAR_WIDTHS = ['38%', '64%', '22%', '50%'];

const FREE_TOOLS_CSS = `
  .ftools-wrap {
    position: relative;
    background-color: #FBE7EE;
    background-image: radial-gradient(rgba(122,28,43,0.18) 1.2px, transparent 1.4px);
    background-size: 22px 22px;
    padding: 72px 0 76px;
  }
  .ftools-inner {
    position: relative;
    z-index: 1;
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 20px;
  }
  .ftools-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 16px 32px;
    flex-wrap: wrap;
    margin-bottom: 30px;
  }
  .ftools-eyeb {
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: #BE185D;
    margin: 0 0 6px;
  }
  .ftools-h2 {
    font-weight: 700;
    font-size: clamp(26px, 3vw, 36px);
    margin: 0;
    color: #7A1C2B;
    text-transform: uppercase;
    letter-spacing: -0.01em;
    line-height: 1.1;
  }
  .ftools-lede {
    font-size: 15px;
    color: #5A4A42;
    margin: 10px 0 0;
    line-height: 1.6;
    max-width: 560px;
  }
  .ftools-more {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 11px 24px;
    font-size: 13px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #fff;
    background: #BE185D;
    border: 2px solid #7A1C2B;
    box-shadow: 4px 4px 0 #7A1C2B;
    text-decoration: none;
    white-space: nowrap;
    transition: transform 0.15s ease, background 0.2s ease;
  }
  .ftools-more:hover { transform: translateY(-2px); background: #9D174D; }
  .ftools-more:focus-visible { outline: 3px solid #BE185D; outline-offset: 2px; }

  .ftools-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 24px;
  }
  @media (min-width: 640px) { .ftools-grid { grid-template-columns: repeat(2, 1fr); } }
  @media (min-width: 1024px) { .ftools-grid { grid-template-columns: repeat(3, 1fr); } }

  .tool-card {
    display: flex;
    flex-direction: column;
    background: #fff;
    border: 2px solid #7A1C2B;
    box-shadow: 5px 5px 0 #7A1C2B;
    padding: 20px;
    text-decoration: none;
    cursor: pointer;
    transition: transform 0.15s ease;
  }
  .tool-card:hover { transform: translateY(-4px); }
  .tool-card:focus-visible { outline: 3px solid #BE185D; outline-offset: 2px; }
  .tool-card__top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 12px;
  }
  .tool-card__chip {
    display: inline-block;
    padding: 5px 12px;
    border-radius: 999px;
    border: 1px solid rgba(255,255,255,0.5);
    box-shadow: 3px 3px 8px rgba(190,24,93,0.10), -2px -2px 5px rgba(255,255,255,0.8), inset 2px 2px 3px rgba(255,255,255,0.7);
    font-size: 10.5px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #7A1C2B;
  }
  .tool-card__icon {
    flex: none;
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #FBF2E6;
    border: 2px solid #7A1C2B;
    box-shadow: 3px 3px 0 #7A1C2B;
    color: #7A1C2B;
  }
  .tool-card__title {
    font-weight: 700;
    font-size: 18px;
    line-height: 1.3;
    color: #2b1a1e;
    margin: 0 0 8px;
  }
  .tool-card__desc {
    font-size: 12.5px;
    color: #7a6d70;
    line-height: 1.5;
    margin: 0 0 14px;
  }
  .tool-card__bar {
    margin-top: auto;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .tool-card__track {
    flex: 1;
    height: 4px;
    background: rgba(122,28,43,0.12);
    border-radius: 2px;
    position: relative;
    overflow: hidden;
  }
  .tool-card__fill {
    position: absolute;
    top: 0; left: 0; bottom: 0;
    background: #BE185D;
    border-radius: 2px;
  }
  .tool-card__open {
    font-size: 11px;
    font-weight: 800;
    color: #9b8291;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }
  @media (prefers-reduced-motion: reduce) {
    .tool-card:hover, .ftools-more:hover { transform: none; }
  }
  @media (max-width: 768px) {
    .ftools-wrap { padding: 52px 0 56px; }
    .ftools-head { margin-bottom: 22px; }
  }
`;

function FreeToolsBand() {
  return (
    <section aria-labelledby="free-tools-heading" className="ftools-wrap">
      <style>{FREE_TOOLS_CSS}</style>

      <div className="ftools-inner">
        <div className="ftools-head">
          <div>
            <p className="ftools-eyeb">Always free</p>
            <h2 id="free-tools-heading" className="ftools-h2 font-heading">
              Free {brand.niche.short} career tools
            </h2>
            <p className="ftools-lede">
              No account and no paywall. Work out what a role should pay, what your state requires, and
              what contract work actually nets before you apply.
            </p>
          </div>
          {/* The tools hub carries the calculators that did not fit above
              (salary benchmark, cost-of-living comparison). Linking the hub
              rather than every tool keeps this band stable as that set grows. */}
          <Link href="/tools" className="ftools-more">
            All free tools →
          </Link>
        </div>

        <div className="ftools-grid">
          {FREE_TOOLS.map((tool, i) => {
            const ToolIcon = tool.icon;
            return (
              <Link key={tool.href} href={tool.href} className="tool-card">
                <span className="tool-card__top">
                  <span className="tool-card__chip" style={{ background: TOOL_CHIP_FILLS[i % TOOL_CHIP_FILLS.length] }}>
                    {tool.chip}
                  </span>
                  <span className="tool-card__icon" aria-hidden="true">
                    <ToolIcon size={18} strokeWidth={2.25} />
                  </span>
                </span>
                <h3 className="tool-card__title font-heading">{tool.label}</h3>
                <p className="tool-card__desc">{tool.blurb}</p>
                <span className="tool-card__bar" aria-hidden="true">
                  <span className="tool-card__track">
                    <span className="tool-card__fill" style={{ width: TOOL_BAR_WIDTHS[i % TOOL_BAR_WIDTHS.length] }} />
                  </span>
                  <span className="tool-card__open">Open →</span>
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
