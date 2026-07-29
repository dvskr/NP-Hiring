/**
 * Niche content map — the per-niche lists of AUTHORED blog slugs that
 * CODE links to (as opposed to links written inside authored copy).
 * This file is DATA ONLY; the selection and rendering logic stays in
 * the consuming components.
 *
 * ── NP HIRING CONTENT STATUS (2026-07-29, P1 #2/#3) ──────────────────
 * The launch content batch is authored:
 *   - Six evergreen NP posts live as .mdx in content/blog/ and are
 *     wired into every slug list below. They serve from the blog_posts
 *     table — run `npx tsx scripts/sync-blog-to-db.ts` against prod
 *     BEFORE deploying this file so the homepage links resolve.
 *   - The 51-post licensure series is generated deterministically from
 *     lib/blog-license-guides.ts and served by lib/blog.ts as a code
 *     fallback (DB rows, synced via `npx tsx scripts/sync-blog-to-db.ts
 *     --license-guides`, take precedence). Because all 51 render from
 *     code, LICENSE_GUIDE_SERIES_PUBLISHED is now true — the gate can
 *     never 404 a subset of states.
 * The consumers still handle empty gracefully (RelatedBlogPosts /
 * HomepageBlogSection return null on empty lists) for future forks.
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
 * NP HIRING: populated with the six-post seed batch in content/blog/
 * (P1 #3). Slugs resolve through getPostBySlug(), so until the sync
 * script has run against prod a missing post silently drops out of the
 * sidebar rather than 404ing.
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
    always: ['np-salary-guide'],
    remoteOrTelehealth: ['remote-telehealth-np-jobs-guide'],
    newGrad: ['new-grad-np-first-job'],
    generalFallback: [
        'highest-paying-np-specialties',
        'fnp-vs-pmhnp-vs-agacnp',
        'np-1099-vs-w2',
    ],
};

/**
 * Slug prefix of the state-licensure blog series ('np-license-alabama'
 * … 'np-license-wyoming', 50 states + DC).
 *
 * NP HIRING: the series is AUTHORED — all 51 posts generate
 * deterministically from lib/blog-license-guides.ts (practice authority,
 * NLC membership, board links, cited salary stats) and are served by
 * lib/blog.ts, with DB rows as editorial overrides. CODE derives links
 * and lookups from this prefix in four places:
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
 * TRUE since 2026-07-29 (P1 #2): all 51 posts render deterministically
 * from lib/blog-license-guides.ts via the getPostBySlug() fallback in
 * lib/blog.ts, so partial publication is structurally impossible — the
 * all-or-nothing property is enforced by
 * tests/regressions/p1-content-library-license-guides.test.ts (one
 * guide per STATE_PRACTICE_AUTHORITY jurisdiction, and this flag may
 * only be true while that holds).
 *
 * The same suite also gates the DATA these pages assert: the number of
 * jurisdictions classified 'full' in lib/state-practice-authority.ts
 * must equal the figure the series publishes on its own pages
 * (STAT_SOURCES.fullPracticeStates, "27 states + DC"). Flipping this
 * flag while those disagree ships a self-contradiction — a state's guide
 * telling readers a collaborative agreement is required while the same
 * page's FPA count says otherwise — so the flag and the classification
 * set move together.
 */
export const LICENSE_GUIDE_SERIES_PUBLISHED = true;

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
 * NP HIRING: populated with the six-post seed batch (P1 #3). These are
 * direct <Link> hrefs — run `npx tsx scripts/sync-blog-to-db.ts` against
 * prod before deploying, or these become live internal 404s.
 */
export const HOMEPAGE_FEATURED_POSTS: FeaturedBlogPost[] = [
    {
        category: 'Salary',
        title: 'Nurse Practitioner Salary Guide: How NP Pay Really Works',
        description: 'The national median, the ranges behind it, and the five factors that move NP pay most.',
        href: '/blog/np-salary-guide',
    },
    {
        category: 'Remote Work',
        title: 'Remote and Telehealth NP Careers',
        description: 'Licensure across state lines, the Nurse Licensure Compact, and what virtual roles pay.',
        href: '/blog/remote-telehealth-np-jobs-guide',
    },
    {
        category: 'New Grad',
        title: 'How to Land Your First NP Job as a New Grad',
        description: 'Where new-grad-friendly jobs are, what they pay, and how to evaluate onboarding support.',
        href: '/blog/new-grad-np-first-job',
    },
    {
        category: 'Salary',
        title: 'The Highest-Paying NP Specialties, Compared',
        description: 'CRNA, acute care, emergency, and behavioral health — and the reasons behind every premium.',
        href: '/blog/highest-paying-np-specialties',
    },
    {
        category: 'Career Paths',
        title: 'FNP vs PMHNP vs AGACNP: Choosing Your NP Specialty',
        description: 'Patient populations, settings, certification paths, and pay for the three biggest NP tracks.',
        href: '/blog/fnp-vs-pmhnp-vs-agacnp',
    },
    {
        category: 'Contracts',
        title: '1099 vs W-2 for Nurse Practitioners',
        description: 'The real take-home math once taxes, malpractice, benefits, and retirement are priced in.',
        href: '/blog/np-1099-vs-w2',
    },
];
