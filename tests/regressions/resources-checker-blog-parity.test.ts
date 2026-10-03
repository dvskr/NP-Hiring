/**
 * Package C1 parity and copy leftovers on two surfaces that list blog posts.
 *
 *  - /resources: the "Salary Calculator & Guide" card said "Complete 2026
 *    data.", a hand-typed year plus a completeness claim the salary guide
 *    cannot back (states below the publishing gate print no figure). And
 *    the hero's "Articles" sticker printed /blog's total, which includes
 *    the 51 license guides the "State Guides" sticker beside it already
 *    counts. It now counts the posts the article grid groups.
 *  - /tools/licensure-checker read blog_posts through Prisma for its guide
 *    links and added the code-served series by the same fallback rule. It
 *    now reads getAllPublishedSlugs() in lib/blog.ts, the list the sitemap
 *    advertises and the state pages check before they link a guide, so an
 *    editorial takedown in blog_posts reaches it too.
 *  - That left the two checker surfaces choosing guides by different rules:
 *    the route by slug (every license-guide slug that is live), /resources
 *    by category (listed posts filed under State Spotlight). They agreed
 *    until a guide row was filed under another category, and then /resources
 *    lost that state's tile and its embedded checker's guide link while the
 *    route and the state pages kept linking the guide. /resources now knows
 *    a license guide by its slug too, and the last suite here compares what
 *    the two surfaces hand the checker.
 *
 * The database is faked at both doors: Prisma's blogPost delegate answers no
 * rows (and must not be asked), and the Supabase client lib/blog.ts reads
 * through serves an in-memory blog_posts table, empty unless a test seeds
 * rows. Nothing here reaches a real database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

type Row = { slug: string; status: string; [k: string]: unknown };
const db: { rows: Row[] } = { rows: [] };

/** PostgREST builder over db.rows (the shape tests/regressions/p10-blog-mdx-fallback.test.ts fakes). */
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

import { prisma } from '@/lib/prisma';
import ResourcesPage from '@/app/resources/page';
import LicensureCheckerToolPage from '@/app/tools/licensure-checker/page';
import LicensureChecker from '@/components/LicensureChecker';
import MultiStatePlanner, { type PlannerState } from '@/components/tools/MultiStatePlanner';
import { LICENSE_GUIDE_SLUG_REGEX } from '@/config/niche/content-map';
import { getAllPublishedSlugs } from '@/lib/blog';
import { getAllMdxPosts } from '@/lib/blog-mdx-posts';
import { LICENSE_GUIDE_PUBLISH_DATE, LICENSE_GUIDE_STATES } from '@/lib/blog-license-guides';

type Mock = ReturnType<typeof vi.fn>;
const m = (fn: unknown) => fn as Mock;

/** The first render imports the full page trees (lucide, next/image, the checker, the planner). */
const RENDER_TIMEOUT_MS = 60_000;

interface GuideRef { name: string; slug: string }

/** The value printed on a /resources hero stat sticker, or null when the sticker is absent. */
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

/** The guides and planner rows the licensure checker route hands its two widgets. */
async function checkerProps(): Promise<{ guides: GuideRef[]; planner: readonly PlannerState[] }> {
    const tree = await LicensureCheckerToolPage();
    const checker = findElement<{ stateGuides: GuideRef[] }>(tree, LicensureChecker);
    const planner = findElement<{ states: readonly PlannerState[] }>(tree, MultiStatePlanner);
    expect(checker, 'LicensureChecker not found in the page tree').not.toBeNull();
    expect(planner, 'MultiStatePlanner not found in the page tree').not.toBeNull();
    return { guides: checker!.props.stateGuides, planner: planner!.props.states };
}

/** Every license guide, as the old Prisma read plus fallback produced it with an empty table. */
const ALL_GUIDES: GuideRef[] = LICENSE_GUIDE_STATES
    .map((s) => ({ name: s.name, slug: s.slug }))
    .sort((a, b) => a.name.localeCompare(b.name));

/** /resources rendered once: its markup, and the guides it hands its embedded checker. */
async function resourcesPage(): Promise<{ html: string; guides: GuideRef[] }> {
    const tree = await ResourcesPage();
    const checker = findElement<{ stateGuides: GuideRef[] }>(tree, LicensureChecker);
    expect(checker, 'LicensureChecker not found on /resources').not.toBeNull();
    return { html: renderToStaticMarkup(tree), guides: checker!.props.stateGuides };
}

