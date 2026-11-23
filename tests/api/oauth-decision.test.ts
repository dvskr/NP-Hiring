/**
 * POST /api/oauth/decision, the consent page's Allow and Cancel.
 *
 * The session cookie is ambient authority, so this route is stricter than
 * the site-wide origin check: JSON only, from this exact host (a first-party
 * subdomain is not enough), and only for the account the page was shown to.
 * It reads the profile without side effects, so a soft-deleted account
 * reaches the consent check still marked deleted instead of being restored
 * by a click on Allow.
 *
 * All fixtures are fictional.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { brand } from '@/config/brand';
import { TOKEN_PREFIX } from '@/lib/mcp/oauth/config';


const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  findUnique: vi.fn(),
  ensureProfileFromAuth: vi.fn(),
  decideAuthorization: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock('@/lib/prisma', () => ({ prisma: { userProfile: { findUnique: mocks.findUnique } } }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(async () => null) }));
vi.mock('@/lib/auth/ensure-profile', () => ({ ensureProfileFromAuth: mocks.ensureProfileFromAuth }));
vi.mock('@/lib/mcp/oauth/consent', () => ({ decideAuthorization: mocks.decideAuthorization }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { POST } from '@/app/api/oauth/decision/route';

const USER = { id: 'user-fic-1', email: 'person@example.test' };
const body = { requestId: `${TOKEN_PREFIX.request}fictional`, decision: 'approve', expectedUserId: USER.id };

function decide(payload: unknown = body, headers: Record<string, string> = {}) {
  return POST(
    new NextRequest(`${brand.baseUrl}/api/oauth/decision`, {
      method: 'POST',
      headers: { origin: brand.baseUrl, host: brand.domain, 'content-type': 'application/json', ...headers },
      body: typeof payload === 'string' ? payload : JSON.stringify(payload),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: USER } });
  mocks.findUnique.mockResolvedValue({ supabaseId: USER.id, role: 'job_seeker', deletedAt: null });
  mocks.decideAuthorization.mockResolvedValue({ kind: 'redirect', location: 'https://claude.ai/api/mcp/auth_callback?code=x' });
});

describe('POST /api/oauth/decision', () => {
  it('approves for the account the page was shown to', async () => {
    const res = await decide();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ redirectTo: 'https://claude.ai/api/mcp/auth_callback?code=x' });
    expect(mocks.decideAuthorization).toHaveBeenCalledWith({
      requestId: body.requestId,
      approve: true,
      user: { supabaseId: USER.id, role: 'job_seeker', deletedAt: null },
    });
  });

  it('accepts only JSON, which a cross-site form or a plain-text fetch cannot send', async () => {
    const res = await decide(JSON.stringify(body), { 'content-type': 'text/plain' });
    expect(res.status).toBe(403);
    expect(mocks.decideAuthorization).not.toHaveBeenCalled();
  });

  it('accepts only this exact host, not every first-party one', async () => {
    const res = await decide(body, { origin: `https://dev.${brand.domain}` });
    expect(res.status).toBe(403);
    expect(mocks.decideAuthorization).not.toHaveBeenCalled();
  });

  it('refuses when the session now belongs to a different account', async () => {
    const res = await decide({ ...body, expectedUserId: 'user-fic-2' });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('account_changed');
    expect(mocks.decideAuthorization).not.toHaveBeenCalled();
  });

  it('reads an existing profile as it is, so a deleted account is refused rather than restored', async () => {
    const deletedAt = new Date('2026-10-20T00:00:00Z');
    mocks.findUnique.mockResolvedValue({ supabaseId: USER.id, role: 'job_seeker', deletedAt });
    await decide();
    expect(mocks.ensureProfileFromAuth).not.toHaveBeenCalled();
    expect(mocks.decideAuthorization.mock.calls[0][0].user.deletedAt).toEqual(deletedAt);
  });

  it('creates a profile only for an account made in the middle of the flow', async () => {
    mocks.findUnique.mockResolvedValue(null);
    mocks.ensureProfileFromAuth.mockResolvedValue({ id: 'p1', supabaseId: USER.id, email: USER.email, role: 'employer', deletedAt: null });
    await decide();
    expect(mocks.ensureProfileFromAuth).toHaveBeenCalledTimes(1);
    expect(mocks.decideAuthorization.mock.calls[0][0].user).toEqual({ supabaseId: USER.id, role: 'employer', deletedAt: null });
  });
});
