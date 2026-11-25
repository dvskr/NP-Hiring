import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireApiAdmin } from '@/lib/auth/require-api-admin';
import { inngest } from '@/lib/inngest/client';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit-log';
import { contentChangeStamp } from '@/lib/job-content-change';
import { revalidateJobPage } from '@/lib/job-page-revalidation';
import { holdChange } from '@/lib/admin/job-hold';
import {
    UPDATE_FIELD_KINDS,
    patchAuditAction,
    publishStateFields,
    resolveAdminActorId,
    validateJobUpdate,
    withOrderedSalary,
} from '../_lib/job-input';
import {
    HARD_DELETE_CHANGED_MESSAGE,
    HARD_DELETE_GUARD_SELECT,
    PUBLISHABLE_JOB_WHERE,
    PUBLISH_BLOCKED_MESSAGE,
    hardDeletableJobWhere,
    hardDeleteRefusal,
    isPublishBlocked,
    isRecordNotFound,
} from '../../_lib/job-takedown';

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

/**
 * Columns PATCH reads before it writes: every editable field (the audit diff
 * and the content stamp compare them), and the hold, archive and payment
 * state the publish guard and the takedown read.
 */
const PATCH_PRIOR_SELECT = Object.fromEntries(
    [...Object.keys(UPDATE_FIELD_KINDS), 'expiresAt', 'adminHoldAt', 'archivedAt', 'employerJobs'].map((k) => [k, true]),
);

const badRequest = (error: string) => NextResponse.json({ success: false, error }, { status: 400 });
const notFound = () => NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });
const conflict = (error: string) => NextResponse.json({ success: false, error }, { status: 409 });

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

/** The PATCH body as an object naming at least one field PATCH knows, or the 400 to answer. */
async function readPatchBody(request: NextRequest): Promise<{ body: Record<string, unknown> } | { error: NextResponse }> {
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return { error: badRequest('Request body must be valid JSON') };
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        return { error: badRequest('Request body must be a JSON object') };
    }
    const record = body as Record<string, unknown>;
    const knownKeys = Object.keys(record).filter((k) => k in UPDATE_FIELD_KINDS || k === 'expiresAt');
    if (knownKeys.length === 0) return { error: badRequest('No valid fields provided') };
    return { body: record };
}

/** The prior row's hold, archive and payment state, as the publish guard reads it. */
function priorPublishState(prior: Record<string, unknown>) {
    return {
        adminHoldAt: (prior.adminHoldAt as Date | null | undefined) ?? null,
        archivedAt: (prior.archivedAt as Date | null | undefined) ?? null,
        employerJobs: (prior.employerJobs as { paymentStatus: string } | null | undefined) ?? null,
    };
}

/**
 * The job write. A publish of a posting that was down carries the publish
 * guard in its WHERE, so an archive or a refund landing after the read
 * cannot be overtaken. Null when no row matched.
 */
async function writeJobUpdate(id: string, data: Record<string, unknown>, reviving: boolean) {
    try {
        return await prisma.job.update({
            where: reviving ? { ...PUBLISHABLE_JOB_WHERE, id } : { id },
            data,
            select: {
                id: true, title: true, employer: true, isPublished: true,
                isFeatured: true, updatedAt: true, expiresAt: true, slug: true,
            },
        });
    } catch (error) {
        if (isRecordNotFound(error)) return null;
        throw error;
    }
}

interface PatchAudit {
    id: string;
    prior: Record<string, unknown>;
    data: Record<string, unknown>;
    fields: string[];
    /** The isPublished the body sent, if it sent one. */
    publish: boolean | undefined;
    /** The expiry the body sent, if it sent one. */
    expiresAt: Date | null | undefined;
    /** The expiry stored after the write. */
    storedExpiresAt: Date | null;
}

/**
 * The PATCH audit rows: the edit, with what it did to the admin hold when it
 * published or unpublished, and an expiry change of its own.
 */
