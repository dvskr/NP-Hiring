/**
 * /salary-guide/[state]: one page per jurisdiction.
 *
 * THIN-CONTENT PROGRAM (PLAN C.4 item 5, thin-spec-4 3A). Deletions first:
 * the hero summary that promised a setting breakdown on all 43 rendered
 * states, the "ingested daily" claim, and the duplicate "Typical Range:
 * Pending" card below the gate. Then SAL-S1 practice environment, SAL-S2
 * pay by work arrangement and employment type, SAL-S3 employers and
 * cities, SAL-S4 what employers are hiring for, SAL-S5 nearby states and
 * SAL-S6 FAQ additions, each rendered only when its own facts clear their
 * floor.
 *
 * TRUTH RULES
 *   1. Every posting-derived figure is a GATED MEDIAN from
 *      lib/salary-analytics.ts (the one salary pool and engine: NP postings
 *      only, each employer counted once, a median at BENCHMARK_MIN_EMPLOYERS
 *      or more employers and the middle half at BENCHMARK_FULL_MIN_EMPLOYERS
 *      or more). Below the tier there is no posted figure. Every page also carries the state's
 *      cited BLS OEWS wages (lib/salary-guide-bls-states.ts): its title
 *      figure, the BLS wage band and the lead FAQ, labelled as BLS survey
 *      estimates with their vintage, never as posted pay.
 *   2. The board-wide median is labelled BOARD_MEDIAN_LABEL, never
 *      "national" (thin-spec-4 B8). "National median" is reserved for the
 *      cited BLS wage, and the comparison clause names its base.
 *   3. Counts come from getListingFacts, which composes the canonical
 *      predicate, so employer and city rows can no longer count expired or
 *      dead-link postings (thin-spec-4 B3).
 *   4. The provenance line renders only when the gate passed (B7).
 *   5. No editorial review date and no Article date keys: this page
 *      regenerates from live postings and has no human review event.
 *
 * STYLE: clay (owner decision 2026-09-20). The page ground is CLAY_GROUND,
 * cards are the shared clayCard token, sections come from
 * components/seo/pseo, and the one stylesheet is a static string with no
 * interpolation (a template interpolation inside a style block deadlocks
 * the route compile under Turbopack).
 */
import { brand } from '@/config/brand';
import { Metadata } from 'next';
import { cache, type ReactNode } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import BreadcrumbSchema from '@/components/BreadcrumbSchema';
import SalaryProvenance from '@/components/SalaryProvenance';
import CategoryFAQAccordion from '@/components/CategoryFAQAccordion';
import GuidePromo from '@/components/guides/GuidePromo';
import StateImage, { hasStateDiorama } from '@/components/StateImage';
import {
    BENCHMARK_MIN_EMPLOYERS,
    type BenchmarkRow,
} from '@/components/tools/benchmark-model';
import {
    ClayCard,
    ClayHead,
    ClayStyles,
    ClayTable,
    EmployerRoster,
    NearbyStatesTable,
    PracticeCard,
    CLAY_ACCENT,
    CLAY_BODY,
    CLAY_GROUND,
    CLAY_INK,
    CLAY_MUTED,
    CLAY_TRACK,
    clayButton,
    clayCard,
    clayChip,
    clayCta,
    clayDesc,
    clayEyebrow,
    clayFill,
    clayLink,
    clayList,
    clayMeta,
    clayRow,
    clayStat,
    clayTile,
    FAQ_SCHEMA_MIN_ENTRIES,
    type NearbyStateRow,
} from '@/components/seo/pseo';
// Empty-state 404 gate: the SAME predicate the sitemap's per-state gate
// uses, so a URL the sitemap advertises can never land on this page's
// notFound(). canonicalActiveJobWhere is the same set with GLOBAL_EXCLUSIONS
// restructured into an AND, which is what getListingFacts composes, so the
// gate count and facts.total always agree.
import { activeIndexableJobWhere } from '@/lib/active-job-filter';
import { canonicalActiveJobWhere } from '@/lib/canonical-counts';
import { categoryLabelOf, getListingFacts, type ListingFacts } from '@/lib/pseo/listing-facts';
import {
    BOARD_MEDIAN_LABEL,
    buildBlsStateWageSentence,
    buildHiringForSentence,
    buildHubPayParagraph,
    buildSalaryStateDescription,
    buildSalaryStateFaqAdditions,
    buildSalaryStateSummary,
    buildSalaryStateTitle,
    formatDollars,
    formatK,
} from '@/lib/pseo/listing-narrative';
import {
    getNearbyStates,
    getPracticeEnvironment,
    isLicenseGuideLive,
    NLC_VERIFIED_LABEL,
} from '@/lib/pseo/practice-environment';
import {
    isSettingStateIndexable,
    MIN_JOBS_FOR_LINK_LIST_ROW,
    pseoStatsFreshnessThreshold,
    shouldIndexSalaryGuideState,
} from '@/lib/pseo/render-gate';
import {
    benchmarkRowOf,
    getGatedBenchmarkRows,
    getGatedCitySalaries,
    getGatedLocationSalary,
    getGatedStateBenchmarks,
    type GatedSalary,
    type LabeledBenchmarkRow,
} from '@/lib/salary-analytics';
import { withTagFallback, type CategoryTag } from '@/lib/pseo/category-tagger';
import { STATE_ELIGIBLE_CATEGORY_SLUGS } from '@/lib/pseo/taxonomy-registry';
import { DESCRIPTION_MAX } from '@/lib/pseo/category-metadata';
import { formatCount, truncateOnWord } from '@/lib/display-text';
import { STAT_SOURCES } from '@/lib/stats-sources';
// The cited BLS OEWS state wages: every state and DC carries its own median,
// band and employment, which is also what lets the page index on its own.
import {
    BLS_NATIONAL,
    BLS_OEWS_REFERENCE_PERIOD,
    BLS_STATE_SOURCE_LABEL,
    BLS_STATE_SOURCE_URL,
    blsStateWage,
    compareWithNationalMedian,
    formatBlsCount,
    formatBlsDollars,
    formatBlsHourly,
    hasBlsStateMedian,
} from '@/lib/salary-guide-bls-states';
// P3 #9: /jobs/city/[slug] resolves by re-parsing the slug into a city NAME, so a
// link built from a lossy slug can be a guaranteed 404. Guard before emitting.
import { buildCitySlug, cityLinkResolves, MIN_CITY_JOBS_FOR_LINK } from '@/app/jobs/locations/[state]/directory';
import { localJobsPath } from '@/lib/city-link-path';
import {
    ArrowRight,
    Banknote,
    BarChart3,
    Briefcase,
    Building2,
    Layers,
    MapPin,
    ShieldCheck,
} from 'lucide-react';

