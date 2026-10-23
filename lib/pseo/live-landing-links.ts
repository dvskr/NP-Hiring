/**
 * lib/pseo/live-landing-links.ts
 *
 * Whether a hard-coded link to a category landing (/jobs/{category}) may be
 * printed: never while the landing answers 404. A landing with 0 jobs calls
 * notFound() (TECH-06), and render-gate.ts asks every link to a landing to
 * follow that count. A landing with a few jobs renders `noindex, follow`, so
 * links to it stay; only the navigation surfaces (the footer, the /jobs hub)
 * hold out for indexable landings (lib/pseo/landing-verdicts.ts).
 *
 * Register 2.25: on 2026-10-22 the AGACNP vs AGPCNP post linked
 * /jobs/adult-gerontology, and the private practice guide and the private
 * practice income calculator linked /jobs/private-practice, while both
 * landings answered 404.
 *
 * `empty` is loadEmptyLandingSlugs(): the landings whose fresh stats row
 * counts no job. Null (the read failed) keeps every link, and a landing with
 * no fresh row is not in the set, so a stalled cron never strips links.
 * Tests: tests/regressions/live-landing-links.test.ts
 */
import { brand } from '@/config/brand';
import { ALL_CATEGORY_SLUGS } from './taxonomy-registry';

const LANDING_SLUGS: ReadonlySet<string> = new Set(ALL_CATEGORY_SLUGS);

/**
 * The category landing `href` points at: /jobs/{landing}, written relative or
 * absolute on this site, with or without a trailing slash, query or fragment.
 */
export function landingSlugOf(href: string): string | null {
    const path = href.startsWith(brand.baseUrl) ? href.slice(brand.baseUrl.length) : href;
    const match = /^\/jobs\/([a-z0-9-]+)\/?(?:[?#].*)?$/.exec(path);
    return match && LANDING_SLUGS.has(match[1]) ? match[1] : null;
}

/** True unless `href` is a category landing known to be empty. */
export function mayLinkLanding(href: string, empty: ReadonlySet<string> | null): boolean {
    const slug = landingSlugOf(href);
    return slug === null || empty === null || !empty.has(slug);
}

/** Rendered HTML with each link to a landing known to be empty replaced by its words. */
export function unlinkClosedLandings(html: string, empty: ReadonlySet<string> | null): string {
    return html.replace(
        /<a\b[^>]*?\bhref=(["'])([^"']*)\1[^>]*>([\s\S]*?)<\/a>/g,
        (link: string, _quote: string, href: string, words: string) => (mayLinkLanding(href, empty) ? link : words),
    );
}
