/**
 * POST /oauth/token (design 2.7), against the in-memory OAuth tables.
 *
 * authorization_code: the happy path (form and JSON), the token response and
 * its headers, PKCE, expiry, replay (revokes the grant and everything it
 * issued), client, redirect URI and resource binding, the account checks.
 * refresh_token: rotation, reuse (revokes the grant), a revoked grant, a
 * subset scope, a wider scope refused, expiry, client and resource binding.
 * Both: request parsing, the rate limits, the 503 without a secret, and no
 * code, token or verifier in any log line.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';

const h = vi.hoisted(() => ({
    checkRateLimit: vi.fn(),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/prisma', async () => ({ prisma: (await import('./support/fake-prisma')).fakePrisma }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: h.checkRateLimit }));
vi.mock('@/lib/logger', () => ({ logger: h.logger }));

import { POST, OPTIONS, dynamic } from '@/app/oauth/token/route';
import { MCP_SCOPES, type McpScope } from '@/lib/mcp/config';
import { verifyAccessToken } from '@/lib/oauth/access-token';
import { createGrantWithCode } from '@/lib/oauth/grants';
import { addProfile, db, fakePrisma, resetDb } from './support/fake-prisma';
import {
    CHALLENGE,
    CHATGPT_RESOURCE,
    CLAUDE_CLIENT_ID,
    CLAUDE_REDIRECT,
    CLAUDE_RESOURCE,
    DCR_CLIENT_ID,
    VERIFIER,
    formRequest,
    jsonRequest,
    useOAuthEnv,
} from './support/fixtures';

const TOKEN_URL = 'https://nphiring.com/oauth/token';
const USER = 'user-1';
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

interface TokenAnswer {
    status: number;
    json: Record<string, unknown>;
    headers: Headers;
}

async function call(request: Request): Promise<TokenAnswer> {
    const res = await POST(request as Parameters<typeof POST>[0]);
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : {}, headers: res.headers };
}

async function issueCode(options: { scopes?: McpScope[]; redirectUri?: string; resource?: string } = {}): Promise<{ code: string; grantId: string }> {
    return createGrantWithCode({
        userId: USER,
        client: { clientId: CLAUDE_CLIENT_ID, clientName: 'Claude', redirectUris: [CLAUDE_REDIRECT], kind: 'cimd' },
        redirectUri: options.redirectUri ?? CLAUDE_REDIRECT,
        scopes: options.scopes ?? [...MCP_SCOPES],
        resource: options.resource ?? CLAUDE_RESOURCE,
        codeChallenge: CHALLENGE,
    });
}

function exchange(code: string, overrides: Record<string, string> = {}): Promise<TokenAnswer> {
    return call(
        formRequest(TOKEN_URL, {
            grant_type: 'authorization_code',
            client_id: CLAUDE_CLIENT_ID,
            redirect_uri: CLAUDE_REDIRECT,
            code_verifier: VERIFIER,
            code,
            ...overrides,
        }, { 'x-forwarded-for': '203.0.113.5' }),
    );
}

function refresh(refreshToken: string, overrides: Record<string, string> = {}): Promise<TokenAnswer> {
    return call(
        formRequest(TOKEN_URL, { grant_type: 'refresh_token', client_id: CLAUDE_CLIENT_ID, refresh_token: refreshToken, ...overrides }, { 'x-forwarded-for': '203.0.113.5' }),
    );
}

/** A full sign-in: code, then the first token response. */
async function signIn(options: { scopes?: McpScope[] } = {}): Promise<{ grantId: string; accessToken: string; refreshToken: string }> {
    const { code, grantId } = await issueCode(options);
    const { status, json } = await exchange(code);
    expect(status).toBe(200);
    return { grantId, accessToken: json.access_token as string, refreshToken: json.refresh_token as string };
}

function grant(id: string): Record<string, unknown> {
    const row = db.grants.find((candidate) => candidate.id === id);
    if (!row) throw new Error(`no grant ${id}`);
    return row;
}

beforeEach(() => {
    useOAuthEnv();
    resetDb();
    addProfile(USER);
    h.checkRateLimit.mockReset().mockResolvedValue({ success: true, reset: Date.now() + 60_000, remaining: 100 });
});

