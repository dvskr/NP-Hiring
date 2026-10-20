/**
 * ensureProfileFromAuth relinks a profile only to a session whose email
 * Supabase has confirmed.
 *
 * When no profile is linked to the auth user, findOrRelinkProfile looks for
 * one under the session's email and moves it onto the auth user (the case it
 * was written for: an auth user deleted and created again). That hands an
 * existing profile, whatever its role, admin included, to whichever auth
 * user presents the address. Presenting it proves ownership only once
 * Supabase has confirmed the address, which /api/auth/welcome and the
 * newsletter routes already require (user.email_confirmed_at).
 *
 * Every legitimate session carries email_confirmed_at: Supabase refuses a
 * password sign-in for an unconfirmed email, stamps the confirmation when a
 * sign-up, magic link or recovery link is verified, and stamps it at a Google
 * sign-in whose email Google reports verified (any other Google sign-in is
 * refused unless the project allows unverified email sign-ins). A session
 * without it is one Supabase let in on an address nobody proved, so it gets
 * no one else's profile, and no new row that would collide with it.
 *
 * Not a substitute for the dashboard setting: with "Confirm email" off,
 * Supabase stamps email_confirmed_at at sign-up, before anyone proves the
 * address, so the check passes for every sign-up then.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { User } from '@supabase/supabase-js';
import type { PrismaClient } from '@prisma/client';

vi.mock('@/lib/beehiiv', () => ({ syncToBeehiiv: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { ensureProfileFromAuth } from '@/lib/auth/ensure-profile';
import { logger } from '@/lib/logger';

const EMAIL = 'owner@clinic.example';
const CONFIRMED_AT = '2026-10-01T12:00:00Z';

/** The profile already filed under the address, linked to a different auth user. */
const OTHER_ACCOUNTS_PROFILE = {
  id: 'profile-admin',
  supabaseId: 'auth-user-original',
  email: EMAIL,
  role: 'admin',
};

const sessionUser = (emailConfirmedAt: string | null | undefined): User =>
  ({
    id: 'auth-user-new',
    email: EMAIL,
    ...(emailConfirmedAt === undefined ? {} : { email_confirmed_at: emailConfirmedAt }),
    user_metadata: {},
  } as unknown as User);

function makePrisma() {
  const fake = {
    userProfile: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'profile-new', ...data })),
      update: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...OTHER_ACCOUNTS_PROFILE, ...data })),
    },
    emailLead: { upsert: vi.fn().mockResolvedValue({}) },
    jobAlert: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'alert-1' }) },
    employerLead: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'lead-1' }) },
  };
  return { fake, client: fake as unknown as PrismaClient };
}

beforeEach(() => vi.clearAllMocks());

describe('ensureProfileFromAuth: the relink needs a confirmed email', () => {
  it.each([
    ['no email_confirmed_at at all', undefined],
    ['email_confirmed_at null', null],
    ['email_confirmed_at empty', ''],
  ])('refuses another account\'s profile to a session with %s', async (_label, confirmedAt) => {
    const { fake, client } = makePrisma();
    fake.userProfile.findFirst.mockResolvedValue(OTHER_ACCOUNTS_PROFILE);

    const profile = await ensureProfileFromAuth(client, sessionUser(confirmedAt));

    expect(profile).toBeNull();
    expect(fake.userProfile.update).not.toHaveBeenCalled();
    // Nor a second row under the same address (it would only collide).
    expect(fake.userProfile.create).not.toHaveBeenCalled();
    expect(fake.employerLead.create).not.toHaveBeenCalled();
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining('[ensureProfileFromAuth]'),
      expect.objectContaining({ profileId: OTHER_ACCOUNTS_PROFILE.id }),
    );
  });

  it('still relinks for a confirmed session (an auth user deleted and created again)', async () => {
    const { fake, client } = makePrisma();
    fake.userProfile.findFirst.mockResolvedValue(OTHER_ACCOUNTS_PROFILE);

    const profile = await ensureProfileFromAuth(client, sessionUser(CONFIRMED_AT));

    expect(fake.userProfile.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: OTHER_ACCOUNTS_PROFILE.id },
      data: { supabaseId: 'auth-user-new' },
    }));
    expect(profile).toMatchObject({ id: OTHER_ACCOUNTS_PROFILE.id, supabaseId: 'auth-user-new' });
    expect(fake.userProfile.create).not.toHaveBeenCalled();
  });

  it('returns the session\'s own profile whatever its confirmation state (no email involved)', async () => {
    const { fake, client } = makePrisma();
    const own = { id: 'profile-own', supabaseId: 'auth-user-new', email: EMAIL, role: 'job_seeker' };
    fake.userProfile.findUnique.mockResolvedValue(own);

    expect(await ensureProfileFromAuth(client, sessionUser(undefined))).toBe(own);
    expect(fake.userProfile.findFirst).not.toHaveBeenCalled();
    expect(fake.userProfile.update).not.toHaveBeenCalled();
  });

  it('still creates a first profile when nothing is filed under the address', async () => {
    // Nobody else's row is involved, so this is unchanged.
    const { fake, client } = makePrisma();
    const profile = await ensureProfileFromAuth(client, sessionUser(undefined));
    expect(fake.userProfile.create).toHaveBeenCalledTimes(1);
    expect(profile).toMatchObject({ id: 'profile-new', supabaseId: 'auth-user-new', email: EMAIL });
  });

  it('a create that loses the race to another account\'s row is refused, not handed that row', async () => {
    // Nothing under the address at the first look; by the re-read after the
    // unique-constraint failure, another account's profile holds it.
    const { fake, client } = makePrisma();
    fake.userProfile.findFirst.mockResolvedValueOnce(null).mockResolvedValue(OTHER_ACCOUNTS_PROFILE);
    const conflict = Object.assign(new Error('Unique constraint failed on the fields: (`email`)'), { code: 'P2002' });
    fake.userProfile.create.mockRejectedValue(conflict);

    await expect(ensureProfileFromAuth(client, sessionUser(undefined))).rejects.toBe(conflict);
    expect(fake.userProfile.update).not.toHaveBeenCalled();
  });

  it('a confirmed session that loses the same race still gets the relinked row', async () => {
    const { fake, client } = makePrisma();
    fake.userProfile.findFirst.mockResolvedValueOnce(null).mockResolvedValue(OTHER_ACCOUNTS_PROFILE);
    fake.userProfile.create.mockRejectedValue(Object.assign(new Error('conflict'), { code: 'P2002' }));

    const profile = await ensureProfileFromAuth(client, sessionUser(CONFIRMED_AT));
    expect(profile).toMatchObject({ id: OTHER_ACCOUNTS_PROFILE.id, supabaseId: 'auth-user-new' });
  });
});
