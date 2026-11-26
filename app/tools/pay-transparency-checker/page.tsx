import { brand } from '@/config/brand';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, HelpCircle, ShieldCheck } from 'lucide-react';
import Breadcrumbs from '@/components/Breadcrumbs';
import { toolApplicationCategory } from '@/app/tools/tools-registry';
import AssumptionsPanel from '@/components/tools/AssumptionsPanel';
import PayTransparencyCheckerClient from '@/components/tools/PayTransparencyCheckerClient';
import { loadMarketSalaryBundle } from '@/lib/tools-salary-data';
import { STAT_SOURCES } from '@/lib/stats-sources';
import { TOOL_ACCENT, TOOL_HERO_BG, TOOL_PAGE_CSS, TOOL_PANEL_BG, clayCard } from '@/components/tools/tool-theme';

export const revalidate = 86400;

const PAGE_PATH = '/tools/pay-transparency-checker';
const PAGE_URL = `${brand.baseUrl}${PAGE_PATH}`;
const PAGE_TITLE = 'Job-Posting Pay Transparency & Salary-History Checker (51 States)';
const PAGE_DESCRIPTION = `Check 2026 to 2027 state salary-range job-posting mandates, employee headcount thresholds, salary-history bans, and remote strictest-state rules across all 50 states and DC, paired with live ${brand.niche.short} salary benchmarks.`;
const OG_IMAGE = `${brand.baseUrl}/api/og?title=${encodeURIComponent('Pay Transparency Checker (51 Jurisdictions)')}&type=page`;

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  keywords: [
    'pay transparency laws by state 2026',
    'job posting salary range requirements by state',
    'salary history ban states',
    'remote job pay transparency strictest state rule',
    `healthcare ${brand.niche.short.toLowerCase()} pay transparency`,
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
  'Covers statewide statutes enacted across all 50 US states and the District of Columbia through the 2026 to 2027 legislative cycle (including Massachusetts Oct 2025, New Jersey June 2025, Vermont July 2025, Connecticut Oct 2026, Virginia July 2026, and Delaware Sep 2027).',
  'When "100% Remote telehealth" with multi-state/nationwide eligibility is selected, the tool applies the strictest active range and benefits disclosure standard because applicants in 1+ employee states (such as Colorado, DC, and Maryland) can apply.',
  `Market pay bands display gated live ${brand.niche.short} postings where at least 5 employers disclose pay (10 for quartiles), alongside official BLS OEWS May 2025 state percentiles.`,
];

const EXCLUSIONS: readonly string[] = [
  'Municipal and county ordinances (such as Jersey City, Ithaca, Westchester County, Cincinnati, Toledo, or Philadelphia) when stricter than state law.',
  'Formal legal counsel. Statutory headcount counting rules (in-state vs nationwide headcount) differ by state department of labor guidance; confirm borderline thresholds with employment counsel.',
];

const FAQS = [
  {
    q: 'Which states require a salary range in job postings in 2026?',
    a: 'Jurisdictions with active or 2026-effective job-posting pay-range statutes include California, Colorado, Connecticut, the District of Columbia, Hawaii, Illinois, Maryland, Massachusetts, Minnesota, New Jersey, New York, Vermont, Virginia, and Washington, with Delaware enacted to follow in September 2027.',
  },
  {
    q: 'Do we have to list benefits as well as base pay?',
    a: 'Several states (including Colorado, the District of Columbia, Illinois, Maryland, Minnesota, New Jersey, and Washington) require a general description of benefits and other compensation (such as bonuses or productivity incentives) in addition to the base pay scale.',
  },
  {
    q: 'How do pay-transparency laws apply to remote telehealth roles?',
    a: 'If a remote role can be performed from a pay-transparency state (or reports to an office/supervisor in states like Illinois or New York), that state’s disclosure mandate generally applies. Publishing a good-faith range plus a summary of benefits brings nationwide remote postings into compliance across states at once.',
  },
  {
    q: 'Can we post an open-ended range like "$125,000 and up"?',
    a: 'No. Regulators in states such as Colorado, Minnesota, New York, California, and Washington explicitly prohibit open-ended ranges with no ceiling or floor; both a good-faith minimum and maximum are required.',
  },
] as const;

const jsonLd = (obj: object): string =>
  JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

export default async function PayTransparencyCheckerPage() {
  const salaryBundle = await loadMarketSalaryBundle();

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
              { label: 'Pay Transparency Checker' },
            ]}
          />
          <div style={{ maxWidth: '760px' }}>
            <p style={{ fontSize: '13px', fontWeight: 600, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '10px' }}>
              Free Tool · For Employers
            </p>
            <h1 className="font-lora" style={{ fontSize: 'clamp(2rem, 4.4vw, 2.9rem)', fontWeight: 800, lineHeight: 1.12, color: '#1A2E35', margin: '0 0 16px' }}>
              Job-posting pay transparency & salary-history checker
            </h1>
            <p style={{ fontSize: '17px', color: '#5A4A42', lineHeight: 1.65, margin: 0 }}>
              Verify whether your state, headcount, or remote telehealth arrangement requires a published salary
              range and benefits summary, benchmark a compliant {brand.niche.short} range, and launch directly into Post a Job.
            </p>
          </div>
        </section>
      </div>

      <section style={{ background: TOOL_PANEL_BG, padding: '44px 20px 56px' }}>
        <div style={{ maxWidth: '1120px', margin: '0 auto' }}>
          <PayTransparencyCheckerClient states={salaryBundle.states} />
        </div>
      </section>

      <section style={{ background: '#FFF', padding: '56px 20px' }}>
        <div style={{ maxWidth: '860px', margin: '0 auto' }}>
          <AssumptionsPanel
            title="How this compliance lookup works"
            assumptions={ASSUMPTIONS}
            exclusions={EXCLUSIONS}
            reviewedOn="2026-11-26"
            sources={[
              { label: 'US Department of Labor: Equal Pay & Pay Transparency Protections', url: 'https://www.dol.gov/agencies/wb/equal-pay-protections' },
              { label: `${brand.name} pay transparency market report`, url: '/reports/pay-transparency' },
              { label: STAT_SOURCES.npMedianWageBls.source, url: STAT_SOURCES.npMedianWageBls.sourceUrl },
            ]}
          />
        </div>
      </section>

      <section style={{ background: TOOL_HERO_BG, padding: '64px 20px' }}>
        <div style={{ maxWidth: '760px', margin: '0 auto' }}>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 32px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '28px' }}>
            Pay-transparency questions
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
            Next steps for compliant hiring
          </h2>
          <div className="tool-three-col" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
            {[
              { href: '/tools/job-description-generator', title: 'Job description generator', blurb: 'Insert your compliant range into a clinical setting skeleton.' },
              { href: '/tools/salary-benchmark', title: 'Employer salary benchmark', blurb: 'Compare your planned offer against live state medians.' },
              { href: '/reports/pay-transparency', title: 'Pay transparency report', blurb: 'How often healthcare employers disclose pay across live postings.' },
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
