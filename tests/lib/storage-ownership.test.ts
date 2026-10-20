/**
 * Resume and avatar ownership (findings AUTH-PROFILE-1, RES-1 to RES-4,
 * APP-2, EMP-RES-1).
 *
 * Every upload is keyed `<prefix>/<supabase uid>/<file>` (uploadResume and
 * uploadAvatar in lib/supabase-storage.ts), but the columns that point at
 * those keys (UserProfile.resumeUrl / avatarUrl, JobApplication.resumeUrl /
 * coverLetterUrl) were writable by the user. A stored value therefore proved
 * nothing about whose object it named, and every reader signed, downloaded
 * or deleted it with the service role.
 *
 * These tests pin the one ownership rule (isOwnStoragePath), the two
 * normalizing helpers built on it, and its enforcement at the signing and
 * download chokepoint in lib/document-storage.ts. The storage client and
 * the database are mocked: nothing here reaches a network or a database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  createSignedUrl: vi.fn(),
  download: vi.fn(),
  from: vi.fn(),
  auditCreate: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ storage: { from: h.from } })),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: { documentAccessLog: { create: h.auditCreate } },
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: h.warn, error: vi.fn(), debug: vi.fn() },
}));

import { isOwnStoragePath, toOwnAvatarPath } from '@/lib/supabase-storage';
import { toOwnResumePath } from '@/lib/resume-storage';
import { mintDocReadUrl, downloadDocBytes, type DocReadContext } from '@/lib/document-storage';

const OWNER = 'aaaaaaaa-1111-2222-3333-444444444444';
const OTHER = 'bbbbbbbb-5555-6666-7777-888888888888';
const OWN = `local/${OWNER}/1700000000000-cv.pdf`;
const FOREIGN = `local/${OTHER}/1700000000001-cv.pdf`;
const HOST = 'https://test.supabase.co/storage/v1/object';

function ctx(ownerId: string): DocReadContext {
  return { actorId: OWNER, ownerId, audience: 'owner', action: 'view' };
}

beforeEach(() => {
  h.from.mockImplementation(() => ({ createSignedUrl: h.createSignedUrl, download: h.download }));
  h.createSignedUrl.mockResolvedValue({
    data: { signedUrl: `${HOST}/sign/resumes/${OWN}?token=t` },
    error: null,
  });
  h.download.mockResolvedValue({ data: new Blob(['%PDF-1.4 test']), error: null });
  h.auditCreate.mockResolvedValue({});
});

describe('isOwnStoragePath: exactly <prefix>/<owner uid>/<file>, nothing else', () => {
  it.each([
    ['a resume key', OWN],
    ['a key under another upload prefix', `prod/${OWNER}/1700000000000-cv.pdf`],
    ['an avatar key', `dev/${OWNER}/1700000000000.png`],
    ['a file name holding two dots inside the segment', `local/${OWNER}/1700000000000-my..cv.pdf`],
  ])('accepts %s', (_label, path) => {
    expect(isOwnStoragePath(path, OWNER)).toBe(true);
  });

  it.each([
    ["another user's folder", FOREIGN],
    ['a dot-dot segment back out of the own folder', `local/${OWNER}/../${OTHER}/1700000000001-cv.pdf`],
    ['an encoded dot-dot segment', `local/${OWNER}/%2e%2e/${OTHER}/1700000000001-cv.pdf`],
    ['a half-encoded dot-dot segment', `local/${OWNER}/.%2E/${OTHER}/1700000000001-cv.pdf`],
    ['an encoded slash', `local/${OWNER}/..%2F${OTHER}%2F1700000000001-cv.pdf`],
    ['backslash separators', `local/${OWNER}/..\\${OTHER}\\1700000000001-cv.pdf`],
    ['a tab inside a dot-dot segment', `local/${OWNER}/.\t./${OTHER}/1700000000001-cv.pdf`],
    ['a newline in the file name', `local/${OWNER}/1700000000000-cv.pdf\n`],
    ['a query string', `local/${OWNER}/1700000000000-cv.pdf?download=1`],
    ['a fragment', `local/${OWNER}/1700000000000-cv.pdf#x`],
    ['a space', `local/${OWNER}/1700000000000-my cv.pdf`],
    ['a leading slash', `/local/${OWNER}/1700000000000-cv.pdf`],
    ['a trailing slash', `local/${OWNER}/`],
    ['an empty segment', `local//${OWNER}/1700000000000-cv.pdf`],
    ['a dot file segment', `local/${OWNER}/.`],
    ['a dot-dot file segment', `local/${OWNER}/..`],
    ['a hidden file segment', `local/${OWNER}/.cv.pdf`],
    ['the bucket still attached', `resumes/${OWN}`],
    ['no upload prefix', `${OWNER}/1700000000000-cv.pdf`],
    ['an extra folder level', `local/${OWNER}/nested/1700000000000-cv.pdf`],
    ['the owner id as a prefix of the folder name', `local/${OWNER}x/1700000000000-cv.pdf`],
    ['the owner id inside the file name', `local/${OTHER}/${OWNER}.pdf`],
    ['the owner id in the prefix position', `${OWNER}/${OTHER}/1700000000001-cv.pdf`],
  ])('rejects %s', (_label, path) => {
    expect(isOwnStoragePath(path, OWNER)).toBe(false);
  });

  it('rejects a missing or empty owner id and non-string paths', () => {
    expect(isOwnStoragePath(OWN, '')).toBe(false);
    expect(isOwnStoragePath(OWN, null)).toBe(false);
    expect(isOwnStoragePath(OWN, undefined)).toBe(false);
    expect(isOwnStoragePath(null, OWNER)).toBe(false);
    expect(isOwnStoragePath(undefined, OWNER)).toBe(false);
    expect(isOwnStoragePath('', OWNER)).toBe(false);
  });
});

// STORAGE_UPLOAD_PREFIX is documented as one word (local, dev or prod), but
// a deployment that set a two part value would write keys with an extra
// segment, and a three segment rule would then lock every owner out of
// every file. Exactly the configured prefix is accepted as well.
describe('isOwnStoragePath under a multi-part STORAGE_UPLOAD_PREFIX', () => {
  async function withPrefix(prefix: string) {
    vi.resetModules();
    vi.stubEnv('STORAGE_UPLOAD_PREFIX', prefix);
    try {
      return (await import('@/lib/supabase-storage')).isOwnStoragePath;
    } finally {
      vi.unstubAllEnvs();
    }
  }

  it('accepts a key under exactly the configured prefix', async () => {
    const check = await withPrefix('nphiring/prod');
    expect(check(`nphiring/prod/${OWNER}/1700000000000-cv.pdf`, OWNER)).toBe(true);
    expect(check(`local/${OWNER}/1700000000000-cv.pdf`, OWNER)).toBe(true);
  });

  it('still rejects any other multi-part prefix and every foreign folder', async () => {
    const check = await withPrefix('nphiring/prod');
    expect(check(`other/prod/${OWNER}/1700000000000-cv.pdf`, OWNER)).toBe(false);
    expect(check(`nphiring/prod/${OTHER}/1700000000001-cv.pdf`, OWNER)).toBe(false);
    expect(check(`nphiring/prod/${OWNER}/nested/1700000000000-cv.pdf`, OWNER)).toBe(false);
    expect(check(`nphiring/prod/${OWNER}/%2e%2e`, OWNER)).toBe(false);
  });

  it('accepts no extra level when the prefix is one word', async () => {
    const check = await withPrefix('prod');
    expect(check(`a/b/${OWNER}/1700000000000-cv.pdf`, OWNER)).toBe(false);
  });
});

describe('toOwnResumePath: one normalizer, then the ownership rule', () => {
  it.each([
    ['the bare key /api/upload stores', OWN],
    ["the legacy 'resumes/' bucket prefix", `resumes/${OWN}`],
    ['a signed URL the settings page used to store', `${HOST}/sign/resumes/${OWN}?token=eyJabc`],
    ['a public-style storage URL', `${HOST}/public/resumes/${OWN}`],
  ])('returns the bare own key for %s', (_label, stored) => {
    expect(toOwnResumePath(stored, OWNER)).toBe(OWN);
  });

  it.each([
    ["another user's bare key", FOREIGN],
    ["a signed URL naming another user's key", `${HOST}/sign/resumes/${FOREIGN}?token=eyJabc`],
    ['a fragment smuggling the own id after a foreign key', `${HOST}/sign/resumes/${FOREIGN}#/${OWNER}/x`],
    ['a query smuggling the own id after a foreign key', `/${FOREIGN}?x=/${OWNER}/y`],
    ['an encoded traversal inside a signed URL', `${HOST}/sign/resumes/local/${OWNER}/%2e%2e/${OTHER}/1-cv.pdf?token=t`],
    ['an external link', 'https://example.com/my-resume.pdf'],
    ['an empty string', ''],
  ])('returns null for %s', (_label, stored) => {
    expect(toOwnResumePath(stored, OWNER)).toBeNull();
  });

  it('returns null for non-string values instead of throwing', () => {
    expect(toOwnResumePath(null, OWNER)).toBeNull();
    expect(toOwnResumePath(undefined, OWNER)).toBeNull();
    expect(toOwnResumePath(42, OWNER)).toBeNull();
    expect(toOwnResumePath({ path: OWN }, OWNER)).toBeNull();
  });
});

describe('toOwnAvatarPath', () => {
  const OWN_AVATAR = `local/${OWNER}/1700000000000.png`;

  it('returns the key of a public avatar URL in the own folder', () => {
    expect(toOwnAvatarPath(`${HOST}/public/avatars/${OWN_AVATAR}`, OWNER)).toBe(OWN_AVATAR);
  });

  it("returns null for another user's avatar, an OAuth picture, a same-origin path and non-strings", () => {
    expect(toOwnAvatarPath(`${HOST}/public/avatars/local/${OTHER}/1700000000000.png`, OWNER)).toBeNull();
    expect(toOwnAvatarPath('https://lh3.googleusercontent.com/a/ACg8ocK=s96-c', OWNER)).toBeNull();
    expect(toOwnAvatarPath('/api/auth/signout', OWNER)).toBeNull();
    expect(toOwnAvatarPath(42, OWNER)).toBeNull();
  });
});

describe('the signing and download chokepoint enforces the owner folder for resumes', () => {
  it.each([
    ['bare', OWN],
    ["'resumes/'-prefixed", `resumes/${OWN}`],
    ['signed-URL', `${HOST}/sign/resumes/${OWN}?token=old`],
  ])('signs an own key given in %s form, and audit-logs it', async (_label, stored) => {
    const url = await mintDocReadUrl(stored, 'resume', ctx(OWNER));

    expect(url).toContain('/sign/resumes/');
    expect(h.from).toHaveBeenCalledWith('resumes');
    expect(h.createSignedUrl).toHaveBeenCalledTimes(1);
    expect(h.createSignedUrl.mock.calls[0][0]).toBe(OWN);
    await vi.waitFor(() => expect(h.auditCreate).toHaveBeenCalledTimes(1));
  });

  it.each([
    ["another user's key", FOREIGN],
    ["a signed URL naming another user's key", `${HOST}/sign/resumes/${FOREIGN}?token=t`],
    ['an encoded dot-dot path', `local/${OWNER}/%2e%2e/${OTHER}/1700000000001-cv.pdf`],
    ['a literal dot-dot path', `local/${OWNER}/../${OTHER}/1700000000001-cv.pdf`],
    ['a backslash path', `local/${OWNER}/..\\${OTHER}\\1700000000001-cv.pdf`],
    ['a fragment smuggling the owner id', `${HOST}/sign/resumes/${FOREIGN}#/${OWNER}/x`],
  ])('refuses %s: no signing call and no audit row', async (_label, stored) => {
    const url = await mintDocReadUrl(stored, 'resume', ctx(OWNER));

    expect(url).toBeNull();
    expect(h.createSignedUrl).not.toHaveBeenCalled();
    expect(h.auditCreate).not.toHaveBeenCalled();
    expect(h.warn).toHaveBeenCalled();
  });

  it('refuses when the caller passed no owner id', async () => {
    expect(await mintDocReadUrl(OWN, 'resume', ctx(''))).toBeNull();
    expect(h.createSignedUrl).not.toHaveBeenCalled();
  });

  it("downloadDocBytes refuses another user's key without a storage call", async () => {
    const bytes = await downloadDocBytes(FOREIGN, 'resume', ctx(OWNER));

    expect(bytes).toBeNull();
    expect(h.download).not.toHaveBeenCalled();
    expect(h.auditCreate).not.toHaveBeenCalled();
  });

  it('downloadDocBytes still downloads an own key', async () => {
    const bytes = await downloadDocBytes(`${HOST}/sign/resumes/${OWN}?token=old`, 'resume', ctx(OWNER));

    expect(bytes?.buffer.toString()).toBe('%PDF-1.4 test');
    expect(h.download).toHaveBeenCalledWith(OWN);
  });

  it('leaves message attachments, keyed <uid>/<file> and checked by their own write route, unchanged', async () => {
    const url = await mintDocReadUrl(`${OWNER}/1700000000000_note.pdf`, 'message_attachment', ctx(OWNER));

    expect(url).not.toBeNull();
    expect(h.from).toHaveBeenCalledWith('message-attachments');
    expect(h.createSignedUrl).toHaveBeenCalledTimes(1);
  });
});
