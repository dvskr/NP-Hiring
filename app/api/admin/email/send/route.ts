import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { limitHighImpactAdminAction, requireApiAdminActor } from '@/lib/auth/require-api-admin';
import { logAudit } from '@/lib/audit-log';
import { executeBroadcast, markdownToEmailHtml, personalize } from '@/lib/broadcast-sender';
import { buildBroadcastHtml, sendBroadcastEmail } from '@/lib/email-service';
import { inngest, BROADCAST_REQUESTED_EVENT } from '@/lib/inngest/client';
import { logger } from '@/lib/logger';
import { readJsonObject } from '@/lib/request-body';
import { isOutboundPaused, OUTBOUND_PAUSED_MESSAGE } from '@/lib/outbound-kill-switch';
import { BROADCAST_SEGMENTS, isBroadcastSegment } from '@/lib/admin/broadcast-audience';
import { buildSegmentRecipients, type BroadcastRecipient } from '@/lib/admin/broadcast-recipients';

// F23: the ≤50-recipient path awaits the full send inline (~150ms per email
// + 2s per 10-email batch + retry backoff can top 90s). Without an explicit
// budget the default function duration kills it mid-send.
export const maxDuration = 120;

// B74: sanity bounds for the custom-audience path. Format check is
// intentionally light (same shape Zod's .email() accepts) — the goal is to
// reject obvious garbage (empty strings, pasted names, doubled commas)
// before it becomes EmailBroadcastRecipient rows that fail at send time.
const MAX_CUSTOM_EMAILS = 10_000;
const MAX_TEST_RECIPIENTS = 5;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Lists up to this size are sent inside the request; larger ones run on Inngest. */
const INLINE_SEND_LIMIT = 50;
/** How many rejected custom addresses a 400 answer echoes back. */
const MAX_INVALID_ECHOED = 20;

/**
 * The budget of the transaction that checks for a duplicate and creates the
 * broadcast. The create writes every recipient row, and an identical request
 * waits on the lock for as long as that takes, so both get more than
 * Prisma's 5 second default, well inside maxDuration.
 */
const CLAIM_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 60_000 } as const;

const DUPLICATE_SENDING_MESSAGE =
    'A broadcast with this subject, body and audience is still sending. Check the History tab: one that stopped partway continues on its own, or use Resume there.';

/**
 * B74: normalize (trim + lowercase), drop malformed entries, and dedupe a
 * raw custom-audience list. Returns the clean list plus what was dropped so
 * the admin gets visibility instead of silent mutation.
 */
function cleanCustomEmails(raw: string[]): {
    emails: string[];
    invalid: string[];
    duplicates: number;
} {
    const seen = new Set<string>();
    const emails: string[] = [];
    const invalid: string[] = [];
    let duplicates = 0;
    for (const entry of raw) {
        if (typeof entry !== 'string') { invalid.push(String(entry)); continue; }
        const normalized = entry.trim().toLowerCase();
        if (normalized.length === 0) continue;
        if (!EMAIL_SHAPE.test(normalized) || normalized.length > 254) {
            invalid.push(entry.trim());
            continue;
        }
        if (seen.has(normalized)) { duplicates++; continue; }
        seen.add(normalized);
        emails.push(normalized);
    }
    return { emails, invalid, duplicates };
}

interface SendRequest {
    subject: string;
    body: string;
    audience: string;
    customEmails: unknown;
    isTest: unknown;
}

/** A checked value, or the 400 answer that explains why it was refused. */
type Checked<T> = { ok: true; value: T } | { ok: false; response: NextResponse };

