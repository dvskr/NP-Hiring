import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiAdminActor } from '@/lib/auth/require-api-admin';
import { verifyCsrf } from '@/lib/csrf';
import { logAudit } from '@/lib/audit-log';
import { BROADCAST_STALE_AFTER_MS } from '@/lib/broadcast-sender';
import { inngest, BROADCAST_REQUESTED_EVENT } from '@/lib/inngest/client';
import { logger } from '@/lib/logger';
import { readJsonObject, stringField } from '@/lib/request-body';
import { isOutboundPaused, OUTBOUND_PAUSED_MESSAGE } from '@/lib/outbound-kill-switch';

/** Longest broadcast id accepted (ids are cuids, far shorter). */
const MAX_BROADCAST_ID_LENGTH = 64;
const STALE_MINUTES = Math.round(BROADCAST_STALE_AFTER_MS / 60_000);

function jsonError(error: string, status: number): NextResponse {
    return NextResponse.json({ success: false, error }, { status });
}

function recipientsLabel(count: number): string {
    return `${count.toLocaleString('en-US')} ${count === 1 ? 'recipient' : 'recipients'}`;
}

/**
 * Takes the broadcast for this resume with one conditional UPDATE: it matches
 * only a broadcast still 'sending' and silent for longer than any sender can
 * live (BROADCAST_STALE_AFTER_MS, the window the stuck-broadcast sweep uses).
 * The fresh updatedAt it writes is the claim: a second click, or the sweep,
 * re-reads the row after this commits and no longer matches, so a stalled
 * broadcast is handed over once.
 */
async function claimStalledBroadcast(broadcastId: string, claimedAt: Date): Promise<boolean> {
    const claimed = await prisma.emailBroadcast.updateMany({
        where: {
            id: broadcastId,
            status: 'sending',
            updatedAt: { lt: new Date(claimedAt.getTime() - BROADCAST_STALE_AFTER_MS) },
        },
        data: { updatedAt: claimedAt },
    });
    return claimed.count === 1;
}

/**
 * Gives the claim back when the hand-over fails, so the admin can try again
 * at once instead of waiting out the window. Only the stamp this request
 * wrote is undone; a failure to undo it is logged, and the sweep then picks
 * the broadcast up after the window as before.
 */
async function releaseClaim(broadcastId: string, claimedAt: Date, previousUpdatedAt: Date): Promise<void> {
    try {
        await prisma.emailBroadcast.updateMany({
            where: { id: broadcastId, updatedAt: claimedAt },
            data: { updatedAt: previousUpdatedAt },
        });
    } catch (err) {
        logger.error('[Admin Email Resume] could not give the claim back', err, { broadcastId });
    }
}

async function resumeBroadcast(broadcastId: string, actorId: string): Promise<NextResponse> {
    const broadcast = await prisma.emailBroadcast.findUnique({
        where: { id: broadcastId },
        select: { id: true, status: true, updatedAt: true },
    });
    if (!broadcast) return jsonError('Broadcast not found', 404);
    if (broadcast.status !== 'sending') {
        return jsonError(`Only a broadcast that is still sending can be resumed (this one is ${broadcast.status}).`, 409);
    }

    const pending = await prisma.emailBroadcastRecipient.count({ where: { broadcastId, status: 'pending' } });

    const claimedAt = new Date();
    if (!(await claimStalledBroadcast(broadcastId, claimedAt))) {
        return jsonError(
            `This broadcast may still be sending. It can be resumed once it has made no progress for ${STALE_MINUTES} minutes, and the background sender also picks it up on its own after that. Check History again later.`,
            409,
        );
    }

    try {
        await inngest.send({ name: BROADCAST_REQUESTED_EVENT, data: { broadcastId } });
    } catch (err) {
        await releaseClaim(broadcastId, claimedAt, broadcast.updatedAt);
        logger.error('[Admin Email Resume] Inngest event send failed', err, { broadcastId });
        return jsonError('The background sender could not be reached, so nothing was resumed. Try Resume again.', 503);
    }

    await logAudit({
        action: 'admin.email.broadcast_resume',
        actorType: 'admin',
        actorId,
        targetType: 'email_broadcast',
        targetId: broadcastId,
        metadata: { pending },
    });

    return NextResponse.json({
        success: true,
        broadcastId,
        pending,
        message: pending > 0
            ? `Resuming: ${recipientsLabel(pending)} still to send. Check History for progress.`
            : 'No recipients are left to send. The broadcast will be marked complete shortly.',
    });
}

/**
 * POST /api/admin/email/resume
 * Body: { broadcastId }
 *
 * Hands a broadcast that stopped partway (still 'sending', no progress for
 * BROADCAST_STALE_AFTER_MS) back to the background sender now, instead of
 * waiting for the stuck-broadcast sweep (lib/inngest/functions/broadcast-send.ts),
 * which does the same every 30 minutes. It emits the event the sweep emits,
 * so it adds no new way of sending:
 *  - only recipients still 'pending' are sent; nobody recorded as sent, failed
 *    or skipped is mailed again;
 *  - the background function runs one step at a time per broadcast, so a
 *    resumed run queues behind any run that is still alive;
 *  - the claim makes a second click a 409, not a second hand-over.
 * There is no in-process fallback here: a sender outside the background
 * queue is the one thing that could run beside another and mail someone
 * twice.
 */
export async function POST(req: NextRequest) {
    const { error: authError, actor } = await requireApiAdminActor(req);
    if (authError) return authError;

    // Defence in depth: middleware.ts already gates every /api/* mutation.
    const csrfError = verifyCsrf(req);
    if (csrfError) return csrfError;

    if (isOutboundPaused()) return jsonError(OUTBOUND_PAUSED_MESSAGE, 503);
    if (!process.env.INNGEST_EVENT_KEY) {
        return jsonError('Background sending is not set up (INNGEST_EVENT_KEY is missing), so a broadcast cannot be resumed from here.', 503);
    }

    const input = await readJsonObject(req);
    const broadcastId = stringField(input?.broadcastId, MAX_BROADCAST_ID_LENGTH);
    if (!broadcastId) return jsonError('broadcastId is required', 400);

    try {
        return await resumeBroadcast(broadcastId, actor.profileId);
    } catch (error) {
        logger.error('[Admin Email Resume] Error', error, { broadcastId });
        return jsonError('Failed to resume broadcast', 500);
    }
}
