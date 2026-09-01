/**
 * Standalone licensure checker + multi-state planner (P2 #6).
 *
 * The checker itself was previously reachable only by scrolling into the
 * middle of /resources, which gave a genuinely useful tool no indexable home
 * and no chance of ranking for licensure queries. This route is that home;
 * /resources keeps its embedded copy.
 *
 * DATA PROVENANCE (all read-only imports — nothing is re-typed here)
 *  - Practice authority: lib/state-practice-authority.ts (AANP).
 *  - State salary: live aggregation over published postings.
 *  - State guide slugs: published state_spotlight posts.
 *
 * NOT USED HERE, DELIBERATELY: LICENSE_GUIDE_NLC_NON_MEMBERS from
 * lib/blog-license-guides.ts. This page used to derive a per-state compact
 * verdict and a "{n} of 51 jurisdictions are compact members" headline from
 * that set. The set is inaccurate in both directions (it omits Alaska, a
 * non-member, and lists Connecticut, Rhode Island and Washington as
 * non-members when all three are members), and the drift test guarding it only
 * proves its two copies agree with each other. See the long note at the top of
 * components/tools/MultiStatePlanner.tsx. Nothing on this route may reintroduce
 * a per-state membership claim until the shared dataset is re-verified against
 * NCSBN by its owner.
 */
import { brand } from '@/config/brand';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, ClipboardCheck, HelpCircle } from 'lucide-react';
import Breadcrumbs from '@/components/Breadcrumbs';
import LicensureChecker from '@/components/LicensureChecker';
import AssumptionsPanel from '@/components/tools/AssumptionsPanel';
import MultiStatePlanner, { type PlannerState } from '@/components/tools/MultiStatePlanner';
import { TOOL_ACCENT, TOOL_PAGE_CSS, TOOL_HERO_BG, TOOL_PANEL_BG, clayCard } from '@/components/tools/tool-theme';
import { LICENSE_GUIDE_SLUG_REGEX } from '@/config/niche/content-map';
import { prisma } from '@/lib/prisma';
import { getGatedStateBenchmarks } from '@/lib/salary-analytics';
import { logger } from '@/lib/logger';
import { STATE_PRACTICE_AUTHORITY } from '@/lib/state-practice-authority';
import { STAT_SOURCES } from '@/lib/stats-sources';

export const revalidate = 86400;

const PAGE_PATH = '/tools/licensure-checker';
const PAGE_URL = `${brand.baseUrl}${PAGE_PATH}`;
const PAGE_TITLE = `${brand.niche.short} Licensure Checker & Multi-State Planner`;
const PAGE_DESCRIPTION = `Check ${brand.niche.short} licensure requirements, practice authority, and salary for any state — then line up every state you are considering side by side, with each one's licensure guide and how the Nurse Licensure Compact does and does not apply.`;
const OG_IMAGE = `${brand.baseUrl}/api/og?title=${encodeURIComponent(`${brand.niche.short} Licensure Checker`)}&type=page`;

