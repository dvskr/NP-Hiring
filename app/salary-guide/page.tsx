import { brand } from '@/config/brand';
import { Metadata } from 'next';
import VideoJsonLd from '@/components/VideoJsonLd';
import Link from 'next/link';
import { ArrowUpRight, ArrowRight, DollarSign, TrendingUp, HelpCircle, Ruler, Star } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import SalaryGuideForm from '@/components/SalaryGuideForm';
import BreadcrumbSchema from '@/components/BreadcrumbSchema';
import CopyCitation from '@/components/CopyCitation';
import GuidePromo from '@/components/guides/GuidePromo';
import EditorialByline, { editorialSchemaFields } from '@/components/EditorialByline';
import SalaryCalculator from '@/components/SalaryCalculator';
import SalaryProvenance from '@/components/SalaryProvenance';
import { STAT_SOURCES } from '@/lib/stats-sources';
// Report links derive from the edition config, so next year's edition and
// any retitle reach this page without a hand-typed path or title.
import { PAY_TRANSPARENCY_REPORT } from '@/lib/reports/editions';
import { SALARY_GUIDE_PDF_AVAILABLE } from '@/app/api/salary-guide/pdf-availability';
// P1 #7: by-specialty salary pages, linked from the measured specialty
// table and the chips under it (config-driven: one array feeds the chips,
// the index hub and the sitemap).
import { SALARY_SPECIALTY_PAGES } from '@/app/salary-guide/specialty/specialty-config';
// Review P9 #2c/#2d, salary build 2026-11: every posted-pay figure on this
// page reads the NP Pay Report snapshot, the one salary pool (live NP
// postings, no CRNA, CNM or CNS) through the one engine (each employer
// counted once, a median at 5 or more employers, quartiles at 10 or more),
// the same figures /reports/np-pay and the state pages print.
import { BENCHMARK_MIN_EMPLOYERS } from '@/components/tools/benchmark-model';
import { loadNpPaySnapshot } from '@/lib/reports/np-pay';
import { NP_PAY_REPORT_PATH, usd, type NpPaySnapshot } from '@/lib/reports/np-pay-model';
import { MAX_RANGE_RATIO, ONE_EMPLOYER_NOTE, salaryAsOfLabel, SALARY_SANITY_MAX, SALARY_SANITY_MIN, TIER_RULE_NOTE } from '@/lib/salary-report/stats';
import { buildHubFaqs } from '@/lib/salary-guide-hub-faq';
import AdvertisedPaySection from './advertised-pay-section';
import { formatStatVintage } from '@/components/SalaryProvenance';
import { activeIndexableJobWhere } from '@/lib/active-job-filter';
// The BLS OEWS May 2025 state wages: the all-state table, the highest and
// lowest paying states and the state FAQ answer all read this one module.
import {
  BLS_NATIONAL,
  BLS_OEWS_REFERENCE_PERIOD,
  BLS_STATE_SOURCE_LABEL,
  BLS_STATE_SOURCE_URL,
  BLS_STATE_WAGES,
  blsRankSentence,
  blsStatesByMedianDesc,
  bottomStatesByMedian,
  formatBlsCount,
  formatBlsDollars,
  formatBlsHourly,
  topStatesByMedian,
} from '@/lib/salary-guide-bls-states';

// ── Editorial review date (audit P0 #23, B54 principle) ─────────────────
// The Article schema's dateModified must reflect a REAL content review,
// never render time — `new Date()` fabricated freshness on every request.
// Update this literal only when the guide's figures/copy are actually
// reviewed. (State salary pages omit dates entirely for the same reason.)
// 2026-10-06: reviewed after the 2026-09-30 OEWS May 2025 refresh; the
// median and both percentiles were re-read that day from the BLS public
// data API (series OEUN000000000000029117113 / ...111 / ...115).
const LAST_REVIEWED_DATE = '2026-10-06';

// ── Cited figures (audit B51: single source of truth) ──────────────────
// Every national salary / growth / shortage / FPA claim on this page
// derives from lib/stats-sources.ts so it cannot disagree with the
// homepage FAQ, job-page widgets, or state FAQs. Update that file, not
// this page. The previous 126K-era hardcodes (an earlier OEWS vintage)
// contradicted the cited figure; a drift test
// (tests/regressions/aeo-content-citation-stats.test.ts) now blocks
// re-hardcoding a national salary here.
const NATIONAL_SALARY = STAT_SOURCES.npMedianWageBls; // '$132,300' (BLS OEWS May 2025 median)
const NATIONAL_SALARY_K = Math.round(Number(NATIONAL_SALARY.value) / 1000); // 132
// "May 2025" from the entry's own asOf, so the inline cite follows a
// vintage refresh of lib/stats-sources.ts instead of going stale.
const NATIONAL_SALARY_VINTAGE = formatStatVintage(NATIONAL_SALARY.asOf);
// The percentile pills cite the same OEWS release (HANDOFFS 181): nothing
// here is typed by hand. The labels name the percentile itself ("10th
// percentile wage"), so the compact $K figure rounds to the nearest $1,000.
const NATIONAL_P10 = STAT_SOURCES.salaryPercentile10; // '$101,340' (BLS OEWS May 2025)
const NATIONAL_P90 = STAT_SOURCES.salaryPercentile90; // '$174,420' (BLS OEWS May 2025)
const P10_K = Math.round(Number(NATIONAL_P10.value) / 1000); // 101
const P90_K = Math.round(Number(NATIONAL_P90.value) / 1000); // 174
const NP_GROWTH = STAT_SOURCES.blsGrowth2035; // '41%'
const FPA_STATES = STAT_SOURCES.fullPracticeStates; // '27 states + DC' (AANP)
const SHORTAGE_POP = STAT_SOURCES.hrsaShortagePopulation; // '100 million+' (HRSA, primary care)

// The review date as readers see it ("October 6, 2026"), formatted from the
// literal above so the citation block and the schema cannot disagree. The
// citation block used to hardcode "February 2026", a date inherited from
// the donor template's initial commit that matched no review of this page.
const REVIEWED_LABEL = formatStatVintage(LAST_REVIEWED_DATE);

// One name for the guide: the H1, the Article headline, the WebPage name
// and the copy-citation title. No year in it: the figures carry their own
// vintage (NATIONAL_SALARY_VINTAGE), and a year in the name went stale.
const GUIDE_NAME = `${brand.niche.long} Salary Guide`;

// ── BLS state wages (May 2025 OEWS) ─────────────────────────────────────
// Ranked once from the generated module (lib/salary-guide-bls-states.ts):
// the all-state table, the highest and lowest paying state lists and the
// state FAQ answer all read these, so none of them is typed by hand.
const BLS_STATES_BY_MEDIAN = blsStatesByMedianDesc();
const TOP_PAYING_STATES = topStatesByMedian(5);
const LOWEST_PAYING_STATES = bottomStatesByMedian(5);


// Enable ISR with daily revalidation
export const revalidate = 86400;

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || brand.baseUrl;

