/**
 * /reports/state-of-np-hiring-2026 — the 2026 State of Hiring data report
 * (P5 A7).
 *
 * TRUTH RULES this page is built around:
 *   - Every live figure renders from lib/reports/queries.ts aggregates over
 *     THIS BOARD's active postings (the same activeIndexableJobWhere()
 *     filter the sitemaps and /press use). If the database is unreachable
 *     the live sections are OMITTED and the page says so — no fallback
 *     constants, ever.
 *   - Sample gates from lib/reports/report-model.ts decide what publishes:
 *     below-threshold sections render a "sample too small" note, never a
 *     padded number. The advertised-pay table reuses the public benchmark
 *     widget's min-postings / min-distinct-employers gates verbatim.
 *   - National context renders ONLY from lib/stats-sources.ts entries with
 *     their citations — the same objects /press and /salary-guide cite.
 *   - The Methodology section states the basis, the as-of timestamp from
 *     the query itself, and what this report is NOT (not a national census,
 *     not a wage survey).
 *   - Designed for annual re-issue: this page is the 2026 edition object in
 *     lib/reports/editions.ts. Next year is a NEW edition entry + folder,
 *     never a rewrite of this page (published editions get cited).
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import {
    BarChart3,
    Building2,
    FlaskConical,
    GraduationCap,
    Landmark,
    MapPin,
    Stethoscope,
    Wallet,
    Wifi,
} from 'lucide-react';
import Breadcrumbs from '@/components/Breadcrumbs';
import { brand } from '@/config/brand';
import { STAT_SOURCES } from '@/lib/stats-sources';
import {
    STATE_OF_HIRING_EDITIONS,
    REPORTS_HUB_PATH,
    type ReportEdition,
} from '@/lib/reports/editions';
import { loadHiringReportSnapshot, type HiringReportSnapshot } from '@/lib/reports/queries';
import {
    computeShare,
    summarizeCountGroups,
    REPORT_MIN_SHARE_SAMPLE,
    REPORT_MIN_GROUP_COUNT,
} from '@/lib/reports/report-model';
import {
    BENCHMARK_MIN_POSTINGS,
    BENCHMARK_MIN_EMPLOYERS,
} from '@/components/tools/benchmark-model';

/** Live aggregates refresh hourly — same cadence as /press. */
export const revalidate = 3600;

const EDITION_LOOKUP = STATE_OF_HIRING_EDITIONS.find((e) => e.year === 2026);
if (!EDITION_LOOKUP) throw new Error('reports: 2026 State of Hiring edition config is missing');
/** Re-bound after the guard so the non-null type reaches every closure. */
const EDITION: ReportEdition = EDITION_LOOKUP;
const PAGE_URL = `${brand.baseUrl}${EDITION.path}`;

export const metadata: Metadata = {
    title: `${EDITION.title} | ${brand.name}`,
    description: EDITION.description,
    alternates: { canonical: PAGE_URL },
    robots: { index: true, follow: true },
    openGraph: {
        title: EDITION.title,
        description: EDITION.description,
        type: 'article',
        url: PAGE_URL,
        images: [
            {
                url: `${brand.baseUrl}/api/og?title=${encodeURIComponent(EDITION.title)}&type=page`,
                width: 1200,
                height: 630,
                alt: EDITION.title,
            },
        ],
    },
};

/**
 * The live-section titles. Rendered as the visible <h2>s AND used as the
 * Dataset schema's variableMeasured — one array, so the schema can never
 * claim a measurement the visible page does not show.
 */
const LIVE_SECTION_TITLES = {
    specialty: 'Active postings by specialty',
    state: 'Active postings by state',
    mode: 'Where the work happens',
    newGrad: 'New-grad openness',
    pay: 'Advertised pay',
} as const;

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
const money = (n: number): string => `$${n.toLocaleString('en-US')}`;

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

/** The honest below-threshold state: a note, never a padded number. */
function SampleTooSmallNote({ what }: { what: string }) {
    return (
        <p
            style={{
                ...clayCard,
                padding: '14px 18px',
                marginTop: '10px',
                fontSize: '13.5px',
                color: MUTED_TEXT,
            }}
        >
            Sample too small to publish. We do not print {what} until the underlying sample clears
            the minimums stated in the methodology below — a small-sample figure would read as
            market signal it isn&apos;t.
        </p>
    );
}

