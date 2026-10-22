/**
 * B114 regression lock — /api/verify-checkout-session is an authenticated,
 * rate-limited, ownership-scoped endpoint, not an open Stripe proxy.
 *
 * Contract (mirrors tests/api/verify-renewal-session-sec3.test.ts for the
 * renewal twin):
 *   - anonymous callers without the checkout binding cookie → 401 and NO
 *     Stripe API call (session ids leak via referers/history; the endpoint
 *     must not be usable to probe them or burn Stripe quota)
 *   - signed-in callers who do NOT own the checkout (no userId or
 *     contactEmail match on the EmployerJob row) → 403, no job data
 *   - signed-in owners without the cookie → 200, but the dashboardToken is
 *     withheld (tokenDeliveredViaEmail — email is the authoritative channel)
 *   - cookie-bound callers ('checkout_session_bind' === session_id) → 200
 *     with the dashboardToken
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

// The self-heal path pulls the full webhook activation module — irrelevant
// here (paymentStatus is 'paid' in these fixtures) and heavy to load.
vi.mock('@/app/api/webhooks/stripe/activate-paid-job', () => ({
  activatePaidJobCheckout: vi.fn().mockResolvedValue({ outcome: 'activated' }),
}));

function makeReq(sessionId: string, cookie?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (cookie) headers['cookie'] = cookie;
  return new NextRequest(
    `https://pmhnphiring.com/api/verify-checkout-session?session_id=${sessionId}`,
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
    metadata: { jobId: 'job-1' },
  });
  vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({
    dashboardToken: 'secret-token',
    paymentStatus: 'paid',
    contactEmail: 'owner@clinic.example',
    userId: 'owner-user-id',
    job: { title: 'PMHNP', slug: 'pmhnp-job-1', isPublished: true },
  } as never);
});

describe('verify-checkout-session — B114 auth + ownership gate', () => {
  it('401s anonymous callers with no binding cookie, before any Stripe call', async () => {
    const { GET } = await import('@/app/api/verify-checkout-session/route');
    const res = await GET(makeReq('cs_123'));
    const json = await res.json();
    expect(res.status).toBe(401);
    expect(json.dashboardToken).toBeUndefined();
    expect(json.jobTitle).toBeUndefined();
    expect(retrieveMock).not.toHaveBeenCalled();
  });

  it('401s when the cookie binds a DIFFERENT session and the caller is anonymous', async () => {
    const { GET } = await import('@/app/api/verify-checkout-session/route');
    const res = await GET(makeReq('cs_123', 'checkout_session_bind=cs_OTHER'));
    expect(res.status).toBe(401);
    expect(retrieveMock).not.toHaveBeenCalled();
  });

  it('returns the dashboardToken when the checkout binding cookie matches', async () => {
    const { GET } = await import('@/app/api/verify-checkout-session/route');
    const res = await GET(makeReq('cs_123', 'checkout_session_bind=cs_123'));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.paid).toBe(true);
    expect(json.dashboardToken).toBe('secret-token');
    expect(json.tokenDeliveredViaEmail).toBeUndefined();
  });

  it('403s a signed-in caller who does not own the checkout (no job data leaked)', async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: 'attacker-id', email: 'attacker@evil.example' } },
      error: null,
    });
    const { GET } = await import('@/app/api/verify-checkout-session/route');
    const res = await GET(makeReq('cs_123'));
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
    const { GET } = await import('@/app/api/verify-checkout-session/route');
    const res = await GET(makeReq('cs_123'));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.dashboardToken).toBeUndefined();
    expect(json.tokenDeliveredViaEmail).toBe(true);
    expect(json.jobTitle).toBe('PMHNP');
  });

  it('200s the owner via case-insensitive contactEmail match on legacy rows without userId', async () => {
    vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({
      dashboardToken: 'secret-token',
      paymentStatus: 'paid',
      contactEmail: 'Owner@Clinic.example',
      userId: null,
      job: { title: 'PMHNP', slug: 'pmhnp-job-1', isPublished: true },
    } as never);
    getUserMock.mockResolvedValue({
      data: { user: { id: 'some-user-id', email: 'owner@clinic.EXAMPLE', email_confirmed_at: '2026-10-01T00:00:00Z' } },
      error: null,
    });
    const { GET } = await import('@/app/api/verify-checkout-session/route');
    const res = await GET(makeReq('cs_123'));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.dashboardToken).toBeUndefined();
    expect(json.tokenDeliveredViaEmail).toBe(true);
  });

  // Register 2.26: the email fallback is for unclaimed rows only, and only for
  // a confirmed email, as lib/employer-ownership.ts defines ownership.
  it('403s a caller whose email matches a checkout another account claimed', async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: 'someone-else', email: 'owner@clinic.example', email_confirmed_at: '2026-10-01T00:00:00Z' } },
      error: null,
    });
    const { GET } = await import('@/app/api/verify-checkout-session/route');
    const res = await GET(makeReq('cs_123'));
    const json = await res.json();
    expect(res.status).toBe(403);
    expect(json.jobTitle).toBeUndefined();
  });

  it('403s an unconfirmed email on a legacy row without userId', async () => {
    vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({
      dashboardToken: 'secret-token',
      paymentStatus: 'paid',
      contactEmail: 'owner@clinic.example',
      userId: null,
      job: { title: 'PMHNP', slug: 'pmhnp-job-1', isPublished: true },
    } as never);
    getUserMock.mockResolvedValue({
      data: { user: { id: 'some-user-id', email: 'owner@clinic.example' } },
      error: null,
    });
    const { GET } = await import('@/app/api/verify-checkout-session/route');
    const res = await GET(makeReq('cs_123'));
    expect(res.status).toBe(403);
  });
});