/** The article grid band of /resources. */
const articleGrid = (html: string): string =>
    html.slice(html.indexOf('Career Guides &amp; Insights'), html.indexOf('Tools &amp; Downloads'));

/** The per-category counts the article grid prints, in page order. */
const articleGroupCounts = (html: string): number[] =>
    [...articleGrid(html).matchAll(/<span class="stk-cat-count">(\d+)<\/span>/g)].map((count) => Number(count[1]));

beforeEach(() => {
    db.rows = [];
    // The direct table read the checker used to make: answering it with no
    // rows reproduces production, and nothing should ask it any more.
    m(prisma.blogPost.findMany).mockReset().mockResolvedValue([]);
    m(prisma.blogPost.findFirst).mockReset().mockResolvedValue(null);
});

describe('/resources: the salary guide card describes the guide, with no typed year', () => {
    it('names what /salary-guide renders and claims no edition or completeness', async () => {
        const html = renderToStaticMarkup(await ResourcesPage());
        const match = html.match(/Salary Calculator &amp; Guide<\/h2><p class="stk-desc">([^<]+)<\/p>/);
        expect(match, 'the salary guide card did not render').not.toBeNull();
        const desc = match![1];
        expect(desc, 'a hand-typed year goes stale').not.toMatch(/\b20\d{2}\b/);
        expect(desc, 'states below the publishing gate print no figure').not.toMatch(/\bcomplete\b/i);
        // The guide's selectors and its two kinds of figure, both medians.
        for (const selector of ['state', 'experience', 'setting', 'specialty']) {
            expect(desc).toContain(selector);
        }
        expect(desc).toContain('BLS national median');
        expect(desc).toContain('state medians from live postings');
        expect(desc, 'house style: median, never average').not.toMatch(/\baverage\b/i);
        expect(desc, 'house style: no em dash, en dash or spaced hyphen').not.toMatch(/[—–]| - /);
    }, RENDER_TIMEOUT_MS);
});

describe('/resources: the hero counts each post once', () => {
    it('"Articles" is the article grid the page renders, beside the guides it does not repeat', async () => {
        const html = renderToStaticMarkup(await ResourcesPage());
        const articles = Number(heroStat(html, 'Articles'));
        const guides = Number(heroStat(html, 'State Guides'));
        // With blog_posts empty: the authored .mdx posts, and the 51 guides.
        expect(articles).toBe(getAllMdxPosts().length);
        expect(guides).toBe(LICENSE_GUIDE_STATES.length);
        // The category counts in the article grid add up to the hero figure.
        const grid = html.slice(html.indexOf('Career Guides &amp; Insights'), html.indexOf('Tools &amp; Downloads'));
        const groupCounts = [...grid.matchAll(/<span class="stk-cat-count">(\d+)<\/span>/g)].map((c) => Number(c[1]));
        expect(groupCounts.length).toBeGreaterThan(0);
        expect(groupCounts.reduce((sum, n) => sum + n, 0)).toBe(articles);
    }, RENDER_TIMEOUT_MS);
});

