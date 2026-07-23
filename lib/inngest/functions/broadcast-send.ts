/**
 * Durable admin-broadcast execution — F23.
 *
 * Previously /api/admin/email/send fired `executeBroadcast(id)` without
 * awaiting it and returned the HTTP response; on Vercel the function
 * instance freezes the moment the response is sent, so any audience big
 * enough to outlive the request (>50 recipients ≈ 5+ minutes at the rate
 * limits) stalled mid-send. The broadcast stayed status='sending' with
 * recipients stuck 'pending' forever — nothing resumed it.
 *
 * Now the route emits BROADCAST_REQUESTED_EVENT and this function drives the
 * send as a chain of durable steps:
 *   - each step processes one chunk of pending recipients
 *     (processBroadcastChunk persists per-recipient outcomes + counters);
 *   - a killed/redeployed run resumes from the last completed step, and the
 *     'pending'-status query means re-running a partial chunk never
 *     double-sends more than the single in-flight recipient;
 *   - per-broadcast concurrency of 1 stops a sweep re-emit from racing an
 *     active run.
 *
 * broadcastStuckSweep is the safety net: every 30 minutes it re-emits the
 * event for broadcasts stuck in 'sending' with no progress, and finalizes
 * ones whose recipients are all done but whose terminal status write was
 * lost.
 */

import { inngest, BROADCAST_REQUESTED_EVENT } from '@/lib/inngest/client';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import {
    processBroadcastChunk,
    finalizeBroadcast,
    BROADCAST_CHUNK_SIZE,
} from '@/lib/broadcast-sender';

/**
 * Chunk-step budget per run. Inngest caps steps per run, so gigantic
 * audiences chain a follow-up event instead of exhausting the budget:
 * 400 chunks × 25 recipients = 10,000 emails per run.
 */
const MAX_CHUNKS_PER_RUN = 400;

/** A 'sending' broadcast with no counter/status write for this long is stuck. */
const STUCK_AFTER_MS = 30 * 60 * 1000;

export const broadcastSend = inngest.createFunction(
    {
        id: 'admin-broadcast-send',
        name: 'Admin: execute email broadcast (resumable)',
        triggers: [{ event: BROADCAST_REQUESTED_EVENT }],
        retries: 3,
        // One run per broadcast at a time — a stuck-sweep re-emit while a
        // run is active queues behind it instead of double-sending.
        concurrency: { limit: 1, key: 'event.data.broadcastId' },
    },
    async ({ event, step }) => {
        const broadcastId = (event.data as { broadcastId?: unknown })?.broadcastId;
        if (!broadcastId || typeof broadcastId !== 'string') {
            throw new Error('admin/broadcast.requested event missing broadcastId');
        }

        const shouldRun = await step.run('mark-sending', async () => {
            const broadcast = await prisma.emailBroadcast.findUnique({
                where: { id: broadcastId },
                select: { id: true, status: true },
            });
            if (!broadcast) {
                logger.warn('[BroadcastSend] Broadcast not found — dropping event', { broadcastId });
                return false;
            }
            if (broadcast.status === 'sent' || broadcast.status === 'failed') {
                // Duplicate/late event for a finished broadcast — no-op.
                return false;
            }
            await prisma.emailBroadcast.update({
                where: { id: broadcastId },
                data: { status: 'sending' },
            });
            return true;
        });

        if (!shouldRun) {
            return { broadcastId, skipped: true };
        }

        let processed = 0;
        let sent = 0;
        let failed = 0;
        let skipped = 0;

        for (let chunkIndex = 0; chunkIndex < MAX_CHUNKS_PER_RUN; chunkIndex++) {
            const chunk = await step.run(`send-chunk-${chunkIndex}`, () =>
                processBroadcastChunk(broadcastId, BROADCAST_CHUNK_SIZE),
            );

            processed += chunk.processed;
            sent += chunk.sent;
            failed += chunk.failed;
            skipped += chunk.skipped;

            if (!chunk.hasMore) {
                const final = await step.run('finalize', () => finalizeBroadcast(broadcastId));
                return { broadcastId, processed, sent, failed, skipped, status: final.status };
            }

            // Same inter-batch pacing as the synchronous sender, but durable.
            await step.sleep(`inter-chunk-pause-${chunkIndex}`, '2s');
        }

        // Chunk budget exhausted (very large audience) — chain a follow-up
        // run; the per-broadcast concurrency key keeps ordering safe.
        await step.sendEvent('chain-next-run', {
            name: BROADCAST_REQUESTED_EVENT,
            data: { broadcastId },
        });
        return { broadcastId, processed, sent, failed, skipped, chained: true };
    },
);

export const broadcastStuckSweep = inngest.createFunction(
    {
        id: 'admin-broadcast-stuck-sweep',
        name: 'Admin: resume stuck email broadcasts',
        triggers: [{ cron: 'TZ=UTC */30 * * * *' }],
        retries: 1,
    },
    async ({ step }) => {
        const staleBefore = new Date(Date.now() - STUCK_AFTER_MS);

        // Broadcasts stuck mid-send: still 'sending', recipients waiting,
        // and no progress writes for STUCK_AFTER_MS (every chunk bumps
        // updatedAt via the counter increments, so active runs never match).
        const stuckIds = await step.run('find-stuck-broadcasts', async () => {
            const rows = await prisma.emailBroadcast.findMany({
                where: {
                    status: 'sending',
                    updatedAt: { lt: staleBefore },
                    recipients: { some: { status: 'pending' } },
                },
                select: { id: true },
                take: 10,
            });
            return rows.map((r) => r.id);
        });

        if (stuckIds.length > 0) {
            await step.sendEvent(
                'resume-stuck-broadcasts',
                stuckIds.map((id) => ({
                    name: BROADCAST_REQUESTED_EVENT,
                    data: { broadcastId: id },
                })),
            );
            logger.info('[BroadcastSweep] Re-queued stuck broadcasts', { count: stuckIds.length, broadcastIds: stuckIds });
        }

        // Broadcasts that finished every recipient but died before the
        // terminal-status write: flip them to sent/failed directly.
        const finalizedCount = await step.run('finalize-completed-broadcasts', async () => {
            const rows = await prisma.emailBroadcast.findMany({
                where: {
                    status: 'sending',
                    updatedAt: { lt: staleBefore },
                    recipients: { none: { status: 'pending' } },
                },
                select: { id: true },
                take: 10,
            });
            for (const row of rows) {
                await finalizeBroadcast(row.id);
            }
            return rows.length;
        });

        return { resumed: stuckIds.length, finalized: finalizedCount };
    },
);

export const broadcastFunctions = [broadcastSend, broadcastStuckSweep] as const;
