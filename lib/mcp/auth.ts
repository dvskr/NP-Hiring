/**
 * Who is calling an MCP endpoint, and how each host is told to sign in.
 *
 * A request without an Authorization header is anonymous: the public tools
 * (search_jobs, get_job, get_state_practice_authority) answer it. A request
 * with a bearer token must carry a valid access token issued for THIS
 * endpoint (lib/oauth/access-token.ts checks signature, issuer, audience,
 * expiry, the grant and the account); anything else is answered 401 before
 * the MCP layer runs, which makes both hosts refresh or re-authorize.
 *
 * Calling a candidate tool without the needed sign-in differs per host
 * (lib/mcp/config.ts):
 *   - Claude: HTTP 401 with WWW-Authenticate (or 403 insufficient_scope),
 *     decided here from the JSON-RPC body before the MCP layer runs. Claude
 *     ignores a challenge on a 200, so it must be an HTTP status.
 *   - ChatGPT: the tool answers an error result carrying
 *     `_meta["mcp/www_authenticate"]` (signInRequiredResult), which opens
 *     ChatGPT's account linking.
 */
import type { AuthInfo, CallToolResult } from '@modelcontextprotocol/server';
import { verifyAccessToken, type AccessTokenFailure, type VerifiedAccessToken } from '@/lib/oauth/access-token';
import { MCP_SCOPES, type McpHostProfile, type McpScope } from '@/lib/mcp/config';
import { TOOL, type ToolName } from '@/lib/mcp/tool-names';
import { isReviewer } from '@/lib/mcp/sandbox';
import type { McpViewer } from '@/lib/mcp/jobs';

/** Scopes each candidate tool needs; a tool not listed here is public. */
export const TOOL_SCOPES: Readonly<Partial<Record<ToolName, readonly McpScope[]>>> = {
    [TOOL.profileStatus]: ['profile:read'],
    [TOOL.startApplication]: ['profile:read', 'applications:read'],
    [TOOL.submitApplication]: ['applications:write'],
    [TOOL.trackEmployerSiteApplication]: ['applications:write'],
    [TOOL.listApplications]: ['applications:read'],
    [TOOL.withdrawApplication]: ['applications:write'],
    [TOOL.saveJob]: ['applications:write'],
    [TOOL.unsaveJob]: ['applications:write'],
    [TOOL.listSavedJobs]: ['applications:read'],
};

export function requiredScopes(toolName: string): readonly McpScope[] | null {
    // Own keys only: 'toString' or 'constructor' must not read Object.prototype.
    if (!Object.hasOwn(TOOL_SCOPES, toolName)) return null;
    return TOOL_SCOPES[toolName as ToolName] ?? null;
}

/** The signed-in caller, as the tools see it. */
export interface McpPrincipal extends McpViewer {
    clientId: string;
    grantId: string;
    scopes: readonly McpScope[];
}

export function hasScopes(principal: McpPrincipal, needed: readonly McpScope[]): boolean {
    return needed.every((scope) => principal.scopes.includes(scope));
}

/**
 * A WWW-Authenticate value (RFC 6750 §3, RFC 9728 §5.1). Every challenge asks
 * for the full scope set, so one consent covers every candidate tool (the MCP
 * spec asks for all the scopes an operation needs in one challenge).
 */
export function bearerChallenge(
    profile: McpHostProfile,
    options: { error?: 'invalid_token' | 'insufficient_scope' | 'invalid_request'; description?: string } = {},
): string {
    const parts = [`resource_metadata="${profile.resourceMetadataUrl}"`, `scope="${MCP_SCOPES.join(' ')}"`];
    if (options.error) parts.push(`error="${options.error}"`);
    // A quoted-string: our own fixed sentences, which hold no quote or backslash.
    if (options.description) parts.push(`error_description="${options.description}"`);
    return `Bearer ${parts.join(', ')}`;
}

/** CORS for the MCP endpoints and their metadata: bearer tokens only, never cookies. */
export const MCP_CORS_HEADERS: Readonly<Record<string, string>> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':
        'Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Mcp-Method, Mcp-Name, Last-Event-ID',
    'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id, Mcp-Protocol-Version',
    'Access-Control-Max-Age': '86400',
};

function challengeResponse(status: 401 | 403, challenge: string, error: string, description: string): Response {
    return new Response(JSON.stringify({ error, error_description: description }), {
        status,
        headers: {
            ...MCP_CORS_HEADERS,
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            'WWW-Authenticate': challenge,
        },
    });
}

const FAILURE_DESCRIPTIONS: Readonly<Record<AccessTokenFailure, string>> = {
    malformed: 'The access token is malformed',
    invalid: 'The access token is not valid',
    expired: 'The access token has expired',
    wrong_audience: 'The access token was issued for another endpoint',
    revoked: 'Access to this NP Hiring account was removed',
    account: 'This NP Hiring account cannot use the app',
    unconfigured: 'Sign in to NP Hiring is not available right now',
};

