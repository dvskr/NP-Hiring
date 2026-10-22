/**
 * Register 2.26: account erasure removes every file the account uploaded.
 *
 * The purge cron deleted only the objects the profile pointed at when it was
 * purged, so every earlier resume, every cover letter (stored beside the
 * resumes), every earlier avatar and every message attachment stayed in
 * storage after the account was erased. removeUserUploadFolders empties the
 * account's own folders: <prefix>/<uid>/ in the resume and avatar buckets and
 * <uid>/ in the message attachment bucket. Ownership accepts a key under any
 * one word prefix (local, dev or prod), so the folders under each go.
 *
 * The resume DELETE removed only the current resume, so every replaced
 * resume and every cover letter no application names stayed for good.
 * removeUnreferencedResumeUploads removes those: old uploads in the account's
 * resume folders that none of its applications names.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Entry = { name: string; id: string | null; created_at?: string };

const h = vi.hoisted(() => {
    const listings: Record<string, Array<{ name: string; id: string | null; created_at?: string }>[]> = {};
    const list = vi.fn();
    const remove = vi.fn();
    const from = vi.fn((bucket: string) => ({
        list: (folder: string, opts: unknown) => list(bucket, folder, opts),
        remove: (paths: string[]) => remove(bucket, paths),
    }));
    return { listings, list, remove, from };
});

vi.mock('@supabase/supabase-js', () => ({
    createClient: vi.fn(() => ({ storage: { from: h.from } })),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/virus-scan', () => ({ scanFileForViruses: vi.fn() }));

import { removeUserUploadFolders, removeUnreferencedResumeUploads } from '@/lib/supabase-storage';

const UID = 'aaaaaaaa-1111-2222-3333-444444444444';

/** Each call to list(bucket, folder) answers the next page queued for it, then nothing. */
function queue(bucket: string, folder: string, ...pages: Array<Array<Entry>>) {
    h.listings[`${bucket}|${folder}`] = pages;
}

beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(h.listings)) delete h.listings[key];
    h.list.mockImplementation(async (bucket: string, folder: string) => {
        const pages = h.listings[`${bucket}|${folder}`] ?? [];
        return { data: pages.shift() ?? [], error: null };
    });
    h.remove.mockResolvedValue({ data: [], error: null });
});

describe('removeUserUploadFolders', () => {
    it('empties the account folder in the resume, avatar and message attachment buckets', async () => {
        queue('resumes', `local/${UID}`, [
            { name: '1700000000000-cv.pdf', id: 'f1' },
            { name: '1700000000001-letter.pdf', id: 'f2' },
            { name: 'nested', id: null },
        ]);
        queue('avatars', `local/${UID}`, [{ name: '1700000000002.png', id: 'f3' }]);
        queue('message-attachments', UID, [{ name: '1700000000003_offer.pdf', id: 'f4' }]);

        const result = await removeUserUploadFolders(UID);

        expect(h.remove).toHaveBeenCalledWith('resumes', [`local/${UID}/1700000000000-cv.pdf`, `local/${UID}/1700000000001-letter.pdf`]);
        expect(h.remove).toHaveBeenCalledWith('avatars', [`local/${UID}/1700000000002.png`]);
        expect(h.remove).toHaveBeenCalledWith('message-attachments', [`${UID}/1700000000003_offer.pdf`]);
        expect(result).toEqual({ removed: 4, failed: [] });
    });

    it('keeps going through a full page until the folder is empty', async () => {
        const fullPage = Array.from({ length: 100 }, (_, i) => ({ name: `${1700000000000 + i}-cv.pdf`, id: `f${i}` }));
        queue('resumes', `local/${UID}`, fullPage, [{ name: '1700000009999-cv.pdf', id: 'last' }]);

        const result = await removeUserUploadFolders(UID);

        expect(h.remove).toHaveBeenCalledTimes(2);
        expect(result.removed).toBe(101);
    });

    it('reports a folder it could not empty and still empties the others', async () => {
        queue('avatars', `local/${UID}`, [{ name: '1700000000002.png', id: 'f3' }]);
        h.list.mockImplementationOnce(async () => ({ data: null, error: { message: 'storage down' } }));

        const result = await removeUserUploadFolders(UID);

        expect(result.failed).toEqual([`resumes/local/${UID}`]);
        expect(h.remove).toHaveBeenCalledWith('avatars', [`local/${UID}/1700000000002.png`]);
    });

    it('touches nothing for an id that is not a single folder name', async () => {
        for (const id of ['', '..', 'a/b', '../other', 'x\\y']) {
            const result = await removeUserUploadFolders(id);
            expect(result.removed, id).toBe(0);
        }
        expect(h.list).not.toHaveBeenCalled();
        expect(h.remove).not.toHaveBeenCalled();
    });

    // Security review of 2.26: the purge deletes the profile in the same run,
    // so a folder it could not finish is never revisited. It is reported.
    it('reports a folder it could not empty within its bound', async () => {
        const page = (round: number) => Array.from({ length: 100 }, (_, i) => ({ name: `${round}-${i}-cv.pdf`, id: `f${round}-${i}` }));
        queue('resumes', `local/${UID}`, ...Array.from({ length: 50 }, (_, round) => page(round)));

        const result = await removeUserUploadFolders(UID);

        expect(result.removed).toBe(5000);
        expect(result.failed).toEqual([`resumes/local/${UID}`]);
    });

    it('counts a bucket that was never created as empty, not as a failure', async () => {
        h.list.mockImplementation(async (bucket: string, folder: string) => {
            if (bucket === 'message-attachments') return { data: null, error: { message: 'Bucket not found' } };
            const pages = h.listings[`${bucket}|${folder}`] ?? [];
            return { data: pages.shift() ?? [], error: null };
        });

        const result = await removeUserUploadFolders(UID);

        expect(result).toEqual({ removed: 0, failed: [] });
    });

    it('also empties the folders under the other upload prefixes, which ownership accepts', async () => {
        queue('resumes', `prod/${UID}`, [{ name: '1600000000000-cv.pdf', id: 'p1' }]);
        queue('avatars', `dev/${UID}`, [{ name: '1600000000001.png', id: 'd1' }]);

        const result = await removeUserUploadFolders(UID);

        expect(h.remove).toHaveBeenCalledWith('resumes', [`prod/${UID}/1600000000000-cv.pdf`]);
        expect(h.remove).toHaveBeenCalledWith('avatars', [`dev/${UID}/1600000000001.png`]);
        expect(result).toEqual({ removed: 2, failed: [] });
    });
});

