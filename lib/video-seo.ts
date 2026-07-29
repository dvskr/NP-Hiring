/*
 * FORK-NOTE: This is a per-board content-pack DATA file — a route →
 * video SEO map whose titles, descriptions, and underlying recordings are
 * all niche- and board-specific. Forks must regenerate every entry (and
 * the recordings/thumbnails themselves) for their own board.
 *
 * NP HIRING STATUS (2026-07-03): the donor's mapped .webm files were
 * donor-era UI recordings (old brand, old copy, old inventory) that lived
 * in public/videos/. Publishing them would attach stale, wrong-brand video
 * to this board's VideoObject JSON-LD, so those recordings were DELETED
 * from public/videos/ and this map is intentionally EMPTY. Repopulate it
 * route-by-route once fresh scroll recordings of THIS board's pages exist.
 *
 * ── WHY AN EMPTY MAP IS HONEST, NOT BROKEN (verified P3 #1) ───────────
 * There is exactly ONE consumer of this map today:
 *   • components/VideoJsonLd.tsx — calls getPageVideoSEO(pathname) and
 *     returns null for unmapped routes, so the seven pages that mount it
 *     (/, /about, /faq, /blog, /resources, /salary-guide,
 *     /for-job-seekers) currently emit NO VideoObject at all. Correct:
 *     claiming a VideoObject with no playable contentUrl is exactly the
 *     kind of unverifiable markup that earns a structured-data penalty.
 *
 * The video sitemap does NOT read this map. app/video-sitemap.xml/route.ts
 * lists only YouTube-backed blog posts (blog_posts.youtube_video_id), by
 * deliberate design — Google requires video to be a page's PRIMARY content,
 * which a scroll recording embedded as page decoration never is. So no
 * sitemap entry can ever advertise a file that is missing from
 * public/videos/, and app/robots.ts can keep advertising
 * /video-sitemap.xml unconditionally: with no YouTube-backed posts the
 * route still returns a well-formed, empty <urlset> (0 URLs is a valid
 * sitemap, not a fetch error).
 *
 * ── WHAT A RECORDING DROP-IN NEEDS (human task — out of agent scope) ──
 * Recording the walkthroughs requires a human with the running app. Per
 * route, the map expects six fields (see PageVideoSEO below):
 *   1. a real file at public/videos/<page>-scroll.webm  ← must exist first;
 *      an entry pointing at a missing file is a dead contentUrl/embedUrl,
 *      which is worse than no VideoObject;
 *   2. a thumbnail that also resolves — use a local /images/** path; the
 *      donor's remote asset bucket was purged in P1 #1 and 404s;
 *   3. title + description written for THIS board (brand.niche tokens, no
 *      donor copy);
 *   4. duration = the recording's ACTUAL length in whole seconds
 *      (VideoJsonLd emits it as `PT<duration>S`; an invented number is a
 *      mismatch Google can and does check against the file);
 *   5. uploadDate = ISO 8601 WITH a time zone.
 * Adding entries needs no code change here or in VideoJsonLd.tsx. Note
 * the sitemap caveat above: mapping a route lights up its VideoObject
 * JSON-LD only — self-hosted scroll recordings stay OUT of the video
 * sitemap on purpose.
 */

/**
 * Video SEO Configuration
 *
 * Maps site routes to their scroll-recording video, title, description,
 * thumbnail, and estimated duration for use in video sitemap and
 * VideoObject JSON-LD.
 *
 * Entry template (see the donor board's lib/video-seo.ts for fully
 * populated examples). Both paths are LOCAL and must resolve under
 * public/ — the donor's remote storage bucket was purged in P1 #1, so a
 * remote thumbnail example here would only reintroduce a dead URL:
 *
 *   '/': {
 *       video: '/videos/<page>-scroll.webm',
 *       thumbnail: '/images/<section>/<page>.webp',
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
 * Get all page video entries.
 *
 * NO CURRENT CONSUMERS (verified P3 #1). Kept as the read API for the map,
 * but do NOT wire it into app/video-sitemap.xml/route.ts: that route
 * deliberately lists only YouTube-backed blog posts, because self-hosted
 * page-scroll recordings are secondary page content and Google filters
 * them out. Returns [] while PAGE_VIDEO_SEO is empty, so a caller that
 * did wire it up would advertise nothing rather than anything false.
 */
export function getAllPageVideos(): Array<{ url: string } & PageVideoSEO> {
    return Object.entries(PAGE_VIDEO_SEO).map(([url, seo]) => ({ url, ...seo }));
}
