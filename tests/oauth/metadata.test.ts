/**
 * The discovery documents (design 2.2 and 2.3) and their routes:
 *   GET /.well-known/oauth-authorization-server
 *   GET /.well-known/oauth-protected-resource       (the Claude endpoint's document)
 *   GET /.well-known/oauth-protected-resource/mcp
 *   GET /.well-known/oauth-protected-resource/mcp/chatgpt
 *
 * Pinned: the exact fields of each document, offline_access in the server
 * metadata only, public 5 minute caching, CORS for any origin, a 204
 * preflight, and every URL following MCP_BASE_URL.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { authorizationServerMetadata, protectedResourceMetadata } from '@/lib/oauth/metadata';
import { mcpHostProfile } from '@/lib/mcp/config';
import * as asRoute from '@/app/.well-known/oauth-authorization-server/route';
import * as rootPrRoute from '@/app/.well-known/oauth-protected-resource/route';
import * as claudePrRoute from '@/app/.well-known/oauth-protected-resource/mcp/route';
import * as chatgptPrRoute from '@/app/.well-known/oauth-protected-resource/mcp/chatgpt/route';
import { useOAuthEnv } from './support/fixtures';

const AUTHORIZATION_SERVER = {
    issuer: 'https://nphiring.com',
    authorization_endpoint: 'https://nphiring.com/oauth/authorize',
    token_endpoint: 'https://nphiring.com/oauth/token',
    registration_endpoint: 'https://nphiring.com/oauth/register',
    revocation_endpoint: 'https://nphiring.com/oauth/revoke',
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    scopes_supported: ['profile:read', 'applications:read', 'applications:write', 'offline_access'],
    service_documentation: 'https://nphiring.com/ai-apps',
};

function protectedResource(resource: string) {
    return {
        resource,
        authorization_servers: ['https://nphiring.com'],
        scopes_supported: ['profile:read', 'applications:read', 'applications:write'],
        bearer_methods_supported: ['header'],
        resource_name: 'NP Hiring',
        resource_documentation: 'https://nphiring.com/ai-apps',
    };
}

beforeEach(() => {
    useOAuthEnv();
});

afterEach(() => {
    delete process.env.MCP_BASE_URL;
});

describe('the documents', () => {
    it('authorization server metadata has exactly the design 2.2 fields', () => {
        expect(authorizationServerMetadata()).toEqual(AUTHORIZATION_SERVER);
    });

    it('protected resource metadata for each endpoint has exactly the design 2.3 fields', () => {
        expect(protectedResourceMetadata(mcpHostProfile('claude'))).toEqual(protectedResource('https://nphiring.com/mcp'));
        expect(protectedResourceMetadata(mcpHostProfile('chatgpt'))).toEqual(protectedResource('https://nphiring.com/mcp/chatgpt'));
    });

    it('offline_access is advertised by the server only, never by a protected resource', () => {
        for (const id of ['claude', 'chatgpt'] as const) {
            expect(protectedResourceMetadata(mcpHostProfile(id)).scopes_supported).not.toContain('offline_access');
        }
    });

    it('every URL follows MCP_BASE_URL (a preview or local run), origin only', () => {
        process.env.MCP_BASE_URL = 'http://localhost:3000/ignored/path';
        const server = authorizationServerMetadata();
        expect(server.issuer).toBe('http://localhost:3000');
        expect(server.token_endpoint).toBe('http://localhost:3000/oauth/token');
        expect(protectedResourceMetadata(mcpHostProfile('chatgpt'))).toMatchObject({
            resource: 'http://localhost:3000/mcp/chatgpt',
            authorization_servers: ['http://localhost:3000'],
        });
    });
});

describe('the routes', () => {
    const cases = [
        { name: 'authorization server', route: asRoute, body: AUTHORIZATION_SERVER },
        { name: 'root protected resource (Claude)', route: rootPrRoute, body: protectedResource('https://nphiring.com/mcp') },
        { name: 'Claude protected resource', route: claudePrRoute, body: protectedResource('https://nphiring.com/mcp') },
        { name: 'ChatGPT protected resource', route: chatgptPrRoute, body: protectedResource('https://nphiring.com/mcp/chatgpt') },
    ];

    for (const { name, route, body } of cases) {
        it(`${name}: JSON, public for 5 minutes, any origin, dynamic`, async () => {
            const res = route.GET();
            expect(res.status).toBe(200);
            expect(res.headers.get('content-type')).toContain('application/json');
            expect(res.headers.get('cache-control')).toBe('public, max-age=300');
            expect(res.headers.get('access-control-allow-origin')).toBe('*');
            expect(await res.json()).toEqual(body);
            expect(route.dynamic).toBe('force-dynamic');
        });

        it(`${name}: OPTIONS answers 204 with CORS headers`, () => {
            const res = route.OPTIONS();
            expect(res.status).toBe(204);
            expect(res.headers.get('access-control-allow-origin')).toBe('*');
            expect(res.headers.get('access-control-allow-methods')).toContain('GET');
            expect(res.headers.get('access-control-allow-headers')).toContain('MCP-Protocol-Version');
        });
    }
});
