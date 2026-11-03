/**
 * The candidate's connected AI apps (design 2.10), for Settings, Account.
 *
 *   GET    → { grants: [{ id, clientName, host, scopes, createdAt, lastUsedAt }] }
 *            active grants only, newest first, at most 50
 *   DELETE { grantId } → revokes that grant (user_revoke) and its refresh
 *            tokens; 404 when it is not the caller's active grant
 *
 * SECURITY: both act on the session user's own grants only; the grant id is
 * read as a plain short string (lib/request-body.ts) before it reaches a
 * where clause, and the revoke is one update scoped by the caller's id, so
 * another user's grant answers 404 exactly like a missing one.
 * tests/oauth/grants-api.test.ts
 */
import { NextResponse, type NextRequest } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { readJsonObject, stringField } from '@/lib/request-body';
import { createClient } from '@/lib/supabase/server';
import { listConnectedApps, revokeGrantForUser } from '@/lib/oauth/grants';

export const dynamic = 'force-dynamic';

/** Grant ids are cuids (25 characters); anything longer names no grant. */
const MAX_GRANT_ID_LENGTH = 64;

const NO_STORE = { 'Cache-Control': 'no-store' };

async function sessionUser(): Promise<User | null> {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    return data.user ?? null;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
    const limited = await rateLimit(request, 'oauth-grants:get', RATE_LIMITS.general);
    if (limited) return limited;
    try {
        const user = await sessionUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
        const grants = await listConnectedApps(user.id);
        return NextResponse.json({ grants }, { headers: NO_STORE });
    } catch (error) {
        logger.error('[oauth] listing connected apps failed', error);
        return NextResponse.json({ error: 'Connected apps could not be loaded.' }, { status: 500, headers: NO_STORE });
    }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
    const limited = await rateLimit(request, 'oauth-grants:delete', RATE_LIMITS.general);
    if (limited) return limited;
    try {
        const user = await sessionUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
        const body = await readJsonObject(request);
        const grantId = stringField(body?.grantId, MAX_GRANT_ID_LENGTH);
        if (!grantId) return NextResponse.json({ error: 'grantId is required.' }, { status: 400, headers: NO_STORE });
        const revoked = await revokeGrantForUser(user.id, grantId);
        if (!revoked) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
        return NextResponse.json({ revoked: true }, { headers: NO_STORE });
    } catch (error) {
        logger.error('[oauth] removing a connected app failed', error);
        return NextResponse.json({ error: 'Access could not be removed.' }, { status: 500, headers: NO_STORE });
    }
}
