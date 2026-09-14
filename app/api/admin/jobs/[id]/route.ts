import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiAdmin } from '@/lib/auth/require-api-admin';
import { inngest } from '@/lib/inngest/client';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit-log';
import {
    UPDATE_FIELD_KINDS,
    patchAuditAction,
    publishStateFields,
    resolveAdminActorId,
    validateJobUpdate,
    withOrderedSalary,
} from '../_lib/job-input';

/**
 * GET /api/admin/jobs/:id
 * Full job detail with engagement stats.
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const authError = await requireApiAdmin(request);
    if (authError) return authError;

    const { id } = await params;

    try {
        const job = await prisma.job.findUnique({
            where: { id },
            include: {
                _count: {
                    select: {
                        applyClicks: true,
                        jobApplications: true,
                        jobViewEvents: true,
                        jobReports: true,
                    },
                },
            },
        });

        if (!job) {
            return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });
        }

        return NextResponse.json({ success: true, job });
    } catch (error) {
        console.error('[Admin Jobs] GET/:id error:', error);
        return NextResponse.json({ success: false, error: 'Failed to fetch job' }, { status: 500 });
    }
}

/** Long or list fields kept out of the audit before/after diff (size, not secrecy). */
const AUDIT_DIFF_EXCLUDED = new Set(['description', 'descriptionSummary', 'benefits']);
const EMBED_FIELDS = ['title', 'description', 'setting', 'population', 'state', 'benefits'];
const MAX_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000; // 12 months

const badRequest = (error: string) => NextResponse.json({ success: false, error }, { status: 400 });

/**
 * Validate expiresAt. Must be parseable, in the future and within 12 months.
 * `null` is an explicit clear (archive/cleanup workflows).
 */
function parseExpiresAt(raw: unknown): { ok: true; value: Date | null } | { ok: false; error: string } {
    if (raw === null) return { ok: true, value: null };
    const parsed = typeof raw === 'string' || typeof raw === 'number' ? new Date(raw) : new Date(Number.NaN);
    if (Number.isNaN(parsed.getTime())) return { ok: false, error: 'expiresAt must be a valid date' };
    const now = Date.now();
    if (parsed.getTime() < now) {
        return { ok: false, error: 'expiresAt cannot be in the past. Use isPublished=false to unpublish instead.' };
    }
    if (parsed.getTime() > now + MAX_EXPIRY_MS) {
        return { ok: false, error: 'expiresAt cannot be more than 12 months in the future' };
    }
    return { ok: true, value: parsed };
}

/**
 * PATCH /api/admin/jobs/:id
 * Update allow-listed job fields. Every value is type and shape validated
 * (400 on failure, nothing written) and every change is audit-logged.
 */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const authError = await requireApiAdmin(request);
    if (authError) return authError;

    const { id } = await params;

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return badRequest('Request body must be valid JSON');
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        return badRequest('Request body must be a JSON object');
    }
    const knownKeys = Object.keys(body).filter((k) => k in UPDATE_FIELD_KINDS || k === 'expiresAt');
    if (knownKeys.length === 0) return badRequest('No valid fields provided');

    try {
        const priorSelect = Object.fromEntries(
            [...Object.keys(UPDATE_FIELD_KINDS), 'expiresAt'].map((k) => [k, true]),
        );
        const prior = await prisma.job.findUnique({ where: { id }, select: priorSelect }) as Record<string, unknown> | null;
        if (!prior) {
            return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });
        }

        const validated = validateJobUpdate(body, prior.applyLink as string | null);
        if (!validated.ok) return badRequest(validated.error);

        let expiresAt: Date | null | undefined;
        if ('expiresAt' in body) {
            const parsed = parseExpiresAt((body as Record<string, unknown>).expiresAt);
            if (!parsed.ok) return badRequest(parsed.error);
            expiresAt = parsed.value;
        }

        const fields = Object.keys(validated.data);
        const data: Record<string, unknown> = {
            ...withOrderedSalary(validated.data),
            ...(typeof validated.data.isPublished === 'boolean' ? publishStateFields(validated.data.isPublished) : {}),
            ...(expiresAt !== undefined ? { expiresAt } : {}),
        };

        const job = await prisma.job.update({
            where: { id },
            data,
            select: {
                id: true, title: true, employer: true, isPublished: true,
                isFeatured: true, updatedAt: true, expiresAt: true,
            },
        });

        // Refresh the embedding when an embedded-text field changes; the
        // Inngest 30s throttle dedupes. No-op if Inngest env is not set.
        if (EMBED_FIELDS.some((f) => f in data)) {
            inngest.send({ name: 'embedding.refresh.job', data: { jobId: id } }).catch((err) => {
                logger.warn('inngest.send embedding.refresh.job failed (admin edit)', undefined, err);
            });
        }

        const actorId = await resolveAdminActorId();
        const priorTitle = prior.title as string;

        if (fields.length > 0) {
            const changes = Object.fromEntries(
                fields
                    .filter((f) => !AUDIT_DIFF_EXCLUDED.has(f))
                    .map((f) => [f, { from: prior[f] ?? null, to: data[f] ?? null }]),
            );
            await logAudit({
                action: patchAuditAction(fields, data),
                actorType: 'admin',
                actorId,
                targetType: 'job',
                targetId: id,
                metadata: { jobTitle: priorTitle, fields, changes },
            });
        }

        if (expiresAt !== undefined) {
            const priorIso = (prior.expiresAt as Date | null)?.toISOString() ?? null;
            const newIso = job.expiresAt?.toISOString() ?? null;
            if (priorIso !== newIso) {
                await logAudit({
                    action: 'admin.job.expiry_change',
                    actorType: 'admin',
                    actorId,
                    targetType: 'job',
                    targetId: id,
                    metadata: { from: priorIso, to: newIso, jobTitle: priorTitle },
                });
            }
        }

        return NextResponse.json({ success: true, job });
    } catch (error) {
        console.error('[Admin Jobs] PATCH error:', error);
        return NextResponse.json({ success: false, error: 'Failed to update job' }, { status: 500 });
    }
}