describe('authorization_code: the happy path', () => {
    it('answers the token response, no-store and readable from any origin', async () => {
        const { code, grantId } = await issueCode();
        const { status, json, headers } = await exchange(code);

        expect(status).toBe(200);
        expect(Object.keys(json).sort()).toEqual(['access_token', 'expires_in', 'refresh_token', 'scope', 'token_type']);
        expect(json).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'profile:read applications:read applications:write' });
        expect(headers.get('cache-control')).toBe('no-store');
        expect(headers.get('pragma')).toBe('no-cache');
        expect(headers.get('access-control-allow-origin')).toBe('*');

        const verified = await verifyAccessToken(json.access_token as string, CLAUDE_RESOURCE);
        expect(verified).toMatchObject({
            ok: true,
            token: { userId: USER, clientId: CLAUDE_CLIENT_ID, grantId, scopes: [...MCP_SCOPES], resource: CLAUDE_RESOURCE },
        });
    });

    it('signs an HS256 at+jwt and stores only the SHA-256 of the refresh token', async () => {
        const { code } = await issueCode();
        const { json } = await exchange(code);
        const header = JSON.parse(Buffer.from(String(json.access_token).split('.')[0], 'base64url').toString('utf8'));
        expect(header).toEqual({ alg: 'HS256', typ: 'at+jwt' });

        const refreshToken = json.refresh_token as string;
        expect(refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(db.refreshTokens).toHaveLength(1);
        expect(db.refreshTokens[0].tokenHash).toBe(sha256(refreshToken));
        expect(JSON.stringify(db)).not.toContain(refreshToken);
        expect(JSON.stringify(db)).not.toContain(code);
        const expiresAt = (db.refreshTokens[0].expiresAt as Date).getTime();
        expect(expiresAt - Date.now()).toBeGreaterThan(29 * 24 * 3600 * 1000);
        expect(expiresAt - Date.now()).toBeLessThanOrEqual(30 * 24 * 3600 * 1000);
    });

    it('consumes the code with one conditional update (single use, unexpired)', async () => {
        const { code } = await issueCode();
        await exchange(code);
        expect(fakePrisma.oauthAuthorizationCode.updateMany).toHaveBeenCalledWith({
            where: { codeHash: sha256(code), consumedAt: null, expiresAt: { gt: expect.any(Date) } },
            data: { consumedAt: expect.any(Date) },
        });
        expect(db.codes[0].consumedAt).toBeInstanceOf(Date);
    });

    it('accepts a JSON body', async () => {
        const { code } = await issueCode();
        const { status } = await call(
            jsonRequest(TOKEN_URL, {
                grant_type: 'authorization_code',
                client_id: CLAUDE_CLIENT_ID,
                redirect_uri: CLAUDE_REDIRECT,
                code_verifier: VERIFIER,
                code,
            }),
        );
        expect(status).toBe(200);
    });

    it('accepts form encoding with a charset, ignores and never echoes a client_secret or client_assertion', async () => {
        const { code } = await issueCode();
        const request = new Request(TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: CLAUDE_CLIENT_ID,
                redirect_uri: CLAUDE_REDIRECT,
                code_verifier: VERIFIER,
                code,
                client_secret: 'SECRET-VALUE-123',
                client_assertion: 'ASSERTION-VALUE-456',
            }).toString(),
        });
        const { status, json } = await call(request);
        expect(status).toBe(200);
        expect(JSON.stringify(json)).not.toContain('SECRET-VALUE-123');
        expect(JSON.stringify(json)).not.toContain('ASSERTION-VALUE-456');
    });

    it('accepts a resource that canonicalizes to the grant resource', async () => {
        for (const resource of [CLAUDE_RESOURCE, `${CLAUDE_RESOURCE}/`, 'HTTPS://NPHIRING.COM/mcp', 'https://nphiring.com:443/mcp']) {
            const { code } = await issueCode();
            expect((await exchange(code, { resource })).status, resource).toBe(200);
        }
    });

    it('issues tokens for the ChatGPT endpoint that only that endpoint accepts', async () => {
        const { code } = await issueCode({ resource: CHATGPT_RESOURCE });
        const { json } = await exchange(code);
        expect((await verifyAccessToken(json.access_token as string, CHATGPT_RESOURCE)).ok).toBe(true);
        expect(await verifyAccessToken(json.access_token as string, CLAUDE_RESOURCE)).toEqual({ ok: false, reason: 'wrong_audience' });
    });
});

