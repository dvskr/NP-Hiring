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
 * ── NP HIRING (2026-07-02) ────────────────────────────────────────────
 * Taxonomy replaced with the donor NP board's 42 canonical category
 * slugs (its CANONICAL_CATEGORY_SLUGS in lib/pseo/category-tagger.ts;
 * axis grouping mirrors its app/sitemap.ts axis arrays — note the donor
 * runbook said "41 slugs" but its source of truth listed 42).
 * Eligibility mirrors the donor's middleware allowlists:
 *   - STATE-eligible: its 21-slug STATE_ELIGIBLE_TAXONOMIES set;
 *   - CITY-eligible: all 42 (its CITY_ELIGIBLE_TAXONOMIES was the full
 *     taxonomy — category×city is the ~165k-URL pSEO surface);
 *   - PSEO indexing: 12 broad, high-coverage categories (the donor cron's
 *     "only submit broad categories with meaningful city-level coverage"
 *     intent, mapped onto NP slugs — its own cron list still carried
 *     stale pre-fork slugs).
 *
 * ✅ Route-folder migration COMPLETE: the physical app/jobs/<slug>/
 * folders and the JOBS_TOP_SEGMENTS set in jobs-segments-edge.ts now
 * match this registry (45 category folders + 5 namespace segments; the
 * 28 state-eligible slugs each have an [state] sub-folder). The drift
 * test (tests/seo/jobs-segments-drift.test.ts) enforces this and PASSES;
 * if it fails, a folder or registry entry changed without its
 * counterpart.
 *
 * IMPORTANT FOR FORKS: these slugs are live indexed URLs. Removing or
 * renaming a slug on an existing board without a 301 kills indexed SEO
 * pages. New boards define their own axes/slugs here AND create the
 * matching app/jobs/<slug>/ folders (the drift test fails until both
 * sides agree).
 *
 * ⚠️ DEPLOY STEP FOR ANY *NEW* SLUG — re-run the tag backfill:
 *     npx tsx scripts/backfill-category-tags.ts --force --apply
 * A new slug starts with zero rows carrying it in Job.categoryTags, and
 * withTagFallback()'s keyword fallback only rescues rows whose
 * categoryTags array is EMPTY (lib/pseo/category-tagger.ts). Every
 * already-backfilled row therefore stays invisible to the new category
 * until the classifier re-runs — the landing page renders a real but
 * empty result set (correctly noindexed by the zero-inventory gate, so
 * nothing thin gets indexed; it just has no inventory). The 2026-07
 * P1 #15 slugs (aesthetics, pain-management, palliative-hospice) are in
 * exactly that state until the backfill runs.
 */

/**
 * Category slugs grouped by taxonomy axis. The union of all axes is the
 * full set of category landing pages under app/jobs/<slug>/.
 */
export const CATEGORY_AXES = {
    /** Modality / setting (mode of practice). */
    setting: [
        'remote', 'telehealth', 'inpatient', 'outpatient', 'travel',
        'urgent-care', 'home-health',
    ],
    jobType: ['full-time', 'part-time', 'contract', 'per-diem', 'locum-tenens', '1099'],
    /** NP specialty — the heart of the NP board. */
    specialty: [
        'family-practice', 'adult-gerontology', 'pediatric', 'neonatal',
        'women-health', 'acute-care', 'emergency', 'psychiatric-mental-health',
        'oncology', 'cardiology', 'primary-care', 'hospitalist',
        'dermatology', 'orthopedic',
        // 2026-07 P1 #15: high-volume NP verticals. The content-gap
        // synthesis §7 that picked these was a session artifact (never
        // committed); its in-repo record — including the 8 verticals it
        // deferred pending live inventory checks — is
        // docs/PENDING_WORK.md §3.7.
        'aesthetics', 'pain-management', 'palliative-hospice',
    ],
    /** APRN cohort beyond NPs (CRNA / CNM / CNS). */
    aprn: ['anesthesia', 'midwifery', 'clinical-nurse-specialist'],
    experience: ['entry-level', 'new-grad', 'mid-career', 'senior'],
    employerType: ['hospital', 'private-practice', 'community-health', 'va', 'correctional'],
    population: ['geriatric', 'veterans', 'lgbtq'],
} as const;

