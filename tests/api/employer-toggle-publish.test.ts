/**
 * PATCH /api/employer/jobs/[jobId]/toggle-publish — which paused posts the
 * owner can put back live.
 *
 * Pinned:
 *   - 'promo' posts (every post during the launch promo) republish exactly
 *     like legacy 'free' and 'paid' posts. Before this, the gate allowed only
 *     'paid' | 'free', so every promo post an employer paused (or archived and
 *     restored) could never come back. A 5-post pack post ('pack', paid for
 *     by its pack) republishes on the same terms.
 *   - A legacy 'plan' post is refused with the 402 like any status that
 *     cannot go live: the Employer plan is retired and its republish path was
 *     deleted with the plan code (phase 4 of the 2027 re-price), so no plan
 *     can entitle it. Pausing a live one still works.
 *   - 'pending', 'refunded', 'expired' and unknown statuses keep the 402.
 *   - The expiry, ownership and pause paths are unchanged.
 *   - Every refusal carries a `message`, which the dashboard shows first
 *     (components/employer/EmployerDashboardClient.tsx performTogglePublish).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';

const mocks = vi.hoisted(() => ({
    getUser: vi.fn(),
    inngestSend: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser } })),
}));
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn().mockResolvedValue(null),
    RATE_LIMITS: { employer: { limit: 30, windowSeconds: 60 } },
}));
vi.mock('@/lib/inngest/client', () => ({ inngest: { send: mocks.inngestSend } }));

import { PATCH } from '@/app/api/employer/jobs/[jobId]/toggle-publish/route';

const USER_ID = 'user-1';
const JOB_ID = 'job-1';
const DAY_MS = 24 * 60 * 60 * 1000;
const future = () => new Date(Date.now() + 10 * DAY_MS);
const past = () => new Date(Date.now() - DAY_MS);
const CANNOT_REPUBLISH = 'This posting cannot be republished (refunded or invalid payment state).';

function employerJobRow(paymentStatus: string, job: Partial<{ isPublished: boolean; expiresAt: Date | null; archivedAt: Date | null }> = {}) {
    return {
        id: 'ej-1',
        jobId: JOB_ID,
        userId: USER_ID,
        contactEmail: 'hiring@clinic.example',
        editToken: 'edit-token-1',
        paymentStatus,
        job: { id: JOB_ID, title: 'PMHNP Outpatient', isPublished: false, expiresAt: future(), ...job },
    };
}

async function toggle(body?: Record<string, unknown>) {
    const req = new NextRequest(`http://localhost:3000/api/employer/jobs/${JOB_ID}/toggle-publish`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    const res = await PATCH(req, { params: Promise.resolve({ jobId: JOB_ID }) });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
}

beforeEach(() => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID, email: 'hiring@clinic.example' } }, error: null });
    mocks.inngestSend.mockResolvedValue(undefined);
    vi.mocked(prisma.userProfile.findUnique).mockResolvedValue({ id: 'profile-1', role: 'employer' } as never);
    vi.mocked(prisma.job.update).mockResolvedValue({ id: JOB_ID } as never);
});

describe('republish of a paused post by paymentStatus', () => {
    it.each(['promo', 'free', 'paid', 'pack'])("republishes a paused '%s' post directly", async (status) => {
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue(employerJobRow(status) as never);

        const res = await toggle();

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ success: true, isPublished: true });
        // A republish is a revival, so it stamps contentChangedAt (fixSoon 5).
        expect(prisma.job.update).toHaveBeenCalledWith({
            where: { id: JOB_ID },
            data: { isPublished: true, isManuallyUnpublished: false, contentChangedAt: expect.any(Date) },
        });
        expect(mocks.inngestSend).toHaveBeenCalledWith({ name: 'embedding.refresh.job', data: { jobId: JOB_ID } });
    });

    it('keeps the expiry guard for a promo post: an expired paused post cannot come back', async () => {
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue(employerJobRow('promo', { expiresAt: past() }) as never);

        const res = await toggle();

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Cannot modify an expired job');
        expect(prisma.job.update).not.toHaveBeenCalled();
    });

    it("keeps the 402 for a 'pending' post (checkout never paid)", async () => {
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue(employerJobRow('pending') as never);

        const res = await toggle();

        expect(res.status).toBe(402);
        expect(res.body).toMatchObject({
            error: 'Payment required',
            message: 'This posting has not been paid yet. Complete checkout to publish.',
            paymentStatus: 'pending',
        });
        expect(prisma.job.update).not.toHaveBeenCalled();
    });

    it.each(['refunded', 'expired', 'something_new'])("keeps the 402 refusal for '%s'", async (status) => {
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue(employerJobRow(status) as never);

        const res = await toggle();

        expect(res.status).toBe(402);
        expect(res.body).toMatchObject({
            error: 'Payment required',
            message: CANNOT_REPUBLISH,
            paymentStatus: status,
        });
        expect(prisma.job.update).not.toHaveBeenCalled();
    });

    it.each(['promo', 'free', 'paid', 'pack'])("refuses to republish an archived '%s' post until it is restored", async (status) => {
        // Archive unpublishes in the same write; republishing without a
        // restore would leave the post archived and live at once.
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue(employerJobRow(status, { archivedAt: past() }) as never);

        const res = await toggle();

        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({
            error: 'Job is archived',
            message: 'This post is archived. Restore it from the Archived tab before you republish it.',
            archived: true,
        });
        expect(prisma.job.update).not.toHaveBeenCalled();
    });

    it('still answers 404 to an employer who does not own the post', async () => {
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue(null as never);

        const res = await toggle();

        expect(res.status).toBe(404);
        expect(prisma.job.update).not.toHaveBeenCalled();
    });
});

describe("a legacy 'plan' post (the Employer plan is retired, its code deleted)", () => {
    it.each([
        ['paused', {}],
        ['paused and archived', { archivedAt: past() }],
        ['paused and past its run', { expiresAt: past() }],
    ])('answers the 402 when %s, and writes nothing', async (_state, job) => {
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue(employerJobRow('plan', job) as never);

        const res = await toggle();

        expect(res.status).toBe(402);
        expect(res.body).toMatchObject({ error: 'Payment required', message: CANNOT_REPUBLISH, paymentStatus: 'plan' });
        expect(prisma.job.update).not.toHaveBeenCalled();
        expect(mocks.inngestSend).not.toHaveBeenCalled();
    });

    it('can still be paused', async () => {
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue(employerJobRow('plan', { isPublished: true }) as never);

        const res = await toggle({ reason: 'filled' });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ success: true, isPublished: false });
        expect(prisma.job.update).toHaveBeenCalledWith({
            where: { id: JOB_ID },
            data: expect.objectContaining({ isPublished: false, isManuallyUnpublished: true, unpublishReason: 'filled' }),
        });
    });

    it('the route has no plan path left: no plan module, no slot check', () => {
        const src = fs.readFileSync(path.join(process.cwd(), 'app/api/employer/jobs/[jobId]/toggle-publish/route.ts'), 'utf8');
        expect(src).not.toMatch(/employer-plan|republishPlanPost|planSlotsFull|planInactive/);
    });
});

describe('refusal copy follows the house style', () => {
    it('no refusal message uses an em dash, an en dash or a spaced hyphen', async () => {
        const messages: string[] = [];
        for (const status of ['pending', 'plan', 'refunded']) {
            vi.mocked(prisma.employerJob.findFirst).mockResolvedValue(employerJobRow(status) as never);
            messages.push(String((await toggle()).body.message));
        }
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue(employerJobRow('promo', { archivedAt: past() }) as never);
        messages.push(String((await toggle()).body.message));

        expect(messages).toHaveLength(4);
        for (const message of messages) {
            expect(message.length).toBeGreaterThan(0);
            expect(message).not.toMatch(/[–—]| - /);
        }
    });
});
