import { brand } from '@/config/brand';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, HelpCircle, Sparkles } from 'lucide-react';
import Breadcrumbs from '@/components/Breadcrumbs';
import { toolApplicationCategory } from '@/app/tools/tools-registry';
import AssumptionsPanel from '@/components/tools/AssumptionsPanel';
import InterviewScorecardBuilderClient from '@/components/tools/InterviewScorecardBuilderClient';
import { TOOL_ACCENT, TOOL_HERO_BG, TOOL_PAGE_CSS, TOOL_PANEL_BG, clayCard } from '@/components/tools/tool-theme';

export const revalidate = 86400;

const PAGE_PATH = '/tools/interview-scorecard-builder';
const PAGE_URL = `${brand.baseUrl}${PAGE_PATH}`;
const PAGE_TITLE = `${brand.niche.long} Clinical Interview Questions & Scorecard Builder`;
const PAGE_DESCRIPTION = `Structured clinical interview question bank and printable 1 to 5 candidate evaluation scorecard for hiring ${brand.niche.descriptor}s across primary care, urgent care, acute inpatient, dermatology, and telehealth.`;
const OG_IMAGE = `${brand.baseUrl}/api/og?title=${encodeURIComponent(`${brand.niche.long} Interview Scorecard Builder`)}&type=page`;

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  keywords: [
    `${brand.niche.descriptor} interview questions for employers`,
    `how to interview a ${brand.niche.descriptor}`,
    `${brand.niche.short.toLowerCase()} clinical interview scorecard`,
    `urgent care ${brand.niche.short.toLowerCase()} interview questions`,
    `primary care ${brand.niche.short.toLowerCase()} interview rubric`,
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
  'Each clinical track weights diagnostic reasoning, red-flag escalation, pharmacology stewardship, and workflow throughput on an anchored 1 to 5 scale.',
  'All candidate scores and notes live strictly in your browser memory for printing or saving to PDF; nothing typed into the scorecard is transmitted to our servers.',
  'Composite recommendation thresholds (4.2+ Strong Hire, 3.5+ Hire with Focused Onboarding, 2.8+ Hold) are structured calibration guides rather than automated hiring decisions.',
];

const EXCLUSIONS: readonly string[] = [
  'Primary-source credentialing verification, NPDB queries, peer reference calls, and hands-on procedural skills proctoring.',
  'Equal Employment Opportunity legal compliance review for custom user-entered questions.',
];

const FAQS = [
  {
    q: `Why use a structured clinical scorecard when interviewing ${brand.niche.descriptor}s?`,
    a: 'Unstructured conversational interviews reward charisma while missing subtle gaps in red-flag recognition, escalation instincts, or panel throughput. Asking every finalist the same clinical scenarios with anchored 1 to 5 criteria improves fairness and hire retention.',
  },
  {
    q: 'What separates a 5 from a 3 on clinical scenario questions?',
    a: 'A 3 names reasonable textbook tests and treatments. A 5 immediately rules out life-or-limb threats first, tailors medication choices to comorbidities like renal function or fall risk, states clear physician escalation triggers, and closes the follow-up loop.',
  },
  {
    q: 'How should we adapt the scorecard for a new graduate vs an experienced clinician?',
    a: 'For new graduates, weight escalation judgment, coachability, and systematic safety habits heavily rather than expecting day-one 22-patient throughput, and pair a 3.5+ score with a structured ramp schedule.',
  },
  {
    q: 'Are candidate notes saved anywhere online?',
    a: 'No. Everything stays inside your browser tab until you print or save to PDF, and clears on reset or tab close.',
  },
] as const;

const jsonLd = (obj: object): string =>
  JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

export default function InterviewScorecardBuilderPage() {
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
              { label: 'Interview Scorecard Builder' },
            ]}
          />
          <div style={{ maxWidth: '760px' }}>
            <p style={{ fontSize: '13px', fontWeight: 600, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '10px' }}>
              Free Tool · For Medical Directors & Hiring Teams
            </p>
            <h1 className="font-lora" style={{ fontSize: 'clamp(2rem, 4.4vw, 2.9rem)', fontWeight: 800, lineHeight: 1.12, color: '#1A2E35', margin: '0 0 16px' }}>
              {brand.niche.long} clinical interview scorecard builder
            </h1>
            <p style={{ fontSize: '17px', color: '#5A4A42', lineHeight: 1.65, margin: 0 }}>
              Evaluate every finalist on the same clinical scenarios across outpatient primary care, urgent care,
              hospitalist medicine, dermatology, or telehealth, then print a clean PDF rubric for your hiring packet.
            </p>
          </div>
        </section>
      </div>

      <section style={{ background: TOOL_PANEL_BG, padding: '44px 20px 56px' }}>
        <div style={{ maxWidth: '1080px', margin: '0 auto' }}>
          <InterviewScorecardBuilderClient />
        </div>
      </section>

      <section style={{ background: '#FFF', padding: '56px 20px' }}>
        <div style={{ maxWidth: '860px', margin: '0 auto' }}>
          <AssumptionsPanel
            title="How this interview rubric is structured"
            assumptions={ASSUMPTIONS}
            exclusions={EXCLUSIONS}
            reviewedOn="2026-11-26"
            sources={[
              { label: `How to hire a ${brand.niche.long}: employer guide`, url: '/for-employers/resources/how-to-hire' },
              { label: 'Job description generator', url: '/tools/job-description-generator' },
              { label: 'Credentialing & payer paneling timeline planner', url: '/tools/credentialing-timeline-planner' },
            ]}
          />
        </div>
      </section>

      <section style={{ background: TOOL_HERO_BG, padding: '64px 20px' }}>
        <div style={{ maxWidth: '760px', margin: '0 auto' }}>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 32px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '28px' }}>
            Clinical interview questions
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
            Complete your hiring toolkit
          </h2>
          <div className="tool-three-col" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
            {[
              { href: '/tools/job-description-generator', title: 'Job description generator', blurb: 'Setting-specific skeletons with one-click Post a Job handoff.' },
              { href: '/tools/salary-benchmark', title: 'Employer salary benchmark', blurb: 'Median and quartile posted pay by state.' },
              { href: '/tools/credentialing-timeline-planner', title: 'Credentialing timeline planner', blurb: 'Plan backwards from your target clinical start date.' },
            ].map((l) => (
              <Link key={l.href} href={l.href} className="tool-card" style={{ ...clayCard, padding: '20px 20px 18px', textDecoration: 'none', display: 'block' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <Sparkles size={15} color={TOOL_ACCENT} aria-hidden="true" />
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
