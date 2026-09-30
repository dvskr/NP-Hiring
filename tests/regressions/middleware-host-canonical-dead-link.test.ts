/**
 * Middleware behaviour for the pre-submission indexing fixes, driven through
 * the real middleware() with a real NextRequest.
 *
 * TECH-02 / CS-04 (plan fixSoon 2): the production deployment answered on its
 * *.vercel.app alias as an indexable duplicate of the whole site. In
 * production every *.vercel.app page request now 308s to the same path and
 * query on brand.baseUrl, while /api/** (cron, Inngest, webhooks) and the
 * framework prefixes are never redirected. Preview deployments are never
 * redirected; every preview response carries X-Robots-Tag noindex, nofollow.
 *
 * CS-06 (plan fixSoon 3): a job whose source stopped listing it
 * (health_consecutive_missing at or above DEAD_LINK_MISS_THRESHOLD) left the
 * sitemaps but its page stayed a 200 JobPosting. The job gate now answers 410.
 *
 * Supabase session refresh and rate limiting are stubbed; the job gate's
 * Supabase REST lookup goes to a mocked fetch. Nothing reaches the network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/supabase/middleware', () => ({
    updateSession: vi.fn(async () => NextResponse.next()),
}));
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
import { DEAD_LINK_MISS_THRESHOLD } from '@/lib/active-job-filter';

const CANONICAL = new URL(brand.baseUrl);
const ALIAS = 'np-hiring.vercel.app';
const DEPLOYMENT_URL = 'np-hiring-3fx8q2k1a-team-slug.vercel.app';
const PREVIEW = 'np-hiring-git-feature-branch-team-slug.vercel.app';

const ENV_KEYS = ['VERCEL_ENV', 'NEXT_PUBLIC_BASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'PROD_SUPABASE_URL', 'PROD_SUPABASE_SERVICE_ROLE_KEY'] as const;
const savedEnv = new Map<string, string | undefined>();

function request(host: string, pathAndQuery: string, init: { method?: string; headers?: Record<string, string> } = {}): NextRequest {
    return new NextRequest(`https://${host}${pathAndQuery}`, {
        method: init.method ?? 'GET',
        headers: { host, 'user-agent': 'Mozilla/5.0 (test)', ...init.headers },
    });
}

beforeEach(() => {
    for (const key of ENV_KEYS) {
        savedEnv.set(key, process.env[key]);
        delete process.env[key];
    }
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

// ─── Host canonicalisation ──────────────────────────────────────────────────

describe('production *.vercel.app hosts 308 to the canonical host', () => {
    beforeEach(() => {
        process.env.VERCEL_ENV = 'production';
    });

    it('redirects the project alias with the same path and query', async () => {
        const res = await middleware(request(ALIAS, '/jobs/remote?page=2&sort=newest'));
        expect(res.status).toBe(308);
        expect(res.headers.get('location')).toBe(`${CANONICAL.origin}/jobs/remote?page=2&sort=newest`);
    });

    it('redirects a production deployment URL and the site root', async () => {
        const res = await middleware(request(DEPLOYMENT_URL, '/'));
        expect(res.status).toBe(308);
        expect(res.headers.get('location')).toBe(`${CANONICAL.origin}/`);
    });

    it('matches the host case-insensitively and ignores a port', async () => {
        const res = await middleware(request(ALIAS, '/salary-guide', { headers: { host: 'NP-Hiring.Vercel.App:443' } }));
        expect(res.status).toBe(308);
        expect(res.headers.get('location')).toBe(`${CANONICAL.origin}/salary-guide`);
    });

    it('redirects before any other rule, so a job URL is not looked up on the alias', async () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://db.example.supabase.co';
        process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        const res = await middleware(request(ALIAS, '/jobs/family-np-00000000-0000-4000-8000-000000000001'));
        expect(res.status).toBe(308);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it.each([
        ['GET', '/api/cron/index-urls'],
        ['GET', '/api/cron/batch/midday'],
        ['POST', '/api/inngest'],
        ['POST', '/api/webhooks/stripe'],
        ['GET', '/api'],
        ['GET', '/_vercel/insights/view'],
        ['GET', '/.well-known/security.txt'],
    ])('never redirects %s %s, which machines call on the deployment host', async (method, pathname) => {
        const res = await middleware(request(ALIAS, pathname, { method }));
        expect(res.status).not.toBe(308);
        expect(res.headers.get('location')).toBeNull();
    });

    it('leaves the canonical host alone, and the redirect target never redirects again', async () => {
        const direct = await middleware(request(CANONICAL.hostname, '/jobs/remote'));
        expect(direct.status).toBe(200);

        const first = await middleware(request(ALIAS, '/jobs/remote'));
        const target = new URL(first.headers.get('location') ?? '');
        expect(target.hostname).toBe(CANONICAL.hostname);
        expect(target.hostname.endsWith('.vercel.app')).toBe(false);
        const followed = await middleware(request(target.host, `${target.pathname}${target.search}`));
        expect(followed.status).not.toBe(308);
    });

    it('redirects when NEXT_PUBLIC_BASE_URL names the canonical host', async () => {
        process.env.NEXT_PUBLIC_BASE_URL = CANONICAL.origin;
        const res = await middleware(request(ALIAS, '/jobs'));
        expect(res.status).toBe(308);
    });

    it('stands down when the deployment base URL is another host, so it is never stranded', async () => {
        process.env.NEXT_PUBLIC_BASE_URL = `https://${ALIAS}`;
        const res = await middleware(request(ALIAS, '/jobs/remote'));
        expect(res.status).toBe(200);
        expect(res.headers.get('location')).toBeNull();
    });

    it('does not add the preview noindex header in production', async () => {
        const res = await middleware(request(CANONICAL.hostname, '/jobs/remote'));
        expect(res.headers.get('x-robots-tag')).toBeNull();
    });
});

describe('preview deployments are never redirected and always noindex', () => {
    beforeEach(() => {
        process.env.VERCEL_ENV = 'preview';
    });

    it('serves the page on the preview host with X-Robots-Tag noindex, nofollow', async () => {
        const res = await middleware(request(PREVIEW, '/jobs/remote'));
        expect(res.status).toBe(200);
        expect(res.headers.get('location')).toBeNull();
        expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    });

    it('overrides the softer header the pipeline sets on a paginated page', async () => {
        const res = await middleware(request(PREVIEW, '/jobs/remote?page=3'));
        expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    });

    it('also marks a 410 and an API response', async () => {
        const gone = await middleware(request(PREVIEW, '/jobs/state/atlantis'));
        expect(gone.status).toBe(410);
        expect(gone.headers.get('x-robots-tag')).toBe('noindex, nofollow');

        const api = await middleware(request(PREVIEW, '/api/jobs'));
        expect(api.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    });
});

describe('outside Vercel production and preview nothing changes', () => {
    it('neither redirects a .vercel.app host nor adds a header in development', async () => {
        process.env.VERCEL_ENV = 'development';
        const res = await middleware(request(ALIAS, '/jobs/remote'));
        expect(res.status).toBe(200);
        expect(res.headers.get('x-robots-tag')).toBeNull();
    });

    it('does the same when VERCEL_ENV is unset, as under next start', async () => {
        const res = await middleware(request(ALIAS, '/jobs/remote'));
        expect(res.status).toBe(200);
    });
});

// ─── Dead-link job gate (CS-06) ─────────────────────────────────────────────

describe('the job gate answers 410 for a job dead at its source', () => {
    const SUPABASE = 'https://db.example.supabase.co';

    function stubJobRow(row: Record<string, unknown> | null) {
        return vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
            new Response(JSON.stringify(row ? [row] : []), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            }),
        );
    }

    const liveRow = (id: string, overrides: Record<string, unknown> = {}) => ({
        id,
        is_published: true,
        expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        health_consecutive_missing: 0,
        title: 'Family Nurse Practitioner',
        employer: 'Riverbend Health',
        profession_class: 'np_eligible',
        ...overrides,
    });

    beforeEach(() => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE;
        process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
    });

    it('410s a published, unexpired job at the threshold, with noindex', async () => {
        const id = '00000000-0000-4000-8000-00000000d001';
        const fetchSpy = stubJobRow(liveRow(id, { health_consecutive_missing: DEAD_LINK_MISS_THRESHOLD }));

        const res = await middleware(request(CANONICAL.hostname, `/jobs/family-nurse-practitioner-${id}`));
        expect(res.status).toBe(410);
        expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
        expect(await res.text()).toContain('This position is no longer available');
        expect(String(fetchSpy.mock.calls[0][0])).toContain('health_consecutive_missing');
    });

    it('410s a job far past the threshold, and serves the cached ruling on the next hit', async () => {
        const id = '00000000-0000-4000-8000-00000000d002';
        const fetchSpy = stubJobRow(liveRow(id, { health_consecutive_missing: DEAD_LINK_MISS_THRESHOLD + 7 }));
        const path = `/jobs/family-nurse-practitioner-${id}`;

        expect((await middleware(request(CANONICAL.hostname, path))).status).toBe(410);
        expect((await middleware(request(CANONICAL.hostname, path))).status).toBe(410);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('lets a job one miss short of the threshold through to the page', async () => {
        const id = '00000000-0000-4000-8000-00000000d003';
        stubJobRow(liveRow(id, { health_consecutive_missing: DEAD_LINK_MISS_THRESHOLD - 1 }));
        const res = await middleware(request(CANONICAL.hostname, `/jobs/family-nurse-practitioner-${id}`));
        expect(res.status).toBe(200);
    });

    it('treats a row without the counter as live rather than guessing', async () => {
        const id = '00000000-0000-4000-8000-00000000d004';
        const row: Record<string, unknown> = liveRow(id);
        delete row.health_consecutive_missing;
        stubJobRow(row);
        const res = await middleware(request(CANONICAL.hostname, `/jobs/family-nurse-practitioner-${id}`));
        expect(res.status).toBe(200);
    });

    it('still 410s expired and missing rows as before', async () => {
        const expiredId = '00000000-0000-4000-8000-00000000d005';
        stubJobRow(liveRow(expiredId, { expires_at: new Date(Date.now() - 86_400_000).toISOString() }));
        expect((await middleware(request(CANONICAL.hostname, `/jobs/np-${expiredId}`))).status).toBe(410);

        vi.restoreAllMocks();
        const missingId = '00000000-0000-4000-8000-00000000d006';
        stubJobRow(null);
        expect((await middleware(request(CANONICAL.hostname, `/jobs/np-${missingId}`))).status).toBe(410);
    });
});
