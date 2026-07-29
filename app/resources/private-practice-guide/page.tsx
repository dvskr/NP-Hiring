import { brand } from '@/config/brand';
import { Metadata } from 'next';
import Link from 'next/link';
import { Building2, DollarSign, FileText, CheckCircle, Shield, Users, BookOpen, Landmark } from 'lucide-react';
import BreadcrumbSchema from '@/components/BreadcrumbSchema';
import { getStatesByAuthority } from '@/lib/state-practice-authority';
import { STAT_SOURCES } from '@/lib/stats-sources';

// Editorial review constants — bump LAST_REVIEWED on each pass so Article
// dateModified reflects real freshness, not the original publish date.
const PUBLISHED_AT = '2026-03-19';
const LAST_REVIEWED = '2026-07-29';

/* ─────────────────────────────────────────────────────────────────────────
 * P2 #22 — FACTUAL FIXES ON THIS PAGE
 * ─────────────────────────────────────────────────────────────────────────
 * 1. Step 1 overstated the number of Full Practice Authority states by
 *    seven. The repo's own AANP-sourced dataset says 27 + DC, and a
 *    regression test already bans that same wrong count on /salary-guide
 *    for exactly this reason. It is now DERIVED from
 *    lib/state-practice-authority.ts and cannot drift again.
 * 2. The income-projection table published four gross/net bands with no
 *    stated basis — they were not computed from anything and not sourced
 *    to anything. They are now COMPUTED from the visit-volume and
 *    per-visit assumptions declared in PRACTICE_MODEL below, and those
 *    assumptions are rendered above the table. It is a transparent model,
 *    labelled as a model, rather than a claim about what practices earn.
 */

/**
 * JSON-LD serializer matching the repo convention (see app/companies/page.tsx
 * and app/for-employers/resources/how-to-hire/page.tsx): angle brackets are
 * escaped so no serialized value can terminate the surrounding script element.
 */
const ldJson = (obj: unknown): string =>
  JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

/**
 * Full Practice Authority state count, derived so it can never disagree
 * with /resources/fpa-guide or STAT_SOURCES.fullPracticeStates. D.C. is a
 * jurisdiction in the dataset, not a state, so it is excluded from the
 * count and named separately in copy.
 */
const FULL_PRACTICE_STATE_COUNT = getStatesByAuthority('full').filter(
  (jurisdiction) => jurisdiction !== 'District of Columbia',
).length;


/**
 * Revenue model inputs. Every figure in the income table is computed from
 * these, and the assumptions are shown to the reader above the table —
 * they are illustrative planning inputs, not survey data.
 */
const PRACTICE_MODEL = {
  /** 52 weeks less roughly six for holidays, vacation, and admin days. */
  workingWeeksPerYear: 46,
  /** Blended amount COLLECTED per visit on an insurance-based panel. */
  insuranceCollectedPerVisit: 175,
  /** Blended amount collected per visit on a cash-pay panel. */
  cashCollectedPerVisit: 250,
} as const;

interface PracticeScenario {
  label: string;
  visitsPerWeek: { min: number; max: number };
  collectedPerVisit: number;
  /** Overhead as a share of collections. */
  overhead: { min: number; max: number };
}

const PRACTICE_SCENARIOS: readonly PracticeScenario[] = [
  {
    label: 'Part-time telehealth',
    visitsPerWeek: { min: 12, max: 15 },
    collectedPerVisit: PRACTICE_MODEL.insuranceCollectedPerVisit,
    overhead: { min: 0.15, max: 0.20 },
  },
  {
    label: 'Full-time telehealth',
    visitsPerWeek: { min: 22, max: 28 },
    collectedPerVisit: PRACTICE_MODEL.insuranceCollectedPerVisit,
    overhead: { min: 0.15, max: 0.25 },
  },
  {
    label: 'Full-time office',
    visitsPerWeek: { min: 22, max: 28 },
    collectedPerVisit: PRACTICE_MODEL.insuranceCollectedPerVisit,
    overhead: { min: 0.30, max: 0.40 },
  },
  {
    label: 'Cash-pay panel',
    visitsPerWeek: { min: 18, max: 25 },
    collectedPerVisit: PRACTICE_MODEL.cashCollectedPerVisit,
    overhead: { min: 0.15, max: 0.25 },
  },
];

