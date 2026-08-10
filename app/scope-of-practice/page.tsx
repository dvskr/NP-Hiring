import { brand } from '@/config/brand';
import { Metadata } from 'next';
import Link from 'next/link';
import {
    AlertTriangle, CheckCircle, ExternalLink, Shield, XCircle,
} from 'lucide-react';
import BreadcrumbSchema from '@/components/BreadcrumbSchema';
import ScopeOfPracticeExplorer from '@/components/ScopeOfPracticeExplorer';
import {
    AANP_STATE_PRACTICE_URL,
    NLC_LIVE_ROSTER_URL,
    SOP_COUNTS,
    SOP_LAST_REVIEWED,
    SOP_PUBLISHED_AT,
    SOP_SOURCE_LINE,
    SOP_STATE_ROWS,
    buildSopFaqs,
} from '@/components/ScopeOfPracticeData';
import { getAuthorityColor } from '@/lib/state-practice-authority';

/**
 * /scope-of-practice — the interactive 51-jurisdiction scope-of-practice
 * hub (P5 sop-hub).
 *
 * Everything factual on this page comes from components/ScopeOfPracticeData.ts
 * (which itself renders lib/state-practice-authority.ts and the verified
 * NCSBN board directory in lib/blog-license-guides.ts verbatim). Dimensions
 * the repo does not store — prescribing schedules, agreement contents,
 * fees, renewal rules, NLC membership — are LINKED to their authorities
 * (state board, AANP, live NCSBN roster), never asserted. See the data
 * module's header for the full truth-rule rationale, including why NLC
 * membership booleans are deliberately absent.
 */

/**
 * JSON-LD serializer matching the repo convention (see
 * app/resources/fpa-guide/page.tsx): angle brackets are escaped so no
 * serialized value can terminate the surrounding script element.
 */
const ldJson = (obj: unknown): string =>
    JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

// Edge-generated OG card via /api/og (P0 OG sweep pattern). Absolute URL
// because it also feeds Article JSON-LD `image`.
const HERO_IMAGE = `${brand.baseUrl}/api/og?title=${encodeURIComponent(`${brand.niche.short} Scope of Practice by State`)}&type=page`;

export const metadata: Metadata = {
    title: `${brand.niche.short} Scope of Practice by State 2026 — All 50 States + DC`,
    description: `Interactive ${brand.niche.short} scope-of-practice explorer: sort and filter all 50 states + DC by full, reduced, or restricted practice authority, with per-state details, board of nursing links, licensure guides, salary data, and open jobs.`,
    keywords: [
        `${brand.niche.short} scope of practice by state`,
        `${brand.niche.descriptor} practice authority`,
        `${brand.niche.short} independent practice states`,
        `${brand.niche.short} full practice authority map`,
        `${brand.niche.short} restricted practice states`,
        `${brand.niche.short} collaborative agreement states`,
    ],
    openGraph: {
        title: `${brand.niche.short} Scope of Practice by State — 2026 Interactive Explorer`,
        description: `Sortable, filterable practice-authority classifications for all 50 states + DC, with board links and live per-state pay and job data.`,
        type: 'article',
        images: [{ url: HERO_IMAGE, width: 1200, height: 630, alt: `${brand.niche.short} scope of practice by state` }],
    },
    twitter: {
        card: 'summary_large_image',
        title: `${brand.niche.short} Scope of Practice by State 2026`,
        images: [HERO_IMAGE],
    },
    alternates: { canonical: `${brand.baseUrl}/scope-of-practice` },
};

