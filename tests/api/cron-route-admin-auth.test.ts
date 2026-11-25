/**
 * The cron gate end to end, through a real cron route (oauth-cleanup) and
 * the real verifyCronOrAdmin: `Authorization: Bearer <CRON_SECRET>` or an
 * admin session, nothing else.
 *
 * Ported from the donor board's B14 suite, which drove two POST routes that
 * compared the secret inline and accepted it without the Bearer prefix. This
 * board's equivalents of those routes go through the same helper, so the
 * helper is what is pinned here, on a route that exists in this board. It
 * also pins the hardening of the open door: local development with a
 * CRON_SECRET set no longer skips authentication.
 *
 * Supabase and Prisma are mocked; the work the route does is a spy.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
    purgeOAuth: vi.fn(async () => ({ codes: 0, tokens: 0 })),
    purgeReviews: vi.fn(async () => 0),
    user: null as { id: string } | null,
    authError: null as unknown,
    profile: null as { id: string; role: string; deletedAt: Date | null } | null,
}));

vi.mock('@/lib/supabase/server', () => ({
    createClient: async () => ({
        auth: {
            getUser: async () => (h.user
                ? { data: { user: h.user }, error: null }
                : { data: { user: null }, error: h.authError }),
        },
    }),
}));
vi.mock('@/lib/prisma', () => ({ prisma: { userProfile: { findUnique: vi.fn(async () => h.profile) } } }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/cron/track', () => ({
    withCronTracking: async (_name: string, body: () => Promise<{ response: Response }>) => (await body()).response,
}));
vi.mock('@/lib/mcp/oauth/grants', () => ({ purgeSpentOAuthRows: h.purgeOAuth }));
vi.mock('@/lib/mcp/server/pending-actions', () => ({ purgeExpiredPendingActions: h.purgeReviews }));

import { GET } from '@/app/api/cron/oauth-cleanup/route';

const SECRET = 'test-cron-secret-fic-0123456789';

function call(auth: string | null) {
    const headers: Record<string, string> = {};
    if (auth !== null) headers.authorization = auth;
    return GET(new NextRequest('https://example.test/api/cron/oauth-cleanup', { method: 'GET', headers }));
}

function signIn(role: string, deletedAt: Date | null = null): void {
    h.user = { id: 'sb-fic-1' };
    h.profile = { id: 'profile-fic-1', role, deletedAt };
}

beforeEach(() => {
    vi.clearAllMocks();
    h.user = null;
    h.authError = null;
    h.profile = null;
    vi.stubEnv('CRON_SECRET', SECRET);
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('VERCEL_ENV', '');
});

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('the cron bearer', () => {
    it('rejects the bare secret without the Bearer prefix', async () => {
        expect((await call(SECRET)).status).toBe(401);
        expect(h.purgeOAuth).not.toHaveBeenCalled();
    });

    it('rejects a wrong bearer token of the same length', async () => {
        const wrong = `Bearer ${SECRET.slice(0, -1)}X`;
        expect((await call(wrong)).status).toBe(401);
        expect(h.purgeOAuth).not.toHaveBeenCalled();
    });

    it('rejects a request with no header', async () => {
        expect((await call(null)).status).toBe(401);
        expect(h.purgeOAuth).not.toHaveBeenCalled();
    });

    it('accepts the bearer token', async () => {
        const res = await call(`Bearer ${SECRET}`);
        expect(res.status).toBe(200);
        expect(h.purgeOAuth).toHaveBeenCalledTimes(1);
    });
});

describe('the manual trigger', () => {
    it('accepts an admin session without a bearer', async () => {
        signIn('admin');
        expect((await call(null)).status).toBe(200);
        expect(h.purgeOAuth).toHaveBeenCalledTimes(1);
    });

    it('refuses a signed-in non-admin with 403', async () => {
        signIn('employer');
        expect((await call(null)).status).toBe(403);
        expect(h.purgeOAuth).not.toHaveBeenCalled();
    });

    it('refuses an admin account in its deletion window with 403', async () => {
        signIn('admin', new Date('2026-11-20T00:00:00Z'));
        expect((await call(null)).status).toBe(403);
        expect(h.purgeOAuth).not.toHaveBeenCalled();
    });

    it('answers 500, not a false 401, when the auth service does not answer', async () => {
        h.authError = { name: 'AuthRetryableFetchError', status: 0, message: 'fetch failed' };
        expect((await call(null)).status).toBe(500);
        expect(h.purgeOAuth).not.toHaveBeenCalled();
    });
});

describe('local development', () => {
    it('still needs a credential when a CRON_SECRET is configured', async () => {
        vi.stubEnv('NODE_ENV', 'development');
        expect((await call(null)).status).toBe(401);
        expect(h.purgeOAuth).not.toHaveBeenCalled();
    });

    it('is open only on a checkout with no CRON_SECRET to present', async () => {
        vi.stubEnv('NODE_ENV', 'development');
        vi.stubEnv('CRON_SECRET', '');
        expect((await call(null)).status).toBe(200);
        expect(h.purgeOAuth).toHaveBeenCalledTimes(1);
    });
});
