import { brand } from '@/config/brand';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, HelpCircle, Layers } from 'lucide-react';
import Breadcrumbs from '@/components/Breadcrumbs';
import { toolApplicationCategory } from '@/app/tools/tools-registry';
import AssumptionsPanel from '@/components/tools/AssumptionsPanel';
import IncidentToRoiCalculatorClient from '@/components/tools/IncidentToRoiCalculatorClient';
import { TOOL_ACCENT, TOOL_HERO_BG, TOOL_PAGE_CSS, TOOL_PANEL_BG, clayCard } from '@/components/tools/tool-theme';

export const revalidate = 86400;

const PAGE_PATH = '/tools/incident-to-roi-calculator';
const PAGE_URL = `${brand.baseUrl}${PAGE_PATH}`;
const PAGE_TITLE = `Medicare 85% Direct vs 100% Incident-To Billing Calculator for ${brand.niche.short}s`;
const PAGE_DESCRIPTION = `Model physician + ${brand.niche.descriptor} care-team reimbursement: compare direct NPI billing at 85% of the Medicare Physician Fee Schedule against compliant 100% incident-to billing net of supervision time.`;
const OG_IMAGE = `${brand.baseUrl}/api/og?title=${encodeURIComponent('Medicare 85% vs 100% Incident-To Calculator')}&type=page`;

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  keywords: [
    `incident to billing ${brand.niche.descriptor} calculator`,
    `medicare 85 percent rule ${brand.niche.short.toLowerCase()}`,
    '42 cfr 410.26 incident to requirements',
    `direct billing vs incident to ${brand.niche.short.toLowerCase()}`,
    'care team billing roi calculator',
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
  `Under Social Security Act Section 1833(a)(1)(O) and CMS Physician Fee Schedule rules, covered services billed directly under a ${brand.niche.descriptor}'s NPI reimburse at 85% of the physician fee schedule amount.`,
  'Under 42 CFR 410.26, qualifying non-facility office (POS 11) follow-up encounters that meet every CMS incident-to requirement reimburse at 100% of the physician fee schedule.',
  'Because new patients, established patients presenting with a new problem, and encounters when no group physician is in the office suite must be billed directly at 85%, the model lets you set the realistic qualifying share rather than assuming 100% conversion.',
];

const EXCLUSIONS: readonly string[] = [
  'Hospital inpatient, outpatient department, or emergency department split/shared visits, which are governed by separate CMS substantive-portion rules rather than 42 CFR 410.26 office incident-to rules.',
  'Billing compliance or legal advice. Incident-to overbilling is a frequent OIG audit target; verify workflow documentation with a certified healthcare compliance officer.',
];

const FAQS = [
  {
    q: 'Why can’t 100% of a clinic’s Medicare visits be billed incident-to?',
    a: 'CMS prohibits incident-to billing for new patients, for established patients who bring up a new clinical problem or require a change outside the physician’s established plan of care, and on any half-day when no supervising physician from the group is present in the office suite.',
  },
  {
    q: 'Does direct 85% billing ever outperform incident-to operationally?',
    a: 'Frequently yes. Direct billing under the clinician’s own NPI lets the clinician see new patients, adjust treatment plans autonomously without pulling a physician off their own schedule, and practice on days or in satellite offices without on-site physician presence.',
  },
  {
    q: 'Do commercial insurers pay 85% or 100% for APRN claims?',
    a: 'Each commercial payer sets its own contracting policy. Some pay 85% of the physician fee schedule while others credential and reimburse APRNs at 100% or prohibit incident-to billing altogether. Check each payer’s provider manual before modeling commercial lift.',
  },
  {
    q: 'How does direct NPI vs incident-to billing affect wRVU tracking?',
    a: 'When encounters are billed under a supervising physician’s NPI, EHR billing reports attribute those wRVUs to the physician unless your practice tracks rendering-clinician productivity separately in the EHR.',
  },
] as const;

const jsonLd = (obj: object): string =>
  JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

export default function IncidentToRoiCalculatorPage() {
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
              { label: 'Incident-To ROI Calculator' },
            ]}
          />
          <div style={{ maxWidth: '760px' }}>
            <p style={{ fontSize: '13px', fontWeight: 600, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '10px' }}>
              Free Tool · For Medical Groups & Clinic Owners
            </p>
            <h1 className="font-lora" style={{ fontSize: 'clamp(2rem, 4.4vw, 2.9rem)', fontWeight: 800, lineHeight: 1.12, color: '#1A2E35', margin: '0 0 16px' }}>
              Medicare 85% direct vs 100% incident-to billing calculator
            </h1>
            <p style={{ fontSize: '17px', color: '#5A4A42', lineHeight: 1.65, margin: 0 }}>
              Weigh the 15% Medicare fee-schedule lift on qualifying established visits against physician supervision
              time and scheduling rigidity, with a built-in CMS 42 CFR 410.26 compliance checklist.
            </p>
          </div>
        </section>
      </div>

      <section style={{ background: TOOL_PANEL_BG, padding: '44px 20px 56px' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <IncidentToRoiCalculatorClient />
        </div>
      </section>

      <section style={{ background: '#FFF', padding: '56px 20px' }}>
        <div style={{ maxWidth: '860px', margin: '0 auto' }}>
          <AssumptionsPanel
            title="How this Medicare billing comparison works"
            assumptions={ASSUMPTIONS}
            exclusions={EXCLUSIONS}
            reviewedOn="2026-11-26"
            sources={[
              { label: 'eCFR: 42 CFR 410.26 Services and supplies incident to a physician’s professional services', url: 'https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-B/part-410/subpart-B/section-410.26' },
              { label: 'CMS Medicare Claims Processing Manual, Chapter 12 (Nonphysician Practitioners)', url: 'https://www.cms.gov/regulations-and-guidance/guidance/manuals/downloads/clm104c12.pdf' },
              { label: 'Clinic hire break-even & profitability calculator', url: '/tools/clinic-profitability-calculator' },
            ]}
          />
        </div>
      </section>

      <section style={{ background: TOOL_HERO_BG, padding: '64px 20px' }}>
        <div style={{ maxWidth: '760px', margin: '0 auto' }}>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 32px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '28px' }}>
            Incident-to billing questions
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
            Related coding & clinic economics tools
          </h2>
          <div className="tool-three-col" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
            {[
              { href: '/tools/clinic-profitability-calculator', title: 'Clinic profitability modeler', blurb: 'W-2 vs 1099 split and break-even daily patient visits.' },
              { href: '/tools/em-coding-calculator', title: 'Outpatient E/M coding calculator', blurb: '2023+ AMA 2-of-3 MDM matrix and total encounter time.' },
              { href: '/tools/wrvu-calculator', title: 'wRVU bonus calculator', blurb: 'CMS CY2026 work RVUs and productivity bonus modeling.' },
            ].map((l) => (
              <Link key={l.href} href={l.href} className="tool-card" style={{ ...clayCard, padding: '20px 20px 18px', textDecoration: 'none', display: 'block' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <Layers size={15} color={TOOL_ACCENT} aria-hidden="true" />
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
