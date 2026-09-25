import { createClient } from '@supabase/supabase-js';
import sanitizeHtml from 'sanitize-html';
import { brand } from '@/config/brand';
import {
    LICENSE_GUIDE_SERIES_PUBLISHED,
    LICENSE_GUIDE_SLUG_PREFIX,
    LICENSE_GUIDE_SLUG_REGEX,
} from '@/config/niche/content-map';
import type { BlogCategory } from '@/lib/blog-categories';
import {
    getAllLicenseGuideSlugs,
    getLicenseGuidePost,
    LICENSE_GUIDE_REVIEWED_AT,
} from '@/lib/blog-license-guides';
import { getAllMdxPosts, getMdxPost } from '@/lib/blog-mdx-posts';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BlogPost {
    id: string;
    title: string;
    slug: string;
    content: string;
    meta_description: string | null;
    target_keyword: string | null;
    category: BlogCategory;
    status: 'draft' | 'published';
    publish_date: string | null;
    image_url: string | null;
    youtube_video_id: string | null;
    video_url: string | null;
    /** Editorial review timestamp. Takes precedence over updated_at as the
     *  BlogPosting.dateModified value when set (audit 14 HIGH). Bump on
     *  each review pass so dateModified reflects real freshness instead of
     *  being permanently equal to publish_date. */
    reviewed_at: string | null;
    /** Per-post FAQ data emitted as FAQPage JSON-LD. Populated via the
     *  n8n content pipeline. When null, the post page falls back to the
     *  legacy hardcoded blogFaqData map (audit 14 MEDIUM). */
    faq_json: Array<{ name: string; text: string }> | null;
    created_at: string;
    updated_at: string;
}

// The taxonomy itself lives in lib/blog-categories.ts — a dependency-free
// module — so 'use client' surfaces (the admin editor) can consume it
// without pulling supabase + sanitize-html into the browser bundle. It is
// re-exported here so every existing server-side importer is unchanged and
// there is still exactly one definition.
export { BLOG_CATEGORIES } from '@/lib/blog-categories';
export type { BlogCategory } from '@/lib/blog-categories';

// ─── Supabase Client ─────────────────────────────────────────────────────────

function getSupabaseClient() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
}

function getSupabaseServiceClient() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
}

// ─── Query Functions ─────────────────────────────────────────────────────────

const POSTS_PER_PAGE = 12;

/** Upper bound on DB rows merged in memory with the license-guide series. */
const MERGED_LISTING_MAX_ROWS = 1000;

const LISTING_COLUMNS = 'id, title, slug, meta_description, category, publish_date, created_at, image_url, youtube_video_id, reviewed_at';
const RELATED_COLUMNS = 'id, title, slug, meta_description, category, publish_date, image_url, reviewed_at';

/**
 * Listing and "Read next" cards print a row's title and meta_description.
 * getPostBySlug already swaps a superseded license-guide mirror for the
 * reviewed guide, but these cards read blog_posts directly, so a mirror synced
 * before the 2026-09 practice-authority review would keep printing its old
 * generated description ("physician-supervision rules" for every restricted
 * state, "collaborative-agreement rules" for every reduced one) on /blog and
 * in "Read next". This gives the cards the same reviewed copy the page shows.
 */
export function withReviewedLicenseGuideCopy<T extends Pick<BlogPost, 'slug' | 'reviewed_at' | 'title' | 'meta_description'>>(row: T): T {
    if (!isSupersededLicenseGuideRow(row)) return row;
    const match = row.slug.match(LICENSE_GUIDE_SLUG_REGEX);
    const reviewed = match ? getLicenseGuidePost(match[1]) : null;
    return reviewed ? { ...row, title: reviewed.title, meta_description: reviewed.meta_description } : row;
}

type SupabaseClient = ReturnType<typeof getSupabaseClient>;

type SlugRow = { slug: string; updated_at: string };

/** One blog_posts read; `error` is set on a PostgREST error or a thrown client. */
interface BlogRead<T> {
    data: T | null;
    error: unknown;
    count: number | null;
}

/**
 * Run one blog_posts read and never throw. `T` names the row shape the
 * caller's select produces (supabase-js types this untyped table as any).
 *
 * Production lesson (blog outage, September 2026): the anon role had no
 * SELECT grant on blog_posts, so every read failed with Postgres 42501 and
 * the loaders that returned early on error 404ed all 19 authored posts and
 * dropped the 51 license guides from the sitemap. Every loader below treats
 * a failed read as "zero DB rows" and still serves the code-generated posts;
 * a thrown client error (missing env, network layer) takes the same path.
 */
