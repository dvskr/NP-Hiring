/**
 * W0-BLOG: the blog loaders never depend on blog_posts being readable.
 *
 * Production diagnosis (2026-09-16, anon GET against the Supabase REST
 * endpoint): every read of blog_posts as the anon role fails with Postgres
 * 42501 "permission denied for table blog_posts" (HTTP 401). That is a
 * missing table-level GRANT SELECT, not an RLS policy (RLS answers with zero
 * rows, not an error). Before commit 1db01ab getAllPublishedSlugs() returned
 * [] on that error before appending the code-generated license slugs, so
 * the sitemap carried zero /blog URLs and every authored post 404ed
 * (thin-spec-4 B1, PLAN T0-9).
 *
 * These tests drive the real loaders against a fake supabase-js client in
 * three failure shapes: PostgREST answers with an error (the production
 * shape), PostgREST answers with zero rows (the RLS shape), and the client
 * itself throws (missing env, network layer). In every shape
 *   - getAllPublishedSlugs() lists the 51 license guides plus every .mdx post,
 *   - every HOMEPAGE_FEATURED_POSTS and RELATED_BLOG_SLUGS slug resolves,
 *   - no loader throws, and the index, count, sitemap and post page agree.
 *
 * The 7 posts that print hand-typed salary bands are served by the .mdx
 * fallback today (production returns 200 for them). Taking them down is the
 * W1-LICENSE frontmatter flag, not anything in lib/blog.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

type Row = { slug: string; status: string; [k: string]: unknown };
type Mode = 'error' | 'empty' | 'throw' | 'rows';

const fake: { mode: Mode; rows: Row[] } = { mode: 'error', rows: [] };

const PERMISSION_DENIED = {
    code: '42501',
    message: 'permission denied for table blog_posts',
    details: null,
    hint: 'Grant the required privileges to the current role with: GRANT SELECT ON public.blog_posts TO anon;',
};

/** Minimal supabase-js query-builder stand-in with a switchable failure shape. */
function makeQuery() {
    const eqs: Array<[string, unknown]> = [];
    const neqs: Array<[string, unknown]> = [];
    const ins: Array<[string, unknown[]]> = [];
    let likePrefix: [string, string] | null = null;
    const matched = (): Row[] =>
        fake.rows.filter(
            (r) =>
                eqs.every(([c, v]) => r[c] === v) &&
                neqs.every(([c, v]) => r[c] !== v) &&
                ins.every(([c, vs]) => vs.includes(r[c])) &&
                (likePrefix === null || String(r[likePrefix[0]] ?? '').startsWith(likePrefix[1])),
        );
    const failed = () => ({ data: null, count: null, error: PERMISSION_DENIED });
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
            if (fake.mode === 'error') return failed();
            const rows = matched();
            return rows.length === 1
                ? { data: rows[0], error: null }
                : { data: null, error: { code: 'PGRST116', message: 'no rows returned' } };
        },
        maybeSingle: async () => (fake.mode === 'error' ? failed() : { data: matched()[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => void) => {
            if (fake.mode === 'error') return resolve(failed());
            const rows = matched();
            return resolve({ data: rows, count: rows.length, error: null });
        },
    };
    return q;
}

vi.mock('@supabase/supabase-js', () => ({
    createClient: () => {
        if (fake.mode === 'throw') throw new Error('supabaseUrl is required.');
        return { from: () => makeQuery() };
    },
}));

import {
    getAllPublishedSlugs,
    getPostBySlug,
    getPublishedPosts,
    getPostCount,
    getRelatedPosts,
} from '@/lib/blog';
import { getAllLicenseGuideSlugs, LICENSE_GUIDE_STATES } from '@/lib/blog-license-guides';
import { getAllMdxPosts } from '@/lib/blog-mdx-posts';
import { HOMEPAGE_FEATURED_POSTS, RELATED_BLOG_SLUGS } from '@/config/niche/content-map';

const ROOT = process.cwd();
const POSTS_PER_PAGE = 12;
const LICENSE_GUIDE_COUNT = 51;
const MDX_FILE_COUNT = fs
    .readdirSync(path.join(ROOT, 'content', 'blog'))
    .filter((f) => f.endsWith('.mdx')).length;
const OUTAGE_MODES: Mode[] = ['error', 'empty', 'throw'];

const linkedSlugs = (): string[] => [
    ...new Set([
        ...HOMEPAGE_FEATURED_POSTS.map((p) => p.href.replace('/blog/', '')),
        ...Object.values(RELATED_BLOG_SLUGS).flat(),
    ]),
];

