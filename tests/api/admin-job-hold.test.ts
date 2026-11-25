/**
 * An admin takedown sticks (lib/admin/job-hold.ts).
 *
 * Unpublishing from the admin tools wrote what an employer's own pause
 * writes, so the owner could press Unpause, or buy a renewal, and undo a
 * removal made for a policy reason. A takedown now also sets adminHoldAt,
 * which only an admin clears, and isManuallyUnpublished, the flag every
 * automatic republisher leaves alone. These tests hold the admin job routes
 * to that, and the renewal checkout to refusing a posting under a hold. The
 * payment side is in webhooks-stripe-admin-hold.test.ts, the owner's resume
 * in employer-toggle-publish.test.ts and hunt-employer-takedown-sticks.test.ts.
 *
 * All fixtures are fictional.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { ADMIN_HOLD_MESSAGE } from '@/lib/admin/job-hold';

const mocks = vi.hoisted(() => ({ logAudit: vi.fn(), sessionsCreate: vi.fn() }));

vi.mock('@/lib/auth/require-api-admin', () => ({
    requireApiAdmin: vi.fn(async () => null),
    requireApiAdminActor: vi.fn(async () => ({ error: null, actor: { profileId: 'admin-profile-fic-1', supabaseId: 'admin-fic-1' } })),
    limitHighImpactAdminAction: vi.fn(async () => null),
}));
vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'admin-fic-1' } } }) } })),
}));
vi.mock('@/lib/audit-log', () => ({ logAudit: mocks.logAudit }));
vi.mock('@/lib/inngest/client', () => ({ inngest: { send: vi.fn(() => Promise.resolve()) } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('stripe', () => ({
    default: vi.fn().mockImplementation(() => ({
        checkout: { sessions: { create: mocks.sessionsCreate, list: vi.fn(), expire: vi.fn() } },
    })),
}));
vi.mock('@/lib/env', () => ({
    isFeatureEnabled: vi.fn((feature: string) => feature === 'paidPosting'),
    getEnv: vi.fn(() => ({ STRIPE_WEBHOOK_SECRET: 'whsec_x' })),
    getBaseUrl: vi.fn(() => 'http://localhost:3000'),
}));
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn().mockResolvedValue(null),
    RATE_LIMITS: { postJob: { limit: 100, windowMs: 60_000 } },
}));

const JOB_ID = 'job-fic-1';
const IDS = ['job-fic-1', 'job-fic-2'];
const DAY = 24 * 60 * 60 * 1000;
const EARLIER_HOLD = new Date('2026-10-01T00:00:00.000Z');
const TAKEDOWN = { isPublished: false, isManuallyUnpublished: true, adminHoldAt: expect.any(Date) };
const RELEASE = { isPublished: true, isManuallyUnpublished: false, adminHoldAt: null };

interface StoredState {
    id: string;
    isPublished: boolean;
    adminHoldAt: Date | null;
    archivedAt: Date | null;
    employerJobs: { paymentStatus: string; updatedAt: Date } | null;
}

/** The job row as the admin routes read it before they write. */
function storedJob(state: Partial<StoredState> = {}) {
    const id = state.id ?? JOB_ID;
    return {
        id,
        title: 'NP (Fixture)',
        employer: 'Fictional Clinic',
        location: 'Austin, TX',
        description: 'A fictional posting.',
        applyLink: 'https://clinic.example/apply',
        isFeatured: false,
        expiresAt: null,
        slug: `np-fixture-${id}`,
        isPublished: true,
        adminHoldAt: null,
        archivedAt: null,
        employerJobs: null,
        _count: { jobApplications: 0 },
        ...state,
    };
}

function request(method: string, url: string, body?: unknown): NextRequest {
    return new NextRequest(url, {
        method,
        ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
}

const params = { params: Promise.resolve({ id: JOB_ID }) };
const updateArgs = () => vi.mocked(prisma.job.update).mock.calls[0][0] as { where: Record<string, unknown>; data: Record<string, unknown> };
const auditEntries = () => mocks.logAudit.mock.calls.map((call) => call[0] as { action: string; targetId: string; actorId: string; metadata: Record<string, unknown> });

// Load the route graphs once, outside any single test's time budget.
beforeAll(async () => {
    await import('@/app/api/admin/jobs/[id]/route');
    await import('@/app/api/admin/jobs/bulk/route');
    await import('@/app/api/create-renewal-checkout/route');
}, 60_000);

beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_fixture';
    vi.mocked(prisma.job.update).mockImplementation((async ({ data }: { data: Record<string, unknown> }) => ({ ...storedJob(), ...data })) as never);
    vi.mocked(prisma.job.updateMany).mockResolvedValue({ count: 1 } as never);
});

