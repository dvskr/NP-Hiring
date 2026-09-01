/**
 * "How to Hire a Nurse Practitioner" employer guide (P1 #18).
 *
 * Evergreen process guide: role definition, salary benchmarking against
 * the live /salary-guide data, credential verification, and timeline
 * planning.
 *
 * TRUTH RULES (audit-enforced):
 *  - Every number on this page derives from lib/stats-sources.ts or
 *    config/niche/salary.ts imports — never typed inline.
 *  - Credentialing durations, fees, and state-specific requirements are
 *    NOT stated as facts; the copy points at the state board of nursing
 *    and the AANP state-practice-environment source instead.
 *  - Certification bodies are named correctly per role (AANP/ANCC for
 *    NPs, NBCRNA for CRNAs, AMCB for CNMs).
 *  - Article dateModified renders the LAST_REVIEWED constant — never
 *    new Date() (fabricated-freshness rule, audit P0 #23).
 */
import { brand } from '@/config/brand';
import { Metadata } from 'next';
import Link from 'next/link';
import Breadcrumbs from '@/components/Breadcrumbs';
import { STAT_SOURCES } from '@/lib/stats-sources';
import { salaryConfig } from '@/config/niche/salary';
import {
  BookOpen, CheckCircle, ClipboardCheck, Clock, DollarSign, ExternalLink, ArrowRight,
} from 'lucide-react';

// Bump on each editorial review pass (repo pattern:
// app/resources/1099-vs-w2/page.tsx).
const PUBLISHED_AT = '2026-07-29';
const LAST_REVIEWED = '2026-07-29';

const PAGE_URL = `${brand.baseUrl}/for-employers/resources/how-to-hire`;
const PAGE_TITLE = `How to Hire a ${brand.niche.long}: Process, Credentialing & Timeline`;
const PAGE_DESCRIPTION = `A step-by-step employer guide to hiring a ${brand.niche.descriptor}: defining the role, benchmarking salary with live data, verifying licenses and board certification, and planning a realistic credentialing timeline.`;
const HERO_IMAGE = `${brand.baseUrl}/api/og?title=${encodeURIComponent(`How to Hire a ${brand.niche.long}`)}&type=page`;

export const metadata: Metadata = {
  title: `${PAGE_TITLE} | ${brand.name}`,
  description: PAGE_DESCRIPTION,
  keywords: [
    `how to hire a ${brand.niche.descriptor}`,
    `hiring ${brand.niche.short}s`,
    `${brand.niche.short} credentialing`,
    `${brand.niche.short} recruitment`,
    `${brand.niche.short} salary benchmark`,
  ],
  openGraph: {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    type: 'article',
    images: [{ url: HERO_IMAGE, width: 1200, height: 630, alt: PAGE_TITLE }],
  },
  twitter: { card: 'summary_large_image', title: PAGE_TITLE, images: [HERO_IMAGE] },
  alternates: { canonical: PAGE_URL },
};

// Typical W-2 comparison band this board uses for salary sanity checks —
// derived from config/niche/salary.ts, never typed inline.
const TYPICAL_BAND = `$${Math.round(salaryConfig.normalizer.typical.min / 1000)}K–$${Math.round(salaryConfig.normalizer.typical.max / 1000)}K`;

// Labor-market context — each entry pairs a cited stat from
// lib/stats-sources.ts with its visible source link.
const MARKET_STATS = [
  {
    label: `Median annual ${brand.niche.short} wage`,
    stat: STAT_SOURCES.averageSalary,
  },
  {
    label: `Projected ${brand.niche.short} employment growth (2024–2034)`,
    stat: STAT_SOURCES.blsGrowth2034,
  },
  {
    label: 'Jurisdictions with Full Practice Authority',
    stat: STAT_SOURCES.fullPracticeStates,
  },
] as const;