async function allIndexSlugs(): Promise<string[]> {
    const total = await getPostCount();
    const pages = Math.max(1, Math.ceil(total / POSTS_PER_PAGE));
    const slugs: string[] = [];
    for (let page = 1; page <= pages; page++) {
        slugs.push(...(await getPublishedPosts(page, POSTS_PER_PAGE)).map((p) => p.slug));
    }
    return slugs;
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    fake.mode = 'error';
    fake.rows = [];
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
    errorSpy.mockRestore();
});

describe.each(OUTAGE_MODES)('blog_posts unreadable (%s)', (mode) => {
    beforeEach(() => {
        fake.mode = mode;
    });

    it('getAllPublishedSlugs lists the 51 license guides plus every .mdx post, once each', async () => {
        const rows = await getAllPublishedSlugs();
        const slugs = rows.map((r) => r.slug);

        expect(LICENSE_GUIDE_STATES).toHaveLength(LICENSE_GUIDE_COUNT);
        expect(getAllMdxPosts()).toHaveLength(MDX_FILE_COUNT);
        expect(new Set(slugs).size).toBe(slugs.length);
        expect(slugs).toHaveLength(LICENSE_GUIDE_COUNT + MDX_FILE_COUNT);
        expect(new Set(slugs)).toEqual(
            new Set([...getAllLicenseGuideSlugs(), ...getAllMdxPosts().map((p) => p.slug)]),
        );
        for (const row of rows) {
            expect(Number.isFinite(Date.parse(row.updated_at)), `${row.slug} updated_at`).toBe(true);
        }
    });

    it('every homepage and job-sidebar blog link resolves through the code fallback', async () => {
        const slugs = linkedSlugs();
        expect(slugs.length).toBeGreaterThan(0);
        for (const slug of slugs) {
            const post = await getPostBySlug(slug);
            expect(post?.slug, slug).toBe(slug);
        }
    });

    it('no loader throws, and the index, count, sitemap and post page agree', async () => {
        const [count, sitemap, guide, related] = await Promise.all([
            getPostCount(),
            getAllPublishedSlugs(),
            getPostBySlug('np-license-texas'),
            getRelatedPosts('career_opportunities', 'np-preceptor-guide'),
        ]);

        expect(count).toBe(sitemap.length);
        expect(new Set(await allIndexSlugs())).toEqual(new Set(sitemap.map((r) => r.slug)));
        expect(guide?.title).toContain('Texas');
        expect(related).toHaveLength(3);
        for (const { slug } of sitemap) {
            expect(await getPostBySlug(slug), slug).not.toBeNull();
        }
    });

    it('a slug with no license match and no .mdx file still gets nothing', async () => {
        expect(await getPostBySlug('no-such-authored-post')).toBeNull();
    });
});

describe('failures are logged, never swallowed silently', () => {
    it.each(['error', 'throw'] as Mode[])('%s: console.error carries the failure', async (mode) => {
        fake.mode = mode;
        await getAllPublishedSlugs();
        expect(errorSpy).toHaveBeenCalled();
        const detail = errorSpy.mock.calls[0]?.[1];
        expect(mode === 'error' ? detail : (detail as Error).message).toEqual(
            mode === 'error' ? PERMISSION_DENIED : 'supabaseUrl is required.',
        );
    });
});

