/**
 * /salary-guide/specialty: index hub for the by-specialty salary pages
 * (content audit P1 #7). Lists every configured specialty with its
 * estimated premium range (the cited median times the published premium)
 * and a live posting count, linking down to the detail pages and back up to
 * the national guide.
 *
 * CREDENTIAL TRUTH: the roster covers neighbouring APRN roles (CRNA, CNM)
 * alongside the niche specialties. Their cards must not borrow the
 * all-niche median as their own figure; see `page.isNicheRole` in
 * specialty-config.ts.
 *
 * STYLE: clay (owner decision 2026-09-20), matching the rest of the pSEO
 * family: the CLAY_GROUND page, clay cards, pink eyebrows and Lora
 * headings.
 */
import { brand } from '@/config/brand';
import { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import BreadcrumbSchema from '@/components/BreadcrumbSchema';
import SalaryProvenance from '@/components/SalaryProvenance';
import { STAT_SOURCES } from '@/lib/stats-sources';
import { withTagFallback } from '@/lib/pseo/category-tagger';
import { canonicalBucketWhere } from '@/lib/canonical-counts';
import { formatCount } from '@/lib/display-text';
import {
    ClayCard,
    ClayHead,
    ClayStyles,
    CLAY_BODY,
    CLAY_GROUND,
    CLAY_INK,
    CLAY_MUTED,
    clayChip,
    clayFill,
    clayMeta,
} from '@/components/seo/pseo';
import { SALARY_SPECIALTY_PAGES } from './specialty-config';
import { configRange, formatSalary, MIN_LIVE_JOBS } from './specialty-content';
import { BarChart3, Stethoscope } from 'lucide-react';

export const revalidate = 86400; // ISR daily

const median = STAT_SOURCES.averageSalary;

const OG_IMAGE = `${brand.baseUrl}/api/og?title=${encodeURIComponent(`${brand.niche.short} Salary by Specialty`)}&type=page`;

const INDEX_TITLE = `${brand.niche.short} and APRN Salary by Specialty: FNP, CRNA, CNM`;
const INDEX_DESCRIPTION = `Compare ${brand.niche.descriptor} pay across ${SALARY_SPECIALTY_PAGES.length} specialties. National all-${brand.niche.short} median ${median.formatted} (${median.source}), specialty premiums, and live postings with disclosed pay.`;

export const metadata: Metadata = {
    title: INDEX_TITLE,
    description: INDEX_DESCRIPTION,
    alternates: { canonical: `${brand.baseUrl}/salary-guide/specialty` },
    openGraph: {
        title: INDEX_TITLE,
        description: INDEX_DESCRIPTION,
        type: 'website',
        url: `${brand.baseUrl}/salary-guide/specialty`,
        siteName: brand.name,
        images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: `${brand.niche.short} salary by specialty` }],
    },
    twitter: { card: 'summary_large_image', images: [OG_IMAGE] },
};

/**
 * Live postings with disclosed pay per specialty, over the canonical pool
 * so a card can never count an expired or dead-link row (thin-spec-4 B3).
 */
async function getLiveCounts(): Promise<Record<string, number>> {
    const counts = await Promise.all(
        SALARY_SPECIALTY_PAGES.map(async (page) => {
            const count = await prisma.job.count({
                where: canonicalBucketWhere({
                    AND: [
                        { normalizedMinSalary: { not: null } },
                        withTagFallback(page.slug) as Record<string, unknown>,
                    ],
                }),
            });
            return [page.slug, count] as const;
        }),
    );
    return Object.fromEntries(counts);
}

