/**
 * POST /oauth/revoke (RFC 7009, design 2.8): a refresh token (any state) or
 * an unexpired access token this server signed revokes its grant
 * (client_revoke) and the grant's refresh tokens; an unknown or forged token
 * changes nothing; every well-formed request answers an empty 200. Form or
 * JSON, CORS for any origin, the IP rate limit, 503 without a secret.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SignJWT } from 'jose';

const h = vi.hoisted(() => ({
    checkRateLimit: vi.fn(),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/prisma', async () => ({ prisma: (await import('./support/fake-prisma')).fakePrisma }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: h.checkRateLimit }));
vi.mock('@/lib/logger', () => ({ logger: h.logger }));

import { POST, OPTIONS, dynamic } from '@/app/oauth/revoke/route';
import { MCP_SCOPES } from '@/lib/mcp/config';
import { signAccessToken, verifyAccessToken } from '@/lib/oauth/access-token';
import { issueRefreshToken } from '@/lib/oauth/refresh-tokens';
import { addGrant, addProfile, db, resetDb } from './support/fake-prisma';
import { CHATGPT_RESOURCE, CLAUDE_CLIENT_ID, CLAUDE_RESOURCE, ISSUER, OTHER_SECRET, formRequest, jsonRequest, useOAuthEnv } from './support/fixtures';

const REVOKE_URL = 'https://nphiring.com/oauth/revoke';
const USER = 'user-1';
let grantId = '';

async function revoke(params: Record<string, string>, asJson = false): Promise<{ status: number; body: string; headers: Headers }> {
    const request = asJson ? jsonRequest(REVOKE_URL, params, { 'x-forwarded-for': '203.0.113.9' }) : formRequest(REVOKE_URL, params, { 'x-forwarded-for': '203.0.113.9' });
    const res = await POST(request);
    return { status: res.status, body: await res.text(), headers: res.headers };
}

function accessToken(resource = CLAUDE_RESOURCE, now = Date.now()): Promise<string> {
    return signAccessToken({ userId: USER, clientId: CLAUDE_CLIENT_ID, grantId, scopes: [...MCP_SCOPES], resource }, now);
}

function expectRevoked(): void {
    expect(db.grants[0].revokedAt).toBeInstanceOf(Date);
    expect(db.grants[0].revokedReason).toBe('client_revoke');
    expect(db.refreshTokens).toHaveLength(0);
}

function expectUntouched(refreshTokens = 1): void {
    expect(db.grants[0].revokedAt).toBeNull();
    expect(db.refreshTokens).toHaveLength(refreshTokens);
}

beforeEach(() => {
    useOAuthEnv();
    resetDb();
    addProfile(USER);
    grantId = addGrant({ userId: USER }).id as string;
    h.checkRateLimit.mockReset().mockResolvedValue({ success: true, reset: Date.now() + 60_000, remaining: 119 });
});

describe('revoking', () => {
    it('a refresh token revokes its grant and every refresh token under it: empty 200', async () => {
        const token = await issueRefreshToken(grantId);
        await issueRefreshToken(grantId);
        const access = await accessToken();
        const { status, body, headers } = await revoke({ token, token_type_hint: 'refresh_token' });
        expect(status).toBe(200);
        expect(body).toBe('');
        expect(headers.get('access-control-allow-origin')).toBe('*');
        expect(headers.get('cache-control')).toBe('no-store');
        expectRevoked();
        expect(await verifyAccessToken(access, CLAUDE_RESOURCE)).toEqual({ ok: false, reason: 'revoked' });
    });

    it('a rotated (consumed) refresh token still revokes', async () => {
        const token = await issueRefreshToken(grantId);
        db.refreshTokens[0].consumedAt = new Date();
        await revoke({ token });
        expect(db.grants[0].revokedReason).toBe('client_revoke');
    });

    it('an access token for either endpoint revokes its grant, whatever the hint says', async () => {
        await issueRefreshToken(grantId);
        await revoke({ token: await accessToken(CHATGPT_RESOURCE), token_type_hint: 'refresh_token' });
        expectRevoked();
    });

    it('accepts a JSON body', async () => {
        await issueRefreshToken(grantId);
        expect((await revoke({ token: await accessToken() }, true)).status).toBe(200);
        expectRevoked();
    });

    it('keeps the first reason when the grant was already revoked', async () => {
        const token = await issueRefreshToken(grantId);
        db.grants[0].revokedAt = new Date(0);
        db.grants[0].revokedReason = 'user_revoke';
        await revoke({ token });
        expect(db.grants[0].revokedReason).toBe('user_revoke');
        expect(db.refreshTokens).toHaveLength(0);
    });
});

describe('tokens that change nothing (still an empty 200)', () => {
    it('an unknown refresh token', async () => {
        await issueRefreshToken(grantId);
        const { status, body } = await revoke({ token: 'B'.repeat(43) });
        expect(status).toBe(200);
        expect(body).toBe('');
        expectUntouched();
    });

    it('an access token signed with another secret, for another audience, by another issuer, or expired', async () => {
        await issueRefreshToken(grantId);
        const now = Math.floor(Date.now() / 1000);
        const forged = await new SignJWT({ client_id: CLAUDE_CLIENT_ID, scope: 'profile:read', gid: grantId })
            .setProtectedHeader({ alg: 'HS256', typ: 'at+jwt' })
            .setIssuer(ISSUER).setSubject(USER).setAudience(CLAUDE_RESOURCE).setJti('j').setIssuedAt(now).setExpirationTime(now + 600)
            .sign(new TextEncoder().encode(OTHER_SECRET));
        const otherIssuer = await new SignJWT({ client_id: CLAUDE_CLIENT_ID, scope: 'profile:read', gid: grantId })
            .setProtectedHeader({ alg: 'HS256', typ: 'at+jwt' })
            .setIssuer('https://evil.example').setSubject(USER).setAudience(CLAUDE_RESOURCE).setJti('j').setIssuedAt(now).setExpirationTime(now + 600)
            .sign(new TextEncoder().encode(process.env.MCP_OAUTH_SIGNING_SECRET ?? ''));
        const otherAudience = await new SignJWT({ client_id: CLAUDE_CLIENT_ID, scope: 'profile:read', gid: grantId })
            .setProtectedHeader({ alg: 'HS256', typ: 'at+jwt' })
            .setIssuer(ISSUER).setSubject(USER).setAudience('https://other.example/mcp').setJti('j').setIssuedAt(now).setExpirationTime(now + 600)
            .sign(new TextEncoder().encode(process.env.MCP_OAUTH_SIGNING_SECRET ?? ''));
        const expired = await accessToken(CLAUDE_RESOURCE, Date.now() - 2 * 3600 * 1000);
        for (const token of [forged, otherIssuer, otherAudience, expired, 'a.b.c']) {
            const { status } = await revoke({ token });
            expect(status).toBe(200);
            expectUntouched();
        }
    });
});

describe('malformed requests, limits and availability', () => {
    it('no token, or one over 4 KB: 400 invalid_request', async () => {
        const malformed: Array<Record<string, string>> = [{}, { token: '' }, { token_type_hint: 'access_token' }, { token: 'x'.repeat(4097) }];
        for (const params of malformed) {
            const { status, body } = await revoke(params);
            expect(status, JSON.stringify(params).slice(0, 40)).toBe(400);
            expect(JSON.parse(body).error).toBe('invalid_request');
        }
    });

    it('counts per IP, 120 a minute, and answers 429 slow_down past it', async () => {
        const token = await issueRefreshToken(grantId);
        await revoke({ token: 'B'.repeat(43) });
        expect(h.checkRateLimit).toHaveBeenCalledWith('oauth:revoke:ip:203.0.113.9', { limit: 120, windowSeconds: 60 });

        h.checkRateLimit.mockResolvedValue({ success: false, reset: Date.now() + 5_000, remaining: 0 });
        const { status, body, headers } = await revoke({ token });
        expect(status).toBe(429);
        expect(JSON.parse(body)).toEqual({ error: 'slow_down' });
        expect(headers.get('retry-after')).toBeTruthy();
        expectUntouched();
    });

    it('answers 503 without a signing secret', async () => {
        const token = await issueRefreshToken(grantId);
        delete process.env.MCP_OAUTH_SIGNING_SECRET;
        expect((await revoke({ token })).status).toBe(503);
        expectUntouched();
    });

    it('answers a CORS preflight and renders per request', () => {
        expect(OPTIONS().status).toBe(204);
        expect(OPTIONS().headers.get('access-control-allow-origin')).toBe('*');
        expect(dynamic).toBe('force-dynamic');
    });
});
