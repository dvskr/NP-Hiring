import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { brand } from '@/config/brand';
import { logger } from '@/lib/logger';
import { MCP_RESOURCES, getIssuer, resourceUrl } from '@/lib/mcp/oauth/config';
import { clientIp } from '@/lib/mcp/oauth/http';
import { verifyAccessToken, type VerifiedAccess } from '@/lib/mcp/oauth/tokens';
import { bearerChallenge, buildMcpServer, securitySchemesFor, type EndpointDefinition } from './build-server';
import { checkRequestBudget } from './rate-limits';
import type { ToolContext } from './types';

/**
 * HTTP entry for both MCP endpoints (Streamable HTTP, stateless, JSON
 * responses).
 *
 * Authentication, in order:
 *  1. A bearer token, if present, must be valid for THIS endpoint. A bad one
 *     is a 401 even on calls that work signed out, because a 401 is what
 *     makes Claude and ChatGPT refresh it.
 *  2. The employer endpoint has no signed-out mode: no token, 401, which
 *     starts sign-in at connect time.
 *  3. The candidate endpoint works signed out for search, job details and
 *     pay data (lazy authentication). A signed-out call to a tool that needs
 *     an account gets an HTTP 401 before the tool runs, which is the only
 *     signal Claude starts sign-in from. ChatGPT instead links accounts from
 *     a tool result carrying mcp/www_authenticate, so calls that carry its
 *     openai/* request metadata are let through to receive that result.
 *
 * Before any of that, every POST is charged to a per-IP budget, so the calls
 * that never reach a tool (initialize, tools/list, resources/read) are
 * metered too, and the body is capped well below what a large array would
 * need to make validation expensive.
 */

/** The largest real request, a posting preview with a 25,000 character description, fits with room to spare. */
const MAX_BODY_BYTES = 128 * 1024;

const CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, MCP-Protocol-Version, Mcp-Session-Id',
  'X-Robots-Tag': 'noindex, nofollow',
  'Cache-Control': 'no-store',
};

interface JsonRpcRequestLike {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: { name?: unknown; _meta?: unknown } & Record<string, unknown>;
}

function jsonRpcError(status: number, code: number, message: string, id: unknown = null, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: id ?? null }), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...headers },
  });
}

function messages(body: unknown): JsonRpcRequestLike[] {
  if (Array.isArray(body)) return body.filter((m): m is JsonRpcRequestLike => !!m && typeof m === 'object');
  return body && typeof body === 'object' ? [body as JsonRpcRequestLike] : [];
}

function firstId(body: unknown): unknown {
  return messages(body).find((m) => m.id !== undefined)?.id ?? null;
}

export function readBearer(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match ? match[1] : null;
}

/** True when the request carries ChatGPT's per-call metadata (openai/* keys). */
export function carriesOpenAiMeta(body: unknown): boolean {
  return messages(body).some((m) => {
    const meta = m.params?._meta;
    return !!meta && typeof meta === 'object' && Object.keys(meta as object).some((k) => k.startsWith('openai/'));
  });
}

/**
 * ChatGPT's MCP client names itself in its user agent and sends openai/*
 * metadata with tool calls. Either one marks the request as ChatGPT's, which
 * only ever removes tools from what is offered.
 */
export function isChatGptRequest(request: Request, body: unknown): boolean {
  return /openai-mcp|chatgpt/i.test(request.headers.get('user-agent') ?? '') || carriesOpenAiMeta(body);
}

/** Names of tools/call targets in this request that need an account. */
export function signInRequiredCalls(body: unknown, definition: EndpointDefinition): string[] {
  const required = new Set(definition.tools.filter((t) => t.auth === 'required').map((t) => t.name));
  return messages(body)
    .filter((m) => m.method === 'tools/call' && typeof m.params?.name === 'string' && required.has(m.params.name))
    .map((m) => m.params!.name as string);
}

function requestMeta(body: unknown): Record<string, unknown> | undefined {
  const meta = messages(body).find((m) => m.method === 'tools/call')?.params?._meta;
  return meta && typeof meta === 'object' ? (meta as Record<string, unknown>) : undefined;
}

/**
 * Adds ChatGPT's top-level `securitySchemes` to each tool in a tools/list
 * response. The SDK only emits standard Tool fields, so the declaration is
 * also mirrored in _meta (build-server.ts) and patched in here for hosts
 * that read the top-level field.
 */
export function withSecuritySchemes(responseText: string, definition: EndpointDefinition): string {
  try {
    const parsed = JSON.parse(responseText) as { result?: { tools?: Array<Record<string, unknown>> } };
    const tools = parsed.result?.tools;
    if (!Array.isArray(tools)) return responseText;
    const byName = new Map(definition.tools.map((t) => [t.name, t]));
    for (const tool of tools) {
      const spec = byName.get(String(tool.name));
      if (spec) tool.securitySchemes = securitySchemesFor(spec.auth, definition.id);
    }
    return JSON.stringify(parsed);
  } catch {
    return responseText;
  }
}

