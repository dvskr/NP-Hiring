/**
 * /salary-guide/specialty/[specialty]: by-specialty salary pages
 * (content audit P1 #7: salary queries by specialty dwarf state queries;
 * only the [state] axis existed).
 *
 * Content contract:
 *   - Config-derived content (premium band times the cited BLS median,
 *     certification, settings, FAQ) ALWAYS renders, so a specialty with
 *     zero salary-bearing inventory still serves a substantive page and
 *     needs no notFound() soft-404 gate like the [state] pages do.
 *   - CREDENTIAL TRUTH: every group noun comes from specialtyNoun or
 *     specialtyNounPlural and every mention of the cited median comes from
 *     medianSentenceParts, never `page.label + brand.niche.short`. Nurse
 *     anesthetists and nurse midwives are APRNs, not the niche role, and
 *     this template must not say otherwise in visible copy or in JSON-LD.
 *   - Live sections (board median, top-paying states, experience bands)
 *     are GATED MEDIANS (review P9 #2c/#2d): computed over the
 *     npSalaryAnalyticsWhere pool (published, non-expired, non-estimated,
 *     confidence of 0.8 or more, annual cadence) scoped to NP-eligible
 *     titles, and published only under the benchmark widget's policy, a
 *     true median at n of BENCHMARK_MIN_POSTINGS or more from
 *     BENCHMARK_MIN_EMPLOYERS or more employers. Below the gate the
 *     section is omitted, never a mean and never fabricated.
 *   - FAQPage JSON-LD and the visible accordion render from ONE array
 *     (B48), escaped with the repo's \u003c pattern.
 *
 * THIN-CONTENT PROGRAM (thin-spec-4 3B): SPEC-P1 where roles are open,
 * SPEC-P2 practice rules where those roles are, SPEC-P3 employers, SPEC-P4
 * work arrangement and experience, SPEC-P5 related guides, each rendered
 * only when its own facts clear their floor. The uncited premium table is
 * NOT extended into any new copy.
 *
 * STYLE: clay (owner decision 2026-09-20), matching the rest of the pSEO
 * family: the CLAY_GROUND page, clay cards, pink eyebrows and Lora band
 * headings.
 */
