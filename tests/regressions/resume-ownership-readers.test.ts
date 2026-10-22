/**
 * Readers of the stored resume reference (findings RES-1, RES-2, RES-3,
 * EMP-RES-1).
 *
 * The stored value was writable by its owner (PATCH /api/auth/profile, see
 * resume-ownership-writers.test.ts), and rows written before that fix may
 * already name another user's object. Every reader therefore checks that the
 * key sits in the owner's own upload folder before it signs, downloads or
 * deletes anything:
 *
 *   - GET /api/documents/resume/me/url answers 404 instead of a signed link
 *   - GET /api/profile/export returns meta.resumeUrl null
 *   - DELETE /api/profile/resume clears the reference but removes no object
 *   - GET /api/employer/candidates/[id]/resume answers 404
 *
 * The storage client and the database are mocked: nothing here reaches a
 * network or a database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  createSignedUrl: vi.fn(),
  remove: vi.fn(),
  list: vi.fn(),
  userProfile: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  jobApplication: { findMany: vi.fn() },
  profileView: { findUnique: vi.fn() },
  auditCreate: vi.fn(),
  verifyExtensionToken: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ storage: { from: h.from } })),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: h.getUser } })),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    userProfile: h.userProfile,
    profileView: h.profileView,
    jobApplication: h.jobApplication,
    documentAccessLog: { create: h.auditCreate },
  },
}));
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: vi.fn(async () => null),
  RATE_LIMITS: { profile: { limit: 20, windowSeconds: 60 }, employer: { limit: 30, windowSeconds: 60 } },
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: h.warn, error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/verify-extension-token', () => ({ verifyExtensionToken: h.verifyExtensionToken }));
vi.mock('@/lib/audit-log', () => ({ logAudit: vi.fn(async () => undefined) }));

import { GET as resumeMeUrl } from '@/app/api/documents/resume/me/url/route';
import { GET as profileExport } from '@/app/api/profile/export/route';
import { DELETE as deleteResume } from '@/app/api/profile/resume/route';
import { GET as employerResume } from '@/app/api/employer/candidates/[id]/resume/route';

const ME = 'aaaaaaaa-1111-2222-3333-444444444444';
const VICTIM = 'bbbbbbbb-5555-6666-7777-888888888888';
const OWN = `local/${ME}/1700000000000-cv.pdf`;
const FOREIGN = `local/${VICTIM}/1700000000001-cv.pdf`;
const STORAGE = 'https://test.supabase.co/storage/v1/object';
const signedUrlFor = (path: string) => `${STORAGE}/sign/resumes/${path}?token=eyJabc`;

const POISONED: Array<[string, string]> = [
  ["another user's bare key", FOREIGN],
  ["a signed URL to another user's resume", signedUrlFor(FOREIGN)],
  ['an encoded dot-dot path out of the own folder', `local/${ME}/%2e%2e/${VICTIM}/1700000000001-cv.pdf`],
];

function get(path: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, { headers });
}

/** A full export row: every relation the export maps over is present and empty. */
function exportProfile(resumeUrl: string | null): Record<string, unknown> {
  return {
    id: 'profile-1',
    supabaseId: ME,
    resumeUrl,
    avatarUrl: null,
    specialties: null,
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    licenses: [],
    certificationRecords: [],
    education: [],
    workExperience: [],
    screeningAnswers: [],
    openEndedResponses: [],
    candidateReferences: [],
  };
}

beforeEach(() => {
  h.getUser.mockResolvedValue({ data: { user: { id: ME } }, error: null });
  // The delete's sweep of earlier uploads (tests/api/profile-resume-delete-sweep.test.ts)
  // finds an empty folder here, so every remove below is the delete's own.
  h.from.mockImplementation(() => ({ createSignedUrl: h.createSignedUrl, remove: h.remove, list: h.list }));
  h.list.mockResolvedValue({ data: [], error: null });
  h.jobApplication.findMany.mockResolvedValue([]);
  h.createSignedUrl.mockImplementation(async (path: string) => ({
    data: { signedUrl: signedUrlFor(path) },
    error: null,
  }));
  h.remove.mockResolvedValue({ data: [], error: null });
  h.userProfile.update.mockResolvedValue({});
  h.auditCreate.mockResolvedValue({});
  h.verifyExtensionToken.mockResolvedValue(null);
});

describe('GET /api/documents/resume/me/url (RES-1)', () => {
  it.each(POISONED)('404 with no signing call when the column holds %s', async (_label, stored) => {
    h.userProfile.findUnique.mockResolvedValue({ resumeUrl: stored });

    const res = await resumeMeUrl(get('/api/documents/resume/me/url'));

    expect(res.status).toBe(404);
    expect(h.createSignedUrl).not.toHaveBeenCalled();
    expect(h.auditCreate).not.toHaveBeenCalled();
  });

  it('signs the caller own key, audit-logged as an owner view', async () => {
    h.userProfile.findUnique.mockResolvedValue({ resumeUrl: OWN });

    const res = await resumeMeUrl(get('/api/documents/resume/me/url'));

    expect(res.status).toBe(200);
    expect((await res.json()).url).toBe(signedUrlFor(OWN));
    expect(h.createSignedUrl.mock.calls[0][0]).toBe(OWN);
    await vi.waitFor(() => expect(h.auditCreate).toHaveBeenCalledTimes(1));
    expect(h.auditCreate.mock.calls[0][0].data).toMatchObject({ actorId: ME, ownerId: ME, audience: 'owner' });
  });
});