/** One labelled count with a proportional bar. Value is text; bar is decor. */
function BarRow({ label, count, max }: { label: string; count: number; max: number }) {
    const widthPct = max > 0 ? Math.max(2, Math.round((count / max) * 100)) : 0;
    return (
        <li style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '5px 0' }}>
            <span style={{ flex: '0 0 42%', minWidth: 0, fontSize: '13.5px', color: '#1A2E35', fontWeight: 500 }}>
                {label}
            </span>
            <span aria-hidden="true" style={{ flex: 1, height: 10, borderRadius: 6, background: '#FDF2F8' }}>
                <span
                    style={{
                        display: 'block',
                        width: `${widthPct}%`,
                        height: '100%',
                        borderRadius: 6,
                        background: '#BE185D',
                    }}
                />
            </span>
            <span style={{ flex: '0 0 64px', textAlign: 'right', fontSize: '13.5px', color: '#1A2E35', fontVariantNumeric: 'tabular-nums' }}>
                {count.toLocaleString('en-US')}
            </span>
        </li>
    );
}

/** How many state rows render individually before the honest remainder line. */
const STATE_ROWS_SHOWN = 10;

function buildSchemas(snapshot: HiringReportSnapshot | null) {
    const articleSchema = {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: EDITION.title,
        description: EDITION.description,
        url: PAGE_URL,
        datePublished: EDITION.datePublished,
        ...(snapshot ? { dateModified: snapshot.asOf.slice(0, 10) } : {}),
        author: { '@type': 'Organization', name: brand.name, url: brand.baseUrl },
        publisher: { '@type': 'Organization', name: brand.name, url: brand.baseUrl },
        mainEntityOfPage: PAGE_URL,
    };
    // Dataset schema exists ONLY when the live aggregates rendered — schema
    // for data the page is not currently showing would be a false claim.
    const datasetSchema = snapshot
        ? {
              '@context': 'https://schema.org',
              '@type': 'Dataset',
              name: `${EDITION.title} — live posting aggregates`,
              description:
                  `Aggregates over ${brand.name}'s own active ${brand.niche.descriptor} job postings ` +
                  `as of ${snapshot.asOf.slice(0, 10)} (${snapshot.inventory.totalActive} active postings). ` +
                  `Describes this job board's inventory only — not a national census and not a wage survey.`,
              url: PAGE_URL,
              creator: { '@type': 'Organization', name: brand.name, url: brand.baseUrl },
              dateModified: snapshot.asOf.slice(0, 10),
              spatialCoverage: 'United States',
              variableMeasured: Object.values(LIVE_SECTION_TITLES),
          }
        : null;
    return { articleSchema, datasetSchema };
}

