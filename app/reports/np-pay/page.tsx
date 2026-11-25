/**
 * /reports/np-pay: the NP Pay Report. What employers advertise for nurse
 * practitioners on live postings, beside the BLS OEWS May 2025 wages for
 * every state, with the data as a CSV.
 *
 * TRUTH RULES (lib/reports/np-pay-model.ts): every live figure is the one
 * salary engine's (each employer counted once; quartiles at 10 or more
 * employers, a median at 5 or more, nothing below); a withheld figure is a
 * sentence, never 0; BLS figures carry their source and vintage; the copy
 * never says "earn" and never "average". The Dataset JSON-LD renders only
 * with the live data, and declares no license until the owner picks one.
 *
 * Revalidates daily (Vercel usage policy), like the CSV route beside it.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { BarChart3, BookOpen, Download, Layers, MapPin, Ruler, Stethoscope } from 'lucide-react';
import Breadcrumbs from '@/components/Breadcrumbs';
import BreadcrumbSchema from '@/components/BreadcrumbSchema';
import CopyCitation from '@/components/CopyCitation';
import { brand } from '@/config/brand';
import { NP_PAY_REPORT, PAY_TRANSPARENCY_REPORT, REPORTS_HUB_PATH } from '@/lib/reports/editions';
import { loadNpPaySnapshot } from '@/lib/reports/np-pay';
import {
    buildNpPayDataset,
    citationText,
    liveMedianCell,
    liveMiddleHalfCell,
    NP_PAY_CSV_PATH,
    usd,
    type NpPayScopeRow,
} from '@/lib/reports/np-pay-model';
import { computeShare, REPORT_MIN_SHARE_SAMPLE } from '@/lib/reports/report-model';
import { BENCHMARK_FULL_MIN_EMPLOYERS, BENCHMARK_MIN_EMPLOYERS } from '@/components/tools/benchmark-model';
import { MAX_RANGE_RATIO, ONE_EMPLOYER_NOTE, SALARY_SANITY_MAX, SALARY_SANITY_MIN, TIER_RULE_NOTE } from '@/lib/salary-report/stats';
import {
    BLS_NATIONAL,
    BLS_OEWS_REFERENCE_PERIOD,
    BLS_STATE_SOURCE_LABEL,
    BLS_STATE_SOURCE_URL,
    formatBlsDollars,
} from '@/lib/salary-guide-bls-states';

export const revalidate = 86400;

const PAGE_URL = `${brand.baseUrl}${NP_PAY_REPORT.path}`;
const H1 = 'NP Pay Report: What Employers Advertise for Nurse Practitioners';

export const metadata: Metadata = {
    title: { absolute: `${NP_PAY_REPORT.title} | ${brand.name}` },
    description: NP_PAY_REPORT.description,
    alternates: { canonical: PAGE_URL },
    openGraph: { title: NP_PAY_REPORT.title, description: NP_PAY_REPORT.description, url: PAGE_URL, type: 'article', siteName: brand.name },
};

const clayCard: React.CSSProperties = {
    background: '#FFFFFF',
    borderRadius: '20px',
    border: '1px solid rgba(0,0,0,0.06)',
    boxShadow: '6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6)',
};
const linkStyle: React.CSSProperties = { color: '#BE185D', textDecoration: 'underline' };
const MUTED_TEXT = '#5A6E7A';
const th: React.CSSProperties = { textAlign: 'left', padding: '10px 12px', fontSize: '11.5px', fontWeight: 700, color: MUTED_TEXT, textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '2px solid rgba(0,0,0,0.08)', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '9px 12px', fontSize: '13.5px', color: '#1A2E35', borderBottom: '1px solid rgba(0,0,0,0.05)', fontVariantNumeric: 'tabular-nums' };

/** "November 25, 2026" in UTC, formatted on the server. */
const longDay = (iso: string): string =>
    new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

