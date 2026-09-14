/**
 * P10: authored content/blog/*.mdx guides resolve without a DB sync, and the
 * create-alert tap targets meet the 44px minimum.
 *
 * Defect 1: the certification guides (and every other .mdx post wired into
 * config/niche/content-map.ts) 404ed whenever blog_posts had not been synced,
 * while the license guides already rendered from code. The fix gives .mdx
 * posts the same fallback, and these tests pin that getPostBySlug, the blog
 * index listing + count, and the sitemap slug list all agree.
 *
 * Defect 2: the icon-only create-alert control in the nav bar was 42px tall
 * below the desktop breakpoint, and the modal's email input and submit were
 * 38px.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

type Row = { slug: string; status: string; [k: string]: unknown };
const db: { rows: Row[] } = { rows: [] };

function makeQuery() {
    const eqs: Array<[string, unknown]> = [];
    const neqs: Array<[string, unknown]> = [];
    const ins: Array<[string, unknown[]]> = [];
    let likePrefix: [string, string] | null = null;
    const matched = (): Row[] =>
        db.rows.filter(
            (r) =>
                eqs.every(([c, v]) => r[c] === v) &&
                neqs.every(([c, v]) => r[c] !== v) &&
                ins.every(([c, vs]) => vs.includes(r[c])) &&
                (likePrefix === null || String(r[likePrefix[0]] ?? '').startsWith(likePrefix[1])),
        );
    const q: Record<string, unknown> = {
        select: () => q,
        order: () => q,
        range: () => q,
        limit: () => q,
        eq: (c: string, v: unknown) => { eqs.push([c, v]); return q; },
        neq: (c: string, v: unknown) => { neqs.push([c, v]); return q; },
        in: (c: string, vs: unknown[]) => { ins.push([c, vs]); return q; },
        like: (c: string, pattern: string) => { likePrefix = [c, pattern.replace(/%$/, '')]; return q; },
        single: async () => {
            const rows = matched();
            return rows.length === 1
                ? { data: rows[0], error: null }
                : { data: null, error: { message: 'no rows returned' } };
        },
        maybeSingle: async () => ({ data: matched()[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => void) => {
            const rows = matched();
            resolve({ data: rows, count: rows.length, error: null });
        },
    };
    return q;
}

vi.mock('@supabase/supabase-js', () => ({
    createClient: () => ({ from: () => makeQuery() }),
}));

import {
    getPostBySlug,
    getAllPublishedSlugs,
    getPublishedPosts,
    getPostCount,
    mdxFallbackPosts,
    mergeListingWithFallbackPosts,
    type BlogPost,
} from '@/lib/blog';
import { getAllMdxPosts, getMdxPost, extractMdxFaq, parseMdxFrontmatter } from '@/lib/blog-mdx-posts';
import { HOMEPAGE_FEATURED_POSTS, RELATED_BLOG_SLUGS } from '@/config/niche/content-map';
import { BLOG_CATEGORIES } from '@/lib/blog-categories';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');
const MDX_FILES = fs.readdirSync(path.join(ROOT, 'content', 'blog')).filter((f) => f.endsWith('.mdx'));
const CERT_SLUG = 'pmhnp-certification-guide';

beforeEach(() => {
    db.rows = [];
});

describe('.mdx posts become BlogPost rows', () => {
    it('every .mdx file yields a post with a valid category, a date, and its frontmatter slug', () => {
        const posts = getAllMdxPosts();
        expect(posts).toHaveLength(MDX_FILES.length);
        const validCategories = new Set<string>(BLOG_CATEGORIES.map((c) => c.id));
        for (const post of posts) {
            expect(validCategories.has(post.category), post.slug).toBe(true);
            expect(post.publish_date, post.slug).toMatch(/^\d{4}-\d{2}-\d{2}T/);
            expect(post.content.startsWith('---'), `${post.slug} body must not carry frontmatter`).toBe(false);
            expect(post.status).toBe('published');
        }
    });

    it('the FAQ extractor matches the sync script on every .mdx body', async () => {
        vi.stubEnv('PROD_DATABASE_URL', 'postgres://unit-test.invalid/db');
        vi.doMock('dotenv/config', () => ({}));
        vi.doMock('@prisma/client', () => ({ Prisma: { DbNull: null }, PrismaClient: class {} }));
        vi.doMock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));
        vi.doMock('pg', () => ({ Pool: class {} }));
        const { extractFaqFromMarkdown } = await import('../../scripts/sync-blog-to-db');
        for (const file of MDX_FILES) {
            const { content } = parseMdxFrontmatter(read(`content/blog/${file}`));
            expect(extractMdxFaq(content.trim()), file).toEqual(extractFaqFromMarkdown(content));
        }
        vi.unstubAllEnvs();
    });

    it('a file without a date or a valid category is skipped, never given invented values', async () => {
        const { mdxFileToBlogPost } = await import('@/lib/blog-mdx-posts');
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        expect(mdxFileToBlogPost('x.mdx', '---\ntitle: X\ncategory: career_opportunities\n---\nbody')).toBeNull();
        expect(mdxFileToBlogPost('y.mdx', '---\ntitle: Y\ncategory: made_up\ndate: 2026-01-01\n---\nbody')).toBeNull();
        errorSpy.mockRestore();
    });
});

describe('getPostBySlug serves .mdx guides without a DB sync', () => {
    it('resolves the certification guides from code when blog_posts is empty', async () => {
        const pmhnp = await getPostBySlug(CERT_SLUG);
        expect(pmhnp?.title).toMatch(/Certification/);
        const fnp = await getPostBySlug('fnp-certification-aanp-vs-ancc');
        expect(fnp?.title).toMatch(/FNP|Certification/);
        expect(fnp?.faq_json?.length ?? 0).toBeGreaterThan(0);
    });

    it('every content-map slug resolves (sidebar + homepage links never 404 unsynced)', async () => {
        const slugs = new Set([
            ...Object.values(RELATED_BLOG_SLUGS).flat(),
            ...HOMEPAGE_FEATURED_POSTS.map((p) => p.href.replace('/blog/', '')),
        ]);
        for (const slug of slugs) {
            expect(await getPostBySlug(slug), slug).not.toBeNull();
        }
    });

    it('an unpublished DB row takes the guide down', async () => {
        db.rows = [{ slug: CERT_SLUG, status: 'draft', id: 'row-1' }];
        expect(await getPostBySlug(CERT_SLUG)).toBeNull();
    });

    it('a published DB row overrides the file', async () => {
        db.rows = [{ slug: CERT_SLUG, status: 'published', id: 'row-1', title: 'Edited in admin' }];
        expect((await getPostBySlug(CERT_SLUG))?.title).toBe('Edited in admin');
    });
});

describe('index, count and sitemap agree with getPostBySlug', () => {
    async function allIndexSlugs(category?: string): Promise<string[]> {
        const total = await getPostCount(category);
        const pages = Math.max(1, Math.ceil(total / 12));
        const slugs: string[] = [];
        for (let page = 1; page <= pages; page++) {
            slugs.push(...(await getPublishedPosts(page, 12, category)).map((p) => p.slug));
        }
        return slugs;
    }

    it('unsynced: the index lists every .mdx guide and license guide, and the count matches', async () => {
        const slugs = await allIndexSlugs();
        expect(slugs).toContain(CERT_SLUG);
        expect(slugs).toContain('np-license-texas');
        expect(new Set(slugs).size).toBe(slugs.length);
        expect(slugs.length).toBe(await getPostCount());
        const sitemap = (await getAllPublishedSlugs()).map((r) => r.slug);
        expect(new Set(slugs)).toEqual(new Set(sitemap));
        for (const slug of sitemap) {
            expect(await getPostBySlug(slug), slug).not.toBeNull();
        }
    });

    it('a category filter lists only matching .mdx guides and counts them', async () => {
        const expected = getAllMdxPosts().filter((p) => p.category === 'career_opportunities').map((p) => p.slug);
        const slugs = await allIndexSlugs('career_opportunities');
        expect(new Set(slugs)).toEqual(new Set(expected));
        expect(await getPostCount('career_opportunities')).toBe(expected.length);
    });

    it('an unpublished row removes the guide from the index, the count and the sitemap', async () => {
        const before = await getPostCount();
        db.rows = [{ slug: CERT_SLUG, status: 'draft', id: 'row-1', updated_at: 'x', category: 'career_opportunities' }];
        expect(await allIndexSlugs()).not.toContain(CERT_SLUG);
        expect(await getPostCount()).toBe(before - 1);
        expect((await getAllPublishedSlugs()).map((r) => r.slug)).not.toContain(CERT_SLUG);
    });

    it('a synced (published) row is listed once, from the DB', async () => {
        const before = await getPostCount();
        db.rows = [{
            slug: CERT_SLUG, status: 'published', id: 'row-1', title: 'DB copy',
            category: 'career_opportunities', publish_date: '2026-08-06T00:00:00.000Z', updated_at: '2026-08-07',
        }];
        const slugs = await allIndexSlugs();
        expect(slugs.filter((s) => s === CERT_SLUG)).toHaveLength(1);
        expect(await getPostCount()).toBe(before);
        expect((await getAllPublishedSlugs()).filter((r) => r.slug === CERT_SLUG)).toHaveLength(1);
    });

    it('mergeListingWithFallbackPosts sorts newest first, drops duplicates and blanks bodies', () => {
        const base = getMdxPost(CERT_SLUG)!;
        const dbRow = { ...base, id: 'db', publish_date: '2030-01-01T00:00:00.000Z' } as BlogPost;
        const older = { ...base, slug: 'older', publish_date: '2020-01-01T00:00:00.000Z' } as BlogPost;
        const merged = mergeListingWithFallbackPosts([dbRow], [older, base]);
        expect(merged.map((p) => p.slug)).toEqual([CERT_SLUG, 'older']);
        expect(merged[1].content).toBe('');
        expect(mdxFallbackPosts([CERT_SLUG]).map((p) => p.slug)).not.toContain(CERT_SLUG);
    });

    it('the /blog empty state does not claim nothing is published when posts exist on earlier pages', () => {
        const src = read('app/blog/page.tsx');
        expect(src).toMatch(/totalCount > 0 \? \(/);
        expect(src).toContain('This page is past the end of the list.');
    });
});

describe('create-alert tap targets are at least 44px', () => {
    it('the icon-only nav control gets a 44px floor below the desktop breakpoint', () => {
        const header = read('components/Header.tsx');
        const rule = header.match(/@media \(max-width: 1023px\) \{[\s\S]*?#nav-alert-slot \.jp-alert-btn \{([^}]*)\}/);
        expect(rule, 'nav-alert-slot icon-only rule').not.toBeNull();
        expect(rule![1]).toMatch(/min-height:\s*44px/);
        expect(rule![1]).toMatch(/min-width:\s*44px/);
    });

    it('the modal email input, frequency select and submit button have a 44px minimum height', () => {
        const form = read('components/CreateAlertForm.tsx');
        for (const anchor of ['id="email"', 'id="frequency"', 'type="submit"']) {
            const at = form.indexOf(anchor);
            expect(at, anchor).toBeGreaterThan(-1);
            expect(form.slice(at, at + 400), anchor).toContain('min-h-[44px]');
        }
    });
});
