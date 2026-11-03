/**
 * POST /oauth/register: Dynamic Client Registration (RFC 7591, design 2.4).
 *
 * Pinned, rule by rule: 1 to 5 redirect URIs, each at most 512 characters,
 * no fragment, https on claude.ai, claude.com or chatgpt.com (plus
 * MCP_OAUTH_REDIRECT_HOSTS) or http loopback on any port; auth method absent
 * or none; grant and response types within what the server does; a client
 * name of at most 100 characters after cleaning, "MCP client" by default.
 * Redirect problems answer invalid_redirect_uri, everything else
 * invalid_client_metadata. The answer is the 201 document of design 2.4.
 * Plus the IP rate limit, the 503 without a signing secret, and CORS.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
    checkRateLimit: vi.fn(),
}));

vi.mock('@/lib/prisma', async () => ({ prisma: (await import('./support/fake-prisma')).fakePrisma }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: h.checkRateLimit }));
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { POST, OPTIONS, dynamic } from '@/app/oauth/register/route';
import { db, resetDb } from './support/fake-prisma';
import { jsonRequest, useOAuthEnv } from './support/fixtures';

const URL_REGISTER = 'https://nphiring.com/oauth/register';

async function register(body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: Record<string, unknown>; res: Response }> {
    const res = await POST(jsonRequest(URL_REGISTER, body, { 'x-forwarded-for': '198.51.100.7', ...headers }));
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : {}, res };
}

beforeEach(() => {
    useOAuthEnv();
    resetDb();
    h.checkRateLimit.mockReset().mockResolvedValue({ success: true, reset: Date.now() + 60_000, remaining: 19 });
});

describe('a valid registration', () => {
    it('answers 201 with the design 2.4 document and stores the client', async () => {
        const before = Math.floor(Date.now() / 1000);
        const { status, json, res } = await register({
            client_name: 'Claude',
            redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            token_endpoint_auth_method: 'none',
            scope: 'profile:read',
            software_id: 'ignored',
        });
        expect(status).toBe(201);
        expect(Object.keys(json).sort()).toEqual([
            'client_id', 'client_id_issued_at', 'client_name', 'grant_types', 'redirect_uris', 'response_types', 'token_endpoint_auth_method',
        ]);
        expect(json.client_id).toMatch(/^dcr_[A-Za-z0-9_-]{32}$/);
        expect(json.client_id_issued_at).toBeGreaterThanOrEqual(before);
        expect(json).toMatchObject({
            client_name: 'Claude',
            redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            token_endpoint_auth_method: 'none',
        });
        expect(res.headers.get('cache-control')).toBe('no-store');
        expect(res.headers.get('access-control-allow-origin')).toBe('*');

        expect(db.clients).toHaveLength(1);
        expect(db.clients[0]).toMatchObject({ id: json.client_id, clientName: 'Claude', redirectUris: ['https://claude.ai/api/mcp/auth_callback'] });
    });

    it('accepts loopback redirect URIs on any port, and ChatGPT and claude.com callbacks', async () => {
        const { status } = await register({
            redirect_uris: [
                'http://localhost:33418/callback',
                'http://127.0.0.1/callback',
                'http://[::1]:8080/cb',
                'https://chatgpt.com/connector_platform_oauth_redirect',
                'https://claude.com/api/mcp/auth_callback',
            ],
        });
        expect(status).toBe(201);
    });

    it('defaults the name to "MCP client" and cleans control and invisible characters', async () => {
        expect((await register({ redirect_uris: ['https://claude.ai/cb'] })).json.client_name).toBe('MCP client');
        expect((await register({ redirect_uris: ['https://claude.ai/cb'], client_name: '   ' })).json.client_name).toBe('MCP client');
        const override = String.fromCharCode(0x202e);
        expect((await register({ redirect_uris: ['https://claude.ai/cb'], client_name: `My${override} App\n` })).json.client_name).toBe('My App');
    });

    it('answers both grant types whatever subset was asked for (the server always issues refresh tokens)', async () => {
        const { status, json } = await register({ redirect_uris: ['https://claude.ai/cb'], grant_types: ['authorization_code'] });
        expect(status).toBe(201);
        expect(json.grant_types).toEqual(['authorization_code', 'refresh_token']);
    });

    it('MCP_OAUTH_REDIRECT_HOSTS adds https hosts', async () => {
        process.env.MCP_OAUTH_REDIRECT_HOSTS = 'client.example.org';
        expect((await register({ redirect_uris: ['https://client.example.org/cb'] })).status).toBe(201);
    });
});

describe('invalid_redirect_uri', () => {
    const cases: Array<[string, unknown]> = [
        ['missing', undefined],
        ['not an array', 'https://claude.ai/cb'],
        ['empty', []],
        ['six entries', Array.from({ length: 6 }, (_, i) => `https://claude.ai/cb/${i}`)],
        ['a non-string entry', ['https://claude.ai/cb', 7]],
        ['over 512 characters', [`https://claude.ai/${'a'.repeat(500)}`]],
        ['a fragment', ['https://claude.ai/cb#x']],
        ['another host', ['https://evil.example/cb']],
        ['a lookalike host', ['https://claude.ai.evil.example/cb']],
        ['http off loopback', ['http://claude.ai/cb']],
        ['a port on an https host', ['https://claude.ai:8443/cb']],
        ['userinfo', ['https://user@claude.ai/cb']],
        ['a custom scheme', ['myapp://callback']],
        ['javascript', ['javascript:alert(1)']],
        ['one bad among good', ['https://claude.ai/cb', 'https://evil.example/cb']],
    ];
    for (const [name, redirect_uris] of cases) {
        it(`${name}: 400, nothing stored`, async () => {
            const { status, json } = await register({ client_name: 'X', redirect_uris });
            expect(status).toBe(400);
            expect(json.error).toBe('invalid_redirect_uri');
            expect(typeof json.error_description).toBe('string');
            expect(db.clients).toHaveLength(0);
        });
    }
});

describe('invalid_client_metadata', () => {
    const cases: Array<[string, Record<string, unknown>]> = [
        ['client_secret_basic', { token_endpoint_auth_method: 'client_secret_basic' }],
        ['client_secret_post', { token_endpoint_auth_method: 'client_secret_post' }],
        ['private_key_jwt', { token_endpoint_auth_method: 'private_key_jwt' }],
        ['a null auth method', { token_endpoint_auth_method: null }],
        ['client_credentials', { grant_types: ['authorization_code', 'client_credentials'] }],
        ['implicit', { grant_types: ['implicit'] }],
        ['grant_types not an array', { grant_types: 'authorization_code' }],
        ['response_type token', { response_types: ['code', 'token'] }],
        ['client_name over 100 characters', { client_name: 'x'.repeat(101) }],
        ['client_name not a string', { client_name: 42 }],
    ];
    for (const [name, extra] of cases) {
        it(`${name}: 400, nothing stored`, async () => {
            const { status, json } = await register({ redirect_uris: ['https://claude.ai/cb'], ...extra });
            expect(status).toBe(400);
            expect(json.error).toBe('invalid_client_metadata');
            expect(db.clients).toHaveLength(0);
        });
    }

    it('a client_name of exactly 100 characters is kept', async () => {
        expect((await register({ redirect_uris: ['https://claude.ai/cb'], client_name: 'x'.repeat(100) })).status).toBe(201);
    });

    it('a body that is not a JSON object, or is over 16 KB', async () => {
        for (const body of ['not json', '[]', 'null', '"x"']) {
            const { status, json } = await register(body);
            expect(status, body).toBe(400);
            expect(json.error).toBe('invalid_client_metadata');
        }
        const huge = JSON.stringify({ redirect_uris: ['https://claude.ai/cb'], padding: 'x'.repeat(17 * 1024) });
        expect((await register(huge)).status).toBe(400);
        expect(db.clients).toHaveLength(0);
    });
});

describe('limits and availability', () => {
    it('counts registrations per IP, 20 a minute', async () => {
        await register({ redirect_uris: ['https://claude.ai/cb'] });
        expect(h.checkRateLimit).toHaveBeenCalledWith('oauth:register:ip:198.51.100.7', { limit: 20, windowSeconds: 60 });
    });

    it('answers 429 slow_down with Retry-After once the budget is spent, storing nothing', async () => {
        h.checkRateLimit.mockResolvedValue({ success: false, reset: Date.now() + 42_000, remaining: 0 });
        const { status, json, res } = await register({ redirect_uris: ['https://claude.ai/cb'] });
        expect(status).toBe(429);
        expect(json).toEqual({ error: 'slow_down' });
        expect(Number(res.headers.get('retry-after'))).toBeGreaterThanOrEqual(41);
        expect(db.clients).toHaveLength(0);
    });

    it('answers 503 temporarily_unavailable without a signing secret of at least 32 characters', async () => {
        for (const secret of [undefined, 'short-secret']) {
            if (secret === undefined) delete process.env.MCP_OAUTH_SIGNING_SECRET;
            else process.env.MCP_OAUTH_SIGNING_SECRET = secret;
            const { status, json } = await register({ redirect_uris: ['https://claude.ai/cb'] });
            expect(status).toBe(503);
            expect(json.error).toBe('temporarily_unavailable');
        }
        expect(db.clients).toHaveLength(0);
    });

    it('answers a CORS preflight and renders per request', () => {
        const res = OPTIONS();
        expect(res.status).toBe(204);
        expect(res.headers.get('access-control-allow-origin')).toBe('*');
        expect(res.headers.get('access-control-allow-methods')).toContain('POST');
        expect(dynamic).toBe('force-dynamic');
    });
});
