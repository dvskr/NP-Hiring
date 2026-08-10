import { brand } from '@/config/brand';
import { Metadata } from 'next';
import Link from 'next/link';
import { Shield, MapPin, CheckCircle, AlertTriangle, XCircle } from 'lucide-react';
import BreadcrumbSchema from '@/components/BreadcrumbSchema';
import { STATE_PRACTICE_AUTHORITY, getStatesByAuthority, getAuthorityColor } from '@/lib/state-practice-authority';
import { STAT_SOURCES } from '@/lib/stats-sources';
// P6 #10: this guide carried Article JSON-LD + a review stamp but no
// E-E-A-T byline. Visible byline and schema both derive from
// brand.editorial.reviewer (config/brand.ts) so they can never disagree —
// same wiring as app/blog/[slug]/page.tsx.
import EditorialByline, { editorialSchemaFields } from '@/components/EditorialByline';

// Bump on each editorial review pass — Article.dateModified should reflect
// real freshness, not be permanently frozen at the original publish date.
// Update at least quarterly; sooner if NLC membership or state authority
// classifications change.
const PUBLISHED_AT = '2026-03-19';
const LAST_REVIEWED = '2026-07-29';

/* ─────────────────────────────────────────────────────────────────────────
 * P2 #22 — UNSOURCED CLAIMS REMOVED FROM THIS PAGE
 * ─────────────────────────────────────────────────────────────────────────
 * Four claims were asserted as fact with nothing behind them:
 *   1. A double-digit percentage salary premium for full-practice states —
 *      rendered as a hero stat card, an FAQ answer, AND the meta
 *      description. No survey, dataset, or citation anywhere in the repo
 *      supports it.
 *   2. A multiple claiming full-practice states have several times more
 *      private practice owners — same problem.
 *   3. A claim that full-practice states have more openings per capita —
 *      same problem.
 *   4. An NLC member count that contradicted the repo's own compact
 *      dataset, which yields 38 member states.
 * Claims 1-3 are gone; the salary section now explains the MECHANISMS
 * practice authority actually controls (all readable off
 * lib/state-practice-authority.ts) and links to live per-state pay data
 * rather than inventing a premium.
 *
 * CLAIM 4 — SECOND PASS. The first fix replaced the typed "41 states" with
 * a count DERIVED from LICENSE_GUIDE_NLC_NON_MEMBERS (which yields 38).
 * That made the claim self-consistent with the licensure series without
 * making it TRUE, and a derived number reads more authoritative than a
 * typed one. Checked against the NLC's own site and the public roster on
 * 2026-07-29: NCSBN publishes 43 member JURISDICTIONS (41 states plus
 * territories), and the repo's non-member set is wrong in five places — it
 * omits Alaska (a genuine non-member with only pending legislation) and
 * lists Connecticut, Massachusetts, Rhode Island, and Washington as
 * non-members when all four have joined.
 *
 * That set is a mirror of the canonical one in lib/pseo/state-narrative.ts
 * and drives 51 licensure guides, the state hubs, and the licensure
 * checker, so correcting it is a separate change with its own blast radius
 * — not something to smuggle in behind an FPA-guide edit. Until then this
 * page publishes NO membership count and no membership list: it explains
 * what the compact does and sends the reader to the live NCSBN map, the
 * same rule /resources/1099-vs-w2 applies to annually indexed IRS figures.
 */

/**
 * JSON-LD serializer matching the repo convention (see app/companies/page.tsx
 * and app/for-employers/resources/how-to-hire/page.tsx): angle brackets are
 * escaped so no serialized value can terminate the surrounding script element.
 */
const ldJson = (obj: unknown): string =>
  JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

/** Live NLC roster — the only place this page will point for membership. */
const NLC_MAP_URL = 'https://www.nursecompact.com/';

// P0 OG sweep: edge-generated card via /api/og — the previous Supabase
// page-screenshot 400'd on every share (pattern: app/for-employers/page.tsx).
// Absolute URL because it also feeds Article JSON-LD `image`.
const HERO_IMAGE = `${brand.baseUrl}/api/og?title=${encodeURIComponent(`${brand.niche.short} Full Practice Authority Guide`)}&type=page`;

