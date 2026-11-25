import { NextRequest, NextResponse } from 'next/server';
import { brand } from '@/config/brand';
import { logger } from '@/lib/logger';
import { verifyCronOrAdmin } from '@/lib/auth/verify-cron-or-admin';
import { sendCronFailureAlert, sendDiscordMessage } from '@/lib/discord-notifier';
import { withCronTracking } from '@/lib/cron/track';
import { refreshSiteStats } from '@/lib/site-stats';
import { revalidateJobPage } from '@/lib/job-page-revalidation';
import {
    syncPaidPostTwins,
    verificationDigest,
    VERIFICATION_DIGEST_UTC_HOUR,
    type TwinSyncResult,
} from '@/lib/paid-post-twins-sync';

export const maxDuration = 60;

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || brand.baseUrl).replace(/\/$/, '');

/** Counts only: the typed names of the employers waiting stay out of the run log. */
function twinMetrics(twins: TwinSyncResult) {
    return {
        livePaidPosts: twins.livePaidPosts,
        candidates: twins.candidates,
        shadowed: twins.shadowed,
        newlyShadowed: twins.newlyShadowed,
        released: twins.released,
        linkedToCompany: twins.linkedToCompany,
        unlinkedFromCompany: twins.unlinkedFromCompany,
        awaitingVerification: twins.awaitingVerification.length,
        badgesGranted: twins.badgesGranted,
        badgesRemoved: twins.badgesRemoved,
    };
}

/**
 * Re-marks the free copies of live paid posts and keeps the Verified
 * employer check on exactly the confirmed employers' posts
 * (lib/paid-post-twins-sync.ts), then refreshes the cached pages of the posts
 * it changed. A failure leaves the previous marks in place and the counters
 * still refresh. It must not fail quietly, though: marks that outlive their
 * paid post keep a real role hidden, so it alerts like a failed cron.
 */
async function syncTwins(): Promise<TwinSyncResult | null> {
    try {
        const twins = await syncPaidPostTwins();
        for (const slug of twins.changedPostSlugs) revalidateJobPage(slug, 'refresh-site-stats');
        return twins;
    } catch (err) {
        logger.error('Paid-post twin sync failed; keeping the previous marks', err);
        await sendCronFailureAlert('refresh-site-stats: paid-post twin sync', err);
        return null;
    }
}

/**
 * Once a day, while paid posts wait at /admin/verify-employers, a Discord
 * reminder: nothing else tells the operator that a new one arrived.
 */
async function remindWaitingVerifications(twins: TwinSyncResult | null, now: Date): Promise<boolean> {
    if (!twins || now.getUTCHours() !== VERIFICATION_DIGEST_UTC_HOUR) return false;
    const digest = verificationDigest(twins.awaitingVerification, `${BASE_URL}/admin/verify-employers`);
    if (!digest) return false;
    const sent = await sendDiscordMessage(digest);
    if (!sent) logger.warn('The employer verification reminder did not reach Discord');
    return sent;
}

/**
 * Recomputes the cached site-wide counters (jobs / companies / subscribers)
 * into the SiteStat singleton row. The homepage reads from that row instead of
 * running the aggregate queries itself on every render. Runs hourly — the
 * numbers move slowly (jobs ingest in a few daily waves).
 *
 * It first re-marks the free copies of live paid posts (lib/paid-post-twins.ts).
 * The counters read activeIndexableJobWhere, which hides those copies, so
 * marking first keeps both on the same hour. This rides the existing hourly
 * cron rather than adding a schedule of its own.
 */
export async function GET(request: NextRequest) {
    const authError = await verifyCronOrAdmin(request);
    if (authError) return authError;

    try {
        return await withCronTracking('refresh-site-stats', async () => {
            const twins = await syncTwins();
            const reminded = await remindWaitingVerifications(twins, new Date());
            const stats = await refreshSiteStats();
            const twinSummary = twins && twinMetrics(twins);
            logger.info('refresh-site-stats complete', { ...stats, twins: twinSummary, reminded });
            return {
                response: NextResponse.json({ success: true, ...stats, twins: twinSummary }),
                metrics: { ...stats, twins: twinSummary, twinSyncFailed: twins === null, reminded },
            };
        });
    } catch (err) {
        await sendCronFailureAlert('refresh-site-stats', err);
        logger.error('Cron refresh-site-stats error', err);
        return NextResponse.json({ error: 'refresh-site-stats failed' }, { status: 500 });
    }
}
