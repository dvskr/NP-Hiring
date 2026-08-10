import { brand } from '@/config/brand';
import { licenseGuideSlug, LICENSE_GUIDE_SERIES_PUBLISHED } from '@/config/niche/content-map';
import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import BreadcrumbSchema from '@/components/BreadcrumbSchema';
import SalaryProvenance from '@/components/SalaryProvenance';
import StateImage, { hasStateDiorama } from '@/components/StateImage';
// P3 #9: /jobs/city/[slug] resolves by re-parsing the slug into a city NAME, so a
// link built from a lossy slug can be a guaranteed 404 — guard before emitting.
import { buildCitySlug, cityLinkResolves } from '@/app/jobs/locations/[state]/directory';
import {
    DollarSign,
    MapPin,
    Briefcase,
    TrendingUp,
    Building2,
    ArrowRight,
    BarChart3,
    Stethoscope,
    BookOpen,
} from 'lucide-react';

// P0 OG sweep: per-state OG/schema image rendered by the board's own
// /api/og edge route — the previous shared Supabase page-screenshot lived
// in an unpopulated bucket and 400'd on every share (pattern:
// app/for-employers/page.tsx). Absolute URL because it also feeds the
// Article JSON-LD `image`.
const salaryGuideOgImage = (stateName: string, code: string): string =>
    `${brand.baseUrl}/api/og?title=${encodeURIComponent(`${brand.niche.short} Salary in ${stateName} (${code})`)}&type=page`;

export const revalidate = 86400; // ISR daily

// ── State mappings ──────────────────────────────────────────────────────────

const STATE_CODES: Record<string, string> = {
    'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR',
    'California': 'CA', 'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE',
    'Florida': 'FL', 'Georgia': 'GA', 'Hawaii': 'HI', 'Idaho': 'ID',
    'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA', 'Kansas': 'KS',
    'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
    'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS',
    'Missouri': 'MO', 'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV',
    'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
    'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH', 'Oklahoma': 'OK',
    'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
    'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT',
    'Vermont': 'VT', 'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV',
    'Wisconsin': 'WI', 'Wyoming': 'WY', 'District of Columbia': 'DC',
};

const SLUG_TO_STATE: Record<string, string> = {};
Object.keys(STATE_CODES).forEach((name) => {
    SLUG_TO_STATE[name.toLowerCase().replace(/\s+/g, '-')] = name;
});

const ALL_STATE_SLUGS = Object.keys(SLUG_TO_STATE);

// ── Data fetching ───────────────────────────────────────────────────────────

async function getStateSalaryData(stateName: string) {
    const stats = await prisma.job.aggregate({
        where: {
            isPublished: true,
            state: stateName,
            normalizedMinSalary: { not: null },
        },
        _avg: { normalizedMinSalary: true, normalizedMaxSalary: true },
        _min: { normalizedMinSalary: true },
        _max: { normalizedMaxSalary: true },
        _count: { id: true },
    });

    const avgMin = stats._avg.normalizedMinSalary || 0;
    const avgMax = stats._avg.normalizedMaxSalary || 0;

    return {
        avgSalary: Math.round((avgMin + avgMax) / 2),
        minSalary: Math.round(stats._min.normalizedMinSalary || 0),
        maxSalary: Math.round(stats._max.normalizedMaxSalary || 0),
        jobCount: stats._count.id,
    };
}

async function getStateSalaryBySetting(stateName: string) {
    const settings = ['Telehealth', 'Outpatient', 'Inpatient', 'Remote'];
    const results = await Promise.all(
        settings.map(async (setting) => {
            const jobs = await prisma.job.aggregate({
                where: {
                    isPublished: true,
                    state: stateName,
                    normalizedMinSalary: { not: null },
                    OR: [
                        { title: { contains: setting, mode: 'insensitive' } },
                        { jobType: { contains: setting, mode: 'insensitive' } },
                    ],
                },
                _avg: { normalizedMinSalary: true, normalizedMaxSalary: true },
                _count: { id: true },
            });
            const aMin = jobs._avg.normalizedMinSalary || 0;
            const aMax = jobs._avg.normalizedMaxSalary || 0;
            return {
                setting,
                avgSalary: Math.round((aMin + aMax) / 2),
                jobCount: jobs._count.id,
            };
        })
    );
    return results.filter((r) => r.jobCount > 0);
}

