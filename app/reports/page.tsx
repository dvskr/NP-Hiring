/**
 * /reports — hub for the data-report surfaces (P5 A7/A8).
 *
 * Cards render from ALL_REPORTS in lib/reports/editions.ts — the same
 * array the CollectionPage JSON-LD derives from — so the hub can never
 * advertise a report that has no config, and the schema can never claim a
 * report the visible page does not show.
 *
 * TRUTH RULES: the hub types no figure of its own. The publishing floors
 * in the methods block are interpolated from the constants the queries
 * gate on (lib/reports/report-model.ts, components/tools/benchmark-model.ts),
 * so the prose cannot describe a floor the code stopped using; and the one
 * live line comes from the same cache()d `loadHiringReportSnapshot` the
 * annual report renders from, so the hub and the report can never print
 * different totals. A hub that RETYPED "N postings" would go stale the hour
 * after it deployed, which is why nothing here is a literal.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { BarChart3, FileText, ArrowRight, Scale } from 'lucide-react';
import Breadcrumbs from '@/components/Breadcrumbs';
import { brand } from '@/config/brand';
import { ALL_REPORTS, REPORTS_HUB_PATH } from '@/lib/reports/editions';
import {
    REPORT_MIN_GROUP_COUNT,
    REPORT_MIN_SHARE_SAMPLE,
    TREND_MIN_MONTHS,
    TREND_MIN_MONTH_SAMPLE,
} from '@/lib/reports/report-model';
import { BENCHMARK_MIN_EMPLOYERS, BENCHMARK_MIN_POSTINGS } from '@/components/tools/benchmark-model';
import { loadHiringReportSnapshot } from '@/lib/reports/queries';
import { formatCount } from '@/lib/display-text';

/**
 * Live aggregates refresh hourly, the same cadence as /press and both
 * report pages. Without this the hub would be fully static and its one
 * live line would freeze at build time.
 */
export const revalidate = 3600;

const PAGE_URL = `${brand.baseUrl}${REPORTS_HUB_PATH}`;
const PAGE_TITLE = `${brand.niche.short} Hiring Data Reports`;
const PAGE_DESCRIPTION =
    `Data reports built from ${brand.name}'s own ${brand.niche.descriptor} job postings: ` +
    ALL_REPORTS.map((r) => r.title.toLowerCase()).join('; ') +
    `. Every figure is sample-gated and sourced.`;

export const metadata: Metadata = {
    // P7 runtime fix D7: root layout template appends `| ${brand.name}`.
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    alternates: { canonical: PAGE_URL },
    robots: { index: true, follow: true },
    openGraph: {
        title: PAGE_TITLE,
        description: PAGE_DESCRIPTION,
        type: 'website',
        url: PAGE_URL,
        images: [
            {
                url: `${brand.baseUrl}/api/og?title=${encodeURIComponent(PAGE_TITLE)}&type=page`,
                width: 1200,
                height: 630,
                alt: PAGE_TITLE,
            },
        ],
    },
};

const clayCard: React.CSSProperties = {
    background: '#FFFFFF',
    borderRadius: '20px',
    border: '1px solid rgba(0,0,0,0.06)',
    boxShadow:
        '6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6)',
};

/** AA-clearing muted slate — same token and rationale as app/press/page.tsx. */
const MUTED_TEXT = '#5A6E7A';

const REPORT_ICONS = [BarChart3, Scale, FileText] as const;

