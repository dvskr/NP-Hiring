/**
 * OAuth 2.1 authorization server settings for the AI assistant connectors.
 *
 * NP Hiring is its own authorization server. ChatGPT and Claude discover
 * it from the protected resource metadata (RFC 9728) that each MCP endpoint
 * points at, register through Dynamic Client Registration (RFC 7591), send
 * the person through /oauth/authorize to sign in with their normal account,
 * and receive bearer tokens bound to exactly one MCP endpoint (RFC 8707).
 *
 * Two endpoints, two audiences, two scopes. A token minted for the candidate
 * connector is refused by the employer connector and the other way round, so
 * an app a job seeker approved can never reach employer tools even if the
 * account later becomes an employer account.
 */

import { brand } from '@/config/brand';
import { MCP_PREFIX } from '@/lib/mcp/prefix';

/** Every scope this server can grant. One per MCP endpoint. */
export type OAuthScope = 'candidate' | 'employer';

export type McpResourceId = 'candidate' | 'employer';

export interface McpResourceConfig {
  id: McpResourceId;
  /**
   * The MCP endpoint's path on this origin. An API address, not a page:
   * nothing renders it as a link, and the employer one is not served yet.
   */
  endpoint: string;
  /** The single scope a token for this endpoint carries. */
  scope: OAuthScope;
  /** Name shown on the consent screen and in Connected apps. */
  displayName: string;
  /** Account roles allowed to approve a connection to this endpoint. */
  allowedRoles: readonly string[];
}

export const MCP_RESOURCES: Readonly<Record<McpResourceId, McpResourceConfig>> = {
  candidate: {
    id: 'candidate',
    endpoint: '/mcp',
    scope: 'candidate',
    displayName: brand.name,
    // Mirrors the web: apply-direct does not check role, so neither does this.
    allowedRoles: ['job_seeker', 'employer', 'admin'],
  },
  employer: {
    id: 'employer',
    endpoint: '/mcp/employer',
    scope: 'employer',
    displayName: `${brand.name} for Employers`,
    // Mirrors requireEmployerApi(): employer and admin accounts only.
    allowedRoles: ['employer', 'admin'],
  },
};

/** What each scope lets an app do, in the words the consent screen uses. */
export const SCOPE_PERMISSIONS: Readonly<Record<OAuthScope, readonly string[]>> = {
  candidate: [
    `Search ${brand.niche.short} jobs and pay data for you`,
    'Read the profile details employers see when you apply',
    'Submit applications you confirm, and show their status',
    'Withdraw an application when you ask it to',
    'Save jobs for you, and set up, list and delete your job alerts',
  ],
  employer: [
    'Show your job postings, their status and their results',
    'Prepare new postings and open Stripe checkout for the ones you approve',
    'Show applicants for your postings and their screening answers, except answers about sensitive personal information',
    'Move an applicant to a new stage when you ask it to',
  ],
};

/** Access tokens are short: an hour bounds what a leaked token is worth. */
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
/** Refresh tokens rotate on every use; this is the idle lifetime. */
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 60;
export const AUTHORIZATION_CODE_TTL_SECONDS = 5 * 60;
/** Long enough to create an account and confirm an email in the middle. */
export const AUTHORIZATION_REQUEST_TTL_SECONDS = 30 * 60;
/**
 * A spent refresh token presented once more inside this window gets a fresh
 * pair instead of revoking the grant: a retry after a lost response, or two
 * of a host's workers racing on the same token, is not theft. A second reuse,
 * or any reuse after the window, is.
 */
export const REFRESH_REUSE_GRACE_SECONDS = 30;
/**
 * How long a rotated refresh token is kept, so a stolen copy presented later
 * still trips reuse detection. After this it expires and the cleanup cron
 * removes it.
 */
export const SPENT_REFRESH_RETENTION_SECONDS = 7 * 24 * 60 * 60;
/** lastUsedAt on a grant is written at most this often. */
export const GRANT_LAST_USED_THROTTLE_SECONDS = 10 * 60;

