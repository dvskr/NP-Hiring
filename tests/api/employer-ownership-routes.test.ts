/**
 * Every employer-job ownership site, driven through its real handler: the
 * employer routes and the employer dashboard page.
 *
 * Pinned, per site:
 *   - A session with an email gets exactly the ownership OR the route built
 *     inline before lib/employer-ownership.ts: its claimed rows, plus the
 *     unclaimed legacy rows under its email. Behaviour is unchanged.
 *   - A session without an email (a sign-in method that carries none) gets
 *     its claimed rows only. The inline `{ userId: null, contactEmail:
 *     user.email! }` branch read as `{ userId: null }` for it, because Prisma
 *     drops an undefined condition, and reached every unclaimed row; the
 *     `user.email ?? ''` and `user.email || ''` variants matched on ''.
 *   - The two sites that require an email up front (the profile snapshot and
 *     the dashboard page) still turn such a session away before any query.
 *     The dashboard page used a bare contactEmail branch; it now leaves out
 *     rows another account claimed, as every action route already did.
 *
 * Each handler gets just enough mocked reads to reach its ownership query.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { canSendInMail, canUnlockCandidate, getEmployerActivePostings, getEmployerTier } from '@/lib/tier-limits';
import { redirect } from 'next/navigation';

const mocks = vi.hoisted(() => ({ getUser: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser } })),
}));
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn(async () => null),
    RATE_LIMITS: { employer: { limit: 30, windowSeconds: 60 }, feedback: { limit: 5, windowSeconds: 60 } },
}));
vi.mock('@/lib/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/tier-limits', () => ({
    getEmployerTier: vi.fn(),
    getEmployerActivePostings: vi.fn(),
    canUnlockCandidate: vi.fn(),
    canSendInMail: vi.fn(),
}));
vi.mock('@/lib/stripe', () => ({ getStripe: vi.fn(() => null) }));
vi.mock('@/lib/invoice-generator', () => ({ generateInvoice: vi.fn() }));
vi.mock('@/lib/resume-storage', () => ({
    mintResumeReadUrl: vi.fn(async () => null),
    extractRequestContext: vi.fn(() => ({ ip: null, userAgent: null })),
}));
vi.mock('@/lib/inngest/client', () => ({ inngest: { send: vi.fn(async () => undefined) } }));
vi.mock('@/lib/employer-plan', () => ({ republishPlanPost: vi.fn() }));
vi.mock('@/lib/auth/protect', () => ({ requireEmployer: vi.fn(async () => undefined) }));
vi.mock('next/navigation', () => ({
    redirect: vi.fn((url: string) => {
        throw new Error(`NEXT_REDIRECT ${url}`);
    }),
}));
vi.mock('@/components/employer/EmployerDashboardClient', () => ({ default: () => null }));
vi.mock('@/components/employer/UnfinishedPostBanner', () => ({ default: () => null }));
vi.mock('@/components/BreadcrumbSchema', () => ({ default: () => null }));

import { GET as benchmarks } from '@/app/api/employer/analytics/benchmarks/route';
import { GET as analyticsCsv } from '@/app/api/employer/analytics/csv/route';
import { GET as analytics } from '@/app/api/employer/analytics/route';
import { GET as applicants } from '@/app/api/employer/applicants/route';
import { GET as billing } from '@/app/api/employer/billing/route';
import { GET as candidateDetail } from '@/app/api/employer/candidates/[id]/route';
import { GET as invoice } from '@/app/api/employer/invoice/route';
import { PATCH as archive } from '@/app/api/employer/jobs/[jobId]/archive/route';
import { PATCH as togglePublish } from '@/app/api/employer/jobs/[jobId]/toggle-publish/route';
import { POST as sendMessage } from '@/app/api/employer/messages/route';
import { GET as profileSnapshot } from '@/app/api/employer/profile-snapshot/route';
import { POST as unlockBulk } from '@/app/api/employer/profiles/unlock-bulk/route';
import { GET as receipt } from '@/app/api/employer/receipt/route';
import { GET as notificationSettings } from '@/app/api/employer/settings/notifications/route';
import { GET as settings, PATCH as saveSettings } from '@/app/api/employer/settings/route';
import { POST as testimonial } from '@/app/api/employer/testimonials/route';
import EmployerDashboardPage from '@/app/employer/dashboard/page';

// The global prisma fake has no testimonial model; the testimonial route writes one.
Object.assign(prisma, { employerTestimonial: { create: vi.fn(async () => ({ id: 'testimonial-1' })) } });

const USER_ID = 'supabase-employer';
const EMAIL = 'hiring@clinic.example';
const WITH_EMAIL = { id: USER_ID, email: EMAIL };
/** A Supabase session from a sign-in method that carries no email. */
const WITHOUT_EMAIL = { id: USER_ID };
const JOB_ID = 'job-1';

