import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { brand } from '@/config/brand';
import { prisma } from '@/lib/prisma';
import { buildWhereClause, parseFiltersFromParams } from '@/lib/filters';
import { slugify } from '@/lib/utils';
import JobsPageClient from '../../../JobsPageClient';
import { Job } from '@/lib/types';
import {
    CANONICAL_CATEGORY_SLUGS,
    withTagFallback,
    type CategoryTag,
} from '@/lib/pseo/category-tagger';
import { CATEGORY_LABELS, type CategorySlug } from '@/lib/pseo/category-faq-data';
import { getCityBySlug } from '@/lib/pseo/city-data/cities';

/**
 * `/jobs/<category>/city/<city-slug>` — category × city landing route.
 *
 * Minimal-but-functional pSEO page. Rich chrome (city narrative, healthcare
 * systems, COL, neighboring cities, FAQs) deferred to Phase 8.
 */

const VALID_SLUGS = new Set<string>(CANONICAL_CATEGORY_SLUGS);

export const revalidate = 3600;

interface CategoryCityPageProps {
    params: Promise<{ category: string; slug: string }>;
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

function getCategoryLabel(slug: string): string {
    if (slug in CATEGORY_LABELS) return CATEGORY_LABELS[slug as CategorySlug];
    return slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export async function generateMetadata({ params }: CategoryCityPageProps): Promise<Metadata> {
    const { category, slug } = await params;
    const city = getCityBySlug(slug);
    if (!VALID_SLUGS.has(category) || !city) {
        return { title: 'Not Found' };
    }
    const label = getCategoryLabel(category);

    const where = {
        isPublished: true,
        city: { equals: city.name, mode: 'insensitive' as const },
        state: { equals: city.state, mode: 'insensitive' as const },
        ...withTagFallback(category as CategoryTag),
    };
    const totalJobs = await prisma.job.count({ where });

    const title = `${label} NP Jobs in ${city.name}, ${city.stateCode} — ${totalJobs} Open`;
    const description = `Browse ${totalJobs} ${label.toLowerCase()} nurse practitioner jobs in ${city.name}, ${city.stateCode}. Population: ${city.population.toLocaleString()}. Updated daily.`;
    const canonical = `${brand.baseUrl}/jobs/${category}/city/${slug}`;

    return {
        title,
        description,
        openGraph: { title, description, type: 'website' },
        twitter: { card: 'summary_large_image', title, description },
        alternates: { canonical },
        ...(totalJobs === 0 && { robots: { index: false, follow: true } }),
    };
}

export default async function CategoryCityPage({ params, searchParams }: CategoryCityPageProps) {
    const { category, slug } = await params;
    const city = getCityBySlug(slug);
    if (!VALID_SLUGS.has(category) || !city) {
        notFound();
    }
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
        city: { equals: city.name, mode: 'insensitive' as const },
        state: { equals: city.state, mode: 'insensitive' as const },
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
        name: `${label} Nurse Practitioner Jobs in ${city.name}, ${city.stateCode}`,
        numberOfItems: total,
        itemListElement: jobs.slice(0, 10).map((job, i) => {
            const j = job as { id: string; slug?: string | null; title: string };
            const slug2 = j.slug || slugify(j.title, j.id);
            return {
                '@type': 'ListItem',
                position: i + 1,
                name: job.title,
                url: `${brand.baseUrl}/jobs/${slug2}`,
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
