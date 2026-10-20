/**
 * The employer sinks of a stored resume reference (findings APP-2 and
 * EMP-RES-1).
 *
 * GET /api/employer/applicants signs JobApplication.resumeUrl and GET
 * /api/employer/candidates/[id] signs UserProfile.resumeUrl. The candidate
 * wrote both values (POST /api/applications/apply-direct, PATCH
 * /api/auth/profile), and rows stored before those writers were fixed may
 * still name another user's object. Neither route checks the value itself:
 * both rely on the signing chokepoint in lib/document-storage.ts, which
 * refuses a key outside the document owner's upload folder.
 *
 * These tests drive the real handlers through the real chokepoint. Only the
 * storage client, the session and the database are mocked: nothing here
 * reaches a network or a database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  createSignedUrl: vi.fn(),
  userProfile: { findUnique: vi.fn(), findFirst: vi.fn() },
  profileView: { findUnique: vi.fn(), upsert: vi.fn() },
  employerJob: { findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn() },
  jobApplication: { findMany: vi.fn() },
  auditCreate: vi.fn(),
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
    employerJob: h.employerJob,
    jobApplication: h.jobApplication,
    documentAccessLog: { create: h.auditCreate },
  },
}));
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: vi.fn(async () => null),
  RATE_LIMITS: { employer: { limit: 30, windowSeconds: 60 } },
}));
vi.mock('@/lib/tier-limits', () => ({
  getEmployerTier: vi.fn(async () => 'pro'),
  canUnlockCandidate: vi.fn(async () => ({ allowed: true, postingId: 'posting-1' })),
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { GET as applicants } from '@/app/api/employer/applicants/route';
import { GET as candidateDetail } from '@/app/api/employer/candidates/[id]/route';

const EMPLOYER = 'cccccccc-9999-aaaa-bbbb-cccccccccccc';
const CANDIDATE = 'aaaaaaaa-1111-2222-3333-444444444444';
const VICTIM = 'bbbbbbbb-5555-6666-7777-888888888888';
const OWN = `local/${CANDIDATE}/1700000000000-cv.pdf`;
const FOREIGN = `local/${VICTIM}/1700000000001-cv.pdf`;
const STORAGE = 'https://test.supabase.co/storage/v1/object';
const signedUrlFor = (path: string) => `${STORAGE}/sign/resumes/${path}?token=eyJabc`;

const POISONED = [
  ["another user's bare key", FOREIGN],
  ["a signed URL to another user's resume", signedUrlFor(FOREIGN)],
  ['an encoded dot-dot path out of the own folder', `local/${CANDIDATE}/%2e%2e/${VICTIM}/1700000000001-cv.pdf`],
] as const;

const OWN_FORMS = [
  ['the bare key', OWN],
  ['a legacy signed URL', signedUrlFor(OWN)],
] as const;

function get(path: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`);
}

/** One application row as the applicants query returns it. */
function applicationRow(resumeUrl: string | null, coverLetterUrl: string | null = null): Record<string, unknown> {
  return {
    id: 'application-1',
    status: 'applied',
    notes: null,
    coverLetter: null,
    coverLetterUrl,
    resumeUrl,
    appliedAt: new Date('2026-10-01T00:00:00Z'),
    statusUpdatedAt: null,
    aiMatchScore: null,
    aiMatchReasons: [],
    aiMissingItems: [],
    screeningAnswers: null,
    user: {
      supabaseId: CANDIDATE,
      firstName: 'Sam',
      lastName: 'Rivera',
      email: 'sam@example.com',
      avatarUrl: null,
      headline: null,
      yearsExperience: null,
      certifications: null,
      licenseStates: null,
      specialties: null,
      bio: null,
      skills: [],
      education: [],
      workExperience: [],
      certificationRecords: [],
      licenses: [],
    },
    job: { id: 'job-1', title: 'Family Nurse Practitioner', isFeatured: false },
  };
}

/** The candidate row the detail route reads after its privacy gates. */
function candidateRow(resumeUrl: string | null): Record<string, unknown> {
  return {
    supabaseId: CANDIDATE,
    firstName: 'Sam',
    lastName: 'Rivera',
    email: 'sam@example.com',
    avatarUrl: null,
    headline: null,
    bio: null,
    yearsExperience: null,
    specialties: null,
    certifications: null,
    licenseStates: null,
    preferredWorkMode: null,
    preferredJobType: null,
    desiredSalaryMin: null,
    desiredSalaryMax: null,
    availableDate: null,
    linkedinUrl: null,
    resumeUrl,
    createdAt: new Date('2026-09-01T00:00:00Z'),
  };
}

