import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiAdmin } from '@/lib/auth/require-api-admin';
import { logAudit } from '@/lib/audit-log';
import { parsePagingParam, resolveAdminActorId, validateJobCreate, withOrderedSalary } from './_lib/job-input';
import { randomUUID } from 'node:crypto';
import { config } from '@/lib/config';
import { expiresFromNow } from '@/lib/expires-at';
import { slugify } from '@/lib/utils';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
/** Keeps (page - 1) * limit inside Prisma's safe skip range. */
const MAX_PAGE = 1_000_000;

/**
 * GET /api/admin/jobs
 * Admin-level job listing with search, filters, pagination.
 */
export async function GET(request: NextRequest) {
    const authError = await requireApiAdmin(request);
    if (authError) return authError;

    // Audit log: admin accessing job data. The entry names the acting admin
    // by auth id, like every other admin.job.* row; an email address would
    // put personal data in the audit table (lib/audit-log.ts). Written before
    // the read, so a failed read is still on record.
    await logAudit({
        action: 'admin.jobs.list',
        actorType: 'admin',
        actorId: await resolveAdminActorId(),
    });

    try {
        const { searchParams } = new URL(request.url);
        // Non-numeric or out-of-range paging falls back to the defaults
        // instead of feeding NaN into skip/take (which made Prisma throw).
        const page = parsePagingParam(searchParams.get('page'), 1, MAX_PAGE);
        const limit = parsePagingParam(searchParams.get('limit'), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
        const search = searchParams.get('search')?.trim();
        const source = searchParams.get('source');
        const published = searchParams.get('published'); // 'true' | 'false' | null
        const featured = searchParams.get('featured');   // 'true' | 'false' | null
        const sort = searchParams.get('sort') || 'newest'; // newest | oldest | views | clicks | title

        // Build where clause
        const where: Record<string, unknown> = {};

        if (search) {
            where.OR = [
                { title: { contains: search, mode: 'insensitive' } },
                { employer: { contains: search, mode: 'insensitive' } },
            ];
        }
        if (source && source !== 'all') {
            // Employer-posted jobs have sourceType='employer' and a null
            // sourceProvider — filter on sourceType for that virtual bucket.
            // Everything else filters on sourceProvider as before.
            if (source === 'employer') {
                where.sourceType = 'employer';
            } else {
                where.sourceProvider = source;
            }
        }
        if (published === 'true') where.isPublished = true;
        if (published === 'false') where.isPublished = false;
        if (featured === 'true') where.isFeatured = true;
        if (featured === 'false') where.isFeatured = false;

        // Sort
        let orderBy: Record<string, unknown>[] = [{ createdAt: 'desc' }];
        if (sort === 'oldest') orderBy = [{ createdAt: 'asc' }];
        else if (sort === 'views') orderBy = [{ viewCount: 'desc' }];
        else if (sort === 'clicks') orderBy = [{ applyClickCount: 'desc' }];
        else if (sort === 'title') orderBy = [{ title: 'asc' }];

        const skip = (page - 1) * limit;

        const [jobs, total] = await Promise.all([
            prisma.job.findMany({
                where,
                orderBy,
                skip,
                take: limit,
                select: {
                    id: true,
                    title: true,
                    slug: true,
                    employer: true,
                    location: true,
                    city: true,
                    state: true,
                    jobType: true,
                    mode: true,
                    displaySalary: true,
                    sourceProvider: true,
                    isPublished: true,
                    isFeatured: true,
                    isVerifiedEmployer: true,
                    viewCount: true,
                    applyClickCount: true,
                    qualityScore: true,
                    createdAt: true,
                    updatedAt: true,
                    expiresAt: true,
                    applyLink: true,
                    _count: { select: { jobApplications: true } },
                },
            }),
            prisma.job.count({ where }),
        ]);

        // Get unique source providers for filter options. Group on both
        // sourceProvider AND sourceType so we can split "employer-posted"
        // out of the catch-all "unknown" bucket — employer postings
        // (paid via Stripe) have sourceType='employer' and a null
        // sourceProvider, but admins want them surfaced as their own
        // first-class filter, not lumped with truly-unknown rows.
        const sourceGroups = await prisma.job.groupBy({
            by: ['sourceProvider', 'sourceType'],
            _count: true,
        });
        const sourceCounts = new Map<string, number>();
        for (const g of sourceGroups) {
            const label = g.sourceProvider
                ? g.sourceProvider
                : g.sourceType === 'employer'
                    ? 'employer'
                    : 'unknown';
            sourceCounts.set(label, (sourceCounts.get(label) ?? 0) + g._count);
        }
        const sources = [...sourceCounts.entries()]
            .map(([source, count]) => ({ source, count }))
            .sort((a, b) => b.count - a.count);

        return NextResponse.json({
            success: true,
            jobs: jobs.map(j => ({
                ...j,
                applications: j._count.jobApplications,
                _count: undefined,
            })),
            total,
            page,
            totalPages: Math.ceil(total / limit),
            sources,
        });
    } catch (error) {
        console.error('[Admin Jobs] GET error:', error);
        return NextResponse.json({ success: false, error: 'Failed to fetch jobs' }, { status: 500 });
    }
}

/**
 * POST /api/admin/jobs
 * Create a new job from admin panel.
 */
export async function POST(request: NextRequest) {
    const authError = await requireApiAdmin(request);
    if (authError) return authError;

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ success: false, error: 'Request body must be valid JSON' }, { status: 400 });
    }

    // Type and shape validation: wrong-typed numbers and non-http(s) apply
    // links are refused with 400 before anything reaches Prisma.
    const validated = validateJobCreate(body);
    if (!validated.ok) {
        return NextResponse.json({ success: false, error: validated.error }, { status: 400 });
    }
    const input = withOrderedSalary(validated.data);
    const title = input.title as string;
    const employer = input.employer as string;
    const str = (key: string) => (input[key] as string | null | undefined) ?? null;
    const int = (key: string) => (input[key] as number | null | undefined) ?? null;
    const bool = (key: string, fallback: boolean) => (input[key] as boolean | undefined) ?? fallback;

    try {
        // The id is minted here so the slug can end in it, as every other
        // job's does (lib/utils.ts slugify, the ingest pattern). The slug
        // this route used to write ended in a base36 timestamp, and
        // middleware.ts answers a /jobs/<slug> with no UUID at its end as an
        // unknown page (410), so every admin-created job's page was gone.
        const id = randomUUID();
        const slug = slugify(`${title} ${employer}`, id);
        const now = new Date();

        const job = await prisma.job.create({
            data: {
                id,
                title,
                employer,
                location: input.location as string,
                description: input.description as string,
                applyLink: input.applyLink as string,
                slug,
                sourceType: 'direct',
                sourceProvider: 'admin',
                // Posted here, now: undated rows sort last under Newest First.
                originalPostedAt: now,
                // The standard listing term. Without an expiry the listings
                // and the sitemaps keep a job for ever.
                expiresAt: expiresFromNow(config.durationDays, now),
                isPublished: bool('isPublished', true),
                isFeatured: bool('isFeatured', false),
                jobType: str('jobType'),
                mode: str('mode'),
                city: str('city'),
                state: str('state'),
                salaryRange: str('salaryRange'),
                minSalary: int('minSalary'),
                maxSalary: int('maxSalary'),
                salaryPeriod: str('salaryPeriod'),
                displaySalary: str('displaySalary'),
                isRemote: bool('isRemote', false),
                isHybrid: bool('isHybrid', false),
                benefits: (input.benefits as string[] | undefined) ?? [],
                setting: str('setting'),
                population: str('population'),
                // A new posting's content is new now (sitemap lastmod, the
                // page's "Last updated"; indexing audit fixSoon 5).
                contentChangedAt: new Date(),
            },
        });

        const actorId = await resolveAdminActorId();
        await logAudit({
            action: 'admin.job.create',
            actorType: 'admin',
            actorId,
            targetType: 'job',
            targetId: job.id,
            metadata: { createdByAdminId: actorId, jobTitle: title, employer, isPublished: job.isPublished },
        });

        return NextResponse.json({ success: true, job }, { status: 201 });
    } catch (error) {
        console.error('[Admin Jobs] POST error:', error);
        return NextResponse.json({ success: false, error: 'Failed to create job' }, { status: 500 });
    }
}
