import { brand } from '@/config/brand';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, BarChart3, HelpCircle } from 'lucide-react';
import Breadcrumbs from '@/components/Breadcrumbs';
import GuidePromo from '@/components/guides/GuidePromo';
import { toolApplicationCategory } from '@/app/tools/tools-registry';
import AssumptionsPanel from '@/components/tools/AssumptionsPanel';
import OfferAnalyzerClient from '@/components/tools/OfferAnalyzerClient';
import { BENCHMARK_FULL_MIN_EMPLOYERS, BENCHMARK_MIN_EMPLOYERS } from '@/components/tools/benchmark-model';
import { loadMarketSalaryBundle } from '@/lib/tools-salary-data';
import { STAT_SOURCES } from '@/lib/stats-sources';
import { TOOL_ACCENT, TOOL_HERO_BG, TOOL_PAGE_CSS, TOOL_PANEL_BG, clayCard } from '@/components/tools/tool-theme';

export const revalidate = 86400;

const PAGE_PATH = '/tools/offer-analyzer';
const PAGE_URL = `${brand.baseUrl}${PAGE_PATH}`;
const PAGE_TITLE = `${brand.niche.long} Job Offer Competitiveness Analyzer`;
const PAGE_DESCRIPTION = `Grade your ${brand.niche.descriptor} salary offer against live state job postings and official BLS wage percentiles, calculate your true hourly rate after charting and call, and get counter-offer talking points.`;
const OG_IMAGE = `${brand.baseUrl}/api/og?title=${encodeURIComponent(`${brand.niche.long} Offer Competitiveness Analyzer`)}&type=page`;

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  keywords: [
    `is my ${brand.niche.descriptor} offer good`,
    `${brand.niche.short.toLowerCase()} salary offer analyzer`,
    `${brand.niche.descriptor} negotiation calculator`,
    `${brand.niche.short.toLowerCase()} salary percentile by state`,
    `evaluate ${brand.niche.short.toLowerCase()} job offer`,
  ],
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    type: 'website',
    url: PAGE_URL,
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: PAGE_TITLE }],
  },
  twitter: { card: 'summary_large_image', title: PAGE_TITLE, images: [OG_IMAGE] },
  alternates: { canonical: PAGE_URL },
};

const ASSUMPTIONS: readonly string[] = [
  `Where at least ${BENCHMARK_MIN_EMPLOYERS} employers disclose pay in your selected state (${BENCHMARK_FULL_MIN_EMPLOYERS} for 25th and 75th percentiles), the grader anchors to live ${brand.name} postings with each employer counted once; otherwise it anchors to the state’s published BLS OEWS May 2025 percentiles.`,
  'Percentile placement interpolates base salary plus recurring annual bonus across the state 10th, 25th, 50th, 75th, and 90th wage points. One-time sign-on bonuses are annualized over their clawback commitment window separately so they do not artificially inflate steady-state standing.',
  'True worked hourly rate divides annualized direct cash by worked weeks (52 less PTO) times total weekly clinical, unpaid charting, and uncompensated call hours.',
];

const EXCLUSIONS: readonly string[] = [
  'Sub-specialty pay spreads inside a state (such as neonatal, critical care, or dermatology procedures vs outpatient general care). Pair this state check with our specialty salary pages.',
  'Health insurance plan design, retirement vesting schedules, and malpractice tail exposure (use the Total Comp Comparator and Tail Coverage Calculator to price those).',
];

const FAQS = [
  {
    q: `What is a competitive ${brand.niche.descriptor} salary offer?`,
    a: `Nationally, the BLS median annual wage for ${brand.niche.descriptor}s is ${STAT_SOURCES.npMedianWageBls.formatted} (${STAT_SOURCES.npMedianWageBls.source}), with the 10th percentile at ${STAT_SOURCES.salaryPercentile10.formatted} and the 90th at ${STAT_SOURCES.salaryPercentile90.formatted}. Inside an individual state, offers between the 25th and 75th percentile represent the core market band, with experienced clinicians and high-acuity or high-volume roles targeting the upper half.`,
  },
  {
    q: 'Should sign-on bonuses count toward my base percentile?',
    a: 'No. A one-time sign-on bonus disappears in Year 2, does not compound with annual merit raises or employer 401(k) matches, and typically carries a 1 to 3 year repayment clawback. Always evaluate base plus recurring bonus first.',
  },
  {
    q: 'What if the employer says the base salary band is fixed by HR?',
    a: 'When health-system HR tiers lock base pay by years of licensure, shift negotiation to levers outside the base grid: an extra week of PTO, protected weekly administrative charting blocks, a paid call stipend, higher CME funding, or employer-paid claims-made tail coverage.',
  },
  {
    q: 'Why does unpaid charting matter so much to offer quality?',
    a: 'Five hours of evening charting a week adds over 230 uncompensated hours a year, quietly cutting a 40-hour salary’s true hourly rate by more than 11%.',
  },
] as const;

const jsonLd = (obj: object): string =>
  JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

