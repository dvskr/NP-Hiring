/**
 * lib/pseo/category-landing-template.tsx
 *
 * Minimal shared landing-page template for the NP taxonomy categories added
 * in the 2026-07 folder migration (see lib/pseo/taxonomy-registry.ts). Each
 * new app/jobs/<slug>/page.tsx is a thin wrapper over this template — same
 * pattern as the [state] wrappers over setting-state-template.
 *
 * Bespoke editorial surfaces (hero art, bento grids, FAQs, salary claims)
 * are a separate content task — see docs/pilot-fork-runbook.md §3. This
 * template keeps every new category route functional, type-safe, and
 * query-correct until that content ships.
 *
 * QUERY NOTE: the legacy keyword registry (lib/filters.ts CATEGORY_FILTERS)
 * and the ingest classifier (lib/pseo/category-tagger.ts) still carry the
 * pre-fork PMHNP tag set. For slugs with no keyword entry we gate on the
 * precomputed `categoryTags` column instead of letting
 * buildCategoryWhereClause degrade to "all published jobs" — pages render
 * an honest empty state until the classifier is migrated to the NP taxonomy.
 */
import { Prisma } from '@prisma/client';
import { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Bell, Building2, TrendingUp } from 'lucide-react';
import { brand } from '@/config/brand';
import { prisma } from '@/lib/prisma';
import { BEST_SORT_ORDER_BY } from '@/lib/utils/job-sort';
import { buildCategoryWhereClause, CATEGORY_FILTERS, CATEGORY_EXTRA_OR } from '@/lib/filters';
import JobCard from '@/components/JobCard';
import { Job } from '@/lib/types';
import BreadcrumbSchema from '@/components/BreadcrumbSchema';
import { JobListViewTracker } from '@/components/analytics/ViewTrackers';
import CategoryLocationsExplore from '@/components/seo/CategoryLocationsExplore';
import { CATEGORY_AXES } from '@/lib/pseo/taxonomy-registry';

// ─── Category copy ───────────────────────────────────────────────────────────

interface CategoryCopy {
    /** Short label for breadcrumbs / headings (e.g. "Family Practice"). */
    label: string;
    /** Full role name for titles (e.g. "Family Practice Nurse Practitioner (FNP)"). */
    role: string;
    /** One-sentence hero description. TODO(content): per-board editorial copy. */
    blurb: string;
}