const grossFor = (visitsPerWeek: number, collectedPerVisit: number): number =>
  visitsPerWeek * PRACTICE_MODEL.workingWeeksPerYear * collectedPerVisit;

/** "$177K" from 177,100 — the table reads in thousands, not to the dollar. */
const asK = (n: number): string => `$${Math.round(n / 1000)}K`;

interface ScenarioRow {
  label: string;
  visits: string;
  gross: string;
  overhead: string;
  net: string;
}

function projectScenario(s: PracticeScenario): ScenarioRow {
  const grossLow = grossFor(s.visitsPerWeek.min, s.collectedPerVisit);
  const grossHigh = grossFor(s.visitsPerWeek.max, s.collectedPerVisit);
  // Worst case pairs the lowest volume with the highest overhead, and
  // vice versa — so the net band brackets the realistic outcomes rather
  // than quietly mixing best-case inputs.
  const netLow = grossLow * (1 - s.overhead.max);
  const netHigh = grossHigh * (1 - s.overhead.min);
  return {
    label: s.label,
    visits: `${s.visitsPerWeek.min}–${s.visitsPerWeek.max}`,
    gross: `${asK(grossLow)}–${asK(grossHigh)}`,
    overhead: `${Math.round(s.overhead.min * 100)}–${Math.round(s.overhead.max * 100)}%`,
    net: `${asK(netLow)}–${asK(netHigh)}`,
  };
}

const SCENARIO_ROWS: readonly ScenarioRow[] = PRACTICE_SCENARIOS.map(projectScenario);

/** Full-time telehealth gross band — the headline the hero renders. */
const HEADLINE_GROSS = SCENARIO_ROWS[1].gross;
// P0 OG sweep: edge-generated card via /api/og — the previous Supabase
// page-screenshot 400'd on every share (pattern: app/for-employers/page.tsx).
// Absolute URL because it also feeds Article JSON-LD `image`.
const HERO_IMAGE = `${brand.baseUrl}/api/og?title=${encodeURIComponent(`How to Start an ${brand.niche.short} Private Practice`)}&type=page`;

export const metadata: Metadata = {
  title: `How to Start an ${brand.niche.short} Private Practice — Step-by-Step Guide 2026`,
  description: `Complete guide to starting your own ${brand.niche.short} private practice: PLLC formation, insurance credentialing (CAQH, NPI), EHR setup, malpractice coverage, billing, overhead, and a transparent revenue model you can re-run with your own numbers.`,
  keywords: [`${brand.niche.short} private practice`, `how to start an ${brand.niche.short} private practice`, `${brand.niche.short} private practice income`, `${brand.niche.descriptor} own practice`, `${brand.niche.short} business startup`, `independent ${brand.niche.descriptor} practice`],
  openGraph: {
    title: `How to Start an ${brand.niche.short} Private Practice — 2026 Guide`,
    description: `Step-by-step guide to launching your own ${brand.niche.descriptor} private practice.`,
    type: 'article',
    images: [{ url: HERO_IMAGE, width: 1200, height: 630, alt: `How to Start an ${brand.niche.short} Private Practice — 2026 Guide` }],
  },
  twitter: {
    card: 'summary_large_image',
    title: `How to Start an ${brand.niche.short} Private Practice — 2026 Guide`,
    images: [HERO_IMAGE],
  },
  alternates: { canonical: `${brand.baseUrl}/resources/private-practice-guide` },
};

