/**
 * /editorial-policy — public editorial + data policy page (content audit
 * P1 #8, E-E-A-T trust cluster).
 *
 * TRUTH RULES this page is built around:
 *   - Every statistic it mentions renders from lib/stats-sources.ts —
 *     the same objects the rest of the site cites. No literal figures
 *     are hardcoded here.
 *   - The review-status section is HONEST: while
 *     brand.editorial.reviewer (config/brand.ts) is null, the page says
 *     clinical review is pending a named credentialed reviewer — it
 *     never invents a person. When a real reviewer is contracted, the
 *     same config drives the named credit here, the blog bylines, and
 *     the Person schema.
 *   - The disclosures under "Where our numbers come from" describe other
 *     surfaces, so each must match what those surfaces print today and may
 *     never promise less than they print. The metro-guide paragraph is a
 *     promise about lib/metro-data.ts, and
 *     tests/regressions/p1-eeat-editorial-trust.test.ts checks it against
 *     the records themselves: if a guide ever quotes a processing time, a
 *     fee, a cost-of-living or population figure, a ranking or a shortage
 *     designation again, that test fails and this paragraph must widen with
 *     it. The same test holds the guides' pay pointers to this paragraph's
 *     account of the pay card, so the two cannot contradict. That card has
 *     three branches: a local median only with enough posted pay from enough
 *     employers; below that, when at least one listing states pay, the cited
 *     national median as a reference; and nothing at all when no listing
 *     states pay (postedPaySentence in components/seo/pseo/PostedPay.tsx
 *     returns null). The paragraph names the national reference only for
 *     the middle branch.
 */
import { Metadata } from 'next';
import Link from 'next/link';
import BreadcrumbSchema from '@/components/BreadcrumbSchema';
import {
    Database,
    FileSearch,
    ShieldCheck,
    Stethoscope,
    MailWarning,
    Ban,
} from 'lucide-react';
import { brand } from '@/config/brand';
import { STAT_SOURCES, STATS_LAST_REVIEWED } from '@/lib/stats-sources';

export const metadata: Metadata = {
    title: 'Editorial Policy',
    description: `How ${brand.name} produces its content: cited government and professional data sources, deterministic data-driven pages, review status, and our correction policy.`,
    alternates: { canonical: `${brand.baseUrl}/editorial-policy` },
    robots: { index: true, follow: true },
};

interface SectionProps {
    icon: React.ReactNode;
    title: string;
    children: React.ReactNode;
}

function Section({ icon, title, children }: SectionProps) {
    return (
        <section style={{ display: 'flex', gap: '14px', marginTop: '28px' }}>
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
            <div style={{ minWidth: 0 }}>
                <h2
                    style={{
                        fontSize: '18px',
                        fontWeight: 700,
                        color: '#1A2E35',
                        margin: '4px 0 8px 0',
                    }}
                >
                    {title}
                </h2>
                <div style={{ fontSize: '14px', color: '#4A5568', lineHeight: 1.7 }}>{children}</div>
            </div>
        </section>
    );
}

const clayCard: React.CSSProperties = {
    background: '#FFFFFF',
    borderRadius: '20px',
    border: '1px solid rgba(0,0,0,0.06)',
    boxShadow:
        '6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6)',
};

const linkStyle: React.CSSProperties = { color: '#BE185D', textDecoration: 'underline' };

