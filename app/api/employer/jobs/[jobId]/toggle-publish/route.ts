import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { readJsonObject } from '@/lib/request-body';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { inngest } from '@/lib/inngest/client';
import { employerJobOwnershipBranches } from '@/lib/employer-ownership';

/**
 * paymentStatus values whose paused posts the owner may republish directly:
 * a paid post, a legacy free post, a launch promo post (the promo row
 * replaced 'free' and is republished on exactly the same terms) and a 5-post
 * pack post (paid for by its pack). Anything else is refused with 402:
 * 'pending', 'refunded', 'disputed', 'expired', unknown values, and a legacy
 * 'plan' post, which only an Employer plan could put back live (the plan is
 * retired and its code deleted, phase 4 of the 2027 re-price).
 */
const DIRECTLY_REPUBLISHABLE_STATUSES: ReadonlySet<string> = new Set(['paid', 'free', 'promo', 'pack']);

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
        // The body is optional and untrusted (register 2.29): a missing or
        // malformed body, or a reason or note that is not text, is no reason.
        const body = await readJsonObject(req);
        const reason = body?.reason;
        if (typeof reason === 'string' && (ALLOWED_REASONS as readonly string[]).includes(reason)) {
            providedReason = reason as UnpublishReason;
            const note = body?.note;
            if (typeof note === 'string' && note.trim().length > 0) {
                providedNote = note.trim().slice(0, 1000);
            }
        }

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
                OR: employerJobOwnershipBranches(user),
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
        // free, launch promo, a pack credit).
        if (employerJob) {
            const ps = employerJob.paymentStatus;
            const willPublish = !employerJob.job.isPublished;
            if (willPublish && !DIRECTLY_REPUBLISHABLE_STATUSES.has(ps)) {
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
        // live at once. Restore first, then republish.
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

        await prisma.job.update({
            where: { id: job.id },
            data: updateData,
        });

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
