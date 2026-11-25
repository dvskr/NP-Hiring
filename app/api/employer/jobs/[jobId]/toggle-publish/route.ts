import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { createClient } from '@/lib/supabase/server';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { readJsonObject } from '@/lib/request-body';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { inngest } from '@/lib/inngest/client';
import { employerJobOwnershipBranches, type EmployerJobOwner } from '@/lib/employer-ownership';
import { ADMIN_HOLD_MESSAGE, adminReleaseData, adminTakedownData, holdChange } from '@/lib/admin/job-hold';
import { logAudit } from '@/lib/audit-log';
import { insideRunWhere } from '@/lib/active-job-filter';
import { PUBLISHABLE_JOB_WHERE, PUBLISH_BLOCKED_MESSAGE, isPublishBlocked, isRecordNotFound } from '@/app/api/admin/_lib/job-takedown';

/** The job columns an owner's toggle reads beside its EmployerJob: what the publish gates check. */
const OWNED_JOB_SELECT = {
    id: true,
    title: true,
    isPublished: true,
    expiresAt: true,
    archivedAt: true,
    adminHoldAt: true,
} satisfies Prisma.JobSelect;

/**
 * The columns an admin's toggle reads from a posting it does not own: the
 * owner's payment state too, which the publish guard reads
 * (app/api/admin/_lib/job-takedown.ts).
 */
const ADMIN_JOB_SELECT = {
    ...OWNED_JOB_SELECT,
    employerJobs: { select: { paymentStatus: true } },
} satisfies Prisma.JobSelect;

/**
 * The signed-in owner's EmployerJob for the job, with the job's gate
 * columns, or null when this user does not own it. Ownership is built by
 * the one helper (lib/employer-ownership.ts). P5.A (2026-06-01): the
 * contactEmail fallback is honored only for legacy rows that never got a
 * claimed userId, which closes the signup-with-existing-employer-email
 * impersonation surface.
 */
function findOwnedPosting(jobId: string, user: EmployerJobOwner) {
    return prisma.employerJob.findFirst({
        where: {
            jobId,
            OR: employerJobOwnershipBranches(user),
        },
        include: { job: { select: OWNED_JOB_SELECT } },
    });
}

/** A posting an admin acts on without owning it. */
function findPostingForAdmin(jobId: string) {
    return prisma.job.findUnique({ where: { id: jobId }, select: ADMIN_JOB_SELECT });
}

type OwnedPosting = NonNullable<Awaited<ReturnType<typeof findOwnedPosting>>>;
type AdminPosting = NonNullable<Awaited<ReturnType<typeof findPostingForAdmin>>>;

/** What a toggle writes to the posting. */
interface VisibilityData {
    isPublished: boolean;
    isManuallyUnpublished: boolean;
    unpublishReason?: string | null;
    unpublishReasonNote?: string | null;
    unpublishedAt?: Date;
    adminHoldAt?: Date | null;
    contentChangedAt?: Date;
}

/**
 * The owner's pause or resume. A pause records when, and why when the modal
 * said (the note only with the reason "other"). A resume clears the manual
 * flag so the cron lifecycle treats the row as active again, and stamps
 * contentChangedAt: the posting is public again, so its content counts as
 * changed now (sitemap lastmod, "Last updated"; indexing audit fixSoon 5).
 * The reason stays as the historical record.
 */
function ownerVisibilityData(live: boolean, reason: string | null, note: string | null): VisibilityData {
    if (live) return { isPublished: true, isManuallyUnpublished: false, contentChangedAt: new Date() };
    return {
        isPublished: false,
        isManuallyUnpublished: true,
        unpublishedAt: new Date(),
        ...(reason ? { unpublishReason: reason, unpublishReasonNote: reason === 'other' ? note : null } : {}),
    };
}

/**
 * An admin pausing or resuming a posting it does not own. A pause is a
 * takedown (lib/admin/job-hold.ts): it places the hold, keeps an earlier
 * takedown's time, and leaves the owner's pause fields alone. A resume ends
 * the hold and any pause.
 */
function adminVisibilityData(live: boolean, heldSince: Date | null): VisibilityData {
    return live ? { ...adminReleaseData(), contentChangedAt: new Date() } : adminTakedownData(heldSince ?? new Date());
}

/** The refusal for a posting under an admin hold. `message` is the text the dashboard shows. */
function adminHoldRefusal(): NextResponse {
    return NextResponse.json(
        { error: ADMIN_HOLD_MESSAGE, message: ADMIN_HOLD_MESSAGE, cause: 'admin_hold' },
        { status: 403 },
    );
}

/**
 * The refusal for an admin putting back a posting that is archived or has no
 * completed payment, the same rule and text as the admin jobs page.
 */