const HIRING_STEPS = [
  {
    title: 'Define the role before you write anything',
    body: `Pin down the population focus (adult, pediatric, geriatric, women's health, acute care), the setting (outpatient clinic, inpatient unit, telehealth, urgent care), the schedule model, and the supervision structure your state requires. A vague "provider needed" posting attracts vague applicants; a precise role definition lets a qualified ${brand.niche.descriptor} self-select in seconds.`,
  },
  {
    title: 'Benchmark compensation with real data',
    body: `Anchor your range to published data rather than last year's budget line. Start with the national median, then adjust for your state, setting, and specialty using the salary guide linked below. Posting a visible, realistic range filters out mismatched expectations before the first phone screen.`,
  },
  {
    title: 'Write a specific, honest job description',
    body: `Name the EHR, the visit cadence, the panel or caseload expectation, the call schedule, and the actual benefits. Our job-description guide walks through the structure section by section, and the template library gives you a setting-specific skeleton to start from.`,
  },
  {
    title: 'Post where the audience is specialized',
    body: `Generalist boards reach everyone, which means screening everyone. A niche board reaches only ${brand.niche.descriptor}s, so every applicant already holds the baseline credential. Wherever you post, keep the application short — long forms lose working clinicians.`,
  },
  {
    title: 'Screen credentials early, not at offer stage',
    body: `Verify licensure and board certification during the first screen (the checklist below covers what to check). Confirming credentials up front costs minutes; discovering a licensure gap after a signed offer costs the whole search.`,
  },
  {
    title: 'Interview for clinical fit and practice fit',
    body: `Pair a clinical conversation (case walk-throughs appropriate to the population focus) with a practice-model conversation: documentation expectations, collaboration structure, escalation paths, and autonomy. Misalignment on practice model — not clinical skill — is what drives early turnover.`,
  },
  {
    title: 'Make the offer and start credentialing in parallel',
    body: `The signed offer is the midpoint, not the finish line. Kick off state licensure verification, payer enrollment, and facility privileging the same week the offer is signed — these run in parallel with the candidate's notice period, and they are almost always the longest poles in the timeline.`,
  },
] as const;

// Credential checklist — evergreen verification steps. Certification
// bodies per the truth rules: AANP/ANCC certify NPs; NBCRNA certifies
// CRNAs; AMCB certifies CNMs. No fees, CE hours, or processing times are
// stated — those vary by state and belong to the state board.
const CREDENTIAL_CHECKLIST = [
  {
    title: 'Graduate education',
    body: `A master's or doctoral degree (MSN or DNP) from an accredited ${brand.niche.descriptor} program. Ask for the transcript or degree verification if your compliance process requires primary-source documentation.`,
  },
  {
    title: 'National board certification',
    body: `${brand.niche.long}s certify through AANP or ANCC in their population focus. If you are hiring for the wider APRN cohort, the certifying body differs by role: NBCRNA for nurse anesthetists (CRNAs) and AMCB for certified nurse-midwives (CNMs). Verify the certification is active and matches the population your role serves.`,
  },
  {
    title: 'State RN and APRN licensure',
    body: `Both licenses must be active and unrestricted in your state. Verify through your state board of nursing; RN licenses can also be checked through Nursys, the national licensure verification system. State-specific requirements vary — the board is the authoritative source.`,
  },
  {
    title: 'DEA registration',
    body: `Required if the role involves prescribing controlled substances. Confirm the registration is active and covers the schedules the role needs, or agree on a plan to obtain it before the start date.`,
  },
  {
    title: 'NPI number',
    body: `Needed for billing and payer enrollment. Nearly every practicing clinician already has one; confirm it early because payer credentialing cannot start without it.`,
  },
  {
    title: 'Practice-authority fit for your state',
    body: `States grant ${brand.niche.short}s full, reduced, or restricted practice authority — ${STAT_SOURCES.fullPracticeStates.formatted} currently grant Full Practice Authority. In reduced- and restricted-practice states you will need a collaborative or supervisory agreement with a physician in place before the start date. Check your state's current rules at the source below.`,
  },
] as const;