import { brand } from '@/config/brand';
import { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import BreadcrumbSchema from '@/components/BreadcrumbSchema';
import SalaryProvenance from '@/components/SalaryProvenance';
import CategoryFAQAccordion from '@/components/CategoryFAQAccordion';
import { STAT_SOURCES } from '@/lib/stats-sources';
import { withTagFallback, type CategoryTag } from '@/lib/pseo/category-tagger';
import { STATE_ELIGIBLE_CATEGORY_SLUGS } from '@/lib/pseo/taxonomy-registry';
import { STATE_CODES, stateToSlug } from '@/lib/pseo/setting-state-config';
import { canonicalBucketWhere } from '@/lib/canonical-counts';
import { formatCount } from '@/lib/display-text';
import { getListingFacts, MIX_MIN_POSTINGS_HUB, type ListingFacts } from '@/lib/pseo/listing-facts';
import {
    buildLandingStatesSentence,
    buildSpecialtyAuthoritySentence,
    buildSpecialtyCtaLine,
    buildSpecialtyDescription,
    formatK,
} from '@/lib/pseo/listing-narrative';
import {
    MIN_JOBS_FOR_LINK_LIST_ROW,
    pseoStatsFreshnessThreshold,
} from '@/lib/pseo/render-gate';
import {
    ClayCard,
    ClayHead,
    ClayStyles,
    ClayTable,
    EmployerRoster,
    LocationSpread,
    RoleSetup,
    CLAY_BODY,
    CLAY_GROUND,
    CLAY_INK,
    CLAY_MUTED,
    clayButton,
    clayCard,
    clayChip,
    clayCta,
    clayDesc,
    clayEyebrow,
    clayFill,
    clayLink,
    clayStat,
    clayTile,
    FAQ_SCHEMA_MIN_ENTRIES,
    type LocationSpreadPlace,
} from '@/components/seo/pseo';
import {
    getRelatedSpecialtyPages,
    getSpecialtySalaryPage,
    SALARY_SPECIALTY_SLUGS,
    SpecialtySalaryPage,
} from '../specialty-config';
import {
    buildSpecialtyFaqs,
    configRange,
    formatSalary,
    hasReportedRange,
    medianSentence,
    medianSentenceParts,
    specialtyNoun,
    specialtyNounPlural,
    SpecialtyExperienceRow,
    SpecialtyLiveStats,
    SpecialtyStateRow,
} from '../specialty-content';
// P9 #2c/#2d: every live figure runs the gated analytics pool through the
// benchmark widget's publishing policy, the same pipeline as the
// salary-guide hub and state pages.
import {
    summarizeBenchmarks,
    BENCHMARK_MIN_POSTINGS,
    BENCHMARK_MIN_EMPLOYERS,
} from '@/components/tools/benchmark-model';
import {
    npSalaryAnalyticsWhere,
    NP_SALARY_ANALYTICS_SELECT,
    filterNpEligibleRows,
} from '@/lib/salary-utils';
import {
    Award,
    ArrowRight,
    BarChart3,
    Briefcase,
    Building2,
    Layers,
    MapPin,
    ShieldCheck,
    Stethoscope,
    TrendingUp,
} from 'lucide-react';

export const revalidate = 86400; // ISR daily, mirrors /salary-guide/[state]

// OG card via the board's own /api/og edge route (P0 OG-sweep pattern).
const specialtyOgImage = (page: SpecialtySalaryPage): string =>
    `${brand.baseUrl}/api/og?title=${encodeURIComponent(`${page.shortTitle} Salary Guide`)}&type=page`;

// ─── Data fetching (live DB aggregation over Job.categoryTags) ──────────────

/**
 * withTagFallback returns an intentionally untyped where fragment (its
 * callers cast; see lib/pseo/setting-state-template.tsx). Cast once here so
 * every query below stays fully typed.
 */
const tagWhere = (slug: CategoryTag): Prisma.JobWhereInput =>
    withTagFallback(slug) as Prisma.JobWhereInput;

/**
 * NP-eligible analytics rows for this specialty tag: the hygiene pool
 * (npSalaryAnalyticsWhere, which is published, non-expired, non-estimated,
 * confidence of 0.8 or more, annual cadence, normalized salary present)
 * intersected with the tag predicate via a top-level AND (both sides carry
 * their own AND and OR trees, so an object spread would silently drop
 * clauses), then scoped to NP-eligible titles in JS. This is the ONLY pool
 * any figure on this page may derive from.
 */
async function fetchSpecialtyAnalyticsRows(
    slug: CategoryTag,
    extra: Prisma.JobWhereInput = {},
): Promise<Array<{ state: string | null; employer: string | null; title: string | null; normalizedMinSalary: number | null; normalizedMaxSalary: number | null }>> {
    const rows = await prisma.job.findMany({
        where: { AND: [npSalaryAnalyticsWhere(), tagWhere(slug), extra] },
        select: NP_SALARY_ANALYTICS_SELECT,
    });
    return filterNpEligibleRows(rows);
}

async function getLiveStats(slug: CategoryTag): Promise<SpecialtyLiveStats> {
    const npRows = await fetchSpecialtyAnalyticsRows(slug);
    // Pool the whole tag through the national benchmark gate; rows without a
    // state still count toward the specialty-wide median (same coalescing as
    // the state pages' board median).
    const { national } = summarizeBenchmarks(
        npRows.map((r) => ({ ...r, state: r.state ?? 'Unknown' })),
    );
    const mins = npRows
        .map((r) => r.normalizedMinSalary)
        .filter((v): v is number => typeof v === 'number' && v > 0);
    const maxs = npRows
        .map((r) => r.normalizedMaxSalary ?? r.normalizedMinSalary)
        .filter((v): v is number => typeof v === 'number' && v > 0);
    return {
        medianSalary: national?.median ?? 0,
        minSalary: mins.length > 0 ? Math.min(...mins) : 0,
        maxSalary: maxs.length > 0 ? Math.max(...maxs) : 0,
        // The sample size behind the published median: benchmark postings
        // when gated (rows lacking an employer are excluded there), else the
        // raw eligible-row count for the cross-link copy.
        jobCount: national?.postings ?? npRows.length,
        gatePassed: national != null,
    };
}

async function getTopPayingStates(slug: CategoryTag): Promise<SpecialtyStateRow[]> {
    const npRows = await fetchSpecialtyAnalyticsRows(slug, { state: { not: null } });
    // summarizeBenchmarks enforces the per-state publishing gate (n of 5 or
    // more postings from 3 or more employers) and computes true medians. A
    // ranked list over anything less re-created the n=1 "top paying state"
    // defect.
    const { states } = summarizeBenchmarks(npRows);
    return states
        .filter((s) => STATE_CODES[s.scope])
        .map((s) => ({
            state: s.scope,
            stateCode: STATE_CODES[s.scope],
            slug: stateToSlug(s.scope),
            medianSalary: s.median,
            jobCount: s.postings,
        }))
        .sort((a, b) => b.medianSalary - a.medianSalary)
        .slice(0, 8);
}

async function getExperienceBands(slug: CategoryTag): Promise<SpecialtyExperienceRow[]> {
    const bands = [
        { label: 'New-grad friendly roles', extra: { newGradFriendly: true } },
        { label: 'Roles requiring 3+ years', extra: { minYearsExperience: { gte: 3 } } },
        { label: 'Roles requiring 5+ years', extra: { minYearsExperience: { gte: 5 } } },
    ] as const;
    const results = await Promise.all(
        bands.map(async (band): Promise<SpecialtyExperienceRow | null> => {
            const npRows = await fetchSpecialtyAnalyticsRows(slug, band.extra);
            // Same publishing gate per band: a three-posting "average" for an
            // experience bucket is the same defect as a one-posting state.
            const { national } = summarizeBenchmarks(
                npRows.map((r) => ({ ...r, state: r.state ?? 'Unknown' })),
            );
            return national
                ? { label: band.label, medianSalary: national.median, jobCount: national.postings }
                : null;
        }),
    );
    return results.filter((r): r is SpecialtyExperienceRow => r != null);
}

/**
 * SPEC-P4 experience COUNTS over the canonical pool. Counts rather than
 * medians, so the section still renders for a specialty whose experience
 * buckets do not clear the publishing gate.
 */
interface ExperienceCounts { threeYears: number; fiveYears: number }

async function getExperienceCounts(slug: CategoryTag): Promise<ExperienceCounts> {
    try {
        const [threeYears, fiveYears] = await Promise.all([
            prisma.job.count({ where: canonicalBucketWhere({ AND: [tagWhere(slug), { minYearsExperience: { gte: 3 } }] }) }),
            prisma.job.count({ where: canonicalBucketWhere({ AND: [tagWhere(slug), { minYearsExperience: { gte: 5 } }] }) }),
        ]);
        return { threeYears, fiveYears };
    } catch (error) {
        console.error(`[salary-specialty] experience counts failed for "${slug}":`, error);
        return { threeYears: 0, fiveYears: 0 };
    }
}

/**
 * Fresh category-by-state stats rows for this specialty, with the index
 * verdict the aggregate-pseo cron wrote. RAW because `indexable` postdates
 * the generated Prisma client (same reason as app/admin/seo-health/page.tsx);
 * the variables are bound parameters of a tagged template.
 */
interface CategoryStateStatsRow { locationSlug: string; totalJobs: number; indexable: boolean }

async function getCategoryStateRows(slug: string): Promise<CategoryStateStatsRow[]> {
    try {
        return await prisma.$queryRaw<CategoryStateStatsRow[]>`
            SELECT "locationSlug", "totalJobs", "indexable"
            FROM "PseoStats"
            WHERE "type" = 'setting-state'
              AND "categorySlug" = ${slug}
              AND "totalJobs" >= ${MIN_JOBS_FOR_LINK_LIST_ROW}
              AND "updatedAt" >= ${pseoStatsFreshnessThreshold()}`;
    } catch (error) {
        console.error(`[salary-specialty] category-state rows failed for "${slug}":`, error);
        return [];
    }
}

/** Canonical listing facts for the specialty pool (SPEC-P1 to P4). */
function loadFacts(slug: CategoryTag): Promise<ListingFacts> {
    return getListingFacts(`salary-specialty:${slug}`, tagWhere(slug));
}

// ─── Static params + metadata ───────────────────────────────────────────────

export async function generateStaticParams() {
    return SALARY_SPECIALTY_SLUGS.map((slug) => ({ specialty: slug }));
}

interface PageProps {
    params: Promise<{ specialty: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
    const { specialty } = await params;
    const page = getSpecialtySalaryPage(specialty);
    if (!page) return { title: 'Specialty Not Found' };

    // getListingFacts is cache()d on its scope key, so the page handler
    // reuses this read rather than running a second query.
    const facts = await loadFacts(page.slug);
    const year = facts.computedAt.getUTCFullYear();
    const title = `${page.shortTitle} Salary Guide ${year}: Pay and Top States`;
    // SPEC-meta: the live count and the gated board median, with the
    // all-niche BLS median attached only to niche roles.
    const description = buildSpecialtyDescription({
        role: page.role,
        total: facts.total,
        benchmark: facts.benchmark,
        isNicheRole: page.isNicheRole,
    });
    const ogImage = specialtyOgImage(page);
    const url = `${brand.baseUrl}/salary-guide/specialty/${page.slug}`;

    return {
        title,
        description,
        alternates: { canonical: url },
        openGraph: {
            title,
            description,
            type: 'website',
            url,
            siteName: brand.name,
            images: [{ url: ogImage, width: 1200, height: 630, alt: `${page.shortTitle} salary guide` }],
        },
        twitter: { card: 'summary_large_image', title, description, images: [ogImage] },
    };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Escape angle brackets so JSON-LD can't break out of its <script> tag. */
function sanitizeJson(obj: object): string {
    return JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

interface BandProps {
    eyebrow: string;
    title: ReactNode;
    lede?: string;
    children: ReactNode;
}

/** One section band: eyebrow, Lora heading and the band's clay cards. */
function Band({ eyebrow, title, lede, children }: BandProps) {
    return (
        <section className="sp-band">
            <ClayHead eyebrow={eyebrow} title={title} lede={lede} />
            {children}
        </section>
    );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default async function SpecialtySalaryGuidePage({ params }: PageProps) {
    const { specialty } = await params;
    const page = getSpecialtySalaryPage(specialty);
    if (!page) notFound();

    const [live, topStates, experienceBands, facts, experienceCounts, categoryStateRows] = await Promise.all([
        getLiveStats(page.slug),
        getTopPayingStates(page.slug),
        getExperienceBands(page.slug),
        loadFacts(page.slug),
        getExperienceCounts(page.slug),
        getCategoryStateRows(page.slug),
    ]);

    // P9 #2d: a figure renders ONLY when the benchmark publishing gate
    // passed (n of BENCHMARK_MIN_POSTINGS or more from
    // BENCHMARK_MIN_EMPLOYERS or more employers over the NP-eligible
    // analytics pool). Below it: omit, never fabricate.
    const hasLive = live.gatePassed && live.medianSalary > 0;
    const range = configRange(page);
    const median = STAT_SOURCES.averageSalary;
    const pageUrl = `${brand.baseUrl}/salary-guide/specialty/${page.slug}`;
    const stateEligible = STATE_ELIGIBLE_CATEGORY_SLUGS.includes(page.slug);
    // Shared with the Article description and the FAQ so the visible
    // sentence and the structured data can never disagree about whose
    // median this is.
    const { lead: medianLead, tail: medianTail } = medianSentenceParts(page);
    const nounPlural = specialtyNounPlural(page);
    const noun = specialtyNoun(page);

    // ── SPEC-P1: where roles are open ───────────────────────────────────
    // A state links its category spoke only when that page indexes, and
    // otherwise its state hub, which renders at one or more jobs.
    const indexableStates = new Set(
        categoryStateRows.filter((row) => row.indexable).map((row) => row.locationSlug),
    );
    const places: LocationSpreadPlace[] = facts.states.slice(0, 8).map((state) => {
        const slug = stateToSlug(state.name);
        const spoke = stateEligible && indexableStates.has(slug);
        return {
            name: state.name,
            count: state.count,
            link: {
                href: spoke ? `/jobs/${page.slug}/${slug}` : `/jobs/state/${slug}`,
                renders: state.count >= 1,
            },
        };
    });
    // The same builder LocationSpread renders, so the section and the FAQ
    // entry that repeats it can never disagree.
    const statesSentence = facts.total >= MIN_JOBS_FOR_LINK_LIST_ROW
        ? buildLandingStatesSentence(facts.states)
        : null;

    // ── SPEC-P2: practice rules where those roles are ───────────────────
    const authoritySentence = buildSpecialtyAuthoritySentence({ label: noun, states: facts.states });

    // ── SPEC-P4: the work-mode mix only when it clears the hub floor ────
    const workMode = facts.workMode.total >= MIX_MIN_POSTINGS_HUB ? facts.workMode : null;

    // ── SPEC-P5: sibling guides (editorial relation, no figures) ────────
    const related = getRelatedSpecialtyPages(page.slug);

    // ONE array feeds the FAQPage JSON-LD and the visible accordion. The
    // last two entries repeat only sentences that rendered above.
    const faqs = buildSpecialtyFaqs(page, live, topStates, { statesSentence, workMode });
    const ctaLine = buildSpecialtyCtaLine({ label: noun, total: facts.total });

    // Live stat cards, only when the aggregate clears the gate.
    const statCards = [
        {
            icon: BarChart3,
            label: `All-${brand.niche.short} median (BLS)`,
            value: median.formatted,
            // On a non-niche APRN page this card is a benchmark, not the
            // page's own cohort figure. Say so on the card itself.
            sub: page.isNicheRole ? median.source : `Benchmark, excludes ${nounPlural}`,
        },
        ...(range && page.premium
            ? [{
                icon: TrendingUp,
                label: `Estimated ${page.label} range`,
                value: `${formatSalary(range.min)} to ${formatSalary(range.max)}`,
                sub: `Median times a premium of ${page.premium.minPct} to ${page.premium.maxPct}%`,
            }]
            : []),
        ...(hasLive
            ? [{
                icon: Award,
                label: `Median on ${brand.name}`,
                value: formatSalary(live.medianSalary),
                sub: `Median of ${formatCount(live.jobCount, 'posting')} with disclosed pay`,
            }]
            : []),
        ...(hasLive && hasReportedRange(live)
            ? [{
                icon: Briefcase,
                label: 'Reported range',
                value: `${formatSalary(live.minSalary)} to ${formatSalary(live.maxSalary)}`,
                sub: 'Lowest to highest disclosed figure in the same postings',
            }]
            : []),
    ];

    return (
        <div style={{ backgroundColor: CLAY_GROUND, minHeight: '100vh' }}>
            {/* Band layout. Deliberately a static block: a template
                interpolation inside a style block deadlocks the route
                compile under Turbopack, so every value here is literal. */}
            <style>{`
                .sp-band { max-width: 980px; margin: 0 auto; padding: 0 16px 56px; }
                .sp-grid { display: grid; gap: 20px; grid-template-columns: minmax(0, 1fr); }
                .sp-stats { display: grid; gap: 14px; grid-template-columns: repeat(4, minmax(0, 1fr)); }
                .sp-cta-actions { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; }
                @media (min-width: 720px) {
                    .sp-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
                }
                @media (max-width: 860px) {
                    .sp-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
                }
            `}</style>
            <ClayStyles />
            <BreadcrumbSchema
                items={[
                    { name: 'Home', url: brand.baseUrl },
                    { name: 'Salary Guide', url: `${brand.baseUrl}/salary-guide` },
                    { name: 'Specialties', url: `${brand.baseUrl}/salary-guide/specialty` },
                    { name: page.label, url: pageUrl },
                ]}
            />
            {/* FAQPage, from the same faqs array as the accordion below */}
            {faqs.length >= FAQ_SCHEMA_MIN_ENTRIES && (
                <script
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{ __html: sanitizeJson({
                        '@context': 'https://schema.org',
                        '@type': 'FAQPage',
                        mainEntity: faqs.map((faq) => ({
                            '@type': 'Question',
                            name: faq.q,
                            acceptedAnswer: { '@type': 'Answer', text: faq.a },
                        })),
                    }) }}
                />
            )}
            {/* Article. Dates deliberately omitted: live sections regenerate
                daily and there is no editorial publish date, so stamping a
                modified date of now would fabricate freshness (B54
                principle, same as the salary-guide state pages). Mirrors the
                visible hero: the premium range is labelled "estimated" (it
                is the median times a published premium, not an observation),
                and on a non-niche APRN page the cited median is stated as an
                excluding benchmark rather than as that role's pay. */}
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: sanitizeJson({
                    '@context': 'https://schema.org',
                    '@type': 'Article',
                    headline: `${page.role} Salary Guide: Pay, Premium and Top States`,
                    description: page.isNicheRole
                        ? `${page.role} pay: national all-${brand.niche.short} median ${median.formatted} (${median.source})${range ? `, estimated ${page.label} range ${formatSalary(range.min)} to ${formatSalary(range.max)}` : ''}.`
                        : `${page.role} salary guide: certification, where ${specialtyNounPlural(page)} work, top-paying states, and pay disclosed in live openings on ${brand.name}. ${medianSentence(page)}`,
                    author: { '@type': 'Organization', name: brand.name, url: brand.baseUrl },
                    publisher: { '@type': 'Organization', name: brand.name, logo: { '@type': 'ImageObject', url: `${brand.baseUrl}/logo.png` } },
                    mainEntityOfPage: { '@type': 'WebPage', '@id': pageUrl },
                    image: specialtyOgImage(page),
                    url: pageUrl,
                }) }}
            />
            {/* Speakable: the salary summary plus every FAQ answer */}
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: sanitizeJson({
                    '@context': 'https://schema.org',
                    '@type': 'WebPage',
                    name: `${page.shortTitle} Salary Guide`,
                    speakable: {
                        '@type': 'SpeakableSpecification',
                        cssSelector: ['#specialty-salary-summary', '.faq-answer'],
                    },
                    url: pageUrl,
                }) }}
            />

            {/* Hero */}
            <section style={{ padding: '72px 16px 40px', textAlign: 'center' }}>
                <div style={{ maxWidth: '820px', margin: '0 auto' }}>
                    <span style={{ ...clayChip, background: clayFill(0), gap: '6px' }}>
                        <Stethoscope size={13} /> {page.credential ?? page.label} pay data
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
                        {page.role} Salary
                    </h1>

                    <p
                        id="specialty-salary-summary"
                        data-speakable="true"
                        style={{
                            fontSize: '16px',
                            color: CLAY_BODY,
                            maxWidth: '660px',
                            margin: '0 auto',
                            lineHeight: 1.65,
                        }}
                    >
                        {page.blurb} {medianLead}
                        <strong>{median.formatted}</strong>
                        {medianTail}
                        {range && page.premium && (
                            <>
                                {' '}
                                {page.label} pay is estimated at{' '}
                                <strong>{formatSalary(range.min)} to {formatSalary(range.max)}</strong>
                                {`, a premium of ${page.premium.minPct} to ${page.premium.maxPct}%`}.
                            </>
                        )}
                    </p>
                </div>
            </section>

            {/* Headline figures */}
            <section className="sp-band">
                <div className="sp-stats">
                    {statCards.map(({ icon: Ic, label, value, sub }) => (
                        <div key={label} style={{ ...clayStat, padding: '18px 16px', textAlign: 'left' }}>
                            <Ic size={18} style={{ color: '#BE185D', marginBottom: '8px' }} />
                            <p style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: CLAY_MUTED, margin: '0 0 6px' }}>
                                {label}
                            </p>
                            <p style={{ fontSize: '20px', fontWeight: 800, color: CLAY_INK, margin: '0 0 4px', lineHeight: 1.15 }}>
                                {value}
                            </p>
                            <p style={{ fontSize: '12px', color: CLAY_MUTED, margin: 0, lineHeight: 1.45 }}>{sub}</p>
                        </div>
                    ))}
                </div>
                {/* A4 (teardown parity): provenance under the stat cards.
                    Cited vintage from STAT_SOURCES metadata, and the live
                    snapshot basis only when it clears the SAME benchmark
                    publishing gate the cards use (omit, never fabricate). No
                    review date: live sections regenerate daily and this page
                    has no editorial review literal (B54; its Article schema
                    omits dates too). */}
                <SalaryProvenance
                    cited={[median]}
                    live={hasLive ? { count: live.jobCount, minimum: BENCHMARK_MIN_POSTINGS } : undefined}
                    style={{ margin: '16px 0 0' }}
                />
            </section>

            {/* SPEC-P1 where these roles are open */}
            {statesSentence && places.length > 0 && (
                <Band eyebrow="Openings" title={`Where ${nounPlural} are hiring`}>
                    <LocationSpread
                        variant={{ kind: 'landing' }}
                        places={places}
                        title={`States with open ${noun} roles`}
                        chip="States"
                        icon={MapPin}
                        index={1}
                        headingLevel={3}
                    />
                </Band>
            )}

            {/* SPEC-P2 practice rules where those roles are */}
            {authoritySentence && (
                <Band eyebrow="Practice rules" title={`Practice authority where ${nounPlural} are hiring`}>
                    <ClayCard
                        chip="AANP classification"
                        index={2}
                        icon={ShieldCheck}
                        title="Scope of practice across those states"
                        desc={authoritySentence}
                        headingLevel={3}
                    >
                        <p style={{ ...clayDesc, margin: '16px 0 0', fontSize: '13px' }}>
                            <Link href="/scope-of-practice" style={clayLink}>
                                Compare scope of practice state by state
                            </Link>
                        </p>
                    </ClayCard>
                </Band>
            )}

            {/* SPEC-P3 employers, and SPEC-P4 how the roles are set up */}
            {(facts.distinctEmployers >= 1 || facts.total >= MIX_MIN_POSTINGS_HUB) && (
                <Band eyebrow="Listing mix" title={`Who is hiring ${nounPlural}, and how`}>
                    <div className="sp-grid">
                        <EmployerRoster
                            variant={{ kind: 'scoped', label: noun, scope: 'nationwide' }}
                            facts={facts}
                            title={`Employers hiring ${nounPlural}`}
                            chip="Employers"
                            icon={Building2}
                            index={0}
                            headingLevel={3}
                        />
                        <RoleSetup
                            slug={page.slug}
                            facts={facts}
                            min={MIX_MIN_POSTINGS_HUB}
                            title="How these roles are set up"
                            chip="Role setup"
                            icon={Layers}
                            index={2}
                            headingLevel={3}
                        />
                        {(experienceCounts.threeYears > 0 || experienceCounts.fiveYears > 0 || facts.newGradFriendly > 0) && (
                            <ClayCard
                                chip="Experience"
                                index={3}
                                icon={Award}
                                title="Experience these postings ask for"
                                desc={`Counts over the ${formatCount(facts.total, `current ${noun} listing`)}. The buckets overlap, because a role asking for five years also counts toward three.`}
                                headingLevel={3}
                            >
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '16px' }}>
                                    {[
                                        facts.newGradFriendly > 0 ? { key: 'new-grad', value: facts.newGradFriendly, label: 'open to new graduates' } : null,
                                        experienceCounts.threeYears > 0 ? { key: 'three', value: experienceCounts.threeYears, label: 'ask for 3 years or more' } : null,
                                        experienceCounts.fiveYears > 0 ? { key: 'five', value: experienceCounts.fiveYears, label: 'ask for 5 years or more' } : null,
                                    ].filter((stat): stat is { key: string; value: number; label: string } => stat !== null)
                                        .map((stat) => (
                                            <span key={stat.key} style={clayTile}>
                                                <strong style={{ fontSize: '16px', color: CLAY_INK }}>{stat.value.toLocaleString('en-US')}</strong>
                                                <span style={{ fontSize: '12px', color: CLAY_MUTED }}>{stat.label}</span>
                                            </span>
                                        ))}
                                </div>
                            </ClayCard>
                        )}
                    </div>
                </Band>
            )}

            {/* Top-paying states (live, gated) */}
            {topStates.length >= 3 && (
                <Band
                    eyebrow="Pay by state"
                    title={<>Top-Paying States for {nounPlural}</>}
                    lede={`Medians over active postings with disclosed, non-estimated salary on ${brand.name}, published only for states with at least ${BENCHMARK_MIN_POSTINGS} postings from ${BENCHMARK_MIN_EMPLOYERS} or more employers.`}
                >
                    <ClayTable
                        caption={`Ranked on the gated per-state median over ${brand.name} postings that disclose annual pay, not on posting volume.`}
                        columns={['State', { label: 'Posted median', numeric: true }, { label: 'Postings', numeric: true }, 'Open roles']}
                        rows={topStates.map((s) => [
                            <Link key="guide" href={`/salary-guide/${s.slug}`} style={clayLink}>{s.state}</Link>,
                            formatK(s.medianSalary),
                            s.jobCount.toLocaleString('en-US'),
                            <Link
                                key="jobs"
                                href={stateEligible ? `/jobs/${page.slug}/${s.slug}` : `/jobs/state/${s.slug}`}
                                style={clayLink}
                            >
                                Browse {s.stateCode}
                            </Link>,
                        ])}
                    />
                </Band>
            )}

            {/* Pay by experience requirement (live, gated) */}
            {experienceBands.length > 0 && (
                <Band
                    eyebrow="Pay by experience"
                    title="What experience changes about the pay"
                    lede={`Medians across live ${page.label.toLowerCase()} postings with disclosed salary on this board, grouped by the experience each posting asks for and published only when a bucket clears the ${BENCHMARK_MIN_POSTINGS} posting, ${BENCHMARK_MIN_EMPLOYERS} employer minimum. Buckets overlap.`}
                >
                    <ClayTable
                        caption={`Gated medians per experience bucket over ${brand.name} postings that disclose annual pay.`}
                        columns={['Bucket', { label: 'Posted median', numeric: true }, { label: 'Postings', numeric: true }]}
                        rows={experienceBands.map((band) => [
                            band.label,
                            formatK(band.medianSalary),
                            band.jobCount.toLocaleString('en-US'),
                        ])}
                    />
                </Band>
            )}

            {/* Certification and settings (config-derived, always renders) */}
            <Band eyebrow="Credentials" title={<>Certification & Where {nounPlural} Work</>}>
                <ClayCard
                    chip="Certification"
                    index={1}
                    icon={Award}
                    title={`What ${nounPlural} need`}
                    desc={`${page.certification}. State licensure requirements vary, so check your state board of nursing for specifics.`}
                    headingLevel={3}
                >
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '16px' }}>
                        {page.settings.map((setting) => (
                            <span key={setting} style={{ ...clayChip, background: clayFill(2) }}>{setting}</span>
                        ))}
                    </div>
                </ClayCard>
            </Band>

            {/* SPEC-P5 related guides (editorial relation, no figures) */}
            {related.length > 0 && (
                <Band
                    eyebrow="Related guides"
                    title={`Guides readers compare with ${page.label}`}
                    lede="Adjacent roles, grouped by the care they deliver and the certification path they share."
                >
                    <div className="sp-grid">
                        {related.map((sibling, i) => (
                            <ClayCard
                                key={sibling.slug}
                                href={`/salary-guide/specialty/${sibling.slug}`}
                                chip={sibling.credential ?? sibling.label}
                                index={i}
                                icon={Stethoscope}
                                title={`${sibling.label} salary guide`}
                                desc={sibling.blurb}
                                action="Open the guide"
                                headingLevel={3}
                            />
                        ))}
                    </div>
                </Band>
            )}

            {/* Cross-links */}
            <section className="sp-band">
                <div className="sp-grid">
                    <ClayCard
                        href={`/jobs/${page.slug}`}
                        chip="Browse"
                        index={1}
                        icon={Briefcase}
                        title={`Browse ${page.label} jobs`}
                        desc={ctaLine ?? `Every current ${noun} listing on ${brand.name}, with filters for state, setting and schedule.`}
                        action="Open the listings"
                        headingLevel={3}
                    />
                    <ClayCard
                        href="/salary-guide/specialty"
                        chip="Compare"
                        index={2}
                        icon={Stethoscope}
                        title="All specialty guides"
                        desc={`Pay, premiums and live openings across ${SALARY_SPECIALTY_SLUGS.length} specialties.`}
                        action="Open the index"
                        headingLevel={3}
                    />
                    <ClayCard
                        href="/salary-guide"
                        chip="By state"
                        index={3}
                        icon={BarChart3}
                        title="Pay across every state"
                        desc="The board-wide medians, the states that publish one, and how the publishing gate works."
                        action="Open the salary guide"
                        headingLevel={3}
                    />
                </div>
            </section>

            {/* FAQ, rendered from the SAME faqs array as the FAQPage JSON-LD */}
            {faqs.length > 0 && (
                <Band eyebrow="Questions" title={`${page.role} salary: FAQ`}>
                    <CategoryFAQAccordion
                        faqs={faqs.map((faq) => ({ question: faq.q, answer: faq.a }))}
                    />
                </Band>
            )}

            {/* Data sources */}
            <section className="sp-band">
                <div style={{ ...clayCard, padding: '20px 24px' }}>
                    <p style={{ fontSize: '12px', color: CLAY_MUTED, margin: 0, lineHeight: 1.7 }}>
                        <strong>Data sources:</strong> {median.source}
                        {hasLive && (
                            <>, plus {formatCount(live.jobCount, `active ${page.label.toLowerCase()} posting`)} with disclosed salary on {brand.name}</>
                        )}
                        {page.premium && <>, plus the specialty premium published in the {brand.name} salary guide, applied to that median as an estimate</>}
                        {!page.isNicheRole && (
                            <>. That median covers {brand.niche.long}s and does not include {nounPlural}; no national {page.credential} wage figure is cited on this board</>
                        )}
                        .
                    </p>
                </div>
            </section>

            {/* One alert CTA per page */}
            <section className="sp-band" style={{ paddingBottom: '72px' }}>
                <div style={{ ...clayCta, textAlign: 'center', padding: '40px 24px' }}>
                    <p style={{ ...clayEyebrow, marginBottom: '10px' }}>Job alerts</p>
                    <h2 className="font-lora" style={{ fontSize: 'clamp(22px, 3vw, 30px)', fontWeight: 700, color: CLAY_INK, margin: '0 0 10px' }}>
                        Find {specialtyNoun(page)} Jobs
                    </h2>
                    {ctaLine && (
                        <p style={{ fontSize: '15px', color: CLAY_BODY, margin: '0 auto 24px', maxWidth: '520px', lineHeight: 1.6 }}>
                            {ctaLine}
                        </p>
                    )}
                    <div className="sp-cta-actions">
                        <Link href={`/jobs/${page.slug}`} style={clayButton}>
                            Browse {page.credential ?? page.label} jobs <ArrowRight size={16} />
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
