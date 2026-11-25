/**
 * Hunt ADMIN-01 and ADMIN-03 (jobs), as the sister boards fixed them.
 *
 *   - An admin unpublish sticks against ingest and every other automatic
 *     republisher (the manual flag) and against the owner (the hold).
 *   - A hard delete cascades through employer_jobs and job_applications.
 *     The single DELETE refused only free and paid posts, and the bulk
 *     hard_delete only free ones, so a bulk call could delete a paid post
 *     with its EmployerJob row and the candidates' applications. Both now
 *     refuse every employer post except an unpaid one whose checkout can no
 *     longer be paid, and any job with applications, and carry the same
 *     guard into the delete itself.
 *   - An admin publish does not make an archived or unpaid post live.
 *
 * All fixtures are fictional.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import {
    HARD_DELETE_APPLICATIONS_MESSAGE,
    HARD_DELETE_CHANGED_MESSAGE,
    HARD_DELETE_OPEN_CHECKOUT_MESSAGE,
    HARD_DELETE_PAID_MESSAGE,
    PUBLISH_BLOCKED_MESSAGE,
} from '@/app/api/admin/_lib/job-takedown';

const mocks = vi.hoisted(() => ({ logAudit: vi.fn() }));

vi.mock('@/lib/auth/require-api-admin', () => ({
    requireApiAdmin: vi.fn().mockResolvedValue(null),
    requireApiAdminActor: vi.fn().mockResolvedValue({ error: null, actor: { profileId: 'admin-profile-1', supabaseId: 'sb-admin-1' } }),
    limitHighImpactAdminAction: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn().mockResolvedValue({
        auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'sb-admin-1' } } }) },
    }),
}));
vi.mock('@/lib/audit-log', () => ({ logAudit: mocks.logAudit }));
vi.mock('@/lib/inngest/client', () => ({ inngest: { send: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

interface JobState {
    id: string;
    isPublished: boolean;
    adminHoldAt: Date | null;
    archivedAt: Date | null;
    employerJobs: { paymentStatus: string; updatedAt: Date } | null;
    applications: number;
}

function stored(state: Partial<JobState> = {}) {
    const { applications = 0, ...rest } = state;
    const id = rest.id ?? 'j1';
    return {
        id,
        title: 'Psychiatric NP (Fixture)',
        employer: 'Acme Clinic (Fixture)',
        location: 'Remote',
        description: 'A fictional posting.',
        applyLink: 'https://clinic.example/apply',
        isFeatured: false,
        expiresAt: null,
        slug: `psychiatric-np-${id}`,
        isPublished: true,
        adminHoldAt: null,
        archivedAt: null,
        employerJobs: null,
        _count: { jobApplications: applications },
        ...rest,
    };
}

const employer = (paymentStatus: string, updatedAt: Date = new Date(Date.now() - DAY)) => ({ paymentStatus, updatedAt });

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(url, init);
const patch = (body: Record<string, unknown>) =>
    req('https://example.com/api/admin/jobs/j1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
const bulk = (action: string, jobIds: unknown[]) =>
    req('https://example.com/api/admin/jobs/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, jobIds }),
    });
const hardDeleteRequest = () => req('https://example.com/api/admin/jobs/j1?hard=true', { method: 'DELETE' });

async function routes() {
    const single = await import('@/app/api/admin/jobs/[id]/route');
    const many = await import('@/app/api/admin/jobs/bulk/route');
    return { PATCH: single.PATCH, DELETE: single.DELETE, BULK: many.POST };
}

beforeAll(async () => {
    await routes();
}, 60_000);

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.job.update).mockImplementation((async ({ data }: { data: Record<string, unknown> }) => ({ ...stored(), ...data })) as never);
    vi.mocked(prisma.job.updateMany).mockResolvedValue({ count: 2 } as never);
    vi.mocked(prisma.job.deleteMany).mockResolvedValue({ count: 1 } as never);
});

describe('an admin unpublish marks the job as taken down by a person', () => {
    it('PATCH isPublished=false sets the manual flag so ingest skips it, and the hold', async () => {
        vi.mocked(prisma.job.findUnique).mockResolvedValue(stored() as never);
        const { PATCH } = await routes();

        const res = await PATCH(patch({ isPublished: false }), ctx('j1'));

        expect(res.status).toBe(200);
        const data = vi.mocked(prisma.job.update).mock.calls[0][0].data as Record<string, unknown>;
        expect(data).toMatchObject({ isPublished: false, isManuallyUnpublished: true });
        expect(data.adminHoldAt).toBeInstanceOf(Date);
        expect(mocks.logAudit).toHaveBeenCalledWith(expect.objectContaining({ targetId: 'j1', actorId: 'sb-admin-1' }));
    });

    it('PATCH isPublished=true clears the manual flag', async () => {
        vi.mocked(prisma.job.findUnique).mockResolvedValue(stored({ isPublished: false, adminHoldAt: new Date() }) as never);
        const { PATCH } = await routes();

        await PATCH(patch({ isPublished: true }), ctx('j1'));

        expect(vi.mocked(prisma.job.update).mock.calls[0][0].data).toMatchObject({ isPublished: true, isManuallyUnpublished: false });
    });

    it('a PATCH that does not touch isPublished leaves the flag alone', async () => {
        vi.mocked(prisma.job.findUnique).mockResolvedValue(stored() as never);
        const { PATCH } = await routes();

        await PATCH(patch({ title: 'Psychiatric NP (Edited Fixture)' }), ctx('j1'));

        expect(vi.mocked(prisma.job.update).mock.calls[0][0].data).not.toHaveProperty('isManuallyUnpublished');
    });

    it('a soft DELETE sets the manual flag and is recorded', async () => {
        vi.mocked(prisma.job.findUnique).mockResolvedValue(stored() as never);
        const { DELETE } = await routes();

        const res = await DELETE(req('https://example.com/api/admin/jobs/j1', { method: 'DELETE' }), ctx('j1'));

        expect(res.status).toBe(200);
        expect(vi.mocked(prisma.job.update).mock.calls[0][0].data).toMatchObject({ isPublished: false, isManuallyUnpublished: true });
        expect(mocks.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'admin.job.soft_delete', actorId: 'sb-admin-1' }));
    });

    it.each(['unpublish', 'delete'])('bulk %s sets the manual flag on every job and records each', async (action) => {
        vi.mocked(prisma.job.findMany).mockResolvedValue([stored({ id: 'j1' }), stored({ id: 'j2' })] as never);
        const { BULK } = await routes();

        const res = await BULK(bulk(action, ['j1', 'j2']));

        expect(res.status).toBe(200);
        for (const [args] of vi.mocked(prisma.job.updateMany).mock.calls) {
            expect((args as { data: Record<string, unknown> }).data).toMatchObject({ isPublished: false, isManuallyUnpublished: true });
        }
        expect(mocks.logAudit.mock.calls.map(([entry]) => entry.targetId)).toEqual(['j1', 'j2']);
        expect(mocks.logAudit.mock.calls.every(([entry]) => entry.actorId === 'sb-admin-1')).toBe(true);
    });

    it('bulk publish clears the manual flag', async () => {
        vi.mocked(prisma.job.findMany).mockResolvedValue([stored({ id: 'j1', isPublished: false })] as never);
        const { BULK } = await routes();

        await BULK(bulk('publish', ['j1']));

        expect(vi.mocked(prisma.job.updateMany).mock.calls[0][0].data).toMatchObject({ isPublished: true, isManuallyUnpublished: false });
    });
});

describe('a hard delete refuses an employer post that was paid for', () => {
    it('single: a paid post answers 409 telling the admin to unpublish, and nothing is deleted or recorded', async () => {
        vi.mocked(prisma.job.findUnique).mockResolvedValue(stored({ employerJobs: employer('paid') }) as never);
        const { DELETE } = await routes();

        const res = await DELETE(hardDeleteRequest(), ctx('j1'));

        expect(res.status).toBe(409);
        expect((await res.json()).error).toBe(HARD_DELETE_PAID_MESSAGE);
        expect(prisma.job.deleteMany).not.toHaveBeenCalled();
        expect(mocks.logAudit).not.toHaveBeenCalled();
    });

    it.each(['free', 'promo', 'pack', 'plan', 'refunded', 'disputed'])("single: a '%s' post is refused the same way", async (status) => {
        vi.mocked(prisma.job.findUnique).mockResolvedValue(stored({ employerJobs: employer(status) }) as never);
        const { DELETE } = await routes();

        expect((await DELETE(hardDeleteRequest(), ctx('j1'))).status).toBe(409);
        expect(prisma.job.deleteMany).not.toHaveBeenCalled();
    });

    it('single: a checkout opened an hour ago is refused as one that can still be paid, not as a paid post', async () => {
        vi.mocked(prisma.job.findUnique).mockResolvedValue(stored({ employerJobs: employer('pending', new Date(Date.now() - HOUR)) }) as never);
        const { DELETE } = await routes();

        const res = await DELETE(hardDeleteRequest(), ctx('j1'));

        expect(res.status).toBe(409);
        expect((await res.json()).error).toBe(HARD_DELETE_OPEN_CHECKOUT_MESSAGE);
        expect(prisma.job.deleteMany).not.toHaveBeenCalled();
    });

    it('single: an ingested job that candidates applied to is refused, so their application lists keep it', async () => {
        vi.mocked(prisma.job.findUnique).mockResolvedValue(stored({ applications: 3 }) as never);
        const { DELETE } = await routes();

        const res = await DELETE(hardDeleteRequest(), ctx('j1'));

        expect(res.status).toBe(409);
        expect((await res.json()).error).toBe(HARD_DELETE_APPLICATIONS_MESSAGE);
        expect(prisma.job.deleteMany).not.toHaveBeenCalled();
    });

    it('single: a job with no employer row and no applications is deleted with the guard in the delete, recorded, and its page cleared', async () => {
        vi.mocked(prisma.job.findUnique).mockResolvedValue(stored() as never);
        const { DELETE } = await routes();

        const res = await DELETE(hardDeleteRequest(), ctx('j1'));

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ success: true, action: 'hard_deleted' });
        const where = vi.mocked(prisma.job.deleteMany).mock.calls[0][0]?.where as Record<string, unknown>;
        expect(where).toMatchObject({ id: 'j1', jobApplications: { none: {} } });
        expect(where.OR).toEqual(expect.arrayContaining([{ employerJobs: { is: null } }, { employerJobs: { is: { paymentStatus: 'expired' } } }]));
        expect(mocks.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'admin.job.hard_delete', targetId: 'j1' }));
        expect(revalidatePath).toHaveBeenCalledWith('/jobs/psychiatric-np-j1');
    });

    it('single: an abandoned checkout the daily payment check expired is deleted', async () => {
        vi.mocked(prisma.job.findUnique).mockResolvedValue(stored({ employerJobs: employer('expired') }) as never);
        const { DELETE } = await routes();

        expect((await DELETE(hardDeleteRequest(), ctx('j1'))).status).toBe(200);
        expect(prisma.job.deleteMany).toHaveBeenCalledTimes(1);
    });

    it('single: a payment or an application landing after the read keeps the row, and the admin is told', async () => {
        vi.mocked(prisma.job.findUnique).mockResolvedValue(stored({ employerJobs: employer('expired') }) as never);
        vi.mocked(prisma.job.deleteMany).mockResolvedValue({ count: 0 } as never);
        const { DELETE } = await routes();

        const res = await DELETE(hardDeleteRequest(), ctx('j1'));

        expect(res.status).toBe(409);
        expect((await res.json()).error).toBe(HARD_DELETE_CHANGED_MESSAGE);
        expect(mocks.logAudit).not.toHaveBeenCalled();
    });

    it('bulk: one paid post in the selection blocks the whole call and is named', async () => {
        vi.mocked(prisma.job.findMany).mockResolvedValue([stored({ id: 'j1' }), stored({ id: 'j2', employerJobs: employer('paid') })] as never);
        const { BULK } = await routes();

        const res = await BULK(bulk('hard_delete', ['j1', 'j2']));

        expect(res.status).toBe(409);
        const body = await res.json();
        expect(body.blockedJobIds).toEqual(['j2']);
        expect(body.error).toBe(HARD_DELETE_PAID_MESSAGE);
        expect(prisma.job.deleteMany).not.toHaveBeenCalled();
    });

    it('bulk: a job with applications blocks the call and is named', async () => {
        vi.mocked(prisma.job.findMany).mockResolvedValue([stored({ id: 'j1' }), stored({ id: 'j2', applications: 1 })] as never);
        const { BULK } = await routes();

        const res = await BULK(bulk('hard_delete', ['j1', 'j2']));

        expect(res.status).toBe(409);
        expect((await res.json()).blockedJobIds).toEqual(['j2']);
        expect(prisma.job.deleteMany).not.toHaveBeenCalled();
    });

    it('bulk: a paid post among open checkouts is refused as a paid post, naming every blocked id', async () => {
        vi.mocked(prisma.job.findMany).mockResolvedValue([
            stored({ id: 'j1', employerJobs: employer('pending', new Date(Date.now() - HOUR)) }),
            stored({ id: 'j2', employerJobs: employer('paid') }),
            stored({ id: 'j3' }),
        ] as never);
        const { BULK } = await routes();

        const res = await BULK(bulk('hard_delete', ['j1', 'j2', 'j3']));

        expect(res.status).toBe(409);
        const body = await res.json();
        expect(body.blockedJobIds).toEqual(['j1', 'j2']);
        expect(body.error).toBe(HARD_DELETE_PAID_MESSAGE);
    });

    it('bulk: a deletable selection is deleted behind the guard, and each job is recorded and its page cleared', async () => {
        vi.mocked(prisma.job.findMany)
            .mockResolvedValueOnce([stored({ id: 'j1' }), stored({ id: 'j2', employerJobs: employer('expired') })] as never)
            .mockResolvedValueOnce([] as never);
        const { BULK } = await routes();

        const res = await BULK(bulk('hard_delete', ['j1', 'j2']));

        expect(res.status).toBe(200);
        expect((await res.json()).affected).toBe(2);
        const where = vi.mocked(prisma.job.deleteMany).mock.calls[0][0]?.where as Record<string, unknown>;
        expect(where).toMatchObject({ id: { in: ['j1', 'j2'] }, jobApplications: { none: {} } });
        expect(mocks.logAudit.mock.calls.map(([entry]) => [entry.action, entry.targetId])).toEqual([
            ['admin.job.bulk_hard_delete', 'j1'],
            ['admin.job.bulk_hard_delete', 'j2'],
        ]);
        expect(revalidatePath).toHaveBeenCalledWith('/jobs/psychiatric-np-j1');
        expect(revalidatePath).toHaveBeenCalledWith('/jobs/psychiatric-np-j2');
    });

    it('bulk: a row the guarded delete kept is reported, not recorded as deleted', async () => {
        vi.mocked(prisma.job.findMany)
            .mockResolvedValueOnce([stored({ id: 'j1' }), stored({ id: 'j2' })] as never)
            .mockResolvedValueOnce([{ id: 'j2' }] as never);
        const { BULK } = await routes();

        const body = await (await BULK(bulk('hard_delete', ['j1', 'j2']))).json();

        expect(body).toMatchObject({ success: true, affected: 1, skippedJobIds: ['j2'] });
        expect(mocks.logAudit.mock.calls.map(([entry]) => entry.targetId)).toEqual(['j1']);
    });

    it('bulk: rejects non-string ids before touching the database', async () => {
        const { BULK } = await routes();

        const res = await BULK(bulk('unpublish', [{ $ne: 1 }]));

        expect(res.status).toBe(400);
        expect(prisma.job.findMany).not.toHaveBeenCalled();
        expect(prisma.job.updateMany).not.toHaveBeenCalled();
    });
});

describe('an admin publish does not make an archived or unpaid post live', () => {
    it('PATCH refuses to publish an archived posting, and writes and records nothing', async () => {
        vi.mocked(prisma.job.findUnique).mockResolvedValue(stored({ isPublished: false, archivedAt: new Date() }) as never);
        const { PATCH } = await routes();

        const res = await PATCH(patch({ isPublished: true }), ctx('j1'));

        expect(res.status).toBe(409);
        expect((await res.json()).error).toBe(PUBLISH_BLOCKED_MESSAGE);
        expect(prisma.job.update).not.toHaveBeenCalled();
        expect(mocks.logAudit).not.toHaveBeenCalled();
    });

    it.each(['pending', 'expired'])("PATCH refuses to publish a post whose checkout was never paid ('%s')", async (status) => {
        vi.mocked(prisma.job.findUnique).mockResolvedValue(stored({ isPublished: false, employerJobs: employer(status) }) as never);
        const { PATCH } = await routes();

        expect((await PATCH(patch({ isPublished: true }), ctx('j1'))).status).toBe(409);
        expect(prisma.job.update).not.toHaveBeenCalled();
    });

    it.each(['refunded', 'disputed'])('PATCH refuses a %s post with a reason that covers it', async (status) => {
        vi.mocked(prisma.job.findUnique).mockResolvedValue(stored({ isPublished: false, employerJobs: employer(status) }) as never);
        const { PATCH } = await routes();

        const res = await PATCH(patch({ isPublished: true }), ctx('j1'));

        expect(res.status).toBe(409);
        expect((await res.json()).error).toMatch(/refunded or disputed/);
    });

    it('PATCH publishes a paid post under a hold and an ingested job', async () => {
        const { PATCH } = await routes();
        vi.mocked(prisma.job.findUnique).mockResolvedValue(stored({ isPublished: false, adminHoldAt: new Date(), employerJobs: employer('paid') }) as never);
        expect((await PATCH(patch({ isPublished: true }), ctx('j1'))).status).toBe(200);

        vi.mocked(prisma.job.findUnique).mockResolvedValue(stored({ isPublished: false }) as never);
        expect((await PATCH(patch({ isPublished: true }), ctx('j1'))).status).toBe(200);
    });

    it('PATCH: a refund or an archive landing after the read makes the guarded publish match nothing, and is refused', async () => {
        vi.mocked(prisma.job.findUnique).mockResolvedValue(stored({ isPublished: false, employerJobs: employer('paid') }) as never);
        vi.mocked(prisma.job.update).mockRejectedValueOnce(Object.assign(new Error('No record was found for an update.'), { code: 'P2025' }));
        const { PATCH } = await routes();

        const res = await PATCH(patch({ isPublished: true }), ctx('j1'));

        expect(res.status).toBe(409);
        expect((await res.json()).error).toBe(PUBLISH_BLOCKED_MESSAGE);
        expect(mocks.logAudit).not.toHaveBeenCalled();
    });

    it('bulk publish skips the blocked rows, publishes the rest and records only the rest', async () => {
        vi.mocked(prisma.job.findMany).mockResolvedValue([
            stored({ id: 'j1', isPublished: false }),
            stored({ id: 'j2', isPublished: false, employerJobs: employer('refunded') }),
        ] as never);
        const { BULK } = await routes();

        const res = await BULK(bulk('publish', ['j1', 'j2']));

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toMatchObject({ affected: 1, skippedJobIds: ['j2'] });
        for (const [args] of vi.mocked(prisma.job.updateMany).mock.calls) {
            expect((args as { where: { id: unknown } }).where.id).toEqual({ in: ['j1'] });
        }
        expect(mocks.logAudit.mock.calls.map(([entry]) => [entry.action, entry.targetId])).toEqual([['admin.job.bulk_publish', 'j1']]);
    });

    it('bulk publish of blocked rows only answers 409 and writes nothing', async () => {
        vi.mocked(prisma.job.findMany).mockResolvedValue([stored({ id: 'j1', isPublished: false, archivedAt: new Date() })] as never);
        const { BULK } = await routes();

        const res = await BULK(bulk('publish', ['j1']));

        expect(res.status).toBe(409);
        expect(await res.json()).toEqual({ success: false, error: PUBLISH_BLOCKED_MESSAGE, skippedJobIds: ['j1'] });
        expect(prisma.job.updateMany).not.toHaveBeenCalled();
        expect(mocks.logAudit).not.toHaveBeenCalled();
    });
});
