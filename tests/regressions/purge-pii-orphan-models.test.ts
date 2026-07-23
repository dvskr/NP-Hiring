/**
 * F34 regression — the hard-purge cron must explicitly delete models that
 * have NO @relation/FK back to UserProfile, because dropping the profile
 * row cannot cascade into them:
 *
 *   - SavedJob.userId        → Supabase auth id (schema: saved_jobs)
 *   - PushSubscription.userId → Supabase auth id (schema: push_subscriptions)
 *   - JobDraft.userId/email  → Supabase auth id / contact email (job_drafts)
 *   - CandidateTag.employerId → UserProfile.id (candidate_tags)
 *   - JobAlert.email         → raw email, FK to EmailLead(email) RESTRICT
 *   - EmailLead.email        → raw email
 *
 * Pre-fix, these rows survived GDPR erasure: the push-notifications cron
 * (`pushSubscription.findMany()` with no filter) kept sending pushes to a
 * purged user's browser, and job_drafts/email_leads kept raw PII forever.
 *
 * The fix runs all six deletes plus the profile delete in ONE transaction,
 * with JobAlert deleted before EmailLead (required FK, default RESTRICT).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';

const deleteFileMock = vi.fn().mockResolvedValue(undefined);
const adminDeleteUserMock = vi.fn().mockResolvedValue({ error: null });

vi.mock('@/lib/supabase-storage', () => ({
    deleteFile: (...args: unknown[]) => deleteFileMock(...args),
    getPathFromUrl: (url: string) => {
        const m = url.match(/\/(resumes|avatars)\/(.+)$/);
        return m ? m[2] : null;
    },
}));
vi.mock('@/lib/audit-log', () => ({
    logAudit: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/discord-notifier', () => ({
    sendCronFailureAlert: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/auth/verify-cron-or-admin', () => ({
    verifyCronOrAdmin: vi.fn().mockResolvedValue(null),
}));
vi.mock('@supabase/supabase-js', () => ({
    createClient: vi.fn().mockReturnValue({
        auth: { admin: { deleteUser: adminDeleteUserMock } },
    }),
}));

function fakeRequest(): Request {
    return new Request('https://example.com/api/cron/purge-soft-deleted', {
        headers: { 'authorization': 'Bearer ' + (process.env.CRON_SECRET ?? 'test') },
    });
}

const dueUser = {
    id: 'profile-1',
    supabaseId: 'auth-1',
    email: 'purged@example.com',
    resumeUrl: null,
    avatarUrl: null,
};

describe('purge-soft-deleted F34 — relation-less orphan models are purged', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
        process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_role_key_test';
    });

    it('deletes SavedJob + PushSubscription + JobDraft by supabase auth id', async () => {
        vi.mocked(prisma.userProfile.findMany).mockResolvedValue([dueUser] as never);
        vi.mocked(prisma.userProfile.delete).mockResolvedValue({} as never);

        const { GET } = await import('@/app/api/cron/purge-soft-deleted/route');
        const res = await GET(fakeRequest() as never);

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.purgedCount).toBe(1);

        // Keyed by the Supabase auth id, NOT the profile id.
        expect(prisma.savedJob.deleteMany).toHaveBeenCalledWith({
            where: { userId: 'auth-1' },
        });
        expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
            where: { userId: 'auth-1' },
        });
        // Drafts match on auth id OR the contact email left in the draft row.
        expect(prisma.jobDraft.deleteMany).toHaveBeenCalledWith({
            where: { OR: [{ userId: 'auth-1' }, { email: 'purged@example.com' }] },
        });
    });

    it('deletes CandidateTag by profile id and EmailLead/JobAlert by email', async () => {
        vi.mocked(prisma.userProfile.findMany).mockResolvedValue([dueUser] as never);
        vi.mocked(prisma.userProfile.delete).mockResolvedValue({} as never);

        const { GET } = await import('@/app/api/cron/purge-soft-deleted/route');
        const res = await GET(fakeRequest() as never);
        expect(res.status).toBe(200);

        // CandidateTag.employerId references UserProfile.id (see
        // app/api/employer/tags/route.ts — `employerId: profile.id`).
        expect(prisma.candidateTag.deleteMany).toHaveBeenCalledWith({
            where: { employerId: 'profile-1' },
        });
        expect(prisma.jobAlert.deleteMany).toHaveBeenCalledWith({
            where: { email: 'purged@example.com' },
        });
        expect(prisma.emailLead.deleteMany).toHaveBeenCalledWith({
            where: { email: 'purged@example.com' },
        });
    });

    it('orders JobAlert before EmailLead (required FK, RESTRICT on delete)', async () => {
        vi.mocked(prisma.userProfile.findMany).mockResolvedValue([dueUser] as never);
        vi.mocked(prisma.userProfile.delete).mockResolvedValue({} as never);

        const { GET } = await import('@/app/api/cron/purge-soft-deleted/route');
        await GET(fakeRequest() as never);

        const alertOrder = vi.mocked(prisma.jobAlert.deleteMany).mock.invocationCallOrder[0];
        const leadOrder = vi.mocked(prisma.emailLead.deleteMany).mock.invocationCallOrder[0];
        expect(alertOrder).toBeDefined();
        expect(leadOrder).toBeDefined();
        expect(alertOrder).toBeLessThan(leadOrder);
    });

    it('runs the orphan deletes and profile delete in one transaction', async () => {
        vi.mocked(prisma.userProfile.findMany).mockResolvedValue([dueUser] as never);
        vi.mocked(prisma.userProfile.delete).mockResolvedValue({} as never);

        const { GET } = await import('@/app/api/cron/purge-soft-deleted/route');
        await GET(fakeRequest() as never);

        // 6 orphan-model deleteMany calls + the userProfile.delete = 7 ops,
        // all handed to a single $transaction so a partial failure rolls
        // back and the profile row survives to drive a retry.
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        const ops = vi.mocked(prisma.$transaction).mock.calls[0][0] as unknown as unknown[];
        expect(Array.isArray(ops)).toBe(true);
        expect(ops).toHaveLength(7);
        expect(prisma.userProfile.delete).toHaveBeenCalledWith({ where: { id: 'profile-1' } });
        expect(adminDeleteUserMock).toHaveBeenCalledWith('auth-1');
    });

    it('keeps the auth identity when the purge transaction fails, so the user retries next run', async () => {
        vi.mocked(prisma.userProfile.findMany).mockResolvedValue([dueUser] as never);
        vi.mocked(prisma.savedJob.deleteMany).mockRejectedValue(new Error('db down'));
        vi.mocked(prisma.userProfile.delete).mockResolvedValue({} as never);

        const { GET } = await import('@/app/api/cron/purge-soft-deleted/route');
        const res = await GET(fakeRequest() as never);

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.purgedCount).toBe(0);
        expect(json.failures).toHaveLength(1);
        expect(json.failures[0].id).toBe('profile-1');
        // Auth identity must NOT be dropped — the profile row (transaction
        // rollback) still exists, and next run needs the pair intact.
        expect(adminDeleteUserMock).not.toHaveBeenCalled();
    });
});