async function getTopEmployers(stateName: string) {
    const employers = await prisma.job.groupBy({
        by: ['employer'],
        where: { isPublished: true, state: stateName },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10,
    });
    return employers.map((e) => ({
        name: e.employer,
        jobCount: e._count.id,
    }));
}

async function getTopCities(stateName: string) {
    const cities = await prisma.job.groupBy({
        by: ['city'],
        where: { isPublished: true, state: stateName, city: { not: null } },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10,
    });
    const stateCode = STATE_CODES[stateName] || '';
    return cities
        .filter((c) => c.city)
        // P3 #9: every row becomes a /jobs/city/<slug> link in the sidebar. That
        // route rebuilds a city NAME from the slug and matches the DB `city`
        // column, so "St. Louis" → st-louis-mo → "St Louis" finds nothing and
        // hard-404s. Reject those with the same guard the state city directories
        // use, and build the survivors with the shared builder rather than a
        // fifth inline copy of the sanitizer.
        .filter((c) => cityLinkResolves(c.city!, stateCode))
        .map((c) => ({
            name: c.city!,
            jobCount: c._count.id,
            slug: buildCitySlug(c.city!, stateCode),
        }));
}

async function getNationalAvg() {
    const stats = await prisma.job.aggregate({
        where: { isPublished: true, normalizedMinSalary: { not: null } },
        _avg: { normalizedMinSalary: true, normalizedMaxSalary: true },
    });
    const aMin = stats._avg.normalizedMinSalary || 120000;
    const aMax = stats._avg.normalizedMaxSalary || 150000;
    return Math.round((aMin + aMax) / 2);
}

// ── Static Params ───────────────────────────────────────────────────────────

export async function generateStaticParams() {
    return ALL_STATE_SLUGS.map((slug) => ({ state: slug }));
}

// ── Metadata ────────────────────────────────────────────────────────────────