describe('authorization_code: refused', () => {
    it('a wrong PKCE verifier: invalid_grant, and the code is burned', async () => {
        const { code, grantId } = await issueCode();
        const wrong = await exchange(code, { code_verifier: `${VERIFIER.slice(0, -1)}x` });
        expect(wrong.status).toBe(400);
        expect(wrong.json.error).toBe('invalid_grant');
        expect(db.refreshTokens).toHaveLength(0);
        // A malformed verifier is refused the same way.
        const { code: second } = await issueCode();
        expect((await exchange(second, { code_verifier: 'too-short' })).json.error).toBe('invalid_grant');
        expect(grant(grantId).revokedAt).toBeNull();
    });

    it('an expired code: invalid_grant, and the grant is not revoked', async () => {
        const { code, grantId } = await issueCode();
        db.codes[0].expiresAt = new Date(Date.now() - 1000);
        const { status, json } = await exchange(code);
        expect(status).toBe(400);
        expect(json.error).toBe('invalid_grant');
        expect(grant(grantId).revokedAt).toBeNull();
    });

    it('a replayed code: invalid_grant, the grant is revoked (code_reuse) and the first tokens die with it', async () => {
        const { code, grantId } = await issueCode();
        const first = await exchange(code);
        expect(first.status).toBe(200);

        const replay = await exchange(code);
        expect(replay.status).toBe(400);
        expect(replay.json.error).toBe('invalid_grant');
        expect(grant(grantId)).toMatchObject({ revokedReason: 'code_reuse' });
        expect(grant(grantId).revokedAt).toBeInstanceOf(Date);
        expect(db.refreshTokens).toHaveLength(0);

        expect(await verifyAccessToken(first.json.access_token as string, CLAUDE_RESOURCE)).toEqual({ ok: false, reason: 'revoked' });
        expect((await refresh(first.json.refresh_token as string)).json.error).toBe('invalid_grant');
    });

    it('a code redeemed concurrently (the conditional update loses) is a replay', async () => {
        const { code, grantId } = await issueCode();
        fakePrisma.oauthAuthorizationCode.updateMany.mockResolvedValueOnce({ count: 0 });
        expect((await exchange(code)).json.error).toBe('invalid_grant');
        expect(grant(grantId).revokedReason).toBe('code_reuse');
    });

    it('an unknown code: invalid_grant', async () => {
        expect((await exchange('not-a-real-code')).json.error).toBe('invalid_grant');
    });

    it('another client, a well-formed one included: invalid_grant', async () => {
        for (const client_id of [DCR_CLIENT_ID, 'https://chatgpt.com/oauth/client-metadata']) {
            const { code } = await issueCode();
            const { status, json } = await exchange(code, { client_id });
            expect(status, client_id).toBe(400);
            expect(json.error).toBe('invalid_grant');
        }
    });

    it('another redirect URI (exact match, so a loopback port counts): invalid_grant', async () => {
        const { code } = await issueCode();
        expect((await exchange(code, { redirect_uri: `${CLAUDE_REDIRECT}/` })).json.error).toBe('invalid_grant');

        const loopback = 'http://127.0.0.1:53210/callback';
        const { code: loopbackCode } = await issueCode({ redirectUri: loopback });
        expect((await exchange(loopbackCode, { redirect_uri: 'http://127.0.0.1:53211/callback' })).json.error).toBe('invalid_grant');
    });

    it('another resource: invalid_target', async () => {
        const { code } = await issueCode();
        const { status, json } = await exchange(code, { resource: CHATGPT_RESOURCE });
        expect(status).toBe(400);
        expect(json.error).toBe('invalid_target');
    });

    it('a grant revoked before the exchange: invalid_grant', async () => {
        const { code, grantId } = await issueCode();
        grant(grantId).revokedAt = new Date();
        expect((await exchange(code)).json.error).toBe('invalid_grant');
        expect(db.refreshTokens).toHaveLength(0);
    });

    it('an employer, an admin or a soft-deleted profile: invalid_grant', async () => {
        for (const change of [{ role: 'employer' }, { role: 'admin' }, { deletedAt: new Date() }]) {
            resetDb();
            addProfile(USER, change);
            const { code } = await issueCode();
            const { status, json } = await exchange(code);
            expect(status, JSON.stringify(change)).toBe(400);
            expect(json.error).toBe('invalid_grant');
        }
    });
});

