import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { createClient } from '@/lib/supabase/server';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { inngest } from '@/lib/inngest/client';
import { republishPlanPost, type PlanRepublishOutcome } from '@/lib/employer-plan';

/**
 * paymentStatus values whose paused posts the owner may republish directly:
 * a paid post, a legacy free post, and a launch promo post (the promo row
 * replaced 'free' and is republished on exactly the same terms). A 'plan'
 * post is republished only through the Employer plan gate below. Anything
 * else ('pending', 'refunded', 'expired', unknown) is refused with 402.
 */
const DIRECTLY_REPUBLISHABLE_STATUSES: ReadonlySet<string> = new Set(['paid', 'free', 'promo']);

/** Prisma's code for a Serializable transaction that lost a concurrent-write race. */
const SERIALIZATION_FAILURE_CODE = 'P2034';

function isSerializationFailure(error: unknown): boolean {
    return (error as { code?: unknown } | null)?.code === SERIALIZATION_FAILURE_CODE;
}

/**
 * Put a paused 'plan' post back live, or explain why it cannot go live.
 * Returns null on success (the write is done) or the refusal response.
 */
async function republishUnderPlan(
    ownerUserId: string | null,
    jobId: string,
    data: Prisma.JobUpdateInput,
): Promise<NextResponse | null> {
    let outcome: PlanRepublishOutcome;
    try {
        outcome = await republishPlanPost(ownerUserId, jobId, data);
    } catch (error) {
        if (!isSerializationFailure(error)) throw error;
        logger.info('Plan post republish lost a concurrent slot check', { jobId, userId: ownerUserId ?? undefined });
        return NextResponse.json(
            {
                error: 'Plan slot check conflict',
                message: 'Another change to your Employer plan posts was saved at the same moment. Please try again.',
            },
            { status: 409 },
        );
    }
    if (outcome.ok) return null;
    if (outcome.reason === 'plan_inactive') {
        return NextResponse.json(
            {
                error: 'Employer plan inactive',
                message: 'This post runs under your Employer plan, which is not active right now. You can republish it once your plan is active.',
                planInactive: true,
                paymentStatus: 'plan',
            },
            { status: 403 },
        );
    }
    return NextResponse.json(
        {
            error: 'Employer plan slots full',
            message: `All ${outcome.slots} of your Employer plan slots are in use. Pause or archive one of your live plan posts to free a slot, then republish this one.`,
            planSlotsFull: true,
            paymentStatus: 'plan',
            slots: outcome.slots,
            used: outcome.used,
        },
        { status: 409 },
    );
}

/**
 * PATCH /api/employer/jobs/[jobId]/toggle-publish
 * Toggle a job's isPublished status (pause/unpublish or republish).
 * Employer must own the job (via userId or contactEmail).
 */
