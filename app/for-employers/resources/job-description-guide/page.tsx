/**
 * "Writing an NP Job Description" employer guide (P1 #18).
 *
 * Evergreen craft guide. The recommended section structure is the SAME
 * nine-section skeleton the lib/jd-templates.ts registry uses (about,
 * position summary, responsibilities, required quals, preferred quals,
 * schedule, compensation, why join us, how to apply), so guide and
 * templates cannot disagree about what a complete posting contains.
 *
 * That coupling is PINNED, not asserted: tests/regressions/
 * p1-employer-content-hub.test.ts extracts the JD_ANATOMY section names
 * from this file and compares them to the headings buildTemplate()
 * actually emits, so a change on either side fails the suite.
 *
 * TRUTH RULES: no statistics on this page. Advice is framed as
 * recommendation, never as invented data ("X% more applicants").
 * Certification bodies named correctly (AANP/ANCC for NPs). Article
 * dateModified renders the LAST_REVIEWED constant — never new Date().
 */
import { brand } from '@/config/brand';
import { Metadata } from 'next';
import Link from 'next/link';
import Breadcrumbs from '@/components/Breadcrumbs';
import { JD_TEMPLATES } from '@/lib/jd-templates';
import {
  PenLine, CheckCircle, XCircle, ArrowRight, ClipboardList,
} from 'lucide-react';

// Bump on each editorial review pass (repo pattern:
// app/resources/1099-vs-w2/page.tsx).
const PUBLISHED_AT = '2026-07-29';
const LAST_REVIEWED = '2026-07-29';

const PAGE_URL = `${brand.baseUrl}/for-employers/resources/job-description-guide`;
const PAGE_TITLE = `Writing a ${brand.niche.short} Job Description That Actually Converts`;
const PAGE_DESCRIPTION = `A section-by-section employer guide to writing a ${brand.niche.descriptor} job description: structure, title formula, salary transparency, and the mistakes that make qualified clinicians skip your posting.`;
const HERO_IMAGE = `${brand.baseUrl}/api/og?title=${encodeURIComponent(`Writing a ${brand.niche.short} Job Description`)}&type=page`;

