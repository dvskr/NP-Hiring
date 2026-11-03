/**
 * Validation of an authorization request (design 2.5), shared by the consent
 * page (app/oauth/authorize/page.tsx) and the decision route.
 *
 * SECURITY: the order is the point. Until the client and its redirect URI
 * are both known good, an error is shown on an NP Hiring page and never
 * redirected anywhere: redirecting to an unverified URI would make this an
 * open redirector. From then on every error goes back to the client at that
 * URI with `error`, `error_description`, `state` and `iss` (RFC 9207, so a
 * client talking to several servers can tell which one answered).
 * tests/oauth/authorize-page.test.ts
 */
import { logger } from '@/lib/logger';
import { hostProfileForResource, MCP_SCOPES, oauthIssuer, type McpScope } from '@/lib/mcp/config';
import { AUTHORIZE_PARAM_KEYS, readAuthorizeParams, type AuthorizeParams } from '@/lib/oauth/authorize-params';
import type { CimdOptions } from '@/lib/oauth/cimd';
import { clientLogLabel, resolveClient, type OAuthClientInfo } from '@/lib/oauth/clients';
import { MAX_AUTHORIZE_URL_LENGTH, MAX_SCOPE_LENGTH, MAX_STATE_LENGTH } from '@/lib/oauth/config';
import type { OAuthErrorCode } from '@/lib/oauth/errors';
import { isPkceValue } from '@/lib/oauth/pkce';
import { appendQuery, redirectHostLabel, redirectUriMatches } from '@/lib/oauth/redirect-uri';
import { parseScopeTokens } from '@/lib/oauth/scopes';

export interface AuthorizeRequest {
    client: OAuthClientInfo;
    /** The requested redirect URI exactly as sent (for a loopback client, with its port). */
    redirectUri: string;
    codeChallenge: string;
    /** The canonical MCP endpoint URL the tokens will be issued for. */
    resource: string;
    scopes: McpScope[];
    state: string | null;
    /** The known parameters as received: what the consent CSRF token signs. */
    params: AuthorizeParams;
}

export type AuthorizeParseResult =
    | { kind: 'ok'; request: AuthorizeRequest }
    /** Shown on our own page: the client or its redirect URI could not be verified. */
    | { kind: 'error_page'; reason: 'client' | 'redirect_uri' }
    /** Sent back to the client at its verified redirect URI. */
    | { kind: 'error_redirect'; error: OAuthErrorCode; redirectTo: string };

export interface ParseOptions extends CimdOptions {
    /** The request's path and query, when it arrived as a URL: refused past 2,000 characters. */
    pathAndQuery?: string;
}

/**
 * The authorization response URL (success or error): the values that are
 * strings, then `iss`, appended to the redirect URI keeping its own query.
 */
function authorizationResponseUrl(redirectUri: string, values: Record<string, string | null | undefined>): string {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(values)) {
        if (typeof value === 'string') query.append(key, value);
    }
    query.append('iss', oauthIssuer());
    return appendQuery(redirectUri, query.toString());
}

/** `redirect_uri?error=...&error_description=...&state=...&iss=...` */
export function authorizationErrorUrl(redirectUri: string, error: OAuthErrorCode, description: string, state: string | null): string {
    return authorizationResponseUrl(redirectUri, { error, error_description: description, state });
}

/** `redirect_uri?code=...&state=...&iss=...` */
export function authorizationCodeUrl(redirectUri: string, code: string, state: string | null): string {
    return authorizationResponseUrl(redirectUri, { code, state });
}

/** The scopes a request names: empty or only offline_access means all three; null for an unknown scope. */
function requestedScopes(value: string | undefined): McpScope[] | null {
    if (value !== undefined && value.length > MAX_SCOPE_LENGTH) return null;
    const scopes = parseScopeTokens(value);
    if (scopes === null) return null;
    return scopes.length > 0 ? scopes : [...MCP_SCOPES];
}

/** Steps 1 to 8 of design 2.5. The session and profile checks (steps 9 and 10) are the caller's. */
export async function parseAuthorizeRequest(
    raw: Readonly<Record<string, unknown>>,
    options: ParseOptions = {},
): Promise<AuthorizeParseResult> {
    const { params, malformed } = readAuthorizeParams(raw);

    // 1. The client resolves, else our error page.
    const clientId = params.client_id;
    if (clientId === undefined || malformed.has('client_id')) return { kind: 'error_page', reason: 'client' };
    const resolution = await resolveClient(clientId, options);
    if (!resolution.ok) return { kind: 'error_page', reason: 'client' };
    const { client } = resolution;

    // 2. The redirect URI is present and registered, else our error page.
    const redirectUri = params.redirect_uri;
    if (redirectUri === undefined || malformed.has('redirect_uri') || !redirectUriMatches(client.redirectUris, redirectUri)) {
        logger.info('[oauth] authorization request refused: redirect_uri not registered', {
            client: clientLogLabel(clientId),
            redirectHost: redirectUri === undefined ? null : redirectHostLabel(redirectUri),
        });
        return { kind: 'error_page', reason: 'redirect_uri' };
    }

    // 3. From here every error goes back to the client. A state over the cap
    // is not echoed: it is the error being reported.
    const state = params.state !== undefined && params.state.length <= MAX_STATE_LENGTH ? params.state : null;
    const fail = (error: OAuthErrorCode, description: string): AuthorizeParseResult => {
        logger.info('[oauth] authorization request refused', { client: clientLogLabel(clientId), error });
        return { kind: 'error_redirect', error, redirectTo: authorizationErrorUrl(redirectUri, error, description, state) };
    };

    if (options.pathAndQuery !== undefined && options.pathAndQuery.length > MAX_AUTHORIZE_URL_LENGTH) {
        return fail('invalid_request', `The authorization request is longer than ${MAX_AUTHORIZE_URL_LENGTH} characters.`);
    }
    const repeated = AUTHORIZE_PARAM_KEYS.find((key) => malformed.has(key));
    if (repeated !== undefined) {
        return fail(repeated === 'resource' ? 'invalid_target' : 'invalid_request', `The ${repeated} parameter must be sent once.`);
    }

    // 4. response_type
    if (params.response_type === undefined) return fail('invalid_request', 'The response_type parameter is missing.');
    if (params.response_type !== 'code') return fail('unsupported_response_type', 'Only the code response type is supported.');

    // 5. PKCE, S256 only
    const codeChallenge = params.code_challenge;
    if (!isPkceValue(codeChallenge)) {
        return fail('invalid_request', 'A code_challenge of 43 to 128 unreserved characters is required.');
    }
    if (params.code_challenge_method !== 'S256') return fail('invalid_request', 'The code_challenge_method must be S256.');

    // 6. resource names one of the two MCP endpoints
    const profile = hostProfileForResource(params.resource);
    if (!profile) return fail('invalid_target', "The resource parameter must name one of this server's MCP endpoints.");

    // 7. scope
    const scopes = requestedScopes(params.scope);
    if (!scopes) return fail('invalid_scope', 'The scope parameter names a scope this server does not offer.');

    // 8. state
    if (params.state !== undefined && params.state.length > MAX_STATE_LENGTH) {
        return fail('invalid_request', `The state parameter is longer than ${MAX_STATE_LENGTH} characters.`);
    }

    return {
        kind: 'ok',
        request: {
            client,
            redirectUri,
            codeChallenge,
            resource: profile.resourceUrl,
            scopes,
            state,
            params,
        },
    };
}