const FREE_HARD_DELETE_ERROR =
    'Cannot hard-delete a free posting because the cascade would erase the free quota record. Soft-delete it (no ?hard flag) instead, or contact engineering for a quota-preserving removal.';

/**
 * DELETE /api/admin/jobs/:id
 * Soft-delete by default (unpublishes and pins against ingest renewal).
 * Use ?hard=true for permanent deletion.
 *
 * Audit #25: hard-delete is BLOCKED on free posts. Cascade-deleting an
 * EmployerJob row that recorded a free posting would drop the domain's
 * free-post count, letting the employer post fresh free jobs from a clean
 * slate. Admin can still soft-delete free posts.
 */
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const authError = await requireApiAdmin(request);
    if (authError) return authError;

    const { id } = await params;
    const hard = new URL(request.url).searchParams.get('hard') === 'true';

    try {
        const job = await prisma.job.findUnique({
            where: { id },
            select: {
                title: true,
                employer: true,
                isPublished: true,
                employerJobs: { select: { paymentStatus: true } },
            },
        });
        if (!job) {
            return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });
        }
        const actorId = await resolveAdminActorId();

        if (hard) {
            if (job.employerJobs?.paymentStatus === 'free') {
                return NextResponse.json({ success: false, error: FREE_HARD_DELETE_ERROR }, { status: 409 });
            }
            // The paymentStatus filter repeats the guard inside the write so
            // a row that became free between the read and the delete survives.
            const deleted = await prisma.job.deleteMany({
                where: { id, NOT: { employerJobs: { is: { paymentStatus: 'free' } } } },
            });
            if (deleted.count === 0) {
                return NextResponse.json({ success: false, error: FREE_HARD_DELETE_ERROR }, { status: 409 });
            }
            await logAudit({
                action: 'admin.job.hard_delete',
                actorType: 'admin',
                actorId,
                targetType: 'job',
                targetId: id,
                metadata: {
                    jobTitle: job.title,
                    employer: job.employer,
                    paymentStatus: job.employerJobs?.paymentStatus ?? null,
                },
            });
            return NextResponse.json({ success: true, action: 'hard_deleted' });
        }

        await prisma.job.update({ where: { id }, data: publishStateFields(false) });
        await logAudit({
            action: 'admin.job.soft_delete',
            actorType: 'admin',
            actorId,
            targetType: 'job',
            targetId: id,
            metadata: { jobTitle: job.title, employer: job.employer, wasPublished: job.isPublished },
        });

        return NextResponse.json({ success: true, action: 'soft_deleted' });
    } catch (error) {
        console.error('[Admin Jobs] DELETE error:', error);
        return NextResponse.json({ success: false, error: 'Failed to delete job' }, { status: 500 });
    }
}
