import { brand } from '@/config/brand';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Clock, HelpCircle } from 'lucide-react';
import Breadcrumbs from '@/components/Breadcrumbs';
import { toolApplicationCategory } from '@/app/tools/tools-registry';
import AssumptionsPanel from '@/components/tools/AssumptionsPanel';
import CostOfVacancyCalculatorClient from '@/components/tools/CostOfVacancyCalculatorClient';
import { STAT_SOURCES } from '@/lib/stats-sources';
import { TOOL_ACCENT, TOOL_HERO_BG, TOOL_PAGE_CSS, TOOL_PANEL_BG, clayCard } from '@/components/tools/tool-theme';

export const revalidate = 86400;

const PAGE_PATH = '/tools/cost-of-vacancy-calculator';
const PAGE_URL = `${brand.baseUrl}${PAGE_PATH}`;
const PAGE_TITLE = `Unfilled ${brand.niche.long} Cost-of-Vacancy Calculator`;
const PAGE_DESCRIPTION = `Calculate what an unfilled ${brand.niche.descriptor} seat costs your clinic in missed patient visits, foregone net collections less saved salary, and locum bridge spend across 30, 60, 90, and 120 days.`;
const OG_IMAGE = `${brand.baseUrl}/api/og?title=${encodeURIComponent(`Unfilled ${brand.niche.long} Vacancy Cost Calculator`)}&type=page`;

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  keywords: [
    `${brand.niche.descriptor} cost of vacancy calculator`,
    'healthcare provider vacancy cost calculator',
    `unfilled ${brand.niche.short.toLowerCase()} revenue loss`,
    'locum tenens vs vacancy cost',
    'clinical time to fill calculator',
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
  'Net vacancy loss equals foregone completed-visit collections (calendar days / 7 × clinical days per week × daily completed visits × net collection per visit) minus unpaid base salary and benefits/payroll load over the same calendar window.',
  `Planned base salary defaults to ${STAT_SOURCES.npMedianWageBls.formatted} (${STAT_SOURCES.npMedianWageBls.source}); every other figure is an editable starting illustration that you should replace with your clinic’s actual collections and staffing ledger.`,
  'When the optional locum tenens bridge slider is above 0%, recovered collections are calculated at your chosen locum throughput percentage and weighed directly against the daily agency invoice.',
];

const EXCLUSIONS: readonly string[] = [
  'Downstream ancillary, imaging, lab, surgical, or specialist referral revenue generated inside a health system (which makes real vacancy loss substantially larger for hospital-affiliated groups).',
  'Permanent patient attrition to competing clinics when wait times stretch past 30 days, and burnout turnover among remaining clinicians absorbing extra inbox and call load.',
];

const FAQS = [
  {
    q: `Why subtract saved salary when calculating ${brand.niche.descriptor} vacancy cost?`,
    a: 'Because CFOs evaluate net margin impact, not gross revenue alone. While a seat is open you do not pay that clinician’s salary, FICA, or benefits, so subtracting unpaid compensation isolates the true net operating cash bleed.',
  },
  {
    q: 'Should we enter billed charges or net collections per visit?',
    a: 'Always enter net collected dollars per completed visit after contractual payer write-offs and bad debt. Entering chargemaster rates overstates lost revenue.',
  },
  {
    q: 'Why include credentialing days in the vacancy window?',
    a: 'A seat stops losing money on the first billable patient day, not on the day an offer letter is signed. Notice periods, state board endorsement, and commercial/PECOS payer paneling all extend the unfunded or unbillable window.',
  },
  {
    q: 'When does a locum bridge make financial sense?',
    a: 'Even when a daily locum rate is close to per-day collections, covering part of the schedule preserves established patient panels, keeps referral pipelines warm, and prevents remaining clinicians from burning out during a 90-day onboarding cycle.',
  },
] as const;

const jsonLd = (obj: object): string =>
  JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

export default function CostOfVacancyCalculatorPage() {
  const defaultBase = Number(STAT_SOURCES.npMedianWageBls.value);

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
              { label: 'Cost of Vacancy' },
            ]}
          />
          <div style={{ maxWidth: '760px' }}>
            <p style={{ fontSize: '13px', fontWeight: 600, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '10px' }}>
              Free Tool · For Employers & Clinic Owners
            </p>
            <h1 className="font-lora" style={{ fontSize: 'clamp(2rem, 4.4vw, 2.9rem)', fontWeight: 800, lineHeight: 1.12, color: '#1A2E35', margin: '0 0 16px' }}>
              What an unfilled {brand.niche.descriptor} seat costs per month
            </h1>
            <p style={{ fontSize: '17px', color: '#5A4A42', lineHeight: 1.65, margin: 0 }}>
              Work through missed patient visits, foregone net collections, saved payroll, and optional locum bridge
              coverage on your own clinic numbers, with a printable summary for leadership approval.
            </p>
          </div>
        </section>
      </div>

      <section style={{ background: TOOL_PANEL_BG, padding: '44px 20px 56px' }}>
        <div style={{ maxWidth: '1080px', margin: '0 auto' }}>
          <CostOfVacancyCalculatorClient defaultAnnualSalary={defaultBase} />
        </div>
      </section>

      <section style={{ background: '#FFF', padding: '56px 20px' }}>
        <div style={{ maxWidth: '860px', margin: '0 auto' }}>
          <AssumptionsPanel
            title="How this vacancy model is built"
            assumptions={ASSUMPTIONS}
            exclusions={EXCLUSIONS}
            reviewedOn="2026-11-26"
            sources={[
              { label: STAT_SOURCES.npMedianWageBls.source, url: STAT_SOURCES.npMedianWageBls.sourceUrl },
              { label: 'Credentialing & payer paneling timeline planner', url: '/tools/credentialing-timeline-planner' },
              { label: 'Cost-per-hire recruiting channel comparison', url: '/tools/cost-per-hire-calculator' },
            ]}
          />
        </div>
      </section>

      <section style={{ background: TOOL_HERO_BG, padding: '64px 20px' }}>
        <div style={{ maxWidth: '760px', margin: '0 auto' }}>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 32px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '28px' }}>
            Vacancy cost questions
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
            Related clinic finance & hiring tools
          </h2>
          <div className="tool-three-col" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
            {[
              { href: '/tools/clinic-profitability-calculator', title: 'Clinic profitability modeler', blurb: 'Break-even daily visits and W-2 vs 1099 split margins for a new hire.' },
              { href: '/tools/credentialing-timeline-planner', title: 'Credentialing timeline planner', blurb: 'Work backwards from your target go-live date across state BON, DEA, and payers.' },
              { href: '/tools/cost-per-hire-calculator', title: 'Cost-per-hire calculator', blurb: 'Flat-fee posting vs sponsored CPC spend and agency contingency fees.' },
            ].map((l) => (
              <Link key={l.href} href={l.href} className="tool-card" style={{ ...clayCard, padding: '20px 20px 18px', textDecoration: 'none', display: 'block' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <Clock size={15} color={TOOL_ACCENT} aria-hidden="true" />
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