const CLAIMED_AND_LEGACY = [{ userId: USER_ID }, { userId: null, contactEmail: EMAIL }];
const CLAIMED_ONLY = [{ userId: USER_ID }];

type Where = Record<string, unknown>;
type MockWithCalls = { mock: { calls: unknown[][] } };

/** The `where` of every call a prisma fake received, in order. */
function wheresOf(fn: unknown): Where[] {
    return (fn as MockWithCalls).mock.calls.map(([args]) => ((args ?? {}) as { where?: Where }).where ?? {});
}

/** The ownership OR of the one call to `fn` that carried it. */
function ownershipOr(fn: unknown, pick: (where: Where) => unknown = (where) => where.OR): unknown {
    const found = wheresOf(fn).map(pick).filter((or) => or !== undefined);
    expect(found, 'exactly one ownership query').toHaveLength(1);
    return found[0];
}

function url(path: string): string {
    return `http://localhost:3000${path}`;
}

function getRequest(path: string): NextRequest {
    return new NextRequest(url(path));
}

function jsonRequest(path: string, method: string, body: unknown): NextRequest {
    return new NextRequest(url(path), {
        method,
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
    });
}

function employerProfile(role: string = 'employer'): void {
    vi.mocked(prisma.userProfile.findUnique).mockResolvedValue({
        id: 'profile-1',
        role,
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: EMAIL,
        phone: null,
        company: 'Clinic',
    } as never);
}

interface Site {
    readonly name: string;
    /** Arrange the reads the handler makes before its ownership query, then run it. */
    readonly run: () => Promise<unknown>;
    /** The ownership OR the handler built. */
    readonly or: () => unknown;
}

