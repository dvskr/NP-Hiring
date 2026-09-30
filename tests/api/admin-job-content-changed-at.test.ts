/**
 * Admin PATCH /api/admin/jobs/:id and Job.contentChangedAt (indexing audit
 * fixSoon 5): an edit to a rendered field, or a republish, moves it; a
 * feature toggle or a re-save of the same value does not.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const db = vi.hoisted(() => ({
    job: {
        findUnique: vi.fn(),
        update: vi.fn(),
    },
}));

vi.mock('@/lib/prisma', () => ({ prisma: db }));
vi.mock('@/lib/audit-log', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/auth/require-api-admin', () => ({ requireApiAdmin: vi.fn(async () => null) }));
vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({
        auth: { getUser: async () => ({ data: { user: { id: 'admin-id', email: 'admin@example.test' } } }) },
    })),
}));
vi.mock('@/lib/inngest/client', () => ({ inngest: { send: vi.fn(() => Promise.resolve()) } }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { PATCH } from '@/app/api/admin/jobs/[id]/route';

const params = { params: Promise.resolve({ id: 'job-1' }) };
const patch = (body: unknown) =>
    PATCH(
        new NextRequest('http://127.0.0.1:3000/api/admin/jobs/job-1', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        }),
        params,
    );

const prior = {
    title: 'Psych NP', employer: 'Acme', location: 'Austin, TX', description: 'desc',
    applyLink: 'https://acme.example/apply', isPublished: true, isFeatured: false, expiresAt: null,
    city: 'Austin', minSalary: 120000,
};

function writtenData(): Record<string, unknown> {
    return db.job.update.mock.calls[0][0].data as Record<string, unknown>;
}

beforeEach(() => {
    vi.clearAllMocks();
    db.job.findUnique.mockResolvedValue(prior);
    db.job.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'job-1', ...prior, ...data }));
});

describe('admin PATCH moves contentChangedAt only for content', () => {
    it('stamps a title edit', async () => {
        expect((await patch({ title: 'Psychiatric Nurse Practitioner' })).status).toBe(200);
        expect(writtenData().contentChangedAt).toBeInstanceOf(Date);
    });

    it('stamps a pay edit', async () => {
        await patch({ minSalary: 125000 });
        expect(writtenData().contentChangedAt).toBeInstanceOf(Date);
    });

    it('does not stamp a feature toggle', async () => {
        await patch({ isFeatured: true });
        expect(writtenData()).not.toHaveProperty('contentChangedAt');
    });

    it('does not stamp a re-save of the same title', async () => {
        await patch({ title: 'Psych NP' });
        expect(writtenData()).not.toHaveProperty('contentChangedAt');
    });

    it('stamps a republish', async () => {
        db.job.findUnique.mockResolvedValue({ ...prior, isPublished: false });
        await patch({ isPublished: true });
        expect(writtenData()).toMatchObject({ isPublished: true, isManuallyUnpublished: false });
        expect(writtenData().contentChangedAt).toBeInstanceOf(Date);
    });

    it('does not stamp an unpublish', async () => {
        await patch({ isPublished: false });
        expect(writtenData()).not.toHaveProperty('contentChangedAt');
    });
});
