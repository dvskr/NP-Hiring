/**
 * 1099 vs W-2 take-home calculator (P2 #4) — indexable tool route.
 *
 * The math and every tax constant live in components/tools/take-home-model.ts
 * and components/tools/federal-tax-model.ts. This route is metadata, schema,
 * visible assumptions, and cross-links only — no numbers are typed here that
 * the calculator does not also use.
 *
 * TRUTH RULES
 *  - The tax-year label, sources, and exclusions rendered in the assumptions
 *    panel come from the same module the arithmetic reads, so the page cannot
 *    advertise a tax year the model does not implement.
 *  - FAQPage JSON-LD derives from the same FAQS array the visible accordion
 *    renders (repo pattern: app/for-employers/resources/how-to-hire).
 *  - Salary bands quoted in copy derive from config/niche/salary.ts.
 */
import { brand } from '@/config/brand';
import { salaryConfig } from '@/config/niche/salary';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Calculator, HelpCircle } from 'lucide-react';
import Breadcrumbs from '@/components/Breadcrumbs';
import AssumptionsPanel from '@/components/tools/AssumptionsPanel';
import TakeHomeCalculator from '@/components/tools/TakeHomeCalculator';
import {
  TAX_MODEL_EXCLUSIONS,
  TAX_MODEL_REVIEWED,
  TAX_MODEL_SOURCES,
  TAX_MODEL_YEAR,
} from '@/components/tools/federal-tax-model';
import { TOOL_ACCENT, TOOL_PAGE_CSS, TOOL_HERO_BG, TOOL_PANEL_BG, clayCard } from '@/components/tools/tool-theme';

const PAGE_PATH = '/tools/1099-vs-w2-calculator';
const PAGE_URL = `${brand.baseUrl}${PAGE_PATH}`;
const PAGE_TITLE = `1099 vs W2 Take-Home Calculator for ${brand.niche.short}s`;
const PAGE_DESCRIPTION = `Free take-home calculator comparing a 1099 contract rate to a W-2 ${brand.niche.short} salary: self-employment tax, federal bracket, business expenses, and the employer-paid benefits a contractor has to self-fund. Tax year ${TAX_MODEL_YEAR}, federal only.`;
const OG_IMAGE = `${brand.baseUrl}/api/og?title=${encodeURIComponent(`1099 vs W2 Take-Home Calculator`)}&type=page`;

const TYPICAL_BAND = `$${Math.round(salaryConfig.normalizer.typical.min / 1000)}K–$${Math.round(salaryConfig.normalizer.typical.max / 1000)}K`;

