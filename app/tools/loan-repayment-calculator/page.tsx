import { brand } from '@/config/brand';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, HelpCircle, Landmark } from 'lucide-react';
import Breadcrumbs from '@/components/Breadcrumbs';
import { toolApplicationCategory } from '@/app/tools/tools-registry';
import AssumptionsPanel from '@/components/tools/AssumptionsPanel';
import LoanRepaymentCalculatorClient from '@/components/tools/LoanRepaymentCalculatorClient';
import { NHSC_AWARD_AMOUNTS } from '@/components/tools/clinician-comp-models';
import { TOOL_ACCENT, TOOL_HERO_BG, TOOL_PAGE_CSS, TOOL_PANEL_BG, clayCard } from '@/components/tools/tool-theme';

export const revalidate = 86400;

const PAGE_PATH = '/tools/loan-repayment-calculator';
const PAGE_URL = `${brand.baseUrl}${PAGE_PATH}`;
const PAGE_TITLE = `${brand.niche.long} Loan Repayment Calculator: PSLF vs NHSC vs NURSE Corps`;
const PAGE_DESCRIPTION = `Model 10-year cumulative net wealth for ${brand.niche.descriptor}s across Public Service Loan Forgiveness (PSLF), HRSA NHSC, HRSA NURSE Corps, and higher-paying private clinic payoff.`;
const OG_IMAGE = `${brand.baseUrl}/api/og?title=${encodeURIComponent(`${brand.niche.short} Loan Forgiveness & Wealth Calculator`)}&type=page`;

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  keywords: [
    `${brand.niche.descriptor} loan repayment calculator`,
    `${brand.niche.short.toLowerCase()} PSLF vs NHSC calculator`,
    'HRSA NURSE Corps loan repayment taxable',
    'FQHC vs private practice salary calculator',
    'healthcare student loan forgiveness modeler',
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
  'PSLF models 120 monthly Income-Driven Repayment (IDR) payments at 10% of discretionary income above 150% of the federal poverty guideline (capped at the 10-year standard payment), with remaining federal Direct Loan balance forgiven tax-free under IRC Section 108(f).',
  `HRSA NHSC tiers apply a tax-free lump-sum award (${fmt(NHSC_AWARD_AMOUNTS.fullTimeHighHpsa)} primary care high-need HPSA, ${fmt(NHSC_AWARD_AMOUNTS.fullTimeStandardHpsa)} standard full-time HPSA, or ${fmt(NHSC_AWARD_AMOUNTS.halfTimeStandardHpsa)} half-time) against principal in exchange for a 2-year service commitment, with any remainder amortized over 10 years.`,
  'HRSA NURSE Corps models 60% of qualifying nursing education debt paid over 2 years plus 25% in optional Year 3 (85% total), and explicitly deducts estimated federal income and FICA tax on the grant because NURSE Corps payments are federally taxable.',
];

const EXCLUSIONS: readonly string[] = [
  'Private student loans (which are ineligible for federal PSLF, though certain state repayment programs and employer tuition stipends may apply).',
  'State-specific SLRP matching grants and employer-funded monthly student loan stipends under IRC Section 127.',
];

const FAQS = [
  {
    q: 'Can I combine NHSC Loan Repayment and PSLF at the same time?',
    a: 'You cannot receive concurrent service credit from two federal service-obligation programs (like NHSC and NURSE Corps) for the exact same hours, but working full-time at a 501(c)(3) FQHC while fulfilling a 2-year NHSC contract can simultaneously count toward your 120 qualifying PSLF months on any remaining federal Direct Loan balance.',
  },
  {
    q: 'Are PSLF, NHSC, and NURSE Corps awards taxed differently?',
    a: 'Yes, and the difference can exceed twenty thousand dollars. Public Service Loan Forgiveness (PSLF) and National Health Service Corps (NHSC) loan repayment awards are exempt from federal income and employment taxes by statute. HRSA NURSE Corps Loan Repayment awards, by contrast, are subject to federal income and FICA withholding.',
  },
  {
    q: 'When does a higher-paying private clinic beat PSLF or NHSC?',
    a: 'When your student loan balance is modest relative to your income (for example, under one times annual pay) or when a private specialty practice pays twenty-five thousand dollars or more above local nonprofit bands, paying the loan off aggressively from higher after-tax earnings often leaves you with higher 10-year net cash and zero site restrictions.',
  },
  {
    q: 'Does a physician group inside a nonprofit hospital qualify for PSLF?',
    a: 'Check the EIN on your W-2. To count directly for PSLF, your direct W-2 employer must be a government agency or 501(c)(3) nonprofit (except in states like California and Texas where statutory corporate-practice laws bar hospitals from directly employing certain clinicians and narrow federal PSLF contractor rules may apply).',
  },
] as const;

