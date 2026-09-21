/**
 * P10 admin-users-gates regressions:
 *  1. an admin cannot change their own role, deactivate or delete themselves
 *  2. role change, deactivate and hard delete write AuditLog rows
 *  3. /api/admin/cron-list answers 401/403 JSON (never 500 NEXT_REDIRECT)
 *  4. unknown ids are 404 and wrong-typed flags are 400
 *  5. requireApiAdmin always rate limits; health, email and pipeline-flow pass the request
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';

const getUserMock = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}));

const rateLimitMock = vi.fn();
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: (...args: unknown[]) => rateLimitMock(...args),
    RATE_LIMITS: { admin: { limit: 20, windowMs: 60_000 } },
}));

vi.mock('@/lib/prisma', () => ({
    prisma: {
        userProfile: {
            findUnique: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
        },
    },
}));

const logAuditMock = vi.fn();
vi.mock('@/lib/audit-log', () => ({
    logAudit: (...args: unknown[]) => logAuditMock(...args),
}));

vi.mock('@/lib/logger', () => ({
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/auth/protect', () => ({
    requireAdmin: vi.fn(async () => {
        throw new Error('NEXT_REDIRECT');
    }),
}));

import { prisma } from '@/lib/prisma';
import { requireApiAdmin } from '@/lib/auth/require-api-admin';
import { PATCH, DELETE } from '@/app/api/admin/users/[id]/route';
import { GET as cronListGET } from '@/app/api/admin/cron-list/route';

const ADMIN_PROFILE = 'admin-profile-id';
const ADMIN_SUPABASE = 'admin-supabase-id';
const TARGET = 'target-profile-id';

const findUnique = prisma.userProfile.findUnique as unknown as ReturnType<typeof vi.fn>;
const update = prisma.userProfile.update as unknown as ReturnType<typeof vi.fn>;
const del = prisma.userProfile.delete as unknown as ReturnType<typeof vi.fn>;

function req(url: string, method: string, body?: unknown): NextRequest {
    return new NextRequest(`https://example.com${url}`, {
        method,
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function signInAsAdmin(): void {
    getUserMock.mockResolvedValue({ data: { user: { id: ADMIN_SUPABASE } }, error: null });
    findUnique.mockImplementation(async ({ where }: { where: { supabaseId?: string; id?: string } }) => {
        if (where.supabaseId === ADMIN_SUPABASE) return { id: ADMIN_PROFILE, role: 'admin' };
        if (where.id === TARGET) return { role: 'employer', openToOffers: true, profileVisible: true };
        return null;
    });
}

function p2025(): Error {
    return Object.assign(new Error('Record not found'), { code: 'P2025' });
}

beforeEach(() => {
    vi.clearAllMocks();
    rateLimitMock.mockResolvedValue(null);
    logAuditMock.mockResolvedValue(undefined);
    signInAsAdmin();
});

describe('requireApiAdmin', () => {
    it('always applies the admin rate limit and returns its 429', async () => {
        const limited = NextResponse.json({ error: 'Too many requests' }, { status: 429 });
        rateLimitMock.mockResolvedValueOnce(limited);
        const res = await requireApiAdmin(req('/api/admin/health', 'GET'));
        expect(rateLimitMock).toHaveBeenCalledWith(expect.any(Request), 'admin', expect.anything());
        expect(res?.status).toBe(429);
    });

    it('answers 401 anonymous and 403 non-admin', async () => {
        getUserMock.mockResolvedValueOnce({ data: { user: null }, error: null });
        expect((await requireApiAdmin(req('/x', 'GET')))?.status).toBe(401);
        getUserMock.mockResolvedValueOnce({ data: { user: { id: 'seeker' } }, error: null });
        findUnique.mockResolvedValueOnce({ id: 'p', role: 'job_seeker' });
        expect((await requireApiAdmin(req('/x', 'GET')))?.status).toBe(403);
    });

    it('fails closed with 500 when the auth lookup throws', async () => {
        getUserMock.mockRejectedValueOnce(new Error('supabase down'));
        expect((await requireApiAdmin(req('/x', 'GET')))?.status).toBe(500);
    });

    it('every health, email and pipeline-flow call site passes the request', () => {
        const files = [
            'app/api/admin/health/route.ts',
            'app/api/admin/pipeline-flow/route.ts',
            'app/api/admin/cron-list/route.ts',
            'app/api/admin/email/audience/route.ts',
            'app/api/admin/email/history/route.ts',
            'app/api/admin/email/preview/route.ts',
            'app/api/admin/email/send/route.ts',
            'app/api/admin/email/templates/route.ts',
            'app/api/admin/email/test/route.ts',
        ];
        for (const f of files) {
            const src = readFileSync(path.join(process.cwd(), f), 'utf-8');
            expect(src, f).toMatch(/requireApiAdmin\((req|request)\)/);
            expect(src, f).not.toContain('requireApiAdmin()');
        }
    });
});

describe('GET /api/admin/cron-list gate', () => {
    it('anonymous gets 401 JSON, not 500 NEXT_REDIRECT', async () => {
        getUserMock.mockResolvedValueOnce({ data: { user: null }, error: null });
        const res = await cronListGET(req('/api/admin/cron-list', 'GET'));
        expect(res.status).toBe(401);
        expect(JSON.stringify(await res.json())).not.toContain('NEXT_REDIRECT');
    });

    it('non-admin gets 403', async () => {
        getUserMock.mockResolvedValueOnce({ data: { user: { id: 'seeker' } }, error: null });
        findUnique.mockResolvedValueOnce({ id: 'p', role: 'job_seeker' });
        const res = await cronListGET(req('/api/admin/cron-list', 'GET'));
        expect(res.status).toBe(403);
    });
});

describe('PATCH /api/admin/users/:id', () => {
    it('refuses a role change on the acting admin (self-lockout guard)', async () => {
        const res = await PATCH(req(`/api/admin/users/${ADMIN_PROFILE}`, 'PATCH', { role: 'job_seeker' }), ctx(ADMIN_PROFILE));
        expect(res.status).toBe(403);
        expect(update).not.toHaveBeenCalled();
    });

    it('audit-logs a role change with actor, target and from/to', async () => {
        update.mockResolvedValueOnce({ id: TARGET, role: 'admin', openToOffers: true, profileVisible: true });
        const res = await PATCH(req(`/api/admin/users/${TARGET}`, 'PATCH', { role: 'admin' }), ctx(TARGET));
        expect(res.status).toBe(200);
        expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({
            action: 'role.change',
            actorType: 'admin',
            actorId: ADMIN_PROFILE,
            targetType: 'user',
            targetId: TARGET,
            ip: '203.0.113.9',
            metadata: { from: 'employer', to: 'admin' },
        }));
    });

    it('answers 404 for an unknown id', async () => {
        const res = await PATCH(req('/api/admin/users/missing', 'PATCH', { role: 'employer' }), ctx('missing'));
        expect(res.status).toBe(404);
        expect(update).not.toHaveBeenCalled();
    });

    it('maps a P2025 race on update to 404', async () => {
        update.mockRejectedValueOnce(p2025());
        const res = await PATCH(req(`/api/admin/users/${TARGET}`, 'PATCH', { role: 'employer' }), ctx(TARGET));
        expect(res.status).toBe(404);
    });

    it.each([
        [{ profileVisible: 'no' }],
        [{ openToOffers: 1 }],
        [{ role: 'superuser' }],
        [{}],
        [['role']],
    ])('rejects invalid body %j with 400', async (body) => {
        const res = await PATCH(req(`/api/admin/users/${TARGET}`, 'PATCH', body), ctx(TARGET));
        expect(res.status).toBe(400);
        expect(update).not.toHaveBeenCalled();
    });
});

describe('DELETE /api/admin/users/:id', () => {
    it('refuses deactivating or hard deleting the acting admin', async () => {
        const soft = await DELETE(req(`/api/admin/users/${ADMIN_PROFILE}`, 'DELETE'), ctx(ADMIN_PROFILE));
        const hard = await DELETE(req(`/api/admin/users/${ADMIN_PROFILE}?hard=true`, 'DELETE'), ctx(ADMIN_PROFILE));
        expect(soft.status).toBe(403);
        expect(hard.status).toBe(403);
        expect(update).not.toHaveBeenCalled();
        expect(del).not.toHaveBeenCalled();
    });

    it('audit-logs deactivation', async () => {
        update.mockResolvedValueOnce({});
        const res = await DELETE(req(`/api/admin/users/${TARGET}`, 'DELETE'), ctx(TARGET));
        expect(res.status).toBe(200);
        expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({
            action: 'admin.user.deactivate', actorId: ADMIN_PROFILE, targetId: TARGET,
        }));
    });

    it('audit-logs hard deletion', async () => {
        del.mockResolvedValueOnce({});
        const res = await DELETE(req(`/api/admin/users/${TARGET}?hard=true`, 'DELETE'), ctx(TARGET));
        expect(res.status).toBe(200);
        expect((await res.json()).action).toBe('hard_deleted');
        expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({
            action: 'admin.user.hard_delete', actorId: ADMIN_PROFILE, targetId: TARGET,
        }));
    });

    it('answers 404 for an unknown id', async () => {
        const res = await DELETE(req('/api/admin/users/missing', 'DELETE'), ctx('missing'));
        expect(res.status).toBe(404);
        expect(logAuditMock).not.toHaveBeenCalled();
    });
});
