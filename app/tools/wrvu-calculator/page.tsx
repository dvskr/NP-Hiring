import { brand } from '@/config/brand';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Activity, ArrowRight, HelpCircle } from 'lucide-react';
import Breadcrumbs from '@/components/Breadcrumbs';
import { toolApplicationCategory } from '@/app/tools/tools-registry';
import AssumptionsPanel from '@/components/tools/AssumptionsPanel';
import WrvuCalculatorClient from '@/components/tools/WrvuCalculatorClient';
import { TOOL_ACCENT, TOOL_HERO_BG, TOOL_PAGE_CSS, TOOL_PANEL_BG, clayCard } from '@/components/tools/tool-theme';

export const revalidate = 86400;

const PAGE_PATH = '/tools/wrvu-calculator';
const PAGE_URL = `${brand.baseUrl}${PAGE_PATH}`;
const PAGE_TITLE = `${brand.niche.long} wRVU & Productivity Bonus Calculator (CMS CY2026)`;
const PAGE_DESCRIPTION = `Calculate annual ${brand.niche.descriptor} work RVUs and productivity bonus pay from published CMS CY2026 E/M and procedural wRVU values across primary care, urgent care, dermatology, orthopedics, and hospitalist schedules.`;
const OG_IMAGE = `${brand.baseUrl}/api/og?title=${encodeURIComponent(`${brand.niche.long} wRVU & Bonus Calculator`)}&type=page`;

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  keywords: [
    `${brand.niche.descriptor} wrvu calculator`,
    `${brand.niche.short.toLowerCase()} rvu bonus calculator`,
    'cms 2026 wrvu table 99213 99214',
    `how many wrvus does an ${brand.niche.short.toLowerCase()} generate`,
    'productivity bonus threshold calculator',
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
  'Work RVU (wRVU) unit weights per CPT code come from the CMS Physician Fee Schedule relative value file (e.g. 99213 = 1.30 wRVU, 99214 = 1.92 wRVU, 99215 = 2.80 wRVU, 99204 = 2.60 wRVU, 99291 = 4.50 wRVU).',
  'Specialty presets populate an editable starting illustration of daily encounter mix and clinical days; replace them with your own schedule and your contract’s exact wRVU threshold and conversion factor.',
  'Productivity bonus equals max(0, annual wRVUs − annual threshold) × conversion rate per wRVU.',
];

const EXCLUSIONS: readonly string[] = [
  'Practice Expense (PE) and Malpractice (MP) RVUs, Geographic Practice Cost Indices (GPCI), and multiple-procedure reduction adjustments.',
  'Incident-to attribution rules: if an employer bills follow-up visits under a supervising physician’s NPI without crediting rendering-provider wRVUs internally, EHR billing reports can undercount your wRVU production. Verify how your contract credits split/shared and incident-to visits in writing.',
];

const FAQS = [
  {
    q: 'Why does coding accuracy between 99213 and 99214 move annual bonus pay so dramatically?',
    a: 'CMS values 99213 at 1.30 wRVU and 99214 at 1.92 wRVU, a 0.62 wRVU difference per visit. When clinically appropriate moderate-complexity visits (such as managing two stable chronic illnesses with prescription drug management) are habitually undercoded as 99213 five times a day across 210 clinic days, that leaves over 650 wRVUs a year uncounted.',
  },
  {
    q: 'What should I verify in an employment contract’s wRVU bonus clause?',
    a: 'Confirm four things in writing: (1) which year’s CMS PFS schedule governs the wRVU weights, (2) whether you receive full wRVU credit on encounters billed incident-to a physician or split/shared inpatient visits, (3) whether the threshold prorates for PTO, CME, or parental leave, and (4) whether bonuses settle quarterly or annually (and whether slow quarters claw back strong quarters).',
  },
  {
    q: 'How do I check if my wRVU threshold is realistic?',
    a: 'Divide your contract’s base salary by the bonus conversion rate ($/wRVU). If your threshold is far higher than Base ÷ Conversion Rate, the employer is requiring you to generate substantially more value per base dollar before any bonus begins.',
  },
  {
    q: 'Do surgical global periods or bundled visits generate separate wRVUs?',
    a: 'Post-operative follow-up visits inside a global surgical package (such as CPT 99024) carry 0.00 wRVU on the CMS fee schedule, which is an important adjustment to ask about in surgical subspecialty offers.',
  },
] as const;

const jsonLd = (obj: object): string =>
  JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

export default function WrvuCalculatorPage() {
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
              { label: 'wRVU Calculator' },
            ]}
          />
          <div style={{ maxWidth: '760px' }}>
            <p style={{ fontSize: '13px', fontWeight: 600, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '10px' }}>
              Free Tool · For Clinicians & Medical Groups
            </p>
            <h1 className="font-lora" style={{ fontSize: 'clamp(2rem, 4.4vw, 2.9rem)', fontWeight: 800, lineHeight: 1.12, color: '#1A2E35', margin: '0 0 16px' }}>
              {brand.niche.short} wRVU & productivity bonus calculator
            </h1>
            <p style={{ fontSize: '17px', color: '#5A4A42', lineHeight: 1.65, margin: 0 }}>
              Translate your daily E/M and procedural CPT mix into annual CMS work RVUs, see how many patients per day
              it takes to clear your bonus threshold, and model your total annual compensation.
            </p>
          </div>
        </section>
      </div>

      <section style={{ background: TOOL_PANEL_BG, padding: '44px 20px 56px' }}>
        <div style={{ maxWidth: '1120px', margin: '0 auto' }}>
          <WrvuCalculatorClient />
        </div>
      </section>

      <section style={{ background: '#FFF', padding: '56px 20px' }}>
        <div style={{ maxWidth: '860px', margin: '0 auto' }}>
          <AssumptionsPanel
            title="How this wRVU calculator is built"
            assumptions={ASSUMPTIONS}
            exclusions={EXCLUSIONS}
            reviewedOn="2026-11-26"
            sources={[
              { label: 'CMS Physician Fee Schedule Look-Up & RVU Files', url: 'https://www.cms.gov/medicare/payment/fee-schedules/physician' },
              { label: 'Outpatient E/M coding & 2-of-3 MDM calculator', url: '/tools/em-coding-calculator' },
              { label: 'Medicare 85% direct vs 100% incident-to calculator', url: '/tools/incident-to-roi-calculator' },
            ]}
          />
        </div>
      </section>

      <section style={{ background: TOOL_HERO_BG, padding: '64px 20px' }}>
        <div style={{ maxWidth: '760px', margin: '0 auto' }}>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 32px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '28px' }}>
            Questions about wRVU contracts
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
            Related coding & offer tools
          </h2>
          <div className="tool-three-col" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
            {[
              { href: '/tools/em-coding-calculator', title: 'Outpatient E/M coding calculator', blurb: '2023+ AMA 2-of-3 MDM matrix and total encounter time.' },
              { href: '/tools/offer-analyzer', title: 'Offer competitiveness analyzer', blurb: 'Grade your base + wRVU bonus against live state pay.' },
              { href: '/tools/total-comp-comparator', title: 'Total comp comparator', blurb: 'Compare a flat-salary offer against a base + wRVU offer.' },
            ].map((l) => (
              <Link key={l.href} href={l.href} className="tool-card" style={{ ...clayCard, padding: '20px 20px 18px', textDecoration: 'none', display: 'block' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <Activity size={15} color={TOOL_ACCENT} aria-hidden="true" />
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