// P0 OG sweep: edge-generated card via /api/og — the previous Supabase
// page-screenshot 400'd on every share (pattern: app/for-employers/page.tsx).
// The median in the title derives from STAT_SOURCES above, never hardcoded.
const SALARY_GUIDE_OG_IMAGE = `${brand.baseUrl}/api/og?title=${encodeURIComponent(`${brand.niche.long} Salary: ${NATIONAL_SALARY.formatted} Median`)}&type=page`;

// Search snippet copy (SEO/AEO release 2026-10): leads with the query
// phrase "Nurse Practitioner Salary", names the cited figures as a median
// and percentiles (never an average), and reads every figure and its
// vintage from STAT_SOURCES. Title is 60 characters rendered; the
// description 120 to 160.
const META_DESCRIPTION = `${brand.niche.descriptor.charAt(0).toUpperCase()}${brand.niche.descriptor.slice(1)} salary: the BLS ${NATIONAL_SALARY_VINTAGE} median wage is ${NATIONAL_SALARY.formatted}, with 10th and 90th percentile wages of ${NATIONAL_P10.formatted} and ${NATIONAL_P90.formatted}, plus pay by state.`;

// State codes mapping
const STATE_CODES: Record<string, string> = {
  'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR',
  'California': 'CA', 'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE',
  'Florida': 'FL', 'Georgia': 'GA', 'Hawaii': 'HI', 'Idaho': 'ID',
  'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA', 'Kansas': 'KS',
  'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
  'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS',
  'Missouri': 'MO', 'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH', 'Oklahoma': 'OK',
  'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT',
  'Vermont': 'VT', 'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV',
  'Wisconsin': 'WI', 'Wyoming': 'WY', 'District of Columbia': 'DC',
};

/**
 * Every posted-pay figure on this page reads ONE snapshot: the NP Pay Report's
 * (lib/reports/np-pay.ts), the one salary pool (live NP postings with a
 * non-estimated annual pay range; no CRNA, CNM or CNS postings) through the
 * one engine (each employer counted once; a median at 5 or more employers,
 * quartiles at 10 or more). /reports/np-pay prints the same figures, so the
 * two pages cannot disagree. Null only during a build with no database: the
 * page then renders its BLS figures alone.
 */
function calculatorStates(snapshot: NpPaySnapshot | null) {
  return (snapshot?.states ?? [])
    .filter((row) => row.median !== null && row.employers !== null)
    .map((row) => ({
      state: row.scope,
      stateCode: STATE_CODES[row.scope] || '',
      medianSalary: row.median as number,
      employers: row.employers as number,
    }));
}

/**
 * Active jobs per state on the predicate /salary-guide/[state] uses for its
 * own 404 gate (activeIndexableJobWhere plus the state name), so the BLS
 * table links a state page, and its jobs, only where that page renders.
 */
async function getActiveJobsByState(): Promise<Map<string, number>> {
  const rows = await prisma.job.groupBy({
    by: ['state'],
    where: { ...activeIndexableJobWhere(), state: { not: null } },
    _count: { id: true },
  });
  return new Map(rows.flatMap((row) => (row.state ? [[row.state, row._count.id] as const] : [])));
}

/** All 51 BLS rows for the table: highest median first, any footnoted median last. */
const BLS_TABLE_ROWS = [
  ...BLS_STATES_BY_MEDIAN,
  ...Object.values(BLS_STATE_WAGES).filter((row) => row.annualMedian.value === null),
];

const blsHeadCell: React.CSSProperties = {
  padding: '12px 14px', textAlign: 'right', fontWeight: 600, color: '#64748B',
  borderBottom: '2px solid rgba(0,0,0,0.06)', fontSize: '11px', textTransform: 'uppercase',
  letterSpacing: '0.04em', whiteSpace: 'nowrap',
};
const blsCell: React.CSSProperties = {
  padding: '10px 14px', textAlign: 'right', borderBottom: '1px solid rgba(0,0,0,0.04)', whiteSpace: 'nowrap',
};

export const metadata: Metadata = {
  // `absolute` opts out of the layout title template so the brand suffix
  // doesn't get appended a second time (was rendering "... | PMHNP Hiring
  // | PMHNP Hiring" — audit 09 M-17).
  title: { absolute: `${brand.niche.long} Salary: $${NATIONAL_SALARY_K}K Median by State | ${brand.name}` },
  description: META_DESCRIPTION,
  keywords: [
    `${brand.niche.descriptor} salary`,
    `${brand.niche.short.toLowerCase()} salary`,
    `${brand.niche.short.toLowerCase()} salary by state`,
    `how much do ${brand.niche.descriptor}s make`,
    `${brand.niche.short.toLowerCase()} pay`,
    `${brand.niche.short.toLowerCase()} salary 2026`,
    `${brand.niche.descriptor} salary by state`,
    `${brand.niche.short.toLowerCase()} salary guide`,
  ],
  openGraph: {
    title: `${brand.niche.long} Salary: ${NATIONAL_SALARY.formatted} Median (BLS ${NATIONAL_SALARY_VINTAGE})`,
    description: META_DESCRIPTION,
    type: 'website',
    url: `${BASE_URL}/salary-guide`,
    images: [{ url: SALARY_GUIDE_OG_IMAGE, width: 1200, height: 630, alt: `${GUIDE_NAME} showing ${brand.niche.descriptor} pay by state with an interactive salary comparison table` }],
  },
  twitter: { card: 'summary_large_image', images: [SALARY_GUIDE_OG_IMAGE] },
  alternates: { canonical: `${brand.baseUrl}/salary-guide` },
};

/* ═══ Clay Design Tokens ═══ */
const clayCard: React.CSSProperties = {
  background: '#FFFFFF', borderRadius: '20px',
  border: '1px solid rgba(255,255,255,0.5)',
  boxShadow: '6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02)',
};

/* ═══════════════════════════════════════════════════════════════════════
 * EVERY FIGURE ON THIS PAGE IS MEASURED (salary build 2026-11)
 * ═══════════════════════════════════════════════════════════════════════
 * The experience, setting and specialty premium tables and the figures in
 * the factor cards were uncited editorial estimates, labelled as such while
 * they stood. They are gone, from
 * this page and from scripts/generate-salary-pdf.ts alike. In their place:
 *   - BLS OEWS May 2025 wages for every state and DC
 *     (lib/salary-guide-bls-states.ts), each with its source and vintage;
 *   - advertised pay on live postings by state, specialty, work mode,
 *     employment type and experience, from the one salary engine through the
 *     NP Pay Report snapshot (lib/reports/np-pay.ts): each employer counted
 *     once, a median at 5 or more employers, quartiles at 10 or more.
 * The factor cards stay as guidance with no figure of their own. The FAQ
 * (lib/salary-guide-hub-faq.ts) answers from those same figures.
 * ═══════════════════════════════════════════════════════════════════════ */
const HUB_FIGURES_NOTE = `Every figure on this page is either a BLS survey estimate, shown with its source and vintage, or a median of the pay employers advertise in live postings on ${brand.name}, shown with the number of employers behind it.`;

