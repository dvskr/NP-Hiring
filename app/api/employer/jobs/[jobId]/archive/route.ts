import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { employerJobOwnershipBranches, type EmployerJobOwner } from '@/lib/employer-ownership';

/**
 * PATCH /api/employer/jobs/[jobId]/archive
 * Archive or restore a job. The optional JSON body names the state:
 *   { "archived": true }    archive it
 *   { "archived": false }   restore it
 *   no body (or {})         toggle, for older clients and the e2e journeys
 * Any other body is a 400. A request for the state the post is already in
 * succeeds and writes nothing. That is what keeps a stale tab honest: the
 * dashboard sends the state its employer chose, so clicking Archive in a tab
 * that still shows a post another tab archived leaves it archived, where a
 * toggle would have restored it. The answer carries the resulting archivedAt
 * and isPublished, so the tab shows the stored state, not its guess.
 * One request for the state a post is already in does write: { archived: true }
 * for a post that is archived yet still published (an admin republish leaves
 * archivedAt set) unpublishes it, because an archived listing is never live.
 *
 * Archived jobs:
 *   - Leave the public board through the isPublished: false that archiving
 *     writes in the same update. /jobs (lib/filters.ts), the pSEO listings
 *     (lib/pseo/listing-where.ts) and the sitemaps (lib/active-job-filter.ts)
 *     filter on isPublished, not archivedAt; only a few surfaces also filter
 *     archivedAt (lib/ai/vector-search.ts, app/api/jobs/search/semantic,
 *     app/widget, the expiry-warnings cron).
 *   - Stay visible in the employer dashboard under the "Archived" filter
 *   - Have isPublished forced to false (you can't have a live archived listing)
 *   - Keep their EmployerJob row, so the per-domain pricing anchors survive
 *     (archive is not delete): a 'paid' row still marks the domain's intro
 *     price as used, and a legacy 'free' row still counts against the old
 *     quota. Because archiving unpublishes, an archived 'promo' post no
 *     longer counts toward the launch-promo cap and an archived 'plan' post
 *     frees its plan slot — that is the intended way to swap jobs on a plan.
 *
 * Unarchiving simply clears archived_at — but does NOT auto-republish. The
 * employer must republish manually so they can decide whether the post is
 * still relevant before going live again.
 */

/**
 * The optional body. An empty object counts as no body, since some HTTP
 * clients send `{}` by default; an unknown key or a non-boolean value is
 * refused, so a typo such as { "archive": true } cannot fall back to a toggle.
 */
const ARCHIVE_BODY = z.strictObject({ archived: z.boolean().optional() });

/** The archive state a request asks for: true, false, or null to toggle. */
type RequestedState = { ok: true; archived: boolean | null } | { ok: false };

const JOB_FIELDS = { id: true, title: true, archivedAt: true, isPublished: true } as const;

interface ArchivableJob {
    id: string;
    title: string;
    archivedAt: Date | null;
    isPublished: boolean;
}

async function readRequestedState(req: NextRequest): Promise<RequestedState> {
    const raw = await req.text();
    if (raw.trim() === '') return { ok: true, archived: null };
    let body: unknown;
    try {
        body = JSON.parse(raw);
    } catch {
        return { ok: false };
    }
    const parsed = ARCHIVE_BODY.safeParse(body);
    return parsed.success ? { ok: true, archived: parsed.data.archived ?? null } : { ok: false };
}

/**
 * The post this caller may archive: their own, or any post for an admin.
 * An employer never reads the job row directly, so a post out of their reach
 * answers exactly as an unknown id does.
 */
async function findArchivableJob(
    jobId: string,
    user: EmployerJobOwner,
    isAdmin: boolean,
): Promise<ArchivableJob | NextResponse> {
    const employerJob = await prisma.employerJob.findFirst({
        where: {
            jobId,
            OR: employerJobOwnershipBranches(user),
        },
        include: { job: { select: JOB_FIELDS } },
    });
    if (employerJob) return employerJob.job;
    if (!isAdmin) {
        return NextResponse.json({ error: 'Job not found or access denied' }, { status: 404 });
    }
    const job = await prisma.job.findUnique({ where: { id: jobId }, select: JOB_FIELDS });
    return job ?? NextResponse.json({ error: 'Job not found' }, { status: 404 });
}

