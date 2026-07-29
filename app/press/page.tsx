/**
 * /press — media + data room (content audit P2 #9, trust cluster).
 *
 * The press@ inbox already existed and is cited by the licensure checker
 * and the salary guide; this is the page those citations land on.
 *
 * TRUTH RULES this page is built around:
 *   - Every national statistic renders from lib/stats-sources.ts — the
 *     same objects /editorial-policy, /salary-guide, and the pSEO layer
 *     cite. No figure is retyped here.
 *   - The practice-authority breakdown is DERIVED at render time from
 *     lib/state-practice-authority.ts via getStatesByAuthority(), so the
 *     counts on this page cannot drift from the dataset the state pages
 *     and licensure checker read.
 *   - Board inventory is a live aggregate over the same
 *     activeIndexableJobWhere() filter the sitemaps and feed use. If the
 *     database is unreachable the whole block is OMITTED rather than
 *     rendered from a fallback constant — a press page must never quote a
 *     placeholder number.
 *   - Brand assets are real files in public/. No asset is offered that
 *     does not exist on disk, no two entries are the same file under
 *     different names, and the stated dimensions are read back from the
 *     PNG header by the regression guard — "the link resolves" is not a
 *     high enough bar for a press kit, since a false description of a
 *     real file passes it.
 *   - No journalist, publication, or coverage clipping is invented. There
 *     is no "as seen in" strip, because there is nothing to put in it.
 */
import { Metadata } from 'next';
import Link from 'next/link';
import BreadcrumbSchema from '@/components/BreadcrumbSchema';
import CopyCitation from '@/components/CopyCitation';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { activeIndexableJobWhere } from '@/lib/active-job-filter';
import { brand } from '@/config/brand';
import { STAT_SOURCES, STATS_LAST_REVIEWED } from '@/lib/stats-sources';
import { getStatesByAuthority } from '@/lib/state-practice-authority';
import {
    Newspaper,
    Database,
    Quote,
    ImageDown,
    Mail,
    Building2,
    FlaskConical,
    BarChart3,
} from 'lucide-react';

/** Live aggregates are cheap enough hourly; the stat table is static. */
export const revalidate = 3600;

export const metadata: Metadata = {
    title: 'Press & Data Room',
    description: `Media resources for ${brand.name}: the ${brand.niche.long} workforce data we publish, how each figure is produced, how to cite it, brand assets, and our press contact.`,
    alternates: { canonical: `${brand.baseUrl}/press` },
    robots: { index: true, follow: true },
    openGraph: {
        title: `${brand.name} — Press & Data Room`,
        description: `${brand.niche.long} workforce data, methodology, brand assets, and media contact.`,
        images: [
            {
                url: `${brand.baseUrl}/api/og?title=${encodeURIComponent('Press & Data Room')}&type=page`,
                width: 1200,
                height: 630,
                alt: `${brand.name} press and data room`,
            },
        ],
    },
};

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

const clayCard: React.CSSProperties = {
    background: '#FFFFFF',
    borderRadius: '20px',
    border: '1px solid rgba(0,0,0,0.06)',
    boxShadow:
        '6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6)',
};

const linkStyle: React.CSSProperties = { color: '#BE185D', textDecoration: 'underline' };

/**
 * Muted/meta text. The site's usual muted grey, #6B7F8A, measures 4.177:1 on
 * #FFFFFF and 3.689:1 on the #F5F0EB page background — under the 4.5:1 AA
 * minimum for normal-size text, and named as a known contrast gap on
 * /accessibility. This darker slate clears it on both surfaces (5.322:1 and
 * 4.700:1) while staying subordinate to the #4A5568 body copy. Ratios are
 * sRGB relative luminance per WCAG 2.x; recompute before changing this value.
 */
const MUTED_TEXT = '#5A6E7A';

interface InventorySnapshot {
    totalJobs: number;
    totalEmployers: number;
    totalStates: number;
}

