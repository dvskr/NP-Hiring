import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiAdmin, requireApiAdminActor, type ApiAdminActor } from '@/lib/auth/require-api-admin';
import { logAudit } from '@/lib/audit-log';
import { logger } from '@/lib/logger';

const VALID_ROLES = ['job_seeker', 'employer', 'admin'] as const;
type UserRole = (typeof VALID_ROLES)[number];
const BOOLEAN_FIELDS = ['openToOffers', 'profileVisible'] as const;

interface UserPatch {
    role?: UserRole;
    openToOffers?: boolean;
    profileVisible?: boolean;
}

type PatchParse = { ok: true; data: UserPatch } | { ok: false; error: string };

function jsonError(error: string, status: number): NextResponse {
    return NextResponse.json({ success: false, error }, { status });
}

/** Prisma "record not found" (update/delete on a missing row). */
function isNotFound(err: unknown): boolean {
    return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2025';
}

function isUserRole(value: unknown): value is UserRole {
    return typeof value === 'string' && (VALID_ROLES as readonly string[]).includes(value);
}

/** Validate the PATCH body: only known fields, each with the right type. */
function parsePatch(body: unknown): PatchParse {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        return { ok: false, error: 'Request body must be a JSON object' };
    }
    const input = body as Record<string, unknown>;
    let data: UserPatch = {};

    if ('role' in input) {
        if (!isUserRole(input.role)) {
            return { ok: false, error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` };
        }
        data = { ...data, role: input.role };
    }
    for (const field of BOOLEAN_FIELDS) {
        if (!(field in input)) continue;
        if (typeof input[field] !== 'boolean') {
            return { ok: false, error: `${field} must be true or false` };
        }
        data = { ...data, [field]: input[field] };
    }

    if (Object.keys(data).length === 0) {
        return { ok: false, error: 'No valid fields provided' };
    }
    return { ok: true, data };
}

function requestMeta(request: Request): { ip: string | null; userAgent: string | null } {
    const forwarded = request.headers.get('x-forwarded-for');
    const ip = forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || null;
    return { ip, userAgent: request.headers.get('user-agent') };
}

function auditUserAction(
    request: Request,
    actor: ApiAdminActor,
    action: string,
    targetId: string,
    metadata: Record<string, unknown>,
): Promise<void> {
    return logAudit({
        action,
        actorType: 'admin',
        actorId: actor.profileId,
        targetType: 'user',
        targetId,
        ...requestMeta(request),
        metadata,
    });
}

/**
 * GET /api/admin/users/:id
 * Full user profile with activity stats.
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const authError = await requireApiAdmin(request);
    if (authError) return authError;

    const { id } = await params;

    try {
        const user = await prisma.userProfile.findUnique({
            where: { id },
            include: {
                jobApplications: {
                    orderBy: { appliedAt: 'desc' },
                    take: 20,
                    include: {
                        job: { select: { id: true, title: true, employer: true, isPublished: true } },
                    },
                },
                autofillUsage: {
                    orderBy: { createdAt: 'desc' },
                    take: 10,
                    select: { id: true, pageUrl: true, atsName: true, fieldsFilled: true, aiGenerations: true, createdAt: true },
                },
                _count: {
                    select: {
                        jobApplications: true,
                        autofillUsage: true,
                        autofillTelemetry: true,
                        employerJobs: true,
                    },
                },
            },
        });

        if (!user) {
            return jsonError('User not found', 404);
        }

        return NextResponse.json({ success: true, user });
    } catch (error) {
        logger.error('[Admin Users] GET/:id error', error);
        return jsonError('Failed to fetch user', 500);
    }
}

/**
 * PATCH /api/admin/users/:id
 * Update user role or visibility flags. Role changes are audit-logged
 * (role.change); an admin cannot change their own role.
 */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { error: authError, actor } = await requireApiAdminActor(request);
    if (authError) return authError;

    const { id } = await params;

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return jsonError('Request body must be valid JSON', 400);
    }

    const parsed = parsePatch(body);
    if (!parsed.ok) return jsonError(parsed.error, 400);
    const data = parsed.data;

    // Self-lockout guard: one mis-click in the role select would otherwise
    // demote the acting admin and lock them out of the console.
    if (data.role !== undefined && id === actor.profileId) {
        return jsonError('You cannot change the role of your own account', 403);
    }

    try {
        const before = await prisma.userProfile.findUnique({
            where: { id },
            select: { role: true, openToOffers: true, profileVisible: true },
        });
        if (!before) return jsonError('User not found', 404);

        const user = await prisma.userProfile.update({
            where: { id },
            data,
            select: { id: true, email: true, role: true, openToOffers: true, profileVisible: true, updatedAt: true },
        });

        if (data.role !== undefined && data.role !== before.role) {
            await auditUserAction(request, actor, 'role.change', id, { from: before.role, to: user.role });
        }
        const flagChanges = BOOLEAN_FIELDS.filter((f) => data[f] !== undefined && data[f] !== before[f]);
        if (flagChanges.length > 0) {
            await auditUserAction(request, actor, 'admin.user.update', id, {
                changes: Object.fromEntries(flagChanges.map((f) => [f, { from: before[f], to: user[f] }])),
            });
        }

        return NextResponse.json({ success: true, user });
    } catch (error) {
        if (isNotFound(error)) return jsonError('User not found', 404);
        logger.error('[Admin Users] PATCH error', error);
        return jsonError('Failed to update user', 500);
    }
}

/**
 * DELETE /api/admin/users/:id
 * Deactivate user (hides profile, sets openToOffers=false).
 * Use ?hard=true for permanent deletion. Both are audit-logged, and an admin
 * cannot deactivate or delete their own account.
 */
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { error: authError, actor } = await requireApiAdminActor(request);
    if (authError) return authError;

    const { id } = await params;
    const hard = new URL(request.url).searchParams.get('hard') === 'true';

    if (id === actor.profileId) {
        return jsonError('You cannot deactivate or delete your own account', 403);
    }

    try {
        const target = await prisma.userProfile.findUnique({
            where: { id },
            select: { role: true },
        });
        if (!target) return jsonError('User not found', 404);

        if (hard) {
            await prisma.userProfile.delete({ where: { id } });
            await auditUserAction(request, actor, 'admin.user.hard_delete', id, { role: target.role });
            return NextResponse.json({ success: true, action: 'hard_deleted' });
        }

        await prisma.userProfile.update({
            where: { id },
            data: { profileVisible: false, openToOffers: false },
        });
        await auditUserAction(request, actor, 'admin.user.deactivate', id, { role: target.role });

        return NextResponse.json({ success: true, action: 'deactivated' });
    } catch (error) {
        if (isNotFound(error)) return jsonError('User not found', 404);
        logger.error('[Admin Users] DELETE error', error);
        return jsonError('Failed to delete user', 500);
    }
}