/** The answer's message, from the post's resulting state. */
function stateMessage(archived: boolean, isPublished: boolean, changed: boolean): string {
    if (archived) {
        return changed
            ? 'Job archived. It will no longer appear on the public job board.'
            : 'Job is already archived.';
    }
    if (!changed) return 'Job is not archived.';
    return isPublished
        ? 'Job restored from archive.'
        : 'Job restored from archive. Republish it to make it visible again.';
}

/** Puts the post in the requested state, writing only when it differs. */
async function settleArchiveState(job: ArchivableJob, archive: boolean, userId: string): Promise<NextResponse> {
    if (archive && job.archivedAt !== null && job.isPublished) {
        // Archived and live at once. This route never writes that state, but
        // an admin republish does: publishStateFields in
        // app/api/admin/jobs/_lib/job-input.ts sets isPublished and leaves
        // archivedAt alone. The employer asked for the post archived, and
        // answering "already archived" would leave it on the public board,
        // so unpublish it, flagged as the employer's choice like any archive.
        // The stored archive time stays: the post was archived then, not now.
        await prisma.job.update({
            where: { id: job.id },
            data: { isPublished: false, isManuallyUnpublished: true },
        });
        logger.info('Archived job was still published and has been unpublished', {
            jobId: job.id,
            title: job.title,
            archivedAt: job.archivedAt,
            userId,
        });
        return NextResponse.json({
            success: true,
            archivedAt: job.archivedAt.toISOString(),
            isPublished: false,
            message: stateMessage(true, false, true),
        });
    }

    if (archive === (job.archivedAt !== null)) {
        // Already in the requested state (a stale tab, a double click):
        // report the stored state and write nothing.
        logger.info('Job archive request matched the current state', { jobId: job.id, archived: archive, userId });
        return NextResponse.json({
            success: true,
            archivedAt: job.archivedAt?.toISOString() ?? null,
            isPublished: job.isPublished,
            message: stateMessage(archive, job.isPublished, false),
        });
    }

    const newArchivedAt = archive ? new Date() : null;
    await prisma.job.update({
        where: { id: job.id },
        data: {
            archivedAt: newArchivedAt,
            // Archiving hides the listing — force-unpublish in the same write.
            // Unarchiving leaves isPublished alone; employer republishes manually.
            // isManuallyUnpublished marks it as the employer's choice, as a
            // pause does, so lib/employer-plan.ts resumePlanPosts (run on
            // every plan renewal) and fp-recovery never bring it back.
            ...(newArchivedAt !== null && { isPublished: false, isManuallyUnpublished: true }),
        },
    });
    const isPublished = newArchivedAt !== null ? false : job.isPublished;

    logger.info('Job archive state changed', { jobId: job.id, title: job.title, archivedAt: newArchivedAt, userId });

    return NextResponse.json({
        success: true,
        archivedAt: newArchivedAt?.toISOString() ?? null,
        isPublished,
        message: stateMessage(archive, isPublished, true),
    });
}

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ jobId: string }> }
) {
    const rateLimitResponse = await rateLimit(req, 'employer:archive', RATE_LIMITS.employer);
    if (rateLimitResponse) return rateLimitResponse;

    try {
        const { jobId } = await params;
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const profile = await prisma.userProfile.findUnique({
            where: { supabaseId: user.id },
            select: { id: true, role: true },
        });

        if (!profile || !['employer', 'admin'].includes(profile.role)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const requested = await readRequestedState(req);
        if (!requested.ok) {
            return NextResponse.json(
                {
                    error: 'Invalid request body',
                    message: 'Send {"archived": true} to archive this post or {"archived": false} to restore it. Send no body to toggle it.',
                },
                { status: 400 },
            );
        }

        const job = await findArchivableJob(jobId, user, profile.role === 'admin');
        if (job instanceof NextResponse) return job;

        // No body toggles: archive a live post, restore an archived one.
        const archive = requested.archived ?? (job.archivedAt === null);
        return await settleArchiveState(job, archive, user.id);
    } catch (error) {
        logger.error('Error toggling job archive state', error);
        return NextResponse.json({ error: 'Failed to update archive state' }, { status: 500 });
    }
}
