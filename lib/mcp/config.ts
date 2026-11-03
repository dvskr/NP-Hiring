/**
 * Endpoints of the NP Hiring app for Claude and ChatGPT, one source for the
 * MCP routes (app/mcp), the OAuth server (lib/oauth) and the metadata
 * documents (app/.well-known).
 *
 * Two MCP endpoints serve one codebase because the hosts disagree in two
 * places (research 2026-10-25, docs/ai-apps):
 *   - `_meta.ui.domain`: Claude refuses to render a widget whose value is not
 *     its own `<hash>.claudemcpcontent.com` form, while ChatGPT requires the
 *     app's own origin before a UI plugin can be submitted. The Claude
 *     endpoint sends none; the ChatGPT endpoint sends the site origin.
 *   - The sign-in signal: Claude starts sign-in only on an HTTP 401 with
 *     WWW-Authenticate, sent before the MCP layer answers; ChatGPT links an
 *     account from a tool error result carrying `_meta["mcp/www_authenticate"]`.
 * Each endpoint is its own OAuth protected resource: a token's audience is
 * exactly one of the two URLs, and the other endpoint refuses it.
 */
import { brand } from '@/config/brand';

export type McpHostId = 'claude' | 'chatgpt';

export interface McpHostProfile {
    id: McpHostId;
    /** Route path on the site. */
    path: '/mcp' | '/mcp/chatgpt';
    /** Canonical endpoint URL: the OAuth resource and every token's audience. */
    resourceUrl: string;
    /** RFC 9728 protected resource metadata for this endpoint. */
    resourceMetadataUrl: string;
    /** How a missing sign-in is reported (see the header comment). */
    signIn: 'http-401' | 'tool-error';
    /** `_meta.ui.domain` for the widget resource, or null to send none. */
    widgetDomain: string | null;
}

/**
 * The site origin the endpoints and the OAuth issuer derive from:
 * brand.baseUrl, unless MCP_BASE_URL names another origin (local runs at
 * http://localhost:3000, a preview deployment). Only the origin of the value
 * is kept, so a stray path or trailing slash can never change a token
 * audience.
 */
export function mcpBaseUrl(): string {
    const configured = process.env.MCP_BASE_URL?.trim();
    if (configured) {
        try {
            return new URL(configured).origin;
        } catch {
            // An unparseable override falls back to the canonical site.
        }
    }
    return new URL(brand.baseUrl).origin;
}

/** The OAuth authorization server's issuer identifier (RFC 8414): the site origin itself. */
export function oauthIssuer(): string {
    return mcpBaseUrl();
}

function profile(id: McpHostId, path: McpHostProfile['path'], base: string): McpHostProfile {
    return {
        id,
        path,
        resourceUrl: `${base}${path}`,
        resourceMetadataUrl: `${base}/.well-known/oauth-protected-resource${path}`,
        signIn: id === 'claude' ? 'http-401' : 'tool-error',
        widgetDomain: id === 'chatgpt' ? base : null,
    };
}

export function mcpHostProfile(id: McpHostId): McpHostProfile {
    const base = mcpBaseUrl();
    return id === 'claude' ? profile('claude', '/mcp', base) : profile('chatgpt', '/mcp/chatgpt', base);
}

export function allMcpHostProfiles(): McpHostProfile[] {
    return [mcpHostProfile('claude'), mcpHostProfile('chatgpt')];
}

/**
 * The canonical form of a resource indicator (RFC 8707) for comparison:
 * lowercase scheme and host, no default port, no trailing slash, no query and
 * no fragment. Null when the value is not an absolute http(s) URL.
 */
export function canonicalResource(value: string | null | undefined): string | null {
    if (typeof value !== 'string' || value.trim() === '') return null;
    let url: URL;
    try {
        url = new URL(value.trim());
    } catch {
        return null;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password) return null;
    const path = url.pathname.replace(/\/+$/, '');
    return `${url.protocol}//${url.host.toLowerCase()}${path}`;
}

/** The host profile whose endpoint a resource indicator names, or null. */
export function hostProfileForResource(value: string | null | undefined): McpHostProfile | null {
    const canonical = canonicalResource(value);
    if (!canonical) return null;
    return allMcpHostProfiles().find((p) => p.resourceUrl === canonical) ?? null;
}

// ── Scopes ─────────────────────────────────────────────────────────────────

export const MCP_SCOPES = ['profile:read', 'applications:read', 'applications:write'] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

/** Consent-screen wording for each scope (app/oauth/authorize). */
export const MCP_SCOPE_DESCRIPTIONS: Readonly<Record<McpScope, string>> = {
    'profile:read': 'See your name, headline and whether a resume is on your profile',
    'applications:read': 'See your applications and saved jobs',
    'applications:write': 'Submit, track and withdraw applications and save jobs when you ask',
};

export function isMcpScope(value: string): value is McpScope {
    return (MCP_SCOPES as readonly string[]).includes(value);
}
