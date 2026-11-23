import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyCsrf } from '@/lib/csrf';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { readJsonObject } from '@/lib/request-body';
import { disconnectApp, listConnectedApps } from '@/lib/mcp/oauth/grants';
import { logger } from '@/lib/logger';

/**
 * GET    /api/oauth/connected-apps          the apps this account has approved
 * DELETE /api/oauth/connected-apps          { grantId } disconnects one
 *
 * Disconnecting revokes the grant and every token it issued, so the app's
 * next MCP call fails and it has to ask for permission again.
 */
export async function GET(request: NextRequest) {
  const limited = await rateLimit(request, 'oauth-connected-apps', RATE_LIMITS.profile);
  if (limited) return limited;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ apps: await listConnectedApps(user.id) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    logger.error('Listing connected apps failed', error);
    return NextResponse.json({ error: 'Could not load connected apps.' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const csrfError = verifyCsrf(request);
  if (csrfError) return csrfError;
  const limited = await rateLimit(request, 'oauth-connected-apps', RATE_LIMITS.profile);
  if (limited) return limited;

  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: 'Request body must be a JSON object.' }, { status: 400 });
  const { grantId } = body as { grantId?: unknown };

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const disconnected = await disconnectApp(user.id, grantId);
    if (!disconnected) return NextResponse.json({ error: 'That app is not connected to your account.' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('Disconnecting an app failed', error);
    return NextResponse.json({ error: 'Could not disconnect the app.' }, { status: 500 });
  }
}
