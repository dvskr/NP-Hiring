/**
 * /reports/pay-transparency — our disclosed-salary rate, computed live
 * (P5 A8).
 *
 * TRUTH RULES this page is built around:
 *   - The headline rate and the trend are computed from THIS BOARD's own
 *     database at render time (lib/reports/queries.ts). DB unreachable →
 *     the numbers are OMITTED with a note, never replaced by a constant.
 *   - "Disclosed" is strict: the pay range came from the posting itself.
 *     Figures our enrichment pipeline estimated count as NOT disclosed —
 *     the honest direction to round in, since the page's whole point is
 *     accountability.
 *   - Sample gates from lib/reports/report-model.ts: no rate below the
 *     minimum sample, no trend without enough qualifying months.
 *   - MARKET_OBSERVATIONS (RULE: competitor claims) — every entry was
 *     RE-VERIFIED live on the date in `verifiedOn` by fetching the cited
 *     page; each is a dated, observational quote of what that page said
 *     that day, never a characterization. Claims that could not be
 *     re-verified on that date were dropped, not hedged (which is why no
 *     third-party posting-level statistics appear here). Do not add an
 *     entry without re-verifying it live the same day and updating
 *     `verifiedOn`.
 *   - We do not track state pay-transparency LAW and assert none of it —
 *     the legal dimension links to the authority instead.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import {
    ExternalLink,
    Eye,
    FlaskConical,
    LineChart,
    Scale,
    ShieldCheck,
} from 'lucide-react';
import Breadcrumbs from '@/components/Breadcrumbs';
import { brand } from '@/config/brand';
import {
    PAY_TRANSPARENCY_REPORT,
    REPORTS_HUB_PATH,
    CURRENT_STATE_OF_HIRING_EDITION,
} from '@/lib/reports/editions';
import { loadHiringReportSnapshot, loadDisclosureCohort } from '@/lib/reports/queries';
import {
    computeShare,
    summarizeDisclosureTrend,
    REPORT_MIN_SHARE_SAMPLE,
    TREND_MIN_MONTH_SAMPLE,
    TREND_MIN_MONTHS,
} from '@/lib/reports/report-model';

/** Live numbers refresh hourly — same cadence as /press and the report. */
export const revalidate = 3600;

const PAGE_URL = `${brand.baseUrl}${PAY_TRANSPARENCY_REPORT.path}`;

export const metadata: Metadata = {
    // P7 runtime fix D7: root layout template appends `| ${brand.name}`.
    title: PAY_TRANSPARENCY_REPORT.title,
    description: PAY_TRANSPARENCY_REPORT.description,
    alternates: { canonical: PAGE_URL },
    robots: { index: true, follow: true },
    openGraph: {
        title: PAY_TRANSPARENCY_REPORT.title,
        description: PAY_TRANSPARENCY_REPORT.description,
        type: 'article',
        url: PAGE_URL,
        images: [
            {
                url: `${brand.baseUrl}/api/og?title=${encodeURIComponent('Pay Transparency, Measured')}&type=page`,
                width: 1200,
                height: 630,
                alt: PAY_TRANSPARENCY_REPORT.title,
            },
        ],
    },
};

/**
 * Dated market observations (competitor-claims rule). Each entry is an
 * exact quote fetched live from `sourceUrl` on `verifiedOn` — see the
 * header comment's re-verification rule before editing.
 */
interface MarketObservation {
    board: string;
    /** Exact wording found on the cited page on `verifiedOn`. */
    quote: string;
    /** Where the quote appeared. */
    sourceUrl: string;
    /** Page label for the visible link. */
    sourceLabel: string;
    /** ISO date the page was fetched and the quote confirmed. */
    verifiedOn: string;
}

const MARKET_OBSERVATIONS: readonly MarketObservation[] = [
    {
        board: 'NPHire',
        quote: 'We provide upfront salary, benefits, and work expectations, so you apply with confidence.',
        sourceUrl: 'https://www.nphire.com/candidate',
        sourceLabel: 'nphire.com/candidate',
        verifiedOn: '2026-08-07',
    },
    {
        board: 'Vivian Health',
        quote:
            'Vivian Health is a digital job marketplace for healthcare professionals that lets them browse ' +
            "1,000s of jobs with transparent salary information posted.",
        sourceUrl: 'https://www.vivian.com/faq/',
        sourceLabel: 'vivian.com/faq',
        verifiedOn: '2026-08-07',
    },
];

