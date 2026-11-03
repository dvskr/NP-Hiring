/**
 * OAuth error codes this server answers with: RFC 6749 sections 4.1.2.1 and
 * 5.2, RFC 8707 (invalid_target), RFC 7591 (the two registration errors) and
 * RFC 8628's slow_down for a rate-limited client.
 *
 * error_description values are developer-facing and never carry a token,
 * a code, a verifier or anything taken from the request.
 */
export type OAuthErrorCode =
    | 'invalid_request'
    | 'invalid_client'
    | 'invalid_grant'
    | 'unsupported_grant_type'
    | 'invalid_scope'
    | 'invalid_target'
    | 'access_denied'
    | 'unsupported_response_type'
    | 'server_error'
    | 'temporarily_unavailable'
    | 'slow_down'
    | 'invalid_redirect_uri'
    | 'invalid_client_metadata';

/** The error a token-endpoint step answers with when it refuses the request. */
export interface OAuthFailure {
    ok: false;
    error: OAuthErrorCode;
    description: string;
}

export function oauthFailure(error: OAuthErrorCode, description: string): OAuthFailure {
    return { ok: false, error, description };
}