async function readBlogPosts<T>(
    label: string,
    run: (supabase: SupabaseClient) => PromiseLike<{ data: unknown; error: unknown; count?: number | null }>,
): Promise<BlogRead<T>> {
    try {
        const result = await run(getSupabaseClient());
        if (result.error) console.error(`Error ${label}:`, result.error);
        return { data: result.data as T | null, error: result.error, count: result.count ?? null };
    } catch (error) {
        console.error(`Error ${label}:`, error);
        return { data: null, error, count: null };
    }
}

/**
 * Code-generated license-guide slugs that are live WITHOUT a blog_posts row.
 *
 * getPostBySlug serves every 'np-license-<state>' slug from
 * lib/blog-license-guides.ts when no published row exists, and serves
 * nothing when an UNPUBLISHED row exists (editorial takedown). So a slug is
 * a live fallback exactly when the series is published and the slug has no
 * DB row of any status: a published row is listed from the DB already, and
 * an unpublished one is suppressed. Every listing surface (blog index, post
 * count, sitemap, licensure checker) derives from this one rule so none of
 * them can disagree with what /blog/<slug> actually renders.
 */
export function licenseGuideFallbackSlugs(
    dbLicenseSlugs: Iterable<string>,
    seriesPublished: boolean = LICENSE_GUIDE_SERIES_PUBLISHED,
): string[] {
    if (!seriesPublished) return [];
    const inDb = new Set(dbLicenseSlugs);
    return getAllLicenseGuideSlugs().filter((slug) => !inDb.has(slug));
}

/** True when a blog index filter can contain the license-guide series. */
export function categoryIncludesLicenseGuides(category?: string): boolean {
    return !category || category === 'all' || category === 'state_spotlight';
}

/**
 * Merge DB listing rows with the live fallback guides, newest first (null
 * publish dates last, as the DB query orders them). A fallback slug that
 * also appears in the DB rows is dropped, so nothing is listed twice.
 */
export function mergeListingWithLicenseGuides(
    dbRows: readonly BlogPost[],
    fallbackSlugs: readonly string[],
): BlogPost[] {
    const guides = fallbackSlugs.flatMap((slug) => {
        const match = slug.match(LICENSE_GUIDE_SLUG_REGEX);
        const post = match ? getLicenseGuidePost(match[1]) : null;
        return post ? [post] : [];
    });
    return mergeListingWithFallbackPosts(dbRows, guides);
}

/**
 * Merge DB listing rows with code-served fallback posts (license guides and
 * .mdx guides), newest first, null publish dates last. A fallback post whose
 * slug is already among the DB rows is dropped, and bodies are blanked
 * because the index never renders them.
 */
export function mergeListingWithFallbackPosts(
    dbRows: readonly BlogPost[],
    fallbackPosts: readonly BlogPost[],
): BlogPost[] {
    const listed = new Set(dbRows.map((row) => row.slug));
    const extra = fallbackPosts
        .filter((post) => !listed.has(post.slug))
        .map((post) => ({ ...post, content: '' }));
    const time = (row: BlogPost) => (row.publish_date ? Date.parse(row.publish_date) : Number.NEGATIVE_INFINITY);
    return [...dbRows, ...extra].sort((a, b) => time(b) - time(a));
}

/**
 * Authored content/blog/*.mdx posts that are live WITHOUT a blog_posts row,
 * restricted to a blog index category filter.
 *
 * Same rule as licenseGuideFallbackSlugs: getPostBySlug serves an .mdx post
 * from code only when no DB row of any status exists (a published row is the
 * editorial version and is listed from the DB; an unpublished row is a
 * takedown). The index, the post count and the sitemap all derive from this
 * one rule, so none of them can disagree with what /blog/<slug> renders.
 */
export function mdxFallbackPosts(
    dbSlugs: Iterable<string>,
    category?: string,
    posts: readonly BlogPost[] = getAllMdxPosts(),
): BlogPost[] {
    const inDb = new Set(dbSlugs);
    return posts.filter(
        (post) => !inDb.has(post.slug) && (!category || category === 'all' || post.category === category),
    );
}

/** Slugs of the .mdx posts that could be listed under a category filter. */
function mdxCandidateSlugs(category?: string): string[] {
    return mdxFallbackPosts([], category).map((post) => post.slug);
}