export default async function StateOfHiring2026Page() {
    const snapshot = await loadHiringReportSnapshot();
    const { articleSchema, datasetSchema } = buildSchemas(snapshot);

    const specialty = snapshot ? summarizeCountGroups(snapshot.bySpecialty) : null;
    const states = snapshot ? summarizeCountGroups(snapshot.byState) : null;
    const remoteShare = snapshot ? computeShare(snapshot.modes.remote, snapshot.modes.total) : null;
    const hybridShare = snapshot ? computeShare(snapshot.modes.hybrid, snapshot.modes.total) : null;
    const onSiteShare = snapshot ? computeShare(snapshot.modes.onSite, snapshot.modes.total) : null;
    const newGradShare = snapshot
        ? computeShare(snapshot.newGradFriendly, snapshot.inventory.totalActive)
        : null;

    const topStates = states ? states.shown.slice(0, STATE_ROWS_SHOWN) : [];
    const remainingStateCount = states
        ? states.total - topStates.reduce((sum, s) => sum + s.count, 0)
        : 0;
    const remainingStateGroups = states
        ? Math.max(0, states.shown.length - topStates.length) + states.otherGroups
        : 0;

    const nationalContextRows = [
        { label: `Median ${brand.niche.short} salary, United States`, stat: STAT_SOURCES.averageSalary },
        { label: `Projected ${brand.niche.short} employment growth`, stat: STAT_SOURCES.blsGrowth2032 },
        { label: 'Full Practice Authority jurisdictions', stat: STAT_SOURCES.fullPracticeStates },
    ];

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
            {datasetSchema && (
                <script
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{
                        __html: JSON.stringify(datasetSchema)
                            .replace(/</g, '\\u003c')
                            .replace(/>/g, '\\u003e'),
                    }}
                />
            )}

            <article style={{ ...clayCard, maxWidth: '860px', margin: '0 auto', padding: '48px 40px' }}>
                <Breadcrumbs
                    items={[
                        { label: 'Home', href: '/' },
                        { label: 'Data Reports', href: REPORTS_HUB_PATH },
                        { label: EDITION.title },
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
                        <BarChart3 size={14} /> {EDITION.year} Edition
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
                        The State of {brand.niche.short} Hiring{' '}
                        <span style={{ color: '#BE185D' }}>{EDITION.year}</span>
                    </h1>
                    <p style={{ fontSize: '15px', color: MUTED_TEXT, margin: 0, lineHeight: 1.6 }}>
                        First published {formatDay(EDITION.datePublished)}
                        {snapshot && <> · Live figures as of {formatDay(snapshot.asOf)}</>} · Free to
                        quote with attribution —{' '}
                        <Link href="/press" style={linkStyle}>
                            how to cite us
                        </Link>
                    </p>
                </header>

                <p style={{ fontSize: '15px', color: '#4A5568', lineHeight: 1.75, marginTop: '28px' }}>
                    This report is built from one dataset we know completely: the active{' '}
                    {brand.niche.descriptor} postings on {brand.name} itself. That makes it precise
                    about what it covers and silent about what it doesn&apos;t — it describes this
                    board&apos;s inventory, not the national {brand.niche.short} labour market. Where a
                    figure&apos;s sample is too small to mean anything, we say so instead of printing
                    it. National context, where shown, is cited to the federal and professional
                    sources that actually publish it.
                </p>

                {!snapshot && (
                    <p style={{ ...clayCard, padding: '16px 20px', marginTop: '24px', fontSize: '14px', color: MUTED_TEXT }}>
                        The live aggregates are unavailable right now, so every board-derived section
                        of this report is omitted rather than rendered from stored constants. The
                        cited national context and the methodology below remain valid; reload later
                        for the live figures.
                    </p>
                )}

                {snapshot && (
                    <Section icon={<Building2 size={20} />} title="The board at a glance" id="inventory">
                        <p>
                            A live count of this board&apos;s indexable inventory at the timestamp
                            above — the population every figure below is computed from:
                        </p>
                        <div
                            style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                                gap: '12px',
                                marginTop: '14px',
                            }}
                        >
                            {[
                                { n: snapshot.inventory.totalActive.toLocaleString('en-US'), label: 'Active postings' },
                                { n: snapshot.inventory.totalEmployers.toLocaleString('en-US'), label: 'Hiring organisations' },
                                { n: snapshot.inventory.totalStates.toLocaleString('en-US'), label: 'States represented' },
                            ].map((s) => (
                                <div key={s.label} style={{ ...clayCard, padding: '16px 18px' }}>
                                    <p style={{ fontSize: '26px', fontWeight: 800, color: '#1A2E35', margin: 0, lineHeight: 1.1 }}>
                                        {s.n}
                                    </p>
                                    <p style={{ fontSize: '13px', color: MUTED_TEXT, margin: '4px 0 0' }}>{s.label}</p>
                                </div>
                            ))}
                        </div>
                    </Section>
                )}

                {snapshot && specialty && (
                    <Section icon={<Stethoscope size={20} />} title={LIVE_SECTION_TITLES.specialty} id="specialty">
                        {specialty.total >= REPORT_MIN_SHARE_SAMPLE ? (
                            <>
                                <p>
                                    Active postings matching each clinical specialty on our taxonomy. A
                                    posting can match more than one specialty (and some match none), so
                                    rows are overlapping counts, not slices of a pie:
                                </p>
                                <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0 }}>
                                    {specialty.shown.map((row) => (
                                        <BarRow
                                            key={row.key}
                                            label={row.label}
                                            count={row.count}
                                            max={specialty.shown[0]?.count ?? 0}
                                        />
                                    ))}
                                </ul>
                                {specialty.otherGroups > 0 && (
                                    <p style={{ fontSize: '13px', color: MUTED_TEXT, marginTop: '10px' }}>
                                        {specialty.otherGroups} further{' '}
                                        {specialty.otherGroups === 1 ? 'specialty has' : 'specialties have'} fewer
                                        than {REPORT_MIN_GROUP_COUNT} matching postings each (
                                        {specialty.otherCount.toLocaleString('en-US')} combined) and are folded
                                        here rather than shown as one-posting rows.
                                    </p>
                                )}
                            </>
                        ) : (
                            <SampleTooSmallNote what="a specialty breakdown" />
                        )}
                    </Section>
                )}

                {snapshot && states && (
                    <Section icon={<MapPin size={20} />} title={LIVE_SECTION_TITLES.state} id="states">
                        {states.total >= REPORT_MIN_SHARE_SAMPLE ? (
                            <>
                                <p>The {Math.min(STATE_ROWS_SHOWN, states.shown.length)} states with the most active postings:</p>
                                <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0 }}>
                                    {topStates.map((row) => (
                                        <BarRow
                                            key={row.key}
                                            label={row.label}
                                            count={row.count}
                                            max={topStates[0]?.count ?? 0}
                                        />
                                    ))}
                                </ul>
                                {remainingStateCount > 0 && (
                                    <p style={{ fontSize: '13px', color: MUTED_TEXT, marginTop: '10px' }}>
                                        The remaining {remainingStateCount.toLocaleString('en-US')} active
                                        postings are spread across {remainingStateGroups} further states.
                                        Per-state detail is on the{' '}
                                        <Link href="/salary-guide" style={linkStyle}>
                                            salary guide
                                        </Link>{' '}
                                        and the state job pages.
                                    </p>
                                )}
                            </>
                        ) : (
                            <SampleTooSmallNote what="a state breakdown" />
                        )}
                    </Section>
                )}

                {snapshot && (
                    <Section icon={<Wifi size={20} />} title={LIVE_SECTION_TITLES.mode} id="mode">
                        {remoteShare && hybridShare && onSiteShare ? (
                            <>
                                <p>
                                    Of {snapshot.modes.total.toLocaleString('en-US')} active postings, the
                                    share flagged for each work mode (hybrid counts exclude postings
                                    already flagged remote):
                                </p>
                                <div
                                    style={{
                                        display: 'grid',
                                        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                                        gap: '12px',
                                        marginTop: '14px',
                                    }}
                                >
                                    {[
                                        { share: remoteShare, label: 'Remote' },
                                        { share: hybridShare, label: 'Hybrid' },
                                        { share: onSiteShare, label: 'On-site' },
                                    ].map((s) => (
                                        <div key={s.label} style={{ ...clayCard, padding: '16px 18px' }}>
                                            <p style={{ fontSize: '26px', fontWeight: 800, color: '#BE185D', margin: 0, lineHeight: 1.1 }}>
                                                {s.share.pct}%
                                            </p>
                                            <p style={{ fontSize: '13.5px', fontWeight: 700, color: '#1A2E35', margin: '4px 0 2px' }}>
                                                {s.label}
                                            </p>
                                            <p style={{ fontSize: '12px', color: MUTED_TEXT, margin: 0 }}>
                                                {s.share.numerator.toLocaleString('en-US')} postings
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            </>
                        ) : (
                            <SampleTooSmallNote what="work-mode shares" />
                        )}
                    </Section>
                )}

                {snapshot && (
                    <Section icon={<GraduationCap size={20} />} title={LIVE_SECTION_TITLES.newGrad} id="new-grad">
                        {newGradShare ? (
                            <p>
                                <strong style={{ color: '#BE185D', fontSize: '17px' }}>{newGradShare.pct}%</strong>{' '}
                                of active postings ({newGradShare.numerator.toLocaleString('en-US')} of{' '}
                                {newGradShare.denominator.toLocaleString('en-US')}) are flagged open to new
                                graduates — either an explicit zero-experience requirement or an
                                employer&apos;s &quot;new grads welcome&quot; flag. Browse them under{' '}
                                <Link href="/jobs/new-grad" style={linkStyle}>
                                    new-grad roles
                                </Link>
                                .
                            </p>
                        ) : (
                            <SampleTooSmallNote what="a new-grad share" />
                        )}
                    </Section>
                )}

                {snapshot && (
                    <Section icon={<Wallet size={20} />} title={LIVE_SECTION_TITLES.pay} id="pay">
                        <p>
                            What employers advertise, from postings that state a real pay range —
                            figures our pipeline estimated are excluded, and a state publishes only
                            with at least {BENCHMARK_MIN_POSTINGS} salaried postings from at least{' '}
                            {BENCHMARK_MIN_EMPLOYERS} distinct employers (the same gates as our{' '}
                            <Link href="/tools/salary-benchmark" style={linkStyle}>
                                salary benchmark tool
                            </Link>
                            ). These are advertised ranges on this board, not a wage survey.
                        </p>
                        {snapshot.salary.national ? (
                            <div style={{ ...clayCard, padding: '16px 20px', marginTop: '12px', overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                                    <caption
                                        style={{
                                            captionSide: 'bottom',
                                            textAlign: 'left',
                                            fontSize: '12px',
                                            color: MUTED_TEXT,
                                            paddingTop: '10px',
                                        }}
                                    >
                                        Midpoints of employer-advertised annual ranges on {brand.name};
                                        p25/p75 are the 25th/75th percentiles of those midpoints.
                                    </caption>
                                    <thead>
                                        <tr style={{ textAlign: 'left', color: MUTED_TEXT, borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                                            <th scope="col" style={{ padding: '8px 8px 8px 0', fontWeight: 600 }}>Scope</th>
                                            <th scope="col" style={{ padding: '8px', fontWeight: 600 }}>Median</th>
                                            <th scope="col" style={{ padding: '8px', fontWeight: 600 }}>p25</th>
                                            <th scope="col" style={{ padding: '8px', fontWeight: 600 }}>p75</th>
                                            <th scope="col" style={{ padding: '8px', fontWeight: 600 }}>Postings</th>
                                            <th scope="col" style={{ padding: '8px', fontWeight: 600 }}>Employers</th>
                                        </tr>
                                    </thead>
                                    <tbody style={{ color: '#1A2E35' }}>
                                        {[snapshot.salary.national, ...snapshot.salary.states].map((row) => (
                                            <tr key={row.scope} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                                                <th scope="row" style={{ padding: '10px 8px 10px 0', textAlign: 'left', fontWeight: row.scope === 'National' ? 700 : 500 }}>
                                                    {row.scope}
                                                </th>
                                                <td style={{ padding: '10px 8px', whiteSpace: 'nowrap' }}>{money(row.median)}</td>
                                                <td style={{ padding: '10px 8px', whiteSpace: 'nowrap' }}>{money(row.p25)}</td>
                                                <td style={{ padding: '10px 8px', whiteSpace: 'nowrap' }}>{money(row.p75)}</td>
                                                <td style={{ padding: '10px 8px' }}>{row.postings.toLocaleString('en-US')}</td>
                                                <td style={{ padding: '10px 8px' }}>{row.employers.toLocaleString('en-US')}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <SampleTooSmallNote what="an advertised-pay distribution" />
                        )}
                        <p style={{ fontSize: '13px', color: MUTED_TEXT, marginTop: '10px' }}>
                            How many postings disclose pay at all — and how we hold ourselves to that
                            number — is its own report:{' '}
                            <Link href="/reports/pay-transparency" style={linkStyle}>
                                pay transparency on {brand.name}
                            </Link>
                            .
                        </p>
                    </Section>
                )}

                <Section icon={<Landmark size={20} />} title="National context, cited" id="context">
                    <p>
                        For scale beyond this board, the figures we republish come from the sources
                        below — we do not survey, model, or adjust them, and each is quoted with its
                        vintage:
                    </p>
                    <div style={{ ...clayCard, padding: '16px 20px', marginTop: '12px', overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                            <caption
                                style={{
                                    captionSide: 'bottom',
                                    textAlign: 'left',
                                    fontSize: '12px',
                                    color: MUTED_TEXT,
                                    paddingTop: '10px',
                                }}
                            >
                                National {brand.niche.long} statistics with primary sources.
                            </caption>
                            <thead>
                                <tr style={{ textAlign: 'left', color: MUTED_TEXT, borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                                    <th scope="col" style={{ padding: '8px 8px 8px 0', fontWeight: 600 }}>Figure</th>
                                    <th scope="col" style={{ padding: '8px', fontWeight: 600 }}>Value</th>
                                    <th scope="col" style={{ padding: '8px', fontWeight: 600 }}>Primary source</th>
                                    <th scope="col" style={{ padding: '8px', fontWeight: 600 }}>As of</th>
                                </tr>
                            </thead>
                            <tbody style={{ color: '#1A2E35' }}>
                                {nationalContextRows.map((row) => (
                                    <tr key={row.label} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                                        <th scope="row" style={{ padding: '10px 8px 10px 0', textAlign: 'left', fontWeight: 500 }}>
                                            {row.label}
                                        </th>
                                        <td style={{ padding: '10px 8px', whiteSpace: 'nowrap' }}>{row.stat.formatted}</td>
                                        <td style={{ padding: '10px 8px' }}>
                                            <a href={row.stat.sourceUrl} target="_blank" rel="noopener noreferrer" style={linkStyle}>
                                                {row.stat.source}
                                            </a>
                                        </td>
                                        <td style={{ padding: '10px 8px', whiteSpace: 'nowrap' }}>{row.stat.asOf}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </Section>

                <Section icon={<FlaskConical size={20} />} title="Methodology, and what this report is not" id="methodology">
                    <ul style={{ margin: 0, paddingLeft: '20px', lineHeight: 1.85 }}>
                        <li>
                            <strong>Basis.</strong> Every live figure is computed from {brand.name}&apos;s
                            own active postings at the &quot;as of&quot; timestamp shown in the header —
                            counted with the same published, unexpired, not-repeatedly-dead-linked
                            filter our sitemaps use. Nothing is sampled, imputed, or carried over from
                            a previous run.
                        </li>
                        <li>
                            <strong>This is not a national census.</strong> It describes one job
                            board&apos;s inventory. Postings that were never listed here are invisible
                            to it, and employers who list many roles here weigh more than those who
                            don&apos;t.
                        </li>
                        <li>
                            <strong>Not a wage survey.</strong> Pay figures are midpoints of
                            employer-advertised ranges, which skew toward employers willing to
                            advertise pay at all. Pipeline-estimated figures are excluded entirely.
                        </li>
                        <li>
                            <strong>Sample gates.</strong> Percentages publish only over at least{' '}
                            {REPORT_MIN_SHARE_SAMPLE} postings; a distribution row shows individually
                            only with at least {REPORT_MIN_GROUP_COUNT} postings; pay rows require at
                            least {BENCHMARK_MIN_POSTINGS} salaried postings from at least{' '}
                            {BENCHMARK_MIN_EMPLOYERS} distinct employers. Below a gate, the section says
                            &quot;sample too small&quot; — it never renders a padded number.
                        </li>
                        <li>
                            <strong>National context is republished, not produced.</strong> Those
                            figures come from the cited federal and professional sources, with their
                            vintages shown, via the same audited source file every page of this site
                            quotes from.
                        </li>
                        <li>
                            <strong>Editions.</strong> This is the {EDITION.year} edition. Future
                            editions will be published as new pages so that citations of this one keep
                            meaning what they meant.
                        </li>
                    </ul>
                    <p style={{ marginTop: '12px' }}>
                        How our pages are produced and corrected is on the{' '}
                        <Link href="/editorial-policy" style={linkStyle}>
                            editorial policy
                        </Link>
                        ; citation format and custom cuts are on the{' '}
                        <Link href="/press" style={linkStyle}>
                            press &amp; data room
                        </Link>
                        . Questions about a figure:{' '}
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
