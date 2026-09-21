/**
 * P10 job-alerts regressions (E2E-verified defects):
 *
 *   1. POST /api/job-alerts opted every signup into the newsletter (absent
 *      flag read as true) and synced it to Beehiiv on every submit.
 *   2. POST /api/job-alerts answered 500 for {} (sanitizeEmail(undefined)
 *      threw) and for malformed JSON.
 *   3. A signup from a previously unsubscribed address left suppression set,
 *      so the digest cron could never send the new alert.
 *   4. PATCH /api/job-alerts/[token] answered 500 for a non-boolean isActive
 *      and for malformed JSON.
 *   5. GET /api/job-alerts/by-email dropped the experience criteria.
 *   6. The /job-alerts success banner told single-opt-in subscribers to
 *      confirm by email.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  emailLead: { upsert: vi.fn(), update: vi.fn() },
  userProfile: { updateMany: vi.fn() },
  jobAlert: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  $transaction: vi.fn(),
  $executeRaw: vi.fn(),
  syncToBeehiiv: vi.fn(),
  sendWelcomeEmail: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    emailLead: h.emailLead,
    userProfile: h.userProfile,
    jobAlert: h.jobAlert,
    $transaction: h.$transaction,
  },
}));
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: vi.fn().mockResolvedValue(null),
  RATE_LIMITS: { jobAlerts: { limit: 10, windowSeconds: 60 } },
}));
vi.mock('@/lib/beehiiv', () => ({ syncToBeehiiv: h.syncToBeehiiv }));
vi.mock('@/lib/email-service', () => ({ sendWelcomeEmail: h.sendWelcomeEmail }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({ auth: { getUser: h.getUser } }),
}));

import { POST } from '@/app/api/job-alerts/route';
import { PATCH } from '@/app/api/job-alerts/[token]/route';
import { GET as GET_BY_EMAIL } from '@/app/api/job-alerts/by-email/route';
import { sanitizeEmail, sanitizeJobAlert } from '@/lib/sanitize';

const EMAIL = 'seeker@example.com';

function postReq(body: string): NextRequest {
  return new NextRequest('http://localhost/api/job-alerts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
}
function patchReq(body: string): NextRequest {
  return new NextRequest('http://localhost/api/job-alerts/tok', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
}
const params = { params: Promise.resolve({ token: 'tok' }) };

beforeEach(() => {
  vi.clearAllMocks();
  h.emailLead.upsert.mockResolvedValue({ isSuppressed: false, suppressionReason: null });
  h.emailLead.update.mockReturnValue('lead-update-op');
  h.userProfile.updateMany.mockReturnValue('profile-update-op');
  h.$executeRaw.mockResolvedValue(1);
  // Array form = the suppression-lift batch; callback form = the locked
  // find-or-create, which runs against the same mocked delegates.
  h.$transaction.mockImplementation((arg: unknown) =>
    typeof arg === 'function'
      ? (arg as (tx: unknown) => Promise<unknown>)({ jobAlert: h.jobAlert, $executeRaw: h.$executeRaw })
      : Promise.resolve([]));
  h.jobAlert.findFirst.mockResolvedValue(null);
  h.jobAlert.create.mockResolvedValue({ id: 'a1', token: 't1' });
  h.jobAlert.findUnique.mockResolvedValue({ id: 'a1', token: 'tok', isActive: true });
  h.jobAlert.update.mockResolvedValue({ id: 'a1', token: 'tok', frequency: 'daily', isActive: false });
});

describe('sanitizeEmail / sanitizeJobAlert tolerate untrusted JSON shapes', () => {
  it('sanitizeEmail returns an empty string for non-strings instead of throwing', () => {
    for (const v of [undefined, null, 42, {}, []]) {
      expect(sanitizeEmail(v)).toBe('');
    }
    expect(sanitizeEmail(' A@B.CO ')).toBe('a@b.co');
  });

  it('sanitizeJobAlert drops non-string text fields and stringifies a bad frequency', () => {
    const out = sanitizeJobAlert({ email: undefined, name: 5, keyword: { x: 1 }, frequency: 7 });
    expect(out.email).toBe('');
    expect(out.name).toBeUndefined();
    expect(out.keyword).toBeUndefined();
    expect(out.frequency).toBe('7');
  });
});

describe('POST /api/job-alerts input validation (defect 2)', () => {
  it('400 "Invalid email address" for a body without an email', async () => {
    const res = await POST(postReq('{}'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid email address');
    expect(h.emailLead.upsert).not.toHaveBeenCalled();
  });

  it('400 for malformed JSON and for a non-object body', async () => {
    expect((await POST(postReq('{not json'))).status).toBe(400);
    expect((await POST(postReq('null'))).status).toBe(400);
    expect((await POST(postReq('[1]'))).status).toBe(400);
  });

  it('400 for a non-string frequency', async () => {
    const res = await POST(postReq(JSON.stringify({ email: EMAIL, frequency: 5 })));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/job-alerts newsletter consent (defect 1)', () => {
  it('no newsletterOptIn field: lead created opted OUT, existing lead untouched, no Beehiiv sync', async () => {
    const res = await POST(postReq(JSON.stringify({ email: EMAIL, keyword: 'Consent probe' })));
    expect(res.status).toBe(200);
    const arg = h.emailLead.upsert.mock.calls[0][0];
    expect(arg.create.newsletterOptIn).toBe(false);
    expect(arg.update).toEqual({});
    expect(h.syncToBeehiiv).not.toHaveBeenCalled();
  });

  it('truthy non-boolean values are not consent', async () => {
    for (const v of ['true', 1, 'yes']) {
      h.emailLead.upsert.mockClear();
      await POST(postReq(JSON.stringify({ email: EMAIL, newsletterOptIn: v })));
      expect(h.emailLead.upsert.mock.calls[0][0].create.newsletterOptIn).toBe(false);
    }
    expect(h.syncToBeehiiv).not.toHaveBeenCalled();
  });

  it('explicit newsletterOptIn: true opts in and syncs', async () => {
    await POST(postReq(JSON.stringify({ email: EMAIL, newsletterOptIn: true })));
    const arg = h.emailLead.upsert.mock.calls[0][0];
    expect(arg.create.newsletterOptIn).toBe(true);
    expect(arg.update).toEqual({ newsletterOptIn: true });
    expect(h.syncToBeehiiv).toHaveBeenCalledWith(EMAIL, { utmSource: 'job_alert' });
  });
});

describe('POST /api/job-alerts lifts unsubscribe suppression only (defect 3)', () => {
  it('an unsubscribe-suppressed lead is un-suppressed on the lead and the profile', async () => {
    h.emailLead.upsert.mockResolvedValue({ isSuppressed: true, suppressionReason: 'unsubscribe' });
    const res = await POST(postReq(JSON.stringify({ email: EMAIL, keyword: 'Suppressed probe' })));
    expect(res.status).toBe(200);
    expect(h.emailLead.update).toHaveBeenCalledWith({
      where: { email: EMAIL },
      data: { isSubscribed: true, isSuppressed: false, suppressedAt: null, suppressionReason: null },
    });
    expect(h.userProfile.updateMany).toHaveBeenCalledWith({
      where: { email: { equals: EMAIL, mode: 'insensitive' } },
      data: { emailSuppressed: false, emailSuppressedAt: null },
    });
    const batchCalls = h.$transaction.mock.calls
      .map((c, i) => ({ arg: c[0], order: h.$transaction.mock.invocationCallOrder[i] }))
      .filter((c) => Array.isArray(c.arg));
    expect(batchCalls).toHaveLength(1);
    // Suppression is lifted before the welcome email is attempted.
    expect(batchCalls[0].order).toBeLessThan(
      h.sendWelcomeEmail.mock.invocationCallOrder[0]
    );
  });

  it.each(['bounce', 'complaint', null])('suppression reason %s is never lifted', async (reason) => {
    h.emailLead.upsert.mockResolvedValue({ isSuppressed: true, suppressionReason: reason });
    await POST(postReq(JSON.stringify({ email: EMAIL })));
    expect(h.$transaction.mock.calls.filter((c) => Array.isArray(c[0]))).toHaveLength(0);
    expect(h.emailLead.update).not.toHaveBeenCalled();
    expect(h.userProfile.updateMany).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/job-alerts/[token] validation (defect 4)', () => {
  it.each([['yes'], [1], [{ on: true }], [null]])('400 for isActive=%j with no DB write', async (isActive) => {
    const res = await PATCH(patchReq(JSON.stringify({ isActive })), params);
    expect(res.status).toBe(400);
    expect(h.jobAlert.update).not.toHaveBeenCalled();
  });

  it('400 for a non-string frequency, malformed JSON, and a non-object body', async () => {
    expect((await PATCH(patchReq(JSON.stringify({ frequency: 5 })), params)).status).toBe(400);
    expect((await PATCH(patchReq('{not json'), params)).status).toBe(400);
    expect((await PATCH(patchReq('"x"'), params)).status).toBe(400);
    expect(h.jobAlert.update).not.toHaveBeenCalled();
  });

  it('a valid boolean isActive still updates', async () => {
    const res = await PATCH(patchReq(JSON.stringify({ isActive: false })), params);
    expect(res.status).toBe(200);
    expect(h.jobAlert.update).toHaveBeenCalledWith({ where: { token: 'tok' }, data: { isActive: false } });
  });
});

describe('GET /api/job-alerts/by-email returns experience criteria (defect 5)', () => {
  it('includes newGradFriendly and minYearsExperience', async () => {
    h.getUser.mockResolvedValue({ data: { user: { email: EMAIL } } });
    h.jobAlert.findMany.mockResolvedValue([
      { id: 'a1', token: 't', email: EMAIL, frequency: 'weekly', isActive: true, newGradFriendly: true, minYearsExperience: 2, createdAt: new Date() },
    ]);
    const res = await GET_BY_EMAIL(new NextRequest(`http://localhost/api/job-alerts/by-email?email=${EMAIL}`));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.alerts[0]).toMatchObject({ newGradFriendly: true, minYearsExperience: 2 });
  });
});

describe('/job-alerts success copy (defect 6)', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'app/job-alerts/page.tsx'), 'utf8');
  it('does not ask a single-opt-in subscriber to confirm', () => {
    const line = src.split('\n').find((l) => l.includes("'Job alert created!"));
    expect(line).toBeDefined();
    expect(line).not.toMatch(/confirm/i);
    expect(line).not.toMatch(/[–—]/);
  });
});
