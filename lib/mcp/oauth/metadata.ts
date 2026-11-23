import {
  MCP_RESOURCES,
  isResourceServed,
  OAUTH_ENDPOINTS,
  endpointUrl,
  getIssuer,
  resourceUrl,
  type McpResourceId,
} from './config';

/**
 * Discovery documents. ChatGPT and Claude read these before anything else:
 * the MCP endpoint's 401 points at the protected resource metadata, which
 * names this server as its authorization server, whose metadata names every
 * endpoint below.
 */

/** RFC 8414 authorization server metadata. */
export function authorizationServerMetadata(): Record<string, unknown> {
  const issuer = getIssuer();
  return {
    issuer,
    authorization_endpoint: endpointUrl(OAUTH_ENDPOINTS.authorization),
    token_endpoint: endpointUrl(OAUTH_ENDPOINTS.token),
    registration_endpoint: endpointUrl(OAUTH_ENDPOINTS.registration),
    revocation_endpoint: endpointUrl(OAUTH_ENDPOINTS.revocation),
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    // ChatGPT refuses an authorization server that does not advertise S256.
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    scopes_supported: (Object.keys(MCP_RESOURCES) as McpResourceId[]).filter(isResourceServed).map((id) => MCP_RESOURCES[id].scope),
    // RFC 9207. ChatGPT's stable redirect URI requires it.
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${issuer}/ai-apps`,
    op_policy_uri: `${issuer}/privacy`,
    op_tos_uri: `${issuer}/terms`,
  };
}

/** RFC 9728 protected resource metadata for one MCP endpoint. */
export function protectedResourceMetadata(id: McpResourceId): Record<string, unknown> {
  const resource = MCP_RESOURCES[id];
  const issuer = getIssuer();
  return {
    resource: resourceUrl(id),
    authorization_servers: [issuer],
    scopes_supported: [resource.scope],
    bearer_methods_supported: ['header'],
    resource_name: resource.displayName,
    resource_documentation: `${issuer}/ai-apps`,
    resource_policy_uri: `${issuer}/privacy`,
    resource_tos_uri: `${issuer}/terms`,
  };
}

/** Headers for discovery documents: public, cacheable briefly, readable cross-origin. */
export const DISCOVERY_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'public, max-age=300',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version',
};