/**
 * Slugs from `slugs` that have a blog_posts row of any status. On a failed
 * read this fails OPEN (no rows), matching hasSuppressedRow: the fallback
 * posts still render, so they should still be listed.
 */
async function fetchDbSlugsIn(slugs: readonly string[]): Promise<string[]> {
    if (slugs.length === 0) return [];
    const read = await readBlogPosts<{ slug: string }[]>('fetching blog rows for code-served posts', (supabase) =>
        supabase.from('blog_posts').select('slug').in('slug', [...slugs]),
    );
    return (read.data ?? []).map((row) => row.slug);
}

/**
 * Slugs of every blog_posts row in the license-guide series (any status,
 * or only the unpublished ones). On a failed read this fails OPEN (no
 * rows), matching hasSuppressedRow: the fallback guides still render, so
 * they should still be listed.
 */
async function fetchLicenseGuideDbSlugs(onlyUnpublished = false): Promise<string[]> {
    const read = await readBlogPosts<{ slug: string }[]>('fetching license guide rows', (supabase) => {
        const query = supabase.from('blog_posts').select('slug').like('slug', `${LICENSE_GUIDE_SLUG_PREFIX}%`);
        return onlyUnpublished ? query.neq('status', 'published') : query;
    });
    return (read.data ?? []).map((row) => row.slug);
}

export async function getPublishedPosts(
    page = 1,
    limit = POSTS_PER_PAGE,
    category?: string
) {
    const offset = (page - 1) * limit;
    const includeGuides = categoryIncludesLicenseGuides(category) && LICENSE_GUIDE_SERIES_PUBLISHED;
    const mdxSlugs = mdxCandidateSlugs(category);
    const mergeFallbacks = includeGuides || mdxSlugs.length > 0;

    const [listing, licenseDbSlugs, mdxDbSlugs] = await Promise.all([
        readBlogPosts<BlogPost[]>('fetching blog posts', (supabase) => {
            let query = supabase
                .from('blog_posts')
                .select(LISTING_COLUMNS)
                .eq('status', 'published')
                .order('publish_date', { ascending: false, nullsFirst: false });
            // With code-served posts merged in, paging happens after the merge.
            query = mergeFallbacks
                ? query.limit(MERGED_LISTING_MAX_ROWS)
                : query.range(offset, offset + limit - 1);
            return category && category !== 'all' ? query.eq('category', category) : query;
        }),
        includeGuides ? fetchLicenseGuideDbSlugs() : Promise.resolve([]),
        fetchDbSlugsIn(mdxSlugs),
    ]);
    // A failed read contributes zero DB rows. The code-served posts still
    // list (getPostBySlug renders them when blog_posts is unreadable), so
    // /blog never claims "No posts found" during an outage.
    const rows = (listing.data ?? []).map(withReviewedLicenseGuideCopy);
    if (!mergeFallbacks) return rows;

    const licenseSlugs = includeGuides ? licenseGuideFallbackSlugs(licenseDbSlugs) : [];
    const withGuides = mergeListingWithLicenseGuides(rows, licenseSlugs);
    const merged = mergeListingWithFallbackPosts(withGuides, mdxFallbackPosts(mdxDbSlugs, category));
    return merged.slice(offset, offset + limit);
}

export async function getPostCount(category?: string): Promise<number> {
    const includeGuides = categoryIncludesLicenseGuides(category) && LICENSE_GUIDE_SERIES_PUBLISHED;

    const [counted, licenseDbSlugs, mdxDbSlugs] = await Promise.all([
        readBlogPosts<unknown>('counting blog posts', (supabase) => {
            const query = supabase
                .from('blog_posts')
                .select('id', { count: 'exact', head: true })
                .eq('status', 'published');
            return category && category !== 'all' ? query.eq('category', category) : query;
        }),
        includeGuides ? fetchLicenseGuideDbSlugs() : Promise.resolve([]),
        fetchDbSlugsIn(mdxCandidateSlugs(category)),
    ]);
    // On a failed count the DB contributes zero, but the live code-served
    // posts still count, matching getPublishedPosts and getPostBySlug.
    const dbCount = counted.count ?? 0;
    const guideCount = includeGuides ? licenseGuideFallbackSlugs(licenseDbSlugs).length : 0;
    return dbCount + guideCount + mdxFallbackPosts(mdxDbSlugs, category).length;
}

