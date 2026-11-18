/**
 * Crawlers the site limits (owner decision 2026-11-17).
 *
 * Once the board passed 6,000 jobs, crawler bursts re-rendered job pages
 * faster than the database pool could serve them, and readers got error
 * pages. In one hour of production traffic meta-externalagent (Meta AI) made
 * 874 job-page requests, MJ12bot (Majestic) 107 and Googlebot 9. The owner
 * chose to block Majestic, slow Meta's AI crawler, and leave Google, Bing,
 * OpenAI, Anthropic and Perplexity open.
 *
 *   - app/robots.ts disallows BLOCKED_CRAWLERS everywhere and gives
 *     THROTTLED_CRAWLER a Crawl-delay.
 *   - middleware.ts caps THROTTLED_CRAWLER at RATE_LIMITS.metaAiCrawler
 *     across all of its IPs (it crawls from many, so a per-IP limit never
 *     binds), answering 429 with Retry-After past the cap. That cap is what
 *     slows it if it ignores Crawl-delay.
 */

/** Disallowed from the whole site in robots.txt. */
export const BLOCKED_CRAWLERS = ['MJ12bot'] as const;

/** Meta's AI crawler: allowed, asked to wait between requests, and capped. */
export const THROTTLED_CRAWLER = 'meta-externalagent';

/** robots.txt Crawl-delay for THROTTLED_CRAWLER, in seconds. */
export const THROTTLED_CRAWL_DELAY_SECONDS = 10;

const THROTTLED_CRAWLER_PATTERN = /meta-externalagent/i;

/** True when the user agent is THROTTLED_CRAWLER. */
export function isThrottledCrawler(userAgent: string | null | undefined): boolean {
    return typeof userAgent === 'string' && THROTTLED_CRAWLER_PATTERN.test(userAgent);
}