describe('getRelatedPosts falls back to code-served posts', () => {
    it('fills "Read Next" from the same category first, never with the current post', async () => {
        const related = await getRelatedPosts('career_opportunities', 'np-preceptor-guide');
        expect(related).toHaveLength(3);
        expect(related.map((p) => p.slug)).not.toContain('np-preceptor-guide');
        expect(related.every((p) => p.category === 'career_opportunities')).toBe(true);
        expect(new Set(related.map((p) => p.slug)).size).toBe(3);
    });

    it('tops up a thin category from any category', async () => {
        const sameCategory = getAllMdxPosts().filter((p) => p.category === 'salary_negotiation');
        expect(sameCategory.length).toBeLessThan(4);
        const related = await getRelatedPosts('salary_negotiation', 'np-salary-guide');
        expect(related).toHaveLength(3);
        expect(related.slice(0, sameCategory.length - 1).every((p) => p.category === 'salary_negotiation')).toBe(true);
        expect(related[2].category).not.toBe('salary_negotiation');
    });

    it('license guides rotate through the series instead of all pointing at the same three states', async () => {
        const texas = (await getRelatedPosts('state_spotlight', 'np-license-texas')).map((p) => p.slug);
        const wyoming = (await getRelatedPosts('state_spotlight', 'np-license-wyoming')).map((p) => p.slug);
        expect(texas).toEqual(['np-license-utah', 'np-license-vermont', 'np-license-virginia']);
        expect(wyoming).toEqual(['np-license-alabama', 'np-license-alaska', 'np-license-arizona']);
    });

    it('a published DB row wins over the file and is listed once', async () => {
        fake.mode = 'rows';
        fake.rows = [{
            slug: 'np-ceu-requirements-by-state', status: 'published', id: 'row-1', title: 'DB copy',
            category: 'career_opportunities', publish_date: '2030-01-01T00:00:00.000Z',
        }];
        const related = await getRelatedPosts('career_opportunities', 'np-preceptor-guide');
        expect(related[0].title).toBe('DB copy');
        expect(related.filter((p) => p.slug === 'np-ceu-requirements-by-state')).toHaveLength(1);
        expect(related).toHaveLength(3);
    });

    it('an unpublished DB row keeps the file out of "Read Next"', async () => {
        fake.mode = 'rows';
        fake.rows = [{ slug: 'np-ceu-requirements-by-state', status: 'draft', id: 'row-1' }];
        const related = await getRelatedPosts('career_opportunities', 'np-preceptor-guide');
        expect(related).toHaveLength(3);
        expect(related.map((p) => p.slug)).not.toContain('np-ceu-requirements-by-state');
    });
});

describe('blog_posts readable: DB rows merge with the code-served posts', () => {
    const SYNCED_AT = '2030-01-02T00:00:00.000Z';

    beforeEach(() => {
        fake.mode = 'rows';
        fake.rows = [
            { slug: 'np-salary-guide', status: 'published', id: 'row-1', title: 'DB copy', category: 'salary_negotiation',
              publish_date: '2030-01-01T00:00:00.000Z', updated_at: SYNCED_AT },
            { slug: 'np-license-texas', status: 'draft', id: 'row-2', updated_at: SYNCED_AT },
            { slug: 'db-only-post', status: 'published', id: 'row-3', title: 'Only in the DB', category: 'career_opportunities',
              publish_date: '2030-01-01T00:00:00.000Z', updated_at: SYNCED_AT },
        ];
    });

    it('lists a synced slug once with the DB timestamp, keeps a DB-only post, drops an unpublished guide', async () => {
        const rows = await getAllPublishedSlugs();
        const slugs = rows.map((r) => r.slug);

        expect(slugs.filter((s) => s === 'np-salary-guide')).toHaveLength(1);
        expect(rows.find((r) => r.slug === 'np-salary-guide')?.updated_at).toBe(SYNCED_AT);
        expect(slugs).toContain('db-only-post');
        expect(slugs).not.toContain('np-license-texas');
        expect(slugs).toHaveLength(LICENSE_GUIDE_COUNT - 1 + MDX_FILE_COUNT + 1);
    });

    it('the post page, the count and the sitemap agree', async () => {
        const [sitemap, count, synced, suppressed] = await Promise.all([
            getAllPublishedSlugs(),
            getPostCount(),
            getPostBySlug('np-salary-guide'),
            getPostBySlug('np-license-texas'),
        ]);
        expect(count).toBe(sitemap.length);
        expect(synced?.title).toBe('DB copy');
        expect(suppressed).toBeNull();
        expect(new Set(await allIndexSlugs())).toEqual(new Set(sitemap.map((r) => r.slug)));
    });
});

describe('source pins', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'blog.ts'), 'utf-8');
    const querySection = src.slice(src.indexOf('Query Functions'), src.indexOf('Write Functions'));

    it('getAllPublishedSlugs has no early return and appends both code-served series', () => {
        const start = src.indexOf('export async function getAllPublishedSlugs');
        expect(start).toBeGreaterThan(-1);
        // The function ends at the first unindented closing brace (CRLF-safe).
        const length = src.slice(start).search(/\r?\n\}\r?\n/);
        expect(length).toBeGreaterThan(0);
        const body = src.slice(start, start + length);
        expect(body).not.toMatch(/return \[\]/);
        expect(body).toContain('getAllLicenseGuideSlugs()');
        expect(body).toContain('mdxFallbackPosts(');
    });

    it('every blog_posts read builds its client inside the never-throw helper', () => {
        expect(querySection.match(/getSupabaseClient\(\)/g)).toHaveLength(1);
        expect(querySection.indexOf('getSupabaseClient()')).toBeGreaterThan(querySection.indexOf('async function readBlogPosts'));
        expect(querySection).not.toMatch(/\.single\(\)/);
    });
});
