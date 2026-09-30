/**
 * Indexing audit L-01: the company 410 gate in middleware.ts must never
 * answer 410 on a display-name profile slug.
 *
 * Profile URLs are display-name slugs (lib/company-slug.ts). normalized_name
 * evidence says nothing about them: /companies/one-medical matches no row,
 * and /companies/davita (live "DaVita", normalized_name "da-vita") matches a
 * dormant variant row spelled "Davita" whose normalized_name is "davita".
 * The gate used to rule 410 on both, which would have taken down every link
 * the hub, the similar-employer cards and the homepage chips emit. A slug
 * with the display-name shape is left to the page (live profile, 308 from an
 * old slug, or 404). A slug that can never be a display-name slug, such as
 * the %20 space form, keeps its 410.
 *
 * Driven through the real middleware() with a real NextRequest; the
 * Supabase REST lookups go to a mocked fetch and nothing reaches the
 * network. Each test uses its own slug because the gate keeps an in-process
 * verdict cache.
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

const HOST = new URL(brand.baseUrl).hostname;
const SUPABASE = 'https://db.example.supabase.co';
const ENV_KEYS = ['VERCEL_ENV', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'PROD_SUPABASE_URL', 'PROD_SUPABASE_SERVICE_ROLE_KEY'] as const;
const savedEnv = new Map<string, string | undefined>();

function request(pathname: string): NextRequest {
    return new NextRequest(`https://${HOST}${pathname}`, {
        headers: { host: HOST, 'user-agent': 'Mozilla/5.0 (test)' },
    });
}

function json(body: unknown): Response {
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

/**
 * A company table in miniature: `companies` maps a normalized_name to its
 * row id, `jobs` maps a company id to its active job rows.
 */
function stubSupabase(companies: Record<string, string>, jobs: Record<string, unknown[]> = {}) {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = new URL(String(input));
        const name = url.searchParams.get('normalized_name');
        if (url.pathname.endsWith('/companies') && name?.startsWith('eq.')) {
            const id = companies[name.slice('eq.'.length)];
            return json(id ? [{ id }] : []);
        }
        const companyId = url.searchParams.get('company_id');
        if (url.pathname.endsWith('/jobs') && companyId?.startsWith('eq.')) {
            return json(jobs[companyId.slice('eq.'.length)] ?? []);
        }
        throw new Error(`unexpected fetch ${url.pathname}${url.search}`);
    });
}

beforeEach(() => {
    for (const key of ENV_KEYS) {
        savedEnv.set(key, process.env[key]);
        delete process.env[key];
    }
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
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

describe('display-name slugs pass through to the page', () => {
    it('a display-name slug that matches no normalized_name row is not 410', async () => {
        stubSupabase({});
        const res = await middleware(request('/companies/one-medical'));
        expect(res.status).toBe(200);
        expect(res.headers.get('x-robots-tag')).toBeNull();
    });

    it('a display-name slug that a dormant variant row holds is not 410', async () => {
        // Live "DaVita" is "da-vita"; the dormant "Davita" row is "davita".
        stubSupabase({ davita: 'variant-row', 'da-vita': 'live-row' }, { 'variant-row': [] });
        const res = await middleware(request('/companies/davita'));
        expect(res.status).toBe(200);
    });

    it('never caches a gone verdict for a display-name slug', async () => {
        stubSupabase({ medelite: 'variant-row' }, { 'variant-row': [] });
        expect((await middleware(request('/companies/medelite'))).status).toBe(200);
        expect((await middleware(request('/companies/medelite'))).status).toBe(200);
    });

    it('an old kebab slug of a live company reaches the page, which 308s it', async () => {
        stubSupabase({ 'life-stance': 'lifestance' }, {
            lifestance: [{ id: 'job-1', title: 'Psychiatric Nurse Practitioner', employer: 'LifeStance Health' }],
        });
        const res = await middleware(request('/companies/life-stance'));
        expect(res.status).toBe(200);
    });
});

describe('slugs that can never be display-name slugs keep their 410', () => {
    it('a space-form slug that matches no row answers 410', async () => {
        stubSupabase({});
        const res = await middleware(request('/companies/no%20such%20employer'));
        expect(res.status).toBe(410);
        expect(res.headers.get('x-robots-tag')).toContain('noindex');
    });

    it('a space-form slug of a company with no open jobs answers the styled 410', async () => {
        stubSupabase({ 'acme clinic': 'acme' }, { acme: [] });
        const res = await middleware(request('/companies/acme%20clinic'));
        expect(res.status).toBe(410);
        expect(await res.text()).toContain('This employer has no current openings');
    });

    it('a database failure on a space-form slug is a 503, never a 410', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
        const res = await middleware(request('/companies/broken%20lookup'));
        expect(res.status).toBe(503);
    });
});
