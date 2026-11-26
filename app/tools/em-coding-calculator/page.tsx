import { brand } from '@/config/brand';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, ClipboardCheck, HelpCircle } from 'lucide-react';
import Breadcrumbs from '@/components/Breadcrumbs';
import { toolApplicationCategory } from '@/app/tools/tools-registry';
import AssumptionsPanel from '@/components/tools/AssumptionsPanel';
import EmCodingCalculatorClient from '@/components/tools/EmCodingCalculatorClient';
import { TOOL_ACCENT, TOOL_HERO_BG, TOOL_PAGE_CSS, TOOL_PANEL_BG, clayCard } from '@/components/tools/tool-theme';

export const revalidate = 86400;

const PAGE_PATH = '/tools/em-coding-calculator';
const PAGE_URL = `${brand.baseUrl}${PAGE_PATH}`;
const PAGE_TITLE = `Outpatient E/M Coding & MDM Calculator for ${brand.niche.short}s (99202 to 99215)`;
const PAGE_DESCRIPTION = `Interactive 2023+ AMA outpatient E/M level calculator (99202 to 99215): side-by-side 2-of-3 Medical Decision Making matrix and Total Time encounter slider with CMS wRVU values and prolonged service thresholds.`;
const OG_IMAGE = `${brand.baseUrl}/api/og?title=${encodeURIComponent('Outpatient E/M Coding & MDM Calculator')}&type=page`;

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  keywords: [
    'em coding calculator 99213 vs 99214',
    `outpatient mdm calculator ${brand.niche.short.toLowerCase()}`,
    'ama em guidelines 2 of 3 mdm matrix',
    '99202 to 99215 time thresholds',
    'g2212 vs 99417 prolonged services calculator',
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
  'Follows AMA CPT Outpatient Office / Other Outpatient Evaluation & Management leveling guidelines: history and physical exam are documented as clinically appropriate, while code selection (99202 to 99205 new; 99212 to 99215 established) rests on EITHER Medical Decision Making (2 of 3 elements) OR Total Time on the calendar date of the encounter.',
  'MDM overall level equals the second-highest rank across (1) Number & Complexity of Problems Addressed, (2) Amount &/or Complexity of Data to Be Reviewed and Analyzed, and (3) Risk of Complications and/or Morbidity or Mortality of Patient Management.',
  'Prolonged service counters distinguish AMA CPT 99417 (15 full minutes beyond minimum of 99205/99215: 75 min new, 55 min established) from CMS Medicare HCPCS G2212 (15 full minutes beyond maximum of 99205/99215: 89 min new, 69 min established).',
];

const EXCLUSIONS: readonly string[] = [
  'Medical necessity determination, modifier 25 unbundling rules when a procedure or preventive visit occurs on the same day, and payer-specific downcoding edits.',
  'Patient-specific coding or legal compliance advice. Runs 100% in your browser with zero PHI transmission.',
];

const FAQS = [
  {
    q: 'Why do so many clinicians accidentally undercode 99214 visits as 99213?',
    a: 'Under AMA MDM rules, managing two or more stable chronic illnesses (for example hypertension and type 2 diabetes) OR one chronic illness with exacerbation (such as uncontrolled asthma) meets Moderate Problems, and prescription drug management (initiating, adjusting, or continuing a prescription after clinical review) meets Moderate Risk. Meeting 2 of the 3 elements supports 99214 even when zero labs were ordered that day.',
  },
  {
    q: 'What counts toward Total Time on the date of the encounter?',
    a: 'Same-calendar-day clinician time spent preparing to see the patient (reviewing external records/labs), obtaining history, performing the exam, counseling/educating the patient or family, ordering medications/tests/referrals, communicating with other clinicians, and documenting the clinical note in the EHR. Exclude time spent on separately billed procedures and time spent on a different calendar date.',
  },
  {
    q: 'Why do CPT 99417 and Medicare G2212 start at different minute marks?',
    a: 'AMA CPT counts 15 minutes from the bottom of the level-5 time band (40 + 15 = 55 minutes for 99215; 60 + 15 = 75 minutes for 99205), whereas CMS requires 15 full minutes beyond the top of the level-5 time band (54 + 15 = 69 minutes for 99215; 74 + 15 = 89 minutes for 99205).',
  },
  {
    q: 'Does Ordering + Reviewing the same lab count as two data points?',
    a: 'No. Under AMA CPT Data rules, ordering a unique test includes reviewing its result, so a single CBC ordered and reviewed counts as one unique test, not two.',
  },
] as const;