/** Legend copy for the three AANP tiers (semantics match the dataset). */
const TIER_LEGEND = [
    {
        authority: 'full' as const,
        icon: CheckCircle,
        heading: 'Full Practice Authority',
        body: 'Evaluate, diagnose, order and interpret tests, and prescribe under the licensure authority of the state board of nursing — no mandated physician relationship. Some full-practice states phase this in through a transition-to-practice period.',
        iconClass: 'text-green-600',
        headingClass: 'text-green-800',
        bodyClass: 'text-green-700',
        cardClass: 'bg-green-50 border-green-200',
    },
    {
        authority: 'reduced' as const,
        icon: AlertTriangle,
        heading: 'Reduced Practice',
        body: 'A documented collaborative agreement with a physician is required for at least one element of practice — most commonly prescribing. The collaborating physician typically does not need to be on-site.',
        iconClass: 'text-yellow-600',
        headingClass: 'text-yellow-800',
        bodyClass: 'text-yellow-700',
        cardClass: 'bg-yellow-50 border-yellow-200',
    },
    {
        authority: 'restricted' as const,
        icon: XCircle,
        heading: 'Restricted Practice',
        body: 'State law requires supervision, delegation, or team management by a physician. Postings in these states typically name a supervising physician and reference protocols or practice agreements.',
        iconClass: 'text-orange-600',
        headingClass: 'text-orange-800',
        bodyClass: 'text-orange-700',
        cardClass: 'bg-orange-50 border-orange-200',
    },
];

