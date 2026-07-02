/**
 * Niche content map — the per-niche lists of AUTHORED blog slugs that
 * CODE links to (as opposed to links written inside authored copy).
 * This file is DATA ONLY; the selection and rendering logic stays in
 * the consuming components.
 *
 * ── NP HIRING LAUNCH STATUS (2026-07-02) ─────────────────────────────
 * This board has NO authored blog content yet (content/blog/ posts are
 * inherited PMHNP articles slated for removal; the donor NP board also
 * launched with an empty blog). Every slug list below is therefore
 * EMPTY, and the license-guide series is gated OFF via
 * LICENSE_GUIDE_SERIES_PUBLISHED until the series is written. The
 * consumers handle empty gracefully:
 *   - components/RelatedBlogPosts.tsx returns null for zero posts;
 *   - components/HomepageBlogSection.tsx returns null for an empty
 *     featured list (mirrors the donor's "no dead links" launch state);
 *   - the pSEO/salary-guide licensure links render only when
 *     LICENSE_GUIDE_SERIES_PUBLISHED is true.
 * Seeding 5–10 NP posts and flipping these lists back on is a
 * post-launch content task.
 *
 * ── WHAT EACH MAP FEEDS ───────────────────────────────────────────────
 *   RELATED_BLOG_SLUGS       getRelevantBlogSlugs() in
 *                            components/RelatedBlogPosts.tsx — the
 *                            "Career Resources" sidebar on job detail
 *                            pages (app/jobs/[slug]/page.tsx). Slugs
 *                            are resolved through getPostBySlug(), so
 *                            a missing post silently drops out of the
 *                            sidebar rather than 404ing.
 *   HOMEPAGE_FEATURED_POSTS  components/HomepageBlogSection.tsx — the
 *                            "From the blog" section on the homepage.
 *                            These render as direct <Link> hrefs, so a
 *                            missing post is a live sitewide internal
 *                            404. Keep EMPTY until posts exist.
 *
 * ── FOR FORKS ─────────────────────────────────────────────────────────
 * Every slug listed here MUST exist as a post in content/blog/ or the
 * links 404. When re-niching the board, replace every slug below (and
 * the homepage titles/descriptions/categories) with your own authored
 * posts. Consider a future drift test that asserts each slug in this
 * file resolves to a real post in content/blog/.
 */

/**
 * Slug groups for the job-page "Career Resources" sidebar, keyed by the
 * job attribute that makes them relevant. Selection order and the
 * 3-post cap live in getRelevantBlogSlugs() in
 * components/RelatedBlogPosts.tsx.
 *
 * NP HIRING: all groups EMPTY — no NP posts authored yet. With every
 * group empty the sidebar renders nothing (RelatedBlogPosts returns
 * null on zero posts). Populate as NP guides are published (salary
 * guide first — it's the `always` slot).
 */
export const RELATED_BLOG_SLUGS: {
    /** Always included on every job page. */
    always: string[];
    /** Added when the job is remote or telehealth. */
    remoteOrTelehealth: string[];
    /** Added when the job targets new graduates. */
    newGrad: string[];
    /** General career guides used to fill up to 3 posts. */
    generalFallback: string[];
} = {
    always: [],
    remoteOrTelehealth: [],
    newGrad: [],
    generalFallback: [],
};

/**
 * Slug prefix of the state-licensure blog series ('np-license-alabama'
 * … 'np-license-wyoming', 50 states + DC).
 *
 * ⚠️ NP HIRING: this series is UNWRITTEN — the prefix is reserved, but
 * zero posts exist under it. All code-derived links to the series are
 * gated behind LICENSE_GUIDE_SERIES_PUBLISHED (below) so nothing links
 * to it until it ships. CODE derives links and lookups from this prefix
 * in four places:
 *   - lib/pseo/category-city-template.tsx (a link on EVERY category×city page)
 *   - app/salary-guide/[state]/page.tsx (related-guide link)
 *   - app/blog/[slug]/page.tsx (license-post detection for related content)
 *   - app/resources/page.tsx (series listing)
 * The blog-side consumers (detection/listing) are lookup-only and simply
 * match nothing while the series is empty.
 * Keep the value free of regex metacharacters (it is compiled into a RegExp).
 */
export const LICENSE_GUIDE_SLUG_PREFIX = 'np-license-';

/**
 * Master gate for every CODE-rendered link into the license-guide
 * series. While false, the licensure links on category×city pSEO pages
 * and salary-guide state pages are NOT rendered (they would otherwise
 * be internal 404s at pSEO scale — the category×city template alone
 * links from ~100K+ pages).
 *
 * FLIP TO true ONLY once all 51 posts ('np-license-<state-slug>' for
 * every state slug + district-of-columbia) exist in content/blog/ —
 * partial publication still 404s the missing states.
 */
export const LICENSE_GUIDE_SERIES_PUBLISHED = false;

/** Build the license-guide slug for a state slug (e.g. 'california'). */
export function licenseGuideSlug(stateSlug: string): string {
    return `${LICENSE_GUIDE_SLUG_PREFIX}${stateSlug}`;
}

/** Regex matching a license-guide slug, capturing the state slug. */
export const LICENSE_GUIDE_SLUG_REGEX = new RegExp(`^${LICENSE_GUIDE_SLUG_PREFIX}(.+)$`);

/** One row of the homepage "From the blog" section. */
export interface FeaturedBlogPost {
    category: string;
    title: string;
    description: string;
    href: string;
}

/**
 * Posts featured on the homepage, rendered in order by
 * components/HomepageBlogSection.tsx. hrefs must point at published
 * posts in content/blog/.
 *
 * NP HIRING: EMPTY — no NP posts authored yet. The component returns
 * null for an empty list, so the homepage simply skips the section (no
 * dead links, no empty chrome). Populate with six NP posts once the
 * initial content batch ships.
 */
export const HOMEPAGE_FEATURED_POSTS: FeaturedBlogPost[] = [];
