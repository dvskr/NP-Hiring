/**
 * Employer salary-benchmark tool (P2 #17) — indexable route.
 *
 * "What should I pay in <state>?" answered from live published postings.
 * The aggregation and its public-safety thresholds live in
 * components/tools/EmployerBenchmarkWidget.tsx and benchmark-model.ts; this
 * route is metadata, schema, visible method, and cross-links.
 */
import { brand } from '@/config/brand';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, BarChart3, HelpCircle } from 'lucide-react';
import Breadcrumbs from '@/components/Breadcrumbs';
import AssumptionsPanel from '@/components/tools/AssumptionsPanel';
import EmployerBenchmarkWidget from '@/components/tools/EmployerBenchmarkWidget';
import { BENCHMARK_MIN_EMPLOYERS, BENCHMARK_MIN_POSTINGS } from '@/components/tools/benchmark-model';
import { TOOL_ACCENT, TOOL_PAGE_CSS, TOOL_HERO_BG, TOOL_PANEL_BG, clayCard } from '@/components/tools/tool-theme';
import { STAT_SOURCES } from '@/lib/stats-sources';

export const revalidate = 86400;

const PAGE_PATH = '/tools/salary-benchmark';
const PAGE_URL = `${brand.baseUrl}${PAGE_PATH}`;
const PAGE_TITLE = `What Should I Pay a ${brand.niche.long}? Salary Benchmark by State`;
const PAGE_DESCRIPTION = `Free salary benchmark for employers hiring ${brand.niche.descriptor}s: median and 25th–75th percentile posted pay by state, from live listings. Check a planned offer against the market before you post.`;
const OG_IMAGE = `${brand.baseUrl}/api/og?title=${encodeURIComponent(`What should I pay a ${brand.niche.long}?`)}&type=page`;

