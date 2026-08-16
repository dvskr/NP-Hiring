/**
 * Cost-of-living adjusted city-vs-city salary comparator (P2 #5).
 *
 * DATA PROVENANCE
 *  - Nominal pay: live aggregation over published postings on this board.
 *    `salaryIsEstimated` rows are EXCLUDED for the same reason
 *    app/companies/[slug]/page.tsx excludes them — three production codepaths
 *    write LLM-inferred or clamped numbers into normalizedMin/MaxSalary and
 *    flag the row instead of nulling it, so aggregating them would publish an
 *    invented pay figure attributed to a named city.
 *  - Cost-of-living index: this board's city dataset (lib/pseo/city-data),
 *    4,135 cities, 100 = national average. Labelled as our dataset rather
 *    than attributed to an external index we cannot verify.
 *  - Adjustment formula: identical to the one the pSEO aggregation cron uses
 *    for `pseoStats.colAdjustedSalary` — see components/tools/col-model.ts.
 */
import { brand } from '@/config/brand';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, HelpCircle, MapPin } from 'lucide-react';
import Breadcrumbs from '@/components/Breadcrumbs';
import AssumptionsPanel from '@/components/tools/AssumptionsPanel';
import CostOfLivingComparator from '@/components/tools/CostOfLivingComparator';
import {
  buildCityOptions,
  pickDefaultPair,
  resolveCitySlug,
  type CityOption,
  type SalaryAggregate,
} from '@/components/tools/city-picker-data';
import { CITY_SAMPLE_THRESHOLD } from '@/components/tools/col-model';
import { TOOL_ACCENT, TOOL_PAGE_CSS, TOOL_HERO_BG, TOOL_PANEL_BG, clayCard } from '@/components/tools/tool-theme';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

export const revalidate = 86400;

/** Largest cities per state always offered in the picker. */
const CITIES_PER_STATE = 15;

const PAGE_PATH = '/tools/cost-of-living-comparison';
const PAGE_URL = `${brand.baseUrl}${PAGE_PATH}`;
const PAGE_TITLE = `Cost of Living Salary Comparison for ${brand.niche.short}s — City vs City`;
const PAGE_DESCRIPTION = `Compare ${brand.niche.short} pay between two cities in real terms. Posted salary, cost-of-living index, and what the money is actually worth — so a bigger offer in a pricier city stops looking like a raise.`;
const OG_IMAGE = `${brand.baseUrl}/api/og?title=${encodeURIComponent('Cost of Living Salary Comparison')}&type=page`;

