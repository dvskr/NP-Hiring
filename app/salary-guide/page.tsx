import { brand } from '@/config/brand';
import { Metadata } from 'next';
import VideoJsonLd from '@/components/VideoJsonLd';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowUpRight, ArrowRight } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import SalaryGuideForm from '@/components/SalaryGuideForm';
import BreadcrumbSchema from '@/components/BreadcrumbSchema';
import CopyCitation from '@/components/CopyCitation';
import SalaryCalculator from '@/components/SalaryCalculator';

const STORAGE_BASE = brand.assets.storageBase;

// Enable ISR with daily revalidation
export const revalidate = 86400;

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || brand.baseUrl;

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

interface StateSalary {
  state: string;
  stateCode: string;
  avgSalary: number;
  minSalary: number;
  maxSalary: number;
  jobCount: number;
  slug: string;
}

async function getSalaryByState(): Promise<StateSalary[]> {
  const stateData = await prisma.job.groupBy({
    by: ['state'],
    where: {
      isPublished: true,
      state: { not: null },
      normalizedMinSalary: { not: null },
    },
    _avg: { normalizedMinSalary: true, normalizedMaxSalary: true },
    _min: { normalizedMinSalary: true },
    _max: { normalizedMaxSalary: true },
    _count: { id: true },
  });

  return stateData
    .filter(s => s.state && s._avg.normalizedMinSalary)
    .map(s => ({
      state: s.state!,
      stateCode: STATE_CODES[s.state!] || '',
      avgSalary: Math.round(((s._avg.normalizedMinSalary || 0) + (s._avg.normalizedMaxSalary || 0)) / 2),
      minSalary: Math.round(s._min.normalizedMinSalary || 0),
      maxSalary: Math.round(s._max.normalizedMaxSalary || 0),
      jobCount: s._count.id,
      slug: s.state!.toLowerCase().replace(/\s+/g, '-'),
    }))
    .sort((a, b) => b.avgSalary - a.avgSalary);
}

async function getOverallStats() {
  const stats = await prisma.job.aggregate({
    where: { isPublished: true, normalizedMinSalary: { not: null } },
    _avg: { normalizedMinSalary: true, normalizedMaxSalary: true },
    _min: { normalizedMinSalary: true },
    _max: { normalizedMaxSalary: true },
    _count: { id: true },
  });

  const avgMin = stats._avg.normalizedMinSalary || 120000;
  const avgMax = stats._avg.normalizedMaxSalary || 150000;

  return {
    avgSalary: Math.round((avgMin + avgMax) / 2),
    minSalary: Math.round(stats._min.normalizedMinSalary || 85000),
    maxSalary: Math.round(stats._max.normalizedMaxSalary || 200000),
    jobsWithSalary: stats._count.id,
  };
}

export const metadata: Metadata = {
  // `absolute` opts out of the layout title template so the brand suffix
  // doesn't get appended a second time (was rendering "... | PMHNP Hiring
  // | PMHNP Hiring" — audit 09 M-17).
  title: { absolute: `${brand.niche.short} Salary Guide 2026 — $126K+ Avg by State | ${brand.name}` },
  description: `Complete 2026 ${brand.niche.short} salary data: national avg $126K+, top 10% earn $165K+. All 50 states, by experience level, practice setting, and negotiation tips.`,
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
    title: `${brand.niche.short} Salary Guide 2026 | $126,000+ Average`,
    description: `Complete guide to ${brand.niche.short} salaries. National average $126,000+, top 10% earn $165,000+. State-by-state breakdown and tips to maximize earnings.`,
    type: 'website',
    url: `${BASE_URL}/salary-guide`,
    images: [{ url: `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/pages/pmhnp-salary-guide-2026.webp`, width: 1280, height: 900, alt: `${brand.niche.short} salary guide 2026 showing ${brand.niche.descriptor} pay by state with interactive salary comparison table` }],
  },
  twitter: { card: 'summary_large_image', images: [`${STORAGE_BASE}/storage/v1/object/public/site-assets/images/pages/pmhnp-salary-guide-2026.webp`] },
  alternates: { canonical: `${brand.baseUrl}/salary-guide` },
};

/* ═══ Clay Design Tokens ═══ */
const clayCard: React.CSSProperties = {
  background: '#FFFFFF', borderRadius: '20px',
  border: '1px solid rgba(255,255,255,0.5)',
  boxShadow: '6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02)',
};

