/**
 * Review fix (sign-up / log-in return flow): POST /api/auth/send-confirmation
 * read only `email` and always minted the link with a bare /auth/confirm, so
 * the `next` sent by the log-in, sign-up and /auth/confirm resend buttons was
 * lost. /auth/confirm then fell back to the return path stored at sign up,
 * which is wrong for a log-in resend: the candidate landed on onboarding, or
 * on a different job's apply form.
 *
 * The route now forwards a safe same-origin `next` as ?next= on the
 * confirmation redirect (the same shape SignUpForm uses for emailRedirectTo),
 * and drops anything off site.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const generateLinkMock = vi.fn();
const sendAndLogMock = vi.fn();
const queryRawMock = vi.fn();

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ auth: { admin: { generateLink: generateLinkMock } } }),
}));
vi.mock('@/lib/email-service', () => ({
  sendAndLog: sendAndLogMock,
}));
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => queryRawMock(...args),
  },
}));

function post(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/auth/send-confirmation', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
    body: JSON.stringify(body),
  });
}

/** The redirectTo the route handed to Supabase's generateLink. */
function mintedRedirect(): string {
  expect(generateLinkMock).toHaveBeenCalledTimes(1);
  const arg = generateLinkMock.mock.calls[0][0] as { options?: { redirectTo?: string } };
  return arg.options?.redirectTo ?? '';
}

beforeEach(() => {
  vi.clearAllMocks();
  // An existing, unconfirmed account: the only case that mints a link.
  queryRawMock.mockResolvedValue([{ confirmed: false }]);
  generateLinkMock.mockResolvedValue({ data: { properties: { action_link: 'https://auth.example/verify?t=1' } }, error: null });
  sendAndLogMock.mockResolvedValue(undefined);
});

describe('POST /api/auth/send-confirmation forwards the return path', () => {
  it('a job apply return path becomes an encoded ?next= on /auth/confirm', async () => {
    const { POST } = await import('@/app/api/auth/send-confirmation/route');
    const res = await POST(post({ email: 'pending@example.com', next: '/jobs/x?apply=1' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    const redirect = mintedRedirect();
    expect(redirect.endsWith('/auth/confirm?next=%2Fjobs%2Fx%3Fapply%3D1')).toBe(true);
    expect(sendAndLogMock).toHaveBeenCalledTimes(1);
  });

  it('no next: the plain /auth/confirm redirect, as before', async () => {
    const { POST } = await import('@/app/api/auth/send-confirmation/route');
    const res = await POST(post({ email: 'pending@example.com' }));
    expect(res.status).toBe(200);
    const redirect = mintedRedirect();
    expect(redirect.endsWith('/auth/confirm')).toBe(true);
    expect(redirect).not.toContain('next=');
  });

  it.each([
    ['protocol relative', '//evil.com'],
    ['absolute off site', 'https://evil.com'],
    ['backslash host', '/\\evil.com'],
    ['script url', 'javascript:alert(1)'],
    ['not a string', 42],
    ['empty', ''],
  ])('drops an unsafe next (%s) instead of forwarding it', async (_label, next) => {
    const { POST } = await import('@/app/api/auth/send-confirmation/route');
    const res = await POST(post({ email: 'pending@example.com', next }));
    expect(res.status).toBe(200);
    const redirect = mintedRedirect();
    expect(redirect.endsWith('/auth/confirm')).toBe(true);
    expect(redirect).not.toContain('next=');
    expect(redirect).not.toContain('evil.com');
  });

  it('keeps the generic answer for an unknown address and mints nothing, next or not', async () => {
    queryRawMock.mockResolvedValue([]);
    const { POST } = await import('@/app/api/auth/send-confirmation/route');
    const res = await POST(post({ email: 'anyone@example.com', next: '/jobs/x?apply=1' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(generateLinkMock).not.toHaveBeenCalled();
  });
});
