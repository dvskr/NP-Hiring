import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiAdmin } from '@/lib/auth/require-api-admin';
import { executeBroadcast, markdownToEmailHtml, personalize } from '@/lib/broadcast-sender';
import { buildBroadcastHtml, sendBroadcastEmail } from '@/lib/email-service';
import { inngest, BROADCAST_REQUESTED_EVENT } from '@/lib/inngest/client';
import { logger } from '@/lib/logger';

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

/**
 * POST /api/admin/email/send
 * Create and execute an email broadcast.
 *
 * Body: { subject, body, audience, customEmails?, isTest? }
 *
 * B74: `isTest: true` (custom audience only, ≤5 recipients) sends through
 * the exact production render pipeline (markdown → merge tags → V2 shell)
 * but does NOT create an EmailBroadcast row — test sends no longer pollute
 * the History tab or its sent counters.
 */
export async function POST(req: Request) {
    const authError = await requireApiAdmin();
    if (authError) return authError;

    try {
        const { subject, body, audience, customEmails, isTest } = await req.json();

        if (!subject || !body || !audience) {
            return NextResponse.json(
                { success: false, error: 'subject, body, and audience are required' },
                { status: 400 }
            );
        }

        // ── Build recipient list based on audience segment ──
        let recipients: Array<{ email: string; firstName?: string | null }> = [];

        switch (audience) {
            case 'job_seekers': {
                recipients = await prisma.userProfile.findMany({
                    where: { role: 'job_seeker' },
                    select: { email: true, firstName: true },
                });
                break;
            }
            case 'employers': {
                recipients = await prisma.userProfile.findMany({
                    where: { role: 'employer' },
                    select: { email: true, firstName: true },
                });
                break;
            }
            case 'subscribers': {
                const leads = await prisma.emailLead.findMany({
                    where: { isSubscribed: true },
                    select: { email: true },
                });
                recipients = leads.map(l => ({ email: l.email }));
                break;
            }
            case 'newsletter': {
                const leads = await prisma.emailLead.findMany({
                    where: { isSubscribed: true, newsletterOptIn: true },
                    select: { email: true },
                });
                recipients = leads.map(l => ({ email: l.email }));
                break;
            }
            case 'custom': {
                if (!customEmails || !Array.isArray(customEmails) || customEmails.length === 0) {
                    return NextResponse.json(
                        { success: false, error: 'customEmails array is required for custom audience' },
                        { status: 400 }
                    );
                }
                if (customEmails.length > MAX_CUSTOM_EMAILS) {
                    return NextResponse.json(
                        { success: false, error: `customEmails exceeds the ${MAX_CUSTOM_EMAILS}-address limit` },
                        { status: 400 }
                    );
                }
                // B74: previously the raw list was used as-is — duplicate
                // addresses got duplicate emails and malformed entries became
                // guaranteed-failure recipient rows.
                const cleaned = cleanCustomEmails(customEmails as string[]);
                if (cleaned.emails.length === 0) {
                    return NextResponse.json(
                        {
                            success: false,
                            error: 'No valid email addresses in customEmails',
                            invalid: cleaned.invalid.slice(0, 20),
                        },
                        { status: 400 }
                    );
                }
                if (cleaned.invalid.length > 0 || cleaned.duplicates > 0) {
                    logger.warn('[Admin Email Send] custom audience cleaned', {
                        kept: cleaned.emails.length,
                        invalid: cleaned.invalid.length,
                        duplicates: cleaned.duplicates,
                    });
                }
                recipients = cleaned.emails.map(email => ({ email }));
                break;
            }
            case 'all':
            default: {
                const [users, leads] = await Promise.all([
                    prisma.userProfile.findMany({ select: { email: true, firstName: true } }),
                    prisma.emailLead.findMany({ where: { isSubscribed: true }, select: { email: true } }),
                ]);
                const seen = new Set<string>();
                for (const u of users) {
                    const key = u.email.toLowerCase();
                    if (!seen.has(key)) { seen.add(key); recipients.push(u); }
                }
                for (const l of leads) {
                    const key = l.email.toLowerCase();
                    if (!seen.has(key)) { seen.add(key); recipients.push({ email: l.email }); }
                }
                break;
            }
        }

        if (recipients.length === 0) {
            return NextResponse.json(
                { success: false, error: 'No recipients found for this audience' },
                { status: 400 }
            );
        }

        // ── B74: test send — never enters broadcast history ──
        // Renders through the same markdown/merge-tag/V2-shell pipeline as a
        // real broadcast so the preview is faithful, but skips the
        // EmailBroadcast row entirely (sendBroadcastEmail still writes an
        // EmailSend log row, so the send itself remains observable).
        if (isTest === true) {
            if (audience !== 'custom' || recipients.length > MAX_TEST_RECIPIENTS) {
                return NextResponse.json(
                    { success: false, error: `Test sends must use the custom audience with at most ${MAX_TEST_RECIPIENTS} recipients` },
                    { status: 400 }
                );
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

        // ── Create broadcast + recipients in DB ──
        const broadcast = await prisma.emailBroadcast.create({
            data: {
                subject,
                body,
                audience,
                audienceCount: recipients.length,
                status: 'sending',
                recipients: {
                    create: recipients.map(r => ({
                        email: r.email,
                        firstName: r.firstName || null,
                    })),
                },
            },
        });

        // ── Execute send ──
        // Small lists (≤50) send synchronously and return the result — the
        // route exports maxDuration to cover the worst case.
        if (recipients.length <= 50) {
            const result = await executeBroadcast(broadcast.id);
            return NextResponse.json({
                success: true,
                ...result,
            });
        }

        // F23: large audiences run on Inngest — durable, chunked, resumable.
        // The previous fire-and-forget executeBroadcast() call died the
        // moment Vercel froze the lambda after this response, stranding the
        // broadcast in 'sending' with no resume path. The stuck-broadcast
        // sweep (lib/inngest/functions/broadcast-send.ts) re-emits the event
        // if a run dies mid-send.
        let queuedViaInngest = false;
        if (process.env.INNGEST_EVENT_KEY) {
            try {
                await inngest.send({
                    name: BROADCAST_REQUESTED_EVENT,
                    data: { broadcastId: broadcast.id },
                });
                queuedViaInngest = true;
            } catch (sendErr) {
                logger.error('[Admin Email Send] Inngest event send failed — falling back to in-process send', sendErr, {
                    broadcastId: broadcast.id,
                });
            }
        }

        if (!queuedViaInngest) {
            // Inngest unconfigured/unreachable — degrade to the legacy
            // in-process background send rather than stranding the broadcast
            // in 'sending' forever with no worker at all.
            logger.warn('[Admin Email Send] Inngest unavailable — using legacy in-process background send', {
                broadcastId: broadcast.id,
            });
            executeBroadcast(broadcast.id).catch(err => {
                logger.error(`[Broadcast ${broadcast.id}] Background send error`, err);
            });
        }

        return NextResponse.json({
            success: true,
            broadcastId: broadcast.id,
            message: `Broadcasting to ${recipients.length} recipients in the background. Check the History tab for progress.`,
            total: recipients.length,
            status: 'sending',
        });
    } catch (error) {
        logger.error('[Admin Email Send] Error', error);
        return NextResponse.json(
            { success: false, error: 'Failed to send broadcast' },
            { status: 500 }
        );
    }
}
