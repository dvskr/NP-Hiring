/**
 * Specialty finder (P3 #2) — indexable tool route.
 *
 * The questions, the affinity sets, and the scoring live in
 * components/tools/specialty-quiz-model.ts. This route is metadata, schema,
 * visible assumptions, and cross-links only.
 *
 * TRUTH RULES
 *  - The output is framed everywhere as "specialties that match the
 *    preferences you entered". It is never an aptitude assessment, a
 *    recommendation, or career advice, and the page says so above the widget,
 *    inside the widget, and in the assumptions panel.
 *  - Specialties come from the canonical taxonomy, so every result link
 *    resolves; the salary-page link is gated on the slugs that actually have a
 *    specialty salary page.
 *  - The only pay figures on the page are the premium bands already published
 *    in the salary guide, rendered as percentages over the cited median with
 *    their basis stated. No new dollar band is introduced here.
 *  - No certification requirements are published. Naming the wrong certifying
 *    body for a specialty on a YMYL surface is worse than omitting it; the
 *    specialty salary pages carry the sourced ones.
 *  - FAQPage JSON-LD derives from the same FAQS array the visible accordion
 *    renders.
 */
import { brand } from '@/config/brand';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Compass, HelpCircle } from 'lucide-react';
import Breadcrumbs from '@/components/Breadcrumbs';
import AssumptionsPanel from '@/components/tools/AssumptionsPanel';
import SpecialtyFinderQuiz from '@/components/tools/SpecialtyFinderQuiz';
import {
  QUIZ_QUESTIONS,
  QUIZ_QUESTION_COUNT,
  SPECIALTY_PROFILES,
  TOP_MATCH_COUNT,
} from '@/components/tools/specialty-quiz-model';
import { TOOL_ACCENT, TOOL_PAGE_CSS, TOOL_HERO_BG, TOOL_PANEL_BG, clayCard } from '@/components/tools/tool-theme';
import { STAT_SOURCES } from '@/lib/stats-sources';

const PAGE_PATH = '/tools/specialty-finder';
const PAGE_URL = `${brand.baseUrl}${PAGE_PATH}`;
const PAGE_TITLE = `${brand.niche.short} Specialty Finder — Match Your Preferences to a Specialty`;
const PAGE_DESCRIPTION = `Answer ${QUIZ_QUESTION_COUNT} questions about patient population, acuity, setting, autonomy, procedures, and schedule, and see which of ${SPECIALTY_PROFILES.length} ${brand.niche.short} and advanced practice specialties match what you said you want. A preference sort, not an aptitude test.`;
const OG_IMAGE = `${brand.baseUrl}/api/og?title=${encodeURIComponent(`${brand.niche.short} Specialty Finder`)}&type=page`;

const DIMENSION_LIST = QUIZ_QUESTIONS.map((question) => question.dimension.toLowerCase()).join(', ');

