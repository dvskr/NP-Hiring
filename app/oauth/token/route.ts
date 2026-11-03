/**
 * POST /oauth/token (design 2.7): authorization_code and refresh_token
 * grants for public clients (Claude, ChatGPT and other MCP clients).
 *
 * Form encoded (primary) or JSON, at most 16 KB. Every answer is no-store
 * and readable from any origin. A client_secret or client_assertion in the
 * body is never read. Logs name the client by host and never carry a token,
 * a code or a verifier. tests/oauth/token-route.test.ts
 */
import type { NextRequest, NextResponse } from 'next/server';
import type { McpScope } from '@/lib/mcp/config';
import { logger } from '@/lib/logger';
import { signAccessToken } from '@/lib/oauth/access-token';
import { clientIdKind, clientLogLabel } from '@/lib/oauth/clients';
import { redeemAuthorizationCode } from '@/lib/oauth/codes';
import { ACCESS_TOKEN_TTL_SECONDS, MAX_TOKEN_LENGTH, OAUTH_RATE_LIMITS, oauthSigningSecret } from '@/lib/oauth/config';
import type { GrantWithAccount } from '@/lib/oauth/grants';
import { corsPreflight, oauthError, oauthJson, readOAuthParams, slowDown, temporarilyUnavailable } from '@/lib/oauth/http';
import { clientIp, rateLimitWait } from '@/lib/oauth/limits';
import { issueRefreshToken, rotateRefreshToken } from '@/lib/oauth/refresh-tokens';
import { grantScopes } from '@/lib/oauth/scopes';

export const dynamic = 'force-dynamic';

const TOKEN_PARAMS = [
    'grant_type',
    'client_id',
    'code',
    'redirect_uri',
    'code_verifier',
    'refresh_token',
    'scope',
    'resource',
] as const;

type GrantType = 'authorization_code' | 'refresh_token';

export function OPTIONS(): NextResponse {
    return corsPreflight('POST, OPTIONS');
}

/** The token response for a grant (design 2.7 step 5). */
async function tokenResponse(grantType: GrantType, grant: GrantWithAccount, scopes: McpScope[], refreshToken: string): Promise<NextResponse> {
    const accessToken = await signAccessToken({
        userId: grant.userId,
        clientId: grant.clientId,
        grantId: grant.id,
        scopes,
        resource: grant.resource,
    });
    logger.info('[oauth] tokens issued', { grantType, client: clientLogLabel(grant.clientId), grantId: grant.id, userId: grant.userId });
    return oauthJson({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: ACCESS_TOKEN_TTL_SECONDS,
        refresh_token: refreshToken,
        scope: scopes.join(' '),
    });
}

async function exchangeCode(params: ReadonlyMap<string, string>, clientId: string, now: Date): Promise<NextResponse> {
    const code = params.get('code');
    const redirectUri = params.get('redirect_uri');
    const codeVerifier = params.get('code_verifier');
    if (!code || code.length > MAX_TOKEN_LENGTH) return oauthError('invalid_request', 'The code parameter is missing or too long.');
    if (!redirectUri) return oauthError('invalid_request', 'The redirect_uri parameter is missing.');
    if (!codeVerifier) return oauthError('invalid_request', 'The code_verifier parameter is missing.');

    const result = await redeemAuthorizationCode(
        { code, clientId, redirectUri, codeVerifier, resource: params.get('resource') },
        now,
    );
    if (!result.ok) return oauthError(result.error, result.description);
    const refreshToken = await issueRefreshToken(result.grant.id, now);
    return tokenResponse('authorization_code', result.grant, grantScopes(result.grant.scopes), refreshToken);
}

async function refresh(params: ReadonlyMap<string, string>, clientId: string, now: Date): Promise<NextResponse> {
    const refreshToken = params.get('refresh_token');
    if (!refreshToken || refreshToken.length > MAX_TOKEN_LENGTH) {
        return oauthError('invalid_request', 'The refresh_token parameter is missing or too long.');
    }
    const result = await rotateRefreshToken(
        { refreshToken, clientId, scope: params.get('scope'), resource: params.get('resource') },
        now,
    );
    if (!result.ok) return oauthError(result.error, result.description);
    return tokenResponse('refresh_token', result.grant, result.scopes, result.refreshToken);
}

async function handleTokenRequest(request: NextRequest): Promise<NextResponse> {
    if (!oauthSigningSecret()) return temporarilyUnavailable();
    const ipWait = await rateLimitWait(`oauth:token:ip:${clientIp(request.headers)}`, OAUTH_RATE_LIMITS.tokenPerIp);
    if (ipWait !== null) return slowDown(ipWait);

    const read = await readOAuthParams(request, TOKEN_PARAMS);
    if (!read.ok) return oauthError('invalid_request', read.description);
    const { params } = read;

    const grantType = params.get('grant_type');
    if (!grantType) return oauthError('invalid_request', 'The grant_type parameter is missing.');
    if (grantType !== 'authorization_code' && grantType !== 'refresh_token') {
        return oauthError('unsupported_grant_type', 'Only the authorization_code and refresh_token grants are supported.');
    }
    const clientId = params.get('client_id');
    if (!clientId) return oauthError('invalid_request', 'The client_id parameter is missing.');
    if (!clientIdKind(clientId)) return oauthError('invalid_client', 'The client_id is not one this server issues or accepts.', 401);
    const clientWait = await rateLimitWait(`oauth:token:client:${clientId}`, OAUTH_RATE_LIMITS.tokenPerClient);
    if (clientWait !== null) return slowDown(clientWait);

    const now = new Date();
    return grantType === 'authorization_code' ? exchangeCode(params, clientId, now) : refresh(params, clientId, now);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
    try {
        return await handleTokenRequest(request);
    } catch (error) {
        logger.error('[oauth] token endpoint failed', error);
        return oauthError('server_error', 'The token request could not be completed.', 500);
    }
}
