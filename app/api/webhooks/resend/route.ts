import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { Webhook } from 'svix';

const WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET || '';

// B75: Svix dedupe (below) blocks replays of the SAME event, but distinct
// events can still arrive out of order (e.g. `email.delivered` after
// `email.opened`, or an `email.opened` after `email.bounced`). Blindly
// writing each event's status would downgrade the engagement funnel, so
// every EmailSend status write is guarded by this precedence ladder: an
// incoming status only overwrites statuses strictly below it.
// 'sent' is the sendAndLog default; 'failed' never has a resendId so the
// webhook can't match those rows anyway.
const STATUS_PRECEDENCE: Record<string, number> = {
  sent: 0,
  delivered: 1,
  opened: 2,
  clicked: 3,
  bounced: 4,
  complained: 5,
};

/** Statuses an incoming status is allowed to overwrite (strictly lower rank). */
function overwritableStatuses(incoming: string): string[] {
  const rank = STATUS_PRECEDENCE[incoming];
  if (rank === undefined) return [];
  return Object.keys(STATUS_PRECEDENCE).filter(s => STATUS_PRECEDENCE[s] < rank);
}

interface ResendWebhookPayload {
  type: string;
  data: {
    email_id: string;
    to: string[];
    from: string;
    subject: string;
    created_at: string;
  };
}

export async function POST(request: NextRequest) {
  if (!WEBHOOK_SECRET) {
    logger.error('RESEND_WEBHOOK_SECRET not configured');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  try {
    const body = await request.text();

    // Verify signature using Svix (Resend uses Svix for webhooks)
    const svixId = request.headers.get('svix-id') || '';
    const svixTimestamp = request.headers.get('svix-timestamp') || '';
    const svixSignature = request.headers.get('svix-signature') || '';

    const wh = new Webhook(WEBHOOK_SECRET);
    let payload: ResendWebhookPayload;

    try {
      payload = wh.verify(body, {
        'svix-id': svixId,
        'svix-timestamp': svixTimestamp,
        'svix-signature': svixSignature,
      }) as ResendWebhookPayload;
    } catch (e) {
      logger.error('Webhook signature verification failed', e);
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    // P5.A idempotency (2026-06-01): Svix re-delivers webhooks on
    // transient failures. Without dedupe, the bounce/complaint path
    // would re-suppress (idempotent at the row level but pollutes
    // audit timestamps) and the engagement tracking would overwrite
    // newer statuses with older ones (e.g. an "opened" replay AFTER
    // a "clicked" event downgrades the funnel). Reusing the
    // ProcessedStripeEvent table with a `resend:` prefix avoids a
    // schema migration for a sibling-events use case.
    const dedupeKey = `resend:${svixId}`;
    try {
      await prisma.processedStripeEvent.create({
        data: { eventId: dedupeKey, eventType: payload.type },
      });
    } catch (dedupeErr) {
      const code = (dedupeErr as { code?: string } | null)?.code;
      if (code === 'P2002') {
        logger.info('Resend webhook already processed; skipping', { svixId, type: payload.type });
        return NextResponse.json({ received: true, deduped: true });
      }
      logger.error('Failed to record processed Resend event', dedupeErr, { svixId });
      return NextResponse.json({ error: 'Idempotency check failed' }, { status: 500 });
    }

    const eventType = payload.type;
    const emails = payload.data.to || [];
    const resendId = payload.data.email_id;

    // Handle engagement tracking events (update EmailSend status)
    if (['email.delivered', 'email.opened', 'email.clicked'].includes(eventType)) {
      if (resendId) {
        const statusMap: Record<string, string> = {
          'email.delivered': 'delivered',
          'email.opened': 'opened',
          'email.clicked': 'clicked',
        };
        const nextStatus = statusMap[eventType];
        // B75: only upgrade — an out-of-order `delivered` must not clobber
        // `opened`/`clicked`, and no engagement event may un-suppress a row
        // already marked bounced/complained.
        await prisma.emailSend.updateMany({
          where: { resendId, status: { in: overwritableStatuses(nextStatus) } },
          data: { status: nextStatus },
        });
      }
      return NextResponse.json({ received: true, action: 'tracked', event: eventType });
    }

    // Only handle bounce and complaint events for suppression
    if (eventType !== 'email.bounced' && eventType !== 'email.complained') {
      return NextResponse.json({ received: true, action: 'ignored' });
    }

    const suppressionReason = eventType === 'email.bounced' ? 'bounce' : 'complaint';

    for (const email of emails) {
      const normalizedEmail = email.toLowerCase().trim();

      // Suppress in EmailLead
      await prisma.emailLead.updateMany({
        where: { email: normalizedEmail },
        data: {
          isSuppressed: true,
          suppressedAt: new Date(),
          suppressionReason,
          isSubscribed: false,
        },
      });

      // Suppress in UserProfile
      await prisma.userProfile.updateMany({
        where: { email: normalizedEmail },
        data: {
          emailSuppressed: true,
          emailSuppressedAt: new Date(),
        },
      });

      // Mark in ProgramDirectorLead so the PD campaign script skips
      // bounced/complained addresses on future touches. The send script
      // already filters by emailStatus='Valid' — flipping the status
      // here removes them from the eligible pool the next time it runs.
      if (suppressionReason === 'bounce') {
        await prisma.programDirectorLead.updateMany({
          where: { email: normalizedEmail },
          data: {
            outreachStatus: 'bounced',
            emailStatus: 'Bounced',
          },
        });
      } else {
        // complaint — treat as declined (PD effectively said "stop")
        await prisma.programDirectorLead.updateMany({
          where: { email: normalizedEmail },
          data: { outreachStatus: 'declined' },
        });
      }

      logger.info('Email suppressed via webhook', {
        email: normalizedEmail,
        reason: suppressionReason,
        resendId,
      });
    }

    // Update the EmailSend log status ONCE per webhook (not per recipient).
    // Resend sends one webhook per email send so this is keyed by resendId,
    // not by recipient — avoids redundant writes if a multi-recipient webhook ever ships.
    // B75: precedence-guarded so a late `bounced` can't downgrade `complained`.
    if (resendId) {
      const terminalStatus = suppressionReason === 'bounce' ? 'bounced' : 'complained';
      await prisma.emailSend.updateMany({
        where: { resendId, status: { in: overwritableStatuses(terminalStatus) } },
        data: { status: terminalStatus },
      });
    }

    return NextResponse.json({
      received: true,
      action: 'suppressed',
      emails: emails.length,
      reason: suppressionReason,
    });
  } catch (error) {
    logger.error('Resend webhook error', error);
    // P5.A: roll back the dedupe row so Svix retry can replay. Mirrors
    // the Stripe webhook C2 pattern. svixId is captured at the top of
    // the outer try; if we never made it past dedupe insert, the
    // delete fails silently (which is fine — nothing to roll back).
    try {
      const svixIdForCleanup = request.headers.get('svix-id');
      if (svixIdForCleanup) {
        await prisma.processedStripeEvent.delete({
          where: { eventId: `resend:${svixIdForCleanup}` },
        }).catch(() => { /* ignore P2025 not-found */ });
      }
    } catch {
      // Best-effort cleanup; the outer 500 still surfaces the failure.
    }
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
