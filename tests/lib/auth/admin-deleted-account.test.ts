/**
 * An admin account in its deletion window is not an admin.
 *
 * Deleting an account soft-deletes it: deletedAt is set, the Supabase
 * identity stays until the purge, and the row keeps role 'admin'. Every admin
 * gate used to read the role alone, so a deleted admin with a live session (a
 * second device, a sign-in that did not restore) kept the console, the admin
 * API and the manual cron trigger.
 *
 *   - the API guard (requireApiAdmin, requireApiAdminActor) answers 403 and
 *     charges no admin budget;
 *   - the cron manual trigger (verifyCronOrAdmin) answers 403;
 *   - the page guard (requireAdmin) sends the account to the login form,
 *     keeping the console path, because signing in restores it; once the
 *     purge may take it, to the login form's account-unavailable message;
 *   - getCurrentUser reads such an account as signed out, or /login would
 *     forward it straight back to the console it was just turned away from.
 *
 * And a Supabase outage is never reported as "signed out": getUser() returns
 * those as error values, and the gates answer 500 for them.
 *
 * All fixtures are fictional.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type ProfileRow = { id: string; supabaseId: string; email: string; role: string; deletedAt: Date | null; purgeAt: Date | null };

const state = vi.hoisted(() => ({
    user: null as { id: string; email: string } | null,
    authError: null as unknown,
    profile: null as ProfileRow | null,
}));

vi.mock('next/navigation', () => ({
    redirect: vi.fn((url: string) => {
        throw new Error(`NEXT_REDIRECT ${url}`);
    }),
}));
vi.mock('@/lib/supabase/server', () => ({
    createClient: async () => ({
        auth: {
            getUser: async () => (state.user
                ? { data: { user: state.user }, error: null }
                : { data: { user: null }, error: state.authError }),
        },
    }),
}));
vi.mock('@/lib/prisma', () => ({ prisma: { userProfile: { findUnique: vi.fn(async () => state.profile) } } }));
vi.mock('@/lib/auth/ensure-profile', () => ({ ensureProfileFromAuth: vi.fn(async () => state.profile) }));
const limits = vi.hoisted(() => ({ rateLimit: vi.fn(async () => null), rateLimitShared: vi.fn(async () => null) }));
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: limits.rateLimit,
    rateLimitShared: limits.rateLimitShared,
    RATE_LIMITS: { admin: { limit: 60, windowSeconds: 60 }, adminIp: { limit: 120, windowSeconds: 60 } },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { requireApiAdmin, requireApiAdminActor } from '@/lib/auth/require-api-admin';
import { verifyCronOrAdmin } from '@/lib/auth/verify-cron-or-admin';
import { requireAdmin, getCurrentUser } from '@/lib/auth/protect';

const DAY_MS = 24 * 60 * 60 * 1000;
const ADMIN_PATH = '/admin/users';

function signInAs(role: string, deletion: { deletedAt: Date | null; purgeAt: Date | null } = { deletedAt: null, purgeAt: null }): void {
    state.user = { id: 'sb-admin-fic', email: 'admin@example.test' };
    state.profile = { id: 'profile-admin-fic', supabaseId: 'sb-admin-fic', email: 'admin@example.test', role, ...deletion };
}

const inWindow = () => ({ deletedAt: new Date(Date.now() - DAY_MS), purgeAt: new Date(Date.now() + 29 * DAY_MS) });
const lapsed = () => ({ deletedAt: new Date(Date.now() - 31 * DAY_MS), purgeAt: new Date(Date.now() - DAY_MS) });

function apiRequest(path = '/api/admin/users'): NextRequest {
    return new NextRequest(`https://example.test${path}`, { headers: { 'x-forwarded-for': '192.0.2.10' } });
}

/** The URL a page guard redirected to, or null when it let the request through. */
async function redirectOf(run: () => Promise<unknown>): Promise<string | null> {
    try {
        await run();
        return null;
    } catch (err) {
        const match = /^NEXT_REDIRECT (.*)$/.exec(err instanceof Error ? err.message : String(err));
        if (!match) throw err;
        return match[1];
    }
}

beforeEach(() => {
    vi.clearAllMocks();
    state.user = null;
    state.authError = null;
    state.profile = null;
    delete process.env.CRON_SECRET;
});