beforeEach(() => {
  h.getUser.mockResolvedValue({ data: { user: { id: EMPLOYER, email: 'hiring@clinic.example' } }, error: null });
  h.userProfile.findUnique.mockResolvedValue({ role: 'employer' });
  h.from.mockImplementation(() => ({ createSignedUrl: h.createSignedUrl }));
  h.createSignedUrl.mockImplementation(async (path: string) => ({
    data: { signedUrl: signedUrlFor(path) },
    error: null,
  }));
  h.auditCreate.mockResolvedValue({});
  h.employerJob.findMany.mockResolvedValue([{ jobId: 'job-1', job: { id: 'job-1', title: 'Family Nurse Practitioner' } }]);
  h.profileView.findUnique.mockResolvedValue({ id: 'view-1' });
  h.profileView.upsert.mockResolvedValue({});
});

describe('GET /api/employer/applicants (APP-2)', () => {
  it.each(POISONED)('no signed link and no signing call when the application holds %s', async (_label, stored) => {
    h.jobApplication.findMany.mockResolvedValue([applicationRow(stored)]);

    const res = await applicants(get('/api/employer/applicants'));

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text).applicants[0].resumeUrl).toBeNull();
    expect(text).not.toContain(VICTIM);
    expect(h.createSignedUrl).not.toHaveBeenCalled();
    expect(h.auditCreate).not.toHaveBeenCalled();
  });

  it.each(OWN_FORMS)("signs the applicant's own key stored as %s, audit-logged with the applicant as owner", async (_label, stored) => {
    h.jobApplication.findMany.mockResolvedValue([applicationRow(stored)]);

    const res = await applicants(get('/api/employer/applicants'));

    expect((await res.json()).applicants[0].resumeUrl).toBe(signedUrlFor(OWN));
    expect(h.createSignedUrl.mock.calls[0][0]).toBe(OWN);
    await vi.waitFor(() => expect(h.auditCreate).toHaveBeenCalledTimes(1));
    expect(h.auditCreate.mock.calls[0][0].data).toMatchObject({
      actorId: EMPLOYER,
      ownerId: CANDIDATE,
      audience: 'employer',
    });
  });

  // apply-direct stores the cover letter as the applicant's bare key, the
  // same way it stores the resume, so the list must sign it before the
  // employer's browser can open it; ApplicantsTab uses it as a raw href.
  it("signs the applicant's own cover letter key the same way", async () => {
    const OWN_LETTER = `local/${CANDIDATE}/1700000000002-letter.pdf`;
    h.jobApplication.findMany.mockResolvedValue([applicationRow(null, OWN_LETTER)]);

    const res = await applicants(get('/api/employer/applicants'));

    expect((await res.json()).applicants[0].coverLetterUrl).toBe(signedUrlFor(OWN_LETTER));
    expect(h.createSignedUrl.mock.calls[0][0]).toBe(OWN_LETTER);
  });

  it.each([
    ...POISONED,
    ['an external link', 'https://files.example.com/letter.pdf'],
  ] as const)('gives no cover letter link when the application holds %s', async (_label, stored) => {
    h.jobApplication.findMany.mockResolvedValue([applicationRow(null, stored)]);

    const res = await applicants(get('/api/employer/applicants'));

    const text = await res.text();
    expect(JSON.parse(text).applicants[0].coverLetterUrl).toBeNull();
    expect(text).not.toContain(VICTIM);
    expect(h.createSignedUrl).not.toHaveBeenCalled();
  });
});

describe('GET /api/employer/candidates/[id] (EMP-RES-1)', () => {
  function detailRequest(): Promise<Response> {
    return candidateDetail(get(`/api/employer/candidates/${CANDIDATE}`), {
      params: Promise.resolve({ id: CANDIDATE }),
    });
  }

  it.each(POISONED)('no signed link and no signing call when the candidate column holds %s', async (_label, stored) => {
    h.userProfile.findFirst.mockResolvedValue(candidateRow(stored));

    const res = await detailRequest();

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text).resumeUrl).toBeNull();
    expect(text).not.toContain(VICTIM);
    expect(h.createSignedUrl).not.toHaveBeenCalled();
    expect(h.auditCreate).not.toHaveBeenCalled();
  });

  it.each(OWN_FORMS)("signs the candidate's own key stored as %s for an employer who unlocked them", async (_label, stored) => {
    h.userProfile.findFirst.mockResolvedValue(candidateRow(stored));

    const res = await detailRequest();

    expect((await res.json()).resumeUrl).toBe(signedUrlFor(OWN));
    expect(h.createSignedUrl.mock.calls[0][0]).toBe(OWN);
  });
});
