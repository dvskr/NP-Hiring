/**
 * POST /oauth/register: Dynamic Client Registration (RFC 7591, design 2.4)
 * for MCP clients that do not publish a Client ID Metadata Document.
 *
 * SECURITY: a registered client can only ever redirect to claude.ai,
 * claude.com, chatgpt.com (plus MCP_OAUTH_REDIRECT_HOSTS) or to the user's
 * own machine, so registering one cannot route a candidate's code to a site
 * of the registrant's choosing. 20 registrations a minute per IP.
 * tests/oauth/register.test.ts
 */
import type { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { asJsonObject } from '@/lib/request-body';
import { checkRegistration, registerClient } from '@/lib/oauth/clients';
import { OAUTH_RATE_LIMITS, oauthSigningSecret } from '@/lib/oauth/config';
import { corsPreflight, oauthError, oauthJson, readBodyText, slowDown, temporarilyUnavailable } from '@/lib/oauth/http';
import { clientIp, rateLimitWait } from '@/lib/oauth/limits';

export const dynamic = 'force-dynamic';

export function OPTIONS(): NextResponse {
    return corsPreflight('POST, OPTIONS');
}

async function handleRegistration(request: NextRequest): Promise<NextResponse> {
    if (!oauthSigningSecret()) return temporarilyUnavailable();
    const wait = await rateLimitWait(`oauth:register:ip:${clientIp(request.headers)}`, OAUTH_RATE_LIMITS.registerPerIp);
    if (wait !== null) return slowDown(wait);

    const body = await readBodyText(request);
    if (!body.ok) return oauthError('invalid_client_metadata', 'The request body is too large or not readable.');
    let parsed: unknown;
    try {
        parsed = JSON.parse(body.text);
    } catch {
        return oauthError('invalid_client_metadata', 'The request body must be a JSON object.');
    }
    const metadata = asJsonObject(parsed);
    if (!metadata) return oauthError('invalid_client_metadata', 'The request body must be a JSON object.');

    const check = checkRegistration(metadata);
    if (!check.ok) return oauthError(check.error, check.description);
    return oauthJson(await registerClient(check.value), 201);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
    try {
        return await handleRegistration(request);
    } catch (error) {
        logger.error('[oauth] registration failed', error);
        return oauthError('server_error', 'The registration could not be completed.', 500);
    }
}
