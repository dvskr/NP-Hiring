import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { prisma } from '@/lib/prisma';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

/** The authenticated admin behind an API request. */
export interface ApiAdminActor {
    /** UserProfile.id of the admin (the id AuditLog.actorId expects). */
    profileId: string;
    /** Supabase auth user id of the admin. */
    supabaseId: string;
}

export type ApiAdminResult =
    | { error: NextResponse; actor: null }
    | { error: null; actor: ApiAdminActor };

function pathOf(request: Request): string | undefined {
    try {
        return new URL(request.url).pathname;
    } catch {
        return undefined;
    }
}

/**
 * Verify that the request is from an authenticated admin user and return
 * that admin's identity. Always applies the admin rate limit (20 req/min per
 * IP) first: the request is REQUIRED so no call site can skip the limiter by
 * omitting it (the P10 defect where health, email and pipeline-flow never
 * throttled).
 *
 * Fails closed: any infrastructure error answers 500, never authorizes.
 */
export async function requireApiAdminActor(request: Request): Promise<ApiAdminResult> {
    try {
        const rateLimitResult = await rateLimit(request, 'admin', RATE_LIMITS.admin);
        if (rateLimitResult) return { error: rateLimitResult, actor: null };

        const supabase = await createClient();
        const {
            data: { user },
            error,
        } = await supabase.auth.getUser();

        if (error || !user) {
            return {
                error: NextResponse.json({ error: 'Authentication required' }, { status: 401 }),
                actor: null,
            };
        }

        const profile = await prisma.userProfile.findUnique({
            where: { supabaseId: user.id },
            select: { id: true, role: true },
        });

        if (!profile || profile.role !== 'admin') {
            return {
                error: NextResponse.json({ error: 'Admin access required' }, { status: 403 }),
                actor: null,
            };
        }

        return { error: null, actor: { profileId: profile.id, supabaseId: user.id } };
    } catch (err) {
        // H5 fix: auth-infra failures (Supabase outage, Prisma connection
        // drop, misconfigured env) answer 500 with a logged error so they are
        // distinguishable from legitimate "not logged in" 401 rejections.
        logger.error('[requireApiAdmin] auth check failed', err, {
            path: pathOf(request),
        });
        return {
            error: NextResponse.json(
                { error: 'Authentication infrastructure failure' },
                { status: 500 }
            ),
            actor: null,
        };
    }
}

/**
 * Pass/fail variant of requireApiAdminActor.
 *
 * @returns null if authorized, or a NextResponse (401/403/429/500) to return immediately.
 */
export async function requireApiAdmin(request: Request): Promise<NextResponse | null> {
    const { error } = await requireApiAdminActor(request);
    return error;
}