function badRequest(error: string, extra: Record<string, unknown> = {}): NextResponse {
    return NextResponse.json({ success: false, error, ...extra }, { status: 400 });
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

async function readSendRequest(req: Request): Promise<Checked<SendRequest>> {
    const input = await readJsonObject(req);
    if (!input) return { ok: false, response: badRequest('Request body must be a JSON object') };
    const { subject, body, audience, customEmails, isTest } = input;
    if (!isNonEmptyString(subject) || !isNonEmptyString(body) || !isNonEmptyString(audience)) {
        return { ok: false, response: badRequest('subject, body, and audience are required') };
    }
    return { ok: true, value: { subject, body, audience, customEmails, isTest } };
}

function customRecipients(customEmails: unknown): Checked<BroadcastRecipient[]> {
    if (!Array.isArray(customEmails) || customEmails.length === 0) {
        return { ok: false, response: badRequest('customEmails array is required for custom audience') };
    }
    if (customEmails.length > MAX_CUSTOM_EMAILS) {
        return { ok: false, response: badRequest(`customEmails exceeds the ${MAX_CUSTOM_EMAILS}-address limit`) };
    }
    // B74: the raw list used to be used as it came: duplicate addresses got
    // duplicate emails and malformed entries became recipient rows bound to
    // fail at send time.
    const cleaned = cleanCustomEmails(customEmails as string[]);
    if (cleaned.emails.length === 0) {
        return {
            ok: false,
            response: badRequest('No valid email addresses in customEmails', {
                invalid: cleaned.invalid.slice(0, MAX_INVALID_ECHOED),
            }),
        };
    }
    if (cleaned.invalid.length > 0 || cleaned.duplicates > 0) {
        logger.warn('[Admin Email Send] custom audience cleaned', {
            kept: cleaned.emails.length,
            invalid: cleaned.invalid.length,
            duplicates: cleaned.duplicates,
        });
    }
    return { ok: true, value: cleaned.emails.map((email) => ({ email })) };
}

/**
 * The recipients for an audience. A named segment comes from
 * buildSegmentRecipients, the builder the audience count reads, so the count
 * the admin approved is the list created here. An unknown name is refused:
 * it used to fall through to 'all' and mail everyone.
 */
async function resolveRecipients(audience: string, customEmails: unknown): Promise<Checked<BroadcastRecipient[]>> {
    if (audience === 'custom') return customRecipients(customEmails);
    if (!isBroadcastSegment(audience)) {
        return { ok: false, response: badRequest(`audience must be one of: ${[...BROADCAST_SEGMENTS, 'custom'].join(', ')}`) };
    }
    return { ok: true, value: await buildSegmentRecipients(audience) };
}

/**
 * B74: a test send renders through the same markdown, merge tag and email
 * shell pipeline as a real broadcast, so it shows what recipients will get,
 * but it creates no EmailBroadcast row and stays out of History and its
 * counters. sendBroadcastEmail still writes an EmailSend log row, so the send
 * itself remains observable.
 */
async function sendTestBroadcast(
    subject: string,
    body: string,
    audience: string,
    recipients: readonly BroadcastRecipient[],
): Promise<NextResponse> {
    if (audience !== 'custom' || recipients.length > MAX_TEST_RECIPIENTS) {
        return badRequest(`Test sends must use the custom audience with at most ${MAX_TEST_RECIPIENTS} recipients`);
    }
    const bodyHtml = markdownToEmailHtml(body);
    let sent = 0;
    const failures: string[] = [];
    for (const r of recipients) {
        const mergeData = { email: r.email, firstName: r.firstName ?? null };
        const html = buildBroadcastHtml(
            personalize(bodyHtml, mergeData),
            personalize(subject, mergeData),
        );
        const result = await sendBroadcastEmail(r.email, personalize(subject, mergeData), html);
        if (result.success) sent++;
        else failures.push(`${r.email}: ${result.error ?? 'send failed'}`);
    }
    if (failures.length > 0) {
        logger.error('[Admin Email Send] test send failures', null, { failures });
    }
    return NextResponse.json({
        success: failures.length === 0,
        isTest: true,
        sent,
        failed: failures.length,
        error: failures.length > 0 ? failures.join('; ') : undefined,
    });
}

/**
 * POST /api/admin/email/send
 * Create and execute an email broadcast.
 *
 * Body: { subject, body, audience, customEmails?, isTest? }
 *
 * B74: `isTest: true` (custom audience only, at most 5 recipients) sends
 * through the production render pipeline but creates no EmailBroadcast row.
 *
 * A real broadcast is refused (409) while one with the same subject, body and
 * audience is still sending, also when the two requests arrive together, and
 * each one created is written to the audit log with ids and counts only,
 * never an address or the message. Every send, a test send included, is
 * charged to the admin's high-impact budget (10 a minute) on top of the
 * general admin one.
 */
export async function POST(req: Request) {
    const { error: authError, actor } = await requireApiAdminActor(req);
    if (authError) return authError;

    const limited = await limitHighImpactAdminAction('email-send', actor);
    if (limited) return limited;

    // Emergency brake (lib/outbound-kill-switch.ts): while it is engaged
    // nothing leaves, and the admin gets the reason instead of a broadcast
    // whose recipients all wait.
    if (isOutboundPaused()) {
        return NextResponse.json({ success: false, error: OUTBOUND_PAUSED_MESSAGE }, { status: 503 });
    }

    try {
        const parsed = await readSendRequest(req);
        if (!parsed.ok) return parsed.response;
        const { subject, body, audience, customEmails, isTest } = parsed.value;

        const resolved = await resolveRecipients(audience, customEmails);
        if (!resolved.ok) return resolved.response;
        const recipients = resolved.value;
        if (recipients.length === 0) return badRequest('No recipients found for this audience');

        // B74: a test send never enters broadcast history, so it is neither
        // checked for duplicates nor audited as a broadcast.
        if (isTest === true) return await sendTestBroadcast(subject, body, audience, recipients);

        const claim = await claimBroadcast(subject, body, audience, recipients);
        if ('inFlight' in claim) {
            return NextResponse.json(
                { success: false, error: DUPLICATE_SENDING_MESSAGE, broadcastId: claim.inFlight.id },
                { status: 409 },
            );
        }

        const broadcast = claim.created;
        await logAudit({
            action: 'admin.email.broadcast',
            actorType: 'admin',
            actorId: actor.profileId,
            targetType: 'email_broadcast',
            targetId: broadcast.id,
            metadata: { audience, recipientCount: recipients.length },
        });

        return await dispatchBroadcast(broadcast, recipients.length);
    } catch (error) {
        logger.error('[Admin Email Send] Error', error);
        return NextResponse.json(
            { success: false, error: 'Failed to send broadcast' },
            { status: 500 }
        );
    }
}

/** The broadcast a send created, or the unfinished one it would repeat. */
type BroadcastClaim = { readonly created: { id: string } } | { readonly inFlight: { id: string } };

/** The client the claim reads and writes through: the transaction's. */
type BroadcastStore = Pick<Prisma.TransactionClient, 'emailBroadcast'>;

/**
 * The key of the transaction lock on one broadcast's content and audience.
 * JSON keeps the three apart, so a subject ending where a body begins cannot
 * stand for another pair. The key is a bound parameter of the lock statement.
 */
function broadcastLockKey(subject: string, body: string, audience: string): string {
    return `admin-broadcast:${JSON.stringify([subject, body, audience])}`;
}

/**
 * The duplicate check and the create as one transaction, under a transaction
 * lock on the subject, body and audience. Checked and created apart, two
 * identical requests arriving together (a double click, a retried request)
 * each found no unfinished broadcast and each created one, so every recipient
 * was mailed twice. Now the second waits on the lock until the first commits,
 * then finds its broadcast and is refused.
 */
function claimBroadcast(
    subject: string,
    body: string,
    audience: string,
    recipients: readonly BroadcastRecipient[],
): Promise<BroadcastClaim> {
    return prisma.$transaction(async (tx): Promise<BroadcastClaim> => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${broadcastLockKey(subject, body, audience)}))`;
        const inFlight = await findUnfinishedDuplicate(tx, subject, body, audience, recipients);
        if (inFlight) return { inFlight };
        return { created: await createBroadcast(tx, subject, body, audience, recipients) };
    }, CLAIM_TRANSACTION_OPTIONS);
}

/**
 * The unfinished broadcast this one would repeat, if any. One still
 * 'sending' with the same content has recipients waiting, and the
 * stuck-broadcast sweep finishes it on its own: a second one would mail the
 * people the first already reached. A segment name stands for the same
 * people, but 'custom' names nobody in particular, so the same message to a
 * different typed list is a new broadcast. A custom send is refused only when
 * one of its addresses is a recipient of the unfinished one.
 */
function findUnfinishedDuplicate(
    db: BroadcastStore,
    subject: string,
    body: string,
    audience: string,
    recipients: readonly BroadcastRecipient[],
): Promise<{ id: string } | null> {
    return db.emailBroadcast.findFirst({
        where: {
            subject,
            body,
            audience,
            status: 'sending',
            ...(audience === 'custom'
                ? { recipients: { some: { email: { in: recipients.map((r) => r.email) } } } }
                : {}),
        },
        select: { id: true },
    });
}

/**
 * The broadcast row and its recipient rows. The recipients go in as one
 * batched insert (createMany), not one insert each, so a list of thousands
 * fits the claim transaction's budget.
 */
function createBroadcast(
    db: BroadcastStore,
    subject: string,
    body: string,
    audience: string,
    recipients: readonly BroadcastRecipient[],
): Promise<{ id: string }> {
    return db.emailBroadcast.create({
        data: {
            subject,
            body,
            audience,
            audienceCount: recipients.length,
            status: 'sending',
            recipients: {
                createMany: {
                    data: recipients.map((r) => ({
                        email: r.email,
                        firstName: r.firstName || null,
                    })),
                },
            },
        },
        select: { id: true },
    });
}

/**
 * Small lists send inside the request (maxDuration covers the worst case) and
 * answer with the result; larger ones are handed to the background sender.
 */
async function dispatchBroadcast(broadcast: { id: string }, total: number): Promise<NextResponse> {
    if (total <= INLINE_SEND_LIMIT) {
        const result = await executeBroadcast(broadcast.id);
        return NextResponse.json({
            success: true,
            ...result,
        });
    }

    // F23: large audiences run on Inngest, durable, chunked and resumable.
    // The previous fire-and-forget executeBroadcast() call died the moment
    // the platform froze the function after this response, stranding the
    // broadcast in 'sending' with no resume path. The stuck-broadcast sweep
    // (lib/inngest/functions/broadcast-send.ts) re-emits the event if a run
    // dies mid-send.
    let queuedViaInngest = false;
    if (process.env.INNGEST_EVENT_KEY) {
        try {
            await inngest.send({
                name: BROADCAST_REQUESTED_EVENT,
                data: { broadcastId: broadcast.id },
            });
            queuedViaInngest = true;
        } catch (sendErr) {
            logger.error('[Admin Email Send] Inngest event send failed, falling back to the in-process send', sendErr, {
                broadcastId: broadcast.id,
            });
        }
    }

    if (!queuedViaInngest) {
        // Inngest unconfigured or unreachable: degrade to the legacy
        // in-process background send rather than strand the broadcast in
        // 'sending' with no worker at all.
        logger.warn('[Admin Email Send] Inngest unavailable, using the legacy in-process background send', {
            broadcastId: broadcast.id,
        });
        executeBroadcast(broadcast.id).catch(err => {
            logger.error(`[Broadcast ${broadcast.id}] Background send error`, err);
        });
    }

    return NextResponse.json({
        success: true,
        broadcastId: broadcast.id,
        message: `Broadcasting to ${total} recipients in the background. Check the History tab for progress.`,
        total,
        status: 'sending',
    });
}
