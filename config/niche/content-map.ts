/**
 * Niche content map — the per-niche lists of AUTHORED blog slugs that
 * CODE links to (as opposed to links written inside authored copy).
 * This file is DATA ONLY; the selection and rendering logic stays in
 * the consuming components.
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
 *                            404.
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
    always: ['pmhnp-salary-guide-2026'],
    remoteOrTelehealth: [
        'telehealth-pmhnp-guide',
        'ultimate-guide-remote-pmhnp-jobs-2026',
    ],
    newGrad: [
        'new-grad-pmhnp-first-job',
        '5-tips-new-grad-pmhnp-job-market',
    ],
    generalFallback: [
        'pmhnp-interview-questions',
        'pmhnp-salary-negotiation',
    ],
};

/** One row of the homepage "From the blog" section. */
export interface FeaturedBlogPost {
    category: string;
    title: string;
    description: string;
    href: string;
}

/**
 * The six posts featured on the homepage, rendered in order by
 * components/HomepageBlogSection.tsx. hrefs must point at published
 * posts in content/blog/.
 */
export const HOMEPAGE_FEATURED_POSTS: FeaturedBlogPost[] = [
    {
        category: 'Salary Guide',
        title: 'PMHNP Salary Guide 2026: State-by-State Analysis',
        description: 'Data from 8,500+ job postings reveals top-paying states, specialty premiums, and negotiation strategies that can add $15K–$25K to your offer.',
        href: '/blog/pmhnp-salary-guide-2026',
    },
    {
        category: 'Career Path',
        title: 'How to Become a PMHNP: The Complete Roadmap',
        description: 'From BSN to board certification — every step, timeline, and insider tip for launching your psychiatric NP career in 2026.',
        href: '/blog/how-to-become-a-pmhnp',
    },
    {
        category: 'Job Market',
        title: 'PMHNP Job Outlook: 45% Growth Through 2032',
        description: '123 million Americans live in mental health shortage areas. Here\'s what that means for your career trajectory and earning potential.',
        href: '/blog/pmhnp-job-outlook',
    },
    {
        category: 'Remote Work',
        title: 'The Ultimate Guide to Remote PMHNP Jobs',
        description: '62% of psych NP positions now offer telehealth. Find out which companies pay $130K–$200K for remote psychiatric care.',
        href: '/blog/ultimate-guide-remote-pmhnp-jobs-2026',
    },
    {
        category: 'New Graduates',
        title: 'New Grad PMHNP: Landing Your First Role',
        description: 'Residency programs, interview prep, salary benchmarks, and the resume strategies that get callbacks within 48 hours.',
        href: '/blog/new-grad-pmhnp-guide-2026',
    },
    {
        category: 'Private Practice',
        title: 'PMHNP Private Practice Income: What to Expect',
        description: 'Cash-pay vs insurance, overhead costs, and how practice owners in FPA states are clearing $200K–$300K+ annually.',
        href: '/blog/pmhnp-private-practice-income-2026',
    },
];
