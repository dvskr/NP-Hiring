/**
 * Register 2.26, storage housekeeping: DELETE /api/profile/resume removed
 * only the current resume, so every replaced resume and every cover letter
 * no application names stayed in storage for good.
 *
 * After it clears the reference, the route now sweeps the caller's own
 * resume folders (removeUnreferencedResumeUploads, tested in
 * tests/lib/remove-user-upload-folders.test.ts), keeping every file one of
 * the caller's applications still names, since the employer opens the file
 * an application names. The current resume is still removed even when an
 * application names it, as before (DECISION D35). A failed sweep never
 * fails the delete.
 *
 * Supabase and the database are mocked; nothing here reaches either.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
    getUser: vi.fn(),
    remove: vi.fn(),
    profileFindUnique: vi.fn(),
    profileUpdate: vi.fn(),
    applicationFindMany: vi.fn(),
    sweep: vi.fn(),
    error: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
    createClient: vi.fn(() => ({ storage: { from: vi.fn(() => ({ remove: h.remove })) } })),
}));
vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: h.getUser } })),
}));
vi.mock('@/lib/prisma', () => ({
    prisma: {
        userProfile: { findUnique: h.profileFindUnique, update: h.profileUpdate },
        jobApplication: { findMany: h.applicationFindMany },
    },
}));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(async () => null) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: h.error, debug: vi.fn() } }));
vi.mock('@/lib/supabase-storage', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/supabase-storage')>()),
    removeUnreferencedResumeUploads: h.sweep,
}));

import { DELETE } from '@/app/api/profile/resume/route';

const ME = 'aaaaaaaa-1111-2222-3333-444444444444';
const OTHER = 'bbbbbbbb-5555-6666-7777-888888888888';
const CURRENT = `local/${ME}/1700000000009-cv.pdf`;
const APPLIED_WITH = `local/${ME}/1700000000001-cv.pdf`;
const LETTER = `local/${ME}/1700000000002-letter.pdf`;
const signed = (path: string) => `https://test.supabase.co/storage/v1/object/sign/resumes/${path}?token=eyJabc`;

const request = () => new NextRequest('http://localhost:3000/api/profile/resume', { method: 'DELETE' });

beforeEach(() => {
    vi.clearAllMocks();
    h.getUser.mockResolvedValue({ data: { user: { id: ME } }, error: null });
    h.remove.mockResolvedValue({ data: [], error: null });
    h.profileFindUnique.mockResolvedValue({ resumeUrl: CURRENT });
    h.profileUpdate.mockResolvedValue({});
    h.applicationFindMany.mockResolvedValue([]);
    h.sweep.mockResolvedValue({ removed: 0, failed: [] });
});

describe('DELETE /api/profile/resume sweeps the earlier uploads', () => {
    it('keeps every file an application names, in either stored form, and sweeps the rest', async () => {
        h.applicationFindMany.mockResolvedValue([
            { resumeUrl: APPLIED_WITH, coverLetterUrl: signed(LETTER) },
            { resumeUrl: signed(APPLIED_WITH), coverLetterUrl: null },
            // A value naming another user's file keeps nothing of the caller's.
            { resumeUrl: `local/${OTHER}/1700000000003-cv.pdf`, coverLetterUrl: null },
        ]);

        const res = await DELETE(request());

        expect(res.status).toBe(200);
        expect(h.remove).toHaveBeenCalledWith([CURRENT]);
        expect(h.applicationFindMany).toHaveBeenCalledWith({
            where: { userId: ME },
            select: { resumeUrl: true, coverLetterUrl: true },
        });
        expect(h.sweep).toHaveBeenCalledTimes(1);
        const [uid, named] = h.sweep.mock.calls[0] as [string, Set<string>];
        expect(uid).toBe(ME);
        expect([...named].sort()).toEqual([APPLIED_WITH, LETTER].sort());
    });

    // Review of 2.26 (M2): applications store the profile resume's own key, so
    // the current file is often one an application names. The delete removes
    // it anyway, as it always did; whether it should stay is DECISION D35.
    it('still removes the current resume when an application names it, as before', async () => {
        h.applicationFindMany.mockResolvedValue([{ resumeUrl: CURRENT, coverLetterUrl: null }]);

        const res = await DELETE(request());

        expect(res.status).toBe(200);
        expect(h.remove).toHaveBeenCalledWith([CURRENT]);
        const [, named] = h.sweep.mock.calls[0] as [string, Set<string>];
        expect([...named]).toEqual([CURRENT]);
    });

    it('sweeps after the reference is cleared', async () => {
        await DELETE(request());

        expect(h.profileUpdate.mock.invocationCallOrder[0]).toBeLessThan(h.sweep.mock.invocationCallOrder[0]);
    });

    it('still answers 200 when the sweep fails', async () => {
        h.sweep.mockRejectedValue(new Error('storage down'));

        const res = await DELETE(request());

        expect(res.status).toBe(200);
        expect(h.profileUpdate).toHaveBeenCalledWith({ where: { supabaseId: ME }, data: { resumeUrl: null } });
        expect(h.error).toHaveBeenCalled();
    });

    it('still answers 200 when the applications cannot be read, and sweeps nothing', async () => {
        h.applicationFindMany.mockRejectedValue(new Error('db down'));

        const res = await DELETE(request());

        expect(res.status).toBe(200);
        expect(h.sweep).not.toHaveBeenCalled();
    });

    it('sweeps nothing when there is no resume, as the 404 says', async () => {
        h.profileFindUnique.mockResolvedValue({ resumeUrl: null });

        const res = await DELETE(request());

        expect(res.status).toBe(404);
        expect(h.sweep).not.toHaveBeenCalled();
    });
});