describe('removeUnreferencedResumeUploads', () => {
    const NOW = new Date('2026-10-22T12:00:00.000Z');
    const OLD = '2026-09-01T08:00:00.000Z';
    const TODAY = '2026-10-22T09:30:00.000Z';

    it('removes the old uploads no application names and keeps the rest', async () => {
        queue('resumes', `local/${UID}`, [
            { name: '1700000000000-cv.pdf', id: 'r1', created_at: OLD },
            { name: '1700000000001-cv.pdf', id: 'r2', created_at: OLD },
            { name: '1700000000002-letter.pdf', id: 'r3', created_at: OLD },
            { name: '1700000000003-letter.pdf', id: 'r4', created_at: TODAY },
            { name: '1700000000004-cv.pdf', id: 'r5' },
            { name: 'nested', id: null },
        ]);
        const named = new Set([`local/${UID}/1700000000001-cv.pdf`]);

        const result = await removeUnreferencedResumeUploads(UID, named, NOW);

        // r2 is named by an application; r4 is less than a day old (a cover
        // letter is stored before the application that names it); r5 has no
        // creation time, so its age is unknown.
        expect(h.remove).toHaveBeenCalledTimes(1);
        expect(h.remove).toHaveBeenCalledWith('resumes', [
            `local/${UID}/1700000000000-cv.pdf`,
            `local/${UID}/1700000000002-letter.pdf`,
        ]);
        expect(result).toEqual({ removed: 2, failed: [] });
    });

    it('reads every page of a folder it keeps files in', async () => {
        const fullPage = Array.from({ length: 100 }, (_, i) => ({ name: `${1700000000000 + i}-cv.pdf`, id: `f${i}`, created_at: OLD }));
        queue('resumes', `local/${UID}`, fullPage, [{ name: '1700000009999-cv.pdf', id: 'last', created_at: OLD }]);
        const named = new Set(fullPage.map((file) => `local/${UID}/${file.name}`));

        const result = await removeUnreferencedResumeUploads(UID, named, NOW);

        const offsets = h.list.mock.calls
            .filter(([bucket, folder]) => bucket === 'resumes' && folder === `local/${UID}`)
            .map(([, , opts]) => (opts as { offset?: number }).offset);
        expect(offsets).toEqual([0, 100]);
        expect(h.remove).toHaveBeenCalledWith('resumes', [`local/${UID}/1700000009999-cv.pdf`]);
        expect(result.removed).toBe(1);
    });

    it('sweeps the resume folders under every upload prefix, and never the avatars', async () => {
        queue('resumes', `dev/${UID}`, [{ name: '1600000000000-cv.pdf', id: 'd1', created_at: OLD }]);

        await removeUnreferencedResumeUploads(UID, new Set(), NOW);

        expect(h.remove).toHaveBeenCalledWith('resumes', [`dev/${UID}/1600000000000-cv.pdf`]);
        expect(h.from).not.toHaveBeenCalledWith('avatars');
        expect(h.from).not.toHaveBeenCalledWith('message-attachments');
    });

    it('reports a folder it could read only in part, after removing what it read', async () => {
        const page = (round: number) => Array.from({ length: 100 }, (_, i) => ({ name: `${round}-${i}-cv.pdf`, id: `f${round}-${i}`, created_at: OLD }));
        queue('resumes', `local/${UID}`, ...Array.from({ length: 50 }, (_, round) => page(round)));

        const result = await removeUnreferencedResumeUploads(UID, new Set(), NOW);

        expect(result.removed).toBe(5000);
        expect(result.failed).toEqual([`resumes/local/${UID}`]);
    });

    it('reports a folder it could not read and removes nothing from it', async () => {
        h.list.mockImplementationOnce(async () => ({ data: null, error: { message: 'storage down' } }));

        const result = await removeUnreferencedResumeUploads(UID, new Set(), NOW);

        expect(result.failed).toEqual([`resumes/local/${UID}`]);
        expect(h.remove).not.toHaveBeenCalled();
    });

    it('touches nothing for an id that is not a single folder name', async () => {
        for (const id of ['', '..', 'a/b']) {
            expect((await removeUnreferencedResumeUploads(id, new Set(), NOW)).removed, id).toBe(0);
        }
        expect(h.list).not.toHaveBeenCalled();
    });
});