/**
 * Exact-DPR srcSet over the ladder files generated by
 * scripts/regen-image-ladders.mjs — served as a plain <img> because the
 * next/image resample blurs this flat line art (same pattern as the
 * /for-employers CTA). Factor sources are 96px, so their ladder caps at 2x.
 */
function ladderSrcSet(img: string, widths: number[]): string {
  const base = img.replace(/\.webp$/, '');
  return widths.map(w => `${base}-${w}.webp ${w}w`).join(', ');
}

const FACTOR_LADDER = [48, 60, 72, 84, 96];

const factorCards = [
  { img: '/images/salary-guide/factor-location.webp', title: 'Geographic Location', desc: 'Pay differs widely by state. The BLS table on the salary guide lists the median annual wage for every state and DC, from the highest paying to the lowest.' },
  { img: '/images/salary-guide/factor-experience.webp', title: 'Experience Level', desc: 'The salary guide compares advertised pay for new-grad friendly roles with roles asking for several years of experience, from live postings, each employer counted once.' },
  { img: '/images/salary-guide/factor-setting.webp', title: 'Practice Setting', desc: 'Hospitals, clinics, telehealth companies and private practices pay differently. Compare advertised pay by specialty and work mode on the salary guide before weighing an offer.' },
  { img: '/images/salary-guide/factor-employment.webp', title: 'Employment Type', desc: `Contract and travel ${brand.niche.short} work is quoted as an hourly or weekly rate without benefits, so it does not compare with a salary as quoted. The 1099 vs W-2 comparison works out the rate that matches a salaried package.` },
  { img: '/images/salary-guide/factor-specialty.webp', title: 'Specialization', desc: 'Advertised pay differs by specialty. The salary guide lists the median for each specialty where enough employers disclose pay, with each specialty guide linked.' },
  { img: '/images/salary-guide/factor-negotiate.webp', title: 'Negotiation', desc: `Ask for the employer’s range first, anchor on your state’s BLS median and the advertised median for comparable roles, then negotiate the whole package: CME, PTO, malpractice tail and productivity terms.` },
];