export const metadata: Metadata = {
  // P7 runtime fix D7: root layout template appends `| ${brand.name}`.
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  keywords: [
    `what should i pay a ${brand.niche.descriptor}`,
    `${brand.niche.short.toLowerCase()} salary benchmark by state`,
    `${brand.niche.descriptor} compensation benchmark`,
    `hiring ${brand.niche.short.toLowerCase()} salary range`,
    `${brand.niche.short.toLowerCase()} pay transparency range`,
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

const FAQS = [
  {
    q: `What should I pay a ${brand.niche.descriptor}?`,
    a: `Start from the median posted salary for your state in the tool above, then adjust for the things a median cannot see: setting, specialty, shift pattern, call burden, experience floor, and how quickly you need the seat filled. The 25th-to-75th percentile band is the practical decision range — below the 25th you are competing on something other than pay, and above the 75th you are buying speed. For national context, the BLS median annual wage for ${brand.niche.descriptor}s is ${STAT_SOURCES.averageSalary.formatted} (${STAT_SOURCES.averageSalary.source}).`,
  },
  {
    q: 'Where does this benchmark data come from?',
    a: `Published listings on this board that disclose a salary range. We take each posting's range midpoint, then report the median and the 25th and 75th percentiles per state. Listings whose pay was inferred rather than posted by the employer are excluded, so every figure traces to a range a real employer chose to publish.`,
  },
  {
    q: 'Why is my state missing from the dropdown?',
    a: `Because it has not cleared the disclosure threshold yet. A state is published only when it has at least ${BENCHMARK_MIN_POSTINGS} salaried postings from at least ${BENCHMARK_MIN_EMPLOYERS} distinct employers — otherwise the "benchmark" would just be one organisation's pay scale made public. Use the national figure in the meantime.`,
  },
  {
    q: 'Is this posted pay or accepted pay?',
    a: `Posted pay. It reflects what employers advertise, not what candidates ultimately sign for, and it excludes bonuses, shift differentials, productivity incentives, retirement match, and the value of benefits. Treat it as the number your posting will be compared against by candidates browsing the same market.`,
  },
  {
    q: 'Should I put the range in the job posting?',
    a: `Yes, and in many states you are legally required to. Beyond compliance, a visible range filters out mismatched expectations before the first screen and is one of the few posting changes that reliably improves applicant volume. If your range sits below the market band here, publishing it alongside what you do offer — schedule, autonomy, support ratio — beats hiding it.`,
  },
] as const;

const jsonLd = (obj: object): string =>
  JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

export default function SalaryBenchmarkPage() {
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
        <section style={{ maxWidth: '1180px', margin: '0 auto', padding: '32px 20px 56px' }}>
          <Breadcrumbs items={[
            { label: 'Home', href: '/' },
            { label: 'Tools', href: '/tools' },
            { label: 'Salary Benchmark' },
          ]} />
          <div style={{ maxWidth: '760px' }}>
            <p style={{ fontSize: '13px', fontWeight: 600, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '10px' }}>
              Free Tool · For Employers
            </p>
            <h1 className="font-lora" style={{ fontSize: 'clamp(2rem, 4.4vw, 2.9rem)', fontWeight: 800, lineHeight: 1.12, color: '#1A2E35', margin: '0 0 16px' }}>
              What should I pay a {brand.niche.long}?
            </h1>
            <p style={{ fontSize: '17px', color: '#5A4A42', lineHeight: 1.65, margin: 0 }}>
              Median and 25th–75th percentile posted pay by state, straight from live listings. Pick a state,
              drop in the number you had in mind, and see where it lands before candidates do.
            </p>
          </div>
        </section>
      </div>

      <section style={{ background: TOOL_PANEL_BG, padding: '48px 20px 56px' }}>
        <div style={{ maxWidth: '820px', margin: '0 auto' }}>
          <EmployerBenchmarkWidget />
        </div>
      </section>

      <section style={{ background: '#FFF', padding: '56px 20px' }}>
        <div style={{ maxWidth: '860px', margin: '0 auto' }}>
          <AssumptionsPanel
            title="How this benchmark is built"
            intro="A pay benchmark is only useful if you know what went into it. This one is deliberately narrow, and it withholds figures rather than publishing thin ones."
            assumptions={[
              'Each posting contributes the midpoint of its disclosed salary range. We report the median plus the 25th and 75th percentiles of those midpoints.',
              `A state is published only when it has at least ${BENCHMARK_MIN_POSTINGS} salaried postings from at least ${BENCHMARK_MIN_EMPLOYERS} distinct employers, so no single employer's pay scale can be read out of an aggregate.`,
              'Listings whose pay was inferred rather than posted by the employer are excluded entirely.',
              'Figures refresh daily from live published listings on this board.',
              `National context comes from ${STAT_SOURCES.averageSalary.source}: a median annual wage of ${STAT_SOURCES.averageSalary.formatted}.`,
            ]}
            exclusions={[
              'Accepted offers and negotiated outcomes. This is advertised pay, not signed pay.',
              'Bonuses, sign-on payments, shift and weekend differentials, productivity incentives, relocation, retirement match, and the cash value of benefits.',
              'Any employer-identifying detail. The tool never exposes which employers sit behind a figure, and per-employer analytics stay behind the employer dashboard login.',
              'Specialty, setting, and experience segmentation. State-level medians pool an entire market; use them as a starting anchor, not a final number.',
            ]}
            sources={[
              { label: STAT_SOURCES.averageSalary.source, url: STAT_SOURCES.averageSalary.sourceUrl },
              { label: `${brand.name} salary guide — state pay from live postings`, url: '/salary-guide' },
              { label: `How to hire a ${brand.niche.long}`, url: '/for-employers/resources/how-to-hire' },
            ]}
          />
        </div>
      </section>

      <section style={{ background: TOOL_HERO_BG, padding: '64px 20px' }}>
        <div style={{ maxWidth: '760px', margin: '0 auto' }}>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 32px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '28px' }}>
            Employer questions
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
            Keep going
          </h2>
          <div className="tool-three-col" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
            {[
              { href: '/for-employers/resources/how-to-hire', title: `How to hire a ${brand.niche.long}`, blurb: 'Process, credential checks, and a realistic timeline.' },
              { href: '/for-employers/resources/job-description-templates', title: 'Job description templates', blurb: 'Setting-specific skeletons you can post today.' },
              { href: '/post-job', title: 'Post a role', blurb: 'First post free, all features included.' },
              { href: '/for-employers', title: 'For employers', blurb: 'Pricing, reach, and what a post includes.' },
              { href: '/salary-guide', title: `${brand.niche.short} salary guide`, blurb: 'The candidate-facing view of the same market data.' },
              { href: '/tools/cost-of-living-comparison', title: 'Cost-of-living comparator', blurb: 'Why the same salary lands differently in two markets.' },
            ].map((l) => (
              <Link key={l.href} href={l.href} className="tool-card" style={{ ...clayCard, padding: '20px 20px 18px', textDecoration: 'none', display: 'block' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <BarChart3 size={15} color={TOOL_ACCENT} aria-hidden="true" />
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