export const metadata: Metadata = {
  title: `${PAGE_TITLE} | ${brand.name}`,
  description: PAGE_DESCRIPTION,
  keywords: [
    `${brand.niche.short} job description`,
    `${brand.niche.descriptor} job description template`,
    `how to write a ${brand.niche.short} job posting`,
    `hiring ${brand.niche.short}s`,
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

// The nine-section anatomy — the SAME structure lib/jd-templates.ts
// builds every skeleton from (see buildTemplate + the shared blocks).
// Order and membership are pinned against renderTemplate() output; do
// not add, drop, or reorder an entry here without changing the registry.
const JD_ANATOMY = [
  {
    section: 'About your organization',
    advice: `Two or three sentences on who you are and who you serve. Skip the mission-statement boilerplate — name the care model, the patient mix, and what makes the clinical environment distinctive.`,
  },
  {
    section: 'Position summary',
    advice: `One paragraph a candidate can evaluate in ten seconds: setting, population focus, degree of autonomy, the team they join, and the EHR they will chart in. Naming the EHR is a small detail that signals you understand a clinician's daily reality.`,
  },
  {
    section: 'Key responsibilities',
    advice: `Five to eight scannable bullets with real specifics: visit lengths, caseload or panel expectations, procedures within scope, documentation turnaround. Vague duties ("provide excellent patient care") tell a candidate nothing and read as template filler.`,
  },
  {
    section: 'Required qualifications',
    advice: `Keep this list short and legally accurate: graduate degree (MSN/DNP) from an accredited program, active national board certification — AANP or ANCC for ${brand.niche.short}s, in the population focus the role serves — active RN and APRN licensure in your state, and DEA registration if the role prescribes. State your real experience requirement explicitly, including "new grads welcome" if that is true.`,
  },
  {
    section: 'Preferred qualifications',
    advice: `Separate nice-to-haves from must-haves honestly. Language fluency, procedural skills, and prior experience with your patient population belong here — not in the required list, where they silently filter out candidates you would actually hire.`,
  },
  {
    section: 'Schedule',
    advice: `Days, hours, call expectations, weekend rotations, and admin time. Ambiguity here is the number-one source of first-call mismatches — a clinician deciding between offers compares schedules before almost anything else.`,
  },
  {
    section: 'Compensation and benefits',
    advice: `Post a real salary range. Some states require a posted pay range by law — verify your state's rules — and even where it is optional, an honest range pre-qualifies candidates and signals negotiating in good faith. List the benefits that matter to clinicians: CME stipend and days, malpractice coverage (with tail), retirement match, and PTO.`,
  },
  {
    section: 'Why join us',
    advice: `One or two sentences on what makes this job different from the other openings a candidate is comparing it against — clinician-led leadership, panel or caseload limits you actually hold to, administrative support, a growth path. This is the only section where you are arguing rather than describing, so keep it concrete: a specific commitment beats an adjective.`,
  },
  {
    section: 'How to apply',
    advice: `Say what happens next and how fast you respond. A short application with a stated response window outperforms a long portal form — working clinicians apply between patients, not at a desk.`,
  },
] as const;

const TITLE_DOS = [
  `Lead with the credential and population focus: the role name a ${brand.niche.descriptor} searches for`,
  'Include the setting (outpatient, inpatient, telehealth, urgent care)',
  'Include the location or "Remote" explicitly',
  'Add the schedule model when it is a selling point (PRN, part-time, 7-on/7-off)',
] as const;

const TITLE_DONTS = [
  `Internal req codes or grade levels ("Provider II — Req 4471")`,
  `Generic titles ("Healthcare Provider", "Clinician") that never surface in a ${brand.niche.short} search`,
  'ALL-CAPS, emoji, or urgency bait ("HIRING NOW!!!")',
  'Stuffing every keyword into one unreadable title',
] as const;

const COMMON_MISTAKES = [
  {
    title: 'Hiding the salary',
    body: `"Competitive compensation" is a red flag to experienced candidates and may put you out of compliance in states with pay-transparency laws. If you must use a wide range, explain what moves an offer within it.`,
  },
  {
    title: 'Copying a physician JD and swapping the title',
    body: `Scope, supervision language, and credential requirements differ. A posting that asks a ${brand.niche.short} for "board certification in family medicine" or residency training signals the org does not understand the role it is hiring for.`,
  },
  {
    title: 'Requiring the wrong certification',
    body: `Certification follows population focus — an acute-care inpatient role and a primary-care clinic role call for different certifications, and both come from AANP or ANCC for ${brand.niche.short}s. Name the population focus you need and let the certification requirement follow from it.`,
  },
  {
    title: 'Burying the practice model',
    body: `Autonomy, collaboration structure, and escalation paths decide whether a hire stays. If your state requires a collaborative agreement, say how it works in practice; if you are in a full-practice-authority state, that is a selling point worth stating.`,
  },
  {
    title: 'Posting a novel instead of a description',
    body: `Walls of prose get skimmed, not read. Structure wins: short paragraphs for context, bullets for responsibilities and qualifications, and specifics a candidate can compare against other offers.`,
  },
] as const;

// FAQPage JSON-LD derives from this SAME array the visible FAQ renders.
const FAQS = [
  {
    q: `What should a ${brand.niche.short} job description include?`,
    a: `Nine sections: about your organization, a position summary (setting, population focus, EHR, team), key responsibilities as scannable bullets, required qualifications (MSN/DNP, AANP or ANCC board certification in the population focus, state RN/APRN licensure, DEA if prescribing), preferred qualifications kept separate, the real schedule including call, compensation with a posted salary range and clinician-relevant benefits, a short why-join-us section naming what makes the role different, and how to apply with your response window.`,
  },
  {
    q: `Should I include a salary range in my ${brand.niche.short} job posting?`,
    a: `Yes. Several states require a posted pay range by law — verify your state's current rules — and even where optional, a transparent range pre-qualifies candidates on the factor most likely to end a negotiation late. Use the ${brand.name} salary guide's live state-level data to set a range that is competitive in your market.`,
  },
  {
    q: `How long should a ${brand.niche.short} job description be?`,
    a: `Long enough to answer a candidate's comparison questions, short enough to scan between patients. The template skeletons in our library run a few thousand characters with bulleted responsibilities and qualifications — enough structure to be complete without becoming a wall of prose.`,
  },
  {
    q: `Can I start from a template instead of writing from scratch?`,
    a: `Yes — the ${brand.name} template library has ${JD_TEMPLATES.length} setting-specific skeletons (outpatient, inpatient, telehealth, and specialty settings) with bracketed prompts marking every detail you should customize. The same templates are available directly inside the post-job form's description editor.`,
  },
] as const;

// Escape < and > so serialized content can never terminate the script
// element early (repo pattern: components/BreadcrumbSchema.tsx).
const jsonLd = (obj: object): string =>
  JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

export default function JobDescriptionGuidePage() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)' }}>
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
              <PenLine className="w-8 h-8" aria-hidden="true" />
            </div>
            <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4">
              Writing a {brand.niche.short} Job Description
            </h1>
            <p className="text-sm text-pink-200 mb-4">
              Last reviewed: {new Date(`${LAST_REVIEWED}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}
            </p>
            <p className="text-lg md:text-xl text-pink-100">
              The section-by-section structure that qualified {brand.niche.descriptor}s actually respond to — and the mistakes that make them skip your posting.
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
              { label: 'Job Description Guide' },
            ]}
          />

          {/* Anatomy */}
          <div className="mb-10">
            <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
              The Anatomy of a Strong {brand.niche.short} Job Description
            </h2>
            <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
              Nine sections, in this order — the same structure every skeleton in our template library uses.
            </p>
            <ol className="space-y-4">
              {JD_ANATOMY.map((item, i) => (
                <li
                  key={item.section}
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
                    <h3 className="font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>{item.section}</h3>
                    <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{item.advice}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {/* Title formula */}
          <div className="mb-10 rounded-xl p-6 md:p-8" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
            <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>The Job Title Formula</h2>
            <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
              Credential + population focus or specialty + setting + location. The title is a search query target first and a headline second.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="font-semibold mb-3 text-green-600">Put in the title</h3>
                <ul className="space-y-2">
                  {TITLE_DOS.map((item) => (
                    <li key={item} className="flex gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" aria-hidden="true" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="font-semibold mb-3 text-red-500">Keep out of the title</h3>
                <ul className="space-y-2">
                  {TITLE_DONTS.map((item) => (
                    <li key={item} className="flex gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      <XCircle className="h-4 w-4 text-red-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          {/* Common mistakes */}
          <div className="mb-10 rounded-xl p-6 md:p-8" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
            <h2 className="text-2xl font-bold mb-6" style={{ color: 'var(--text-primary)' }}>Five Mistakes That Lose Qualified Candidates</h2>
            <div className="space-y-5">
              {COMMON_MISTAKES.map((m) => (
                <div key={m.title}>
                  <h3 className="font-semibold text-sm mb-1" style={{ color: 'var(--text-primary)' }}>{m.title}</h3>
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{m.body}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Template library CTA */}
          <div
            className="mb-10 rounded-xl p-6 md:p-8"
            style={{ background: 'linear-gradient(135deg, #FDF2F8, #FCE7F3)', border: '1px solid rgba(190,24,93,0.2)' }}
          >
            <div className="flex items-center gap-3 mb-3">
              <ClipboardList className="h-6 w-6" style={{ color: '#BE185D' }} aria-hidden="true" />
              <h2 className="text-xl md:text-2xl font-bold" style={{ color: '#831843' }}>
                Start From a Template
              </h2>
            </div>
            <p className="text-sm mb-5" style={{ color: '#9D174D' }}>
              {JD_TEMPLATES.length} setting-specific skeletons built on this exact structure — outpatient, inpatient, telehealth, and specialty settings — with bracketed prompts marking everything you should customize.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/for-employers/resources/job-description-templates"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold text-sm text-white"
                style={{ background: 'linear-gradient(145deg, #BE185D, #9D174D)' }}
              >
                Browse the Template Library <ArrowRight size={14} aria-hidden="true" />
              </Link>
              <Link
                href="/post-job"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold text-sm bg-white"
                style={{ color: '#831843', border: '1px solid rgba(190,24,93,0.3)' }}
              >
                Post a Job — First Post Free
              </Link>
            </div>
          </div>

          {/* FAQ */}
          <div className="mb-10 rounded-xl p-6 md:p-8" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
            <h2 className="text-2xl font-bold mb-6" style={{ color: 'var(--text-primary)' }}>Job Description FAQs</h2>
            {FAQS.map(({ q, a }) => (
              <div key={q} className="mb-6 last:mb-0">
                <h3 className="font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>{q}</h3>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{a}</p>
              </div>
            ))}
          </div>

          {/* Related resources */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Link href="/for-employers/resources/how-to-hire" className="block p-4 rounded-lg hover:shadow-sm transition-all" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
              <h3 className="font-semibold text-sm" style={{ color: 'var(--color-primary)' }}>How to Hire a {brand.niche.long}</h3>
              <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>Process, credentialing, and timeline expectations.</p>
            </Link>
            <Link href="/salary-guide" className="block p-4 rounded-lg hover:shadow-sm transition-all" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
              <h3 className="font-semibold text-sm" style={{ color: 'var(--color-primary)' }}>{brand.niche.short} Salary Guide</h3>
              <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>Live state-level pay data for setting your range.</p>
            </Link>
            <Link href="/for-employers" className="block p-4 rounded-lg hover:shadow-sm transition-all" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
              <h3 className="font-semibold text-sm" style={{ color: 'var(--color-primary)' }}>For Employers</h3>
              <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>Pricing, features, and how the board works.</p>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
