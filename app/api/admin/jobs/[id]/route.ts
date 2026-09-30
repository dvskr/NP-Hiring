import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiAdmin } from '@/lib/auth/require-api-admin';
import { inngest } from '@/lib/inngest/client';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit-log';
import { contentChangeStamp } from '@/lib/job-content-change';
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
        const edits: Record<string, unknown> = {
            ...withOrderedSalary(validated.data),
            ...(typeof validated.data.isPublished === 'boolean' ? publishStateFields(validated.data.isPublished) : {}),
            ...(expiresAt !== undefined ? { expiresAt } : {}),
        };
        // contentChangedAt (sitemap lastmod, "Last updated") moves when the
        // edit changes a rendered field or republishes the job; feature,
        // verification and quality-score edits leave it alone.
        const data: Record<string, unknown> = {
            ...edits,
            ...contentChangeStamp(prior, edits, {
                revived: edits.isPublished === true && prior.isPublished === false,
            }),
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

/**
 * paymentStatus values whose EmployerJob row anchors a per-domain
 * entitlement and therefore must survive a hard delete:
 *   'free' is legacy free-quota rows (audit #25).
 *   'paid' is the intro-price allowance: lib/pricing.ts#getNextPaidTier
 *          quotes 'intro' whenever a domain has ZERO 'paid' rows, so
 *          cascading one away would re-open config.introPrice for the
 *          whole company domain.
 * 'promo' and 'plan' rows are not anchors (the promo cap and plan slots
 * count LIVE posts only, and soft-delete already unpublishes), so admins
 * can still hard-delete those.
 */
const HARD_DELETE_PROTECTED_STATUSES = ['free', 'paid'] as const;

const isHardDeleteProtected = (status: string | null | undefined): boolean =>
    status != null && (HARD_DELETE_PROTECTED_STATUSES as readonly string[]).includes(status);

/** What the caller loses if we let the cascade through, per anchor status. */
const HARD_DELETE_ANCHOR_LABELS: Record<string, string> = {
    free: 'free quota record',
    paid: 'intro price allowance',
};

/**
 * 409 copy for a blocked hard delete. `status` is omitted when the block
 * came from the re-check inside the write, where we no longer know which
 * anchor status the row had raced into.
 */
const hardDeleteBlockedError = (status?: string | null): string => {
    const posting = status ? `a ${status} posting` : 'this posting';
    const anchor = (status && HARD_DELETE_ANCHOR_LABELS[status]) || 'per-domain pricing record';
    return `Cannot hard-delete ${posting} because the cascade would erase the ${anchor}. Soft-delete it (no ?hard flag) instead, or contact engineering for a record-preserving removal.`;
};

/**
 * DELETE /api/admin/jobs/:id
 * Soft-delete by default (unpublishes and pins against ingest renewal).
 * Use ?hard=true for permanent deletion.
 *
 * Audit #25: hard-delete is BLOCKED on rows in HARD_DELETE_PROTECTED_STATUSES.
 * Cascade-deleting an EmployerJob row that anchors a per-domain entitlement
 * would reset it, letting the (probably just spammy) employer start again
 * from a clean slate. Admin can still soft-delete such posts, which removes
 * them from search without nuking the pricing signal.
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
            // Audit #25: refuse hard-delete if the EmployerJob row anchors a
            // per-domain entitlement (legacy free quota, intro-price
            // allowance). Cascade through EmployerJob would drop the
            // quotaDomain row the pricing rules count against.
            const anchorStatus = job.employerJobs?.paymentStatus ?? null;
            if (isHardDeleteProtected(anchorStatus)) {
                return NextResponse.json(
                    { success: false, error: hardDeleteBlockedError(anchorStatus) },
                    { status: 409 },
                );
            }
            // The paymentStatus filter repeats the guard inside the write so
            // a row that became an anchor between the read and the delete
            // still survives.
            const deleted = await prisma.job.deleteMany({
                where: {
                    id,
                    NOT: {
                        employerJobs: {
                            is: { paymentStatus: { in: [...HARD_DELETE_PROTECTED_STATUSES] } },
                        },
                    },
                },
            });
            if (deleted.count === 0) {
                return NextResponse.json(
                    { success: false, error: hardDeleteBlockedError() },
                    { status: 409 },
                );
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
