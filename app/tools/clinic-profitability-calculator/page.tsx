import { brand } from '@/config/brand';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, DollarSign, HelpCircle } from 'lucide-react';
import Breadcrumbs from '@/components/Breadcrumbs';
import { toolApplicationCategory } from '@/app/tools/tools-registry';
import AssumptionsPanel from '@/components/tools/AssumptionsPanel';
import ClinicProfitabilityCalculatorClient from '@/components/tools/ClinicProfitabilityCalculatorClient';
import { STAT_SOURCES } from '@/lib/stats-sources';
import { TOOL_ACCENT, TOOL_HERO_BG, TOOL_PAGE_CSS, TOOL_PANEL_BG, clayCard } from '@/components/tools/tool-theme';

export const revalidate = 86400;

const PAGE_PATH = '/tools/clinic-profitability-calculator';
const PAGE_URL = `${brand.baseUrl}${PAGE_PATH}`;
const PAGE_TITLE = `${brand.niche.long} Hire Break-Even & Clinic Profitability Calculator`;
const PAGE_DESCRIPTION = `Model the clinic ROI of hiring a ${brand.niche.descriptor}: completed daily visits, net collection per visit, no-show rate, collaborating physician retainer, seat overhead, and W-2 salary vs 1099 percentage split.`;
const OG_IMAGE = `${brand.baseUrl}/api/og?title=${encodeURIComponent(`${brand.niche.long} Hire Profitability & Break-Even`)}&type=page`;

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  keywords: [
    `${brand.niche.descriptor} clinic profitability calculator`,
    `hiring an ${brand.niche.short.toLowerCase()} roi calculator`,
    `${brand.niche.short.toLowerCase()} break even visits per day`,
    `w2 vs 1099 ${brand.niche.short.toLowerCase()} split clinic margin`,
    'collaborating physician fee calculator',
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
  'Completed annual visits equal scheduled visits per day × (1 − no-show %) × clinical days per week × working weeks per year.',
  `W-2 base salary defaults to ${STAT_SOURCES.npMedianWageBls.formatted} (${STAT_SOURCES.npMedianWageBls.source}). Every other input (visits, collection per visit, benefits load, collaborating physician retainer, EHR/MA overhead, and 1099 split share) is an editable planning assumption, not an industry benchmark.`,
  'In the 1099 split column, the contractor receives the entered percentage of net collections and covers their own payroll taxes and benefits, while the practice retains the remainder and still covers seat overhead and any collaborating physician retainer.',
];

const EXCLUSIONS: readonly string[] = [
  'Month-by-month new-hire panel ramp. Newly credentialed clinicians frequently run at 40% to 60% schedule fill for their first 60 to 90 days; test lower visit counts on the slider to stress-test ramp cash flow.',
  'Worker-classification legal compliance. Behavioral and clinical control rules (IRS common-law test and state ABC tests such as California AB 5) restrict when a clinic may lawfully engage a clinician as a 1099 contractor.',
  'Practice owner corporate or personal income taxes.',
];

const FAQS = [
  {
    q: `How many patients per day does a ${brand.niche.descriptor} need to see to break even?`,
    a: 'Divide total annual seat cost (base salary + payroll taxes/benefits + CME/malpractice + collaborating physician retainer + incremental MA/EHR/room cost) by annual clinic days times net collected dollars per visit. The gauge above updates that exact break-even threshold as you move any slider.',
  },
  {
    q: 'When does a W-2 salary beat a 1099 percentage split for a clinic?',
    a: 'A 1099 percentage split protects the clinic when patient demand is uncertain or ramping because clinician pay scales down with collections. Once a panel is consistently full above the W-2 break-even visit count, a W-2 salary (or base plus wRVU bonus) retains a larger share of upside margin for the practice and is easier to defend under labor law.',
  },
  {
    q: 'Do we need a collaborating physician retainer in every state?',
    a: `No. ${STAT_SOURCES.fullPracticeStates.formatted} grant full practice authority (${STAT_SOURCES.fullPracticeStates.source}), though several full-practice states still require a transition-to-practice mentorship period for newly certified clinicians. Set the collaborating retainer slider to zero where no agreement applies.`,
  },
  {
    q: 'What belongs in the monthly seat overhead field?',
    a: 'Include only the incremental monthly expenses triggered by adding the seat: an EHR license, billing service percentage or seat fee, medical assistant support share, medical supplies, and incremental exam-room occupancy.',
  },
] as const;

const jsonLd = (obj: object): string =>
  JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

export default function ClinicProfitabilityCalculatorPage() {
  const defaultW2 = Number(STAT_SOURCES.npMedianWageBls.value);

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
              { label: 'Clinic Profitability' },
            ]}
          />
          <div style={{ maxWidth: '760px' }}>
            <p style={{ fontSize: '13px', fontWeight: 600, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '10px' }}>
              Free Tool · For Clinic Owners & Practice Managers
            </p>
            <h1 className="font-lora" style={{ fontSize: 'clamp(2rem, 4.4vw, 2.9rem)', fontWeight: 800, lineHeight: 1.12, color: '#1A2E35', margin: '0 0 16px' }}>
              {brand.niche.long} hire break-even & clinic profitability calculator
            </h1>
            <p style={{ fontSize: '17px', color: '#5A4A42', lineHeight: 1.65, margin: 0 }}>
              Price a new clinical seat on your own numbers: daily patient volume, no-show rate, net collection per
              visit, collaborating physician retainer, and W-2 salary vs 1099 split margin.
            </p>
          </div>
        </section>
      </div>

      <section style={{ background: TOOL_PANEL_BG, padding: '44px 20px 56px' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <ClinicProfitabilityCalculatorClient defaultW2Base={defaultW2} />
        </div>
      </section>

      <section style={{ background: '#FFF', padding: '56px 20px' }}>
        <div style={{ maxWidth: '860px', margin: '0 auto' }}>
          <AssumptionsPanel
            title="How this unit-economics model is built"
            assumptions={ASSUMPTIONS}
            exclusions={EXCLUSIONS}
            reviewedOn="2026-11-26"
            sources={[
              { label: STAT_SOURCES.npMedianWageBls.source, url: STAT_SOURCES.npMedianWageBls.sourceUrl },
              { label: STAT_SOURCES.fullPracticeStates.source, url: STAT_SOURCES.fullPracticeStates.sourceUrl },
              { label: '1099 vs W-2 clinician take-home calculator', url: '/tools/1099-vs-w2-calculator' },
            ]}
          />
        </div>
      </section>

      <section style={{ background: TOOL_HERO_BG, padding: '64px 20px' }}>
        <div style={{ maxWidth: '760px', margin: '0 auto' }}>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 32px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '28px' }}>
            Practice unit-economics questions
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
            Related practice & hiring tools
          </h2>
          <div className="tool-three-col" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
            {[
              { href: '/tools/incident-to-roi-calculator', title: 'Incident-to ROI calculator', blurb: 'Model Medicare 85% direct billing vs 100% compliant incident-to revenue.' },
              { href: '/tools/cost-of-vacancy-calculator', title: 'Cost-of-vacancy calculator', blurb: 'See what waiting 60 or 90 days to fill the seat costs your practice.' },
              { href: '/tools/salary-benchmark', title: 'Employer salary benchmark', blurb: 'Check posted state salary bands before setting your W-2 offer.' },
            ].map((l) => (
              <Link key={l.href} href={l.href} className="tool-card" style={{ ...clayCard, padding: '20px 20px 18px', textDecoration: 'none', display: 'block' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <DollarSign size={15} color={TOOL_ACCENT} aria-hidden="true" />
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