/* ═══ Experience / Setting / Specialty data ═══ */
const experienceData = [
  { exp: 'New Grad (0-1 yr)', range: '$95,000 - $115,000', roles: `Staff ${brand.niche.short}, Outpatient Clinic` },
  { exp: 'Early Career (1-3 yrs)', range: '$110,000 - $130,000', roles: `Staff ${brand.niche.short}, Telehealth Provider` },
  { exp: 'Mid-Career (3-7 yrs)', range: '$125,000 - $150,000', roles: `Senior ${brand.niche.short}, Team Lead` },
  { exp: 'Experienced (7-15 yrs)', range: '$150,000 - $180,000', roles: 'Clinical Director, Supervisor' },
  { exp: 'Expert (15+ yrs)', range: '$180,000 - $250,000+', roles: 'Director, Consultant, Private Practice' },
];

const settingData = [
  { setting: 'Private Practice (Owner)', range: '$180,000 - $300,000+', notes: 'Highest earning potential, requires business skills', color: '#BE185D' },
  { setting: 'Travel / Locum Tenens', range: '$150,000 - $250,000', notes: 'Includes housing, travel, higher hourly rates', color: '#8B5CF6' },
  { setting: 'Telehealth / Remote', range: '$130,000 - $180,000', notes: 'Growing rapidly, flexible schedules', color: '#3B82F6' },
  { setting: 'Outpatient Clinic', range: '$120,000 - $160,000', notes: 'Most common setting, steady patient load', color: '#F59E0B' },
  { setting: 'Hospital / Inpatient', range: '$115,000 - $150,000', notes: 'Often includes shift differentials, benefits', color: '#EF4444' },
  { setting: 'Community Health (FQHC)', range: '$100,000 - $130,000', notes: 'May qualify for loan forgiveness programs', color: '#6B7280' },
];

const specialtyData = [
  { specialty: 'Acute Care / Hospitalist', premium: '+10-20%', notes: 'AGACNP certification, hospital demand' },
  { specialty: 'Psychiatric-Mental Health', premium: '+10-20%', notes: 'PMHNP-BC certification, provider shortage' },
  { specialty: 'Emergency / Urgent Care', premium: '+10-20%', notes: 'Dynamic environment, flexible scheduling' },
  { specialty: 'Dermatology / Aesthetics', premium: '+10-25%', notes: 'Procedure-driven, cash-pay revenue' },
  { specialty: 'Gerontology / Palliative', premium: '+5-10%', notes: 'Growing aging population' },
  { specialty: 'Private Practice (Owner)', premium: '+20-40%', notes: 'Higher risk, no benefits' },
  { specialty: 'Rural / Underserved', premium: '+10-15%', notes: 'Often includes loan repayment' },
];

const factorCards = [
  { img: '/images/salary-guide/factor-location.webp', title: 'Geographic Location', desc: 'States with higher cost of living and greater demand (CA, NY, MA) typically offer 20-40% higher salaries than rural areas.' },
  { img: '/images/salary-guide/factor-experience.webp', title: 'Experience Level', desc: `Entry-level ${brand.niche.short}s start around $95-115k. With 5+ years experience, salaries can reach $150-180k or more.` },
  { img: '/images/salary-guide/factor-setting.webp', title: 'Practice Setting', desc: 'Private practice and telehealth positions often pay more than hospital or community health settings.' },
  { img: '/images/salary-guide/factor-employment.webp', title: 'Employment Type', desc: `1099 contractors and travel ${brand.niche.short}s often earn 20-50% more than W2 employees, though without traditional benefits.` },
  { img: '/images/salary-guide/factor-specialty.webp', title: 'Specialization', desc: 'Subspecialties like acute care, emergency, psychiatric-mental health, or dermatology can command premium pay (+10-25%).' },
  { img: '/images/salary-guide/factor-negotiate.webp', title: 'Negotiation', desc: `${brand.niche.short}s who negotiate can often secure 5-15% higher starting salaries plus signing bonuses ($5,000-$30,000).` },
];