// P0 OG sweep: per-state OG and schema image rendered by the board's own
// /api/og edge route. The previous shared Supabase page screenshot lived in
// an unpopulated bucket and 400'd on every share (pattern:
// app/for-employers/page.tsx). Absolute URL because it also feeds the
// Article JSON-LD `image`.
const salaryGuideOgImage = (stateName: string, code: string): string =>
    `${brand.baseUrl}/api/og?title=${encodeURIComponent(`${brand.niche.short} Salary in ${stateName} (${code})`)}&type=page`;

export const revalidate = 86400; // ISR daily

// ── State mappings ──────────────────────────────────────────────────────────

const STATE_CODES: Record<string, string> = {
    'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR',
    'California': 'CA', 'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE',
    'Florida': 'FL', 'Georgia': 'GA', 'Hawaii': 'HI', 'Idaho': 'ID',
    'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA', 'Kansas': 'KS',
    'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
    'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS',
    'Missouri': 'MO', 'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV',
    'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
    'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH', 'Oklahoma': 'OK',
    'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
    'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT',
    'Vermont': 'VT', 'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV',
    'Wisconsin': 'WI', 'Wyoming': 'WY', 'District of Columbia': 'DC',
};

const SLUG_TO_STATE: Record<string, string> = {};
Object.keys(STATE_CODES).forEach((name) => {
    SLUG_TO_STATE[name.toLowerCase().replace(/\s+/g, '-')] = name;
});

const ALL_STATE_SLUGS = Object.keys(SLUG_TO_STATE);

/**
 * Category tags that restate a work arrangement. SAL-S4 already gives the
 * structured remote, hybrid and on-site split in its sentence, so a tile
 * counting the same thing from tags could only disagree with it.
 */
const WORK_ARRANGEMENT_TAG_SLUGS: ReadonlySet<string> = new Set(['remote']);

// ── Data fetching ───────────────────────────────────────────────────────────
// generateMetadata and the page handler run in the same request, so every
// loader below is cached: getListingFacts keys on its primitive scope key,
// and the salary loaders are wrapped in React cache() here. Metadata
// therefore costs no extra query.

/** Facts over the canonical pool for the state (B3: no expired or dead-link rows). */
function loadFacts(stateName: string, slug: string): Promise<ListingFacts> {
    return getListingFacts(`salary-state:${slug}`, { state: stateName });
}

/**
 * The state's own gated figure, from the pool getPublishableSalaryGuideStates
 * reads. Below the median tier it still carries n (employers disclosing
 * pay), so the page can say how far the state is from a published median.
 */
const loadSalary = cache((stateName: string): Promise<GatedSalary> =>
    getGatedLocationSalary({ state: stateName }));

/** Board-wide gated median (BOARD_MEDIAN_LABEL), never called "national". */
const loadBoardMedian = cache((): Promise<GatedSalary> => getGatedLocationSalary());

/** A GatedSalary in the BenchmarkRow shape the narrative builders take (median tier or above). */
const toBenchmarkRow = benchmarkRowOf;

/**
 * SAL-S2 sub-pools. The employment-type rows use the SAME tag predicate
 * `/jobs/{slug}/{state}` uses (withTagFallback), so this table and the
 * setting pages can no longer disagree. The previous
 * `title contains 'Telehealth'` substring match counted any posting whose
 * title happened to mention the word. Each extra is scoped to the state
 * through a top-level AND, because both sides carry their own OR trees and
 * an object spread would silently drop clauses.
 */
interface PayRowSpec {
    label: string;
    /** Category slug whose `/jobs/{slug}/{state}` page this row may link. */
    slug: CategoryTag | null;
    where: Prisma.JobWhereInput;
}

function payRowSpecs(stateName: string): PayRowSpec[] {
    const inState = (bucket: Prisma.JobWhereInput): Prisma.JobWhereInput => ({
        AND: [{ state: stateName }, bucket],
    });
    const tag = (slug: CategoryTag): Prisma.JobWhereInput => withTagFallback(slug) as Prisma.JobWhereInput;
    return [
        { label: 'Remote', slug: 'remote', where: inState({ isRemote: true }) },
        { label: 'On site', slug: null, where: inState({ isRemote: false }) },
        { label: 'Full time', slug: 'full-time', where: inState(tag('full-time')) },
        { label: 'Part time', slug: 'part-time', where: inState(tag('part-time')) },
        { label: 'Per diem', slug: 'per-diem', where: inState(tag('per-diem')) },
    ];
}

/** Gated rows only, in spec order. The caller renders nothing below two rows. */
async function getPayRows(stateName: string): Promise<LabeledBenchmarkRow[]> {
    const extras: Record<string, Prisma.JobWhereInput> = {};
    for (const spec of payRowSpecs(stateName)) extras[spec.label] = spec.where;
    return getGatedBenchmarkRows(extras);
}

/**
 * Fresh setting-state stats rows for this state, with the index verdict the
 * aggregate-pseo cron wrote. RAW because `indexable` postdates the
 * generated Prisma client (same reason as app/admin/seo-health/page.tsx);
 * the variables are bound parameters of a tagged template.
 */
