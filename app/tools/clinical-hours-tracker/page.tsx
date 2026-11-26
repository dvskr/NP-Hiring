import { brand } from '@/config/brand';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, GraduationCap, HelpCircle } from 'lucide-react';
import Breadcrumbs from '@/components/Breadcrumbs';
import { toolApplicationCategory } from '@/app/tools/tools-registry';
import AssumptionsPanel from '@/components/tools/AssumptionsPanel';
import ClinicalHoursTrackerClient from '@/components/tools/ClinicalHoursTrackerClient';
import { TOOL_ACCENT, TOOL_HERO_BG, TOOL_PAGE_CSS, TOOL_PANEL_BG, clayCard } from '@/components/tools/tool-theme';

export const revalidate = 86400;

const PAGE_PATH = '/tools/clinical-hours-tracker';
const PAGE_URL = `${brand.baseUrl}${PAGE_PATH}`;
const PAGE_TITLE = `${brand.niche.long} Student Clinical Hours Tracker & ANCC vs AANPCB Planner`;
const PAGE_DESCRIPTION = `Track MSN and DNP direct clinical rotation hours across population domains right in your browser, export CSV logs, and compare ANCC vs AANPCB certification and 5-year CE renewal rules.`;
const OG_IMAGE = `${brand.baseUrl}/api/og?title=${encodeURIComponent(`${brand.niche.long} Clinical Hours & Board Planner`)}&type=page`;

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  keywords: [
    `${brand.niche.descriptor} clinical hours tracker`,
    `ANCC vs AANPCB certification requirements`,
    `MSN DNP clinical rotation log CSV`,
    `${brand.niche.short.toLowerCase()} recertification CE hours`,
    'DEA MATE Act 8 hour requirement',
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
  'Minimum initial board eligibility uses 500 faculty-supervised direct patient care hours per current ANCC and AANPCB national certification standards (many MSN tracks require 600 to 750 hours and DNP programs typically require 1,000 post-BSN clinical hours).',
  '5-year recertification rules reflect ANCC (75 contact hours including 25 pharmacotherapeutic hours plus 1 renewal category such as 1,000 practice hours) and AANPCB (100 contact hours including 25 pharmacotherapeutic hours plus 1,000 clinical practice hours, or exam).',
  'All clinical rotation log entries stay inside your browser localStorage and export locally as CSV; nothing is uploaded to a server.',
];

const EXCLUSIONS: readonly string[] = [
  'Official university clinical tracking systems of record (such as Typhon, Exxat, or Medatrax) required by your school registrar for faculty sign-off.',
  'Individual state Board of Nursing controlled-substance, opioid, or implicit-bias CE sub-mandates beyond national ANCC/AANPCB renewal rules.',
];

const FAQS = [
  {
    q: 'Do simulation hours count toward the 500 direct clinical hours minimum for ANCC and AANPCB?',
    a: 'Both ANCC and AANPCB require at least 500 faculty-supervised direct patient care clinical hours in your population focus. While NTF criteria allow programs to use simulation above the 500 direct-care floor, simulation hours generally cannot replace the initial 500 direct patient care hours.',
  },
  {
    q: 'Should I take the ANCC or AANPCB exam as a Family or Adult-Gerontology graduate?',
    a: 'State Boards of Nursing and hospital credentialing committees accept both ANCC (-BC) and AANPCB (-C) credentials equally for primary care tracks. Acute care (AGACNP-BC) is offered through ANCC, whereas emergency certification (ENP-C) is offered through AANPCB. Many students choose based on exam blueprint style and 5-year renewal rules.',
  },
  {
    q: 'What is the 8-hour DEA MATE Act training requirement?',
    a: 'Under federal law effective June 2023, all DEA-registered practitioners (including APRNs applying for a first DEA number or renewing) must attest to completing a one-time 8-hour training requirement on treating and managing patients with opioid or other substance-use disorders. Recent graduates can often satisfy this with qualifying coursework from their APRN curriculum.',
  },
  {
    q: 'Where is my clinical rotation log stored?',
    a: 'Exclusively in your device browser localStorage. Use the Export CSV button regularly to back up a copy to your personal drive, and never enter protected health information.',
  },
] as const;

const jsonLd = (obj: object): string =>
  JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

export default function ClinicalHoursTrackerPage() {
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
              { label: 'Clinical Hours Tracker' },
            ]}
          />
          <div style={{ maxWidth: '760px' }}>
            <p style={{ fontSize: '13px', fontWeight: 600, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '10px' }}>
              Free Tool · For Students & Clinicians
            </p>
            <h1 className="font-lora" style={{ fontSize: 'clamp(2rem, 4.4vw, 2.9rem)', fontWeight: 800, lineHeight: 1.12, color: '#1A2E35', margin: '0 0 16px' }}>
              {brand.niche.short} clinical rotation hours tracker & board planner
            </h1>
            <p style={{ fontSize: '17px', color: '#5A4A42', lineHeight: 1.65, margin: 0 }}>
              Log MSN and DNP preceptorship shifts across population domains, project your graduation countdown, export
              a clean CSV backup, and compare ANCC vs AANPCB initial certification and 5-year renewal rules.
            </p>
          </div>
        </section>
      </div>

      <section style={{ background: TOOL_PANEL_BG, padding: '44px 20px 56px' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <ClinicalHoursTrackerClient nicheShort={brand.niche.short} />
        </div>
      </section>

      <section style={{ background: '#FFF', padding: '56px 20px' }}>
        <div style={{ maxWidth: '860px', margin: '0 auto' }}>
          <AssumptionsPanel
            title="How board hour rules & storage work"
            assumptions={ASSUMPTIONS}
            exclusions={EXCLUSIONS}
            reviewedOn="2026-11-26"
            sources={[
              { label: 'ANCC Certification & Renewal Handbook', url: 'https://www.nursingworld.org/ancc/' },
              { label: 'AANPCB Candidate & Recertification Handbooks', url: 'https://www.aanpcert.org/' },
              { label: 'DEA MATE Act Training Guidance', url: 'https://www.deadiversion.usdoj.gov/' },
            ]}
          />
        </div>
      </section>

      <section style={{ background: TOOL_HERO_BG, padding: '64px 20px' }}>
        <div style={{ maxWidth: '760px', margin: '0 auto' }}>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 32px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '28px' }}>
            Clinical hours & certification questions
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
            Next steps for new graduates
          </h2>
          <div className="tool-three-col" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
            {[
              { href: '/tools/licensure-checker', title: 'State licensure checker', blurb: 'Check full vs reduced vs restricted practice rules in all 50 states.' },
              { href: '/tools/prescriptive-authority-checker', title: 'Prescriptive authority lookup', blurb: 'See Schedule II to V rules and state CSR licenses before applying for DEA.' },
              { href: '/tools/loan-repayment-calculator', title: 'Loan repayment modeler', blurb: 'Compare PSLF, NHSC, and NURSE Corps against higher-paying private clinics.' },
            ].map((l) => (
              <Link key={l.href} href={l.href} className="tool-card" style={{ ...clayCard, padding: '20px 20px 18px', textDecoration: 'none', display: 'block' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <GraduationCap size={15} color={TOOL_ACCENT} aria-hidden="true" />
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
