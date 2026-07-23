/**
 * Regression (F27, audit high) — signup opt-ins were silently lost when email
 * confirmation is required: supabase.auth.signUp returns no session, so the
 * immediate POST /api/auth/profile carried no auth cookie and 401'd unseen.
 * ensureProfileFromAuth later recreated the UserProfile from auth metadata,
 * but everything that ONLY lived in that POST was gone forever: the
 * default-on "Job Highlights" JobAlert (+ chosen frequency), the EmailLead
 * with newsletterOptIn, Beehiiv sync — and the EmployerLead for employer
 * signups. Google-OAuth signups got all of these in /auth/callback; email
 * signups got nothing.
 *
 * Fix under test: SignUpForm stashes the opt-ins in Supabase user_metadata at
 * signUp, and ensureProfileFromAuth's create branch completes them
 * server-side (completeSignupOptIns) — guarded against double-creation for
 * the autoconfirm/OAuth paths whose profile row already exists.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { User } from '@supabase/supabase-js';
import type { PrismaClient } from '@prisma/client';
import {
  readSignupMetadata,
  completeSignupOptIns,
  ensureProfileFromAuth,
} from '@/lib/auth/ensure-profile';
import { syncToBeehiiv } from '@/lib/beehiiv';
import { logger } from '@/lib/logger';

vi.mock('@/lib/beehiiv', () => ({
  syncToBeehiiv: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const EMAIL = 'seeker@example.com';

const authUser = (metadata: Record<string, unknown>, email = EMAIL): User =>
  ({ id: 'auth-user-1', email, user_metadata: metadata } as unknown as User);

/** Hand-rolled prisma fake — ensureProfileFromAuth takes prisma as an arg. */
const makePrisma = () => {
  const fake = {
    userProfile: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'profile-1', ...data })),
      update: vi.fn(),
    },
    emailLead: {
      upsert: vi.fn().mockResolvedValue({ email: EMAIL }),
    },
    jobAlert: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'alert-1' }),
    },
    employerLead: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'lead-1' }),
    },
  };
  return { fake, prisma: fake as unknown as PrismaClient };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('F27 — readSignupMetadata extracts the stashed opt-ins', () => {
  it('reads want_job_highlights / highlights_frequency / newsletter_opt_in', () => {
    const derived = readSignupMetadata(authUser({
      role: 'job_seeker',
      first_name: 'Jane',
      last_name: 'Doe',
      want_job_highlights: true,
      highlights_frequency: 'weekly',
      newsletter_opt_in: true,
    }));
    expect(derived.wantJobHighlights).toBe(true);
    expect(derived.highlightsFrequency).toBe('weekly');
    expect(derived.newsletterOptIn).toBe(true);
  });

  it('defaults to opted-out for absent metadata (old accounts, OAuth)', () => {
    const derived = readSignupMetadata(authUser({ role: 'job_seeker' }));
    expect(derived.wantJobHighlights).toBe(false);
    expect(derived.highlightsFrequency).toBe('daily');
    expect(derived.newsletterOptIn).toBe(false);
  });

  it('never derives a job-highlights alert for employers', () => {
    const derived = readSignupMetadata(authUser({
      role: 'employer',
      company: 'Acme Clinic',
      want_job_highlights: true,
    }));
    expect(derived.role).toBe('employer');
    expect(derived.wantJobHighlights).toBe(false);
  });
});