export const metadata: Metadata = {
  // P7 runtime fix D7: root layout template appends `| ${brand.name}`.
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  keywords: [
    `${brand.niche.short.toLowerCase()} specialty finder`,
    `which ${brand.niche.short.toLowerCase()} specialty is right for me`,
    `${brand.niche.descriptor} specialties compared`,
    `${brand.niche.short.toLowerCase()} specialty quiz`,
    `choosing an ${brand.niche.short.toLowerCase()} specialty`,
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
  `Scoring is a count, not a formula: one point per answered question whose option appears in that specialty's profile, divided by the questions you answered. Nothing is weighted and nothing is hidden — each result card lists the dimensions it matched and the ones it did not.`,
  `The specialty profiles are editorial descriptions of how each specialty is usually practised across ${DIMENSION_LIST}. They are not survey data, and individual roles vary enormously — a hospital-based role in a normally clinic-based specialty is a real job, not an error.`,
  `The ${SPECIALTY_PROFILES.length} specialties come from this site's category taxonomy, which is also what the job listings are tagged with, so every result links to real inventory rather than to a page we invented for the quiz.`,
  `Where a premium band is shown it is the band already published in our salary guide, expressed as a percentage over the all-${brand.niche.short} median of ${STAT_SOURCES.averageSalary.formatted} (${STAT_SOURCES.averageSalary.source}) and applied to that median as an estimate.`,
  `Ties are broken by a fixed order — broadest specialties first — so the same answers always produce the same ranking.`,
  `Answers stay in your browser. Nothing is submitted, stored, or emailed.`,
];

const EXCLUSIONS: readonly string[] = [
  'Aptitude. This tool has no idea what you are good at, and it makes no attempt to guess.',
  'Your certification and your program. Population-focused certification is what actually gates most of these specialties, and the tool does not know which one you hold or could pursue.',
  'What your state allows. Practice authority, collaborative-agreement requirements, and transition-to-practice periods are state law — the licensure checker covers them separately.',
  'Certification requirements and certifying bodies. They differ per specialty and we would rather send you to the specialty salary page that carries the sourced ones than risk naming the wrong board here.',
  'Local demand and pay. Both are geographic, and the salary guide and category pages answer them from live postings instead of from a quiz.',
];

const FAQS = [
  {
    q: `How do I choose an ${brand.niche.short} specialty?`,
    a: `Start from the shape of the work rather than the title. The dimensions that actually separate specialties are the ones this tool asks about: which population you want, how sick they should be, whether you want a clinic or a hospital or a screen, how much you want to be the decision-maker, how procedural the day is, whether you keep your patients, and what your week looks like. Once you know your answers to those, the field narrows quickly. Then check two things the tool cannot: which population-focused certification you hold or are willing to pursue, and what your state permits.`,
  },
  {
    q: 'Is this an aptitude or career-aptitude test?',
    a: `No, and it is deliberately built so it cannot be mistaken for one. It compares the preferences you entered against how each specialty is usually practised and reports how many of them line up. It has no information about your clinical strengths, your training, your certification, or your circumstances, so it cannot tell you what you would be good at — only which specialties look like what you said you wanted.`,
  },
  {
    q: 'Where do the specialty descriptions come from?',
    a: `They are editorial descriptions written for this tool, listing the population, acuity, setting, autonomy, procedural content, continuity, schedule, and payment mix each specialty normally involves. They are not a survey and they are not sourced to one, which is why the tool shows you which answers matched instead of presenting a confidence score. Individual jobs vary a great deal within any specialty.`,
  },
  {
    q: 'Do higher-paying specialties show up higher in the results?',
    a: `No. Pay plays no part in the ranking at all — the sort is purely how many of your answers a specialty matches. Where our salary guide publishes a premium band for a specialty we show it on the card, because it is useful context once a specialty is already on your list, but it never moves anything up or down.`,
  },
  {
    q: 'What should I do with the result?',
    a: `Treat the top ${TOP_MATCH_COUNT} as a shortlist to investigate, not an answer. Open the live roles for each one and read actual postings — the day-to-day, the call expectations, and the pay basis show up there in a way no quiz can capture. Then check the specialty pay pages, and check what your state allows before you commit to a path that assumes independent practice.`,
  },
] as const;

const jsonLd = (obj: object): string =>
  JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

export default function SpecialtyFinderPage() {
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
            applicationCategory: 'EducationalApplication',
            operatingSystem: 'Any',
            browserRequirements: 'Requires JavaScript',
            isAccessibleForFree: true,
            offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
            publisher: { '@type': 'Organization', name: brand.name, url: brand.baseUrl },
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
          <Breadcrumbs items={[
            { label: 'Home', href: '/' },
            { label: 'Tools', href: '/tools' },
            { label: 'Specialty Finder' },
          ]} />
          <div style={{ maxWidth: '760px' }}>
            <p style={{ fontSize: '13px', fontWeight: 600, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '10px' }}>
              Free Tool
            </p>
            <h1 className="font-lora" style={{ fontSize: 'clamp(2rem, 4.4vw, 2.9rem)', fontWeight: 800, lineHeight: 1.12, color: '#1A2E35', margin: '0 0 16px' }}>
              Which specialty fits what you actually want?
            </h1>
            <p style={{ fontSize: '17px', color: '#5A4A42', lineHeight: 1.65, margin: 0 }}>
              {QUIZ_QUESTION_COUNT} questions about the things that genuinely differ between specialties — who your
              patients are, how sick they are, where you work, how much you decide, how hands-on the day is, and
              what your week looks like. We sort {SPECIALTY_PROFILES.length} {brand.niche.short} and advanced
              practice specialties by how many of your answers each one matches, and show you exactly which answers
              did the matching.
            </p>
            <p style={{ fontSize: '13.5px', color: '#7A6A62', margin: '16px 0 0', lineHeight: 1.6 }}>
              <strong>This is a preference sort, not an assessment.</strong> It does not measure aptitude, it does
              not know your certification or your state, and it is not career advice.
            </p>
          </div>
        </section>
      </div>

      <section style={{ background: TOOL_PANEL_BG, padding: '44px 20px 56px' }}>
        <div style={{ maxWidth: '860px', margin: '0 auto' }}>
          <SpecialtyFinderQuiz />
        </div>
      </section>

      <section style={{ background: '#FFF', padding: '56px 20px' }}>
        <div style={{ maxWidth: '860px', margin: '0 auto' }}>
          <AssumptionsPanel
            title="How the matching works"
            intro="Every part of the score is visible on the page, because a quiz that hides its scoring is indistinguishable from one that made the answer up."
            assumptions={ASSUMPTIONS}
            exclusions={EXCLUSIONS}
            sources={[
              { label: `${brand.name} specialty pay pages — premium bands and certification`, url: '/salary-guide/specialty' },
              { label: 'Practice authority and licensure by state', url: '/tools/licensure-checker' },
              { label: STAT_SOURCES.averageSalary.source, url: STAT_SOURCES.averageSalary.sourceUrl },
            ]}
          />
        </div>
      </section>

      <section style={{ background: TOOL_HERO_BG, padding: '64px 20px' }}>
        <div style={{ maxWidth: '760px', margin: '0 auto' }}>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 32px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '28px' }}>
            Questions about picking a specialty
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {FAQS.map(({ q, a }) => (
              <details key={q} style={{ ...clayCard, padding: 0, overflow: 'hidden' }}>
                <summary style={{
                  padding: '18px 22px', cursor: 'pointer', listStyle: 'none',
                  display: 'flex', alignItems: 'center', gap: '12px',
                  fontSize: '15px', fontWeight: 600, color: '#1A2E35',
                }}>
                  <span style={{
                    width: '26px', height: '26px', borderRadius: '8px', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'linear-gradient(145deg, #BE185D, #9D174D)',
                  }} aria-hidden="true">
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
            Once you have a shortlist
          </h2>
          <div className="tool-three-col" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
            {[
              { href: '/salary-guide/specialty', title: 'Pay by specialty', blurb: 'Premium bands, certification, and live postings per specialty.' },
              { href: '/tools/licensure-checker', title: 'Licensure checker', blurb: 'What your state actually allows, and the steps to get licensed there.' },
              { href: '/salary-guide', title: `${brand.niche.short} salary guide`, blurb: 'State-by-state pay from live postings, with an estimator.' },
              { href: '/resources/private-practice-guide', title: 'Private practice guide', blurb: 'If your answers pointed at owning your own panel.' },
              { href: '/tools/1099-vs-w2-calculator', title: '1099 vs W-2 calculator', blurb: 'What a contract role is worth once you self-fund benefits.' },
              { href: '/jobs', title: 'Browse every role', blurb: 'The full board, filterable by specialty, setting, and location.' },
            ].map((l) => (
              <Link key={l.href} href={l.href} className="tool-card" style={{ ...clayCard, padding: '20px 20px 18px', textDecoration: 'none', display: 'block' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <Compass size={15} color={TOOL_ACCENT} aria-hidden="true" />
                  <h3 style={{ fontSize: '14px', fontWeight: 800, color: '#1A2E35', margin: 0 }}>{l.title}</h3>
                </div>
                <p style={{ fontSize: '12.5px', color: '#7A6A62', margin: '0 0 10px', lineHeight: 1.55 }}>{l.blurb}</p>
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
