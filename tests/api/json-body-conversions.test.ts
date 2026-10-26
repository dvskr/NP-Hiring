/**
 * Two routes that typed their parsed JSON body read it as unknown now
 * (register 2.29, tests/regressions/json-body-type-annotation.test.ts), with
 * the checks they already made.
 *
 *   - POST /api/job-draft declared `{ formData?: Record<string, unknown>;
 *     email?: string }` for JSON.parse of the request text. A JSON null body
 *     threw outside the route's try (a 500); it is now the missing formData
 *     400 an array body already got.
 *   - PATCH /api/employer/jobs/[jobId]/toggle-publish cast the body to
 *     `{ reason?: string; note?: string } | null`. The pause reason and its
 *     note are now each checked as text: what is stored is unchanged.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
    prisma: {
        userProfile: { findUnique: vi.fn() },
        jobDraft: { upsert: vi.fn(), findUnique: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
        employerJob: { findFirst: vi.fn() },
        job: { update: vi.fn(), findUnique: vi.fn() },
    },
}));
const getUserMock = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}));
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn().mockResolvedValue(null),
    RATE_LIMITS: { general: { limit: 60, windowSeconds: 60 }, employer: { limit: 30, windowSeconds: 60 } },
}));
vi.mock('@/lib/inngest/client', () => ({ inngest: { send: vi.fn().mockResolvedValue(undefined) } }));

import { prisma } from '@/lib/prisma';

function request(url: string, method: string, body: string): NextRequest {
    return new NextRequest(url, { method, body, headers: { 'content-type': 'application/json' } });
}

beforeAll(async () => {
    await import('@/app/api/job-draft/route');
    await import('@/app/api/employer/jobs/[jobId]/toggle-publish/route');
}, 120_000);

beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1', email: 'owner@clinic.example' } }, error: null });
    vi.mocked(prisma.userProfile.findUnique).mockResolvedValue({ id: 'profile-1', role: 'employer' } as never);
    vi.mocked(prisma.jobDraft.upsert).mockResolvedValue({ id: 'draft-1', updatedAt: new Date('2026-10-27T12:00:00.000Z') } as never);
    vi.mocked(prisma.job.update).mockResolvedValue({ id: 'job-1' } as never);
});

describe('POST /api/job-draft reads its body as unknown', () => {
    async function save(body: string): Promise<{ status: number; json: Record<string, unknown> }> {
        const { POST } = await import('@/app/api/job-draft/route');
        const res = await POST(request('https://test.local/api/job-draft', 'POST', body));
        return { status: res.status, json: await res.json() };
    }

    it.each([
        ['a JSON null body', 'null'],
        ['an array body', JSON.stringify([{ formData: { title: 'x' } }])],
        ['a bare string body', JSON.stringify('draft')],
        ['formData that is text', JSON.stringify({ formData: 'title' })],
        ['no formData', JSON.stringify({ email: 'owner@clinic.example' })],
    ])('%s is the missing formData 400, and nothing is saved', async (_label, body) => {
        const res = await save(body);

        expect(res.status).toBe(400);
        expect(res.json).toEqual({ error: 'Missing formData' });
        expect(prisma.jobDraft.upsert).not.toHaveBeenCalled();
    });

    it('malformed JSON is still the invalid JSON 400', async () => {
        const res = await save('{"formData":');

        expect(res.status).toBe(400);
        expect(res.json).toEqual({ error: 'Invalid JSON' });
    });

    it('saves the form for the signed-in account, with the email only when it is text', async () => {
        expect((await save(JSON.stringify({ formData: { title: 'FNP' }, email: 'owner@clinic.example' }))).status).toBe(200);
        expect(prisma.jobDraft.upsert).toHaveBeenLastCalledWith(expect.objectContaining({
            where: { userId: 'user-1' },
            create: expect.objectContaining({ userId: 'user-1', email: 'owner@clinic.example', formData: { title: 'FNP' } }),
        }));

        expect((await save(JSON.stringify({ formData: { title: 'FNP' }, email: { not: '' } }))).status).toBe(200);
        expect(prisma.jobDraft.upsert).toHaveBeenLastCalledWith(expect.objectContaining({
            update: expect.objectContaining({ email: null }),
        }));
    });
});

describe('PATCH toggle-publish reads the pause reason as unknown', () => {
    function livePost(): void {
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({
            id: 'ej-1', jobId: 'job-1', userId: 'user-1', contactEmail: 'owner@clinic.example', editToken: 'edit-1', paymentStatus: 'promo',
            job: { id: 'job-1', title: 'FNP', isPublished: true, expiresAt: new Date(Date.now() + 86_400_000), archivedAt: null },
        } as never);
    }

    async function pause(body: string): Promise<Record<string, unknown>> {
        livePost();
        const { PATCH } = await import('@/app/api/employer/jobs/[jobId]/toggle-publish/route');
        const res = await PATCH(request('https://test.local/api/employer/jobs/job-1/toggle-publish', 'PATCH', body), { params: Promise.resolve({ jobId: 'job-1' }) });
        expect(res.status).toBe(200);
        return vi.mocked(prisma.job.update).mock.calls[0][0].data as Record<string, unknown>;
    }

    it('stores a listed reason', async () => {
        expect(await pause(JSON.stringify({ reason: 'filled' }))).toMatchObject({ isPublished: false, unpublishReason: 'filled', unpublishReasonNote: null });
    });

    it('stores the trimmed note with the "other" reason', async () => {
        expect(await pause(JSON.stringify({ reason: 'other', note: '  Hired internally  ' }))).toMatchObject({ unpublishReason: 'other', unpublishReasonNote: 'Hired internally' });
    });

    it.each([
        ['a reason that is an object', JSON.stringify({ reason: { not: '' } })],
        ['a reason off the list', JSON.stringify({ reason: 'bored' })],
        ['malformed JSON', '{"reason":'],
        ['a JSON null body', 'null'],
    ])('%s pauses the post without a reason', async (_label, body) => {
        const data = await pause(body);

        expect(data).toMatchObject({ isPublished: false, isManuallyUnpublished: true });
        expect(data).not.toHaveProperty('unpublishReason');
    });

    it('drops a note that is not text', async () => {
        expect(await pause(JSON.stringify({ reason: 'other', note: 42 }))).toMatchObject({ unpublishReason: 'other', unpublishReasonNote: null });
    });
});
