/**
 * Private-practice revenue projector (P3 #6a) — indexable tool route.
 *
 * The arithmetic and every default live in
 * components/tools/practice-revenue-model.ts, which MIRRORS the revenue model
 * published on /resources/private-practice-guide. This route is metadata,
 * schema, visible assumptions, and cross-links only — no number is typed here
 * that the model does not also hold.
 *
 * TRUTH RULES
 *  - "Illustration, not a financial projection" is stated in the hero, at the
 *    top of the widget, and in the assumptions panel. It is not a footnote.
 *  - Every default is traceable to the guide's published figures, or it is zero
 *    and labelled a user-supplied assumption. The widget labels which is which
 *    on the field itself.
 *  - Per-visit figures are COLLECTIONS, not charges — the distinction the guide
 *    makes and the one that breaks these models when it is ignored.
 *  - No vendor pricing, no startup-cost total, no premium figures. The guide
 *    declines to publish those and so does this page.
 *  - FAQPage JSON-LD derives from the same FAQS array the visible accordion
 *    renders.
 */
import { brand } from '@/config/brand';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Building2, HelpCircle } from 'lucide-react';
import Breadcrumbs from '@/components/Breadcrumbs';
import AssumptionsPanel from '@/components/tools/AssumptionsPanel';
import PracticeRevenueProjector from '@/components/tools/PracticeRevenueProjector';
import {
  GUIDE_MODEL,
  GUIDE_SCENARIOS,
  PRACTICE_GUIDE_PATH,
  SENSITIVITY_STEPS,
} from '@/components/tools/practice-revenue-model';
import { TOOL_ACCENT, TOOL_PAGE_CSS, TOOL_HERO_BG, TOOL_PANEL_BG, clayCard } from '@/components/tools/tool-theme';
import { STAT_SOURCES } from '@/lib/stats-sources';

const PAGE_PATH = '/tools/private-practice-revenue-calculator';
const PAGE_URL = `${brand.baseUrl}${PAGE_PATH}`;
const PAGE_TITLE = `Private Practice Revenue Calculator for ${brand.niche.short}s`;
const PAGE_DESCRIPTION = `Model a ${brand.niche.short} private practice line by line: visits per week × collections per visit × working weeks, less overhead and fixed costs — with a sensitivity table showing how far the answer moves when your volume or reimbursement is off. An illustration, not a financial projection.`;
const OG_IMAGE = `${brand.baseUrl}/api/og?title=${encodeURIComponent('Private Practice Revenue Calculator')}&type=page`;

const WIDEST_STEP_PCT = Math.round(Math.max(...SENSITIVITY_STEPS.map(Math.abs)) * 100);

/**
 * Worked example proving the sensitivity steps are RELATIVE moves rather than
 * percentage points. Derived from WIDEST_STEP_PCT so it cannot drift if the step
 * ladder in the model changes.
 */
const EXAMPLE_OVERHEAD_PCT = 20;
const EXAMPLE_OVERHEAD_STEPPED = Math.round(EXAMPLE_OVERHEAD_PCT * (1 + WIDEST_STEP_PCT / 100) * 10) / 10;
const EXAMPLE_OVERHEAD_WRONG = EXAMPLE_OVERHEAD_PCT + WIDEST_STEP_PCT;
const SCENARIO_LABELS = GUIDE_SCENARIOS.map((scenario) => scenario.label.toLowerCase()).join(', ');

