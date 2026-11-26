import { brand } from '@/config/brand';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, HelpCircle, ShieldCheck } from 'lucide-react';
import Breadcrumbs from '@/components/Breadcrumbs';
import { toolApplicationCategory } from '@/app/tools/tools-registry';
import AssumptionsPanel from '@/components/tools/AssumptionsPanel';
import PrescriptiveAuthorityCheckerClient from '@/components/tools/PrescriptiveAuthorityCheckerClient';
import { STAT_SOURCES } from '@/lib/stats-sources';
import { TOOL_ACCENT, TOOL_HERO_BG, TOOL_PAGE_CSS, TOOL_PANEL_BG, clayCard } from '@/components/tools/tool-theme';

export const revalidate = 86400;

const PAGE_PATH = '/tools/prescriptive-authority-checker';
const PAGE_URL = `${brand.baseUrl}${PAGE_PATH}`;
const PAGE_TITLE = `${brand.niche.long} Prescriptive Authority & Schedule II to V Lookup by State`;
const PAGE_DESCRIPTION = `Check ${brand.niche.descriptor} controlled-substance prescribing rules (Schedules II to V), separate state CSR/CDS registration requirements, transition hours, and DEA MATE Act rules across all 50 states and DC.`;
const OG_IMAGE = `${brand.baseUrl}/api/og?title=${encodeURIComponent(`${brand.niche.short} Prescriptive Authority by State`)}&type=page`;

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  keywords: [
    `${brand.niche.descriptor} prescriptive authority by state`,
    `can ${brand.niche.short.toLowerCase()}s prescribe schedule 2 by state`,
    'state controlled substance registration csr cds states',
    `${brand.niche.short.toLowerCase()} dea registration requirements`,
    'mate act 8 hour dea requirement',
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
  `Practice-authority tiers (Full, Reduced, Restricted) and per-state practice environment notes read directly from our sourced AANP dataset (${STAT_SOURCES.fullPracticeStates.formatted} grant full practice authority as of ${STAT_SOURCES.fullPracticeStates.asOf}).`,
  'State CSR/CDS flags identify jurisdictions where a controlled-substance license from a state pharmacy, health, or narcotics bureau is required in addition to Board of Nursing prescriptive authority and federal DEA registration.',
  'Schedule II nuance callouts flag states where statutory formulary, setting, or day-supply limits restrict Schedule II prescribing even when Schedules III to V are authorized.',
];

const EXCLUSIONS: readonly string[] = [
  'Exact acute-pain opioid day-supply limits (such as 3-day, 5-day, or 7-day initial acute Rx limits), which vary by statute and clinical indication.',
  'Board-level fee schedules, pharmacology CE contact-hour counts per renewal cycle, and state PDMP registration workflows. Always confirm current rules directly with the state board of nursing and state pharmacy/CSR agency before prescribing.',
];

const FAQS = [
  {
    q: 'Why do some states require both a state CSR/CDS and a federal DEA number?',
    a: 'About two dozen jurisdictions regulate controlled substances under a state Controlled Substances Act administered by a Board of Pharmacy, Department of Health, or Narcotics Bureau separate from the Board of Nursing. In those states, the DEA will not issue a federal registration until your state CSR/CDS number is active.',
  },
  {
    q: 'Can I use one DEA number to prescribe across multiple telehealth states?',
    a: 'Federal Controlled Substances Act rules tie DEA registration to each state in which you practice and prescribe controlled substances. Multi-state telehealth clinicians prescribing controlled substances generally need state prescriptive authority (plus any state CSR) and a state-specific DEA registration in the state where the patient is physically located.',
  },
  {
    q: 'Which states place special limits on Schedule II prescribing?',
    a: 'States such as Georgia, Oklahoma, Texas (outside qualifying hospital/ED/hospice settings), Arkansas, and Alabama impose distinct statutory restrictions or separate permits on Schedule II controlled substances compared with Schedules III to V. Select any state above to read its specific pathway.',
  },
  {
    q: 'What is the DEA MATE Act 8-hour requirement?',
    a: 'Under the Medication Access and Training Expansion (MATE) Act, all DEA-registered practitioners (other than veterinarians) must complete a one-time 8-hour training requirement on treating and managing patients with opioid or other substance-use disorders when applying for or renewing a DEA registration.',
  },
] as const;