describe('GET /api/profile/export (RES-3)', () => {
  it.each(POISONED)('meta.resumeUrl is null with no signing call when the column holds %s', async (_label, stored) => {
    h.userProfile.findUnique.mockResolvedValue(exportProfile(stored));

    const res = await profileExport(get('/api/profile/export'));

    expect(res.status).toBe(200);
    expect((await res.json()).meta.resumeUrl).toBeNull();
    expect(h.createSignedUrl).not.toHaveBeenCalled();
  });

  it('mints a fresh link for an own key stored as a legacy signed URL', async () => {
    h.userProfile.findUnique.mockResolvedValue(exportProfile(signedUrlFor(OWN)));

    const res = await profileExport(get('/api/profile/export'));

    expect((await res.json()).meta.resumeUrl).toBe(signedUrlFor(OWN));
    expect(h.createSignedUrl.mock.calls[0][0]).toBe(OWN);
  });

  it("the extension token branch checks against the profile's own supabaseId", async () => {
    h.verifyExtensionToken.mockResolvedValue({ userId: 'profile-1' });

    h.userProfile.findUnique.mockResolvedValue(exportProfile(FOREIGN));
    const poisoned = await profileExport(get('/api/profile/export', { authorization: 'Bearer ext' }));
    expect((await poisoned.json()).meta.resumeUrl).toBeNull();
    expect(h.userProfile.findUnique.mock.calls[0][0].where).toEqual({ id: 'profile-1' });

    h.userProfile.findUnique.mockResolvedValue(exportProfile(OWN));
    const own = await profileExport(get('/api/profile/export', { authorization: 'Bearer ext' }));
    expect((await own.json()).meta.resumeUrl).toBe(signedUrlFor(OWN));
    expect(h.createSignedUrl).toHaveBeenCalledTimes(1);
  });
});

describe('DELETE /api/profile/resume (RES-2)', () => {
  function deleteRequest(): NextRequest {
    return new NextRequest('http://localhost:3000/api/profile/resume', { method: 'DELETE' });
  }

  it.each([
    ...POISONED,
    ['a leading-slash bucket path the old fallback pattern matched', `/resumes/${FOREIGN}`],
    ['a link on another host naming a resumes path', `https://evil.example/resumes/${FOREIGN}`],
  ])('removes no object but still clears the reference when the column holds %s', async (_label, stored) => {
    h.userProfile.findUnique.mockResolvedValue({ resumeUrl: stored });

    const res = await deleteResume(deleteRequest());

    expect(res.status).toBe(200);
    expect(h.remove).not.toHaveBeenCalled();
    expect(h.userProfile.update).toHaveBeenCalledWith({ where: { supabaseId: ME }, data: { resumeUrl: null } });
    expect(h.warn).toHaveBeenCalled();
  });

  it.each([
    ['the bare key /api/upload stores', OWN, OWN],
    ['a legacy signed URL', signedUrlFor(OWN), OWN],
    ['a key under another upload prefix', `dev/${ME}/1700000000000-cv.pdf`, `dev/${ME}/1700000000000-cv.pdf`],
  ])('removes the caller own object stored as %s', async (_label, stored, expected) => {
    h.userProfile.findUnique.mockResolvedValue({ resumeUrl: stored });

    const res = await deleteResume(deleteRequest());

    expect(res.status).toBe(200);
    expect(h.from).toHaveBeenCalledWith('resumes');
    expect(h.remove).toHaveBeenCalledTimes(1);
    expect(h.remove).toHaveBeenCalledWith([expected]);
    expect(h.userProfile.update).toHaveBeenCalledWith({ where: { supabaseId: ME }, data: { resumeUrl: null } });
  });

  it('still clears the reference when storage refuses the delete', async () => {
    h.userProfile.findUnique.mockResolvedValue({ resumeUrl: OWN });
    h.remove.mockResolvedValue({ data: null, error: { message: 'storage down' } });

    const res = await deleteResume(deleteRequest());

    expect(res.status).toBe(200);
    expect(h.userProfile.update).toHaveBeenCalledWith({ where: { supabaseId: ME }, data: { resumeUrl: null } });
  });

  it('404 when there is no resume, as before', async () => {
    h.userProfile.findUnique.mockResolvedValue({ resumeUrl: null });

    const res = await deleteResume(deleteRequest());

    expect(res.status).toBe(404);
    expect(h.remove).not.toHaveBeenCalled();
  });
});

describe('GET /api/employer/candidates/[id]/resume (EMP-RES-1)', () => {
  const EMPLOYER = 'cccccccc-9999-aaaa-bbbb-cccccccccccc';
  const CANDIDATE = ME;

  function employerRequest(): Promise<Response> {
    return employerResume(get(`/api/employer/candidates/${CANDIDATE}/resume?json=1`), {
      params: Promise.resolve({ id: CANDIDATE }),
    });
  }

  beforeEach(() => {
    h.getUser.mockResolvedValue({ data: { user: { id: EMPLOYER } }, error: null });
    h.userProfile.findUnique.mockResolvedValue({ role: 'employer' });
    h.profileView.findUnique.mockResolvedValue({ id: 'view-1' });
  });

  it.each(POISONED)('404 with no signing call when the candidate column holds %s', async (_label, stored) => {
    h.userProfile.findFirst.mockResolvedValue({ resumeUrl: stored });

    const res = await employerRequest();

    expect(res.status).toBe(404);
    expect(h.createSignedUrl).not.toHaveBeenCalled();
    expect(await res.text()).not.toContain(VICTIM);
  });

  it("signs the candidate's own key for an employer who unlocked them", async () => {
    h.userProfile.findFirst.mockResolvedValue({ resumeUrl: OWN });

    const res = await employerRequest();

    expect(res.status).toBe(200);
    expect((await res.json()).url).toBe(signedUrlFor(OWN));
    expect(h.createSignedUrl.mock.calls[0]).toEqual([OWN, 60]);
  });
});