export const metadata: Metadata = {
  title: `${PAGE_TITLE} | ${brand.name}`,
  description: PAGE_DESCRIPTION,
  keywords: [
    `${brand.niche.short.toLowerCase()} private practice revenue calculator`,
    `${brand.niche.descriptor} private practice income`,
    'private practice overhead calculator',
    `${brand.niche.short.toLowerCase()} practice collections per visit`,
    'independent practice revenue model',
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
  `The whole model is one line of arithmetic: scheduled visits per week × working weeks × the amount collected per completed visit, less overhead as a share of collections, less any fixed annual costs you add.`,
  `The presets are the ${GUIDE_SCENARIOS.length} scenarios published in our private practice guide (${SCENARIO_LABELS}). Selecting one loads the MIDPOINT of that scenario's volume and overhead bands; the guide's full band is shown next to the result so you can see what the midpoint left out.`,
  `Working weeks default to ${GUIDE_MODEL.workingWeeksPerYear} — 52 less roughly six for holidays, vacation, and admin days, the same figure the guide uses.`,
  `Per-visit amounts are what a practice COLLECTS, not what it bills. The guide's planning inputs are $${GUIDE_MODEL.insuranceCollectedPerVisit} on an insurance panel and $${GUIDE_MODEL.cashCollectedPerVisit} cash-pay, and both are planning inputs rather than contracted rates — replace them with the rates you are actually offered.`,
  `Two inputs are yours alone and start at zero: the no-show and late-cancellation rate, and fixed annual costs such as a lease or a specific software or billing contract. We publish no figure for either, because vendor pricing changes and inventing one would put an expiring number on the page.`,
  `The sensitivity table moves one input at a time by up to ±${WIDEST_STEP_PCT}% and holds the rest, so the "swing" column reads as what that single assumption is worth to your net. Those percentages are relative moves on the value you entered, not percentage points — +${WIDEST_STEP_PCT}% on an overhead share of ${EXAMPLE_OVERHEAD_PCT}% of collections is ${EXAMPLE_OVERHEAD_STEPPED}%, not ${EXAMPLE_OVERHEAD_WRONG}% — and every cell prints the input value it used so there is nothing to infer.`,
  `Net is before self-employment tax and income tax. A practice owner is a contractor for tax purposes, so a substantial further deduction applies to the figure shown.`,
];

const EXCLUSIONS: readonly string[] = [
  'Tax of any kind. Net here is pre-tax; self-employment tax alone takes a large bite, and the 1099 vs W-2 calculator models it properly.',
  'Startup costs. Formation fees, credentialing, equipment, and a website are one-off costs this annual model does not carry — the guide covers them without printing figures that expire.',
  'The ramp. A new practice does not open at full volume: payer credentialing has to complete before you can bill an insurer, and a panel fills gradually after that. We are not putting a number of days on either here — we have no defensible figure for how long your payers take, and it varies by payer and state. Ask each payer for its current processing time, then model your first year at a fraction of the steady-state volume you enter above.',
  'Vendor pricing. No software, billing, or insurance prices are published here or in the guide. Get current quotes.',
  'Any per-category overhead breakdown. Overhead is a single share of collections, because a per-line dollar default would be an invented figure — put your own line items into the fixed-costs field.',
  'What a practice will actually earn. This computes your inputs. It has no knowledge of your payer mix, your market, or your referral base.',
];

const FAQS = [
  {
    q: `How much can an ${brand.niche.short} private practice make?`,
    a: `It is a volume-times-collections calculation, which is exactly why a headline number is the wrong thing to look for. Enter your own visits per week, what you actually collect per visit, and your overhead share, and the tool works it through. Then read the sensitivity table: at typical inputs, being 10% out on either volume or reimbursement moves the answer by tens of thousands of dollars a year, which tells you the honest answer is a range whose width depends on how well you know your own numbers. For comparison, the national median annual wage for employed ${brand.niche.descriptor}s is ${STAT_SOURCES.averageSalary.formatted} (${STAT_SOURCES.averageSalary.source}) — with malpractice, health coverage, and payroll taxes largely handled by an employer.`,
  },
  {
    q: 'Why does this ask for collections instead of what I charge?',
    a: `Because charges are not money. Contracted payer rates, patient responsibility that never arrives, denials, and write-offs all sit between a charge and a deposit, and a model built on charges overstates revenue by whatever that gap is. Track what lands in the account per completed visit and use that. If you are still negotiating contracts, use the rate you have been offered rather than your fee schedule.`,
  },
  {
    q: 'What counts as overhead in this model?',
    a: `Everything that scales with running the practice, expressed as one share of collections: billing, software, supplies, rent if you have it, staff, and the administrative cost of the panel. It is a single percentage rather than a list of line items on purpose — putting default dollar amounts against individual categories would mean publishing vendor prices we cannot stand behind. If you have real quotes for specific fixed costs, put them in the fixed annual costs field instead so they are subtracted as dollars rather than as a percentage.`,
  },
  {
    q: 'Is this a financial projection I can show a lender?',
    a: `No, and it should not be presented as one. It is an illustration of arithmetic that runs on assumptions you supply, and it deliberately excludes tax, startup costs, and the ramp period. A lender or an accountant will want a projection built on your actual contracted rates, a month-by-month ramp, and a full cost schedule. Use this to sanity-check whether the shape of the plan works before paying anyone to build that.`,
  },
  {
    q: 'Should I model insurance or cash-pay?',
    a: `Model both and compare. Insurance panels fill faster and reach more patients at a lower collected amount per visit, with real billing and credentialing overhead attached. Cash-pay collects more per visit with far less paperwork but fills slowly and depends on your local market. Switch the preset between the insurance scenarios and the cash-pay panel and watch what happens to net — then decide which risk you would rather carry.`,
  },
  {
    q: 'Does this include what I pay myself?',
    a: `The net figure IS what is available to you, before tax. It is not a salary line and there is no separate owner-compensation input, so do not subtract your own pay from it as if it were another cost. If you plan to employ someone else in the practice, their cost belongs in overhead or in fixed annual costs.`,
  },
] as const;

const jsonLd = (obj: object): string =>
  JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

export default function PrivatePracticeRevenueCalculatorPage() {
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
            applicationCategory: 'FinanceApplication',
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
            { label: 'Private Practice Revenue' },
          ]} />
          <div style={{ maxWidth: '760px' }}>
            <p style={{ fontSize: '13px', fontWeight: 600, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '10px' }}>
              Free Tool
            </p>
            <h1 className="font-lora" style={{ fontSize: 'clamp(2rem, 4.4vw, 2.9rem)', fontWeight: 800, lineHeight: 1.12, color: '#1A2E35', margin: '0 0 16px' }}>
              Model a practice, then see how wrong it can be
            </h1>
            <p style={{ fontSize: '17px', color: '#5A4A42', lineHeight: 1.65, margin: 0 }}>
              Visits a week, what you collect per visit, weeks you work, overhead as a share of collections — the
              same four inputs our private practice guide builds its table from, except here you set them. Every
              preset loads the guide&rsquo;s published figures, and anything the guide has no figure for starts at
              zero and says so.
            </p>
            <p style={{ fontSize: '13.5px', color: '#7A6A62', margin: '16px 0 0', lineHeight: 1.6 }}>
              <strong>An illustration, not a financial projection.</strong> It computes the assumptions you enter,
              before tax, and the sensitivity table exists to show how much a wrong assumption costs.
            </p>
          </div>
        </section>
      </div>

      <section style={{ background: TOOL_PANEL_BG, padding: '44px 20px 56px' }}>
        <div style={{ maxWidth: '880px', margin: '0 auto' }}>
          <PracticeRevenueProjector />
        </div>
      </section>

      <section style={{ background: '#FFF', padding: '56px 20px' }}>
        <div style={{ maxWidth: '860px', margin: '0 auto' }}>
          <AssumptionsPanel
            title="How this model is built"
            intro="Every default on this page is either a figure our private practice guide already publishes, or a zero you replace yourself. There is no third kind."
            assumptions={ASSUMPTIONS}
            exclusions={EXCLUSIONS}
            sources={[
              { label: `${brand.name} private practice guide — the model these defaults come from`, url: PRACTICE_GUIDE_PATH },
              { label: '1099 vs W-2 calculator — the tax this figure is before', url: '/tools/1099-vs-w2-calculator' },
              { label: STAT_SOURCES.averageSalary.source, url: STAT_SOURCES.averageSalary.sourceUrl },
            ]}
          />
        </div>
      </section>

      <section style={{ background: TOOL_HERO_BG, padding: '64px 20px' }}>
        <div style={{ maxWidth: '760px', margin: '0 auto' }}>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 32px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '28px' }}>
            Questions about practice economics
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
            Before you commit
          </h2>
          <div className="tool-three-col" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
            {[
              { href: PRACTICE_GUIDE_PATH, title: 'Private practice guide', blurb: 'Entity formation, credentialing, EHR, malpractice, and the model this tool runs.' },
              { href: '/resources/fpa-guide', title: 'Practice authority guide', blurb: 'Whether an independent practice is available to you at all.' },
              { href: '/tools/licensure-checker', title: 'Licensure checker', blurb: 'Your state\u2019s authority classification and licensure steps.' },
              { href: '/tools/1099-vs-w2-calculator', title: '1099 vs W-2 calculator', blurb: 'The tax this net figure sits before, modelled properly.' },
              { href: '/salary-guide', title: `${brand.niche.short} salary guide`, blurb: 'What employed roles pay — the opportunity cost of going independent.' },
              { href: '/jobs/private-practice', title: 'Private practice roles', blurb: 'Work inside an existing practice before you start one.' },
            ].map((l) => (
              <Link key={l.href} href={l.href} className="tool-card" style={{ ...clayCard, padding: '20px 20px 18px', textDecoration: 'none', display: 'block' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <Building2 size={15} color={TOOL_ACCENT} aria-hidden="true" />
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