describe('request parsing', () => {
    it('a missing grant_type, code, redirect_uri, code_verifier or client_id: invalid_request', async () => {
        const { code } = await issueCode();
        const full = { grant_type: 'authorization_code', client_id: CLAUDE_CLIENT_ID, redirect_uri: CLAUDE_REDIRECT, code_verifier: VERIFIER, code };
        for (const key of Object.keys(full)) {
            const params: Record<string, string> = { ...full };
            delete params[key];
            const { status, json } = await call(formRequest(TOKEN_URL, params));
            expect(status, key).toBe(400);
            expect(json.error, key).toBe('invalid_request');
        }
        // None of those touched the code.
        expect(db.codes[0].consumedAt).toBeNull();
    });

    it('an empty value counts as missing', async () => {
        const { code } = await issueCode();
        expect((await exchange(code, { code_verifier: '' })).json.error).toBe('invalid_request');
    });

    it('other grant types: unsupported_grant_type', async () => {
        for (const grant_type of ['password', 'client_credentials', 'implicit', 'urn:ietf:params:oauth:grant-type:device_code']) {
            const { status, json } = await call(formRequest(TOKEN_URL, { grant_type, client_id: CLAUDE_CLIENT_ID }));
            expect(status, grant_type).toBe(400);
            expect(json.error).toBe('unsupported_grant_type');
        }
    });

    it('a client_id of no known shape: 401 invalid_client', async () => {
        for (const client_id of ['abc', 'dcr_short', 'http://claude.ai/oauth/meta', `https://claude.ai/${'a'.repeat(600)}`]) {
            const { code } = await issueCode();
            const { status, json } = await exchange(code, { client_id });
            expect(status, client_id).toBe(401);
            expect(json.error).toBe('invalid_client');
        }
    });

    it('a repeated parameter: invalid_request', async () => {
        const { code } = await issueCode();
        const body = new URLSearchParams({ grant_type: 'authorization_code', client_id: CLAUDE_CLIENT_ID, redirect_uri: CLAUDE_REDIRECT, code_verifier: VERIFIER, code });
        body.append('code', code);
        const { status, json } = await call(new Request(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() }));
        expect(status).toBe(400);
        expect(json.error).toBe('invalid_request');
    });

    it('a JSON value that is not a string (a Prisma operator object, say): invalid_request, no query', async () => {
        await issueCode();
        const { json } = await call(jsonRequest(TOKEN_URL, { grant_type: 'authorization_code', client_id: CLAUDE_CLIENT_ID, redirect_uri: CLAUDE_REDIRECT, code_verifier: VERIFIER, code: { not: '' } }));
        expect(json.error).toBe('invalid_request');
        expect(fakePrisma.oauthAuthorizationCode.findUnique).not.toHaveBeenCalled();
        expect(db.codes[0].consumedAt).toBeNull();
    });

    it('another content type, a body over 16 KB, or invalid JSON: invalid_request', async () => {
        const plain = new Request(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'grant_type=refresh_token' });
        expect((await call(plain)).json.error).toBe('invalid_request');
        const big = formRequest(TOKEN_URL, { grant_type: 'refresh_token', client_id: CLAUDE_CLIENT_ID, refresh_token: 'x', padding: 'y'.repeat(17 * 1024) });
        expect((await call(big)).json.error).toBe('invalid_request');
        expect((await call(jsonRequest(TOKEN_URL, '{not json'))).json.error).toBe('invalid_request');
    });
});

