/**
 * app/compare/page.tsx — hub for the vs-competitor comparison series
 * (P5 A2). Cards derive from COMPETITOR_PROFILES in lib/compare-data.ts —
 * the same array the three detail pages render from — so the hub can never
 * advertise a comparison that does not exist.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Scale, ArrowRight } from 'lucide-react';
import BreadcrumbSchema from '@/components/BreadcrumbSchema';
import { brand } from '@/config/brand';
import {
    COMPARE_HUB_PATH,
    COMPARE_REVIEW_DATE_LABEL,
    COMPETITOR_PROFILES,
} from '@/lib/compare-data';
import { ldJson } from './comparison-shared';

const OG_IMAGE = `${brand.baseUrl}/api/og?title=${encodeURIComponent(
    `${brand.name} vs other ${brand.niche.short} job boards`,
)}&type=page`;

export const metadata: Metadata = {
    title: `${brand.name} vs Other ${brand.niche.short} Job Boards — Honest Comparisons`,
    description: `Side-by-side comparisons of ${brand.name} with Indeed, the AANP JobCenter, and ENP Network for ${brand.niche.descriptor} job searches and hiring. Every claim dated and checked against each competitor's own pages.`,
    openGraph: {
        title: `${brand.name} vs Other ${brand.niche.short} Job Boards`,
        description: `Honest, dated, source-checked comparisons — including what each competitor does better than we do.`,
        images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: `${brand.name} comparisons` }],
    },
    twitter: { card: 'summary_large_image', images: [OG_IMAGE] },
    alternates: { canonical: `${brand.baseUrl}${COMPARE_HUB_PATH}` },
};

export default function CompareHubPage() {
    return (
        <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)' }}>
            <BreadcrumbSchema
                items={[
                    { name: 'Home', url: brand.baseUrl },
                    { name: 'Compare', url: `${brand.baseUrl}${COMPARE_HUB_PATH}` },
                ]}
            />
            {/* ItemList derives from the SAME array the cards render from. */}
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{
                    __html: ldJson({
                        '@context': 'https://schema.org',
                        '@type': 'CollectionPage',
                        name: `${brand.name} comparisons`,
                        url: `${brand.baseUrl}${COMPARE_HUB_PATH}`,
                        mainEntity: {
                            '@type': 'ItemList',
                            itemListElement: COMPETITOR_PROFILES.map((profile, idx) => ({
                                '@type': 'ListItem',
                                position: idx + 1,
                                name: profile.metaTitle,
                                url: `${brand.baseUrl}${COMPARE_HUB_PATH}/${profile.slug}`,
                            })),
                        },
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
                        <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4">
                            {brand.name} vs other {brand.niche.short} job boards
                        </h1>
                        <p className="text-lg md:text-xl text-pink-100">
                            Honest comparisons: what each competitor does well, where we differ, and how to choose.
                        </p>
                    </div>
                </div>
            </section>

            <div className="container mx-auto px-4 py-8 md:py-12">
                <div className="max-w-5xl mx-auto">
                    {/* Ground rules */}
                    <div className="mb-8 md:mb-12">
                        <div
                            className="rounded-xl p-6 md:p-8"
                            style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}
                        >
                            <h2 className="text-2xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
                                How these comparisons work
                            </h2>
                            <ul className="space-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                                <li>
                                    Every factual claim about a competitor was checked against that competitor&apos;s own public
                                    pages on {COMPARE_REVIEW_DATE_LABEL}; each page lists exactly which pages were reviewed.
                                </li>
                                <li>Claims we could not verify on that date were left out — even the flattering-to-us ones.</li>
                                <li>Each page opens with what the competitor does well, because a comparison that skips that is an ad.</li>
                                <li>
                                    Competitor names are used only to identify the services compared; all trademarks belong to
                                    their owners, and none of these companies is affiliated with {brand.name}.
                                </li>
                                <li>
                                    Corrections are welcome at{' '}
                                    <a
                                        href={`mailto:${brand.email.press}`}
                                        className="font-medium hover:underline"
                                        style={{ color: 'var(--color-primary)' }}
                                    >
                                        {brand.email.press}
                                    </a>
                                    .
                                </li>
                            </ul>
                        </div>
                    </div>

                    {/* Comparison cards — derived from the same array as the routes */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                        {COMPETITOR_PROFILES.map((profile) => (
                            <Link
                                key={profile.slug}
                                href={`${COMPARE_HUB_PATH}/${profile.slug}`}
                                className="block p-6 rounded-xl hover:shadow-sm transition-all"
                                style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}
                            >
                                <h2 className="font-semibold text-lg mb-2" style={{ color: 'var(--color-primary)' }}>
                                    vs {profile.competitorName}
                                </h2>
                                <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>
                                    {profile.metaDescription}
                                </p>
                                <span
                                    className="inline-flex items-center gap-1 text-sm font-medium"
                                    style={{ color: 'var(--color-primary)' }}
                                >
                                    Read the comparison <ArrowRight className="h-4 w-4" aria-hidden="true" />
                                </span>
                            </Link>
                        ))}
                    </div>

                    {/* CTA */}
                    <div className="text-center py-8">
                        <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>
                            Or skip the reading and judge the product directly — browsing is open, no account required.
                        </p>
                        <Link
                            href="/jobs"
                            className="inline-block bg-pink-700 text-white px-8 py-3 rounded-lg font-medium hover:bg-pink-800 transition-colors"
                        >
                            Browse {brand.niche.short} jobs
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
