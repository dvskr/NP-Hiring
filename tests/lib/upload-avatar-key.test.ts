/**
 * The storage key of an uploaded profile photo (lib/supabase-storage.ts
 * uploadAvatar).
 *
 * The key took its extension from `fileName.split('.').pop()`, the client's
 * own file name, so a multipart name like `a.png/../../<other uid>/evil` put
 * an object outside the uploader's folder in the avatars bucket, and a name
 * with no dot ended the key in the whole name. Keys outside the owner's
 * folder are what lib/avatar-url.ts refuses to sign. The extension now comes
 * from the validated type, as on PMHNP Hiring.
 *
 * The storage client is a fake; nothing here reaches Supabase.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ upload: vi.fn(), getPublicUrl: vi.fn() }));

vi.mock('@supabase/supabase-js', () => ({
    createClient: () => ({
        storage: { from: () => ({ upload: h.upload, getPublicUrl: h.getPublicUrl }) },
    }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { isOwnStoragePath, uploadAvatar } from '@/lib/supabase-storage';

const UID = 'aaaaaaaa-1111-2222-3333-444444444444';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

beforeEach(() => {
    vi.clearAllMocks();
    h.upload.mockImplementation(async (path: string) => ({ data: { path }, error: null }));
    h.getPublicUrl.mockImplementation((path: string) => ({
        data: { publicUrl: `https://test.supabase.co/storage/v1/object/public/avatars/${path}` },
    }));
});

const keyFor = async (fileName: string, type = 'image/png'): Promise<string> => (await uploadAvatar(PNG, fileName, type, UID)).path;

describe('uploadAvatar: the key it writes', () => {
    it("keeps a traversal in the file name out of the key, inside the uploader's own folder", async () => {
        const key = await keyFor(`a.png/../../${'bbbbbbbb-5555-6666-7777-888888888888'}/evil`);

        expect(key).not.toContain('..');
        expect(key).toMatch(new RegExp(`/${UID}/\\d+\\.png$`));
        expect(isOwnStoragePath(key, UID)).toBe(true);
    });

    it('never ends the key in the file name when it has no dot', async () => {
        const key = await keyFor('my photo');

        expect(key.endsWith('.png')).toBe(true);
        expect(key).not.toContain('my photo');
    });

    it.each([
        ['image/jpeg', 'jpg'],
        ['image/jpg', 'jpg'],
        ['image/png', 'png'],
        ['image/webp', 'webp'],
    ])('takes the extension from the type %s, whatever the name says', async (type, extension) => {
        expect(await keyFor('portrait.gif', type)).toMatch(new RegExp(`\\.${extension}$`));
    });

    it('returns the public URL the avatarUrl column stores to name the object', async () => {
        const result = await uploadAvatar(PNG, 'me.png', 'image/png', UID);

        expect(result.url).toBe(`https://test.supabase.co/storage/v1/object/public/avatars/${result.path}`);
    });

    it('refuses a type it does not take before writing anything', async () => {
        await expect(uploadAvatar(PNG, 'me.gif', 'image/gif', UID)).rejects.toThrow(/Only JPEG, PNG, and WebP/);
        expect(h.upload).not.toHaveBeenCalled();
    });
});
