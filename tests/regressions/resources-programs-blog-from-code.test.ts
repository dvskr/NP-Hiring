/**
 * Backlog 2.2: /resources and /for-programs read blog posts through
 * lib/blog.ts, the reads /blog renders from, never blog_posts directly.
 *
 * Production blog_posts holds 0 rows. /blog, the post pages, related posts
 * and the sitemap already served the content/blog .mdx posts and the 51
 * license guides from code, but these two pages queried the table through
 * Prisma and rendered nothing from it: no "Articles" count, no article
 * grid, no "Before you apply" band, no state guides, and no program guide
 * card on /for-programs.
 *
 * Those bands had never rendered in production, so two defects in them went
 * live with the change and are pinned here too: card teasers were cut at a
 * fixed length, inside a word, and the two guides in the "Before you apply"
 * band were repeated as cards in the Career group a few bands down.
 *
 * The database is faked at both doors. Prisma's blogPost delegate answers no
 * rows (and must not be asked at all now), and the Supabase client lib/blog.ts
 * reads through serves an in-memory blog_posts table that is empty unless a
 * test seeds rows. Nothing here reaches a real database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

type Row = { slug: string; status: string; [k: string]: unknown };
const db: { rows: Row[] } = { rows: [] };

/** PostgREST builder over db.rows, the shape tests/regressions/p10-blog-mdx-fallback.test.ts fakes. */
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

vi.mock('@/lib/prisma', () => ({
    prisma: { blogPost: { findMany: vi.fn(), findFirst: vi.fn() } },
}));

vi.mock('@/lib/salary-analytics', () => ({ getGatedStateBenchmarks: vi.fn(async () => []) }));
vi.mock('@/lib/site-stats', () => ({ getSiteStatsOrNull: vi.fn(async () => null) }));
vi.mock('@/lib/states-covered', () => ({ getStatesCovered: vi.fn(async () => null) }));

import { prisma } from '@/lib/prisma';
import ResourcesPage from '@/app/resources/page';
import ForProgramsPage from '@/app/for-programs/page';
import LicensureChecker from '@/components/LicensureChecker';
import { getPostCount } from '@/lib/blog';
import { getAllMdxPosts, getMdxPost } from '@/lib/blog-mdx-posts';
import { LICENSE_GUIDE_PUBLISH_DATE, LICENSE_GUIDE_STATES } from '@/lib/blog-license-guides';
import { STATE_PRACTICE_AUTHORITY } from '@/lib/state-practice-authority';

type Mock = ReturnType<typeof vi.fn>;
const m = (fn: unknown) => fn as Mock;

/** The first render imports the full page trees (lucide, next/image, the checker). */
const RENDER_TIMEOUT_MS = 60_000;

const PROGRAM_GUIDE_SLUG = 'how-to-evaluate-np-programs';
const PRECEPTOR_SLUG = 'np-preceptor-guide';

/** The two guides the "Before you apply" band shows, in band order. */
const WEDGE_SLUGS: readonly string[] = [PROGRAM_GUIDE_SLUG, PRECEPTOR_SLUG];

/** Cards per category group in the article grid. */
const CARDS_PER_GROUP = 6;

/** Teaser budgets on the band's cards and the article cards, ellipsis included. */
const WEDGE_TEASER_MAX = 140;
const ARTICLE_TEASER_MAX = 120;
const ELLIPSIS = '…';

/** Everything /blog lists while blog_posts is empty: the .mdx posts plus the license series. */
const CODE_SERVED_TOTAL = getAllMdxPosts().length + LICENSE_GUIDE_STATES.length;

/** Text as renderToStaticMarkup escapes it. */
const escapeHtml = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

/** Rendered text back to the string the page gave React. */
const unescapeHtml = (s: string): string =>
    s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');

