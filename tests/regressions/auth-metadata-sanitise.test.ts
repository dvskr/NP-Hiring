/**
 * Profile fields copied from Supabase auth metadata are sanitised and bounded.
 *
 * user_metadata is written by the account holder: the public auth API stores
 * any `options.data` sent at sign-up. Both paths that create a UserProfile
 * from it stored the names and company as sent, with no length limit and no
 * type check, and GET /auth/callback also stored the company of a job seeker
 * and any avatar_url string at all. POST /api/auth/profile, the third
 * creation path, already cleans its body with sanitizeText (first and last
 * name 50, company 100).
 *
 * Pinned, on the row each path writes:
 *   - GET /auth/callback and ensureProfileFromAuth (via readSignupMetadata)
 *     clean and bound first_name, last_name and company the way the profile
 *     POST does, and drop a value that is not a string;
 *   - the company is kept for an employer only, as readSignupMetadata does;
 *   - the callback still splits a Google full_name, each part cleaned the
 *     same way, and a full_name that is not a string no longer throws the
 *     whole profile write away;
 *   - avatar_url is kept only from an account that signed in with Google
 *     (app_metadata, which only Supabase writes), and only as a picture URL
 *     on lh3.googleusercontent.com, the one host the image policy (CSP
 *     img-src, next.config.ts remotePatterns) loads: https, no credentials,
 *     no port, nothing that ends a CSS url(), at most 500 characters. It is
 *     rendered to other users as an image source and a CSS background, so
 *     any other host would see every viewer's address and read time;
 *   - the callback's welcome email falls back to the cleaned name, never to
 *     the raw metadata. sanitizeText is not an HTML escape; the email
 *     escapes the name itself (tests/lib/signup-welcome-email-escaping.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { User } from '@supabase/supabase-js';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { sendSignupWelcomeEmail } from '@/lib/email-service';

const mocks = vi.hoisted(() => ({ exchangeCodeForSession: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { exchangeCodeForSession: mocks.exchangeCodeForSession } })),
}));
vi.mock('@/lib/beehiiv', () => ({ syncToBeehiiv: vi.fn() }));
vi.mock('@/lib/email-service', () => ({ sendSignupWelcomeEmail: vi.fn(async () => undefined) }));
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { GET as callback } from '@/app/auth/callback/route';
import { readSignupMetadata, ensureProfileFromAuth } from '@/lib/auth/ensure-profile';

// Methods the callback calls that the global prisma fake does not carry.
const extra = {
  emailLeadUpsert: vi.fn(async () => ({})),
  employerLeadFindFirst: vi.fn(async () => null),
  jobAlertFindFirst: vi.fn(async () => null),
};
Object.assign(prisma.emailLead, { upsert: extra.emailLeadUpsert });
Object.assign(prisma.employerLead, { findFirst: extra.employerLeadFindFirst });
Object.assign(prisma.jobAlert, { findFirst: extra.jobAlertFindFirst });

const USER_ID = 'auth-user-1';
const EMAIL = 'new.account@clinic.example';
const SCRIPT = '<script>alert(1)</script>';
const GOOGLE_AVATAR = 'https://lh3.googleusercontent.com/a/ACg8ocK1example=s96-c';
/** app_metadata of an account made by a Google sign-in. Only Supabase writes app_metadata. */
const GOOGLE_SIGN_IN = { provider: 'google', providers: ['google'] };

function signInWith(metadata: Record<string, unknown>, appMetadata: Record<string, unknown> = {}): void {
  mocks.exchangeCodeForSession.mockResolvedValue({
    data: {
      user: {
        id: USER_ID,
        email: EMAIL,
        email_confirmed_at: '2026-10-01T00:00:00Z',
        app_metadata: appMetadata,
        user_metadata: metadata,
      },
    },
    error: null,
  });
}

/** Run the callback for a first sign-in; returns the profile row it wrote. */
async function firstSignIn(
  metadata: Record<string, unknown>,
  appMetadata: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  signInWith(metadata, appMetadata);
  let written: Record<string, unknown> | null = null;
  vi.mocked(prisma.userProfile.findUnique).mockImplementation((async () => written) as never);
  vi.mocked(prisma.userProfile.create).mockImplementation((async (args: { data: Record<string, unknown> }) => {
    written = { id: 'profile-1', ...args.data };
    return written;
  }) as never);
  vi.mocked(prisma.emailSend.findFirst).mockResolvedValue({ id: 'already-sent' } as never);
  vi.mocked(prisma.employerJob.updateMany).mockResolvedValue({ count: 0 } as never);

  await callback(new Request('http://localhost:3000/auth/callback?code=valid-code'));
  expect(vi.mocked(prisma.userProfile.create), 'one profile row written').toHaveBeenCalledTimes(1);
  const [{ data }] = vi.mocked(prisma.userProfile.create).mock.calls[0] as unknown as [{ data: Record<string, unknown> }];
  return data;
}