function Section({ icon, title, id, children }: { icon: React.ReactNode; title: string; id: string; children: React.ReactNode }) {
    return (
        <section id={id} style={{ display: 'flex', gap: '14px', marginTop: '36px' }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#FDF2F8', color: '#BE185D' }}>
                {icon}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
                <h2 style={{ fontSize: '19px', fontWeight: 700, color: '#1A2E35', margin: '4px 0 10px 0' }}>{title}</h2>
                <div style={{ fontSize: '14px', color: '#4A5568', lineHeight: 1.7 }}>{children}</div>
            </div>
        </section>
    );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
    return (
        <div style={{ ...clayCard, padding: '18px 18px 16px' }}>
            <p style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED_TEXT, margin: '0 0 6px' }}>{label}</p>
            <p style={{ fontSize: '24px', fontWeight: 800, color: '#1A2E35', margin: '0 0 4px', lineHeight: 1.15 }}>{value}</p>
            <p style={{ fontSize: '12.5px', color: MUTED_TEXT, margin: 0, lineHeight: 1.5 }}>{sub}</p>
        </div>
    );
}

/** A breakdown table: scope, median advertised pay with its n, and the middle half. */
function BreakdownTable({ caption, scopeLabel, rows }: { caption: string; scopeLabel: string; rows: NpPayScopeRow[] }) {
    return (
        <div style={{ overflowX: 'auto', marginTop: '8px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <caption style={{ captionSide: 'bottom', textAlign: 'left', fontSize: '12px', color: MUTED_TEXT, padding: '8px 0 0' }}>{caption}</caption>
                <thead>
                    <tr>
                        <th scope="col" style={th}>{scopeLabel}</th>
                        <th scope="col" style={th}>Median advertised pay</th>
                        <th scope="col" style={th}>Middle half</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row) => (
                        <tr key={`${row.scopeType}-${row.scope}`}>
                            <th scope="row" style={{ ...td, fontWeight: 600 }}>
                                {row.href ? <Link href={row.href} style={linkStyle}>{row.scope}</Link> : row.scope}
                            </th>
                            <td style={td}>{liveMedianCell(row)}</td>
                            <td style={{ ...td, color: MUTED_TEXT }}>{liveMiddleHalfCell(row)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export default async function NpPayReportPage() {
    const snapshot = await loadNpPaySnapshot();
    const dataset = buildNpPayDataset(snapshot, NP_PAY_REPORT.datePublished);
    const asOfLabel = snapshot ? longDay(snapshot.asOf) : null;
    const national = snapshot?.national ?? null;
    const share = snapshot ? computeShare(snapshot.disclosure.disclosed, snapshot.disclosure.total) : null;

    const article = {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: NP_PAY_REPORT.title,
        description: NP_PAY_REPORT.description,
        url: PAGE_URL,
        datePublished: NP_PAY_REPORT.datePublished,
        ...(snapshot ? { dateModified: snapshot.asOf.slice(0, 10) } : {}),
        author: { '@type': 'Organization', '@id': `${brand.baseUrl}/#organization`, name: brand.name, url: brand.baseUrl },
        publisher: { '@type': 'Organization', '@id': `${brand.baseUrl}/#organization`, name: brand.name, url: brand.baseUrl },
        mainEntityOfPage: PAGE_URL,
    };
    const jsonLd = (value: object) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

    return (
        <div style={{ background: '#F5F0EB', minHeight: '100vh', padding: '48px 16px 80px' }}>
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(article) }} />
            {dataset && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(dataset) }} />}
            <BreadcrumbSchema
                items={[
                    { name: 'Home', url: brand.baseUrl },
                    { name: 'Data Reports', url: `${brand.baseUrl}${REPORTS_HUB_PATH}` },
                    { name: NP_PAY_REPORT.title, url: PAGE_URL },
                ]}
            />

            <article style={{ ...clayCard, maxWidth: '920px', margin: '0 auto', padding: '44px 36px' }}>
                <Breadcrumbs
                    items={[
                        { label: 'Home', href: '/' },
                        { label: 'Data Reports', href: REPORTS_HUB_PATH },
                        { label: NP_PAY_REPORT.title },
                    ]}
                />
                <h1 className="font-lora" style={{ fontSize: 'clamp(26px, 4vw, 36px)', fontWeight: 800, color: '#1A2E35', lineHeight: 1.2, margin: '18px 0 12px' }}>
                    {H1}
                </h1>
                <p style={{ fontSize: '16px', color: '#4A5568', lineHeight: 1.65, margin: 0 }}>
                    {national && national.postings !== null && national.employers !== null && asOfLabel
                        ? `Advertised pay on ${national.postings.toLocaleString('en-US')} live postings that state an annual pay range, from ${national.employers.toLocaleString('en-US')} employers, as of ${asOfLabel}. Each employer counts once.`
                        : `Advertised pay on live nurse practitioner postings, beside the BLS ${BLS_OEWS_REFERENCE_PERIOD} wages for every state. The live figures load from current postings and are recomputed daily.`}
                </p>

                {/* Key numbers */}
                <div style={{ display: 'grid', gap: '14px', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', marginTop: '28px' }}>
                    {national && (
                        <Tile
                            label="Median advertised pay, all live NP postings"
                            value={national.median !== null ? usd(national.median) : 'Not published'}
                            sub={national.median !== null && national.employers !== null
                                ? `${national.employers} employers disclosing pay${national.p25 !== null && national.p75 !== null ? `; middle half ${usd(national.p25)} to ${usd(national.p75)}` : ''}`
                                : `Fewer than ${BENCHMARK_MIN_EMPLOYERS} employers disclose pay`}
                        />
                    )}
                    {snapshot && (
                        <Tile
                            label="Live postings that disclose pay"
                            value={share ? `${share.pct}%` : 'Not published'}
                            sub={share
                                ? `${share.numerator.toLocaleString('en-US')} of ${share.denominator.toLocaleString('en-US')} live postings state a pay range`
                                : `Published once there are at least ${REPORT_MIN_SHARE_SAMPLE} live postings`}
                        />
                    )}
                    <Tile
                        label={`BLS median annual wage, ${BLS_OEWS_REFERENCE_PERIOD}`}
                        value={formatBlsDollars(BLS_NATIONAL.np.annualMedian)}
                        sub="BLS OEWS, Nurse Practitioners (29-1171), national estimate"
                    />
                </div>

                <Section icon={<MapPin size={20} />} title="Advertised pay vs BLS wages by state" id="by-state">
                    <p style={{ margin: '0 0 6px' }}>
                        Every state and DC, with the BLS median annual wage and its 10th to 90th percentile range beside the median pay employers advertise on live postings here. A live median appears once at least {BENCHMARK_MIN_EMPLOYERS} employers in the state disclose pay.
                    </p>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <caption style={{ captionSide: 'bottom', textAlign: 'left', fontSize: '12px', color: MUTED_TEXT, padding: '8px 0 0' }}>
                                BLS columns: {BLS_STATE_SOURCE_LABEL}, state estimates. Live columns: {brand.name} postings{asOfLabel ? ` as of ${asOfLabel}` : ''}, each employer counted once.
                            </caption>
                            <thead>
                                <tr>
                                    <th scope="col" style={th}>State</th>
                                    <th scope="col" style={th}>BLS median annual wage</th>
                                    <th scope="col" style={th}>BLS 10th to 90th percentile</th>
                                    <th scope="col" style={th}>Live advertised median</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(snapshot?.states ?? []).map((row) => (
                                    <tr key={row.scope}>
                                        <th scope="row" style={{ ...td, fontWeight: 600 }}>
                                            {row.href ? <Link href={row.href} style={linkStyle}>{row.scope}</Link> : row.scope}
                                        </th>
                                        <td style={td}>{row.bls ? formatBlsDollars(row.bls.median) : ''}</td>
                                        <td style={{ ...td, color: MUTED_TEXT }}>
                                            {row.bls ? `${formatBlsDollars(row.bls.p10)} to ${formatBlsDollars(row.bls.p90)}` : ''}
                                        </td>
                                        <td style={td}>{liveMedianCell(row)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {!snapshot && (
                        <p style={{ color: MUTED_TEXT }}>
                            The state table loads with the live figures. The BLS wages for every state are also on the <Link href="/salary-guide#salary-by-state" style={linkStyle}>salary guide</Link>.
                        </p>
                    )}
                </Section>

                {snapshot && (
                    <>
                        <Section icon={<Stethoscope size={20} />} title="Advertised pay by specialty" id="by-specialty">
                            <BreakdownTable caption="Each specialty links its own salary guide. CRNA and CNM pay is reported on those roles' own pages, never in an NP figure." scopeLabel="Specialty" rows={snapshot.specialties} />
                        </Section>

                        <Section icon={<Layers size={20} />} title="Advertised pay by work mode and employment type" id="by-work-mode">
                            <BreakdownTable caption="Work mode from each posting's own fields. Rows can overlap: a posting can be remote and full time." scopeLabel="Work mode" rows={snapshot.workModes} />
                            <BreakdownTable caption="Employment type from the posting's category tags." scopeLabel="Employment type" rows={snapshot.employmentTypes} />
                        </Section>

                        <Section icon={<BarChart3 size={20} />} title="New-grad friendly roles and experience required" id="by-experience">
                            <BreakdownTable caption="Buckets overlap: a role requiring 5 or more years also requires 3 or more." scopeLabel="Roles" rows={snapshot.experience} />
                        </Section>
                    </>
                )}

                <Section icon={<Ruler size={20} />} title="Methodology" id="methodology">
                    <ul style={{ margin: 0, paddingLeft: '18px' }}>
                        <li><strong>The pool.</strong> Live nurse practitioner postings on {brand.name} that state an annual pay range: published, not expired and passing the dead-link check.</li>
                        <li><strong>Left out.</strong> Pay the employer did not state (estimated), contract cadence (hourly, daily or weekly rates), parsing confidence below 0.8, a single figure with no range, a midpoint outside {usd(SALARY_SANITY_MIN)} to {usd(SALARY_SANITY_MAX)}, a range wider than {MAX_RANGE_RATIO} to 1, and roles that are not nurse practitioner roles, including CRNA, CNM and CNS postings.</li>
                        <li><strong>Counting.</strong> {ONE_EMPLOYER_NOTE}</li>
                        <li><strong>Tiers.</strong> {TIER_RULE_NOTE} Three or four employers show as a count only; fewer show nothing.</li>
                        <li><strong>Rounding.</strong> Advertised figures round to the nearest $500.</li>
                        <li><strong>Refresh.</strong> The figures are recomputed once a day from the postings live that day.</li>
                        <li>
                            <strong>BLS figures.</strong> {BLS_STATE_SOURCE_LABEL}, national and state estimates (
                            <a href={BLS_STATE_SOURCE_URL} rel="noopener noreferrer" style={linkStyle}>BLS state file</a>
                            ). These are survey estimates of wages paid in jobs people hold, published once a year.
                        </li>
                        <li><strong>Limits.</strong> This report describes this board&apos;s postings only. It is not a census of nurse practitioner jobs, not a survey and not a measure of wages paid.</li>
                    </ul>
                </Section>

                <Section icon={<Download size={20} />} title="Download and cite" id="download">
                    <p style={{ margin: '0 0 10px' }}>
                        <a href={NP_PAY_CSV_PATH} style={linkStyle} download>Download the data as a CSV</a>: one row per scope, with the tier, the employers behind each figure and the BLS columns for the national and state rows. A withheld figure is an empty cell.
                    </p>
                    <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#1A2E35', margin: '14px 0 8px' }}>How to cite</h3>
                    <CopyCitation citation={citationText(asOfLabel ?? longDay(new Date().toISOString()))} />
                    <p style={{ fontSize: '12.5px', color: MUTED_TEXT, margin: '10px 0 0' }}>
                        Cite the date you read the figures: the page and the CSV change daily. For press requests, contact {brand.email.press}.
                    </p>
                </Section>

                <Section icon={<BookOpen size={20} />} title="Related" id="related">
                    <ul style={{ margin: 0, paddingLeft: '18px' }}>
                        <li><Link href="/salary-guide" style={linkStyle}>Nurse practitioner salary guide</Link>, with the BLS wage table for every state</li>
                        <li><Link href="/salary-guide#highest-paying-states" style={linkStyle}>Highest paying states for nurse practitioners</Link></li>
                        <li><Link href={PAY_TRANSPARENCY_REPORT.path} style={linkStyle}>{PAY_TRANSPARENCY_REPORT.title}</Link></li>
                        <li><Link href="/tools/salary-benchmark" style={linkStyle}>Salary benchmark for employers</Link></li>
                    </ul>
                    <p style={{ fontSize: '12.5px', color: MUTED_TEXT, margin: '12px 0 0' }}>
                        The 25th to 75th percentile range of a scope appears once at least {BENCHMARK_FULL_MIN_EMPLOYERS} employers in it disclose pay.
                    </p>
                </Section>
            </article>
        </div>
    );
}
