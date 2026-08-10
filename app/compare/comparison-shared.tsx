/**
 * app/compare/comparison-shared.tsx — shared renderer + metadata builder for
 * the three /compare/<slug> pages (P5 A2).
 *
 * NOT a route file. All three comparison routes render THIS component from
 * the SAME profile objects in lib/compare-data.ts, so the pages cannot drift
 * from each other or from the single review-date constant. JSON-LD derives
 * from the same profile object the visible sections render.
 *
 * Competitor names appear as text only (nominative use) — no logos, no
 * competitor imagery. External competitor links carry rel="nofollow".
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { CheckCircle, Scale, ExternalLink, ArrowRight } from 'lucide-react';
import BreadcrumbSchema from '@/components/BreadcrumbSchema';
import { brand } from '@/config/brand';
import {
    COMPARE_HUB_PATH,
    COMPARE_PUBLISHED_AT,
    COMPARE_REVIEW_DATE,
    COMPARE_REVIEW_DATE_LABEL,
    type CompetitorProfile,
} from '@/lib/compare-data';

/**
 * JSON-LD serializer matching the repo convention (app/resources/fpa-guide/
 * page.tsx, app/companies/page.tsx): angle brackets are escaped so no
 * serialized value can terminate the surrounding script element.
 */
export const ldJson = (obj: unknown): string =>
    JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

/** Edge-generated OG card (repo pattern: app/pricing/page.tsx). */
const ogImageFor = (profile: CompetitorProfile): string =>
    `${brand.baseUrl}/api/og?title=${encodeURIComponent(profile.title)}&type=page`;

/** Builds the route file's exported metadata from the shared profile. */
export function buildCompareMetadata(profile: CompetitorProfile): Metadata {
    const og = ogImageFor(profile);
    return {
        title: profile.metaTitle,
        description: profile.metaDescription,
        openGraph: {
            title: profile.metaTitle,
            description: profile.metaDescription,
            type: 'article',
            images: [{ url: og, width: 1200, height: 630, alt: profile.title }],
        },
        twitter: { card: 'summary_large_image', images: [og] },
        alternates: { canonical: `${brand.baseUrl}${COMPARE_HUB_PATH}/${profile.slug}` },
    };
}

const cardStyle: React.CSSProperties = {
    backgroundColor: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
};

interface ComparisonPageBodyProps {
    profile: CompetitorProfile;
}