/**
 * Live board inventory. Returns null on any failure so the caller can omit
 * the block entirely — quoting a fallback constant on a page journalists
 * cite would be fabrication.
 */
async function getInventorySnapshot(): Promise<InventorySnapshot | null> {
    try {
        const where = activeIndexableJobWhere();
        const [totalJobs, employerGroups, stateGroups] = await Promise.all([
            prisma.job.count({ where }),
            prisma.job.groupBy({ by: ['employer'], where }),
            prisma.job.groupBy({ by: ['state'], where: { ...where, state: { not: null } } }),
        ]);
        return {
            totalJobs,
            totalEmployers: employerGroups.length,
            totalStates: stateGroups.length,
        };
    } catch (error) {
        logger.error('[press] inventory snapshot unavailable — omitting the block', error);
        return null;
    }
}

/**
 * Downloadable brand assets. Every entry must be a DISTINCT file whose
 * description matches what a downloader actually receives.
 *
 * /logo-cropped.png was previously offered here as a second, "tighter
 * bounding box" mark. It is not one: it is byte-identical to /logo.png
 * (sha1 423968c48ad8d710d24fca0771c3bc35154c1c3e, both 1024 × 1024,
 * both 228,592 bytes). A design desk downloading the "cropped" version got
 * the same image with a different filename, which is a false description of
 * a real file — the worst kind for a press kit, because the link resolves.
 * It is dropped rather than relabelled; when a genuinely cropped mark is
 * produced, add it back with its real dimensions. The regression guard now
 * hashes these files and fails if two entries resolve to the same bytes.
 */
const BRAND_ASSETS: { href: string; label: string; detail: string }[] = [
    { href: '/logo.png', label: 'Primary logo', detail: 'PNG · 1024 × 1024 · transparent background' },
    { href: '/android-chrome-512x512.png', label: 'App icon', detail: 'PNG · 512 × 512' },
    { href: '/apple-touch-icon.png', label: 'Touch icon', detail: 'PNG · 180 × 180' },
];

