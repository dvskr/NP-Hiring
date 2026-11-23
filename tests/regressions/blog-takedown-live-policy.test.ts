/**
 * The editorial takedown under the live policy: an UNPUBLISHED blog_posts
 * row keeps a code-served post (a license guide or a content/blog .mdx post)
 * off the post page, the /blog index, the post count, the sitemap and
 * "Read Next".
 *
 * Production (2026-11-23): blog_posts_public_read lets the anon role read
 * published rows only, and the lookups that look for an unpublished row
 * (hasSuppressedRow, fetchDbSlugsIn, fetchLicenseGuideDbSlugs) read with the
 * anon client, so they never saw one and the takedown did nothing.
 * tests/regressions/blog-slugs-fallback.test.ts could not catch it: its fake
 * shows every row to every client. This fake applies the policy to the anon
 * key, shows every row to the service-role key, as Supabase does, and lets
 * each key fail on its own.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Row = { slug: string; status: string; [k: string]: unknown };
type ClientMode = 'rows' | 'error' | 'throw';
type Filter = [string, unknown];
type ServiceQuery = { columns: string; eqs: Filter[]; neqs: Filter[] };

const ANON_KEY = 'anon-key-for-the-takedown-test';
const SERVICE_KEY = 'service-key-for-the-takedown-test';

const db: { rows: Row[]; anon: ClientMode; service: ClientMode; serviceQueries: ServiceQuery[] } = {
    rows: [],
    anon: 'rows',
    service: 'rows',
    serviceQueries: [],
};

const PERMISSION_DENIED = { code: '42501', message: 'permission denied for table blog_posts', details: null, hint: null };

/** supabase-js query-builder stand-in that applies blog_posts_public_read to the anon key. */
function makeQuery(asService: boolean) {
    const mode = asService ? db.service : db.anon;
    const visible = asService ? db.rows : db.rows.filter((r) => r.status === 'published');
    const record: ServiceQuery = { columns: '', eqs: [], neqs: [] };
    if (asService) db.serviceQueries.push(record);
    const ins: Array<[string, unknown[]]> = [];
    let likePrefix: [string, string] | null = null;
    const matched = (): Row[] =>
        visible.filter(
            (r) =>
                record.eqs.every(([c, v]) => r[c] === v) &&
                record.neqs.every(([c, v]) => r[c] !== v) &&
                ins.every(([c, vs]) => vs.includes(r[c])) &&
                (likePrefix === null || String(r[likePrefix[0]] ?? '').startsWith(likePrefix[1])),
        );
    const failed = { data: null, count: null, error: PERMISSION_DENIED };
    const q: Record<string, unknown> = {
        select: (columns: string) => { record.columns = columns; return q; },
        order: () => q,
        range: () => q,
        limit: () => q,
        eq: (c: string, v: unknown) => { record.eqs.push([c, v]); return q; },
        neq: (c: string, v: unknown) => { record.neqs.push([c, v]); return q; },
        in: (c: string, vs: unknown[]) => { ins.push([c, vs]); return q; },
        like: (c: string, pattern: string) => { likePrefix = [c, pattern.replace(/%$/, '')]; return q; },
        maybeSingle: async () => (mode === 'error' ? failed : { data: matched()[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => void) => {
            if (mode === 'error') return resolve(failed);
            const rows = matched();
            return resolve({ data: rows, count: rows.length, error: null });
        },
    };
    return q;
}

vi.mock('@supabase/supabase-js', () => ({
    createClient: (_url: string, key: string) => {
        const asService = key === SERVICE_KEY;
        if (!asService && key !== ANON_KEY) throw new Error(`unexpected Supabase key in the takedown test`);
        if ((asService ? db.service : db.anon) === 'throw') throw new Error('supabaseKey is required.');
        return { from: () => makeQuery(asService) };
    },
}));

import {
    getAllPublishedSlugs,
    getPostBySlug,
    getPostCount,
    getPublishedPosts,
    getRelatedPosts,
} from '@/lib/blog';

const GUIDE = 'np-license-texas';
const MDX = 'np-ceu-requirements-by-state';
const POSTS_PER_PAGE = 12;
const EVERY_RELATED = 500;

async function indexSlugs(): Promise<string[]> {
    const pages = Math.max(1, Math.ceil((await getPostCount()) / POSTS_PER_PAGE));
    const slugs: string[] = [];
    for (let page = 1; page <= pages; page++) {
        slugs.push(...(await getPublishedPosts(page, POSTS_PER_PAGE)).map((p) => p.slug));
    }
    return slugs;
}

/** The sitemap, the post count and the /blog index list the same posts; returns the sitemap. */
async function listingsAgree(): Promise<string[]> {
    const sitemap = (await getAllPublishedSlugs()).map((r) => r.slug);
    expect(new Set(sitemap).size).toBe(sitemap.length);
    expect(await getPostCount()).toBe(sitemap.length);
    expect(new Set(await indexSlugs())).toEqual(new Set(sitemap));
    return sitemap;
}

async function readNextSlugs(): Promise<string[]> {
    return (await getRelatedPosts('career_opportunities', 'np-preceptor-guide', EVERY_RELATED)).map((p) => p.slug);
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    db.rows = [];
    db.anon = 'rows';
    db.service = 'rows';
    db.serviceQueries = [];
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://takedown-test.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', ANON_KEY);
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', SERVICE_KEY);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
    vi.unstubAllEnvs();
    errorSpy.mockRestore();
});

describe('an unpublished row takes a code-served post down everywhere', () => {
    it.each([GUIDE, MDX])('%s', async (slug) => {
        expect((await getPostBySlug(slug))?.slug, 'served before the takedown').toBe(slug);
        expect(await listingsAgree()).toContain(slug);
        expect(await readNextSlugs()).toContain(slug);

        db.rows = [{ slug, status: 'draft', id: 'row-1' }];

        expect((await getPostBySlug(slug))?.slug ?? null, 'served after the takedown').toBeNull();
        expect(await listingsAgree()).not.toContain(slug);
        expect(await readNextSlugs()).not.toContain(slug);
    });
});

describe('published rows stay on the public key', () => {
    const publishedRow: Row = {
        slug: MDX, status: 'published', id: 'row-1', title: 'DB copy', category: 'career_opportunities',
        publish_date: '2030-01-01T00:00:00.000Z', updated_at: '2030-01-02T00:00:00.000Z',
    };

    it('a published row the site can read is served and listed once, from the database', async () => {
        db.rows = [publishedRow];
        expect((await getPostBySlug(MDX))?.title).toBe('DB copy');
        expect((await listingsAgree()).filter((s) => s === MDX)).toHaveLength(1);
    });

    it('a published row the public key cannot read leaves the code copy served and listed (the September 2026 shape)', async () => {
        db.anon = 'error';
        db.rows = [publishedRow];
        const post = await getPostBySlug(MDX);
        expect(post?.slug).toBe(MDX);
        expect(post?.title).not.toBe('DB copy');
        expect(await listingsAgree()).toContain(MDX);
        expect(await readNextSlugs()).toContain(MDX);
    });
});

describe('the service-role client', () => {
    it('reads only the slug of unpublished rows, never a post', async () => {
        db.rows = [
            { slug: GUIDE, status: 'draft', id: 'row-1' },
            { slug: MDX, status: 'draft', id: 'row-2' },
            { slug: 'np-salary-guide', status: 'published', id: 'row-3', title: 'DB copy', category: 'salary_negotiation',
              publish_date: '2030-01-01T00:00:00.000Z', updated_at: '2030-01-02T00:00:00.000Z', content: 'body' },
        ];
        await Promise.all([
            getAllPublishedSlugs(),
            getPostCount(),
            getPublishedPosts(1, POSTS_PER_PAGE),
            readNextSlugs(),
            getPostBySlug(GUIDE),
            getPostBySlug(MDX),
            getPostBySlug('np-salary-guide'),
        ]);
        expect(db.serviceQueries.length).toBeGreaterThan(0);
        for (const query of db.serviceQueries) {
            expect(query.columns).toBe('slug');
            expect(query.neqs).toContainEqual(['status', 'published']);
        }
    });

    it.each(['throw', 'error'] as ClientMode[])('fails open when its read fails (%s): the post is served and every listing still agrees', async (mode) => {
        db.service = mode;
        db.rows = [{ slug: GUIDE, status: 'draft', id: 'row-1' }];
        expect((await getPostBySlug(GUIDE))?.slug).toBe(GUIDE);
        expect(await listingsAgree()).toContain(GUIDE);
        expect(errorSpy).toHaveBeenCalled();
    });
});
