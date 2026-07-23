import { prisma } from '@/lib/prisma';
import { sendBroadcastEmail, buildBroadcastHtml, isEmailSuppressed, getOrCreateUnsubToken } from '@/lib/email-service';
import { logger } from '@/lib/logger';

// ── Rate limiting config (Resend Pro: 10/sec) ──────────────────
const BATCH_SIZE = 10;
const EMAIL_DELAY_MS = 150;  // 150ms between emails (~6.6/sec, safe margin)
const BATCH_DELAY_MS = 2000;
const MAX_RETRIES = 3;

/**
 * F23: recipients processed per resumable chunk. Each chunk is one Inngest
 * step (lib/inngest/functions/broadcast-send.ts) — ~25 × (150ms delay + send
 * RTT) ≈ 15-20s, comfortably inside a serverless invocation. Progress is
 * persisted per recipient, so a killed run resumes at the next pending
 * recipient instead of restarting or stalling forever.
 */
export const BROADCAST_CHUNK_SIZE = 25;

// Safety valve for the synchronous path — it's only used for ≤50-recipient
// sends, so this is never a real constraint.
const MAX_SYNC_CHUNKS = 200;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Replace merge tags in subject/body with real recipient data.
 * Exported so the admin test-send path renders exactly what a real
 * broadcast recipient would receive.
 */
export function personalize(text: string, data: { email: string; firstName?: string | null }): string {
    return text
        .replace(/\{\{firstName\}\}/g, data.firstName || 'there')
        .replace(/\{\{email\}\}/g, data.email);
}

/**
 * Convert simple markdown-ish body text to email-safe HTML.
 * Handles: paragraphs, bold, italic, links, line breaks.
 * Exported so the admin test-send path renders exactly what a real
 * broadcast recipient would receive.
 */
export function markdownToEmailHtml(md: string): string {
    return md
        .split(/\n{2,}/)
        .map(para => {
            let html = para.trim();
            // Bold
            html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
            // Italic
            html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
            // Links [text](url)
            html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color: #F472B6; text-decoration: none;">$1</a>');
            // Line breaks
            html = html.replace(/\n/g, '<br>');
            return `<p style="margin: 0 0 16px;">${html}</p>`;
        })
        .join('\n');
}

export interface BroadcastProgress {
    broadcastId: string;
    total: number;
    sent: number;
    failed: number;
    skipped: number;
    status: 'sending' | 'sent' | 'failed';
}

export interface BroadcastChunkResult {
    broadcastId: string;
    processed: number;
    sent: number;
    failed: number;
    skipped: number;
    /** True when the chunk was full — more pending recipients may remain. */
    hasMore: boolean;
}

export interface BroadcastFinalizeResult {
    broadcastId: string;
    finalized: boolean;
    status: 'sending' | 'sent' | 'failed';
    sent: number;
    failed: number;
}

/**
 * Process up to `limit` pending recipients of a broadcast — the resumable
 * unit of work. Every recipient's outcome is persisted immediately
 * (sent / failed / skipped), and the broadcast's running counters are
 * incremented at the end of the chunk, so a killed process loses at most
 * the in-flight recipient and a resume picks up exactly where it stopped.
 */
