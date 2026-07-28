/**
 * Sec3 + B114 regression lock — verify-renewal-session must only hand back the
 * job's management token (dashboardToken) when a cookie set at checkout binds
 * the requester to the session_id. session_id leaks via URLs / referers /
 * history, so returning the token for any known session_id was a
 * listing-takeover vector.
 *
 * B114 hardening (2026-07): cookie-less callers are no longer served at all
 * unless they are signed in AND own the renewed posting (userId or
 * contactEmail match against the EmployerJob row):
 *   - anonymous / wrong-cookie callers  → 401 (no Stripe call, no data)
 *   - signed-in NON-owners              → 403 (no job data, no token)
 *   - signed-in owners without cookie   → 200 but token still withheld
 *     (tokenDeliveredViaEmail — email remains the authoritative channel)
 *   - cookie-bound callers              → 200 with dashboardToken
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { NextRequest } from 'next/server';

const retrieveMock = vi.fn();
vi.mock('stripe', () => ({
  default: vi.fn().mockImplementation(() => ({
    checkout: { sessions: { retrieve: retrieveMock } },
  })),
}));

const getUserMock = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}));

vi.mock('@/lib/rate-limit', () => ({
  rateLimit: vi.fn().mockResolvedValue(null),
  RATE_LIMITS: { employer: { limit: 30, windowSeconds: 60 } },
}));

function makeReq(sessionId: string, cookie?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (cookie) headers['cookie'] = cookie;
  return new NextRequest(
    `https://pmhnphiring.com/api/verify-renewal-session?session_id=${sessionId}`,
    { headers },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  // Default: anonymous caller. Individual tests override with a signed-in user.
  getUserMock.mockResolvedValue({ data: { user: null }, error: null });
  retrieveMock.mockResolvedValue({
    payment_status: 'paid',
    metadata: { jobId: 'job-1', type: 'renewal', tier: 'pro' },
  });
  vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({
    dashboardToken: 'secret-token',
    userId: 'owner-user-id',
    contactEmail: 'owner@clinic.example',
    job: { id: 'job-1', title: 'PMHNP' },
  } as never);
});

describe('verify-renewal-session — Sec3 cookie binding + B114 auth gate', () => {
  it('returns the dashboardToken when the renewal cookie matches the session_id', async () => {
    const { GET } = await import('@/app/api/verify-renewal-session/route');
    const res = await GET(makeReq('sess_123', 'pmhnp_renewal_session=sess_123'));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.dashboardToken).toBe('secret-token');
    expect(json.tokenDeliveredViaEmail).toBeUndefined();
  });

  it('401s anonymous callers with no binding cookie, before any Stripe call', async () => {
    const { GET } = await import('@/app/api/verify-renewal-session/route');
    const res = await GET(makeReq('sess_123'));
    const json = await res.json();
    expect(res.status).toBe(401);
    expect(json.dashboardToken).toBeUndefined();
    expect(json.jobTitle).toBeUndefined();
    expect(retrieveMock).not.toHaveBeenCalled();
  });

  it('401s when the cookie is for a different session and the caller is anonymous (IDOR attempt)', async () => {
    const { GET } = await import('@/app/api/verify-renewal-session/route');
    const res = await GET(makeReq('sess_123', 'pmhnp_renewal_session=sess_OTHER'));
    const json = await res.json();
    expect(res.status).toBe(401);
    expect(json.dashboardToken).toBeUndefined();
    expect(retrieveMock).not.toHaveBeenCalled();
  });

  it('403s a signed-in caller who does NOT own the renewed posting (no job data leaked)', async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: 'attacker-id', email: 'attacker@evil.example' } },
      error: null,
    });
    const { GET } = await import('@/app/api/verify-renewal-session/route');
    const res = await GET(makeReq('sess_123'));
    const json = await res.json();
    expect(res.status).toBe(403);
    expect(json.dashboardToken).toBeUndefined();
    expect(json.jobTitle).toBeUndefined();
  });

  it('200s the owner (userId match) without a cookie but still withholds the token', async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: 'owner-user-id', email: 'different@login.example' } },
      error: null,
    });
    const { GET } = await import('@/app/api/verify-renewal-session/route');
    const res = await GET(makeReq('sess_123'));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.dashboardToken).toBeUndefined();
    expect(json.tokenDeliveredViaEmail).toBe(true);
    expect(json.jobTitle).toBe('PMHNP');
  });

  it('200s the owner (contactEmail match, case-insensitive) when the row has no linked userId', async () => {
    vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({
      dashboardToken: 'secret-token',
      userId: null,
      contactEmail: 'Owner@Clinic.example',
      job: { id: 'job-1', title: 'PMHNP' },
    } as never);
    getUserMock.mockResolvedValue({
      data: { user: { id: 'some-user-id', email: 'owner@clinic.EXAMPLE' } },
      error: null,
    });
    const { GET } = await import('@/app/api/verify-renewal-session/route');
    const res = await GET(makeReq('sess_123'));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.dashboardToken).toBeUndefined();
    expect(json.tokenDeliveredViaEmail).toBe(true);
  });
});
