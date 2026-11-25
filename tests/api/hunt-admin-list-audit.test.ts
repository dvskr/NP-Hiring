/**
 * The audit entries for reading the users and jobs lists name the acting
 * admin by id. They used to store the admin's email address in metadata,
 * against lib/audit-log.ts's rule that entries hold no personal data.
 *
 * Each list records the id its own route family records for its mutations:
 * the users list the admin's profile id (as role.change and admin.user.* do
 * in /api/admin/users/:id), the jobs list the admin's auth id (as every
 * admin.job.* row does).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
    logAudit: vi.fn(),
    requireApiAdmin: vi.fn(),
    requireApiAdminActor: vi.fn(),
}));

vi.mock('@/lib/auth/require-api-admin', () => ({
    requireApiAdmin: mocks.requireApiAdmin,
    requireApiAdminActor: mocks.requireApiAdminActor,
}));
vi.mock('@/lib/audit-log', () => ({ logAudit: mocks.logAudit }));
vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn().mockResolvedValue({
        auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'sb-admin-1', email: 'op@example.com' } } }) },
    }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
// Every query fails: the audit entry is written before any data is read.
vi.mock('@/lib/prisma', () => {
    const fail = vi.fn().mockRejectedValue(new Error('db down'));
    const model = { findMany: fail, count: fail, groupBy: fail, aggregate: fail };
    return { prisma: { userProfile: model, emailLead: model, employerLead: model, job: model, $transaction: fail } };
});

import { GET as users } from '@/app/api/admin/users/route';
import { GET as jobs } from '@/app/api/admin/jobs/route';

const ADMIN = { profileId: 'admin-profile-1', supabaseId: 'sb-admin-1' };

beforeEach(() => {
    mocks.logAudit.mockReset().mockResolvedValue(undefined);
    mocks.requireApiAdmin.mockReset().mockResolvedValue(null);
    mocks.requireApiAdminActor.mockReset().mockResolvedValue({ error: null, actor: ADMIN });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe.each([
    ['users', users, 'admin.users.list', ADMIN.profileId],
    ['jobs', jobs, 'admin.jobs.list', ADMIN.supabaseId],
])('GET /api/admin/%s audit entry', (name, handler, action, actorId) => {
    it('records one entry naming the admin by id, with no email', async () => {
        await handler(new NextRequest(`https://example.com/api/admin/${name}`));
        expect(mocks.logAudit).toHaveBeenCalledTimes(1);
        const entry = mocks.logAudit.mock.calls[0][0];
        expect(entry).toMatchObject({ action, actorType: 'admin', actorId });
        expect(JSON.stringify(entry)).not.toContain('op@example.com');
        expect(JSON.stringify(entry)).not.toMatch(/email/i);
    });

    it('writes nothing for a request the guard refused', async () => {
        const refused = NextResponse.json({ error: 'Admin access required' }, { status: 403 });
        mocks.requireApiAdmin.mockResolvedValue(refused);
        mocks.requireApiAdminActor.mockResolvedValue({ error: refused, actor: null });
        const res = await handler(new NextRequest(`https://example.com/api/admin/${name}`));
        expect(res.status).toBe(403);
        expect(mocks.logAudit).not.toHaveBeenCalled();
    });
});
