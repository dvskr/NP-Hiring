import { brand } from '@/config/brand';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, HelpCircle, Scale } from 'lucide-react';
import Breadcrumbs from '@/components/Breadcrumbs';
import { toolApplicationCategory } from '@/app/tools/tools-registry';
import AssumptionsPanel from '@/components/tools/AssumptionsPanel';
import TotalCompComparatorClient from '@/components/tools/TotalCompComparatorClient';
import { TOOL_ACCENT, TOOL_HERO_BG, TOOL_PAGE_CSS, TOOL_PANEL_BG, clayCard } from '@/components/tools/tool-theme';

export const revalidate = 86400;

const PAGE_PATH = '/tools/total-comp-comparator';
const PAGE_URL = `${brand.baseUrl}${PAGE_PATH}`;
const PAGE_TITLE = `${brand.niche.long} Total Compensation Comparator (Offer A vs Offer B)`;
const PAGE_DESCRIPTION = `Compare two ${brand.niche.descriptor} job offers side by side across base salary, wRVU bonus, sign-on clawbacks, PTO, CME, 401(k) match, health insurance, malpractice tail, and unpaid charting hours.`;
const OG_IMAGE = `${brand.baseUrl}/api/og?title=${encodeURIComponent(`${brand.niche.short} Offer A vs Offer B Comparator`)}&type=page`;

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  keywords: [
    `compare ${brand.niche.descriptor} job offers`,
    `${brand.niche.short.toLowerCase()} total compensation calculator`,
    'hospital vs private practice offer comparison',
    'true hourly rate job offer calculator',
    'clinical offer A vs offer B calculator',
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
  'Paid PTO and paid CME days are not double-counted on top of annual base salary; instead, they reduce worked weeks per year (52 less total paid days divided by 5), lifting your true steady-state worked hourly value.',
  'When an offer excludes employer-paid malpractice tail (on a claims-made policy), one-third of your estimated exit tail invoice is deducted per year so a 3-year comparison reflects unpaid tail liability.',
  '3-year cumulative value sums three years of steady-state cash, retirement match, and net benefits plus the one-time Year-1 sign-on bonus.',
];

const EXCLUSIONS: readonly string[] = [
  'Individual federal/state income tax brackets or pre-tax FSA/HSA elections (use the 1099 vs W-2 Calculator if one offer is a 1099 independent-contractor agreement).',
  'Student loan forgiveness eligibility differences between a 501(c)(3) hospital and a for-profit practice (use the Loan Repayment Calculator when PSLF or NHSC is in play).',
];

const FAQS = [
  {
    q: 'Why can a lower base salary at a health system beat a higher private-practice base?',
    a: 'Health systems frequently bundle a 4% to 6% retirement match, eight to ten thousand dollars a year in employer health-premium subsidies, occurrence or employer-paid tail coverage, and five weeks of paid time off. Combined with a 36-hour patient-facing template, the health system offer can pay substantially more per worked hour than a higher-headline salary with minimal benefits and heavy evening charting.',
  },
  {
    q: 'Why does the comparator use a 3-year horizon in addition to Year 1?',
    a: 'Sign-on bonuses only hit in Year 1 and usually carry a 2-year or 3-year repayment clawback. Looking at a 3-year cumulative total prevents a large one-time sign-on bonus from masking a weak recurring salary or missing 401(k) match.',
  },
  {
    q: 'How do I share my Offer A vs Offer B comparison with a mentor or partner?',
    a: 'Click Copy shareable link at the top of the tool. Both offers are encoded directly into the URL query string (?a=...&b=...) with zero server storage.',
  },
  {
    q: 'What if Offer A is W-2 and Offer B is 1099?',
    a: 'A 1099 contractor pays the extra employer half of FICA (up to 7.65% before QBI/deductions) and buys benefits with own dollars. Run Offer B through our 1099 vs W-2 Calculator first to find its W-2 equivalent salary.',
  },
] as const;

const jsonLd = (obj: object): string =>
  JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

export default function TotalCompComparatorPage() {
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
              { label: 'Total Comp Comparator' },
            ]}
          />
          <div style={{ maxWidth: '760px' }}>
            <p style={{ fontSize: '13px', fontWeight: 600, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '10px' }}>
              Free Tool · For Clinicians
            </p>
            <h1 className="font-lora" style={{ fontSize: 'clamp(2rem, 4.4vw, 2.9rem)', fontWeight: 800, lineHeight: 1.12, color: '#1A2E35', margin: '0 0 16px' }}>
              {brand.niche.short} Offer A vs Offer B total comp comparator
            </h1>
            <p style={{ fontSize: '17px', color: '#5A4A42', lineHeight: 1.65, margin: 0 }}>
              Base salary never tells the whole story. Stack two offers side by side across productivity bonuses, sign-on
              clawbacks, PTO, CME, retirement matches, health subsidies, tail liability, and unpaid charting to reveal the real winner.
            </p>
          </div>
        </section>
      </div>

      <section style={{ background: TOOL_PANEL_BG, padding: '44px 20px 56px' }}>
        <div style={{ maxWidth: '1120px', margin: '0 auto' }}>
          <TotalCompComparatorClient />
        </div>
      </section>

      <section style={{ background: '#FFF', padding: '56px 20px' }}>
        <div style={{ maxWidth: '860px', margin: '0 auto' }}>
          <AssumptionsPanel
            title="How total economic value & true worked hourly rate are computed"
            assumptions={ASSUMPTIONS}
            exclusions={EXCLUSIONS}
            reviewedOn="2026-11-26"
            sources={[
              { label: 'Offer competitiveness analyzer', url: '/tools/offer-analyzer' },
              { label: 'Malpractice tail & non-compete calculator', url: '/tools/tail-coverage-calculator' },
              { label: 'Loan repayment & PSLF wealth calculator', url: '/tools/loan-repayment-calculator' },
            ]}
          />
        </div>
      </section>

      <section style={{ background: TOOL_HERO_BG, padding: '64px 20px' }}>
        <div style={{ maxWidth: '760px', margin: '0 auto' }}>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 32px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '28px' }}>
            Offer comparison questions
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
            Related negotiation & tax tools
          </h2>
          <div className="tool-three-col" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
            {[
              { href: '/tools/offer-analyzer', title: 'Offer competitiveness analyzer', blurb: 'Grade each offer against live state job postings and BLS percentiles.' },
              { href: '/tools/1099-vs-w2-calculator', title: '1099 vs W-2 calculator', blurb: 'Translate a 1099 contractor rate into an after-tax W-2 salary equivalent.' },
              { href: '/tools/wrvu-calculator', title: 'wRVU bonus calculator', blurb: 'Stress-test whether an employer’s wRVU bonus threshold is realistically achievable.' },
            ].map((l) => (
              <Link key={l.href} href={l.href} className="tool-card" style={{ ...clayCard, padding: '20px 20px 18px', textDecoration: 'none', display: 'block' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <Scale size={15} color={TOOL_ACCENT} aria-hidden="true" />
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
