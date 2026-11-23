/**
 * The short name every connector identifier starts with: token and review
 * ids (lib/mcp/oauth/config.ts, lib/mcp/server/pending-actions.ts) and the
 * widget resource URIs (lib/mcp/widgets/resources.ts), so a value in a log
 * or a support ticket says which site issued it.
 */
export const MCP_PREFIX = 'nph' as const;
