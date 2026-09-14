/**
 * P10 auth-account-security: resume upload and parse.
 *
 *  - POST /api/upload collapsed every failure into 500 "Failed to upload
 *    file". Root cause on the dev project: the "resumes" storage bucket did
 *    not exist ("Bucket not found"). The route now self-heals a missing
 *    bucket once, maps user errors to 4xx and logs the underlying error.
 *  - POST /api/resume/parse answered 503 (config) before auth and flipped
 *    resumeParseStatus to pending/failed on rejected requests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const getUserMock = vi.fn();
const uploadResumeMock = vi.fn();
const ensureBucketMock = vi.fn();
const profileFindUniqueMock = vi.fn();
const profileUpdateMock = vi.fn();
const profileUpdateManyMock = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/supabase-storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/supabase-storage')>();
  return { ...actual, uploadResume: (...a: unknown[]) => uploadResumeMock(...a), uploadAvatar: vi.fn() };
});
vi.mock('@/app/api/upload/ensure-bucket', () => ({ ensureUploadBucket: (...a: unknown[]) => ensureBucketMock(...a) }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    userProfile: {
      findUnique: (...a: unknown[]) => profileFindUniqueMock(...a),
      update: (...a: unknown[]) => profileUpdateMock(...a),
      updateMany: (...a: unknown[]) => profileUpdateManyMock(...a),
    },
  },
}));
vi.mock('@/lib/resume-parser', () => ({ parseResume: vi.fn() }));
vi.mock('@/lib/inngest/client', () => ({ inngest: { send: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('@/lib/ai/feature-flags', () => ({ isAiFeatureEnabled: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/resume-storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/resume-storage')>();
  return { ...actual, downloadResumeBytes: vi.fn() };
});

const USER = 'aaaaaaaa-1111-2222-3333-444444444444';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n', 'latin1');

function uploadReq(): NextRequest {
  const form = new FormData();
  form.append('file', new File([new Uint8Array(PDF)], 'resume.pdf', { type: 'application/pdf' }));
  form.append('type', 'resume');
  return new NextRequest('http://localhost:3000/api/upload', { method: 'POST', body: form });
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserMock.mockResolvedValue({ data: { user: { id: USER } }, error: null });
  profileFindUniqueMock.mockResolvedValue({ id: 'p1' });
  profileUpdateMock.mockResolvedValue({});
  profileUpdateManyMock.mockResolvedValue({ count: 1 });
});

describe('classifyUploadError', () => {
  it('maps user and scanner errors to specific 4xx and service faults to 503', async () => {
    const { classifyUploadError } = await import('@/app/api/upload/upload-errors');
    expect(classifyUploadError(new Error('Invalid file type. Only PDF and DOC/DOCX files are allowed.'), 'resume').status).toBe(415);
    expect(classifyUploadError(new Error('File size exceeds maximum of 5MB'), 'resume').status).toBe(413);
    expect(classifyUploadError(new Error('Threat detected: Eicar'), 'resume')).toMatchObject({ status: 422, code: 'rejected_by_scanner' });
    expect(classifyUploadError(new Error('File contains disallowed content (executable / script / macros / password-protected).'), 'resume').status).toBe(422);
    expect(classifyUploadError(new Error('Virus scanner returned 502.'), 'resume')).toMatchObject({ status: 503, code: 'scanner_unavailable' });
    expect(classifyUploadError(new Error('Virus scanner failure; upload rejected.'), 'resume').status).toBe(503);
    expect(classifyUploadError(new Error('Failed to upload resume: Bucket not found'), 'resume')).toMatchObject({ status: 503, code: 'storage_unavailable' });
    expect(classifyUploadError(Object.assign(new Error('Record not found'), { code: 'P2025' }), 'resume').status).toBe(409);
    expect(classifyUploadError(new Error('something else'), 'resume')).toMatchObject({ status: 500, error: 'Failed to upload file' });
  });

  it('user-facing messages carry no em or en dashes', async () => {
    const { classifyUploadError } = await import('@/app/api/upload/upload-errors');
    for (const m of ['Invalid file type', 'Threat detected: x', 'Virus scanner returned 500.', 'Bucket not found', 'x']) {
      expect(classifyUploadError(new Error(m), 'avatar').error).not.toMatch(/[–—]/);
    }
  });
});

describe('POST /api/upload', () => {
  it('creates a missing storage bucket once and retries: 200', async () => {
    uploadResumeMock
      .mockRejectedValueOnce(new Error('Failed to upload resume: Bucket not found'))
      .mockResolvedValueOnce({ path: `local/${USER}/1-resume.pdf`, url: 'https://signed.example/x' });
    ensureBucketMock.mockResolvedValue(true);
    const { POST } = await import('@/app/api/upload/route');
    const res = await POST(uploadReq());
    expect(res.status).toBe(200);
    expect(ensureBucketMock).toHaveBeenCalledWith('resume');
    expect(uploadResumeMock).toHaveBeenCalledTimes(2);
    expect(profileUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ data: { resumeUrl: `local/${USER}/1-resume.pdf`, resumeParseStatus: 'pending' } }));
  });

  it('503 with a specific message when the bucket cannot be created', async () => {
    uploadResumeMock.mockRejectedValue(new Error('Failed to upload resume: Bucket not found'));
    ensureBucketMock.mockResolvedValue(false);
    const { POST } = await import('@/app/api/upload/route');
    const res = await POST(uploadReq());
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('storage_unavailable');
    expect(profileUpdateMock).not.toHaveBeenCalled();
  });

  it('422 for a scanner rejection, never retried', async () => {
    uploadResumeMock.mockRejectedValue(new Error('Threat detected: Eicar-Test-Signature'));
    const { POST } = await import('@/app/api/upload/route');
    const res = await POST(uploadReq());
    expect(res.status).toBe(422);
    expect(ensureBucketMock).not.toHaveBeenCalled();
  });

  it('409 before storing anything when the caller has no profile row', async () => {
    profileFindUniqueMock.mockResolvedValue(null);
    const { POST } = await import('@/app/api/upload/route');
    const res = await POST(uploadReq());
    expect(res.status).toBe(409);
    expect(uploadResumeMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/resume/parse ordering', () => {
  function parseReq(resumeUrl: string): NextRequest {
    return new NextRequest('http://localhost:3000/api/resume/parse?preview=1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resumeUrl }),
    });
  }

  it('anonymous callers get 401 even when the parser is not configured', async () => {
    const saved = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    getUserMock.mockResolvedValue({ data: { user: null }, error: { message: 'no session' } });
    try {
      const { POST } = await import('@/app/api/resume/parse/route');
      const res = await POST(parseReq('resumes/x/y.pdf'));
      expect(res.status).toBe(401);
    } finally {
      if (saved !== undefined) process.env.OPENAI_API_KEY = saved;
    }
  });

  it("a rejected foreign-path request leaves the caller's resumeParseStatus untouched", async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-key';
    profileFindUniqueMock.mockResolvedValue({ resumeUrl: `local/${USER}/1-mine.pdf` });
    const { POST } = await import('@/app/api/resume/parse/route');
    const res = await POST(parseReq('local/bbbbbbbb-5555-6666-7777-888888888888/1-victim.pdf'));
    expect(res.status).toBe(403);
    expect(profileUpdateManyMock).not.toHaveBeenCalled();
  });

  it('a malformed body leaves the status untouched', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    const { POST } = await import('@/app/api/resume/parse/route');
    const res = await POST(parseReq(''));
    expect(res.status).toBe(400);
    expect(profileUpdateManyMock).not.toHaveBeenCalled();
  });
});