export default async function SalarySpecialtyIndexPage() {
    const liveCounts = await getLiveCounts();

    return (
        <div style={{ backgroundColor: CLAY_GROUND, minHeight: '100vh' }}>
            <style>{`
                .sp-index-band { max-width: 1040px; margin: 0 auto; padding: 0 16px 56px; }
                .sp-index-grid { display: grid; gap: 20px; grid-template-columns: minmax(0, 1fr); }
                @media (min-width: 720px) {
                    .sp-index-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
                }
                @media (min-width: 1040px) {
                    .sp-index-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
                }
            `}</style>
            <ClayStyles />
            <BreadcrumbSchema
                items={[
                    { name: 'Home', url: brand.baseUrl },
                    { name: 'Salary Guide', url: `${brand.baseUrl}/salary-guide` },
                    { name: 'Specialties', url: `${brand.baseUrl}/salary-guide/specialty` },
                ]}
            />

            {/* Hero */}
            <section style={{ padding: '72px 16px 40px', textAlign: 'center' }}>
                <div style={{ maxWidth: '760px', margin: '0 auto' }}>
                    <span style={{ ...clayChip, background: clayFill(0), gap: '6px' }}>
                        <Stethoscope size={13} /> Salary by specialty
                    </span>
                    <h1
                        className="font-lora"
                        style={{
                            fontSize: 'clamp(1.9rem, 4.5vw, 2.9rem)',
                            fontWeight: 700,
                            color: CLAY_INK,
                            lineHeight: 1.15,
                            margin: '16px 0 14px',
                        }}
                    >
                        {brand.niche.short} Salary by Specialty
                    </h1>
                    <p style={{ fontSize: '16px', color: CLAY_BODY, maxWidth: '620px', margin: '0 auto', lineHeight: 1.65 }}>
                        The national median across all {brand.niche.short}s is{' '}
                        <strong>{median.formatted}</strong> per year ({median.source}), and specialty
                        choice moves pay more than almost any other factor. Pick a specialty for its
                        full breakdown: premiums, top-paying states and live postings. The nurse
                        anesthetist and nurse midwife guides cover neighbouring APRN roles, which that
                        median does not include.
                    </p>
                    {/* A4: cited-stat provenance for the median every card
                        benchmarks against, source and vintage straight from
                        STAT_SOURCES metadata. Per-card posting counts carry
                        their own basis inline. */}
                    <SalaryProvenance cited={[median]} style={{ textAlign: 'center', marginTop: '14px' }} />
                </div>
            </section>

            {/* Specialty cards */}
            <section className="sp-index-band">
                <div className="sp-index-grid">
                    {SALARY_SPECIALTY_PAGES.map((page, i) => {
                        const range = configRange(page);
                        const count = liveCounts[page.slug] ?? 0;
                        const figure = range && page.premium
                            ? `${formatSalary(range.min)} to ${formatSalary(range.max)} estimated, a premium of ${page.premium.minPct} to ${page.premium.maxPct}% over the median`
                            : page.isNicheRole
                                ? `National median ${median.formatted}, with live board data on the guide`
                                // The all-niche median excludes this role, so it never appears here.
                                : `Pay from live ${page.credential} postings on the guide`;
                        return (
                            <ClayCard
                                key={page.slug}
                                href={`/salary-guide/specialty/${page.slug}`}
                                chip={page.credential ?? page.label}
                                index={i}
                                icon={Stethoscope}
                                title={page.label}
                                desc={page.blurb}
                                action="Open the guide"
                                headingLevel={2}
                            >
                                <p style={{ fontSize: '13px', color: CLAY_MUTED, margin: '12px 0 0', lineHeight: 1.55 }}>
                                    {figure}
                                </p>
                                {count >= MIN_LIVE_JOBS && (
                                    <p style={{ ...clayMeta, margin: '8px 0 0' }}>
                                        {formatCount(count, 'live posting')} with disclosed pay
                                    </p>
                                )}
                            </ClayCard>
                        );
                    })}
                </div>
            </section>

            {/* Back to the national guide */}
            <section className="sp-index-band" style={{ paddingBottom: '72px' }}>
                <ClayHead
                    eyebrow="Also on this board"
                    title="Pay by state, not by specialty"
                    lede="The national guide publishes a median per state, plus the practice rules and the employers behind each one."
                />
                <ClayCard
                    href="/salary-guide"
                    chip="By state"
                    index={1}
                    icon={BarChart3}
                    title="National salary guide"
                    desc="Every state that publishes a median, the gate each one has to clear, and the board-wide figures behind the comparison."
                    action="Open the salary guide"
                    headingLevel={2}
                />
                <p style={{ fontSize: '13px', color: CLAY_MUTED, margin: '16px 0 0', textAlign: 'center' }}>
                    <Link href="/salary-guide" style={{ color: CLAY_INK }}>All states</Link>
                </p>
            </section>
        </div>
    );
}
