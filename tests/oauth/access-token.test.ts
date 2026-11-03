/**
 * verifyAccessToken (lib/oauth/access-token.ts, design 2.9): what the MCP
 * routes trust. Every failure reason, the attacks a JWT verifier must refuse
 * (alg none, another algorithm, another type, issuer or audience, an expired
 * token), the grant and account checks, the throttled lastUsedAt write, and
 * that a bad token never throws and is never logged.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SignJWT } from 'jose';

const h = vi.hoisted(() => ({
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/prisma', async () => ({ prisma: (await import('./support/fake-prisma')).fakePrisma }));
vi.mock('@/lib/logger', () => ({ logger: h.logger }));

import { MCP_SCOPES } from '@/lib/mcp/config';
import { signAccessToken, verifyAccessToken, type AccessTokenInput } from '@/lib/oauth/access-token';
import { addGrant, addProfile, db, fakePrisma, resetDb } from './support/fake-prisma';
import { CHATGPT_RESOURCE, CLAUDE_CLIENT_ID, CLAUDE_RESOURCE, ISSUER, OTHER_SECRET, SECRET, useOAuthEnv } from './support/fixtures';

const USER = 'user-1';
let grantId = '';

function input(overrides: Partial<AccessTokenInput> = {}): AccessTokenInput {
    return { userId: USER, clientId: CLAUDE_CLIENT_ID, grantId, scopes: [...MCP_SCOPES], resource: CLAUDE_RESOURCE, ...overrides };
}

const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');
const key = (secret: string): Uint8Array => new TextEncoder().encode(secret);

/** A token built by hand with jose, for the shapes signAccessToken never makes. */
function craft(options: { alg?: 'HS256' | 'HS512'; typ?: string | null; iss?: string; aud?: string; claims?: Record<string, unknown>; secret?: string } = {}): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const header: { alg: string; typ?: string } = { alg: options.alg ?? 'HS256' };
    if (options.typ !== null) header.typ = options.typ ?? 'at+jwt';
    return new SignJWT({ client_id: CLAUDE_CLIENT_ID, scope: MCP_SCOPES.join(' '), gid: grantId, ...options.claims })
        .setProtectedHeader(header)
        .setIssuer(options.iss ?? ISSUER)
        .setSubject(USER)
        .setAudience(options.aud ?? CLAUDE_RESOURCE)
        .setJti('jti-1')
        .setIssuedAt(now)
        .setExpirationTime(now + 3600)
        .sign(key(options.secret ?? SECRET));
}

beforeEach(() => {
    useOAuthEnv();
    resetDb();
    addProfile(USER);
    grantId = addGrant({ userId: USER }).id as string;
});

describe('a valid token', () => {
    it('verifies for its own endpoint with every field', async () => {
        const token = await signAccessToken(input());
        const result = await verifyAccessToken(token, CLAUDE_RESOURCE);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.token).toEqual({
            token,
            userId: USER,
            clientId: CLAUDE_CLIENT_ID,
            grantId,
            scopes: [...MCP_SCOPES],
            resource: CLAUDE_RESOURCE,
            expiresAt: expect.any(Number),
        });
        const now = Math.floor(Date.now() / 1000);
        expect(result.token.expiresAt).toBeGreaterThan(now + 3500);
        expect(result.token.expiresAt).toBeLessThanOrEqual(now + 3600);
    });
});

