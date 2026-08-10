import { brand } from '@/config/brand';
import { Metadata } from 'next';
import Link from 'next/link';
import { Scale, DollarSign, Calculator, CheckCircle, AlertTriangle, TrendingUp, Building2, Percent } from 'lucide-react';
import BreadcrumbSchema from '@/components/BreadcrumbSchema';
import { SALARY_BANDS } from '@/lib/stats-sources';
// P6 #10: this guide carried Article JSON-LD + a review stamp but no
// E-E-A-T byline. Visible byline and schema both derive from
// brand.editorial.reviewer (config/brand.ts) so they can never disagree —
// same wiring as app/blog/[slug]/page.tsx.
import EditorialByline, { editorialSchemaFields } from '@/components/EditorialByline';

// Bump on each editorial review pass so dateModified isn't permanently
// frozen at the original publish date. Quarterly cadence is a reasonable
// minimum; bump sooner when content changes substantively.
const PUBLISHED_AT = '2026-03-19';
const LAST_REVIEWED = '2026-07-29';

/* ─────────────────────────────────────────────────────────────────────────
 * P2 #22 — TAX-FIGURE TRUTH RULES FOR THIS PAGE
 * ─────────────────────────────────────────────────────────────────────────
 * The page is titled 2026 but was printing 2024-cycle IRS numbers: a
 * SEP-IRA cap labelled 2024 that was actually the prior year's cap, a
 * Solo 401(k) deferral-plus-total stack from the same stale cycle, an IRA
 * contribution limit, and a standard mileage rate carrying the same stale
 * year label. All four are indexed annually, so any literal printed here is wrong the
 * moment the IRS publishes the next cost-of-living adjustment — and a
 * stale dollar cap on a YMYL money page is worse than no cap at all.
 *
 * RULE APPLIED: print only tax figures that are set by STATUTE and not
 * indexed, and explain everything else as a mechanic that points at the
 * current IRS figure.
 *   PRINTED (statutory, not indexed):
 *     - 15.3% SE tax (12.4% OASDI + 2.9% Medicare) — IRC §1401
 *     - 92.35% of net profit is the SE tax base — IRC §1402(a)(12)
 *     - 7.65% employee-side FICA — IRC §3101
 *     - 0.9% Additional Medicare Tax over $200,000 single / $250,000 MFJ
 *       — IRC §3101(b)(2), fixed in statute, never indexed
 *     - simplified home-office method: $5/sq ft, 300 sq ft cap ($1,500)
 *       — Rev. Proc. 2013-13, unchanged since adoption
 *   NOT PRINTED (indexed annually — described, then sourced to the IRS):
 *     - Social Security wage base, defined-contribution cap, elective
 *       deferral limit, IRA limit, standard mileage rate, bracket
 *       thresholds and the standard deduction
 *
 * Salary/rate BANDS come from SALARY_BANDS (lib/stats-sources.ts →
 * config/niche/salary.ts) — the same bands the ingest pipeline validates
 * postings against. The page previously invented its own hourly bands for
 * both the contract and salaried sides; neither matched anything in the
 * repo, and neither matched the other pages quoting NP pay.
 *
 * ── BAND-COMPARISON RULE (review follow-up) ──────────────────────────────
 * The two published bands are NOT comparable end to end, and this page must
 * never imply they are. `contractorHourly` ($40–$350/hr) is an ALL-SPECIALTY
 * ingest envelope — CRNA sets its ceiling and its FLOOR SITS BELOW the
 * $53/hr floor of `typicalW2Hourly`. (Band literals are deliberately not
 * typed out in this comment: the P2 #10 ratchet scans source text, and a
 * hand-typed band in a comment is indistinguishable from a published one.)
 * A bullet reading "Higher headline rate: contract postings validate in a
 * $40–$350/hr band" therefore printed a contract floor 25% UNDER the
 * salaried floor
 * directly beneath a claim that it was higher, and the FAQ repeated it as
 * "the headline gap is real". Both are gone. A wider envelope is not a
 * higher rate; the only comparison this page is entitled to make is the
 * WORKED one below, which is computed rather than asserted.
 */

/**
 * Worked-comparison inputs. Every dollar in the comparison table is
 * COMPUTED from these, so the arithmetic cannot drift from the stated
 * assumptions — and the assumptions are rendered above the table.
 */
const EXAMPLE = {
  w2Salary: 160_000,
  contractGross: 200_000,
  /** Schedule C spend other than malpractice: home office, mileage, CME, equipment. */
  otherBusinessExpenses: 15_000,
  /** Employee share of an employer-sponsored premium. */
  w2PremiumShare: 3_000,
  /** Individually purchased family-tier coverage, self-funded. */
  contractHealthPremium: 12_000,
  /** Individual occurrence-based professional liability policy. */
  contractMalpractice: 2_500,
  /** Employer 401(k) match as a share of salary. */
  w2MatchRate: 0.04,
} as const;

/** Employee-side FICA: 6.2% Social Security + 1.45% Medicare (IRC §3101). */
const FICA_EMPLOYEE_RATE = 0.0765;
/** Self-employment tax: 12.4% Social Security + 2.9% Medicare (IRC §1401). */
const SE_TAX_RATE = 0.153;
/** Only 92.35% of net profit is subject to SE tax (IRC §1402(a)(12)). */
const SE_BASE_FACTOR = 0.9235;
/** Combined effective SE-tax rate on Schedule C net profit. */
const SE_EFFECTIVE_RATE = SE_TAX_RATE * SE_BASE_FACTOR;

