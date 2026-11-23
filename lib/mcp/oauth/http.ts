/**
 * Response and request helpers shared by the OAuth endpoints.
 *
 * The token, registration and revocation endpoints are called by servers
 * (ChatGPT, Claude) and by browser-based MCP clients such as the MCP
 * Inspector. None of them authenticates with a cookie, so a wildcard CORS
 * origin grants nothing a direct server call could not already do, and it
 * is what lets the browser-based clients work at all.
 */

const CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version',
  'Access-Control-Max-Age': '86400',
};

export function oauthJson(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      // RFC 6749 section 5.1: token responses must not be cached.
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      ...CORS_HEADERS,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      ...headers,
    },
  });
}

export function corsPreflight(methods: string): Response {
  return new Response(null, {
    status: 204,
    headers: { ...CORS_HEADERS, 'Access-Control-Allow-Methods': `${methods}, OPTIONS` },
  });
}

/** Bodies larger than this are refused before parsing. Real requests are under 4 KB. */
const MAX_BODY_BYTES = 32 * 1024;

export type FormResult = { ok: true; params: URLSearchParams } | { ok: false; status: number; description: string };

/**
 * Reads an OAuth request body. RFC 6749 specifies form encoding; JSON is
 * accepted as well because some clients send it, and refusing them helps
 * nobody.
 */
export async function readOAuthForm(request: Request): Promise<FormResult> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return { ok: false, status: 413, description: 'Request body is too large.' };

  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, status: 400, description: 'Request body could not be read.' };
  }
  if (text.length > MAX_BODY_BYTES) return { ok: false, status: 413, description: 'Request body is too large.' };

  const contentType = (request.headers.get('content-type') ?? '').toLowerCase();
  if (contentType.includes('application/json')) {
    try {
      const parsed: unknown = JSON.parse(text || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, status: 400, description: 'Request body must be a JSON object.' };
      }
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value === 'string') params.set(key, value);
        else if (typeof value === 'number' || typeof value === 'boolean') params.set(key, String(value));
      }
      return { ok: true, params };
    } catch {
      return { ok: false, status: 400, description: 'Request body must be valid JSON.' };
    }
  }
  return { ok: true, params: new URLSearchParams(text) };
}

/** Best-effort client IP for rate limiting, the same derivation lib/rate-limit.ts uses. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}
