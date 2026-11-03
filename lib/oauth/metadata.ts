/**
 * Discovery documents (design 2.2 and 2.3): the authorization server
 * metadata (RFC 8414) and one protected resource metadata document per MCP
 * endpoint (RFC 9728). Every URL derives from lib/mcp/config.ts, so the
 * documents, the token audiences and the MCP routes always agree.
 * tests/oauth/metadata.test.ts
 */
import { brand } from '@/config/brand';
import { MCP_SCOPES, mcpBaseUrl, oauthIssuer, type McpHostProfile, type McpScope } from '@/lib/mcp/config';
import { OFFLINE_ACCESS } from '@/lib/oauth/scopes';

export interface AuthorizationServerMetadata {
    issuer: string;
    authorization_endpoint: string;
    token_endpoint: string;
    registration_endpoint: string;
    revocation_endpoint: string;
    response_types_supported: string[];
    response_modes_supported: string[];
    grant_types_supported: string[];
    code_challenge_methods_supported: string[];
    token_endpoint_auth_methods_supported: string[];
    revocation_endpoint_auth_methods_supported: string[];
    client_id_metadata_document_supported: boolean;
    authorization_response_iss_parameter_supported: boolean;
    scopes_supported: string[];
    service_documentation: string;
}

export interface ProtectedResourceMetadata {
    resource: string;
    authorization_servers: string[];
    scopes_supported: McpScope[];
    bearer_methods_supported: string[];
    resource_name: string;
    resource_documentation: string;
}

/** The public page that documents the apps. */
function documentationUrl(): string {
    return `${mcpBaseUrl()}/ai-apps`;
}

export function authorizationServerMetadata(): AuthorizationServerMetadata {
    const issuer = oauthIssuer();
    return {
        issuer,
        authorization_endpoint: `${issuer}/oauth/authorize`,
        token_endpoint: `${issuer}/oauth/token`,
        registration_endpoint: `${issuer}/oauth/register`,
        revocation_endpoint: `${issuer}/oauth/revoke`,
        response_types_supported: ['code'],
        response_modes_supported: ['query'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        revocation_endpoint_auth_methods_supported: ['none'],
        client_id_metadata_document_supported: true,
        authorization_response_iss_parameter_supported: true,
        // offline_access is listed here only: refresh tokens are always issued.
        scopes_supported: [...MCP_SCOPES, OFFLINE_ACCESS],
        service_documentation: documentationUrl(),
    };
}

export function protectedResourceMetadata(profile: McpHostProfile): ProtectedResourceMetadata {
    return {
        resource: profile.resourceUrl,
        authorization_servers: [oauthIssuer()],
        scopes_supported: [...MCP_SCOPES],
        bearer_methods_supported: ['header'],
        resource_name: brand.name,
        resource_documentation: documentationUrl(),
    };
}