const faqData = [
  { q: `How much do ${brand.niche.short}s make in 2026?`, a: `The national average ${brand.niche.short} salary is about $126,000-$135,000 per year in 2026, based on data from BLS, ZipRecruiter, Indeed, PayScale, and Glassdoor. The top 10% earn $165,000 or more. New graduates start at $95,000-$115,000, while experienced ${brand.niche.short}s earn $150,000-$180,000+.` },
  { q: `Which state pays ${brand.niche.short}s the most?`, a: `${brand.niche.short} pay is consistently highest in West Coast and Northeast markets — California, Washington, Oregon, Nevada, and New Jersey rank near the top in federal wage data. When adjusted for cost of living, several Midwest and Southern states offer stronger real purchasing power.` },
  { q: `Do telehealth ${brand.niche.short}s make less than in-person?`, a: `Telehealth ${brand.niche.short}s typically earn $120,000 to $170,000 — broadly comparable to in-person roles, which vary more by setting and acuity. Telehealth offers excellent flexibility, and some national telehealth platforms pay $180,000+ for experienced ${brand.niche.short}s with multi-state licenses.` },
  { q: `How can I increase my ${brand.niche.short} salary?`, a: 'Top strategies include: specializing in high-demand areas like acute care, emergency, or psychiatric-mental health (+10-25% premium), practicing in Full Practice Authority states (+12-15% premium), considering private practice ownership ($180,000-$300,000+), working in rural/underserved areas for loan repayment incentives, and always negotiating total compensation.' },
  { q: `How much do travel ${brand.niche.short}s make?`, a: `Travel and locum tenens ${brand.niche.short}s typically earn 20-50% more than permanent positions, with compensation ranging from $150,000 to $250,000+ including housing stipends and travel allowances.` },
];

