/**
 * P10 auth-account-security: anonymous email-triggering auth routes.
 *
 *  - POST /api/auth/send-confirmation minted Supabase auth users and sent
 *    mail for ANY address (admin.generateLink magiclink auto-creates the
 *    user), and answered 500 for a malformed address.
 *  - POST /api/auth/welcome told an anonymous caller whether an address
 *    had an account ({reason:'no_profile'} vs {sent:true}) and mailed it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const generateLinkMock = vi.fn();
const sendAndLogMock = vi.fn();
const queryRawMock = vi.fn();
const getUserMock = vi.fn();
const findFirstProfileMock = vi.fn();
const findFirstEmailSendMock = vi.fn();
const sendWelcomeMock = vi.fn();

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ auth: { admin: { generateLink: generateLinkMock } } }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}));
vi.mock('@/lib/email-service', () => ({
  sendAndLog: sendAndLogMock,
  sendSignupWelcomeEmail: sendWelcomeMock,
}));
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: vi.fn().mockResolvedValue(null),
  RATE_LIMITS: { auth: { limit: 10, windowSeconds: 60 } },
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => queryRawMock(...args),
    userProfile: { findFirst: (...a: unknown[]) => findFirstProfileMock(...a) },
    emailSend: { findFirst: (...a: unknown[]) => findFirstEmailSendMock(...a) },
  },
}));

function post(url: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  generateLinkMock.mockResolvedValue({ data: { properties: { action_link: 'https://auth.example/verify?t=1' } }, error: null });
  sendAndLogMock.mockResolvedValue(undefined);
});

describe('send-confirmation email validation', () => {
  it('accepts normal addresses and rejects malformed ones', async () => {
    const { isValidEmailAddress } = await import('@/app/api/auth/send-confirmation/confirmation-eligibility');
    expect(isValidEmailAddress('person@example.com')).toBe(true);
    expect(isValidEmailAddress(' first.last+tag@sub.example.org ')).toBe(true);
    for (const bad of ['x', 'x@', '@example.com', 'a@b', 'a b@example.com', 'a@@example.com', `${'a'.repeat(250)}@example.com`, 42, null]) {
      expect(isValidEmailAddress(bad), String(bad)).toBe(false);
    }
  });
});

describe('POST /api/auth/send-confirmation', () => {
  it('400 for an invalid email string, without touching the database or Supabase', async () => {
    const { POST } = await import('@/app/api/auth/send-confirmation/route');
    const res = await POST(post('/api/auth/send-confirmation', { email: 'x' }));
    expect(res.status).toBe(400);
    expect(queryRawMock).not.toHaveBeenCalled();
    expect(generateLinkMock).not.toHaveBeenCalled();
  });

  it('400 for a malformed body', async () => {
    const { POST } = await import('@/app/api/auth/send-confirmation/route');
    for (const body of ['not json', {}, { email: 42 }, { email: '' }]) {
      const res = await POST(post('/api/auth/send-confirmation', body));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('unknown address: generic 200, no auth user minted, no mail', async () => {
    queryRawMock.mockResolvedValue([]);
    const { POST } = await import('@/app/api/auth/send-confirmation/route');
    const res = await POST(post('/api/auth/send-confirmation', { email: 'anyone@example.com' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(generateLinkMock).not.toHaveBeenCalled();
    expect(sendAndLogMock).not.toHaveBeenCalled();
  });

  it('already confirmed address: same generic 200, no sign-in link minted', async () => {
    queryRawMock.mockResolvedValue([{ confirmed: true }]);
    const { POST } = await import('@/app/api/auth/send-confirmation/route');
    const res = await POST(post('/api/auth/send-confirmation', { email: 'Known@Example.com' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(generateLinkMock).not.toHaveBeenCalled();
    expect(sendAndLogMock).not.toHaveBeenCalled();
  });

  it('existing unconfirmed account: link generated and mailed, same body', async () => {
    queryRawMock.mockResolvedValue([{ confirmed: false }]);
    const { POST } = await import('@/app/api/auth/send-confirmation/route');
    const res = await POST(post('/api/auth/send-confirmation', { email: 'Pending@Example.com' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(generateLinkMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'magiclink', email: 'pending@example.com' }));
    expect(sendAndLogMock).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the account lookup errors: nothing created or sent', async () => {
    queryRawMock.mockRejectedValue(new Error('db down'));
    const { POST } = await import('@/app/api/auth/send-confirmation/route');
    const res = await POST(post('/api/auth/send-confirmation', { email: 'someone@example.com' }));
    expect(res.status).toBe(500);
    expect(generateLinkMock).not.toHaveBeenCalled();
    expect(sendAndLogMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/welcome', () => {
  it('anonymous callers get an identical 401 for known and unknown addresses, and no lookup or mail', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: { message: 'Auth session missing!' } });
    findFirstProfileMock.mockResolvedValue({ firstName: 'E2E', role: 'job_seeker' });
    const { POST } = await import('@/app/api/auth/welcome/route');
    const unknown = await POST(post('/api/auth/welcome', { email: 'nobody-xyz-123@example.invalid' }));
    const known = await POST(post('/api/auth/welcome', { email: 'e2e-candidate@example.invalid' }));
    expect(unknown.status).toBe(401);
    expect(known.status).toBe(401);
    expect(await known.text()).toBe(await unknown.text());
    expect(findFirstProfileMock).not.toHaveBeenCalled();
    expect(sendWelcomeMock).not.toHaveBeenCalled();
  });

  it('a signed-in but unconfirmed session is refused', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@example.com', email_confirmed_at: null } }, error: null });
    const { POST } = await import('@/app/api/auth/welcome/route');
    const res = await POST(post('/api/auth/welcome', {}));
    expect(res.status).toBe(401);
    expect(sendWelcomeMock).not.toHaveBeenCalled();
  });

  it("mails only the session user's own address; a body email is ignored", async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: 'u1', email: 'Owner@Example.com', email_confirmed_at: '2026-09-01T00:00:00Z' } },
      error: null,
    });
    findFirstProfileMock.mockResolvedValue({ firstName: 'Ada', role: 'job_seeker' });
    findFirstEmailSendMock.mockResolvedValue(null);
    const { POST } = await import('@/app/api/auth/welcome/route');
    const res = await POST(post('/api/auth/welcome', { email: 'victim@example.com' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: true });
    expect(findFirstProfileMock).toHaveBeenCalledWith(expect.objectContaining({ where: { supabaseId: 'u1' } }));
    expect(sendWelcomeMock).toHaveBeenCalledWith('owner@example.com', 'Ada', 'job_seeker');
  });
});
