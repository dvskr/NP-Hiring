/**
 * P1 #2 — how lib/blog.ts SERVES the license-guide series.
 *
 * The generator is a fallback for 'np-license-<state>' slugs with no DB
 * row, which is what makes the all-or-nothing gate safe. But a fallback
 * that ignores DB state entirely takes editorial control away:
 *
 *   - getPostBySlug() filters on status='published'. An unpublished row
 *     therefore misses, and the pre-fix code fell straight through to the
 *     generator — so "unpublish" was a silent no-op on all 51 license
 *     slugs. On a YMYL series, a page you cannot take down is the whole
 *     problem: the Massachusetts/New York misclassification was live copy
 *     asserting a collaborative-agreement requirement, and the only
 *     containment lever (unpublish) did nothing.
 *   - getAllPublishedSlugs() feeds the sitemap. If it keeps advertising a
 *     slug getPostBySlug() now 404s, the takedown trades one defect for
 *     another.
 *
 * These tests exercise the real functions against a fake supabase client,
 * so they fail if either rule is refactored away.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Row = { slug: string; status: string; [k: string]: unknown };

const db: { rows: Row[] } = { rows: [] };

/**
 * Minimal supabase-js query-builder stand-in: chainable filters, awaitable
 * for list queries, .single()/.maybeSingle() for row queries.
 */
function makeQuery() {
    const eqs: Array<[string, unknown]> = [];
    const neqs: Array<[string, unknown]> = [];
    let likeCol: string | null = null;
    let likePrefix = '';
    const ins: Array<[string, unknown[]]> = [];

    const matched = (): Row[] =>
        db.rows.filter(
            (r) =>
                eqs.every(([c, v]) => r[c] === v) &&
                neqs.every(([c, v]) => r[c] !== v) &&
                ins.every(([c, vs]) => vs.includes(r[c])) &&
                (likeCol === null || String(r[likeCol] ?? '').startsWith(likePrefix)),
        );

    const q: Record<string, unknown> = {
        select: () => q,
        order: () => q,
        range: () => q,
        limit: () => q,
        eq: (c: string, v: unknown) => { eqs.push([c, v]); return q; },
        neq: (c: string, v: unknown) => { neqs.push([c, v]); return q; },
        in: (c: string, vs: unknown[]) => { ins.push([c, vs]); return q; },
        like: (c: string, pattern: string) => {
            likeCol = c;
            likePrefix = pattern.replace(/%$/, '');
            return q;
        },
        single: async () => {
            const rows = matched();
            return rows.length === 1
                ? { data: rows[0], error: null }
                : { data: null, error: { message: 'no rows returned' } };
        },
        maybeSingle: async () => ({ data: matched()[0] ?? null, error: null }),
        // Awaiting the builder itself resolves the list form.
        then: (resolve: (v: unknown) => void) => resolve({ data: matched(), error: null }),
    };
    return q;
}

vi.mock('@supabase/supabase-js', () => ({
    createClient: () => ({ from: () => makeQuery() }),
}));

import { getPostBySlug, getAllPublishedSlugs } from '@/lib/blog';
import { getAllLicenseGuideSlugs, LICENSE_GUIDE_STATES } from '@/lib/blog-license-guides';
import { getAllMdxPosts } from '@/lib/blog-mdx-posts';
import { LICENSE_GUIDE_SERIES_PUBLISHED } from '@/config/niche/content-map';

const SLUG = 'np-license-new-mexico';

beforeEach(() => {
    db.rows = [];
});

describe('license-guide fallback vs editorial control', () => {
    it('serves the generated guide when the DB has no row', async () => {
        expect(LICENSE_GUIDE_SERIES_PUBLISHED).toBe(true);
        const post = await getPostBySlug(SLUG);
        expect(post).toBeTruthy();
        expect(post!.slug).toBe(SLUG);
        expect(post!.title).toContain('New Mexico');
    });

    it('respects an unpublished DB row instead of resurrecting the generated guide', async () => {
        db.rows = [{ slug: SLUG, status: 'draft', id: 'row-1', title: 'taken down' }];
        const post = await getPostBySlug(SLUG);
        expect(post, 'unpublish must actually unpublish a license guide').toBeNull();
    });

    it('a published DB row still overrides the generator (editorial edits win)', async () => {
        db.rows = [{
            slug: SLUG,
            status: 'published',
            id: 'row-1',
            title: 'Editorially rewritten New Mexico guide',
            content: 'db copy',
        }];
        const post = await getPostBySlug(SLUG);
        expect(post!.title).toBe('Editorially rewritten New Mexico guide');
    });

    // Authored content/blog/*.mdx guides (np-salary-guide among them) now
    // have their own code fallback, pinned by
    // tests/regressions/p10-blog-mdx-fallback.test.ts. A slug with neither a
    // license match nor an .mdx file still gets nothing.
    it('slugs with no license match and no .mdx file get no fallback', async () => {
        expect(await getPostBySlug('no-such-authored-post')).toBeNull();
    });
});

describe('slug listing (sitemap + listings)', () => {
    it('lists all 51 generated slugs (plus the .mdx guides) when the DB is empty', async () => {
        const slugs = (await getAllPublishedSlugs()).map((r) => r.slug);
        const license = slugs.filter((s) => s.startsWith('np-license-'));
        expect(license).toHaveLength(LICENSE_GUIDE_STATES.length);
        expect(new Set(license)).toEqual(new Set(getAllLicenseGuideSlugs()));
        expect(slugs).toHaveLength(LICENSE_GUIDE_STATES.length + getAllMdxPosts().length);
    });

    it('does not list a license guide that was unpublished', async () => {
        db.rows = [{ slug: SLUG, status: 'draft', id: 'row-1', updated_at: 'x' }];
        const slugs = (await getAllPublishedSlugs()).map((r) => r.slug);
        expect(slugs).not.toContain(SLUG);
        expect(slugs).toHaveLength(LICENSE_GUIDE_STATES.length - 1 + getAllMdxPosts().length);
    });

    it('does not double-list a guide that was synced into the DB', async () => {
        db.rows = [{ slug: SLUG, status: 'published', id: 'row-1', updated_at: '2026-07-29' }];
        const slugs = (await getAllPublishedSlugs()).map((r) => r.slug);
        expect(slugs.filter((s) => s === SLUG)).toHaveLength(1);
        expect(slugs).toHaveLength(LICENSE_GUIDE_STATES.length + getAllMdxPosts().length);
    });
});