export default function ScopeOfPracticePage() {
    const sopFaqs = buildSopFaqs();

    return (
        <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)' }}>
            <BreadcrumbSchema items={[
                { name: 'Home', url: brand.baseUrl },
                { name: 'Scope of Practice by State', url: `${brand.baseUrl}/scope-of-practice` },
            ]} />
            {/* FAQPage JSON-LD — derived from the SAME sopFaqs array rendered
                in the visible FAQ section below, so schema and page content
                can never diverge. */}
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{
                    __html: ldJson({
                        '@context': 'https://schema.org',
                        '@type': 'FAQPage',
                        mainEntity: sopFaqs.map((faq) => ({
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
                        headline: `${brand.niche.short} Scope of Practice by State 2026 — All 50 States + DC`,
                        description: `Interactive state-by-state scope-of-practice explorer for ${brand.niche.descriptor}s.`,
                        datePublished: SOP_PUBLISHED_AT,
                        dateModified: SOP_LAST_REVIEWED,
                        image: HERO_IMAGE,
                        author: { '@type': 'Organization', name: brand.name },
                        publisher: { '@type': 'Organization', name: brand.name, url: brand.baseUrl },
                    }),
                }}
            />

            {/* Hero */}
            <section className="bg-gradient-to-r from-pink-700 to-pink-800 text-white py-12 md:py-16">
                <div className="container mx-auto px-4">
                    <div className="max-w-4xl mx-auto text-center">
                        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-white/10 mb-6">
                            <Shield className="w-8 h-8" aria-hidden="true" />
                        </div>
                        <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4">
                            {brand.niche.short} Scope of Practice by State
                        </h1>
                        <p className="text-lg md:text-xl text-pink-100 mb-4">
                            Every state&apos;s practice-authority classification in one
                            sortable, filterable view — with each state&apos;s board of
                            nursing, licensure guide, live salary data, and open jobs one
                            click away.
                        </p>
                        {/* Real editorial literal (audit B54 pattern): the same
                            constant feeds Article.dateModified — freshness is
                            never fabricated at render time. */}
                        <p className="text-sm text-pink-200 mb-1">
                            Last reviewed: {new Date(`${SOP_LAST_REVIEWED}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}
                        </p>
                        <p className="text-sm text-pink-200">
                            Source: {SOP_SOURCE_LINE}
                        </p>
                        <div className="flex flex-wrap justify-center gap-6 md:gap-8 mt-8">
                            <div className="text-center">
                                <div className="text-3xl font-bold">{SOP_COUNTS.full}</div>
                                <div className="text-sm text-pink-100">Full Practice states (+ DC)</div>
                            </div>
                            <div className="text-center">
                                <div className="text-3xl font-bold">{SOP_COUNTS.reduced}</div>
                                <div className="text-sm text-pink-100">Reduced Practice</div>
                            </div>
                            <div className="text-center">
                                <div className="text-3xl font-bold">{SOP_COUNTS.restricted}</div>
                                <div className="text-sm text-pink-100">Restricted Practice</div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <div className="container mx-auto px-4 py-8 md:py-12">
                <div className="max-w-5xl mx-auto">

                    {/* Tier legend */}
                    <div className="mb-8 md:mb-12">
                        <div className="rounded-xl p-6 md:p-8" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
                            <h2 className="text-2xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
                                The three practice environments
                            </h2>
                            <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
                                The AANP classifies each state&apos;s regulatory environment
                                for {brand.niche.descriptor}s into one of three tiers. The
                                tier tells you the legal structure around practice — it is
                                not a pay scale, and it is not the fine print: prescribing
                                schedules, agreement contents, fees, and renewal rules are
                                set by each state board of nursing, which is why every
                                state below links its board directly.
                            </p>
                            <div className="grid md:grid-cols-3 gap-4 mt-6">
                                {TIER_LEGEND.map((tierInfo) => (
                                    <div key={tierInfo.authority} className={`p-4 rounded-lg border ${tierInfo.cardClass}`}>
                                        <div className="flex items-center gap-2 mb-2">
                                            <tierInfo.icon className={`h-5 w-5 ${tierInfo.iconClass}`} aria-hidden="true" />
                                            <h3 className={`font-semibold ${tierInfo.headingClass}`}>{tierInfo.heading}</h3>
                                        </div>
                                        <p className={`text-sm ${tierInfo.bodyClass}`}>{tierInfo.body}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Interactive explorer */}
                    <div className="mb-8 md:mb-12">
                        <div className="rounded-xl p-6 md:p-8" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
                            <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
                                Explore all 50 states + DC
                            </h2>
                            <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
                                Sort by state or by authority tier, filter, or search.
                                State names jump to the detail section below; the links on
                                each row go straight to that state&apos;s licensure guide,
                                live salary page, and open jobs.
                            </p>
                            <ScopeOfPracticeExplorer rows={[...SOP_STATE_ROWS]} />
                        </div>
                    </div>

                    {/* NLC note — link the live roster, never a stored list (see
                        components/ScopeOfPracticeData.ts for why membership
                        booleans are deliberately absent from this page). */}
                    <div className="mb-8 md:mb-12">
                        <div className="rounded-xl p-6 md:p-8" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
                            <h2 className="text-2xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
                                Where the Nurse Licensure Compact fits
                            </h2>
                            <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
                                The compact covers the <strong>RN license</strong> that
                                underpins your APRN credential — a multistate RN license is
                                recognized across member states. It does not change your
                                scope of practice: APRN licensure is issued state by state,
                                and the practice environment above is what governs how you
                                work there.
                            </p>
                            <p style={{ color: 'var(--text-secondary)' }}>
                                Membership shifts as legislatures act, and some
                                jurisdictions sit between enactment and implementation, so
                                this page deliberately does not publish a membership list.
                                Check each state you plan to cover against the{' '}
                                <a href={NLC_LIVE_ROSTER_URL} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline" style={{ color: 'var(--color-primary)' }}>
                                    live NCSBN compact roster
                                    <ExternalLink className="inline h-3.5 w-3.5 ml-1" aria-hidden="true" />
                                </a>
                                .
                            </p>
                        </div>
                    </div>

                    {/* Per-state detail sections (deep-anchor targets) */}
                    <div className="mb-8 md:mb-12">
                        <div className="rounded-xl p-6 md:p-8" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
                            <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
                                State-by-state details
                            </h2>
                            <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
                                What we track here: the AANP classification and what it
                                means in that state. What we deliberately leave to the
                                authorities: prescribing schedules, agreement contents,
                                fees, and renewal rules — those change too often to restate,
                                so each state links its board of nursing, and the{' '}
                                <a href={AANP_STATE_PRACTICE_URL} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline" style={{ color: 'var(--color-primary)' }}>
                                    AANP State Practice Environment page
                                    <ExternalLink className="inline h-3.5 w-3.5 ml-1" aria-hidden="true" />
                                </a>{' '}
                                tracks classification changes as legislatures act.
                            </p>
                            <div className="space-y-4">
                                {SOP_STATE_ROWS.map((row) => {
                                    const colors = getAuthorityColor(row.authority);
                                    return (
                                        <section
                                            key={row.stateSlug}
                                            id={row.anchorId}
                                            aria-label={`${row.name} scope of practice`}
                                            className="rounded-lg p-4"
                                            style={{ border: '1px solid var(--border-color)', scrollMarginTop: '96px' }}
                                        >
                                            <div className="flex flex-wrap items-center gap-2 mb-2">
                                                <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                                                    {row.name} <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>({row.code})</span>
                                                </h3>
                                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors.bg} ${colors.text} ${colors.border} border`}>
                                                    {row.authorityLabel}
                                                </span>
                                            </div>
                                            <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>
                                                {row.details}
                                            </p>
                                            <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium">
                                                <a href={row.boardUrl} target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: 'var(--color-primary)' }}>
                                                    {row.boardName}
                                                    <ExternalLink className="inline h-3 w-3 ml-1" aria-hidden="true" />
                                                </a>
                                                {row.licenseGuideHref && (
                                                    <Link href={row.licenseGuideHref} className="hover:underline" style={{ color: 'var(--color-primary)' }}>
                                                        Licensure guide
                                                    </Link>
                                                )}
                                                <Link href={row.salaryHref} className="hover:underline" style={{ color: 'var(--color-primary)' }}>
                                                    Salary data
                                                </Link>
                                                <Link href={row.jobsHref} className="hover:underline" style={{ color: 'var(--color-primary)' }}>
                                                    Open jobs
                                                </Link>
                                            </p>
                                        </section>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    {/* FAQ — rendered from the SAME array as the FAQPage JSON-LD */}
                    <div className="mb-8 md:mb-12">
                        <div className="rounded-xl p-6 md:p-8" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
                            <h2 className="text-2xl font-bold mb-6" style={{ color: 'var(--text-primary)' }}>
                                Frequently asked questions
                            </h2>
                            {sopFaqs.map((faq) => (
                                <div key={faq.question} className="mb-6 last:mb-0">
                                    <h3 className="font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>{faq.question}</h3>
                                    <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{faq.answer}</p>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Related resources */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                        <Link href="/resources/fpa-guide" className="block p-4 rounded-lg hover:shadow-sm transition-all" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
                            <h3 className="font-semibold" style={{ color: 'var(--color-primary)' }}>Full Practice Authority guide</h3>
                            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>What practice authority changes about how you can work and earn.</p>
                        </Link>
                        <Link href="/tools/licensure-checker" className="block p-4 rounded-lg hover:shadow-sm transition-all" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
                            <h3 className="font-semibold" style={{ color: 'var(--color-primary)' }}>Licensure checker &amp; multi-state planner</h3>
                            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>Line up the states you&apos;re considering side by side.</p>
                        </Link>
                        <Link href="/salary-guide" className="block p-4 rounded-lg hover:shadow-sm transition-all" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
                            <h3 className="font-semibold" style={{ color: 'var(--color-primary)' }}>{brand.niche.short} salary guide</h3>
                            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>State-by-state pay computed from live postings.</p>
                        </Link>
                    </div>

                    {/* CTA */}
                    <div className="text-center py-8">
                        <h2 className="text-2xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
                            Find {brand.niche.short} jobs where you want to practice
                        </h2>
                        <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>
                            Browse {brand.niche.descriptor} positions updated daily, in
                            every practice environment.
                        </p>
                        <div className="flex flex-col sm:flex-row gap-4 justify-center">
                            <Link href="/jobs" className="inline-block bg-pink-700 text-white px-8 py-3 rounded-lg font-medium hover:bg-pink-800 transition-colors">Browse All Jobs</Link>
                            <Link href="/salary-guide" className="inline-block bg-white px-8 py-3 rounded-lg font-medium border border-pink-200 hover:bg-pink-50 transition-colors" style={{ color: 'var(--color-primary)' }}>View Salary Guide</Link>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