describe('F27 — ensureProfileFromAuth completes opt-ins on profile creation', () => {
  it('creates EmailLead, Beehiiv sync, and a CONFIRMED JobAlert for opted-in seekers', async () => {
    const { fake, prisma } = makePrisma();
    const profile = await ensureProfileFromAuth(prisma, authUser({
      role: 'job_seeker',
      first_name: 'Jane',
      want_job_highlights: true,
      highlights_frequency: 'weekly',
      newsletter_opt_in: true,
    }));

    expect(profile).not.toBeNull();
    expect(fake.userProfile.create).toHaveBeenCalledTimes(1);

    // EmailLead upsert with the newsletter opt-in (FK parent of JobAlert).
    expect(fake.emailLead.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { email: EMAIL },
      create: expect.objectContaining({ email: EMAIL, newsletterOptIn: true, isSubscribed: true }),
    }));

    // Beehiiv newsletter sync fires for seekers.
    expect(vi.mocked(syncToBeehiiv)).toHaveBeenCalledWith(EMAIL, { utmSource: 'signup' });

    // JobAlert honors the chosen frequency and the single-opt-in semantics:
    // confirmedAt MUST be set or the digest cron never sends to it.
    expect(fake.jobAlert.create).toHaveBeenCalledTimes(1);
    const alertData = fake.jobAlert.create.mock.calls[0][0].data;
    expect(alertData.email).toBe(EMAIL);
    expect(alertData.frequency).toBe('weekly');
    expect(alertData.isActive).toBe(true);
    expect(alertData.confirmedAt).toBeInstanceOf(Date);
    expect(typeof alertData.token).toBe('string');
    expect(alertData.token.length).toBeGreaterThan(0);
  });

  it('skips the JobAlert when the user unchecked job highlights', async () => {
    const { fake, prisma } = makePrisma();
    await ensureProfileFromAuth(prisma, authUser({
      role: 'job_seeker',
      want_job_highlights: false,
      newsletter_opt_in: true,
    }));
    expect(fake.jobAlert.create).not.toHaveBeenCalled();
    // Newsletter opt-in is independent of the alert.
    expect(fake.emailLead.upsert).toHaveBeenCalledTimes(1);
  });

  it('creates an EmployerLead (not seeker records) for employer signups', async () => {
    const { fake, prisma } = makePrisma();
    await ensureProfileFromAuth(prisma, authUser({
      role: 'employer',
      first_name: 'Bob',
      last_name: 'Recruiter',
      company: 'Acme Clinic',
      newsletter_opt_in: true,
    }, 'hiring@acmeclinic.com'));

    expect(fake.employerLead.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        companyName: 'Acme Clinic',
        contactEmail: 'hiring@acmeclinic.com',
        contactName: 'Bob Recruiter',
        source: 'employer_signup',
        status: 'prospect',
      }),
    }));
    expect(fake.emailLead.upsert).not.toHaveBeenCalled();
    expect(fake.jobAlert.create).not.toHaveBeenCalled();
    expect(vi.mocked(syncToBeehiiv)).not.toHaveBeenCalled();
  });

  it('does NOT re-create opt-ins when the profile already exists (autoconfirm/OAuth path)', async () => {
    const { fake, prisma } = makePrisma();
    fake.userProfile.findUnique.mockResolvedValue({
      id: 'profile-1', supabaseId: 'auth-user-1', email: EMAIL, role: 'job_seeker',
    });

    await ensureProfileFromAuth(prisma, authUser({
      role: 'job_seeker',
      want_job_highlights: true,
      newsletter_opt_in: true,
    }));

    expect(fake.userProfile.create).not.toHaveBeenCalled();
    expect(fake.emailLead.upsert).not.toHaveBeenCalled();
    expect(fake.jobAlert.create).not.toHaveBeenCalled();
    expect(fake.employerLead.create).not.toHaveBeenCalled();
    expect(vi.mocked(syncToBeehiiv)).not.toHaveBeenCalled();
  });

  it('guards against duplicate JobAlert / EmployerLead rows', async () => {
    const { fake, prisma } = makePrisma();
    fake.jobAlert.findFirst.mockResolvedValue({ id: 'existing-alert' });
    await completeSignupOptIns(prisma, EMAIL, {
      role: 'job_seeker', company: null, firstName: null, lastName: null,
      wantJobHighlights: true, highlightsFrequency: 'daily', newsletterOptIn: false,
    });
    expect(fake.jobAlert.create).not.toHaveBeenCalled();

    fake.employerLead.findFirst.mockResolvedValue({ id: 'existing-lead' });
    await completeSignupOptIns(prisma, EMAIL, {
      role: 'employer', company: 'Acme', firstName: null, lastName: null,
      wantJobHighlights: false, highlightsFrequency: 'daily', newsletterOptIn: false,
    });
    expect(fake.employerLead.create).not.toHaveBeenCalled();
  });

  it('never blocks auth when opt-in bookkeeping fails', async () => {
    const { fake, prisma } = makePrisma();
    fake.emailLead.upsert.mockRejectedValue(new Error('db down'));
    const profile = await ensureProfileFromAuth(prisma, authUser({
      role: 'job_seeker',
      want_job_highlights: true,
      newsletter_opt_in: true,
    }));
    // Profile creation succeeded even though the opt-in completion threw.
    expect(profile).not.toBeNull();
    expect(fake.userProfile.create).toHaveBeenCalledTimes(1);
  });

  it('logs the opt-in failure with logger.error(message, error, context) — not transposed', async () => {
    const { fake, prisma } = makePrisma();
    fake.emailLead.upsert.mockRejectedValue(new Error('db down'));
    await ensureProfileFromAuth(prisma, authUser({
      role: 'job_seeker',
      want_job_highlights: true,
      newsletter_opt_in: true,
    }));

    // The logger contract is error(message, error?, context?). Passing the
    // context object in slot 2 is a strict-mode TS2345 (unknown context param)
    // that fails `next build`, and at runtime Sentry would capture the context
    // object as the "error" while the real exception landed in the context slot.
    expect(vi.mocked(logger.error)).toHaveBeenCalledTimes(1);
    const [message, errArg, ctxArg] = vi.mocked(logger.error).mock.calls[0];
    expect(message).toBe('[ensureProfileFromAuth] signup opt-in completion failed');
    expect(errArg).toBeInstanceOf(Error);
    expect((errArg as Error).message).toBe('db down');
    expect(ctxArg).toMatchObject({ email: EMAIL, role: 'job_seeker' });
  });
});

