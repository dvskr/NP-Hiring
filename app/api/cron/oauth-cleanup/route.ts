import { NextRequest, NextResponse } from 'next/server';
import { verifyCronOrAdmin } from '@/lib/auth/verify-cron-or-admin';
import { withCronTracking } from '@/lib/cron/track';
import { purgeSpentOAuthRows } from '@/lib/mcp/oauth/grants';
import { purgeExpiredPendingActions } from '@/lib/mcp/server/pending-actions';
import { logger } from '@/lib/logger';

export const maxDuration = 60;

/**
 * Daily cleanup for the AI assistant connectors: parked authorization
 * requests past their 30 minutes, spent codes and tokens after 7 days,
 * disconnected connections after 30, registrations with no connection after
 * 30, and application and posting reviews a day after they expire. The
 * retention matches what the privacy policy publishes (sections 11 and 17).
 */
export async function GET(request: NextRequest) {
  const authError = await verifyCronOrAdmin(request);
  if (authError) return authError;

  try {
    return await withCronTracking('oauth-cleanup', async () => {
      const deleted = { ...(await purgeSpentOAuthRows()), reviews: await purgeExpiredPendingActions() };
      logger.info('OAuth cleanup finished', deleted);
      return { response: NextResponse.json({ success: true, deleted }), metrics: deleted };
    });
  } catch (error) {
    logger.error('OAuth cleanup failed', error);
    return NextResponse.json({ success: false, error: 'OAuth cleanup failed' }, { status: 500 });
  }
}