describe('PATCH /api/admin/jobs/:id', () => {
    const patch = async (body: unknown) => {
        const { PATCH } = await import('@/app/api/admin/jobs/[id]/route');
        return PATCH(request('PATCH', `http://localhost/api/admin/jobs/${JOB_ID}`, body), params);
    };

    it('unpublishing a live posting places the hold and records it', async () => {
        vi.mocked(prisma.job.findUnique).mockResolvedValue(storedJob() as never);

        expect((await patch({ isPublished: false })).status).toBe(200);

        expect(updateArgs().data).toEqual(TAKEDOWN);
        expect(updateArgs().where).toEqual({ id: JOB_ID });
        expect(auditEntries()[0]).toMatchObject({
            action: 'admin.job.unpublish',
            actorId: 'admin-fic-1',
            targetId: JOB_ID,
            metadata: { hold: 'placed' },
        });
    });

    it('unpublishing a posting its owner had already paused places the hold too', async () => {
        // Otherwise the takedown would leave the owner one Unpause away from undoing it.
        vi.mocked(prisma.job.findUnique).mockResolvedValue(storedJob({ isPublished: false }) as never);

        expect((await patch({ isPublished: false })).status).toBe(200);

        expect(updateArgs().data).toEqual(TAKEDOWN);
        expect(auditEntries()[0].metadata.hold).toBe('placed');
    });

    it("a second takedown keeps the first one's time", async () => {
        vi.mocked(prisma.job.findUnique).mockResolvedValue(storedJob({ isPublished: false, adminHoldAt: EARLIER_HOLD }) as never);

        expect((await patch({ isPublished: false })).status).toBe(200);

        expect(updateArgs().data).toEqual({ isPublished: false, isManuallyUnpublished: true, adminHoldAt: EARLIER_HOLD });
        expect(auditEntries()[0].metadata.hold).toBe('kept');
    });

    it('publishing lifts the hold, carries the publish guard into the write, and records it', async () => {
        vi.mocked(prisma.job.findUnique).mockResolvedValue(storedJob({ isPublished: false, adminHoldAt: EARLIER_HOLD }) as never);

        expect((await patch({ isPublished: true })).status).toBe(200);

        expect(updateArgs().data).toMatchObject(RELEASE);
        // A revival: the posting's content counts as changed now.
        expect(updateArgs().data.contentChangedAt).toBeInstanceOf(Date);
        expect(updateArgs().where).toMatchObject({ id: JOB_ID, archivedAt: null });
        expect(updateArgs().where.OR).toEqual(expect.arrayContaining([{ employerJobs: { is: null } }]));
        expect(auditEntries()[0]).toMatchObject({ action: 'admin.job.publish', metadata: { hold: 'lifted' } });
    });

    it('an edit that does not carry isPublished leaves the hold fields alone', async () => {
        // What the edit form sends: text fields, never the publish toggle.
        vi.mocked(prisma.job.findUnique).mockResolvedValue(storedJob({ isPublished: false, adminHoldAt: EARLIER_HOLD }) as never);

        expect((await patch({ title: 'NP, Outpatient (Fixture)', isFeatured: true })).status).toBe(200);

        expect(updateArgs().data).not.toHaveProperty('adminHoldAt');
        expect(updateArgs().data).not.toHaveProperty('isManuallyUnpublished');
        expect(updateArgs().data).not.toHaveProperty('isPublished');
        expect(auditEntries()[0].metadata).not.toHaveProperty('hold');
    });

    it('clears the cached job page after the write', async () => {
        vi.mocked(prisma.job.findUnique).mockResolvedValue(storedJob() as never);

        await patch({ isPublished: false });

        expect(revalidatePath).toHaveBeenCalledWith(`/jobs/np-fixture-${JOB_ID}`);
    });

    it('answers 404 for a posting that does not exist, and writes and records nothing', async () => {
        vi.mocked(prisma.job.findUnique).mockResolvedValue(null as never);

        expect((await patch({ isPublished: false })).status).toBe(404);

        expect(prisma.job.update).not.toHaveBeenCalled();
        expect(mocks.logAudit).not.toHaveBeenCalled();
    });
});

describe('DELETE /api/admin/jobs/:id (soft)', () => {
    const softDelete = async () => {
        const { DELETE } = await import('@/app/api/admin/jobs/[id]/route');
        return DELETE(request('DELETE', `http://localhost/api/admin/jobs/${JOB_ID}`), params);
    };

    it('is a takedown, recorded, and clears the cached page', async () => {
        vi.mocked(prisma.job.findUnique).mockResolvedValue(storedJob() as never);

        const res = await softDelete();

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ success: true, action: 'soft_deleted' });
        expect(updateArgs()).toEqual({ where: { id: JOB_ID }, data: TAKEDOWN });
        expect(auditEntries()[0]).toMatchObject({ action: 'admin.job.soft_delete', metadata: { hold: 'placed' } });
        expect(revalidatePath).toHaveBeenCalledWith(`/jobs/np-fixture-${JOB_ID}`);
    });

    it("keeps the time of an earlier takedown", async () => {
        vi.mocked(prisma.job.findUnique).mockResolvedValue(storedJob({ isPublished: false, adminHoldAt: EARLIER_HOLD }) as never);

        await softDelete();

        expect(updateArgs().data).toEqual({ isPublished: false, isManuallyUnpublished: true, adminHoldAt: EARLIER_HOLD });
        expect(auditEntries()[0].metadata.hold).toBe('kept');
    });
});