export const metadata: Metadata = {
  // P7 runtime fix D7: root layout template appends `| ${brand.name}`.
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  keywords: [
    `${brand.niche.short.toLowerCase()} licensure by state`,
    `${brand.niche.descriptor} license requirements`,
    'nurse licensure compact states',
    `${brand.niche.short.toLowerCase()} multi state license`,
    `${brand.niche.short.toLowerCase()} full practice authority states`,
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

interface StateGuideRef {
  name: string;
  slug: string;
}

/**
 * P9 #2c/#2d: gated benchmark row (true median + quartiles over the
 * NP-eligible analytics pool) — matches LicensureChecker's StateSalary
 * shape. Only states past the n ≥ 5 / 3-employer publishing gate appear;
 * the checker omits the salary card for the rest.
 */
interface StateSalaryRow {
  state: string;
  medianSalary: number;
  p25: number;
  p75: number;
  jobCount: number;
}

interface CheckerData {
  stateGuides: StateGuideRef[];
  stateSalaries: StateSalaryRow[];
}

const EMPTY_CHECKER_DATA: CheckerData = { stateGuides: [], stateSalaries: [] };

/** Title-cases a hyphenated state fragment from a licensure-guide slug. */
function titleCaseSlugFragment(fragment: string): string {
  return fragment
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

async function loadCheckerData(): Promise<CheckerData> {
  try {
    const [guidePosts, benchmarkRows] = await Promise.all([
      prisma.blogPost.findMany({
        where: { status: 'published', category: 'state_spotlight' },
        select: { slug: true },
      }),
      // P9 #2c/#2d: gated per-state medians — replaces the old `_avg`
      // mean-of-min/max over every published row (psychiatrist/PA pay and
      // estimated rows included), which this tool then divided by 2080 and
      // republished as an hourly figure too.
      getGatedStateBenchmarks(),
    ]);

    // Deduplicate: some states carry a "-2" copy of their guide.
    const guideByState = new Map<string, string>();
    for (const post of guidePosts) {
      const match = post.slug.match(LICENSE_GUIDE_SLUG_REGEX);
      if (!match) continue;
      const name = titleCaseSlugFragment(match[1].replace(/-\d+$/, ''));
      if (!guideByState.has(name)) guideByState.set(name, post.slug);
    }

    const stateSalaries: StateSalaryRow[] = benchmarkRows
      .map((row) => ({
        state: row.scope,
        medianSalary: row.median,
        p25: row.p25,
        p75: row.p75,
        jobCount: row.postings,
      }))
      .sort((a, b) => b.medianSalary - a.medianSalary);

    return {
      stateGuides: [...guideByState.entries()]
        .map(([name, slug]) => ({ name, slug }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      stateSalaries,
    };
  } catch (error) {
    // Practice-authority data is static, so the tools still work without live
    // salary or guide links.
    logger.error('[tools/licensure-checker] checker data load failed', error);
    return EMPTY_CHECKER_DATA;
  }
}

/** Planner rows derive from the sourced practice-authority data plus guide slugs. */
function buildPlannerStates(guides: readonly StateGuideRef[]): PlannerState[] {
  const guideByName = new Map(guides.map((g) => [g.name, g.slug]));
  return Object.entries(STATE_PRACTICE_AUTHORITY)
    .map(([name, info]) => ({
      name,
      authority: info.authority,
      guideSlug: guideByName.get(name) ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const FAQS = [
  {
    q: 'Does a compact nursing license let me practise as an APRN in another state?',
    a: `No. The Nurse Licensure Compact covers the RN license that underpins your APRN credential, not the APRN credential itself. Every state issues its own APRN license, so adding a state always means an APRN application to that state's board — the compact only removes the separate RN endorsement step, and only between member states.`,
  },
  {
    q: 'What decides whether I can hold a multistate RN license?',
    a: `Your primary state of residence. Only a compact member state can issue a multistate license, so if you live in a non-member state you have no multistate privilege to carry anywhere, regardless of where you want to work. Check your home state against NCSBN's current member list before you plan around it — jurisdictions join and switch on their own timelines, and this page deliberately does not keep its own copy of that list.`,
  },
  {
    q: `How many states grant ${brand.niche.short}s full practice authority?`,
    a: `${STAT_SOURCES.fullPracticeStates.formatted}, according to ${STAT_SOURCES.fullPracticeStates.source} (as of ${STAT_SOURCES.fullPracticeStates.asOf}). In full-practice states you can evaluate, diagnose, prescribe, and manage treatment without a physician agreement. Reduced-practice states require a collaborative agreement and restricted-practice states require physician supervision — the checker labels each state and the planner totals them across your selection.`,
  },
  {
    q: 'How long does licensure take, and what does it cost?',
    a: `That varies by state and by your own file, and we do not publish figures we cannot keep current for 51 jurisdictions. The checker shows a broad timeline band tied to practice-authority tier as a planning aid only — for fees, processing times, CE hours, and renewal cycles, go to the state board of nursing, which is the authoritative source.`,
  },
  {
    q: 'Which states should I add first if I want telehealth or travel work?',
    a: `If you live in a compact member state, the cheapest additions are other member states: the RN layer is already covered, so each one is an APRN application rather than two — confirm both ends against NCSBN's current member list. After that, weigh practice authority. A full-practice state removes the collaborative-agreement dependency entirely, which matters more for telehealth caseloads than for on-site roles.`,
  },
] as const;

const jsonLd = (obj: object): string =>
  JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

export default async function LicensureCheckerToolPage() {
  const { stateGuides, stateSalaries } = await loadCheckerData();
  const plannerStates = buildPlannerStates(stateGuides);

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
            { label: 'Licensure Checker' },
          ]} />
          <div style={{ maxWidth: '760px' }}>
            <p style={{ fontSize: '13px', fontWeight: 600, color: TOOL_ACCENT, textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '10px' }}>
              Free Tool
            </p>
            <h1 className="font-lora" style={{ fontSize: 'clamp(2rem, 4.4vw, 2.9rem)', fontWeight: 800, lineHeight: 1.12, color: '#1A2E35', margin: '0 0 16px' }}>
              {brand.niche.short} licensure checker
            </h1>
            <p style={{ fontSize: '17px', color: '#5A4A42', lineHeight: 1.65, margin: 0 }}>
              Pick a state for its practice authority, licensure steps, timeline band, and live pay data.
              Then line up every state you are considering in the planner below — all {plannerStates.length}{' '}
              jurisdictions, sorted by what actually differs between them, starting with practice authority.
            </p>
          </div>
        </section>
      </div>

      {/* ─── Single-state checker ─── */}
      <section style={{ background: TOOL_PANEL_BG, padding: '48px 20px 56px' }}>
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
          <h2 className="font-lora" style={{ fontSize: 'clamp(22px, 3vw, 28px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', margin: '0 0 8px' }}>
            Check one state
          </h2>
          <p style={{ fontSize: '15px', color: '#5A4A42', textAlign: 'center', maxWidth: '560px', margin: '0 auto 34px', lineHeight: 1.6 }}>
            Requirements, practice authority, timeline band, and what {brand.niche.short}s in that state are
            currently being paid.
          </p>
          <LicensureChecker
            stateGuides={stateGuides}
            stateSalaries={stateSalaries}
            practiceAuthority={STATE_PRACTICE_AUTHORITY}
          />
        </div>
      </section>

      {/* ─── Multi-state planner ─── */}
      <section style={{ background: '#FFF', padding: '56px 20px' }}>
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
          <h2 className="font-lora" style={{ fontSize: 'clamp(22px, 3vw, 28px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', margin: '0 0 8px' }}>
            Plan several states
          </h2>
          <p style={{ fontSize: '15px', color: '#5A4A42', textAlign: 'center', maxWidth: '600px', margin: '0 auto 34px', lineHeight: 1.6 }}>
            Telehealth panels, travel assignments, and border-state practices all run into the same question:
            how different are these states really? Line them up and see it in one pass.
          </p>
          <MultiStatePlanner states={plannerStates} />
        </div>
      </section>

      {/* ─── Assumptions ─── */}
      <section style={{ background: TOOL_PANEL_BG, padding: '56px 20px' }}>
        <div style={{ maxWidth: '860px', margin: '0 auto' }}>
          <AssumptionsPanel
            title="What these tools do and do not tell you"
            intro="Licensure is a YMYL topic, so this page is deliberately narrow: it states what our sourced data supports and hands you the board link for everything else."
            assumptions={[
              `Practice-authority tiers (full, reduced, restricted) come from the AANP state practice environment — ${STAT_SOURCES.fullPracticeStates.formatted} grant full practice authority as of ${STAT_SOURCES.fullPracticeStates.asOf}.`,
              'The planner states the Nurse Licensure Compact rules, which are stable: a multistate RN license is issued only by a compact member state acting as your primary state of residence, and it covers the RN layer only.',
              'APRN licensure is treated as state-by-state in every case. The compact covers the RN layer only.',
              `Salary figures in the checker are true medians over live ${brand.niche.short}-eligible postings with disclosed, non-estimated salary, shown only for states with at least 5 postings from 3+ employers, refreshed daily.`,
              'The timeline band is a broad planning aid keyed to practice-authority tier, not a state-specific processing estimate.',
            ]}
            exclusions={[
              'Which specific states are Nurse Licensure Compact members. Membership moves — jurisdictions enact the compact and implement it on separate timelines, and some are only partially implemented — so a per-state member or non-member verdict is exactly the kind of claim that goes stale without anyone noticing. The planner links you to NCSBN, which maintains the current list, rather than publishing a copy of it.',
              'Application fees, renewal cycles, CE hour requirements, and processing times. These change per state and per applicant — the state board of nursing is the only authoritative source, and every state row links out to its guide rather than guessing.',
              'The APRN Compact. It is not treated as an operating multistate APRN privilege anywhere in this planner.',
              'Endorsement eligibility specifics such as background-check status, prior discipline, or education equivalency reviews.',
              'Prescriptive-authority detail and controlled-substance schedules, which vary within practice-authority tiers.',
            ]}
            sources={[
              { label: STAT_SOURCES.fullPracticeStates.source, url: STAT_SOURCES.fullPracticeStates.sourceUrl },
              { label: 'NCSBN — Nurse Licensure Compact, current member jurisdictions', url: 'https://www.nursecompact.com/' },
              { label: `${brand.name} salary guide — state pay from live postings`, url: '/salary-guide' },
            ]}
          />
        </div>
      </section>

      {/* ─── FAQ ─── */}
      <section style={{ background: TOOL_HERO_BG, padding: '64px 20px' }}>
        <div style={{ maxWidth: '760px', margin: '0 auto' }}>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 32px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '28px' }}>
            Licensure questions
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
              { href: '/resources/fpa-guide', title: 'Full practice authority guide', blurb: 'All 50 states classified, and what FPA does to pay.' },
              { href: '/tools/cost-of-living-comparison', title: 'Cost-of-living comparator', blurb: 'Before you move for a license, check what the salary is worth.' },
              { href: '/jobs/telehealth', title: 'Telehealth roles', blurb: 'Where multi-state licensure pays for itself fastest.' },
              { href: '/jobs/travel', title: 'Travel roles', blurb: 'Assignment work across compact and non-compact states.' },
              { href: '/resources', title: 'All career resources', blurb: 'Guides, state licensure series, and the salary guide.' },
              { href: '/salary-guide', title: `${brand.niche.short} salary guide`, blurb: 'What each state currently pays, from live postings.' },
            ].map((l) => (
              <Link key={l.href} href={l.href} className="tool-card" style={{ ...clayCard, padding: '20px 20px 18px', textDecoration: 'none', display: 'block' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <ClipboardCheck size={15} color={TOOL_ACCENT} aria-hidden="true" />
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