/**
 * True when a published blog_posts row for a license-guide slug was
 * reviewed BEFORE the generator's latest editorial review
 * (LICENSE_GUIDE_REVIEWED_AT), so the generated guide supersedes it.
 *
 * WHY: scripts/sync-blog-to-db.ts --license-guides mirrors the generator
 * into blog_posts, and a published row normally wins (editorial override).
 * A mirror synced before a YMYL correction would therefore keep serving
 * the corrected-away copy, here the tier-derived physician claims the
 * 2026-09 practice-authority pass removed, until someone reruns that sync
 * against the production database. The sync stamps reviewed_at with
 * LICENSE_GUIDE_REVIEWED_AT, so a row dated earlier predates the current
 * reviewed text. A row with no review date, or one an editor dated on or
 * after the series review, still wins; rerunning the sync restores DB
 * precedence with identical content.
 */
export function isSupersededLicenseGuideRow(row: Pick<BlogPost, 'slug' | 'reviewed_at'>): boolean {
    if (!LICENSE_GUIDE_SERIES_PUBLISHED || !LICENSE_GUIDE_SLUG_REGEX.test(row.slug)) return false;
    const reviewed = row.reviewed_at ? Date.parse(row.reviewed_at) : Number.NaN;
    return Number.isFinite(reviewed) && reviewed < Date.parse(LICENSE_GUIDE_REVIEWED_AT);
}

export async function getPostBySlug(slug: string): Promise<BlogPost | null> {
    const found = await readBlogPosts<BlogPost | null>('fetching blog post', (supabase) =>
        supabase.from('blog_posts').select('*').eq('slug', slug).eq('status', 'published').maybeSingle(),
    );
    if (found.data && !isSupersededLicenseGuideRow(found.data)) return found.data;

    // A miss (no published row, or blog_posts unreadable) falls through to
    // the code-served posts, so rendering never depends on the sync script
    // having run or on the DB grant being in place.
    // License-guide series fallback: 'np-license-<state>' slugs resolve
    // deterministically from lib/blog-license-guides.ts when no DB row
    // exists, so the all-or-nothing gate (LICENSE_GUIDE_SERIES_PUBLISHED)
    // can never 404 a subset of the 51 states. A published DB row for the
    // same slug (editorial override via admin) takes precedence above,
    // unless it predates the series review (isSupersededLicenseGuideRow).
    const licenseMatch = slug.match(LICENSE_GUIDE_SLUG_REGEX);
    if (licenseMatch && LICENSE_GUIDE_SERIES_PUBLISHED) {
        // A superseded row is published, so it is no takedown: serve the
        // reviewed guide without the suppression lookup.
        if (found.data) return getLicenseGuidePost(licenseMatch[1]);
        return (await hasSuppressedRow(slug))
            ? null
            : getLicenseGuidePost(licenseMatch[1]);
    }
    // Authored .mdx guide fallback (content/blog/): same contract as the
    // license series, so a guide wired into the content map never 404s
    // just because scripts/sync-blog-to-db.ts has not run.
    const mdxPost = getMdxPost(slug);
    if (mdxPost) {
        return (await hasSuppressedRow(slug)) ? null : mdxPost;
    }
    return null;
}

/**
 * True when blog_posts holds a row for `slug` that is NOT published.
 *
 * The code fallbacks above (license generator and .mdx guides) must not resurrect a guide an editor
 * deliberately took down: without this check the admin publish/unpublish
 * toggle (and any editorial retraction) is a silent no-op on all 51
 * license slugs, because the unpublished row simply fails the
 * status='published' filter and the code fallback serves the post anyway.
 * A YMYL correction that can't be taken down is worse than no CMS at all.
 *
 * Only runs on the miss path for license and .mdx slugs, so the extra
 * round-trip never touches the normal published-post render.
 */
async function hasSuppressedRow(slug: string): Promise<boolean> {
    const read = await readBlogPosts<{ id: string } | null>('checking for an unpublished blog row', (supabase) =>
        supabase.from('blog_posts').select('id').eq('slug', slug).maybeSingle(),
    );
    // On a failed read, fail OPEN (serve the generated guide): an outage in
    // this secondary lookup should not 404 a page that would otherwise render.
    if (read.error) return false;
    return Boolean(read.data);
}