export default async function SalaryGuidePage() {
  const [snapshot, activeJobsByState] = await Promise.all([loadNpPaySnapshot(), getActiveJobsByState()]);
  const national = snapshot?.national ?? null;
  const nationalPublished = national && national.median !== null && national.employers !== null ? national : null;
  const liveByState = new Map((snapshot?.states ?? []).map((row) => [row.scope, row]));
  // The day the live figures describe, formatted on the server.
  const asOfLabel = snapshot ? salaryAsOfLabel(new Date(snapshot.asOf)) : null;

  // Calculator base: the national median advertised pay when the engine
  // publishes one; otherwise the cited BLS OEWS national median, never an
  // ungated posting mean.
  const calculatorNational = nationalPublished
    ? { base: nationalPublished.median as number, basis: 'postings' as const, employers: nationalPublished.employers as number }
    : { base: Number(NATIONAL_SALARY.value), basis: 'bls' as const };

  // ONE array feeds the visible FAQ and the FAQPage JSON-LD, and every answer
  // comes from a cited figure or the snapshot (lib/salary-guide-hub-faq.ts).
  const faqs = buildHubFaqs(snapshot);
  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(faq => ({
      '@type': 'Question' as const,
      name: faq.q,
      acceptedAnswer: { '@type': 'Answer' as const, text: faq.a },
    })),
  };

  // Article Schema
  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": GUIDE_NAME,
    "description": `${brand.niche.long} salary data: the BLS ${NATIONAL_SALARY_VINTAGE} median wage and its 10th and 90th percentiles, the BLS median for every state and DC, and the pay employers advertise on live postings by state, specialty, work mode and experience, each employer counted once. Based on ${NATIONAL_SALARY.source} and live job postings listed on ${brand.name}.`,
    "image": SALARY_GUIDE_OG_IMAGE,
    // No datePublished: the literal "2026-01-01" predated the repository
    // itself (first commit 2026-07-02), and no record fixes the day this
    // page went live, so no date is claimed (B54 principle). dateModified is
    // the real review date the page shows beside the figures.
    "dateModified": `${LAST_REVIEWED_DATE}T00:00:00Z`,
    "author": { "@type": "Organization", "@id": `${brand.baseUrl}/#organization`, "name": brand.name, "url": brand.baseUrl, "logo": { "@type": "ImageObject", "url": `${brand.baseUrl}/logo.png` } },
    // CQ-12: a configured named author replaces the Organization author, and
    // a configured reviewer adds reviewedBy; {} while neither is set.
    ...editorialSchemaFields(),
    // B56: publisher logo previously referenced an SVG path that does not
    // exist in public/ — /logo.png is the real asset.
    "publisher": { "@type": "Organization", "@id": `${brand.baseUrl}/#organization`, "name": brand.name, "url": brand.baseUrl, "logo": { "@type": "ImageObject", "url": `${brand.baseUrl}/logo.png` } },
    "mainEntityOfPage": { "@type": "WebPage", "@id": `${brand.baseUrl}/salary-guide` }
  };

  const sanitizeJson = (obj: object): string => {
    return JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  };

  return (
    <>
      <VideoJsonLd pathname="/salary-guide" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: sanitizeJson(faqSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: sanitizeJson(articleSchema) }} />
      <BreadcrumbSchema items={[
        { name: "Home", url: brand.baseUrl },
        { name: "Salary Guide", url: `${brand.baseUrl}/salary-guide` }
      ]} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: sanitizeJson({
        "@context": "https://schema.org", "@type": "WebPage",
        "name": GUIDE_NAME,
        "speakable": { "@type": "SpeakableSpecification", "cssSelector": [".quick-answer-box", "h1"] },
        "url": `${brand.baseUrl}/salary-guide`
      }) }} />

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 1: HERO BENTO (warm cream bg)
          ═══════════════════════════════════════════════════════════════ */}
      <div style={{ background: 'linear-gradient(180deg, #FFF5EE 0%, #FDE8D8 40%, #FFF5EE 100%)', paddingBottom: '64px' }}>
        <section style={{ maxWidth: '1100px', margin: '0 auto', padding: '80px 20px 0' }}>
          {/* Title */}
          <div style={{ textAlign: 'center', marginBottom: '40px' }}>
            <p style={{ fontSize: '13px', fontWeight: 600, color: '#BE185D', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '8px' }}>
              {/* The eyebrow names the data's own vintage, never the
                  render-time year (it printed new Date().getFullYear()). */}
              BLS {NATIONAL_SALARY_VINTAGE} Wage Data
            </p>
            <h1 className="font-lora" style={{
              fontSize: 'clamp(2rem, 5vw, 3rem)', fontWeight: 800, lineHeight: 1.15,
              color: '#1A2E35', marginBottom: '16px',
            }}>
              {GUIDE_NAME}
            </h1>
            <p style={{ fontSize: '17px', color: '#5A4A42', maxWidth: '600px', margin: '0 auto', lineHeight: 1.6 }}>
              National median <strong>{NATIONAL_SALARY.formatted}</strong> per year (BLS OEWS, {NATIONAL_SALARY_VINTAGE}).
            </p>
            {/* The trust line: the real review date (a literal, never render
                time) and the day the live figures describe. */}
            <p style={{ fontSize: '12.5px', color: '#7A6A62', margin: '10px auto 0' }}>
              Reviewed {REVIEWED_LABEL}.{asOfLabel ? ` Live advertised pay recomputed daily, as of ${asOfLabel}.` : ''}
            </p>
            {/* CQ-12: the visible authorship line, matching the Article
                JSON-LD below (the editorial team until a named author or
                reviewer is configured in brand.editorial). */}
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <EditorialByline variant="hero" />
            </div>
          </div>

          {/* ─── Bento Grid ───
              Grid template columns + child spans live in the stylesheet below
              so the @media (max-width: 768px) rules can collapse to a single
              column without fighting !important against inline styles.
              `minWidth: 0` on children prevents intrinsic min-content from
              blowing the row past the viewport on narrow screens. */}
          <div className="sal-hero-bento" style={{ display: 'grid', gap: '14px' }}>

            {/* Calculator (8 cols on desktop, full row on mobile) */}
            <div className="sal-hero-calc" style={{ minWidth: 0 }}>
              <SalaryCalculator
                stateSalaries={calculatorStates(snapshot)}
                national={calculatorNational}
              />
            </div>

            {/* Right sidebar (4 cols on desktop, full row on mobile): Stats + PDF */}
            <div className="sal-hero-sidebar" style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '14px' }}>

              {/* Stat pills — vertical stack */}
              <div className="emp-bento-card" style={{
                ...clayCard, padding: '24px 22px', flex: 1,
                display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '14px',
              }}>
                <h3 style={{ fontSize: '13px', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>Key Numbers</h3>
                {[
                  { value: `$${NATIONAL_SALARY_K}K`, label: 'National Median', bg: '#D4F5E9', color: '#065F46' },
                  { value: `$${P10_K}K`, label: '10th percentile wage', bg: '#E0E7FF', color: '#3730A3' },
                  { value: `$${P90_K}K`, label: '90th percentile wage', bg: '#FEF3C7', color: '#92400E' },
                  { value: NP_GROWTH.formatted, label: 'Job Growth', bg: '#FFE0D3', color: '#7C2D12' },
                ].map(s => (
                  <div key={s.label} className="sal-stat-pill" style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '10px 16px', borderRadius: '14px',
                    background: s.bg,
                    boxShadow: '3px 3px 8px rgba(0,0,0,0.04), inset 1px 1px 2px rgba(255,255,255,0.5)',
                  }}>
                    <span style={{ fontSize: '20px', fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</span>
                    <span style={{ fontSize: '12px', color: s.color, fontWeight: 500 }}>{s.label}</span>
                  </div>
                ))}
              </div>

              {/* PDF download card — gated until the PDF deliverable is
                  real (audit P0 #6): the email funnel previously promised
                  a PDF whose storage object 404s. Flip the flag in
                  app/api/salary-guide/pdf-availability.ts once uploaded. */}
              {SALARY_GUIDE_PDF_AVAILABLE && (
                <div className="emp-bento-card" style={{
                  ...clayCard, padding: '20px', background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)',
                  border: '1.5px solid rgba(190,24,93,0.12)',
                }}>
                  <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#831843', margin: '0 0 10px' }}>Download the Free PDF Guide</h3>
                  <SalaryGuideForm />
                  {/* Must list only what the delivered PDF's Methodology
                      section actually cites (scripts/generate-salary-pdf.ts →
                      methodologySources = the four STAT_SOURCES entries, plus
                      this board's own live postings). Commercial aggregators
                      were named here but appear nowhere in the artifact —
                      unsourced attribution on a YMYL page. Guarded by
                      tests/regressions/p1-salary-pdf-copy-truth.test.ts. */}
                  <p style={{ fontSize: '10px', color: '#64748B', marginTop: '8px', marginBottom: 0 }}>
                    Sources: BLS OEWS, BLS Employment Projections, AANP, HRSA, and live {brand.name} postings
                  </p>
                </div>
              )}
            </div>

            {/* Quick Answer (full-width 12 cols) */}
            <div className="quick-answer-box emp-bento-card" style={{
              ...clayCard, gridColumn: 'span 12', padding: '28px 32px',
              border: '2px solid rgba(190,24,93,0.10)',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', marginBottom: '20px' }}>
                <div style={{
                  width: '44px', height: '44px', borderRadius: '14px', background: '#D4E2D4',
                  color: '#1E3A5F', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <DollarSign size={24} />
                </div>
                <div>
                  <h2 className="font-lora" style={{ fontSize: '18px', fontWeight: 700, color: '#1A2E35', margin: '0 0 8px' }}>Quick Answer: How Much Do {brand.niche.long}s Make?</h2>
                  {/* SEO/AEO release 2026-10: the block answer engines lift
                      now carries ONLY cited figures: the OEWS median and the
                      10th and 90th percentiles, all read from STAT_SOURCES,
                      named as a median and percentiles (never an average),
                      and linked to the BLS source. The editorial ranges it
                      used to print are gone from the page (salary build
                      2026-11), replaced by the BLS state table and the
                      advertised pay sections below. The PDF's Quick Answer card
                      (scripts/generate-salary-pdf.ts) prints the same three
                      figures since the 2026-10-13 regeneration, and
                      tests/regressions/p1-salary-pdf-deliverable.test.ts
                      pins the two together. */}
                  <p style={{ fontSize: '14px', color: '#5A4A42', lineHeight: 1.7, margin: 0 }}>
                    The median {brand.niche.descriptor} salary is <strong>{NATIONAL_SALARY.formatted} per year</strong>, according to
                    the{' '}
                    <a href={NATIONAL_SALARY.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#BE185D', fontWeight: 600 }}>
                      Bureau of Labor Statistics wage survey for {NATIONAL_SALARY_VINTAGE}
                    </a>
                    . Half of {brand.niche.short} wages sit above the median and half below. The 10th percentile
                    wage is <strong>{NATIONAL_P10.formatted}</strong>, and the 90th percentile wage
                    is <strong>{NATIONAL_P90.formatted}</strong>.
                  </p>
                  <p style={{ fontSize: '14px', color: '#5A4A42', lineHeight: 1.7, margin: '10px 0 0' }}>
                    State medians run from {formatBlsDollars(LOWEST_PAYING_STATES[0].annualMedian)} in {LOWEST_PAYING_STATES[0].state} to{' '}
                    {formatBlsDollars(TOP_PAYING_STATES[0].annualMedian)} in {TOP_PAYING_STATES[0].state} in the same survey: see{' '}
                    <a href="#salary-by-state" style={{ color: '#BE185D', fontWeight: 600 }}>the table for every state</a>.
                    For the pay employers advertise now, the same table carries the live median for each state, and the{' '}
                    <Link href={NP_PAY_REPORT_PATH} style={{ color: '#BE185D', fontWeight: 600 }}>
                      NP Pay Report
                    </Link>
                    {' '}covers advertised pay on {brand.name} in full. Our{' '}
                    <Link href={PAY_TRANSPARENCY_REPORT.path} style={{ color: '#BE185D', fontWeight: 600 }}>
                      pay transparency report
                    </Link>
                    {' '}shows how many postings disclose a pay range.
                  </p>
                  <p style={{ fontSize: '12px', color: '#6B5B53', lineHeight: 1.6, margin: '10px 0 0' }}>
                    {HUB_FIGURES_NOTE}
                  </p>
                  {/* A4 (teardown parity): the date-stamp, assembled honestly:
                      cited vintage from STAT_SOURCES, the live basis in
                      employers from the snapshot that already ran, the
                      review date a literal (never render time; P0 #23). */}
                  <SalaryProvenance
                    cited={[NATIONAL_SALARY, NATIONAL_P10, NATIONAL_P90]}
                    live={nationalPublished ? { count: nationalPublished.employers as number, minimum: BENCHMARK_MIN_EMPLOYERS, noun: 'employers that disclose pay in live postings' } : undefined}
                    reviewedOn={LAST_REVIEWED_DATE}
                    style={{ fontSize: '11px', color: '#64748B', marginTop: '6px' }}
                  />
                </div>
              </div>
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px',
                paddingTop: '18px', borderTop: '1px solid rgba(0,0,0,0.06)',
              }} className="sal-quick-stats">
                {[
                  { value: NATIONAL_SALARY.formatted, label: 'National Median (BLS)', color: '#BE185D' },
                  { value: NATIONAL_P90.formatted, label: '90th Percentile Wage (BLS)', color: '#BE185D' },
                  { value: NP_GROWTH.formatted, label: 'Job Growth by 2035', color: '#B45309' },
                  // The posted-pay sample is counted in employers, each once;
                  // without live data the tile shows the BLS employment count.
                  nationalPublished
                    ? { value: (nationalPublished.employers as number).toLocaleString('en-US'), label: 'Employers Disclosing Pay', color: '#B45309' }
                    : { value: formatBlsCount(BLS_NATIONAL.np.employment), label: 'NPs Employed (BLS)', color: '#B45309' },
                ].map(s => (
                  <div key={s.label} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '20px', fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
                    <div style={{ fontSize: '11px', color: '#64748B', marginTop: '4px' }}>{s.label}</div>
                  </div>
                ))}
              </div>
            </div>

          </div>

          <GuidePromo
            slug="compensation-report"
            heading="Want every state and setting in one report?"
            pitch="A state by state pay table for all 50 states and DC, pay by specialty and setting, W-2 vs. 1099 math and a negotiation method built on the data."
            style={{ maxWidth: '900px', margin: '40px auto 0' }}
          />
        </section>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 2: BLS WAGES BY STATE (white bg)
          All 50 states and DC from the BLS OEWS May 2025 state file
          (lib/salary-guide-bls-states.ts). Every cell is a BLS figure or
          the BLS footnote label, never a number BLS did not publish, and
          the caption names the source and vintage. A state links its own
          salary page and its jobs only where it has active jobs, because
          /salary-guide/[state] 404s at zero.
          ═══════════════════════════════════════════════════════════════ */}
      <section id="salary-by-state" style={{ background: '#FFFFFF', padding: '80px 20px' }}>
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#BE185D', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>
            BLS Wage Data by State
          </p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.5vw, 32px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '12px' }}>
            {brand.niche.long} Salary by State (BLS, {BLS_OEWS_REFERENCE_PERIOD})
          </h2>
          <p style={{ fontSize: '14px', color: '#5A4A42', lineHeight: 1.65, textAlign: 'center', maxWidth: '720px', margin: '0 auto 28px' }}>
            Median annual wage for {brand.niche.descriptor}s in each state and DC, from the BLS Occupational Employment and Wage Statistics survey ({BLS_OEWS_REFERENCE_PERIOD}), sorted from the highest state median to the lowest.
            {snapshot ? ` Where at least ${BENCHMARK_MIN_EMPLOYERS} employers disclose pay in live postings, the live column shows the median advertised pay, each employer counted once.` : ''}
          </p>

          <div className="emp-compare-table" style={{ ...clayCard, padding: 0, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <caption style={{ captionSide: 'bottom', textAlign: 'left', padding: '12px 16px', fontSize: '11.5px', color: '#64748B', lineHeight: 1.5 }}>
                Source: {BLS_STATE_SOURCE_LABEL}, state estimates (
                <a href={BLS_STATE_SOURCE_URL} rel="noopener noreferrer" style={{ color: '#BE185D', fontWeight: 600 }}>BLS state file</a>
                ). The national median in the same survey is {NATIONAL_SALARY.formatted}.
              </caption>
              <thead>
                <tr style={{ background: 'linear-gradient(135deg, rgba(190,24,93,0.08), rgba(190,24,93,0.02))' }}>
                  <th scope="col" style={{ ...blsHeadCell, textAlign: 'left', paddingLeft: '20px' }}>State</th>
                  <th scope="col" style={blsHeadCell}>Median annual wage</th>
                  <th scope="col" className="sal-bls-optional" style={blsHeadCell}>Median hourly wage</th>
                  <th scope="col" className="sal-bls-optional" style={blsHeadCell}>10th to 90th percentile</th>
                  <th scope="col" className="sal-bls-optional" style={blsHeadCell}>{brand.niche.short} employment</th>
                  {snapshot && <th scope="col" style={blsHeadCell}>Live advertised median</th>}
                  <th scope="col" style={blsHeadCell}>Open jobs</th>
                </tr>
              </thead>
              <tbody>
                {BLS_TABLE_ROWS.map((row, i) => {
                  const jobs = activeJobsByState.get(row.state) ?? 0;
                  const live = liveByState.get(row.state);
                  return (
                    <tr key={row.state} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.015)' }}>
                      <th scope="row" style={{ ...blsCell, textAlign: 'left', paddingLeft: '20px', fontWeight: 600, color: '#1A2E35' }}>
                        {jobs > 0 ? (
                          <Link href={`/salary-guide/${row.slug}`} className="sal-state-link" style={{ color: '#1A2E35', textDecoration: 'none' }}>
                            {row.state}
                          </Link>
                        ) : row.state}
                      </th>
                      <td style={{ ...blsCell, fontWeight: 700, color: '#1A2E35' }}>{formatBlsDollars(row.annualMedian)}</td>
                      <td className="sal-bls-optional" style={{ ...blsCell, color: '#5A4A42' }}>{formatBlsHourly(row.hourlyMedian)}</td>
                      <td className="sal-bls-optional" style={{ ...blsCell, color: '#5A4A42', fontSize: '12px' }}>
                        {row.annualP10.value !== null && row.annualP90.value !== null
                          ? `${formatBlsDollars(row.annualP10)} to ${formatBlsDollars(row.annualP90)}`
                          : `${formatBlsDollars(row.annualP10)}; ${formatBlsDollars(row.annualP90)}`}
                      </td>
                      <td className="sal-bls-optional" style={{ ...blsCell, color: '#5A4A42' }}>{formatBlsCount(row.employment)}</td>
                      {snapshot && (
                        <td style={{ ...blsCell, color: '#5A4A42', fontSize: '12px' }}>
                          {live && live.median !== null && live.employers !== null ? (
                            <>
                              <span style={{ fontWeight: 700, color: '#1A2E35', fontSize: '13px' }}>{usd(live.median)}</span>
                              <span style={{ display: 'block', fontSize: '11px', color: '#64748B' }}>{live.employers} employers</span>
                            </>
                          ) : `Fewer than ${BENCHMARK_MIN_EMPLOYERS} employers`}
                        </td>
                      )}
                      <td style={blsCell}>
                        {jobs > 0 ? (
                          <Link href={`/jobs/state/${row.slug}`} style={{ fontSize: '12px', color: '#BE185D', fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                            {jobs.toLocaleString('en-US')} <ArrowUpRight size={12} />
                          </Link>
                        ) : (
                          <span style={{ fontSize: '12px', color: '#64748B' }}>None open</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* The highest and lowest paying states, five each, from the same
              rows: one generated sentence per state, figures and comparison
              read from the module. */}
          <div className="sal-rank-grid" style={{ display: 'grid', gap: '16px', marginTop: '28px' }}>
            {[
              { id: 'highest-paying-states', title: `Highest Paying States for ${brand.niche.long}s`, rows: TOP_PAYING_STATES },
              { id: 'lowest-paying-states', title: `Lowest Paying States for ${brand.niche.long}s`, rows: LOWEST_PAYING_STATES },
            ].map((group) => (
              <div key={group.id} id={group.id} style={{ ...clayCard, padding: '22px 24px' }}>
                <h2 className="font-lora" style={{ fontSize: '19px', fontWeight: 700, color: '#1A2E35', margin: '0 0 12px' }}>{group.title}</h2>
                <ol style={{ margin: 0, paddingLeft: '20px', fontSize: '13.5px', color: '#5A4A42', lineHeight: 1.65 }}>
                  {group.rows.map((row) => (
                    <li key={row.state} style={{ marginBottom: '6px' }}>{blsRankSentence(row)}</li>
                  ))}
                </ol>
                <p style={{ fontSize: '11.5px', color: '#64748B', margin: '10px 0 0' }}>{BLS_STATE_SOURCE_LABEL}, median annual wage.</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 3: ADVERTISED PAY ON LIVE POSTINGS (cream bg)
          The measured breakdowns that replaced the editorial estimate
          tables (experience, setting, specialty premiums): the NP Pay
          Report snapshot, rows at the engine's median tier only.
          ═══════════════════════════════════════════════════════════════ */}
      {snapshot && asOfLabel && <AdvertisedPaySection snapshot={snapshot} asOfLabel={asOfLabel} />}

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 4: SPECIALTY GUIDES AND PRACTICE AUTHORITY (white bg)
          ═══════════════════════════════════════════════════════════════ */}
      <section style={{ background: '#FFFFFF', padding: '64px 20px' }}>
        <div className="sal-bento" style={{ maxWidth: '1100px', margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '14px' }}>

          {/* Specialty guides (6 cols): config-driven, one array feeds these
              chips, the specialty index hub and the sitemap (P1 #7). */}
          <div className="sal-bento-spec emp-bento-card" style={{ ...clayCard, gridColumn: 'span 6', padding: '24px 22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
              <div style={{ width: '44px', height: '44px', borderRadius: '14px', background: '#D4E2D4', color: '#1E3A5F', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Star size={22} />
              </div>
              <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#1A2E35', margin: 0 }}>Salary Guides by Specialty</h3>
            </div>
            <p style={{ fontSize: '13px', color: '#5A4A42', lineHeight: 1.6, margin: '0 0 14px' }}>
              Each specialty guide carries the BLS context for the role, the open roles and, where at least {BENCHMARK_MIN_EMPLOYERS} employers disclose pay, the median advertised pay for that specialty.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 10px' }}>
              {SALARY_SPECIALTY_PAGES.map(p => (
                <Link key={p.slug} href={`/salary-guide/specialty/${p.slug}`} className="sal-state-link" style={{ fontSize: '12px', fontWeight: 600, color: '#BE185D', textDecoration: 'none' }}>
                  {p.credential ?? p.label}
                </Link>
              ))}
              <Link href="/salary-guide/specialty" className="sal-state-link" style={{ fontSize: '12px', fontWeight: 700, color: '#1E3A5F', textDecoration: 'none' }}>
                Compare all specialties
              </Link>
            </div>
          </div>

          {/* FPA Impact (6 cols) */}
          <div className="sal-bento-fpa emp-bento-card" style={{
            ...clayCard, gridColumn: 'span 6', padding: '24px 22px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
              <div style={{ width: '44px', height: '44px', borderRadius: '14px', background: '#D4E2D4', color: '#1E3A5F', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <TrendingUp size={22} />
              </div>
              <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#1A2E35', margin: 0 }}>Full Practice Authority</h3>
            </div>
            <p style={{ fontSize: '13px', color: '#5A4A42', lineHeight: 1.6, margin: '0 0 16px' }}>
              {/* P2 #22 follow-up: no FPA pay premium is claimed here; none is
                  cited anywhere. What practice authority controls is
                  readable off lib/state-practice-authority.ts.
                  scripts/generate-salary-pdf.ts mirrors this block and must
                  be edited with it. */}
              <strong>{FPA_STATES.formatted}</strong> grant FPA ({FPA_STATES.source}). Practice authority is a legal classification, not a pay scale. It decides which kinds of practice and contract work are open to you in that state.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div style={{ padding: '14px 16px', borderRadius: '14px', background: '#FDF2F8', border: '1px solid #FBCFE8' }}>
                <h4 style={{ fontSize: '13px', fontWeight: 700, color: '#BE185D', margin: '0 0 8px' }}>✓ Full Practice Authority</h4>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: '11.5px', color: '#5A4A42' }}>
                  {/* The panels describe the TIERS, so each carries the
                      within-tier caveat the verified per-state details
                      demand. The PDF mirrors these lines. */}
                  <li style={{ marginBottom: '3px' }}>• Own and bill under your own practice</li>
                  <li style={{ marginBottom: '3px' }}>• Independent 1099 and telehealth work</li>
                  <li>• Several states first require a transition period</li>
                </ul>
              </div>
              <div style={{ padding: '14px 16px', borderRadius: '14px', background: 'rgba(0,0,0,0.02)', border: '1px solid rgba(0,0,0,0.06)' }}>
                <h4 style={{ fontSize: '13px', fontWeight: 700, color: '#64748B', margin: '0 0 8px' }}>Restricted / Reduced</h4>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: '11.5px', color: '#5A4A42' }}>
                  <li style={{ marginBottom: '3px' }}>• Most require an agreement, supervision or delegation first</li>
                  <li style={{ marginBottom: '3px' }}>• That agreement is usually a paid one</li>
                  <li>• Several offer a route out after a set amount of experience</li>
                </ul>
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 5: MARKET DEMAND (slate bg)
          Audit P0 #22: the former "Market Trends" table (invented monthly
          posting counts, telehealth share, and time-to-fill trend rows)
          was fabricated — those figures appear nowhere in
          lib/stats-sources.ts or any cited source, so the table was
          deleted. Only sourced claims remain. Do not re-add trend rows
          without a citable source.
          ═══════════════════════════════════════════════════════════════ */}
      <section style={{ background: 'linear-gradient(180deg, #F1F5F9 0%, #E8EDF2 50%, #F1F5F9 100%)', padding: '80px 20px' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#BE185D', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>
            Market Intelligence
          </p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.5vw, 32px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '36px' }}>
            Why {brand.niche.short} Demand Is High
          </h2>

          <div style={{ ...clayCard, padding: '22px 28px', background: '#FDF2F8', border: '1px solid #FBCFE8' }}>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexWrap: 'wrap', gap: '8px 24px', fontSize: '13px', color: '#5A4A42' }}>
              <li>• <strong>{SHORTAGE_POP.formatted}</strong> Americans live in primary-care shortage areas (HRSA)</li>
              <li>• <strong>{NP_GROWTH.formatted}</strong> projected NP job growth through 2035 (BLS)</li>
            </ul>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 6: FACTORS (cream bg)
          ═══════════════════════════════════════════════════════════════ */}
      <div style={{ background: 'linear-gradient(180deg, #FFF5EE 0%, #FDE8D8 50%, #FFF5EE 100%)', padding: '80px 20px' }}>
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#BE185D', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>
            Maximize Your Pay
          </p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.5vw, 32px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '36px' }}>
            Factors Affecting {brand.niche.short} Salary
          </h2>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
            {factorCards.map(card => (
                <div key={card.title} className="emp-bento-card" style={{ ...clayCard, padding: '28px 24px' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- exact-DPR ladder; next/image resample blurs this art */}
                  <img
                    src={card.img.replace(/\.webp$/, '-96.webp')}
                    srcSet={ladderSrcSet(card.img, FACTOR_LADDER)}
                    sizes="48px"
                    alt={card.title}
                    width={48} height={48}
                    loading="lazy" decoding="async"
                    style={{ width: '48px', height: '48px', borderRadius: '14px', marginBottom: '16px' }}
                  />
                  <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#1A2E35', margin: '0 0 8px' }}>{card.title}</h3>
                  <p style={{ fontSize: '13px', color: '#5A4A42', lineHeight: 1.6, margin: 0 }}>{card.desc}</p>
                </div>
            ))}
          </div>
          {/* CQ-13: the long-form companion to these cards. */}
          <p style={{ fontSize: '14px', color: '#5A4A42', textAlign: 'center', margin: '24px 0 0' }}>
            How each factor shows up in a real offer:{' '}
            <Link href="/blog/np-salary-guide" style={{ color: '#BE185D', fontWeight: 600 }}>
              What moves NP pay
            </Link>
          </p>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 7: FAQ (white bg)
          ═══════════════════════════════════════════════════════════════ */}
      <section style={{ padding: '80px 20px', background: '#fff' }}>
        <div style={{ maxWidth: '700px', margin: '0 auto' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#BE185D', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>
            Common Questions
          </p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3vw, 32px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '32px' }}>
            Frequently Asked Questions
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {faqs.map(({ q, a }) => (
              <details key={q} style={{ ...clayCard, padding: 0, overflow: 'hidden' }}>
                <summary style={{
                  padding: '18px 24px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: '12px',
                  fontSize: '15px', fontWeight: 600, color: '#1A2E35', listStyle: 'none',
                }}>
                  <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: '#D4E2D4', color: '#1E3A5F', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <HelpCircle size={16} />
                  </div>
                  {q}
                </summary>
                <div style={{ padding: '0 24px 18px 64px', fontSize: '14px', color: '#5A4A42', lineHeight: 1.65 }}>{a}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 8: METHODOLOGY, CITATION + CTA (slate bg)
          The methodology states the pool, the exclusions, the counting
          rule, the tiers, the rounding, the BLS series and what the figures
          are not; the citation block sits under it.
          ═══════════════════════════════════════════════════════════════ */}
      <section id="methodology" style={{ background: 'linear-gradient(180deg, #F1F5F9 0%, #E8EDF2 50%, #F1F5F9 100%)', padding: '80px 20px' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
          <div style={{ ...clayCard, padding: '28px 32px', marginBottom: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: '#D4E2D4', color: '#1E3A5F', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Ruler size={20} />
              </div>
              <h2 className="font-lora" style={{ fontSize: '22px', fontWeight: 700, color: '#1A2E35', margin: 0 }}>Methodology</h2>
            </div>
            <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '13.5px', color: '#5A4A42', lineHeight: 1.7 }}>
              <li><strong>BLS figures.</strong> {BLS_STATE_SOURCE_LABEL}: the national median and percentiles and the state estimates (<a href={BLS_STATE_SOURCE_URL} rel="noopener noreferrer" style={{ color: '#BE185D' }}>BLS state file</a>, <a href={NATIONAL_SALARY.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#BE185D' }}>national data</a>). They are survey estimates of wages paid in jobs people hold, published once a year.</li>
              <li><strong>Advertised pay.</strong> Live {brand.niche.short} postings on {brand.name} that state an annual pay range: published, not expired and passing the dead-link check. Left out: pay the employer did not state, hourly, daily or weekly rates, parsing confidence below 0.8, a single figure with no range, a midpoint outside {usd(SALARY_SANITY_MIN)} to {usd(SALARY_SANITY_MAX)}, a range wider than {MAX_RANGE_RATIO} to 1, and roles that are not {brand.niche.short} roles, including CRNA, CNM and CNS postings.</li>
              <li><strong>Counting.</strong> {ONE_EMPLOYER_NOTE} {TIER_RULE_NOTE}</li>
              <li><strong>Rounding.</strong> Advertised figures round to the nearest $500 and are recomputed daily{asOfLabel ? `, last on ${asOfLabel}` : ''}.</li>
              <li><strong>What the figures are not.</strong> Advertised pay is what employers post, not what anyone is paid, and this board&apos;s postings are not a census or a survey. The full breakdown, with a CSV, is in the <Link href={NP_PAY_REPORT_PATH} style={{ color: '#BE185D', fontWeight: 600 }}>NP Pay Report</Link>.</li>
            </ul>
            <p style={{ fontSize: '12px', color: '#64748B', margin: '14px 0 0', lineHeight: 1.6 }}>
              {/* Each source links its STAT_SOURCES sourceUrl, so the main
                  content cites the primary source behind every figure. */}
              <strong>Other sources:</strong>{' '}
              <a href={NP_GROWTH.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#475569' }}>BLS Employment Projections</a>,{' '}
              <a href={SHORTAGE_POP.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#475569' }}>HRSA</a> and{' '}
              <a href={FPA_STATES.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#475569' }}>AANP</a>. Page last reviewed {REVIEWED_LABEL}.
            </p>
            <p style={{ fontSize: '12.5px', color: '#5A4A42', margin: '12px 0 0', lineHeight: 1.6 }}>
              Related guides:{' '}
              <Link href="/resources/what-is-a-nurse-practitioner" style={{ color: '#BE185D', fontWeight: 600 }}>What is a nurse practitioner</Link>,{' '}
              <Link href="/resources/np-vs-pa" style={{ color: '#BE185D', fontWeight: 600 }}>NP vs PA</Link> and{' '}
              <Link href="/resources/1099-vs-w2" style={{ color: '#BE185D', fontWeight: 600 }}>1099 vs W-2</Link>.
            </p>
          </div>

          {/* Citation, under the methodology it rests on */}
          <div style={{ ...clayCard, padding: '24px 28px', marginBottom: '24px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#1A2E35', margin: '0 0 14px' }}>Cite This Page</h3>
            <CopyCitation citation={`${brand.name}. "${GUIDE_NAME}." ${brand.name}, last reviewed ${REVIEWED_LABEL}, ${brand.domain}/salary-guide.`} />
            <p style={{ fontSize: '11px', color: '#64748B', marginTop: '10px' }}>For media inquiries or custom data requests, contact {brand.email.press}</p>
          </div>

          {/* CTA */}
          <div className="sal-cta-grid emp-bento-card" style={{
            ...clayCard, padding: '0', overflow: 'hidden',
            display: 'grid', gridTemplateColumns: '1fr 320px', alignItems: 'center',
          }}>
            <div style={{ padding: '36px 32px' }}>
              <h2 className="font-lora" style={{ fontSize: '22px', fontWeight: 700, color: '#1A2E35', margin: '0 0 20px' }}>
                Find Your Next High-Paying{' '}
                <span style={{ color: '#BE185D' }}>{brand.niche.short} Job</span>
              </h2>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                <Link href="/jobs" className="emp-cta-primary" style={{
                  padding: '12px 24px', borderRadius: '12px', fontWeight: 700, fontSize: '14px',
                  background: 'linear-gradient(145deg, #BE185D, #9D174D)', color: '#fff',
                  textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '8px',
                  boxShadow: '4px 4px 12px rgba(190,24,93,0.2), inset 1px 1px 2px rgba(255,255,255,0.15)',
                }}>
                  Browse All Jobs <ArrowRight size={15} />
                </Link>
                {[
                  { label: 'Remote', href: '/jobs/remote' },
                  { label: 'Telehealth', href: '/jobs/telehealth' },
                  { label: 'Travel', href: '/jobs/travel' },
                ].map(l => (
                  <Link key={l.label} href={l.href} className="emp-cta-secondary" style={{
                    padding: '12px 18px', borderRadius: '12px', fontWeight: 600, fontSize: '13px',
                    background: '#fff', color: '#1A2E35', textDecoration: 'none',
                    display: 'inline-flex', alignItems: 'center',
                    border: '1px solid rgba(0,0,0,0.08)',
                    boxShadow: '2px 2px 6px rgba(0,0,0,0.04)',
                  }}>
                    {l.label}
                  </Link>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', padding: '24px', background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)' }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- exact-DPR ladder; next/image resample blurs this art */}
              <img
                src="/images/employers/cta-illustration-v2-520.webp"
                srcSet={ladderSrcSet('/images/employers/cta-illustration-v2.webp', [260, 325, 390, 455, 520, 585, 650, 780])}
                sizes="260px"
                alt={`Find high-paying ${brand.niche.short} jobs`}
                width={260} height={260}
                loading="lazy" decoding="async"
                style={{ width: '100%', maxWidth: '260px', height: 'auto', borderRadius: '14px', display: 'block' }}
              />
            </div>
          </div>
        </div>
      </section>

      {/* ═══ Responsive + Hover ═══ */}
      <style>{`
        /* Mobile-first: single column. Desktop bumps to 12-track bento via media query below. */
        .sal-hero-bento { grid-template-columns: 1fr; }
        .sal-hero-calc { grid-column: span 1; }
        .sal-hero-sidebar { grid-column: span 1; }
        @media (min-width: 769px) {
          .sal-hero-bento { grid-template-columns: repeat(12, 1fr); }
          .sal-hero-calc { grid-column: span 8; }
          .sal-hero-sidebar { grid-column: span 4; }
          .sal-rank-grid { grid-template-columns: 1fr 1fr; }
          .sal-pay-grid { grid-template-columns: 1fr 1fr; }
        }
        @media (max-width: 768px) {
          .sal-bls-optional { display: none; }
        }
        .emp-cta-primary {
          transition: transform 0.25s ease, box-shadow 0.25s ease, filter 0.25s ease;
        }
        .emp-cta-primary:hover {
          transform: translateY(-3px);
          box-shadow: 0 10px 32px rgba(190,24,93,0.35), inset 1px 1px 2px rgba(255,255,255,0.2) !important;
          filter: brightness(1.05);
        }
        .emp-cta-secondary {
          transition: transform 0.25s ease, box-shadow 0.25s ease, border-color 0.25s ease;
        }
        .emp-cta-secondary:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(0,0,0,0.08) !important;
          border-color: rgba(190,24,93,0.3) !important;
        }
        .emp-bento-card {
          transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
        .emp-bento-card:hover {
          transform: translateY(-4px);
          box-shadow: 8px 8px 24px rgba(0,0,0,0.1), -4px -4px 12px rgba(255,255,255,0.9), inset 1px 1px 2px rgba(255,255,255,0.6) !important;
        }
        .emp-compare-table tr {
          transition: background 0.2s ease;
        }
        .emp-compare-table tbody tr:hover {
          background: rgba(190,24,93,0.04) !important;
        }
        .sal-state-link:hover {
          color: #BE185D !important;
          text-decoration: underline !important;
        }
        .sal-stat-pill {
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .sal-stat-pill:hover {
          transform: translateY(-2px) scale(1.02);
          box-shadow: 6px 6px 20px rgba(0,0,0,0.1), -3px -3px 10px rgba(255,255,255,0.9) !important;
        }

        @media (max-width: 768px) {
          .sal-hero-bento .quick-answer-box { grid-column: span 1 !important; }
          .sal-bento { grid-template-columns: 1fr !important; }
          .sal-bento > div { grid-column: span 1 !important; }
          .sal-cta-grid { grid-template-columns: 1fr !important; }
          .sal-quick-stats { grid-template-columns: repeat(2, 1fr) !important; }
          .sal-range-col { display: none; }
          .sal-roles-col { display: none; }
        }
        @media (min-width: 769px) and (max-width: 1024px) {
          .sal-hero-calc { grid-column: span 7 !important; }
          .sal-hero-sidebar { grid-column: span 5 !important; }
          .sal-bento { grid-template-columns: repeat(6, 1fr) !important; }
          .sal-bento-exp { grid-column: span 6 !important; }
          .sal-bento-setting { grid-column: span 6 !important; }
          .sal-bento-spec { grid-column: span 6 !important; }
          .sal-bento-fpa { grid-column: span 6 !important; }
        }
      `}</style>
    </>
  );
}
