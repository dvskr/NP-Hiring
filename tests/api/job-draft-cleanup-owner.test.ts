/**
 * A new post clears only its own author's saved draft (register 2.29).
 *
 * A draft belongs to the signed-in employer who saved it: JobDraft.userId,
 * one draft per account (app/api/job-draft/route.ts saves, reads and deletes
 * by it). The contact email in the post form is whatever the poster typed, so
 * clearing drafts "filed under the same contact email" let one employer delete
 * another's in-progress draft by typing that employer's address:
 *   - POST /api/jobs/post-free cleared drafts by the form's contact email;
 *   - the paid activation (app/api/webhooks/stripe/activate-paid-job.ts)
 *     cleared them by the contact email the checkout stored.
 * Both now clear the drafts of the account that made the post, and the paid
 * activation clears none for a legacy row that no account claimed.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import type Stripe from 'stripe';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';

vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn().mockResolvedValue(null),
    RATE_LIMITS: { postJob: { limit: 100, windowMs: 60_000 } },
}));
const getUserMock = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}));
vi.mock('@/lib/inngest/client', () => ({ inngest: { send: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('@/lib/analytics-server', () => ({ trackServerPurchase: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/job-page-indexing', () => ({ pingSearchEnginesForJobPage: vi.fn().mockResolvedValue([]) }));

/** Another employer's address, typed into the form as the contact email. */
const SOMEONE_ELSES_EMAIL = 'hiring@other-clinic.example';

const BODY = {
    title: 'Family Nurse Practitioner',
    employer: 'Clinic Co',
    location: 'Austin, TX',
    mode: 'In-Person',
    jobType: 'Full-Time',
    description: '<p>' + 'Outpatient primary care for adults and families. '.repeat(6) + '</p>',
    applyLink: 'https://clinic.example/apply',
    contactEmail: SOMEONE_ELSES_EMAIL,
};

async function postFree(): Promise<number> {
    const { POST } = await import('@/app/api/jobs/post-free/route');
    const res = await POST(new NextRequest('https://test.local/api/jobs/post-free', {
        method: 'POST',
        body: JSON.stringify(BODY),
        headers: { 'content-type': 'application/json' },
    }));
    return res.status;
}

const PAID_SESSION = {
    id: 'cs_paid',
    payment_status: 'paid',
    metadata: { jobId: 'job-1', pricing: 'pro' },
    payment_intent: 'pi_paid',
    amount_total: 34900,
    currency: 'usd',
    invoice: null,
} as unknown as Stripe.Checkout.Session;

async function activatePaid(row: { userId: string | null }): Promise<string> {
    vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({
        id: 'ej-1', jobId: 'job-1', contactEmail: SOMEONE_ELSES_EMAIL, dashboardToken: 'dash-1', quotaDomain: 'clinic.example', ...row,
    } as never);
    const { activatePaidJobCheckout } = await import('@/app/api/webhooks/stripe/activate-paid-job');
    const result = await activatePaidJobCheckout({} as Stripe, PAID_SESSION);
    return result.outcome;
}

beforeAll(async () => {
    await import('@/app/api/jobs/post-free/route');
    await import('@/app/api/webhooks/stripe/activate-paid-job');
}, 120_000);

beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1', email: 'owner@clinic.example' } }, error: null });
    vi.mocked(prisma.userProfile.findUnique).mockResolvedValue({ supabaseId: 'user-1', role: 'employer', email: 'owner@clinic.example' } as never);
    vi.mocked(prisma.$transaction).mockImplementation(((fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma)) as never);
    vi.mocked(prisma.job.create).mockResolvedValue({ id: 'job-1' } as never);
    vi.mocked(prisma.job.update).mockResolvedValue({ id: 'job-1', title: BODY.title, slug: null } as never);
    vi.mocked(prisma.employerJob.create).mockResolvedValue({ id: 'ej-1' } as never);
    vi.mocked(prisma.employerJob.update).mockResolvedValue({} as never);
    vi.mocked(prisma.employerJob.count).mockResolvedValue(0 as never);
    vi.mocked(prisma.jobCharge.create).mockResolvedValue({} as never);
    vi.mocked(prisma.jobDraft.deleteMany).mockResolvedValue({ count: 1 } as never);
    vi.spyOn(config, 'isPromoActive').mockReturnValue(true);
});

afterEach(() => {
    vi.mocked(config.isPromoActive).mockRestore();
});

describe('the free post clears its author\'s draft, never one filed under the contact email', () => {
    it('deletes the drafts of the signed-in account that posted', async () => {
        expect(await postFree()).toBe(200);

        expect(prisma.jobDraft.deleteMany).toHaveBeenCalledTimes(1);
        expect(prisma.jobDraft.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    });

    it('never targets a draft by the contact email the form carried', async () => {
        expect(await postFree()).toBe(200);
        expect(prisma.jobDraft.deleteMany).toHaveBeenCalled();

        expect(JSON.stringify(vi.mocked(prisma.jobDraft.deleteMany).mock.calls)).not.toContain(SOMEONE_ELSES_EMAIL);
        expect(JSON.stringify(vi.mocked(prisma.jobDraft.deleteMany).mock.calls)).not.toContain('"email"');
    });
});

describe('the paid activation clears the drafts of the account that bought the post', () => {
    it('deletes the drafts of the account the checkout row belongs to', async () => {
        expect(await activatePaid({ userId: 'user-1' })).toBe('activated');

        expect(prisma.jobDraft.deleteMany).toHaveBeenCalledTimes(1);
        expect(prisma.jobDraft.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
        expect(JSON.stringify(vi.mocked(prisma.jobDraft.deleteMany).mock.calls)).not.toContain(SOMEONE_ELSES_EMAIL);
    });

    it('deletes no draft for a legacy row no account claimed', async () => {
        expect(await activatePaid({ userId: null })).toBe('activated');

        expect(prisma.jobDraft.deleteMany).not.toHaveBeenCalled();
    });
});
