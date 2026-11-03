/**
 * POST /oauth/revoke: token revocation (RFC 7009, design 2.8). Form encoded
 * or JSON: `token`, optional `token_type_hint` (not needed: the two token
 * kinds differ in shape). Always an empty 200 for a well-formed request,
 * whether or not the token was known. tests/oauth/revoke-route.test.ts
 */
import type { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { MAX_TOKEN_LENGTH, OAUTH_RATE_LIMITS, oauthSigningSecret } from '@/lib/oauth/config';
import { corsPreflight, emptyOk, oauthError, readOAuthParams, slowDown, temporarilyUnavailable } from '@/lib/oauth/http';
import { clientIp, rateLimitWait } from '@/lib/oauth/limits';
import { revokeByToken } from '@/lib/oauth/revocation';

export const dynamic = 'force-dynamic';

export function OPTIONS(): NextResponse {
    return corsPreflight('POST, OPTIONS');
}

async function handleRevocation(request: NextRequest): Promise<NextResponse> {
    if (!oauthSigningSecret()) return temporarilyUnavailable();
    const wait = await rateLimitWait(`oauth:revoke:ip:${clientIp(request.headers)}`, OAUTH_RATE_LIMITS.revokePerIp);
    if (wait !== null) return slowDown(wait);

    const read = await readOAuthParams(request, ['token', 'token_type_hint']);
    if (!read.ok) return oauthError('invalid_request', read.description);
    const token = read.params.get('token');
    if (!token || token.length > MAX_TOKEN_LENGTH) return oauthError('invalid_request', 'The token parameter is missing or too long.');

    await revokeByToken(token);
    return emptyOk();
}

export async function POST(request: NextRequest): Promise<NextResponse> {
    try {
        return await handleRevocation(request);
    } catch (error) {
        logger.error('[oauth] revocation failed', error);
        return oauthError('server_error', 'The revocation could not be completed.', 500);
    }
}