interface PageProps {
    params: Promise<{ state: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
    const { state: slug } = await params;
    const stateName = SLUG_TO_STATE[slug];
    if (!stateName) return { title: 'State Not Found' };

    const code = STATE_CODES[stateName];

    // Empty-state defense lives in the page handler (notFound() when
    // salaryData.jobCount === 0). We deliberately do NOT duplicate that
    // gate here: generateMetadata + the page handler run in parallel, so
    // adding a count() query here would double the per-request DB load
    // for marginal benefit (the 404 itself is the strongest signal Google
    // needs to drop the URL).
    // Title trimmed to <60 chars (was 77-82 — reliably truncated mid-phrase).
    // The "Average Pay, Jobs & Cost of Living" suffix moved into the description.
    const title = `${brand.niche.short} Salary in ${stateName} (${code}) 2026 — Avg Pay & Jobs`;
    const description = `${brand.niche.short} salary data for ${stateName}: average pay by practice setting, top employers, and open positions. Updated daily.`;
    const ogImage = salaryGuideOgImage(stateName, code);

    return {
        title,
        description,
        alternates: { canonical: `${brand.baseUrl}/salary-guide/${slug}` },
        openGraph: {
            title: `${brand.niche.short} Salary in ${stateName} (${code}) — 2026 Data`,
            description: `Average ${brand.niche.short} salary in ${stateName} by practice setting, top employers, and open positions.`,
            type: 'website',
            url: `${brand.baseUrl}/salary-guide/${slug}`,
            siteName: brand.name,
            images: [{ url: ogImage, width: 1200, height: 630, alt: `${brand.niche.short} Salary in ${stateName} 2026` }],
        },
        twitter: {
            card: 'summary_large_image',
            title: `${brand.niche.short} Salary in ${stateName} (${code}) 2026`,
            description,
            images: [ogImage],
        },
    };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatSalary(n: number) {
    if (n >= 1000) return `$${Math.round(n / 1000)}K`;
    return `$${n.toLocaleString()}`;
}

/** Escape angle brackets so JSON-LD can't break out of its <script> tag. */
function sanitizeJson(obj: object): string {
    return JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

// ── Page ────────────────────────────────────────────────────────────────────

export default async function StateSalaryPage({ params }: PageProps) {
    const { state: slug } = await params;
    const stateName = SLUG_TO_STATE[slug];
    if (!stateName) notFound();

    const stateCode = STATE_CODES[stateName];
    const stateSlug = slug;

    const [salaryData, bySetting, topEmployers, topCities, nationalAvg] = await Promise.all([
        getStateSalaryData(stateName),
        getStateSalaryBySetting(stateName),
        getTopEmployers(stateName),
        getTopCities(stateName),
        getNationalAvg(),
    ]);

    // GSC Fix: empty-state guard. Without this, a state with 0 normalized-salary
    // jobs renders the full guide showing "$0 – $0", "0 active jobs in WY",
    // and a CTA pointing at /jobs/state/wy — classic soft-404 cluster.
    // notFound() is preferable to a noindex render because the page also
    // sits in the sitemap; a hard 404 lets Google drop it cleanly.
    if (salaryData.jobCount === 0) {
        notFound();
    }

    const diff = salaryData.avgSalary - nationalAvg;
    const diffPct = nationalAvg > 0 ? Math.round((diff / nationalAvg) * 100) : 0;
    const aboveBelow = diff >= 0 ? 'above' : 'below';

    // Find the licensure blog post slug (prefix lives in config/niche/content-map.ts)
    const licenseSlug = licenseGuideSlug(slug);

    // ── AEO schemas (audit B48) ──────────────────────────────────────────
    // FAQPage + Article + Speakable, mirroring the pSEO category-city
    // template. ONE array feeds both the JSON-LD and the visible accordion
    // below so schema and visible content cannot diverge (invisible FAQ
    // structured data is spam per Google's policy). Every figure is live
    // page data — no hardcoded salary claims (the cited national figures
    // live in lib/stats-sources.ts and render on the salary-guide index).
    const pageUrl = `${brand.baseUrl}/salary-guide/${stateSlug}`;
    const topSetting = [...bySetting].sort((a, b) => b.avgSalary - a.avgSalary)[0];
    const stateFaqs = [
        {
            q: `What is the average ${brand.niche.short} salary in ${stateName}?`,
            a: `The average ${brand.niche.short} salary in ${stateName} is ${formatSalary(salaryData.avgSalary)} per year, based on ${salaryData.jobCount} active job ${salaryData.jobCount === 1 ? 'posting' : 'postings'} with disclosed salary on ${brand.name}. Reported salaries range from ${formatSalary(salaryData.minSalary)} to ${formatSalary(salaryData.maxSalary)}. That is ${Math.abs(diffPct)}% ${aboveBelow} the national average of ${formatSalary(nationalAvg)} across postings on this board.`,
        },
        {
            q: `How many ${brand.niche.short} jobs are open in ${stateName}?`,
            a: `There ${salaryData.jobCount === 1 ? 'is' : 'are'} currently ${salaryData.jobCount} active ${brand.niche.short} ${salaryData.jobCount === 1 ? 'position' : 'positions'} with disclosed salary in ${stateName} on ${brand.name}. Listings are ingested daily from employer applicant-tracking systems.`,
        },
        ...(topSetting
            ? [{
                q: `Which practice setting pays ${brand.niche.short}s the most in ${stateName}?`,
                a: `Among current ${stateName} postings on ${brand.name}, ${topSetting.setting.toLowerCase()} roles report the highest average at ${formatSalary(topSetting.avgSalary)} per year (${topSetting.jobCount} ${topSetting.jobCount === 1 ? 'position' : 'positions'}). Actual pay varies with experience, employer type, and benefits.`,
            }]
            : []),
    ];

    // Only 51 jurisdictions route here and all 51 ship a diorama, but keep
    // the guard so a future slug without artwork degrades to the original
    // centred text hero instead of an empty framed box.
    const showHeroDiorama = hasStateDiorama(stateSlug);

    return (
        <div style={{ backgroundColor: 'var(--bg-primary)', minHeight: '100vh' }}>
            {/* Hero layout. Deliberately a static block: a template
                interpolation inside a style block deadlocks the route
                compile under Turbopack, so every value here is literal. */}
            <style>{`
                .sg-hero-inner { max-width: 800px; margin: 0 auto; text-align: center; }
                .sg-hero-inner p { margin-left: auto; margin-right: auto; }
                .sg-hero-inner--art { max-width: 980px; }
                .sg-hero-art {
                    position: relative;
                    width: 200px;
                    aspect-ratio: 1 / 1;
                    margin: 32px auto 0;
                    border-radius: 28px;
                    overflow: hidden;
                    flex: 0 0 auto;
                    box-shadow: inset 4px 4px 10px rgba(255,255,255,0.3),
                                inset -3px -3px 8px rgba(0,0,0,0.08),
                                0 10px 30px rgba(0,0,0,0.12);
                }
                .sg-hero-art-img { object-fit: cover; }
                @media (min-width: 860px) {
                    .sg-hero-inner--art {
                        display: flex;
                        align-items: center;
                        gap: 48px;
                        text-align: left;
                    }
                    .sg-hero-inner--art .sg-hero-copy { flex: 1 1 auto; min-width: 0; }
                    .sg-hero-inner--art p { margin-left: 0; margin-right: 0; }
                    .sg-hero-inner--art .sg-hero-art { width: 260px; margin: 0; }
                }
            `}</style>
            <BreadcrumbSchema
                items={[
                    { name: 'Home', url: brand.baseUrl },
                    { name: 'Salary Guide', url: `${brand.baseUrl}/salary-guide` },
                    { name: stateName, url: `${brand.baseUrl}/salary-guide/${stateSlug}` },
                ]}
            />
            {/* FAQPage — same stateFaqs array renders the visible accordion below */}
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: sanitizeJson({
                    '@context': 'https://schema.org',
                    '@type': 'FAQPage',
                    mainEntity: stateFaqs.map((faq) => ({
                        '@type': 'Question',
                        name: faq.q,
                        acceptedAnswer: { '@type': 'Answer', text: faq.a },
                    })),
                }) }}
            />
            {/* Article — dates deliberately omitted: this page regenerates
                daily from live posting data and has no editorial publish
                date; emitting dateModified=now would fabricate freshness
                (audit B54 principle). */}
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: sanitizeJson({
                    '@context': 'https://schema.org',
                    '@type': 'Article',
                    headline: `${brand.niche.short} Salary in ${stateName} (${stateCode}) — Pay by Practice Setting`,
                    description: `Average ${brand.niche.short} salary in ${stateName} based on ${salaryData.jobCount} active ${salaryData.jobCount === 1 ? 'posting' : 'postings'}: ${formatSalary(salaryData.avgSalary)} per year (range ${formatSalary(salaryData.minSalary)}–${formatSalary(salaryData.maxSalary)}).`,
                    author: { '@type': 'Organization', name: brand.name, url: brand.baseUrl },
                    publisher: { '@type': 'Organization', name: brand.name, logo: { '@type': 'ImageObject', url: `${brand.baseUrl}/logo.png` } },
                    mainEntityOfPage: { '@type': 'WebPage', '@id': pageUrl },
                    image: salaryGuideOgImage(stateName, stateCode),
                    url: pageUrl,
                }) }}
            />
            {/* Speakable — marks the salary summary + FAQ answers for voice/AI */}
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: sanitizeJson({
                    '@context': 'https://schema.org',
                    '@type': 'WebPage',
                    name: `${brand.niche.short} Salary in ${stateName} (${stateCode})`,
                    speakable: {
                        '@type': 'SpeakableSpecification',
                        cssSelector: ['#state-salary-summary', '.faq-answer'],
                    },
                    url: pageUrl,
                }) }}
            />

            {/* Hero — P2 #1: pairs the copy with this state's own diorama
                (public/images/states/<slug>.png). Every slug this route can
                reach ships one; a jurisdiction without artwork falls back to
                the original centred text-only hero rather than a placeholder
                or a dead URL. The art sits in a fixed aspect-ratio box so its
                space is reserved before it decodes — no layout shift. */}
            <section style={{ padding: '72px 16px 48px' }}>
                <div className={showHeroDiorama ? 'sg-hero-inner sg-hero-inner--art' : 'sg-hero-inner'}>
                    <div className="sg-hero-copy">
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
                            <MapPin size={14} /> {stateCode} Salary Data · Updated Daily
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
                            {brand.niche.short} Salary in {stateName}
                        </h1>

                        <p
                            id="state-salary-summary"
                            data-speakable="true"
                            style={{
                                fontSize: '16px',
                                color: 'var(--text-secondary)',
                                maxWidth: '600px',
                                lineHeight: 1.6,
                            }}
                        >
                            Average {brand.niche.descriptor} compensation in {stateName}, broken down by
                            practice setting, top employers, and cities.
                        </p>
                    </div>

                    {showHeroDiorama && (
                        <div className="sg-hero-art">
                            <StateImage
                                slug={stateSlug}
                                alt={`Illustrated diorama representing ${stateName}`}
                                fill
                                className="sg-hero-art-img"
                                sizes="(max-width: 859px) 200px, 260px"
                                priority
                            />
                        </div>
                    )}
                </div>
            </section>

            {/* Salary Overview Cards */}
            <section style={{ padding: '0 16px 64px', maxWidth: '900px', margin: '0 auto' }}>
                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                        gap: '16px',
                        marginBottom: '32px',
                    }}
                >
                    {[
                        {
                            icon: DollarSign,
                            label: 'Average Salary',
                            value: formatSalary(salaryData.avgSalary),
                            sub: `${Math.abs(diffPct)}% ${aboveBelow} national avg`,
                            color: '#F472B6',
                        },
                        {
                            icon: TrendingUp,
                            label: 'Salary Range',
                            value: `${formatSalary(salaryData.minSalary)} – ${formatSalary(salaryData.maxSalary)}`,
                            sub: 'Min – Max reported',
                            color: '#E86C2C',
                        },
                        {
                            icon: Briefcase,
                            label: 'Open Positions',
                            value: salaryData.jobCount.toLocaleString(),
                            sub: `Active jobs in ${stateCode}`,
                            color: '#A855F7',
                        },
                        {
                            icon: BarChart3,
                            label: 'National Average',
                            value: formatSalary(nationalAvg),
                            sub: 'All 50 states',
                            color: '#3B82F6',
                        },
                    ].map(({ icon: Ic, label, value, sub, color }) => (
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
                            <p style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '4px' }}>
                                {value}
                            </p>
                            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{sub}</p>
                        </div>
                    ))}
                </div>

                {/* A4 (teardown parity): honest date-stamp equivalent. The
                    figures above are a live snapshot, so the provenance line
                    states the query's own basis (N postings with disclosed
                    salary) instead of a fabricated "last updated today" —
                    this page deliberately has no editorial review date
                    (B54; its Article schema omits dates for the same
                    reason). jobCount ≥ 1 is guaranteed by the notFound()
                    empty-state gate above. */}
                <SalaryProvenance
                    live={{ count: salaryData.jobCount, minimum: 1 }}
                    style={{ textAlign: 'center', margin: '-16px 0 32px' }}
                />

                {/* Salary by Setting */}
                {bySetting.length > 0 && (
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
                                marginBottom: '20px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                            }}
                        >
                            <Stethoscope size={20} style={{ color: '#F472B6' }} />
                            Salary by Practice Setting
                        </h2>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {bySetting.sort((a, b) => b.avgSalary - a.avgSalary).map((s) => {
                                const pct = salaryData.maxSalary > 0
                                    ? Math.min(100, Math.round((s.avgSalary / salaryData.maxSalary) * 100))
                                    : 50;
                                return (
                                    <div key={s.setting}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                                            <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                                                {s.setting}
                                            </span>
                                            <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
                                                {formatSalary(s.avgSalary)}
                                            </span>
                                        </div>
                                        <div
                                            style={{
                                                height: '8px',
                                                borderRadius: '4px',
                                                backgroundColor: 'var(--bg-tertiary)',
                                                overflow: 'hidden',
                                            }}
                                        >
                                            <div
                                                style={{
                                                    height: '100%',
                                                    width: `${pct}%`,
                                                    borderRadius: '4px',
                                                    background: 'linear-gradient(90deg, #F472B6, #BE185D)',
                                                    transition: 'width 0.5s',
                                                }}
                                            />
                                        </div>
                                        <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                                            {s.jobCount} {s.jobCount === 1 ? 'position' : 'positions'}
                                        </p>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Two-column: Top Employers + Top Cities */}
                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                        gap: '24px',
                        marginBottom: '32px',
                    }}
                >
                    {/* Top Employers */}
                    {topEmployers.length > 0 && (
                        <div
                            style={{
                                padding: '28px 24px',
                                borderRadius: '18px',
                                backgroundColor: 'var(--bg-secondary)',
                                border: '1px solid var(--border-color)',
                            }}
                        >
                            <h2
                                style={{
                                    fontSize: '18px',
                                    fontWeight: 700,
                                    color: 'var(--text-primary)',
                                    marginBottom: '16px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                }}
                            >
                                <Building2 size={18} style={{ color: '#E86C2C' }} />
                                Top Employers in {stateCode}
                            </h2>
                            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                {topEmployers.map((emp, i) => (
                                    <li
                                        key={emp.name}
                                        style={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            padding: '10px 14px',
                                            borderRadius: '10px',
                                            backgroundColor: i % 2 === 0 ? 'var(--bg-tertiary)' : 'transparent',
                                        }}
                                    >
                                        <span style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 500 }}>
                                            {emp.name}
                                        </span>
                                        <span
                                            style={{
                                                fontSize: '12px',
                                                fontWeight: 600,
                                                color: '#E86C2C',
                                                backgroundColor: 'rgba(232,108,44,0.1)',
                                                padding: '2px 10px',
                                                borderRadius: '999px',
                                            }}
                                        >
                                            {emp.jobCount} {emp.jobCount === 1 ? 'job' : 'jobs'}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Top Cities */}
                    {topCities.length > 0 && (
                        <div
                            style={{
                                padding: '28px 24px',
                                borderRadius: '18px',
                                backgroundColor: 'var(--bg-secondary)',
                                border: '1px solid var(--border-color)',
                            }}
                        >
                            <h2
                                style={{
                                    fontSize: '18px',
                                    fontWeight: 700,
                                    color: 'var(--text-primary)',
                                    marginBottom: '16px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                }}
                            >
                                <MapPin size={18} style={{ color: '#A855F7' }} />
                                Top Cities in {stateCode}
                            </h2>
                            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                {topCities.map((city, i) => (
                                    <li key={city.name}>
                                        <Link
                                            href={`/jobs/city/${city.slug}`}
                                            style={{
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                                alignItems: 'center',
                                                padding: '10px 14px',
                                                borderRadius: '10px',
                                                backgroundColor: i % 2 === 0 ? 'var(--bg-tertiary)' : 'transparent',
                                                textDecoration: 'none',
                                                transition: 'background 0.2s',
                                            }}
                                        >
                                            <span style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 500 }}>
                                                {city.name}
                                            </span>
                                            <span
                                                style={{
                                                    fontSize: '12px',
                                                    fontWeight: 600,
                                                    color: '#A855F7',
                                                    backgroundColor: 'rgba(168,85,247,0.1)',
                                                    padding: '2px 10px',
                                                    borderRadius: '999px',
                                                }}
                                            >
                                                {city.jobCount} {city.jobCount === 1 ? 'job' : 'jobs'}
                                            </span>
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>

                {/* Cross-links (C17 + C18) */}
                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                        gap: '16px',
                    }}
                >
                    {/* C17: Link to state jobs page */}
                    <Link
                        href={`/jobs/state/${stateSlug}`}
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
                                Browse All {stateCode} {brand.niche.short} Jobs →
                            </p>
                            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                {salaryData.jobCount} open positions in {stateName}
                            </p>
                        </div>
                    </Link>

                    {/* Link to licensure guide — rendered only once the
                        license-guide blog series is published (see
                        LICENSE_GUIDE_SERIES_PUBLISHED in
                        config/niche/content-map.ts); otherwise this is a
                        dead /blog link on every salary-guide state page. */}
                    {LICENSE_GUIDE_SERIES_PUBLISHED && (
                    <Link
                        href={`/blog/${licenseSlug}`}
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
                        <BookOpen size={22} style={{ color: '#E86C2C', flexShrink: 0 }} />
                        <div>
                            <p style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '2px' }}>
                                {stateName} Licensure Guide →
                            </p>
                            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                Requirements, process & timeline
                            </p>
                        </div>
                    </Link>
                    )}

                    {/* Link to national salary guide */}
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
                                Compare all 50 states
                            </p>
                        </div>
                    </Link>
                </div>

                {/* FAQ — rendered from the SAME stateFaqs array as the FAQPage
                    JSON-LD above (B48: schema must match visible content). */}
                <div style={{ marginTop: '32px' }}>
                    <h2 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '16px' }}>
                        {brand.niche.short} Salary in {stateName} — FAQ
                    </h2>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {stateFaqs.map((faq, i) => (
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
                        Find {brand.niche.short} Jobs in {stateName}
                    </h2>
                    <p
                        style={{
                            fontSize: '15px',
                            color: 'var(--text-secondary)',
                            marginBottom: '24px',
                        }}
                    >
                        Browse {salaryData.jobCount} active positions and get daily alerts for new openings.
                    </p>
                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
                        <Link
                            href={`/jobs/state/${stateSlug}`}
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
                            Browse {stateCode} Jobs <ArrowRight size={16} />
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
