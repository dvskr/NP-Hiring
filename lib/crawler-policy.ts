/**
 * Crawlers the site limits.
 *
 * Owner decision 2026-11-17: once the board passed 6,000 jobs, crawler bursts
 * re-rendered job pages faster than the database pool could serve them, and
 * readers got error pages. In one hour of production traffic
 * meta-externalagent (Meta AI) made 874 job-page requests, MJ12bot (Majestic)
 * 107 and Googlebot 9. The owner chose to block Majestic, slow Meta's AI
 * crawler, and leave Google, Bing, OpenAI, Anthropic and Perplexity open.
 *
 * Owner decision 2026-11-19 ("fix all of them"):
 *   - ShapBot (Parallel Web Systems' AI search crawler) gets the same delay
 *     and cap as Meta's: in 43 minutes on 2026-11-18 it made 4,477 requests,
 *     about 2,100 of them for pages, up to 300 a minute.
 *   - AI crawlers skip numbered listing pages (?page=N). Those render on
 *     every request (no edge cache absorbs a one-off URL), GPTBot walked
 *     about 200 to 370 of them an hour, and every job they list is in the
 *     sitemap. Search engines keep them.
 *
 *   - app/robots.ts disallows BLOCKED_CRAWLERS everywhere, gives
 *     THROTTLED_CRAWLERS a Crawl-delay, and adds PAGED_LISTING_DISALLOW to
 *     the AI crawler groups.
 *   - middleware.ts caps each THROTTLED_CRAWLERS entry at
 *     RATE_LIMITS.throttledCrawler across all of its IPs (they crawl from
 *     many, so a per-IP limit never binds), answering 429 with Retry-After
 *     past the cap. That cap is what slows a crawler that ignores
 *     Crawl-delay.
 */

/** Disallowed from the whole site in robots.txt. */
export const BLOCKED_CRAWLERS = ['MJ12bot'] as const;

/** Allowed, asked to wait between requests, and capped (robots.txt tokens). */
export const THROTTLED_CRAWLERS = ['meta-externalagent', 'ShapBot'] as const;

export type ThrottledCrawler = (typeof THROTTLED_CRAWLERS)[number];

/** robots.txt Crawl-delay for THROTTLED_CRAWLERS, in seconds. */
export const THROTTLED_CRAWL_DELAY_SECONDS = 10;

/**
 * Numbered listing pages (/jobs?page=2, /jobs/remote?page=3,
 * /jobs?specialty=x&page=4), disallowed for AI crawlers. Page 1 of every
 * listing stays open.
 */
export const PAGED_LISTING_DISALLOW = ['/*?page=', '/*&page='] as const;

const THROTTLED_CRAWLER_PATTERNS: ReadonlyArray<[ThrottledCrawler, RegExp]> = THROTTLED_CRAWLERS.map(
    (crawler) => [crawler, new RegExp(crawler.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')],
);

/** The throttled crawler a user agent belongs to, or null. */
export function throttledCrawlerOf(userAgent: string | null | undefined): ThrottledCrawler | null {
    if (typeof userAgent !== 'string' || userAgent === '') return null;
    const found = THROTTLED_CRAWLER_PATTERNS.find(([, pattern]) => pattern.test(userAgent));
    return found ? found[0] : null;
}
