import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireApiAdmin } from '@/lib/auth/require-api-admin';
import { logAudit } from '@/lib/audit-log';
import {
    isRecordNotFound,
    parseBlogStatus,
    parseBlogTitle,
    parseFaqJson,
    parseReviewedAt,
} from '@/app/api/admin/blog/validate';
import { resolveAdminActorId } from '@/app/api/admin/blog/admin-actor';

const notFound = () =>
    NextResponse.json({ success: false, error: 'Post not found' }, { status: 404 });
const badRequest = (error: string) =>
    NextResponse.json({ success: false, error }, { status: 400 });
const unauthenticated = () =>
    NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });

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
            return notFound();
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
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            return badRequest('Invalid JSON body');
        }
        const copiedFields = ['content', 'category', 'metaDescription', 'targetKeyword', 'imageUrl'];
        const data: Record<string, unknown> = {};

        for (const field of copiedFields) {
            if (field in body) {
                data[field] = body[field];
            }
        }

        // title and status are validated, never copied raw: an empty title or
        // an unknown status used to persist (the latter silently hides the
        // post from every `status: 'published'` read).
        if ('title' in body) {
            const titleResult = parseBlogTitle(body.title);
            if (!titleResult.ok) return badRequest(titleResult.error);
            data.title = titleResult.value;
        }
        if ('status' in body) {
            const statusResult = parseBlogStatus(body.status);
            if (!statusResult.ok) return badRequest(statusResult.error);
            data.status = statusResult.value;
        }

        // Editorially-authored schema fields — validated, never copied raw
        // (they feed FAQPage JSON-LD + BlogPosting.dateModified on the
        // public post page).
        if ('faqJson' in body) {
            const faqResult = parseFaqJson(body.faqJson);
            if (!faqResult.ok) {
                return badRequest(faqResult.error);
            }
            // Prisma nullable-Json semantics: DbNull clears the column.
            data.faqJson = faqResult.value === null ? Prisma.DbNull : faqResult.value;
        }
        if ('reviewedAt' in body) {
            const reviewedResult = parseReviewedAt(body.reviewedAt);
            if (!reviewedResult.ok) {
                return badRequest(reviewedResult.error);
            }
            data.reviewedAt = reviewedResult.value;
        }

        if (Object.keys(data).length === 0) {
            return badRequest('Nothing to update');
        }

        const existing = await prisma.blogPost.findUnique({
            where: { id },
            select: { status: true, publishDate: true },
        });
        if (!existing) {
            return notFound();
        }

        // Fail closed: no unattributed content change.
        const actorId = await resolveAdminActorId();
        if (!actorId) {
            return unauthenticated();
        }

        // Auto-set publishDate when publishing
        if (data.status === 'published' && !existing.publishDate) {
            data.publishDate = new Date();
        }

        const post = await prisma.blogPost.update({
            where: { id },
            data,
        });

        await logAudit({
            action: data.status && data.status !== existing.status
                ? (data.status === 'published' ? 'blog.post.publish' : 'blog.post.unpublish')
                : 'blog.post.update',
            actorType: 'admin',
            actorId,
            targetType: 'blog_post',
            targetId: post.id,
            metadata: {
                slug: post.slug,
                fields: Object.keys(data).filter((f) => f !== 'publishDate'),
                previousStatus: existing.status,
                status: post.status,
            },
        });

        return NextResponse.json({ success: true, post });
    } catch (error) {
        // Deleted between the lookup and the write.
        if (isRecordNotFound(error)) return notFound();
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
        // Fail closed: no unattributed content change.
        const actorId = await resolveAdminActorId();
        if (!actorId) {
            return unauthenticated();
        }

        const deleted = await prisma.blogPost.delete({
            where: { id },
            select: { id: true, slug: true, status: true },
        });

        await logAudit({
            action: 'blog.post.delete',
            actorType: 'admin',
            actorId,
            targetType: 'blog_post',
            targetId: deleted.id,
            metadata: { slug: deleted.slug, status: deleted.status },
        });

        return NextResponse.json({ success: true, action: 'deleted' });
    } catch (error) {
        if (isRecordNotFound(error)) return notFound();
        console.error('[Admin Blog] DELETE error:', error);
        return NextResponse.json({ success: false, error: 'Failed to delete post' }, { status: 500 });
    }
}