const authUser = (metadata: Record<string, unknown>): User =>
  ({ id: USER_ID, email: EMAIL, email_confirmed_at: '2026-10-01T00:00:00Z', user_metadata: metadata } as unknown as User);

/** A prisma fake for ensureProfileFromAuth, which takes prisma as an argument. */
function makePrisma() {
  const fake = {
    userProfile: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'profile-1', ...data })),
      update: vi.fn(),
    },
    emailLead: { upsert: vi.fn().mockResolvedValue({}) },
    jobAlert: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'alert-1' }) },
    employerLead: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'lead-1' }) },
  };
  return { fake, client: fake as unknown as PrismaClient };
}

beforeEach(() => {
  vi.clearAllMocks();
  extra.employerLeadFindFirst.mockResolvedValue(null);
  extra.jobAlertFindFirst.mockResolvedValue(null);
});

describe('GET /auth/callback: names from sign-up metadata', () => {
  it('cleans and bounds first_name and last_name like POST /api/auth/profile', async () => {
    const created = await firstSignIn({ first_name: `${SCRIPT}Mallory`, last_name: 'x'.repeat(200) });
    expect(created.firstName).toBe('Mallory');
    expect(created.lastName).toBe('x'.repeat(50));
  });

  it('drops a name that is not a string, and still writes the profile', async () => {
    const created = await firstSignIn({ first_name: { $gt: '' }, last_name: 42 });
    expect(created.firstName).toBeNull();
    expect(created.lastName).toBeNull();
  });

  it('still splits a Google full_name, each part cleaned and bounded', async () => {
    expect(await firstSignIn({ full_name: 'Ada Lovelace' })).toMatchObject({ firstName: 'Ada', lastName: 'Lovelace' });
    vi.clearAllMocks();
    expect(await firstSignIn({ full_name: 'Mary Ann Smith' })).toMatchObject({ firstName: 'Mary', lastName: 'Ann Smith' });
    vi.clearAllMocks();
    const long = await firstSignIn({ full_name: `Ada ${'B'.repeat(80)}` });
    expect(long.firstName).toBe('Ada');
    expect(long.lastName).toBe('B'.repeat(50));
  });

  it('a full_name that is not a string no longer throws the profile write away', async () => {
    const created = await firstSignIn({ full_name: 42 });
    expect(created.firstName).toBeNull();
    expect(created.lastName).toBeNull();
  });

  it('the welcome email falls back to the cleaned name, never the raw metadata', async () => {
    // The profile write fails (a duplicate email, say), so the second welcome
    // step finds no profile and reads the name from sign-up metadata.
    signInWith({ first_name: `${SCRIPT}Mallory` });
    vi.mocked(prisma.userProfile.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.userProfile.create).mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
    vi.mocked(prisma.emailSend.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.employerJob.updateMany).mockResolvedValue({ count: 0 } as never);

    await callback(new Request('http://localhost:3000/auth/callback?code=valid-code'));

    expect(vi.mocked(sendSignupWelcomeEmail)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendSignupWelcomeEmail)).toHaveBeenCalledWith(EMAIL, 'Mallory', 'job_seeker');
  });
});

describe('GET /auth/callback: company from sign-up metadata', () => {
  it('is never stored for a job seeker', async () => {
    const created = await firstSignIn({ role: 'job_seeker', company: 'Acme Clinic' });
    expect(created.company).toBeNull();
  });

  it('is cleaned and bounded to 100 for an employer, on the profile and the lead', async () => {
    const created = await firstSignIn({ role: 'employer', company: `${SCRIPT}${'C'.repeat(150)}`, first_name: 'Grace' });
    expect(created.company).toBe('C'.repeat(100));
    const [{ data: lead }] = vi.mocked(prisma.employerLead.create).mock.calls[0] as unknown as [{ data: Record<string, unknown> }];
    expect(lead.companyName).toBe('C'.repeat(100));
    expect(lead.contactName).toBe('Grace');
  });
});

