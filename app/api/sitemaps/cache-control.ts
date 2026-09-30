/**
 * The one CDN caching policy for every sitemap (indexing audit CS-09).
 *
 * The sitemaps regenerate hourly (app/sitemap.ts `revalidate = 3600`; the
 * /api/sitemaps routes compute per request), so the CDN holds a copy for the
 * same hour and serves a stale one for at most ten minutes while it
 * refreshes. vercel.json used to pin s-maxage=86400 with a week of
 * stale-while-revalidate on /sitemap.xml and /api/sitemaps/*, which could
 * keep offering Google job URLs that already answer 410 and pSEO pages that
 * had just turned noindex. vercel.json now sets exactly this value on
 * /sitemap.xml (the one sitemap whose headers Next writes) and no override on
 * /api/sitemaps/*, whose handlers send it themselves; the index sends
 * `no-store` instead when a count failed. Pinned by
 * tests/regressions/sitemap-content-lastmod.test.ts.
 */
export const SITEMAP_CACHE_CONTROL = 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=600';
