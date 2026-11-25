import { NextResponse } from 'next/server';
import { rateLimit, rateLimitShared, RATE_LIMITS } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { resolveAdminSession, type AdminSessionRefusal } from '@/lib/auth/admin-session';

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

/** Bucket of the per-IP guard charged before the session is known. */
export const ADMIN_IP_BUCKET = 'admin-ip';

function pathOf(request: Request): string | undefined {
    try {
        return new URL(request.url).pathname;
    } catch {
        return undefined;
    }
}

/** A path segment is a record id when it is this long or longer and holds a digit. */
const MIN_RECORD_ID_LENGTH = 8;

/**
 * Key of the per-admin budget: one allowance per admin per route group.
 *
 * Record ids are collapsed, so /api/admin/jobs/<id> shares one allowance with
 * every other job instead of minting a fresh one per record, which would let
 * a loop over ids run unthrottled. Admin record ids are uuids and cuids, and
 * no admin route name holds a digit, so a long segment with a digit in it is
 * an id. A request whose path cannot be read shares an 'unknown' group that
 * is still scoped to the admin.
 */
export function adminRateLimitKey(pathname: string | undefined, adminId: string): string {
    const route = (pathname ?? 'unknown')
        .split('/')
        .map((segment) => (segment.length >= MIN_RECORD_ID_LENGTH && /\d/.test(segment) ? ':id' : segment))
        .join('/');
    return `admin:${route}:${adminId}`;
}

function refuse(error: NextResponse): ApiAdminResult {
    return { error, actor: null };
}

function infrastructureFailure(): NextResponse {
    return NextResponse.json({ error: 'Authentication infrastructure failure' }, { status: 500 });
}

/** 401 signed out, 403 not an admin (a soft-deleted admin included), 500 auth service down. */
function sessionRefusal(session: AdminSessionRefusal, request: Request): NextResponse {
    if (session.status === 'signed_out') {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    if (session.status === 'not_admin') {
        return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    logger.error('[requireApiAdmin] the auth service did not answer', session.error, {
        path: pathOf(request),
    });
    return infrastructureFailure();
}

/**
 * Verify that the request is from an authenticated admin user and return
 * that admin's identity.
 *
 * Rate limiting has two layers. A loose per-IP guard (RATE_LIMITS.adminIp)
 * runs before the session is known, to bound anonymous hammering. The real
 * budget (RATE_LIMITS.admin) belongs to the admin and the route group, goes
 * through the shared limiter (Upstash, with its in-memory fallback), and is
 * charged only once the caller is known to be an admin. It used to be one
 * 20 req/min bucket per IP, charged before authentication and shared by every
 * admin route, so the console throttled itself just by being browsed and
 * anonymous traffic from the same address spent the operator's allowance.
 *
 * The request is REQUIRED so no call site can skip the limiter by omitting it
 * (the P10 defect where health, email and pipeline-flow never throttled).
 *
 * A soft-deleted admin (an account in its deletion window, or one waiting for
 * the purge) is refused with 403 like any other non-admin.
 *
 * Fails closed: an infrastructure error answers 500. It never authorizes and
 * never reads as a 401 or a 403.
 */
export async function requireApiAdminActor(request: Request): Promise<ApiAdminResult> {
    try {
        const ipLimited = await rateLimit(request, ADMIN_IP_BUCKET, RATE_LIMITS.adminIp);
        if (ipLimited) return refuse(ipLimited);

        const session = await resolveAdminSession();
        if (session.status !== 'admin') return refuse(sessionRefusal(session, request));

        const adminLimited = await rateLimitShared(
            adminRateLimitKey(pathOf(request), session.supabaseId),
            RATE_LIMITS.admin,
        );
        if (adminLimited) return refuse(adminLimited);

        return { error: null, actor: { profileId: session.profileId, supabaseId: session.supabaseId } };
    } catch (err) {
        // H5 fix: auth-infra failures (Supabase outage, Prisma connection
        // drop, misconfigured env) answer 500 with a logged error so they are
        // distinguishable from legitimate "not logged in" 401 rejections.
        logger.error('[requireApiAdmin] auth check failed', err, {
            path: pathOf(request),
        });
        return refuse(infrastructureFailure());
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

/**
 * The admin actions with a budget of their own (RATE_LIMITS.adminHighImpact)
 * on top of the general one: a broadcast send, a bulk hard delete of jobs
 * and a user deletion (deactivate or hard delete).
 */
export const HIGH_IMPACT_ADMIN_ACTIONS = ['email-send', 'jobs-hard-delete', 'users-delete'] as const;

export type HighImpactAdminAction = (typeof HIGH_IMPACT_ADMIN_ACTIONS)[number];

/** Key of a high-impact action's budget: one allowance per admin per action. */
export function highImpactRateLimitKey(action: HighImpactAdminAction, adminId: string): string {
    return `admin-high-impact:${action}:${adminId}`;
}

/**
 * Charges a high-impact action to the admin requireApiAdminActor let
 * through, at RATE_LIMITS.adminHighImpact (10 a minute per admin per action).
 * The general budget allows 60 a minute per route group, enough for a stuck
 * button or a script to send dozens of broadcasts or delete thousands of
 * jobs before it stops. Call it after requireApiAdminActor, once the request
 * is known to be the action.
 *
 * Answers 429 past the limit, null otherwise. Fails closed: if the limiter
 * itself throws, it answers 500 and the action does not run.
 */
export async function limitHighImpactAdminAction(
    action: HighImpactAdminAction,
    actor: ApiAdminActor,
): Promise<NextResponse | null> {
    try {
        return await rateLimitShared(highImpactRateLimitKey(action, actor.supabaseId), RATE_LIMITS.adminHighImpact);
    } catch (err) {
        logger.error('[requireApiAdmin] the high-impact rate limit check failed', err, { action });
        return NextResponse.json({ error: 'Rate limit check failed' }, { status: 500 });
    }
}
