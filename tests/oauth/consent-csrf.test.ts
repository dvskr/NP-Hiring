/**
 * The consent page's CSRF token (lib/oauth/consent-csrf.ts, design 2.6): it
 * verifies only for the user it was made for, within 10 minutes, for the
 * exact authorization parameters the page showed, under the current secret.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createConsentToken, verifyConsentToken } from '@/lib/oauth/consent-csrf';
import { AUTHORIZE_PARAM_KEYS, type AuthorizeParams } from '@/lib/oauth/authorize-params';
import { CHALLENGE, CLAUDE_CLIENT_ID, CLAUDE_REDIRECT, CLAUDE_RESOURCE, OTHER_SECRET, useOAuthEnv } from './support/fixtures';

const USER = 'user-1';
const PARAMS: AuthorizeParams = {
    response_type: 'code',
    client_id: CLAUDE_CLIENT_ID,
    redirect_uri: CLAUDE_REDIRECT,
    scope: 'profile:read applications:read',
    state: 'state-123',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    resource: CLAUDE_RESOURCE,
};
const NOW = Date.parse('2026-10-28T12:00:00Z');

beforeEach(() => {
    useOAuthEnv();
});

describe('consent token', () => {
    it('verifies for the same user and parameters', () => {
        const token = createConsentToken(USER, PARAMS, NOW);
        expect(token).toMatch(/^\d+\.[A-Za-z0-9_-]{43}$/);
        expect(verifyConsentToken(token, USER, { ...PARAMS }, NOW + 1000)).toBe(true);
    });

    it('refuses another user', () => {
        expect(verifyConsentToken(createConsentToken(USER, PARAMS, NOW), 'user-2', PARAMS, NOW)).toBe(false);
    });

    it('is valid for 10 minutes, and refuses a stale or far-future one', () => {
        const token = createConsentToken(USER, PARAMS, NOW);
        expect(verifyConsentToken(token, USER, PARAMS, NOW + 10 * 60 * 1000)).toBe(true);
        expect(verifyConsentToken(token, USER, PARAMS, NOW + 10 * 60 * 1000 + 1000)).toBe(false);
        expect(verifyConsentToken(token, USER, PARAMS, NOW - 30 * 1000)).toBe(true);
        expect(verifyConsentToken(token, USER, PARAMS, NOW - 2 * 60 * 1000)).toBe(false);
    });

    it('refuses any change to any parameter, an added one or a removed one', () => {
        const token = createConsentToken(USER, PARAMS, NOW);
        for (const key of AUTHORIZE_PARAM_KEYS) {
            expect(verifyConsentToken(token, USER, { ...PARAMS, [key]: `${PARAMS[key] ?? ''}x` }, NOW), `changed ${key}`).toBe(false);
            const without: AuthorizeParams = { ...PARAMS };
            delete without[key];
            expect(verifyConsentToken(token, USER, without, NOW), `removed ${key}`).toBe(false);
        }
        const noState: AuthorizeParams = { ...PARAMS };
        delete noState.state;
        const tokenWithoutState = createConsentToken(USER, noState, NOW);
        expect(verifyConsentToken(tokenWithoutState, USER, { ...noState, state: 'added' }, NOW)).toBe(false);
    });

    it('a value cannot slide into its neighbour (no delimiter ambiguity)', () => {
        const token = createConsentToken(USER, { ...PARAMS, scope: 'profile:read', state: 'a' }, NOW);
        expect(verifyConsentToken(token, USER, { ...PARAMS, scope: 'profile:read a', state: undefined }, NOW)).toBe(false);
    });

    it('refuses a tampered MAC or time, and anything malformed', () => {
        const token = createConsentToken(USER, PARAMS, NOW);
        const [issuedAt, mac] = token.split('.');
        const flipped = `${issuedAt}.${mac[0] === 'A' ? 'B' : 'A'}${mac.slice(1)}`;
        expect(verifyConsentToken(flipped, USER, PARAMS, NOW)).toBe(false);
        expect(verifyConsentToken(`${Number(issuedAt) + 1}.${mac}`, USER, PARAMS, NOW)).toBe(false);
        for (const bad of [undefined, null, 42, '', 'abc', `${issuedAt}.`, `.${mac}`, `${issuedAt}.${mac}.x`, `-1.${mac}`]) {
            expect(verifyConsentToken(bad, USER, PARAMS, NOW), String(bad)).toBe(false);
        }
    });

    it('stops verifying when the secret changes or goes away', () => {
        const token = createConsentToken(USER, PARAMS, NOW);
        process.env.MCP_OAUTH_SIGNING_SECRET = OTHER_SECRET;
        expect(verifyConsentToken(token, USER, PARAMS, NOW)).toBe(false);
        delete process.env.MCP_OAUTH_SIGNING_SECRET;
        expect(verifyConsentToken(token, USER, PARAMS, NOW)).toBe(false);
        expect(() => createConsentToken(USER, PARAMS, NOW)).toThrow();
    });
});
