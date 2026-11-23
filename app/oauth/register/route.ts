import { NextRequest } from 'next/server';
import { isRegistrationError, registerClient, validateRegistration } from '@/lib/mcp/oauth/clients';
import { clientIp, corsPreflight, oauthJson } from '@/lib/mcp/oauth/http';
import { checkRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

/**
 * POST /oauth/register: Dynamic Client Registration (RFC 7591).
 *
 * Open by design (see lib/mcp/oauth/clients.ts), so it is bounded twice: per
 * IP, which is still far above what a host needs (each connection registers
 * once), and across every caller per day, which caps how many rows open
 * registration can add before the cleanup cron removes the unused ones.
 */
const PER_IP = { limit: 10, windowSeconds: 60 };
const ALL_CALLERS_PER_DAY = { limit: 5000, windowSeconds: 24 * 60 * 60 };

export async function POST(request: NextRequest): Promise<Response> {
  const [perIp, allCallers] = await Promise.all([
    checkRateLimit(`ratelimit:oauth-register:${clientIp(request)}`, PER_IP),
    checkRateLimit('ratelimit:oauth-register:all', ALL_CALLERS_PER_DAY),
  ]);
  if (!perIp.success || !allCallers.success) {
    return oauthJson({ error: 'slow_down', error_description: 'Too many registrations. Retry shortly.' }, 429, {
      'Retry-After': '60',
    });
  }

  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > 32 * 1024) {
      return oauthJson({ error: 'invalid_client_metadata', error_description: 'Registration body is too large.' }, 400);
    }
    body = JSON.parse(text);
  } catch {
    return oauthJson({ error: 'invalid_client_metadata', error_description: 'Registration body must be JSON.' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return oauthJson({ error: 'invalid_client_metadata', error_description: 'Registration body must be a JSON object.' }, 400);
  }

  const validated = validateRegistration(body as Record<string, unknown>);
  if (isRegistrationError(validated)) return oauthJson(validated, 400);

  try {
    const registered = await registerClient(validated);
    logger.info('MCP OAuth client registered', {
      clientId: registered.client_id,
      authMethod: registered.token_endpoint_auth_method,
      redirectHosts: validated.redirectUris.map((u) => {
        try {
          return new URL(u).host || new URL(u).protocol;
        } catch {
          return 'unparseable';
        }
      }),
    });
    return oauthJson(registered, 201);
  } catch (error) {
    logger.error('MCP OAuth client registration failed', error);
    return oauthJson({ error: 'server_error', error_description: 'Registration failed. Retry shortly.' }, 500);
  }
}

export function OPTIONS(): Response {
  return corsPreflight('POST');
}
