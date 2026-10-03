/**
 * verify-renewal-session — missed-webhook self-heal for RENEWALS.
 *
 * A lost renewal webhook used to mean $179 taken and the posting still
 * expiring on its original date, permanently. The verify endpoint now runs
 * the webhook's own applyRenewalCheckout when Stripe says the session is
 * paid, the caller owns it, and no JobCharge exists for the session.
 *
 * Pins:
 *   - self-heal runs only after the paid / type / ownership checks, and only
 *     when the ledger has no row for this session;
 *   - an existing ledger row (webhook already applied) skips it;
 *   - a self-heal failure is captured to Sentry and never breaks the response;
 *   - an anonymous caller never triggers it (401 before any Stripe call);
 *   - the answer carries the post's archivedAt, so the success page can say
 *     that a renewal applied to an archived post is not live until the post
 *     is restored (tests/regressions/renewal-success-archived.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { NextRequest } from 'next/server';
import { captureException } from '@/lib/sentry';

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

const applyMock = vi.hoisted(() => vi.fn());
vi.mock('@/app/api/webhooks/stripe/apply-renewal', () => ({ applyRenewalCheckout: applyMock }));

const PAID_SESSION = {
  id: 'sess_123',
  payment_status: 'paid',
  metadata: { jobId: 'job-1', type: 'renewal', tier: 'pro' },
};

function makeReq(cookie?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (cookie) headers['cookie'] = cookie;
  return new NextRequest('https://pmhnphiring.com/api/verify-renewal-session?session_id=sess_123', { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  getUserMock.mockResolvedValue({ data: { user: null }, error: null });
  retrieveMock.mockResolvedValue(PAID_SESSION);
  vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({
    dashboardToken: 'secret-token',
    userId: 'owner-user-id',
    contactEmail: 'owner@clinic.example',
    job: { id: 'job-1', title: 'PMHNP' },
  } as never);
  applyMock.mockResolvedValue({ outcome: 'applied', jobId: 'job-1' });
});

describe('verify-renewal-session self-heal', () => {
  it('applies a paid renewal that has no ledger row (webhook lost) via the shared fulfilment', async () => {
    vi.mocked(prisma.jobCharge.findUnique).mockResolvedValue(null as never);

    const { GET } = await import('@/app/api/verify-renewal-session/route');
    const res = await GET(makeReq('pmhnp_renewal_session=sess_123'));

    expect(res.status).toBe(200);
    expect(prisma.jobCharge.findUnique).toHaveBeenCalledWith({ where: { stripeSessionId: 'sess_123' }, select: { id: true } });
    expect(applyMock).toHaveBeenCalledWith(expect.anything(), PAID_SESSION);
    expect((await res.json()).dashboardToken).toBe('secret-token');
  });

  it('does nothing when the webhook already ledgered the session', async () => {
    vi.mocked(prisma.jobCharge.findUnique).mockResolvedValue({ id: 'jc-1' } as never);

    const { GET } = await import('@/app/api/verify-renewal-session/route');
    const res = await GET(makeReq('pmhnp_renewal_session=sess_123'));

    expect(res.status).toBe(200);
    expect(applyMock).not.toHaveBeenCalled();
  });

  it('never self-heals an unpaid session', async () => {
    retrieveMock.mockResolvedValue({ ...PAID_SESSION, payment_status: 'unpaid' });

    const { GET } = await import('@/app/api/verify-renewal-session/route');
    const res = await GET(makeReq('pmhnp_renewal_session=sess_123'));

    expect(res.status).toBe(400);
    expect(applyMock).not.toHaveBeenCalled();
  });

  it('never self-heals for a signed-in caller who does not own the posting', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'attacker', email: 'a@evil.example' } }, error: null });

    const { GET } = await import('@/app/api/verify-renewal-session/route');
    const res = await GET(makeReq());

    expect(res.status).toBe(403);
    expect(applyMock).not.toHaveBeenCalled();
  });

  it('captures a self-heal failure to Sentry without breaking the success page', async () => {
    vi.mocked(prisma.jobCharge.findUnique).mockResolvedValue(null as never);
    applyMock.mockRejectedValue(new Error('db down'));

    const { GET } = await import('@/app/api/verify-renewal-session/route');
    const res = await GET(makeReq('pmhnp_renewal_session=sess_123'));

    expect(res.status).toBe(200);
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({
      tags: { area: 'verify-renewal-session' },
    }));
  });

  it('surfaces a renewal paid on a revoked posting to Sentry', async () => {
    vi.mocked(prisma.jobCharge.findUnique).mockResolvedValue(null as never);
    applyMock.mockResolvedValue({ outcome: 'revoked_posting', jobId: 'job-1', revokedStatus: 'disputed' });

    const { GET } = await import('@/app/api/verify-renewal-session/route');
    await GET(makeReq('pmhnp_renewal_session=sess_123'));

    expect(captureException).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({
      extra: expect.objectContaining({ status: 'disputed' }),
    }));
  });
});

describe('verify-renewal-session tells the success page when the post is archived', () => {
  const ARCHIVED_AT = new Date('2026-09-30T12:00:00.000Z');

  function post(archivedAt: Date | null) {
    vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({
      dashboardToken: 'secret-token',
      userId: 'owner-user-id',
      contactEmail: 'owner@clinic.example',
      job: { id: 'job-1', title: 'PMHNP', archivedAt },
    } as never);
  }

  it('returns archivedAt for a renewal applied to an archived post: paid for, not live until restored', async () => {
    post(ARCHIVED_AT);
    vi.mocked(prisma.jobCharge.findUnique).mockResolvedValue(null as never);
    applyMock.mockResolvedValue({ outcome: 'applied', jobId: 'job-1', leftArchived: true });

    const { GET } = await import('@/app/api/verify-renewal-session/route');
    const res = await GET(makeReq('pmhnp_renewal_session=sess_123'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.archivedAt).toBe(ARCHIVED_AT.toISOString());
    expect(json.dashboardToken).toBe('secret-token');
  });

  it('returns archivedAt: null for a post that is not archived', async () => {
    post(null);
    vi.mocked(prisma.jobCharge.findUnique).mockResolvedValue({ id: 'jc-1' } as never);

    const { GET } = await import('@/app/api/verify-renewal-session/route');
    const json = await (await GET(makeReq('pmhnp_renewal_session=sess_123'))).json();

    expect(json.archivedAt).toBeNull();
  });

  it('reads archivedAt with the post, and gives it to a signed in owner without the checkout cookie too', async () => {
    post(ARCHIVED_AT);
    vi.mocked(prisma.jobCharge.findUnique).mockResolvedValue({ id: 'jc-1' } as never);
    getUserMock.mockResolvedValue({ data: { user: { id: 'owner-user-id', email: 'owner@clinic.example' } }, error: null });

    const { GET } = await import('@/app/api/verify-renewal-session/route');
    const json = await (await GET(makeReq())).json();

    expect(prisma.employerJob.findFirst).toHaveBeenCalledWith({
      where: { jobId: 'job-1' },
      include: { job: { select: { id: true, title: true, archivedAt: true } } },
    });
    expect(json.archivedAt).toBe(ARCHIVED_AT.toISOString());
    expect(json.dashboardToken).toBeUndefined();
    expect(json.tokenDeliveredViaEmail).toBe(true);
  });
});