export default async function ReportsHubPage() {
    // The one live line on the hub. `loadHiringReportSnapshot` is the same
    // cache()d loader the annual report uses, so the hub cannot print a
    // different total from the report it links to; it resolves to null
    // during `next build` and on a repeated query failure, in which case
    // the sentence is simply absent (the /press pattern: omit, never pad).
    const snapshot = await loadHiringReportSnapshot();

    // CollectionPage schema derives from the SAME array the cards render
    // from, escaped with the repo's < pattern.
    const collectionSchema = {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: PAGE_TITLE,
        url: PAGE_URL,
        description: PAGE_DESCRIPTION,
        publisher: { '@type': 'Organization', name: brand.name, url: brand.baseUrl },
        hasPart: ALL_REPORTS.map((report) => ({
            '@type': 'Article',
            headline: report.title,
            url: `${brand.baseUrl}${report.path}`,
            datePublished: report.datePublished,
        })),
    };

    return (
        <div style={{ background: '#F5F0EB', minHeight: '100vh', padding: '48px 16px 80px' }}>
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{
                    __html: JSON.stringify(collectionSchema)
                        .replace(/</g, '\\u003c')
                        .replace(/>/g, '\\u003e'),
                }}
            />
            <div style={{ maxWidth: '860px', margin: '0 auto' }}>
                <Breadcrumbs
                    items={[
                        { label: 'Home', href: '/' },
                        { label: 'Data Reports' },
                    ]}
                />

                <header style={{ marginBottom: '28px' }}>
                    <div
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '6px 14px',
                            background: '#FDF2F8',
                            color: '#BE185D',
                            borderRadius: '20px',
                            fontSize: '13px',
                            fontWeight: 700,
                            marginBottom: '16px',
                        }}
                    >
                        <BarChart3 size={14} /> Data Reports
                    </div>
                    <h1
                        style={{
                            fontSize: 'clamp(2rem, 5vw, 2.75rem)',
                            fontWeight: 800,
                            fontFamily: 'var(--font-lora), Georgia, serif',
                            color: '#1A2E35',
                            margin: '0 0 12px 0',
                            lineHeight: 1.15,
                        }}
                    >
                        What our own listings <span style={{ color: '#BE185D' }}>show</span>
                    </h1>
                    <p style={{ fontSize: '15px', color: '#4A5568', lineHeight: 1.7, margin: 0, maxWidth: '640px' }}>
                        Reports built from {brand.name}&apos;s own {brand.niche.descriptor} postings: live
                        aggregates with the sample limits stated, national context cited to primary sources,
                        and nothing padded to look bigger than it is. Free to quote with attribution via our{' '}
                        <Link href="/press" style={{ color: '#BE185D', textDecoration: 'underline' }}>
                            press &amp; data room
                        </Link>
                        .
                    </p>
                </header>

                <div style={{ display: 'grid', gap: '16px' }}>
                    {ALL_REPORTS.map((report, i) => {
                        const Icon = REPORT_ICONS[i % REPORT_ICONS.length];
                        return (
                            <Link
                                key={report.slug}
                                href={report.path}
                                style={{ ...clayCard, padding: '24px 28px', textDecoration: 'none', display: 'block' }}
                            >
                                <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                                    <div
                                        style={{
                                            width: 44,
                                            height: 44,
                                            borderRadius: 12,
                                            flexShrink: 0,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            background: '#FDF2F8',
                                            color: '#BE185D',
                                        }}
                                    >
                                        <Icon size={22} />
                                    </div>
                                    <div style={{ minWidth: 0, flex: 1 }}>
                                        <h2
                                            style={{
                                                fontSize: '18px',
                                                fontWeight: 700,
                                                color: '#1A2E35',
                                                margin: '2px 0 6px 0',
                                                lineHeight: 1.3,
                                            }}
                                        >
                                            {report.title}
                                        </h2>
                                        <p style={{ fontSize: '14px', color: '#4A5568', lineHeight: 1.65, margin: '0 0 10px 0' }}>
                                            {report.description}
                                        </p>
                                        <span
                                            style={{
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: '6px',
                                                fontSize: '13.5px',
                                                fontWeight: 700,
                                                color: '#BE185D',
                                            }}
                                        >
                                            Read the report <ArrowRight size={15} />
                                        </span>
                                    </div>
                                </div>
                            </Link>
                        );
                    })}
                </div>

                {/* Methods. Every threshold below is interpolated from the
                    constant the queries actually gate on, so the paragraph
                    cannot describe a floor the code stopped using. */}
                <section
                    aria-labelledby="reports-methods-heading"
                    style={{ ...clayCard, padding: '24px 28px', marginTop: '24px' }}
                >
                    <h2
                        id="reports-methods-heading"
                        style={{ fontSize: '16px', fontWeight: 700, color: '#1A2E35', margin: '0 0 10px 0' }}
                    >
                        How these reports handle small samples
                    </h2>
                    <p style={{ fontSize: '13.5px', color: MUTED_TEXT, lineHeight: 1.75, margin: '0 0 10px 0' }}>
                        Every figure is computed from {brand.name}&apos;s own active postings, and each kind
                        of figure has a publishing floor written into the query rather than into the prose.
                        A rate is published as a percentage only when its denominator reaches{' '}
                        {REPORT_MIN_SHARE_SAMPLE} postings; below that the report shows the counts
                        themselves. A row in a breakdown is named only at {REPORT_MIN_GROUP_COUNT} or more
                        postings, and the smaller rows fold into a single remainder line. A month joins the
                        pay disclosure trend only at {TREND_MIN_MONTH_SAMPLE} or more postings added that
                        month, and a trend is drawn only once{' '}
                        {formatCount(TREND_MIN_MONTHS, 'such month')} exist. A pay figure is published only
                        from {BENCHMARK_MIN_POSTINGS} or more postings with employer stated pay across{' '}
                        {BENCHMARK_MIN_EMPLOYERS} or more employers, and pay that our own enrichment
                        pipeline inferred is excluded from that sample entirely.
                    </p>
                    <p style={{ fontSize: '13.5px', color: MUTED_TEXT, lineHeight: 1.75, margin: '0 0 10px 0' }}>
                        Where a sample is below its floor, the report says so in place of the number. The
                        current partial month is excluded from every trend, because a half month of
                        postings reads as a decline that has not happened. These are counts of what
                        employers posted here, not a census of the profession.
                    </p>
                    {snapshot && (
                        <p style={{ fontSize: '13.5px', color: MUTED_TEXT, lineHeight: 1.75, margin: '0 0 10px 0' }}>
                            Current snapshot: {formatCount(snapshot.inventory.totalActive, 'active posting')}{' '}
                            from {formatCount(snapshot.inventory.totalEmployers, 'employer')} across{' '}
                            {formatCount(snapshot.inventory.totalStates, 'state')}.
                        </p>
                    )}
                    <p style={{ fontSize: '13px', color: MUTED_TEXT, lineHeight: 1.7, margin: 0 }}>
                        Full methodology lives on each report and on the{' '}
                        <Link href="/press" style={{ color: '#BE185D', textDecoration: 'underline' }}>
                            press &amp; data room
                        </Link>
                        . Custom cuts:{' '}
                        <a href={`mailto:${brand.email.press}`} style={{ color: '#BE185D', textDecoration: 'underline' }}>
                            {brand.email.press}
                        </a>
                        .
                    </p>
                </section>
            </div>
        </div>
    );
}
