/**
 * Regression (audit H1) — GET /api/job-alerts/by-email leaked every alert,
 * INCLUDING the management `token`, for ANY email with no auth (IDOR). The
 * token is the bearer credential for editing/deleting alerts, so knowing a
 * victim's email handed an attacker control of their alerts.
 *
 * The fix requires an authenticated session whose email matches the requested
 * address. These tests lock that in.
 *
 * A matching email proves ownership only once Supabase has confirmed it, so
 * the session must also carry email_confirmed_at, the check
 * /api/auth/welcome already makes. Every legitimate session has it (Supabase
 * refuses a password sign-in for an unconfirmed email and stamps it when a
 * confirmation, magic link or verified Google sign-in completes); only a
 * session let in on an unverified address lacks it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';

const getUserMock = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({ auth: { getUser: getUserMock } }),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: { jobAlert: { findMany: vi.fn() } },
}));

vi.mock('@/lib/rate-limit', () => ({
  rateLimit: vi.fn().mockResolvedValue(null),
  RATE_LIMITS: { jobAlerts: { limit: 10, windowSeconds: 60 } },
}));

function req(email: string): Request {
  return new Request(`https://example.com/api/job-alerts/by-email?email=${encodeURIComponent(email)}`);
}

describe('GET /api/job-alerts/by-email — IDOR is closed', () => {
  beforeEach(() => vi.clearAllMocks());

  it('401 for an anonymous caller, with no DB read', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const { GET } = await import('@/app/api/job-alerts/by-email/route');
    const res = await GET(req('victim@example.com') as never);
    expect(res.status).toBe(401);
    expect(prisma.jobAlert.findMany).not.toHaveBeenCalled();
  });

  it("403 when the session email differs from the requested email (can't read someone else's tokens)", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'sb-1', email: 'attacker@example.com', email_confirmed_at: '2026-10-01T00:00:00Z' } } });
    const { GET } = await import('@/app/api/job-alerts/by-email/route');
    const res = await GET(req('victim@example.com') as never);
    expect(res.status).toBe(403);
    expect(prisma.jobAlert.findMany).not.toHaveBeenCalled();
  });

  it.each([
    ['no email_confirmed_at', {}],
    ['email_confirmed_at null', { email_confirmed_at: null }],
  ])('401 for a matching session whose email is not confirmed (%s), with no DB read', async (_label, confirmation) => {
    // An address nobody proved: the alert tokens would go to whoever typed it.
    getUserMock.mockResolvedValue({ data: { user: { id: 'sb-3', email: 'victim@example.com', ...confirmation } } });
    const { GET } = await import('@/app/api/job-alerts/by-email/route');
    const res = await GET(req('victim@example.com') as never);
    expect(res.status).toBe(401);
    expect(prisma.jobAlert.findMany).not.toHaveBeenCalled();
  });

  it('401 when Supabase answers with an error, even if it also returned a user', async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: 'sb-4', email: 'owner@example.com', email_confirmed_at: '2026-10-01T00:00:00Z' } },
      error: { name: 'AuthApiError', message: 'invalid JWT' },
    });
    const { GET } = await import('@/app/api/job-alerts/by-email/route');
    const res = await GET(req('owner@example.com') as never);
    expect(res.status).toBe(401);
    expect(prisma.jobAlert.findMany).not.toHaveBeenCalled();
  });

  it('200 and returns alerts only when the session owns the email (case-insensitive)', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'sb-2', email: 'Owner@Example.com', email_confirmed_at: '2026-10-01T00:00:00Z' } } });
    vi.mocked(prisma.jobAlert.findMany).mockResolvedValue([
      { id: 'a1', token: 't1', email: 'owner@example.com', name: null, keyword: null, location: null, mode: null, jobType: null, minSalary: null, maxSalary: null, frequency: 'daily', isActive: true, lastSentAt: null, createdAt: new Date() },
    ] as never);
    const { GET } = await import('@/app/api/job-alerts/by-email/route');
    const res = await GET(req('owner@example.com') as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.alerts).toHaveLength(1);
  });
});
