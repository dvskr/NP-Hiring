/**
 * P10 admin-jobs-api regressions (app/api/admin/jobs/**).
 *
 *   1. every mutating branch (create, PATCH, soft/hard DELETE, bulk) writes an
 *      AuditLog row carrying the admin actor;
 *   2. bulk hard_delete refuses free postings (quota guard parity with DELETE ?hard=true);
 *   3. PATCH validates types/shape (400, nothing written);
 *   4. admin unpublish sets isManuallyUnpublished (republish clears it);
 *   5. POST validates numbers and apply-link URLs;
 *   6. GET clamps non-numeric paging to defaults.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const db = vi.hoisted(() => ({
    job: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        deleteMany: vi.fn(),
        create: vi.fn(),
        count: vi.fn(),
        groupBy: vi.fn(),
    },
}));
const logAudit = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: db }));
vi.mock('@/lib/audit-log', () => ({ logAudit }));
vi.mock('@/lib/auth/require-api-admin', () => ({ requireApiAdmin: vi.fn(async () => null) }));
vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({
        auth: { getUser: async () => ({ data: { user: { id: 'admin-supabase-id', email: 'admin@example.test' } } }) },
    })),
}));
vi.mock('@/lib/inngest/client', () => ({ inngest: { send: vi.fn(() => Promise.resolve()) } }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { PATCH, DELETE } from '@/app/api/admin/jobs/[id]/route';
import { GET, POST } from '@/app/api/admin/jobs/route';
import { POST as BULK } from '@/app/api/admin/jobs/bulk/route';
import { normalizeApplyLink, parsePagingParam, validateJobUpdate } from '@/app/api/admin/jobs/_lib/job-input';

const JOB_ID = 'job-1';
const params = { params: Promise.resolve({ id: JOB_ID }) };
const jsonReq = (url: string, method: string, body?: unknown) =>
    new NextRequest(`http://127.0.0.1:3000${url}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    });

const priorJob = {
    title: 'Psych NP', employer: 'Acme', location: 'Austin, TX', description: 'desc',
    applyLink: 'https://acme.example/apply', isPublished: true, isFeatured: false, expiresAt: null,
    employerJobs: null,
};

beforeEach(() => {
    vi.clearAllMocks();
    db.job.findUnique.mockResolvedValue(priorJob);
    db.job.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: JOB_ID, ...priorJob, ...data }));
});

describe('PATCH /api/admin/jobs/:id', () => {
    it.each([
        [{ isPublished: 'yes' }],
        [{ title: '' }],
        [{ title: '   ' }],
        [{ applyLink: 'javascript:alert(1)' }],
        [{ applyLink: 'mailto:x@example.com' }],
        [{ minSalary: 'abc' }],
        [{ benefits: 'dental' }],
        [{ qualityScore: 1.5 }],
    ])('rejects %j with 400 and writes nothing', async (body) => {
        const res = await PATCH(jsonReq(`/api/admin/jobs/${JOB_ID}`, 'PATCH', body), params);
        expect(res.status).toBe(400);
        expect(db.job.update).not.toHaveBeenCalled();
        expect(logAudit).not.toHaveBeenCalled();
    });

    it('unpublish pins isManuallyUnpublished and writes an admin.job.unpublish audit row with the actor', async () => {
        const res = await PATCH(jsonReq(`/api/admin/jobs/${JOB_ID}`, 'PATCH', { isPublished: false }), params);
        expect(res.status).toBe(200);
        const data = db.job.update.mock.calls[0][0].data;
        expect(data).toMatchObject({ isPublished: false, isManuallyUnpublished: true });
        expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
            action: 'admin.job.unpublish', actorType: 'admin', actorId: 'admin-supabase-id', targetType: 'job', targetId: JOB_ID,
        }));
    });

    it('republish clears isManuallyUnpublished', async () => {
        await PATCH(jsonReq(`/api/admin/jobs/${JOB_ID}`, 'PATCH', { isPublished: true }), params);
        expect(db.job.update.mock.calls[0][0].data).toMatchObject({ isPublished: true, isManuallyUnpublished: false });
        expect(logAudit.mock.calls[0][0].action).toBe('admin.job.publish');
    });

    it('edit-modal payload (unchanged link, blank optionals) saves and audits admin.job.update', async () => {
        const res = await PATCH(jsonReq(`/api/admin/jobs/${JOB_ID}`, 'PATCH', {
            title: 'Psych NP (edited)', employer: 'Acme', location: 'Austin, TX',
            displaySalary: '', jobType: '', mode: '', applyLink: 'https://acme.example/apply',
        }), params);
        expect(res.status).toBe(200);
        const data = db.job.update.mock.calls[0][0].data;
        expect(data).toMatchObject({ title: 'Psych NP (edited)', displaySalary: null, jobType: null });
        expect(data).not.toHaveProperty('applyLink');
        expect(logAudit.mock.calls[0][0]).toMatchObject({ action: 'admin.job.update', targetId: JOB_ID });
        expect(logAudit.mock.calls[0][0].metadata.changes.title).toEqual({ from: 'Psych NP', to: 'Psych NP (edited)' });
    });

    it('an unchanged legacy (non-http) apply link can be resent, but a new one cannot', () => {
        expect(validateJobUpdate({ applyLink: 'mailto:jobs@acme.example' }, 'mailto:jobs@acme.example').ok).toBe(true);
        expect(validateJobUpdate({ applyLink: 'mailto:jobs@acme.example' }, 'https://acme.example').ok).toBe(false);
    });

    it('404s an unknown job instead of a Prisma 500', async () => {
        db.job.findUnique.mockResolvedValue(null);
        const res = await PATCH(jsonReq(`/api/admin/jobs/${JOB_ID}`, 'PATCH', { isFeatured: true }), params);
        expect(res.status).toBe(404);
    });
});

describe('DELETE /api/admin/jobs/:id', () => {
    it('soft delete unpublishes, pins against renewal and audits', async () => {
        const res = await DELETE(jsonReq(`/api/admin/jobs/${JOB_ID}`, 'DELETE'), params);
        expect((await res.json()).action).toBe('soft_deleted');
        expect(db.job.update.mock.calls[0][0].data).toMatchObject({ isPublished: false, isManuallyUnpublished: true });
        expect(logAudit.mock.calls[0][0]).toMatchObject({ action: 'admin.job.soft_delete', actorId: 'admin-supabase-id', targetId: JOB_ID });
    });

    it('hard delete audits; a free posting is refused with 409 and nothing deleted', async () => {
        db.job.deleteMany.mockResolvedValue({ count: 1 });
        const ok = await DELETE(jsonReq(`/api/admin/jobs/${JOB_ID}?hard=true`, 'DELETE'), params);
        expect(ok.status).toBe(200);
        expect(logAudit.mock.calls[0][0].action).toBe('admin.job.hard_delete');

        vi.clearAllMocks();
        db.job.findUnique.mockResolvedValue({ ...priorJob, employerJobs: { paymentStatus: 'free' } });
        const refused = await DELETE(jsonReq(`/api/admin/jobs/${JOB_ID}?hard=true`, 'DELETE'), params);
        expect(refused.status).toBe(409);
        expect(db.job.deleteMany).not.toHaveBeenCalled();
    });
});

describe('POST /api/admin/jobs/bulk', () => {
    const jobs = [
        { id: 'a', title: 'A', employerJobs: null },
        { id: 'b', title: 'B', employerJobs: { paymentStatus: 'free' } },
    ];

    it('hard_delete refuses the whole batch when any job is a free posting', async () => {
        db.job.findMany.mockResolvedValue(jobs);
        const res = await BULK(jsonReq('/api/admin/jobs/bulk', 'POST', { action: 'hard_delete', jobIds: ['a', 'b'] }));
        expect(res.status).toBe(409);
        expect((await res.json()).freeJobIds).toEqual(['b']);
        expect(db.job.deleteMany).not.toHaveBeenCalled();
    });

    it('hard_delete keeps the free guard inside the delete itself', async () => {
        db.job.findMany.mockResolvedValueOnce([jobs[0]]).mockResolvedValueOnce([]);
        db.job.deleteMany.mockResolvedValue({ count: 1 });
        const res = await BULK(jsonReq('/api/admin/jobs/bulk', 'POST', { action: 'hard_delete', jobIds: ['a'] }));
        expect(res.status).toBe(200);
        expect(db.job.deleteMany.mock.calls[0][0].where.NOT).toEqual({ employerJobs: { is: { paymentStatus: 'free' } } });
        expect(logAudit.mock.calls[0][0]).toMatchObject({ action: 'admin.job.bulk_hard_delete', targetId: 'a', actorId: 'admin-supabase-id' });
    });

    it.each(['unpublish', 'delete'])('%s pins isManuallyUnpublished and audits one row per job', async (action) => {
        db.job.findMany.mockResolvedValue(jobs);
        const res = await BULK(jsonReq('/api/admin/jobs/bulk', 'POST', { action, jobIds: ['a', 'b'] }));
        expect((await res.json()).affected).toBe(2);
        expect(db.job.updateMany.mock.calls[0][0].data).toMatchObject({ isPublished: false, isManuallyUnpublished: true });
        expect(logAudit.mock.calls.map((c) => c[0].targetId).sort()).toEqual(['a', 'b']);
    });

    it('publish clears isManuallyUnpublished', async () => {
        db.job.findMany.mockResolvedValue([jobs[0]]);
        await BULK(jsonReq('/api/admin/jobs/bulk', 'POST', { action: 'publish', jobIds: ['a'] }));
        expect(db.job.updateMany.mock.calls[0][0].data).toMatchObject({ isPublished: true, isManuallyUnpublished: false });
    });

    it('rejects an unknown action and non-string ids before touching the database', async () => {
        expect((await BULK(jsonReq('/api/admin/jobs/bulk', 'POST', { action: 'nuke', jobIds: ['a'] }))).status).toBe(400);
        expect((await BULK(jsonReq('/api/admin/jobs/bulk', 'POST', { action: 'publish', jobIds: [{}] }))).status).toBe(400);
        expect(db.job.findMany).not.toHaveBeenCalled();
    });
});

describe('POST /api/admin/jobs', () => {
    const base = { title: 'NP', employer: 'Acme', location: 'Remote', description: 'd', applyLink: 'https://acme.example/apply' };

    it.each([[{ minSalary: 'abc' }], [{ applyLink: 'javascript:alert(1)' }], [{ isPublished: 'yes' }]])(
        'rejects %j with 400', async (extra) => {
            const res = await POST(jsonReq('/api/admin/jobs', 'POST', { ...base, ...extra }));
            expect(res.status).toBe(400);
            expect(db.job.create).not.toHaveBeenCalled();
        },
    );

    it('creates and records the creating admin in the audit row', async () => {
        db.job.create.mockResolvedValue({ id: 'new-job', isPublished: true });
        const res = await POST(jsonReq('/api/admin/jobs', 'POST', { ...base, minSalary: '150000', maxSalary: 120000 }));
        expect(res.status).toBe(201);
        expect(db.job.create.mock.calls[0][0].data).toMatchObject({ minSalary: 120000, maxSalary: 150000 });
        expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
            action: 'admin.job.create', actorId: 'admin-supabase-id', targetId: 'new-job',
            metadata: expect.objectContaining({ createdByAdminId: 'admin-supabase-id' }),
        }));
    });
});

describe('GET /api/admin/jobs paging', () => {
    it('clamps non-numeric page/limit to defaults instead of NaN skip/take', async () => {
        db.job.findMany.mockResolvedValue([]);
        db.job.count.mockResolvedValue(0);
        db.job.groupBy.mockResolvedValue([]);
        const res = await GET(jsonReq('/api/admin/jobs?page=abc&limit=abc', 'GET'));
        expect(res.status).toBe(200);
        expect(db.job.findMany.mock.calls[0][0]).toMatchObject({ skip: 0, take: 25 });
        expect(parsePagingParam('0', 1, 10)).toBe(1);
        expect(parsePagingParam('500', 25, 100)).toBe(100);
    });

    it('normalizeApplyLink accepts http(s) only', () => {
        expect(normalizeApplyLink('https://a.example/x')).toBe('https://a.example/x');
        expect(normalizeApplyLink('//evil.example')).toBeNull();
        expect(normalizeApplyLink('/relative')).toBeNull();
        expect(normalizeApplyLink('data:text/html,hi')).toBeNull();
    });
});