export default async function PressPage() {
    const inventory = await getInventorySnapshot();

    // Derived at render time from the practice-authority dataset itself, so
    // these counts and the state pages can never disagree.
    const fullPracticeCount = getStatesByAuthority('full').length;
    const reducedPracticeCount = getStatesByAuthority('reduced').length;
    const restrictedPracticeCount = getStatesByAuthority('restricted').length;

    const dataSourceRows = [
        { label: `Median ${brand.niche.short} salary, United States`, stat: STAT_SOURCES.averageSalary },
        { label: `Projected ${brand.niche.short} employment growth`, stat: STAT_SOURCES.blsGrowth2032 },
        { label: 'Population in primary-care shortage areas', stat: STAT_SOURCES.hrsaShortagePopulation },
        { label: 'Full Practice Authority jurisdictions', stat: STAT_SOURCES.fullPracticeStates },
    ];

    const citation = `${brand.name}, "${brand.niche.long} Salary Guide," ${brand.legal.entityName}. Data last verified ${STATS_LAST_REVIEWED}. ${brand.baseUrl}/salary-guide`;

    // Organization JSON-LD for the press/contact relationship. Derived from
    // config/brand.ts — the same object the visible copy renders from — and
    // escaped with the repo's < pattern so a stray angle bracket can
    // never terminate the script element early.
    const orgSchema = {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: brand.name,
        legalName: brand.legal.entityName,
        url: brand.baseUrl,
        logo: `${brand.baseUrl}/logo.png`,
        foundingDate: brand.legal.foundingYear,
        address: {
            '@type': 'PostalAddress',
            streetAddress: brand.legal.addressLine,
            addressLocality: brand.legal.addressCity,
            addressRegion: brand.legal.addressRegion,
            postalCode: brand.legal.addressPostalCode,
            addressCountry: brand.legal.addressCountry,
        },
        contactPoint: [
            {
                '@type': 'ContactPoint',
                contactType: 'press',
                email: brand.email.press,
                url: `${brand.baseUrl}/press`,
            },
        ],
    };

    return (
        <div style={{ background: '#F5F0EB', minHeight: '100vh', padding: '48px 16px 80px' }}>
            <BreadcrumbSchema
                items={[
                    { name: 'Home', url: brand.baseUrl },
                    { name: 'Press', url: `${brand.baseUrl}/press` },
                ]}
            />
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{
                    __html: JSON.stringify(orgSchema)
                        .replace(/</g, '\\u003c')
                        .replace(/>/g, '\\u003e'),
                }}
            />

            <article style={{ ...clayCard, maxWidth: '860px', margin: '0 auto', padding: '48px 40px' }}>
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
                            marginBottom: '16px',
                        }}
                    >
                        <Newspaper size={14} /> Trust Center
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
                        Press &amp; <span style={{ color: '#BE185D' }}>Data Room</span>
                    </h1>
                    <p style={{ fontSize: '15px', color: MUTED_TEXT, margin: 0, lineHeight: 1.6 }}>
                        Source data last verified: {STATS_LAST_REVIEWED} · Media contact:{' '}
                        <a href={`mailto:${brand.email.press}`} style={linkStyle}>
                            {brand.email.press}
                        </a>
                    </p>
                </header>

                <p style={{ fontSize: '15px', color: '#4A5568', lineHeight: 1.75, marginTop: '32px' }}>
                    {brand.name} is a job board covering every {brand.niche.long} specialty and the wider{' '}
                    {brand.niche.adjective} nursing cohort, operated by <strong>{brand.legal.entityName}</strong> (
                    {brand.legal.jurisdiction}, founded {brand.legal.foundingYear}). Reporters and researchers use us
                    for two things: the workforce datasets we publish, and what our own listings say about where{' '}
                    {brand.niche.descriptor} demand is going. Everything on this page is free to quote with
                    attribution.
                </p>

                <Section icon={<Database size={20} />} title="The figures we publish" id="data">
                    <p>
                        These are the national statistics that appear across our salary and licensure pages. Each one
                        renders from a single audited source file, so the value you see quoted on any page of this
                        site is the value below, with the same &quot;as of&quot; date:
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
                                National {brand.niche.long} statistics published by {brand.name}, with primary
                                sources.
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
                                {dataSourceRows.map((row) => (
                                    <tr key={row.label} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                                        <th
                                            scope="row"
                                            style={{ padding: '10px 8px 10px 0', textAlign: 'left', fontWeight: 500 }}
                                        >
                                            {row.label}
                                        </th>
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

                    <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#1A2E35', margin: '24px 0 8px' }}>
                        Practice authority across the 50 states and DC
                    </h3>
                    <p>
                        We maintain a per-jurisdiction classification of {brand.niche.long} practice authority, based
                        on the{' '}
                        <a
                            href={STAT_SOURCES.fullPracticeStates.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={linkStyle}
                        >
                            {STAT_SOURCES.fullPracticeStates.source}
                        </a>
                        . The split below is computed from that dataset each time this page renders:
                    </p>
                    <div
                        style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                            gap: '12px',
                            marginTop: '14px',
                        }}
                    >
                        {[
                            { n: fullPracticeCount, label: 'Full practice authority', hint: 'Practice without a physician agreement' },
                            { n: reducedPracticeCount, label: 'Reduced practice', hint: 'Collaborative agreement required' },
                            { n: restrictedPracticeCount, label: 'Restricted practice', hint: 'Physician supervision required' },
                        ].map((s) => (
                            <div key={s.label} style={{ ...clayCard, padding: '16px 18px' }}>
                                <p style={{ fontSize: '26px', fontWeight: 800, color: '#BE185D', margin: 0, lineHeight: 1.1 }}>
                                    {s.n}
                                </p>
                                <p style={{ fontSize: '13.5px', fontWeight: 700, color: '#1A2E35', margin: '4px 0 2px' }}>
                                    {s.label}
                                </p>
                                <p style={{ fontSize: '12px', color: MUTED_TEXT, margin: 0, lineHeight: 1.5 }}>{s.hint}</p>
                            </div>
                        ))}
                    </div>
                    <p style={{ marginTop: '12px', fontSize: '13px', color: MUTED_TEXT }}>
                        The full-practice count includes the District of Columbia, which is why it reads one higher
                        than the &quot;{STAT_SOURCES.fullPracticeStates.formatted}&quot; phrasing in the table above.
                        Per-state detail, including what each classification means in practice, is on our{' '}
                        <Link href="/resources/fpa-guide" style={linkStyle}>
                            practice-authority guide
                        </Link>
                        .
                    </p>
                </Section>

                {inventory && (
                    <Section icon={<BarChart3 size={20} />} title="What our own listings show" id="inventory">
                        <p>
                            The figures below are a live count of this board&apos;s own indexable inventory at the
                            time this page was generated — not a market estimate, and not a national vacancy figure.
                            They describe {brand.name} and nothing wider than {brand.name}.
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
                                { n: inventory.totalJobs.toLocaleString(), label: 'Open listings' },
                                { n: inventory.totalEmployers.toLocaleString(), label: 'Hiring organisations' },
                                { n: inventory.totalStates.toLocaleString(), label: 'States represented' },
                            ].map((s) => (
                                <div key={s.label} style={{ ...clayCard, padding: '16px 18px' }}>
                                    <p style={{ fontSize: '26px', fontWeight: 800, color: '#1A2E35', margin: 0, lineHeight: 1.1 }}>
                                        {s.n}
                                    </p>
                                    <p style={{ fontSize: '13px', color: MUTED_TEXT, margin: '4px 0 0' }}>{s.label}</p>
                                </div>
                            ))}
                        </div>
                        <p style={{ marginTop: '12px', fontSize: '13px', color: MUTED_TEXT }}>
                            Counted with the same filter our sitemaps use: published, unexpired, and not flagged as a
                            repeatedly dead source link. If you need a cut of this by specialty, state, or setting,
                            ask — we will run it.
                        </p>
                    </Section>
                )}

                <Section icon={<FlaskConical size={20} />} title="Methodology, and what these numbers are not">
                    <ul style={{ margin: 0, paddingLeft: '20px', lineHeight: 1.85 }}>
                        <li>
                            <strong>The national statistics are not ours.</strong> Salary, growth, and shortage
                            figures come from the federal sources named in the table. We republish them with
                            attribution; we do not survey, model, or adjust them.
                        </li>
                        <li>
                            <strong>Practice-authority classifications are a curated dataset.</strong> We maintain the
                            per-state mapping from the professional-association source above. Legislatures change
                            this; check the &quot;as of&quot; date before quoting.
                        </li>
                        <li>
                            <strong>Listing aggregates describe this board, not the labour market.</strong> Pay ranges
                            derived from our postings reflect what employers advertised on {brand.name}, which skews
                            toward roles employers chose to advertise with a salary at all. They are not a wage
                            survey, and we label them as posting-derived everywhere they appear.
                        </li>
                        <li>
                            <strong>We do not publish counts we cannot compute.</strong> Where a number is unavailable
                            it is omitted rather than estimated, including on this page.
                        </li>
                        <li>
                            <strong>Certification bodies are attributed per specialty</strong> — AANP or ANCC for{' '}
                            {brand.niche.short} certification, NBCRNA for nurse anesthetists, AMCB for certified
                            nurse-midwives.
                        </li>
                    </ul>
                    <p style={{ marginTop: '12px' }}>
                        The longer version — how our pages are produced, our correction policy, and our clinical
                        review status — is on the{' '}
                        <Link href="/editorial-policy" style={linkStyle}>
                            editorial policy
                        </Link>{' '}
                        page.
                    </p>
                </Section>

                <Section icon={<Quote size={20} />} title="How to cite us">
                    <p style={{ marginBottom: '12px' }}>
                        Quote freely with attribution and a link. A ready-made citation for our salary guide:
                    </p>
                    <CopyCitation citation={citation} />
                    <p style={{ marginTop: '12px' }}>
                        For a specific page, cite the page title and its URL with the same publisher and
                        verification date. If you need the underlying figures as a spreadsheet, or a per-state cut
                        that is not published, email{' '}
                        <a href={`mailto:${brand.email.press}`} style={linkStyle}>
                            {brand.email.press}
                        </a>{' '}
                        and we will send it.
                    </p>
                </Section>

                <Section icon={<ImageDown size={20} />} title="Brand assets">
                    <p style={{ marginBottom: '12px' }}>
                        Logo files for editorial use. Please do not recolour, stretch, add effects to, or lock up the
                        mark with other logos in a way that implies a partnership we do not have.
                    </p>
                    <div
                        style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                            gap: '12px',
                        }}
                    >
                        {BRAND_ASSETS.map((a) => (
                            <a
                                key={a.href}
                                href={a.href}
                                download
                                style={{ ...clayCard, padding: '14px 16px', textDecoration: 'none', display: 'block' }}
                            >
                                <span style={{ display: 'block', fontSize: '13.5px', fontWeight: 700, color: '#BE185D' }}>
                                    {a.label}
                                </span>
                                <span style={{ display: 'block', fontSize: '12px', color: MUTED_TEXT, marginTop: '2px' }}>
                                    {a.detail}
                                </span>
                            </a>
                        ))}
                    </div>
                    <p style={{ marginTop: '12px', fontSize: '13px', color: MUTED_TEXT }}>
                        The correct written form of our name is &quot;{brand.name}&quot;. The operating entity is{' '}
                        {brand.legal.entityName}.
                    </p>
                </Section>

                <Section icon={<Building2 size={20} />} title="Company facts">
                    <ul style={{ margin: 0, paddingLeft: '20px', lineHeight: 1.85 }}>
                        <li>
                            <strong>Product:</strong> a job board for {brand.niche.long}s and the wider{' '}
                            {brand.niche.adjective} nursing cohort, covering all 50 states and DC.
                        </li>
                        <li>
                            <strong>Operating entity:</strong> {brand.legal.entityName}, {brand.legal.jurisdiction}.
                        </li>
                        <li>
                            <strong>Founded:</strong> {brand.legal.foundingYear}.
                        </li>
                        <li>
                            <strong>Built by:</strong> {brand.legal.creatorName}, {brand.legal.creatorTitle} — more on{' '}
                            <Link href="/about" style={linkStyle}>
                                the about page
                            </Link>
                            .
                        </li>
                    </ul>
                </Section>

                <Section icon={<Mail size={20} />} title="Media contact">
                    <p>
                        Interviews, data requests, custom cuts, and fact-checks:{' '}
                        <a href={`mailto:${brand.email.press}`} style={linkStyle}>
                            {brand.email.press}
                        </a>
                        . We answer fact-check requests on deadline where we can — say so in the subject line and
                        include your deadline.
                    </p>
                    <p style={{ marginTop: '10px' }}>
                        Corrections to something we have already published go to{' '}
                        <a href={`mailto:${brand.email.contact}`} style={linkStyle}>
                            {brand.email.contact}
                        </a>{' '}
                        — we fix verified errors at the data source so the fix propagates to every page quoting it.
                        Accessibility questions about our site are handled on the{' '}
                        <Link href="/accessibility" style={linkStyle}>
                            accessibility statement
                        </Link>
                        .
                    </p>
                </Section>
            </article>
        </div>
    );
}
