import { NextRequest } from 'next/server';
import { authenticateClient, readClientCredentials } from '@/lib/mcp/oauth/clients';
import { clientIp, corsPreflight, oauthJson, readOAuthForm } from '@/lib/mcp/oauth/http';
import { exchangeAuthorizationCode, isTokenError, refreshAccessToken } from '@/lib/mcp/oauth/tokens';
import { checkRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

/**
 * POST /oauth/token: authorization_code and refresh_token grants.
 *
 * Errors follow RFC 6749 section 5.2. A failed client authentication is a
 * 401 with a WWW-Authenticate challenge when the client tried HTTP Basic,
 * as the RFC requires, and a plain 401 otherwise.
 *
 * Every ChatGPT or Claude user arrives from that host's few addresses, so
 * the per-IP budget is wide and only bounds abuse. Each registration also
 * gets its own budget, so one busy or broken connection cannot use up the
 * allowance its host's other users share.
 */
const PER_IP = { limit: 600, windowSeconds: 60 };
const PER_CLIENT = { limit: 60, windowSeconds: 60 };

function slowDown(): Response {
  return oauthJson({ error: 'slow_down', error_description: 'Too many token requests. Retry shortly.' }, 429, {
    'Retry-After': '60',
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  const ip = clientIp(request);
  if (!(await checkRateLimit(`ratelimit:oauth-token:${ip}`, PER_IP)).success) return slowDown();

  const form = await readOAuthForm(request);
  if (!form.ok) return oauthJson({ error: 'invalid_request', error_description: form.description }, form.status);
  const params = form.params;

  const credentials = readClientCredentials(request.headers.get('authorization'), params);
  const clientKey = (credentials.clientId ?? 'none').slice(0, 100);
  if (!(await checkRateLimit(`ratelimit:oauth-token:${clientKey}:${ip}`, PER_CLIENT)).success) return slowDown();
  const client = await authenticateClient(credentials);
  if (!client) {
    return oauthJson(
      { error: 'invalid_client', error_description: 'Client authentication failed.' },
      401,
      credentials.method === 'client_secret_basic' ? { 'WWW-Authenticate': 'Basic realm="oauth"' } : {},
    );
  }

  try {
    const grantType = params.get('grant_type');
    const result =
      grantType === 'authorization_code'
        ? await exchangeAuthorizationCode({
            client,
            code: params.get('code'),
            redirectUri: params.get('redirect_uri'),
            codeVerifier: params.get('code_verifier'),
            resource: params.get('resource'),
          })
        : grantType === 'refresh_token'
          ? await refreshAccessToken({
              client,
              refreshToken: params.get('refresh_token'),
              resource: params.get('resource'),
              scope: params.get('scope'),
            })
          : ({
              status: 400,
              error: 'unsupported_grant_type',
              error_description: 'Only authorization_code and refresh_token are supported.',
            } as const);

    if (isTokenError(result)) {
      const { status, ...body } = result;
      return oauthJson(body, status);
    }
    return oauthJson(result, 200);
  } catch (error) {
    logger.error('OAuth token request failed', error, { clientId: client.clientId });
    return oauthJson({ error: 'server_error', error_description: 'Token request failed. Retry shortly.' }, 500);
  }
}

export function OPTIONS(): Response {
  return corsPreflight('POST');
}