/** All 45 category landing-page slugs (union of the axes). */
export const ALL_CATEGORY_SLUGS: readonly string[] = Object.values(CATEGORY_AXES).flat();

/**
 * Categories with a /jobs/<category>/[state] sub-route (28 physical
 * `[state]` folders). Middleware 410s state URLs outside this set.
 * Started from the donor's STATE_ELIGIBLE_TAXONOMIES (all modalities and
 * job types, the high-volume NP specialties where state-by-state demand
 * is real, the APRN roles whose state licensing genuinely varies, and
 * new-grad); extended 2026-07 (P1 #14) with the remaining high-demand
 * specialties + the urgent-care/home-health settings.
 *
 * Every slug here MUST have a matching entry in SETTING_CONFIGS
 * (lib/pseo/setting-state-config.ts) — the [state] template notFound()s
 * for keys without a config, which would 404 all 51 state pages.
 * tests/regressions/p1-taxonomy-expansion-registry.test.ts enforces this.
 */
export const STATE_ELIGIBLE_CATEGORY_SLUGS: readonly string[] = [
    'remote', 'telehealth', 'inpatient', 'outpatient', 'travel',
    'urgent-care', 'home-health',
    'full-time', 'part-time', 'contract', 'per-diem', 'locum-tenens', '1099',
    'family-practice', 'adult-gerontology', 'pediatric', 'women-health',
    'acute-care', 'emergency', 'psychiatric-mental-health',
    // 2026-07 P1 #14: high-demand specialties promoted to the [state] tier
    // ("primary care NP jobs in Texas" is a head query — content-gap
    // synthesis §7, recorded in-repo at docs/PENDING_WORK.md §3.7).
    'primary-care', 'oncology', 'cardiology', 'hospitalist', 'dermatology',
    'anesthesia', 'midwifery',
    'new-grad',
];

/**
 * Categories with a /jobs/<category>/city/[slug] sub-route. Every
 * category page is city-eligible (matching the donor, where the full
 * taxonomy carried the ~165k category×city URL surface); middleware
 * 410s city URLs outside this set.
 */
export const CITY_ELIGIBLE_CATEGORY_SLUGS: readonly string[] = ALL_CATEGORY_SLUGS;

/**
 * Categories whose category×city URLs are submitted to the Google
 * Indexing API by cron/index-pseo. A deliberate 12-slug subset of the
 * state-eligible set — the 100/day pSEO indexing quota goes to the
 * broadest, highest-demand categories first (all five core modalities,
 * the three main job types, 1099, new-grad, and the two highest-volume
 * NP specialties). Remaining categories still appear in sitemaps;
 * they're just not priority-pushed through the API.
 */
export const PSEO_INDEXING_CATEGORY_SLUGS: readonly string[] = [
    'remote', 'telehealth', 'inpatient', 'outpatient', 'travel',
    'full-time', 'part-time', 'contract', '1099', 'new-grad',
    'family-practice', 'psychiatric-mental-health',
];

/**
 * The psych/behavioral-health specialty slug, derived from the axis data
 * rather than written as a literal. Consumers that key narrative maps by
 * this slug (e.g. lib/pseo/city-narrative.ts) import THIS constant so the
 * reference-niche term stays confined to the registry, which already
 * carries the slug and is baselined by the niche-copy debt ratchet
 * (tests/regressions/niche-copy-debt.test.ts).
 */
export const PSYCH_SPECIALTY_SLUG: string | undefined =
    CATEGORY_AXES.specialty.find((slug) => slug.endsWith('-mental-health'));

/**
 * Non-category namespace segments under /jobs/ (dynamic routes and
 * utility pages) — together with ALL_CATEGORY_SLUGS these make up
 * JOBS_TOP_SEGMENTS in jobs-segments-edge.ts.
 */
export const JOBS_NAMESPACE_SEGMENTS: readonly string[] = [
    'city', 'state', 'metro', 'locations', 'edit',
];
