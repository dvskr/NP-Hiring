/**
 * Audit CRIT-1 regression — the human unsubscribe page path
 * (GET /api/email/unsubscribe) previously set only isSubscribed=false, but every
 * marketing send-gate checks isEmailSuppressed() (EmailLead.isSuppressed /
 * UserProfile.emailSuppressed), NOT isSubscribed. So opt-outs were still mailed by
 * broadcasts, candidate alerts, saved-job reminders, and digests.
 *
 * The fix sets suppression on the lead and mirrors it onto the profile, and the
 * resubscribe path lifts suppression ONLY when it came from an explicit
 * unsubscribe (never resurrecting a bounce/complaint). These tests lock that in.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    emailLead: { findUnique: vi.fn(), update: vi.fn() },
    userProfile: { updateMany: vi.fn() },
    $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: vi.fn().mockResolvedValue(null),
  RATE_LIMITS: { general: {} },
}));

import { prisma } from '@/lib/prisma';

function getReq(token?: string): Request {
  const base = 'https://nphiring.com/api/email/unsubscribe';
  return new Request(token ? `${base}?token=${token}` : base);
}
function postReq(token: string): Request {
  return new Request('https://nphiring.com/api/email/unsubscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });
}

describe('GET /api/email/unsubscribe — human unsubscribe suppresses', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sets isSuppressed on the lead AND mirrors emailSuppressed onto the profile', async () => {
    vi.mocked(prisma.emailLead.findUnique).mockResolvedValue({ id: 'l1', email: 'x@example.com' } as never);
    vi.mocked(prisma.emailLead.update).mockResolvedValue({} as never);
    vi.mocked(prisma.userProfile.updateMany).mockResolvedValue({ count: 1 } as never);

    const { GET } = await import('@/app/api/email/unsubscribe/route');
    const res = await GET(getReq('tok-1') as never);

    expect(res.status).toBe(200);
    expect(prisma.emailLead.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { unsubscribeToken: 'tok-1' },
        data: expect.objectContaining({
          isSubscribed: false,
          newsletterOptIn: false,
          isSuppressed: true,
          suppressionReason: 'unsubscribe',
        }),
      }),
    );
    expect(prisma.userProfile.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: 'x@example.com' },
        data: expect.objectContaining({ emailSuppressed: true }),
      }),
    );
  });

  it('returns 404 for an unknown token and writes nothing', async () => {
    vi.mocked(prisma.emailLead.findUnique).mockResolvedValue(null as never);

    const { GET } = await import('@/app/api/email/unsubscribe/route');
    const res = await GET(getReq('nope') as never);

    expect(res.status).toBe(404);
    expect(prisma.emailLead.update).not.toHaveBeenCalled();
    expect(prisma.userProfile.updateMany).not.toHaveBeenCalled();
  });
});

describe('POST /api/email/unsubscribe — resubscribe', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lifts suppression when it came from an explicit unsubscribe', async () => {
    vi.mocked(prisma.emailLead.findUnique).mockResolvedValue({
      id: 'l1', email: 'x@example.com', isSuppressed: true, suppressionReason: 'unsubscribe',
    } as never);
    vi.mocked(prisma.emailLead.update).mockResolvedValue({} as never);
    vi.mocked(prisma.userProfile.updateMany).mockResolvedValue({ count: 1 } as never);

    const { POST } = await import('@/app/api/email/unsubscribe/route');
    const res = await POST(postReq('tok-1') as never);

    expect(res.status).toBe(200);
    expect(prisma.emailLead.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isSubscribed: true, isSuppressed: false, suppressionReason: null }),
      }),
    );
    expect(prisma.userProfile.updateMany).toHaveBeenCalled();
  });

  it('does NOT resurrect a bounce/complaint suppression on resubscribe', async () => {
    vi.mocked(prisma.emailLead.findUnique).mockResolvedValue({
      id: 'l1', email: 'x@example.com', isSuppressed: true, suppressionReason: 'bounce',
    } as never);
    vi.mocked(prisma.emailLead.update).mockResolvedValue({} as never);

    const { POST } = await import('@/app/api/email/unsubscribe/route');
    const res = await POST(postReq('tok-1') as never);

    expect(res.status).toBe(200);
    const arg = vi.mocked(prisma.emailLead.update).mock.calls[0][0] as { data: Record<string, unknown> };
    expect(arg.data.isSubscribed).toBe(true);
    expect(arg.data.isSuppressed).toBeUndefined();
    expect(prisma.userProfile.updateMany).not.toHaveBeenCalled();
  });
});
