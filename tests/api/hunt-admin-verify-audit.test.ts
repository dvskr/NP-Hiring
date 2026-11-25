/**
 * POST /api/admin/verify-employers: every confirmation and revocation is
 * audited before the response, naming the admin by id only (no email), the
 * change reaches the listings and the cached job pages at once, and a
 * failure says so instead of passing for a success.
 *
 * All fixtures are fictional.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireApiAdminActor: vi.fn(),
  logAudit: vi.fn(),
  setEmployerVerification: vi.fn(),
  syncPaidPostTwins: vi.fn(),
  revalidateJobPage: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('@/lib/auth/require-api-admin', () => ({ requireApiAdminActor: mocks.requireApiAdminActor }));
vi.mock('@/lib/csrf', () => ({ verifyCsrf: vi.fn(() => null) }));
vi.mock('@/lib/audit-log', () => ({ logAudit: mocks.logAudit }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: mocks.loggerError, debug: vi.fn() } }));
vi.mock('@/lib/job-page-revalidation', () => ({ revalidateJobPage: mocks.revalidateJobPage }));
vi.mock('@/lib/admin/employer-verification', () => ({ setEmployerVerification: mocks.setEmployerVerification }));
vi.mock('@/lib/paid-post-twins-sync', () => ({ syncPaidPostTwins: mocks.syncPaidPostTwins }));

import { POST } from '@/app/api/admin/verify-employers/route';

const ADMIN = { profileId: 'profile-admin-1', supabaseId: 'sb-admin-1' };

function request(body: unknown): NextRequest {
  return new NextRequest('https://example.com/api/admin/verify-employers', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const CONFIRM = { supabaseId: 'sb-emp-1', orgKey: 'acmepsychiatry', verified: true };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireApiAdminActor.mockResolvedValue({ error: null, actor: ADMIN });
  mocks.setEmployerVerification.mockResolvedValue({ ok: true, verifiedEmployerOrgKeys: ['acmepsychiatry'] });
  mocks.syncPaidPostTwins.mockResolvedValue({ shadowed: 2, newlyShadowed: 2, released: 0, changedPostSlugs: ['np-outpatient-post-1'] });
});

describe('POST /api/admin/verify-employers', () => {
  it('audits the change with the admin\'s profile id and no email address', async () => {
    const res = await POST(request(CONFIRM));
    expect(res.status).toBe(200);
    expect(mocks.logAudit).toHaveBeenCalledTimes(1);
    const entry = mocks.logAudit.mock.calls[0][0];
    expect(entry).toMatchObject({
      action: 'admin.employer.verify',
      actorType: 'admin',
      actorId: 'profile-admin-1',
      targetType: 'user_profile',
      targetId: 'sb-emp-1',
      metadata: { orgKey: 'acmepsychiatry' },
    });
    expect(JSON.stringify(entry)).not.toContain('@');
  });

  it('names a revocation as such', async () => {
    await POST(request({ ...CONFIRM, verified: false }));
    expect(mocks.setEmployerVerification).toHaveBeenCalledWith('sb-emp-1', 'acmepsychiatry', false);
    expect(mocks.logAudit.mock.calls[0][0]).toMatchObject({ action: 'admin.employer.unverify' });
  });

  it('applies the change at once and refreshes the job pages whose check changed', async () => {
    const res = await POST(request(CONFIRM));
    expect(await res.json()).toEqual({
      success: true,
      verifiedEmployerOrgKeys: ['acmepsychiatry'],
      twins: { shadowed: 2, newlyShadowed: 2, released: 0 },
      syncFailed: false,
    });
    expect(mocks.syncPaidPostTwins).toHaveBeenCalledTimes(1);
    expect(mocks.revalidateJobPage).toHaveBeenCalledWith('np-outpatient-post-1', expect.any(String));
  });

  it('keeps a saved change when the sync fails, and says the sync failed', async () => {
    mocks.syncPaidPostTwins.mockRejectedValue(new Error('database unavailable'));
    const res = await POST(request(CONFIRM));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, syncFailed: true, twins: null });
    expect(mocks.loggerError).toHaveBeenCalled();
  });

  it('answers 500, writes no audit entry and runs no sync when the change cannot be saved', async () => {
    mocks.setEmployerVerification.mockRejectedValue(new Error('database unavailable'));
    const res = await POST(request(CONFIRM));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: 'Could not save the change. Try again.' });
    expect(mocks.logAudit).not.toHaveBeenCalled();
    expect(mocks.syncPaidPostTwins).not.toHaveBeenCalled();
  });

  it('passes a refusal through with its status and writes no audit entry', async () => {
    mocks.setEmployerVerification.mockResolvedValue({ ok: false, status: 422, error: 'This account has never posted under that employer name' });
    const res = await POST(request(CONFIRM));
    expect(res.status).toBe(422);
    expect(mocks.logAudit).not.toHaveBeenCalled();
  });

  it('rejects a malformed body before touching anything', async () => {
    const res = await POST(request({ supabaseId: 'sb-emp-1', orgKey: 'Not A Key!', verified: 'yes' }));
    expect(res.status).toBe(400);
    expect(mocks.setEmployerVerification).not.toHaveBeenCalled();
  });

  it('refuses a caller who is not an admin', async () => {
    mocks.requireApiAdminActor.mockResolvedValue({
      error: NextResponse.json({ error: 'Admin access required' }, { status: 403 }),
      actor: null,
    });
    const res = await POST(request(CONFIRM));
    expect(res.status).toBe(403);
    expect(mocks.setEmployerVerification).not.toHaveBeenCalled();
  });
});