function publishBlockedRefusal(): NextResponse {
    return NextResponse.json(
        { error: PUBLISH_BLOCKED_MESSAGE, message: PUBLISH_BLOCKED_MESSAGE, cause: 'publish_blocked' },
        { status: 409 },
    );
}

/**
 * Payment gate (2026-05-15): an employer who started a paid checkout and
 * closed the window before paying ends up with paymentStatus='pending'.
 * Without this guard they could republish via the dashboard's pause/unpause
 * button and get a Live + Featured post for free. Republishing waits until
 * the payment cleared (paid, legacy free, launch promo, a pack credit).
 */
function paymentRefusal(owned: OwnedPosting, willPublish: boolean): NextResponse | null {
    const ps = owned.paymentStatus;
    if (willPublish && !DIRECTLY_REPUBLISHABLE_STATUSES.has(ps)) {
        return NextResponse.json(
            {
                error: 'Payment required',
                message: ps === 'pending'
                    ? 'This posting has not been paid yet. Complete checkout to publish.'
                    : 'This posting cannot be republished (refunded or invalid payment state).',
                paymentStatus: ps,
                editLink: `/jobs/edit/${owned.editToken}`,
            },
            { status: 402 }
        );
    }
    return null;
}

/**
 * An archived listing is never live (archive/route.ts unpublishes in the
 * same write). Republishing one here would leave it archived and live at
 * once. Restore first, then republish.
 */
function archivedRefusal(): NextResponse {
    return NextResponse.json(
        {
            error: 'Job is archived',
            message: 'This post is archived. Restore it from the Archived tab before you republish it.',
            archived: true,
        },
        { status: 409 }
    );
}

/** An expired job cannot be republished from here: it is already off the board. */
function expiredRefusal(): NextResponse {
    return NextResponse.json({ error: 'Cannot modify an expired job' }, { status: 400 });
}

function ownerNotFound(): NextResponse {
    return NextResponse.json({ error: 'Job not found or access denied' }, { status: 404 });
}

function jobNotFound(): NextResponse {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
}

/** A write that matched no row, when the posting as it is now explains nothing. */
function changedConflict(): NextResponse {
    const message = 'This posting changed while it was being updated. Refresh the page and try again.';
    return NextResponse.json({ error: message, message }, { status: 409 });
}

/** The archived and expiry gates both paths share, in the order the route checks them. */
function runRefusal(job: Pick<AdminPosting, 'archivedAt' | 'expiresAt'>, now: Date): NextResponse | null {
    if (job.archivedAt) return archivedRefusal();
    if (job.expiresAt && job.expiresAt.getTime() < now.getTime()) return expiredRefusal();
    return null;
}

/**
 * Why the owner may not put this paused posting back live, or null: a
 * takedown by an admin (lib/admin/job-hold.ts, checked before anything else
 * so the owner is told why, whatever else is true of the posting), then the
 * payment, then archived, then expired.
 */
function ownerPublishRefusal(owned: OwnedPosting, now: Date): NextResponse | null {
    if (owned.job.adminHoldAt) return adminHoldRefusal();
    return paymentRefusal(owned, true) ?? runRefusal(owned.job, now);
}

/**
 * Why an admin may not put back a posting it does not own, or null:
 * archived, expired, then the admin jobs page's publish guard (never a
 * posting whose checkout was never paid, or whose payment was refunded or
 * disputed).
 */
function adminPublishRefusal(job: AdminPosting, now: Date): NextResponse | null {
    return runRefusal(job, now) ?? (isPublishBlocked(job) ? publishBlockedRefusal() : null);
}

/**
 * The WHERE of an owner's resume: every gate ownerPublishRefusal checks, so
 * a takedown, a refund or dispute, an archive or the end of the run landing
 * after the read cannot be overtaken.
 */
function ownerPublishWhere(jobId: string, now: Date): Prisma.JobWhereUniqueInput {
    return {
        id: jobId,
        adminHoldAt: null,
        archivedAt: null,
        employerJobs: { is: { paymentStatus: { in: [...DIRECTLY_REPUBLISHABLE_STATUSES] } } },
        ...insideRunWhere(now),
    };
}

/** The WHERE of an admin's publish: the admin jobs page's publish guard, and the run. */
function adminPublishWhere(jobId: string, now: Date): Prisma.JobWhereUniqueInput {
    return { ...PUBLISHABLE_JOB_WHERE, id: jobId, AND: [insideRunWhere(now)] };
}

/** The toggle's one write. False when its WHERE matched no row (Prisma P2025). */
async function writeToggle(where: Prisma.JobWhereUniqueInput, data: VisibilityData): Promise<boolean> {
    try {
        await prisma.job.update({ where, data });
        return true;
    } catch (error) {
        if (isRecordNotFound(error)) return false;
        throw error;
    }
}

/**
 * An owner's write that matched no row, answered from the posting as it is
 * now with what the read would have answered: gone, or (for a paused
 * posting) taken down, unpaid, archived or expired.
 */
