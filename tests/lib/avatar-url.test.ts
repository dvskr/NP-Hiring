/**
 * Profile photos leave the server only as short-lived signed URLs
 * (lib/avatar-url.ts, owner 2026-11-25).
 *
 * A photo was served at its permanent public URL, so anyone who saw it once
 * kept it for good. The helper turns the stored value, the public URL that
 * /api/upload writes or a bare key, into a link that expires; passes any
 * other URL (a Google sign-in picture) through untouched; signs only inside
 * the owner's own upload folder; and answers null on any failure, so the UI
 * draws initials. The batch form makes one createSignedUrls call per list.
 *
 * The storage client is a fake; nothing here reaches Supabase. Every fixture
 * is fictional.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
    createAdminClient: vi.fn(),
    from: vi.fn(),
    createSignedUrls: vi.fn(),
    logError: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: h.createAdminClient }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: h.logError, debug: vi.fn() } }));

import { AVATAR_URL_TTL_SECONDS, signAvatarUrl, signAvatarUrls, withSignedAvatar } from '@/lib/avatar-url';

const OWNER = 'aaaaaaaa-1111-2222-3333-444444444444';
const OTHER = 'bbbbbbbb-5555-6666-7777-888888888888';
const HOST = 'https://test.supabase.co/storage/v1/object';
const KEY = `prod/${OWNER}/1700000000000.png`;
const PUBLIC_URL = `${HOST}/public/avatars/${KEY}`;
const GOOGLE_PICTURE = 'https://lh3.googleusercontent.com/a/ACg8ocK-fic=s96-c';

/** What the fake store signs a key as. */
const signed = (key: string): string => `${HOST}/sign/avatars/${key}?token=fic-${key.length}`;

function storeSigns(): void {
    h.createSignedUrls.mockImplementation(async (paths: string[]) => ({
        data: paths.map((path) => ({ path, signedUrl: signed(path), error: null })),
        error: null,
    }));
}

beforeEach(() => {
    vi.clearAllMocks();
    storeSigns();
    h.from.mockImplementation(() => ({ createSignedUrls: h.createSignedUrls }));
    h.createAdminClient.mockImplementation(() => ({ storage: { from: h.from } }));
});

