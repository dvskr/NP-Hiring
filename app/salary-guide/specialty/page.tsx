/**
 * /salary-guide/specialty — index hub for the by-specialty salary pages
 * (content audit P1 #7). Lists every configured specialty with its
 * estimated premium range (median × published premium) and a live posting
 * count, linking down to the detail pages and back up to the national
 * guide.
 *
 * CREDENTIAL TRUTH: the roster covers neighbouring APRN roles (CRNA, CNM)
 * alongside the niche specialties. Their cards must not borrow the
 * all-<niche> median as their own figure — see `page.isNicheRole` in
 * specialty-config.ts.
 */
import { brand } from '@/config/brand';
import { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import BreadcrumbSchema from '@/components/BreadcrumbSchema';
import { STAT_SOURCES } from '@/lib/stats-sources';
import { withTagFallback } from '@/lib/pseo/category-tagger';
import { SALARY_SPECIALTY_PAGES } from './specialty-config';
import { configRange, formatSalary, MIN_LIVE_JOBS } from './specialty-content';
import { ArrowRight, BarChart3, Stethoscope } from 'lucide-react';

export const revalidate = 86400; // ISR daily

const median = STAT_SOURCES.averageSalary;

const OG_IMAGE = `${brand.baseUrl}/api/og?title=${encodeURIComponent(`${brand.niche.short} Salary by Specialty`)}&type=page`;

export const metadata: Metadata = {
    title: `${brand.niche.short} & APRN Salary by Specialty 2026 — FNP, CRNA, CNM`,
    description: `Compare ${brand.niche.descriptor} pay across ${SALARY_SPECIALTY_PAGES.length} specialties. National all-${brand.niche.short} median ${median.formatted} (BLS), specialty premiums, and live salary data updated daily.`,
    alternates: { canonical: `${brand.baseUrl}/salary-guide/specialty` },
    openGraph: {
        title: `${brand.niche.short} Salary by Specialty 2026`,
        description: `Specialty-by-specialty ${brand.niche.short} pay: premiums over the ${median.formatted} national median, top-paying states, and live openings.`,
        type: 'website',
        url: `${brand.baseUrl}/salary-guide/specialty`,
        siteName: brand.name,
        images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: `${brand.niche.short} Salary by Specialty 2026` }],
    },
    twitter: { card: 'summary_large_image', images: [OG_IMAGE] },
};

async function getLiveCounts(): Promise<Record<string, number>> {
    const counts = await Promise.all(
        SALARY_SPECIALTY_PAGES.map(async (page) => {
            const count = await prisma.job.count({
                where: {
                    isPublished: true,
                    normalizedMinSalary: { not: null },
                    ...withTagFallback(page.slug),
                },
            });
            return [page.slug, count] as const;
        }),
    );
    return Object.fromEntries(counts);
}

export default async function SalarySpecialtyIndexPage() {
    const liveCounts = await getLiveCounts();

    return (
        <div style={{ backgroundColor: 'var(--bg-primary)', minHeight: '100vh' }}>
            <BreadcrumbSchema
                items={[
                    { name: 'Home', url: brand.baseUrl },
                    { name: 'Salary Guide', url: `${brand.baseUrl}/salary-guide` },
                    { name: 'Specialties', url: `${brand.baseUrl}/salary-guide/specialty` },
                ]}
            />

            {/* Hero */}
            <section style={{ padding: '72px 16px 48px', textAlign: 'center' }}>
                <div style={{ maxWidth: '760px', margin: '0 auto' }}>
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
                        <Stethoscope size={14} /> Salary by Specialty · Updated Daily
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
                        {brand.niche.short} Salary by Specialty
                    </h1>
                    <p style={{ fontSize: '16px', color: 'var(--text-secondary)', maxWidth: '600px', margin: '0 auto', lineHeight: 1.6 }}>
                        The national median across all {brand.niche.short}s is{' '}
                        <strong>{median.formatted}</strong> per year ({median.source}) — but specialty
                        choice moves pay more than almost any other factor. Pick a specialty for its full
                        breakdown: premiums, top-paying states, and live postings. The nurse anesthetist
                        and nurse midwife guides cover neighbouring APRN roles, which that median does not
                        include.
                    </p>
                </div>
            </section>

            {/* Specialty cards */}
            <section style={{ padding: '0 16px 64px', maxWidth: '1000px', margin: '0 auto' }}>
                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))',
                        gap: '16px',
                    }}
                >
                    {SALARY_SPECIALTY_PAGES.map((page) => {
                        const range = configRange(page);
                        const count = liveCounts[page.slug] ?? 0;
                        return (
                            <Link
                                key={page.slug}
                                href={`/salary-guide/specialty/${page.slug}`}
                                style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '10px',
                                    padding: '24px 22px',
                                    borderRadius: '16px',
                                    backgroundColor: 'var(--bg-secondary)',
                                    border: '1px solid var(--border-color)',
                                    textDecoration: 'none',
                                    transition: 'border-color 0.3s',
                                }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px' }}>
                                    <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>
                                        {page.label}
                                    </span>
                                    {page.credential && (
                                        <span
                                            style={{
                                                fontSize: '11px',
                                                fontWeight: 700,
                                                color: '#F472B6',
                                                backgroundColor: 'rgba(244,114,182,0.1)',
                                                padding: '2px 10px',
                                                borderRadius: '999px',
                                            }}
                                        >
                                            {page.credential}
                                        </span>
                                    )}
                                </div>
                                {range && page.premium ? (
                                    <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
                                        {formatSalary(range.min)} – {formatSalary(range.max)}
                                        <span style={{ fontSize: '11px', fontWeight: 500, color: 'var(--text-muted)', marginLeft: '6px' }}>
                                            estimated · +{page.premium.minPct}–{page.premium.maxPct}% vs median
                                        </span>
                                    </span>
                                ) : page.isNicheRole ? (
                                    <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                                        National median {median.formatted} · live data on the guide
                                    </span>
                                ) : (
                                    // The all-<niche> median excludes this role — never show it here.
                                    <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                                        Pay from live {page.credential} postings on the guide
                                    </span>
                                )}
                                <span style={{ fontSize: '12.5px', color: 'var(--text-muted)', lineHeight: 1.55 }}>
                                    {page.blurb}
                                </span>
                                <span style={{ fontSize: '12px', fontWeight: 600, color: '#F472B6', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                    {count >= MIN_LIVE_JOBS ? `${count} live postings with pay` : 'View salary guide'}{' '}
                                    <ArrowRight size={12} />
                                </span>
                            </Link>
                        );
                    })}
                </div>

                {/* Back to national guide */}
                <div style={{ marginTop: '28px' }}>
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
                        }}
                    >
                        <BarChart3 size={22} style={{ color: '#3B82F6', flexShrink: 0 }} />
                        <div>
                            <p style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '2px' }}>
                                National Salary Guide →
                            </p>
                            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                Pay by state, experience level, and practice setting
                            </p>
                        </div>
                    </Link>
                </div>
            </section>
        </div>
    );
}
