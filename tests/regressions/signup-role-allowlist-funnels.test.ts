/**
 * Every path that creates a UserProfile holds the role to employer or
 * job_seeker; admin is granted by a direct database action only.
 *
 * GET /auth/callback did not, and any sign-up carrying role 'admin' became
 * an admin (tests/regressions/auth-callback-role-allowlist.test.ts). The
 * other two paths already allow-listed the role, but nothing pinned it:
 * reverting either allow-list kept the whole suite green (security review of
 * the 2026-10-13 hotfix). Pinned here, on the row each path writes:
 *   - readSignupMetadata and ensureProfileFromAuth (lib/auth/ensure-profile.ts),
 *     which every protected page and GET /api/auth/profile go through;
 *   - POST /api/auth/profile, the sign-up form's own call, which takes the
 *     role from its request body.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { User } from '@supabase/supabase-js';
import type { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';

const mocks = vi.hoisted(() => ({ getUser: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser } })),
}));
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn(async () => null),
    RATE_LIMITS: { auth: { limit: 10, windowSeconds: 60 } },
}));
vi.mock('@/lib/beehiiv', () => ({ syncToBeehiiv: vi.fn() }));
vi.mock('@/lib/email-service', () => ({ sendSignupWelcomeEmail: vi.fn(async () => undefined) }));
vi.mock('@/lib/inngest/client', () => ({ inngest: { send: vi.fn(async () => undefined) } }));
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { readSignupMetadata, ensureProfileFromAuth } from '@/lib/auth/ensure-profile';
import { POST as createProfile } from '@/app/api/auth/profile/route';

/** Role values a caller can put in auth metadata or a request body. None may become anything but job_seeker. */
const UNSAFE_ROLES: unknown[] = [
    'admin', 'ADMIN', 'Admin', 'superuser', 'staff', 'employer ', ' employer', 'Employer', '',
    0, 1, true, null, {}, { $ne: null }, ['admin'], ['employer'],
];

const authUser = (metadata: Record<string, unknown>, email = 'new.account@clinic.example'): User =>
    ({ id: 'auth-user-1', email, user_metadata: metadata } as unknown as User);

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

// Methods POST /api/auth/profile calls that the global prisma fake (tests/setup.ts) does not carry.
const extra = {
    userProfileUpsert: vi.fn(),
    emailLeadUpsert: vi.fn(async () => ({})),
    jobAlertFindFirst: vi.fn(async () => null),
    employerLeadFindFirst: vi.fn(async () => null),
};
Object.assign(prisma.userProfile, { upsert: extra.userProfileUpsert });
Object.assign(prisma.emailLead, { upsert: extra.emailLeadUpsert });
Object.assign(prisma.jobAlert, { findFirst: extra.jobAlertFindFirst });
Object.assign(prisma.employerLead, { findFirst: extra.employerLeadFindFirst });

/** POST /api/auth/profile as a signed-in new account; returns the create half of the upsert it wrote. */
async function signUpWithBodyRole(role: unknown): Promise<{ status: number; create?: Record<string, unknown>; update?: Record<string, unknown> }> {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'auth-user-1', email: 'new.account@clinic.example' } }, error: null });
    vi.mocked(prisma.userProfile.findUnique).mockResolvedValue(null as never);
    extra.userProfileUpsert.mockImplementation(async (args: { create: Record<string, unknown> }) => ({ id: 'profile-1', ...args.create }));
    const res = await createProfile(new NextRequest('https://nphiring.com/api/auth/profile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role, firstName: 'Mallory', company: 'Clinic' }),
    }));
    const call = extra.userProfileUpsert.mock.calls[0] as unknown as [{ create: Record<string, unknown>; update: Record<string, unknown> }] | undefined;
    return { status: res.status, create: call?.[0].create, update: call?.[0].update };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('readSignupMetadata: the role read from sign-up metadata', () => {
    it('is job_seeker for every value but the exact string employer', () => {
        for (const role of UNSAFE_ROLES) {
            expect(readSignupMetadata(authUser({ role })).role, `metadata role ${JSON.stringify(role)}`).toBe('job_seeker');
        }
        expect(readSignupMetadata(authUser({})).role).toBe('job_seeker');
        expect(readSignupMetadata(authUser({ role: 'employer' })).role).toBe('employer');
    });
});

describe('ensureProfileFromAuth: the row it creates from sign-up metadata', () => {
    it('never writes admin, or any other unknown role', async () => {
        for (const role of UNSAFE_ROLES) {
            const { fake, client } = makePrisma();
            await ensureProfileFromAuth(client, authUser({ role }));
            expect(fake.userProfile.create, `metadata role ${JSON.stringify(role)}`).toHaveBeenCalledTimes(1);
            const [{ data }] = fake.userProfile.create.mock.calls[0] as [{ data: Record<string, unknown> }];
            expect(data.role, `metadata role ${JSON.stringify(role)}`).toBe('job_seeker');
        }
    });

    it('keeps employer', async () => {
        const { fake, client } = makePrisma();
        await ensureProfileFromAuth(client, authUser({ role: 'employer', company: 'Clinic' }));
        const [{ data }] = fake.userProfile.create.mock.calls[0] as [{ data: Record<string, unknown> }];
        expect(data.role).toBe('employer');
    });
});

describe('POST /api/auth/profile: the role taken from the request body', () => {
    it('never writes admin, or any other unknown role', async () => {
        for (const role of UNSAFE_ROLES) {
            vi.clearAllMocks();
            const { status, create } = await signUpWithBodyRole(role);
            expect(status, `body role ${JSON.stringify(role)}`).toBe(200);
            expect(create?.role, `body role ${JSON.stringify(role)}`).toBe('job_seeker');
        }
    });

    it('never touches the role of an existing profile', async () => {
        const { update } = await signUpWithBodyRole('admin');
        expect(update).toBeDefined();
        expect(update).not.toHaveProperty('role');
    });

    it('keeps employer for a company address', async () => {
        const { status, create } = await signUpWithBodyRole('employer');
        expect(status).toBe(200);
        expect(create?.role).toBe('employer');
    });
});
