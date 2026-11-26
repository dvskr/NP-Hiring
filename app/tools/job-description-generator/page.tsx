import { brand } from '@/config/brand';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, FileText, HelpCircle } from 'lucide-react';
import Breadcrumbs from '@/components/Breadcrumbs';
import { toolApplicationCategory } from '@/app/tools/tools-registry';
import AssumptionsPanel from '@/components/tools/AssumptionsPanel';
import JobDescriptionGeneratorClient from '@/components/tools/JobDescriptionGeneratorClient';
import { loadMarketSalaryBundle } from '@/lib/tools-salary-data';
import { JD_TEMPLATES } from '@/lib/jd-templates';
import { STAT_SOURCES } from '@/lib/stats-sources';
import { TOOL_ACCENT, TOOL_HERO_BG, TOOL_PAGE_CSS, TOOL_PANEL_BG, clayCard } from '@/components/tools/tool-theme';

export const revalidate = 86400;

const PAGE_PATH = '/tools/job-description-generator';
const PAGE_URL = `${brand.baseUrl}${PAGE_PATH}`;
const PAGE_TITLE = `${brand.niche.long} Job Description Generator & Templates`;
const PAGE_DESCRIPTION = `Build a setting-specific ${brand.niche.descriptor} job description from ${JD_TEMPLATES.length} clinical skeletons with state pay-transparency checks, live market pay context, HTML/Markdown copy, and one-click handoff to Post a Job.`;
const OG_IMAGE = `${brand.baseUrl}/api/og?title=${encodeURIComponent(`${brand.niche.long} Job Description Generator`)}&type=page`;

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  keywords: [
    `${brand.niche.descriptor} job description generator`,
    `${brand.niche.short.toLowerCase()} job description template`,
    `how to write a ${brand.niche.descriptor} job posting`,
    `outpatient ${brand.niche.short.toLowerCase()} job description`,
    `urgent care ${brand.niche.short.toLowerCase()} job description`,
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
  `Skeletons come directly from the ${JD_TEMPLATES.length} practice-setting templates in our employer library (outpatient primary care, pediatrics, geriatrics, women's health, hospitalist, urgent care, emergency, FQHC, correctional, and telehealth).`,
  'Placeholders inside [square brackets] are deliberately preserved where clinic facts vary (EHR system, daily visit volume, call rotation, CME stipend) so you never publish generic boilerplate.',
  'State pay-transparency reminders evaluate your selected jurisdiction, employer headcount, and remote status against enacted 2026 to 2027 state wage-disclosure laws.',
  'Clicking "Open in Post a Job" saves your draft into your browser localStorage so the posting wizard restores your title, location, salary range, benefits, and formatted description immediately.',
];

const EXCLUSIONS: readonly string[] = [
  'Legal review of employment contracts, restrictive covenants, or state-specific equal-opportunity addenda. Have counsel verify local municipal ordinances.',
  'Credentialing verification. Required qualifications list standard national board certification (ANCC or AANPCB) and state APRN/DEA licensure, which your team must still verify directly.',
];

const FAQS = [
  {
    q: `What makes a ${brand.niche.descriptor} job description attract experienced applicants?`,
    a: `Specificity on four points: the exact daily patient volume or appointment lengths, whether evening or weekend call is required (and whether it is paid separately), the EHR and charting support in place, and a transparent base salary range plus any wRVU or quality bonus structure.`,
  },
  {
    q: 'Why does the generator leave [bracketed] prompts in the draft?',
    a: `Identical copy-and-paste prose across dozens of clinics tells candidates nothing about your practice and performs poorly in search engines. Bracketed prompts highlight the exact operational facts only your clinic knows so you can fill them in under two minutes.`,
  },
  {
    q: 'Should I include a salary range even if my state does not mandate it?',
    a: `Yes. Over a dozen jurisdictions already require pay ranges in job postings, nationwide remote listings trigger the strictest states, and experienced ${brand.niche.short}s routinely skip listings that hide compensation.`,
  },
  {
    q: 'How does the "Open in Post a Job" button work?',
    a: `It writes your customized job title, organization name, city and state, work mode, salary range, benefits, and formatted HTML description to your browser draft and opens the ${brand.name} posting form with every field pre-populated.`,
  },
] as const;

const jsonLd = (obj: object): string =>
  JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

export default async function JobDescriptionGeneratorPage() {
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
              { label: 'Job Description Generator' },
            ]}
          />
          <div style={{ maxWidth: '760px' }}>
            <p style={{ fontSize: '13px', fontWeight: 600, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '10px' }}>
              Free Tool · For Employers
            </p>
            <h1 className="font-lora" style={{ fontSize: 'clamp(2rem, 4.4vw, 2.9rem)', fontWeight: 800, lineHeight: 1.12, color: '#1A2E35', margin: '0 0 16px' }}>
              {brand.niche.long} job description generator
            </h1>
            <p style={{ fontSize: '17px', color: '#5A4A42', lineHeight: 1.65, margin: 0 }}>
              Pick your clinical setting, plug in your location and pay range, check state pay-transparency rules in
              real time, and copy clean HTML or Markdown or send the draft straight into Post a Job.
            </p>
          </div>
        </section>
      </div>

      <section style={{ background: TOOL_PANEL_BG, padding: '44px 20px 56px' }}>
        <div style={{ maxWidth: '1120px', margin: '0 auto' }}>
          <JobDescriptionGeneratorClient states={salaryBundle.states} />
        </div>
      </section>

      <section style={{ background: '#FFF', padding: '56px 20px' }}>
        <div style={{ maxWidth: '860px', margin: '0 auto' }}>
          <AssumptionsPanel
            title="How this generator is built"
            assumptions={ASSUMPTIONS}
            exclusions={EXCLUSIONS}
            reviewedOn="2026-11-26"
            sources={[
              { label: `${brand.name} job description template library`, url: '/for-employers/resources/job-description-templates' },
              { label: 'Pay transparency checker (51 jurisdictions)', url: '/tools/pay-transparency-checker' },
              { label: STAT_SOURCES.npMedianWageBls.source, url: STAT_SOURCES.npMedianWageBls.sourceUrl },
            ]}
          />
        </div>
      </section>

      <section style={{ background: TOOL_HERO_BG, padding: '64px 20px' }}>
        <div style={{ maxWidth: '760px', margin: '0 auto' }}>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 32px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '28px' }}>
            Questions about writing job descriptions
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
            Related hiring tools
          </h2>
          <div className="tool-three-col" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
            {[
              { href: '/tools/pay-transparency-checker', title: 'Pay transparency checker', blurb: 'Verify salary-range and benefits disclosure rules across all 50 states and DC.' },
              { href: '/tools/salary-benchmark', title: 'Employer salary benchmark', blurb: 'Median and quartile posted pay by state from live listings.' },
              { href: '/tools/interview-scorecard-builder', title: 'Interview scorecard builder', blurb: 'Structured clinical interview questions and printable 1 to 5 candidate rubrics.' },
            ].map((l) => (
              <Link key={l.href} href={l.href} className="tool-card" style={{ ...clayCard, padding: '20px 20px 18px', textDecoration: 'none', display: 'block' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <FileText size={15} color={TOOL_ACCENT} aria-hidden="true" />
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