/** 401 for a missing (no error code, RFC 6750 §3.1) or rejected token. */
export function unauthorizedResponse(profile: McpHostProfile, failure?: AccessTokenFailure): Response {
    if (!failure) {
        return challengeResponse(
            401,
            bearerChallenge(profile),
            'unauthorized',
            'Sign in to NP Hiring to use this tool',
        );
    }
    const description = FAILURE_DESCRIPTIONS[failure];
    return challengeResponse(401, bearerChallenge(profile, { error: 'invalid_token', description }), 'invalid_token', description);
}

export function insufficientScopeResponse(profile: McpHostProfile): Response {
    const description = 'Allow NP Hiring to use your applications to continue';
    return challengeResponse(
        403,
        bearerChallenge(profile, { error: 'insufficient_scope', description }),
        'insufficient_scope',
        description,
    );
}

export type McpAuthentication =
    | { kind: 'anonymous' }
    | { kind: 'authenticated'; principal: McpPrincipal; authInfo: AuthInfo }
    | { kind: 'rejected'; response: Response };

/** RFC 6750 b64token: a JWT's base64url segments and dots fit inside it. */
const BEARER = /^Bearer[ ]+([A-Za-z0-9\-._~+/]+=*)$/i;

export async function authenticateMcpRequest(request: Request, profile: McpHostProfile): Promise<McpAuthentication> {
    const header = request.headers.get('authorization');
    if (header === null || header.trim() === '') return { kind: 'anonymous' };

    const match = BEARER.exec(header.trim());
    if (!match) return { kind: 'rejected', response: unauthorizedResponse(profile, 'malformed') };

    const check = await verifyAccessToken(match[1], profile.resourceUrl);
    if (!check.ok) return { kind: 'rejected', response: unauthorizedResponse(profile, check.reason) };

    const token: VerifiedAccessToken = check.token;
    const principal: McpPrincipal = {
        userId: token.userId,
        reviewer: isReviewer(token.userId),
        clientId: token.clientId,
        grantId: token.grantId,
        scopes: token.scopes,
    };
    const authInfo: AuthInfo = {
        token: token.token,
        clientId: token.clientId,
        scopes: [...token.scopes],
        expiresAt: token.expiresAt,
        resource: new URL(profile.resourceUrl),
        resourceMetadataUrl: profile.resourceMetadataUrl,
        extra: { userId: principal.userId, grantId: principal.grantId, reviewer: principal.reviewer },
    };
    return { kind: 'authenticated', principal, authInfo };
}

/** The principal the MCP layer was handed (lib/mcp/handler.ts puts it on authInfo.extra). */
export function principalFromAuthInfo(authInfo: AuthInfo | undefined): McpPrincipal | null {
    const extra = authInfo?.extra;
    if (!authInfo || !extra) return null;
    const userId = extra.userId;
    const grantId = extra.grantId;
    if (typeof userId !== 'string' || typeof grantId !== 'string') return null;
    return {
        userId,
        grantId,
        reviewer: extra.reviewer === true,
        clientId: authInfo.clientId,
        scopes: authInfo.scopes.filter((scope): scope is McpScope => (MCP_SCOPES as readonly string[]).includes(scope)),
    };
}

/** The candidate tools a JSON-RPC body calls (a batch is checked call by call). */
export function calledToolNames(body: unknown): string[] {
    const messages = Array.isArray(body) ? body : [body];
    const names: string[] = [];
    for (const message of messages) {
        if (message === null || typeof message !== 'object') continue;
        const { method, params } = message as { method?: unknown; params?: unknown };
        if (method !== 'tools/call' || params === null || typeof params !== 'object') continue;
        const name = (params as { name?: unknown }).name;
        if (typeof name === 'string') names.push(name);
    }
    return names;
}

/**
 * Claude's gate, decided before the MCP layer: a call to a candidate tool
 * without a token answers 401, and with a token that lacks a needed scope
 * 403. Null lets the request through.
 */
export function claudeSignInGate(body: unknown, auth: McpAuthentication, profile: McpHostProfile): Response | null {
    for (const name of calledToolNames(body)) {
        const needed = requiredScopes(name);
        if (!needed) continue;
        if (auth.kind !== 'authenticated') return unauthorizedResponse(profile);
        if (!hasScopes(auth.principal, needed)) return insufficientScopeResponse(profile);
    }
    return null;
}

/**
 * ChatGPT's sign-in signal: an error result whose `_meta["mcp/www_authenticate"]`
 * holds the challenge (OpenAI asks for both error and error_description in it).
 * Claude never reaches this: its gate answers before the tool runs.
 */
export function signInRequiredResult(profile: McpHostProfile, insufficientScope: boolean): CallToolResult {
    const description = insufficientScope
        ? 'Allow NP Hiring to use your applications to continue'
        : 'Sign in to NP Hiring to continue';
    return {
        isError: true,
        content: [{ type: 'text', text: `${description}.` }],
        _meta: {
            'mcp/www_authenticate': [bearerChallenge(profile, { error: 'insufficient_scope', description })],
        },
    };
}