/** The slugs of every /blog/<slug> link in a slice of markup, in document order. */
const blogHrefs = (html: string): string[] => [...html.matchAll(/href="\/blog\/([^"?#]+)"/g)].map((match) => match[1]);

/** Slugs that appear more than once in a list of links. */
const repeated = (slugs: readonly string[]): string[] => [...new Set(slugs.filter((slug, i) => slugs.indexOf(slug) !== i))];

/** Each /blog card in a slice of markup: the post it links and the teaser it prints (null when it prints none). */
function blogCards(html: string): Array<{ slug: string; teaser: string | null }> {
    return [...html.matchAll(/<a[^>]*href="\/blog\/([^"?#]+)"[^>]*>([\s\S]*?)<\/a>/g)].map((card) => {
        const teaser = card[2].match(/<p class="stk-desc">([^<]*)<\/p>/)?.[1];
        return { slug: card[1], teaser: teaser === undefined ? null : unescapeHtml(teaser) };
    });
}

/** Markup from the first `from` up to the next `to` (or the end). */
function band(html: string, from: string, to: string): string {
    const start = html.indexOf(from);
    if (start === -1) return '';
    const end = html.indexOf(to, start);
    return html.slice(start, end === -1 ? undefined : end);
}

/** The value printed on a hero stat sticker, or null when the sticker is absent. */
function heroStat(html: string, label: string): string | null {
    const match = html.match(new RegExp(`<span class="stk-stat-value[^"]*">([^<]+)</span><span class="stk-stat-label">${label}</span>`));
    return match ? match[1] : null;
}

/** First element of `type` in a server-rendered tree (walks props.children only). */
function findElement<P>(node: ReactNode, type: unknown): ReactElement<P> | null {
    if (Array.isArray(node)) {
        for (const child of node) {
            const found = findElement<P>(child, type);
            if (found) return found;
        }
        return null;
    }
    if (!isValidElement(node)) return null;
    if (node.type === type) return node as ReactElement<P>;
    return findElement<P>((node.props as { children?: ReactNode }).children, type);
}

const resourcesHtml = async (): Promise<string> => renderToStaticMarkup(await ResourcesPage());
const programsHtml = async (): Promise<string> => renderToStaticMarkup(await ForProgramsPage());

const wedgeBand = (html: string) => band(html, 'Before you apply', 'stk-stage-mint');
const stateBand = (html: string) => band(html, 'Browse All Licensure Guides', 'Career Guides &amp; Insights');
const articleBand = (html: string) => band(html, 'Career Guides &amp; Insights', 'Tools &amp; Downloads');

beforeEach(() => {
    db.rows = [];
    // The direct table read these pages used to make: answering it with no
    // rows reproduces production, and nothing should ask it any more.
    m(prisma.blogPost.findMany).mockResolvedValue([]);
    m(prisma.blogPost.findFirst).mockResolvedValue(null);
});

describe('/resources with an empty blog_posts table lists what /blog lists', () => {
    it('prints the /blog article count without the guides, and never reads the table through Prisma', async () => {
        const html = await resourcesHtml();
        // /blog's total counts the 51 guides, which the State Guides sticker
        // beside "Articles" already counts: printing it here counted them twice.
        expect(await getPostCount()).toBe(CODE_SERVED_TOTAL);
        expect(heroStat(html, 'Articles')).toBe(String(CODE_SERVED_TOTAL - LICENSE_GUIDE_STATES.length));
        expect(heroStat(html, 'Articles')).toBe(String((await getPostCount()) - (await getPostCount('state_spotlight'))));
        expect(heroStat(html, 'State Guides')).toBe(String(LICENSE_GUIDE_STATES.length));
        expect(prisma.blogPost.findMany).not.toHaveBeenCalled();
        expect(prisma.blogPost.findFirst).not.toHaveBeenCalled();
    }, RENDER_TIMEOUT_MS);

    it('renders the "Before you apply" band with both education guides', async () => {
        const wedge = wedgeBand(await resourcesHtml());
        expect(wedge, 'the band did not render').not.toBe('');
        expect(blogHrefs(wedge)).toEqual([PROGRAM_GUIDE_SLUG, PRECEPTOR_SLUG]);
        for (const slug of [PROGRAM_GUIDE_SLUG, PRECEPTOR_SLUG]) {
            expect(wedge).toContain(escapeHtml(getMdxPost(slug)!.title));
        }
    }, RENDER_TIMEOUT_MS);

    it('groups the authored posts by category, newest first, six cards per group', async () => {
        const html = await resourcesHtml();
        // Newest first with the merge's stable tie order (file name order,
        // the order getAllMdxPosts returns), grouped in order of first
        // appearance. A group counts every post filed under it; its cards
        // are the six newest that the "Before you apply" band above has not
        // already shown.
        const time = (date: string | null) => (date ? Date.parse(date) : Number.NEGATIVE_INFINITY);
        const ordered = [...getAllMdxPosts()].sort((a, b) => time(b.publish_date) - time(a.publish_date));
        const groups = new Map<string, string[]>();
        for (const post of ordered) groups.set(post.category, [...(groups.get(post.category) ?? []), post.slug]);
        const expected = [...groups.values()].flatMap((slugs) =>
            slugs.filter((slug) => !WEDGE_SLUGS.includes(slug)).slice(0, CARDS_PER_GROUP),
        );

        const articles = articleBand(html);
        expect(articles, 'the article grid did not render').not.toBe('');
        expect(blogHrefs(articles)).toEqual(expected);
        const groupCounts = [...articles.matchAll(/<span class="stk-cat-count">(\d+)<\/span>/g)].map((count) => Number(count[1]));
        expect(groupCounts).toEqual([...groups.values()].map((slugs) => slugs.length));
        // The eyebrow names where the posts live; the byline names no expert.
        expect(html).toContain('From the Blog');
        expect(html).not.toContain('Expert Articles');
    }, RENDER_TIMEOUT_MS);

    it('links each post once: the two guides in the band are not repeated as article cards', async () => {
        const html = await resourcesHtml();
        // Both guides are filed under Career. Repeating them in that group
        // spent two of its six cards on posts the band already shows.
        const career = getAllMdxPosts().filter((post) => post.category === 'career_opportunities').map((post) => post.slug);
        for (const slug of WEDGE_SLUGS) {
            expect(career, `${slug} is no longer filed under Career`).toContain(slug);
        }
        expect(career.length, 'needs more Career posts than cards plus the band').toBeGreaterThanOrEqual(CARDS_PER_GROUP + WEDGE_SLUGS.length);

        expect(blogHrefs(wedgeBand(html))).toEqual(WEDGE_SLUGS);
        const articleSlugs = blogHrefs(articleBand(html));
        for (const slug of WEDGE_SLUGS) {
            expect(articleSlugs, `${slug} is in the band and in the grid`).not.toContain(slug);
        }
        // The two freed cards go to the next Career posts in line.
        expect(articleSlugs.filter((slug) => career.includes(slug))).toHaveLength(CARDS_PER_GROUP);
        expect(repeated(blogHrefs(html)), 'a post is linked twice on /resources').toEqual([]);
    }, RENDER_TIMEOUT_MS);

    it('the bands this change makes visible keep the house style', async () => {
        const html = await resourcesHtml();
        // These bands never rendered in production before (the table was
        // empty), so their copy and the post titles in them go live here.
        for (const slice of [wedgeBand(html), stateBand(html), articleBand(html)]) {
            const text = slice.replace(/<[^>]+>/g, ' ');
            expect(text.trim().length).toBeGreaterThan(0);
            expect(text, 'em dash, en dash or spaced hyphen in visible copy').not.toMatch(/[—–]| - /);
        }
    }, RENDER_TIMEOUT_MS);

    it('cuts every card teaser at the end of a word of the post description', async () => {
        const html = await resourcesHtml();
        // A fixed-length slice ended most of these cards inside a word
        // ("certificatio…", "before yo…") or on a dangling comma or space.
        for (const [name, slice, max] of [
            ['wedge', wedgeBand(html), WEDGE_TEASER_MAX],
            ['article', articleBand(html), ARTICLE_TEASER_MAX],
        ] as const) {
            const cards = blogCards(slice);
            expect(cards.length, `the ${name} band has no cards`).toBeGreaterThan(0);
            let clipped = 0;
            for (const { slug, teaser } of cards) {
                const description = getMdxPost(slug)!.meta_description!.trim();
                expect(teaser, `${slug} prints no teaser`).not.toBeNull();
                if (!teaser!.endsWith(ELLIPSIS)) {
                    expect(teaser, `${slug}: a description that fits prints whole`).toBe(description);
                    continue;
                }
                clipped += 1;
                const kept = teaser!.slice(0, -ELLIPSIS.length);
                expect(description.startsWith(kept), `${slug}: "${teaser}" is not the start of its description`).toBe(true);
                // The description goes on with a space or a separator, so the cut is not inside a word…
                expect(description.charAt(kept.length), `${slug}: "${teaser}" ends inside a word`).toMatch(/[\s,;:(]/);
                // …and the teaser ends on the word itself, not on that separator.
                expect(kept, `${slug}: "${teaser}" ends on a dangling separator`).not.toMatch(/[\s,;:(]$/);
                expect(teaser!.length, `${slug}: teaser over its budget`).toBeLessThanOrEqual(max);
            }
            expect(clipped, `no ${name} teaser was long enough to cut, so nothing was checked`).toBeGreaterThan(0);
        }
    }, RENDER_TIMEOUT_MS);

    it('"View all" opens /blog filtered to that category', async () => {
        const articles = articleBand(await resourcesHtml());
        const career = getAllMdxPosts().filter((post) => post.category === 'career_opportunities');
        expect(career.length, 'needs a category with more than six posts').toBeGreaterThan(6);
        expect(articles).toContain('href="/blog?category=career_opportunities"');
        expect(articles).not.toContain('href="/blog"');
    }, RENDER_TIMEOUT_MS);

    it('lists all 51 license guides once and hands them to the checker by registry name', async () => {
        const html = await resourcesHtml();
        const guideSlugs = LICENSE_GUIDE_STATES.map((s) => s.slug);
        expect(heroStat(html, 'State Guides')).toBe(String(guideSlugs.length));

        const states = blogHrefs(stateBand(html));
        expect(new Set(states)).toEqual(new Set(guideSlugs));
        expect(states).toHaveLength(guideSlugs.length);
        // Title casing the slug printed "District Of Columbia".
        expect(html).toContain('District of Columbia');
        expect(html).not.toContain('District Of Columbia');

        const checker = findElement<{ stateGuides: Array<{ name: string; slug: string }> }>(
            await ResourcesPage(),
            LicensureChecker,
        );
        expect(checker, 'LicensureChecker not found in the page tree').not.toBeNull();
        const guides = checker!.props.stateGuides;
        expect(guides).toHaveLength(guideSlugs.length);
        // The checker finds a guide by exact state name, so every name must be one it can select.
        for (const guide of guides) {
            expect(Object.keys(STATE_PRACTICE_AUTHORITY), guide.name).toContain(guide.name);
        }
        expect(guides).toContainEqual({ name: 'District of Columbia', slug: 'np-license-district-of-columbia' });
    }, RENDER_TIMEOUT_MS);
});

describe('/resources with blog_posts rows: the merge lists each slug once', () => {
    it('a synced row is listed once, from the DB, and only rows without a file add to the count', async () => {
        db.rows = [
            {
                id: 'row-program', slug: PROGRAM_GUIDE_SLUG, status: 'published', category: 'career_opportunities',
                title: 'Program guide, as edited in admin', meta_description: 'Edited in admin.',
                publish_date: '2026-09-30T00:00:00.000Z', created_at: '2026-09-30T00:00:00.000Z', reviewed_at: null,
            },
            {
                // A mirror synced before the series review: listed once, under the reviewed copy.
                id: 'row-texas', slug: 'np-license-texas', status: 'published', category: 'state_spotlight',
                title: 'Texas mirror', meta_description: 'Old copy.',
                publish_date: LICENSE_GUIDE_PUBLISH_DATE, created_at: LICENSE_GUIDE_PUBLISH_DATE,
                reviewed_at: '2026-01-01T00:00:00.000Z',
            },
            {
                id: 'row-db-only', slug: 'written-in-admin', status: 'published', category: 'salary_negotiation',
                title: 'Written in admin', meta_description: 'A post with no file behind it.',
                publish_date: '2026-09-29T00:00:00.000Z', created_at: '2026-09-29T00:00:00.000Z', reviewed_at: null,
            },
        ];
        const html = await resourcesHtml();

        // The Texas row replaces its code-served guide (a State Guide, not
        // an Article); only the admin-written post adds an Article.
        expect(heroStat(html, 'Articles')).toBe(String(CODE_SERVED_TOTAL - LICENSE_GUIDE_STATES.length + 1));
        expect(heroStat(html, 'Articles')).toBe(String((await getPostCount()) - (await getPostCount('state_spotlight'))));

        for (const [name, slice] of [['wedge', wedgeBand(html)], ['state', stateBand(html)], ['article', articleBand(html)]] as const) {
            const hrefs = blogHrefs(slice);
            expect(hrefs.length, `${name} band is empty`).toBeGreaterThan(0);
            expect(repeated(hrefs), `${name} band lists a slug twice`).toEqual([]);
        }
        // The published row is the editorial version of the file.
        expect(wedgeBand(html)).toContain('Program guide, as edited in admin');
        expect(wedgeBand(html)).not.toContain(escapeHtml(getMdxPost(PROGRAM_GUIDE_SLUG)!.title));
        expect(blogHrefs(stateBand(html)).filter((slug) => slug === 'np-license-texas')).toHaveLength(1);
        expect(blogHrefs(articleBand(html))).toContain('written-in-admin');
        // The synced guide is linked once on the whole page: from the band,
        // which the article grid does not repeat.
        expect(blogHrefs(html).filter((slug) => slug === PROGRAM_GUIDE_SLUG)).toHaveLength(1);
        expect(repeated(blogHrefs(html)), 'a post is linked twice on /resources').toEqual([]);
    }, RENDER_TIMEOUT_MS);

    it('a guide taken down in blog_posts leaves the band, the grid and the count, as on /blog', async () => {
        db.rows = [{ id: 'row-preceptor', slug: PRECEPTOR_SLUG, status: 'draft', category: 'career_opportunities' }];
        const html = await resourcesHtml();
        expect(blogHrefs(wedgeBand(html))).toEqual([PROGRAM_GUIDE_SLUG]);
        expect(blogHrefs(html)).not.toContain(PRECEPTOR_SLUG);
        expect(heroStat(html, 'Articles')).toBe(String(CODE_SERVED_TOTAL - LICENSE_GUIDE_STATES.length - 1));
    }, RENDER_TIMEOUT_MS);
});

describe('/for-programs program guide card', () => {
    it('renders from content/blog when blog_posts has no row, without a Prisma read', async () => {
        const html = await programsHtml();
        expect(html).toContain('Share with your students');
        expect(blogHrefs(html)).toEqual([PROGRAM_GUIDE_SLUG]);
        expect(html).toContain(escapeHtml(getMdxPost(PROGRAM_GUIDE_SLUG)!.title));
        expect(prisma.blogPost.findFirst).not.toHaveBeenCalled();
        expect(prisma.blogPost.findMany).not.toHaveBeenCalled();
    }, RENDER_TIMEOUT_MS);

    it('a published row wins over the file, and the card renders once', async () => {
        db.rows = [{ id: 'row-program', slug: PROGRAM_GUIDE_SLUG, status: 'published', title: 'Program guide, as edited in admin' }];
        const html = await programsHtml();
        expect(html).toContain('Program guide, as edited in admin');
        expect(blogHrefs(html)).toEqual([PROGRAM_GUIDE_SLUG]);
    }, RENDER_TIMEOUT_MS);

    it('an unpublished row takes the card down', async () => {
        db.rows = [{ id: 'row-program', slug: PROGRAM_GUIDE_SLUG, status: 'draft' }];
        const html = await programsHtml();
        expect(html).not.toContain('Share with your students');
        expect(blogHrefs(html)).toEqual([]);
    }, RENDER_TIMEOUT_MS);
});