describe('refused tokens', () => {
    it('malformed: not three base64url segments, empty, oversized, not a string', async () => {
        for (const token of ['', 'abc', 'a.b', 'a.b.c.d', 'a b.c.d', `${'a'.repeat(3000)}.${'b'.repeat(1100)}.c`, 42 as unknown as string, null as unknown as string]) {
            expect(await verifyAccessToken(token, CLAUDE_RESOURCE), String(token).slice(0, 20)).toEqual({ ok: false, reason: 'malformed' });
        }
        expect(await verifyAccessToken('eyJ.eyJ.sig', CLAUDE_RESOURCE)).toEqual({ ok: false, reason: 'malformed' });
    });

    it('invalid: signed with another secret', async () => {
        expect(await verifyAccessToken(await craft({ secret: OTHER_SECRET }), CLAUDE_RESOURCE)).toEqual({ ok: false, reason: 'invalid' });
    });

    it('invalid: alg none, with or without a signature', async () => {
        const payload = encode({ iss: ISSUER, sub: USER, aud: CLAUDE_RESOURCE, client_id: CLAUDE_CLIENT_ID, scope: 'profile:read', gid: grantId, jti: 'j', iat: 1, exp: 9_999_999_999 });
        const header = encode({ alg: 'none', typ: 'at+jwt' });
        for (const token of [`${header}.${payload}.`, `${header}.${payload}.c2ln`]) {
            expect(await verifyAccessToken(token, CLAUDE_RESOURCE)).toEqual({ ok: false, reason: 'invalid' });
        }
    });

    it('invalid: another HMAC algorithm with the right secret', async () => {
        expect(await verifyAccessToken(await craft({ alg: 'HS512' }), CLAUDE_RESOURCE)).toEqual({ ok: false, reason: 'invalid' });
    });

    it('invalid: typ JWT, or no typ (an ID token or another JWT this secret might sign)', async () => {
        expect(await verifyAccessToken(await craft({ typ: 'JWT' }), CLAUDE_RESOURCE)).toEqual({ ok: false, reason: 'invalid' });
        expect(await verifyAccessToken(await craft({ typ: null }), CLAUDE_RESOURCE)).toEqual({ ok: false, reason: 'invalid' });
    });

    it('invalid: another issuer', async () => {
        expect(await verifyAccessToken(await craft({ iss: 'https://evil.example' }), CLAUDE_RESOURCE)).toEqual({ ok: false, reason: 'invalid' });
    });

    it('invalid: a missing grant id, client id or scope, or an unknown scope', async () => {
        for (const claims of [{ gid: undefined }, { client_id: undefined }, { scope: undefined }, { scope: '' }, { scope: 'admin' }, { gid: 7 }]) {
            expect(await verifyAccessToken(await craft({ claims }), CLAUDE_RESOURCE), JSON.stringify(claims)).toEqual({ ok: false, reason: 'invalid' });
        }
    });

    it('wrong_audience: a token for the other endpoint', async () => {
        const chatgpt = await signAccessToken(input({ resource: CHATGPT_RESOURCE }));
        expect(await verifyAccessToken(chatgpt, CLAUDE_RESOURCE)).toEqual({ ok: false, reason: 'wrong_audience' });
        const claude = await signAccessToken(input());
        expect(await verifyAccessToken(claude, CHATGPT_RESOURCE)).toEqual({ ok: false, reason: 'wrong_audience' });
        expect(await verifyAccessToken(await craft({ aud: 'https://other.example/mcp' }), CLAUDE_RESOURCE)).toEqual({ ok: false, reason: 'wrong_audience' });
    });

    it('expired: issued more than an hour ago', async () => {
        const token = await signAccessToken(input(), Date.now() - 3601 * 1000);
        expect(await verifyAccessToken(token, CLAUDE_RESOURCE)).toEqual({ ok: false, reason: 'expired' });
    });

    it('revoked: the grant is revoked, missing, another user\'s, or another client\'s', async () => {
        const token = await signAccessToken(input());
        db.grants[0].revokedAt = new Date();
        expect(await verifyAccessToken(token, CLAUDE_RESOURCE)).toEqual({ ok: false, reason: 'revoked' });

        db.grants[0].revokedAt = null;
        db.grants[0].userId = 'someone-else';
        expect(await verifyAccessToken(token, CLAUDE_RESOURCE)).toEqual({ ok: false, reason: 'revoked' });

        db.grants[0].userId = USER;
        db.grants[0].clientId = 'https://chatgpt.com/oauth/meta';
        expect(await verifyAccessToken(token, CLAUDE_RESOURCE)).toEqual({ ok: false, reason: 'revoked' });

        db.grants.length = 0;
        expect(await verifyAccessToken(token, CLAUDE_RESOURCE)).toEqual({ ok: false, reason: 'revoked' });
    });

    it('account: the profile is soft-deleted, an employer or an admin', async () => {
        const token = await signAccessToken(input());
        for (const change of [{ deletedAt: new Date() }, { role: 'employer' }, { role: 'admin' }]) {
            Object.assign(db.profiles[0], { role: 'job_seeker', deletedAt: null }, change);
            expect(await verifyAccessToken(token, CLAUDE_RESOURCE), JSON.stringify(change)).toEqual({ ok: false, reason: 'account' });
        }
    });

    it('unconfigured: no signing secret, or one under 32 characters', async () => {
        const token = await signAccessToken(input());
        delete process.env.MCP_OAUTH_SIGNING_SECRET;
        expect(await verifyAccessToken(token, CLAUDE_RESOURCE)).toEqual({ ok: false, reason: 'unconfigured' });
        process.env.MCP_OAUTH_SIGNING_SECRET = SECRET.slice(0, 31);
        expect(await verifyAccessToken(token, CLAUDE_RESOURCE)).toEqual({ ok: false, reason: 'unconfigured' });
    });

    it('a bad token never reaches the database', async () => {
        await verifyAccessToken(await craft({ secret: OTHER_SECRET }), CLAUDE_RESOURCE);
        await verifyAccessToken('garbage', CLAUDE_RESOURCE);
        expect(fakePrisma.oauthGrant.findUnique).not.toHaveBeenCalled();
    });

    it('logs the reason, never the token', async () => {
        const forged = await craft({ secret: OTHER_SECRET });
        const valid = await signAccessToken(input());
        db.grants[0].revokedAt = new Date();
        await verifyAccessToken(forged, CLAUDE_RESOURCE);
        await verifyAccessToken(valid, CLAUDE_RESOURCE);
        const logged = JSON.stringify([h.logger.info.mock.calls, h.logger.warn.mock.calls]);
        expect(logged).toContain('invalid');
        expect(logged).toContain('revoked');
        expect(logged).not.toContain(forged);
        expect(logged).not.toContain(valid);
        expect(logged).not.toContain(valid.split('.')[2]);
    });
});

