/**
 * Scope strings (design 2.1). The three MCP scopes come from lib/mcp/config.ts;
 * offline_access is advertised in the authorization server metadata only and
 * is dropped wherever a client sends it, because refresh tokens are always
 * issued.
 */
import { MCP_SCOPES, isMcpScope, type McpScope } from '@/lib/mcp/config';

export const OFFLINE_ACCESS = 'offline_access';

/**
 * The MCP scopes a space-separated scope string names, deduplicated and in
 * MCP_SCOPES order, with offline_access dropped. An empty array when it names
 * none; null when it names a scope this server does not know (invalid_scope).
 */
export function parseScopeTokens(value: string | undefined): McpScope[] | null {
    if (value === undefined) return [];
    const named = new Set<McpScope>();
    for (const token of value.split(' ')) {
        if (token === '' || token === OFFLINE_ACCESS) continue;
        if (!isMcpScope(token)) return null;
        named.add(token);
    }
    return MCP_SCOPES.filter((scope) => named.has(scope));
}

/** The stored scopes of a grant that are still MCP scopes, in MCP_SCOPES order. */
export function grantScopes(stored: readonly string[]): McpScope[] {
    return MCP_SCOPES.filter((scope) => stored.includes(scope));
}