export default async function SalaryGuidePage() {
  const [stateSalaries, overallStats] = await Promise.all([
    getSalaryByState(),
    getOverallStats(),
  ]);

  const currentYear = new Date().getFullYear();

  // FAQ Schema — generated from visible faqData so schema + content stay in sync
  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqData.map(faq => ({
      '@type': 'Question' as const,
      name: faq.q,
      acceptedAnswer: { '@type': 'Answer' as const, text: faq.a },
    })),
  };

  // Article Schema
  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": `2026 ${brand.niche.short} Salary Guide: ${brand.niche.long} Pay by State`,
    "description": `Comprehensive ${brand.niche.short} salary data for 2026 including state-by-state pay, experience levels, specialty premiums, and market trends. Based on BLS, ZipRecruiter, Indeed, and 10,000+ job postings.`,
    "image": `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/pages/pmhnp-salary-guide-2026.webp`,
    "datePublished": "2026-01-01T00:00:00Z",
    "dateModified": new Date().toISOString(),
    "author": { "@type": "Organization", "name": brand.name, "url": brand.baseUrl, "logo": { "@type": "ImageObject", "url": `${brand.baseUrl}/logo.png` } },
    "publisher": { "@type": "Organization", "name": brand.name, "url": brand.baseUrl, "logo": { "@type": "ImageObject", "url": `${brand.baseUrl}/logo.svg` } },
    "mainEntityOfPage": { "@type": "WebPage", "@id": `${brand.baseUrl}/salary-guide` }
  };

  const sanitizeJson = (obj: object): string => {
    return JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  };

  const fmt = (n: number) => n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);

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
        "name": `${currentYear} ${brand.niche.short} Salary Guide`,
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
              {currentYear} Salary Data
            </p>
            <h1 className="font-lora" style={{
              fontSize: 'clamp(2rem, 5vw, 3rem)', fontWeight: 800, lineHeight: 1.15,
              color: '#1A2E35', marginBottom: '16px',
            }}>
              {brand.niche.short} Salary Guide
            </h1>
            <p style={{ fontSize: '17px', color: '#5A4A42', maxWidth: '600px', margin: '0 auto', lineHeight: 1.6 }}>
              National average <strong>$126,000+</strong> per year. State-by-state breakdown, experience levels, practice settings, and tips to maximize earnings.
            </p>
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
                stateSalaries={stateSalaries.map(s => ({ state: s.state, stateCode: s.stateCode, avgSalary: s.avgSalary, minSalary: s.minSalary, maxSalary: s.maxSalary }))}
                nationalAvg={overallStats.avgSalary}
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
                  { value: '$126K+', label: 'National Avg', bg: '#D4F5E9', color: '#065F46' },
                  { value: '$95K', label: 'Entry Level', bg: '#E0E7FF', color: '#3730A3' },
                  { value: '$165K+', label: 'Top 10%', bg: '#FEF3C7', color: '#92400E' },
                  { value: '45%', label: 'Job Growth', bg: '#FFE0D3', color: '#7C2D12' },
                ].map(s => (
                  <div key={s.label} className="sal-stat-pill" style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '10px 16px', borderRadius: '14px',
                    background: s.bg,
                    boxShadow: '3px 3px 8px rgba(0,0,0,0.04), inset 1px 1px 2px rgba(255,255,255,0.5)',
                  }}>
                    <span style={{ fontSize: '20px', fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</span>
                    <span style={{ fontSize: '12px', color: s.color, opacity: 0.7, fontWeight: 500 }}>{s.label}</span>
                  </div>
                ))}
              </div>

              {/* PDF download card */}
              <div className="emp-bento-card" style={{
                ...clayCard, padding: '20px', background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)',
                border: '1.5px solid rgba(190,24,93,0.12)',
              }}>
                <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#831843', margin: '0 0 10px' }}>📄 Download Free PDF Guide</h3>
                <SalaryGuideForm />
                <p style={{ fontSize: '10px', color: '#94A3B8', marginTop: '8px', marginBottom: 0 }}>
                  Sources: BLS, ZipRecruiter, Indeed, PayScale, Glassdoor, CompHealth
                </p>
              </div>
            </div>

            {/* Quick Answer (full-width 12 cols) */}
            <div className="quick-answer-box emp-bento-card" style={{
              ...clayCard, gridColumn: 'span 12', padding: '28px 32px',
              border: '2px solid rgba(190,24,93,0.10)',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', marginBottom: '20px' }}>
                <Image src={`${STORAGE_BASE}/storage/v1/object/public/site-assets/images/employers/clay-dollar.webp`} alt="Salary" width={44} height={44} style={{ width: '44px', height: '44px', borderRadius: '14px', flexShrink: 0 }} />
                <div>
                  <h2 className="font-lora" style={{ fontSize: '18px', fontWeight: 700, color: '#1A2E35', margin: '0 0 8px' }}>Quick Answer: {brand.niche.short} Salary in {currentYear}</h2>
                  <p style={{ fontSize: '14px', color: '#5A4A42', lineHeight: 1.7, margin: 0 }}>
                    The average {brand.niche.short} salary is <strong>$126,000-$135,000 per year</strong> in {currentYear}. The top 10% earn <strong>$165,000+</strong>.
                    New graduates start at $95,000-$115,000, while experienced {brand.niche.short}s (7-15 years) earn $150,000-$180,000.
                    Private practice owners can earn $180,000-$300,000+. Pay runs highest in West Coast and Northeast
                    markets, with California, Washington, and New Jersey near the top in federal wage data.
                  </p>
                </div>
              </div>
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px',
                paddingTop: '18px', borderTop: '1px solid rgba(0,0,0,0.06)',
              }} className="sal-quick-stats">
                {[
                  { value: '$126,000+', label: 'National Average', color: '#BE185D' },
                  { value: '$165,000+', label: 'Top 10% Earn', color: '#BE185D' },
                  { value: '45%', label: 'Job Growth by 2032', color: '#F59E0B' },
                  { value: '10,000+', label: 'Jobs Analyzed', color: '#F59E0B' },
                ].map(s => (
                  <div key={s.label} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '20px', fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
                    <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: '4px' }}>{s.label}</div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </section>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 3: STATE SALARY TABLE (slate bg)
          ═══════════════════════════════════════════════════════════════ */}
      {stateSalaries.length > 0 && (
        <section style={{ background: 'linear-gradient(180deg, #F1F5F9 0%, #E8EDF2 50%, #F1F5F9 100%)', padding: '80px 20px' }}>
          <div style={{ maxWidth: '900px', margin: '0 auto' }}>
            <p style={{ fontSize: '13px', fontWeight: 600, color: '#BE185D', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>
              Salary by Location
            </p>
            <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.5vw, 32px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '8px' }}>
              {brand.niche.short} Salary by State
            </h2>
            <p style={{ fontSize: '15px', color: '#5A4A42', textAlign: 'center', maxWidth: '500px', margin: '0 auto 12px', lineHeight: 1.6 }}>
              See how {brand.niche.short} salaries compare across different states. Click any state to view available jobs.
            </p>

            {/* Note */}
            <div style={{
              ...clayCard, maxWidth: '680px', margin: '0 auto 28px', padding: '14px 20px',
              background: '#FDF2F8', border: '1px solid #FBCFE8',
            }}>
              <p style={{ fontSize: '12px', color: '#831843', margin: 0, lineHeight: 1.5 }}>
                <strong>Note:</strong> Real-time salary data from active {brand.niche.short} job postings.
                For comprehensive state-by-state data including cost-of-living adjustments, download our full PDF guide above.
              </p>
            </div>

            {/* Table */}
            <div className="emp-compare-table" style={{ ...clayCard, padding: '0', overflow: 'hidden' }}>
              <table role="table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', tableLayout: 'fixed' }}>
                <thead>
                  <tr style={{ background: 'linear-gradient(135deg, rgba(190,24,93,0.08), rgba(190,24,93,0.02))' }}>
                    <th style={{ width: '35%', padding: '14px 20px', textAlign: 'left', fontWeight: 600, color: '#64748B', borderBottom: '2px solid rgba(0,0,0,0.06)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>State</th>
                    <th style={{ width: '20%', padding: '14px 16px', textAlign: 'right', fontWeight: 600, color: '#64748B', borderBottom: '2px solid rgba(0,0,0,0.06)', fontSize: '11px', textTransform: 'uppercase' }}>Avg. Salary</th>
                    <th className="sal-range-col" style={{ width: '25%', padding: '14px 16px', textAlign: 'right', fontWeight: 600, color: '#64748B', borderBottom: '2px solid rgba(0,0,0,0.06)', fontSize: '11px', textTransform: 'uppercase' }}>Range</th>
                    <th style={{ width: '10%', padding: '14px 16px', textAlign: 'right', fontWeight: 600, color: '#64748B', borderBottom: '2px solid rgba(0,0,0,0.06)', fontSize: '11px', textTransform: 'uppercase' }}>Jobs</th>
                    <th style={{ width: '10%', padding: '14px 16px', textAlign: 'right', borderBottom: '2px solid rgba(0,0,0,0.06)' }}><span style={{ position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px', overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 }}>Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {stateSalaries.map((state, i) => (
                    <tr key={state.state} style={{ background: i < 3 ? 'rgba(251,191,36,0.06)' : i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.015)' }}>
                      <td style={{ padding: '12px 20px', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {i < 3 && (
                            <span style={{
                              width: '22px', height: '22px', borderRadius: '50%',
                              background: '#FEF3C7', color: '#92400E', fontSize: '11px', fontWeight: 700,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>{i + 1}</span>
                          )}
                          <div>
                            <span style={{ fontWeight: 600, color: '#1A2E35' }}>{state.state}</span>
                            <span style={{ fontSize: '11px', color: '#94A3B8', marginLeft: '6px' }}>{state.stateCode}</span>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'right', borderBottom: '1px solid rgba(0,0,0,0.04)', fontWeight: 700, color: '#1A2E35' }}>
                        ${fmt(state.avgSalary)}
                      </td>
                      <td className="sal-range-col" style={{ padding: '12px 16px', textAlign: 'right', borderBottom: '1px solid rgba(0,0,0,0.04)', fontSize: '12px', color: '#64748B' }}>
                        ${fmt(state.minSalary)} - ${fmt(state.maxSalary)}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'right', borderBottom: '1px solid rgba(0,0,0,0.04)', fontSize: '13px', color: '#64748B' }}>
                        {state.jobCount}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'right', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                        <Link href={`/jobs/state/${state.slug}`} style={{ fontSize: '12px', color: '#BE185D', fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                          Jobs <ArrowUpRight size={12} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 4: SALARY BREAKDOWN BENTO (cream bg)
          ═══════════════════════════════════════════════════════════════ */}
      <div style={{ background: 'linear-gradient(180deg, #FFF5EE 0%, #FDE8D8 50%, #FFF5EE 100%)', padding: '80px 20px' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#BE185D', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>
            Salary Breakdown
          </p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.5vw, 32px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '36px' }}>
            What Impacts Your Earnings
          </h2>

          <div className="sal-bento" style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '14px' }}>

            {/* Experience Level (8 cols) */}
            <div className="sal-bento-exp emp-bento-card" style={{ ...clayCard, gridColumn: 'span 8', padding: '0', overflow: 'hidden' }}>
              <div style={{ padding: '24px 28px 8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <Image src={`${STORAGE_BASE}/storage/v1/object/public/site-assets/images/employers/clay-calendar.webp`} alt="Experience" width={44} height={44} style={{ width: '44px', height: '44px', borderRadius: '14px' }} />
                <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#1A2E35', margin: 0 }}>By Experience Level</h3>
              </div>
              <div style={{ padding: '0 0 0' }}>
                <table className="emp-compare-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr>
                      <th style={{ padding: '12px 28px', textAlign: 'left', fontWeight: 600, color: '#64748B', borderBottom: '1px solid rgba(0,0,0,0.06)', fontSize: '11px', textTransform: 'uppercase' }}>Experience</th>
                      <th style={{ padding: '12px 24px', textAlign: 'right', fontWeight: 600, color: '#64748B', borderBottom: '1px solid rgba(0,0,0,0.06)', fontSize: '11px', textTransform: 'uppercase' }}>Salary Range</th>
                      <th className="sal-roles-col" style={{ padding: '12px 24px', textAlign: 'left', fontWeight: 600, color: '#64748B', borderBottom: '1px solid rgba(0,0,0,0.06)', fontSize: '11px', textTransform: 'uppercase' }}>Typical Roles</th>
                    </tr>
                  </thead>
                  <tbody>
                    {experienceData.map((item, i) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.015)' }}>
                        <td style={{ padding: '12px 28px', fontWeight: 500, color: '#1A2E35', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>{item.exp}</td>
                        <td style={{ padding: '12px 24px', textAlign: 'right', fontWeight: 700, color: '#BE185D', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>{item.range}</td>
                        <td className="sal-roles-col" style={{ padding: '12px 24px', color: '#64748B', borderBottom: '1px solid rgba(0,0,0,0.04)', fontSize: '12px' }}>{item.roles}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Practice Setting (4 cols) */}
            <div className="sal-bento-setting emp-bento-card" style={{ ...clayCard, gridColumn: 'span 4', padding: '24px 22px', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '18px' }}>
                <Image src={`${STORAGE_BASE}/storage/v1/object/public/site-assets/images/employers/clay-briefcase.webp`} alt="Setting" width={44} height={44} style={{ width: '44px', height: '44px', borderRadius: '14px' }} />
                <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#1A2E35', margin: 0 }}>By Setting</h3>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {settingData.map((item, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 14px', borderRadius: '12px',
                    background: 'rgba(0,0,0,0.02)', border: '1px solid rgba(0,0,0,0.04)',
                  }}>
                    <div>
                      <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#1A2E35' }}>{item.setting}</div>
                      <div style={{ fontSize: '10.5px', color: '#94A3B8', marginTop: '1px' }}>{item.notes}</div>
                    </div>
                    <span style={{ fontSize: '11.5px', fontWeight: 700, color: item.color, whiteSpace: 'nowrap', marginLeft: '8px' }}>{item.range}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Specialty Premiums (6 cols) */}
            <div className="sal-bento-spec emp-bento-card" style={{ ...clayCard, gridColumn: 'span 6', padding: '0', overflow: 'hidden' }}>
              <div style={{ padding: '24px 28px 8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <Image src={`${STORAGE_BASE}/storage/v1/object/public/site-assets/images/employers/clay-star.webp`} alt="Specialty" width={44} height={44} style={{ width: '44px', height: '44px', borderRadius: '14px' }} />
                <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#1A2E35', margin: 0 }}>Specialty Premiums</h3>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
                <tbody>
                  {specialtyData.map((item, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.015)' }}>
                      <td style={{ padding: '10px 28px', fontWeight: 500, color: '#1A2E35', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>{item.specialty}</td>
                      <td style={{ padding: '10px 20px', textAlign: 'right', fontWeight: 700, color: '#BE185D', borderBottom: '1px solid rgba(0,0,0,0.04)', whiteSpace: 'nowrap' }}>{item.premium}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* FPA Impact (6 cols) */}
            <div className="sal-bento-fpa emp-bento-card" style={{
              ...clayCard, gridColumn: 'span 6', padding: '24px 22px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                <Image src={`${STORAGE_BASE}/storage/v1/object/public/site-assets/images/employers/clay-chart.webp`} alt="Practice Authority" width={44} height={44} style={{ width: '44px', height: '44px', borderRadius: '14px' }} />
                <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#1A2E35', margin: 0 }}>Full Practice Authority</h3>
              </div>
              <p style={{ fontSize: '13px', color: '#5A4A42', lineHeight: 1.6, margin: '0 0 16px' }}>
                <strong>34 states + DC</strong> have FPA. {brand.niche.short}s in FPA states earn <strong style={{ color: '#BE185D' }}>12-15% more</strong> on average.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div style={{ padding: '14px 16px', borderRadius: '14px', background: '#FDF2F8', border: '1px solid #FBCFE8' }}>
                  <h4 style={{ fontSize: '13px', fontWeight: 700, color: '#BE185D', margin: '0 0 8px' }}>✓ Full Practice Authority</h4>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: '11.5px', color: '#5A4A42' }}>
                    <li style={{ marginBottom: '3px' }}>• +12-15% salary premium</li>
                    <li style={{ marginBottom: '3px' }}>• Can own practice independently</li>
                    <li>• Full clinical independence</li>
                  </ul>
                </div>
                <div style={{ padding: '14px 16px', borderRadius: '14px', background: 'rgba(0,0,0,0.02)', border: '1px solid rgba(0,0,0,0.06)' }}>
                  <h4 style={{ fontSize: '13px', fontWeight: 700, color: '#64748B', margin: '0 0 8px' }}>Restricted / Reduced</h4>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: '11.5px', color: '#5A4A42' }}>
                    <li style={{ marginBottom: '3px' }}>• Baseline salary</li>
                    <li style={{ marginBottom: '3px' }}>• Requires physician collaboration</li>
                    <li>• Physician oversight required</li>
                  </ul>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 5: MARKET TRENDS (slate bg)
          ═══════════════════════════════════════════════════════════════ */}
      <section style={{ background: 'linear-gradient(180deg, #F1F5F9 0%, #E8EDF2 50%, #F1F5F9 100%)', padding: '80px 20px' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#BE185D', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>
            Market Intelligence
          </p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.5vw, 32px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '36px' }}>
            {currentYear} {brand.niche.short} Market Trends
          </h2>

          <div className="emp-compare-table" style={{ ...clayCard, padding: '0', overflowX: 'auto', marginBottom: '20px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', tableLayout: 'fixed', minWidth: '480px' }}>
              <thead>
                <tr style={{ background: 'linear-gradient(135deg, rgba(190,24,93,0.08), rgba(190,24,93,0.02))' }}>
                  <th style={{ padding: '14px 24px', textAlign: 'left', fontWeight: 600, color: '#64748B', borderBottom: '2px solid rgba(0,0,0,0.06)', fontSize: '11px', textTransform: 'uppercase' }}>Metric</th>
                  <th style={{ padding: '14px 20px', textAlign: 'center', fontWeight: 600, color: '#94A3B8', borderBottom: '2px solid rgba(0,0,0,0.06)', fontSize: '11px', textTransform: 'uppercase' }}>2024</th>
                  <th style={{ padding: '14px 20px', textAlign: 'center', fontWeight: 600, color: '#94A3B8', borderBottom: '2px solid rgba(0,0,0,0.06)', fontSize: '11px', textTransform: 'uppercase' }}>2025</th>
                  <th style={{ padding: '14px 20px', textAlign: 'center', fontWeight: 800, color: '#BE185D', borderBottom: '2px solid rgba(190,24,93,0.2)', fontSize: '11px', textTransform: 'uppercase' }}>2026</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { metric: 'Average Salary', v24: '$158,000', v25: '$162,000', v26: '$165,000' },
                  { metric: 'Job Postings (Monthly)', v24: '12,500', v25: '14,200', v26: '15,800' },
                  { metric: 'Telehealth %', v24: '48%', v25: '55%', v26: '62%' },
                  { metric: 'Time to Fill (days)', v24: '45', v25: '38', v26: '32' },
                ].map((row, i) => (
                  <tr key={row.metric} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.015)' }}>
                    <td style={{ padding: '12px 24px', fontWeight: 500, color: '#1A2E35', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>{row.metric}</td>
                    <td style={{ padding: '12px 20px', textAlign: 'center', color: '#94A3B8', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>{row.v24}</td>
                    <td style={{ padding: '12px 20px', textAlign: 'center', color: '#94A3B8', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>{row.v25}</td>
                    <td style={{ padding: '12px 20px', textAlign: 'center', fontWeight: 700, color: '#BE185D', borderBottom: '1px solid rgba(0,0,0,0.04)', background: 'rgba(190,24,93,0.03)' }}>{row.v26}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Why Demand is High */}
          <div style={{ ...clayCard, padding: '22px 28px', background: '#FDF2F8', border: '1px solid #FBCFE8' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#831843', margin: '0 0 10px' }}>Why Demand is High</h3>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexWrap: 'wrap', gap: '8px 24px', fontSize: '13px', color: '#5A4A42' }}>
              <li>• <strong>123 million</strong> Americans in shortage areas</li>
              <li>• <strong>6,203</strong> additional providers needed</li>
              <li>• <strong>45%</strong> projected NP job growth through 2032</li>
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
                  <Image src={card.img} alt={card.title} width={48} height={48} style={{ width: '48px', height: '48px', borderRadius: '14px', marginBottom: '16px' }} />
                  <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#1A2E35', margin: '0 0 8px' }}>{card.title}</h3>
                  <p style={{ fontSize: '13px', color: '#5A4A42', lineHeight: 1.6, margin: 0 }}>{card.desc}</p>
                </div>
            ))}
          </div>
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
            {faqData.map(({ q, a }) => (
              <details key={q} style={{ ...clayCard, padding: 0, overflow: 'hidden' }}>
                <summary style={{
                  padding: '18px 24px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: '12px',
                  fontSize: '15px', fontWeight: 600, color: '#1A2E35', listStyle: 'none',
                }}>
                  <Image src={`${STORAGE_BASE}/storage/v1/object/public/site-assets/images/employers/clay-envelope.webp`} alt="FAQ" width={28} height={28} style={{ width: '28px', height: '28px', borderRadius: '8px', flexShrink: 0 }} />
                  {q}
                </summary>
                <div style={{ padding: '0 24px 18px 64px', fontSize: '14px', color: '#5A4A42', lineHeight: 1.65 }}>{a}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 8: CITATION + CTA (slate bg)
          ═══════════════════════════════════════════════════════════════ */}
      <section style={{ background: 'linear-gradient(180deg, #F1F5F9 0%, #E8EDF2 50%, #F1F5F9 100%)', padding: '80px 20px' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
          {/* Citation */}
          <div style={{ ...clayCard, padding: '24px 28px', marginBottom: '24px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#1A2E35', margin: '0 0 10px' }}>📋 Cite This Page</h3>
            <p style={{ fontSize: '13px', color: '#5A4A42', marginBottom: '14px' }}>Use the following citation when referencing data from this salary guide:</p>
            <CopyCitation citation={`${brand.name}. "2026 ${brand.niche.short} Salary Guide: ${brand.niche.long} Pay by State." ${brand.name}, February 2026, ${brand.domain}/salary-guide.`} />
            <p style={{ fontSize: '11px', color: '#94A3B8', marginTop: '10px' }}>For media inquiries or custom data requests, contact {brand.email.press}</p>
          </div>

          {/* Data Sources */}
          <div style={{ ...clayCard, padding: '16px 24px', background: 'rgba(0,0,0,0.02)', marginBottom: '24px', textAlign: 'center' }}>
            <p style={{ fontSize: '12px', color: '#64748B', margin: 0, lineHeight: 1.5 }}>
              <strong>Data Sources & Methodology:</strong> Bureau of Labor Statistics (BLS), ZipRecruiter, Indeed, PayScale, Glassdoor, CompHealth, and analysis of 10,000+ active {brand.niche.short} job postings. Industry data updated January {currentYear}. Real-time job posting data updated daily.
            </p>
          </div>

          {/* CTA */}
          <div className="sal-cta-grid emp-bento-card" style={{
            ...clayCard, padding: '0', overflow: 'hidden',
            display: 'grid', gridTemplateColumns: '1fr 320px', alignItems: 'center',
          }}>
            <div style={{ padding: '36px 32px' }}>
              <h2 className="font-lora" style={{ fontSize: '22px', fontWeight: 700, color: '#1A2E35', margin: '0 0 10px' }}>
                Find Your Next High-Paying{' '}
                <span style={{ color: '#BE185D' }}>{brand.niche.short} Job</span>
              </h2>
              <p style={{ fontSize: '14px', color: '#5A4A42', lineHeight: 1.6, margin: '0 0 20px', maxWidth: '380px' }}>
                Browse positions with competitive salaries. Filter by location, salary, and work type.
              </p>
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
              <Image
                src={`${STORAGE_BASE}/storage/v1/object/public/site-assets/images/employers/cta-illustration.webp`}
                alt={`Find high-paying ${brand.niche.short} jobs`}
                width={280} height={220}
                style={{ width: '100%', maxWidth: '260px', height: 'auto', borderRadius: '14px' }}
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
