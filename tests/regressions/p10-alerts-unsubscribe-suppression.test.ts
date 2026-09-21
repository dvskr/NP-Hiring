/**
 * P10 alerts-unsubscribe regressions.
 *
 * 1. One-click unsubscribe (RFC 8058) must record reason 'unsubscribe' and
 *    suppressedAt and mirror suppression onto the profile, exactly like the
 *    human GET unsubscribe, so resubscribe can lift it.
 * 2. Resubscribe (and the /unsubscribe page, which now calls it) lifts that
 *    suppression but never a bounce/complaint, and never un-suppresses a
 *    soft-deleted profile. Unsubscribing never relabels a bounce as an opt-out.
 * 3. /api/email/preferences only stores a flat object of known boolean keys.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
import { parsePreferences, buildUnsubscribeLeadData } from '@/app/api/email/_lib/subscription';

const TOKEN = 'tok-p10';
const EMAIL = 'seeker@example.com';

function jsonPost(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function oneClick(): Request {
  return new Request(`https://nphiring.com/api/one-click-unsubscribe?token=${TOKEN}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'List-Unsubscribe=One-Click',
  });
}

type Data = Record<string, unknown>;
const leadUpdateData = (i = 0) => (vi.mocked(prisma.emailLead.update).mock.calls[i][0] as { data: Data }).data;
const profileCall = (i = 0) => vi.mocked(prisma.userProfile.updateMany).mock.calls[i][0] as { where: Data; data: Data };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.emailLead.update).mockResolvedValue({ email: EMAIL, isSubscribed: true, newsletterOptIn: false, preferences: {} } as never);
  vi.mocked(prisma.userProfile.updateMany).mockResolvedValue({ count: 1 } as never);
});

describe('defect 1: one-click unsubscribe records reason and mirrors onto the profile', () => {
  it('sets reason unsubscribe, suppressedAt, and profile emailSuppressed', async () => {
    vi.mocked(prisma.emailLead.findUnique).mockResolvedValue({ email: EMAIL, isSuppressed: false, suppressionReason: null } as never);
    const { POST } = await import('@/app/api/one-click-unsubscribe/route');
    const res = await POST(oneClick() as never);

    expect(res.status).toBe(200);
    const data = leadUpdateData();
    expect(data).toMatchObject({ isSubscribed: false, newsletterOptIn: false, isSuppressed: true, suppressionReason: 'unsubscribe' });
    expect(data.suppressedAt).toBeInstanceOf(Date);
    expect(profileCall()).toMatchObject({ where: { email: EMAIL }, data: { emailSuppressed: true } });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('keeps a bounce reason intact when a bounced address clicks unsubscribe', () => {
    const data = buildUnsubscribeLeadData({ email: EMAIL, isSuppressed: true, suppressionReason: 'bounce' }, new Date());
    expect(data).toEqual({ isSubscribed: false, newsletterOptIn: false, isSuppressed: true });
  });

  it('one-click then resubscribe restores deliverability end to end', async () => {
    vi.mocked(prisma.emailLead.findUnique).mockResolvedValueOnce({ email: EMAIL, isSuppressed: false, suppressionReason: null } as never);
    const { POST: oneClickPost } = await import('@/app/api/one-click-unsubscribe/route');
    await oneClickPost(oneClick() as never);
    const written = leadUpdateData(0);

    vi.mocked(prisma.emailLead.findUnique).mockResolvedValueOnce({
      email: EMAIL, isSuppressed: written.isSuppressed, suppressionReason: written.suppressionReason,
    } as never);
    const { POST: resubscribe } = await import('@/app/api/email/unsubscribe/route');
    const res = await resubscribe(jsonPost('https://nphiring.com/api/email/unsubscribe', { token: TOKEN }) as never);

    expect(res.status).toBe(200);
    expect(leadUpdateData(1)).toMatchObject({ isSubscribed: true, isSuppressed: false, suppressionReason: null });
    expect(profileCall(1).data).toMatchObject({ emailSuppressed: false });
  });
});

describe('defect 2: resubscribe lifts only opt-out suppression', () => {
  it('lifts a legacy one-click suppression that has no recorded reason', async () => {
    vi.mocked(prisma.emailLead.findUnique).mockResolvedValue({ email: EMAIL, isSuppressed: true, suppressionReason: null } as never);
    const { POST } = await import('@/app/api/email/unsubscribe/route');
    await POST(jsonPost('https://nphiring.com/api/email/unsubscribe', { token: TOKEN }) as never);
    expect(leadUpdateData()).toMatchObject({ isSubscribed: true, isSuppressed: false });
  });

  it('never lifts complaint suppression and reports failure instead of Welcome back', async () => {
    vi.mocked(prisma.emailLead.findUnique).mockResolvedValue({ email: EMAIL, isSuppressed: true, suppressionReason: 'complaint' } as never);
    const { POST } = await import('@/app/api/email/unsubscribe/route');
    const res = await POST(jsonPost('https://nphiring.com/api/email/unsubscribe', { token: TOKEN }) as never);
    expect(res.status).toBe(409);
    expect((await res.json()).success).toBe(false);
    expect(prisma.emailLead.update).not.toHaveBeenCalled();
    expect(prisma.userProfile.updateMany).not.toHaveBeenCalled();
  });

  it('preferences isSubscribed:true on a bounced address returns 409 and writes nothing', async () => {
    vi.mocked(prisma.emailLead.findUnique).mockResolvedValue({ email: EMAIL, isSuppressed: true, suppressionReason: 'bounce' } as never);
    const { POST } = await import('@/app/api/email/preferences/route');
    const res = await POST(jsonPost('https://nphiring.com/api/email/preferences', { token: TOKEN, isSubscribed: true, newsletterOptIn: true }) as never);
    expect(res.status).toBe(409);
    expect(prisma.emailLead.update).not.toHaveBeenCalled();
  });

  it('never un-suppresses a soft-deleted profile', async () => {
    vi.mocked(prisma.emailLead.findUnique).mockResolvedValue({ email: EMAIL, isSuppressed: true, suppressionReason: 'unsubscribe' } as never);
    const { POST } = await import('@/app/api/email/unsubscribe/route');
    await POST(jsonPost('https://nphiring.com/api/email/unsubscribe', { token: TOKEN }) as never);
    expect(profileCall().where).toEqual({ email: EMAIL, deletedAt: null });
  });

  it('returns 400 (not 500) for a malformed JSON body', async () => {
    const { POST } = await import('@/app/api/email/unsubscribe/route');
    const res = await POST(jsonPost('https://nphiring.com/api/email/unsubscribe', '{not json') as never);
    expect(res.status).toBe(400);
  });

  it('preferences isSubscribed:true takes the same suppression-lifting path', async () => {
    vi.mocked(prisma.emailLead.findUnique).mockResolvedValue({ email: EMAIL, isSuppressed: true, suppressionReason: 'unsubscribe' } as never);
    const { POST } = await import('@/app/api/email/preferences/route');
    const res = await POST(jsonPost('https://nphiring.com/api/email/preferences', { token: TOKEN, isSubscribed: true }) as never);
    expect(res.status).toBe(200);
    expect(leadUpdateData(0)).toMatchObject({ isSubscribed: true, isSuppressed: false, suppressionReason: null });
    expect(profileCall().data).toMatchObject({ emailSuppressed: false });
  });

  it('the /unsubscribe page resubscribes through POST /api/email/unsubscribe and reads data.message', () => {
    const src = readFileSync(resolve(__dirname, '../../app/unsubscribe/page.tsx'), 'utf8');
    const handler = src.slice(src.indexOf('handleResubscribe'), src.indexOf('return ('));
    expect(handler).toContain("fetch('/api/email/unsubscribe'");
    expect(handler).not.toContain('/api/email/preferences');
    expect(src).not.toContain('data.error');
  });
});

describe('defect 3: preferences payload validation', () => {
  it.each([
    ['a string', 'garbage'],
    ['a number', 42],
    ['an array', ['a', 'b']],
    ['a nested object', { nested: { deep: { blob: 'x'.repeat(5000) } } }],
    ['an unknown key', { marketing: false }],
    ['a non-boolean value', { profileNudge: 'no' }],
  ])('rejects %s with 400 and writes nothing', async (_label, preferences) => {
    vi.mocked(prisma.emailLead.findUnique).mockResolvedValue({ email: EMAIL, isSuppressed: false, suppressionReason: null } as never);
    const { POST } = await import('@/app/api/email/preferences/route');
    const res = await POST(jsonPost('https://nphiring.com/api/email/preferences', { token: TOKEN, preferences }) as never);
    expect(res.status).toBe(400);
    expect(prisma.emailLead.update).not.toHaveBeenCalled();
  });

  it('stores a valid flat boolean object', async () => {
    vi.mocked(prisma.emailLead.findUnique).mockResolvedValue({ email: EMAIL, isSuppressed: false, suppressionReason: null } as never);
    const { POST } = await import('@/app/api/email/preferences/route');
    const preferences = { profileNudge: false, savedJobReminder: true };
    const res = await POST(jsonPost('https://nphiring.com/api/email/preferences', { token: TOKEN, preferences }) as never);
    expect(res.status).toBe(200);
    expect(leadUpdateData()).toEqual({ preferences });
  });

  it('parsePreferences accepts an empty object and rejects class instances', () => {
    expect(parsePreferences({})).toEqual({});
    expect(parsePreferences(new Date())).toBeNull();
    expect(parsePreferences(null)).toBeNull();
  });
});
