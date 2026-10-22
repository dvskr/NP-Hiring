/**
 * C3 regression — when a soft-deleted account's grace period lapses,
 * the purge-soft-deleted cron must remove ALL PII, not just the profile
 * row + Supabase auth identity.
 *
 * What must happen on purge:
 *   1. Resume file deleted from Supabase Storage
 *   2. Avatar file deleted from Supabase Storage (if present)
 *   3. CandidateEmbedding row deleted (input_hash + 1536-dim vector)
 *   4. EmailSend rows for that address anonymized (recipient → redacted)
 *   5. UserProfile row deleted
 *   6. Supabase Auth identity deleted
 *
 * Pre-fix code only did steps 5 + 6 (the audit-runbook C3 finding).
 *
 * AUTH-PROFILE-1 / RES-2 (2026-10-14): both columns were writable by the user
 * being purged, so a stored value could name ANOTHER user's object, which the
 * service-role delete then removed. Only keys in the purged user's own upload
 * folder (`<prefix>/<supabaseId>/<file>`) are deleted now. The real path
 * helpers run here (only deleteFile is stubbed): the earlier mocked
 * getPathFromUrl hid that the real one never resolves the bare key
 * /api/upload stores, so those résumés survived erasure.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

const deleteFileMock = vi.fn().mockResolvedValue(undefined);
const removeFoldersMock = vi.fn().mockResolvedValue({ removed: 0, failed: [] });
const adminDeleteUserMock = vi.fn().mockResolvedValue({ error: null });

vi.mock('@/lib/supabase-storage', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/supabase-storage')>()),
    deleteFile: (...args: unknown[]) => deleteFileMock(...args),
    removeUserUploadFolders: (...args: unknown[]) => removeFoldersMock(...args),
}));
vi.mock('@/lib/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
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

describe('purge-soft-deleted C3 — full PII erasure', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
        process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_role_key_test';
        // The re-check just before an account's files go: still deleted and due.
        vi.mocked(prisma.userProfile.findFirst).mockResolvedValue({ id: 'due' } as never);
    });

    // Review of 2.26 (L2): the profile goes in the same run, so a folder the
    // erasure could not empty is never revisited. The audit record names it.
    it('names the upload folders it could not empty in the purge audit record', async () => {
        vi.mocked(prisma.userProfile.findMany).mockResolvedValue([
            { id: 'u8', supabaseId: 'sb8', email: 'g8@example.com', resumeUrl: null, avatarUrl: null },
        ] as never);
        removeFoldersMock.mockResolvedValueOnce({ removed: 3, failed: ['resumes/local/sb8'] });
        vi.mocked(prisma.userProfile.delete).mockResolvedValue({} as never);

        const { GET } = await import('@/app/api/cron/purge-soft-deleted/route');
        const res = await GET(fakeRequest() as never);
        const { logAudit } = await import('@/lib/audit-log');

        expect((await res.json()).purgedCount).toBe(1);
        expect(vi.mocked(logAudit)).toHaveBeenCalledWith(expect.objectContaining({
            action: 'account.purge',
            metadata: expect.objectContaining({ uploadFoldersLeft: ['resumes/local/sb8'] }),
        }));
    });

    // Security review of 2.26: the batch is read once, and each account now
    // takes several storage round trips, so an account restored after the
    // read lost every upload while its profile survived. It is re-read first.
    it('skips an account restored after the batch was read: no file, no profile, no auth user touched', async () => {
        vi.mocked(prisma.userProfile.findMany).mockResolvedValue([
            { id: 'u9', supabaseId: 'sb9', email: 'back@example.com', resumeUrl: 'local/sb9/1700000000000-cv.pdf', avatarUrl: null },
        ] as never);
        vi.mocked(prisma.userProfile.findFirst).mockResolvedValue(null as never);

        const { GET } = await import('@/app/api/cron/purge-soft-deleted/route');
        const res = await GET(fakeRequest() as never);

        expect(res.status).toBe(200);
        expect((await res.json()).purgedCount).toBe(0);
        expect(prisma.userProfile.findFirst).toHaveBeenCalledWith({
            where: { id: 'u9', deletedAt: { not: null }, purgeAt: { lte: expect.any(Date) } },
            select: { id: true },
        });
        expect(deleteFileMock).not.toHaveBeenCalled();
        expect(removeFoldersMock).not.toHaveBeenCalled();
        expect(prisma.userProfile.delete).not.toHaveBeenCalled();
        expect(adminDeleteUserMock).not.toHaveBeenCalled();
    });

    it('deletes resume + avatar + embedding + anonymizes email_sends + drops profile + deletes auth', async () => {
        vi.mocked(prisma.userProfile.findMany).mockResolvedValue([
            {
                id: 'u1',
                supabaseId: 'sb1',
                email: 'gone@example.com',
                resumeUrl: 'https://test.supabase.co/storage/v1/object/sign/resumes/local/sb1/1700000000000-cv.pdf?token=t',
                avatarUrl: 'https://test.supabase.co/storage/v1/object/public/avatars/local/sb1/1700000000000.jpg',
            },
        ] as never);
        vi.mocked(prisma.candidateEmbedding.delete).mockResolvedValue({} as never);
        vi.mocked(prisma.emailSend.updateMany).mockResolvedValue({ count: 7 } as never);
        vi.mocked(prisma.userProfile.delete).mockResolvedValue({} as never);

        const { GET } = await import('@/app/api/cron/purge-soft-deleted/route');
        const res = await GET(fakeRequest() as never);

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.purgedCount).toBe(1);

        // Storage
        expect(deleteFileMock).toHaveBeenCalledWith('local/sb1/1700000000000-cv.pdf', 'resume');
        expect(deleteFileMock).toHaveBeenCalledWith('local/sb1/1700000000000.jpg', 'avatar');
        // Register 2.26: every earlier upload in the account folders goes too.
        expect(removeFoldersMock).toHaveBeenCalledWith('sb1');
        // Embedding
        expect(prisma.candidateEmbedding.delete).toHaveBeenCalledWith({ where: { supabaseId: 'sb1' } });
        // Email anonymization
        expect(prisma.emailSend.updateMany).toHaveBeenCalledWith({
            where: { to: 'gone@example.com' },
            data: expect.objectContaining({ to: expect.stringContaining('redacted') }),
        });
        // Profile + auth
        expect(prisma.userProfile.delete).toHaveBeenCalledWith({ where: { id: 'u1' } });
        expect(adminDeleteUserMock).toHaveBeenCalledWith('sb1');
    });

    it('continues to delete auth + profile even if resume delete fails', async () => {
        vi.mocked(prisma.userProfile.findMany).mockResolvedValue([
            {
                id: 'u2', supabaseId: 'sb2', email: 'g2@example.com',
                resumeUrl: 'local/sb2/1700000000000-cv.pdf',
                avatarUrl: null,
            },
        ] as never);
        deleteFileMock.mockRejectedValueOnce(new Error('storage 500'));
        vi.mocked(prisma.candidateEmbedding.delete).mockResolvedValue({} as never);
        vi.mocked(prisma.emailSend.updateMany).mockResolvedValue({ count: 0 } as never);
        vi.mocked(prisma.userProfile.delete).mockResolvedValue({} as never);

        const { GET } = await import('@/app/api/cron/purge-soft-deleted/route');
        const res = await GET(fakeRequest() as never);

        const json = await res.json();
        expect(res.status).toBe(200);
        expect(json.purgedCount).toBe(1);
        expect(deleteFileMock).toHaveBeenCalledWith('local/sb2/1700000000000-cv.pdf', 'resume');
        // Profile still dropped despite the storage failure (defensive design)
        expect(prisma.userProfile.delete).toHaveBeenCalledWith({ where: { id: 'u2' } });
        expect(adminDeleteUserMock).toHaveBeenCalledWith('sb2');
    });

    it('deletes the bare key /api/upload stores, which the URL-only parser used to skip', async () => {
        vi.mocked(prisma.userProfile.findMany).mockResolvedValue([
            { id: 'u4', supabaseId: 'sb4', email: 'g4@example.com', resumeUrl: 'prod/sb4/1700000000000-cv.pdf', avatarUrl: null },
        ] as never);
        vi.mocked(prisma.userProfile.delete).mockResolvedValue({} as never);

        const { GET } = await import('@/app/api/cron/purge-soft-deleted/route');
        await GET(fakeRequest() as never);

        expect(deleteFileMock).toHaveBeenCalledTimes(1);
        expect(deleteFileMock).toHaveBeenCalledWith('prod/sb4/1700000000000-cv.pdf', 'resume');
    });

    it("never deletes another user's objects named by the purged user's columns, and still purges the user", async () => {
        vi.mocked(prisma.userProfile.findMany).mockResolvedValue([
            {
                id: 'u5', supabaseId: 'sb5', email: 'g5@example.com',
                resumeUrl: 'https://test.supabase.co/storage/v1/object/sign/resumes/local/victim-uid/1700000000000-cv.pdf?token=t',
                avatarUrl: 'https://test.supabase.co/storage/v1/object/public/avatars/local/victim-uid/1700000000000.jpg',
            },
        ] as never);
        vi.mocked(prisma.userProfile.delete).mockResolvedValue({} as never);

        const { GET } = await import('@/app/api/cron/purge-soft-deleted/route');
        const res = await GET(fakeRequest() as never);

        expect((await res.json()).purgedCount).toBe(1);
        expect(deleteFileMock).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledTimes(2);
        expect(prisma.userProfile.delete).toHaveBeenCalledWith({ where: { id: 'u5' } });
        expect(adminDeleteUserMock).toHaveBeenCalledWith('sb5');
    });

    it('skips a sign-in provider picture quietly: it is not a storage object', async () => {
        vi.mocked(prisma.userProfile.findMany).mockResolvedValue([
            {
                id: 'u6', supabaseId: 'sb6', email: 'g6@example.com', resumeUrl: null,
                avatarUrl: 'https://lh3.googleusercontent.com/a/ACg8ocK=s96-c',
            },
        ] as never);
        vi.mocked(prisma.userProfile.delete).mockResolvedValue({} as never);

        const { GET } = await import('@/app/api/cron/purge-soft-deleted/route');
        await GET(fakeRequest() as never);

        expect(deleteFileMock).not.toHaveBeenCalled();
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('survives missing embedding (P2025) silently', async () => {
        vi.mocked(prisma.userProfile.findMany).mockResolvedValue([
            { id: 'u3', supabaseId: 'sb3', email: 'g3@example.com', resumeUrl: null, avatarUrl: null },
        ] as never);
        const notFound: Error & { code?: string } = new Error('not found');
        notFound.code = 'P2025';
        vi.mocked(prisma.candidateEmbedding.delete).mockRejectedValue(notFound);
        vi.mocked(prisma.emailSend.updateMany).mockResolvedValue({ count: 0 } as never);
        vi.mocked(prisma.userProfile.delete).mockResolvedValue({} as never);

        const { GET } = await import('@/app/api/cron/purge-soft-deleted/route');
        const res = await GET(fakeRequest() as never);

        expect(res.status).toBe(200);
        // Profile still purged
        expect(prisma.userProfile.delete).toHaveBeenCalledWith({ where: { id: 'u3' } });
    });

    it('no-ops when nothing is due', async () => {
        vi.mocked(prisma.userProfile.findMany).mockResolvedValue([] as never);
        const { GET } = await import('@/app/api/cron/purge-soft-deleted/route');
        const res = await GET(fakeRequest() as never);
        const json = await res.json();
        expect(res.status).toBe(200);
        expect(json.purgedCount).toBe(0);
        expect(deleteFileMock).not.toHaveBeenCalled();
        expect(prisma.candidateEmbedding.delete).not.toHaveBeenCalled();
    });
});
