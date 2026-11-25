import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import webpush from 'web-push'
import { verifyCronOrAdmin } from '@/lib/auth/verify-cron-or-admin';
import { sendCronFailureAlert } from '@/lib/discord-notifier';
import { withCronTracking } from '@/lib/cron/track';
import { logger } from '@/lib/logger';
import { brand } from '@/config/brand';
import { isOutboundPaused } from '@/lib/outbound-kill-switch';
import { outboundPausedRun } from '@/lib/cron/outbound-pause';

export const maxDuration = 120 // 2 minutes — push notifications to subscribers

// Set VAPID details (must set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY env vars)
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ''
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || ''

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
        `mailto:${brand.email.contact}`,
        VAPID_PUBLIC_KEY,
        VAPID_PRIVATE_KEY
    )
}

const VAPID_MISSING_MESSAGE = 'VAPID keys not configured'

/**
 * Thrown inside the tracked run when the VAPID keys are missing, so the run
 * is recorded as failed with that reason. Answered 500 as before, with no
 * failure alert of its own: the batch dispatcher reports the 500.
 */
class VapidKeysMissingError extends Error {
    constructor() {
        super(VAPID_MISSING_MESSAGE)
        this.name = 'VapidKeysMissingError'
    }
}

export async function GET(request: NextRequest) {
    const authError = await verifyCronOrAdmin(request);
    if (authError) return authError;

    try {
        return await withCronTracking('push-notifications', async () => {
            // Emergency brake (lib/outbound-kill-switch.ts). Push notifications
            // are not email, so sendAndLog never sees them: this check is their
            // only brake. First in the tracked run, before the VAPID keys and
            // the job query, so a pause costs nothing and is recorded as a run
            // that sent nothing (lib/cron/outbound-pause.ts).
            if (isOutboundPaused()) return outboundPausedRun()

            if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) throw new VapidKeysMissingError()

            // Get top 3 new jobs from last 24 hours
            const oneDayAgo = new Date()
            oneDayAgo.setDate(oneDayAgo.getDate() - 1)

            const newJobs = await prisma.job.findMany({
                where: {
                    isPublished: true,
                    // Never a free copy of a live paid post (lib/paid-post-twins.ts).
                    shadowedByJobId: null,
                    createdAt: { gt: oneDayAgo },
                    OR: [
                        { expiresAt: null },
                        { expiresAt: { gt: new Date() } },
                    ],
                },
                orderBy: [
                    { isFeatured: 'desc' },
                    { createdAt: 'desc' },
                ],
                take: 3,
                select: { id: true, title: true, employer: true, location: true },
            })

            if (newJobs.length === 0) {
                return {
                    response: NextResponse.json({ success: true, message: 'No new jobs', sent: 0 }),
                    metrics: { newJobs: 0, sent: 0 },
                }
            }

            const payload = JSON.stringify({
                title: `${newJobs.length} New ${brand.niche.short} Job${newJobs.length > 1 ? 's' : ''}`,
                body: newJobs.map(j => `${j.title} at ${j.employer}`).join('\n'),
                url: '/jobs',
                icon: '/icon-192x192.png',
                badge: '/favicon-48x48.png',
            })

            // Get all subscriptions
            const subscriptions = await prisma.pushSubscription.findMany()

            let sent = 0
            const staleIds: string[] = []

            for (const sub of subscriptions) {
                try {
                    await webpush.sendNotification(
                        {
                            endpoint: sub.endpoint,
                            keys: { p256dh: sub.p256dh, auth: sub.auth },
                        },
                        payload
                    )
                    sent++
                } catch (error: unknown) {
                    const statusCode = (error as { statusCode?: number })?.statusCode
                    // Remove expired/invalid subscriptions
                    if (statusCode === 410 || statusCode === 404) {
                        staleIds.push(sub.id)
                    }
                }
            }

            // Clean up stale subscriptions
            if (staleIds.length > 0) {
                await prisma.pushSubscription.deleteMany({
                    where: { id: { in: staleIds } },
                })
            }

            return {
                response: NextResponse.json({
                    success: true,
                    sent,
                    staleRemoved: staleIds.length,
                    totalSubscriptions: subscriptions.length,
                    timestamp: new Date().toISOString(),
                }),
                metrics: {
                    newJobs: newJobs.length,
                    sent,
                    staleRemoved: staleIds.length,
                    totalSubscriptions: subscriptions.length,
                },
            }
        })
    } catch (error) {
        if (error instanceof VapidKeysMissingError) {
            return NextResponse.json({ error: VAPID_MISSING_MESSAGE }, { status: 500 })
        }
        await sendCronFailureAlert('push-notifications', error);
        logger.error('Push notification cron error', error)
        return NextResponse.json({ error: 'Push notification failed' }, { status: 500 })
    }
}
