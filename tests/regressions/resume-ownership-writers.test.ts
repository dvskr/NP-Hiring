/**
 * Writers of the resume and avatar columns (findings AUTH-PROFILE-1, APP-2).
 *
 * PATCH /api/auth/profile stored any http(s) or leading-slash value as the
 * caller's own resumeUrl / avatarUrl, and POST /api/applications/apply-direct
 * stored any URL whose host ended in "supabase.co" as the application's
 * resumeUrl / coverLetterUrl. Every reader then treated the stored value as
 * the caller's own storage object: a signed link to it (self view, export,
 * the employer's applicant list), a download for parsing, or a deletion.
 *
 * Now a caller can only store a key in their OWN upload folder (or clear the
 * column). /api/upload still writes both profile columns after a real upload,
 * so the settings page and the apply form keep working.
 *
 * Every database and network dependency is mocked; nothing here can reach the
 * production database the main checkout's .env points at.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  getUser: vi.fn(),
  userProfile: { update: vi.fn(), findUnique: vi.fn() },
  job: { findUnique: vi.fn() },
  jobScreeningQuestion: { findMany: vi.fn() },
  txJobApplication: { findUnique: vi.fn(), upsert: vi.fn() },
  $executeRaw: vi.fn(),
  $transaction: vi.fn(),
  after: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    userProfile: h.userProfile,
    job: h.job,
    jobScreeningQuestion: h.jobScreeningQuestion,
    $transaction: h.$transaction,
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: h.getUser } })),
}));
vi.mock('@/lib/csrf', () => ({ verifyCsrf: vi.fn(() => null) }));
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: vi.fn(async () => null),
  RATE_LIMITS: { auth: { limit: 10, windowSeconds: 60 }, applyDirect: { limit: 10, windowSeconds: 60 } },
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: h.warn, error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/beehiiv', () => ({ syncToBeehiiv: vi.fn() }));
vi.mock('@/lib/inngest/client', () => ({ inngest: { send: vi.fn(async () => undefined) } }));
vi.mock('@/lib/auth/ensure-profile', () => ({ ensureProfileFromAuth: vi.fn() }));
vi.mock('@/lib/email-service', () => ({
  sendSignupWelcomeEmail: vi.fn(),
  sendNewApplicationEmail: vi.fn(async () => ({ success: true })),
  sendApplicationConfirmationEmail: vi.fn(async () => ({ success: true })),
}));
vi.mock('@/lib/candidate-scorer', () => ({ scoreCandidate: vi.fn(async () => undefined) }));
// `after` throws outside a real request scope; the rest of next/server stays real.
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: h.after,
}));

import { PATCH as patchProfile } from '@/app/api/auth/profile/route';
import { POST as applyDirect } from '@/app/api/applications/apply-direct/route';

const ME = 'aaaaaaaa-1111-2222-3333-444444444444';
const VICTIM = 'bbbbbbbb-5555-6666-7777-888888888888';
const OWN = `local/${ME}/1700000000000-cv.pdf`;
const FOREIGN = `local/${VICTIM}/1700000000001-cv.pdf`;
const STORAGE = 'https://test.supabase.co/storage/v1/object';
const OWN_AVATAR = `local/${ME}/1700000000000.png`;
const OWN_AVATAR_URL = `${STORAGE}/public/avatars/${OWN_AVATAR}`;

function patchRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/auth/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function applyRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/applications/apply-direct', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId: 'job-1', consent: true, ...body }),
  });
}

/** The `data` the PATCH handed to prisma.userProfile.update. */
function patchedData(): Record<string, unknown> {
  expect(h.userProfile.update).toHaveBeenCalledTimes(1);
  return h.userProfile.update.mock.calls[0][0].data as Record<string, unknown>;
}

/** The create branch the apply route handed to the application upsert. */
function storedApplication(): Record<string, unknown> {
  expect(h.txJobApplication.upsert).toHaveBeenCalledTimes(1);
  return h.txJobApplication.upsert.mock.calls[0][0].create as Record<string, unknown>;
}

