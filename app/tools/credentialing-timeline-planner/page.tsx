import { brand } from '@/config/brand';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, HelpCircle } from 'lucide-react';
import Breadcrumbs from '@/components/Breadcrumbs';
import { toolApplicationCategory } from '@/app/tools/tools-registry';
import AssumptionsPanel from '@/components/tools/AssumptionsPanel';
import CredentialingTimelinePlannerClient from '@/components/tools/CredentialingTimelinePlannerClient';
import { TOOL_ACCENT, TOOL_HERO_BG, TOOL_PAGE_CSS, TOOL_PANEL_BG, clayCard } from '@/components/tools/tool-theme';

export const revalidate = 86400;

const PAGE_PATH = '/tools/credentialing-timeline-planner';
const PAGE_URL = `${brand.baseUrl}${PAGE_PATH}`;
const PAGE_TITLE = `${brand.niche.long} Credentialing & Payer Paneling Timeline Planner`;
const PAGE_DESCRIPTION = `Plan backwards from your target first billable patient day across state APRN licensure, federal DEA/CSR, CAQH attestation, PECOS/Medicaid/commercial payer enrollment, and hospital privileging, with .ics calendar export.`;
const OG_IMAGE = `${brand.baseUrl}/api/og?title=${encodeURIComponent(`${brand.niche.long} Credentialing Timeline Planner`)}&type=page`;

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  keywords: [
    `${brand.niche.descriptor} credentialing timeline`,
    `${brand.niche.short.toLowerCase()} payer enrollment planner`,
    'caqh pecos credentialing checklist',
    'hospital privileging timeline calculator',
    `onboarding a ${brand.niche.descriptor}`,
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
  'The planner sequences two serial stages backwards from your target go-live date: pre-filing prerequisites (state APRN licensure and NPI/CAQH/malpractice packet) followed by parallel downstream tracks (DEA/CSR, payer enrollment, hospital privileging, and EHR onboarding).',
  'Every phase duration is an editable user-supplied planning input rather than a guaranteed government or payer turnaround. Replace each slider with your state board’s and top payers’ current processing queues.',
  'Calendar export (.ics) generates standard RFC 5545 all-day milestone events directly in your browser with zero server storage.',
];

const EXCLUSIONS: readonly string[] = [
  'Candidate sourcing, interviewing, and current-employer notice periods (which sit upstream of the signed-offer date).',
  'Retroactive billing effective-date policies, which vary between Medicare PECOS and individual commercial plans.',
];

const FAQS = [
  {
    q: 'Which credentialing steps must happen sequentially vs in parallel?',
    a: 'An active in-state APRN license and practice address are prerequisites before federal DEA registration, state CSR/CDS registration, and most commercial payer applications can be finalized. However, NPI taxonomy updates, CAQH ProView attestation, malpractice certificate binding, and hospital peer-reference collection can begin the day the offer is signed.',
  },
  {
    q: 'What slows down payer paneling most often?',
    a: 'Unexplained month-or-year gaps in work history on CAQH ProView, expired DEA or malpractice face sheets, mismatched NPPES Type 1 vs group Type 2 addresses, and missing collaborative or supervisory protocol filings in reduced or restricted states.',
  },
  {
    q: 'Why align hospital privileging packets with committee calendars?',
    a: 'Most hospital Credentials Committees, Medical Executive Committees (MEC), and Governing Boards meet once a month. Missing a packet cutoff by 48 hours routinely pushes clinical go-live back by a full 30 days.',
  },
  {
    q: 'Can a newly hired clinician see cash-pay or shadow visits while commercial panels finalize?',
    a: 'Once state APRN licensure, malpractice coverage, and any required state collaborative agreement are active, clinics frequently schedule orientation, shadowing, or self-pay encounters while awaiting final commercial payer effective dates. Never bill an insurer under another clinician’s NPI to work around pending credentialing unless every payer-specific locum or incident-to rule is satisfied.',
  },
] as const;

const jsonLd = (obj: object): string =>
  JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

export default function CredentialingTimelinePlannerPage() {
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
              { label: 'Credentialing Timeline Planner' },
            ]}
          />
          <div style={{ maxWidth: '760px' }}>
            <p style={{ fontSize: '13px', fontWeight: 600, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '10px' }}>
              Free Tool · For Practice Managers & Credentialing Teams
            </p>
            <h1 className="font-lora" style={{ fontSize: 'clamp(2rem, 4.4vw, 2.9rem)', fontWeight: 800, lineHeight: 1.12, color: '#1A2E35', margin: '0 0 16px' }}>
              {brand.niche.long} credentialing & payer paneling timeline planner
            </h1>
            <p style={{ fontSize: '17px', color: '#5A4A42', lineHeight: 1.65, margin: 0 }}>
              Pick your target first billable patient day, set each licensing and payer-enrollment queue on your own
              turnaround times, see your latest safe offer-signature deadline, and export milestones to your calendar.
            </p>
          </div>
        </section>
      </div>

      <section style={{ background: TOOL_PANEL_BG, padding: '44px 20px 56px' }}>
        <div style={{ maxWidth: '1120px', margin: '0 auto' }}>
          <CredentialingTimelinePlannerClient />
        </div>
      </section>

      <section style={{ background: '#FFF', padding: '56px 20px' }}>
        <div style={{ maxWidth: '860px', margin: '0 auto' }}>
          <AssumptionsPanel
            title="How this reverse timeline works"
            assumptions={ASSUMPTIONS}
            exclusions={EXCLUSIONS}
            reviewedOn="2026-11-26"
            sources={[
              { label: 'CMS PECOS Medicare Provider Enrollment', url: 'https://pecos.cms.hhs.gov/' },
              { label: 'DEA Diversion Control Division: Practitioner Registration', url: 'https://www.deadiversion.usdoj.gov/' },
              { label: 'State licensure & practice authority checker', url: '/tools/licensure-checker' },
            ]}
          />
        </div>
      </section>

      <section style={{ background: TOOL_HERO_BG, padding: '64px 20px' }}>
        <div style={{ maxWidth: '760px', margin: '0 auto' }}>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 32px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '28px' }}>
            Credentialing & onboarding questions
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
            Related hiring & licensure tools
          </h2>
          <div className="tool-three-col" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
            {[
              { href: '/tools/prescriptive-authority-checker', title: 'Prescriptive authority lookup', blurb: 'Check which states require a separate state CSR/CDS registration.' },
              { href: '/tools/cost-of-vacancy-calculator', title: 'Cost-of-vacancy calculator', blurb: 'Price what each extra 30 days of credentialing delay costs.' },
              { href: '/tools/licensure-checker', title: 'Licensure checker', blurb: 'State practice authority tiers and multi-state APRN planning.' },
            ].map((l) => (
              <Link key={l.href} href={l.href} className="tool-card" style={{ ...clayCard, padding: '20px 20px 18px', textDecoration: 'none', display: 'block' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <CheckCircle2 size={15} color={TOOL_ACCENT} aria-hidden="true" />
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
