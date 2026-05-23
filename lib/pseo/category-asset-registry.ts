/**
 * Category visual assets — STUB.
 *
 * The PMHNP fork shipped a 670-line registry tied to a specific Supabase
 * project's storage bucket. Those URLs don't resolve for this fork.
 *
 * Phase 8 will replace this stub with NP-specific category hero images,
 * bento layouts, and explore cards uploaded to the new Supabase bucket.
 * Until then the pSEO templates render without category-specific imagery
 * but still produce valid pages.
 */

export interface ExploreCard {
    href: string;
    label: string;
    sub: string;
    icon: string;
}

export interface CategoryAssets {
    heroImage: string;
    bgColor: string;
    bentoSectionLabel: string;
    bentoImages: string[];
    bentoIcons: string[];
    exploreCards: ExploreCard[];
}

/**
 * Default fallback assets used when a category has no entry. Safe to
 * render — empty arrays for image lists, a neutral background colour,
 * and a generic section label. Hero image is an empty string; callers
 * already handle that gracefully (image just doesn't render).
 */
const DEFAULT_ASSETS: CategoryAssets = {
    heroImage: '',
    bgColor: '#f5f0eb',
    bentoSectionLabel: 'Why This Specialty',
    bentoImages: [],
    bentoIcons: [],
    exploreCards: [],
};

/**
 * Per-category overrides. Add entries in Phase 8 as real assets are
 * uploaded. Empty for now — every category falls through to DEFAULT_ASSETS.
 */
export const CATEGORY_ASSET_REGISTRY: Record<string, CategoryAssets> = {};

/**
 * Convenience getter — returns the override if present, falls back to
 * defaults. Callers should use this instead of indexing the registry
 * directly so they always get a non-undefined value.
 */
export function getCategoryAssets(slug: string): CategoryAssets {
    return CATEGORY_ASSET_REGISTRY[slug] ?? DEFAULT_ASSETS;
}