describe('the API guard', () => {
    it.each([
        ['inside its deletion window', inWindow],
        ['waiting for the purge', lapsed],
    ])('refuses an admin account %s with 403 and charges no admin budget', async (_label, deletion) => {
        signInAs('admin', deletion());
        expect((await requireApiAdmin(apiRequest()))?.status).toBe(403);

        const { error, actor } = await requireApiAdminActor(apiRequest());
        expect(error?.status).toBe(403);
        expect(actor).toBeNull();
        expect(limits.rateLimitShared).not.toHaveBeenCalled();
    });

    it('lets the same admin through once the account is active again', async () => {
        signInAs('admin');
        expect(await requireApiAdmin(apiRequest())).toBeNull();
        const { actor } = await requireApiAdminActor(apiRequest());
        expect(actor).toEqual({ profileId: 'profile-admin-fic', supabaseId: 'sb-admin-fic' });
    });
});

describe('the cron manual trigger', () => {
    it('refuses an admin account in its deletion window with 403', async () => {
        signInAs('admin', inWindow());
        expect((await verifyCronOrAdmin(apiRequest('/api/cron/oauth-cleanup')))?.status).toBe(403);
    });

    it('accepts an active admin session', async () => {
        signInAs('admin');
        expect(await verifyCronOrAdmin(apiRequest('/api/cron/oauth-cleanup'))).toBeNull();
    });
});

describe('the console page guard', () => {
    it('sends an admin in the deletion window to sign in again, keeping the console path', async () => {
        signInAs('admin', inWindow());
        const to = await redirectOf(() => requireAdmin(ADMIN_PATH));
        expect(to).toBe(`/login?error=deletion_scheduled&next=${encodeURIComponent(ADMIN_PATH)}`);
    });

    it('tells an admin past the window that the account is gone, with nowhere to return to', async () => {
        signInAs('admin', lapsed());
        expect(await redirectOf(() => requireAdmin(ADMIN_PATH))).toBe('/login?error=account_unavailable');
    });

    it('keeps the deep link for a signed-out visitor and /unauthorized for a non-admin', async () => {
        expect(await redirectOf(() => requireAdmin(ADMIN_PATH))).toBe(`/login?next=${encodeURIComponent(ADMIN_PATH)}`);

        signInAs('employer', inWindow());
        expect(await redirectOf(() => requireAdmin(ADMIN_PATH))).toBe('/unauthorized');
    });

    it('renders the console for an active admin', async () => {
        signInAs('admin');
        expect(await redirectOf(() => requireAdmin(ADMIN_PATH))).toBeNull();
    });
});

describe('getCurrentUser', () => {
    it('reads an account in its deletion window as signed out, so /login does not bounce it back', async () => {
        signInAs('admin', inWindow());
        expect(await getCurrentUser()).toBeNull();
    });

    it('still recognises an active account', async () => {
        signInAs('admin');
        expect((await getCurrentUser())?.profile?.id).toBe('profile-admin-fic');
    });
});

describe('an auth service outage is not a sign-out', () => {
    it.each([
        ['a request that never got an answer', { name: 'AuthRetryableFetchError', status: 0, message: 'fetch failed' }],
        ['a 503 from the auth service', { name: 'AuthRetryableFetchError', status: 503, message: 'Service Unavailable' }],
        ['an answer that was not the auth API', { name: 'AuthUnknownError', message: 'Unexpected token <' }],
        ['a 500 from the auth API', { name: 'AuthApiError', status: 500, message: 'Internal error' }],
    ])('%s answers 500 on every admin gate', async (_label, authError) => {
        state.authError = authError;
        expect((await requireApiAdmin(apiRequest()))?.status).toBe(500);
        expect((await verifyCronOrAdmin(apiRequest('/api/cron/oauth-cleanup')))?.status).toBe(500);
    });

    it('a missing session is still a 401', async () => {
        state.authError = { name: 'AuthSessionMissingError', status: 400, message: 'Auth session missing!' };
        expect((await requireApiAdmin(apiRequest()))?.status).toBe(401);
        expect((await verifyCronOrAdmin(apiRequest('/api/cron/oauth-cleanup')))?.status).toBe(401);
    });

    it('a profile lookup that throws is a 500, never a pass', async () => {
        signInAs('admin');
        const { prisma } = await import('@/lib/prisma');
        vi.mocked(prisma.userProfile.findUnique).mockRejectedValueOnce(new Error('connection reset') as never);
        expect((await requireApiAdmin(apiRequest()))?.status).toBe(500);
    });
});
