/**
 * Auth helper for cron endpoints that should also be manually triggerable
 * from the admin panel.
 *
 * Vercel cron sends `Authorization: Bearer <CRON_SECRET>`. Admins clicking
 * "Trigger manually" from /admin/cron send a same-origin request with their
 * Supabase session cookie but no bearer token.
 *
 * This helper accepts either:
 *   1. Bearer-token match against `CRON_SECRET` (Vercel cron path).
 *   2. An authenticated admin session (manual trigger path). A soft-deleted
 *      admin is refused (lib/auth/admin-session.ts).
 *   3. A checkout that has no CRON_SECRET to check against, in local
 *      development only (see isUnauthenticatedCronAllowed).
 *
 * Returns null when authorized; otherwise a 401 or 403 NextResponse the
 * caller should return immediately, or a 500 when the auth service failed.
 */
import { NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'crypto';
import { logger } from '@/lib/logger';
import { resolveAdminSession } from '@/lib/auth/admin-session';

/**
 * The open door, and why it is this narrow.
 *
 * P5.A (2026-06-01) required NODE_ENV=development and no Vercel env, which
 * still meant NODE_ENV alone decided it: any self-hosted deployment that runs
 * with NODE_ENV=development served every cron route, the destructive purges
 * included, to anonymous callers. NODE_ENV describes a build, not a trust
 * boundary.
 *
 * A deployment that runs crons has a CRON_SECRET, so its presence is the
 * signal that there is something to authenticate against: once it is set,
 * the bearer token and an admin session are the only ways in, on every host.
 * What is left open is a fresh local checkout with no secret configured,
 * where there is no credential to present and nothing deployed to reach.
 *
 * Exported so the gate can be tested without standing up Supabase or Prisma.
 */
export function isUnauthenticatedCronAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
    return (
        env.NODE_ENV === 'development' &&
        !env.VERCEL &&
        !env.VERCEL_ENV &&
        !env.CRON_SECRET
    );
}

/**
 * B101: constant-time check of an Authorization header against
 * `Bearer <secret>`. A plain `===` returns as soon as a character differs,
 * which leaks how much of a guess was right to anyone timing the response.
 * Both sides are hashed first, so the compared buffers always have the same
 * length: timingSafeEqual never throws, and the secret's length does not
 * leak either.
 */
function bearerMatches(authHeader: string, secret: string): boolean {
    const given = createHash('sha256').update(authHeader).digest();
    const expected = createHash('sha256').update(`Bearer ${secret}`).digest();
    return timingSafeEqual(given, expected);
}

export async function verifyCronOrAdmin(req: Request): Promise<NextResponse | null> {
    if (isUnauthenticatedCronAllowed()) {
        return null;
    }

    // Fast path: Vercel cron's bearer token (constant-time compare, B101).
    const authHeader = req.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && authHeader !== null && bearerMatches(authHeader, cronSecret)) {
        return null;
    }

    // Slow path: admin session via Supabase cookie.
    try {
        const session = await resolveAdminSession();
        if (session.status === 'admin') return null;
        if (session.status === 'signed_out') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        if (session.status === 'not_admin') {
            return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
        }
        logger.error('[verifyCronOrAdmin] the auth service did not answer', session.error);
        return NextResponse.json(
            { error: 'Authentication infrastructure failure' },
            { status: 500 },
        );
    } catch (err) {
        // H5 fix: previously the bare `catch {}` returned a generic 401,
        // making Supabase/Prisma infra failures invisible in observability.
        // Log + 500 so a real auth-infra outage triggers alerting instead
        // of being misclassified as a normal 401.
        logger.error('[verifyCronOrAdmin] auth check failed', err);
        return NextResponse.json(
            { error: 'Authentication infrastructure failure' },
            { status: 500 },
        );
    }
}