const usd = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`;

/**
 * W-2 side. The employer 401(k) match is deliberately NOT part of the cash
 * subtotal: it is deferred, illiquid, non-cash compensation, and the
 * contractor column carries no retirement contribution at all, so folding
 * it into a row labelled "cash" compares an employee's cash-plus-deferral
 * against a contractor's cash alone. That single mislabelled inclusion was
 * worth ~5 percentage points of the break-even premium below — the same
 * class of error as the "+$12,300 PTO value" line the old table carried.
 * The match is now surfaced on its own row, under the cash subtotal, and
 * rolls up into a separately labelled total-value line.
 */
const w2Fica = EXAMPLE.w2Salary * FICA_EMPLOYEE_RATE;
const w2Match = EXAMPLE.w2Salary * EXAMPLE.w2MatchRate;
const w2CashBeforeIncomeTax =
  EXAMPLE.w2Salary - w2Fica - EXAMPLE.w2PremiumShare;
const w2TotalValueBeforeIncomeTax = w2CashBeforeIncomeTax + w2Match;

/**
 * 1099 side. Malpractice and other business spend are Schedule C expenses,
 * so they reduce the SE-tax base; the self-employed health-insurance
 * deduction is an above-the-line income-tax deduction and does NOT reduce
 * SE tax — which is exactly the distinction the old table got wrong.
 */
const scheduleCExpenses = EXAMPLE.otherBusinessExpenses + EXAMPLE.contractMalpractice;
const contractNetProfit = EXAMPLE.contractGross - scheduleCExpenses;
const contractSeTax = contractNetProfit * SE_EFFECTIVE_RATE;
const contractCashBeforeIncomeTax =
  contractNetProfit - contractSeTax - EXAMPLE.contractHealthPremium;

/**
 * Gross contract income that leaves `target` in hand after Schedule C
 * spend, self-employment tax, and self-funded health coverage.
 */
const breakEvenGrossFor = (target: number): number =>
  (target + EXAMPLE.contractHealthPremium) / (1 - SE_EFFECTIVE_RATE) + scheduleCExpenses;

const premiumPctOver = (gross: number): number =>
  Math.round((gross / EXAMPLE.w2Salary - 1) * 100);

/**
 * Two break-evens, because they answer different questions and the page
 * previously conflated them into one inflated figure:
 *   - CASH parity: matches the salaried package's spendable cash.
 *   - TOTAL-VALUE parity: additionally replaces the employer match out of
 *     the contractor's own pocket. Still conservative toward W-2, since a
 *     solo 401(k) gives the contractor far more tax-advantaged capacity
 *     than the match it is replacing.
 */
const contractBreakEvenGross = breakEvenGrossFor(w2CashBeforeIncomeTax);
const contractPremiumNeededPct = premiumPctOver(contractBreakEvenGross);
const contractBreakEvenGrossWithMatch = breakEvenGrossFor(w2TotalValueBeforeIncomeTax);
const contractPremiumNeededWithMatchPct = premiumPctOver(contractBreakEvenGrossWithMatch);

/**
 * JSON-LD serializer matching the repo convention (see app/companies/page.tsx
 * and app/for-employers/resources/how-to-hire/page.tsx): angle brackets are
 * escaped so no value can terminate the surrounding <script> element.
 */
const ldJson = (obj: unknown): string =>
  JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

const CONTRACT_HOURLY = SALARY_BANDS.contractorHourly;
const W2_HOURLY = SALARY_BANDS.typicalW2Hourly;
const W2_ANNUAL = SALARY_BANDS.typicalW2Annual;
// P0 OG sweep: edge-generated card via /api/og — the previous Supabase
// page-screenshot 400'd on every share (pattern: app/for-employers/page.tsx).
// Absolute URL because it also feeds Article JSON-LD `image`.
const HERO_IMAGE = `${brand.baseUrl}/api/og?title=${encodeURIComponent(`1099 vs W2 for ${brand.niche.short}s`)}&type=page`;

export const metadata: Metadata = {
  title: `1099 vs W2 for ${brand.niche.short}s — Complete Compensation Comparison 2026`,
  description: `Compare 1099 independent contractor vs W2 employee ${brand.niche.short} compensation: how self-employment tax actually works, which costs you self-fund, a worked side-by-side with its assumptions shown, and how much more gross a contract needs to match a salaried offer.`,
  keywords: [`1099 vs W2 ${brand.niche.short}`, `1099 ${brand.niche.descriptor}`, `${brand.niche.short} independent contractor taxes`, 'contractor vs employee NP', `1099 ${brand.niche.short} telehealth pay`, `${brand.niche.short} compensation comparison`],
  openGraph: {
    title: `1099 vs W2 for ${brand.niche.short}s — Compensation Guide`,
    description: `Which pays more? Complete comparison of independent contractor vs employee compensation for ${brand.niche.descriptor}s.`,
    type: 'article',
    images: [{ url: HERO_IMAGE, width: 1200, height: 630, alt: `1099 vs W2 ${brand.niche.short} Compensation Guide` }],
  },
  twitter: {
    card: 'summary_large_image',
    title: `1099 vs W2 for ${brand.niche.short}s — Compensation Guide`,
    images: [HERO_IMAGE],
  },
  alternates: { canonical: `${brand.baseUrl}/resources/1099-vs-w2` },
};

export default function CompensationGuidePage() {
  const compFaqs = [
    {
      question: `Is 1099 or W2 better for ${brand.niche.short}s?`,
      answer: `It depends on what you are optimizing for. A 1099 contract is quoted gross — nothing is withheld and no benefits are bought out of it — and it lets you deduct real business expenses, but you fund your own health coverage, malpractice, and retirement, and you owe self-employment tax and quarterly estimated payments. A W2 role pays inside a salary band and hands you employer-subsidized health coverage, employer-paid malpractice, a retirement match, paid time off, and withholding someone else calculates. Do not compare the two posted bands directly: contract postings on ${brand.name} validate in a ${CONTRACT_HOURLY.formatted} band spanning every ${brand.niche.short} and APRN specialty, so CRNA work sets its ceiling and its floor sits BELOW the ${W2_HOURLY.formatted} hourly equivalent of the ${W2_ANNUAL.formatted} typical W-2 band — that is an ingest envelope, not a contract floor, and a wider band is not a higher rate. The comparison worth making is the worked one on this page: matching a ${usd(EXAMPLE.w2Salary)} salaried package on cash took about ${contractPremiumNeededPct}% more gross.`
    },
    {
      question: `How much more does a 1099 contract need to pay to match a W2 offer?`,
      answer: `Ask which parity you mean, because the two answers differ. In the worked example on this page — a ${usd(EXAMPLE.w2Salary)} W-2 package against contract work with ${usd(EXAMPLE.otherBusinessExpenses)} of business expenses, ${usd(EXAMPLE.contractHealthPremium)} of self-funded health coverage, and ${usd(EXAMPLE.contractMalpractice)} of malpractice — the contract needs roughly ${usd(contractBreakEvenGross)} gross, about ${contractPremiumNeededPct}% above the salary, to leave the same spendable cash before income tax. To also replace the ${usd(w2Match)} employer retirement match out of your own pocket it needs about ${usd(contractBreakEvenGrossWithMatch)}, roughly ${contractPremiumNeededWithMatchPct}%. Your own number moves with your premium, your deductible business spend, and whether a spouse's plan covers you. Run the math on the specific offer rather than assuming a flat percentage.`
    },
    {
      question: `What tax deductions can 1099 ${brand.niche.short}s claim?`,
      answer: `Ordinary and necessary business expenses: the simplified home-office deduction ($5 per square foot of dedicated space, capped at 300 square feet), business mileage or actual vehicle costs, malpractice and other business insurance, CME and licensure, professional memberships, work devices, software and EHR subscriptions, and business phone and internet. Health insurance premiums are deducted separately as a self-employed health-insurance deduction against income tax rather than as a business expense — an important difference, because business expenses cut self-employment tax and that deduction does not. Retirement contributions through a SEP-IRA or solo 401(k) are deductible up to annual limits the IRS indexes each year; check the current figure before you fund the account.`
    },
    {
      question: `Should new grad ${brand.niche.short}s take 1099 positions?`,
      answer: `Usually not as a first role. W2 positions come with mentorship, structured onboarding, employer-paid malpractice, and benefits, and they do not require you to run a business alongside a new clinical role. Contract work assumes you can practice with minimal orientation and handle quarterly taxes, bookkeeping, and your own insurance. Many ${brand.niche.short}s move to contract work once they can command a rate that covers the cost stack described on this page.`
    },
    {
      question: `Can you do both 1099 and W2 as an ${brand.niche.short}?`,
      answer: `Yes, and it is common: a W2 role for benefits and predictable income, plus 1099 contracts for additional hours at a rate you negotiate yourself. This is the one case where the cost stack on this page mostly does not apply — because the W2 job already covers your health coverage and malpractice, the contract side keeps far more of its gross rate than it would standalone, so the break-even premium computed below is not the bar you have to clear. Check your W2 contract for non-compete or moonlighting restrictions before you sign anything, and confirm the contract's malpractice terms cover the work.`
    },
    {
      question: `What retirement accounts should 1099 ${brand.niche.short}s use?`,
      answer: `A SEP-IRA lets you contribute a percentage of net self-employment earnings up to the annual defined-contribution cap and takes minutes to open. A solo 401(k) stacks an employee elective deferral on top of an employer profit-sharing contribution, so it reaches the same cap at a much lower income and usually offers a Roth option — which is why higher earners generally prefer it. Traditional and Roth IRAs remain available alongside either. Every one of those dollar limits is indexed annually, so this page deliberately does not print them: pull the current figures from IRS Publication 560 and the IRS annual cost-of-living release before you contribute.`
    },
  ];

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <BreadcrumbSchema items={[
        { name: "Home", url: brand.baseUrl },
        { name: "Resources", url: `${brand.baseUrl}/resources` },
        { name: "1099 vs W2 Guide", url: `${brand.baseUrl}/resources/1099-vs-w2` }
      ]} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: ldJson({
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: compFaqs.map((faq) => ({
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
            headline: `1099 vs W2 for ${brand.niche.short}s — Complete Compensation Comparison 2026`,
            description: `Compare independent contractor vs employee compensation for ${brand.niche.descriptor}s.`,
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
      <section className="bg-gradient-to-r from-pink-700 to-blue-600 text-white py-12 md:py-16">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-white/10 mb-6">
              <Scale className="w-8 h-8" />
            </div>
            <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4">
              1099 vs W2 for {brand.niche.short}s
            </h1>
            <p className="text-sm text-blue-200 text-center mt-2 mb-4">
              {/* Audit P0 #23: render the real review date (same constant the
                  Article schema emits) — never render time, which fabricated
                  freshness and contradicted dateModified. */}
              Last Updated: {new Date(`${LAST_REVIEWED}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })} | Complete compensation comparison
            </p>
            <p className="text-lg md:text-xl text-blue-100 mb-6">
              Which pays more? Independent contractor vs employee — taxes, benefits, and take-home pay compared
            </p>
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

          {/* Quick Summary */}
          <div className="mb-8 md:mb-12 grid md:grid-cols-2 gap-6">
            <div className="rounded-xl p-6" style={{ backgroundColor: 'var(--bg-secondary)', border: '2px solid #BE185D' }}>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-full bg-pink-100 flex items-center justify-center"><DollarSign className="h-4 w-4 text-pink-800" /></div>
                <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>1099 / Independent Contractor</h2>
              </div>
              <ul className="space-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                {/* Review follow-up: this bullet used to read "Higher headline
                    rate: contract postings here validate in a $40–$350/hr
                    band". That band's FLOOR is below the W-2 card's own
                    $53–$82/hr equivalent two bullets away, so the evidence
                    contradicted the claim it was attached to. What is
                    actually true of a contract rate — and what the worked
                    example below quantifies — is that it is quoted gross. */}
                <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" /><span><strong>You price the work:</strong> the rate is negotiated per engagement and quoted gross — nothing withheld, no benefits bought out of it</span></li>
                <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" /><span><strong>Schedule flexibility:</strong> Choose hours &amp; clients</span></li>
                <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" /><span><strong>Business deductions:</strong> Home office, mileage, CME, equipment</span></li>
                <li className="flex gap-2"><AlertTriangle className="h-4 w-4 text-yellow-500 flex-shrink-0 mt-0.5" /><span><strong>Self-employment tax:</strong> {(SE_TAX_RATE * 100).toFixed(1)}% — you pay both halves</span></li>
                <li className="flex gap-2"><AlertTriangle className="h-4 w-4 text-yellow-500 flex-shrink-0 mt-0.5" /><span><strong>No employer benefits:</strong> Self-fund health, malpractice, retirement</span></li>
                <li className="flex gap-2"><AlertTriangle className="h-4 w-4 text-yellow-500 flex-shrink-0 mt-0.5" /><span><strong>Admin burden:</strong> Quarterly estimated taxes, bookkeeping</span></li>
              </ul>
              <p className="mt-4 text-xs font-medium" style={{ color: 'var(--color-primary)' }}>Best for: Experienced {brand.niche.short}s who want maximum control and can price the cost stack</p>
            </div>
            <div className="rounded-xl p-6" style={{ backgroundColor: 'var(--bg-secondary)', border: '2px solid #6366f1' }}>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center"><Building2 className="h-4 w-4 text-indigo-700" /></div>
                <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>W2 / Employee</h2>
              </div>
              <ul className="space-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" /><span><strong>Stability:</strong> Predictable paycheck &amp; schedule</span></li>
                <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" /><span><strong>Employer benefits:</strong> Subsidized health, 401(k) match, PTO</span></li>
                <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" /><span><strong>Malpractice included:</strong> Employer-paid coverage</span></li>
                <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" /><span><strong>Simpler taxes:</strong> Your employer withholds and pays half of FICA</span></li>
                {/* Counterpart to the 1099 card's first bullet: "Lower
                    headline rate" was the other half of the false
                    comparison. The real W-2 trade is that the number is set
                    inside a band and the employer's cost stack is funded
                    before it, not that it is lower than a contract rate. */}
                <li className="flex gap-2"><AlertTriangle className="h-4 w-4 text-yellow-500 flex-shrink-0 mt-0.5" /><span><strong>Pay is set inside a band:</strong> less room to price yourself, and the employer funds its cost stack before your number</span></li>
                <li className="flex gap-2"><AlertTriangle className="h-4 w-4 text-yellow-500 flex-shrink-0 mt-0.5" /><span><strong>Less flexibility:</strong> Employer-defined schedule</span></li>
              </ul>
              <p className="mt-4 text-xs font-medium text-indigo-600">Best for: New grads, {brand.niche.short}s wanting stability and mentorship</p>
            </div>
          </div>

          {/* Band provenance — these are pipeline validation bands, not a wage
              survey, and the page says so rather than implying otherwise.
              Review follow-up: the bands moved OUT of the two comparison
              cards and into this one paragraph, because side by side in the
              cards they read as a rate comparison, which they cannot
              support. Here they are stated with the reason they are not
              comparable. */}
          <p className="text-xs mb-8 md:mb-12 -mt-4" style={{ color: 'var(--text-tertiary)' }}>
            What {brand.name} publishes as bands: contract postings validate in {CONTRACT_HOURLY.formatted}, salaried postings in {W2_ANNUAL.formatted} — {W2_HOURLY.formatted} as {W2_HOURLY.basis}. Those are {CONTRACT_HOURLY.basis} and {W2_ANNUAL.basis}: what {brand.name} accepts and displays for a real posting, not a survey of what every {brand.niche.short} earns. <strong>They are not comparable end to end.</strong> The contract band spans every specialty, so CRNA work sets its ceiling and its floor sits below the salaried floor — a wider envelope is not a higher rate. Compare a specific offer against a specific offer, the way the worked example below does. For a cited national figure, see the <Link href="/salary-guide" className="font-medium hover:underline" style={{ color: 'var(--color-primary)' }}>{brand.niche.short} salary guide</Link>.
          </p>

          {/* Self-employment tax mechanics — statutory rates only. Every
              indexed threshold is described and sourced to the IRS rather
              than printed, so this section cannot go stale. */}
          <div className="mb-8 md:mb-12">
            <div className="rounded-xl p-6 md:p-8" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
              <div className="flex items-center gap-3 mb-4">
                <Percent className="h-6 w-6" style={{ color: 'var(--color-primary)' }} aria-hidden="true" />
                <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>How Self-Employment Tax Actually Works</h2>
              </div>
              <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
                This is the single biggest line item people miss when they compare a contract rate to a salary. As a W2 employee you pay {(FICA_EMPLOYEE_RATE * 100).toFixed(2)}% of wages in FICA and your employer pays a matching share you never see. As a contractor there is no employer, so you pay both halves yourself:
              </p>
              <ul className="space-y-3 text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
                <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" aria-hidden="true" /><span><strong>The rate is {(SE_TAX_RATE * 100).toFixed(1)}%</strong> — 12.4% Social Security plus 2.9% Medicare. Both halves, combined.</span></li>
                <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" aria-hidden="true" /><span><strong>It applies to {(SE_BASE_FACTOR * 100).toFixed(2)}% of your Schedule C net profit</strong>, not to gross receipts — so an effective {(SE_EFFECTIVE_RATE * 100).toFixed(2)}% of net profit. Business expenses reduce this base; the self-employed health-insurance deduction does not.</span></li>
                <li className="flex gap-2"><AlertTriangle className="h-4 w-4 text-yellow-500 flex-shrink-0 mt-0.5" aria-hidden="true" /><span><strong>The 12.4% Social Security portion stops at the annual wage base.</strong> The IRS indexes that ceiling every year, so we do not print it here — look up the current wage base before you model a high-income year. Above it, only the 2.9% Medicare portion continues, with no cap.</span></li>
                <li className="flex gap-2"><AlertTriangle className="h-4 w-4 text-yellow-500 flex-shrink-0 mt-0.5" aria-hidden="true" /><span><strong>An extra 0.9% Additional Medicare Tax</strong> applies to earnings above $200,000 (single) or $250,000 (married filing jointly). Those two thresholds are fixed in statute and are <em>not</em> indexed, which is why they are safe to print.</span></li>
                <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" aria-hidden="true" /><span><strong>Half of your self-employment tax is deductible</strong> against income tax. It does not come back as cash, but it lowers taxable income — which is why the cash comparison below stops before income tax.</span></li>
                <li className="flex gap-2"><AlertTriangle className="h-4 w-4 text-yellow-500 flex-shrink-0 mt-0.5" aria-hidden="true" /><span><strong>Nobody withholds it for you.</strong> Contractors generally owe quarterly estimated payments, and underpaying triggers a penalty even if you settle up in April.</span></li>
              </ul>
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                Rates and the {(SE_BASE_FACTOR * 100).toFixed(2)}% base factor are set by statute and have not changed in years. Every dollar threshold that <em>is</em> indexed — the Social Security wage base, retirement contribution caps, the standard deduction, bracket boundaries, and the standard mileage rate — is deliberately omitted from this page so it cannot publish a stale number. Get those from IRS.gov for the year you are filing, and treat this page as orientation rather than tax advice.
              </p>
            </div>
          </div>

          {/* Detailed Comparison Table */}
          <div className="mb-8 md:mb-12">
            <div className="rounded-xl p-6 md:p-8" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
              <h2 className="text-2xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
                Worked Comparison: {usd(EXAMPLE.w2Salary)} W2 vs {usd(EXAMPLE.contractGross)} Gross 1099
              </h2>

              {/* Assumptions are rendered ABOVE the table, not buried in a
                  footnote: every figure in the table is computed from them. */}
              <div className="rounded-lg p-4 mb-5" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>What this example assumes</h3>
                <ul className="text-xs space-y-1" style={{ color: 'var(--text-secondary)' }}>
                  <li>A {usd(EXAMPLE.w2Salary)} salaried offer with an employer plan costing you {usd(EXAMPLE.w2PremiumShare)}/year, employer-paid malpractice, and a {(EXAMPLE.w2MatchRate * 100).toFixed(0)}% 401(k) match.</li>
                  <li>A contract paying {usd(EXAMPLE.contractGross)} gross, with {usd(EXAMPLE.otherBusinessExpenses)} of deductible business spend (home office, mileage, CME, equipment), {usd(EXAMPLE.contractMalpractice)} of malpractice, and {usd(EXAMPLE.contractHealthPremium)} of individually purchased health coverage.</li>
                  <li><strong>Federal and state income tax are excluded from both columns.</strong> At similar taxable income they are broadly comparable, and the deductions that differ — half of self-employment tax, the self-employed health-insurance deduction, and any qualified business income deduction — all cut the contractor&apos;s taxable income, not the employee&apos;s. Including a guessed bracket would obscure the comparison rather than sharpen it.</li>
                  <li><strong>The employer 401(k) match is kept out of the cash subtotal.</strong> It is real compensation, but it is deferred and locked in a retirement account rather than spendable this year, and the contractor column carries no retirement contribution at all — so counting it as &quot;cash&quot; would compare an employee&apos;s cash-plus-deferral against a contractor&apos;s cash alone. It gets its own row and a separate total-value line.</li>
                  <li>Payroll tax is computed from statutory rates only: {(FICA_EMPLOYEE_RATE * 100).toFixed(2)}% employee FICA on wages, and {(SE_TAX_RATE * 100).toFixed(1)}% self-employment tax on {(SE_BASE_FACTOR * 100).toFixed(2)}% of Schedule C net profit. Where net profit approaches the Social Security wage base, the true figure is slightly lower than shown, so the contractor column is the conservative side.</li>
                  <li>These are illustrative inputs chosen to show the mechanics — not survey data, and not a quote for your situation.</li>
                </ul>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    Line-by-line comparison of a {usd(EXAMPLE.w2Salary)} W2 package against {usd(EXAMPLE.contractGross)} of gross 1099 contract income, before income tax, subtotalled first on spendable cash and then on total value including the deferred employer retirement match.
                  </caption>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                      <th scope="col" className="text-left py-3 pr-4 font-semibold" style={{ color: 'var(--text-primary)' }}>Line Item</th>
                      <th scope="col" className="text-right py-3 px-4 font-semibold text-indigo-600">W2 ({usd(EXAMPLE.w2Salary)})</th>
                      <th scope="col" className="text-right py-3 pl-4 font-semibold" style={{ color: 'var(--color-primary)' }}>1099 ({usd(EXAMPLE.contractGross)} gross)</th>
                    </tr>
                  </thead>
                  <tbody style={{ color: 'var(--text-secondary)' }}>
                    <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <th scope="row" className="py-3 pr-4 font-medium text-left" style={{ color: 'var(--text-primary)' }}>Gross income</th>
                      <td className="py-3 px-4 text-right">{usd(EXAMPLE.w2Salary)}</td>
                      <td className="py-3 pl-4 text-right">{usd(EXAMPLE.contractGross)}</td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <th scope="row" className="py-3 pr-4 font-medium text-left" style={{ color: 'var(--text-primary)' }}>Business expenses (Schedule C)</th>
                      <td className="py-3 px-4 text-right">None — not available to employees</td>
                      <td className="py-3 pl-4 text-right text-red-500">−{usd(EXAMPLE.otherBusinessExpenses)}</td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <th scope="row" className="py-3 pr-4 font-medium text-left" style={{ color: 'var(--text-primary)' }}>Malpractice insurance</th>
                      <td className="py-3 px-4 text-right">Employer-paid</td>
                      <td className="py-3 pl-4 text-right text-red-500">−{usd(EXAMPLE.contractMalpractice)}</td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <th scope="row" className="py-3 pr-4 font-medium text-left" style={{ color: 'var(--text-primary)' }}>
                        Payroll tax you personally pay
                        <span className="block font-normal text-xs" style={{ color: 'var(--text-tertiary)' }}>
                          W2: {(FICA_EMPLOYEE_RATE * 100).toFixed(2)}% of wages · 1099: {(SE_TAX_RATE * 100).toFixed(1)}% of {(SE_BASE_FACTOR * 100).toFixed(2)}% of {usd(contractNetProfit)} net profit
                        </span>
                      </th>
                      <td className="py-3 px-4 text-right text-red-500">−{usd(w2Fica)}</td>
                      <td className="py-3 pl-4 text-right text-red-500">−{usd(contractSeTax)}</td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <th scope="row" className="py-3 pr-4 font-medium text-left" style={{ color: 'var(--text-primary)' }}>Health insurance you fund</th>
                      <td className="py-3 px-4 text-right text-red-500">−{usd(EXAMPLE.w2PremiumShare)}</td>
                      <td className="py-3 pl-4 text-right text-red-500">−{usd(EXAMPLE.contractHealthPremium)}</td>
                    </tr>
                    {/* Cash subtotal comes FIRST and excludes the employer
                        match — see the w2CashBeforeIncomeTax comment above.
                        The match is deferred compensation, so it sits below
                        the cash line and rolls into total value instead. */}
                    <tr className="font-bold" style={{ borderTop: '2px solid var(--border-color)' }}>
                      <th scope="row" className="py-3 pr-4 text-left" style={{ color: 'var(--text-primary)' }}>Cash before income tax</th>
                      <td className="py-3 px-4 text-right text-indigo-600">{usd(w2CashBeforeIncomeTax)}</td>
                      <td className="py-3 pl-4 text-right" style={{ color: 'var(--color-primary)' }}>{usd(contractCashBeforeIncomeTax)}</td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <th scope="row" className="py-3 pr-4 font-medium text-left" style={{ color: 'var(--text-primary)' }}>
                        Employer retirement match
                        <span className="block font-normal text-xs" style={{ color: 'var(--text-tertiary)' }}>
                          Deferred, not cash — locked in a retirement account, not spendable this year
                        </span>
                      </th>
                      <td className="py-3 px-4 text-right text-green-600">+{usd(w2Match)}</td>
                      <td className="py-3 pl-4 text-right">None — you are the employer</td>
                    </tr>
                    <tr className="font-bold" style={{ borderTop: '2px solid var(--border-color)' }}>
                      <th scope="row" className="py-3 pr-4 text-left" style={{ color: 'var(--text-primary)' }}>Total value before income tax</th>
                      <td className="py-3 px-4 text-right text-indigo-600">{usd(w2TotalValueBeforeIncomeTax)}</td>
                      <td className="py-3 pl-4 text-right" style={{ color: 'var(--color-primary)' }}>{usd(contractCashBeforeIncomeTax)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="mt-5 rounded-lg p-4" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
                  The number worth remembering: about {usd(contractBreakEvenGross)} gross for cash parity, {usd(contractBreakEvenGrossWithMatch)} to also replace the match
                </p>
                {/* Review follow-up: this paragraph used to end its first
                    claim with "That is the honest reading of the 20–25%
                    premium most rate negotiations settle for." Nothing in
                    this repo — or in any source this page cites — supports a
                    claim about what "most rate negotiations settle for". It
                    was market lore surviving on a page whose stated rule is
                    that unsourced figures get deleted, and rephrasing an
                    earlier version of the same sentence had left the number
                    itself in place. The claim is now stated only about the
                    computed example, which is the only thing this page can
                    stand behind. Do not reintroduce a market-wide premium
                    figure here without a citable source. */}
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  Matching the {usd(EXAMPLE.w2Salary)} salaried package on <strong>cash</strong> before income tax takes roughly {usd(contractBreakEvenGross)} gross — about <strong>{contractPremiumNeededPct}% above the salary</strong>. That premium buys cash parity and nothing more: it is the employer&apos;s cost stack priced back in, not a raise. Replacing the {usd(w2Match)} employer retirement match out of your own pocket on top of that takes about {usd(contractBreakEvenGrossWithMatch)}, or <strong>{contractPremiumNeededWithMatchPct}%</strong> — which is the number to quote if you are pricing the whole package rather than this year&apos;s take-home. Both figures are computed from the assumptions listed above this table and hold only for them; the premium you actually need moves with your health premium, how much deductible business spend you genuinely have, and whether a spouse&apos;s plan covers you. It shrinks meaningfully if you are already covered elsewhere.
                </p>
              </div>
              <p className="text-xs mt-4" style={{ color: 'var(--text-tertiary)' }}>
                What this comparison deliberately leaves out: paid time off (already priced into the salary, and unpaid on the contract side, so it favors W2 further), and income tax itself. It also stops at replacing the employer match dollar for dollar, which understates the contract side — a solo 401(k) or SEP-IRA gives a contractor far more tax-advantaged capacity than a {(EXAMPLE.w2MatchRate * 100).toFixed(0)}% match, it is just funded out of the same gross. Contract work wins on the retirement-capacity and deduction axes; salaried work wins on the cost-stack axis. Model your own offer before deciding.
              </p>
            </div>
          </div>

          {/* Tax Tips */}
          <div className="mb-8 md:mb-12">
            <div className="rounded-xl p-6 md:p-8" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
              <div className="flex items-center gap-3 mb-4">
                <Calculator className="h-6 w-6" style={{ color: 'var(--color-primary)' }} />
                <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Tax Optimization for 1099 {brand.niche.short}s</h2>
              </div>
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <h3 className="font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Common Deductions</h3>
                  <ul className="space-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                    <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" aria-hidden="true" /><span>Home office, simplified method: $5 per square foot of dedicated space, capped at 300 sq ft ($1,500)</span></li>
                    <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" aria-hidden="true" /><span>Business mileage at the IRS standard rate for the filing year, or actual vehicle expenses</span></li>
                    <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" aria-hidden="true" /><span>Professional liability / malpractice insurance</span></li>
                    <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" aria-hidden="true" /><span>CME courses, conferences, licensure, and clinical subscriptions</span></li>
                    <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" aria-hidden="true" /><span>Professional memberships (AANP, ANCC, state and specialty {brand.niche.short} associations)</span></li>
                    <li className="flex gap-2"><CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" aria-hidden="true" /><span>Work devices, EHR and telehealth software, business phone and internet</span></li>
                    <li className="flex gap-2"><AlertTriangle className="h-4 w-4 text-yellow-500 flex-shrink-0 mt-0.5" aria-hidden="true" /><span>Health insurance premiums are deducted <strong>against income tax, not as a business expense</strong> — so they do not reduce self-employment tax</span></li>
                    <li className="flex gap-2"><AlertTriangle className="h-4 w-4 text-yellow-500 flex-shrink-0 mt-0.5" aria-hidden="true" /><span>The qualified business income deduction may apply, but clinical care is a specified service trade or business, so it phases out above an income threshold the IRS indexes annually — check eligibility with a CPA rather than assuming it</span></li>
                  </ul>
                </div>
                <div>
                  <h3 className="font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Retirement Capacity Compared</h3>
                  <div className="space-y-3">
                    <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                      <div className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>SEP-IRA</div>
                      <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>A single employer-side contribution: a percentage of net self-employment earnings, up to the annual defined-contribution cap. Opens in minutes, almost no administration.</div>
                    </div>
                    <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                      <div className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Solo 401(k)</div>
                      <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>Two tiers: an employee elective deferral <em>plus</em> an employer profit-sharing contribution, against the same annual cap. Because the deferral stacks on top, it reaches the cap at a much lower income than a SEP-IRA — and usually offers a Roth bucket. This is why higher-earning contractors generally choose it.</div>
                    </div>
                    <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                      <div className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>W2 employer 401(k)</div>
                      <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>The same employee deferral limit, plus whatever your employer matches. Less total capacity than a solo plan, but the match is compensation you would otherwise leave on the table.</div>
                    </div>
                    <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                      Every dollar cap above is indexed annually, so this page names the mechanics instead of printing figures that go stale. Look up the current limits in IRS Publication 560 before you fund an account.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* When to Choose Each */}
          <div className="mb-8 md:mb-12">
            <div className="rounded-xl p-6 md:p-8" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
              <h2 className="text-2xl font-bold mb-6" style={{ color: 'var(--text-primary)' }}>When to Choose 1099 vs W2</h2>
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <h3 className="font-semibold mb-3" style={{ color: 'var(--color-primary)' }}>Choose 1099 If You:</h3>
                  <ul className="space-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                    <li className="flex gap-2"><TrendingUp className="h-4 w-4 text-pink-600 flex-shrink-0 mt-0.5" /><span>Have 2+ years of clinical experience</span></li>
                    <li className="flex gap-2"><TrendingUp className="h-4 w-4 text-pink-600 flex-shrink-0 mt-0.5" /><span>Want maximum income potential</span></li>
                    <li className="flex gap-2"><TrendingUp className="h-4 w-4 text-pink-600 flex-shrink-0 mt-0.5" /><span>Value schedule flexibility and autonomy</span></li>
                    <li className="flex gap-2"><TrendingUp className="h-4 w-4 text-pink-600 flex-shrink-0 mt-0.5" /><span>Are comfortable managing business finances</span></li>
                    <li className="flex gap-2"><TrendingUp className="h-4 w-4 text-pink-600 flex-shrink-0 mt-0.5" /><span>Have a spouse with health insurance</span></li>
                    <li className="flex gap-2"><TrendingUp className="h-4 w-4 text-pink-600 flex-shrink-0 mt-0.5" /><span>Are planning to open a private practice</span></li>
                  </ul>
                </div>
                <div>
                  <h3 className="font-semibold mb-3 text-indigo-600">Choose W2 If You:</h3>
                  <ul className="space-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                    <li className="flex gap-2"><Building2 className="h-4 w-4 text-indigo-500 flex-shrink-0 mt-0.5" /><span>Are a new graduate seeking mentorship</span></li>
                    <li className="flex gap-2"><Building2 className="h-4 w-4 text-indigo-500 flex-shrink-0 mt-0.5" /><span>Need employer-sponsored health insurance</span></li>
                    <li className="flex gap-2"><Building2 className="h-4 w-4 text-indigo-500 flex-shrink-0 mt-0.5" /><span>Prefer predictable income and schedule</span></li>
                    <li className="flex gap-2"><Building2 className="h-4 w-4 text-indigo-500 flex-shrink-0 mt-0.5" /><span>Want employer-paid malpractice coverage</span></li>
                    <li className="flex gap-2"><Building2 className="h-4 w-4 text-indigo-500 flex-shrink-0 mt-0.5" /><span>Value PTO, CME allowance, and retirement match</span></li>
                    <li className="flex gap-2"><Building2 className="h-4 w-4 text-indigo-500 flex-shrink-0 mt-0.5" /><span>Qualify for employer loan repayment programs</span></li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          {/* FAQ Section */}
          <div className="mb-8 md:mb-12">
            <div className="rounded-xl p-6 md:p-8" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
              <h2 className="text-2xl font-bold mb-6" style={{ color: 'var(--text-primary)' }}>1099 vs W2 FAQs</h2>
              {compFaqs.map((faq, idx) => (
                <div key={idx} className="mb-6 last:mb-0">
                  <h3 className="font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>{faq.question}</h3>
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{faq.answer}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Related Resources — P2 #22: all three /resources guides now
              cross-link each other plus the salary guide, so the cluster is
              navigable from any entry point instead of being a dead end. */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            <Link href="/resources/fpa-guide" className="block p-4 rounded-lg hover:shadow-sm transition-all" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
              <h3 className="font-semibold" style={{ color: 'var(--color-primary)' }}>Full Practice Authority guide</h3>
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>Whether you can contract independently depends on your state — check its classification first.</p>
            </Link>
            <Link href="/resources/private-practice-guide" className="block p-4 rounded-lg hover:shadow-sm transition-all" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
              <h3 className="font-semibold" style={{ color: 'var(--color-primary)' }}>Private practice startup guide</h3>
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>The next step past contracting: entity formation, credentialing, and a revenue model.</p>
            </Link>
            <Link href="/salary-guide" className="block p-4 rounded-lg hover:shadow-sm transition-all" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
              <h3 className="font-semibold" style={{ color: 'var(--color-primary)' }}>{brand.niche.short} salary guide</h3>
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>Live pay data by state, setting, and experience — anchor your rate to a real market number.</p>
            </Link>
            <Link href="/jobs/1099" className="block p-4 rounded-lg hover:shadow-sm transition-all" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
              <h3 className="font-semibold" style={{ color: 'var(--color-primary)' }}>Browse 1099 {brand.niche.short} jobs</h3>
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>Independent contractor positions, updated daily.</p>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
