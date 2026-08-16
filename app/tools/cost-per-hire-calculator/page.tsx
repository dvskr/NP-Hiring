/**
 * Employer cost-per-hire calculator (P3 #6b) — indexable tool route.
 *
 * The arithmetic and every price live in
 * components/tools/cost-per-hire-model.ts, which reads our own pricing from
 * lib/config.ts. This route is metadata, schema, visible assumptions, and
 * cross-links only.
 *
 * TRUTH RULES
 *  - Only OUR prices are asserted, and they come from the same config the
 *    checkout charges against. Every alternative-channel figure is an employer
 *    input, and a channel with nothing entered reports "not comparable" rather
 *    than a zero that would read as free.
 *  - There is no industry benchmark anywhere on this page: no typical cost per
 *    click, no typical contingency rate, no typical time-to-fill, no typical
 *    applicant-to-hire ratio. We sell the flat-fee side of this comparison, so
 *    a benchmark we published would be marketing dressed as data.
 *  - Where we state a RULE about our pricing rather than a price, it is scoped
 *    exactly as enforced: the free post is one per employer email DOMAIN,
 *    lifetime, shared across every employee at that domain (lib/config.ts,
 *    app/api/jobs/post-free/route.ts). "Per account" would overstate the
 *    allowance and understate a multi-recruiter employer's real spend.
 *  - No unmeasured comparative about a channel we do not price. Adverbs of
 *    frequency or degree attached to "cheaper" are benchmarks in disguise: they
 *    assert a distribution we have never sampled, on the one page whose premise
 *    is that the only figures we assert are checkable. The calculator answers
 *    the question on the reader's own numbers, or it does not answer it.
 *  - The two non-zero defaults are traceable and labelled: time-to-fill starts
 *    at the posting's own run length (a product fact, applied identically to
 *    every channel), and first-year base starts at the cited BLS median.
 *  - FAQPage JSON-LD derives from the same FAQS array the visible accordion
 *    renders.
 */
import { brand } from '@/config/brand';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Briefcase, HelpCircle } from 'lucide-react';
import Breadcrumbs from '@/components/Breadcrumbs';
import AssumptionsPanel from '@/components/tools/AssumptionsPanel';
import EmployerCostPerHireCalculator from '@/components/tools/EmployerCostPerHireCalculator';
import {
  DEFAULT_TIME_TO_FILL_DAYS,
  FIRST_YEAR_BASE_SOURCE,
  FLAT_FEE_PRICING,
  FREE_POST_SCOPE_NOTE,
} from '@/components/tools/cost-per-hire-model';
import { TOOL_ACCENT, TOOL_PAGE_CSS, TOOL_HERO_BG, TOOL_PANEL_BG, clayCard, formatUsd } from '@/components/tools/tool-theme';
import { STAT_SOURCES } from '@/lib/stats-sources';

const PAGE_PATH = '/tools/cost-per-hire-calculator';
const PAGE_URL = `${brand.baseUrl}${PAGE_PATH}`;
const PAGE_TITLE = `Cost Per Hire Calculator — Flat-Fee Posting vs Sponsored Ads vs Agency`;
const PAGE_DESCRIPTION = `Work out your real cost per hire for a ${brand.niche.short} role: a flat-fee posting priced from our published rates against sponsored-ad spend and an agency contingency fee, using your own applicant volume and time-to-fill. No industry benchmarks — every alternative figure is one you enter.`;
const OG_IMAGE = `${brand.baseUrl}/api/og?title=${encodeURIComponent('Cost Per Hire Calculator')}&type=page`;