export default function PrivatePracticeGuidePage() {
  const steps = [
    {
      number: 1,
      title: 'Verify Your State Requirements',
      icon: Shield,
      content: `Check your state's practice authority laws before anything else — they decide whether an independent practice is even available to you. ${FULL_PRACTICE_STATE_COUNT} states plus Washington D.C. grant Full Practice Authority (${STAT_SOURCES.fullPracticeStates.source}), where you can practice without a physician agreement. In reduced and restricted states you must have a collaborating or supervising physician in place first, and that relationship is usually a paid one. Several full-practice states also apply a transition-to-practice period before autonomy begins.`,
      link: { href: '/resources/fpa-guide', text: 'View FPA Guide →' },
    },
    {
      number: 2,
      title: 'Form Your Business Entity',
      icon: Landmark,
      content: `Most ${brand.niche.short}s choose a Professional Limited Liability Company (PLLC) for liability protection and tax flexibility. Key steps: choose a business name, file with your Secretary of State, get an EIN from the IRS (free), and open a business bank account before any patient revenue lands.`,
      details: [
        'LLC/PLLC: the usual choice for solo practitioners — formation fees are set per state, so check your Secretary of State fee schedule rather than budgeting a national average',
        'S-Corp election: worth modelling with a CPA once net profit is high enough that the payroll-tax saving clearly exceeds the added payroll and compliance cost — it is a threshold specific to your numbers, not a fixed income figure',
        'Professional liability: a PLLC shields personal assets from business debts, but it does not shield you from your own clinical liability — you still need malpractice coverage',
        'Consult a healthcare attorney for state-specific requirements; several states restrict who may own a professional entity',
      ],
    },
    {
      number: 3,
      title: 'Get Insurance Credentialing',
      icon: FileText,
      content: 'Insurance credentialing allows you to bill insurance companies directly. This process takes 90-180 days, so start early.',
      details: [
        'Create your CAQH ProView profile (universal credentialing application)',
        'Apply for an individual NPI number (Type 1) and organizational NPI (Type 2)',
        'Credential with major payers: Aetna, BCBS, Cigna, UnitedHealthcare, Medicare',
        'Consider Medicaid credentialing for your state',
        'Typical timeline: 90-180 days from application to approval',
      ],
    },
    {
      number: 4,
      title: 'Set Up Your EHR & Billing',
      icon: BookOpen,
      content: `Choose an EHR (Electronic Health Records) system with integrated billing. Popular options for ${brand.niche.short} private practices include:`,
      details: [
        'SimplePractice — popular for solo and telehealth practices',
        'DrChrono — full-featured, better suited to larger practices',
        'Tebra (formerly Kareo) — built for independent medical practices',
        'Outsourced billing is usually priced either as a monthly retainer or as a percentage of collections — get both quoted and compare against your modelled volume',
        'Vendor pricing changes often and is not reproduced here; get a current quote directly, and confirm the plan tier includes the billing and telehealth modules you need',
      ],
    },
    {
      number: 5,
      title: 'Secure Malpractice Insurance',
      icon: Shield,
      content: `Individual malpractice (professional liability) insurance is essential. Most private practice ${brand.niche.short}s need:`,
      details: [
        'Prefer an occurrence-based policy over claims-made: it covers incidents that happened during the policy period even after you cancel, so you do not need to buy tail coverage later',
        'A commonly requested limit structure is $1M per occurrence / $3M aggregate — confirm what your payers and any collaborating physician require',
        'Get quotes from several carriers (NSO, HPSO, CM&F, and Berxi all write individual APRN policies); premiums vary by state, specialty, and limits, so a quote is the only reliable number',
        'Add cyber liability if you deliver telehealth or store records electronically',
        'Add general liability separately if you lease office space — it covers premises claims that malpractice does not',
      ],
    },
    {
      number: 6,
      title: 'Launch & Build Your Caseload',
      icon: Users,
      content: `Plan on several months to fill a schedule. The revenue model below assumes ${PRACTICE_SCENARIOS[1].visitsPerWeek.min}-${PRACTICE_SCENARIOS[1].visitsPerWeek.max} visits a week at full-time capacity — that is the number every projection hangs on, so track it weekly from day one.`,
      details: [
        'Create a professional website with online scheduling',
        'Register on provider directories like Zocdoc and Healthgrades',
        'Network with local physicians, specialists, and community organizations for referrals',
        'Consider contract work initially to maintain income while building',
        'Set your fee schedule from your contracted payer rates and local cash-pay market, then track what you actually COLLECT per visit — collections, not charges, are what the revenue model runs on',
      ],
    },
  ];

  const ppFaqs = [
    {
      question: `How much does it cost to start an ${brand.niche.short} private practice?`,
      answer: `Build the number from your own quotes rather than a headline range. The line items are consistent: state filing fees for a PLLC, an EHR subscription, individual malpractice coverage, credentialing and application fees, a website and scheduling, and initial marketing. A telehealth-first practice skips the largest cost — a lease and its fit-out — which is why most ${brand.niche.short}s start virtual and add space later if demand justifies it. Filing fees vary by state and vendor pricing changes, so this guide points you at live quotes instead of printing figures that expire.`
    },
    {
      question: `How much can an ${brand.niche.short} private practice owner earn?`,
      answer: `It is a volume-times-collections calculation, so model it rather than trusting a headline number. The table on this page works it through: at ${PRACTICE_SCENARIOS[1].visitsPerWeek.min}–${PRACTICE_SCENARIOS[1].visitsPerWeek.max} visits a week over ${PRACTICE_MODEL.workingWeeksPerYear} working weeks, collecting about $${PRACTICE_MODEL.insuranceCollectedPerVisit} per visit on an insurance panel, a full-time telehealth practice models ${HEADLINE_GROSS} of gross collections, and ${SCENARIO_ROWS[1].net} net after ${SCENARIO_ROWS[1].overhead} overhead. An office-based practice models the same gross with materially higher overhead, and a cash-pay panel models higher collections per visit at lower volume. Change any input — your real reimbursement rate, your no-show rate, your weeks worked — and the answer changes with it. The national median annual wage for employed ${brand.niche.descriptor}s, for comparison, is ${STAT_SOURCES.averageSalary.formatted} (${STAT_SOURCES.averageSalary.source}).`
    },
    {
      question: "How long does it take to build a full private practice caseload?",
      answer: `Most ${brand.niche.short}s reach a full caseload within 6-12 months. Factors that speed this up include accepting insurance (vs cash-only), being in an underserved area, directory listings (Zocdoc, Healthgrades), networking with local providers, and having a specialty niche. Many ${brand.niche.short}s maintain part-time employment while building their practice.`
    },
    {
      question: "Should I accept insurance or go cash-pay only?",
      answer: `Insurance panels fill faster and reach more patients, at a lower collected amount per visit and with real billing and credentialing overhead. Cash-pay collects more per visit with far less paperwork, but fills slowly and is sensitive to your local market. Many practices run a mix. The model on this page uses $${PRACTICE_MODEL.insuranceCollectedPerVisit} collected per insurance visit and $${PRACTICE_MODEL.cashCollectedPerVisit} per cash-pay visit as planning inputs — replace both with the contracted rates you are actually offered before you commit to a model, since payer contracts vary widely by state and specialty.`
    },
    {
      question: `Can new grad ${brand.niche.short}s open a private practice?`,
      answer: `It is possible but not recommended. Most experts suggest gaining 2-3 years of clinical experience in structured settings (community health centers, group practices) before opening a private practice. This builds clinical confidence, medication management skills, and a professional network for referrals.`
    },
  ];

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <BreadcrumbSchema items={[
        { name: "Home", url: brand.baseUrl },
        { name: "Resources", url: `${brand.baseUrl}/resources` },
        { name: "Private Practice Guide", url: `${brand.baseUrl}/resources/private-practice-guide` }
      ]} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: ldJson({
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: ppFaqs.map((faq) => ({
              '@type': 'Question',
              name: faq.question,
              acceptedAnswer: { '@type': 'Answer', text: faq.answer },
            })),
          }),
        }}
      />
      {/* Article schema (audit 14 M-3): page is long-form editorial content
          with a named publisher and a hero image — qualifies for Article
          rich results alongside the existing HowTo + FAQPage. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: ldJson({
            '@context': 'https://schema.org',
            '@type': 'Article',
            headline: `How to Start an ${brand.niche.short} Private Practice — 2026 Step-by-Step Guide`,
            description: `Complete guide to starting your own ${brand.niche.short} private practice — LLC formation, insurance credentialing, EHR setup, malpractice, billing, and income projections.`,
            datePublished: PUBLISHED_AT,
            dateModified: LAST_REVIEWED,
            image: HERO_IMAGE,
            author: { '@type': 'Organization', name: brand.name },
            publisher: { '@type': 'Organization', name: brand.name, url: brand.baseUrl },
            mainEntityOfPage: { '@type': 'WebPage', '@id': `${brand.baseUrl}/resources/private-practice-guide` },
          }),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: ldJson({
            '@context': 'https://schema.org',
            '@type': 'HowTo',
            name: `How to Start an ${brand.niche.short} Private Practice`,
            description: `Step-by-step guide to launching your own ${brand.niche.descriptor} private practice.`,
            step: steps.map((s) => ({
              '@type': 'HowToStep',
              name: s.title,
              text: s.content,
              position: s.number,
            })),
          }),
        }}
      />

      {/* Hero Section */}
      <section className="bg-gradient-to-r from-pink-700 to-emerald-600 text-white py-12 md:py-16">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-white/10 mb-6">
              <Building2 className="w-8 h-8" />
            </div>
            <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4">
              How to Start an {brand.niche.short} Private Practice
            </h1>
            <p className="text-sm text-pink-200 text-center mt-2 mb-4">
              {/* Audit P0 #23: render the real review date (same constant the
                  Article schema emits) — never render time, which fabricated
                  freshness and contradicted dateModified. */}
              Last Updated: {new Date(`${LAST_REVIEWED}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })} | Step-by-step startup guide
            </p>
            <p className="text-lg md:text-xl text-pink-100 mb-6">
              From LLC formation to full caseload — everything you need to launch your {brand.niche.short} practice
            </p>
            <div className="flex flex-wrap justify-center gap-6 md:gap-8 mt-8">
              {/* Headline figure is the MODELLED full-time telehealth gross
                  band, computed from PRACTICE_MODEL — not an earnings claim. */}
              <div className="text-center">
                <div className="text-3xl font-bold">{HEADLINE_GROSS}</div>
                <div className="text-sm text-pink-100">Modelled full-time gross</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold">6-12 mo</div>
                <div className="text-sm text-pink-100">Typical ramp to a full caseload</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold">{FULL_PRACTICE_STATE_COUNT} + DC</div>
                <div className="text-sm text-pink-100">Full Practice Authority states</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="container mx-auto px-4 py-8 md:py-12">
        <div className="max-w-4xl mx-auto">

          {/* Step-by-Step Guide */}
          <div className="space-y-6 mb-12">
            {steps.map((step) => (
              <div key={step.number} className="rounded-xl p-6 md:p-8" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-10 h-10 rounded-full bg-pink-700 text-white flex items-center justify-center font-bold text-lg">
                    {step.number}
                  </div>
                  <div className="flex-1">
                    <h2 className="text-xl font-bold mb-3" style={{ color: 'var(--text-primary)' }}>
                      {step.title}
                    </h2>
                    <p className="mb-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {step.content}
                    </p>
                    {step.details && (
                      <ul className="space-y-2">
                        {step.details.map((detail, idx) => (
                          <li key={idx} className="flex gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                            <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                            <span>{detail}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {step.link && (
                      <Link href={step.link.href} className="inline-block mt-3 text-sm font-medium hover:underline" style={{ color: 'var(--color-primary)' }}>
                        {step.link.text}
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Income Projections */}
          <div className="mb-8 md:mb-12">
            <div className="rounded-xl p-6 md:p-8" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
              <div className="flex items-center gap-3 mb-4">
                <DollarSign className="h-6 w-6" style={{ color: 'var(--color-primary)' }} />
                <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Revenue Model</h2>
              </div>

              {/* Assumptions render ABOVE the table because every number in
                  it is computed from them (P2 #22). */}
              <div className="rounded-lg p-4 mb-5" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>What this model assumes</h3>
                <ul className="text-xs space-y-1" style={{ color: 'var(--text-secondary)' }}>
                  <li><strong>Gross collections = visits per week × {PRACTICE_MODEL.workingWeeksPerYear} working weeks × amount collected per visit.</strong> {PRACTICE_MODEL.workingWeeksPerYear} weeks leaves roughly six for holidays, vacation, and admin days.</li>
                  <li>Collections of <strong>${PRACTICE_MODEL.insuranceCollectedPerVisit} per visit</strong> on an insurance panel and <strong>${PRACTICE_MODEL.cashCollectedPerVisit} per visit</strong> cash-pay — planning inputs, not contracted rates. Replace them with your own payer contracts.</li>
                  <li>Net is collections less overhead. Each net band pairs the <em>lowest</em> volume with the <em>highest</em> overhead and vice versa, so it brackets outcomes rather than stacking best cases.</li>
                  <li>Net is <strong>before</strong> self-employment tax and income tax. A practice owner is a contractor for tax purposes — see the <Link href="/resources/1099-vs-w2" className="font-medium hover:underline" style={{ color: 'var(--color-primary)' }}>1099 vs W2 guide</Link> for what comes off next.</li>
                  <li>This is a model you can re-run with your own inputs, not a survey of what practices earn.</li>
                </ul>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    Modelled gross collections and net income by practice scenario, computed from the stated visit-volume, per-visit collection, and overhead assumptions.
                  </caption>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                      <th scope="col" className="text-left py-3 pr-4 font-semibold" style={{ color: 'var(--text-primary)' }}>Scenario</th>
                      <th scope="col" className="text-right py-3 px-4 font-semibold" style={{ color: 'var(--text-primary)' }}>Visits/week</th>
                      <th scope="col" className="text-right py-3 px-4 font-semibold" style={{ color: 'var(--text-primary)' }}>Gross collections</th>
                      <th scope="col" className="text-right py-3 px-4 font-semibold" style={{ color: 'var(--text-primary)' }}>Overhead</th>
                      <th scope="col" className="text-right py-3 pl-4 font-semibold" style={{ color: 'var(--color-primary)' }}>Net before tax</th>
                    </tr>
                  </thead>
                  <tbody style={{ color: 'var(--text-secondary)' }}>
                    {SCENARIO_ROWS.map((row, idx) => (
                      <tr key={row.label} style={idx < SCENARIO_ROWS.length - 1 ? { borderBottom: '1px solid var(--border-color)' } : undefined}>
                        <th scope="row" className="py-3 pr-4 font-medium text-left" style={{ color: 'var(--text-primary)' }}>{row.label}</th>
                        <td className="py-3 px-4 text-right">{row.visits}</td>
                        <td className="py-3 px-4 text-right">{row.gross}</td>
                        <td className="py-3 px-4 text-right">{row.overhead}</td>
                        <td className="py-3 pl-4 text-right font-semibold" style={{ color: 'var(--color-primary)' }}>{row.net}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs mt-4" style={{ color: 'var(--text-tertiary)' }}>
                For comparison, the national median annual wage for employed {brand.niche.descriptor}s is {STAT_SOURCES.averageSalary.formatted} ({STAT_SOURCES.averageSalary.source}) — with malpractice, health coverage, and payroll taxes largely handled by an employer. Our <Link href="/salary-guide" className="font-medium hover:underline" style={{ color: 'var(--color-primary)' }}>salary guide</Link> computes state-level averages from live postings.
              </p>
            </div>
          </div>

          {/* FAQ Section */}
          <div className="mb-8 md:mb-12">
            <div className="rounded-xl p-6 md:p-8" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
              <h2 className="text-2xl font-bold mb-6" style={{ color: 'var(--text-primary)' }}>Private Practice FAQs</h2>
              {ppFaqs.map((faq, idx) => (
                <div key={idx} className="mb-6 last:mb-0">
                  <h3 className="font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>{faq.question}</h3>
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{faq.answer}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Related Resources — P2 #22: full cross-linking across the
              /resources guide cluster plus the salary guide. */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            <Link href="/resources/fpa-guide" className="block p-4 rounded-lg hover:shadow-sm transition-all" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
              <h3 className="font-semibold" style={{ color: 'var(--color-primary)' }}>Full Practice Authority guide</h3>
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>Whether your state allows an independent practice at all — check before anything else.</p>
            </Link>
            <Link href="/resources/1099-vs-w2" className="block p-4 rounded-lg hover:shadow-sm transition-all" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
              <h3 className="font-semibold" style={{ color: 'var(--color-primary)' }}>1099 vs W2 guide</h3>
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>Self-employment tax, deductions, and retirement capacity — what comes off your net.</p>
            </Link>
            <Link href="/salary-guide" className="block p-4 rounded-lg hover:shadow-sm transition-all" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
              <h3 className="font-semibold" style={{ color: 'var(--color-primary)' }}>{brand.niche.short} salary guide</h3>
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>What employed roles pay in your state — the opportunity cost of going independent.</p>
            </Link>
            <Link href="/jobs/private-practice" className="block p-4 rounded-lg hover:shadow-sm transition-all" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
              <h3 className="font-semibold" style={{ color: 'var(--color-primary)' }}>Private practice jobs</h3>
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>Browse private practice {brand.niche.short} positions.</p>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