/** Token prefixes, so a token in a log or a support ticket says what it is. */
export const TOKEN_PREFIX = {
  access: `${MCP_PREFIX}_at_`,
  refresh: `${MCP_PREFIX}_rt_`,
  code: `${MCP_PREFIX}_ac_`,
  clientSecret: `${MCP_PREFIX}_cs_`,
  clientId: `${MCP_PREFIX}_ci_`,
  request: `${MCP_PREFIX}_ar_`,
} as const;

/**
 * The issuer and the base of every OAuth and MCP URL. Same derivation as
 * every other absolute URL this app builds (lib/email-service.ts and
 * friends), so dev and local runs advertise their own host.
 */
export function getIssuer(): string {
  return (process.env.NEXT_PUBLIC_BASE_URL || brand.baseUrl).replace(/\/+$/, '');
}

export function resourceUrl(id: McpResourceId): string {
  return `${getIssuer()}${MCP_RESOURCES[id].endpoint}`;
}

/** RFC 9728 section 3.1: the well-known path is inserted before the resource path. */
export function protectedResourceMetadataUrl(id: McpResourceId): string {
  return `${getIssuer()}/.well-known/oauth-protected-resource${MCP_RESOURCES[id].endpoint}`;
}

export const OAUTH_ENDPOINTS = {
  authorization: '/oauth/authorize',
  token: '/oauth/token',
  registration: '/oauth/register',
  revocation: '/oauth/revoke',
  consent: '/oauth/consent',
} as const;

export function endpointUrl(path: string): string {
  return `${getIssuer()}${path}`;
}

/** Normalises a resource indicator for comparison: no trailing slash. */
function normalizeResource(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

/**
 * Which MCP endpoint a request is for. An explicit RFC 8707 `resource` wins
 * and must name one of ours exactly. Without one, the requested scope
 * decides, and anything else falls back to the candidate endpoint, which is
 * the one most connections are for.
 *
 * Returns null when a resource was given and it is not one of ours, which
 * the caller reports as `invalid_target`.
 */
export function resolveResource(
  resourceParam: string | null | undefined,
  scopeParam: string | null | undefined,
): McpResourceConfig | null {
  if (resourceParam && resourceParam.trim()) {
    const wanted = normalizeResource(resourceParam);
    const match = (Object.keys(MCP_RESOURCES) as McpResourceId[]).find(
      (id) => normalizeResource(resourceUrl(id)) === wanted,
    );
    return match && isResourceServed(match) ? MCP_RESOURCES[match] : null;
  }
  const scopes = parseScope(scopeParam);
  const chosen = scopes.includes('employer') ? MCP_RESOURCES.employer : MCP_RESOURCES.candidate;
  return isResourceServed(chosen.id) ? chosen : null;
}

/**
 * Whether NP Hiring serves a connector now. The job seeker connector is
 * always served. The employer connector is defined so stored grants and
 * tokens keep their meaning, but it is not served yet: a request that names
 * it is refused until its tools exist.
 */
export function isResourceServed(id: McpResourceId): boolean {
  return id === 'candidate';
}

export function resourceById(id: string): McpResourceConfig | null {
  return id === 'candidate' || id === 'employer' ? MCP_RESOURCES[id] : null;
}

/** The resource config for a stored resource URL, or null if it is not ours (any more). */
export function resourceForUrl(url: string): McpResourceConfig | null {
  const wanted = normalizeResource(url);
  const match = (Object.keys(MCP_RESOURCES) as McpResourceId[]).find(
    (id) => normalizeResource(resourceUrl(id)) === wanted,
  );
  return match ? MCP_RESOURCES[match] : null;
}

/** Space-delimited scope string to a de-duplicated list (RFC 6749 section 3.3). */
export function parseScope(value: string | null | undefined): string[] {
  if (!value) return [];
  return Array.from(new Set(value.split(/\s+/).filter(Boolean)));
}