export default function EditorialPolicyPage() {
    const reviewer = brand.editorial.reviewer;

    // Every row renders straight from lib/stats-sources.ts — the single
    // source of truth the rest of the site cites. Update protocol lives
    // in that file; this table follows automatically.
    const dataSourceRows = [
        { label: `Median ${brand.niche.short} salary`, stat: STAT_SOURCES.averageSalary },
        { label: `Projected ${brand.niche.short} employment growth`, stat: STAT_SOURCES.blsGrowth2034 },
        { label: 'Primary-care shortage population', stat: STAT_SOURCES.hrsaShortagePopulation },
        { label: 'Full Practice Authority states', stat: STAT_SOURCES.fullPracticeStates },
    ];

    return (
        <div style={{ background: '#F5F0EB', minHeight: '100vh', padding: '48px 16px 80px' }}>
            <BreadcrumbSchema
                items={[
                    { name: 'Home', url: brand.baseUrl },
                    { name: 'Editorial Policy', url: `${brand.baseUrl}/editorial-policy` },
                ]}
            />
            <article style={{ ...clayCard, maxWidth: '820px', margin: '0 auto', padding: '48px 40px' }}>
                <header style={{ marginBottom: '8px' }}>
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
                        <FileSearch size={14} /> Trust Center
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
                        Editorial <span style={{ color: '#BE185D' }}>Policy</span>
                    </h1>
                    <p style={{ fontSize: '15px', color: '#6B7F8A', margin: 0, lineHeight: 1.6 }}>
                        Data sources last verified: {STATS_LAST_REVIEWED}
                    </p>
                </header>

                <p style={{ fontSize: '15px', color: '#4A5568', lineHeight: 1.75, marginTop: '32px' }}>
                    {brand.name} (operated by <strong>{brand.legal.entityName}</strong>) is a job board
                    for {brand.niche.descriptor}s. Because our pages discuss careers, pay, and licensure
                    (topics people make real decisions with), this page explains exactly how our content is
                    produced, where every number comes from, what has and has not been clinically
                    reviewed, and how to get an error corrected.
                </p>

                <Section icon={<Database size={20} />} title="How our pages are produced">
                    <p>
                        Most pages on {brand.name} are <strong>deterministic and data-driven</strong>, not
                        free-written prose. Job counts, salary aggregates, and employer lists on our jobs
                        and location pages are computed from the live listings in our own database and
                        refresh as inventory changes. Salary figures, growth projections, and
                        practice-authority classifications render from a single audited source file so the
                        same cited value appears everywhere it is quoted; a number is never retyped page
                        by page.
                    </p>
                    <p>
                        Blog articles are editorial content written and maintained by the {brand.name}{' '}
                        team from the cited sources below. Our <strong>state license guide series</strong>{' '}
                        is different, and its pages say so: one guide per state is generated
                        programmatically from the structured practice-authority, compact-membership, and
                        board-directory data in this repository. That is why those guides state only what
                        the dataset actually holds and link out for everything else. They carry a
                        generated-content byline, not a review byline.
                    </p>
                    <p>
                        Structured data (schema.org markup) is generated from the same underlying values
                        as the visible copy, so what search engines read always matches what you read.
                    </p>
                </Section>

                <Section icon={<FileSearch size={20} />} title="Where our numbers come from">
                    <p>
                        The headline statistics we publish (pay, employment growth, shortage
                        population, and practice-authority counts) all render from a single audited
                        source file, and each one traces to a named, verifiable source with an
                        &quot;as of&quot; date:
                    </p>
                    <div style={{ ...clayCard, padding: '16px 20px', marginTop: '12px', overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                            <thead>
                                <tr style={{ textAlign: 'left', color: '#6B7F8A', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                                    <th style={{ padding: '8px 8px 8px 0', fontWeight: 600 }}>What we cite</th>
                                    <th style={{ padding: '8px', fontWeight: 600 }}>Current figure</th>
                                    <th style={{ padding: '8px', fontWeight: 600 }}>Source</th>
                                    <th style={{ padding: '8px', fontWeight: 600 }}>As of</th>
                                </tr>
                            </thead>
                            <tbody style={{ color: '#1A2E35' }}>
                                {dataSourceRows.map((row) => (
                                    <tr key={row.label} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                                        <td style={{ padding: '10px 8px 10px 0' }}>{row.label}</td>
                                        <td style={{ padding: '10px 8px', whiteSpace: 'nowrap' }}>{row.stat.formatted}</td>
                                        <td style={{ padding: '10px 8px' }}>
                                            <a
                                                href={row.stat.sourceUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                style={linkStyle}
                                            >
                                                {row.stat.source}
                                            </a>
                                        </td>
                                        <td style={{ padding: '10px 8px', whiteSpace: 'nowrap' }}>{row.stat.asOf}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <p style={{ marginTop: '12px' }}>
                        State practice-authority classifications derive from the AANP State Practice
                        Environment dataset. We do <em>not</em> hold verified per-state data for
                        application fees, CE hours, renewal cycles, or board processing times, so our{' '}
                        <strong>state license guide series never quotes them</strong>. Each of those
                        questions is answered with a link to that state&apos;s board of nursing, because
                        boards change the details without notice.
                    </p>
                    <p style={{ marginTop: '10px' }}>
                        Our licensure checker follows the same rule. For certification-exam and DEA
                        registration fees, license fees and renewal cycles, CE hours, and processing
                        times, it names the body that sets each one instead of quoting a figure, because
                        those figures change. Confirm any number you plan to budget or schedule around
                        with that body before you rely on it.
                    </p>
                    <p style={{ marginTop: '10px' }}>
                        Our metro market pages carry hand-written local guides, and those guides quote
                        no board processing times, fees, cost-of-living or population figures, pay
                        figures, or market rankings. They also do not say which areas hold a federal
                        shortage designation, because loan repayment eligibility depends on the exact
                        practice site: check the street address with HRSA&apos;s Find Shortage Areas by
                        Address tool and the county in HPSA Find, and confirm eligibility with the
                        employer. Their licensing statements, including the hour and year thresholds
                        some states set, restate our per-state practice-authority entries, which were
                        checked against each state&apos;s primary sources, plus two rules read at the
                        source: the Massachusetts law that sets its transition to full practice
                        authority, and the federal regulation on full practice authority at VA
                        facilities. What they say about multistate nursing licenses follows the Nurse
                        Licensure Compact roster that our license guides check against NCSBN, and the
                        compact&apos;s own scope: it covers RN and LPN licenses, never APRN licenses. The
                        figures a metro page does show come from three places: live job
                        counts and other listing tallies and, when enough listings from enough
                        employers state pay, a posted-pay median and how it compares with the statewide
                        one, all computed from listings on this board; the cited national median from
                        the table above, shown as a reference point when some local listings state pay
                        but too few for a local median; and the practice-authority entries, meaning the
                        AANP classification described above and the licensing thresholds in each
                        state&apos;s entry.
                    </p>
                </Section>

                <Section icon={<Stethoscope size={20} />} title="Review status: the honest version">
                    {reviewer ? (
                        <p>
                            Clinical review of our career and licensure content is performed by{' '}
                            <strong>
                                {reviewer.name}, {reviewer.credentials}
                            </strong>
                            {reviewer.title ? <> ({reviewer.title})</> : null}
                            {reviewer.profileUrl ? (
                                <>
                                    {' '}(
                                    <a href={reviewer.profileUrl} rel="noopener noreferrer" style={linkStyle}>
                                        professional profile
                                    </a>
                                    )
                                </>
                            ) : null}
                            . Reviewed articles carry a visible byline and matching structured data, both
                            generated from the same reviewer record.
                        </p>
                    ) : (
                        <p>
                            Our content is <strong>data-sourced and editorially maintained</strong> by the{' '}
                            {brand.name} team. It has <strong>not yet been clinically reviewed</strong> by a
                            named, credentialed {brand.niche.long}. We are recruiting a credentialed
                            reviewer for exactly that role; when the program launches, the reviewer&apos;s
                            name and credentials will be published here and on every reviewed article. We
                            will not attach a reviewer&apos;s name to content they have not actually
                            reviewed, and we do not invent reviewer identities.
                        </p>
                    )}
                    <p style={{ marginTop: '10px' }}>
                        Where certification is discussed, we attribute it to the correct certifying body
                        per specialty: AANP or ANCC for {brand.niche.short} certification, NBCRNA for
                        nurse anesthetists, and AMCB for certified nurse-midwives.
                    </p>
                </Section>

                <Section icon={<Ban size={20} />} title="What we never publish">
                    <ul style={{ margin: 0, paddingLeft: '20px', lineHeight: 1.85 }}>
                        <li>
                            Invented statistics. Every headline figure in the table above carries a
                            named source and an &quot;as of&quot; date; descriptive market context is
                            labelled as the estimate it is rather than dressed up as a cited statistic.
                        </li>
                        <li>Fabricated people: fake authors, reviewers, testimonials, or reviews.</li>
                        <li>
                            Medical, legal, or financial advice. Our content is career information, and
                            individual decisions belong with a licensed clinician or qualified professional.
                        </li>
                        <li>
                            Freshness theater: &quot;updated&quot; dates on our articles reflect real
                            editorial review timestamps, not the current date.
                        </li>
                    </ul>
                </Section>

                <Section icon={<MailWarning size={20} />} title="Corrections">
                    <p>
                        If you spot an error (a stale figure, a wrong practice-authority classification, or a
                        broken source link), email{' '}
                        <a href={`mailto:${brand.email.contact}`} style={linkStyle}>
                            {brand.email.contact}
                        </a>{' '}
                        with the page URL and what looks wrong. We review correction reports, fix verified
                        errors in the underlying data source (so the fix propagates to every page quoting
                        it), and update the affected page&apos;s modified date. Media and data inquiries:{' '}
                        <a href={`mailto:${brand.email.press}`} style={linkStyle}>
                            {brand.email.press}
                        </a>
                        .
                    </p>
                </Section>

                <Section icon={<ShieldCheck size={20} />} title="Related policies">
                    <ul style={{ margin: 0, paddingLeft: '20px', lineHeight: 1.85 }}>
                        <li>
                            <Link href="/about" style={linkStyle}>About {brand.name}</Link>: who operates the board.
                        </li>
                        <li>
                            <Link href="/security" style={linkStyle}>Security &amp; Trust</Link>: how we protect your data.
                        </li>
                        <li>
                            <Link href="/privacy" style={linkStyle}>Privacy Policy</Link> and{' '}
                            <Link href="/terms" style={linkStyle}>Terms of Service</Link>.
                        </li>
                    </ul>
                </Section>
            </article>
        </div>
    );
}