export const metadata: Metadata = {
  title: `${brand.niche.short} Full Practice Authority Guide 2026 — All 50 States`,
  description: `Complete state-by-state Full Practice Authority (FPA) guide for ${brand.niche.descriptor}s. See which states allow independent ${brand.niche.short} practice, prescriptive authority rules, Nurse Licensure Compact membership, and what practice authority changes about how you can work and get paid.`,
  keywords: [`${brand.niche.short} full practice authority`, 'nurse practitioner independent practice states', 'FPA states 2026', `${brand.niche.short} prescriptive authority by state`, `${brand.niche.short} scope of practice`, 'NLC compact states for NP'],
  openGraph: {
    title: `Full Practice Authority Guide for ${brand.niche.short}s — 2026`,
    description: `State-by-state FPA classifications. See where ${brand.niche.descriptor}s can practice independently.`,
    type: 'article',
    images: [{ url: HERO_IMAGE, width: 1200, height: 630, alt: `${brand.niche.short} Full Practice Authority Guide 2026` }],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${brand.niche.short} Full Practice Authority Guide 2026`,
    images: [HERO_IMAGE],
  },
  alternates: { canonical: `${brand.baseUrl}/resources/fpa-guide` },
};

export default function FPAGuidePage() {
  const fullStates = getStatesByAuthority('full');
  const reducedStates = getStatesByAuthority('reduced');
  const restrictedStates = getStatesByAuthority('restricted');

  const allStates = Object.entries(STATE_PRACTICE_AUTHORITY).sort(([a], [b]) => a.localeCompare(b));

  // D.C. is a jurisdiction in the dataset, not a state, so `fullStates` already
  // counts it. Both places below render "<n> states + DC", which double-counted
  // it. Subtract it so the figure reads 27 states + DC — matching
  // STAT_SOURCES.fullPracticeStates (AANP), the same number /jobs, /faq,
  // /salary-guide and /for-employers cite.
  const fullStateCount = fullStates.filter((s) => s !== 'District of Columbia').length;

  const fpaFaqs = [
    {
      question: `What is Full Practice Authority for ${brand.niche.short}s?`,
      answer: `Full Practice Authority (FPA) means an ${brand.niche.short} can evaluate patients, diagnose conditions, order and interpret tests, prescribe medications (including controlled substances), and manage treatment plans without physician oversight or a collaborative agreement. FPA states grant ${brand.niche.short}s the same level of autonomy as physicians in their scope of practice.`
    },
    {
      question: "How many states have Full Practice Authority for nurse practitioners?",
      answer: `${fullStateCount} states plus Washington D.C. grant Full Practice Authority to ${brand.niche.short}s (${STAT_SOURCES.fullPracticeStates.source}, ${STAT_SOURCES.fullPracticeStates.asOf}). ${reducedStates.length} states have Reduced Practice, requiring a collaborative agreement with a physician, and ${restrictedStates.length} states have Restricted Practice, requiring physician supervision. Classifications change as state legislatures act, so confirm against the AANP State Practice Environment map before relying on one.`
    },
    {
      question: `Does Full Practice Authority affect ${brand.niche.short} pay?`,
      answer: `It changes what you are able to do, which in turn shapes what you can be paid for — but this board does not publish a national premium figure, because no verifiable one exists in our data. What practice authority concretely controls: whether you can open and bill under your own practice without a physician agreement, whether you can take independent contract or telehealth work in that state without arranging supervision, and whether a collaborating physician's fee comes out of your revenue. Pay itself varies far more by setting, specialty, experience, and local market than by classification alone. For real numbers, use the state pages in our salary guide, which compute averages from live postings in that state.`
    },
    {
      question: `Can ${brand.niche.short}s prescribe controlled substances in all states?`,
      answer: `${brand.niche.short}s can prescribe controlled substances in all 50 states, but the requirements differ. In FPA states, prescribing is independent. In reduced practice states, a collaborative agreement is needed. In restricted states, a supervisory protocol with a physician is required. All ${brand.niche.short}s need DEA registration.`
    },
    {
      question: `What is the Nurse Licensure Compact (NLC) and how does it help ${brand.niche.short}s?`,
      answer: `The NLC lets a registered nurse hold one multistate RN license that is recognized across member states. It covers the RN license underpinning your credential, not the APRN license itself — ${brand.niche.short}s still apply for APRN licensure state by state — but it removes the RN endorsement step, which is often the slowest part of adding a state. Most states have joined and Washington D.C. has not, but membership moves as legislatures act and several jurisdictions sit between enactment and implementation, so we do not publish a count here: check the current roster on the NCSBN compact map at ${NLC_MAP_URL} for each state you plan to cover, and plan extra lead time wherever the compact does not reach.`
    },
  ];

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <BreadcrumbSchema items={[
        { name: "Home", url: brand.baseUrl },
        { name: "Resources", url: `${brand.baseUrl}/resources` },
        { name: "Full Practice Authority Guide", url: `${brand.baseUrl}/resources/fpa-guide` }
      ]} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: ldJson({
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: fpaFaqs.map((faq) => ({
              '@type': 'Question',
              name: faq.question,
              acceptedAnswer: { '@type': 'Answer', text: faq.answer },
            })),
          }),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: ldJson({
            '@context': 'https://schema.org',
            '@type': 'Article',
            headline: `${brand.niche.short} Full Practice Authority Guide 2026 — All 50 States`,
            description: `Complete state-by-state guide to Full Practice Authority for ${brand.niche.descriptor}s.`,
            datePublished: PUBLISHED_AT,
            dateModified: LAST_REVIEWED,
            image: HERO_IMAGE,
            author: { '@type': 'Organization', name: brand.name },
            publisher: { '@type': 'Organization', name: brand.name, url: brand.baseUrl },
            // {} while brand.editorial.reviewer is null; the real reviewer's
            // Person record when configured. Never a fabricated name.
            ...editorialSchemaFields(),
          }),
        }}
      />

      {/* Hero Section */}
      <section className="bg-gradient-to-r from-pink-700 to-pink-800 text-white py-12 md:py-16">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-white/10 mb-6">
              <Shield className="w-8 h-8" />
            </div>
            <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4">
              {brand.niche.short} Full Practice Authority Guide 2026
            </h1>
            <p className="text-sm text-pink-200 text-center mt-2 mb-4">
              {/* Audit P0 #23: render the real review date (same constant the
                  Article schema emits) — never render time, which fabricated
                  freshness and contradicted dateModified. */}
              Last Updated: {new Date(`${LAST_REVIEWED}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}
            </p>
            <p className="text-lg md:text-xl text-pink-100 mb-6">
              State-by-state practice authority classifications for {brand.niche.descriptor}s
            </p>
            <div className="flex flex-wrap justify-center gap-6 md:gap-8 mt-8">
              {/* fullStates includes D.C. as a jurisdiction; the hero used
                  its raw length (28) while the section below read "27 states
                  + DC". Both now render fullStateCount so the page cannot
                  contradict itself or STAT_SOURCES.fullPracticeStates. */}
              <div className="text-center">
                <div className="text-3xl font-bold">{fullStateCount}</div>
                <div className="text-sm text-pink-100">Full Practice states (+ DC)</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold">{reducedStates.length}</div>
                <div className="text-sm text-pink-100">Reduced Practice</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold">{restrictedStates.length}</div>
                <div className="text-sm text-pink-100">Restricted Practice</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="container mx-auto px-4 py-8 md:py-12">
        <div className="max-w-5xl mx-auto">

          {/* P6 #10: visible review-status byline — renders the honest
              editorial-team state while brand.editorial.reviewer is null,
              the named credentialed reviewer once contracted. */}
          <div className="mb-8">
            <EditorialByline variant="hero" />
          </div>

          {/* What is FPA */}
          <div className="mb-8 md:mb-12">
            <div className="rounded-xl p-6 md:p-8" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
              <h2 className="text-2xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
                What is Full Practice Authority (FPA)?
              </h2>
              <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
                Full Practice Authority allows {brand.niche.short}s ({brand.niche.descriptor}s) to evaluate patients, diagnose conditions, order and interpret diagnostic tests, prescribe medications (including controlled substances), and manage treatment plans <strong>without physician oversight</strong> or a collaborative agreement.
              </p>
              <div className="grid md:grid-cols-3 gap-4 mt-6">
                <div className="p-4 rounded-lg bg-green-50 border border-green-200">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle className="h-5 w-5 text-green-600" />
                    <h3 className="font-semibold text-green-800">Full Practice Authority</h3>
                  </div>
                  <p className="text-sm text-green-700">Independent practice. No physician oversight. Full prescriptive authority including Schedule II-V.</p>
                  <p className="text-xs text-green-600 mt-2 font-semibold">{fullStateCount} states + DC</p>
                </div>
                <div className="p-4 rounded-lg bg-yellow-50 border border-yellow-200">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="h-5 w-5 text-yellow-600" />
                    <h3 className="font-semibold text-yellow-800">Reduced Practice</h3>
                  </div>
                  <p className="text-sm text-yellow-700">Requires a collaborative agreement with a physician. Physician does not need to be on-site.</p>
                  <p className="text-xs text-yellow-600 mt-2 font-semibold">{reducedStates.length} states</p>
                </div>
                <div className="p-4 rounded-lg bg-orange-50 border border-orange-200">
                  <div className="flex items-center gap-2 mb-2">
                    <XCircle className="h-5 w-5 text-orange-600" />
                    <h3 className="font-semibold text-orange-800">Restricted Practice</h3>
                  </div>
                  <p className="text-sm text-orange-700">Requires physician supervision. Must practice under a supervisory protocol or agreement.</p>
                  <p className="text-xs text-orange-600 mt-2 font-semibold">{restrictedStates.length} states</p>
                </div>
              </div>
            </div>
          </div>

          {/* State-by-State Table */}
          <div className="mb-8 md:mb-12">
            <div className="rounded-xl p-6 md:p-8" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
              <h2 className="text-2xl font-bold mb-6" style={{ color: 'var(--text-primary)' }}>
                All 50 States + DC: Practice Authority Classification
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                      <th className="text-left py-3 pr-4 font-semibold" style={{ color: 'var(--text-primary)' }}>State</th>
                      <th className="text-left py-3 px-4 font-semibold" style={{ color: 'var(--text-primary)' }}>Practice Authority</th>
                      <th className="text-left py-3 pl-4 font-semibold hidden md:table-cell" style={{ color: 'var(--text-primary)' }}>Details</th>
                      <th className="text-right py-3 pl-4 font-semibold" style={{ color: 'var(--text-primary)' }}>Jobs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allStates.map(([stateName, info]) => {
                      const colors = getAuthorityColor(info.authority);
                      const stateSlug = stateName.toLowerCase().replace(/\s+/g, '-');
                      return (
                        <tr key={stateName} style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td className="py-3 pr-4">
                            <Link href={`/jobs/state/${stateSlug}`} className="font-medium hover:underline" style={{ color: 'var(--color-primary)' }}>
                              {stateName}
                            </Link>
                          </td>
                          <td className="py-3 px-4">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors.bg} ${colors.text} ${colors.border} border`}>
                              {info.description}
                            </span>
                          </td>
                          <td className="py-3 pl-4 hidden md:table-cell text-xs" style={{ color: 'var(--text-secondary)' }}>
                            {info.details}
                          </td>
                          <td className="py-3 pl-4 text-right">
                            <Link href={`/jobs/state/${stateSlug}`} className="text-xs font-medium hover:underline" style={{ color: 'var(--color-primary)' }}>
                              View →
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Salary Impact */}
          <div className="mb-8 md:mb-12">
            <div className="rounded-xl p-6 md:p-8" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
              <h2 className="text-2xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
                What Practice Authority Changes About Your Earning Options
              </h2>
              <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
                Practice authority is a legal classification, not a pay scale. It does not set your salary — it sets which ways of earning are open to you in that state. The national median annual wage for {brand.niche.descriptor}s is {STAT_SOURCES.averageSalary.formatted} ({STAT_SOURCES.averageSalary.source}); what changes state to state is the structure around that number:
              </p>
              <ul className="space-y-3 text-sm mb-5" style={{ color: 'var(--text-secondary)' }}>
                <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" aria-hidden="true" /><span><strong>Whether you can own the practice.</strong> In a full-practice state you can open and bill under your own practice without a physician agreement. In reduced and restricted states you need a collaborating or supervising physician in place first, which is a real barrier to independent ownership.</span></li>
                <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" aria-hidden="true" /><span><strong>Whether a collaboration fee comes out of your revenue.</strong> Where an agreement is required, the collaborating physician is typically compensated for it — an ongoing cost against your income that a full-practice colleague does not carry. Fees are negotiated privately and vary widely, so treat any quoted figure with suspicion.</span></li>
                <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" aria-hidden="true" /><span><strong>How easily you can take contract and telehealth work.</strong> Independent 1099 and telehealth arrangements are simplest where no supervisory relationship has to be arranged and maintained in each state you cover.</span></li>
                <li className="flex gap-2"><AlertTriangle className="h-4 w-4 text-yellow-500 flex-shrink-0 mt-0.5" aria-hidden="true" /><span><strong>Transition-to-practice periods still apply in several full-practice states.</strong> Check the Details column in the table above before assuming day-one autonomy.</span></li>
              </ul>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                For actual pay rather than classification, the <Link href="/salary-guide" className="font-medium hover:underline" style={{ color: 'var(--color-primary)' }}>{brand.niche.short} salary guide</Link> computes state-level averages from live postings. If independent practice is the goal, the <Link href="/resources/private-practice-guide" className="font-medium hover:underline" style={{ color: 'var(--color-primary)' }}>private practice startup guide</Link> covers entity formation, credentialing, and a revenue model, and the <Link href="/resources/1099-vs-w2" className="font-medium hover:underline" style={{ color: 'var(--color-primary)' }}>1099 vs W2 guide</Link> shows what a contract has to pay to beat a salaried package.
              </p>
            </div>
          </div>

          {/* Telehealth & Cross-State Practice */}
          <div className="mb-8 md:mb-12">
            <div className="rounded-xl p-6 md:p-8" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
              <div className="flex items-center gap-3 mb-4">
                <MapPin className="h-6 w-6" style={{ color: 'var(--color-primary)' }} />
                <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                  Cross-State Telehealth &amp; Prescriptive Authority
                </h2>
              </div>
              <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
                For remote and telehealth {brand.niche.short}s, practice authority in the <strong>patient&apos;s state</strong> determines your scope — not your home state. Key considerations:
              </p>
              <ul className="space-y-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
                <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" /><span>You must hold an APRN license in each state where your patients are located</span></li>
                <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" /><span>DEA registration is required in each state where you prescribe controlled substances</span></li>
                <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" /><span>Some telehealth companies handle multi-state licensing and credentialing for you</span></li>
                <li className="flex gap-2"><AlertTriangle className="h-4 w-4 text-yellow-500 flex-shrink-0 mt-0.5" /><span>Restricted practice states may require a collaborative physician in that specific state</span></li>
                <li className="flex gap-2"><AlertTriangle className="h-4 w-4 text-yellow-500 flex-shrink-0 mt-0.5" /><span>Pandemic-era telehealth waivers have mostly expired — verify current requirements</span></li>
                <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" /><span>The Nurse Licensure Compact can remove the RN endorsement step in member states, but not the APRN application. Membership and implementation dates change, so confirm each state against the <a href={NLC_MAP_URL} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline" style={{ color: 'var(--color-primary)' }}>NCSBN compact map</a> rather than a count published on a jobs board</span></li>
              </ul>
              <p className="text-sm mt-4" style={{ color: 'var(--text-secondary)' }}>
                Browse <Link href="/jobs/remote" className="font-medium hover:underline" style={{ color: 'var(--color-primary)' }}>remote {brand.niche.short} jobs</Link> or <Link href="/jobs/telehealth" className="font-medium hover:underline" style={{ color: 'var(--color-primary)' }}>telehealth positions</Link> that handle multi-state licensing.
              </p>
            </div>
          </div>

          {/* FAQ Section */}
          <div className="mb-8 md:mb-12">
            <div className="rounded-xl p-6 md:p-8" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
              <h2 className="text-2xl font-bold mb-6" style={{ color: 'var(--text-primary)' }}>Frequently Asked Questions</h2>
              {fpaFaqs.map((faq, idx) => (
                <div key={idx} className="mb-6 last:mb-0">
                  <h3 className="font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>{faq.question}</h3>
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{faq.answer}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Related Resources — P2 #22: the /resources guide cluster now
              cross-links in all directions from every member page. */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <Link href="/resources/1099-vs-w2" className="block p-4 rounded-lg hover:shadow-sm transition-all" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
              <h3 className="font-semibold" style={{ color: 'var(--color-primary)' }}>1099 vs W2 guide</h3>
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>How self-employment tax works and what a contract must pay to match a salary.</p>
            </Link>
            <Link href="/resources/private-practice-guide" className="block p-4 rounded-lg hover:shadow-sm transition-all" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
              <h3 className="font-semibold" style={{ color: 'var(--color-primary)' }}>Private practice startup guide</h3>
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>Entity formation, credentialing, EHR, and a transparent revenue model.</p>
            </Link>
            <Link href="/salary-guide" className="block p-4 rounded-lg hover:shadow-sm transition-all" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
              <h3 className="font-semibold" style={{ color: 'var(--color-primary)' }}>{brand.niche.short} salary guide</h3>
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>State-by-state pay computed from live postings.</p>
            </Link>
          </div>

          {/* CTA */}
          <div className="text-center py-8">
            <h2 className="text-2xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
              Find {brand.niche.short} Jobs in Your State
            </h2>
            <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>
              Browse thousands of {brand.niche.descriptor} positions updated daily.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/jobs" className="inline-block bg-pink-700 text-white px-8 py-3 rounded-lg font-medium hover:bg-pink-800 transition-colors">Browse All Jobs</Link>
              <Link href="/salary-guide" className="inline-block bg-white px-8 py-3 rounded-lg font-medium border border-pink-200 hover:bg-pink-50 transition-colors" style={{ color: 'var(--color-primary)' }}>View Salary Guide</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