const REFUSAL_REASON_MAX = 200;
const REFUSAL_METHODS_MAX = 5;
/** Method names and the version header are the caller's own text. */
const REFUSAL_FIELD_MAX = 80;

/**
 * Records a request that was refused as malformed (a 4xx from the transport,
 * or a body that is not JSON). Every Claude connection sends one request that
 * is answered 400, and the platform's request log keeps no bodies, so this is
 * the only place that says what it was. It logs the JSON-RPC method names,
 * the protocol version the host asked for and the reason given back. A tool's
 * arguments are never logged.
 */
function logRefusal(definition: EndpointDefinition, request: Request, body: unknown, status: number, reason: string): void {
  logger.warn('MCP request refused', {
    endpoint: definition.id,
    status,
    methods: messages(body)
      .slice(0, REFUSAL_METHODS_MAX)
      .map((m) => (typeof m.method === 'string' ? m.method.slice(0, REFUSAL_FIELD_MAX) : '(no method)')),
    protocolVersion: request.headers.get('mcp-protocol-version')?.slice(0, REFUSAL_FIELD_MAX) ?? null,
    reason: reason.slice(0, REFUSAL_REASON_MAX),
  });
}

function unauthorized(definition: EndpointDefinition, id: unknown, error?: 'invalid_token', description?: string): Response {
  return jsonRpcError(401, -32001, description ?? `Sign in to ${brand.name} to continue.`, id, {
    'WWW-Authenticate': bearerChallenge(definition.id, error, description),
  });
}

export async function handleMcpRequest(request: Request, definition: EndpointDefinition): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== 'POST') {
    // Stateless server: no standalone SSE stream to open, no session to delete.
    return jsonRpcError(405, -32000, 'Method not allowed. Send JSON-RPC requests with POST.', null, {
      Allow: 'POST, OPTIONS',
    });
  }

  const ip = clientIp(request);
  const budget = await checkRequestBudget(definition.id, ip);
  if (!budget.allowed) {
    return jsonRpcError(429, -32000, 'Too many requests. Retry shortly.', null, {
      'Retry-After': String(budget.retryAfterSeconds),
    });
  }

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return jsonRpcError(413, -32600, 'Request body is too large.');
  let text: string;
  try {
    text = await request.text();
  } catch {
    return jsonRpcError(400, -32700, 'Request body could not be read.');
  }
  if (text.length > MAX_BODY_BYTES) return jsonRpcError(413, -32600, 'Request body is too large.');
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    logRefusal(definition, request, null, 400, 'The body is not valid JSON.');
    return jsonRpcError(400, -32700, 'Parse error: the body is not valid JSON.');
  }
  const id = firstId(body);

  let access: VerifiedAccess | null = null;
  const bearer = readBearer(request.headers.get('authorization'));
  if (bearer) {
    const verified = await verifyAccessToken(bearer, resourceUrl(definition.id), MCP_RESOURCES[definition.id].scope);
    if (!verified.ok) {
      if (verified.reason === 'insufficient_scope') {
        return jsonRpcError(403, -32001, 'This connection does not include that permission.', id, {
          'WWW-Authenticate': bearerChallenge(definition.id, 'insufficient_scope', 'Reconnect to grant access'),
        });
      }
      return unauthorized(definition, id, 'invalid_token', 'The access token is expired or not valid for this endpoint');
    }
    access = verified.access;
  }

  if (!access) {
    const anonymousAllowed = definition.id === 'candidate';
    if (!anonymousAllowed) return unauthorized(definition, id);
    if (signInRequiredCalls(body, definition).length > 0 && !carriesOpenAiMeta(body)) {
      return unauthorized(definition, id);
    }
  }

  const ctx: ToolContext = {
    endpoint: definition.id,
    access,
    baseUrl: getIssuer(),
    ip,
    requestMeta: requestMeta(body),
    ...(isChatGptRequest(request, body) ? { host: 'chatgpt' as const } : {}),
  };
  const server = buildMcpServer(definition, ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request, { parsedBody: body });
    let responseText = await response.text();
    // 4xx only: a transport failure is thrown and logged below.
    if (response.status >= 400 && response.status < 500) logRefusal(definition, request, body, response.status, responseText);
    if (messages(body).some((m) => m.method === 'tools/list')) {
      responseText = withSecuritySchemes(responseText, definition);
    }
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value);
    return new Response(response.status === 202 || responseText === '' ? null : responseText, {
      status: response.status,
      headers,
    });
  } catch (error) {
    logger.error('MCP request failed', error, { endpoint: definition.id });
    return jsonRpcError(500, -32603, 'Internal error.', id);
  } finally {
    await transport.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}
