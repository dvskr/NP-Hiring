/**
 * GET /auth/callback claims legacy employer jobs only for a session whose
 * email Supabase has confirmed.
 *
 * On every sign-in the callback links each unclaimed EmployerJob (userId null,
 * a guest post from before accounts were linked) whose contactEmail is the
 * session's email to the session's user. That hands those postings, and
 * their applicants, to whichever auth user presents the address, the same
 * trust ensureProfileFromAuth's relink places in it
 * (tests/regressions/ensure-profile-relink-confirmed-email.test.ts).
 * Presenting the address proves ownership only once Supabase has confirmed
 * it, so the claim now needs email_confirmed_at.
 *
 * Every legitimate session carries it (Supabase refuses a password sign-in
 * for an unconfirmed email and stamps it when a confirmation, magic link or
 * verified Google sign-in completes), so a real owner's claim is unchanged.
 * Unclaimed rows a refused session leaves behind stay unclaimed until a
 * confirmed session for the address signs in. Not a substitute for the
 * dashboard setting: with "Confirm email" off, Supabase stamps the field at
 * sign-up.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';

const mocks = vi.hoisted(() => ({ exchangeCodeForSession: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { exchangeCodeForSession: mocks.exchangeCodeForSession } })),
}));
vi.mock('@/lib/beehiiv', () => ({ syncToBeehiiv: vi.fn() }));
vi.mock('@/lib/email-service', () => ({ sendSignupWelcomeEmail: vi.fn(async () => undefined) }));

import { GET as callback } from '@/app/auth/callback/route';

const USER_ID = 'auth-user-1';
const EMAIL = 'guest.poster@clinic.example';
const CONFIRMED_AT = '2026-10-01T12:00:00Z';

/** A returning employer: the profile exists, so only the sign-in steps run. */
async function signIn(confirmation: Record<string, unknown>): Promise<Response> {
  mocks.exchangeCodeForSession.mockResolvedValue({
    data: { user: { id: USER_ID, email: EMAIL, user_metadata: {}, ...confirmation } },
    error: null,
  });
  vi.mocked(prisma.userProfile.findUnique).mockResolvedValue({
    id: 'profile-1', supabaseId: USER_ID, email: EMAIL, role: 'employer', firstName: 'Grace',
  } as never);
  vi.mocked(prisma.emailSend.findFirst).mockResolvedValue({ id: 'already-sent' } as never);
  vi.mocked(prisma.employerJob.updateMany).mockResolvedValue({ count: 2 } as never);
  return callback(new Request('http://localhost:3000/auth/callback?code=valid-code'));
}

beforeEach(() => vi.clearAllMocks());

describe('GET /auth/callback: the legacy employer job claim', () => {
  it('links the unclaimed jobs filed under a confirmed email, as before', async () => {
    const res = await signIn({ email_confirmed_at: CONFIRMED_AT });
    expect(vi.mocked(prisma.employerJob.updateMany)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(prisma.employerJob.updateMany)).toHaveBeenCalledWith({
      where: { contactEmail: EMAIL, userId: null },
      data: { userId: USER_ID },
    });
    expect(res.headers.get('location')).toContain('/employer/dashboard');
  });

  it.each([
    ['no email_confirmed_at at all', {}],
    ['email_confirmed_at null', { email_confirmed_at: null }],
    ['email_confirmed_at empty', { email_confirmed_at: '' }],
  ])('claims nothing for a session with %s, and still signs it in', async (_label, confirmation) => {
    const res = await signIn(confirmation);
    expect(vi.mocked(prisma.employerJob.updateMany)).not.toHaveBeenCalled();
    // The sign-in itself is unchanged: the same redirect, no error page.
    expect(res.headers.get('location')).toContain('/employer/dashboard');
    expect(res.headers.get('location')).not.toContain('error=');
  });
});
