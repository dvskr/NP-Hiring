/**
 * Image SEO for the sitemaps (indexing audit FB-4, CS-01, TECH-01, CQ-04,
 * B-01, fixSoon 15).
 *
 * The standalone /image-sitemap.xml is retired: it listed a page for every
 * state diorama and every static route with no index gate, so it offered
 * Google 52 noindex pages (/post-job, /job-alerts and the thin state hubs and
 * salary guides) and 14 that 404, plus /api/og text cards with no image
 * search value. Its route is deleted (the URL answers 404, the documented way
 * to make Google drop a sitemap it already knows) and robots.txt no longer
 * lists it.
 *
 * The one image with search value, the state diorama, now rides on the
 * primary sitemap entries that already passed their index gate: app/sitemap.ts
 * attaches it (MetadataRoute.Sitemap `images`, emitted as
 * <image:image><image:loc>) to the gated /jobs/state/{slug} and
 * /salary-guide/{slug} entries, the two pages that render it. An image can
 * therefore never be offered for a page Google should not index, and there is
 * no second list to drift from the gates.
 */

// The diorama path comes from the component both state surfaces render
// (app/jobs/state/[state], app/salary-guide/[state]). That module owns the
// slug to artwork contract and is pinned against the real directory listing
// by tests/regressions/p2-state-imagery-diorama-wiring.test.ts.
import { stateDioramaSrc } from '@/components/StateImage';

/**
 * The absolute image URLs a state page's sitemap entry carries: its diorama,
 * or none when no artwork ships for the slug.
 */
export function stateDioramaSitemapImages(stateSlug: string, baseUrl: string): string[] {
    const src = stateDioramaSrc(stateSlug);
    return src ? [`${baseUrl.replace(/\/+$/, '')}${src}`] : [];
}
