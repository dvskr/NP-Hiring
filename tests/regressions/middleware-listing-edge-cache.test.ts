/**
 * M-03 (indexing audit): listing pages under /jobs/ read ?page, so they render
 * per request and their ISR revalidate never applies (cold TTFB 1.2 to 3.3 s).
 * The middleware now holds page 1 of every /jobs/{segment} listing at the edge
 * for an hour, served stale for a day while it revalidates, for every user
 * agent, as long as the response sets no cookie. Deeper pages and /jobs itself
 * keep the short crawler-only cache, and job-detail URLs stay uncached (ISR and
 * the 410 gate cover them). Page 1 of the /companies and /blog hubs, which
 * read ?page the same way, gets the same page-1 cache.
 *
 * For that to reach users, the consent cookies are written only when their
 * value changes: a returning visitor whose region cookie and consent mirror
 * already match gets a response with no Set-Cookie.
 *
 * Driven through the real middleware() with a real NextRequest. The Supabase
 * session refresh and the rate limiter are stubbed; nothing reaches the network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const { updateSession } = vi.hoisted(() => ({
    updateSession: vi.fn(async () => NextResponse.next()),
}));

vi.mock('@/lib/supabase/middleware', () => ({ updateSession }));
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn(async () => null),
    RATE_LIMITS: {
        publicDetail: { limit: 240, windowSeconds: 60 },
        publicListing: { limit: 120, windowSeconds: 60 },
        publicCompany: { limit: 60, windowSeconds: 60 },
    },
}));

import { middleware } from '@/middleware';
import { brand } from '@/config/brand';
import { CONSENT_COOKIE, CONSENT_MIRROR_COOKIE } from '@/lib/consent';

const HOST = new URL(brand.baseUrl).host;
const LONG = 'public, s-maxage=3600, stale-while-revalidate=86400';
const SHORT = 'public, s-maxage=300, stale-while-revalidate=600';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const GOOGLEBOT_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
// No geo header in tests, so the middleware resolves the strict region.
const REGION = 'strict';

const ENV_KEYS = ['VERCEL_ENV', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'PROD_SUPABASE_URL', 'PROD_SUPABASE_SERVICE_ROLE_KEY'] as const;
const savedEnv = new Map<string, string | undefined>();

function request(pathAndQuery: string, init: { ua?: string; cookies?: Record<string, string> } = {}): NextRequest {
    const headers: Record<string, string> = { host: HOST, 'user-agent': init.ua ?? BROWSER_UA };
    const cookies = Object.entries(init.cookies ?? {});
    if (cookies.length > 0) headers.cookie = cookies.map(([name, value]) => `${name}=${value}`).join('; ');
    return new NextRequest(`https://${HOST}${pathAndQuery}`, { method: 'GET', headers });
}

const returningVisitor = { [`pmhnp_consent_region`]: REGION };

beforeEach(() => {
    for (const key of ENV_KEYS) {
        savedEnv.set(key, process.env[key]);
        delete process.env[key];
    }
    updateSession.mockImplementation(async () => NextResponse.next());
    for (const method of ['log', 'warn', 'error'] as const) {
        vi.spyOn(console, method).mockImplementation(() => undefined);
    }
});

afterEach(() => {
    vi.restoreAllMocks();
    for (const [key, value] of savedEnv) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    savedEnv.clear();
});

describe('page 1 of a /jobs listing is edge-cached for every user agent', () => {
    it.each(['/jobs/remote', '/jobs/state/texas', '/jobs/psychiatric-mental-health'])(
        '%s: a returning visitor with no cookie to write gets the long edge cache',
        async (path) => {
            const res = await middleware(request(path, { cookies: returningVisitor }));
            expect(res.headers.get('set-cookie')).toBeNull();
            expect(res.headers.get('CDN-Cache-Control')).toBe(LONG);
        },
    );

    it('a crawler gets the long edge cache on page 1', async () => {
        const res = await middleware(request('/jobs/state/texas', { ua: GOOGLEBOT_UA }));
        expect(res.headers.get('set-cookie')).toBeNull();
        expect(res.headers.get('CDN-Cache-Control')).toBe(LONG);
    });

    it('a first visit writes the region cookie, so that response is never marked cacheable', async () => {
        const res = await middleware(request('/jobs/state/texas'));
        expect(res.headers.get('set-cookie')).toContain(`pmhnp_consent_region=${REGION}`);
        expect(res.headers.get('CDN-Cache-Control')).toBeNull();
    });

    it('a region change rewrites the cookie and skips the edge cache', async () => {
        const res = await middleware(request('/jobs/state/texas', { cookies: { pmhnp_consent_region: 'implied' } }));
        expect(res.headers.get('set-cookie')).toContain(`pmhnp_consent_region=${REGION}`);
        expect(res.headers.get('CDN-Cache-Control')).toBeNull();
    });

    it('a Supabase session refresh (Set-Cookie from updateSession) is never cached for the user', async () => {
        updateSession.mockImplementation(async () => {
            const next = NextResponse.next();
            next.cookies.set('sb-access-token', 'refreshed', { path: '/' });
            return next;
        });
        const res = await middleware(request('/jobs/remote', { cookies: returningVisitor }));
        expect(res.headers.get('set-cookie')).toContain('sb-access-token=refreshed');
        expect(res.headers.get('CDN-Cache-Control')).toBeNull();
    });
});

describe('page 1 of the /companies and /blog hubs gets the same edge cache (M-03)', () => {
    it.each(['/companies', '/blog', '/blog?category=salary_negotiation'])(
        '%s: a returning visitor with no cookie to write gets the long edge cache',
        async (path) => {
            const res = await middleware(request(path, { cookies: returningVisitor }));
            expect(res.headers.get('set-cookie')).toBeNull();
            expect(res.headers.get('CDN-Cache-Control')).toBe(LONG);
        },
    );

    it.each(['/companies', '/blog'])('%s: a crawler gets the long edge cache on page 1', async (path) => {
        const res = await middleware(request(path, { ua: GOOGLEBOT_UA }));
        expect(res.headers.get('CDN-Cache-Control')).toBe(LONG);
    });

    it.each(['/companies', '/blog'])('%s: a response that writes a cookie is never marked cacheable', async (path) => {
        const firstVisit = await middleware(request(path));
        expect(firstVisit.headers.get('set-cookie')).toContain(`pmhnp_consent_region=${REGION}`);
        expect(firstVisit.headers.get('CDN-Cache-Control')).toBeNull();

        updateSession.mockImplementation(async () => {
            const next = NextResponse.next();
            next.cookies.set('sb-access-token', 'refreshed', { path: '/' });
            return next;
        });
        const sessionRefresh = await middleware(request(path, { cookies: returningVisitor }));
        expect(sessionRefresh.headers.get('CDN-Cache-Control')).toBeNull();
    });

    it.each(['/companies?page=2', '/blog?page=3'])(
        '%s: page 2 and later answer noindex, follow; crawlers get the short cache, users none',
        async (path) => {
            const crawler = await middleware(request(path, { ua: GOOGLEBOT_UA }));
            expect(crawler.headers.get('CDN-Cache-Control')).toBe(SHORT);
            expect(crawler.headers.get('X-Robots-Tag')).toBe('noindex, follow');

            const user = await middleware(request(path, { cookies: returningVisitor }));
            expect(user.headers.get('CDN-Cache-Control')).toBeNull();
        },
    );

    it('only the hub paths themselves: a blog post and a company profile are not cached here', async () => {
        for (const path of ['/blog/np-interview-questions', '/companies/one-medical']) {
            const res = await middleware(request(path, { cookies: returningVisitor }));
            expect(res.headers.get('CDN-Cache-Control'), path).toBeNull();
        }
    });
});

describe('everything else keeps the old policy', () => {
    it('page 2 and later: crawlers get the short cache, users get none', async () => {
        const crawler = await middleware(request('/jobs/state/texas?page=2', { ua: GOOGLEBOT_UA }));
        expect(crawler.headers.get('CDN-Cache-Control')).toBe(SHORT);
        expect(crawler.headers.get('X-Robots-Tag')).toBe('noindex, follow');

        const user = await middleware(request('/jobs/state/texas?page=2', { cookies: returningVisitor }));
        expect(user.headers.get('CDN-Cache-Control')).toBeNull();
    });

    it('/jobs itself (the filterable search page): crawlers get the short cache, users get none', async () => {
        const crawler = await middleware(request('/jobs', { ua: GOOGLEBOT_UA }));
        expect(crawler.headers.get('CDN-Cache-Control')).toBe(SHORT);

        const user = await middleware(request('/jobs', { cookies: returningVisitor }));
        expect(user.headers.get('CDN-Cache-Control')).toBeNull();
    });

    it('job-detail URLs are never edge-cached by the middleware (ISR and the 410 gate own them)', async () => {
        const detail = '/jobs/family-nurse-practitioner-austin-tx-3f2b8c1d-9a4e-4b7f-8c2d-1e5f6a7b8c9d';
        for (const init of [{ ua: GOOGLEBOT_UA }, { cookies: returningVisitor }]) {
            const res = await middleware(request(detail, init));
            expect(res.headers.get('CDN-Cache-Control')).toBeNull();
        }
    });

    it('pages outside /jobs are untouched', async () => {
        const res = await middleware(request('/salary-guide', { cookies: returningVisitor }));
        expect(res.headers.get('CDN-Cache-Control')).toBeNull();
    });
});

describe('consent cookies are written only when their value changes', () => {
    it('the mirror is not rewritten while it matches the authoritative consent cookie', async () => {
        const res = await middleware(request('/salary-guide', {
            cookies: { ...returningVisitor, [CONSENT_COOKIE]: 'granted', [CONSENT_MIRROR_COOKIE]: 'granted' },
        }));
        expect(res.headers.get('set-cookie')).toBeNull();
    });

    it('the mirror is written when it is missing or stale', async () => {
        const missing = await middleware(request('/salary-guide', {
            cookies: { ...returningVisitor, [CONSENT_COOKIE]: 'granted' },
        }));
        expect(missing.headers.get('set-cookie')).toContain(`${CONSENT_MIRROR_COOKIE}=granted`);

        const stale = await middleware(request('/salary-guide', {
            cookies: { ...returningVisitor, [CONSENT_COOKIE]: 'denied', [CONSENT_MIRROR_COOKIE]: 'granted' },
        }));
        expect(stale.headers.get('set-cookie')).toContain(`${CONSENT_MIRROR_COOKIE}=denied`);
    });

    it('a cleared consent still drops the stale mirror', async () => {
        const res = await middleware(request('/salary-guide', {
            cookies: { ...returningVisitor, [CONSENT_MIRROR_COOKIE]: 'granted' },
        }));
        expect(res.headers.get('set-cookie')).toContain(`${CONSENT_MIRROR_COOKIE}=;`);
    });

    it('crawlers never receive either cookie', async () => {
        const res = await middleware(request('/salary-guide', {
            ua: GOOGLEBOT_UA,
            cookies: { [CONSENT_COOKIE]: 'granted' },
        }));
        expect(res.headers.get('set-cookie')).toBeNull();
    });
});
