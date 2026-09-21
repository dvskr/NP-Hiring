import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireApiAdmin } from '@/lib/auth/require-api-admin';
import { logAudit } from '@/lib/audit-log';
import {
    parseBlogStatus,
    parseBlogTitle,
    parseFaqJson,
    parseReviewedAt,
} from '@/app/api/admin/blog/validate';
import { resolveAdminActorId } from '@/app/api/admin/blog/admin-actor';

/**
 * GET /api/admin/blog
 * List all blog posts from DB.
 */
export async function GET(request: NextRequest) {
    const authError = await requireApiAdmin(request);
    if (authError) return authError;

    try {
        const posts = await prisma.blogPost.findMany({
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                title: true,
                slug: true,
                category: true,
                status: true,
                metaDescription: true,
                targetKeyword: true,
                imageUrl: true,
                publishDate: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        return NextResponse.json({ success: true, posts });
    } catch (error) {
        console.error('[Admin Blog] GET error:', error);
        return NextResponse.json({ success: false, error: 'Failed to fetch posts' }, { status: 500 });
    }
}

/**
 * POST /api/admin/blog
 * Create a new blog post via admin panel.
 */
export async function POST(request: NextRequest) {
    const authError = await requireApiAdmin(request);
    if (authError) return authError;

    try {
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
        }
        const { content, category, metaDescription, targetKeyword, imageUrl } = body;

        if (!body.title || !content || !category) {
            return NextResponse.json(
                { success: false, error: 'title, content, and category are required' },
                { status: 400 },
            );
        }
        const titleResult = parseBlogTitle(body.title);
        if (!titleResult.ok) {
            return NextResponse.json({ success: false, error: titleResult.error }, { status: 400 });
        }
        const title = titleResult.value;
        const statusResult = parseBlogStatus(body.status ?? 'draft');
        if (!statusResult.ok) {
            return NextResponse.json({ success: false, error: statusResult.error }, { status: 400 });
        }
        const status = statusResult.value;

        // Editorially-authored schema fields (FAQPage JSON-LD + dateModified).
        const faqResult = parseFaqJson(body.faqJson);
        if (!faqResult.ok) {
            return NextResponse.json({ success: false, error: faqResult.error }, { status: 400 });
        }
        const reviewedResult = parseReviewedAt(body.reviewedAt);
        if (!reviewedResult.ok) {
            return NextResponse.json({ success: false, error: reviewedResult.error }, { status: 400 });
        }

        // Fail closed: no unattributed content change.
        const actorId = await resolveAdminActorId();
        if (!actorId) {
            return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
        }

        // Generate slug
        const baseSlug = title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
            .slice(0, 80);
        const slug = `${baseSlug}-${Date.now().toString(36)}`;

        const post = await prisma.blogPost.create({
            data: {
                title,
                slug,
                content,
                category,
                status,
                metaDescription: metaDescription || null,
                targetKeyword: targetKeyword || null,
                imageUrl: imageUrl || null,
                publishDate: status === 'published' ? new Date() : null,
                reviewedAt: reviewedResult.value,
                // Prisma's nullable-Json input type is InputJsonValue |
                // DbNull | JsonNull — a typed FaqEntry[] doesn't satisfy
                // its index-signature constraint, so it needs the cast.
                // Without it `tsc --noEmit` (and therefore `next build`,
                // which type-checks) fails on this route.
                faqJson: faqResult.value === null
                    ? Prisma.DbNull
                    : (faqResult.value as unknown as Prisma.InputJsonValue),
            },
        });

        await logAudit({
            action: 'blog.post.create',
            actorType: 'admin',
            actorId,
            targetType: 'blog_post',
            targetId: post.id,
            metadata: { slug: post.slug, status: post.status, category: post.category },
        });

        return NextResponse.json({ success: true, post }, { status: 201 });
    } catch (error) {
        console.error('[Admin Blog] POST error:', error);
        return NextResponse.json({ success: false, error: 'Failed to create post' }, { status: 500 });
    }
}
