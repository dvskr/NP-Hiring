import { brand } from '@/config/brand';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, HelpCircle, Shield } from 'lucide-react';
import Breadcrumbs from '@/components/Breadcrumbs';
import { toolApplicationCategory } from '@/app/tools/tools-registry';
import AssumptionsPanel from '@/components/tools/AssumptionsPanel';
import TailCoverageCalculatorClient from '@/components/tools/TailCoverageCalculatorClient';
import { TOOL_ACCENT, TOOL_HERO_BG, TOOL_PAGE_CSS, TOOL_PANEL_BG, clayCard } from '@/components/tools/tool-theme';

export const revalidate = 86400;

const PAGE_PATH = '/tools/tail-coverage-calculator';
const PAGE_URL = `${brand.baseUrl}${PAGE_PATH}`;
const PAGE_TITLE = `${brand.niche.long} Malpractice Tail Coverage & Non-Compete Calculator`;
const PAGE_DESCRIPTION = `Check 51-jurisdiction healthcare non-compete enforceability, estimate claims-made malpractice tail costs across Year 1 to 5 step rates, and calculate your grossed-up signing bonus counter-ask.`;
const OG_IMAGE = `${brand.baseUrl}/api/og?title=${encodeURIComponent(`${brand.niche.short} Malpractice Tail & Non-Compete Tool`)}&type=page`;

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  keywords: [
    `${brand.niche.descriptor} tail coverage cost`,
    `claims made vs occurrence malpractice ${brand.niche.short.toLowerCase()}`,
    `healthcare non compete by state ${brand.niche.short.toLowerCase()}`,
    'malpractice tail multiplier calculator',
    'nose coverage vs tail coverage clinician',
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
  'Claims-made policies step up toward a mature annual premium over Years 1 through 5 (modeled at 35%, 60%, 80%, 92%, and 100% illustrative carrier step factors) because retroactive prior-acts exposure grows each policy year.',
  'Unlimited Extended Reporting Period (tail) endorsements are modeled as an editable carrier multiple (1.5x to 2.5x) applied to the step-adjusted expiring premium; occurrence policies require zero tail endorsement.',
  'Grossed-up signing bonus counter-ask divides your unpaid tail plus unvested contract clawbacks by (1 minus your marginal tax rate) so after-tax bonus proceeds make you whole.',
];

const EXCLUSIONS: readonly string[] = [
  'Legal advice: non-compete enforceability depends on exact contract text, execution date, consideration, Compensation thresholds, and local court precedent. Always review restrictive covenants with a licensed employment attorney in your state.',
  'Self-insured hospital captive or sovereign/FTCA coverage (for example, qualifying FQHC Federal Tort Claims Act deeming, which acts like occurrence coverage for covered scope-of-project care).',
];

const FAQS = [
  {
    q: 'What is the difference between claims-made and occurrence malpractice insurance?',
    a: 'An occurrence policy covers any incident that took place while the policy was active, even if the claim is filed years after you leave the job, so no tail is ever needed. A claims-made policy only covers claims filed while the policy remains active; when you leave, someone must buy an Extended Reporting Period (tail) endorsement or incoming prior-acts (nose) coverage.',
  },
  {
    q: 'How much does an unlimited tail endorsement typically cost?',
    a: 'Commercial malpractice carriers commonly price an unlimited tail endorsement between 1.5x and 2.5x the expiring mature claims-made annual premium. Leaving in Year 1 or Year 2 usually costs less than leaving in Year 5+ because the policy has fewer prior years of exposure.',
  },
  {
    q: 'Who should pay for tail coverage in an employment contract?',
    a: 'Try to negotiate employer-paid tail if the employer terminates without cause, fails to renew the contract, or breaches the agreement, or ask for 25% to 33% annual tail vesting per year of service so a 3-year tenure earns 100% employer-paid tail.',
  },
  {
    q: 'What if I work at an FQHC covered by FTCA?',
    a: 'Federally deemed FQHCs covered under the Federal Tort Claims Act (FTCA) provide occurrence-equivalent coverage for approved clinical activities within the health center’s scope of project, meaning no private tail purchase is required for those encounters.',
  },
] as const;

const jsonLd = (obj: object): string =>
  JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

export default function TailCoverageCalculatorPage() {
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
              { label: 'Tail & Non-Compete Calculator' },
            ]}
          />
          <div style={{ maxWidth: '760px' }}>
            <p style={{ fontSize: '13px', fontWeight: 600, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '10px' }}>
              Free Tool · For Clinicians
            </p>
            <h1 className="font-lora" style={{ fontSize: 'clamp(2rem, 4.4vw, 2.9rem)', fontWeight: 800, lineHeight: 1.12, color: '#1A2E35', margin: '0 0 16px' }}>
              {brand.niche.short} malpractice tail & non-compete calculator
            </h1>
            <p style={{ fontSize: '17px', color: '#5A4A42', lineHeight: 1.65, margin: 0 }}>
              Before signing or leaving an employment contract, look up your state’s healthcare non-compete rules, model
              claims-made malpractice tail exposure, and calculate the exact pre-tax signing bonus to request from your next employer.
            </p>
          </div>
        </section>
      </div>

      <section style={{ background: TOOL_PANEL_BG, padding: '44px 20px 56px' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <TailCoverageCalculatorClient nicheShort={brand.niche.short} />
        </div>
      </section>

      <section style={{ background: '#FFF', padding: '56px 20px' }}>
        <div style={{ maxWidth: '860px', margin: '0 auto' }}>
          <AssumptionsPanel
            title="How step-rate tail math & state non-compete summaries work"
            assumptions={ASSUMPTIONS}
            exclusions={EXCLUSIONS}
            reviewedOn="2026-11-26"
            sources={[
              { label: 'HRSA FTCA Health Center Policy Manual', url: 'https://bphc.hrsa.gov/ftca' },
              { label: 'Total compensation comparator', url: '/tools/total-comp-comparator' },
              { label: 'Offer competitiveness analyzer', url: '/tools/offer-analyzer' },
            ]}
          />
        </div>
      </section>

      <section style={{ background: TOOL_HERO_BG, padding: '64px 20px' }}>
        <div style={{ maxWidth: '760px', margin: '0 auto' }}>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 32px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '28px' }}>
            Malpractice tail & restrictive covenant questions
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
            Related contract & compensation tools
          </h2>
          <div className="tool-three-col" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
            {[
              { href: '/tools/total-comp-comparator', title: 'Offer A vs Offer B comparator', blurb: 'Factor tail exposure, PTO, health benefits, and charting into true hourly value.' },
              { href: '/tools/offer-analyzer', title: 'Offer competitiveness analyzer', blurb: 'Check your base and bonus against live state postings and BLS wage bands.' },
              { href: '/tools/prescriptive-authority-checker', title: 'Prescriptive authority lookup', blurb: 'Review Schedule II to V rules and collaborative agreements by state.' },
            ].map((l) => (
              <Link key={l.href} href={l.href} className="tool-card" style={{ ...clayCard, padding: '20px 20px 18px', textDecoration: 'none', display: 'block' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <Shield size={15} color={TOOL_ACCENT} aria-hidden="true" />
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