describe('signAvatarUrl: what an avatar becomes', () => {
    it('signs the stored public URL in the avatars bucket, for an hour', async () => {
        expect(await signAvatarUrl(PUBLIC_URL, OWNER)).toBe(signed(KEY));

        expect(h.from).toHaveBeenCalledWith('avatars');
        expect(h.createSignedUrls).toHaveBeenCalledWith([KEY], AVATAR_URL_TTL_SECONDS);
        expect(AVATAR_URL_TTL_SECONDS).toBe(3600);
    });

    it.each([
        ['a bare key', KEY],
        ['a key with the bucket in front', `avatars/${KEY}`],
        ['a signed URL from an earlier response, signed afresh', `${HOST}/sign/avatars/${KEY}?token=old`],
        ['the public URL of another project host', `https://elsewhere.supabase.co/storage/v1/object/public/avatars/${KEY}`],
    ])('signs %s', async (_label, stored) => {
        expect(await signAvatarUrl(stored, OWNER)).toBe(signed(KEY));
        expect(h.createSignedUrls).toHaveBeenCalledWith([KEY], AVATAR_URL_TTL_SECONDS);
    });

    it.each([
        ['a Google sign-in picture', GOOGLE_PICTURE],
        ['a public URL in another bucket', `${HOST}/public/company-logos/logo_x.webp`],
    ])('passes %s through untouched, with no storage call', async (_label, url) => {
        expect(await signAvatarUrl(url, OWNER)).toBe(url);
        expect(h.createAdminClient).not.toHaveBeenCalled();
    });

    it.each([
        ['null', null],
        ['undefined', undefined],
        ['an empty value', ''],
        ['blank space', '   '],
    ])('answers null for %s, with no storage call', async (_label, stored) => {
        expect(await signAvatarUrl(stored, OWNER)).toBeNull();
        expect(h.createAdminClient).not.toHaveBeenCalled();
    });

    it.each([
        ["another account's photo", `${HOST}/public/avatars/prod/${OTHER}/1700000000000.png`],
        ["another account's bare key", `prod/${OTHER}/1700000000000.png`],
        ['a key that climbs out of the folder', `prod/${OWNER}/../${OTHER}/1700000000000.png`],
        ['an encoded climb', `${HOST}/public/avatars/prod/${OWNER}/%2e%2e/x.png`],
        ['a key with characters outside the upload set', `prod/${OWNER}/1700000000000.my photo`],
        ['a path on this site', `/storage/v1/object/public/avatars/${KEY}`],
        ['a data URL', 'data:image/png;base64,iVBORw0KGgo='],
    ])('signs nothing for %s: null, so the UI draws initials', async (_label, stored) => {
        expect(await signAvatarUrl(stored, OWNER)).toBeNull();
        expect(h.createSignedUrls).not.toHaveBeenCalled();
    });

    it('answers null when the store refuses, the client cannot be made, or the call throws', async () => {
        h.createSignedUrls.mockResolvedValueOnce({ data: null, error: { message: 'Bucket not found' } });
        expect(await signAvatarUrl(PUBLIC_URL, OWNER)).toBeNull();

        h.createAdminClient.mockImplementationOnce(() => { throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'); });
        expect(await signAvatarUrl(PUBLIC_URL, OWNER)).toBeNull();

        h.createSignedUrls.mockRejectedValueOnce(new Error('fetch failed'));
        expect(await signAvatarUrl(PUBLIC_URL, OWNER)).toBeNull();

        expect(h.logError).toHaveBeenCalledTimes(3);
        // The log names how many, never whose photo.
        expect(JSON.stringify(h.logError.mock.calls)).not.toContain(OWNER);
    });
});

describe('signAvatarUrls: a page of avatars', () => {
    const second = `prod/${OTHER}/1700000000001.jpg`;

    it('signs a whole page in one call, in order, each key once', async () => {
        const urls = await signAvatarUrls([
            { stored: PUBLIC_URL, ownerId: OWNER },
            { stored: GOOGLE_PICTURE, ownerId: OTHER },
            { stored: null, ownerId: OTHER },
            { stored: second, ownerId: OTHER },
            { stored: KEY, ownerId: OWNER },
        ]);

        expect(urls).toEqual([signed(KEY), GOOGLE_PICTURE, null, signed(second), signed(KEY)]);
        expect(h.createSignedUrls).toHaveBeenCalledTimes(1);
        expect(h.createSignedUrls).toHaveBeenCalledWith([KEY, second], AVATAR_URL_TTL_SECONDS);
    });

    it('answers null for the one key the store could not sign, and signs the rest', async () => {
        h.createSignedUrls.mockImplementationOnce(async (paths: string[]) => ({
            data: paths.map((path) => (path === second
                ? { path, signedUrl: null, error: 'Object not found' }
                : { path, signedUrl: signed(path), error: null })),
            error: null,
        }));

        expect(await signAvatarUrls([{ stored: KEY, ownerId: OWNER }, { stored: second, ownerId: OTHER }]))
            .toEqual([signed(KEY), null]);
    });

    it('makes no call for a page with nothing to sign', async () => {
        expect(await signAvatarUrls([{ stored: null, ownerId: OWNER }, { stored: GOOGLE_PICTURE, ownerId: OWNER }]))
            .toEqual([null, GOOGLE_PICTURE]);
        expect(await signAvatarUrls([])).toEqual([]);
        expect(h.createAdminClient).not.toHaveBeenCalled();
    });
});

describe('withSignedAvatar: a whole profile row', () => {
    it('returns a copy whose avatarUrl is signed for the row owner, leaving the row as it was', async () => {
        const row = { id: 'profile-1', supabaseId: OWNER, firstName: 'Ada', avatarUrl: PUBLIC_URL };

        const out = await withSignedAvatar(row);

        expect(out).toEqual({ ...row, avatarUrl: signed(KEY) });
        expect(row.avatarUrl).toBe(PUBLIC_URL);
    });

    it('leaves a row without the field as it is', async () => {
        // supabaseId keeps the row assignable to the helper's input type; the
        // point is that avatarUrl is absent.
        const row = { id: 'profile-1', supabaseId: OWNER };
        expect(await withSignedAvatar(row)).toBe(row);
        expect(h.createAdminClient).not.toHaveBeenCalled();
    });
});
