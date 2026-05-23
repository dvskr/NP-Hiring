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

/**
 * Generic taxonomy landing route — `/jobs/<category-slug>`.
 *
 * Replaces the 32 hand-rolled `/jobs/<slug>/` directories from the NP
 * fork with a single dynamic route driven by CANONICAL_CATEGORY_SLUGS.
 *
 * Rich pSEO chrome (hero, bento, benefits, tips, niche FAQs) is deferred
 * to Phase 8 — this route ships a functional listing today so URLs aren't
 * 404 while marketing copy is written.
 *
 * Validation: slugs not in CANONICAL_CATEGORY_SLUGS return 404 (which
 * matches the middleware's 410-Gone behavior for SEO-stale slugs).
 */

const VALID_SLUGS = new Set<string>(CANONICAL_CATEGORY_SLUGS);

const NAV_ONLY_PARAMS = new Set(['page', 'sort']);

export const revalidate = 60;

interface CategoryPageProps {
    params: Promise<{ category: string }>;
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/** Pretty label for the category — falls back to title-cased slug. */
function getCategoryLabel(slug: string): string {
    if (slug in CATEGORY_LABELS) {
        return CATEGORY_LABELS[slug as CategorySlug];
    }
    return slug
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

export async function generateMetadata({ params, searchParams }: CategoryPageProps): Promise<Metadata> {
    const { category } = await params;
    if (!VALID_SLUGS.has(category)) {
        return { title: 'Not Found' };
    }
    const sp = await searchParams;
    const label = getCategoryLabel(category);

    const urlParams = new URLSearchParams();
    Object.entries(sp).forEach(([key, value]) => {
        if (Array.isArray(value)) value.forEach((v) => urlParams.append(key, v));
        else if (value) urlParams.set(key, value);
    });
    const filters = parseFiltersFromParams(urlParams);
    const baseWhere = buildWhereClause(filters);
    const whereWithCategory = {
        ...baseWhere,
        ...withTagFallback(category as CategoryTag),
    };

    const totalJobs = await prisma.job.count({ where: whereWithCategory });
    const jobCountDisplay = totalJobs > 1000
        ? `${(Math.floor(totalJobs / 100) * 100).toLocaleString()}+`
        : totalJobs.toLocaleString();

    const userFilterKeys = Object.keys(sp).filter((k) => !NAV_ONLY_PARAMS.has(k));
    const hasUserFilters = userFilterKeys.length > 0;
    const pageNum = Math.max(1, parseInt((sp.page as string) || '1'));
    const isPaginated = pageNum > 1;
    const isEmpty = totalJobs === 0;
    const shouldNoindex = hasUserFilters || isPaginated || isEmpty;

    const title = `${label} NP Jobs — ${jobCountDisplay} Open Positions`;
    const description = `Browse ${jobCountDisplay} ${label.toLowerCase()} nurse practitioner jobs across the US. Filter by state, salary, mode, and job type. Updated daily.`;

    const basePath = `/jobs/c/${category}`;
    const canonical = isPaginated && !hasUserFilters
        ? `${brand.baseUrl}${basePath}?page=${pageNum}`
        : `${brand.baseUrl}${basePath}`;

    return {
        title,
        description,
        openGraph: {
            title,
            description,
            type: 'website',
        },
        twitter: {
            card: 'summary_large_image',
            title,
            description,
        },
        alternates: { canonical },
        ...(shouldNoindex && {
            robots: { index: false, follow: true },
        }),
    };
}

export default async function CategoryPage({ params, searchParams }: CategoryPageProps) {
    const { category } = await params;
    if (!VALID_SLUGS.has(category)) {
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
                id: true,
                slug: true,
                title: true,
                employer: true,
                location: true,
                city: true,
                state: true,
                jobType: true,
                isRemote: true,
                isHybrid: true,
                displaySalary: true,
                normalizedMinSalary: true,
                normalizedMaxSalary: true,
                salaryPeriod: true,
                description: true,
                descriptionSummary: true,
                createdAt: true,
                isFeatured: true,
                isVerifiedEmployer: true,
                originalPostedAt: true,
                mode: true,
                applyLink: true,
                applyOnPlatform: true,
                sourceType: true,
                experienceLabel: true,
                newGradFriendly: true,
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
        name: `${label} Nurse Practitioner Jobs`,
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