describe('F27 — client wiring keeps the opt-ins alive across the confirm gap', () => {
  it('SignUpForm stashes the opt-ins in signUp user_metadata', () => {
    const src = read('components/auth/SignUpForm.tsx');
    expect(src).toMatch(/want_job_highlights:\s*role === 'seeker' \? wantJobHighlights : false/);
    expect(src).toMatch(/highlights_frequency:\s*role === 'seeker' \? highlightsFrequency : null/);
    expect(src).toMatch(/newsletter_opt_in:\s*newsletterOptIn/);
  });

  it('SignUpForm only POSTs the profile when a session exists, with a retry', () => {
    const src = read('components/auth/SignUpForm.tsx');
    // The POST block must be gated on data.session (it 401s without one).
    const sessionGate = src.indexOf('if (data.session) {');
    const profilePost = src.indexOf("fetch('/api/auth/profile'");
    expect(sessionGate).toBeGreaterThan(-1);
    expect(profilePost).toBeGreaterThan(sessionGate);
    // Response is checked and retried instead of fire-and-forget.
    expect(src).toMatch(/profileRes\.ok/);
    expect(src).toMatch(/profileRes = await postProfile\(\)/);
  });

  it('/auth/confirm bootstraps the profile server-side before the welcome call', () => {
    const src = read('app/auth/confirm/page.tsx');
    const confirmSrc = src;
    // Both confirmation success paths await the profile GET (which runs
    // ensureProfileFromAuth → completeSignupOptIns) before firing welcome.
    const bootstraps = confirmSrc.match(/await fetch\('\/api\/auth\/profile'\)/g) ?? [];
    expect(bootstraps.length).toBeGreaterThanOrEqual(2);
    expect(confirmSrc.indexOf("await fetch('/api/auth/profile')"))
      .toBeLessThan(confirmSrc.indexOf("fetch('/api/auth/welcome'"));
  });
});
