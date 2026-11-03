/**
 * POST /oauth/authorize/decision (design 2.6): the consent page's Allow or
 * Cancel.
 *
 * Pinned: Allow creates the grant and a hashed, 5 minute, PKCE-bound code
 * and answers the redirect with code, state and iss (appended to any query
 * the redirect URI has); Cancel answers access_denied with state and iss and
 * writes nothing; and nothing happens without the site Origin, a session,
 * a consent token for that user and those exact parameters (wrong user,
 * stale, tampered), a candidate account, or within the rate limit. The code
 * it issues works at the token endpoint, end to end.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';

const h = vi.hoisted(() => ({
    getUser: vi.fn(),
    ensureProfile: vi.fn(),
    checkRateLimit: vi.fn(),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/prisma', async () => ({ prisma: (await import('./support/fake-prisma')).fakePrisma }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({ auth: { getUser: h.getUser } })) }));
vi.mock('@/lib/auth/ensure-profile', () => ({ ensureProfileFromAuth: h.ensureProfile }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: h.checkRateLimit }));
vi.mock('@/lib/logger', () => ({ logger: h.logger }));

import { POST, dynamic } from '@/app/oauth/authorize/decision/route';
import { POST as tokenPOST } from '@/app/oauth/token/route';
import { verifyAccessToken } from '@/lib/oauth/access-token';
import type { AuthorizeParams } from '@/lib/oauth/authorize-params';
import { createConsentToken } from '@/lib/oauth/consent-csrf';
import { clearClientMetadataCache } from '@/lib/oauth/cimd';
import { addClient, addProfile, db, resetDb } from './support/fake-prisma';
import {
    CHALLENGE,
    CLAUDE_REDIRECT,
    CLAUDE_RESOURCE,
    DCR_CLIENT_ID,
    ISSUER,
    VERIFIER,
    formRequest,
    jsonRequest,
    useOAuthEnv,
} from './support/fixtures';

const DECISION_URL = 'https://nphiring.com/oauth/authorize/decision';
const USER = { id: 'user-1', email: 'np@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' };
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

const PARAMS: AuthorizeParams = {
    response_type: 'code',
    client_id: DCR_CLIENT_ID,
    redirect_uri: CLAUDE_REDIRECT,
    scope: 'profile:read applications:read',
    state: 'state-abc',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    resource: CLAUDE_RESOURCE,
};

interface Answer {
    status: number;
    json: Record<string, unknown>;
    headers: Headers;
}

async function decide(
    body: unknown,
    headers: Record<string, string> = { Origin: ISSUER },
): Promise<Answer> {
    const res = await POST(jsonRequest(DECISION_URL, body, headers));
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : {}, headers: res.headers };
}

function body(decision: 'allow' | 'deny', params: AuthorizeParams = PARAMS, csrf = createConsentToken(USER.id, params)): Record<string, unknown> {
    return { params, decision, csrf };
}

function redirectParams(redirectTo: unknown): URLSearchParams {
    return new URL(String(redirectTo)).searchParams;
}

beforeEach(() => {
    useOAuthEnv();
    resetDb();
    clearClientMetadataCache();
    addProfile(USER.id);
    addClient(DCR_CLIENT_ID, { clientName: 'Claude', redirectUris: [CLAUDE_REDIRECT, 'https://claude.ai/cb?tenant=a%20b'] });
    h.getUser.mockReset().mockResolvedValue({ data: { user: USER }, error: null });
    h.ensureProfile.mockReset().mockResolvedValue({ id: 'p1', supabaseId: USER.id, email: USER.email, role: 'job_seeker', deletedAt: null });
    h.checkRateLimit.mockReset().mockResolvedValue({ success: true, reset: Date.now() + 60_000, remaining: 29 });
});

describe('Allow', () => {
    it('creates the grant and a hashed code, and answers the redirect with code, state and iss', async () => {
        const { status, json, headers } = await decide(body('allow'));
        expect(status).toBe(200);
        expect(headers.get('cache-control')).toBe('no-store');

        const redirectTo = String(json.redirectTo);
        expect(redirectTo.startsWith(`${CLAUDE_REDIRECT}?code=`)).toBe(true);
        const query = redirectParams(redirectTo);
        expect([...query.keys()]).toEqual(['code', 'state', 'iss']);
        expect(query.get('state')).toBe('state-abc');
        expect(query.get('iss')).toBe(ISSUER);
        const code = query.get('code') ?? '';
        expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);

        expect(db.grants).toHaveLength(1);
        expect(db.grants[0]).toMatchObject({
            userId: USER.id,
            clientId: DCR_CLIENT_ID,
            clientName: 'Claude',
            redirectUri: CLAUDE_REDIRECT,
            scopes: ['profile:read', 'applications:read'],
            resource: CLAUDE_RESOURCE,
            revokedAt: null,
        });
        expect(db.codes).toHaveLength(1);
        expect(db.codes[0]).toMatchObject({ codeHash: sha256(code), codeChallenge: CHALLENGE, grantId: db.grants[0].id, consumedAt: null });
        const lifetime = (db.codes[0].expiresAt as Date).getTime() - Date.now();
        expect(lifetime).toBeGreaterThan(4 * 60 * 1000);
        expect(lifetime).toBeLessThanOrEqual(5 * 60 * 1000);
        expect(JSON.stringify(db)).not.toContain(code);
        expect(JSON.stringify(h.logger.info.mock.calls)).not.toContain(code);
    });

    it('records that the registered client was used', async () => {
        await decide(body('allow'));
        expect(db.clients[0].lastUsedAt).toBeInstanceOf(Date);
    });

    it('keeps the query the redirect URI already has', async () => {
        const params = { ...PARAMS, redirect_uri: 'https://claude.ai/cb?tenant=a%20b' };
        const { json } = await decide(body('allow', params));
        expect(String(json.redirectTo).startsWith('https://claude.ai/cb?tenant=a%20b&code=')).toBe(true);
    });

    it('sends no state when the request had none', async () => {
        const params: AuthorizeParams = { ...PARAMS };
        delete params.state;
        const { json } = await decide(body('allow', params));
        expect([...redirectParams(json.redirectTo).keys()]).toEqual(['code', 'iss']);
    });

    it('end to end: the code buys tokens at the token endpoint that verify for the endpoint', async () => {
        const { json } = await decide(body('allow'));
        const code = redirectParams(json.redirectTo).get('code') ?? '';
        const res = await tokenPOST(formRequest('https://nphiring.com/oauth/token', {
            grant_type: 'authorization_code',
            client_id: DCR_CLIENT_ID,
            redirect_uri: CLAUDE_REDIRECT,
            code_verifier: VERIFIER,
            code,
            resource: CLAUDE_RESOURCE,
        }));
        expect(res.status).toBe(200);
        const tokens = await res.json();
        expect(tokens.scope).toBe('profile:read applications:read');
        const verified = await verifyAccessToken(tokens.access_token, CLAUDE_RESOURCE);
        expect(verified).toMatchObject({ ok: true, token: { userId: USER.id, clientId: DCR_CLIENT_ID, scopes: ['profile:read', 'applications:read'] } });
    });
});

describe('Cancel', () => {
    it('answers access_denied with state and iss, and writes nothing', async () => {
        const { status, json } = await decide(body('deny'));
        expect(status).toBe(200);
        const query = redirectParams(json.redirectTo);
        expect(String(json.redirectTo).startsWith(`${CLAUDE_REDIRECT}?error=access_denied`)).toBe(true);
        expect([...query.keys()]).toEqual(['error', 'error_description', 'state', 'iss']);
        expect(query.get('state')).toBe('state-abc');
        expect(query.get('iss')).toBe(ISSUER);
        expect(db.grants).toHaveLength(0);
        expect(db.codes).toHaveLength(0);
    });
});

describe('refused', () => {
    it('without the site Origin: 403, nothing written', async () => {
        const origins: Array<Record<string, string>> = [
            {},
            { Origin: 'https://evil.example' },
            { Origin: 'null' },
            { Origin: 'http://nphiring.com' },
            { Origin: 'https://www.nphiring.com' },
        ];
        for (const headers of origins) {
            const { status } = await decide(body('allow'), headers);
            expect(status, JSON.stringify(headers)).toBe(403);
        }
        expect(db.grants).toHaveLength(0);
        expect(h.getUser).not.toHaveBeenCalled();
    });

    it('signed out: 401', async () => {
        h.getUser.mockResolvedValue({ data: { user: null }, error: null });
        expect((await decide(body('allow'))).status).toBe(401);
        expect(db.grants).toHaveLength(0);
    });

    it('a consent token made for another user: 403', async () => {
        const { status, json } = await decide(body('allow', PARAMS, createConsentToken('user-2', PARAMS)));
        expect(status).toBe(403);
        expect(json.error).toBe('invalid_csrf');
        expect(db.grants).toHaveLength(0);
    });

    it('a stale consent token (over 10 minutes): 403', async () => {
        const stale = createConsentToken(USER.id, PARAMS, Date.now() - 11 * 60 * 1000);
        expect((await decide(body('allow', PARAMS, stale))).status).toBe(403);
        expect(db.grants).toHaveLength(0);
    });

    it('parameters changed after the page signed them: 403', async () => {
        const csrf = createConsentToken(USER.id, PARAMS);
        for (const change of [
            { scope: 'profile:read applications:read applications:write' },
            { redirect_uri: 'https://claude.ai/cb?tenant=a%20b' },
            { state: 'other' },
            { code_challenge: 'B'.repeat(43) },
            { resource: 'https://nphiring.com/mcp/chatgpt' },
        ]) {
            const { status } = await decide(body('allow', { ...PARAMS, ...change }, csrf));
            expect(status, JSON.stringify(change)).toBe(403);
        }
        expect(db.grants).toHaveLength(0);
    });

    it('a missing or malformed consent token, or a malformed body: 400 or 403, nothing written', async () => {
        expect((await decide({ params: PARAMS, decision: 'allow' })).status).toBe(400);
        expect((await decide({ params: PARAMS, decision: 'allow', csrf: 'garbage' })).status).toBe(403);
        expect((await decide({ params: PARAMS, decision: 'maybe', csrf: createConsentToken(USER.id, PARAMS) })).status).toBe(400);
        expect((await decide({ params: { ...PARAMS, scope: ['profile:read'] }, decision: 'allow', csrf: 'x' })).status).toBe(400);
        expect((await decide('not json')).status).toBe(400);
        expect((await decide('null')).status).toBe(400);
        expect((await decide({ ...body('allow'), padding: 'x'.repeat(17 * 1024) })).status).toBe(400);
        expect(db.grants).toHaveLength(0);
    });

    it('an employer, a deleted profile or no profile: 403 account, never a code', async () => {
        for (const profile of [
            { id: 'p1', supabaseId: USER.id, email: USER.email, role: 'employer', deletedAt: null },
            { id: 'p1', supabaseId: USER.id, email: USER.email, role: 'job_seeker', deletedAt: new Date() },
            null,
        ]) {
            h.ensureProfile.mockResolvedValueOnce(profile);
            const { status, json } = await decide(body('allow'));
            expect(status, JSON.stringify(profile)).toBe(403);
            expect(json.error).toBe('account');
            expect(json).not.toHaveProperty('redirectTo');
        }
        expect(db.grants).toHaveLength(0);
    });

    it('signed parameters that fail validation go back to the app as an error', async () => {
        const params = { ...PARAMS, response_type: 'token' };
        const { status, json } = await decide(body('allow', params));
        expect(status).toBe(200);
        expect(redirectParams(json.redirectTo).get('error')).toBe('unsupported_response_type');
        expect(db.grants).toHaveLength(0);
    });

    it('a client that no longer resolves: 400, no redirect', async () => {
        db.clients.length = 0;
        const { status, json } = await decide(body('allow'));
        expect(status).toBe(400);
        expect(json).not.toHaveProperty('redirectTo');
    });

    it('over the per-user rate limit: 429 with Retry-After', async () => {
        h.checkRateLimit.mockResolvedValue({ success: false, reset: Date.now() + 20_000, remaining: 0 });
        const { status, headers } = await decide(body('allow'));
        expect(status).toBe(429);
        expect(Number(headers.get('retry-after'))).toBeGreaterThan(0);
        expect(h.checkRateLimit).toHaveBeenCalledWith(`oauth:decision:user:${USER.id}`, { limit: 30, windowSeconds: 60 });
        expect(db.grants).toHaveLength(0);
    });

    it('without a signing secret: 503', async () => {
        const csrf = createConsentToken(USER.id, PARAMS);
        delete process.env.MCP_OAUTH_SIGNING_SECRET;
        expect((await decide(body('allow', PARAMS, csrf))).status).toBe(503);
        expect(db.grants).toHaveLength(0);
    });

    it('renders per request', () => {
        expect(dynamic).toBe('force-dynamic');
    });
});