export async function processBroadcastChunk(
    broadcastId: string,
    limit: number = BROADCAST_CHUNK_SIZE,
): Promise<BroadcastChunkResult> {
    const broadcast = await prisma.emailBroadcast.findUnique({
        where: { id: broadcastId },
    });

    if (!broadcast) {
        throw new Error(`Broadcast ${broadcastId} not found`);
    }

    const recipients = await prisma.emailBroadcastRecipient.findMany({
        where: { broadcastId, status: 'pending' },
        orderBy: { id: 'asc' },
        take: limit,
    });

    if (recipients.length === 0) {
        return { broadcastId, processed: 0, sent: 0, failed: 0, skipped: 0, hasMore: false };
    }

    let sent = 0;
    let failed = 0;
    let skipped = 0;

    // Pre-render the base HTML (merge tags still present for per-recipient personalization)
    const bodyHtml = markdownToEmailHtml(broadcast.body);

    for (let i = 0; i < recipients.length; i++) {
        const recipient = recipients[i];

        // Respect the Resend rate limit inside a chunk: pause between
        // sub-batches of BATCH_SIZE, same rhythm as the original sender.
        if (i > 0 && i % BATCH_SIZE === 0) {
            await sleep(BATCH_DELAY_MS);
        }

        try {
            // Honor the suppression list (bounced / complained / unsubscribed /
            // soft-deleted). Sending to these addresses harms deliverability and
            // breaks CAN-SPAM/GDPR opt-out guarantees. Mark as skipped, not
            // failed, so it doesn't inflate the failure rate or flip final status.
            if (await isEmailSuppressed(recipient.email)) {
                await prisma.emailBroadcastRecipient.update({
                    where: { id: recipient.id },
                    data: { status: 'skipped', error: 'suppressed' },
                });
                skipped++;
                continue;
            }

            // F17: mint the per-recipient unsubscribe token so the footer's
            // in-body Unsubscribe / Manage-preferences links actually work
            // (unsubscribeFooterV2 renders the generic fallback without it).
            // Token failure must never block the send — sendBroadcastEmail
            // still sets the List-Unsubscribe header from its own lookup.
            let unsubToken: string | undefined;
            try {
                unsubToken = await getOrCreateUnsubToken(recipient.email);
            } catch (tokenErr) {
                logger.warn(`[Broadcast] Failed to mint unsubscribe token for ${recipient.email}`, {
                    broadcastId,
                    error: tokenErr instanceof Error ? tokenErr.message : String(tokenErr),
                });
            }

            const personalizedBody = personalize(bodyHtml, {
                email: recipient.email,
                firstName: recipient.firstName,
            });
            const personalizedSubject = personalize(broadcast.subject, {
                email: recipient.email,
                firstName: recipient.firstName,
            });

            const html = buildBroadcastHtml(personalizedBody, personalizedSubject, unsubToken);

            // Send with retry
            let success = false;
            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                const result = await sendBroadcastEmail(recipient.email, personalizedSubject, html);

                if (result.success) {
                    success = true;
                    break;
                }

                const isRateLimit = result.error?.includes('429') || result.error?.includes('rate') || result.error?.includes('Too Many');
                if (isRateLimit && attempt < MAX_RETRIES) {
                    const backoff = EMAIL_DELAY_MS * Math.pow(2, attempt);
                    logger.warn(`[Broadcast] Rate limited for ${recipient.email}, retrying in ${backoff}ms`);
                    await sleep(backoff);
                } else {
                    // Mark failed
                    await prisma.emailBroadcastRecipient.update({
                        where: { id: recipient.id },
                        data: { status: 'failed', error: result.error || 'Unknown error' },
                    });
                    failed++;
                    logger.error(`[Broadcast] Failed to send to ${recipient.email}`, null, { error: result.error });
                    break;
                }
            }

            if (success) {
                await prisma.emailBroadcastRecipient.update({
                    where: { id: recipient.id },
                    data: { status: 'sent', sentAt: new Date() },
                });
                sent++;
            }
        } catch (recipientErr) {
            // One broken recipient (bad row, DB hiccup) must not kill the
            // whole broadcast — record the failure and move on.
            logger.error(`[Broadcast] Unexpected error processing ${recipient.email}`, recipientErr, { broadcastId });
            try {
                await prisma.emailBroadcastRecipient.update({
                    where: { id: recipient.id },
                    data: {
                        status: 'failed',
                        error: recipientErr instanceof Error ? recipientErr.message : 'Unexpected processing error',
                    },
                });
                failed++;
            } catch (markErr) {
                logger.error('[Broadcast] Failed to mark recipient failed', markErr, { broadcastId, recipientId: recipient.id });
            }
        }

        // Delay between individual emails
        await sleep(EMAIL_DELAY_MS);
    }

    // Persist chunk progress. Increments (not absolute writes) keep the
    // counters correct when chunks run across separate invocations.
    await prisma.emailBroadcast.update({
        where: { id: broadcastId },
        data: {
            sentCount: { increment: sent },
            failedCount: { increment: failed },
        },
    });

    return {
        broadcastId,
        processed: recipients.length,
        sent,
        failed,
        skipped,
        hasMore: recipients.length === limit,
    };
}

/**
 * Flip the broadcast to its terminal status once no pending recipients
 * remain in the chunk stream. Reads the persisted counters (kept current by
 * processBroadcastChunk's increments) so it works from any invocation —
 * the original run, an Inngest resume, or the stuck-broadcast sweep.
 */
export async function finalizeBroadcast(broadcastId: string): Promise<BroadcastFinalizeResult> {
    const broadcast = await prisma.emailBroadcast.findUnique({
        where: { id: broadcastId },
    });

    if (!broadcast) {
        throw new Error(`Broadcast ${broadcastId} not found`);
    }

    const sent = broadcast.sentCount;
    const failed = broadcast.failedCount;
    const finalStatus: 'sent' | 'failed' = failed > 0 && sent === 0 ? 'failed' : 'sent';

    await prisma.emailBroadcast.update({
        where: { id: broadcastId },
        data: {
            status: finalStatus,
            sentAt: new Date(),
        },
    });

    logger.info(`[Broadcast] Complete: ${sent} sent, ${failed} failed`, { broadcastId });

    return { broadcastId, finalized: true, status: finalStatus, sent, failed };
}

/**
 * Execute a broadcast send synchronously — used by the admin route for small
 * (≤50 recipient) audiences only. Large audiences run on Inngest via
 * lib/inngest/functions/broadcast-send.ts, which drives the same
 * processBroadcastChunk/finalizeBroadcast primitives as durable steps.
 */
export async function executeBroadcast(broadcastId: string): Promise<BroadcastProgress> {
    const broadcast = await prisma.emailBroadcast.findUnique({
        where: { id: broadcastId },
    });

    if (!broadcast) {
        throw new Error(`Broadcast ${broadcastId} not found`);
    }

    // Mark as sending
    await prisma.emailBroadcast.update({
        where: { id: broadcastId },
        data: { status: 'sending' },
    });

    let processed = 0;
    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (let chunkIndex = 0; chunkIndex < MAX_SYNC_CHUNKS; chunkIndex++) {
        const chunk = await processBroadcastChunk(broadcastId, BROADCAST_CHUNK_SIZE);
        processed += chunk.processed;
        sent += chunk.sent;
        failed += chunk.failed;
        skipped += chunk.skipped;

        if (!chunk.hasMore) break;

        // Delay between chunks (same rhythm as between sub-batches)
        await sleep(BATCH_DELAY_MS);
    }

    const final = await finalizeBroadcast(broadcastId);

    return {
        broadcastId,
        total: processed,
        sent,
        failed,
        skipped,
        status: final.status,
    };
}
