import { NextRequest, NextResponse } from 'next/server'
import { sendJobAlerts } from '@/lib/job-alerts-service'
import { logger } from '@/lib/logger'
import { verifyCronOrAdmin } from '@/lib/auth/verify-cron-or-admin';
import { sendCronFailureAlert } from '@/lib/discord-notifier';
import { withCronTracking } from '@/lib/cron/track';
import { isOutboundPaused } from '@/lib/outbound-kill-switch';
import { outboundPausedRun } from '@/lib/cron/outbound-pause';

export const maxDuration = 60

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authError = await verifyCronOrAdmin(request);
  if (authError) return authError;

  try {
    return await withCronTracking('send-alerts', async () => {
      // Emergency brake (lib/outbound-kill-switch.ts). Job alert digests go
      // out through the provider's batch API, not sendAndLog, so this cron
      // needs its own check: without it the brake would leave the
      // highest-volume automated sender running. First in the tracked run,
      // so the pause is recorded as a run that sent nothing
      // (lib/cron/outbound-pause.ts), not read as a silent cron.
      if (isOutboundPaused()) return outboundPausedRun();

      // Use the job alerts service (GAP FIX 2)
      const results = await sendJobAlerts()

      logger.info('Job alerts complete', results)

      return {
        response: NextResponse.json({
          success: true,
          alertsSent: results.sent,
          alertsSkipped: results.skipped,
          errors: results.errors,
          timestamp: new Date().toISOString(),
        }),
        metrics: {
          alertsSent: results.sent,
          alertsSkipped: results.skipped,
          errors: results.errors,
        },
      };
    });
  } catch (error) {
      await sendCronFailureAlert('send-alerts', error);
    logger.error('Cron send-alerts error', error)
    return NextResponse.json({ error: 'Alert sending failed' }, { status: 500 })
  }
}