const clayCard: React.CSSProperties = {
    background: '#FFFFFF',
    borderRadius: '20px',
    border: '1px solid rgba(0,0,0,0.06)',
    boxShadow:
        '6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6)',
};
const linkStyle: React.CSSProperties = { color: '#BE185D', textDecoration: 'underline' };
/** AA-clearing muted slate — same token and rationale as app/press/page.tsx. */
const MUTED_TEXT = '#5A6E7A';

const formatDay = (iso: string): string =>
    new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
const formatMonth = (yyyyMm: string): string =>
    new Date(`${yyyyMm}-01T00:00:00Z`).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        timeZone: 'UTC',
    });

interface SectionProps {
    icon: React.ReactNode;
    title: string;
    id?: string;
    children: React.ReactNode;
}

function Section({ icon, title, id, children }: SectionProps) {
    return (
        <section id={id} style={{ display: 'flex', gap: '14px', marginTop: '32px' }}>
            <div
                style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: '#FDF2F8',
                    color: '#BE185D',
                }}
            >
                {icon}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
                <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1A2E35', margin: '4px 0 8px 0' }}>
                    {title}
                </h2>
                <div style={{ fontSize: '14px', color: '#4A5568', lineHeight: 1.7 }}>{children}</div>
            </div>
        </section>
    );
}