/** Labels for the NP slugs introduced by the 2026-07 taxonomy migration. */
export const NEW_CATEGORY_COPY: Record<string, CategoryCopy> = {
    'urgent-care': {
        label: 'Urgent Care',
        role: 'Urgent Care Nurse Practitioner',
        blurb: 'Walk-in clinic and urgent care NP roles with shift-based schedules and episodic acute care.',
    },
    'home-health': {
        label: 'Home Health',
        role: 'Home Health Nurse Practitioner',
        blurb: 'In-home visit NP roles spanning transitional care, chronic disease management, and house-call programs.',
    },
    'family-practice': {
        label: 'Family Practice',
        role: 'Family Practice Nurse Practitioner (FNP)',
        blurb: 'FNP roles across primary care clinics, health systems, and community practices treating patients of all ages.',
    },
    'adult-gerontology': {
        label: 'Adult-Gerontology',
        role: 'Adult-Gerontology Nurse Practitioner (AGNP)',
        blurb: 'AGNP roles — primary and acute care for adult and older-adult populations.',
    },
    pediatric: {
        label: 'Pediatric',
        role: 'Pediatric Nurse Practitioner (PNP)',
        blurb: 'PNP roles in pediatric clinics, children’s hospitals, and specialty practices.',
    },
    neonatal: {
        label: 'Neonatal',
        role: 'Neonatal Nurse Practitioner (NNP)',
        blurb: 'NNP roles in NICUs and newborn care teams at every acuity level.',
    },
    'women-health': {
        label: "Women's Health",
        role: "Women's Health Nurse Practitioner (WHNP)",
        blurb: 'WHNP roles across OB/GYN practices, reproductive health clinics, and women’s health programs.',
    },
    'acute-care': {
        label: 'Acute Care',
        role: 'Acute Care Nurse Practitioner (ACNP)',
        blurb: 'ACNP roles in ICUs, step-down units, and hospital specialty services.',
    },
    emergency: {
        label: 'Emergency',
        role: 'Emergency Nurse Practitioner (ENP)',
        blurb: 'ENP roles in emergency departments, fast tracks, and freestanding ERs.',
    },
    'psychiatric-mental-health': {
        label: 'Psychiatric Mental Health',
        role: 'Psychiatric Mental Health Nurse Practitioner (PMHNP)',
        blurb: 'PMHNP roles spanning outpatient, inpatient, and telepsychiatry settings.',
    },
    oncology: {
        label: 'Oncology',
        role: 'Oncology Nurse Practitioner',
        blurb: 'Oncology NP roles in cancer centers, infusion clinics, and survivorship programs.',
    },
    cardiology: {
        label: 'Cardiology',
        role: 'Cardiology Nurse Practitioner',
        blurb: 'Cardiology NP roles in heart failure clinics, cath lab teams, and cardiovascular practices.',
    },
    'primary-care': {
        label: 'Primary Care',
        role: 'Primary Care Nurse Practitioner',
        blurb: 'Primary care NP roles in outpatient clinics, FQHCs, and value-based care groups.',
    },
    hospitalist: {
        label: 'Hospitalist',
        role: 'Hospitalist Nurse Practitioner',
        blurb: 'Hospitalist NP roles on inpatient medicine teams with rounding and admission coverage.',
    },
    dermatology: {
        label: 'Dermatology',
        role: 'Dermatology Nurse Practitioner',
        blurb: 'Dermatology NP roles in medical, surgical, and cosmetic dermatology practices.',
    },
    orthopedic: {
        label: 'Orthopedic',
        role: 'Orthopedic Nurse Practitioner',
        blurb: 'Orthopedic NP roles in sports medicine, joint replacement, and spine practices.',
    },
    anesthesia: {
        label: 'Nurse Anesthetist',
        role: 'Certified Registered Nurse Anesthetist (CRNA)',
        blurb: 'CRNA roles in hospital ORs, ambulatory surgery centers, and anesthesia groups.',
    },
    midwifery: {
        label: 'Nurse Midwife',
        role: 'Certified Nurse Midwife (CNM)',
        blurb: 'CNM roles in hospital L&D units, birth centers, and midwifery practices.',
    },
    'clinical-nurse-specialist': {
        label: 'Clinical Nurse Specialist',
        role: 'Clinical Nurse Specialist (CNS)',
        blurb: 'CNS roles in quality, education, and specialty practice leadership across health systems.',
    },
};

