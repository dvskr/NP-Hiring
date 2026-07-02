/**
 * lib/pseo/taxonomy-registry.ts
 *
 * SINGLE SOURCE OF TRUTH for the category taxonomy that was previously
 * duplicated across seven places (app/sitemap.ts axis arrays, middleware
 * STATE/CITY-eligible sets, /api/sitemaps/index + /api/sitemaps/cities
 * SITEMAP_CATEGORIES, /api/cron/index-pseo PSEO_INDEXING_CATEGORIES, and
 * the physical app/jobs/<slug>/ folders). Any taxonomy change happens
 * HERE; the drift test (tests/seo/jobs-segments-drift.test.ts) enforces
 * agreement with the physical route folders via JOBS_TOP_SEGMENTS.
 *
 * EDGE-SAFE: plain data only — middleware imports this transitively.
 *
 * IMPORTANT FOR FORKS: these slugs are live indexed URLs. Removing or
 * renaming a slug on an existing board without a 301 kills indexed SEO
 * pages. New boards define their own axes/slugs here AND create the
 * matching app/jobs/<slug>/ folders (the drift test fails until both
 * sides agree).
 */

/**
 * Category slugs grouped by taxonomy axis. The union of all axes is the
 * full set of category landing pages under app/jobs/<slug>/.
 */
export const CATEGORY_AXES = {
    setting: ['remote', 'telehealth', 'inpatient', 'outpatient', 'travel'],
    jobType: ['full-time', 'part-time', 'contract'],
    specialty: [
        'addiction', 'child-adolescent', 'substance-abuse', 'new-grad',
        'per-diem', 'locum-tenens', 'correctional', '1099', 'behavioral-health',
    ],
    experience: ['entry-level', 'mid-career', 'senior'],
    employerType: ['hospital', 'private-practice', 'community-health', 'va'],
    population: ['geriatric', 'veterans', 'lgbtq', 'crisis'],
} as const;

/** All 28 category landing-page slugs (union of the axes). */
export const ALL_CATEGORY_SLUGS: readonly string[] = Object.values(CATEGORY_AXES).flat();

/**
 * Categories with a /jobs/<category>/[state] sub-route (13 physical
 * `[state]` folders). Middleware 410s state URLs outside this set.
 */
export const STATE_ELIGIBLE_CATEGORY_SLUGS: readonly string[] = [
    'remote', 'telehealth', 'inpatient', 'outpatient', 'travel',
    'full-time', 'part-time', 'contract',
    'addiction', 'new-grad', '1099', 'behavioral-health', 'correctional',
];

/**
 * Categories with a /jobs/<category>/city/[slug] sub-route. Currently
 * every category page is city-eligible; middleware 410s city URLs
 * outside this set.
 */
export const CITY_ELIGIBLE_CATEGORY_SLUGS: readonly string[] = ALL_CATEGORY_SLUGS;

/**
 * Categories whose category×city URLs are submitted to the Google
 * Indexing API by cron/index-pseo. Deliberately the state-eligible set
 * MINUS 'correctional' — the 100/day pSEO indexing quota is spent on the
 * highest-demand categories first (correctional pages still appear in
 * sitemaps; they're just not priority-pushed through the API).
 */
export const PSEO_INDEXING_CATEGORY_SLUGS: readonly string[] =
    STATE_ELIGIBLE_CATEGORY_SLUGS.filter((slug) => slug !== 'correctional');

/**
 * Non-category namespace segments under /jobs/ (dynamic routes and
 * utility pages) — together with ALL_CATEGORY_SLUGS these make up
 * JOBS_TOP_SEGMENTS in jobs-segments-edge.ts.
 */
export const JOBS_NAMESPACE_SEGMENTS: readonly string[] = [
    'city', 'state', 'metro', 'locations', 'edit',
];