export async function getRelatedPosts(
    category: string,
    currentSlug: string,
    limit = 3
): Promise<BlogPost[]> {
    // Same category first: the strongest topical relevance signal.
    const same = await readBlogPosts<BlogPost[]>('fetching related posts', (supabase) =>
        supabase
            .from('blog_posts')
            .select(RELATED_COLUMNS)
            .eq('status', 'published')
            .eq('category', category)
            .neq('slug', currentSlug)
            .order('publish_date', { ascending: false, nullsFirst: false })
            .limit(limit),
    );
    const related: BlogPost[] = (same.data ?? []).map(withReviewedLicenseGuideCopy);
    const have = new Set([currentSlug, ...related.map((p) => p.slug)]);

    // Top up from any category when the same-category query is short of
    // `limit`: thin categories (1 to 2 posts) would otherwise leave "Read
    // Next" empty. Skipped when the first read failed: the DB is unreadable
    // and the code-served top-up below covers the block.
    if (related.length < limit && !same.error) {
        const fill = await readBlogPosts<BlogPost[]>('fetching related post fill', (supabase) =>
            supabase
                .from('blog_posts')
                .select(RELATED_COLUMNS)
                .eq('status', 'published')
                .neq('slug', currentSlug)
                .order('publish_date', { ascending: false, nullsFirst: false })
                .limit(limit + related.length),
        );
        appendUpToLimit(related, have, (fill.data ?? []).map(withReviewedLicenseGuideCopy), limit);
    }

    // Code-served top-up: the license guides and .mdx posts that render
    // without a DB row. Before this, "Read Next" was empty on every post
    // while blog_posts was unreadable or unsynced.
    if (related.length < limit) {
        appendUpToLimit(related, have, await relatedFallbackPosts(category, currentSlug), limit);
    }
    return related;
}

/** Append posts whose slug is not yet in `have` until `related` holds `limit`. */
function appendUpToLimit(related: BlogPost[], have: Set<string>, posts: readonly BlogPost[], limit: number): void {
    for (const post of posts) {
        if (related.length >= limit) break;
        if (have.has(post.slug)) continue;
        related.push(post);
        have.add(post.slug);
    }
}

/**
 * Code-served posts eligible for "Read Next": license guides and .mdx posts
 * with no DB row of any status (a published row is already reachable from
 * the DB reads above, an unpublished row is a takedown). Ranked same
 * category first, then newest first; among equal dates the slugs after
 * `currentSlug` lead, so the 51 guides, which share one publish date, do
 * not all point at the same three states.
 */
async function relatedFallbackPosts(category: string, currentSlug: string): Promise<BlogPost[]> {
    const guides = LICENSE_GUIDE_SERIES_PUBLISHED ? mergeListingWithLicenseGuides([], getAllLicenseGuideSlugs()) : [];
    const candidates = mergeListingWithFallbackPosts([], [...guides, ...mdxFallbackPosts([])])
        .filter((post) => post.slug !== currentSlug);
    const inDb = new Set(await fetchDbSlugsIn(candidates.map((post) => post.slug)));
    const time = (post: BlogPost) => (post.publish_date ? Date.parse(post.publish_date) : Number.NEGATIVE_INFINITY);
    const rank = (post: BlogPost) => (post.category === category ? 0 : 1);
    const follows = (post: BlogPost) => (post.slug > currentSlug ? 0 : 1);
    return candidates
        .filter((post) => !inDb.has(post.slug))
        .sort((a, b) => rank(a) - rank(b) || time(b) - time(a) || follows(a) - follows(b) || a.slug.localeCompare(b.slug));
}

export async function getAllPublishedSlugs(): Promise<
    { slug: string; updated_at: string }[]
