/**
 * Regression (audit V7) — POST /api/resume/parse trusted a client-supplied
 * `resumeUrl` storage path with no ownership check. Any authenticated user
 * who obtained another candidate's storage path (e.g. from a previously
 * minted signed URL) could re-download and AI-parse that resume — full PII
 * disclosure — with the access audit-logged as a self-parse
 * (ownerId === actorId), laundering the DocumentAccessLog trail and
 * bypassing the employer route's visibility/unlock gates.
 *
 * The fix normalizes the supplied path, rejects traversal, and requires it
 * to resolve to the caller's OWN stored resume (profile.resumeUrl written
 * by /api/upload) before any storage byte is fetched. It also adds the
 * missing 'ai.candidate.resume_parser' kill-switch gate. These tests lock
 * both in.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { downloadResumeBytes } from '@/lib/resume-storage';
import { parseResume } from '@/lib/resume-parser';
import { isAiFeatureEnabled } from '@/lib/ai/feature-flags';

const getUserMock = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({ auth: { getUser: getUserMock } }),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    userProfile: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock('@/lib/rate-limit', () => ({
  rateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/resume-parser', () => ({
  parseResume: vi.fn(),
}));

vi.mock('@/lib/inngest/client', () => ({
  inngest: { send: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('@/lib/ai/feature-flags', () => ({
  isAiFeatureEnabled: vi.fn(),
}));

// Keep the REAL toBareResumePath (path normalization is part of what the
// guard relies on) and only stub the storage download.
vi.mock('@/lib/resume-storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/resume-storage')>();
  return {
    ...actual,
    downloadResumeBytes: vi.fn(),
  };
});

const USER_A = 'aaaaaaaa-1111-2222-3333-444444444444';
const USER_B = 'bbbbbbbb-5555-6666-7777-888888888888';
const OWN_PATH = `local/${USER_A}/1700000000000-mine.pdf`;
const VICTIM_PATH = `local/${USER_B}/1700000000001-victim.pdf`;

function jsonReq(resumeUrl: string, qs = '?preview=1'): Request {
  return new Request(`https://example.com/api/resume/parse${qs}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ resumeUrl }),
  });
}

describe('POST /api/resume/parse — IDOR on client-supplied storage path is closed (V7)', () => {
  beforeEach(() => {
    // Route fails fast (503) without these; the values are inert — every
    // network-touching module is mocked.
    process.env.OPENAI_API_KEY = 'test-openai-key';

    getUserMock.mockResolvedValue({ data: { user: { id: USER_A } }, error: null });
    vi.mocked(isAiFeatureEnabled).mockResolvedValue(true);
    vi.mocked(prisma.userProfile.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.userProfile.findUnique).mockResolvedValue({ resumeUrl: OWN_PATH } as never);
    vi.mocked(downloadResumeBytes).mockResolvedValue({
      buffer: Buffer.from('%PDF-1.4 test'),
      contentType: 'application/pdf',
    });
    vi.mocked(parseResume).mockResolvedValue({ firstName: 'Ada' } as never);
  });

  it("403 when user A supplies user B's bare storage path — no storage read, no AI parse", async () => {
    const { POST } = await import('@/app/api/resume/parse/route');
    const res = await POST(jsonReq(VICTIM_PATH) as never);

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.parsed).toBeUndefined();
    expect(downloadResumeBytes).not.toHaveBeenCalled();
    expect(parseResume).not.toHaveBeenCalled();
  });

  it("403 when user A replays a signed URL pointing at user B's resume", async () => {
    const signedUrl =
      `https://test.supabase.co/storage/v1/object/sign/resumes/${VICTIM_PATH}?token=eyJabc`;
    const { POST } = await import('@/app/api/resume/parse/route');
    const res = await POST(jsonReq(signedUrl) as never);

    expect(res.status).toBe(403);
    expect(downloadResumeBytes).not.toHaveBeenCalled();
    expect(parseResume).not.toHaveBeenCalled();
  });

  it('403 on a traversal path even when it dot-dots back toward a foreign folder', async () => {
    const { POST } = await import('@/app/api/resume/parse/route');
    const res = await POST(jsonReq(`local/${USER_A}/../${USER_B}/1700000000001-victim.pdf`) as never);

    expect(res.status).toBe(403);
    expect(downloadResumeBytes).not.toHaveBeenCalled();
    expect(parseResume).not.toHaveBeenCalled();
  });

  it('403 when the caller has no stored resume at all', async () => {
    vi.mocked(prisma.userProfile.findUnique).mockResolvedValue(null as never);
    const { POST } = await import('@/app/api/resume/parse/route');
    const res = await POST(jsonReq(VICTIM_PATH) as never);

    expect(res.status).toBe(403);
    expect(downloadResumeBytes).not.toHaveBeenCalled();
  });

  it("200 in preview mode for the caller's OWN path — download uses the verified path with actor===owner audit ctx", async () => {
    const { POST } = await import('@/app/api/resume/parse/route');
    const res = await POST(jsonReq(OWN_PATH) as never);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.parsed).toEqual({ firstName: 'Ada' });

    expect(downloadResumeBytes).toHaveBeenCalledTimes(1);
    const [pathArg, ctxArg] = vi.mocked(downloadResumeBytes).mock.calls[0];
    expect(pathArg).toBe(OWN_PATH);
    expect(ctxArg).toMatchObject({ actorId: USER_A, ownerId: USER_A, action: 'parse' });
  });

  it("200 when the caller sends their own path with the legacy 'resumes/' bucket prefix (normalization still accepted)", async () => {
    const { POST } = await import('@/app/api/resume/parse/route');
    const res = await POST(jsonReq(`resumes/${OWN_PATH}`) as never);

    expect(res.status).toBe(200);
    expect(downloadResumeBytes).toHaveBeenCalledTimes(1);
    expect(vi.mocked(downloadResumeBytes).mock.calls[0][0]).toBe(OWN_PATH);
  });

  it("503 with code 'feature_disabled' when the ai.candidate.resume_parser kill switch is off — nothing downloaded or parsed", async () => {
    vi.mocked(isAiFeatureEnabled).mockResolvedValue(false);
    const { POST } = await import('@/app/api/resume/parse/route');
    const res = await POST(jsonReq(OWN_PATH) as never);

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('feature_disabled');
    expect(isAiFeatureEnabled).toHaveBeenCalledWith(
      'ai.candidate.resume_parser',
      { type: 'candidate', id: USER_A },
    );
    expect(prisma.userProfile.updateMany).not.toHaveBeenCalled();
    expect(downloadResumeBytes).not.toHaveBeenCalled();
    expect(parseResume).not.toHaveBeenCalled();
  });
});