export default function ComparisonPageBody({ profile }: ComparisonPageBodyProps) {
    const pageUrl = `${brand.baseUrl}${COMPARE_HUB_PATH}/${profile.slug}`;

    return (
        <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)' }}>
            <BreadcrumbSchema
                items={[
                    { name: 'Home', url: brand.baseUrl },
                    { name: 'Compare', url: `${brand.baseUrl}${COMPARE_HUB_PATH}` },
                    { name: `vs ${profile.competitorName}`, url: pageUrl },
                ]}
            />
            {/* Article schema derives from the SAME profile object the visible
                page renders — headline, dates, and description cannot diverge. */}
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{
                    __html: ldJson({
                        '@context': 'https://schema.org',
                        '@type': 'Article',
                        headline: profile.metaTitle,
                        description: profile.metaDescription,
                        datePublished: COMPARE_PUBLISHED_AT,
                        dateModified: COMPARE_REVIEW_DATE,
                        image: ogImageFor(profile),
                        mainEntityOfPage: pageUrl,
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
                            <Scale className="w-8 h-8" aria-hidden="true" />
                        </div>
                        <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4">{profile.title}</h1>
                        <p className="text-sm text-pink-200 mb-4">
                            Claims checked against {profile.competitorName}&apos;s own public pages on {COMPARE_REVIEW_DATE_LABEL}
                        </p>
                        <p className="text-lg text-pink-100">
                            An honest comparison — including what {profile.competitorName} does better than we do.
                        </p>
                    </div>
                </div>
            </section>

            <div className="container mx-auto px-4 py-8 md:py-12">
                <div className="max-w-5xl mx-auto">
                    {/* Intro */}
                    <div className="mb-8 md:mb-12">
                        <div className="rounded-xl p-6 md:p-8" style={cardStyle}>
                            {profile.intro.map((paragraph, idx) => (
                                <p
                                    key={idx}
                                    className={idx === profile.intro.length - 1 ? 'text-base' : 'text-base mb-4'}
                                    style={{ color: 'var(--text-secondary)' }}
                                >
                                    {paragraph}
                                </p>
                            ))}
                        </div>
                    </div>

                    {/* What the competitor does well */}
                    <div className="mb-8 md:mb-12">
                        <div className="rounded-xl p-6 md:p-8" style={cardStyle}>
                            <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
                                What {profile.competitorName} does well
                            </h2>
                            <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
                                A comparison you can trust has to start here. Each point links to the page it was verified on.
                            </p>
                            <ul className="space-y-4">
                                {profile.strengths.map((claim, idx) => (
                                    <li key={idx} className="flex gap-3">
                                        <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" aria-hidden="true" />
                                        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                                            {claim.text}{' '}
                                            <a
                                                href={claim.sourceUrl}
                                                target="_blank"
                                                rel="nofollow noopener noreferrer"
                                                className="inline-flex items-center gap-1 font-medium hover:underline whitespace-nowrap"
                                                style={{ color: 'var(--color-primary)' }}
                                            >
                                                source <ExternalLink className="h-3 w-3" aria-hidden="true" />
                                            </a>
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>

                    {/* Capability table */}
                    <div className="mb-8 md:mb-12">
                        <div className="rounded-xl p-6 md:p-8" style={cardStyle}>
                            <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
                                Side by side
                            </h2>
                            <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
                                {profile.competitorName} figures are snapshots from {COMPARE_REVIEW_DATE_LABEL}.
                                &ldquo;Not found on the pages we reviewed&rdquo; means exactly that — see the method note below,
                                not a claim the capability does not exist anywhere.
                            </p>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                                            <th scope="col" className="text-left py-3 pr-4 font-semibold" style={{ color: 'var(--text-primary)' }}>
                                                Dimension
                                            </th>
                                            <th scope="col" className="text-left py-3 px-4 font-semibold" style={{ color: 'var(--text-primary)' }}>
                                                {brand.name}
                                            </th>
                                            <th scope="col" className="text-left py-3 pl-4 font-semibold" style={{ color: 'var(--text-primary)' }}>
                                                {profile.competitorName}
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {profile.table.map((row) => (
                                            <tr key={row.dimension} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                <th scope="row" className="text-left py-3 pr-4 font-medium align-top" style={{ color: 'var(--text-primary)' }}>
                                                    {row.dimension}
                                                </th>
                                                <td className="py-3 px-4 align-top" style={{ color: 'var(--text-secondary)' }}>
                                                    {row.us}
                                                </td>
                                                <td className="py-3 pl-4 align-top" style={{ color: 'var(--text-secondary)' }}>
                                                    {row.them}
                                                    {row.themSourceUrl ? (
                                                        <>
                                                            {' '}
                                                            <a
                                                                href={row.themSourceUrl}
                                                                target="_blank"
                                                                rel="nofollow noopener noreferrer"
                                                                className="font-medium hover:underline whitespace-nowrap"
                                                                style={{ color: 'var(--color-primary)' }}
                                                                aria-label={`Source for ${profile.competitorName} — ${row.dimension}`}
                                                            >
                                                                [source]
                                                            </a>
                                                        </>
                                                    ) : null}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    {/* Where we differ */}
                    <div className="mb-8 md:mb-12">
                        <div className="rounded-xl p-6 md:p-8" style={cardStyle}>
                            <h2 className="text-2xl font-bold mb-6" style={{ color: 'var(--text-primary)' }}>
                                Where {brand.name} differs
                            </h2>
                            <div className="space-y-6">
                                {profile.differences.map((item) => (
                                    <div key={item.title}>
                                        <h3 className="font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
                                            {item.title}
                                        </h3>
                                        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                                            {item.body}
                                            {item.href ? (
                                                <>
                                                    {' '}
                                                    <Link
                                                        href={item.href}
                                                        className="inline-flex items-center gap-1 font-medium hover:underline"
                                                        style={{ color: 'var(--color-primary)' }}
                                                    >
                                                        See it live <ArrowRight className="h-3 w-3" aria-hidden="true" />
                                                    </Link>
                                                </>
                                            ) : null}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Honest guidance */}
                    <div className="mb-8 md:mb-12 grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="rounded-xl p-6" style={cardStyle}>
                            <h2 className="text-xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
                                When {profile.competitorName} is the better choice
                            </h2>
                            <ul className="space-y-3">
                                {profile.guidance.useThem.map((reason, idx) => (
                                    <li key={idx} className="flex gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                                        <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" aria-hidden="true" />
                                        <span>{reason}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div className="rounded-xl p-6" style={cardStyle}>
                            <h2 className="text-xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
                                When {brand.name} is the better choice
                            </h2>
                            <ul className="space-y-3">
                                {profile.guidance.useUs.map((reason, idx) => (
                                    <li key={idx} className="flex gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                                        <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" aria-hidden="true" />
                                        <span>{reason}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>

                    {/* Factual-claims-basis footer */}
                    <div className="mb-8 md:mb-12">
                        <div className="rounded-xl p-6 md:p-8" style={cardStyle}>
                            <h2 className="text-xl font-bold mb-3" style={{ color: 'var(--text-primary)' }}>
                                How we verified this page
                            </h2>
                            <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
                                Every factual claim about {profile.competitorName} on this page was checked directly against
                                the public pages listed below on {COMPARE_REVIEW_DATE_LABEL}. Counts and prices are snapshots
                                from that date and will change. Claims we could not confirm that day were left out. Where a
                                table cell says a capability was not found, that statement is scoped to these pages on that
                                date — nothing more.
                            </p>
                            <ul className="space-y-1 mb-4">
                                {profile.pagesReviewed.map((page) => (
                                    <li key={page.url} className="text-sm">
                                        <a
                                            href={page.url}
                                            target="_blank"
                                            rel="nofollow noopener noreferrer"
                                            className="font-medium hover:underline"
                                            style={{ color: 'var(--color-primary)' }}
                                        >
                                            {page.label}
                                        </a>
                                    </li>
                                ))}
                            </ul>
                            <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>
                                {profile.competitorName} and any related marks are trademarks of their respective owners.{' '}
                                {brand.name} is not affiliated with, sponsored by, or endorsed by {profile.competitorName};
                                the name is used only to identify the service being compared.
                            </p>
                            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                                Spotted something outdated or wrong? Email{' '}
                                <a href={`mailto:${brand.email.press}`} className="font-medium hover:underline" style={{ color: 'var(--color-primary)' }}>
                                    {brand.email.press}
                                </a>{' '}
                                and we will correct it. Our own editorial standards are documented in the{' '}
                                <Link href={brand.editorial.policyPath} className="font-medium hover:underline" style={{ color: 'var(--color-primary)' }}>
                                    editorial policy
                                </Link>
                                .
                            </p>
                        </div>
                    </div>

                    {/* Cross-links + CTA */}
                    <div className="text-center py-8">
                        <h2 className="text-2xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
                            See the product for yourself
                        </h2>
                        <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>
                            The fastest way to judge a job board is to use it — no account needed to browse.
                        </p>
                        <div className="flex flex-col sm:flex-row gap-4 justify-center">
                            <Link
                                href="/jobs"
                                className="inline-block bg-pink-700 text-white px-8 py-3 rounded-lg font-medium hover:bg-pink-800 transition-colors"
                            >
                                Browse {brand.niche.short} jobs
                            </Link>
                            <Link
                                href={COMPARE_HUB_PATH}
                                className="inline-block bg-white px-8 py-3 rounded-lg font-medium border border-pink-200 hover:bg-pink-50 transition-colors"
                                style={{ color: 'var(--color-primary)' }}
                            >
                                All comparisons
                            </Link>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