const TIMELINE_POINTS = [
  {
    title: 'Licensure is the long pole for out-of-state hires',
    body: `A candidate already licensed in your state can often start after standard onboarding. A relocating candidate needs state licensure first, and processing times vary widely by state — verify current expectations with your state board of nursing before committing to a start date.`,
  },
  {
    title: 'Payer credentialing and privileging run on their own clocks',
    body: `Insurance-panel enrollment and hospital privileging are governed by each payer's and facility's committee schedule, not yours. Start both the week the offer is signed, and plan early-start work (documentation setup, EHR training, shadowing) the new hire can do while enrollment completes.`,
  },
  {
    title: 'Build the start date around credentialing, not the offer',
    body: `The realistic sequence is: offer signed, then notice period, licensure verification, payer enrollment, and privileging in parallel, then a fully credentialed start. Committing publicly to a start date before the credentialing dependencies are mapped is the most common avoidable delay.`,
  },
] as const;

// FAQPage JSON-LD derives from this SAME array the visible FAQ renders —
// they cannot diverge (repo pattern: app/for-employers/page.tsx).
const FAQS = [
  {
    q: `What credentials should I verify before hiring a ${brand.niche.descriptor}?`,
    a: `Verify five things: an MSN or DNP from an accredited program; active national board certification (AANP or ANCC for ${brand.niche.short}s, in the population focus your role serves); active, unrestricted RN and APRN licensure in your state (checkable via your state board of nursing, with Nursys as the national RN verification system); active DEA registration if the role prescribes controlled substances; and an NPI number for billing and payer enrollment.`,
  },
  {
    q: `Does my ${brand.niche.short} hire need a collaborating physician?`,
    a: `It depends on your state. States grant full, reduced, or restricted practice authority — ${STAT_SOURCES.fullPracticeStates.formatted} currently grant Full Practice Authority, where ${brand.niche.short}s practice independently. In reduced- and restricted-practice states, a collaborative or supervisory agreement must be in place before the start date. Check your state's current rules with the state board of nursing or the AANP State Practice Environment resource.`,
  },
  {
    q: `How long does it take to hire a ${brand.niche.descriptor}?`,
    a: `The recruiting phase depends on your market and salary competitiveness, but the post-offer phase is what most employers underestimate: notice periods, state licensure for relocating candidates, payer enrollment, and facility privileging each run on their own clock and vary by state and payer. Start credentialing the week the offer is signed and set the start date from the credentialing plan — not the other way around.`,
  },
  {
    q: `How do I benchmark ${brand.niche.short} salary for my role?`,
    a: `Start from the national median annual wage of ${STAT_SOURCES.averageSalary.formatted} (${STAT_SOURCES.averageSalary.source}), then adjust for your state, setting, and specialty — pay differs meaningfully across all three. The ${brand.name} salary guide breaks down live compensation data by state so you can anchor your posted range to what candidates in your market actually see.`,
  },
  {
    q: `Why is ${brand.niche.short} hiring so competitive right now?`,
    a: `The profession is growing fast — the BLS projects ${STAT_SOURCES.blsGrowth2034.formatted} employment growth for ${brand.niche.descriptor}s from 2024 to 2034, among the fastest of any occupation — while demand from team-based and access-focused care models keeps rising. Employers that post transparent salary ranges and streamline credentialing consistently fill roles faster than those that don't.`,
  },
] as const;

// Escape < and > so serialized content can never terminate the script
// element early (repo pattern: components/BreadcrumbSchema.tsx).
const jsonLd = (obj: object): string =>
  JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