> {
    // Never return early here (tests/regressions/blog-slugs-fallback.test.ts).
    // On a failed read the DB contributes zero rows and the code-served posts
    // below are still listed, matching what getPostBySlug renders. Returning
    // [] on error is what emptied the sitemap of every blog URL while the
    // anon role lacked SELECT on blog_posts.
    const published = await readBlogPosts<SlugRow[]>('fetching blog slugs', (supabase) =>
        supabase
            .from('blog_posts')
            .select('slug, updated_at')
            .eq('status', 'published')
            .order('publish_date', { ascending: false, nullsFirst: false }),
    );
    const rows: SlugRow[] = [...(published.data ?? [])];
    const seen = new Set(rows.map((r) => r.slug));

    // Append the 51 code-generated license-guide slugs (sitemap + listing
    // coverage) once the series is published. Deduped against DB rows so
    // states already synced into blog_posts are not listed twice, and
    // suppressed for slugs an editor unpublished: otherwise the sitemap
    // would keep advertising a URL that getPostBySlug() now 404s.
    if (LICENSE_GUIDE_SERIES_PUBLISHED) {
        const suppressed = new Set(await fetchLicenseGuideDbSlugs(true));
        for (const slug of getAllLicenseGuideSlugs()) {
            if (!seen.has(slug) && !suppressed.has(slug)) {
                rows.push({ slug, updated_at: LICENSE_GUIDE_REVIEWED_AT });
                seen.add(slug);
            }
        }
    }

    // Authored .mdx guides served from code (getPostBySlug fallback): listed
    // exactly when no DB row of any status exists for the slug.
    const mdxDbSlugs = await fetchDbSlugsIn(mdxCandidateSlugs());
    for (const post of mdxFallbackPosts(mdxDbSlugs)) {
        if (!seen.has(post.slug)) {
            rows.push({ slug: post.slug, updated_at: post.updated_at });
            seen.add(post.slug);
        }
    }
    return rows;
}

// ─── Write Functions (service role) ──────────────────────────────────────────

export async function createBlogPost(
    // reviewed_at and faq_json are populated separately (editorial review
    // pass and n8n content pipeline respectively), not at create time.
    data: Omit<BlogPost, 'id' | 'created_at' | 'updated_at' | 'reviewed_at' | 'faq_json'>
): Promise<BlogPost> {
    const supabase = getSupabaseServiceClient();

    // Build insert payload — only include image_url when provided
    // (Supabase schema cache may not know about new columns immediately)
    const insertData: Record<string, unknown> = {
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...data,
    };
    if (!insertData.image_url) delete insertData.image_url;

    const { data: post, error } = await supabase
        .from('blog_posts')
        .insert(insertData)
        .select()
        .single();

    if (error) {
        throw new Error(`Failed to create blog post: ${error.message}`);
    }
    return post as BlogPost;
}

// ─── Slug Generation ─────────────────────────────────────────────────────────

export function generateSlug(title: string): string {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80);
}

export async function generateUniqueSlug(title: string): Promise<string> {
    const supabase = getSupabaseServiceClient();
    const baseSlug = generateSlug(title);

    // Check if slug exists
    const { data } = await supabase
        .from('blog_posts')
        .select('slug')
        .like('slug', `${baseSlug}%`);

    if (!data || data.length === 0) return baseSlug;

    const existingSlugs = new Set(data.map((d) => d.slug));
    if (!existingSlugs.has(baseSlug)) return baseSlug;

    // Find next available number
    let counter = 2;
    while (existingSlugs.has(`${baseSlug}-${counter}`)) {
        counter++;
    }
    return `${baseSlug}-${counter}`;
}

// ─── Markdown to HTML ────────────────────────────────────────────────────────

