/**
 * The job gate in middleware.ts sends a free copy of a confirmed employer's
 * live paid post (lib/paid-post-twins.ts) to that post with a real 307. The
 * job route streams behind loading.tsx, so the page itself could only answer
 * with a client-side redirect after a 200. A copy whose paid post is no
 * longer a listing, or whose lookup fails, renders as itself: never a 503
 * and never a redirect to a closed post.
 *
 * Every name is fictional.
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

const CANONICAL = new URL(brand.baseUrl);
const SUPABASE = 'https://db.example.supabase.co';
const ENV_KEYS = ['VERCEL_ENV', 'NEXT_PUBLIC_BASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'PROD_SUPABASE_URL', 'PROD_SUPABASE_SERVICE_ROLE_KEY'] as const;
const savedEnv = new Map<string, string | undefined>();
const DAY_MS = 86_400_000;

function request(pathAndQuery: string): NextRequest {
    return new NextRequest(`https://${CANONICAL.hostname}${pathAndQuery}`, {
        headers: { host: CANONICAL.hostname, 'user-agent': 'Mozilla/5.0 (test)' },
    });
}

function jobRow(id: string, overrides: Record<string, unknown> = {}) {
    return {
        id,
        slug: `family-nurse-practitioner-${id}`,
        is_published: true,
        expires_at: new Date(Date.now() + 30 * DAY_MS).toISOString(),
        health_consecutive_missing: 0,
        shadowed_by_job_id: null,
        title: 'Family Nurse Practitioner',
        employer: 'Riverbend Health',
        profession_class: 'np_eligible',
        ...overrides,
    };
}

/** Answers each `jobs?id=eq.<id>` read from these rows; `failing` ids answer 503. */
function stubJobs(rows: ReadonlyArray<ReturnType<typeof jobRow>>, failing: readonly string[] = []) {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const id = new URL(String(input)).searchParams.get('id')?.replace(/^eq\./, '') ?? '';
        if (failing.includes(id)) return new Response('busy', { status: 503 });
        const found = rows.filter((row) => row.id === id);
        return new Response(JSON.stringify(found), { status: 200, headers: { 'content-type': 'application/json' } });
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

describe('a free copy of a live paid post', () => {
    it('answers 307 to the paid post, keeping the query, and serves the cached ruling on the next hit', async () => {
        const paid = '00000000-0000-4000-8000-00000000e001';
        const copy = '00000000-0000-4000-8000-00000000e002';
        const fetchSpy = stubJobs([jobRow(paid), jobRow(copy, { shadowed_by_job_id: paid })]);

        const res = await middleware(request(`/jobs/family-nurse-practitioner-${copy}?apply=1`));
        expect(res.status).toBe(307);
        expect(res.headers.get('location')).toBe(`https://${CANONICAL.hostname}/jobs/family-nurse-practitioner-${paid}?apply=1`);

        const again = await middleware(request(`/jobs/family-nurse-practitioner-${copy}`));
        expect(again.status).toBe(307);
        expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('renders as itself when the paid post is no longer a listing', async () => {
        const paid = '00000000-0000-4000-8000-00000000e003';
        const copy = '00000000-0000-4000-8000-00000000e004';
        stubJobs([jobRow(paid, { expires_at: new Date(Date.now() - DAY_MS).toISOString() }), jobRow(copy, { shadowed_by_job_id: paid })]);

        const res = await middleware(request(`/jobs/family-nurse-practitioner-${copy}`));
        expect(res.status).toBe(200);
    });

    it('renders as itself, not a 503, when the paid post cannot be read', async () => {
        const paid = '00000000-0000-4000-8000-00000000e005';
        const copy = '00000000-0000-4000-8000-00000000e006';
        stubJobs([jobRow(copy, { shadowed_by_job_id: paid })], [paid]);

        const res = await middleware(request(`/jobs/family-nurse-practitioner-${copy}`));
        expect(res.status).toBe(200);
        expect(console.error).toHaveBeenCalled();
    });
});

describe('a job that is nobody\'s copy', () => {
    it('makes one read and goes to its page as before', async () => {
        const id = '00000000-0000-4000-8000-00000000e007';
        const fetchSpy = stubJobs([jobRow(id)]);

        const res = await middleware(request(`/jobs/family-nurse-practitioner-${id}`));
        expect(res.status).toBe(200);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(String(fetchSpy.mock.calls[0][0])).toContain('shadowed_by_job_id');
    });
});