export const metadata: Metadata = {
  // P7 runtime fix D7: root layout template appends `| ${brand.name}`.
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  keywords: [
    `${brand.niche.short.toLowerCase()} salary cost of living comparison`,
    `${brand.niche.descriptor} pay by city`,
    'cost of living adjusted salary calculator',
    `${brand.niche.short.toLowerCase()} relocation salary`,
    'city vs city salary comparison',
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

const SALARY_WHERE = {
  isPublished: true,
  salaryIsEstimated: false,
  state: { not: null },
  normalizedMinSalary: { not: null },
  normalizedMaxSalary: { not: null },
} as const;

interface ComparatorData {
  options: CityOption[];
  defaultPair: readonly [string, string] | null;
  statesCovered: number;
  postingsCounted: number;
}

const EMPTY_DATA: ComparatorData = { options: [], defaultPair: null, statesCovered: 0, postingsCounted: 0 };

function midpoint(min: number | null, max: number | null): number {
  return Math.round(((min ?? 0) + (max ?? min ?? 0)) / 2);
}

async function loadComparatorData(): Promise<ComparatorData> {
  try {
    const [stateRows, cityRows] = await Promise.all([
      prisma.job.groupBy({
        by: ['state'],
        where: SALARY_WHERE,
        _avg: { normalizedMinSalary: true, normalizedMaxSalary: true },
        _count: { id: true },
      }),
      prisma.job.groupBy({
        by: ['city', 'state'],
        where: { ...SALARY_WHERE, city: { not: null } },
        _avg: { normalizedMinSalary: true, normalizedMaxSalary: true },
        _count: { id: true },
      }),
    ]);

    const stateNominals = new Map<string, SalaryAggregate>();
    let postingsCounted = 0;
    for (const row of stateRows) {
      if (!row.state) continue;
      const nominal = midpoint(row._avg.normalizedMinSalary, row._avg.normalizedMaxSalary);
      if (nominal <= 0) continue;
      stateNominals.set(row.state, { nominal, sample: row._count.id });
      postingsCounted += row._count.id;
    }

    const cityNominals = new Map<string, SalaryAggregate>();
    for (const row of cityRows) {
      if (row._count.id < CITY_SAMPLE_THRESHOLD) continue;
      const slug = resolveCitySlug(row.city, row.state);
      if (!slug) continue;
      const nominal = midpoint(row._avg.normalizedMinSalary, row._avg.normalizedMaxSalary);
      if (nominal <= 0) continue;
      cityNominals.set(slug, { nominal, sample: row._count.id });
    }

    const options = buildCityOptions({ perState: CITIES_PER_STATE, cityNominals, stateNominals });
    return {
      options,
      defaultPair: pickDefaultPair(options),
      statesCovered: stateNominals.size,
      postingsCounted,
    };
  } catch (error) {
    // The tool still explains its method with an empty picker; a failed
    // aggregation must not take the route down.
    logger.error('[tools/cost-of-living] salary aggregation failed', error);
    return EMPTY_DATA;
  }
}

const FAQS = [
  {
    q: 'How is a cost-of-living adjusted salary calculated?',
    a: `Divide the national-average index (100) by the city's index and multiply the salary by the result. A $140,000 salary in a city indexed at 140 is worth $100,000 in national-average dollars; the same salary in a city indexed at 90 is worth about $155,600. This comparator uses exactly the formula the rest of this site uses for cost-of-living adjusted pay. It is stricter about its inputs, though: this tool counts only postings where the employer disclosed a pay range, while our city and state pages also include listings whose pay we inferred. So for a city carrying inferred-pay listings, the nominal figure here can differ from the one on its own city page even though the adjustment is identical.`,
  },
  {
    q: 'Where does the salary data come from?',
    a: `Live postings on this board. Where a city has at least ${CITY_SAMPLE_THRESHOLD} published listings that disclose a pay range, we average those postings' midpoints; below that threshold the state average stands in, and each column tells you which basis it used and how many postings sit behind it. Listings whose pay was inferred rather than posted are excluded entirely.`,
  },
  {
    q: 'Does a higher salary in an expensive city still come out ahead?',
    a: `Often not, and that is the point of the tool. Pay differences between metros are frequently smaller than the cost-of-living gap between them, so the larger nominal offer can buy less. When that happens here, the headline says so directly and shows what the second city would have to pay to match.`,
  },
  {
    q: 'Does this include state income tax?',
    a: `No. The cost-of-living index covers living costs — housing, groceries, utilities, transport, healthcare — not income tax. A state with no income tax can improve your real position beyond what this comparison shows, and a high-tax state can erode it. Treat the result as a living-costs comparison and layer tax on separately.`,
  },
  {
    q: 'Can I use this to negotiate a relocation offer?',
    a: `That is the strongest use of it. The "to match purchasing power" figure gives you a specific number to bring to the conversation: this is what the new city has to pay for the move to be financially neutral. Pair it with the state pay pages linked from each column for a second reference point.`,
  },
] as const;

const jsonLd = (obj: object): string =>
  JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

export default async function CostOfLivingComparisonPage() {
  const data = await loadComparatorData();

  const assumptions: readonly string[] = [
    'Nominal pay is the average midpoint of published postings on this board that disclose a salary range. Postings whose pay was inferred rather than posted by the employer are excluded.',
    `A city uses its own postings when it has at least ${CITY_SAMPLE_THRESHOLD} of them with disclosed pay; otherwise the state average stands in. Each column states which basis it used and the sample size behind it.`,
    'The cost-of-living index comes from this site’s city dataset, where 100 is the national average. It covers living costs — housing, groceries, utilities, transport, healthcare — not taxes.',
    'The adjusted figure is nominal pay multiplied by (100 ÷ the city’s index), the same formula used for cost-of-living adjusted pay across the rest of this site.',
    'The picker carries the largest cities in each state plus every city with enough postings of its own to beat the state average.',
  ];

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
        <section style={{ maxWidth: '1180px', margin: '0 auto', padding: '32px 20px 56px' }}>
          <Breadcrumbs items={[
            { label: 'Home', href: '/' },
            { label: 'Tools', href: '/tools' },
            { label: 'Cost-of-Living Comparison' },
          ]} />
          <div style={{ maxWidth: '760px' }}>
            <p style={{ fontSize: '13px', fontWeight: 600, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '10px' }}>
              Free Tool
            </p>
            <h1 className="font-lora" style={{ fontSize: 'clamp(2rem, 4.4vw, 2.9rem)', fontWeight: 800, lineHeight: 1.12, color: '#1A2E35', margin: '0 0 16px' }}>
              City vs city, in real terms
            </h1>
            <p style={{ fontSize: '17px', color: '#5A4A42', lineHeight: 1.65, margin: 0 }}>
              A $15,000 raise that comes with a 30% jump in living costs is a pay cut. Put two cities side by
              side and see posted {brand.niche.short} pay, the cost-of-living gap, and what each salary is
              actually worth — plus the number the second city would have to hit to break even.
            </p>
            {data.postingsCounted > 0 && (
              <p style={{ fontSize: '13px', color: '#7A6A62', margin: '16px 0 0' }}>
                Built from {data.postingsCounted.toLocaleString('en-US')} published postings with disclosed pay
                across {data.statesCovered} states.
              </p>
            )}
          </div>
        </section>
      </div>

      <section style={{ background: TOOL_PANEL_BG, padding: '48px 20px 56px' }}>
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
          {data.options.length === 0 ? (
            <div style={{ ...clayCard, padding: '40px 28px', textAlign: 'center' }}>
              <p style={{ fontSize: '16px', fontWeight: 700, color: '#1A2E35', margin: '0 0 8px' }}>
                Comparison data is unavailable right now
              </p>
              <p style={{ fontSize: '14px', color: '#5A4A42', margin: '0 0 18px', lineHeight: 1.6 }}>
                We only show pay figures we can trace to live postings, so the comparator stays empty rather
                than guessing. The state pay pages below are built from the same data.
              </p>
              <Link
                href="/salary-guide"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '12px 22px', borderRadius: '12px', background: TOOL_ACCENT, color: '#fff', fontSize: '14px', fontWeight: 700, textDecoration: 'none' }}
              >
                Open the salary guide <ArrowRight size={15} />
              </Link>
            </div>
          ) : (
            <CostOfLivingComparator options={data.options} defaultPair={data.defaultPair} />
          )}
        </div>
      </section>

      <section style={{ background: '#FFF', padding: '56px 20px' }}>
        <div style={{ maxWidth: '860px', margin: '0 auto' }}>
          <AssumptionsPanel
            title="How this comparison is built"
            intro="Two numbers drive everything on this page: what postings in each city actually pay, and how far a dollar goes there. Here is where each comes from."
            assumptions={assumptions}
            exclusions={[
              'Income tax of any kind. The index measures living costs, not what a state or city withholds — a no-income-tax state will do better than this comparison implies.',
              'Your own housing situation. Cost-of-living indices assume an average household; if you own outright, rent below market, or commute in from outside the metro, your real gap will differ.',
              'Employer benefits, shift differentials, and bonuses. Only the posted base range feeds these figures.',
            ]}
            sources={[
              { label: `${brand.name} salary guide — state pay from live postings`, url: '/salary-guide' },
              { label: 'Browse jobs by location', url: '/jobs/locations' },
            ]}
          />
        </div>
      </section>

      <section style={{ background: TOOL_HERO_BG, padding: '64px 20px' }}>
        <div style={{ maxWidth: '760px', margin: '0 auto' }}>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 32px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '28px' }}>
            Questions about relocating
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
              { href: '/salary-guide', title: `${brand.niche.short} salary guide`, blurb: 'State-by-state pay with an interactive estimator.' },
              { href: '/jobs/locations', title: 'Jobs by location', blurb: 'Every state and metro we currently carry listings for.' },
              { href: '/tools/1099-vs-w2-calculator', title: '1099 vs W-2 calculator', blurb: 'What a contract rate is worth after self-employment tax.' },
              { href: '/tools/licensure-checker', title: 'Licensure checker', blurb: 'Requirements, practice authority, and timeline by state.' },
              { href: '/jobs/remote', title: 'Remote roles', blurb: 'Where the cost-of-living arbitrage actually lives.' },
              { href: '/jobs/travel', title: 'Travel roles', blurb: 'Assignment work across multiple markets.' },
            ].map((l) => (
              <Link key={l.href} href={l.href} className="tool-card" style={{ ...clayCard, padding: '20px 20px 18px', textDecoration: 'none', display: 'block' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <MapPin size={15} color={TOOL_ACCENT} aria-hidden="true" />
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