const SITES: readonly Site[] = [
    {
        name: 'GET /api/employer/analytics/benchmarks',
        run: async () => {
            employerProfile();
            // The platform-wide read runs first and must find a row for the
            // route to go on to the employer's own posts.
            vi.mocked(prisma.employerJob.findMany).mockImplementation((async (args: { where: Where }) =>
                args.where.OR
                    ? []
                    : [{ job: { viewCount: 3, applyClickCount: 1, isFeatured: false, createdAt: new Date(), normalizedMinSalary: null, normalizedMaxSalary: null, displaySalary: null } }]
            ) as never);
            return benchmarks();
        },
        or: () => ownershipOr(prisma.employerJob.findMany),
    },
    {
        name: 'GET /api/employer/analytics/csv',
        run: async () => {
            employerProfile('admin');
            vi.mocked(prisma.employerJob.findMany).mockResolvedValue([] as never);
            return analyticsCsv();
        },
        or: () => ownershipOr(prisma.employerJob.findMany),
    },
    {
        name: 'GET /api/employer/analytics',
        run: async () => {
            employerProfile();
            vi.mocked(getEmployerTier).mockResolvedValue('pro' as never);
            vi.mocked(getEmployerActivePostings).mockResolvedValue([] as never);
            vi.mocked(prisma.employerJob.findMany).mockResolvedValue([] as never);
            return analytics(getRequest('/api/employer/analytics'));
        },
        or: () => ownershipOr(prisma.employerJob.findMany),
    },
    {
        name: 'GET /api/employer/applicants',
        run: async () => {
            employerProfile();
            vi.mocked(prisma.employerJob.findMany).mockResolvedValue([] as never);
            return applicants(getRequest('/api/employer/applicants'));
        },
        or: () => ownershipOr(prisma.employerJob.findMany),
    },
    {
        name: 'GET /api/employer/billing',
        run: async () => {
            employerProfile();
            vi.mocked(prisma.employerJob.findMany).mockResolvedValue([] as never);
            return billing(getRequest('/api/employer/billing'));
        },
        or: () => ownershipOr(prisma.employerJob.findMany),
    },
    {
        name: 'GET /api/employer/candidates/[id]?postingId=',
        run: async () => {
            employerProfile();
            vi.mocked(prisma.profileView.findUnique).mockResolvedValue(null as never);
            vi.mocked(prisma.employerJob.count).mockResolvedValue(0 as never);
            vi.mocked(prisma.userProfile.findFirst).mockResolvedValue({
                supabaseId: 'candidate-1', firstName: 'Grace', lastName: 'Hopper', avatarUrl: null, headline: null,
                yearsExperience: null, specialties: null, preferredWorkMode: null, createdAt: new Date(),
            } as never);
            vi.mocked(getEmployerTier).mockResolvedValue('pro' as never);
            vi.mocked(canUnlockCandidate).mockResolvedValue({ allowed: true, postingId: 'auto-posting' } as never);
            vi.mocked(prisma.employerJob.findFirst).mockResolvedValue(null as never);
            vi.mocked(prisma.profileView.upsert).mockResolvedValue({} as never);
            return candidateDetail(getRequest('/api/employer/candidates/candidate-1?postingId=posting-1'), {
                params: Promise.resolve({ id: 'candidate-1' }),
            });
        },
        or: () => ownershipOr(prisma.employerJob.findFirst),
    },
    {
        name: 'GET /api/employer/invoice (session)',
        run: async () => {
            vi.mocked(prisma.employerJob.findFirst).mockResolvedValue(null as never);
            return invoice(getRequest(`/api/employer/invoice?jobId=${JOB_ID}`));
        },
        or: () => ownershipOr(prisma.employerJob.findFirst),
    },
    {
        name: 'PATCH /api/employer/jobs/[jobId]/archive',
        run: async () => {
            employerProfile();
            vi.mocked(prisma.employerJob.findFirst).mockResolvedValue(null as never);
            return archive(jsonRequest(`/api/employer/jobs/${JOB_ID}/archive`, 'PATCH', { archived: true }), {
                params: Promise.resolve({ jobId: JOB_ID }),
            });
        },
        or: () => ownershipOr(prisma.employerJob.findFirst),
    },
    {
        name: 'PATCH /api/employer/jobs/[jobId]/toggle-publish',
        run: async () => {
            employerProfile();
            vi.mocked(prisma.employerJob.findFirst).mockResolvedValue(null as never);
            return togglePublish(jsonRequest(`/api/employer/jobs/${JOB_ID}/toggle-publish`, 'PATCH', {}), {
                params: Promise.resolve({ jobId: JOB_ID }),
            });
        },
        or: () => ownershipOr(prisma.employerJob.findFirst),
    },
    {
        name: 'POST /api/employer/messages (job-scoped)',
        run: async () => {
            arrangeNewThread();
            vi.mocked(prisma.job.findFirst).mockResolvedValue(null as never);
            return sendMessage(jsonRequest('/api/employer/messages', 'POST', {
                recipientId: 'candidate-1', subject: 'Your application', body: 'Can we talk this week?', jobId: JOB_ID,
            }));
        },
        or: () => ownershipOr(prisma.job.findFirst, (where) => (where.employerJobs as Where | undefined)?.OR),
    },
    {
        name: 'POST /api/employer/messages (no job)',
        run: async () => {
            arrangeNewThread();
            vi.mocked(prisma.employerJob.findFirst).mockResolvedValue(null as never);
            return sendMessage(jsonRequest('/api/employer/messages', 'POST', {
                recipientId: 'candidate-1', subject: 'Your profile', body: 'Can we talk this week?',
            }));
        },
        or: () => ownershipOr(prisma.employerJob.findFirst),
    },
    {
        name: 'POST /api/employer/profiles/unlock-bulk (postingId)',
        run: async () => {
            employerProfile();
            vi.mocked(getEmployerTier).mockResolvedValue('pro' as never);
            vi.mocked(prisma.employerJob.findFirst).mockResolvedValue(null as never);
            // Already unlocked, so the loop charges nothing.
            vi.mocked(prisma.profileView.findUnique).mockResolvedValue({ viewerId: USER_ID } as never);
            vi.mocked(canUnlockCandidate).mockResolvedValue({ allowed: true, used: 1, limit: 10 } as never);
            return unlockBulk(jsonRequest('/api/employer/profiles/unlock-bulk', 'POST', {
                candidateIds: ['candidate-1'], postingId: 'posting-1',
            }));
        },
        or: () => ownershipOr(prisma.employerJob.findFirst),
    },
    {
        name: 'GET /api/employer/receipt (session)',
        run: async () => {
            vi.mocked(prisma.employerJob.findFirst).mockResolvedValue(null as never);
            return receipt(getRequest(`/api/employer/receipt?jobId=${JOB_ID}`));
        },
        or: () => ownershipOr(prisma.employerJob.findFirst),
    },
    {
        name: 'GET /api/employer/settings/notifications',
        run: async () => {
            vi.mocked(prisma.employerJob.findMany).mockResolvedValue([] as never);
            return notificationSettings(getRequest('/api/employer/settings/notifications'));
        },
        or: () => ownershipOr(prisma.employerJob.findMany),
    },
    {
        name: 'GET /api/employer/settings',
        run: async () => {
            employerProfile();
            vi.mocked(prisma.employerJob.findFirst).mockResolvedValue(null as never);
            return settings(getRequest('/api/employer/settings'));
        },
        or: () => ownershipOr(prisma.employerJob.findFirst),
    },
    {
        name: 'PATCH /api/employer/settings (the company write to every owned row)',
        run: async () => {
            employerProfile();
            vi.mocked(prisma.employerJob.updateMany).mockResolvedValue({ count: 0 } as never);
            return saveSettings(jsonRequest('/api/employer/settings', 'PATCH', { companyDescription: 'Outpatient psychiatry group.' }));
        },
        or: () => ownershipOr(prisma.employerJob.updateMany),
    },
    {
        name: 'POST /api/employer/testimonials (employer name lookup)',
        run: async () => {
            vi.mocked(prisma.employerJob.findFirst).mockResolvedValue(null as never);
            return testimonial(jsonRequest('/api/employer/testimonials', 'POST', {
                content: 'Hiring through the board was quick.', consent: true,
            }));
        },
        or: () => ownershipOr(prisma.employerJob.findFirst),
    },
    {
        name: 'POST /api/employer/testimonials (employerJobId ownership check)',
        run: async () => {
            vi.mocked(prisma.employerJob.findFirst).mockResolvedValue(null as never);
            return testimonial(jsonRequest('/api/employer/testimonials', 'POST', {
                content: 'Hiring through the board was quick.', consent: true, employerJobId: 'ej-1',
            }));
        },
        or: () => {
            const wheres = wheresOf(prisma.employerJob.findFirst);
            expect(wheres, 'the name lookup, then the ownership check').toHaveLength(2);
            expect(wheres[1]).toMatchObject({ id: 'ej-1' });
            return wheres[1].OR;
        },
    },
];

