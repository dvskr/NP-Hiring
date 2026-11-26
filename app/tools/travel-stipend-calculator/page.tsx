import { brand } from '@/config/brand';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Compass, HelpCircle } from 'lucide-react';
import Breadcrumbs from '@/components/Breadcrumbs';
import { toolApplicationCategory } from '@/app/tools/tools-registry';
import AssumptionsPanel from '@/components/tools/AssumptionsPanel';
import TravelStipendCalculatorClient from '@/components/tools/TravelStipendCalculatorClient';
import { TOOL_ACCENT, TOOL_HERO_BG, TOOL_PAGE_CSS, TOOL_PANEL_BG, clayCard } from '@/components/tools/tool-theme';

export const revalidate = 86400;

const PAGE_PATH = '/tools/travel-stipend-calculator';
const PAGE_URL = `${brand.baseUrl}${PAGE_PATH}`;
const PAGE_TITLE = `Travel & Locum ${brand.niche.long} GSA Per Diem Stipend Calculator`;
const PAGE_DESCRIPTION = `Calculate blended hourly and annual take-home pay for travel and W-2 locum ${brand.niche.descriptor} contracts using FY2026 GSA lodging and M&IE stipends, duplicated housing expenses, and the IRS 3-factor tax-home screener.`;
const OG_IMAGE = `${brand.baseUrl}/api/og?title=${encodeURIComponent(`Travel & Locum ${brand.niche.short} GSA Stipend Calculator`)}&type=page`;

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  keywords: [
    `travel ${brand.niche.descriptor} stipend calculator`,
    `locum tenens ${brand.niche.short.toLowerCase()} pay calculator`,
    'FY2026 GSA per diem healthcare calculator',
    'IRS tax home 3 factor test healthcare',
    'blended hourly rate travel clinician',
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
  'Standard CONUS GSA per diem preset uses the official FY2026 baseline ($110/night lodging and $68/day Meals & Incidental Expenses, effective Oct 1, 2025 through Sep 30, 2026); metro presets provide editable starting tiers that you can match to gsa.gov zip-code ceilings.',
  'Federal income and employee FICA taxes are computed using statutory TY2026 federal brackets and standard deductions on taxed W-2 base wages only when your IRS tax-home screener indicates eligibility.',
  'Primary-home duplicated housing costs are deducted during active assignment months so you see true spendable cash rather than an inflated gross stipend figure.',
];

const EXCLUSIONS: readonly string[] = [
  'State and multi-state non-resident income tax returns (working across multiple states commonly requires filing non-resident returns in assignment states).',
  '1099 independent-contractor locum arrangements where you pay your own lodging and deduct travel on Schedule C instead of receiving W-2 agency GSA stipends (use our 1099 vs W-2 Calculator for 1099 locums).',
];

const FAQS = [
  {
    q: 'Why do travel agencies split pay into a lower taxed hourly rate and a GSA stipend?',
    a: 'Under IRS accountable-plan rules, an agency can reimburse lodging and meals up to federal GSA daily ceilings free of federal income and payroll tax when you travel away from a permanent tax home. However, the taxed W-2 hourly base must still represent reasonable compensation for an advanced practice clinician.',
  },
  {
    q: 'What is the IRS 3-factor test for maintaining a tax home?',
    a: 'IRS guidance examines three factors: (1) whether you perform regular work in the vicinity of your claimed main home, (2) whether you incur substantial ongoing living expenses (mortgage or fair-market rent) at that home that are duplicated while traveling, and (3) whether you have not abandoned your historical residence. Satisfying at least two factors (including duplicated housing) generally supports a valid tax home.',
  },
  {
    q: 'What happens if I extend at the same hospital past 12 months?',
    a: 'Under Internal Revenue Code Section 162(a), once an assignment in a single metropolitan area is realistically expected to exceed 12 months (even if broken by short gaps), the assignment becomes indefinite rather than temporary, and stipends become taxable from the moment that expectation changes.',
  },
  {
    q: 'Do GSA stipends count toward mortgage qualification or Social Security?',
    a: 'Untaxed per diem reimbursements do not appear in W-2 Box 1 taxable wages and do not accrue Social Security earnings credits, though specialty healthcare mortgage lenders can sometimes underwrite documented stipend history.',
  },
] as const;

const jsonLd = (obj: object): string =>
  JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

export default function TravelStipendCalculatorPage() {
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
              { label: 'Travel Stipend Calculator' },
            ]}
          />
          <div style={{ maxWidth: '760px' }}>
            <p style={{ fontSize: '13px', fontWeight: 600, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '10px' }}>
              Free Tool · For Travel & Locum Clinicians
            </p>
            <h1 className="font-lora" style={{ fontSize: 'clamp(2rem, 4.4vw, 2.9rem)', fontWeight: 800, lineHeight: 1.12, color: '#1A2E35', margin: '0 0 16px' }}>
              Travel & locum {brand.niche.short} GSA stipend calculator
            </h1>
            <p style={{ fontSize: '17px', color: '#5A4A42', lineHeight: 1.65, margin: 0 }}>
              Combine taxed hourly wages with FY2026 GSA lodging and meal stipends, subtract duplicated housing at your
              primary residence, screen IRS tax-home eligibility, and see the exact permanent W-2 salary required to match it.
            </p>
          </div>
        </section>
      </div>

      <section style={{ background: TOOL_PANEL_BG, padding: '44px 20px 56px' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <TravelStipendCalculatorClient nicheShort={brand.niche.short} />
        </div>
      </section>

      <section style={{ background: '#FFF', padding: '56px 20px' }}>
        <div style={{ maxWidth: '860px', margin: '0 auto' }}>
          <AssumptionsPanel
            title="How GSA stipends, taxes & duplicated housing are modeled"
            assumptions={ASSUMPTIONS}
            exclusions={EXCLUSIONS}
            reviewedOn="2026-11-26"
            sources={[
              { label: 'U.S. GSA FY2026 Per Diem Rates', url: 'https://www.gsa.gov/travel/plan-book/per-diem-rates' },
              { label: 'IRS Publication 463 (Travel, Gift, and Car Expenses)', url: 'https://www.irs.gov/publications/p463' },
              { label: '1099 vs W-2 independent locum calculator', url: '/tools/1099-vs-w2-calculator' },
            ]}
          />
        </div>
      </section>

      <section style={{ background: TOOL_HERO_BG, padding: '64px 20px' }}>
        <div style={{ maxWidth: '760px', margin: '0 auto' }}>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 32px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '28px' }}>
            Travel & GSA per diem questions
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
            Related tools for mobile clinicians
          </h2>
          <div className="tool-three-col" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
            {[
              { href: '/tools/1099-vs-w2-calculator', title: '1099 vs W-2 calculator', blurb: 'Model 1099 locum tenens contracts with self-employment tax and Schedule C write-offs.' },
              { href: '/tools/licensure-checker', title: 'State licensure checker', blurb: 'Check APRN Compact progress, endorsement timelines, and collaborative rules.' },
              { href: '/tools/salary-converter', title: 'Shift & hourly converter', blurb: 'Convert 3x12 and 7-on/7-off shift rates into annual equivalents.' },
            ].map((l) => (
              <Link key={l.href} href={l.href} className="tool-card" style={{ ...clayCard, padding: '20px 20px 18px', textDecoration: 'none', display: 'block' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <Compass size={15} color={TOOL_ACCENT} aria-hidden="true" />
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
