/**
 * The HTTP face of the two MCP endpoints (app/mcp/route.ts for Claude,
 * app/mcp/chatgpt/route.ts for ChatGPT). Per request:
 *
 *   1. CORS preflight answers at once (bearer tokens only, so `*` is safe).
 *   2. The bearer token, when present, must be valid for this endpoint
 *      (lib/mcp/auth.ts); a bad one is a 401 before anything else runs.
 *   3. Rate limits: per candidate when signed in, per IP otherwise. Claude
 *      and ChatGPT call from shared egress ranges, so the anonymous limit is
 *      generous and the per-candidate one does the real work.
 *   4. The body is read once, capped, and parsed; on the Claude endpoint a
 *      call to a candidate tool without the needed sign-in answers 401 or
 *      403 here (Claude only starts sign-in on an HTTP status).
 *   5. The SDK's createMcpHandler serves 2026-07-28 and, statelessly, the
 *      2025-era protocol the hosts speak today, with a fresh server per
 *      request (lib/mcp/server.ts) built for the verified caller.
 *
 * Origin is not checked: the endpoints take no cookies, a browser can only
 * act with a token it already holds, and Claude's guidance warns that strict
 * Origin checks break connections. Tool arguments are never logged (both
 * directories forbid collecting conversation data, even in logs).
 */
import { createMcpHandler, type AuthInfo, type McpHttpHandler } from '@modelcontextprotocol/server';
import { logger } from '@/lib/logger';
import { checkRateLimit, rateLimit } from '@/lib/rate-limit';
import { mcpHostProfile, type McpHostId } from '@/lib/mcp/config';
import {
    MCP_CORS_HEADERS,
    authenticateMcpRequest,
    claudeSignInGate,
    principalFromAuthInfo,
} from '@/lib/mcp/auth';
import { createNpHiringMcpServer } from '@/lib/mcp/server';

/** Largest JSON-RPC body accepted. A cover letter is at most 5,000 characters. */
export const MAX_MCP_BODY_BYTES = 256 * 1024;

export const MCP_RATE_LIMITS = {
    /** One signed-in candidate, across both endpoints. */
    candidate: { limit: 120, windowSeconds: 60 },
    /** Signed-out traffic per source IP (hosts share egress ranges). */
    anonymous: { limit: 600, windowSeconds: 60 },
} as const;

const handlers = new Map<McpHostId, McpHttpHandler>();

function handlerFor(hostId: McpHostId): McpHttpHandler {
    const existing = handlers.get(hostId);
    if (existing) return existing;
    const created = createMcpHandler(
        (ctx) => createNpHiringMcpServer(mcpHostProfile(hostId), principalFromAuthInfo(ctx.authInfo)),
        {
            legacy: 'stateless',
            responseMode: 'json',
            maxRequestBodySize: MAX_MCP_BODY_BYTES,
            onerror: (error) => logger.warn('[mcp] request rejected', { host: hostId, message: error.message }),
        },
    );
    handlers.set(hostId, created);
    return created;
}

function withCors(response: Response): Response {
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(MCP_CORS_HEADERS)) headers.set(name, value);
    headers.set('X-Robots-Tag', 'noindex, nofollow');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function jsonError(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...MCP_CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extraHeaders },
    });
}

function tooLarge(): Response {
    return jsonError(413, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request body too large' } });
}

/** The raw body, or null when it is over the cap. */
async function readCappedBody(request: Request): Promise<string | null> {
    const declared = Number(request.headers.get('content-length') ?? '');
    if (Number.isFinite(declared) && declared > MAX_MCP_BODY_BYTES) return null;
    const raw = await request.text();
    return new TextEncoder().encode(raw).byteLength > MAX_MCP_BODY_BYTES ? null : raw;
}

export async function handleMcpRequest(request: Request, hostId: McpHostId): Promise<Response> {
    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: MCP_CORS_HEADERS });
    }

    const profile = mcpHostProfile(hostId);
    const auth = await authenticateMcpRequest(request, profile);
    if (auth.kind === 'rejected') return auth.response;

    if (auth.kind === 'authenticated') {
        const verdict = await checkRateLimit(`mcp:candidate:${auth.principal.userId}`, MCP_RATE_LIMITS.candidate);
        if (!verdict.success) {
            const retryAfter = String(Math.max(1, Math.ceil((verdict.reset - Date.now()) / 1000)));
            return jsonError(429, { error: 'rate_limited' }, { 'Retry-After': retryAfter });
        }
    } else {
        const limited = await rateLimit(request, `mcp:${hostId}:anonymous`, MCP_RATE_LIMITS.anonymous);
        if (limited) return withCors(limited);
    }

    let forward: Request = request;
    let parsedBody: unknown = undefined;
    if (request.method === 'POST') {
        const raw = await readCappedBody(request);
        if (raw === null) return tooLarge();
        try {
            parsedBody = JSON.parse(raw);
        } catch {
            return jsonError(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
        }
        // The SDK gets the parsed body and a fresh, unread copy of the request.
        forward = new Request(request.url, { method: 'POST', headers: request.headers, body: raw });

        if (profile.signIn === 'http-401') {
            const gate = claudeSignInGate(parsedBody, auth, profile);
            if (gate) return gate;
        }
    }

    const authInfo: AuthInfo | undefined = auth.kind === 'authenticated' ? auth.authInfo : undefined;
    try {
        const response = await handlerFor(hostId).fetch(forward, { authInfo, parsedBody });
        return withCors(response);
    } catch (error) {
        logger.error('[mcp] handler failed', error, { host: hostId });
        return jsonError(500, { jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal error' } });
    }
}