const jsonLd = (obj: object): string =>
  JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

export default function EmCodingCalculatorPage() {
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
              { label: 'Outpatient E/M Coding Calculator' },
            ]}
          />
          <div style={{ maxWidth: '760px' }}>
            <p style={{ fontSize: '13px', fontWeight: 600, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '10px' }}>
              Free Clinical Reference · Zero PHI
            </p>
            <h1 className="font-lora" style={{ fontSize: 'clamp(2rem, 4.4vw, 2.9rem)', fontWeight: 800, lineHeight: 1.12, color: '#1A2E35', margin: '0 0 16px' }}>
              Outpatient E/M coding & 2-of-3 MDM calculator
            </h1>
            <p style={{ fontSize: '17px', color: '#5A4A42', lineHeight: 1.65, margin: 0 }}>
              Check outpatient E/M levels (99202 to 99215) side by side using the 2023+ AMA 2-of-3 Medical Decision
              Making grid and Total Time on the date of the encounter, with instant CMS wRVU lookup.
            </p>
          </div>
        </section>
      </div>

      <section style={{ background: TOOL_PANEL_BG, padding: '44px 20px 56px' }}>
        <div style={{ maxWidth: '1120px', margin: '0 auto' }}>
          <EmCodingCalculatorClient />
        </div>
      </section>

      <section style={{ background: '#FFF', padding: '56px 20px' }}>
        <div style={{ maxWidth: '860px', margin: '0 auto' }}>
          <AssumptionsPanel
            title="How this E/M leveling reference works"
            assumptions={ASSUMPTIONS}
            exclusions={EXCLUSIONS}
            reviewedOn="2026-11-26"
            sources={[
              { label: 'AMA CPT Evaluation and Management (E/M) Services Guidelines', url: 'https://www.ama-assn.org/practice-management/cpt/cpt-evaluation-and-management' },
              { label: 'CMS Evaluation & Management Visits & Prolonged Services Guide', url: 'https://www.cms.gov/medicare/payment/fee-schedules/physician' },
              { label: 'wRVU & productivity bonus calculator', url: '/tools/wrvu-calculator' },
            ]}
          />
        </div>
      </section>

      <section style={{ background: TOOL_HERO_BG, padding: '64px 20px' }}>
        <div style={{ maxWidth: '760px', margin: '0 auto' }}>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 32px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '28px' }}>
            Outpatient E/M coding questions
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
            Related productivity & practice tools
          </h2>
          <div className="tool-three-col" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
            {[
              { href: '/tools/wrvu-calculator', title: 'wRVU bonus calculator', blurb: 'See what your daily E/M mix earns under a productivity contract.' },
              { href: '/tools/incident-to-roi-calculator', title: 'Incident-to ROI calculator', blurb: 'Compare Medicare 85% direct vs 100% incident-to billing.' },
              { href: '/tools/prescriptive-authority-checker', title: 'Prescriptive authority lookup', blurb: 'State Schedule II to V rules and CSR/DEA requirements.' },
            ].map((l) => (
              <Link key={l.href} href={l.href} className="tool-card" style={{ ...clayCard, padding: '20px 20px 18px', textDecoration: 'none', display: 'block' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <ClipboardCheck size={15} color={TOOL_ACCENT} aria-hidden="true" />
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