export default async function OfferAnalyzerPage() {
  const bundle = await loadMarketSalaryBundle();

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd({
            '@context': 'https://schema.org',
            '@type': 'WebApplication',
            name: PAGE_TITLE,
            description: PAGE_DESCRIPTION,
            url: PAGE_URL,
            applicationCategory: toolApplicationCategory(PAGE_PATH),
            operatingSystem: 'Any',
            browserRequirements: 'Requires JavaScript',
            isAccessibleForFree: true,
            offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
            publisher: { '@type': 'Organization', '@id': `${brand.baseUrl}/#organization`, name: brand.name, url: brand.baseUrl },
          }),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd({
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: FAQS.map(({ q, a }) => ({
              '@type': 'Question',
              name: q,
              acceptedAnswer: { '@type': 'Answer', text: a },
            })),
          }),
        }}
      />

      <div style={{ background: TOOL_HERO_BG }}>
        <section style={{ maxWidth: '1080px', margin: '0 auto', padding: '32px 20px 56px' }}>
          <Breadcrumbs
            items={[
              { label: 'Home', href: '/' },
              { label: 'Tools', href: '/tools' },
              { label: 'Offer Analyzer' },
            ]}
          />
          <div style={{ maxWidth: '760px' }}>
            <p style={{ fontSize: '13px', fontWeight: 600, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '10px' }}>
              Free Tool · For Clinicians
            </p>
            <h1 className="font-lora" style={{ fontSize: 'clamp(2rem, 4.4vw, 2.9rem)', fontWeight: 800, lineHeight: 1.12, color: '#1A2E35', margin: '0 0 16px' }}>
              {brand.niche.short} job offer competitiveness analyzer
            </h1>
            <p style={{ fontSize: '17px', color: '#5A4A42', lineHeight: 1.65, margin: 0 }}>
              Drop in the numbers from your offer letter to see where it lands against live state postings and federal
              wage percentiles, what you truly make per worked hour, and which levers to negotiate before you sign.
            </p>
          </div>
        </section>
      </div>

      <section style={{ background: TOOL_PANEL_BG, padding: '44px 20px 56px' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <OfferAnalyzerClient states={bundle.states} nationalMedian={bundle.nationalBls.median} />
          <GuidePromo
            slug="negotiate-like-an-np"
            heading="Negotiating your base, bonus, or schedule?"
            pitch="Word-for-word email and phone scripts for countering base pay, RVU thresholds, call stipends, and tail coverage."
            style={{ maxWidth: '900px', margin: '36px auto 0' }}
          />
        </div>
      </section>

      <section style={{ background: '#FFF', padding: '56px 20px' }}>
        <div style={{ maxWidth: '860px', margin: '0 auto' }}>
          <AssumptionsPanel
            title="How this offer grader works"
            assumptions={ASSUMPTIONS}
            exclusions={EXCLUSIONS}
            reviewedOn="2026-11-26"
            sources={[
              { label: STAT_SOURCES.npMedianWageBls.source, url: STAT_SOURCES.npMedianWageBls.sourceUrl },
              { label: `${brand.name} state salary guide`, url: '/salary-guide' },
              { label: 'Specialty salary benchmarks', url: '/salary-guide/specialty' },
            ]}
          />
        </div>
      </section>

      <section style={{ background: TOOL_HERO_BG, padding: '64px 20px' }}>
        <div style={{ maxWidth: '760px', margin: '0 auto' }}>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 32px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '28px' }}>
            Offer evaluation questions
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {FAQS.map(({ q, a }) => (
              <details key={q} style={{ ...clayCard, padding: 0, overflow: 'hidden' }}>
                <summary style={{ padding: '18px 22px', cursor: 'pointer', listStyle: 'none', display: 'flex', alignItems: 'center', gap: '12px', fontSize: '15px', fontWeight: 600, color: '#1A2E35' }}>
                  <span style={{ width: '26px', height: '26px', borderRadius: '8px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(145deg, #BE185D, #9D174D)' }} aria-hidden="true">
                    <HelpCircle size={14} color="#fff" />
                  </span>
                  {q}
                </summary>
                <div style={{ padding: '0 22px 18px 60px', fontSize: '14px', color: '#5A4A42', lineHeight: 1.68 }}>{a}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section style={{ background: '#FFF', padding: '56px 20px 72px' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
          <h2 className="font-lora" style={{ fontSize: '22px', fontWeight: 700, color: '#1A2E35', margin: '0 0 18px' }}>
            Related compensation tools
          </h2>
          <div className="tool-three-col" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
            {[
              { href: '/tools/total-comp-comparator', title: 'Total comp comparator', blurb: 'Put Offer A and Offer B side by side across cash, benefits, and hours.' },
              { href: '/tools/tail-coverage-calculator', title: 'Malpractice tail calculator', blurb: 'Check state non-competes and claims-made tail costs before signing.' },
              { href: '/tools/1099-vs-w2-calculator', title: '1099 vs W-2 calculator', blurb: 'Compare contractor rates against W-2 salaries after self-employment tax.' },
            ].map((l) => (
              <Link key={l.href} href={l.href} className="tool-card" style={{ ...clayCard, padding: '20px 20px 18px', textDecoration: 'none', display: 'block' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <BarChart3 size={15} color={TOOL_ACCENT} aria-hidden="true" />
                  <h3 style={{ fontSize: '14px', fontWeight: 800, color: '#1A2E35', margin: 0 }}>{l.title}</h3>
                </div>
                <p style={{ fontSize: '12.5px', color: '#5A4A42', margin: '0 0 10px', lineHeight: 1.55 }}>{l.blurb}</p>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '12px', fontWeight: 700, color: TOOL_ACCENT }}>
                  Open <ArrowRight size={12} />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <style>{TOOL_PAGE_CSS}</style>
    </>
  );
}
