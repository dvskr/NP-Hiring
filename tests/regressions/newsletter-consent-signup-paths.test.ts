/**
 * Register 2.26: a new account reaches the Beehiiv newsletter only with the
 * newsletter opt-in.
 *
 * The sign-up form has a newsletter checkbox (stored as newsletter_opt_in in
 * auth metadata, or newsletterOptIn in the profile POST), and the local
 * newsletter flag already followed it (B73). But all three paths that create
 * an account also called syncToBeehiiv unconditionally, so every new account
 * was subscribed to the Beehiiv publication whatever the checkbox said:
 *   - GET /auth/callback, on every first sign-in and for every role;
 *   - ensureProfileFromAuth's completeSignupOptIns, for every new seeker;
 *   - POST /api/auth/profile, for every new seeker.
 * The job alert and newsletter routes already gated their syncs on consent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { User } from '@supabase/supabase-js';
import type { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { syncToBeehiiv } from '@/lib/beehiiv';

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), exchangeCodeForSession: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({
        auth: { getUser: mocks.getUser, exchangeCodeForSession: mocks.exchangeCodeForSession },
    })),
}));
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn(async () => null),
    RATE_LIMITS: { auth: { limit: 10, windowSeconds: 60 } },
}));
vi.mock('@/lib/beehiiv', () => ({ syncToBeehiiv: vi.fn() }));
vi.mock('@/lib/email-service', () => ({ sendSignupWelcomeEmail: vi.fn(async () => undefined) }));
vi.mock('@/lib/inngest/client', () => ({ inngest: { send: vi.fn(async () => undefined) } }));
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { ensureProfileFromAuth } from '@/lib/auth/ensure-profile';
import { POST as createProfile } from '@/app/api/auth/profile/route';
import { GET as authCallback } from '@/app/auth/callback/route';

const EMAIL = 'new.account@clinic.example';

const authUser = (metadata: Record<string, unknown>): User =>
    ({ id: 'auth-user-1', email: EMAIL, email_confirmed_at: '2026-10-21T00:00:00Z', user_metadata: metadata, app_metadata: {} } as unknown as User);

function makePrisma() {
    const fake = {
        userProfile: {
            findUnique: vi.fn().mockResolvedValue(null),
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'profile-1', ...data })),
            update: vi.fn(),
        },
        emailLead: { upsert: vi.fn().mockResolvedValue({}) },
        jobAlert: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'alert-1' }) },
        employerLead: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'lead-1' }) },
    };
    return fake as unknown as PrismaClient;
}

// Methods the profile POST and the callback call that the global prisma fake does not carry.
Object.assign(prisma.userProfile, { upsert: vi.fn(async (args: { create: Record<string, unknown> }) => ({ id: 'profile-1', ...args.create })) });
Object.assign(prisma.emailLead, { upsert: vi.fn(async () => ({})) });
Object.assign(prisma.jobAlert, { findFirst: vi.fn(async () => null) });
Object.assign(prisma.employerLead, { findFirst: vi.fn(async () => null) });

async function profilePost(body: Record<string, unknown>) {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'auth-user-1', email: EMAIL } }, error: null });
    vi.mocked(prisma.userProfile.findUnique).mockResolvedValue(null as never);
    return createProfile(new NextRequest('https://nphiring.com/api/auth/profile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    }));
}

async function firstSignIn(metadata: Record<string, unknown>) {
    mocks.exchangeCodeForSession.mockResolvedValue({ data: { user: authUser(metadata) }, error: null });
    let written: Record<string, unknown> | null = null;
    vi.mocked(prisma.userProfile.findUnique).mockImplementation((async () => written) as never);
    vi.mocked(prisma.userProfile.create).mockImplementation((async (args: { data: Record<string, unknown> }) => {
        written = { id: 'profile-1', ...args.data };
        return written;
    }) as never);
    vi.mocked(prisma.emailSend.findFirst).mockResolvedValue({ id: 'already-sent' } as never);
    vi.mocked(prisma.employerJob.updateMany).mockResolvedValue({ count: 0 } as never);
    return authCallback(new Request('https://nphiring.com/auth/callback?code=valid-code'));
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('ensureProfileFromAuth: a new seeker from the confirmation flow', () => {
    it('is not sent to Beehiiv without the newsletter opt-in', async () => {
        await ensureProfileFromAuth(makePrisma(), authUser({ role: 'job_seeker', newsletter_opt_in: false }));
        await ensureProfileFromAuth(makePrisma(), authUser({ role: 'job_seeker' }));
        expect(vi.mocked(syncToBeehiiv)).not.toHaveBeenCalled();
    });

    it('is sent with the opt-in', async () => {
        await ensureProfileFromAuth(makePrisma(), authUser({ role: 'job_seeker', newsletter_opt_in: true }));
        expect(vi.mocked(syncToBeehiiv)).toHaveBeenCalledWith(EMAIL, { utmSource: 'signup' });
    });
});

describe('POST /api/auth/profile: a new seeker from the sign-up form', () => {
    it('is not sent to Beehiiv without the newsletter opt-in', async () => {
        for (const newsletterOptIn of [false, undefined, 'yes', 1]) {
            vi.clearAllMocks();
            const res = await profilePost({ role: 'job_seeker', firstName: 'Sam', newsletterOptIn });
            expect(res.status, `newsletterOptIn ${JSON.stringify(newsletterOptIn)}`).toBe(200);
            expect(vi.mocked(syncToBeehiiv), `newsletterOptIn ${JSON.stringify(newsletterOptIn)}`).not.toHaveBeenCalled();
        }
    });

    it('is sent with the opt-in', async () => {
        await profilePost({ role: 'job_seeker', firstName: 'Sam', newsletterOptIn: true });
        expect(vi.mocked(syncToBeehiiv)).toHaveBeenCalledWith(EMAIL, { utmSource: 'signup' });
    });

    // Security review of 2.26: the stored newsletter flag (the list the admin
    // newsletter audience sends to) took any truthy value, where the sync took
    // only true, so "yes" or 1 joined the admin list without consent.
    it('stores the newsletter opt-in only for an explicit true, the same rule as the sync', async () => {
        for (const newsletterOptIn of ['yes', 1, 'false']) {
            vi.clearAllMocks();
            await profilePost({ role: 'job_seeker', firstName: 'Sam', newsletterOptIn });
            const [args] = vi.mocked(prisma.emailLead.upsert).mock.calls[0] as unknown as [{ create: { newsletterOptIn: boolean }; update: { newsletterOptIn?: boolean } }];
            expect(args.create.newsletterOptIn, JSON.stringify(newsletterOptIn)).toBe(false);
            expect(args.update.newsletterOptIn, JSON.stringify(newsletterOptIn)).toBeUndefined();
        }
        vi.clearAllMocks();
        await profilePost({ role: 'job_seeker', firstName: 'Sam', newsletterOptIn: true });
        const [args] = vi.mocked(prisma.emailLead.upsert).mock.calls[0] as unknown as [{ create: { newsletterOptIn: boolean }; update: { newsletterOptIn?: boolean } }];
        expect(args.create.newsletterOptIn).toBe(true);
        expect(args.update.newsletterOptIn).toBe(true);
    });
});

describe('GET /auth/callback: a first sign-in', () => {
    it('sends nobody to Beehiiv without the newsletter opt-in: Google sign-in, seekers, employers', async () => {
        for (const metadata of [{ full_name: 'Ada Lovelace' }, { role: 'job_seeker' }, { role: 'employer', company: 'Clinic' }]) {
            vi.clearAllMocks();
            await firstSignIn(metadata);
            expect(vi.mocked(prisma.userProfile.create), JSON.stringify(metadata)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(syncToBeehiiv), JSON.stringify(metadata)).not.toHaveBeenCalled();
        }
    });

    it('sends an account that opted in', async () => {
        await firstSignIn({ role: 'job_seeker', newsletter_opt_in: true });
        expect(vi.mocked(syncToBeehiiv)).toHaveBeenCalledWith(EMAIL, { utmSource: 'google_signup' });
    });
});