beforeEach(() => {
  h.getUser.mockResolvedValue({ data: { user: { id: ME } }, error: null });
  h.userProfile.update.mockResolvedValue({ id: 'profile-1' });
  h.job.findUnique.mockResolvedValue({
    id: 'job-1',
    title: 'Family Nurse Practitioner',
    employer: 'Northside Clinic',
    applyOnPlatform: true,
    isPublished: true,
    expiresAt: null,
    employerJobs: null,
  });
  h.userProfile.findUnique.mockResolvedValue({
    id: 'profile-1',
    firstName: 'Sam',
    lastName: 'Rivera',
    email: null,
    resumeUrl: null,
    headline: null,
    yearsExperience: null,
  });
  h.jobScreeningQuestion.findMany.mockResolvedValue([]);
  h.$executeRaw.mockResolvedValue(1);
  h.txJobApplication.findUnique.mockResolvedValue(null);
  h.txJobApplication.upsert.mockResolvedValue({ id: 'application-1' });
  h.$transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) =>
    fn({ $executeRaw: h.$executeRaw, jobApplication: h.txJobApplication }),
  );
});

describe('PATCH /api/auth/profile: resumeUrl', () => {
  it.each([
    ["another user's bare key", FOREIGN],
    ["a signed URL to another user's resume", `${STORAGE}/sign/resumes/${FOREIGN}?token=eyJabc`],
    ['a dot-dot path out of the own folder', `local/${ME}/../${VICTIM}/1700000000001-cv.pdf`],
    ['an encoded dot-dot path', `local/${ME}/%2e%2e/${VICTIM}/1700000000001-cv.pdf`],
    ['a backslash path', `local/${ME}/..\\${VICTIM}\\1700000000001-cv.pdf`],
    ['a leading-slash path', `/${FOREIGN}`],
    ['an external link', 'https://example.com/resume.pdf'],
  ])('ignores %s: the column is left untouched and the other fields still save', async (_label, value) => {
    const res = await patchProfile(patchRequest({ resumeUrl: value, firstName: 'Sam' }));

    expect(res.status).toBe(200);
    const data = patchedData();
    expect(data).not.toHaveProperty('resumeUrl');
    expect(data.firstName).toBe('Sam');
  });

  it("stores the caller's own signed URL as the bare key", async () => {
    const res = await patchProfile(patchRequest({ resumeUrl: `${STORAGE}/sign/resumes/${OWN}?token=eyJabc` }));

    expect(res.status).toBe(200);
    expect(patchedData().resumeUrl).toBe(OWN);
  });

  it("keeps the caller's own bare key, which the settings page sends back on every save", async () => {
    await patchProfile(patchRequest({ resumeUrl: OWN }));

    expect(patchedData().resumeUrl).toBe(OWN);
  });

  it('null and an empty string still clear the column', async () => {
    await patchProfile(patchRequest({ resumeUrl: null }));
    expect(patchedData().resumeUrl).toBeNull();

    h.userProfile.update.mockClear();
    await patchProfile(patchRequest({ resumeUrl: '' }));
    expect(patchedData().resumeUrl).toBeNull();
  });

  it('a non-string value is ignored, not a 500', async () => {
    const res = await patchProfile(patchRequest({ resumeUrl: { path: FOREIGN } }));

    expect(res.status).toBe(200);
    expect(patchedData()).not.toHaveProperty('resumeUrl');
  });
});