const jsonLd = (obj: object): string =>
  JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

export default function PrescriptiveAuthorityCheckerPage() {
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
        <section style={{ maxWidth: '1120px', margin: '0 auto', padding: '32px 20px 56px' }}>
          <Breadcrumbs
            items={[
              { label: 'Home', href: '/' },
              { label: 'Tools', href: '/tools' },
              { label: 'Prescriptive Authority Lookup' },
            ]}
          />
          <div style={{ maxWidth: '760px' }}>
            <p style={{ fontSize: '13px', fontWeight: 600, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '10px' }}>
              Free Tool · 51 Jurisdictions
            </p>
            <h1 className="font-lora" style={{ fontSize: 'clamp(2rem, 4.4vw, 2.9rem)', fontWeight: 800, lineHeight: 1.12, color: '#1A2E35', margin: '0 0 16px' }}>
              {brand.niche.short} prescriptive authority & Schedule II to V lookup
            </h1>
            <p style={{ fontSize: '17px', color: '#5A4A42', lineHeight: 1.65, margin: 0 }}>
              Check Schedule II to V controlled-substance authority, whether a separate state CSR or CDS registration
              is required before filing for your federal DEA number, and transition-to-practice rules in every state.
            </p>
          </div>
        </section>
      </div>

      <section style={{ background: TOOL_PANEL_BG, padding: '44px 20px 56px' }}>
        <div style={{ maxWidth: '1120px', margin: '0 auto' }}>
          <PrescriptiveAuthorityCheckerClient />
        </div>
      </section>

      <section style={{ background: '#FFF', padding: '56px 20px' }}>
        <div style={{ maxWidth: '860px', margin: '0 auto' }}>
          <AssumptionsPanel
            title="How this prescriptive-authority lookup is sourced"
            assumptions={ASSUMPTIONS}
            exclusions={EXCLUSIONS}
            reviewedOn="2026-11-26"
            sources={[
              { label: STAT_SOURCES.fullPracticeStates.source, url: STAT_SOURCES.fullPracticeStates.sourceUrl },
              { label: 'DEA Diversion Control Division: Mid-Level Practitioners Authorization by State', url: 'https://www.deadiversion.usdoj.gov/drugreg/practioners/index.html' },
              { label: 'Scope of practice explorer (51 jurisdictions)', url: '/scope-of-practice' },
            ]}
          />
        </div>
      </section>

      <section style={{ background: TOOL_HERO_BG, padding: '64px 20px' }}>
        <div style={{ maxWidth: '760px', margin: '0 auto' }}>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 32px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '28px' }}>
            Prescriptive authority & DEA questions
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
            Related licensure & career tools
          </h2>
          <div className="tool-three-col" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
            {[
              { href: '/tools/licensure-checker', title: 'Licensure checker & planner', blurb: 'Line up multiple states by practice authority and RN compact rules.' },
              { href: '/scope-of-practice', title: 'Scope of practice explorer', blurb: 'State boards of nursing links, guides, and live job counts.' },
              { href: '/tools/credentialing-timeline-planner', title: 'Credentialing timeline planner', blurb: 'Sequence state BON, CSR/DEA, and payer paneling.' },
            ].map((l) => (
              <Link key={l.href} href={l.href} className="tool-card" style={{ ...clayCard, padding: '20px 20px 18px', textDecoration: 'none', display: 'block' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <ShieldCheck size={15} color={TOOL_ACCENT} aria-hidden="true" />
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