export function markdownToHtml(markdown: string): string {
    let html = markdown;

    // Escape HTML entities in code blocks first (preserve them)
    const codeBlocks: string[] = [];
    html = html.replace(/```([\s\S]*?)```/g, (_, code) => {
        codeBlocks.push(code);
        return `%%CODEBLOCK_${codeBlocks.length - 1}%%`;
    });

    const inlineCode: string[] = [];
    html = html.replace(/`([^`]+)`/g, (_, code) => {
        inlineCode.push(code);
        return `%%INLINECODE_${inlineCode.length - 1}%%`;
    });

    // Headings (h1-h6)
    html = html.replace(/^######\s+(.+)$/gm, (_, text) => {
        const id = text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
        return `<h6 id="${id}">${text}</h6>`;
    });
    html = html.replace(/^#####\s+(.+)$/gm, (_, text) => {
        const id = text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
        return `<h5 id="${id}">${text}</h5>`;
    });
    html = html.replace(/^####\s+(.+)$/gm, (_, text) => {
        const id = text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
        return `<h4 id="${id}">${text}</h4>`;
    });
    html = html.replace(/^###\s+(.+)$/gm, (_, text) => {
        const id = text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
        return `<h3 id="${id}">${text}</h3>`;
    });
    html = html.replace(/^##\s+(.+)$/gm, (_, text) => {
        const id = text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
        return `<h2 id="${id}">${text}</h2>`;
    });
    // Single-hash markdown headings render as <h2>, not <h1>. Blog post pages
    // already render the post title as the page-level <h1>; allowing body
    // content to emit additional H1s would produce duplicate-H1 documents
    // and weaken topic signal. Authors who want the largest body heading
    // should use ## (which already renders as <h2>) — the visual size is
    // controlled by editorial.css, not the tag.
    html = html.replace(/^#\s+(.+)$/gm, (_, text) => {
        const id = text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
        return `<h2 id="${id}">${text}</h2>`;
    });

    // Bold and italic
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Images
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" loading="lazy" />');

    // Links (markdown syntax)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

    // Auto-link bare URLs (not already inside an <a> tag or href attribute)
    html = html.replace(
        /(?<!")(?<!href=")(?<!<a[^>]*>)(https?:\/\/[^\s<>"',;!)\]]+[^\s<>"',;!.)\]])/g,
        (url) => {
            const isInternal = url.includes(brand.domain);
            return isInternal
                ? `<a href="${url}">${url}</a>`
                : `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
        }
    );

    // Blockquotes
    html = html.replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>');
    // Merge consecutive blockquotes
    html = html.replace(/<\/blockquote>\n<blockquote>/g, '\n');

    // GFM Tables
    html = html.replace(
        /^(\|.+\|)\r?\n(\|[\s:|-]+\|)\r?\n((?:\|.+\|\r?\n?)+)/gm,
        (match, headerRow, separatorRow, bodyRows) => {
            // Parse alignment from separator row
            const alignments = separatorRow
                .split('|')
                .filter((c: string) => c.trim())
                .map((c: string) => {
                    const trimmed = c.trim();
                    if (trimmed.startsWith(':') && trimmed.endsWith(':')) return 'center';
                    if (trimmed.endsWith(':')) return 'right';
                    return 'left';
                });

            // Parse header
            const headers = headerRow
                .split('|')
                .filter((c: string) => c.trim() !== '')
                .map((c: string) => c.trim());

            let tableHtml =
                '<div class="table-wrapper" style="overflow-x:auto;"><table><thead><tr>';
            headers.forEach((h: string, i: number) => {
                const align = alignments[i] || 'left';
                tableHtml += `<th style="text-align:${align}">${h}</th>`;
            });
            tableHtml += '</tr></thead><tbody>';

            // Parse body rows
            const rows = bodyRows.trim().split('\n');
            rows.forEach((row: string) => {
                const cells = row
                    .split('|')
                    .filter((c: string) => c.trim() !== '')
                    .map((c: string) => c.trim());
                tableHtml += '<tr>';
                cells.forEach((cell: string, i: number) => {
                    const align = alignments[i] || 'left';
                    tableHtml += `<td style="text-align:${align}">${cell}</td>`;
                });
                tableHtml += '</tr>';
            });

            tableHtml += '</tbody></table></div>';
            return tableHtml;
        }
    );

    // Horizontal rules
    html = html.replace(/^---+$/gm, '<hr />');

    // Unordered lists
    html = html.replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>');
    html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

    // Ordered lists
    html = html.replace(/^\d+\.\s+(.+)$/gm, '<oli>$1</oli>');
    html = html.replace(/((?:<oli>.*<\/oli>\n?)+)/g, (match) => {
        return '<ol>' + match.replace(/<\/?oli>/g, (tag) => tag.replace('oli', 'li')) + '</ol>';
    });

    // Paragraphs — wrap remaining text lines
    html = html.replace(/^(?!<[a-z/]|%%)(.*\S.*)$/gm, '<p>$1</p>');

    // Remove empty paragraphs
    html = html.replace(/<p>\s*<\/p>/g, '');

    // Restore code blocks
    codeBlocks.forEach((code, i) => {
        const escaped = code
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        html = html.replace(
            `%%CODEBLOCK_${i}%%`,
            `<pre><code>${escaped.trim()}</code></pre>`
        );
    });

    inlineCode.forEach((code, i) => {
        const escaped = code
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        html = html.replace(`%%INLINECODE_${i}%%`, `<code>${escaped}</code>`);
    });

    // Sanitize HTML to prevent XSS
    html = sanitizeHtml(html, BLOG_SANITIZE_CONFIG);

    return html;
}

