import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiAdmin } from '@/lib/auth/require-api-admin';
import { logAudit } from '@/lib/audit-log';
import { publishStateFields, resolveAdminActorId } from '../_lib/job-input';

const MAX_BULK_JOBS = 100;
const SUPPORTED_ACTIONS = ['publish', 'unpublish', 'feature', 'unfeature', 'delete', 'hard_delete'] as const;
type BulkAction = (typeof SUPPORTED_ACTIONS)[number];

const isBulkAction = (value: unknown): value is BulkAction =>
    typeof value === 'string' && (SUPPORTED_ACTIONS as readonly string[]).includes(value);

/** Update payload for every non-destructive action. Unpublish paths pin against ingest renewal. */
function updateDataFor(action: Exclude<BulkAction, 'hard_delete'>): Record<string, unknown> {
    if (action === 'publish') return publishStateFields(true);
    if (action === 'unpublish' || action === 'delete') return publishStateFields(false);
    return { isFeatured: action === 'feature' };
}

/**
 * POST /api/admin/jobs/bulk
 * Bulk actions on multiple jobs.
 * Body: { action: 'publish' | 'unpublish' | 'feature' | 'unfeature' | 'delete' | 'hard_delete', jobIds: string[] }
 *
 * hard_delete refuses the whole batch when any job is a free posting (same
 * Audit #25 guard as DELETE ?hard=true): the EmployerJob cascade would erase
 * the free quota record. Every affected job gets its own AuditLog row.
 */
export async function POST(request: NextRequest) {
    const authError = await requireApiAdmin(request);
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

    const ids = [...new Set(jobIds as string[])];

    try {
        const jobs = await prisma.job.findMany({
            where: { id: { in: ids } },
            select: { id: true, title: true, employerJobs: { select: { paymentStatus: true } } },
        });

        let affectedIds: string[];

        if (action === 'hard_delete') {
            const freeIds = jobs.filter((j) => j.employerJobs?.paymentStatus === 'free').map((j) => j.id);
            if (freeIds.length > 0) {
                return NextResponse.json(
                    {
                        success: false,
                        error: 'Cannot hard-delete free postings because the cascade would erase the free quota record. Soft-delete them instead. Nothing was deleted.',
                        freeJobIds: freeIds,
                    },
                    { status: 409 },
                );
            }
            // Repeat the guard inside the write so a row that became free
            // between the read and the delete survives.
            await prisma.job.deleteMany({
                where: { id: { in: jobs.map((j) => j.id) }, NOT: { employerJobs: { is: { paymentStatus: 'free' } } } },
            });
            const remaining = await prisma.job.findMany({
                where: { id: { in: jobs.map((j) => j.id) } },
                select: { id: true },
            });
            const remainingIds = new Set(remaining.map((j) => j.id));
            affectedIds = jobs.map((j) => j.id).filter((jobId) => !remainingIds.has(jobId));
        } else {
            await prisma.job.updateMany({
                where: { id: { in: jobs.map((j) => j.id) } },
                data: updateDataFor(action),
            });
            affectedIds = jobs.map((j) => j.id);
        }

        const actorId = await resolveAdminActorId();
        const titles = new Map(jobs.map((j) => [j.id, j.title]));
        await Promise.all(
            affectedIds.map((jobId) =>
                logAudit({
                    action: `admin.job.bulk_${action}`,
                    actorType: 'admin',
                    actorId,
                    targetType: 'job',
                    targetId: jobId,
                    metadata: { jobTitle: titles.get(jobId) ?? null, batchSize: affectedIds.length },
                }),
            ),
        );

        return NextResponse.json({
            success: true,
            action,
            affected: affectedIds.length,
        });
    } catch (error) {
        console.error('[Admin Jobs Bulk] Error:', error);
        return NextResponse.json({ success: false, error: 'Bulk action failed' }, { status: 500 });
    }
}
