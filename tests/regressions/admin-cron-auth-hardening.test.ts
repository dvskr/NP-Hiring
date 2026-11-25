/**
 * Two auth-layer defects, both about a gate that was wider or narrower than
 * the thing it guards.
 *
 *   - requireApiAdmin charged one 20 req/min bucket keyed on IP alone, before
 *     the session was known and shared by every /api/admin route. An operator
 *     walking through the console spent it in a minute, and anonymous traffic
 *     from the same address spent it for them. Now a loose per-IP guard runs
 *     before authentication (RATE_LIMITS.adminIp) and the real budget belongs
 *     to the admin and the route group (RATE_LIMITS.admin), through the
 *     shared limiter.
 *   - verifyCronOrAdmin skipped authentication whenever NODE_ENV was
 *     'development' off Vercel, even with a CRON_SECRET configured, so a
 *     self-hosted deployment built that way served the destructive cron
 *     routes to anonymous callers.
 *
 * The real in-memory limiter runs here (no Redis is configured under test),
 * so these exercise the budgets themselves rather than a mocked call. Every
 * test signs in its own admin from its own address, so one test's spent
 * budget is never another's.
 *
 * All fixtures are fictional.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Hoisted with the vi.mock factories that read them.
const session = vi.hoisted(() => ({
    user: null as { id: string } | null,
    role: 'admin',
}));

vi.mock('@/lib/supabase/server', () => ({
    createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: session.user }, error: null }) },
    }),
}));

vi.mock('@/lib/prisma', () => ({
    prisma: {
        userProfile: {
            findUnique: async () => (session.user
                ? { id: `profile-${session.user.id}`, role: session.role, deletedAt: null }
                : null),
        },
    },
}));

vi.mock('@/lib/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
    requireApiAdmin,
    requireApiAdminActor,
    adminRateLimitKey,
    highImpactRateLimitKey,
    limitHighImpactAdminAction,
    HIGH_IMPACT_ADMIN_ACTIONS,
} from '@/lib/auth/require-api-admin';
import { isUnauthenticatedCronAllowed } from '@/lib/auth/verify-cron-or-admin';
import { RATE_LIMITS } from '@/lib/rate-limit';

const ADMIN_BUDGET = RATE_LIMITS.admin.limit;
const IP_BUDGET = RATE_LIMITS.adminIp.limit;

let seq = 0;

/** A fresh documentation-range address per call. */
function nextAddress(): string {
    seq += 1;
    return `198.51.100.${seq}`;
}

/** A distinct admin per call, so one test's spent budget is not another's. */
function signInAsAdmin(): string {
    seq += 1;
    const id = `supabase-admin-fic-${Date.now()}-${seq}`;
    session.user = { id };
    session.role = 'admin';
    return id;
}

function adminRequest(pathname: string, ip: string): NextRequest {
    return new NextRequest(`http://localhost:3000${pathname}`, {
        method: 'GET',
        headers: { 'x-forwarded-for': ip },
    });
}

/** Statuses of `count` calls, null for an authorized one. */
async function statuses(count: number, call: () => Promise<Response | null>): Promise<Array<number | null>> {
    const out: Array<number | null> = [];
    for (let i = 0; i < count; i += 1) {
        const res = await call();
        out.push(res ? res.status : null);
    }
    return out;
}

beforeEach(() => {
    vi.clearAllMocks();
    session.user = null;
    session.role = 'admin';
});

describe('the budgets', () => {
    it('are 60 a minute per admin per route group, behind 120 a minute per address', () => {
        expect(RATE_LIMITS.admin).toEqual({ limit: 60, windowSeconds: 60 });
        expect(RATE_LIMITS.adminIp).toEqual({ limit: 120, windowSeconds: 60 });
        // The address guard stays looser than one admin's budget, so a real
        // console session is limited by its own budget, never by the guard.
        expect(IP_BUDGET).toBeGreaterThan(ADMIN_BUDGET);
    });
});

describe('the pre-auth guard', () => {
    it('bounds anonymous hammering per address, before any session is read', async () => {
        const address = nextAddress();
        const anonymous = await statuses(IP_BUDGET, () => requireApiAdmin(adminRequest('/api/admin/jobs', address)));
        expect(new Set(anonymous)).toEqual(new Set([401]));

        expect((await requireApiAdmin(adminRequest('/api/admin/jobs', address)))?.status).toBe(429);
        // Another address is not affected.
        expect((await requireApiAdmin(adminRequest('/api/admin/jobs', nextAddress())))?.status).toBe(401);
    });
});