describe('grant.lastUsedAt', () => {
    it('is written on first use, then at most once per 10 minutes', async () => {
        const token = await signAccessToken(input());
        await verifyAccessToken(token, CLAUDE_RESOURCE);
        expect(db.grants[0].lastUsedAt).toBeInstanceOf(Date);
        expect(fakePrisma.oauthGrant.updateMany).toHaveBeenCalledTimes(1);

        await verifyAccessToken(token, CLAUDE_RESOURCE);
        expect(fakePrisma.oauthGrant.updateMany).toHaveBeenCalledTimes(1);

        db.grants[0].lastUsedAt = new Date(Date.now() - 11 * 60 * 1000);
        await verifyAccessToken(token, CLAUDE_RESOURCE);
        expect(fakePrisma.oauthGrant.updateMany).toHaveBeenCalledTimes(2);
        expect(Date.now() - (db.grants[0].lastUsedAt as Date).getTime()).toBeLessThan(5000);
    });

    it('a failed write is logged and the token still verifies', async () => {
        const token = await signAccessToken(input());
        fakePrisma.oauthGrant.updateMany.mockRejectedValueOnce(new Error('timeout'));
        expect((await verifyAccessToken(token, CLAUDE_RESOURCE)).ok).toBe(true);
        expect(h.logger.warn).toHaveBeenCalled();
    });

    it('a database failure loading the grant is thrown, not reported as a bad token', async () => {
        const token = await signAccessToken(input());
        fakePrisma.oauthGrant.findUnique.mockRejectedValueOnce(new Error('connection reset'));
        await expect(verifyAccessToken(token, CLAUDE_RESOURCE)).rejects.toThrow('connection reset');
    });
});
