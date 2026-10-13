/**
 * /blog lists the authored posts before the license-guide series.
 *
 * Finding (SEO release 2026-10, research/site-audit.md item 1): the unfiltered
 * /blog grid sorted the 51 generated license guides in with the authored
 * posts, newest first. The guides share 2026-07-29 with eleven authored
 * posts and sorted ahead of them, so the core application guides (interview,
 * resume, cover letter, salary, negotiation, 1099, telehealth) landed on
 * ?page=5 and ?page=6, which answer "noindex, follow". The licensure band on
 * /blog already links every live guide, so the guides follow the authored
 * posts in the grid. The listing stays a permutation of the same posts, so
 * the index, the count, the sitemap and getPostBySlug still agree.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
    authoredPostsBeforeLicenseGuides,
    getAllPublishedSlugs,
    getPostCount,
    getPublishedPosts,
    type BlogPost,
} from '@/lib/blog';
import { getAllMdxPosts } from '@/lib/blog-mdx-posts';
import { LICENSE_GUIDE_SLUG_REGEX } from '@/config/niche/content-map';

const PER_PAGE = 12;
const isGuide = (slug: string) => LICENSE_GUIDE_SLUG_REGEX.test(slug);

async function allIndexSlugs(category?: string): Promise<string[]> {
    const total = await getPostCount(category);
    const pages = Math.max(1, Math.ceil(total / PER_PAGE));
    const slugs: string[] = [];
    for (let page = 1; page <= pages; page++) {
        slugs.push(...(await getPublishedPosts(page, PER_PAGE, category)).map((p) => p.slug));
    }
    return slugs;
}

/** Index of the first license guide; every slug before it is authored. */
function assertAuthoredFirst(slugs: readonly string[]): void {
    const firstGuide = slugs.findIndex(isGuide);
    expect(firstGuide, 'the listing carries license guides').toBeGreaterThan(-1);
    expect(slugs.slice(firstGuide).some((s) => !isGuide(s)), 'no authored post after the first guide').toBe(false);
}

beforeEach(() => {
    db.rows = [];
});

describe('unfiltered /blog lists authored posts before the license guides', () => {
    it('unsynced: every .mdx post comes before every guide, newest first among themselves', async () => {
        const slugs = await allIndexSlugs();
        assertAuthoredFirst(slugs);

        const time = (d: string | null) => (d ? Date.parse(d) : Number.NEGATIVE_INFINITY);
        const expectedAuthored = [...getAllMdxPosts()]
            .sort((a, b) => time(b.publish_date) - time(a.publish_date))
            .map((p) => p.slug);
        expect(slugs.filter((s) => !isGuide(s))).toEqual(expectedAuthored);
    });

    it('page 1 is the twelve newest authored posts', async () => {
        const page1 = (await getPublishedPosts(1, PER_PAGE)).map((p) => p.slug);
        const authored = (await allIndexSlugs()).filter((s) => !isGuide(s));
        expect(page1).toEqual(authored.slice(0, PER_PAGE));
        expect(page1.some(isGuide)).toBe(false);
    });

    it('the reorder keeps the index, the count and the sitemap in agreement', async () => {
        const slugs = await allIndexSlugs();
        expect(new Set(slugs).size).toBe(slugs.length);
        expect(slugs.length).toBe(await getPostCount());
        expect(new Set(slugs)).toEqual(new Set((await getAllPublishedSlugs()).map((r) => r.slug)));
    });

    it('DB rows follow the same rule: an older DB post precedes the guides, a synced guide row follows them', async () => {
        db.rows = [
            { slug: 'db-only-old-post', status: 'published', id: 'r1', title: 'Old DB post', category: 'career_opportunities',
              publish_date: '2020-01-01T00:00:00.000Z', updated_at: '2020-01-02' },
            { slug: 'np-license-ohio', status: 'published', id: 'r2', title: 'Ohio guide (DB)', category: 'state_spotlight',
              publish_date: '2030-01-01T00:00:00.000Z', updated_at: '2030-01-02' },
        ];
        const slugs = await allIndexSlugs();
        assertAuthoredFirst(slugs);
        expect(slugs.indexOf('db-only-old-post')).toBeLessThan(slugs.findIndex(isGuide));
        expect(slugs.filter((s) => s === 'np-license-ohio')).toHaveLength(1);
        expect(slugs.length).toBe(await getPostCount());
    });

    it('the state_spotlight filter lists its authored posts ahead of the guides too', async () => {
        db.rows = [
            { slug: 'state-spotlight-db-post', status: 'published', id: 'r1', title: 'Spotlight', category: 'state_spotlight',
              publish_date: '2020-01-01T00:00:00.000Z', updated_at: '2020-01-02' },
        ];
        const slugs = await allIndexSlugs('state_spotlight');
        expect(slugs[0]).toBe('state-spotlight-db-post');
        assertAuthoredFirst(slugs);
        expect(slugs.length).toBe(await getPostCount('state_spotlight'));
    });
});

describe('authoredPostsBeforeLicenseGuides', () => {
    it('is a stable partition that returns a new array and leaves its input untouched', () => {
        const rows = ['b-new', 'np-license-texas', 'a-old', 'np-license-alabama', 'c-older'].map(
            (slug) => ({ slug }) as BlogPost,
        );
        const before = rows.map((r) => r.slug);
        const out = authoredPostsBeforeLicenseGuides(rows);
        expect(out.map((r) => r.slug)).toEqual(['b-new', 'a-old', 'c-older', 'np-license-texas', 'np-license-alabama']);
        expect(out).not.toBe(rows);
        expect(rows.map((r) => r.slug)).toEqual(before);
    });
});
