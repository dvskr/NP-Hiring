/**
 * Owner decision 2026-11-17 (lib/crawler-policy.ts): Majestic's MJ12bot is
 * blocked, Meta's AI crawler is asked for a Crawl-delay in robots.txt and
 * capped in middleware across all of its IPs, and every other crawler keeps
 * the open posture it had.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { MetadataRoute } from 'next';
import robots from '@/app/robots';
import {
    BLOCKED_CRAWLERS,
    THROTTLED_CRAWLER,
    THROTTLED_CRAWL_DELAY_SECONDS,
    isThrottledCrawler,
} from '@/lib/crawler-policy';
import { RATE_LIMITS, rateLimitShared } from '@/lib/rate-limit';

type Rule = Exclude<MetadataRoute.Robots['rules'], { userAgent?: string | string[] } | undefined> extends (infer R)[] ? R : never;

const rules = robots().rules as Rule[];
const agentsOf = (rule: Rule): string[] => (Array.isArray(rule.userAgent) ? rule.userAgent : [rule.userAgent ?? '']);
const rulesFor = (agent: string): Rule[] => rules.filter((rule) => agentsOf(rule).includes(agent));
const asList = (value: string | string[] | undefined): string[] => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

describe('robots.txt', () => {
    it('blocks MJ12bot from the whole site, in one rule of its own', () => {
        expect(BLOCKED_CRAWLERS).toEqual(['MJ12bot']);
        const blocked = rulesFor('MJ12bot');
        expect(blocked).toHaveLength(1);
        expect(asList(blocked[0].disallow)).toEqual(['/']);
        expect(asList(blocked[0].allow)).toEqual([]);
    });

    it('asks Meta\'s AI crawler to wait between requests, and keeps its access', () => {
        const meta = rulesFor(THROTTLED_CRAWLER);
        expect(meta).toHaveLength(1);
        expect(meta[0].crawlDelay).toBe(THROTTLED_CRAWL_DELAY_SECONDS);
        expect(asList(meta[0].allow)).toContain('/');
        expect(asList(meta[0].disallow)).not.toContain('/');
    });

    it('leaves search engines and the other AI crawlers as they were: allowed, no delay', () => {
        for (const agent of ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'PerplexityBot', 'AhrefsBot', 'SemrushBot', '*']) {
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

describe('isThrottledCrawler', () => {
    it('matches Meta\'s AI crawler and nothing else Meta sends', () => {
        expect(isThrottledCrawler('meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)')).toBe(true);
        expect(isThrottledCrawler('Meta-ExternalAgent/1.1')).toBe(true);
        expect(isThrottledCrawler('facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)')).toBe(false);
        expect(isThrottledCrawler('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(false);
        expect(isThrottledCrawler('')).toBe(false);
        expect(isThrottledCrawler(null)).toBe(false);
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

    it('caps Meta\'s AI crawler at about one request every 6 seconds', () => {
        expect(RATE_LIMITS.metaAiCrawler).toEqual({ limit: 10, windowSeconds: 60 });
    });
});

describe('middleware', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'middleware.ts'), 'utf8');

    it('caps Meta\'s AI crawler with the shared limiter, before the per-IP limits', () => {
        const cap = src.indexOf('rateLimitShared(`crawler:${THROTTLED_CRAWLER}`, RATE_LIMITS.metaAiCrawler)');
        expect(cap).toBeGreaterThan(-1);
        expect(src).toMatch(/request\.method === 'GET' && isThrottledCrawler\(userAgent\)/);
        expect(cap).toBeLessThan(src.indexOf("limitKey = 'public:job-detail'"));
    });
});