const jsonLd = (obj: object): string =>
  JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

export default function LoanRepaymentCalculatorPage() {
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
              { label: 'Loan Repayment Calculator' },
            ]}
          />
          <div style={{ maxWidth: '760px' }}>
            <p style={{ fontSize: '13px', fontWeight: 600, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '10px' }}>
              Free Tool · For Students & Clinicians
            </p>
            <h1 className="font-lora" style={{ fontSize: 'clamp(2rem, 4.4vw, 2.9rem)', fontWeight: 800, lineHeight: 1.12, color: '#1A2E35', margin: '0 0 16px' }}>
              {brand.niche.short} loan forgiveness vs private salary calculator
            </h1>
            <p style={{ fontSize: '17px', color: '#5A4A42', lineHeight: 1.65, margin: 0 }}>
              Should you take a nonprofit or FQHC role for PSLF, NHSC, or NURSE Corps forgiveness, or accept a higher
              private-practice salary and pay your loans off directly? Compare 10-year after-tax net cash across all four paths.
            </p>
          </div>
        </section>
      </div>

      <section style={{ background: TOOL_PANEL_BG, padding: '44px 20px 56px' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <LoanRepaymentCalculatorClient nicheShort={brand.niche.short} />
        </div>
      </section>

      <section style={{ background: '#FFF', padding: '56px 20px' }}>
        <div style={{ maxWidth: '860px', margin: '0 auto' }}>
          <AssumptionsPanel
            title="How PSLF, NHSC, NURSE Corps & private payoff are modeled"
            assumptions={ASSUMPTIONS}
            exclusions={EXCLUSIONS}
            reviewedOn="2026-11-26"
            sources={[
              { label: 'Federal Student Aid: Public Service Loan Forgiveness (PSLF)', url: 'https://studentaid.gov/manage-loans/forgiveness-cancellation/public-service' },
              { label: 'HRSA National Health Service Corps Loan Repayment', url: 'https://nhsc.hrsa.gov/loan-repayment' },
              { label: 'HRSA NURSE Corps Loan Repayment Program', url: 'https://bhw.hrsa.gov/funding/apply-loan-repayment/nurse-corps' },
            ]}
          />
        </div>
      </section>

      <section style={{ background: TOOL_HERO_BG, padding: '64px 20px' }}>
        <div style={{ maxWidth: '760px', margin: '0 auto' }}>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 32px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '28px' }}>
            Loan forgiveness & career wealth questions
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
            Related offer & compensation tools
          </h2>
          <div className="tool-three-col" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
            {[
              { href: '/tools/total-comp-comparator', title: 'Total comp comparator', blurb: 'Compare an FQHC offer and a private clinic offer across PTO, health, and hours.' },
              { href: '/tools/offer-analyzer', title: 'Offer competitiveness analyzer', blurb: 'Grade your starting offer against live state job postings and BLS percentiles.' },
              { href: '/tools/clinical-hours-tracker', title: 'Clinical hours & board planner', blurb: 'Track MSN/DNP direct hours and ANCC vs AANPCB renewal rules.' },
            ].map((l) => (
              <Link key={l.href} href={l.href} className="tool-card" style={{ ...clayCard, padding: '20px 20px 18px', textDecoration: 'none', display: 'block' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <Landmark size={15} color={TOOL_ACCENT} aria-hidden="true" />
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
