import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { brand } from '@/config/brand';
import { prisma } from '@/lib/prisma';
import { buildWhereClause, parseFiltersFromParams } from '@/lib/filters';
import { slugify } from '@/lib/utils';
import JobsPageClient from '../../JobsPageClient';
import { Job } from '@/lib/types';
import {
    CANONICAL_CATEGORY_SLUGS,
    withTagFallback,
    type CategoryTag,
} from '@/lib/pseo/category-tagger';
import { CATEGORY_LABELS, type CategorySlug } from '@/lib/pseo/category-faq-data';
import { stateToSlug } from '@/lib/pseo/setting-state-config';

/**
 * `/jobs/<category>/<state>` — category × state landing route.
 *
 * Minimal-but-functional pSEO page. Rich chrome (practice authority,
 * employer breakdown, neighboring states, state FAQ) is deferred to
 * Phase 8 once NP-specific copy is ready.
 */

const VALID_SLUGS = new Set<string>(CANONICAL_CATEGORY_SLUGS);

const STATE_NAMES = [
    'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado',
    'Connecticut', 'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho',
    'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana',
    'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota',
    'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada',
    'New Hampshire', 'New Jersey', 'New Mexico', 'New York',
    'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon',
    'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota',
    'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington',
    'West Virginia', 'Wisconsin', 'Wyoming', 'District of Columbia',
];

const SLUG_TO_STATE = STATE_NAMES.reduce<Record<string, string>>((acc, name) => {
    acc[stateToSlug(name)] = name;
    return acc;
}, {});

export const revalidate = 3600;

interface CategoryStatePageProps {
    params: Promise<{ category: string; state: string }>;
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

function getCategoryLabel(slug: string): string {
    if (slug in CATEGORY_LABELS) return CATEGORY_LABELS[slug as CategorySlug];
    return slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export async function generateMetadata({ params }: CategoryStatePageProps): Promise<Metadata> {
    const { category, state } = await params;
    if (!VALID_SLUGS.has(category) || !SLUG_TO_STATE[state]) {
        return { title: 'Not Found' };
    }
    const stateName = SLUG_TO_STATE[state];
    const label = getCategoryLabel(category);

    const where = {
        isPublished: true,
        state: { equals: stateName, mode: 'insensitive' as const },
        ...withTagFallback(category as CategoryTag),
    };
    const totalJobs = await prisma.job.count({ where });

    const title = `${label} NP Jobs in ${stateName} — ${totalJobs} Open`;
    const description = `Browse ${totalJobs} ${label.toLowerCase()} nurse practitioner jobs in ${stateName}. Filter by salary, mode, and job type. Updated daily.`;
    const canonical = `${brand.baseUrl}/jobs/${category}/${state}`;

    return {
        title,
        description,
        openGraph: { title, description, type: 'website' },
        twitter: { card: 'summary_large_image', title, description },
        alternates: { canonical },
        ...(totalJobs === 0 && { robots: { index: false, follow: true } }),
    };
}

export default async function CategoryStatePage({ params, searchParams }: CategoryStatePageProps) {
    const { category, state } = await params;
    if (!VALID_SLUGS.has(category) || !SLUG_TO_STATE[state]) {
        notFound();
    }
    const stateName = SLUG_TO_STATE[state];
    const sp = await searchParams;

    const urlParams = new URLSearchParams();
    Object.entries(sp).forEach(([key, value]) => {
        if (Array.isArray(value)) value.forEach((v) => urlParams.append(key, v));
        else if (value) urlParams.set(key, value);
    });
    const filters = parseFiltersFromParams(urlParams);
    const baseWhere = buildWhereClause(filters);
    const where = {
        ...baseWhere,
        state: { equals: stateName, mode: 'insensitive' as const },
        ...withTagFallback(category as CategoryTag),
    };

    const page = parseInt((sp.page as string) || '1');
    const sort = (sp.sort as string) || 'best';
    const limit = 50;
    const skip = (page - 1) * limit;

    let orderBy: Record<string, unknown>[] = [
        { isFeatured: 'desc' },
        { qualityScore: 'desc' },
        { originalPostedAt: 'desc' },
        { createdAt: 'desc' },
    ];
    if (sort === 'newest') {
        orderBy = [
            { originalPostedAt: { sort: 'desc', nulls: 'last' } },
            { createdAt: 'desc' },
        ];
    } else if (sort === 'salary') {
        orderBy = [
            { normalizedMaxSalary: { sort: 'desc', nulls: 'last' } },
            { normalizedMinSalary: { sort: 'desc', nulls: 'last' } },
            { createdAt: 'desc' },
        ];
    }

    const [rawJobs, total] = await Promise.all([
        prisma.job.findMany({
            where,
            orderBy,
            skip,
            take: limit,
            select: {
                id: true, slug: true, title: true, employer: true, location: true,
                city: true, state: true, jobType: true, isRemote: true, isHybrid: true,
                displaySalary: true, normalizedMinSalary: true, normalizedMaxSalary: true,
                salaryPeriod: true, description: true, descriptionSummary: true,
                createdAt: true, isFeatured: true, isVerifiedEmployer: true,
                originalPostedAt: true, mode: true, applyLink: true, applyOnPlatform: true,
                sourceType: true, experienceLabel: true, newGradFriendly: true,
                employerJobs: { select: { companyLogoUrl: true } },
            },
        }),
        prisma.job.count({ where }),
    ]);

    const jobs = rawJobs.map((j) => ({
        ...j,
        companyLogoUrl: j.employerJobs?.companyLogoUrl || null,
        employerJobs: undefined,
    }));

    const label = getCategoryLabel(category);

    const jobListSchema = {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: `${label} Nurse Practitioner Jobs in ${stateName}`,
        numberOfItems: total,
        itemListElement: jobs.slice(0, 10).map((job, i) => {
            const j = job as { id: string; slug?: string | null; title: string };
            const slug = j.slug || slugify(j.title, j.id);
            return {
                '@type': 'ListItem',
                position: i + 1,
                name: job.title,
                url: `${brand.baseUrl}/jobs/${slug}`,
            };
        }),
    };

    return (
        <>
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{
                    __html: JSON.stringify(jobListSchema)
                        .replace(/</g, '\\u003c')
                        .replace(/>/g, '\\u003e'),
                }}
            />
            <JobsPageClient
                initialJobs={jobs as unknown as Job[]}
                initialTotal={total}
                initialPage={page}
                initialTotalPages={Math.ceil(total / limit)}
            />
        </>
    );
}
