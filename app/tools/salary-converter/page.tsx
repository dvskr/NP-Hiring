import { brand } from '@/config/brand';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeftRight, ArrowRight, HelpCircle } from 'lucide-react';
import Breadcrumbs from '@/components/Breadcrumbs';
import { toolApplicationCategory } from '@/app/tools/tools-registry';
import AssumptionsPanel from '@/components/tools/AssumptionsPanel';
import SalaryConverterClient from '@/components/tools/SalaryConverterClient';
import { STAT_SOURCES } from '@/lib/stats-sources';
import { TOOL_ACCENT, TOOL_HERO_BG, TOOL_PAGE_CSS, TOOL_PANEL_BG, clayCard } from '@/components/tools/tool-theme';

export const revalidate = 86400;

const PAGE_PATH = '/tools/salary-converter';
const PAGE_URL = `${brand.baseUrl}${PAGE_PATH}`;
const PAGE_TITLE = `${brand.niche.long} Hourly, Shift & Annual Salary Converter`;
const PAGE_DESCRIPTION = `Convert ${brand.niche.descriptor} hourly rates, 3x12 urgent care shifts, 4x10 clinic schedules, 7-on/7-off hospitalist blocks, and annual salaries while factoring PTO weeks and unpaid charting hours.`;
const OG_IMAGE = `${brand.baseUrl}/api/og?title=${encodeURIComponent(`${brand.niche.long} Shift & Salary Converter`)}&type=page`;

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  keywords: [
    `${brand.niche.descriptor} hourly to salary converter`,
    '3x12 shift pay to annual salary',
    '7 on 7 off hospitalist hourly rate',
    `${brand.niche.short.toLowerCase()} per diem hourly to annual`,
    'clinical true hourly rate calculator',
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
  'Standard HR salary tables divide annual pay by 2,080 hours (40 hours × 52 weeks), which misstates 3x12 urgent care roles (1,872 scheduled hours/yr) and 7-on/7-off 12-hour hospitalist roles (182 shifts = 2,184 scheduled hours/yr). Each preset uses its exact shift count.',
  'For salaried W-2 roles, paid PTO weeks reduce actual worked hours without reducing annual pay (raising true worked hourly pay). Checking the PRN / Per Diem / 1099 box treats time-off weeks as unpaid instead.',
  'Unpaid charting and inbox hours are added to worked weeks to show the gap between headline rate and true worked rate.',
];

const EXCLUSIONS: readonly string[] = [
  'Federal, state, and FICA or self-employment taxes (use the 1099 vs W-2 Calculator for after-tax net pay).',
  'Overtime multipliers (1.5x over 40 hours) for non-exempt hourly arrangements and night/weekend shift differentials.',
];

const FAQS = [
  {
    q: 'Why does a 3x12 schedule pay differently per hour than a 5x8 clinic role at the same salary?',
    a: 'Three 12-hour shifts equal 36 hours a week (1,872 scheduled hours a year) instead of 40 hours a week (2,080 hours a year). At an identical annual salary, a 3x12 schedule pays 11.1% more per scheduled clinical hour than a 40-hour clinic week.',
  },
  {
    q: 'How many hours a year is a 7-on / 7-off hospitalist schedule?',
    a: 'Working seven 12-hour shifts every two weeks equals 26 work blocks (182 shifts, or 2,184 clinical hours a year) if no extra PTO weeks are carved out of the on-weeks.',
  },
  {
    q: 'How do I compare a PRN hourly rate against a salaried W-2 offer?',
    a: 'Check the PRN / Per Diem / 1099 box so your planned vacation and CME weeks are counted as unpaid weeks, then take the resulting annual gross over to the 1099 vs W-2 Calculator if the PRN role is paid on a 1099.',
  },
  {
    q: `What is the national median hourly wage for ${brand.niche.descriptor}s?`,
    a: `The BLS OEWS May 2025 national median annual wage is ${STAT_SOURCES.npMedianWageBls.formatted} ($63.61/hr at 2,080 hours; ${STAT_SOURCES.npMedianWageBls.source}).`,
  },
] as const;

const jsonLd = (obj: object): string =>
  JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

export default function SalaryConverterPage() {
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
              { label: 'Salary Converter' },
            ]}
          />
          <div style={{ maxWidth: '760px' }}>
            <p style={{ fontSize: '13px', fontWeight: 600, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '10px' }}>
              Free Tool · For Clinicians
            </p>
            <h1 className="font-lora" style={{ fontSize: 'clamp(2rem, 4.4vw, 2.9rem)', fontWeight: 800, lineHeight: 1.12, color: '#1A2E35', margin: '0 0 16px' }}>
              {brand.niche.short} hourly, shift & annual pay converter
            </h1>
            <p style={{ fontSize: '17px', color: '#5A4A42', lineHeight: 1.65, margin: 0 }}>
              Translate any hourly rate, 12-hour shift rate, or annual salary across 5x8, 4x10, 3x12, and 7-on/7-off
              schedules while seeing what unpaid charting and PTO weeks do to your real hourly pay.
            </p>
          </div>
        </section>
      </div>

      <section style={{ background: TOOL_PANEL_BG, padding: '44px 20px 56px' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <SalaryConverterClient />
        </div>
      </section>

      <section style={{ background: '#FFF', padding: '56px 20px' }}>
        <div style={{ maxWidth: '860px', margin: '0 auto' }}>
          <AssumptionsPanel
            title="How this converter computes shift & hourly pay"
            assumptions={ASSUMPTIONS}
            exclusions={EXCLUSIONS}
            reviewedOn="2026-11-26"
            sources={[
              { label: STAT_SOURCES.npMedianWageBls.source, url: STAT_SOURCES.npMedianWageBls.sourceUrl },
              { label: '1099 vs W-2 after-tax calculator', url: '/tools/1099-vs-w2-calculator' },
              { label: 'Offer competitiveness analyzer', url: '/tools/offer-analyzer' },
            ]}
          />
        </div>
      </section>

      <section style={{ background: TOOL_HERO_BG, padding: '64px 20px' }}>
        <div style={{ maxWidth: '760px', margin: '0 auto' }}>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 32px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '28px' }}>
            Shift & hourly conversion questions
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
            Related pay calculators
          </h2>
          <div className="tool-three-col" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
            {[
              { href: '/tools/1099-vs-w2-calculator', title: '1099 vs W-2 calculator', blurb: 'Price self-employment tax and benefits on contract rates.' },
              { href: '/tools/travel-stipend-calculator', title: 'Travel & locum GSA calculator', blurb: 'Blend taxed hourly base with tax-free lodging and M&IE stipends.' },
              { href: '/tools/wrvu-calculator', title: 'wRVU productivity calculator', blurb: 'See how daily CPT mix translates into annual wRVU bonus pay.' },
            ].map((l) => (
              <Link key={l.href} href={l.href} className="tool-card" style={{ ...clayCard, padding: '20px 20px 18px', textDecoration: 'none', display: 'block' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <ArrowLeftRight size={15} color={TOOL_ACCENT} aria-hidden="true" />
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
