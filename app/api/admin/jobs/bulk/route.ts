import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { limitHighImpactAdminAction, requireApiAdminActor } from '@/lib/auth/require-api-admin';
import { logAudit } from '@/lib/audit-log';
import { logger } from '@/lib/logger';
import { revalidateJobPage } from '@/lib/job-page-revalidation';
import { adminTakedownData, holdChange, type HoldChange } from '@/lib/admin/job-hold';
import { publishStateFields, resolveAdminActorId } from '../_lib/job-input';
import {
    HARD_DELETE_GUARD_SELECT,
    PUBLISHABLE_JOB_WHERE,
    PUBLISH_BLOCKED_MESSAGE,
    hardDeletableJobWhere,
    hardDeleteRefusal,
    isPublishBlocked,
} from '../../_lib/job-takedown';

const MAX_BULK_JOBS = 100;
const SUPPORTED_ACTIONS = ['publish', 'unpublish', 'feature', 'unfeature', 'delete', 'hard_delete'] as const;
type BulkAction = (typeof SUPPORTED_ACTIONS)[number];

const isBulkAction = (value: unknown): value is BulkAction =>
    typeof value === 'string' && (SUPPORTED_ACTIONS as readonly string[]).includes(value);

/**
 * What every bulk action reads of the jobs named: the audit row's title, the
 * page to refresh, and the state the hold, publish and hard delete guards
 * read (app/api/admin/_lib/job-takedown.ts).
 */
const BULK_JOB_SELECT = {
    id: true,
    title: true,
    slug: true,
    adminHoldAt: true,
    archivedAt: true,
    ...HARD_DELETE_GUARD_SELECT,
} satisfies Prisma.JobSelect;

type BulkJob = Prisma.JobGetPayload<{ select: typeof BULK_JOB_SELECT }>;

/**
 * What an action did: the jobs it changed and the ones it left alone, or
 * the 409 that stopped it before anything was written.
 */
type BulkOutcome =
    | { ok: true; affected: BulkJob[]; skippedJobIds: string[] }
    | { ok: false; error: string; blockedJobIds?: string[]; skippedJobIds?: string[] };

/**
 * A takedown of every job named, a posting its owner had paused included
 * (lib/admin/job-hold.ts). A posting already under a hold keeps the time of
 * its first takedown; the others get the hold now.
 */
async function takeDown(jobs: BulkJob[]): Promise<BulkOutcome> {
    const ids = jobs.map((job) => job.id);
    await prisma.$transaction([
        prisma.job.updateMany({ where: { id: { in: ids }, adminHoldAt: null }, data: adminTakedownData() }),
        prisma.job.updateMany({
            where: { id: { in: ids }, adminHoldAt: { not: null } },
            data: { isPublished: false, isManuallyUnpublished: true },
        }),
    ]);
    return { ok: true, affected: jobs, skippedJobIds: [] };
}

/**
 * Bulk publish. Archived rows and posts that are not paid for are skipped,
 * as a single publish refuses them; the rest are published and any hold on
 * them ends. A row that was unpublished comes back to the sitemap and the
 * listings, so its content changed now: it stamps contentChangedAt (sitemap
 * lastmod, the page's "Last updated", and the index-urls cron resubmits it),
 * as the single admin PATCH, toggle-publish and the Stripe paths do for a
 * revival (lib/job-content-change.ts contentChangeStamp, `revived`). A row
 * that was already published keeps its stamp. Each row is written once: the
 * already-published rows first, then the revived ones, each guarded by the
 * state it was in, the revived ones by the publish guard as well.
 */
async function publish(jobs: BulkJob[]): Promise<BulkOutcome> {
    const skippedJobIds = jobs.filter((job) => isPublishBlocked(job)).map((job) => job.id);
    const publishable = jobs.filter((job) => !skippedJobIds.includes(job.id));
    if (publishable.length === 0) return { ok: false, error: PUBLISH_BLOCKED_MESSAGE, skippedJobIds };

    const ids = publishable.map((job) => job.id);
    const live = await prisma.job.updateMany({
        where: { id: { in: ids }, isPublished: true },
        data: publishStateFields(true),
    });
    const revived = await prisma.job.updateMany({
        where: { ...PUBLISHABLE_JOB_WHERE, id: { in: ids }, isPublished: false },
        data: { ...publishStateFields(true), contentChangedAt: new Date() },
    });
    if (live.count + revived.count < ids.length) {
        // Archived, refunded or deleted between the read and the write: the
        // guard in the WHERE kept those down.
        logger.warn('[Admin Jobs Bulk] Some postings changed after the read and were not published', {
            requested: ids.length,
            published: live.count + revived.count,
        });
    }
    return { ok: true, affected: publishable, skippedJobIds };
}

/**
 * A permanent delete of every job named, or of none: one job the guard holds
 * back refuses the whole call and names it.
 */
async function hardDelete(jobs: BulkJob[]): Promise<BulkOutcome> {
    const now = new Date();
    const refusal = hardDeleteRefusal(jobs, now);
    if (refusal) return { ok: false, error: refusal.error, blockedJobIds: refusal.jobIds };

    const ids = jobs.map((job) => job.id);
    // The guard again, in the delete itself: a payment, a checkout or an
    // application landing after the read keeps the row.
    await prisma.job.deleteMany({ where: { ...hardDeletableJobWhere(now), id: { in: ids } } });
    const remaining = await prisma.job.findMany({ where: { id: { in: ids } }, select: { id: true } });
    const kept = new Set(remaining.map((job) => job.id));
    if (kept.size > 0) {
        logger.warn('[Admin Jobs Bulk] Some jobs changed after the read and were not deleted', { kept: [...kept] });
    }
    return { ok: true, affected: jobs.filter((job) => !kept.has(job.id)), skippedJobIds: [...kept] };
}