describe('the admin budget belongs to an admin and a route group, not to an address', () => {
    it('gives two admins on the same address separate allowances', async () => {
        const address = nextAddress();
        const first = signInAsAdmin();
        const used = await statuses(ADMIN_BUDGET, () => requireApiAdmin(adminRequest('/api/admin/jobs', address)));
        expect(new Set(used)).toEqual(new Set([null]));
        expect((await requireApiAdmin(adminRequest('/api/admin/jobs', address)))?.status).toBe(429);

        const second = signInAsAdmin();
        expect(second).not.toBe(first);
        expect(await requireApiAdmin(adminRequest('/api/admin/jobs', address))).toBeNull();
    });

    it('does not spend an allowance on a route group the admin has not used', async () => {
        const address = nextAddress();
        signInAsAdmin();
        await statuses(ADMIN_BUDGET, () => requireApiAdmin(adminRequest('/api/admin/jobs', address)));
        expect((await requireApiAdmin(adminRequest('/api/admin/jobs', address)))?.status).toBe(429);

        expect(await requireApiAdmin(adminRequest('/api/admin/users', address))).toBeNull();
    });

    it('shares one allowance across the records of a route group', async () => {
        const address = nextAddress();
        signInAsAdmin();
        let record = 0;
        const recordPath = () => {
            record += 1;
            return `/api/admin/jobs/0f8fad5b-d9cb-469f-a165-${String(record).padStart(12, '0')}`;
        };
        const used = await statuses(ADMIN_BUDGET, () => requireApiAdmin(adminRequest(recordPath(), address)));
        expect(new Set(used)).toEqual(new Set([null]));
        expect((await requireApiAdmin(adminRequest(recordPath(), address)))?.status).toBe(429);
    });

    it('does not let anonymous traffic from the same address spend the admin allowance', async () => {
        const address = nextAddress();
        const anonymous = await statuses(ADMIN_BUDGET, () => requireApiAdmin(adminRequest('/api/admin/jobs', address)));
        expect(new Set(anonymous)).toEqual(new Set([401]));

        // The whole budget is still there (the address guard allows exactly this many more).
        signInAsAdmin();
        const used = await statuses(ADMIN_BUDGET, () => requireApiAdmin(adminRequest('/api/admin/jobs', address)));
        expect(new Set(used)).toEqual(new Set([null]));
    });

    it('does not let a signed-in non-admin spend the allowance either', async () => {
        const address = nextAddress();
        signInAsAdmin();
        session.role = 'job_seeker';
        const refused = await statuses(ADMIN_BUDGET, () => requireApiAdmin(adminRequest('/api/admin/jobs', address)));
        expect(new Set(refused)).toEqual(new Set([403]));

        session.role = 'admin';
        const used = await statuses(ADMIN_BUDGET, () => requireApiAdmin(adminRequest('/api/admin/jobs', address)));
        expect(new Set(used)).toEqual(new Set([null]));
    });

    it('is one budget whichever form of the guard a route calls, and the actor form names the admin', async () => {
        const address = nextAddress();
        const supabaseId = signInAsAdmin();
        const half = ADMIN_BUDGET / 2;
        await statuses(half, () => requireApiAdmin(adminRequest('/api/admin/users', address)));

        for (let i = 0; i < half; i += 1) {
            const { error, actor } = await requireApiAdminActor(adminRequest('/api/admin/users', address));
            expect(error).toBeNull();
            expect(actor).toEqual({ profileId: `profile-${supabaseId}`, supabaseId });
        }

        const over = await requireApiAdminActor(adminRequest('/api/admin/users', address));
        expect(over.error?.status).toBe(429);
        expect(over.actor).toBeNull();
    });
});

