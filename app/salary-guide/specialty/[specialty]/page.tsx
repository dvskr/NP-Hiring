/**
 * /salary-guide/specialty/[specialty] — by-specialty salary pages
 * (content audit P1 #7: salary queries by specialty dwarf state queries;
 * only the [state] axis existed).
 *
 * Content contract:
 *   - Config-derived content (premium band × cited BLS median,
 *     certification, settings, FAQ) ALWAYS renders — a specialty with
 *     zero salary-bearing inventory still serves a substantive page, so
 *     no notFound()/soft-404 gate like the [state] pages need.
 *   - CREDENTIAL TRUTH: every group noun comes from specialtyNoun /
 *     specialtyNounPlural and every mention of the cited median comes
 *     from medianSentenceParts — never `page.label + brand.niche.short`.
 *     Nurse anesthetists and nurse midwives are APRNs, not the niche
 *     role, and this template must not say otherwise in visible copy or
 *     in JSON-LD.
 *   - Live sections (board averages, top-paying states, experience
 *     bands) render only when the underlying aggregate clears the
 *     MIN_LIVE_JOBS / MIN_STATE_JOBS floors — omit, never fabricate.
 *   - FAQPage JSON-LD and the visible accordion render from ONE array
 *     (B48), escaped with the repo's \u003c pattern.
 */
import { brand } from '@/config/brand';
import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import BreadcrumbSchema from '@/components/BreadcrumbSchema';
import { STAT_SOURCES } from '@/lib/stats-sources';
import { withTagFallback, type CategoryTag } from '@/lib/pseo/category-tagger';
import { STATE_ELIGIBLE_CATEGORY_SLUGS } from '@/lib/pseo/taxonomy-registry';
import { STATE_CODES, stateToSlug } from '@/lib/pseo/setting-state-config';
import {
    getSpecialtySalaryPage,
    SALARY_SPECIALTY_SLUGS,
    SpecialtySalaryPage,
} from '../specialty-config';
import {
    averageOfBounds,
    buildSpecialtyFaqs,
    configRange,
    formatSalary,
    hasReportedRange,
    medianSentence,
    medianSentenceParts,
    MIN_LIVE_JOBS,
    MIN_STATE_JOBS,
    specialtyNoun,
    specialtyNounPlural,
    SpecialtyExperienceRow,
    SpecialtyLiveStats,
    SpecialtyStateRow,
} from '../specialty-content';
import {
    Award,
    ArrowRight,
    BarChart3,
    Briefcase,
    DollarSign,
    MapPin,
    Stethoscope,
    TrendingUp,
} from 'lucide-react';

export const revalidate = 86400; // ISR daily — mirrors /salary-guide/[state]

// OG card via the board's own /api/og edge route (P0 OG-sweep pattern).
const specialtyOgImage = (page: SpecialtySalaryPage): string =>
    `${brand.baseUrl}/api/og?title=${encodeURIComponent(`${page.shortTitle} Salary Guide`)}&type=page`;

// ─── Data fetching (live DB aggregation over Job.categoryTags) ──────────────

/**
 * withTagFallback returns an intentionally untyped where fragment (its
 * callers cast — see lib/pseo/setting-state-template.tsx). Cast once here
 * so every query below stays fully typed.
 */
const tagWhere = (slug: CategoryTag): Prisma.JobWhereInput =>
    withTagFallback(slug) as Prisma.JobWhereInput;

async function getLiveStats(slug: CategoryTag): Promise<SpecialtyLiveStats> {
    const stats = await prisma.job.aggregate({
        where: {
            isPublished: true,
            normalizedMinSalary: { not: null },
            ...tagWhere(slug),
        },
        _avg: { normalizedMinSalary: true, normalizedMaxSalary: true },
        _min: { normalizedMinSalary: true },
        _max: { normalizedMaxSalary: true },
        _count: { id: true },
    });
    return {
        avgSalary: averageOfBounds(stats._avg.normalizedMinSalary, stats._avg.normalizedMaxSalary),
        minSalary: Math.round(stats._min.normalizedMinSalary || 0),
        maxSalary: Math.round(stats._max.normalizedMaxSalary || 0),
        jobCount: stats._count.id,
    };
}