describe('GET /auth/callback: avatar_url from sign-in metadata', () => {
  it('keeps the Google picture of a Google sign-in', async () => {
    const created = await firstSignIn({ full_name: 'Ada Lovelace', avatar_url: GOOGLE_AVATAR }, GOOGLE_SIGN_IN);
    expect(created.avatarUrl).toBe(GOOGLE_AVATAR);
  });

  it('keeps it for an account that linked Google after an email sign-up', async () => {
    const created = await firstSignIn({ avatar_url: GOOGLE_AVATAR }, { provider: 'email', providers: ['email', 'google'] });
    expect(created.avatarUrl).toBe(GOOGLE_AVATAR);
  });

  it.each([
    ['no provider recorded', {}],
    ['an email sign-up', { provider: 'email', providers: ['email'] }],
  ])('drops any avatar on an account with no Google sign-in (%s), Google-hosted or not', async (_label, app) => {
    // An email sign-up writes avatar_url itself (options.data), so nothing in
    // it came from Google, whatever host it names.
    expect((await firstSignIn({ avatar_url: GOOGLE_AVATAR }, app)).avatarUrl).toBeNull();
    vi.clearAllMocks();
    expect((await firstSignIn({ avatar_url: 'https://tracker.example/p.gif' }, app)).avatarUrl).toBeNull();
  });

  it.each([
    ['a javascript: URL', 'javascript:alert(1)'],
    ['plain http', 'http://lh3.googleusercontent.com/a/ACg8ocK1example=s96-c'],
    ['a protocol-relative URL', '//lh3.googleusercontent.com/a/ACg8ocK1example=s96-c'],
    ['a same-site path', '/api/job-alerts?token=x'],
    ['a data: URL', 'data:image/svg+xml,<svg onload=alert(1)>'],
    ['a value that is not a URL', 'not a url'],
    ['an oversized URL', `https://lh3.googleusercontent.com/a/${'a'.repeat(600)}`],
    ['a non-string', { href: GOOGLE_AVATAR }],
    ['another host, which would see every viewer', 'https://tracker.example/p.gif'],
    ['a host that only begins like Google\'s', 'https://lh3.googleusercontent.com.evil.example/a.png'],
    ['another googleusercontent.com host', 'https://script.googleusercontent.com/macros/echo?user_content_key=x'],
    ['credentials in the URL', 'https://user:pass@lh3.googleusercontent.com/a/ACg8ocK1example=s96-c'],
    ['a port the image policy does not allow', 'https://lh3.googleusercontent.com:8443/a/ACg8ocK1example=s96-c'],
    ['characters that end a CSS url()', 'https://lh3.googleusercontent.com/a);position:fixed;inset:0;z-index:9'],
    ['a quote', "https://lh3.googleusercontent.com/a/O'x=s96-c"],
  ])('drops %s, even on a Google sign-in', async (_label, avatar) => {
    expect((await firstSignIn({ full_name: 'Ada Lovelace', avatar_url: avatar }, GOOGLE_SIGN_IN)).avatarUrl).toBeNull();
  });
});

describe('readSignupMetadata and ensureProfileFromAuth: the same cleaning', () => {
  it('cleans and bounds the names and the employer company', () => {
    const derived = readSignupMetadata(authUser({
      role: 'employer',
      first_name: `${SCRIPT}Jane`,
      last_name: 'D'.repeat(80),
      company: 'C'.repeat(150),
    }));
    expect(derived.firstName).toBe('Jane');
    expect(derived.lastName).toBe('D'.repeat(50));
    expect(derived.company).toBe('C'.repeat(100));
  });

  it('drops values that are not strings, and a name that is empty once cleaned', () => {
    const derived = readSignupMetadata(authUser({ role: 'employer', first_name: 7, last_name: ['a'], company: { a: 1 } }));
    expect(derived).toMatchObject({ firstName: null, lastName: null, company: null });
    expect(readSignupMetadata(authUser({ first_name: SCRIPT, last_name: '   ' }))).toMatchObject({ firstName: null, lastName: null });
  });

  it('keeps ordinary values as they were', () => {
    const derived = readSignupMetadata(authUser({ role: 'employer', first_name: 'Grace', last_name: 'Hopper', company: 'Acme Clinic' }));
    expect(derived).toMatchObject({ firstName: 'Grace', lastName: 'Hopper', company: 'Acme Clinic' });
  });

  it('ensureProfileFromAuth writes the cleaned values to the profile and the employer lead', async () => {
    const { fake, client } = makePrisma();
    await ensureProfileFromAuth(client, authUser({
      role: 'employer',
      first_name: `${SCRIPT}Grace`,
      last_name: 'H'.repeat(90),
      company: 'C'.repeat(150),
    }));
    const [{ data }] = fake.userProfile.create.mock.calls[0] as [{ data: Record<string, unknown> }];
    expect(data).toMatchObject({ firstName: 'Grace', lastName: 'H'.repeat(50), company: 'C'.repeat(100) });
    const [{ data: lead }] = fake.employerLead.create.mock.calls[0] as [{ data: Record<string, unknown> }];
    expect(lead.companyName).toBe('C'.repeat(100));
    expect(lead.contactName).toBe(`Grace ${'H'.repeat(50)}`);
  });
});
