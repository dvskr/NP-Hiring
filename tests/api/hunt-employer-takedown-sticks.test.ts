/**
 * EMPLOYER-20, as the sister boards fixed it: an admin takedown of a paid post
 * must stick. The admin tools record it as an admin hold (jobs.admin_hold_at,
 * lib/admin/job-hold.ts). The employer's Unpause and the renewal checkout
 * both used to put such a post back: one click, or a renewal payment the
 * expiry email invites. Both now refuse it with a plain explanation that
 * names this board and its support address, while an employer's own pause
 * still unpauses as before.
 *
 * All fixtures are fictional.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { brand } from '@/config/brand';

const mocks = vi.hoisted(() => ({ sessionsCreate: vi.fn() }));

vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn().mockResolvedValue(null),
    RATE_LIMITS: { employer: { limit: 30, windowSeconds: 60 }, postJob: { limit: 30, windowSeconds: 60 } },
}));
vi.mock('@/lib/inngest/client', () => ({ inngest: { send: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('@/lib/supabase/server', () => ({
    createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: { id: 'supabase-employer-fic-1', email: 'hiring@acmepsych.example' } }, error: null }) },
    }),
}));
vi.mock('stripe', () => ({
    default: vi.fn().mockImplementation(() => ({ checkout: { sessions: { create: mocks.sessionsCreate, list: vi.fn(), expire: vi.fn() } } })),
}));
vi.mock('@/lib/env', () => ({
    isFeatureEnabled: vi.fn((feature: string) => feature === 'paidPosting'),
    getEnv: vi.fn(() => ({ STRIPE_WEBHOOK_SECRET: 'whsec_x' })),
    getBaseUrl: vi.fn(() => 'http://localhost:3000'),
}));

const DAY = 24 * 60 * 60 * 1000;

beforeAll(async () => {
    await import('@/app/api/employer/jobs/[jobId]/toggle-publish/route');
    await import('@/app/api/create-renewal-checkout/route');
}, 120_000);

function pausedJob(unpublishReason: string | null, adminHoldAt: Date | null = null) {
    return {
        id: 'job-fic-1',
        title: 'NP (Fixture)',
        employer: 'Acme Psychiatry (Fixture)',
        location: 'Remote',
        isPublished: false,
        isManuallyUnpublished: true,
        unpublishReason,
        adminHoldAt,
        archivedAt: null,
        createdAt: new Date(Date.now() - 50 * DAY),
        expiresAt: new Date(Date.now() + 3 * DAY),
    };
}

function employerJobRow(job: ReturnType<typeof pausedJob>) {
    return {
        id: 'ej-fic-1',
        jobId: job.id,
        userId: 'supabase-employer-fic-1',
        editToken: 'edit-token-fic',
        dashboardToken: 'dash-token-fic',
        contactEmail: 'hiring@acmepsych.example',
        paymentStatus: 'paid',
        pricingTier: 'pro',
        jobCharges: [],
        createdAt: job.createdAt,
        job,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_fixture';
    vi.mocked(prisma.userProfile.findUnique).mockResolvedValue({ id: 'profile-fic', role: 'employer' } as never);
    vi.mocked(prisma.job.update).mockResolvedValue({} as never);
    mocks.sessionsCreate.mockResolvedValue({ id: 'cs_fixture', url: 'https://checkout.example/cs_fixture' });
});

async function toggle() {
    const { PATCH } = await import('@/app/api/employer/jobs/[jobId]/toggle-publish/route');
    return PATCH(
        new NextRequest('http://localhost/api/employer/jobs/job-fic-1/toggle-publish', { method: 'PATCH' }),
        { params: Promise.resolve({ jobId: 'job-fic-1' }) },
    );
}

async function renew() {
    const { POST } = await import('@/app/api/create-renewal-checkout/route');
    return POST(new NextRequest('http://localhost/api/create-renewal-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: 'job-fic-1', editToken: 'edit-token-fic' }),
    }));
}

describe('an admin takedown sticks (EMPLOYER-20)', () => {
    it('refuses the dashboard Unpause and writes nothing', async () => {
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue(employerJobRow(pausedJob(null, new Date())) as never);

        const res = await toggle();
        const body = await res.json();

        expect(res.status).toBe(403);
        expect(body.cause).toBe('admin_hold');
        expect(body.message).toContain(`taken down by ${brand.name}`);
        expect(body.message).toContain(brand.email.support);
        expect(prisma.job.update).not.toHaveBeenCalled();
    });

    it('refuses a renewal checkout with the same explanation, before Stripe is called', async () => {
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue(employerJobRow(pausedJob(null, new Date())) as never);

        const res = await renew();
        const body = await res.json();

        expect(res.status).toBe(409);
        expect(body.cause).toBe('admin_hold');
        expect(body.error).toContain(`taken down by ${brand.name}`);
        expect(mocks.sessionsCreate).not.toHaveBeenCalled();
    });

    it('still lets an employer unpause their own pause', async () => {
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue(employerJobRow(pausedJob('filled')) as never);

        const res = await toggle();

        expect(res.status).toBe(200);
        expect(prisma.job.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ isPublished: true }) }),
        );
    });
});