interface SettingStateStatsRow {
    categorySlug: string;
    totalJobs: number;
    indexable: boolean;
}

async function getSettingStateRows(stateSlug: string): Promise<SettingStateStatsRow[]> {
    try {
        return await prisma.$queryRaw<SettingStateStatsRow[]>`
            SELECT "categorySlug", "totalJobs", "indexable"
            FROM "PseoStats"
            WHERE "type" = 'setting-state'
              AND "locationSlug" = ${stateSlug}
              AND "totalJobs" >= ${MIN_JOBS_FOR_LINK_LIST_ROW}
              AND "updatedAt" >= ${pseoStatsFreshnessThreshold()}
            ORDER BY "totalJobs" DESC`;
    } catch (error) {
        console.error(`[salary-guide] setting-state rows failed for "${stateSlug}":`, error);
        return [];
    }
}

/**
 * Total active jobs in the state: the 404 gate. MUST stay predicate
 * identical to the sitemap's per-state gate (activeIndexableJobWhere plus
 * state), so the two surfaces render the same verdict. The ANALYTICS pool
 * (loadSalary) is deliberately narrower: a state whose disclosed salaries
 * are all hourly, estimated or non-NP still renders the below-gate branch
 * with the cited BLS figure, never a 404.
 */
async function getStateActiveJobCount(stateName: string): Promise<number> {
    return prisma.job.count({
        where: { ...activeIndexableJobWhere(), state: stateName },
    });
}

/** Canonical active counts for the nearby states, keyed by full state name. */
async function getNearbyJobCounts(stateNames: readonly string[]): Promise<Map<string, number>> {
    if (stateNames.length === 0) return new Map();
    try {
        const rows = await prisma.job.groupBy({
            by: ['state'],
            where: { AND: [canonicalActiveJobWhere(), { state: { in: [...stateNames] } }] },
            _count: { id: true },
        });
        return new Map(rows.flatMap((row) => (row.state ? [[row.state, row._count.id] as const] : [])));
    } catch (error) {
        console.error('[salary-guide] nearby state counts failed:', error);
        return new Map();
    }
}

/** Gated medians per state for the SAL-S5 median column; empty on failure. */
const loadStateBenchmarks = cache(async (): Promise<Map<string, BenchmarkRow>> => {
    try {
        const rows = await getGatedStateBenchmarks();
        return new Map(rows.map((row) => [row.scope, row]));
    } catch (error) {
        console.error('[salary-guide] state benchmarks failed:', error);
        return new Map();
    }
});

// ── Static Params ───────────────────────────────────────────────────────────

export async function generateStaticParams() {
    return ALL_STATE_SLUGS.map((slug) => ({ state: slug }));
}

// ── Metadata ────────────────────────────────────────────────────────────────