async function auditPatch(audit: PatchAudit): Promise<void> {
    const actorId = await resolveAdminActorId();
    const priorTitle = audit.prior.title as string;

    if (audit.fields.length > 0) {
        const changes = Object.fromEntries(
            audit.fields
                .filter((f) => !AUDIT_DIFF_EXCLUDED.has(f))
                .map((f) => [f, { from: audit.prior[f] ?? null, to: audit.data[f] ?? null }]),
        );
        const hold = audit.publish === undefined ? null : holdChange(audit.publish, audit.prior.adminHoldAt as Date | null | undefined);
        await logAudit({
            action: patchAuditAction(audit.fields, audit.data),
            actorType: 'admin',
            actorId,
            targetType: 'job',
            targetId: audit.id,
            metadata: { jobTitle: priorTitle, fields: audit.fields, changes, ...(hold && { hold }) },
        });
    }

    if (audit.expiresAt !== undefined) {
        const priorIso = (audit.prior.expiresAt as Date | null)?.toISOString() ?? null;
        const newIso = audit.storedExpiresAt?.toISOString() ?? null;
        if (priorIso !== newIso) {
            await logAudit({
                action: 'admin.job.expiry_change',
                actorType: 'admin',
                actorId,
                targetType: 'job',
                targetId: audit.id,
                metadata: { from: priorIso, to: newIso, jobTitle: priorTitle },
            });
        }
    }
}

/**
 * PATCH /api/admin/jobs/:id
 * Update allow-listed job fields. Every value is type and shape validated
 * (400 on failure, nothing written) and every change is audit-logged.
 *
 * An isPublished the body sends is the platform's decision, which the owner
 * must not be able to undo (lib/admin/job-hold.ts): false is a takedown, also
 * of a posting its owner had paused, and keeps an earlier takedown's time;
 * true ends a hold and any pause, and is refused (409) for a posting that is
 * archived or not paid for. The admin screens send isPublished only from the
 * publish toggle and the analytics Reports tab, never from the edit form.
 */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const authError = await requireApiAdmin(request);
    if (authError) return authError;

    const { id } = await params;
    const read = await readPatchBody(request);
    if ('error' in read) return read.error;
    const { body } = read;

    try {
        const prior = await prisma.job.findUnique({ where: { id }, select: PATCH_PRIOR_SELECT }) as Record<string, unknown> | null;
        if (!prior) return notFound();

        const validated = validateJobUpdate(body, prior.applyLink as string | null);
        if (!validated.ok) return badRequest(validated.error);

        const parsedExpiry = 'expiresAt' in body ? parseExpiresAt(body.expiresAt) : null;
        if (parsedExpiry && !parsedExpiry.ok) return badRequest(parsedExpiry.error);
        const expiresAt = parsedExpiry?.ok ? parsedExpiry.value : undefined;

        const publish = typeof validated.data.isPublished === 'boolean' ? validated.data.isPublished : undefined;
        const state = priorPublishState(prior);
        const reviving = publish === true && prior.isPublished === false;
        if (reviving && isPublishBlocked(state)) return conflict(PUBLISH_BLOCKED_MESSAGE);

        const fields = Object.keys(validated.data);
        const edits: Record<string, unknown> = {
            ...withOrderedSalary(validated.data),
            ...(publish !== undefined ? publishStateFields(publish, state.adminHoldAt) : {}),
            ...(expiresAt !== undefined ? { expiresAt } : {}),
        };
        // contentChangedAt (sitemap lastmod, "Last updated") moves when the
        // edit changes a rendered field or republishes the job; feature,
        // verification and quality-score edits leave it alone.
        const data: Record<string, unknown> = { ...edits, ...contentChangeStamp(prior, edits, { revived: reviving }) };

        const job = await writeJobUpdate(id, data, reviving);
        // No row matched: the job is gone, or a publish found it archived or
        // without its payment after the read.
        if (!job) return reviving ? conflict(PUBLISH_BLOCKED_MESSAGE) : notFound();

        // The job page is cached for a day: show the edit now.
        revalidateJobPage(job.slug, 'Admin Jobs');

        // Refresh the embedding when an embedded-text field changes; the
        // Inngest 30s throttle dedupes. No-op if Inngest env is not set.
        if (EMBED_FIELDS.some((f) => f in data)) {
            inngest.send({ name: 'embedding.refresh.job', data: { jobId: id } }).catch((err) => {
                logger.warn('inngest.send embedding.refresh.job failed (admin edit)', undefined, err);
            });
        }

        await auditPatch({ id, prior, data, fields, publish, expiresAt, storedExpiresAt: job.expiresAt });

        return NextResponse.json({ success: true, job });
    } catch (error) {
        console.error('[Admin Jobs] PATCH error:', error);
        return NextResponse.json({ success: false, error: 'Failed to update job' }, { status: 500 });
    }
}