describe('the high-impact budget (a broadcast send, a bulk hard delete, a user deletion)', () => {
    const HIGH_IMPACT_BUDGET = RATE_LIMITS.adminHighImpact.limit;

    /** A distinct admin identity per call, so one test's spent budget is not another's. */
    function freshActor(): { profileId: string; supabaseId: string } {
        seq += 1;
        const supabaseId = `supabase-admin-fic-high-${Date.now()}-${seq}`;
        return { profileId: `profile-${supabaseId}`, supabaseId };
    }

    it('is 10 a minute, tighter than the general admin budget', () => {
        expect(RATE_LIMITS.adminHighImpact).toEqual({ limit: 10, windowSeconds: 60 });
        expect(HIGH_IMPACT_BUDGET).toBeLessThan(ADMIN_BUDGET);
    });

    it('lets ten through, then answers 429 with Retry-After', async () => {
        const actor = freshActor();
        const used = await statuses(HIGH_IMPACT_BUDGET, () => limitHighImpactAdminAction('email-send', actor));
        expect(new Set(used)).toEqual(new Set([null]));

        const over = await limitHighImpactAdminAction('email-send', actor);
        expect(over?.status).toBe(429);
        expect(over?.headers.get('Retry-After')).toBeTruthy();
    });

    it('keeps a separate allowance per action and per admin', async () => {
        const actor = freshActor();
        await statuses(HIGH_IMPACT_BUDGET, () => limitHighImpactAdminAction('jobs-hard-delete', actor));
        expect((await limitHighImpactAdminAction('jobs-hard-delete', actor))?.status).toBe(429);

        expect(await limitHighImpactAdminAction('users-delete', actor)).toBeNull();
        expect(await limitHighImpactAdminAction('jobs-hard-delete', freshActor())).toBeNull();
    });

    it('names each action and admin in its key, apart from the route group budget', () => {
        const USER = 'supabase-admin-fic-keys';
        const keys = HIGH_IMPACT_ADMIN_ACTIONS.map((action) => highImpactRateLimitKey(action, USER));
        expect(new Set(keys).size).toBe(HIGH_IMPACT_ADMIN_ACTIONS.length);
        for (const key of keys) {
            expect(key).toContain(USER);
            expect(key.startsWith('admin:')).toBe(false);
        }
    });
});

describe('admin rate-limit keys', () => {
    const USER = 'supabase-admin-fic-keys';

    it('separates route groups and admins', () => {
        expect(adminRateLimitKey('/api/admin/jobs', USER)).not.toBe(adminRateLimitKey('/api/admin/users', USER));
        expect(adminRateLimitKey('/api/admin/jobs', USER)).not.toBe(
            adminRateLimitKey('/api/admin/jobs', 'supabase-admin-fic-other'),
        );
    });

    it('collapses record ids (cuid and uuid) so a loop over rows cannot mint fresh allowances', () => {
        expect(adminRateLimitKey('/api/admin/users/clx0000000000000000fic1', USER)).toBe(
            adminRateLimitKey('/api/admin/users/clx0000000000000000fic2', USER),
        );
        expect(adminRateLimitKey('/api/admin/jobs/0f8fad5b-d9cb-469f-a165-70867728950e', USER)).toBe(
            adminRateLimitKey('/api/admin/jobs/7c9e6679-7425-40de-944b-e07fc1f90ae7', USER),
        );
        expect(adminRateLimitKey('/api/admin/guides/clx0000000000000000fic3/rotate', USER)).toBe(
            adminRateLimitKey('/api/admin/guides/clx0000000000000000fic4/rotate', USER),
        );
    });

    it('keeps route names, which hold no digits, as they are', () => {
        for (const route of ['/api/admin/company-claims', '/api/admin/pipeline-flow', '/api/admin/testimonials']) {
            expect(adminRateLimitKey(route, USER)).toBe(`admin:${route}:${USER}`);
        }
    });

    it('still scopes a request with no readable path to the admin', () => {
        expect(adminRateLimitKey(undefined, USER)).toContain(USER);
        expect(adminRateLimitKey(undefined, USER)).not.toBe(adminRateLimitKey(undefined, 'supabase-admin-fic-other'));
    });
});

describe('the cron bypass is not decided by NODE_ENV alone', () => {
    const local = { NODE_ENV: 'development' } as NodeJS.ProcessEnv;

    it('stays open for a local checkout with no cron secret to present', () => {
        expect(isUnauthenticatedCronAllowed(local)).toBe(true);
    });

    it('closes as soon as a cron secret is configured', () => {
        expect(isUnauthenticatedCronAllowed({ ...local, CRON_SECRET: 'fictional-secret' })).toBe(false);
    });

    it('closes on a Vercel deployment however NODE_ENV is set', () => {
        expect(isUnauthenticatedCronAllowed({ ...local, VERCEL: '1' })).toBe(false);
        expect(isUnauthenticatedCronAllowed({ ...local, VERCEL_ENV: 'preview' })).toBe(false);
    });

    it('closes in production and under test', () => {
        expect(isUnauthenticatedCronAllowed({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(false);
        expect(isUnauthenticatedCronAllowed({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).toBe(false);
    });
});