interface PageProps {
    params: Promise<{ state: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
    const { state: slug } = await params;
    const stateName = SLUG_TO_STATE[slug];
    if (!stateName) return { title: 'State Not Found' };

    const code = STATE_CODES[stateName];
    const env = getPracticeEnvironment(stateName);
    const bls = blsStateWage(stateName);
    const [facts, salary] = await Promise.all([loadFacts(stateName, slug), loadSalary(stateName)]);
    const benchmark = toBenchmarkRow(stateName, salary);

    // SAL-meta: the title carries the cited BLS state median (stable for a
    // year, comparable across states), else the posted median when one is
    // published, with the year from the snapshot date so it cannot go stale
    // in January. No count in the title, because counts churn on the ISR
    // cycle. The description leads with the live posted median when it
    // exists, else the BLS figures.
    const title = buildSalaryStateTitle({
        stateName,
        stateCode: code,
        benchmark,
        year: facts.computedAt.getUTCFullYear(),
        blsMedian: bls?.annualMedian.value ?? null,
    });
    const description = env
        ? buildSalaryStateDescription({ env, facts: { ...facts, benchmark }, bls })
        : truncateOnWord(buildSalaryStateSummary({ stateName, benchmark, bls }), DESCRIPTION_MAX);
    const ogImage = salaryGuideOgImage(stateName, code);
    const canonical = `${brand.baseUrl}/salary-guide/${slug}`;
    // S-IDX: index when the page carries a figure of its own, the cited BLS
    // state median or a gated posted median. A page with neither still
    // renders, keeps a self canonical and stays followable. app/sitemap.ts
    // calls the same predicate with the same inputs.
    const indexable = shouldIndexSalaryGuideState({
        activeJobs: facts.total,
        salaryGatePassed: salary.gatePassed,
        blsMedianAvailable: hasBlsStateMedian(stateName),
    });

    return {
        title,
        description,
        robots: { index: indexable, follow: true },
        alternates: { canonical },
        openGraph: {
            title,
            description,
            type: 'website',
            url: canonical,
            siteName: brand.name,
            images: [{ url: ogImage, width: 1200, height: 630, alt: `${brand.niche.short} salary data for ${stateName}` }],
        },
        twitter: {
            card: 'summary_large_image',
            title,
            description,
            images: [ogImage],
        },
    };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Escape angle brackets so JSON-LD can't break out of its <script> tag. */
function sanitizeJson(obj: object): string {
    return JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

interface StatTile {
    key: string;
    label: string;
    value: string;
    sub: string;
}

/** The headline figures as clay stat cards. A tile with no figure is omitted. */
function StatTiles({ tiles }: { tiles: StatTile[] }) {
    if (tiles.length === 0) return null;
    return (
        <div className="sg-stats">
            {tiles.map((tile) => (
                <div key={tile.key} style={{ ...clayStat, padding: '18px 16px', textAlign: 'left' }}>
                    <p style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: CLAY_MUTED, margin: '0 0 6px' }}>
                        {tile.label}
                    </p>
                    <p style={{ fontSize: '22px', fontWeight: 800, color: CLAY_INK, margin: '0 0 4px', lineHeight: 1.15 }}>
                        {tile.value}
                    </p>
                    <p style={{ fontSize: '12px', color: CLAY_MUTED, margin: 0, lineHeight: 1.45 }}>{tile.sub}</p>
                </div>
            ))}
        </div>
    );
}

/** One section band: eyebrow, Lora heading and the band's clay cards. */
function Band({
    eyebrow,
    title,
    lede,
    children,
}: {
    eyebrow: string;
    title: string;
    lede?: string;
    children: ReactNode;
}) {
    return (
        <section className="sg-band">
            <ClayHead eyebrow={eyebrow} title={title} lede={lede} />
            {children}
        </section>
    );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default async function StateSalaryPage({ params }: PageProps) {
    const { state: slug } = await params;
    const stateName = SLUG_TO_STATE[slug];
    if (!stateName) notFound();

    const stateCode = STATE_CODES[stateName];
    const stateSlug = slug;
    const env = getPracticeEnvironment(stateName);
    const nearbyEnvs = getNearbyStates(stateName);
    // The cited BLS row; its median is null only for a footnoted cell, and
    // every block below that prints a BLS figure renders only with one.
    const bls = blsStateWage(stateName);
    const blsMedian = bls && bls.annualMedian.value !== null ? bls : null;
    const blsComparison = blsMedian ? compareWithNationalMedian(blsMedian) : null;

    const [
        facts,
        salaryData,
        boardMedian,
        payRows,
        citySalaries,
        settingRows,
        nearbyCounts,
        stateBenchmarks,
        licenseGuideLive,
        nearbyGuidesLive,
        activeJobs,
    ] = await Promise.all([
        loadFacts(stateName, stateSlug),
        loadSalary(stateName),
        loadBoardMedian(),
        getPayRows(stateName),
        getGatedCitySalaries(stateName),
        getSettingStateRows(stateSlug),
        getNearbyJobCounts(nearbyEnvs.map((neighbor) => neighbor.stateName)),
        loadStateBenchmarks(),
        isLicenseGuideLive(stateSlug),
        Promise.all(nearbyEnvs.map((neighbor) => isLicenseGuideLive(neighbor.stateSlug))),
        getStateActiveJobCount(stateName),
    ]);

    // Empty-state guard: a state with zero active jobs would render "0 open
    // roles" plus a CTA, a classic soft-404, so it hard-404s instead. The
    // gate is TOTAL ACTIVE JOBS on the sitemap's own predicate, NOT the
    // analytics pool: gating on the analytics pool 404'd every state whose
    // disclosed salaries were all hourly, estimated or non-NP while the
    // sitemap kept advertising it.
    if (activeJobs === 0) {
        notFound();
    }

    const benchmark = toBenchmarkRow(stateName, salaryData);
    const payFacts = {
        benchmark,
        salaryDisclosedCount: facts.salaryDisclosedCount,
        total: facts.total,
    };

    // B8: the board-wide figure is "Median across all {brand} postings", and
    // the comparison clause names that base. Below either gate there is no
    // comparison to draw, so the clause is omitted rather than zero-filled.
    const boardRow = toBenchmarkRow('board', boardMedian);
    const comparison = benchmark && boardRow
        ? `${Math.abs(Math.round(((benchmark.median - boardRow.median) / boardRow.median) * 100))}% ${benchmark.median >= boardRow.median ? 'above' : 'below'} the median across all ${brand.name} postings`
        : null;

    const pageUrl = `${brand.baseUrl}/salary-guide/${stateSlug}`;

    // ── SAL-S2 rows and their gated links ───────────────────────────────
    const paySlugByLabel = new Map(payRowSpecs(stateName).map((spec) => [spec.label, spec.slug]));
    const indexableSettings = new Set(
        settingRows.filter((row) => isSettingStateIndexable(row.indexable)).map((row) => row.categorySlug),
    );
    const payScale = payRows.reduce((max, row) => Math.max(max, row.median), 0);

    // ── SAL-S3 cities: linked only where the city page renders, median only
    //    where that city's own sample clears the publishing gate ──────────
    const cityRows = facts.cities.slice(0, 10).map((city) => {
        const gated = citySalaries.get(city.name.trim());
        const code = city.stateCode ?? stateCode;
        const linkable = city.count >= MIN_CITY_JOBS_FOR_LINK && cityLinkResolves(city.name, code);
        return {
            name: city.name,
            count: city.count,
            // L-05: a curated metro links its guide directly; its city form
            // only redirects there.
            href: linkable ? localJobsPath(buildCitySlug(city.name, code)) : null,
            medianK: gated?.medianK ?? null,
        };
    });

    // ── SAL-S4 category rows, linked only where the target page indexes ──
    // The work-arrangement split is stated in the sentence above from each
    // posting's structured work mode, so the tag-derived "remote" tile is
    // left out: the indexing audit found "Remote 23" printed beside "1
    // remote, 21 hybrid" on /salary-guide/virginia (the tag matches
    // description keywords; see CQ-05).
    const categoryRows = settingRows
        .filter((row) => !WORK_ARRANGEMENT_TAG_SLUGS.has(row.categorySlug))
        .slice(0, 8)
        .map((row) => ({
        slug: row.categorySlug,
        label: categoryLabelOf(row.categorySlug),
        count: row.totalJobs,
        href: isSettingStateIndexable(row.indexable) && STATE_ELIGIBLE_CATEGORY_SLUGS.includes(row.categorySlug)
            ? `/jobs/${row.categorySlug}/${stateSlug}`
            : null,
    }));
    const hiringFor = buildHiringForSentence(facts);

    // ── SAL-S5 nearby states ────────────────────────────────────────────
    const nearbyRows: NearbyStateRow[] = nearbyEnvs.map((neighbor, i): NearbyStateRow => {
        const neighborBenchmark = stateBenchmarks.get(neighbor.stateName) ?? null;
        const jobs = nearbyCounts.get(neighbor.stateName) ?? 0;
        return {
            env: neighbor,
            jobs,
            medianK: neighborBenchmark ? Math.round(neighborBenchmark.median / 1000) : null,
            link: {
                href: `/salary-guide/${neighbor.stateSlug}`,
                renders: shouldIndexSalaryGuideState({
                    activeJobs: jobs,
                    salaryGatePassed: neighborBenchmark !== null,
                    blsMedianAvailable: hasBlsStateMedian(neighbor.stateName),
                }),
            },
            guide: {
                href: `/blog/${neighbor.licenseGuideSlug}`,
                renders: nearbyGuidesLive[i] === true,
            },
        };
    });

    // ── FAQ (SAL-S6) ────────────────────────────────────────────────────
    // ONE array feeds the FAQPage JSON-LD and the visible accordion, so the
    // schema and the visible content cannot diverge. No answer asserts a
    // board-derived figure below the publishing gate: buildHubPayParagraph
    // states the sample honestly and cites the BLS median instead.
    // The BLS answer leads: every state has one, it is cited and dated, and
    // it is the question state salary searches ask. The live posted median
    // joins it only when that median is published.
    const blsFaq = blsMedian
        ? {
            question: `How much do ${brand.niche.descriptor}s make in ${stateName}?`,
            answer: [
                buildBlsStateWageSentence(blsMedian),
                blsMedian.hourlyMedian.value !== null ? `The median hourly wage was ${formatBlsHourly(blsMedian.hourlyMedian)}.` : null,
                blsComparison ? `That is ${blsComparison}, from the same survey.` : null,
                benchmark
                    ? `On ${brand.name}, the median posted pay across ${formatCount(benchmark.employers, 'employer')} that disclose pay in live ${stateName} postings is ${formatDollars(benchmark.median)}.`
                    : null,
            ].filter(Boolean).join(' '),
        }
        : null;
    const stateFaqs = [
        ...(blsFaq ? [blsFaq] : []),
        {
            question: `What is the median ${brand.niche.short} salary in ${stateName}?`,
            answer: buildHubPayParagraph({ scopeName: stateName, scopeNoun: 'state', facts: payFacts }),
        },
        {
            question: `How many ${brand.niche.short} jobs are open in ${stateName}?`,
            answer: `${stateName} has ${formatCount(activeJobs, `open ${brand.niche.short} role`)} from ${formatCount(facts.distinctEmployers, 'employer')} on ${brand.name}, ${formatCount(facts.salaryDisclosedCount, 'posting')} of which ${facts.salaryDisclosedCount === 1 ? 'states' : 'state'} an annual salary.`,
        },
        ...(env
            ? buildSalaryStateFaqAdditions({
                env,
                nlcVerifiedLabel: NLC_VERIFIED_LABEL,
                topEmployers: facts.topEmployers.map((employer) => ({ name: employer.name, count: employer.count })),
            })
            : []),
    ];

    const showHeroDiorama = hasStateDiorama(stateSlug);
    const heroSummary = buildSalaryStateSummary({ stateName, benchmark, bls });

    const statTiles: StatTile[] = [
        // The cited BLS state median leads on every state page.
        ...(blsMedian
            ? [{
                key: 'bls-state',
                label: `BLS median annual wage, ${stateName}`,
                value: formatBlsDollars(blsMedian.annualMedian),
                sub: blsComparison
                    ? `${blsComparison.charAt(0).toUpperCase()}${blsComparison.slice(1)} (BLS OEWS, ${BLS_OEWS_REFERENCE_PERIOD})`
                    : `BLS OEWS, ${BLS_OEWS_REFERENCE_PERIOD}`,
            }]
            : []),
        benchmark
            ? {
                key: 'median',
                label: 'Median posted pay',
                value: formatDollars(benchmark.median),
                sub: [
                    `${formatCount(benchmark.employers, 'employer')} disclosing pay${comparison ? `, ${comparison}` : ''}`,
                    benchmark.p25 !== null && benchmark.p75 !== null
                        ? `middle half ${formatK(benchmark.p25)} to ${formatK(benchmark.p75)}`
                        : null,
                ].filter(Boolean).join('; '),
            }
            : {
                // Below the median tier: the count shows only at the count
                // tier (3 or 4 employers), as the engine allows; never a figure.
                key: 'median',
                label: 'Median posted pay',
                value: 'Not published',
                sub: salaryData.tier === 'countOnly'
                    ? `${formatCount(salaryData.employers, 'employer')} disclose pay in live postings; a median appears at ${BENCHMARK_MIN_EMPLOYERS}`
                    : `Fewer than ${BENCHMARK_MIN_EMPLOYERS} employers disclose pay in live postings`,
            },
        {
            key: 'roles',
            label: `Open ${brand.niche.short} roles`,
            value: activeJobs.toLocaleString('en-US'),
            sub: `From ${formatCount(facts.distinctEmployers, 'employer')} in ${stateCode}`,
        },
        boardRow
            ? {
                key: 'board',
                label: BOARD_MEDIAN_LABEL,
                value: formatDollars(boardRow.median),
                sub: `${formatCount(boardRow.employers, 'employer')} disclosing pay, every state`,
            }
            : {
                key: 'bls',
                label: 'National median wage',
                value: STAT_SOURCES.npMedianWageBls.formatted,
                sub: STAT_SOURCES.npMedianWageBls.source,
            },
    ];

    return (
        <div style={{ backgroundColor: CLAY_GROUND, minHeight: '100vh' }}>
            {/* Hero and band layout. Deliberately a static block: a template
                interpolation inside a style block deadlocks the route
                compile under Turbopack, so every value here is literal. */}
            <style>{`
                .sg-hero-inner { max-width: 820px; margin: 0 auto; text-align: center; }
                .sg-hero-inner p { margin-left: auto; margin-right: auto; }
                .sg-hero-inner--art { max-width: 1000px; }
                .sg-hero-art {
                    position: relative;
                    width: 200px;
                    aspect-ratio: 1 / 1;
                    overflow: hidden;
                    margin: 32px auto 0;
                    flex: 0 0 auto;
                }
                .sg-hero-art-img { object-fit: cover; }
                .sg-band { max-width: 980px; margin: 0 auto; padding: 0 16px 56px; }
                .sg-grid { display: grid; gap: 20px; grid-template-columns: minmax(0, 1fr); }
                .sg-stats { display: grid; gap: 14px; grid-template-columns: repeat(4, minmax(0, 1fr)); }
                .sg-cta-actions { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; }
                @media (min-width: 720px) {
                    .sg-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
                }
                @media (max-width: 860px) {
                    .sg-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
                }
                @media (min-width: 860px) {
                    .sg-hero-inner--art {
                        display: flex;
                        align-items: center;
                        gap: 48px;
                        text-align: left;
                    }
                    .sg-hero-inner--art .sg-hero-copy { flex: 1 1 auto; min-width: 0; }
                    .sg-hero-inner--art p { margin-left: 0; margin-right: 0; }
                    .sg-hero-inner--art .sg-hero-art { width: 272px; margin: 0; }
                }
            `}</style>
            <ClayStyles />
            <BreadcrumbSchema
                items={[
                    { name: 'Home', url: brand.baseUrl },
                    { name: 'Salary Guide', url: `${brand.baseUrl}/salary-guide` },
                    { name: stateName, url: `${brand.baseUrl}/salary-guide/${stateSlug}` },
                ]}
            />
            {/* FAQPage, from the same stateFaqs array as the accordion below */}
            {stateFaqs.length >= FAQ_SCHEMA_MIN_ENTRIES && (
                <script
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{ __html: sanitizeJson({
                        '@context': 'https://schema.org',
                        '@type': 'FAQPage',
                        mainEntity: stateFaqs.map((faq) => ({
                            '@type': 'Question',
                            name: faq.question,
                            acceptedAnswer: { '@type': 'Answer', text: faq.answer },
                        })),
                    }) }}
                />
            )}
            {/* Article. Dates deliberately omitted: this page regenerates
                daily from live posting data and has no editorial publish
                date, so emitting dateModified of now would fabricate
                freshness (audit B54 principle). Below the publishing gate
                the description carries no figure, because a structured-data
                salary claim over a tiny sample is fabricated data. */}
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: sanitizeJson({
                    '@context': 'https://schema.org',
                    '@type': 'Article',
                    headline: `${brand.niche.short} Salary in ${stateName} (${stateCode})`,
                    description: heroSummary,
                    author: { '@type': 'Organization', '@id': `${brand.baseUrl}/#organization`, name: brand.name, url: brand.baseUrl },
                    publisher: { '@type': 'Organization', '@id': `${brand.baseUrl}/#organization`, name: brand.name, logo: { '@type': 'ImageObject', url: `${brand.baseUrl}/logo.png` } },
                    mainEntityOfPage: { '@type': 'WebPage', '@id': pageUrl },
                    image: salaryGuideOgImage(stateName, stateCode),
                    url: pageUrl,
                }) }}
            />
            {/* Speakable: the salary summary plus every FAQ answer */}
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: sanitizeJson({
                    '@context': 'https://schema.org',
                    '@type': 'WebPage',
                    name: `${brand.niche.short} Salary in ${stateName} (${stateCode})`,
                    speakable: {
                        '@type': 'SpeakableSpecification',
                        cssSelector: ['#state-salary-summary', '.faq-answer'],
                    },
                    url: pageUrl,
                }) }}
            />

            {/* Hero. Pairs the copy with this state's own diorama
                (public/images/states/<slug>.png). Every slug this route can
                reach ships one; a jurisdiction without artwork falls back to
                the text-only hero rather than a placeholder or a dead URL.
                The art fills a fixed aspect-ratio box edge to edge, with no
                frame, radius or inset shadow, so its space is reserved
                before it decodes and there is no colour seam. */}
            <section style={{ padding: '72px 16px 40px' }}>
                <div className={showHeroDiorama ? 'sg-hero-inner sg-hero-inner--art' : 'sg-hero-inner'}>
                    <div className="sg-hero-copy">
                        <span style={{ ...clayChip, background: clayFill(0), gap: '6px' }}>
                            <MapPin size={13} /> {stateCode} pay data
                        </span>

                        <h1
                            className="font-lora"
                            style={{
                                fontSize: 'clamp(1.9rem, 4.5vw, 2.9rem)',
                                fontWeight: 700,
                                color: CLAY_INK,
                                lineHeight: 1.15,
                                margin: '16px 0 14px',
                            }}
                        >
                            {brand.niche.short} Salary in {stateName}
                        </h1>

                        <p
                            id="state-salary-summary"
                            data-speakable="true"
                            style={{
                                fontSize: '16px',
                                color: CLAY_BODY,
                                maxWidth: '620px',
                                lineHeight: 1.65,
                                margin: 0,
                            }}
                        >
                            {heroSummary}
                        </p>
                    </div>

                    {/* The state's own picture beside the heading. Decorative on
                        a phone (760px and narrower): not shown there, and the 1
                        pixel size hint sends a phone the smallest copy, since it
                        loads at once. */}
                    {showHeroDiorama && (
                        <div className="sg-hero-art" data-phone-hide="">
                            <StateImage
                                slug={stateSlug}
                                alt={`Illustrated diorama representing ${stateName}`}
                                fill
                                className="sg-hero-art-img"
                                sizes="(max-width: 760px) 1px, (max-width: 859px) 200px, 272px"
                                priority
                            />
                        </div>
                    )}
                </div>
            </section>

            {/* Headline figures */}
            <section className="sg-band">
                <StatTiles tiles={statTiles} />
                {/* B7: the provenance line states the query's own basis and
                    renders ONLY when the gate that publishes the figure
                    passed. Below it there is no figure to attribute, so the
                    sentence is omitted rather than fabricated. This page has
                    no editorial review date (B54; its Article schema omits
                    dates for the same reason). */}
                <SalaryProvenance
                    live={salaryData.gatePassed ? { count: salaryData.employers, minimum: BENCHMARK_MIN_EMPLOYERS, noun: 'employers that disclose pay in live postings' } : undefined}
                    style={{ margin: '16px 0 0' }}
                />
            </section>

            {/* BLS state wages: this state's own survey figures beside the
                national ones from the same release, so the page answers the
                state question with cited, state-specific numbers. Rendered
                only with a published median; a footnoted cell prints its
                BLS label, never a number. */}
            {blsMedian && (
                <Band
                    eyebrow="Wage estimates"
                    title={`BLS wages for ${brand.niche.descriptor}s in ${stateName}`}
                    lede={`Survey estimates of wages paid to ${brand.niche.descriptor}s in ${stateName}, from the BLS Occupational Employment and Wage Statistics program (${BLS_OEWS_REFERENCE_PERIOD}). They measure pay in jobs people hold, which is not the same as the pay employers post for open roles.`}
                >
                    <ClayTable
                        caption={`${BLS_STATE_SOURCE_LABEL}, ${stateName} and national estimates.`}
                        columns={['Measure', { label: stateName, numeric: true }, { label: 'United States', numeric: true }]}
                        rows={[
                            ['Median annual wage', formatBlsDollars(blsMedian.annualMedian), formatBlsDollars(BLS_NATIONAL.np.annualMedian)],
                            ['Median hourly wage', formatBlsHourly(blsMedian.hourlyMedian), formatBlsHourly(BLS_NATIONAL.np.hourlyMedian)],
                            ['10th percentile wage', formatBlsDollars(blsMedian.annualP10), formatBlsDollars(BLS_NATIONAL.np.annualP10)],
                            ['25th percentile wage', formatBlsDollars(blsMedian.annualP25), formatBlsDollars(BLS_NATIONAL.np.annualP25)],
                            ['75th percentile wage', formatBlsDollars(blsMedian.annualP75), formatBlsDollars(BLS_NATIONAL.np.annualP75)],
                            ['90th percentile wage', formatBlsDollars(blsMedian.annualP90), formatBlsDollars(BLS_NATIONAL.np.annualP90)],
                            [`${brand.niche.long}s employed`, formatBlsCount(blsMedian.employment), formatBlsCount(BLS_NATIONAL.np.employment)],
                        ]}
                    />
                    <p style={{ ...clayDesc, margin: '14px 0 0', fontSize: '13px' }}>
                        {blsComparison ? `${stateName}'s median is ${blsComparison}. ` : null}
                        Source:{' '}
                        <a href={BLS_STATE_SOURCE_URL} style={clayLink} rel="noopener noreferrer">
                            BLS OEWS {BLS_OEWS_REFERENCE_PERIOD} state estimates
                        </a>
                        . <Link href="/salary-guide#salary-by-state" style={clayLink}>Compare every state</Link>.
                    </p>
                </Band>
            )}

            {/* SAL-S1 practice environment */}
            {env && (
                <Band eyebrow="Licensure" title={`Practicing in ${stateName}`}>
                    <PracticeCard
                        env={env}
                        variant={{ kind: 'salary' }}
                        licenseGuideLive={licenseGuideLive}
                        title={`${stateName} practice environment`}
                        icon={ShieldCheck}
                        headingLevel={3}
                    />
                </Band>
            )}

            {/* SAL-S2 pay by work arrangement and employment type. Two rows
                is the floor: a single row is the state median again. */}
            {payRows.length >= 2 && (
                <Band
                    eyebrow="Pay breakdown"
                    title="Pay by work arrangement and employment type"
                    lede={`Each row is the median posted pay across the employers that disclose annual pay in ${stateName} postings of that kind, each employer counted once, published only where at least ${BENCHMARK_MIN_EMPLOYERS} employers do. Rows overlap, because a posting can be both remote and full time.`}
                >
                    <ClayCard chip="Arrangement" index={1} icon={Banknote} title={`${stateName} posted medians`} headingLevel={3}>
                        <ul className="pseo-clay-list" style={clayList}>
                            {payRows.map((row, i) => {
                                const rowSlug = paySlugByLabel.get(row.label) ?? null;
                                const href = rowSlug && indexableSettings.has(rowSlug)
                                    ? `/jobs/${rowSlug}/${stateSlug}`
                                    : null;
                                const width = payScale > 0 ? Math.round(Math.min(100, (row.median / payScale) * 100)) : 100;
                                return (
                                    <li key={row.label} style={{ ...clayRow(i === payRows.length - 1), fontSize: '13px' }}>
                                        <span style={{ minWidth: '92px' }}>
                                            {href ? <Link href={href} style={clayLink}>{row.label}</Link> : row.label}
                                        </span>
                                        <span
                                            aria-hidden="true"
                                            style={{ flex: 1, height: '8px', borderRadius: '999px', background: CLAY_TRACK, overflow: 'hidden' }}
                                        >
                                            <span
                                                style={{
                                                    display: 'block',
                                                    height: '100%',
                                                    borderRadius: '999px',
                                                    background: CLAY_ACCENT,
                                                    width: `${width}%`,
                                                }}
                                            />
                                        </span>
                                        <span style={{ ...clayMeta, minWidth: '116px', textAlign: 'right' }}>
                                            {formatK(row.median)}, {formatCount(row.employers, 'employer')}
                                        </span>
                                    </li>
                                );
                            })}
                        </ul>
                    </ClayCard>
                </Band>
            )}

            {/* SAL-S3 employers and cities */}
            {(facts.distinctEmployers >= 2 || cityRows.length > 0) && (
                <Band eyebrow="Where the roles are" title={`Employers and cities hiring in ${stateName}`}>
                    <div className="sg-grid">
                        <EmployerRoster
                            variant={{ kind: 'hub', stateName }}
                            facts={facts}
                            title={`Employers hiring in ${stateName}`}
                            chip="Employers"
                            icon={Building2}
                            index={0}
                            headingLevel={3}
                        />
                        {cityRows.length > 0 && (
                            <ClayTable
                                caption={`Cities by open ${brand.niche.short} roles on ${brand.name}. A city links its own page at ${MIN_CITY_JOBS_FOR_LINK} or more roles, and a posted median is published once at least ${BENCHMARK_MIN_EMPLOYERS} employers in the city disclose pay, each counted once.`}
                                columns={['City', { label: 'Open roles', numeric: true }, { label: 'Posted median', numeric: true }]}
                                rows={cityRows.map((city) => [
                                    city.href ? <Link href={city.href} style={clayLink}>{city.name}</Link> : city.name,
                                    city.count.toLocaleString('en-US'),
                                    city.medianK === null ? 'Not published' : `$${city.medianK}K`,
                                ])}
                            />
                        )}
                    </div>
                </Band>
            )}

            {/* SAL-S4 what employers are hiring for */}
            {hiringFor && (
                <Band eyebrow="Open roles" title={`What employers are hiring for in ${stateName}`}>
                    <ClayCard chip="Inventory" index={2} icon={Layers} title={`${stateName} listing mix`} desc={hiringFor} headingLevel={3}>
                        {categoryRows.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '16px' }}>
                                {categoryRows.map((row) => (
                                    row.href ? (
                                        <Link key={row.slug} href={row.href} className="pseo-clay-lift" style={clayTile}>
                                            <span>{row.label}</span>
                                            <span style={clayMeta}>{row.count.toLocaleString('en-US')}</span>
                                        </Link>
                                    ) : (
                                        <span key={row.slug} style={clayTile}>
                                            <span>{row.label}</span>
                                            <span style={clayMeta}>{row.count.toLocaleString('en-US')}</span>
                                        </span>
                                    )
                                ))}
                            </div>
                        )}
                        {facts.newGradFriendly > 0 && (
                            <p style={{ ...clayDesc, margin: '16px 0 0', fontSize: '13px' }}>
                                <Link href="/jobs/new-grad" style={clayLink}>
                                    Browse the roles marked open to new graduates
                                </Link>
                            </p>
                        )}
                    </ClayCard>
                </Band>
            )}

            {/* SAL-S5 nearby states compared */}
            {nearbyRows.length >= 2 && (
                <Band eyebrow="Nearby" title={`States near ${stateName}`}>
                    <NearbyStatesTable rows={nearbyRows} variant="salary" />
                </Band>
            )}

            {/* SAL-S6 FAQ, rendered from the SAME stateFaqs array as the
                FAQPage JSON-LD above, so every answer is in the server HTML
                for the Speakable selector and for crawlers. */}
            {stateFaqs.length > 0 && (
                <Band eyebrow="Questions" title={`${brand.niche.short} salary in ${stateName}: FAQ`}>
                    <CategoryFAQAccordion
                        faqs={stateFaqs.map((faq) => ({ question: faq.question, answer: faq.answer }))}
                    />
                </Band>
            )}

            {/* The compensation report: every state in one table */}
            <section className="sg-band">
                <GuidePromo
                    slug="compensation-report"
                    heading={`See how ${stateName} compares with every other state`}
                    pitch="A state by state pay table for all 50 states and DC, pay by specialty and setting, W-2 vs. 1099 math and a negotiation method built on the data."
                />
            </section>

            {/* Cross-links */}
            <section className="sg-band">
                <div className="sg-grid">
                    <ClayCard
                        href={`/jobs/state/${stateSlug}`}
                        chip="Browse"
                        index={1}
                        icon={Briefcase}
                        title={`Every ${brand.niche.short} job in ${stateName}`}
                        desc={`${formatCount(activeJobs, 'open position')} across the state, with filters for setting, schedule and work arrangement.`}
                        action="Open the state board"
                        headingLevel={3}
                    />
                    <ClayCard
                        href="/salary-guide"
                        chip="Compare"
                        index={2}
                        icon={BarChart3}
                        title="Pay across every state"
                        desc="The BLS median annual wage for all 50 states and DC, the highest and lowest paying states, and live posted medians."
                        action="Open the salary guide"
                        headingLevel={3}
                    />
                </div>
            </section>

            {/* One alert CTA per page */}
            <section className="sg-band" style={{ paddingBottom: '72px' }}>
                <div style={{ ...clayCta, textAlign: 'center', padding: '40px 24px' }}>
                    <p style={{ ...clayEyebrow, marginBottom: '10px' }}>Job alerts</p>
                    <h2 className="font-lora" style={{ fontSize: 'clamp(22px, 3vw, 30px)', fontWeight: 700, color: CLAY_INK, margin: '0 0 10px' }}>
                        New {stateName} roles, by email
                    </h2>
                    <p style={{ fontSize: '15px', color: CLAY_BODY, margin: '0 auto 24px', maxWidth: '520px', lineHeight: 1.6 }}>
                        Browse the {formatCount(activeJobs, 'position')} open now, or have the next ones sent to you.
                    </p>
                    <div className="sg-cta-actions">
                        <Link href={`/jobs/state/${stateSlug}`} style={clayButton}>
                            Browse {stateCode} jobs <ArrowRight size={16} />
                        </Link>
                        <Link
                            href="/job-alerts"
                            style={{ ...clayCard, ...clayButton, background: '#FFFFFF', color: CLAY_INK }}
                        >
                            Create a job alert
                        </Link>
                    </div>
                </div>
            </section>
        </div>
    );
}