/** Sender and recipient profiles, and no existing thread, so the send is new outreach. */
function arrangeNewThread(): void {
    vi.mocked(prisma.userProfile.findUnique).mockImplementation((async (args: { where: { supabaseId: string } }) =>
        args.where.supabaseId === USER_ID
            ? { id: 'profile-1', firstName: 'Ada', lastName: 'Lovelace', company: 'Clinic', role: 'employer' }
            : { id: 'profile-2', email: 'grace@example.com', firstName: 'Grace' }
    ) as never);
    vi.mocked(prisma.conversation.findFirst).mockResolvedValue(null as never);
    vi.mocked(canSendInMail).mockResolvedValue({ allowed: true } as never);
}

function signIn(user: { id: string; email?: string }): void {
    mocks.getUser.mockResolvedValue({ data: { user }, error: null });
}

beforeEach(() => {
    vi.mocked(prisma.employerJob.findMany).mockReset();
    vi.mocked(prisma.employerJob.findFirst).mockReset();
    vi.mocked(prisma.userProfile.findUnique).mockReset();
});

describe('a session with an email: the ownership clause is unchanged', () => {
    it.each(SITES.map((site) => [site.name, site] as const))('%s', async (_name, site) => {
        signIn(WITH_EMAIL);

        await site.run();

        expect(site.or()).toEqual(CLAIMED_AND_LEGACY);
    });

    it('GET /api/employer/profile-snapshot', async () => {
        signIn(WITH_EMAIL);
        vi.mocked(prisma.userProfile.findUnique).mockResolvedValue({ role: 'employer', company: 'Clinic' } as never);
        vi.mocked(prisma.employerJob.findMany).mockResolvedValue([] as never);

        const res = await profileSnapshot();

        expect(res.status).toBe(200);
        expect(ownershipOr(prisma.employerJob.findMany)).toEqual(CLAIMED_AND_LEGACY);
    });
});

describe('a session without an email: claimed rows only, never the unclaimed legacy rows', () => {
    it.each(SITES.map((site) => [site.name, site] as const))('%s', async (_name, site) => {
        signIn(WITHOUT_EMAIL);

        await site.run();

        expect(site.or()).toEqual(CLAIMED_ONLY);
    });

    it('GET /api/employer/profile-snapshot answers 401 before any query', async () => {
        signIn(WITHOUT_EMAIL);

        const res = await profileSnapshot();

        expect(res.status).toBe(401);
        expect(prisma.employerJob.findMany).not.toHaveBeenCalled();
    });
});

describe('the employer dashboard page', () => {
    it('lists the claimed rows and the unclaimed rows under the email, no longer rows another account claimed', async () => {
        // The page used { contactEmail: user.email } with no userId: null
        // guard, so a row another account claimed showed here, edit token
        // and all, whenever it carried the same contact email.
        signIn(WITH_EMAIL);
        vi.mocked(prisma.employerJob.findMany).mockResolvedValue([] as never);

        await EmployerDashboardPage();

        expect(ownershipOr(prisma.employerJob.findMany)).toEqual(CLAIMED_AND_LEGACY);
    });

    it('sends a session without an email to sign in before any query', async () => {
        signIn(WITHOUT_EMAIL);

        await expect(EmployerDashboardPage()).rejects.toThrow('NEXT_REDIRECT');

        expect(redirect).toHaveBeenCalledWith('/login?next=/employer/dashboard');
        expect(prisma.employerJob.findMany).not.toHaveBeenCalled();
    });
});
