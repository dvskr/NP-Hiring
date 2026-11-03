/**
 * lib/mcp/config.ts: the two MCP endpoints, their OAuth resource URLs and the
 * resource indicator canonical form (design section 1 and 2.5 step 6).
 *
 * Pinned:
 *   - both host profiles derive from brand.baseUrl: endpoint URL (the token
 *     audience), protected resource metadata URL, sign-in signal and widget
 *     domain (Claude sends none, ChatGPT the site origin);
 *   - MCP_BASE_URL keeps only its origin, so a stray path or slash can never
 *     change a token audience, and an unparseable value falls back;
 *   - canonicalResource: lowercase scheme and host, no default port, no
 *     trailing slash, no query, no fragment; null for userinfo, non-http(s),
 *     relative and empty values;
 *   - hostProfileForResource names a profile only for an exact canonical
 *     match (another host, scheme or path is no endpoint of ours).
 *
 * Pure module: nothing here touches a database or the network.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { brand } from '@/config/brand';
import {
    MCP_SCOPES,
    MCP_SCOPE_DESCRIPTIONS,
    allMcpHostProfiles,
    canonicalResource,
    hostProfileForResource,
    isMcpScope,
    mcpBaseUrl,
    mcpHostProfile,
    oauthIssuer,
} from '@/lib/mcp/config';
import { dashFindings } from './fixtures';

const SITE = new URL(brand.baseUrl).origin;

let savedBaseUrl: string | undefined;
beforeEach(() => {
    savedBaseUrl = process.env.MCP_BASE_URL;
    delete process.env.MCP_BASE_URL;
});
afterEach(() => {
    if (savedBaseUrl === undefined) delete process.env.MCP_BASE_URL;
    else process.env.MCP_BASE_URL = savedBaseUrl;
});

describe('host profiles derive from brand.baseUrl', () => {
    it('the base URL and the OAuth issuer are the site origin', () => {
        expect(mcpBaseUrl()).toBe(SITE);
        expect(oauthIssuer()).toBe(SITE);
    });

    it('Claude: /mcp, its own metadata document, an HTTP 401 sign-in and no widget domain', () => {
        expect(mcpHostProfile('claude')).toEqual({
            id: 'claude',
            path: '/mcp',
            resourceUrl: `${SITE}/mcp`,
            resourceMetadataUrl: `${SITE}/.well-known/oauth-protected-resource/mcp`,
            signIn: 'http-401',
            widgetDomain: null,
        });
    });

    it('ChatGPT: /mcp/chatgpt, its own metadata document, a tool error sign-in and the site origin as widget domain', () => {
        expect(mcpHostProfile('chatgpt')).toEqual({
            id: 'chatgpt',
            path: '/mcp/chatgpt',
            resourceUrl: `${SITE}/mcp/chatgpt`,
            resourceMetadataUrl: `${SITE}/.well-known/oauth-protected-resource/mcp/chatgpt`,
            signIn: 'tool-error',
            widgetDomain: SITE,
        });
    });

    it('matches the endpoint table of the design spec for the production site', () => {
        expect(brand.baseUrl).toBe('https://nphiring.com');
        expect(allMcpHostProfiles().map((p) => [p.resourceUrl, p.resourceMetadataUrl])).toEqual([
            ['https://nphiring.com/mcp', 'https://nphiring.com/.well-known/oauth-protected-resource/mcp'],
            ['https://nphiring.com/mcp/chatgpt', 'https://nphiring.com/.well-known/oauth-protected-resource/mcp/chatgpt'],
        ]);
    });

    it('allMcpHostProfiles lists exactly the two endpoints, each audience distinct', () => {
        const profiles = allMcpHostProfiles();
        expect(profiles.map((p) => p.id)).toEqual(['claude', 'chatgpt']);
        expect(new Set(profiles.map((p) => p.resourceUrl)).size).toBe(2);
    });
});

describe('MCP_BASE_URL overrides the origin, and only the origin', () => {
    it.each([
        ['http://localhost:3000', 'http://localhost:3000'],
        ['http://localhost:3000/', 'http://localhost:3000'],
        ['https://preview-123.example.com/some/path/?q=1#frag', 'https://preview-123.example.com'],
        ['  https://Preview.Example.COM:443/  ', 'https://preview.example.com'],
    ])('%s gives the base %s', (value, origin) => {
        process.env.MCP_BASE_URL = value;
        expect(mcpBaseUrl()).toBe(origin);
        expect(oauthIssuer()).toBe(origin);
        expect(mcpHostProfile('claude').resourceUrl).toBe(`${origin}/mcp`);
        expect(mcpHostProfile('chatgpt').resourceMetadataUrl).toBe(`${origin}/.well-known/oauth-protected-resource/mcp/chatgpt`);
        expect(mcpHostProfile('chatgpt').widgetDomain).toBe(origin);
    });

    it.each(['not a url', '   ', ''])('an unparseable or blank value (%j) falls back to brand.baseUrl', (value) => {
        process.env.MCP_BASE_URL = value;
        expect(mcpBaseUrl()).toBe(SITE);
    });

    it('is read on every call, so a deploy or test can change it', () => {
        expect(mcpHostProfile('claude').resourceUrl).toBe(`${SITE}/mcp`);
        process.env.MCP_BASE_URL = 'http://localhost:3000';
        expect(mcpHostProfile('claude').resourceUrl).toBe('http://localhost:3000/mcp');
    });
});

describe('canonicalResource (RFC 8707 comparison form)', () => {
    it.each([
        ['https://nphiring.com/mcp', 'https://nphiring.com/mcp'],
        ['HTTPS://NPHIRING.COM/mcp', 'https://nphiring.com/mcp'],
        ['https://NPHiring.com/mcp/chatgpt', 'https://nphiring.com/mcp/chatgpt'],
        ['https://nphiring.com:443/mcp', 'https://nphiring.com/mcp'],
        ['http://localhost:80/mcp', 'http://localhost/mcp'],
        ['https://nphiring.com:8443/mcp', 'https://nphiring.com:8443/mcp'],
        ['http://localhost:3000/mcp', 'http://localhost:3000/mcp'],
        ['https://nphiring.com/mcp/', 'https://nphiring.com/mcp'],
        ['https://nphiring.com/mcp///', 'https://nphiring.com/mcp'],
        ['https://nphiring.com/', 'https://nphiring.com'],
        ['https://nphiring.com/mcp?x=1&resource=https://evil.example', 'https://nphiring.com/mcp'],
        ['https://nphiring.com/mcp#fragment', 'https://nphiring.com/mcp'],
        ['https://nphiring.com/mcp/?a=b#c', 'https://nphiring.com/mcp'],
        ['  https://nphiring.com/mcp  ', 'https://nphiring.com/mcp'],
    ])('%s canonicalizes to %s', (value, canonical) => {
        expect(canonicalResource(value)).toBe(canonical);
    });

    it('keeps the path case: paths are case sensitive, so /MCP is not /mcp', () => {
        expect(canonicalResource('https://nphiring.com/MCP')).toBe('https://nphiring.com/MCP');
    });

    it.each([
        ['userinfo with a password', 'https://user:pass@nphiring.com/mcp'],
        ['userinfo without a password', 'https://user@nphiring.com/mcp'],
        ['a non-http scheme', 'ftp://nphiring.com/mcp'],
        ['a javascript URL', 'javascript:alert(1)'],
        ['a URN', 'urn:ietf:params:oauth:resource'],
        ['a relative path', '/mcp'],
        ['a bare host', 'nphiring.com/mcp'],
        ['an empty string', ''],
        ['whitespace', '   '],
    ])('null for %s', (_label, value) => {
        expect(canonicalResource(value)).toBeNull();
    });

    it('null for null and undefined', () => {
        expect(canonicalResource(null)).toBeNull();
        expect(canonicalResource(undefined)).toBeNull();
    });
});

describe('hostProfileForResource', () => {
    it('names the profile whose endpoint the indicator canonicalizes to', () => {
        expect(hostProfileForResource('https://nphiring.com/mcp')?.id).toBe('claude');
        expect(hostProfileForResource('https://NPHIRING.com:443/mcp/')?.id).toBe('claude');
        expect(hostProfileForResource('https://nphiring.com/mcp/chatgpt')?.id).toBe('chatgpt');
        expect(hostProfileForResource('https://nphiring.com/mcp/chatgpt/?a=1#b')?.id).toBe('chatgpt');
    });

    it.each([
        ['another path on the site', 'https://nphiring.com/mcp/other'],
        ['the site root', 'https://nphiring.com'],
        ['the path in another case', 'https://nphiring.com/MCP'],
        ['plain http', 'http://nphiring.com/mcp'],
        ['the www host', 'https://www.nphiring.com/mcp'],
        ['another host', 'https://evil.example/mcp'],
        ['a look-alike host', 'https://nphiring.com.evil.example/mcp'],
        ['a non-default port', 'https://nphiring.com:8443/mcp'],
        ['userinfo', 'https://nphiring.com@evil.example/mcp'],
        ['nothing', undefined],
    ])('null for %s', (_label, value) => {
        expect(hostProfileForResource(value)).toBeNull();
    });

    it('follows MCP_BASE_URL (local runs and previews)', () => {
        process.env.MCP_BASE_URL = 'http://localhost:3000';
        expect(hostProfileForResource('http://localhost:3000/mcp')?.id).toBe('claude');
        expect(hostProfileForResource('https://nphiring.com/mcp')).toBeNull();
    });
});

describe('scopes', () => {
    it('are exactly the three candidate scopes, with no offline_access', () => {
        expect([...MCP_SCOPES]).toEqual(['profile:read', 'applications:read', 'applications:write']);
        expect(isMcpScope('offline_access')).toBe(false);
        expect(isMcpScope('applications:read')).toBe(true);
        expect(isMcpScope('Applications:Read')).toBe(false);
    });

    it('consent wording follows the copy rule (no dash used as punctuation)', () => {
        expect(Object.keys(MCP_SCOPE_DESCRIPTIONS).sort()).toEqual([...MCP_SCOPES].sort());
        expect(dashFindings(MCP_SCOPE_DESCRIPTIONS)).toEqual([]);
    });
});