async function getTopPayingStates(slug: CategoryTag): Promise<SpecialtyStateRow[]> {
    const rows = await prisma.job.groupBy({
        by: ['state'],
        where: {
            isPublished: true,
            state: { not: null },
            normalizedMinSalary: { not: null },
            ...tagWhere(slug),
        },
        _avg: { normalizedMinSalary: true, normalizedMaxSalary: true },
        _count: { id: true },
    });
    return rows
        .filter((r) => r.state && STATE_CODES[r.state] && r._count.id >= MIN_STATE_JOBS)
        .map((r) => ({
            state: r.state!,
            stateCode: STATE_CODES[r.state!],
            slug: stateToSlug(r.state!),
            avgSalary: averageOfBounds(r._avg.normalizedMinSalary, r._avg.normalizedMaxSalary),
            jobCount: r._count.id,
        }))
        .filter((r) => r.avgSalary > 0)
        .sort((a, b) => b.avgSalary - a.avgSalary)
        .slice(0, 8);
}

async function getExperienceBands(slug: CategoryTag): Promise<SpecialtyExperienceRow[]> {
    const bands = [
        { label: 'New-grad friendly roles', extra: { newGradFriendly: true } },
        { label: 'Roles requiring 3+ years', extra: { minYearsExperience: { gte: 3 } } },
        { label: 'Roles requiring 5+ years', extra: { minYearsExperience: { gte: 5 } } },
    ] as const;
    const results = await Promise.all(
        bands.map(async (band) => {
            const stats = await prisma.job.aggregate({
                where: {
                    isPublished: true,
                    normalizedMinSalary: { not: null },
                    ...band.extra,
                    ...tagWhere(slug),
                },
                _avg: { normalizedMinSalary: true, normalizedMaxSalary: true },
                _count: { id: true },
            });
            return {
                label: band.label,
                avgSalary: averageOfBounds(stats._avg.normalizedMinSalary, stats._avg.normalizedMaxSalary),
                jobCount: stats._count.id,
            };
        }),
    );
    return results.filter((r) => r.jobCount >= MIN_LIVE_JOBS && r.avgSalary > 0);
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

    // Config-only metadata — no DB queries here (the [state] page pattern:
    // generateMetadata and the page handler run in parallel, so DB work
    // here doubles per-request load for marginal benefit).
    const median = STAT_SOURCES.averageSalary;
    const title = `${page.shortTitle} Salary Guide 2026 — Pay & Top States`;
    const premiumClause = page.premium
        ? ` Typical premium +${page.premium.minPct}–${page.premium.maxPct}% over the all-${brand.niche.short} median.`
        : '';
    // The all-<niche> median is this page's own cohort figure only on a
    // niche-role page; on a CRNA / CNM page it must not headline the
    // description as if it were their pay.
    const description = page.isNicheRole
        ? `${page.role} salary guide: national all-${brand.niche.short} median ${median.formatted} (BLS).${premiumClause} Top-paying states and live openings, updated daily.`
        : `${page.role} salary guide: certification, where ${specialtyNounPlural(page)} work, top-paying states, and live openings with disclosed pay on ${brand.name} — updated daily.`;
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
            images: [{ url: ogImage, width: 1200, height: 630, alt: `${page.shortTitle} Salary Guide 2026` }],
        },
        twitter: { card: 'summary_large_image', title, description, images: [ogImage] },
    };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Escape angle brackets so JSON-LD can't break out of its <script> tag. */