describe('/tools/licensure-checker reads its guide links through lib/blog.ts', () => {
    it('links all 51 guides by registry name with an empty table, without a Prisma read', async () => {
        const { guides, planner } = await checkerProps();
        expect(guides).toEqual(ALL_GUIDES);
        expect(guides).toContainEqual({ name: 'District of Columbia', slug: 'np-license-district-of-columbia' });
        // Every planner row carries its state's guide.
        const slugByName = new Map(ALL_GUIDES.map((g) => [g.name, g.slug]));
        for (const row of planner) {
            expect(row.guideSlug, row.name).toBe(slugByName.get(row.name));
        }
        expect(prisma.blogPost.findMany).not.toHaveBeenCalled();
        expect(prisma.blogPost.findFirst).not.toHaveBeenCalled();
    }, RENDER_TIMEOUT_MS);

    it('agrees with getAllPublishedSlugs: a synced guide links once, a taken down guide not at all', async () => {
        db.rows = [
            {
                id: 'row-texas', slug: 'np-license-texas', status: 'published', category: 'state_spotlight',
                publish_date: LICENSE_GUIDE_PUBLISH_DATE, updated_at: LICENSE_GUIDE_PUBLISH_DATE,
            },
            // An editorial takedown: /blog/np-license-ohio 404s, so nothing may link it.
            { id: 'row-ohio', slug: 'np-license-ohio', status: 'draft', category: 'state_spotlight' },
            {
                id: 'row-admin', slug: 'written-in-admin', status: 'published', category: 'salary_negotiation',
                publish_date: '2026-09-29T00:00:00.000Z', updated_at: '2026-09-29T00:00:00.000Z',
            },
        ];
        const { guides, planner } = await checkerProps();

        const live = (await getAllPublishedSlugs())
            .map((row) => row.slug)
            .filter((slug) => LICENSE_GUIDE_SLUG_REGEX.test(slug));
        expect(guides.map((g) => g.slug).sort()).toEqual([...live].sort());

        expect(guides.filter((g) => g.name === 'Texas')).toEqual([{ name: 'Texas', slug: 'np-license-texas' }]);
        expect(guides.find((g) => g.name === 'Ohio')).toBeUndefined();
        expect(guides).toHaveLength(LICENSE_GUIDE_STATES.length - 1);
        expect(planner.find((row) => row.name === 'Ohio')?.guideSlug).toBeNull();
        expect(planner.find((row) => row.name === 'Texas')?.guideSlug).toBe('np-license-texas');
    }, RENDER_TIMEOUT_MS);
});

describe('/resources and /tools/licensure-checker pick license guides by the same rule', () => {
    it('hand the checker the same guides with an empty table', async () => {
        const resources = await resourcesPage();
        expect(resources.guides).toEqual((await checkerProps()).guides);
        expect(resources.guides).toEqual(ALL_GUIDES);
    }, RENDER_TIMEOUT_MS);

    it('agree on a synced guide and on a taken down one', async () => {
        db.rows = [
            {
                id: 'row-texas', slug: 'np-license-texas', status: 'published', category: 'state_spotlight',
                title: 'Texas guide', meta_description: 'Synced.', reviewed_at: null,
                publish_date: LICENSE_GUIDE_PUBLISH_DATE, created_at: LICENSE_GUIDE_PUBLISH_DATE, updated_at: LICENSE_GUIDE_PUBLISH_DATE,
            },
            { id: 'row-ohio', slug: 'np-license-ohio', status: 'draft', category: 'state_spotlight' },
        ];
        const resources = await resourcesPage();
        expect(resources.guides).toEqual((await checkerProps()).guides);
        expect(resources.guides).toHaveLength(LICENSE_GUIDE_STATES.length - 1);
        expect(resources.guides.find((g) => g.name === 'Ohio')).toBeUndefined();
    }, RENDER_TIMEOUT_MS);

    it('a guide row filed under another category is still that state\'s guide on both, and not an article', async () => {
        // The series is known by its slug everywhere else (the route above,
        // the sitemap, the state pages, /blog/<slug> itself). An editor who
        // refiles the row in /admin/blog changes its /blog filter pill, not
        // what the post is.
        db.rows = [{
            id: 'row-texas', slug: 'np-license-texas', status: 'published', category: 'career_opportunities',
            title: 'Texas guide, refiled in admin', meta_description: 'Refiled.', reviewed_at: null,
            publish_date: LICENSE_GUIDE_PUBLISH_DATE, created_at: LICENSE_GUIDE_PUBLISH_DATE, updated_at: LICENSE_GUIDE_PUBLISH_DATE,
        }];
        const resources = await resourcesPage();
        const { guides } = await checkerProps();

        expect(guides).toContainEqual({ name: 'Texas', slug: 'np-license-texas' });
        expect(resources.guides).toEqual(guides);
        expect(resources.guides).toHaveLength(LICENSE_GUIDE_STATES.length);
        expect(heroStat(resources.html, 'State Guides')).toBe(String(LICENSE_GUIDE_STATES.length));

        // Counted and linked once, as a state guide: the article grid and
        // the "Articles" figure leave it out.
        expect(articleGrid(resources.html)).not.toContain('href="/blog/np-license-texas"');
        expect(Number(heroStat(resources.html, 'Articles'))).toBe(getAllMdxPosts().length);
        expect(articleGroupCounts(resources.html).reduce((sum, n) => sum + n, 0)).toBe(getAllMdxPosts().length);
        expect(resources.html.match(/href="\/blog\/np-license-texas"/g) ?? []).toHaveLength(1);
    }, RENDER_TIMEOUT_MS);
});