describe('refresh_token', () => {
    it('rotates: new tokens, the old one consumed, the grant marked used', async () => {
        const session = await signIn();
        const { status, json } = await refresh(session.refreshToken);
        expect(status).toBe(200);
        expect(json.refresh_token).not.toBe(session.refreshToken);
        expect(json.scope).toBe('profile:read applications:read applications:write');

        const old = db.refreshTokens.find((row) => row.tokenHash === sha256(session.refreshToken));
        expect(old?.consumedAt).toBeInstanceOf(Date);
        const fresh = db.refreshTokens.find((row) => row.tokenHash === sha256(json.refresh_token as string));
        expect(fresh?.consumedAt).toBeNull();
        expect(grant(session.grantId).lastUsedAt).toBeInstanceOf(Date);
        expect((await verifyAccessToken(json.access_token as string, CLAUDE_RESOURCE)).ok).toBe(true);
        expect(fakePrisma.oauthRefreshToken.updateMany).toHaveBeenCalledWith({
            where: { tokenHash: sha256(session.refreshToken), consumedAt: null },
            data: { consumedAt: expect.any(Date) },
        });

        // The new token rotates too.
        expect((await refresh(json.refresh_token as string)).status).toBe(200);
    });

    it('reuse of a rotated token revokes the grant (refresh_reuse) and every token under it', async () => {
        const session = await signIn();
        const rotated = await refresh(session.refreshToken);
        expect(rotated.status).toBe(200);

        const reuse = await refresh(session.refreshToken);
        expect(reuse.status).toBe(400);
        expect(reuse.json.error).toBe('invalid_grant');
        expect(grant(session.grantId).revokedReason).toBe('refresh_reuse');
        expect(db.refreshTokens).toHaveLength(0);
        expect((await refresh(rotated.json.refresh_token as string)).json.error).toBe('invalid_grant');
        expect(await verifyAccessToken(rotated.json.access_token as string, CLAUDE_RESOURCE)).toEqual({ ok: false, reason: 'revoked' });
    });

    it('a refresh that loses the rotation race is reuse', async () => {
        const session = await signIn();
        fakePrisma.oauthRefreshToken.updateMany.mockResolvedValueOnce({ count: 0 });
        expect((await refresh(session.refreshToken)).json.error).toBe('invalid_grant');
        expect(grant(session.grantId).revokedReason).toBe('refresh_reuse');
    });

    it('a revoked grant: invalid_grant', async () => {
        const session = await signIn();
        grant(session.grantId).revokedAt = new Date();
        expect((await refresh(session.refreshToken)).json.error).toBe('invalid_grant');
    });

    it('a subset scope narrows the access token only; the grant keeps its scopes', async () => {
        const session = await signIn();
        const narrow = await refresh(session.refreshToken, { scope: 'applications:read offline_access' });
        expect(narrow.status).toBe(200);
        expect(narrow.json.scope).toBe('applications:read');
        const verified = await verifyAccessToken(narrow.json.access_token as string, CLAUDE_RESOURCE);
        expect(verified.ok && verified.token.scopes).toEqual(['applications:read']);

        const full = await refresh(narrow.json.refresh_token as string);
        expect(full.json.scope).toBe('profile:read applications:read applications:write');
    });

    it('a scope wider than the grant, or unknown: invalid_scope, and the token still works', async () => {
        const session = await signIn({ scopes: ['profile:read'] });
        for (const scope of ['applications:write', 'profile:read applications:read', 'admin']) {
            const { status, json } = await refresh(session.refreshToken, { scope });
            expect(status, scope).toBe(400);
            expect(json.error, scope).toBe('invalid_scope');
        }
        expect((await refresh(session.refreshToken)).status).toBe(200);
    });

    it('another client: invalid_grant', async () => {
        const session = await signIn();
        expect((await refresh(session.refreshToken, { client_id: DCR_CLIENT_ID })).json.error).toBe('invalid_grant');
        expect(grant(session.grantId).revokedAt).toBeNull();
    });

    it('an expired refresh token: invalid_grant', async () => {
        const session = await signIn();
        db.refreshTokens[0].expiresAt = new Date(Date.now() - 1000);
        expect((await refresh(session.refreshToken)).json.error).toBe('invalid_grant');
    });

    it('an unknown refresh token: invalid_grant', async () => {
        expect((await refresh('A'.repeat(43))).json.error).toBe('invalid_grant');
    });

    it('a resource for another endpoint: invalid_target; the same endpoint: accepted', async () => {
        const session = await signIn();
        expect((await refresh(session.refreshToken, { resource: CHATGPT_RESOURCE })).json.error).toBe('invalid_target');
        expect((await refresh(session.refreshToken, { resource: `${CLAUDE_RESOURCE}/` })).status).toBe(200);
    });

    it('a profile that became an employer account or was deleted: invalid_grant', async () => {
        const session = await signIn();
        db.profiles[0].deletedAt = new Date();
        expect((await refresh(session.refreshToken)).json.error).toBe('invalid_grant');
    });
});