describe('PATCH /api/auth/profile: avatarUrl', () => {
  it('stores the public URL of an avatar in the own folder', async () => {
    await patchProfile(patchRequest({ avatarUrl: OWN_AVATAR_URL }));

    expect(patchedData().avatarUrl).toBe(OWN_AVATAR_URL);
  });

  it('rebuilds the URL on this project, so another host cannot be planted', async () => {
    await patchProfile(patchRequest({
      avatarUrl: `https://attacker.supabase.co/storage/v1/object/public/avatars/${OWN_AVATAR}`,
    }));

    expect(patchedData().avatarUrl).toBe(OWN_AVATAR_URL);
  });

  it.each([
    ["another user's avatar", `${STORAGE}/public/avatars/local/${VICTIM}/1700000000000.png`],
    ['a Google sign-in picture echoed back by the settings page', 'https://lh3.googleusercontent.com/a/ACg8ocK=s96-c'],
    ['a same-origin path an employer browser would request with cookies', '/api/auth/signout'],
    ['an arbitrary external image', 'https://tracker.example/pixel.png'],
  ])('ignores %s: the stored avatar is left untouched', async (_label, value) => {
    const res = await patchProfile(patchRequest({ avatarUrl: value }));

    expect(res.status).toBe(200);
    expect(patchedData()).not.toHaveProperty('avatarUrl');
  });

  it('null still clears the avatar', async () => {
    await patchProfile(patchRequest({ avatarUrl: null }));

    expect(patchedData().avatarUrl).toBeNull();
  });
});

describe('POST /api/applications/apply-direct: resumeUrl and coverLetterUrl', () => {
  it.each([
    ["another user's bare key", FOREIGN],
    ["a replayed signed link to another user's resume", `${STORAGE}/sign/resumes/${FOREIGN}?token=eyJabc`],
    ['an encoded dot-dot path', `local/${ME}/%2e%2e/${VICTIM}/1700000000001-cv.pdf`],
    ['a look-alike host the old suffix test accepted', `https://evilsupabase.co/storage/v1/object/sign/resumes/${FOREIGN}`],
  ])('400 for a resumeUrl naming %s, nothing stored', async (_label, value) => {
    const res = await applyDirect(applyRequest({ resumeUrl: value }));

    expect(res.status).toBe(400);
    expect(h.txJobApplication.upsert).not.toHaveBeenCalled();
  });

  it("200 for the caller's own bare key (the profile resume the form posts), stored as the key", async () => {
    const res = await applyDirect(applyRequest({ resumeUrl: OWN }));

    expect(res.status).toBe(200);
    expect(storedApplication().resumeUrl).toBe(OWN);
  });

  it("200 for the caller's own signed link from an in-form upload, stored as the bare key", async () => {
    const res = await applyDirect(applyRequest({ resumeUrl: `${STORAGE}/sign/resumes/${OWN}?token=eyJabc` }));

    expect(res.status).toBe(200);
    expect(storedApplication().resumeUrl).toBe(OWN);
  });

  it("stores the caller's own cover letter key", async () => {
    const cover = `local/${ME}/1700000000002-cover.pdf`;
    const res = await applyDirect(applyRequest({ coverLetterUrl: cover }));

    expect(res.status).toBe(200);
    expect(storedApplication().coverLetterUrl).toBe(cover);
  });

  it("400 for a coverLetterUrl naming another user's object", async () => {
    const res = await applyDirect(applyRequest({ coverLetterUrl: `${STORAGE}/sign/resumes/${FOREIGN}?token=t` }));

    expect(res.status).toBe(400);
    expect(h.txJobApplication.upsert).not.toHaveBeenCalled();
  });

  it("falls back to the profile resume only when it is in the caller's own folder", async () => {
    h.userProfile.findUnique.mockResolvedValue({
      id: 'profile-1', firstName: 'Sam', lastName: 'Rivera', email: null,
      resumeUrl: `${STORAGE}/sign/resumes/${FOREIGN}?token=t`, headline: null, yearsExperience: null,
    });
    const res = await applyDirect(applyRequest({}));

    expect(res.status).toBe(200);
    expect(storedApplication().resumeUrl).toBeNull();
  });

  it('normalizes an own profile resume stored as a legacy signed URL', async () => {
    h.userProfile.findUnique.mockResolvedValue({
      id: 'profile-1', firstName: 'Sam', lastName: 'Rivera', email: null,
      resumeUrl: `${STORAGE}/sign/resumes/${OWN}?token=t`, headline: null, yearsExperience: null,
    });
    await applyDirect(applyRequest({}));

    expect(storedApplication().resumeUrl).toBe(OWN);
  });
});