/** Human label for any registry slug (falls back to title-case). */
export function categorySlugLabel(slug: string): string {
    if (NEW_CATEGORY_COPY[slug]) return NEW_CATEGORY_COPY[slug].label;
    const SPECIAL: Record<string, string> = { va: 'VA', lgbtq: 'LGBTQ+', '1099': '1099' };
    if (SPECIAL[slug]) return SPECIAL[slug];
    return slug
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

// ─── Query ───────────────────────────────────────────────────────────────────

function categoryWhere(slug: string): Prisma.JobWhereInput {
    const hasLegacyKeywordFilter =
        (CATEGORY_FILTERS[slug]?.length ?? 0) > 0 || (CATEGORY_EXTRA_OR[slug]?.length ?? 0) > 0;
    // TODO(content): migrate lib/filters.ts CATEGORY_FILTERS and
    // lib/pseo/category-tagger.ts to the NP taxonomy. Until then, slugs
    // without a keyword entry gate on the precomputed categoryTags column
    // so the page never lists off-category jobs.
    return hasLegacyKeywordFilter
        ? buildCategoryWhereClause(slug)
        : buildCategoryWhereClause(slug, { categoryTags: { has: slug } });
}

interface EmployerGroupResult { employer: string; _count: { employer: number }; }
interface ProcessedEmployer { name: string; count: number; }
interface Stats { totalJobs: number; avgSalary: number; topEmployers: ProcessedEmployer[]; }

async function getStats(slug: string): Promise<Stats> {
    const where = categoryWhere(slug);
    const totalJobs = await prisma.job.count({ where });
    if (totalJobs === 0) return { totalJobs: 0, avgSalary: 0, topEmployers: [] };
    const [salaryData, topEmployers] = await Promise.all([
        prisma.job.aggregate({
            where: { ...where, normalizedMinSalary: { not: null }, normalizedMaxSalary: { not: null } },
            _avg: { normalizedMinSalary: true, normalizedMaxSalary: true },
        }),
        prisma.job.groupBy({
            by: ['employer'],
            where,
            _count: { employer: true },
            orderBy: { _count: { employer: 'desc' } },
            take: 8,
        }),
    ]);
    const avgSalary = Math.round(
        ((salaryData._avg.normalizedMinSalary || 0) + (salaryData._avg.normalizedMaxSalary || 0)) / 2 / 1000,
    );
    return {
        totalJobs,
        avgSalary,
        topEmployers: topEmployers.map((e: EmployerGroupResult) => ({ name: e.employer, count: e._count.employer })),
    };
}

// ─── Metadata ────────────────────────────────────────────────────────────────

export async function buildCategoryLandingMetadata(
    slug: string,
    searchParams: { page?: string },
): Promise<Metadata> {
    const copy = NEW_CATEGORY_COPY[slug];
    const role = copy?.role ?? `${categorySlugLabel(slug)} Nurse Practitioner`;
    const page = Math.max(1, parseInt(searchParams.page || '1', 10) || 1);
    const totalJobs = await prisma.job.count({ where: categoryWhere(slug) });
    const countPrefix = totalJobs > 0 ? `${totalJobs} ` : '';
    return {
        title: `${countPrefix}${role} Jobs`,
        description: totalJobs > 0
            ? `Find ${totalJobs} ${role} jobs. Salaries, top employers, and new openings updated daily.`
            : `Browse ${role} jobs. New openings, salary data, and top employers updated daily.`,
        alternates: { canonical: `${brand.baseUrl}/jobs/${slug}` },
        // Noindex paginated views and (for now) empty categories — a 0-job
        // landing page is a thin doorway until inventory is tagged.
        ...((page > 1 || totalJobs === 0) && { robots: { index: false, follow: true } }),
    };
}

// ─── Page component ──────────────────────────────────────────────────────────

const clayCard: React.CSSProperties = {
    background: '#FFFFFF', borderRadius: '20px',
    border: '1px solid rgba(255,255,255,0.5)',
    boxShadow: '6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02)',
};

/** Sibling slugs from the same taxonomy axis (for the internal-links grid). */
function axisSiblings(slug: string, limit = 6): string[] {
    const axis = Object.values(CATEGORY_AXES).find((slugs) => (slugs as readonly string[]).includes(slug));
    if (!axis) return [];
    return (axis as readonly string[]).filter((s) => s !== slug).slice(0, limit);
}

interface CategoryLandingPageProps {
    slug: string;
    page: number;
}

export default async function CategoryLandingPage({ slug, page }: CategoryLandingPageProps) {
    const copy = NEW_CATEGORY_COPY[slug];
    const label = categorySlugLabel(slug);
    const role = copy?.role ?? `${label} Nurse Practitioner`;
    const take = 10;
    const skip = (page - 1) * take;

    const stats = await getStats(slug);
    const jobs = stats.totalJobs > 0
        ? await prisma.job.findMany({ where: categoryWhere(slug), orderBy: BEST_SORT_ORDER_BY, skip, take })
        : [];

    return (
        <div style={{ backgroundColor: '#FDFBF7' }}>
            <BreadcrumbSchema items={[
                { name: 'Home', url: brand.baseUrl },
                { name: 'Jobs', url: `${brand.baseUrl}/jobs` },
                { name: label, url: `${brand.baseUrl}/jobs/${slug}` },
            ]} />
            <JobListViewTracker
                jobs={jobs.map((j: Job) => ({ id: j.id, title: j.title, employer: j.employer }))}
                listName={`${label} Jobs`}
            />
            {jobs.length > 0 && (
                <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
                    '@context': 'https://schema.org',
                    '@type': 'ItemList',
                    name: `${role} Jobs`,
                    numberOfItems: stats.totalJobs,
                    itemListElement: jobs.slice(0, 10).map((job: Job, idx: number) => ({
                        '@type': 'ListItem',
                        position: idx + 1,
                        name: job.title,
                        url: `${brand.baseUrl}/jobs/${job.slug || job.id}`,
                    })),
                }) }} />
            )}

            {/* HERO */}
            <div style={{ background: 'linear-gradient(180deg, #FFF5EE 0%, #FDE8D8 55%, #FDFBF7 100%)' }}>
                <section style={{ maxWidth: '1100px', margin: '0 auto', padding: '72px 24px 48px', textAlign: 'center' }}>
                    <p style={{ fontSize: '13px', fontWeight: 600, color: '#0D9488', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '10px' }}>
                        {stats.totalJobs > 0 ? `${stats.totalJobs} live roles · updated daily` : 'Nurse Practitioner Careers'}
                    </p>
                    <h1 className="font-lora" style={{ fontSize: 'clamp(2rem, 5vw, 3rem)', fontWeight: 800, lineHeight: 1.15, color: '#1A2E35', marginBottom: '16px' }}>
                        {role} Jobs
                    </h1>
                    <p style={{ fontSize: '17px', color: '#5A4A42', maxWidth: '640px', margin: '0 auto 28px', lineHeight: 1.6 }}>
                        {copy?.blurb ?? `Browse ${label.toLowerCase()} nurse practitioner positions from employers nationwide.`}
                    </p>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', flexWrap: 'wrap' }}>
                        <Link href={`/jobs?category=${slug}`} className="cat-cta-primary" style={{ padding: '14px 32px', borderRadius: '14px', fontWeight: 700, fontSize: '14px', background: '#0D9488', color: '#fff', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '8px', boxShadow: '4px 4px 12px rgba(13,148,136,0.2)' }}>
                            Browse {label} Jobs <ArrowRight size={16} />
                        </Link>
                        <Link href="/job-alerts" style={{ padding: '14px 32px', borderRadius: '14px', fontWeight: 700, fontSize: '14px', color: '#0D9488', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '8px', background: '#FFFFFF', border: '1px solid rgba(13,148,136,0.25)' }}>
                            <Bell size={16} /> Set Alert
                        </Link>
                    </div>
                </section>
            </div>

            {/* JOB LISTINGS */}
            <div style={{ maxWidth: '1440px', margin: '0 auto', padding: '32px 24px' }}>
                <div className="grid lg:grid-cols-4 gap-8">
                    <div className="lg:col-span-3">
                        <h2 className="font-lora mb-6" style={{ fontSize: '20px', fontWeight: 700, color: '#1A2E35' }}>
                            {label} Positions ({stats.totalJobs})
                        </h2>
                        {jobs.length > 0 ? (
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
                                {jobs.map((job: Job) => (<JobCard key={job.id} job={job} />))}
                            </div>
                        ) : (
                            <div style={{ ...clayCard, textAlign: 'center', padding: '48px 24px' }}>
                                <p style={{ color: '#5A4A42', fontSize: '15px', margin: '0 0 16px' }}>
                                    No {label.toLowerCase()} positions right now — new roles are added daily.
                                </p>
                                <Link href="/jobs" style={{ fontWeight: 700, fontSize: '14px', color: '#0D9488', textDecoration: 'none' }}>
                                    Browse all nurse practitioner jobs →
                                </Link>
                            </div>
                        )}
                        {jobs.length > 0 && (
                            <div style={{ textAlign: 'center', marginTop: '32px' }}>
                                <Link href={`/jobs?category=${slug}`} className="cat-cta-primary" style={{ padding: '14px 32px', borderRadius: '14px', fontWeight: 700, fontSize: '14px', background: '#0D9488', color: '#fff', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '8px', boxShadow: '4px 4px 12px rgba(13,148,136,0.2)' }}>
                                    Browse All {label} Jobs <ArrowRight size={16} />
                                </Link>
                            </div>
                        )}
                    </div>
                    <div className="lg:col-span-1">
                        <div style={{ ...clayCard, padding: '24px', marginBottom: '20px', background: 'linear-gradient(145deg, #F0FDFA, #CCFBF1)', border: '2px solid rgba(13,148,136,0.15)' }}>
                            <Bell size={28} style={{ color: '#0D9488', marginBottom: '12px' }} />
                            <h3 className="font-lora" style={{ fontSize: '18px', fontWeight: 700, color: '#134E4A', margin: '0 0 8px' }}>{label} Alerts</h3>
                            <p style={{ fontSize: '13px', color: '#0D9488', marginBottom: '16px' }}>New {label.toLowerCase()} roles delivered daily.</p>
                            <Link href="/job-alerts" style={{ display: 'block', textAlign: 'center', padding: '10px 20px', borderRadius: '10px', fontWeight: 700, fontSize: '13px', background: '#0D9488', color: '#fff', textDecoration: 'none' }}>Create Alert</Link>
                        </div>
                        {stats.topEmployers.length > 0 && (
                            <div style={{ ...clayCard, padding: '24px', marginBottom: '20px' }}>
                                <Building2 size={20} style={{ color: '#0D9488', marginBottom: '8px' }} />
                                <h3 style={{ fontSize: '15px', fontWeight: 800, color: '#1A2E35', margin: '0 0 12px' }}>Top Employers</h3>
                                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                                    {stats.topEmployers.map((employer: ProcessedEmployer, index: number) => (
                                        <li key={index} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: index < stats.topEmployers.length - 1 ? '1px solid rgba(0,0,0,0.05)' : 'none' }}>
                                            <span style={{ fontSize: '13px', color: '#5A4A42', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{employer.name}</span>
                                            <span style={{ fontSize: '12px', fontWeight: 700, color: '#0D9488', marginLeft: '8px' }}>{employer.count}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        {stats.avgSalary > 0 && (
                            <div style={{ ...clayCard, padding: '24px' }}>
                                <TrendingUp size={20} style={{ color: '#34D399', marginBottom: '8px' }} />
                                <div style={{ fontSize: '32px', fontWeight: 800, color: '#1A2E35' }}>${stats.avgSalary}k</div>
                                <div style={{ fontSize: '13px', color: '#7A6A62' }}>Average salary</div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* TODO(content): per-board editorial copy — see docs/pilot-fork-runbook.md §3.
                Bespoke sections (why-this-specialty bento, requirements checklist,
                salary narrative, FAQ + FAQPage schema) slot in here. */}

            {/* RELATED CATEGORIES — same taxonomy axis */}
            {axisSiblings(slug).length > 0 && (
                <div style={{ background: 'linear-gradient(180deg, #F0FDFA 0%, #E6FAF5 50%, #F0FDFA 100%)' }}>
                    <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '56px 20px' }}>
                        <p style={{ fontSize: '13px', fontWeight: 600, color: '#E86C2C', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>Keep Exploring</p>
                        <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 34px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '40px' }}>Related Categories</h2>
                        <div className="cat-explore-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
                            {axisSiblings(slug).map((sibling) => (
                                <Link key={sibling} href={`/jobs/${sibling}`} className="cat-bento-card" style={{ ...clayCard, padding: '24px 20px', textDecoration: 'none', textAlign: 'center' }}>
                                    <span style={{ fontSize: '15px', fontWeight: 700, color: '#1A2E35', display: 'block', marginBottom: '4px' }}>{categorySlugLabel(sibling)}</span>
                                    <span style={{ fontSize: '12px', color: '#7A6A62', display: 'block' }}>Nurse practitioner jobs</span>
                                </Link>
                            ))}
                        </div>
                    </section>
                </div>
            )}

            {/* By Location — pseoStats-gated internal links */}
            <CategoryLocationsExplore categorySlug={slug} categoryLabel={label} />

            <style>{`
                .cat-cta-primary { transition: transform 0.25s ease, box-shadow 0.25s ease, filter 0.25s ease; }
                .cat-cta-primary:hover { transform: translateY(-3px); box-shadow: 0 10px 32px rgba(13,148,136,0.35) !important; filter: brightness(1.05); }
                .cat-bento-card { transition: transform 0.3s ease, box-shadow 0.3s ease; }
                .cat-bento-card:hover { transform: translateY(-4px); box-shadow: 8px 8px 24px rgba(0,0,0,0.1), -4px -4px 12px rgba(255,255,255,0.9), inset 1px 1px 2px rgba(255,255,255,0.6) !important; }
                @media (max-width: 768px) { .cat-explore-grid { grid-template-columns: repeat(2, 1fr) !important; } }
            `}</style>
        </div>
    );
}