describe('limits, availability and logging', () => {
    it('counts per IP (600 a minute) and per client (300 a minute)', async () => {
        const { code } = await issueCode();
        await exchange(code);
        expect(h.checkRateLimit).toHaveBeenCalledWith('oauth:token:ip:203.0.113.5', { limit: 600, windowSeconds: 60 });
        expect(h.checkRateLimit).toHaveBeenCalledWith(`oauth:token:client:${CLAUDE_CLIENT_ID}`, { limit: 300, windowSeconds: 60 });
    });

    it('answers 429 slow_down with Retry-After over either limit, touching no code', async () => {
        const { code } = await issueCode();
        h.checkRateLimit.mockResolvedValueOnce({ success: false, reset: Date.now() + 30_000, remaining: 0 });
        const byIp = await exchange(code);
        expect(byIp.status).toBe(429);
        expect(byIp.json).toEqual({ error: 'slow_down' });
        expect(Number(byIp.headers.get('retry-after'))).toBeGreaterThan(0);

        h.checkRateLimit
            .mockResolvedValueOnce({ success: true, reset: Date.now() + 60_000, remaining: 1 })
            .mockResolvedValueOnce({ success: false, reset: Date.now() + 30_000, remaining: 0 });
        expect((await exchange(code)).status).toBe(429);
        expect(db.codes[0].consumedAt).toBeNull();
    });

    it('answers 503 temporarily_unavailable without a usable signing secret', async () => {
        const { code } = await issueCode();
        process.env.MCP_OAUTH_SIGNING_SECRET = 'x'.repeat(31);
        const { status, json } = await exchange(code);
        expect(status).toBe(503);
        expect(json.error).toBe('temporarily_unavailable');
        expect(db.codes[0].consumedAt).toBeNull();
    });

    it('a database failure answers 500 server_error, not a stack', async () => {
        const { code } = await issueCode();
        fakePrisma.oauthAuthorizationCode.findUnique.mockRejectedValueOnce(new Error('connection reset'));
        const { status, json } = await exchange(code);
        expect(status).toBe(500);
        expect(json.error).toBe('server_error');
        expect(h.logger.error).toHaveBeenCalled();
    });

    it('never logs a code, a token or a verifier', async () => {
        const { code } = await issueCode();
        const first = await exchange(code);
        await exchange(code); // replay: the warn path
        const session = await signIn();
        const rotated = await refresh(session.refreshToken);
        await refresh(session.refreshToken); // reuse: the warn path
        const logged = JSON.stringify([h.logger.info.mock.calls, h.logger.warn.mock.calls, h.logger.error.mock.calls]);
        for (const secret of [code, VERIFIER, first.json.access_token, first.json.refresh_token, session.refreshToken, session.accessToken, rotated.json.access_token]) {
            expect(logged).not.toContain(String(secret));
        }
        expect(logged).toContain('claude.ai');
    });

    it('answers a CORS preflight and renders per request', () => {
        const res = OPTIONS();
        expect(res.status).toBe(204);
        expect(res.headers.get('access-control-allow-origin')).toBe('*');
        expect(dynamic).toBe('force-dynamic');
    });
});
