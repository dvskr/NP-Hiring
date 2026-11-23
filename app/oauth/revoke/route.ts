import { NextRequest } from 'next/server';
import { authenticateClient, readClientCredentials } from '@/lib/mcp/oauth/clients';
import { clientIp, corsPreflight, oauthJson, readOAuthForm } from '@/lib/mcp/oauth/http';
import { revokeToken } from '@/lib/mcp/oauth/tokens';
import { checkRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

/**
 * POST /oauth/revoke (RFC 7009). Answers 200 for unknown tokens, as section
 * 2.2 requires, so the endpoint cannot be used to test whether a token
 * exists. Budgeted per IP and per registration, like /oauth/token.
 */
const PER_IP = { limit: 120, windowSeconds: 60 };
const PER_CLIENT = { limit: 30, windowSeconds: 60 };

function slowDown(): Response {
  return oauthJson({ error: 'slow_down', error_description: 'Too many requests. Retry shortly.' }, 429, {
    'Retry-After': '60',
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  const ip = clientIp(request);
  if (!(await checkRateLimit(`ratelimit:oauth-revoke:${ip}`, PER_IP)).success) return slowDown();

  const form = await readOAuthForm(request);
  if (!form.ok) return oauthJson({ error: 'invalid_request', error_description: form.description }, form.status);

  const credentials = readClientCredentials(request.headers.get('authorization'), form.params);
  const clientKey = (credentials.clientId ?? 'none').slice(0, 100);
  if (!(await checkRateLimit(`ratelimit:oauth-revoke:${clientKey}:${ip}`, PER_CLIENT)).success) return slowDown();
  const client = await authenticateClient(credentials);
  if (!client) {
    return oauthJson({ error: 'invalid_client', error_description: 'Client authentication failed.' }, 401);
  }

  try {
    await revokeToken(client, form.params.get('token'));
  } catch (error) {
    logger.error('OAuth revocation failed', error, { clientId: client.clientId });
    return oauthJson({ error: 'server_error', error_description: 'Revocation failed. Retry shortly.' }, 503);
  }
  return new Response(null, { status: 200, headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } });
}

export function OPTIONS(): Response {
  return corsPreflight('POST');
}