function sanitizeJson(obj: object): string {
    return JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default async function SpecialtySalaryGuidePage({ params }: PageProps) {
    const { specialty } = await params;
    const page = getSpecialtySalaryPage(specialty);
    if (!page) notFound();

    const [live, topStates, experienceBands] = await Promise.all([
        getLiveStats(page.slug),
        getTopPayingStates(page.slug),
        getExperienceBands(page.slug),
    ]);

    // A posting count alone is not enough: if nothing in the set discloses a
    // usable bound the average is 0, and a "$0" stat card is worse than no
    // card at all (omit, never fabricate).
    const hasLive = live.jobCount >= MIN_LIVE_JOBS && live.avgSalary > 0;
    const range = configRange(page);
    const median = STAT_SOURCES.averageSalary;
    const faqs = buildSpecialtyFaqs(page, live, topStates);
    const pageUrl = `${brand.baseUrl}/salary-guide/specialty/${page.slug}`;
    const stateEligible = STATE_ELIGIBLE_CATEGORY_SLUGS.includes(page.slug);
    // Shared with the Article description + FAQ so the visible sentence and
    // the structured data can never disagree about whose median this is.
    const { lead: medianLead, tail: medianTail } = medianSentenceParts(page);
    const nounPlural = specialtyNounPlural(page);

    // Live stat cards, only when the aggregate clears the floor.
    const statCards = [
        {
            icon: DollarSign,
            label: `All-${brand.niche.short} Median (BLS)`,
            value: median.formatted,
            // On a non-niche APRN page this card is a benchmark, not the
            // page's own cohort figure — say so on the card itself.
            sub: page.isNicheRole ? median.source : `Benchmark — excludes ${nounPlural}`,
            color: '#F472B6',
        },
        ...(range && page.premium
            ? [{
                icon: TrendingUp,
                label: `Estimated ${page.label} Range`,
                value: `${formatSalary(range.min)} – ${formatSalary(range.max)}`,
                sub: `Median × +${page.premium.minPct}–${page.premium.maxPct}% premium`,
                color: '#E86C2C',
            }]
            : []),
        ...(hasLive
            ? [
                {
                    icon: BarChart3,
                    label: 'Average on This Board',
                    value: formatSalary(live.avgSalary),
                    sub: `${live.jobCount} postings with disclosed pay`,
                    color: '#A855F7',
                },
            ]
            : []),
        ...(hasLive && hasReportedRange(live)
            ? [{
                icon: Briefcase,
                label: 'Reported Range',
                value: `${formatSalary(live.minSalary)} – ${formatSalary(live.maxSalary)}`,
                sub: 'Min – max across live postings',
                color: '#3B82F6',
            }]
            : []),
    ];

    return (
        <div style={{ backgroundColor: 'var(--bg-primary)', minHeight: '100vh' }}>
            <BreadcrumbSchema
                items={[
                    { name: 'Home', url: brand.baseUrl },
                    { name: 'Salary Guide', url: `${brand.baseUrl}/salary-guide` },
                    { name: 'Specialties', url: `${brand.baseUrl}/salary-guide/specialty` },
                    { name: page.label, url: pageUrl },
                ]}
            />
            {/* FAQPage — the same faqs array renders the visible accordion below */}
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
            {/* Article — dates deliberately omitted: live sections regenerate
                daily and there is no editorial publish date; stamping a
                modified-date of "now" would fabricate freshness (B54
                principle, same as the salary-guide state pages). */}
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: sanitizeJson({
                    '@context': 'https://schema.org',
                    '@type': 'Article',
                    headline: `${page.role} Salary Guide — Pay, Premium & Top States`,
                    // Mirrors the visible hero: the premium range is labelled
                    // "estimated" (it is median × published premium, not an
                    // observation), and on a non-niche APRN page the cited
                    // median is stated as an excluding benchmark rather than
                    // as that role's pay.
                    description: page.isNicheRole
                        ? `${page.role} pay: national all-${brand.niche.short} median ${median.formatted} (${median.source})${range ? `, estimated ${page.label} range ${formatSalary(range.min)}–${formatSalary(range.max)}` : ''}.`
                        : `${page.role} salary guide: certification, where ${specialtyNounPlural(page)} work, top-paying states, and pay disclosed in live openings on ${brand.name}. ${medianSentence(page)}`,
                    author: { '@type': 'Organization', name: brand.name, url: brand.baseUrl },
                    publisher: { '@type': 'Organization', name: brand.name, logo: { '@type': 'ImageObject', url: `${brand.baseUrl}/logo.png` } },
                    mainEntityOfPage: { '@type': 'WebPage', '@id': pageUrl },
                    image: specialtyOgImage(page),
                    url: pageUrl,
                }) }}
            />
            {/* Speakable — salary summary + FAQ answers for voice/AI surfaces */}
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
            <section style={{ padding: '72px 16px 48px', textAlign: 'center' }}>
                <div style={{ maxWidth: '800px', margin: '0 auto' }}>
                    <div
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '8px',
                            backgroundColor: 'rgba(244,114,182,0.1)',
                            border: '1px solid rgba(244,114,182,0.2)',
                            borderRadius: '999px',
                            padding: '6px 16px',
                            marginBottom: '20px',
                            fontSize: '13px',
                            fontWeight: 600,
                            color: '#F472B6',
                        }}
                    >
                        <Stethoscope size={14} /> {page.credential ?? page.label} Salary Data · Updated Daily
                    </div>

                    <h1
                        style={{
                            fontSize: 'clamp(1.75rem, 4.5vw, 2.75rem)',
                            fontWeight: 800,
                            color: 'var(--text-primary)',
                            lineHeight: 1.15,
                            marginBottom: '14px',
                        }}
                    >
                        {page.role} Salary
                    </h1>

                    <p
                        id="specialty-salary-summary"
                        data-speakable="true"
                        style={{
                            fontSize: '16px',
                            color: 'var(--text-secondary)',
                            maxWidth: '640px',
                            margin: '0 auto',
                            lineHeight: 1.6,
                        }}
                    >
                        {page.blurb} {medianLead}
                        <strong>{median.formatted}</strong>
                        {medianTail}
                        {range && page.premium && (
                            <>
                                {' '}
                                {page.label} pay is estimated at{' '}
                                <strong>{formatSalary(range.min)}–{formatSalary(range.max)}</strong>
                                {` (+${page.premium.minPct}–${page.premium.maxPct}% premium)`}.
                            </>
                        )}
                    </p>
                </div>
            </section>

            <section style={{ padding: '0 16px 64px', maxWidth: '900px', margin: '0 auto' }}>
                {/* Stat cards */}
                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                        gap: '16px',
                        marginBottom: '32px',
                    }}
                >
                    {statCards.map(({ icon: Ic, label, value, sub, color }) => (
                        <div
                            key={label}
                            style={{
                                padding: '24px 20px',
                                borderRadius: '16px',
                                backgroundColor: 'var(--bg-secondary)',
                                border: '1px solid var(--border-color)',
                            }}
                        >
                            <Ic size={22} style={{ color, marginBottom: '10px' }} />
                            <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                {label}
                            </p>
                            <p style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '4px' }}>
                                {value}
                            </p>
                            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{sub}</p>
                        </div>
                    ))}
                </div>

                {/* Top-paying states (live, gated) */}
                {topStates.length >= 3 && (
                    <div
                        style={{
                            padding: '32px 28px',
                            borderRadius: '18px',
                            backgroundColor: 'var(--bg-secondary)',
                            border: '1px solid var(--border-color)',
                            marginBottom: '32px',
                        }}
                    >
                        <h2
                            style={{
                                fontSize: '20px',
                                fontWeight: 700,
                                color: 'var(--text-primary)',
                                marginBottom: '6px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                            }}
                        >
                            <MapPin size={20} style={{ color: '#F472B6' }} />
                            Top-Paying States for {nounPlural}
                        </h2>
                        <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '20px' }}>
                            Average of active postings with disclosed salary on {brand.name}. Updated daily.
                        </p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {topStates.map((s, i) => (
                                <div
                                    key={s.state}
                                    style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        padding: '12px 16px',
                                        borderRadius: '12px',
                                        backgroundColor: i % 2 === 0 ? 'var(--bg-tertiary)' : 'transparent',
                                    }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <span style={{ fontSize: '12px', fontWeight: 700, color: '#F472B6', width: '18px' }}>{i + 1}</span>
                                        <Link
                                            href={`/salary-guide/${s.slug}`}
                                            style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', textDecoration: 'none' }}
                                        >
                                            {s.state}
                                        </Link>
                                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{s.stateCode}</span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                                        <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
                                            {formatSalary(s.avgSalary)}
                                        </span>
                                        <Link
                                            href={stateEligible ? `/jobs/${page.slug}/${s.slug}` : `/jobs/state/${s.slug}`}
                                            style={{ fontSize: '12px', fontWeight: 600, color: '#F472B6', textDecoration: 'none' }}
                                        >
                                            {s.jobCount} {s.jobCount === 1 ? 'job' : 'jobs'} →
                                        </Link>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Pay by experience requirement (live, gated) */}
                {experienceBands.length > 0 && (
                    <div
                        style={{
                            padding: '32px 28px',
                            borderRadius: '18px',
                            backgroundColor: 'var(--bg-secondary)',
                            border: '1px solid var(--border-color)',
                            marginBottom: '32px',
                        }}
                    >
                        <h2
                            style={{
                                fontSize: '20px',
                                fontWeight: 700,
                                color: 'var(--text-primary)',
                                marginBottom: '6px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                            }}
                        >
                            <TrendingUp size={20} style={{ color: '#E86C2C' }} />
                            Pay by Experience Requirement
                        </h2>
                        <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '20px' }}>
                            Averages across live {page.label.toLowerCase()} postings on this board, grouped by the
                            experience each posting asks for. Buckets overlap (a 5+ years role also counts toward 3+).
                        </p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {experienceBands.map((band) => (
                                <div
                                    key={band.label}
                                    style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        padding: '12px 16px',
                                        borderRadius: '12px',
                                        backgroundColor: 'var(--bg-tertiary)',
                                    }}
                                >
                                    <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                                        {band.label}
                                    </span>
                                    <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                                        {band.jobCount} {band.jobCount === 1 ? 'posting' : 'postings'}
                                    </span>
                                    <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
                                        {formatSalary(band.avgSalary)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Certification + settings (config-derived — always renders) */}
                <div
                    style={{
                        padding: '32px 28px',
                        borderRadius: '18px',
                        backgroundColor: 'var(--bg-secondary)',
                        border: '1px solid var(--border-color)',
                        marginBottom: '32px',
                    }}
                >
                    <h2
                        style={{
                            fontSize: '20px',
                            fontWeight: 700,
                            color: 'var(--text-primary)',
                            marginBottom: '12px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                        }}
                    >
                        <Award size={20} style={{ color: '#A855F7' }} />
                        Certification & Where {nounPlural} Work
                    </h2>
                    <p style={{ fontSize: '14px', color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: '16px' }}>
                        <strong>Certification:</strong> {page.certification}. State licensure requirements
                        vary — check your state board of nursing for specifics.
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                        {page.settings.map((setting) => (
                            <span
                                key={setting}
                                style={{
                                    fontSize: '12px',
                                    fontWeight: 600,
                                    color: 'var(--text-secondary)',
                                    backgroundColor: 'var(--bg-tertiary)',
                                    border: '1px solid var(--border-color)',
                                    padding: '6px 12px',
                                    borderRadius: '999px',
                                }}
                            >
                                {setting}
                            </span>
                        ))}
                    </div>
                </div>

                {/* Cross-links: category landing + specialty index + national guide */}
                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                        gap: '16px',
                    }}
                >
                    <Link
                        href={`/jobs/${page.slug}`}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            padding: '20px 24px',
                            borderRadius: '14px',
                            backgroundColor: 'var(--bg-secondary)',
                            border: '1px solid var(--border-color)',
                            textDecoration: 'none',
                            transition: 'border-color 0.3s',
                        }}
                    >
                        <Briefcase size={22} style={{ color: '#F472B6', flexShrink: 0 }} />
                        <div>
                            <p style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '2px' }}>
                                Browse {page.label} Jobs →
                            </p>
                            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                {hasLive
                                    ? `${live.jobCount} postings with disclosed salary`
                                    : 'New openings ingested daily'}
                            </p>
                        </div>
                    </Link>

                    <Link
                        href="/salary-guide/specialty"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            padding: '20px 24px',
                            borderRadius: '14px',
                            backgroundColor: 'var(--bg-secondary)',
                            border: '1px solid var(--border-color)',
                            textDecoration: 'none',
                            transition: 'border-color 0.3s',
                        }}
                    >
                        <Stethoscope size={22} style={{ color: '#E86C2C', flexShrink: 0 }} />
                        <div>
                            <p style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '2px' }}>
                                All Specialty Guides →
                            </p>
                            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                Compare pay across {SALARY_SPECIALTY_SLUGS.length} specialties
                            </p>
                        </div>
                    </Link>

                    <Link
                        href="/salary-guide"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            padding: '20px 24px',
                            borderRadius: '14px',
                            backgroundColor: 'var(--bg-secondary)',
                            border: '1px solid var(--border-color)',
                            textDecoration: 'none',
                            transition: 'border-color 0.3s',
                        }}
                    >
                        <BarChart3 size={22} style={{ color: '#3B82F6', flexShrink: 0 }} />
                        <div>
                            <p style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '2px' }}>
                                National Salary Guide →
                            </p>
                            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                All 50 states, settings & experience levels
                            </p>
                        </div>
                    </Link>
                </div>

                {/* FAQ — rendered from the SAME faqs array as the FAQPage JSON-LD */}
                <div style={{ marginTop: '32px' }}>
                    <h2 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '16px' }}>
                        {page.role} Salary — FAQ
                    </h2>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {faqs.map((faq, i) => (
                            <details
                                key={faq.q}
                                {...(i === 0 ? { open: true } : {})}
                                style={{
                                    borderRadius: '14px',
                                    backgroundColor: 'var(--bg-secondary)',
                                    border: '1px solid var(--border-color)',
                                    overflow: 'hidden',
                                }}
                            >
                                <summary style={{ padding: '16px 20px', cursor: 'pointer', fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', listStyle: 'none' }}>
                                    {faq.q}
                                </summary>
                                <p className="faq-answer" style={{ padding: '0 20px 16px', fontSize: '13.5px', color: 'var(--text-secondary)', lineHeight: 1.7, margin: 0 }}>
                                    {faq.a}
                                </p>
                            </details>
                        ))}
                    </div>
                </div>

                {/* Data sources */}
                <div
                    style={{
                        marginTop: '32px',
                        padding: '16px 20px',
                        borderRadius: '14px',
                        backgroundColor: 'var(--bg-secondary)',
                        border: '1px solid var(--border-color)',
                        textAlign: 'center',
                    }}
                >
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>
                        <strong>Data sources:</strong> {median.source}
                        {hasLive && (
                            <> · analysis of {live.jobCount} active {page.label.toLowerCase()} {live.jobCount === 1 ? 'posting' : 'postings'} with disclosed salary on {brand.name} (updated daily)</>
                        )}
                        {page.premium && <> · specialty premium as published in the {brand.name} salary guide, applied to that median as an estimate</>}
                        {!page.isNicheRole && (
                            <> · that median covers {brand.niche.long}s and does not include {nounPlural}; no national {page.credential} wage figure is cited on this board</>
                        )}
                        .
                    </p>
                </div>
            </section>

            {/* CTA */}
            <section
                style={{
                    padding: '64px 16px',
                    textAlign: 'center',
                    backgroundColor: 'var(--bg-secondary)',
                }}
            >
                <div style={{ maxWidth: '600px', margin: '0 auto' }}>
                    <h2
                        style={{
                            fontSize: '24px',
                            fontWeight: 800,
                            color: 'var(--text-primary)',
                            marginBottom: '12px',
                        }}
                    >
                        Find {specialtyNoun(page)} Jobs
                    </h2>
                    <p
                        style={{
                            fontSize: '15px',
                            color: 'var(--text-secondary)',
                            marginBottom: '24px',
                        }}
                    >
                        Browse live {page.label.toLowerCase()} openings and get daily alerts for new positions.
                    </p>
                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
                        <Link
                            href={`/jobs/${page.slug}`}
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '8px',
                                padding: '14px 28px',
                                borderRadius: '14px',
                                fontWeight: 700,
                                fontSize: '15px',
                                color: '#fff',
                                background: 'linear-gradient(135deg, #F472B6, #BE185D)',
                                textDecoration: 'none',
                                boxShadow: '0 4px 16px rgba(244,114,182,0.25)',
                            }}
                        >
                            Browse {page.credential ?? page.label} Jobs <ArrowRight size={16} />
                        </Link>
                        <Link
                            href="/job-alerts"
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '8px',
                                padding: '14px 28px',
                                borderRadius: '14px',
                                fontWeight: 600,
                                fontSize: '15px',
                                color: 'var(--text-primary)',
                                backgroundColor: 'var(--bg-primary)',
                                border: '1px solid var(--border-color)',
                                textDecoration: 'none',
                            }}
                        >
                            Get Job Alerts
                        </Link>
                    </div>
                </div>
            </section>
        </div>
    );
}
