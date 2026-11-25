/**
 * Admin-only preview of a blog post, published or not.
 *
 * The Preview control on /admin/blog used to point straight at /blog/<slug>,
 * and the public loader reads only published posts, so previewing a draft was
 * a guaranteed 404: the only way to see a post before publishing it was to
 * publish it. This page looks the post up by id, whatever its status, and
 * renders the body through the same pipeline the public post page uses.
 *
 * It deliberately leaves out the public page's table of contents, share rail,
 * JSON-LD and signup blocks. Those are page chrome; what an author needs
 * before publishing is the body as the reader will see it.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth/protect';
import { logger } from '@/lib/logger';
import { markdownToHtml, autoLinkStates, resanitizeBlogHtml } from '@/lib/blog';
import { autoLinkCategories } from '@/lib/autoLink';
import { blogCategoryLabel } from '@/lib/blog-categories';
import { loadEmptyLandingSlugs } from '@/lib/pseo/landing-verdicts';
import { unlinkClosedLandings } from '@/lib/pseo/live-landing-links';
import { formatCT } from '@/lib/format-ct';
import '@/app/editorial.css';

// A draft changes every time the author saves. Caching the preview would show
// them the version before the one they just wrote.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
    title: 'Blog preview | Admin',
    robots: { index: false, follow: false },
};

interface Props {
    params: Promise<{ id: string }>;
}

const PREVIEW_SELECT = {
    id: true,
    title: true,
    slug: true,
    content: true,
    category: true,
    status: true,
    updatedAt: true,
} as const;

type LoadResult =
    | { ok: true; post: { id: string; title: string; slug: string; content: string; category: string; status: string; updatedAt: Date } | null }
    | { ok: false };

async function loadPost(id: string): Promise<LoadResult> {
    try {
        const post = await prisma.blogPost.findUnique({ where: { id }, select: PREVIEW_SELECT });
        return { ok: true, post };
    } catch (err) {
        logger.error('[admin/blog/preview] could not load the post', err, { id });
        return { ok: false };
    }
}

/** The public post page's body pipeline (app/blog/[slug]/page.tsx), without its chrome. */
async function renderBody(markdown: string): Promise<string> {
    const emptyLandings = await loadEmptyLandingSlugs('admin-blog-preview');
    const linked = autoLinkCategories(autoLinkStates(markdownToHtml(markdown)));
    return resanitizeBlogHtml(unlinkClosedLandings(linked, emptyLandings));
}

type RenderResult = { ok: true; html: string } | { ok: false; error: string };

/**
 * A body that fails to render here fails on the public page too, so the
 * preview says so instead of answering with a bare error page.
 */
async function renderBodyForPreview(id: string, markdown: string): Promise<RenderResult> {
    try {
        return { ok: true, html: await renderBody(markdown) };
    } catch (err) {
        logger.error('[admin/blog/preview] the post body failed to render', err, { id });
        return { ok: false, error: err instanceof Error ? err.message : 'unknown error' };
    }
}

const banner: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
    padding: '12px 18px', borderRadius: 10, marginBottom: 28,
    fontSize: 13, fontWeight: 600,
};

function LoadFailed() {
    return (
        <div style={{ maxWidth: 820, margin: '0 auto', padding: '32px 16px' }}>
            <div role="alert" style={{ ...banner, backgroundColor: '#FEF2F2', color: '#991B1B' }}>
                <span>The post could not be loaded because the database read failed. Try again in a moment.</span>
                <Link href="/admin/blog" style={{ marginLeft: 'auto', color: 'inherit' }}>Back to Blog Management</Link>
            </div>
        </div>
    );
}

export default async function AdminBlogPreviewPage({ params }: Props) {
    // The admin layout already gates /admin. Checking again here keeps an
    // unpublished draft closed even when the page renders without the layout.
    await requireAdmin('/admin/blog');

    const { id } = await params;
    const loaded = await loadPost(id);
    if (!loaded.ok) return <LoadFailed />;
    const { post } = loaded;
    if (!post) notFound();

    const body = await renderBodyForPreview(post.id, post.content);
    const isPublished = post.status === 'published';

    return (
        <div style={{ maxWidth: 820, margin: '0 auto', padding: '32px 16px' }}>
            <div style={{
                ...banner,
                backgroundColor: isPublished ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.12)',
                color: isPublished ? '#15803D' : '#B45309',
            }}>
                <span>
                    {isPublished
                        ? 'This post is published. This preview is the admin copy.'
                        : 'Draft preview. This post is not on the public blog yet.'}
                </span>
                <Link href="/admin/blog" style={{ marginLeft: 'auto', color: 'inherit' }}>Back to Blog Management</Link>
                {isPublished && (
                    <Link href={`/blog/${post.slug}`} style={{ color: 'inherit' }}>Open the live page</Link>
                )}
            </div>

            {/* .ed-page carries the public blog's type and color tokens; the
                inline overrides drop its full-page offsets inside the admin. */}
            <div className="ed-page" style={{ marginTop: 0, paddingTop: 28, paddingBottom: 32, paddingLeft: 24, paddingRight: 24, minHeight: 'auto', borderRadius: 12 }}>
                <article>
                    <h1 style={{ fontSize: 34, fontWeight: 700, lineHeight: 1.2, marginBottom: 10 }}>{post.title}</h1>
                    <p style={{ fontSize: 13, margin: '0 0 24px', color: '#5A5E55' }}>
                        {blogCategoryLabel(post.category)} · slug /blog/{post.slug} · last edited {formatCT(post.updatedAt, 'datetime')}
                    </p>
                    {body.ok ? (
                        <div className="editorial-prose" dangerouslySetInnerHTML={{ __html: body.html }} />
                    ) : (
                        <p role="alert" style={{ color: '#991B1B', fontWeight: 600 }}>
                            The body could not be rendered, and the public page would fail the same way: {body.error}
                        </p>
                    )}
                </article>
            </div>
        </div>
    );
}