export default function HowToHireGuidePage() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* Article schema — derives from the same constants as the visible
          header; author stays Organization until a real credentialed
          reviewer is configured (config/brand.ts editorial.reviewer). */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd({
            '@context': 'https://schema.org',
            '@type': 'Article',
            headline: PAGE_TITLE,
            description: PAGE_DESCRIPTION,
            datePublished: PUBLISHED_AT,
            dateModified: LAST_REVIEWED,
            image: HERO_IMAGE,
            author: { '@type': 'Organization', name: brand.name },
            publisher: { '@type': 'Organization', name: brand.name, url: brand.baseUrl },
            mainEntityOfPage: PAGE_URL,
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

      {/* Hero */}
      <section className="py-12 md:py-16 text-white" style={{ background: 'linear-gradient(135deg, #831843, #BE185D)' }}>
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-white/10 mb-6">
              <BookOpen className="w-8 h-8" aria-hidden="true" />
            </div>
            <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4">
              How to Hire a {brand.niche.long}
            </h1>
            <p className="text-sm text-pink-200 mb-4">
              {/* Real review date — the same constant the Article schema
                  emits (fabricated-freshness rule, audit P0 #23). */}
              Last reviewed: {new Date(`${LAST_REVIEWED}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}
            </p>
            <p className="text-lg md:text-xl text-pink-100">
              Process, credentialing, salary benchmarking, and timeline expectations — from role definition to a fully credentialed start.
            </p>
          </div>
        </div>
      </section>

      <div className="container mx-auto px-4 py-8 md:py-12">
        <div className="max-w-4xl mx-auto">
          <Breadcrumbs
            items={[
              { label: 'Home', href: '/' },
              { label: 'For Employers', href: '/for-employers' },
              { label: 'Resources', href: '/for-employers/resources' },
              { label: 'How to Hire' },
            ]}
          />

          {/* Market context — every figure cited to its source. */}
          <div className="mb-10 rounded-xl p-6 md:p-8" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
            <h2 className="text-2xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
              The Market You Are Hiring Into
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {MARKET_STATS.map(({ label, stat }) => (
                <div key={label} className="p-4 rounded-lg" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                  <p className="text-2xl font-bold" style={{ color: 'var(--color-primary)' }}>{stat.formatted}</p>
                  <p className="text-sm font-medium mt-1" style={{ color: 'var(--text-primary)' }}>{label}</p>
                  <a
                    href={stat.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs mt-2 hover:underline"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    {stat.source} <ExternalLink className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
                  </a>
                </div>
              ))}
            </div>
          </div>

          {/* The process */}
          <div className="mb-10">
            <h2 className="text-2xl font-bold mb-6" style={{ color: 'var(--text-primary)' }}>
              The Hiring Process, Step by Step
            </h2>
            <ol className="space-y-4">
              {HIRING_STEPS.map((step, i) => (
                <li
                  key={step.title}
                  className="rounded-xl p-5 md:p-6 flex gap-4"
                  style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}
                >
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-sm text-white"
                    style={{ background: 'linear-gradient(145deg, #BE185D, #9D174D)' }}
                    aria-hidden="true"
                  >
                    {i + 1}
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>{step.title}</h3>
                    <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {/* Salary benchmarking */}
          <div className="mb-10 rounded-xl p-6 md:p-8" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
            <div className="flex items-center gap-3 mb-4">
              <DollarSign className="h-6 w-6" style={{ color: 'var(--color-primary)' }} aria-hidden="true" />
              <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Benchmarking the Salary</h2>
            </div>
            <p className="text-sm leading-relaxed mb-4" style={{ color: 'var(--text-secondary)' }}>
              The national median annual wage for {brand.niche.descriptor}s is {STAT_SOURCES.averageSalary.formatted} ({STAT_SOURCES.averageSalary.source}). {TYPICAL_BAND} is the typical W-2 comparison band this board&apos;s salary pipeline uses as a sanity check, but pay varies meaningfully by state, setting, and specialty — anchoring to a national number alone will leave your range uncompetitive in some markets and overpriced in others.
            </p>
            <p className="text-sm leading-relaxed mb-5" style={{ color: 'var(--text-secondary)' }}>
              Use the live salary guide to see disclosed-pay data for your state before setting the range, and post the range in the job description — transparent listings pre-qualify candidates on the single factor most likely to end a negotiation late.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/salary-guide"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold text-sm text-white"
                style={{ background: 'linear-gradient(145deg, #BE185D, #9D174D)' }}
              >
                Open the {brand.niche.short} Salary Guide <ArrowRight size={14} aria-hidden="true" />
              </Link>
              <Link
                href="/for-employers/resources/job-description-guide"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold text-sm"
                style={{ color: 'var(--color-primary)', border: '1px solid var(--border-color)' }}
              >
                Job Description Guide
              </Link>
            </div>
          </div>

          {/* Credentialing overview */}
          <div className="mb-10 rounded-xl p-6 md:p-8" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
            <div className="flex items-center gap-3 mb-4">
              <ClipboardCheck className="h-6 w-6" style={{ color: 'var(--color-primary)' }} aria-hidden="true" />
              <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Credentialing Overview: What to Verify</h2>
            </div>
            <ul className="space-y-4">
              {CREDENTIAL_CHECKLIST.map((item) => (
                <li key={item.title} className="flex gap-3">
                  <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" aria-hidden="true" />
                  <div>
                    <h3 className="font-semibold text-sm mb-0.5" style={{ color: 'var(--text-primary)' }}>{item.title}</h3>
                    <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{item.body}</p>
                  </div>
                </li>
              ))}
            </ul>
            <p className="text-xs mt-5 leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
              State licensure specifics — fees, continuing-education requirements, and processing times — vary by jurisdiction and change over time. Your state board of nursing is the authoritative source; the{' '}
              <a href={STAT_SOURCES.fullPracticeStates.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">
                AANP State Practice Environment
              </a>{' '}
              tracks practice-authority rules by state.
            </p>
          </div>

          {/* Timeline expectations */}
          <div className="mb-10 rounded-xl p-6 md:p-8" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
            <div className="flex items-center gap-3 mb-4">
              <Clock className="h-6 w-6" style={{ color: 'var(--color-primary)' }} aria-hidden="true" />
              <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Timeline Expectations</h2>
            </div>
            <div className="space-y-4">
              {TIMELINE_POINTS.map((point) => (
                <div key={point.title}>
                  <h3 className="font-semibold text-sm mb-1" style={{ color: 'var(--text-primary)' }}>{point.title}</h3>
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{point.body}</p>
                </div>
              ))}
            </div>
          </div>

          {/* FAQ — visible list renders the same FAQS array the JSON-LD uses. */}
          <div className="mb-10 rounded-xl p-6 md:p-8" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
            <h2 className="text-2xl font-bold mb-6" style={{ color: 'var(--text-primary)' }}>Hiring FAQs</h2>
            {FAQS.map(({ q, a }) => (
              <div key={q} className="mb-6 last:mb-0">
                <h3 className="font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>{q}</h3>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{a}</p>
              </div>
            ))}
          </div>

          {/* Related resources */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Link href="/for-employers/resources/job-description-guide" className="block p-4 rounded-lg hover:shadow-sm transition-all" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
              <h3 className="font-semibold text-sm" style={{ color: 'var(--color-primary)' }}>Writing a {brand.niche.short} Job Description</h3>
              <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>Section-by-section guide to a posting that converts.</p>
            </Link>
            <Link href="/for-employers/resources/job-description-templates" className="block p-4 rounded-lg hover:shadow-sm transition-all" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
              <h3 className="font-semibold text-sm" style={{ color: 'var(--color-primary)' }}>Job Description Templates</h3>
              <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>Setting-specific skeletons ready to customize.</p>
            </Link>
            <Link href="/post-job" className="block p-4 rounded-lg hover:shadow-sm transition-all" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
              <h3 className="font-semibold text-sm" style={{ color: 'var(--color-primary)' }}>Post Your Role</h3>
              <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>First post free — every feature included.</p>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