async function setFeatured(jobs: BulkJob[], isFeatured: boolean): Promise<BulkOutcome> {
    await prisma.job.updateMany({ where: { id: { in: jobs.map((job) => job.id) } }, data: { isFeatured } });
    return { ok: true, affected: jobs, skippedJobIds: [] };
}

function runBulkAction(action: BulkAction, jobs: BulkJob[]): Promise<BulkOutcome> {
    switch (action) {
        case 'unpublish':
        case 'delete':
            return takeDown(jobs);
        case 'publish':
            return publish(jobs);
        case 'hard_delete':
            return hardDelete(jobs);
        case 'feature':
        case 'unfeature':
            return setFeatured(jobs, action === 'feature');
    }
}

/** What a bulk takedown or publish did to the job's hold, for its audit row. */
function holdMetadata(action: BulkAction, job: BulkJob): { hold?: HoldChange } {
    if (action === 'unpublish' || action === 'delete') return { hold: holdChange(false, job.adminHoldAt) };
    if (action === 'publish') return { hold: holdChange(true, job.adminHoldAt) };
    return {};
}

/** One AuditLog row per affected job, naming the admin who acted. */
async function auditBulk(action: BulkAction, affected: BulkJob[]): Promise<void> {
    const actorId = await resolveAdminActorId();
    await Promise.all(
        affected.map((job) =>
            logAudit({
                action: `admin.job.bulk_${action}`,
                actorType: 'admin',
                actorId,
                targetType: 'job',
                targetId: job.id,
                metadata: { jobTitle: job.title, batchSize: affected.length, ...holdMetadata(action, job) },
            }),
        ),
    );
}

/**
 * POST /api/admin/jobs/bulk
 * Bulk actions on multiple jobs.
 * Body: { action: 'publish' | 'unpublish' | 'feature' | 'unfeature' | 'delete' | 'hard_delete', jobIds: string[] }
 *
 * unpublish and delete are takedowns (lib/admin/job-hold.ts). publish skips
 * archived and unpaid posts and names them in skippedJobIds; when every job
 * named is one of those it answers 409. hard_delete refuses the whole batch
 * with 409 and names the jobs in blockedJobIds when any job is an employer
 * post that was paid for, an unpaid one whose checkout can still be paid, or
 * a job with applications (the same guard as DELETE ?hard=true). Every
 * affected job gets its own AuditLog row and its cached page cleared.
 *
 * A hard_delete is also charged to the admin's high-impact budget (10 a
 * minute) on top of the general admin one; a 429 there deletes nothing.
 */
export async function POST(request: NextRequest) {
    const { error: authError, actor } = await requireApiAdminActor(request);
    if (authError) return authError;

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ success: false, error: 'Request body must be valid JSON' }, { status: 400 });
    }

    const { action, jobIds } = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;

    if (!action || !Array.isArray(jobIds) || jobIds.length === 0) {
        return NextResponse.json(
            { success: false, error: 'action and jobIds[] are required' },
            { status: 400 },
        );
    }
    if (!jobIds.every((jobId) => typeof jobId === 'string' && jobId.length > 0)) {
        return NextResponse.json({ success: false, error: 'jobIds must be non-empty strings' }, { status: 400 });
    }
    if (jobIds.length > MAX_BULK_JOBS) {
        return NextResponse.json(
            { success: false, error: `Maximum ${MAX_BULK_JOBS} jobs per bulk action` },
            { status: 400 },
        );
    }
    if (!isBulkAction(action)) {
        return NextResponse.json(
            { success: false, error: `Invalid action: ${String(action)}. Supported: ${SUPPORTED_ACTIONS.join(', ')}` },
            { status: 400 },
        );
    }

    if (action === 'hard_delete') {
        const limited = await limitHighImpactAdminAction('jobs-hard-delete', actor);
        if (limited) return limited;
    }

    const ids = [...new Set(jobIds as string[])];

    try {
        const jobs = await prisma.job.findMany({ where: { id: { in: ids } }, select: BULK_JOB_SELECT });
        const outcome = await runBulkAction(action, jobs);
        if (!outcome.ok) {
            return NextResponse.json(
                {
                    success: false,
                    error: outcome.error,
                    ...(outcome.blockedJobIds && { blockedJobIds: outcome.blockedJobIds }),
                    ...(outcome.skippedJobIds && { skippedJobIds: outcome.skippedJobIds }),
                },
                { status: 409 },
            );
        }

        // The job pages are cached for a day: show the change now.
        for (const job of outcome.affected) revalidateJobPage(job.slug, 'Admin Jobs Bulk');
        await auditBulk(action, outcome.affected);

        return NextResponse.json({
            success: true,
            action,
            affected: outcome.affected.length,
            ...(outcome.skippedJobIds.length > 0 && { skippedJobIds: outcome.skippedJobIds }),
        });
    } catch (error) {
        console.error('[Admin Jobs Bulk] Error:', error);
        return NextResponse.json({ success: false, error: 'Bulk action failed' }, { status: 500 });
    }
}
