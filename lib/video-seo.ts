/*
 * FORK-NOTE: This is a per-board content-pack DATA file — a route →
 * video SEO map whose titles, descriptions, and underlying recordings are
 * all niche- and board-specific. Forks must regenerate every entry (and
 * the recordings/thumbnails themselves) for their own board.
 *
 * NP HIRING STATUS (2026-07-03): the donor's mapped .webm files were
 * PMHNP-era UI recordings (old brand, old copy, old inventory) that lived
 * in public/videos/. Publishing them would attach stale, wrong-brand video
 * to this board's VideoObject JSON-LD, so those recordings were DELETED
 * from public/videos/ and this map is intentionally EMPTY. Repopulate it
 * route-by-route once fresh scroll recordings of THIS board's pages exist.
 * An empty map is safe: components/VideoJsonLd.tsx renders nothing for
 * unmapped routes, and video sitemap consumers receive an empty list.
 */

/**
 * Video SEO Configuration
 *
 * Maps site routes to their scroll-recording video, title, description,
 * thumbnail, and estimated duration for use in video sitemap and
 * VideoObject JSON-LD.
 *
 * Entry template (see the donor board's lib/video-seo.ts for fully
 * populated examples):
 *
 *   '/': {
 *       video: '/videos/<page>-scroll.webm',
 *       thumbnail: `${brand.assets.storageBase}/storage/v1/object/public/site-assets/images/pages/<page>.webp`,
 *       title: '…',
 *       description: '…',
 *       duration: 20,
 *       // schema.org `uploadDate` must be ISO 8601 WITH a time zone —
 *       // date-only values ('2026-02-20') get flagged by GSC as
 *       // "Invalid datetime value" / "missing a time zone".
 *       uploadDate: '2026-01-01T00:00:00Z',
 *   },
 */

export interface PageVideoSEO {
    /** Path to video relative to public, e.g. /videos/homepage-scroll.webm */
    video: string;
    /** Path to thumbnail image (reuses WebP from image-seo) */
    thumbnail: string;
    /** Video title for sitemap and JSON-LD */
    title: string;
    /** Video description for sitemap and JSON-LD */
    description: string;
    /** Estimated duration in seconds */
    duration: number;
    /** Upload date in ISO 8601 format WITH time zone */
    uploadDate: string;
}

/**
 * Intentionally empty until this board records its own page walkthroughs —
 * see the NP HIRING STATUS note in the header.
 */
export const PAGE_VIDEO_SEO: Record<string, PageVideoSEO> = {};

/**
 * Get video SEO config for a given pathname.
 * Returns null if no video is mapped for this route.
 */
export function getPageVideoSEO(pathname: string): PageVideoSEO | null {
    return PAGE_VIDEO_SEO[pathname] ?? null;
}

/**
 * Get all page video entries for building the video sitemap.
 */
export function getAllPageVideos(): Array<{ url: string } & PageVideoSEO> {
    return Object.entries(PAGE_VIDEO_SEO).map(([url, seo]) => ({ url, ...seo }));
}