/**
 * Columns DELETE reads: what the audit row records, the page to refresh,
 * the hold a takedown keeps, and what the hard delete guard reads.
 */
const DELETE_SELECT = {
    title: true,
    employer: true,
    isPublished: true,
    slug: true,
    adminHoldAt: true,
    ...HARD_DELETE_GUARD_SELECT,
} satisfies Prisma.JobSelect;

type JobForDelete = Prisma.JobGetPayload<{ select: typeof DELETE_SELECT }>;

/**
 * DELETE /api/admin/jobs/:id
 * Soft delete by default: a takedown (lib/admin/job-hold.ts), which the
 * owner cannot undo and an admin publish reverses.
 * Use ?hard=true for permanent deletion. It is refused (409) for every
 * employer post except an unpaid one whose checkout can no longer be paid,
 * and for any job with applications: the cascade would erase the payment
 * status, the pricing record and the candidates' applications
 * (app/api/admin/_lib/job-takedown.ts).
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
        const job = await prisma.job.findUnique({ where: { id }, select: DELETE_SELECT });
        if (!job) return notFound();
        const actorId = await resolveAdminActorId();
        return hard ? await hardDeleteJob(id, job, actorId) : await softDeleteJob(id, job, actorId);
    } catch (error) {
        // Gone between the read and the write: the answer an unknown id gets.
        if (isRecordNotFound(error)) return notFound();
        console.error('[Admin Jobs] DELETE error:', error);
        return NextResponse.json({ success: false, error: 'Failed to delete job' }, { status: 500 });
    }
}

/** A permanent delete, behind the guard in app/api/admin/_lib/job-takedown.ts. */
async function hardDeleteJob(id: string, job: JobForDelete, actorId: string | null): Promise<NextResponse> {
    const now = new Date();
    const refusal = hardDeleteRefusal([{ ...job, id }], now);
    if (refusal) return conflict(refusal.error);

    // The guard again, in the delete itself: a payment, a checkout or an
    // application landing after the read keeps the row.
    const deleted = await prisma.job.deleteMany({ where: { ...hardDeletableJobWhere(now), id } });
    if (deleted.count === 0) return conflict(HARD_DELETE_CHANGED_MESSAGE);

    revalidateJobPage(job.slug, 'Admin Jobs');
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

/** A takedown. A posting already held keeps the time of its first takedown. */
async function softDeleteJob(id: string, job: JobForDelete, actorId: string | null): Promise<NextResponse> {
    await prisma.job.update({ where: { id }, data: publishStateFields(false, job.adminHoldAt) });
    revalidateJobPage(job.slug, 'Admin Jobs');
    await logAudit({
        action: 'admin.job.soft_delete',
        actorType: 'admin',
        actorId,
        targetType: 'job',
        targetId: id,
        metadata: {
            jobTitle: job.title,
            employer: job.employer,
            wasPublished: job.isPublished,
            hold: holdChange(false, job.adminHoldAt),
        },
    });
    return NextResponse.json({ success: true, action: 'soft_deleted' });
}
