/**
 * GET /auth/callback: the role a first sign-in is given.
 *
 * The callback creates the UserProfile on a first sign-in. It took the role
 * straight from `user_metadata.role`, which the account holder writes: the
 * public auth API accepts any `options.data` at sign-up. A sign-up carrying
 * `role: 'admin'` therefore got an admin profile, and every admin guard
 * (lib/auth/require-api-admin.ts, lib/auth/protect.ts) reads only that
 * column. The other two creation paths (lib/auth/ensure-profile.ts and
 * POST /api/auth/profile) already hold the role to employer or job_seeker;
 * admin is granted by a direct database action and nothing else.
 *
 * Pinned, on the row the callback actually writes:
 *   - a metadata role of 'admin', or anything else unknown, becomes job_seeker;
 *   - 'employer' is kept, and so are its lead and welcome email;
 *   - no later step of the same request treats the account as anything else.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { sendSignupWelcomeEmail } from '@/lib/email-service';

const mocks = vi.hoisted(() => ({ exchangeCodeForSession: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { exchangeCodeForSession: mocks.exchangeCodeForSession } })),
}));
vi.mock('@/lib/beehiiv', () => ({ syncToBeehiiv: vi.fn() }));
vi.mock('@/lib/email-service', () => ({ sendSignupWelcomeEmail: vi.fn(async () => undefined) }));

import { GET as callback } from '@/app/auth/callback/route';

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
const EMAIL = 'new.account@example.com';

/** Run the callback for a first sign-in whose auth metadata is `metadata`. */
async function firstSignIn(metadata: Record<string, unknown>): Promise<{ created: Record<string, unknown>; location: string | null }> {
    mocks.exchangeCodeForSession.mockResolvedValue({
        data: { user: { id: USER_ID, email: EMAIL, user_metadata: metadata } },
        error: null,
    });
    // No profile yet on the first read; afterwards the row the callback wrote.
    let written: Record<string, unknown> | null = null;
    vi.mocked(prisma.userProfile.findUnique).mockImplementation((async () => written) as never);
    vi.mocked(prisma.userProfile.create).mockImplementation((async (args: { data: Record<string, unknown> }) => {
        written = { id: 'profile-1', ...args.data };
        return written;
    }) as never);
    vi.mocked(prisma.emailSend.findFirst).mockResolvedValue({ id: 'already-sent' } as never);
    vi.mocked(prisma.employerJob.updateMany).mockResolvedValue({ count: 0 } as never);

    const res = await callback(new Request('http://localhost:3000/auth/callback?code=valid-code'));
    expect(vi.mocked(prisma.userProfile.create), 'one profile row written').toHaveBeenCalledTimes(1);
    const [{ data }] = vi.mocked(prisma.userProfile.create).mock.calls[0] as unknown as [{ data: Record<string, unknown> }];
    return { created: data, location: res.headers.get('location') };
}

beforeEach(() => {
    vi.clearAllMocks();
    extra.employerLeadFindFirst.mockResolvedValue(null);
    extra.jobAlertFindFirst.mockResolvedValue(null);
});

describe('GET /auth/callback: the role written on a first sign-in', () => {
    it('never writes admin from sign-up metadata', async () => {
        const { created, location } = await firstSignIn({ role: 'admin', first_name: 'Mallory' });
        expect(created.role).toBe('job_seeker');
        // The same request must not send the account to the admin area either.
        expect(location).not.toContain('/admin');
    });

    it('holds every other unknown value to job_seeker', async () => {
        for (const role of ['ADMIN', 'superuser', 'employer ', '', 0, null, { $ne: null }, ['admin']]) {
            vi.clearAllMocks();
            const { created } = await firstSignIn({ role });
            expect(created.role, `metadata role ${JSON.stringify(role)}`).toBe('job_seeker');
        }
    });

    it('defaults to job_seeker when the metadata carries no role (Google sign-in)', async () => {
        const { created } = await firstSignIn({ full_name: 'Ada Lovelace', avatar_url: 'https://example.com/a.png' });
        expect(created.role).toBe('job_seeker');
        // The Google name and avatar handling is untouched by the allow-list.
        expect(created.firstName).toBe('Ada');
        expect(created.lastName).toBe('Lovelace');
        expect(created.avatarUrl).toBe('https://example.com/a.png');
    });

    it('keeps employer, with its lead and its welcome email', async () => {
        const { created, location } = await firstSignIn({ role: 'employer', company: 'Clinic', first_name: 'Grace' });
        expect(created.role).toBe('employer');
        expect(vi.mocked(prisma.employerLead.create)).toHaveBeenCalledTimes(1);
        expect(extra.emailLeadUpsert).not.toHaveBeenCalled();
        expect(vi.mocked(sendSignupWelcomeEmail)).toHaveBeenCalledWith(EMAIL, 'Grace', 'employer');
        expect(location).toContain('/employer/dashboard');
    });

    it('treats an account that asked for admin as a job seeker in every later step', async () => {
        await firstSignIn({ role: 'admin' });
        // The job seeker branches run: the email lead and the default alert.
        expect(extra.emailLeadUpsert).toHaveBeenCalledTimes(1);
        expect(vi.mocked(prisma.jobAlert.create)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(prisma.employerLead.create)).not.toHaveBeenCalled();
        expect(vi.mocked(sendSignupWelcomeEmail)).toHaveBeenCalledWith(EMAIL, '', 'job_seeker');
    });
});