async function staleOwnerAnswer(jobId: string, user: EmployerJobOwner, isAdmin: boolean, now: Date): Promise<NextResponse> {
    const fresh = await findOwnedPosting(jobId, user);
    if (!fresh) return isAdmin ? jobNotFound() : ownerNotFound();
    const refusal = fresh.job.isPublished ? null : ownerPublishRefusal(fresh, now);
    return refusal ?? changedConflict();
}

/** An admin's write that matched no row, answered the same way from the posting as it is now. */
async function staleAdminAnswer(jobId: string, now: Date): Promise<NextResponse> {
    const fresh = await findPostingForAdmin(jobId);
    if (!fresh) return jobNotFound();
    const refusal = fresh.isPublished ? null : adminPublishRefusal(fresh, now);
    return refusal ?? changedConflict();
}

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

        // One instant for the expiry gate on the read and in the write's WHERE.
        const now = new Date();
        const isAdmin = profile.role === 'admin';
        const owned = await findOwnedPosting(jobId, user);
        if (owned) {
            return await toggleOwned(owned, { user, isAdmin, reason: providedReason, note: providedNote, now });
        }

        // An admin acting on a posting it does not own takes it down or puts
        // it back; never an owner, an admin who owns it included.
        if (!isAdmin) return ownerNotFound();
        const job = await findPostingForAdmin(jobId);
        if (!job) return jobNotFound();
        return await toggleAsAdmin(job, { userId: user.id, adminProfileId: profile.id, now });
    } catch (error) {
        logger.error('Error toggling job publish status', error);
        return NextResponse.json({ error: 'Failed to update job status' }, { status: 500 });
    }
}

interface OwnerToggle {
    user: EmployerJobOwner;
    isAdmin: boolean;
    reason: string | null;
    note: string | null;
    now: Date;
}

/**
 * The owner pausing or resuming their own posting. A resume meets every
 * gate first and carries all of them in the write's WHERE; a write that
 * then matches no row is answered from the posting as it is now.
 */
async function toggleOwned(owned: OwnedPosting, toggle: OwnerToggle): Promise<NextResponse> {
    const job = owned.job;
    const publishing = !job.isPublished;
    if (publishing) {
        const refusal = ownerPublishRefusal(owned, toggle.now);
        if (refusal) return refusal;
    }
    const written = await writeToggle(
        publishing ? ownerPublishWhere(job.id, toggle.now) : { id: job.id },
        ownerVisibilityData(publishing, toggle.reason, toggle.note),
    );
    if (!written) return staleOwnerAnswer(job.id, toggle.user, toggle.isAdmin, toggle.now);
    return toggled(job, publishing, toggle.user.id);
}

interface AdminToggle {
    userId: string;
    adminProfileId: string;
    now: Date;
}

/**
 * An admin taking down or putting back a posting it does not own
 * (lib/admin/job-hold.ts). A publish meets the admin jobs page's guard and
 * carries it, with the run, in the write's WHERE. Recorded like a change
 * made from the admin jobs page.
 */
async function toggleAsAdmin(job: AdminPosting, toggle: AdminToggle): Promise<NextResponse> {
    const publishing = !job.isPublished;
    if (publishing) {
        const refusal = adminPublishRefusal(job, toggle.now);
        if (refusal) return refusal;
    }
    const written = await writeToggle(
        publishing ? adminPublishWhere(job.id, toggle.now) : { id: job.id },
        adminVisibilityData(publishing, job.adminHoldAt),
    );
    if (!written) return staleAdminAnswer(job.id, toggle.now);
    await logAudit({
        action: publishing ? 'admin.job.publish' : 'admin.job.unpublish',
        actorType: 'admin',
        actorId: toggle.adminProfileId,
        targetType: 'job',
        targetId: job.id,
        metadata: { via: 'toggle-publish', hold: holdChange(publishing, job.adminHoldAt) },
    });
    return toggled(job, publishing, toggle.userId);
}

/** After a toggle was written: the log, the embedding refresh on a republish, the answer. */
function toggled(job: { id: string; title: string }, published: boolean, userId: string): NextResponse {
    logger.info('Job publish status toggled', {
        jobId: job.id,
        title: job.title,
        isPublished: published,
        userId,
    });

    // C1: on republish the job re-enters the catalog with a possibly stale or
    // absent embedding, so refresh it to surface it in AI search. Fire-and-forget.
    if (published) {
        inngest.send({
            name: 'embedding.refresh.job',
            data: { jobId: job.id },
        }).catch((err) => {
            logger.warn('inngest.send embedding.refresh.job failed (toggle-publish)', { error: String(err) });
        });
    }

    return NextResponse.json({
        success: true,
        isPublished: published,
        message: published ? 'Job is now live' : 'Job has been paused',
    });
}