describe('POST /api/admin/jobs/bulk', () => {
    const bulk = async (action: string) => {
        const { POST } = await import('@/app/api/admin/jobs/bulk/route');
        return POST(request('POST', 'http://localhost/api/admin/jobs/bulk', { action, jobIds: IDS }));
    };

    it.each(['unpublish', 'delete'])("%s places the hold on every posting named, keeping an earlier takedown's time", async (action) => {
        vi.mocked(prisma.job.findMany).mockResolvedValue([
            storedJob({ id: IDS[0] }),
            storedJob({ id: IDS[1], isPublished: false, adminHoldAt: EARLIER_HOLD }),
        ] as never);

        const res = await bulk(action);

        expect(res.status).toBe(200);
        expect((await res.json()).affected).toBe(2);
        const [placed, kept] = vi.mocked(prisma.job.updateMany).mock.calls.map((call) => call[0]);
        // Postings with no hold get one now, a posting its owner had paused included.
        expect(placed).toEqual({ where: { id: { in: IDS }, adminHoldAt: null }, data: TAKEDOWN });
        // Postings already held stay down, and their adminHoldAt is not written again.
        expect(kept).toEqual({ where: { id: { in: IDS }, adminHoldAt: { not: null } }, data: { isPublished: false, isManuallyUnpublished: true } });
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(auditEntries().map((entry) => [entry.action, entry.targetId, entry.metadata.hold])).toEqual([
            [`admin.job.bulk_${action}`, IDS[0], 'placed'],
            [`admin.job.bulk_${action}`, IDS[1], 'kept'],
        ]);
        expect(revalidatePath).toHaveBeenCalledWith(`/jobs/np-fixture-${IDS[0]}`);
        expect(revalidatePath).toHaveBeenCalledWith(`/jobs/np-fixture-${IDS[1]}`);
    });

    it('publish lifts the hold, behind the publish guard, and is recorded', async () => {
        vi.mocked(prisma.job.findMany).mockResolvedValue([
            storedJob({ id: IDS[0], isPublished: false, adminHoldAt: EARLIER_HOLD }),
            storedJob({ id: IDS[1], isPublished: false }),
        ] as never);

        expect((await bulk('publish')).status).toBe(200);

        const [live, revived] = vi.mocked(prisma.job.updateMany).mock.calls.map((call) => call[0] as { where: Record<string, unknown>; data: Record<string, unknown> });
        expect(live).toEqual({ where: { id: { in: IDS }, isPublished: true }, data: RELEASE });
        expect(revived.where).toMatchObject({ id: { in: IDS }, isPublished: false, archivedAt: null });
        expect(revived.data).toMatchObject(RELEASE);
        expect(auditEntries().map((entry) => entry.metadata.hold)).toEqual(['lifted', 'none']);
    });

    it('featuring leaves the hold fields alone', async () => {
        vi.mocked(prisma.job.findMany).mockResolvedValue([storedJob({ id: IDS[0] }), storedJob({ id: IDS[1] })] as never);

        expect((await bulk('feature')).status).toBe(200);

        expect(vi.mocked(prisma.job.updateMany).mock.calls[0][0].data).toEqual({ isFeatured: true });
        expect(auditEntries().map((entry) => entry.action)).toEqual(['admin.job.bulk_feature', 'admin.job.bulk_feature']);
        expect(auditEntries()[0].metadata).not.toHaveProperty('hold');
    });
});

describe('POST /api/create-renewal-checkout', () => {
    it('sells no renewal on a posting under a hold', async () => {
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({
            id: 'employer-job-fic-1',
            jobId: JOB_ID,
            editToken: 'edit-token-fic-1',
            contactEmail: 'hiring@clinic.example',
            paymentStatus: 'paid',
            pricingTier: 'pro',
            jobCharges: [],
            job: {
                id: JOB_ID,
                title: 'NP Outpatient (Fixture)',
                employer: 'Fictional Clinic',
                location: 'Austin, TX',
                createdAt: new Date(Date.now() - 40 * DAY),
                expiresAt: new Date(Date.now() - 3 * DAY),
                archivedAt: null,
                adminHoldAt: new Date(),
            },
        } as never);
        const { POST } = await import('@/app/api/create-renewal-checkout/route');

        const res = await POST(request('POST', 'http://localhost/api/create-renewal-checkout', { jobId: JOB_ID, editToken: 'edit-token-fic-1' }));

        expect(res.status).toBe(409);
        // The takedown, not a payment state, which the owner could do something about.
        expect(await res.json()).toEqual({ error: ADMIN_HOLD_MESSAGE, cause: 'admin_hold' });
        expect(mocks.sessionsCreate).not.toHaveBeenCalled();
        const lookup = vi.mocked(prisma.employerJob.findFirst).mock.calls[0][0] as { include: { job: { select: Record<string, boolean> } } };
        expect(lookup.include.job.select.adminHoldAt).toBe(true);
    });
});