export const metadata: Metadata = {
  title: `${PAGE_TITLE} | ${brand.name}`,
  description: PAGE_DESCRIPTION,
  keywords: [
    `1099 vs w2 calculator ${brand.niche.short.toLowerCase()}`,
    `${brand.niche.descriptor} take home pay calculator`,
    `1099 ${brand.niche.short.toLowerCase()} self employment tax`,
    `locum tenens ${brand.niche.short.toLowerCase()} pay calculator`,
    `contract ${brand.niche.descriptor} hourly rate`,
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
  `Federal tax only, tax year ${TAX_MODEL_YEAR}: the ordinary-income brackets and standard deduction for your filing status, plus statutory payroll tax (Social Security to the annual wage base, uncapped Medicare, and the Additional Medicare Tax above $200,000 single / $250,000 joint).`,
  'Both columns work the same number of hours. Days off are paid on the W-2 side and unpaid on the 1099 side, where they reduce billable hours.',
  'Self-employment tax is computed on 92.35% of net profit, and one half of it (the Social Security and Medicare portions, not the Additional Medicare Tax) is deducted above the line.',
  'The health premium you buy as a contractor is deducted above the line, capped at your earned income from the business.',
  'Both columns report "cash after tax" on one definition — what is left of gross after taxes, business expenses, and insurance premiums, and before any retirement money is set aside — so the two are read against each other on the same basis.',
  'Net position adds to that cash only the retirement dollars an employer contributes: the match on the W-2 side. A contractor funding a SEP-IRA or solo 401(k) is moving cash already counted, not gaining extra, so it is shown as a call on that cash rather than added again.',
  'The standard deduction is applied to a single stream of earned income; the model assumes you do not itemize.',
  'Every input starts on a placeholder, not a benchmark. The two pay placeholders derive from this board’s typical W-2 band of ' + TYPICAL_BAND + ' (config/niche/salary.ts) — replace them with your actual offers.',
];

const FAQS = [
  {
    q: `How much more should a 1099 rate be than a W-2 ${brand.niche.short} salary?`,
    a: `There is no single multiplier — it depends on what the W-2 offer actually includes. The calculator answers it directly with a break-even hourly rate: enter the W-2 salary, employer retirement match, premium share, and days off, and it solves for the contract rate at which the two net positions are equal. Anything above that rate leaves you ahead; anything below it does not, no matter how much larger the gross looks.`,
  },
  {
    q: 'What is self-employment tax and why does it hit 1099 income?',
    a: `A W-2 employee and their employer each pay half of Social Security and Medicare. A contractor is both halves, so the combined rate applies to their own net earnings: 12.4% Social Security up to the annual wage base plus 2.9% Medicare with no cap, computed on 92.35% of net profit, with an extra 0.9% Medicare surtax on earnings above $200,000 (single) or $250,000 (married filing jointly). One half of the Social Security and Medicare portions is deductible above the line, which the calculator applies.`,
  },
  {
    q: 'Does this calculator include state income tax?',
    a: `No. It is federal only. State and local income tax rates, brackets, and local add-ons vary by jurisdiction, and publishing a state rate table we cannot keep current would be worse than omitting it. Both columns are therefore overstated by whatever your state charges — and because state tax applies to both, it narrows the gap but rarely reverses it.`,
  },
  {
    q: 'What benefits does a 1099 contractor have to replace?',
    a: `The ones the calculator makes you price: health insurance (the employer share disappears entirely), retirement contributions including any employer match, and paid time off — a contractor who takes the same days off simply bills fewer hours. Malpractice coverage, licensure, CME, and equipment usually move to you as well, which is what the deductible business expenses field is for.`,
  },
  {
    q: `Should a new-grad ${brand.niche.short} take a 1099 role?`,
    a: `That is a career question rather than a math question, and the calculator does not answer it. A 1099 arrangement moves tax filing, insurance, retirement, and business administration onto you, and typically comes without structured onboarding or mentorship. Run the numbers here, then read the full 1099 vs W2 guide for the non-financial trade-offs before deciding.`,
  },
  {
    q: 'Is this tax advice?',
    a: `No. It is a planning estimate built from published federal rates for tax year ${TAX_MODEL_YEAR}, and it deliberately excludes the qualified business income deduction, itemized deductions, credits, dependents, other income, entity choice, and state tax. Take the output to a CPA before you sign anything or set aside estimated payments.`,
  },
] as const;

/**
 * The five steps of the comparison method.
 *
 * VISIBILITY CONTRACT: this array is rendered as a visible "How to use this"
 * section below AND serialized into HowTo JSON-LD. Google's structured-data
 * general guidelines forbid marking up content a reader cannot see, so the
 * schema block may never outlive the section that renders it — the repo's
 * HowTo precedent (app/resources/private-practice-guide) renders its steps for
 * the same reason. tests/regressions/p2-tools-calculators-routes.test.ts
 * strips the JSON-LD scripts and asserts the JSX still maps this array.
 */
const HOW_TO_STEPS = [
  { name: 'Enter the W-2 offer in full', text: 'Base salary, the employer retirement match as a percent of salary, your annual share of the health premium, and how many paid days off the role includes. The match and the premium are where most of the hidden value of a W-2 offer sits.' },
  { name: 'Enter the contract offer', text: 'Hourly rate, the deductible business expenses you will carry (malpractice, licensure, CME, equipment, home office), the health insurance premium you will buy yourself, and the retirement contribution you intend to fund.' },
  { name: 'Set hours and time off once', text: 'Both columns use the same hours per week and the same days off. On the W-2 side that time is paid; on the 1099 side it reduces billable hours, which is the honest way to price time off.' },
  { name: 'Read the net position, not the gross', text: 'Compare the two net-position figures: cash after federal tax and insurance, measured the same way on both sides, plus the retirement dollars an employer adds. A larger 1099 gross regularly loses this comparison once self-employment tax and self-funded benefits are priced in.' },
  { name: 'Negotiate against the break-even rate', text: 'The calculator solves for the contract hourly rate that matches the W-2 offer exactly. That number, not a rule of thumb, is your floor in a rate conversation.' },
] as const;

const jsonLd = (obj: object): string =>
  JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

export default function TakeHomeCalculatorPage() {
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
            '@type': 'HowTo',
            name: `How to compare a 1099 contract offer to a W-2 ${brand.niche.short} salary`,
            description: `A five-step method for pricing a contract rate against a salaried offer, including the employer-paid benefits a contractor has to self-fund.`,
            step: HOW_TO_STEPS.map((s, i) => ({
              '@type': 'HowToStep',
              position: i + 1,
              name: s.name,
              text: s.text,
            })),
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

      {/* ─── Hero ─── */}
      <div style={{ background: TOOL_HERO_BG }}>
        <section style={{ maxWidth: '1180px', margin: '0 auto', padding: '32px 20px 56px' }}>
          <Breadcrumbs items={[
            { label: 'Home', href: '/' },
            { label: 'Tools', href: '/tools' },
            { label: '1099 vs W2 Calculator' },
          ]} />

          <div style={{ maxWidth: '760px' }}>
            <p style={{ fontSize: '13px', fontWeight: 600, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '10px' }}>
              Free Tool · Tax Year {TAX_MODEL_YEAR}
            </p>
            <h1 className="font-lora" style={{ fontSize: 'clamp(2rem, 4.4vw, 2.9rem)', fontWeight: 800, lineHeight: 1.12, color: '#1A2E35', margin: '0 0 16px' }}>
              1099 vs W-2 take-home calculator
            </h1>
            <p style={{ fontSize: '17px', color: '#5A4A42', lineHeight: 1.65, margin: 0 }}>
              A bigger hourly rate is not a bigger paycheck. Price a contract offer against a salaried one
              with self-employment tax, your federal bracket, deductible business expenses, and the
              employer-paid benefits you would have to replace — then read the contract rate that actually
              breaks even.
            </p>
          </div>
        </section>
      </div>

      {/* ─── Calculator ─── */}
      <section style={{ background: TOOL_PANEL_BG, padding: '48px 20px 56px' }}>
        <div style={{ maxWidth: '1180px', margin: '0 auto' }}>
          <TakeHomeCalculator />
        </div>
      </section>

      {/* ─── How to use it (the visible source of the HowTo schema above) ─── */}
      <section style={{ background: '#FFF', padding: '56px 20px 8px' }}>
        <div style={{ maxWidth: '860px', margin: '0 auto' }}>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 30px)', fontWeight: 700, color: '#1A2E35', margin: '0 0 10px' }}>
            How to compare the two offers
          </h2>
          <p style={{ fontSize: '15px', color: '#5A4A42', lineHeight: 1.65, margin: '0 0 24px' }}>
            Five steps. The order matters: the break-even rate is only meaningful once both
            columns describe the same working year.
          </p>
          <ol style={{ listStyle: 'none', counterReset: 'step', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {HOW_TO_STEPS.map((step, i) => (
              <li key={step.name} style={{ ...clayCard, padding: '18px 20px', display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
                <span
                  style={{
                    width: '30px', height: '30px', borderRadius: '10px', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'linear-gradient(145deg, #BE185D, #9D174D)',
                    color: '#FFF', fontSize: '14px', fontWeight: 800,
                  }}
                  aria-hidden="true"
                >
                  {i + 1}
                </span>
                <div>
                  <h3 style={{ fontSize: '15px', fontWeight: 800, color: '#1A2E35', margin: '0 0 5px' }}>{step.name}</h3>
                  <p style={{ fontSize: '14px', color: '#5A4A42', lineHeight: 1.68, margin: 0 }}>{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ─── Assumptions ─── */}
      <section style={{ background: '#FFF', padding: '56px 20px' }}>
        <div style={{ maxWidth: '860px', margin: '0 auto' }}>
          <AssumptionsPanel
            title="How this estimate is built"
            intro={`This is a planning estimate, not a tax return. Everything the model does — and everything it deliberately leaves out — is listed here, because a take-home number without its assumptions is not a useful number.`}
            assumptions={ASSUMPTIONS}
            exclusions={TAX_MODEL_EXCLUSIONS}
            sources={TAX_MODEL_SOURCES}
            reviewedOn={TAX_MODEL_REVIEWED}
          />
        </div>
      </section>

      {/* ─── FAQ ─── */}
      <section style={{ background: TOOL_HERO_BG, padding: '64px 20px' }}>
        <div style={{ maxWidth: '760px', margin: '0 auto' }}>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 32px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '28px' }}>
            Questions about contract pay
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

      {/* ─── Cross-links ─── */}
      <section style={{ background: '#FFF', padding: '56px 20px 72px' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
          <h2 className="font-lora" style={{ fontSize: '22px', fontWeight: 700, color: '#1A2E35', margin: '0 0 18px' }}>
            Keep going
          </h2>
          <div className="tool-three-col" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
            {[
              { href: '/resources/1099-vs-w2', title: '1099 vs W2 guide', blurb: 'The non-financial trade-offs: control, stability, benefits, and when each model fits.' },
              { href: '/tools/cost-of-living-comparison', title: 'Cost-of-living comparator', blurb: 'What that rate is actually worth once you compare two cities in real terms.' },
              { href: '/tools/salary-benchmark', title: 'Salary benchmark', blurb: 'Median posted pay by state, straight from live listings on this board.' },
              { href: '/jobs/1099', title: '1099 roles', blurb: 'Open contractor postings across every specialty.' },
              { href: '/jobs/locum-tenens', title: 'Locum tenens roles', blurb: 'Assignment work with agency-covered malpractice and travel.' },
              { href: '/salary-guide', title: `${brand.niche.short} salary guide`, blurb: 'State-by-state pay, updated from live postings.' },
            ].map((l) => (
              <Link key={l.href} href={l.href} className="tool-card" style={{ ...clayCard, padding: '20px 20px 18px', textDecoration: 'none', display: 'block' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <Calculator size={15} color={TOOL_ACCENT} aria-hidden="true" />
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
