/**
 * The JobAlert token is the only key to an address's alerts, so it is made
 * and guarded like one.
 *
 * GET /api/job-alerts?token= lists every alert on the token's address, each
 * with its own token, and PATCH /api/job-alerts/[token] and DELETE
 * /api/job-alerts?token= accept those. Since the signup answer stopped
 * carrying the token (the 2026-10-13 hotfix), it reaches the inbox only.
 *
 *   - POST stored new alerts under the Prisma cuid() default, which is
 *     partly a timestamp and a counter. Its sibling creators (the auth
 *     callback, POST /api/auth/profile, completeSignupOptIns) already write
 *     crypto.randomUUID(); the signup route now does too. Nothing parses the
 *     token's format: every reader looks it up as an opaque string, and a
 *     UUID is lowercase, so the middleware's lowercase redirect never
 *     touches /api/job-alerts/<token>.
 *   - GET ?token= had no rate limit at all; it now has its own bucket.
 *   - DELETE ?token= took the same token with no limit either, and answers
 *     404 or 200 the same way, so it was the unlimited way to try tokens
 *     once GET was limited. It spends the GET bucket, so switching methods
 *     gives no fresh allowance.
 *   - PATCH /api/job-alerts/[token] is the third: with an empty body it
 *     changes nothing and answers the alert (id, token, frequency, isActive)
 *     or a 404. It spends the same bucket.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const h = vi.hoisted(() => ({
  emailLead: { upsert: vi.fn(), update: vi.fn() },
  userProfile: { updateMany: vi.fn() },
  jobAlert: { findUnique: vi.fn(), findMany: vi.fn(), delete: vi.fn(), update: vi.fn() },
  txJobAlert: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  $transaction: vi.fn(),
  $executeRaw: vi.fn(),
  rateLimit: vi.fn(),
}));

const RATE_LIMITS = vi.hoisted(() => ({
  jobAlerts: { limit: 10, windowSeconds: 60 },
  general: { limit: 60, windowSeconds: 60 },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    emailLead: h.emailLead,
    userProfile: h.userProfile,
    jobAlert: h.jobAlert,
    $transaction: h.$transaction,
  },
}));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: h.rateLimit, RATE_LIMITS }));
vi.mock('@/lib/beehiiv', () => ({ syncToBeehiiv: vi.fn() }));
vi.mock('@/lib/email-service', () => ({ sendWelcomeEmail: vi.fn().mockResolvedValue({ success: true }) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { DELETE, GET, POST } from '@/app/api/job-alerts/route';
import { PATCH } from '@/app/api/job-alerts/[token]/route';

const EMAIL = 'seeker@example.com';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function postReq(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/job-alerts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const getReq = (token: string) => new NextRequest(`http://localhost/api/job-alerts?token=${encodeURIComponent(token)}`);

beforeEach(() => {
  vi.clearAllMocks();
  h.rateLimit.mockResolvedValue(null);
  h.emailLead.upsert.mockResolvedValue({ isSuppressed: false, suppressionReason: null });
  h.$executeRaw.mockResolvedValue(1);
  h.$transaction.mockImplementation((arg: unknown) =>
    typeof arg === 'function'
      ? (arg as (tx: unknown) => Promise<unknown>)({ $executeRaw: h.$executeRaw, jobAlert: h.txJobAlert })
      : Promise.resolve([]),
  );
  h.txJobAlert.findFirst.mockResolvedValue(null);
  h.txJobAlert.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'alert-1', ...data }));
  h.txJobAlert.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'alert-1', token: 'existing-token', ...data }));
});

describe('POST /api/job-alerts: the token a new alert is stored under', () => {
  it('is a crypto.randomUUID(), not the cuid() default', async () => {
    const res = await POST(postReq({ email: EMAIL, frequency: 'daily' }));
    expect(res.status).toBe(200);
    expect(h.txJobAlert.create).toHaveBeenCalledTimes(1);
    const [{ data }] = h.txJobAlert.create.mock.calls[0] as [{ data: Record<string, unknown> }];
    expect(data.token).toMatch(UUID_V4);
  });

  it('differs for every new alert', async () => {
    await POST(postReq({ email: EMAIL, keyword: 'Telehealth' }));
    await POST(postReq({ email: EMAIL, keyword: 'Inpatient' }));
    const tokens = h.txJobAlert.create.mock.calls.map((call) => (call as [{ data: { token: string } }])[0].data.token);
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).not.toBe(tokens[1]);
  });

  it('a repeat of existing criteria leaves the stored token alone', async () => {
    // Rotating it here would break the links already in that inbox.
    h.txJobAlert.findFirst.mockResolvedValue({ id: 'alert-1', token: 'existing-token', name: null, confirmedAt: new Date('2026-09-01') });
    await POST(postReq({ email: EMAIL, frequency: 'weekly' }));
    expect(h.txJobAlert.create).not.toHaveBeenCalled();
    const [{ data }] = h.txJobAlert.update.mock.calls[0] as [{ data: Record<string, unknown> }];
    expect(data).not.toHaveProperty('token');
  });
});

describe('GET /api/job-alerts?token=: rate limited', () => {
  it('answers 429 before anything is looked up when the bucket is spent', async () => {
    h.rateLimit.mockResolvedValue(NextResponse.json({ error: 'Too many requests' }, { status: 429 }));
    const res = await GET(getReq('some-token'));
    expect(res.status).toBe(429);
    expect(h.jobAlert.findUnique).not.toHaveBeenCalled();
    expect(h.jobAlert.findMany).not.toHaveBeenCalled();
  });

  it('uses a bucket of its own, not the signup route\'s', async () => {
    // Sharing POST's 10 a minute would let a few signups lock a reader out
    // of the manage page, and the other way round.
    const req = getReq('some-token');
    h.jobAlert.findUnique.mockResolvedValue(null);
    await GET(req);
    expect(h.rateLimit).toHaveBeenCalledTimes(1);
    expect(h.rateLimit).toHaveBeenCalledWith(req, 'job-alerts-token', RATE_LIMITS.general);
  });

  it('also limits a request with no token, which is how enumeration starts', async () => {
    h.rateLimit.mockResolvedValue(NextResponse.json({ error: 'Too many requests' }, { status: 429 }));
    const res = await GET(new NextRequest('http://localhost/api/job-alerts'));
    expect(res.status).toBe(429);
  });

  it('within the limit it still lists every alert on the address, as the manage page expects', async () => {
    h.jobAlert.findUnique.mockResolvedValue({ id: 'alert-1', token: 'tok-1', email: EMAIL });
    h.jobAlert.findMany.mockResolvedValue([
      { id: 'alert-1', token: 'tok-1', email: EMAIL, frequency: 'daily', isActive: true, createdAt: new Date('2026-09-01') },
      { id: 'alert-2', token: 'tok-2', email: EMAIL, frequency: 'weekly', isActive: false, createdAt: new Date('2026-08-01') },
    ]);
    const res = await GET(getReq('tok-1'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.alerts.map((a: { token: string }) => a.token)).toEqual(['tok-1', 'tok-2']);
    expect(h.jobAlert.findMany).toHaveBeenCalledWith({ where: { email: EMAIL }, orderBy: { createdAt: 'desc' } });
  });

  it('an unknown token is still a 404', async () => {
    h.jobAlert.findUnique.mockResolvedValue(null);
    const res = await GET(getReq('bogus-token'));
    expect(res.status).toBe(404);
  });
});

const deleteReq = (token?: string) =>
  new NextRequest(
    token === undefined ? 'http://localhost/api/job-alerts' : `http://localhost/api/job-alerts?token=${encodeURIComponent(token)}`,
    { method: 'DELETE' },
  );

describe('DELETE /api/job-alerts?token=: rate limited with GET', () => {
  it('answers 429 before anything is looked up or deleted when the bucket is spent', async () => {
    h.rateLimit.mockResolvedValue(NextResponse.json({ error: 'Too many requests' }, { status: 429 }));
    const res = await DELETE(deleteReq('some-token'));
    expect(res.status).toBe(429);
    expect(h.jobAlert.findUnique).not.toHaveBeenCalled();
    expect(h.jobAlert.delete).not.toHaveBeenCalled();
  });

  it('spends the same bucket as GET, so switching methods gives no fresh allowance', async () => {
    h.jobAlert.findUnique.mockResolvedValue(null);
    const get = getReq('some-token');
    const del = deleteReq('some-token');
    await GET(get);
    await DELETE(del);
    expect(h.rateLimit).toHaveBeenCalledTimes(2);
    expect(h.rateLimit).toHaveBeenNthCalledWith(1, get, 'job-alerts-token', RATE_LIMITS.general);
    expect(h.rateLimit).toHaveBeenNthCalledWith(2, del, 'job-alerts-token', RATE_LIMITS.general);
  });

  it('also limits a request with no token', async () => {
    h.rateLimit.mockResolvedValue(NextResponse.json({ error: 'Too many requests' }, { status: 429 }));
    const res = await DELETE(deleteReq());
    expect(res.status).toBe(429);
  });

  it('within the limit it still deletes the alert, as the manage and unsubscribe pages expect', async () => {
    h.jobAlert.findUnique.mockResolvedValue({ id: 'alert-1', token: 'tok-1', email: EMAIL });
    h.jobAlert.delete.mockResolvedValue({ id: 'alert-1' });
    const res = await DELETE(deleteReq('tok-1'));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(h.jobAlert.delete).toHaveBeenCalledWith({ where: { token: 'tok-1' } });
  });

  it('an unknown token is still a 404, with nothing deleted', async () => {
    h.jobAlert.findUnique.mockResolvedValue(null);
    const res = await DELETE(deleteReq('bogus-token'));
    expect(res.status).toBe(404);
    expect(h.jobAlert.delete).not.toHaveBeenCalled();
  });
});

const patchReq = (token: string, body: Record<string, unknown> = {}) =>
  new NextRequest(`http://localhost/api/job-alerts/${encodeURIComponent(token)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
const patchAlert = (req: NextRequest, token: string) => PATCH(req, { params: Promise.resolve({ token }) });

describe('PATCH /api/job-alerts/[token]: rate limited with GET and DELETE', () => {
  it('answers 429 before anything is looked up or changed when the bucket is spent', async () => {
    h.rateLimit.mockResolvedValue(NextResponse.json({ error: 'Too many requests' }, { status: 429 }));
    const res = await patchAlert(patchReq('some-token'), 'some-token');
    expect(res.status).toBe(429);
    expect(h.jobAlert.findUnique).not.toHaveBeenCalled();
    expect(h.jobAlert.update).not.toHaveBeenCalled();
  });

  it('spends the same bucket as GET, so switching methods gives no fresh allowance', async () => {
    h.jobAlert.findUnique.mockResolvedValue(null);
    const req = patchReq('some-token');
    await patchAlert(req, 'some-token');
    expect(h.rateLimit).toHaveBeenCalledWith(req, 'job-alerts-token', RATE_LIMITS.general);
  });

  it('within the limit it still updates the alert, as the manage page expects', async () => {
    h.jobAlert.findUnique.mockResolvedValue({ id: 'alert-1', token: 'tok-1' });
    h.jobAlert.update.mockResolvedValue({ id: 'alert-1', token: 'tok-1', frequency: 'weekly', isActive: false });
    const res = await patchAlert(patchReq('tok-1', { isActive: false }), 'tok-1');
    expect(res.status).toBe(200);
    expect(h.jobAlert.update).toHaveBeenCalledWith({ where: { token: 'tok-1' }, data: { isActive: false } });
  });
});