export const metadata: Metadata = {
  // P7 runtime fix D7: root layout template appends `| ${brand.name}`.
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  keywords: [
    'cost per hire calculator',
    `${brand.niche.short.toLowerCase()} recruiting cost per hire`,
    'job posting vs recruiter cost',
    'agency fee vs job board posting',
    'healthcare recruiting cost calculator',
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
  `Cost per hire is total channel spend divided by hires. Cost per applicant is total channel spend divided by applicants. Nothing else is folded in.`,
  `Our own prices are read from the pricing config the checkout charges against: ${formatUsd(FLAT_FEE_PRICING.postingPrice)} per post for ${FLAT_FEE_PRICING.paidDurationDays} days, ${formatUsd(FLAT_FEE_PRICING.renewalPrice)} per renewal, and ${FLAT_FEE_PRICING.candidateUnlocksPerPosting} candidate unlocks plus ${FLAT_FEE_PRICING.inmailsPerPosting} direct messages included per posting.`,
  `The free post is scoped to the employer's email domain rather than to a login: ${FREE_POST_SCOPE_NOTE}, and it runs ${FLAT_FEE_PRICING.freeDurationDays} days. A five-recruiter health system therefore gets one free post between all five, not one each — so a multi-role plan modelled here shows at most ${FLAT_FEE_PRICING.freePostsPerDomain} free posting and prices every other post at ${formatUsd(FLAT_FEE_PRICING.postingPrice)}.`,
  `Every figure for the sponsored-ad and agency channels is yours. We publish no typical cost per click, no typical contingency rate, no typical time-to-fill, and no typical applicant-to-hire ratio — we sell one side of this comparison, and a benchmark from us would not be evidence.`,
  `A channel with nothing entered is reported as not comparable, never as zero. A zero in a cost column would read as free.`,
  `The applicant-volume default of ${FLAT_FEE_PRICING.candidateUnlocksPerPosting} is the number of candidate unlocks a posting includes — a plan feature, not an expected response rate. Replace it with what your own postings draw.`,
  `Time-to-fill defaults to ${DEFAULT_TIME_TO_FILL_DAYS} days, which is the paid posting's run length rather than a market average, and it is applied identically to all three channels so the default cannot tilt the result. The vacancy overlay only affects anything once you enter a cost per day unfilled, which starts at zero.`,
  `First-year base — the figure an agency contingency rate is applied to — starts at the cited national median of ${STAT_SOURCES.averageSalary.formatted} (${FIRST_YEAR_BASE_SOURCE}). Replace it with your budgeted base.`,
];

const EXCLUSIONS: readonly string[] = [
  'Candidate quality and retention. A cheaper hire that leaves in four months is not cheaper, and this calculator cannot see that.',
  'Your own team\u2019s time. Screening, scheduling, and interviewing all cost money, and they differ sharply between channels — an agency fee buys screening work a posting does not.',
  'Any benchmark for what other employers pay per click, per applicant, or in agency fees. We do not have defensible figures for those and will not print undefensible ones.',
  'Sourcing tools, ATS subscriptions, careers-site costs, and referral bonuses. Add them as part of a channel\u2019s spend if you want them counted.',
  'Offer declines and backfills. Both raise real cost per hire, and both are specific to your process.',
];

const FAQS = [
  {
    q: 'How is cost per hire calculated?',
    a: `Total spend on a channel divided by the hires that channel produced. This calculator does that for three channels side by side and adds an optional overlay for the cost of the seat sitting empty: time-to-fill multiplied by what a day of vacancy costs you. It deliberately stops there. Formulas that fold in recruiter salaries, ATS licences, and overhead produce a bigger number that is harder to check and impossible to compare between employers — if you want those included, add them to a channel's spend yourself.`,
  },
  {
    q: 'Why does this not tell me the typical cost per hire in healthcare?',
    a: `Because we sell one of the channels being compared, and a benchmark published by an interested party is not evidence. Every industry cost-per-hire figure you will find comes from a survey with its own definition of which costs count, and quoting one here would let us pick the definition that flatters us. The comparison is built entirely from prices we can prove — ours — plus numbers you read off your own invoices and ATS.`,
  },
  {
    q: 'Is a flat-fee posting really cheaper than an agency?',
    a: `Not in the abstract, no — we sell one side of that comparison and we have not measured the other, so any margin we quoted you would be marketing rather than a finding. What we can hand you instead is the arithmetic. A contingency fee is a percentage of a first-year salary, so it scales with the salary; a posting is a fixed ${formatUsd(FLAT_FEE_PRICING.postingPrice)} per post that does not. The calculator totals our side from our published rates — posts, renewals, and the one free post per domain if it is still available — and prints that as the cost per hire your other channels have to beat, then applies your own contingency rate to your own base. The verdict is yours and it is about your roles. Spend is also not the whole comparison. A contingency agency does the sourcing and first-pass screening, carries the risk of not placing anyone, and is paid only on a hire; a posting puts the role in front of candidates and leaves the screening with you. The right question is not which is cheaper but whether the fee difference is worth more to you than the work it buys — which is why the calculator prints the number and then tells you what the number leaves out.`,
  },
  {
    q: 'What should I use for time-to-fill?',
    a: `Your own history, from the day a role opened to the day an offer was accepted. The field starts at ${DEFAULT_TIME_TO_FILL_DAYS} days only because that is how long a paid posting runs — it is a product fact standing in for a number we do not have, and it is applied to all three channels equally so it cannot favour one. Time-to-fill has no effect on the result until you enter what a day of vacancy costs you.`,
  },
  {
    q: 'How do I work out what a day of vacancy costs?',
    a: `Start with what you are actually spending to cover the gap: locum or agency coverage day rates, overtime for the staff absorbing the work, or the visit revenue the empty schedule is not generating. Whatever you use, it is your figure and only yours — the default is zero, and with it at zero the vacancy columns stay switched off rather than showing an invented cost.`,
  },
  {
    q: `What does a posting include?`,
    a: `A paid post runs ${FLAT_FEE_PRICING.paidDurationDays} days at ${formatUsd(FLAT_FEE_PRICING.postingPrice)}, is featured, and includes ${FLAT_FEE_PRICING.candidateUnlocksPerPosting} candidate profile unlocks and ${FLAT_FEE_PRICING.inmailsPerPosting} direct messages. Renewing costs ${formatUsd(FLAT_FEE_PRICING.renewalPrice)}. Those are the prices in the calculator, read from the same config the checkout uses, so they cannot drift from what you would actually be charged.`,
  },
  {
    q: `Who exactly gets the free post?`,
    a: `Your employer email domain does, not your login: ${FREE_POST_SCOPE_NOTE}. It runs ${FLAT_FEE_PRICING.freeDurationDays} days rather than the ${FLAT_FEE_PRICING.paidDurationDays} a paid post gets, and it does not reset for each new recruiter who signs up — if a health system with five recruiters fills five roles, one of those posts is free and the other four are ${formatUsd(FLAT_FEE_PRICING.postingPrice)} each. That matters when you model a multi-role plan here, so untick the free-post box in the calculator if anyone at your domain has already used it.`,
  },
] as const;

const jsonLd = (obj: object): string =>
  JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

export default function CostPerHireCalculatorPage() {
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
            applicationCategory: 'BusinessApplication',
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
            { label: 'Cost Per Hire' },
          ]} />
          <div style={{ maxWidth: '760px' }}>
            <p style={{ fontSize: '13px', fontWeight: 600, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '10px' }}>
              For Employers
            </p>
            <h1 className="font-lora" style={{ fontSize: 'clamp(2rem, 4.4vw, 2.9rem)', fontWeight: 800, lineHeight: 1.12, color: '#1A2E35', margin: '0 0 16px' }}>
              What a hire actually costs you
            </h1>
            <p style={{ fontSize: '17px', color: '#5A4A42', lineHeight: 1.65, margin: 0 }}>
              A flat-fee posting, sponsored ads, and an agency search, side by side on cost per applicant and cost
              per hire — with an optional overlay for what the empty seat is costing while you wait.
            </p>
            <p style={{ fontSize: '13.5px', color: '#7A6A62', margin: '16px 0 0', lineHeight: 1.6 }}>
              <strong>We sell postings, so we publish no benchmarks.</strong> Our prices are filled in because we can
              prove them; every figure for the other two channels comes from your invoices, and a channel you leave
              empty says &ldquo;not comparable&rdquo; instead of showing a zero.
            </p>
          </div>
        </section>
      </div>

      <section style={{ background: TOOL_PANEL_BG, padding: '44px 20px 56px' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
          <EmployerCostPerHireCalculator />
        </div>
      </section>

      <section style={{ background: '#FFF', padding: '56px 20px' }}>
        <div style={{ maxWidth: '860px', margin: '0 auto' }}>
          <AssumptionsPanel
            title="How this comparison is built"
            intro="One channel here is ours. That is exactly why the method is spelled out: you should be able to check every number we assert and replace every number we do not."
            assumptions={ASSUMPTIONS}
            exclusions={EXCLUSIONS}
            sources={[
              { label: `${brand.name} pricing — the rates in the flat-fee column`, url: '/pricing' },
              { label: 'Posted-pay benchmark by state, from live listings', url: '/tools/salary-benchmark' },
              { label: STAT_SOURCES.averageSalary.source, url: STAT_SOURCES.averageSalary.sourceUrl },
            ]}
          />
        </div>
      </section>

      <section style={{ background: TOOL_HERO_BG, padding: '64px 20px' }}>
        <div style={{ maxWidth: '760px', margin: '0 auto' }}>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 32px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '28px' }}>
            Questions about hiring cost
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
            Next steps for hiring teams
          </h2>
          <div className="tool-three-col" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
            {[
              { href: '/tools/salary-benchmark', title: 'Salary benchmark', blurb: 'Median and quartile posted pay by state, before you set a range.' },
              { href: '/pricing', title: 'Pricing', blurb: 'The rates this calculator uses, in full.' },
              { href: '/for-employers/resources/how-to-hire', title: 'How to hire guide', blurb: 'Screening, interviewing, and offer mechanics for these roles.' },
              { href: '/post-job', title: 'Post a role', blurb: 'Your organization’s first posting is free.' },
              { href: '/for-employers', title: 'For employers', blurb: 'What the board does for hiring teams.' },
              { href: '/for-employers/resources', title: 'Employer resources', blurb: 'Templates, guides, and benchmarks in one place.' },
            ].map((l) => (
              <Link key={l.href} href={l.href} className="tool-card" style={{ ...clayCard, padding: '20px 20px 18px', textDecoration: 'none', display: 'block' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <Briefcase size={15} color={TOOL_ACCENT} aria-hidden="true" />
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
