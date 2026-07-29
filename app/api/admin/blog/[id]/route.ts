import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireApiAdmin } from '@/lib/auth/require-api-admin';
import { parseFaqJson, parseReviewedAt } from '@/app/api/admin/blog/validate';

/**
 * GET /api/admin/blog/:id
 * Get a single blog post with full content for editing.
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const authError = await requireApiAdmin(request);
    if (authError) return authError;

    const { id } = await params;

    try {
        const post = await prisma.blogPost.findUnique({ where: { id } });
        if (!post) {
            return NextResponse.json({ success: false, error: 'Post not found' }, { status: 404 });
        }
        return NextResponse.json({ success: true, post });
    } catch (error) {
        console.error('[Admin Blog] GET/:id error:', error);
        return NextResponse.json({ success: false, error: 'Failed to fetch post' }, { status: 500 });
    }
}

/**
 * PUT /api/admin/blog/:id
 * Update blog post.
 */
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const authError = await requireApiAdmin(request);
    if (authError) return authError;

    const { id } = await params;

    try {
        const body = await request.json();
        const allowedFields = [
            'title', 'content', 'category', 'status',
            'metaDescription', 'targetKeyword', 'imageUrl',
        ];
        const data: Record<string, unknown> = {};

        for (const field of allowedFields) {
            if (field in body) {
                data[field] = body[field];
            }
        }

        // Editorially-authored schema fields — validated, never copied raw
        // (they feed FAQPage JSON-LD + BlogPosting.dateModified on the
        // public post page).
        if ('faqJson' in body) {
            const faqResult = parseFaqJson(body.faqJson);
            if (!faqResult.ok) {
                return NextResponse.json({ success: false, error: faqResult.error }, { status: 400 });
            }
            // Prisma nullable-Json semantics: DbNull clears the column.
            data.faqJson = faqResult.value === null ? Prisma.DbNull : faqResult.value;
        }
        if ('reviewedAt' in body) {
            const reviewedResult = parseReviewedAt(body.reviewedAt);
            if (!reviewedResult.ok) {
                return NextResponse.json({ success: false, error: reviewedResult.error }, { status: 400 });
            }
            data.reviewedAt = reviewedResult.value;
        }

        // Auto-set publishDate when publishing
        if (data.status === 'published') {
            const existing = await prisma.blogPost.findUnique({
                where: { id },
                select: { publishDate: true },
            });
            if (!existing?.publishDate) {
                data.publishDate = new Date();
            }
        }

        const post = await prisma.blogPost.update({
            where: { id },
            data,
        });

        return NextResponse.json({ success: true, post });
    } catch (error) {
        console.error('[Admin Blog] PUT error:', error);
        return NextResponse.json({ success: false, error: 'Failed to update post' }, { status: 500 });
    }
}

/**
 * DELETE /api/admin/blog/:id
 * Delete blog post.
 */
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const authError = await requireApiAdmin(request);
    if (authError) return authError;

    const { id } = await params;

    try {
        await prisma.blogPost.delete({ where: { id } });
        return NextResponse.json({ success: true, action: 'deleted' });
    } catch (error) {
        console.error('[Admin Blog] DELETE error:', error);
        return NextResponse.json({ success: false, error: 'Failed to delete post' }, { status: 500 });
    }
}
