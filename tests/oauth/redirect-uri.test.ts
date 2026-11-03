/**
 * Redirect URIs (lib/oauth/redirect-uri.ts, design 2.4): where a code may be
 * sent, what a registered client may list, and how the response is appended.
 * Also the PKCE and scope helpers the same checks rest on.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
    appendQuery,
    isAcceptableCimdRedirectUri,
    isAllowedDcrRedirectUri,
    redirectHostLabel,
    redirectUriMatches,
} from '@/lib/oauth/redirect-uri';
import { dcrRedirectHosts } from '@/lib/oauth/config';
import { isPkceValue, s256Challenge, verifyPkceS256 } from '@/lib/oauth/pkce';
import { parseScopeTokens } from '@/lib/oauth/scopes';
import { CHALLENGE, VERIFIER, useOAuthEnv } from './support/fixtures';

beforeEach(() => {
    useOAuthEnv();
});

describe('redirectUriMatches', () => {
    const registered = ['https://claude.ai/api/mcp/auth_callback', 'http://127.0.0.1/callback', 'http://localhost:8080/cb?app=1'];

    it('accepts an exact match', () => {
        expect(redirectUriMatches(registered, 'https://claude.ai/api/mcp/auth_callback')).toBe(true);
    });

    it('refuses a trailing slash, other case, an added query or another path on a non-loopback URI', () => {
        for (const uri of [
            'https://claude.ai/api/mcp/auth_callback/',
            'https://CLAUDE.ai/api/mcp/auth_callback',
            'https://claude.ai/api/mcp/auth_callback?x=1',
            'https://claude.ai/api/mcp/auth_callbacks',
            'https://claude.ai:443/api/mcp/auth_callback',
            'https://evil.example/api/mcp/auth_callback',
        ]) {
            expect(redirectUriMatches(registered, uri), uri).toBe(false);
        }
    });

    it('ignores the port of an http loopback URI (RFC 8252 section 7.3), with or without one registered', () => {
        expect(redirectUriMatches(registered, 'http://127.0.0.1:53210/callback')).toBe(true);
        expect(redirectUriMatches(registered, 'http://127.0.0.1/callback')).toBe(true);
        expect(redirectUriMatches(registered, 'http://localhost:9999/cb?app=1')).toBe(true);
    });

    it('still requires the loopback host, path and query to match', () => {
        for (const uri of [
            'http://localhost:53210/callback', // registered as 127.0.0.1
            'http://127.0.0.1:53210/other',
            'http://127.0.0.1:53210/callback?x=1',
            'http://localhost:9999/cb?app=2',
            'http://[::1]:5000/callback',
        ]) {
            expect(redirectUriMatches(registered, uri), uri).toBe(false);
        }
    });

    it('refuses an https loopback URI that is not registered exactly', () => {
        expect(redirectUriMatches(registered, 'https://127.0.0.1:53210/callback')).toBe(false);
        expect(redirectUriMatches(['https://localhost:4444/cb'], 'https://localhost:5555/cb')).toBe(false);
        expect(redirectUriMatches(['https://localhost:4444/cb'], 'https://localhost:4444/cb')).toBe(true);
    });

    it('refuses a fragment, even on a registered URI', () => {
        expect(redirectUriMatches(registered, 'https://claude.ai/api/mcp/auth_callback#x')).toBe(false);
        expect(redirectUriMatches(['https://claude.ai/cb#frag'], 'https://claude.ai/cb#frag')).toBe(false);
        expect(redirectUriMatches(registered, 'http://127.0.0.1:5000/callback#')).toBe(false);
    });

    it('refuses userinfo, backslashes, whitespace and control characters', () => {
        for (const uri of [
            'http://user@127.0.0.1:5000/callback',
            'http://127.0.0.1:5000\\callback',
            'http://127.0.0.1:5000/callback ',
            'http://127.0.0.1:5000/call\nback',
            'http://127.0.0.1:5000/call\tback',
        ]) {
            expect(redirectUriMatches([...registered, uri], uri), JSON.stringify(uri)).toBe(false);
        }
    });

    it('refuses an empty, unparseable or over-long URI', () => {
        expect(redirectUriMatches(registered, '')).toBe(false);
        expect(redirectUriMatches(['not a url'], 'not a url')).toBe(false);
        const long = `https://claude.ai/${'a'.repeat(2100)}`;
        expect(redirectUriMatches([long], long)).toBe(false);
    });
});

describe('isAllowedDcrRedirectUri (registration)', () => {
    it('allows https on claude.ai, claude.com and chatgpt.com, and http loopback on any port', () => {
        const hosts = dcrRedirectHosts();
        for (const uri of [
            'https://claude.ai/api/mcp/auth_callback',
            'https://claude.com/api/mcp/auth_callback',
            'https://chatgpt.com/connector_platform_oauth_redirect',
            'http://localhost/callback',
            'http://localhost:33418/callback',
            'http://127.0.0.1:6274/oauth/callback',
            'http://[::1]:8080/cb',
        ]) {
            expect(isAllowedDcrRedirectUri(uri, hosts), uri).toBe(true);
        }
    });

    it('refuses other hosts, http off loopback, ports on https hosts, fragments, userinfo and custom schemes', () => {
        const hosts = dcrRedirectHosts();
        for (const uri of [
            'https://evil.example/cb',
            'https://claude.ai.evil.example/cb',
            'https://sub.claude.ai/cb',
            'http://claude.ai/cb',
            'https://claude.ai:8443/cb',
            'https://claude.ai/cb#x',
            'https://user@claude.ai/cb',
            'https://localhost/cb',
            'cursor://anysphere.cursor-retrieval/oauth/callback',
            'javascript:alert(1)',
            'http://192.168.1.10/cb',
        ]) {
            expect(isAllowedDcrRedirectUri(uri, hosts), uri).toBe(false);
        }
    });

    it('refuses more than 512 characters', () => {
        const hosts = dcrRedirectHosts();
        const prefix = 'https://claude.ai/';
        expect(isAllowedDcrRedirectUri(prefix + 'a'.repeat(512 - prefix.length), hosts)).toBe(true);
        expect(isAllowedDcrRedirectUri(prefix + 'a'.repeat(513 - prefix.length), hosts)).toBe(false);
    });

    it('adds MCP_OAUTH_REDIRECT_HOSTS, ignoring entries that are not bare hostnames', () => {
        process.env.MCP_OAUTH_REDIRECT_HOSTS = ' Example.org , https://bad.example, *.wild.example';
        const hosts = dcrRedirectHosts();
        expect(hosts).toContain('example.org');
        expect(hosts).not.toContain('https://bad.example');
        expect(isAllowedDcrRedirectUri('https://example.org/cb', hosts)).toBe(true);
        expect(isAllowedDcrRedirectUri('https://bad.example/cb', hosts)).toBe(false);
    });
});

describe('isAcceptableCimdRedirectUri (metadata documents)', () => {
    it('accepts https on any host and http loopback; refuses everything else', () => {
        expect(isAcceptableCimdRedirectUri('https://claude.ai/api/mcp/auth_callback')).toBe(true);
        expect(isAcceptableCimdRedirectUri('https://claude.com/api/mcp/auth_callback')).toBe(true);
        expect(isAcceptableCimdRedirectUri('http://localhost:4000/cb')).toBe(true);
        for (const uri of ['http://claude.ai/cb', 'javascript:alert(1)', 'data:text/html,x', 'https://claude.ai/cb#x', 'ftp://claude.ai/cb']) {
            expect(isAcceptableCimdRedirectUri(uri), uri).toBe(false);
        }
    });
});

describe('redirectHostLabel and appendQuery', () => {
    it('names the redirect host, or "this computer" for loopback', () => {
        expect(redirectHostLabel('https://claude.ai/api/mcp/auth_callback')).toBe('claude.ai');
        expect(redirectHostLabel('http://127.0.0.1:5000/cb')).toBe('this computer');
        expect(redirectHostLabel('http://localhost/cb')).toBe('this computer');
        expect(redirectHostLabel('http://[::1]:1/cb')).toBe('this computer');
    });

    it('appends after an existing query byte for byte', () => {
        expect(appendQuery('https://a.example/cb', 'code=1')).toBe('https://a.example/cb?code=1');
        expect(appendQuery('https://a.example/cb?x=a%20b', 'code=1')).toBe('https://a.example/cb?x=a%20b&code=1');
        expect(appendQuery('https://a.example/cb?', 'code=1')).toBe('https://a.example/cb?code=1');
        expect(appendQuery('https://a.example/cb?x=1&', 'code=1')).toBe('https://a.example/cb?x=1&code=1');
    });
});

describe('PKCE (S256)', () => {
    it('accepts 43 to 128 unreserved characters only', () => {
        expect(isPkceValue('a'.repeat(43))).toBe(true);
        expect(isPkceValue('a'.repeat(128))).toBe(true);
        expect(isPkceValue('a'.repeat(42))).toBe(false);
        expect(isPkceValue('a'.repeat(129))).toBe(false);
        expect(isPkceValue(`${'a'.repeat(42)}+`)).toBe(false);
        expect(isPkceValue(`${'a'.repeat(42)}=`)).toBe(false);
        expect(isPkceValue(42)).toBe(false);
    });

    it('verifies the RFC 7636 appendix B example', () => {
        expect(s256Challenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    });

    it('matches only the verifier the challenge was made from', () => {
        expect(verifyPkceS256(VERIFIER, CHALLENGE)).toBe(true);
        expect(verifyPkceS256(`${VERIFIER.slice(0, -1)}x`, CHALLENGE)).toBe(false);
        // "plain": the challenge itself as the verifier
        expect(verifyPkceS256(CHALLENGE, CHALLENGE)).toBe(false);
        expect(verifyPkceS256('short', CHALLENGE)).toBe(false);
    });
});

describe('scope strings', () => {
    it('names known scopes in a fixed order, drops offline_access, and refuses an unknown one', () => {
        expect(parseScopeTokens(undefined)).toEqual([]);
        expect(parseScopeTokens('applications:write  profile:read profile:read')).toEqual(['profile:read', 'applications:write']);
        expect(parseScopeTokens('offline_access')).toEqual([]);
        expect(parseScopeTokens('profile:read admin')).toBeNull();
        expect(parseScopeTokens('profile:read\tapplications:read')).toBeNull();
    });
});
