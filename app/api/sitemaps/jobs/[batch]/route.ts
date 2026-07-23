/**
 * Batched job-detail sitemap — serves /jobs/{slug}-{uuid} URLs in batches.
 *
 * Why this exists: the primary sitemap (app/sitemap.ts) used to dump every
 * active job into one file uncapped. Google's per-sitemap limit is 50,000
 * URLs; if we cross it, Google rejects the *entire* sitemap and stops
 * recrawling everything. This route mirrors the cities batch pattern to
 * keep each sitemap file under the limit regardless of ingestion volume.
 *
 * BATCH_SIZE=25000 keeps each file well under the URL cap and the 50MB
 * uncompressed byte limit (each <url> block ≈ 200 bytes → ~5MB max).
 *
 * Routes:
 *   /api/sitemaps/jobs/0  → first 25K active jobs (highest qualityScore first)
 *   /api/sitemaps/jobs/1  → next 25K
 *   ...
 *
 * Ordering matches the previous primary-sitemap behavior: qualityScore desc,
 * createdAt desc — so Google crawls the strongest URLs first when a batch
 * is partially fetched.
 */
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { activeIndexableJobWhere } from '@/lib/active-job-filter';
import { brand } from '@/config/brand';
import { slugify } from '@/lib/utils';

const BATCH_SIZE = 25000;
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || brand.baseUrl;

// B28: activeIndexableJobWhere() bakes `now` into the where-clause, so it
// must be computed PER REQUEST (inside GET below). Frozen at module scope,
// a warm instance kept serving jobs that expired after cold start — the
// exact URLs middleware answers with 410.

interface JobBatchRow {
    id: string;
    title: string;
    slug: string | null;
    updatedAt: Date;
}

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ batch: string }> },
) {
    const { batch: batchStr } = await params;
    const batchIndex = parseInt(batchStr, 10);

    if (isNaN(batchIndex) || batchIndex < 0) {
        return NextResponse.json({ error: 'Invalid batch index' }, { status: 404 });
    }

    // Published, not expired, and not a repeated dead link (S6).
    const activeJobWhere = activeIndexableJobWhere();

    // Cheap count first to validate batch index without paying the full findMany.
    const totalJobs = await prisma.job.count({ where: activeJobWhere });
    const totalBatches = Math.max(1, Math.ceil(totalJobs / BATCH_SIZE));

    if (batchIndex >= totalBatches) {
        return NextResponse.json({ error: 'Invalid batch index' }, { status: 404 });
    }

    const skip = batchIndex * BATCH_SIZE;
    const jobs: JobBatchRow[] = await prisma.job.findMany({
        where: activeJobWhere,
        select: { id: true, title: true, slug: true, updatedAt: true },
        orderBy: [
            { qualityScore: 'desc' },
            { createdAt: 'desc' },
        ],
        skip,
        take: BATCH_SIZE,
    });

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${jobs.map(j => {
        const lastmod = j.updatedAt.toISOString();
        // MUST match the job page's canonical exactly (app/jobs/[slug]/
        // page.tsx: `job.slug || slugify(job.title, job.id)`). A divergent
        // local slug helper here previously submitted URLs whose
        // rel=canonical pointed elsewhere for any title with an apostrophe/
        // slash/parens or over the truncation length — "Duplicate, Google
        // chose different canonical than user" at scale.
        return `  <url>
    <loc>${BASE_URL}/jobs/${j.slug || slugify(j.title, j.id)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`;
    }).join('\n')}
</urlset>`;

    return new NextResponse(xml, {
        headers: {
            'Content-Type': 'application/xml',
            'Cache-Control': 'public, max-age=3600, s-maxage=3600',
        },
    });
}
