/**
 * PATCH /api/employer/jobs/[jobId]/toggle-publish — which paused posts the
 * owner can put back live.
 *
 * Pinned:
 *   - 'promo' posts (every post during the launch promo) republish exactly
 *     like legacy 'free' and 'paid' posts. Before this, the gate allowed only
 *     'paid' | 'free', so every promo post an employer paused (or archived and
 *     restored) could never come back.
 *   - 'plan' posts republish only through lib/employer-plan.ts
 *     republishPlanPost (plan entitled AND a free slot, checked in the same
 *     Serializable transaction as the write). A refusal says why in plain
 *     words: 403 plan inactive, 409 all slots in use, 409 retry on a lost
 *     concurrent slot check.
 *   - 'pending', 'refunded', 'expired' and unknown statuses keep the 402.
 *   - The expiry, ownership and pause paths are unchanged.
 *   - Every refusal carries a `message`, which the dashboard shows first
 *     (components/employer/EmployerDashboardClient.tsx performTogglePublish).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';

const mocks = vi.hoisted(() => ({
    getUser: vi.fn(),
    republishPlanPost: vi.fn(),
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
vi.mock('@/lib/employer-plan', () => ({ republishPlanPost: mocks.republishPlanPost }));

import { PATCH } from '@/app/api/employer/jobs/[jobId]/toggle-publish/route';

const USER_ID = 'user-1';
const JOB_ID = 'job-1';
const DAY_MS = 24 * 60 * 60 * 1000;
const future = () => new Date(Date.now() + 10 * DAY_MS);
const past = () => new Date(Date.now() - DAY_MS);

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
    it.each(['promo', 'free', 'paid'])("republishes a paused '%s' post directly", async (status) => {
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue(employerJobRow(status) as never);

        const res = await toggle();

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ success: true, isPublished: true });
        // A republish is a revival, so it stamps contentChangedAt (fixSoon 5).
        expect(prisma.job.update).toHaveBeenCalledWith({
            where: { id: JOB_ID },
            data: { isPublished: true, isManuallyUnpublished: false, contentChangedAt: expect.any(Date) },
        });
        expect(mocks.republishPlanPost).not.toHaveBeenCalled();
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
            message: 'This posting cannot be republished (refunded or invalid payment state).',
            paymentStatus: status,
        });
        expect(prisma.job.update).not.toHaveBeenCalled();
        expect(mocks.republishPlanPost).not.toHaveBeenCalled();
    });

    it.each(['promo', 'free', 'paid', 'plan'])("refuses to republish an archived '%s' post until it is restored", async (status) => {
        // Archive unpublishes in the same write; republishing without a
        // restore would leave the post archived and live at once, and a plan
        // post would take back the slot the employer freed by archiving it.
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue(employerJobRow(status, { archivedAt: past() }) as never);

        const res = await toggle();

        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({
            error: 'Job is archived',
            message: 'This post is archived. Restore it from the Archived tab before you republish it.',
            archived: true,
        });
        expect(prisma.job.update).not.toHaveBeenCalled();
        expect(mocks.republishPlanPost).not.toHaveBeenCalled();
    });

    it('still answers 404 to an employer who does not own the post', async () => {
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue(null as never);

        const res = await toggle();

        expect(res.status).toBe(404);
        expect(prisma.job.update).not.toHaveBeenCalled();
    });
});

describe("republish of a paused 'plan' post goes through the Employer plan gate", () => {
    it('writes through republishPlanPost with the owner, the job and the republish fields', async () => {
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue(employerJobRow('plan') as never);
        mocks.republishPlanPost.mockResolvedValue({ ok: true });

        const res = await toggle();

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ success: true, isPublished: true, message: 'Job is now live' });
        expect(mocks.republishPlanPost).toHaveBeenCalledWith(USER_ID, JOB_ID, { isPublished: true, isManuallyUnpublished: false, contentChangedAt: expect.any(Date) });
        // The only write is the one inside the plan transaction.
        expect(prisma.job.update).not.toHaveBeenCalled();
        expect(mocks.inngestSend).toHaveBeenCalledWith({ name: 'embedding.refresh.job', data: { jobId: JOB_ID } });
    });

    it('answers 403 with a plain reason when the plan is not active', async () => {
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue(employerJobRow('plan') as never);
        mocks.republishPlanPost.mockResolvedValue({ ok: false, reason: 'plan_inactive' });

        const res = await toggle();

        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({
            error: 'Employer plan inactive',
            message: 'This post runs under your Employer plan, which is not active right now. You can republish it once your plan is active.',
            planInactive: true,
        });
        expect(prisma.job.update).not.toHaveBeenCalled();
        expect(mocks.inngestSend).not.toHaveBeenCalled();
    });

    it('answers 409 with a plain reason when every plan slot is in use', async () => {
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue(employerJobRow('plan') as never);
        mocks.republishPlanPost.mockResolvedValue({ ok: false, reason: 'slots_full', used: 5, slots: 5 });

        const res = await toggle();

        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({
            error: 'Employer plan slots full',
            message: 'All 5 of your Employer plan slots are in use. Pause or archive one of your live plan posts to free a slot, then republish this one.',
            planSlotsFull: true,
            slots: 5,
            used: 5,
        });
        expect(prisma.job.update).not.toHaveBeenCalled();
    });

    it('answers 409 "try again" when a concurrent republish won the slot check (P2034)', async () => {
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue(employerJobRow('plan') as never);
        mocks.republishPlanPost.mockRejectedValue(Object.assign(new Error('could not serialize access'), { code: 'P2034' }));

        const res = await toggle();

        expect(res.status).toBe(409);
        expect(res.body.message).toBe('Another change to your Employer plan posts was saved at the same moment. Please try again.');
        expect(prisma.job.update).not.toHaveBeenCalled();
    });

    it('answers 500 for any other failure inside the plan transaction', async () => {
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue(employerJobRow('plan') as never);
        mocks.republishPlanPost.mockRejectedValue(new Error('connection reset'));

        const res = await toggle();

        expect(res.status).toBe(500);
        expect(res.body.error).toBe('Failed to update job status');
    });

    it('keeps the expiry guard ahead of the plan check', async () => {
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue(employerJobRow('plan', { expiresAt: past() }) as never);

        const res = await toggle();

        expect(res.status).toBe(400);
        expect(mocks.republishPlanPost).not.toHaveBeenCalled();
    });

    it('pauses a live plan post without touching the plan gate', async () => {
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue(employerJobRow('plan', { isPublished: true }) as never);

        const res = await toggle({ reason: 'filled' });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ success: true, isPublished: false });
        expect(mocks.republishPlanPost).not.toHaveBeenCalled();
        expect(prisma.job.update).toHaveBeenCalledWith({
            where: { id: JOB_ID },
            data: expect.objectContaining({ isPublished: false, isManuallyUnpublished: true, unpublishReason: 'filled' }),
        });
    });
});

describe('refusal copy follows the house style', () => {
    it('no refusal message uses an em dash, an en dash or a spaced hyphen', async () => {
        const outcomes = [
            { ok: false, reason: 'plan_inactive' },
            { ok: false, reason: 'slots_full', used: 5, slots: 5 },
        ];
        const messages: string[] = [];
        for (const outcome of outcomes) {
            vi.mocked(prisma.employerJob.findFirst).mockResolvedValue(employerJobRow('plan') as never);
            mocks.republishPlanPost.mockResolvedValueOnce(outcome);
            messages.push(String((await toggle()).body.message));
        }
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue(employerJobRow('plan') as never);
        mocks.republishPlanPost.mockRejectedValueOnce(Object.assign(new Error('conflict'), { code: 'P2034' }));
        messages.push(String((await toggle()).body.message));

        expect(messages).toHaveLength(3);
        for (const message of messages) {
            expect(message.length).toBeGreaterThan(0);
            expect(message).not.toMatch(/[–—]| - /);
        }
    });
});
