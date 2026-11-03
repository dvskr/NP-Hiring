/**
 * Shared constants and request builders for the OAuth suites.
 */
import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';

/** At least 32 characters, like the production secret. */
export const SECRET = 'test-oauth-signing-secret-0123456789abcdef';
export const OTHER_SECRET = 'another-oauth-signing-secret-0123456789xyz';

export const ISSUER = 'https://nphiring.com';
export const CLAUDE_RESOURCE = 'https://nphiring.com/mcp';
export const CHATGPT_RESOURCE = 'https://nphiring.com/mcp/chatgpt';

export const CLAUDE_CLIENT_ID = 'https://claude.ai/oauth/mcp-oauth-client-metadata';
export const CLAUDE_REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

/** A DCR client id: "dcr_" and 32 base64url characters. */
export const DCR_CLIENT_ID = 'dcr_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export const VERIFIER = 'M25iVXpKU3puUjFaYWg3T1NDTDQtcW1ROUY5YXlwalNoc0hhakxifmZHag';
export const CHALLENGE = createHash('sha256').update(VERIFIER, 'ascii').digest('base64url');

/** Sets the environment every OAuth suite starts from: the canonical site, a signing secret, no extra hosts. */
export function useOAuthEnv(): void {
    process.env.MCP_OAUTH_SIGNING_SECRET = SECRET;
    delete process.env.MCP_BASE_URL;
    delete process.env.MCP_OAUTH_CIMD_HOSTS;
    delete process.env.MCP_OAUTH_REDIRECT_HOSTS;
}

export function formRequest(url: string, params: Record<string, string>, headers: Record<string, string> = {}): NextRequest {
    return new NextRequest(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
        body: new URLSearchParams(params).toString(),
    });
}

export function jsonRequest(url: string, body: unknown, headers: Record<string, string> = {}, method = 'POST'): NextRequest {
    return new NextRequest(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body),
    });
}

const EN_DASH = String.fromCharCode(0x2013);
const EM_DASH = String.fromCharCode(0x2014);

/** Every em dash, en dash or spaced hyphen in a piece of user-visible text. */
export function dashesIn(text: string): string[] {
    const found: string[] = [];
    for (const marker of [EN_DASH, EM_DASH, ' - ']) {
        if (text.includes(marker)) found.push(marker);
    }
    return found;
}
