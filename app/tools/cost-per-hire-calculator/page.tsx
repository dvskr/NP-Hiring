/**
 * Employer cost-per-hire calculator (P3 #6b) — indexable tool route.
 *
 * The arithmetic and every price live in
 * components/tools/cost-per-hire-model.ts, which reads our own pricing from
 * lib/config.ts. This route is metadata, schema, visible assumptions, and
 * cross-links only.
 *
 * LAUNCH-PROMO CLOCK (backlog 2.1): the method notes, the FAQ (and its
 * JSON-LD), the calculator's ways to buy and the post-a-role card state the
 * promo while it runs and the ladder as the current price once it has
 * ended, when the promo mode is not offered at all. The page decides the
 * phase per render (pricingPhase), hands it to the client calculator so its
 * server HTML and hydrated state agree, builds its copy from
 * ./cost-per-hire-copy.ts, and re-renders hourly, so the switch needs no
 * deploy.
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
 *    exactly as enforced: the launch promo is a dated window in which every
 *    post is free (config.isPromoActive), and from the ladder start the
 *    intro price is one post per employer email DOMAIN, lifetime, shared
 *    across every employee at that domain (lib/pricing.ts#getNextPaidTier
 *    counts paid rows against EmployerJob.quotaDomain). "Per account" would
 *    overstate the discount and understate a multi-recruiter employer's real
 *    spend. The Employer plan is priced as concurrent plans × months.
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
import { pricingPhase } from '@/components/tools/cost-per-hire-model';
import { TOOL_ACCENT, TOOL_PAGE_CSS, TOOL_HERO_BG, TOOL_PANEL_BG, clayCard } from '@/components/tools/tool-theme';
import { STAT_SOURCES } from '@/lib/stats-sources';
import { costPerHireAssumptions, costPerHireFaqs, postRoleBlurb } from './cost-per-hire-copy';

// The method notes, the FAQ and its JSON-LD, the calculator's ways to buy and
// the post-a-role card follow the launch-promo clock: re-render hourly so they
// switch to the paid ladder without a deploy when the promo ends.
export const revalidate = 3600;

const PAGE_PATH = '/tools/cost-per-hire-calculator';
const PAGE_URL = `${brand.baseUrl}${PAGE_PATH}`;
const PAGE_TITLE = `Cost Per Hire Calculator | Flat-Fee Posting vs Sponsored Ads vs Agency`;
const PAGE_DESCRIPTION = `Work out your real cost per hire for a ${brand.niche.short} role: a flat-fee posting priced from our published rates against sponsored-ad spend and an agency contingency fee, using your own applicant volume and time-to-fill. No industry benchmarks: every alternative figure is one you enter.`;
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

const EXCLUSIONS: readonly string[] = [
  'Candidate quality and retention. A cheaper hire that leaves in four months is not cheaper, and this calculator cannot see that.',
  'Your own team\u2019s time. Screening, scheduling, and interviewing all cost money, and they differ sharply between channels: an agency fee buys screening work that a posting does not.',
  'Any benchmark for what other employers pay per click, per applicant, or in agency fees. We do not have defensible figures for those and will not print indefensible ones.',
  'Sourcing tools, ATS subscriptions, careers-site costs, and referral bonuses. Add them as part of a channel\u2019s spend if you want them counted.',
  'Offer declines and backfills. Both raise real cost per hire, and both are specific to your process.',
];

const jsonLd = (obj: object): string =>
  JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

export default function CostPerHireCalculatorPage() {
  // Decided per render, never at module load (lib/pricing-copy.ts explains
  // why), and handed to the client calculator so its server HTML and its
  // hydrated state agree. One FAQS list feeds the accordion and the JSON-LD.
  const phase = pricingPhase(new Date());
  const ASSUMPTIONS = costPerHireAssumptions(phase);
  const FAQS = costPerHireFaqs(phase);
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
              per hire, with an optional overlay for what the empty seat costs while you wait.
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
          <EmployerCostPerHireCalculator phase={phase} />
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
              { label: `${brand.name} pricing: the rates in the flat-fee column`, url: '/pricing' },
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
              { href: '/post-job', title: 'Post a role', blurb: postRoleBlurb(phase) },
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