// Shared sanitize-html config so the post-autoLink re-sanitize pass below
// uses the exact same allowedTags/allowedAttributes as the initial pass —
// otherwise we'd silently strip legitimate markup added by the auto-linkers.
const BLOG_SANITIZE_CONFIG: sanitizeHtml.IOptions = {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
        'img', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'code', 'hr',
        'table', 'thead', 'tbody', 'tr', 'th', 'td', 'div',
    ]),
    allowedAttributes: {
        ...sanitizeHtml.defaults.allowedAttributes,
        '*': ['id', 'class', 'style'],
        'img': ['src', 'alt', 'loading', 'width', 'height'],
        'a': ['href', 'target', 'rel'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
};

/**
 * Re-sanitize blog post HTML after autoLinkStates / autoLinkCategories.
 *
 * Why: those functions inject <a> tags into already-sanitized HTML using
 * regex — defense-in-depth says any text-in-attribute false positive that
 * slips past the negative-lookbehind would bypass the original sanitize-
 * html step. Applying the same config a second time catches it.
 *
 * The auto-linkers only emit well-formed <a href class> tags that
 * BLOG_SANITIZE_CONFIG already allows, so legitimate output passes
 * through unchanged.
 */
export function resanitizeBlogHtml(html: string): string {
    return sanitizeHtml(html, BLOG_SANITIZE_CONFIG);
}

// ─── Auto-link State Mentions ────────────────────────────────────────────────

const STATE_MAP: Record<string, string> = {
    'Alabama': 'alabama', 'Alaska': 'alaska', 'Arizona': 'arizona',
    'Arkansas': 'arkansas', 'California': 'california', 'Colorado': 'colorado',
    'Connecticut': 'connecticut', 'Delaware': 'delaware', 'Florida': 'florida',
    'Georgia': 'georgia', 'Hawaii': 'hawaii', 'Idaho': 'idaho',
    'Illinois': 'illinois', 'Indiana': 'indiana', 'Iowa': 'iowa',
    'Kansas': 'kansas', 'Kentucky': 'kentucky', 'Louisiana': 'louisiana',
    'Maine': 'maine', 'Maryland': 'maryland', 'Massachusetts': 'massachusetts',
    'Michigan': 'michigan', 'Minnesota': 'minnesota', 'Mississippi': 'mississippi',
    'Missouri': 'missouri', 'Montana': 'montana', 'Nebraska': 'nebraska',
    'Nevada': 'nevada', 'New Hampshire': 'new-hampshire', 'New Jersey': 'new-jersey',
    'New Mexico': 'new-mexico', 'New York': 'new-york', 'North Carolina': 'north-carolina',
    'North Dakota': 'north-dakota', 'Ohio': 'ohio', 'Oklahoma': 'oklahoma',
    'Oregon': 'oregon', 'Pennsylvania': 'pennsylvania', 'Rhode Island': 'rhode-island',
    'South Carolina': 'south-carolina', 'South Dakota': 'south-dakota',
    'Tennessee': 'tennessee', 'Texas': 'texas', 'Utah': 'utah',
    'Vermont': 'vermont', 'Virginia': 'virginia', 'Washington': 'washington',
    'West Virginia': 'west-virginia', 'Wisconsin': 'wisconsin', 'Wyoming': 'wyoming',
    'District of Columbia': 'district-of-columbia',
};

export function autoLinkStates(html: string): string {
    const linked = new Set<string>();

    for (const [stateName, slug] of Object.entries(STATE_MAP)) {
        if (linked.has(stateName)) continue;

        // Only replace in text content, not inside tags or existing links
        const regex = new RegExp(
            `(?<!["/\\w-])\\b${stateName.replace(/\s/g, '\\s')}\\b(?![^<]*>)(?![^<]*<\\/a>)`,
            'g'
        );

        if (regex.test(html)) {
            // Only link the first occurrence
            let replaced = false;
            html = html.replace(regex, (match) => {
                if (replaced) return match;
                replaced = true;
                linked.add(stateName);
                return `<a href="/jobs/state/${slug}" class="text-pink-700 hover:underline">${match}</a>`;
            });
        }
    }

    return html;
}

// ─── Extract Headings for TOC ────────────────────────────────────────────────

export function extractHeadings(
    markdown: string
): { level: number; text: string; id: string }[] {
    const headings = markdown.match(/^#{2,3}\s.+/gm);
    if (!headings) return [];

    return headings.map((heading) => {
        const level = heading.startsWith('###') ? 3 : 2;
        const text = heading.replace(/^#{2,3}\s/, '');
        const id = text
            .toLowerCase()
            .replace(/[^\w\s-]/g, '')
            .replace(/\s+/g, '-');
        return { level, text, id };
    });
}
