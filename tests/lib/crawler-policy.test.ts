/**
 * Crawler policy (lib/crawler-policy.ts).
 *
 * Owner decision 2026-11-17: Majestic's MJ12bot is blocked, Meta's AI crawler
 * is asked for a Crawl-delay in robots.txt and capped in middleware across
 * all of its IPs, and every other crawler keeps the open posture it had.
 *
 * Owner decision 2026-11-19 ("fix all of them"): Parallel's ShapBot gets the
 * same delay and cap, and AI crawlers skip numbered listing pages (?page=N),
 * which render on every request; search engines keep them.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { MetadataRoute } from 'next';
import robots from '@/app/robots';
import {
    BLOCKED_CRAWLERS,
    PAGED_LISTING_DISALLOW,
    THROTTLED_CRAWLERS,
    THROTTLED_CRAWL_DELAY_SECONDS,
    throttledCrawlerOf,
} from '@/lib/crawler-policy';
import { RATE_LIMITS, rateLimitShared } from '@/lib/rate-limit';

type Rule = Exclude<MetadataRoute.Robots['rules'], { userAgent?: string | string[] } | undefined> extends (infer R)[] ? R : never;

const rules = robots().rules as Rule[];
const agentsOf = (rule: Rule): string[] => (Array.isArray(rule.userAgent) ? rule.userAgent : [rule.userAgent ?? '']);
const rulesFor = (agent: string): Rule[] => rules.filter((rule) => agentsOf(rule).includes(agent));
const asList = (value: string | string[] | undefined): string[] => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

/** RFC 9309 matching: `*` is any run of characters, `$` anchors the end, the longest pattern wins and Allow wins a tie. */
function allowed(rule: Rule, url: string): boolean {
    const matchLength = (patterns: string[]) =>
        Math.max(-1, ...patterns
            .filter((pattern) => {
                const body = pattern.endsWith('$') ? pattern.slice(0, -1) : pattern;
                const source = body.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
                return new RegExp(`^${source}${pattern.endsWith('$') ? '$' : ''}`).test(url);
            })
            .map((pattern) => pattern.length));
    const allow = matchLength(asList(rule.allow));
    const disallow = matchLength(asList(rule.disallow));
    return disallow < 0 || allow >= disallow;
}

const AI_AGENTS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'PerplexityBot', 'Amazonbot', 'meta-externalagent', 'ShapBot'];
const PAGED_URLS = ['/jobs?page=2', '/jobs/remote?page=3', '/jobs?specialty=pediatric&page=4', '/companies?page=2'];
const FIRST_PAGES = ['/jobs', '/jobs?specialty=pediatric', '/jobs/remote', '/jobs/state/texas', '/companies', '/blog/page-speed-for-np-clinics'];

describe('robots.txt', () => {
    it('blocks MJ12bot from the whole site, in one rule of its own', () => {
        expect(BLOCKED_CRAWLERS).toEqual(['MJ12bot']);
        const blocked = rulesFor('MJ12bot');
        expect(blocked).toHaveLength(1);
        expect(asList(blocked[0].disallow)).toEqual(['/']);
        expect(asList(blocked[0].allow)).toEqual([]);
    });

    it('asks Meta\'s AI crawler and ShapBot to wait between requests, and keeps their access', () => {
        expect(THROTTLED_CRAWLERS).toEqual(['meta-externalagent', 'ShapBot']);
        for (const agent of THROTTLED_CRAWLERS) {
            const found = rulesFor(agent);
            expect(found, agent).toHaveLength(1);
            expect(found[0].crawlDelay, agent).toBe(THROTTLED_CRAWL_DELAY_SECONDS);
            expect(asList(found[0].allow), agent).toContain('/');
            expect(asList(found[0].disallow), agent).not.toContain('/');
        }
    });

    it('keeps AI crawlers off numbered listing pages and on every first page', () => {
        expect(PAGED_LISTING_DISALLOW).toEqual(['/*?page=', '/*&page=']);
        for (const agent of AI_AGENTS) {
            const [rule] = rulesFor(agent);
            expect(rule, agent).toBeDefined();
            for (const url of PAGED_URLS) expect(allowed(rule, url), `${agent} ${url}`).toBe(false);
            for (const url of FIRST_PAGES) expect(allowed(rule, url), `${agent} ${url}`).toBe(true);
            expect(allowed(rule, '/api/sitemaps/index'), agent).toBe(true);
        }
    });

    it('leaves search engines, SEO and social crawlers on numbered pages, with no delay', () => {
        for (const agent of ['*', 'AhrefsBot', 'SemrushBot', 'Twitterbot', 'LinkedInBot']) {
            const found = rulesFor(agent);
            expect(found, agent).toHaveLength(1);
            expect(found[0].crawlDelay, agent).toBeUndefined();
            for (const url of PAGED_URLS) expect(allowed(found[0], url), `${agent} ${url}`).toBe(true);
        }
    });

    it('leaves the other AI crawlers without a delay', () => {
        for (const agent of ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'PerplexityBot']) {
            const found = rulesFor(agent);
            expect(found, agent).toHaveLength(1);
            expect(found[0].crawlDelay, agent).toBeUndefined();
            expect(asList(found[0].disallow), agent).not.toContain('/');
        }
    });

    it('names every agent at most once', () => {
        const all = rules.flatMap(agentsOf);
        expect(new Set(all).size).toBe(all.length);
    });
});

describe('throttledCrawlerOf', () => {
    it('names the throttled crawler a user agent belongs to, and nothing else', () => {
        expect(throttledCrawlerOf('meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)')).toBe('meta-externalagent');
        expect(throttledCrawlerOf('Meta-ExternalAgent/1.1')).toBe('meta-externalagent');
        expect(throttledCrawlerOf('Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ShapBot/0.1.0')).toBe('ShapBot');
        expect(throttledCrawlerOf('facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)')).toBeNull();
        expect(throttledCrawlerOf('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBeNull();
        expect(throttledCrawlerOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36')).toBeNull();
        expect(throttledCrawlerOf('')).toBeNull();
        expect(throttledCrawlerOf(null)).toBeNull();
    });
});

describe('rateLimitShared', () => {
    it('counts every request under one key, whatever its IP, and answers 429 with Retry-After past the cap', async () => {
        const config = { limit: 3, windowSeconds: 60 };
        const key = `test:shared:${Date.now()}`;
        for (let i = 0; i < config.limit; i += 1) expect(await rateLimitShared(key, config)).toBeNull();
        const refused = await rateLimitShared(key, config);
        expect(refused?.status).toBe(429);
        expect(Number(refused?.headers.get('Retry-After'))).toBeGreaterThan(0);
    });

    it('caps each throttled crawler at about one request every 6 seconds', () => {
        expect(RATE_LIMITS.throttledCrawler).toEqual({ limit: 10, windowSeconds: 60 });
    });
});

describe('middleware', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'middleware.ts'), 'utf8');

    it('caps each throttled crawler under its own shared key, before the per-IP limits', () => {
        const cap = src.indexOf('rateLimitShared(`crawler:${throttledCrawler}`, RATE_LIMITS.throttledCrawler)');
        expect(cap).toBeGreaterThan(-1);
        expect(src).toMatch(/request\.method === 'GET' \? throttledCrawlerOf\(userAgent\) : null/);
        expect(cap).toBeLessThan(src.indexOf("limitKey = 'public:job-detail'"));
    });
});
