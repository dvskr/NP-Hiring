/**
 * The run of an automated sender cron while the emergency brake
 * (lib/outbound-kill-switch.ts) is engaged: send-alerts, candidate-alerts,
 * saved-job-reminder, employer-report and push-notifications.
 *
 * Each of them used to answer the pause before withCronTracking, so a paused
 * run wrote no cron_runs row. The cron watchdog
 * (lib/inngest/functions/cron-watchdog.ts) reads the newest successful row of
 * each cron, so a pause longer than twice a cron's cadence read as a cron
 * that had stopped succeeding and raised an alert, and /admin/cron showed the
 * last real run going stale. Each of them now checks the brake as the first
 * statement of its tracked run and returns this result, so the run is
 * recorded as a success with metrics { paused: true }: nothing was sent and
 * nothing went wrong. It reads no rows and sends nothing.
 */
import { NextResponse } from 'next/server';
import type { CronRunResult } from '@/lib/cron/track';
import { OUTBOUND_PAUSED_MESSAGE } from '@/lib/outbound-kill-switch';

/** The metrics a paused run records in cron_runs. */
export const OUTBOUND_PAUSED_METRICS = { paused: true } as const;

/** What a sender cron's tracked run returns while the brake is engaged. */
export function outboundPausedRun(): CronRunResult {
    return {
        response: NextResponse.json({ enabled: false, paused: true, message: OUTBOUND_PAUSED_MESSAGE }),
        metrics: { ...OUTBOUND_PAUSED_METRICS },
    };
}
