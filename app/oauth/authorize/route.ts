import { NextRequest } from 'next/server';
import { handleAuthorizeRequest } from '@/lib/mcp/oauth/authorize';
import { oauthErrorPage } from '@/lib/mcp/oauth/error-page';
import { checkRateLimit } from '@/lib/rate-limit';
import { clientIp } from '@/lib/mcp/oauth/http';
import { logger } from '@/lib/logger';

/**
 * GET /oauth/authorize
 *
 * Validates the request, parks it, and sends the browser to the consent
 * page. See lib/mcp/oauth/authorize.ts for which errors may be redirected
 * back to the client and which must stay on this origin.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const limit = await checkRateLimit(`ratelimit:oauth-authorize:${clientIp(request)}`, {
    limit: 60,
    windowSeconds: 60,
  });
  if (!limit.success) {
    return oauthErrorPage(429, 'Too many connection attempts from this network. Wait a minute and try again.');
  }

  try {
    const outcome = await handleAuthorizeRequest(request.nextUrl.searchParams);
    if (outcome.kind === 'error_page') return oauthErrorPage(outcome.status, outcome.message);
    // 302, not 301: the consent hop and every client redirect are one-off.
    return new Response(null, {
      status: 302,
      headers: { Location: outcome.location, 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    logger.error('OAuth authorize failed', error);
    return oauthErrorPage(500, 'Something went wrong starting the connection. Go back to the app and try again.');
  }
}
