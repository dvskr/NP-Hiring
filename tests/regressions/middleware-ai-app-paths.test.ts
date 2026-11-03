/**
 * Middleware for the AI app's machine endpoints (AI_APP_MACHINE_PATHS in
 * middleware.ts). Claude's and ChatGPT's servers call the MCP endpoints, the
 * OAuth token, registration and revocation endpoints and the metadata
 * documents with bearer tokens, never with a browser session, so these paths
 * skip the whole pipeline:
 *   - no host redirect (Claude drops the Authorization header on a redirect),
 *   - no Supabase session refresh and no consent cookies (no Set-Cookie on
 *     an MCP call),
 *   - no site CSP and no listing rate limit (the handlers carry their own),
 * and they answer X-Robots-Tag: noindex, nofollow. The consent page
 * /oauth/authorize is NOT one of them: it keeps the session, the site CSP
 * (frame-ancestors 'none') and gets noindex, nofollow too.
 *
 * Driven through the real middleware() with a real NextRequest. The Supabase
 * session refresh and the rate limiter are stubbed; nothing reaches the network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const { updateSession, rateLimit } = vi.hoisted(() => ({
    updateSession: vi.fn(),
    rateLimit: vi.fn(),
}));

vi.mock('@/lib/supabase/middleware', () => ({ updateSession }));
vi.mock('@/lib/rate-limit', () => ({
    rateLimit,
    RATE_LIMITS: {
        publicDetail: { limit: 240, windowSeconds: 60 },
        publicListing: { limit: 120, windowSeconds: 60 },
        publicCompany: { limit: 60, windowSeconds: 60 },
    },
}));

import { middleware } from '@/middleware';
import { brand } from '@/config/brand';

const HOST = new URL(brand.baseUrl).host;
const ALIAS = 'np-hiring.vercel.app';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const CLAUDE_UA = 'Claude-User (+https://support.anthropic.com/)';

const MACHINE_PATHS: ReadonlyArray<[method: string, path: string]> = [
    ['POST', '/mcp'],
    ['GET', '/mcp'],
    ['OPTIONS', '/mcp'],
    ['POST', '/mcp/chatgpt'],
    ['DELETE', '/mcp/chatgpt'],
    ['POST', '/oauth/token'],
    ['POST', '/oauth/register'],
    ['POST', '/oauth/revoke'],
    ['GET', '/.well-known/oauth-authorization-server'],
    ['GET', '/.well-known/oauth-protected-resource'],
    ['GET', '/.well-known/oauth-protected-resource/mcp'],
    ['GET', '/.well-known/oauth-protected-resource/mcp/chatgpt'],
    ['GET', '/.well-known/openai-apps-challenge'],
];

const ENV_KEYS = ['VERCEL_ENV', 'NEXT_PUBLIC_BASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'PROD_SUPABASE_URL', 'PROD_SUPABASE_SERVICE_ROLE_KEY'] as const;
const savedEnv = new Map<string, string | undefined>();

function request(
    pathAndQuery: string,
    init: { method?: string; host?: string; headers?: Record<string, string> } = {},
): NextRequest {
    const host = init.host ?? HOST;
    return new NextRequest(`https://${host}${pathAndQuery}`, {
        method: init.method ?? 'GET',
        headers: { host, 'user-agent': BROWSER_UA, ...init.headers },
    });
}

beforeEach(() => {
    for (const key of ENV_KEYS) {
        savedEnv.set(key, process.env[key]);
        delete process.env[key];
    }
    // A real session refresh would set cookies: make that visible if it ever runs.
    updateSession.mockReset().mockImplementation(async () => {
        const next = NextResponse.next();
        next.cookies.set('sb-access-token', 'refreshed', { path: '/' });
        return next;
    });
    rateLimit.mockReset().mockResolvedValue(null);
    for (const method of ['log', 'warn', 'error'] as const) {
        vi.spyOn(console, method).mockImplementation(() => undefined);
    }
});

afterEach(() => {
    vi.restoreAllMocks();
    for (const [key, value] of savedEnv) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    savedEnv.clear();
});

describe('AI app machine endpoints pass straight through', () => {
    it.each(MACHINE_PATHS)('%s %s: no Set-Cookie, no CSP, noindex, nofollow, no session refresh', async (method, path) => {
        const res = await middleware(
            request(path, {
                method,
                headers: {
                    'user-agent': CLAUDE_UA,
                    authorization: 'Bearer abc.def.ghi',
                    cookie: 'pmhnp_consent=granted; sb-access-token=old',
                    'sec-gpc': '1',
                },
            }),
        );
        expect(res.status).toBe(200);
        expect(res.headers.get('x-middleware-next')).toBe('1');
        expect(res.headers.get('set-cookie')).toBeNull();
        expect(res.headers.get('Content-Security-Policy')).toBeNull();
        expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
        expect(res.headers.get('location')).toBeNull();
        expect(updateSession).not.toHaveBeenCalled();
        expect(rateLimit).not.toHaveBeenCalled();
    });

    it.each(MACHINE_PATHS)('%s %s on the production *.vercel.app alias: never redirected', async (method, path) => {
        process.env.VERCEL_ENV = 'production';
        const res = await middleware(request(path, { method, host: ALIAS }));
        expect(res.status).not.toBe(308);
        expect(res.headers.get('location')).toBeNull();
        expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    });

    it('a trailing slash is not 301ed either (a redirect would drop the bearer token)', async () => {
        const res = await middleware(request('/mcp/', { method: 'POST' }));
        expect(res.status).toBe(200);
        expect(res.headers.get('location')).toBeNull();
    });
});

describe('paths that only look like machine endpoints get the full pipeline', () => {
    it.each(['/mcpx', '/mcp-guide', '/oauth/tokens', '/.well-known/oauth-protected-resources'])(
        '%s is not a machine path',
        async (path) => {
            const res = await middleware(request(path));
            expect(res.headers.get('Content-Security-Policy')).not.toBeNull();
            expect(updateSession).toHaveBeenCalled();
        },
    );
});

describe('the consent page /oauth/authorize keeps the site pipeline', () => {
    it('has the session refresh and the site CSP with frame-ancestors none, and noindex, nofollow', async () => {
        const res = await middleware(
            request('/oauth/authorize?client_id=https%3A%2F%2Fclaude.ai%2Foauth%2Fmcp-oauth-client-metadata&response_type=code'),
        );
        expect(updateSession).toHaveBeenCalledTimes(1);
        const csp = res.headers.get('Content-Security-Policy') ?? '';
        expect(csp).toContain("frame-ancestors 'none'");
        expect(csp).toContain("form-action 'self'");
        expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    });

    it('the decision endpoint the consent page posts to is treated the same way', async () => {
        const res = await middleware(request('/oauth/authorize/decision', { method: 'POST' }));
        expect(updateSession).toHaveBeenCalledTimes(1);
        expect(res.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
        expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    });
});