export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ jobId: string }> }
) {
    const rateLimitResponse = await rateLimit(req, 'employer:toggle-publish', RATE_LIMITS.employer);
    if (rateLimitResponse) return rateLimitResponse;

    try {
        const { jobId } = await params;
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Optional unpublish-reason payload — only consumed when transitioning
        // published -> unpublished. Republishing ignores any reason in the body.
        // Validated against a fixed allowlist; "other" requires the free-text note.
        const ALLOWED_REASONS = ['filled', 'too_many_applicants', 'enough_applicants', 'reposting_later', 'low_quality', 'other'] as const;
        type UnpublishReason = typeof ALLOWED_REASONS[number];
        let providedReason: UnpublishReason | null = null;
        let providedNote: string | null = null;
        try {
            const body = await req.json().catch(() => null) as { reason?: string; note?: string } | null;
            if (body?.reason && (ALLOWED_REASONS as readonly string[]).includes(body.reason)) {
                providedReason = body.reason as UnpublishReason;
                if (typeof body.note === 'string' && body.note.trim().length > 0) {
                    providedNote = body.note.trim().slice(0, 1000);
                }
            }
        } catch { /* body optional — toggling without a reason is allowed */ }

        const profile = await prisma.userProfile.findUnique({
            where: { supabaseId: user.id },
            select: { id: true, role: true },
        });

        if (!profile || !['employer', 'admin'].includes(profile.role)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        // Find the employer job and verify ownership.
        // P5.A (2026-06-01): contactEmail fallback only honored for
        // legacy rows that never got a claimed userId — closes the
        // signup-with-existing-employer-email impersonation surface.
        const employerJob = await prisma.employerJob.findFirst({
            where: {
                jobId,
                OR: [
                    { userId: user.id },
                    { userId: null, contactEmail: user.email! },
                ],
            },
            include: {
                job: { select: { id: true, title: true, isPublished: true, expiresAt: true, archivedAt: true } },
            },
        });

        // Payment gate (2026-05-15): an employer who started a paid checkout
        // and closed the window before paying ends up with paymentStatus=
        // 'pending'. Without this guard they could republish via the
        // dashboard's pause/unpause button and get a Live + Featured post
        // for free. Block republish unless payment cleared (paid, legacy
        // free, launch promo). 'plan' passes here and is checked against the
        // Employer plan (entitlement + free slot) right before the write.
        if (employerJob) {
            const ps = employerJob.paymentStatus;
            const willPublish = !employerJob.job.isPublished;
            if (willPublish && ps !== 'plan' && !DIRECTLY_REPUBLISHABLE_STATUSES.has(ps)) {
                return NextResponse.json(
                    {
                        error: 'Payment required',
                        message: ps === 'pending'
                            ? 'This posting has not been paid yet. Complete checkout to publish.'
                            : 'This posting cannot be republished (refunded or invalid payment state).',
                        paymentStatus: ps,
                        editLink: `/jobs/edit/${employerJob.editToken}`,
                    },
                    { status: 402 }
                );
            }
        }

        // Allow admin bypass
        const isAdmin = profile.role === 'admin';
        if (!employerJob && !isAdmin) {
            return NextResponse.json({ error: 'Job not found or access denied' }, { status: 404 });
        }

        // For admin, fetch job directly
        const job = employerJob
            ? employerJob.job
            : await prisma.job.findUnique({ where: { id: jobId }, select: { id: true, title: true, isPublished: true, expiresAt: true, archivedAt: true } });

        if (!job) {
            return NextResponse.json({ error: 'Job not found' }, { status: 404 });
        }

        // An archived listing is never live (archive/route.ts unpublishes in
        // the same write). Republishing one here would leave it archived and
        // live at once, and a plan post would take back the slot the employer
        // freed by archiving it. Restore first, then republish.
        if (!job.isPublished && job.archivedAt) {
            return NextResponse.json(
                {
                    error: 'Job is archived',
                    message: 'This post is archived. Restore it from the Archived tab before you republish it.',
                    archived: true,
                },
                { status: 409 }
            );
        }

        // Check if expired — can't unpublish an expired job (it's already effectively off)
        if (job.expiresAt && new Date(job.expiresAt) < new Date() && !job.isPublished) {
            return NextResponse.json({ error: 'Cannot modify an expired job' }, { status: 400 });
        }

        // Toggle. When transitioning published -> unpublished, persist the
        // reason if the modal provided one and stamp `unpublished_at` so we
        // know when this state change happened (audit + outreach trigger).
        const newPublishedState = !job.isPublished;
        const updateData: {
          isPublished: boolean;
          isManuallyUnpublished?: boolean;
          unpublishReason?: string | null;
          unpublishReasonNote?: string | null;
          unpublishedAt?: Date | null;
          contentChangedAt?: Date;
        } = { isPublished: newPublishedState };

        if (!newPublishedState) {
            // Pause / unpublish
            updateData.isManuallyUnpublished = true;
            updateData.unpublishedAt = new Date();
            if (providedReason) {
                updateData.unpublishReason = providedReason;
                // Only persist the note when the reason is "other" — otherwise
                // it's redundant / reduces analytical signal.
                updateData.unpublishReasonNote = providedReason === 'other' ? providedNote : null;
            }
        } else {
            // Republish — clear the manual flag so the cron lifecycle treats
            // this row as freshly active again. Reason stays as historical record.
            updateData.isManuallyUnpublished = false;
            // A revival: the posting is public again, so its content counts
            // as changed now (sitemap lastmod, "Last updated"; indexing
            // audit fixSoon 5).
            updateData.contentChangedAt = new Date();
        }

        if (newPublishedState && employerJob?.paymentStatus === 'plan') {
            // Plan post: live only while the plan is entitled and a slot is
            // free; the check and the write share one Serializable transaction.
            const refusal = await republishUnderPlan(employerJob.userId, job.id, updateData);
            if (refusal) return refusal;
        } else {
            await prisma.job.update({
                where: { id: job.id },
                data: updateData,
            });
        }

        logger.info('Job publish status toggled', {
            jobId: job.id,
            title: job.title,
            isPublished: newPublishedState,
            userId: user.id,
        });

        // C1: on republish the job re-enters the catalog with a possibly stale or
        // absent embedding — refresh it so it surfaces in AI search. Fire-and-forget.
        if (newPublishedState) {
            inngest.send({
                name: 'embedding.refresh.job',
                data: { jobId: job.id },
            }).catch((err) => {
                logger.warn('inngest.send embedding.refresh.job failed (toggle-publish)', { error: String(err) });
            });
        }

        return NextResponse.json({
            success: true,
            isPublished: newPublishedState,
            message: newPublishedState ? 'Job is now live' : 'Job has been paused',
        });
    } catch (error) {
        logger.error('Error toggling job publish status', error);
        return NextResponse.json({ error: 'Failed to update job status' }, { status: 500 });
    }
}
