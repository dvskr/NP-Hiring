/**
 * Settings of the OAuth 2.1 authorization server behind the NP Hiring app in
 * Claude and ChatGPT (design spec section 2): lifetimes, size caps, the host
 * allowlists, the rate limits and the signing secret.
 *
 * Environment values are read on every call, never at module load, so a
 * deployment picks up a changed value on its next request and tests can set
 * them per case.
 */

// ── Lifetimes ──────────────────────────────────────────────────────────────

export const ACCESS_TOKEN_TTL_SECONDS = 3600;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 3600;
export const AUTHORIZATION_CODE_TTL_SECONDS = 5 * 60;
/** How long the consent page's CSRF token stays valid. */
export const CONSENT_TOKEN_TTL_SECONDS = 10 * 60;
/** grant.lastUsedAt moves at most once in this interval (one write per busy grant, not one per MCP call). */
export const GRANT_LAST_USED_INTERVAL_MS = 10 * 60 * 1000;

// ── Size caps ──────────────────────────────────────────────────────────────

/** Token, revoke, register and decision request bodies. */
export const MAX_REQUEST_BODY_BYTES = 16 * 1024;
/** The authorize path and query, which the login return also carries as ?next=. */
export const MAX_AUTHORIZE_URL_LENGTH = 2000;
export const MAX_STATE_LENGTH = 1024;
export const MAX_CLIENT_ID_LENGTH = 512;
export const MAX_REDIRECT_URI_LENGTH = 2048;
export const MAX_SCOPE_LENGTH = 512;
export const MAX_CLIENT_NAME_LENGTH = 100;
/** An access token, a refresh token or an authorization code presented to an endpoint. */
export const MAX_TOKEN_LENGTH = 4096;

// ── Clients ────────────────────────────────────────────────────────────────

export const CIMD_FETCH_TIMEOUT_MS = 3000;
export const CIMD_MAX_BYTES = 5 * 1024;
export const CIMD_CACHE_TTL_MS = 5 * 60 * 1000;
export const CIMD_CACHE_MAX_ENTRIES = 100;
export const CIMD_MAX_REDIRECT_URIS = 10;

export const DCR_MAX_REDIRECT_URIS = 5;
export const DCR_MAX_REDIRECT_URI_LENGTH = 512;
export const DCR_DEFAULT_CLIENT_NAME = 'MCP client';

const DEFAULT_CIMD_HOSTS: readonly string[] = ['claude.ai', 'chatgpt.com'];
const DEFAULT_REDIRECT_HOSTS: readonly string[] = ['claude.ai', 'claude.com', 'chatgpt.com'];

/** A DNS hostname in lowercase: labels of letters, digits and inner hyphens. */
const HOSTNAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;

/** The defaults plus the hostnames of a comma list; anything that is not a bare hostname is ignored. */
function hostList(defaults: readonly string[], configured: string | undefined): string[] {
    const extra = (configured ?? '')
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter((value) => HOSTNAME.test(value));
    return [...new Set([...defaults, ...extra])];
}

/** Hosts a Client ID Metadata Document may be fetched from: claude.ai, chatgpt.com and MCP_OAUTH_CIMD_HOSTS. */
export function cimdHosts(): string[] {
    return hostList(DEFAULT_CIMD_HOSTS, process.env.MCP_OAUTH_CIMD_HOSTS);
}

/** https hosts a registered (DCR) client may redirect to: claude.ai, claude.com, chatgpt.com and MCP_OAUTH_REDIRECT_HOSTS. */
export function dcrRedirectHosts(): string[] {
    return hostList(DEFAULT_REDIRECT_HOSTS, process.env.MCP_OAUTH_REDIRECT_HOSTS);
}

// ── Signing secret ─────────────────────────────────────────────────────────

export const MIN_SIGNING_SECRET_LENGTH = 32;

/**
 * MCP_OAUTH_SIGNING_SECRET, or null when it is missing or shorter than 32
 * characters. It signs the access tokens (HS256) and the consent page's CSRF
 * token. Without it every OAuth endpoint answers 503 temporarily_unavailable
 * and verifyAccessToken refuses every token ('unconfigured').
 */
export function oauthSigningSecret(): string | null {
    const secret = process.env.MCP_OAUTH_SIGNING_SECRET;
    if (typeof secret !== 'string' || secret.length < MIN_SIGNING_SECRET_LENGTH) return null;
    return secret;
}

// ── Rate limits (design 2.11) ──────────────────────────────────────────────

export const OAUTH_RATE_LIMITS = {
    /** Claude and ChatGPT call from shared egress IPs, so the token endpoint also counts per client. */
    tokenPerClient: { limit: 300, windowSeconds: 60 },
    tokenPerIp: { limit: 600, windowSeconds: 60 },
    registerPerIp: { limit: 20, windowSeconds: 60 },
    revokePerIp: { limit: 120, windowSeconds: 60 },
    /** The consent page and its decision route, each per signed-in user (per IP before sign-in). */
    authorizePerUser: { limit: 30, windowSeconds: 60 },
} as const;