export default async function PayTransparencyReportPage() {
    const [snapshot, cohort] = await Promise.all([
        loadHiringReportSnapshot(),
        loadDisclosureCohort(),
    ]);

    const liveRate = snapshot
        ? computeShare(snapshot.disclosure.disclosed, snapshot.disclosure.total)
        : null;
    const trend = cohort ? summarizeDisclosureTrend(cohort) : null;
    const maxTrendPct = trend ? Math.max(...trend.map((p) => p.pct), 1) : 1;

    const articleSchema = {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: PAY_TRANSPARENCY_REPORT.title,
        description: PAY_TRANSPARENCY_REPORT.description,
        url: PAGE_URL,
        datePublished: PAY_TRANSPARENCY_REPORT.datePublished,
        ...(snapshot ? { dateModified: snapshot.asOf.slice(0, 10) } : {}),
        author: { '@type': 'Organization', name: brand.name, url: brand.baseUrl },
        publisher: { '@type': 'Organization', name: brand.name, url: brand.baseUrl },
        mainEntityOfPage: PAGE_URL,
    };

    return (
        <div style={{ background: '#F5F0EB', minHeight: '100vh', padding: '48px 16px 80px' }}>
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{
                    __html: JSON.stringify(articleSchema)
                        .replace(/</g, '\\u003c')
                        .replace(/>/g, '\\u003e'),
                }}
            />

            <article style={{ ...clayCard, maxWidth: '860px', margin: '0 auto', padding: '48px 40px' }}>
                <Breadcrumbs
                    items={[
                        { label: 'Home', href: '/' },
                        { label: 'Data Reports', href: REPORTS_HUB_PATH },
                        { label: 'Pay Transparency' },
                    ]}
                />

                <header>
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
                            margin: '8px 0 16px',
                        }}
                    >
                        <Eye size={14} /> Accountability Report
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
                        Pay transparency, <span style={{ color: '#BE185D' }}>measured</span>
                    </h1>
                    <p style={{ fontSize: '15px', color: MUTED_TEXT, margin: 0, lineHeight: 1.6 }}>
                        First published {formatDay(PAY_TRANSPARENCY_REPORT.datePublished)}
                        {snapshot && <> · Live figures as of {formatDay(snapshot.asOf)}</>} · Recomputed
                        from current listings on every refresh
                    </p>
                </header>

                <Section icon={<Eye size={20} />} title="Our disclosed-pay rate, live" id="rate">
                    {liveRate ? (
                        <>
                            <div style={{ ...clayCard, padding: '20px 24px', marginTop: '4px', display: 'flex', alignItems: 'baseline', gap: '14px', flexWrap: 'wrap' }}>
                                <span style={{ fontSize: '44px', fontWeight: 800, color: '#BE185D', lineHeight: 1 }}>
                                    {liveRate.pct}%
                                </span>
                                <span style={{ fontSize: '14px', color: '#4A5568' }}>
                                    of {liveRate.denominator.toLocaleString('en-US')} active postings state
                                    an employer-advertised pay range (
                                    {liveRate.numerator.toLocaleString('en-US')} postings)
                                </span>
                            </div>
                            <p style={{ fontSize: '13px', color: MUTED_TEXT, marginTop: '10px' }}>
                                Strict definition: the range came from the posting itself. A posting
                                where we <em>estimated</em> pay because it stated none counts as not
                                disclosing, and estimated pay is left out of every pay figure we publish.
                            </p>
                        </>
                    ) : (
                        <p style={{ ...clayCard, padding: '14px 18px', marginTop: '4px', fontSize: '13.5px', color: MUTED_TEXT }}>
                            {snapshot
                                ? `Sample too small to publish. A disclosure rate appears once there are at least ${REPORT_MIN_SHARE_SAMPLE} active postings.`
                                : 'The live figure is unavailable right now. Please reload later.'}
                        </p>
                    )}
                </Section>

                <Section icon={<LineChart size={20} />} title="The trend, where the sample supports one" id="trend">
                    {trend ? (
                        <>
                            <p>
                                Disclosure rate among postings <em>added to the board</em> in each of the
                                last months with a publishable sample (at least {TREND_MIN_MONTH_SAMPLE}{' '}
                                new postings, excluding the current partial month):
                            </p>
                            <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0 }}>
                                {trend.map((point) => (
                                    <li key={point.month} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '5px 0' }}>
                                        <span style={{ flex: '0 0 90px', fontSize: '13.5px', color: '#1A2E35', fontWeight: 500 }}>
                                            {formatMonth(point.month)}
                                        </span>
                                        <span aria-hidden="true" style={{ flex: 1, height: 10, borderRadius: 6, background: '#FDF2F8' }}>
                                            <span
                                                style={{
                                                    display: 'block',
                                                    width: `${Math.max(2, Math.round((point.pct / maxTrendPct) * 100))}%`,
                                                    height: '100%',
                                                    borderRadius: 6,
                                                    background: '#BE185D',
                                                }}
                                            />
                                        </span>
                                        <span style={{ flex: '0 0 130px', textAlign: 'right', fontSize: '13px', color: '#1A2E35', fontVariantNumeric: 'tabular-nums' }}>
                                            {point.pct}% of {point.total.toLocaleString('en-US')}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                            <p style={{ fontSize: '13px', color: MUTED_TEXT, marginTop: '10px' }}>
                                These are monthly cohorts, not the live inventory, so this line and the
                                headline rate above can differ. Months below the sample minimum are left
                                out.
                            </p>
                        </>
                    ) : (
                        <p style={{ ...clayCard, padding: '14px 18px', marginTop: '4px', fontSize: '13.5px', color: MUTED_TEXT }}>
                            Not enough history to publish a trend yet. A trend needs at least{' '}
                            {TREND_MIN_MONTHS} months with {TREND_MIN_MONTH_SAMPLE}+ new postings each.
                            The live rate above is the current number.
                        </p>
                    )}
                </Section>

                <Section icon={<Scale size={20} />} title="Why this number matters" id="why">
                    <p>
                        A posting without pay asks the candidate to spend interview cycles discovering
                        what the employer already knows. For {brand.niche.descriptor}s, whose advertised
                        ranges legitimately vary by specialty, setting, and state, that discovery cost
                        is real hours, and it lands entirely on the applicant. Disclosed ranges also
                        make the market legible: our{' '}
                        <Link href="/salary-guide" style={linkStyle}>
                            salary guide
                        </Link>{' '}
                        and{' '}
                        <Link href="/tools/salary-benchmark" style={linkStyle}>
                            benchmark tool
                        </Link>{' '}
                        can only be as good as the share of postings that state real numbers.
                    </p>
                    <p style={{ marginTop: '10px' }}>
                        Whether a posting is <em>legally required</em> to carry a pay range depends on
                        state law. Check with your state labor department (
                        <a
                            href="https://www.dol.gov/agencies/whd/state/contacts"
                            target="_blank"
                            rel="noopener noreferrer"
                            style={linkStyle}
                        >
                            directory via the U.S. Department of Labor
                        </a>
                        ).
                    </p>
                </Section>

                <Section icon={<ShieldCheck size={20} />} title="How we apply it" id="ours">
                    <ul style={{ margin: 0, paddingLeft: '20px', lineHeight: 1.85 }}>
                        <li>
                            <strong>Estimated pay never enters a published figure.</strong> The benchmark
                            tool, company pay summaries, and our data reports count only
                            employer-advertised ranges.
                        </li>
                        <li>
                            <strong>Pay figures need a minimum sample.</strong> A state pay figure appears
                            only once it meets the benchmark tool&apos;s minimum postings and distinct
                            employers, here and across the site.
                        </li>
                        <li>
                            <strong>Candidates can filter by pay.</strong> Postings with advertised
                            ranges surface it on the card and in the salary-floor filter on{' '}
                            <Link href="/jobs" style={linkStyle}>
                                the jobs board
                            </Link>
                            .
                        </li>
                    </ul>
                </Section>

                <Section icon={<ExternalLink size={20} />} title="Market observations, dated" id="market">
                    <p>
                        Other boards make commitments to pay transparency too. The quotes below are what
                        each cited page said on the date shown. Sites change, so follow the links for the
                        current wording.
                    </p>
                    <div style={{ display: 'grid', gap: '12px', marginTop: '12px' }}>
                        {MARKET_OBSERVATIONS.map((obs) => (
                            <figure key={obs.board} style={{ ...clayCard, padding: '16px 20px', margin: 0 }}>
                                <blockquote style={{ margin: 0, fontSize: '14px', color: '#1A2E35', lineHeight: 1.65 }}>
                                    &ldquo;{obs.quote}&rdquo;
                                </blockquote>
                                <figcaption style={{ fontSize: '12.5px', color: MUTED_TEXT, marginTop: '8px' }}>
                                    {obs.board},{' '}
                                    <a href={obs.sourceUrl} target="_blank" rel="noopener noreferrer" style={linkStyle}>
                                        {obs.sourceLabel}
                                    </a>
                                    , as fetched {formatDay(obs.verifiedOn)}
                                </figcaption>
                            </figure>
                        ))}
                    </div>
                </Section>

                <Section icon={<FlaskConical size={20} />} title="Methodology" id="methodology">
                    <ul style={{ margin: 0, paddingLeft: '20px', lineHeight: 1.85 }}>
                        <li>
                            <strong>Disclosed</strong> = an active posting whose normalized pay range came
                            from the posting itself (estimated pay counts as not disclosed). Active =
                            published, unexpired, and not flagged for a repeatedly broken link.
                        </li>
                        <li>
                            <strong>Trend cohorts</strong> are postings first added to the board in each
                            calendar month, over the last twelve complete months. The current partial
                            month is excluded because a half-month reads as a drop that is not there.
                        </li>
                        <li>
                            <strong>Minimums:</strong> a rate needs at least {REPORT_MIN_SHARE_SAMPLE}{' '}
                            postings. A trend month needs at least {TREND_MIN_MONTH_SAMPLE} new postings.
                            A trend needs at least {TREND_MIN_MONTHS} qualifying months.
                        </li>
                        <li>
                            <strong>Scope:</strong> this describes {brand.name}&apos;s inventory, not the{' '}
                            {brand.niche.short} job market. Aggregated postings originate from employer
                            sites and partner feeds, so the disclosure rate partly reflects what sources
                            publish.
                        </li>
                        <li>
                            <strong>Market observations</strong> are verbatim quotes, checked live on the
                            stated date, with sources linked. They say nothing about another board beyond
                            what its own cited page said that day.
                        </li>
                    </ul>
                    <p style={{ marginTop: '12px' }}>
                        Companion report:{' '}
                        <Link href={CURRENT_STATE_OF_HIRING_EDITION.path} style={linkStyle}>
                            {CURRENT_STATE_OF_HIRING_EDITION.title}
                        </Link>
                        . Citation format and custom cuts:{' '}
                        <Link href="/press" style={linkStyle}>
                            press &amp; data room
                        </Link>{' '}
                        ·{' '}
                        <a href={`mailto:${brand.email.press}`} style={linkStyle}>
                            {brand.email.press}
                        </a>
                        .
                    </p>
                </Section>
            </article>
        </div>
    );
}
