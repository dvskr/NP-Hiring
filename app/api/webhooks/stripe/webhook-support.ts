/**
 * Shared helpers for the Stripe webhook and the paths that replay its work
 * (verify-page self-heals, Inngest reconciliation sweeps).
 *
 * Lives outside route.ts because Next.js App Router route files may only
 * export HTTP handlers and segment config — the activate-paid-job.ts
 * precedent.
 */
import type Stripe from 'stripe';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { captureException } from '@/lib/sentry';
import { sendDiscordMessage } from '@/lib/discord-notifier';
import { sanitizeForDiscord } from '@/lib/sanitize-for-discord';

export type AlertExtras = Record<string, string | number | undefined>;

/**
 * Redact PII/secrets from alert extras before they reach Sentry. Sentry's
 * `sendDefaultPii: false` does not cover explicitly supplied extras, so an
 * email passed here would otherwise become a searchable Sentry field.
 */
function redactExtras(extras: AlertExtras): AlertExtras {
  return Object.fromEntries(
    Object.entries(extras).map(([k, v]) => [k, typeof v === 'string' ? sanitizeForDiscord(v) : v]),
  );
}

/**
 * V8: payment-webhook failures must reach a human. Every cron in this repo
 * alerts Discord on failure, but the payments webhook — the one place where
 * money has been taken — previously only wrote logger.error to Vercel logs.
 * If Stripe exhausts its ~3-day retry window against a persistent failure,
 * the money is taken, the job stays unpublished, and nobody is told.
 *
 * Sends to Sentry (captureException) AND Discord, both sanitized.
 * Best-effort: alerting can never make a failing webhook fail harder.
 */
export async function alertWebhookFailure(
  reason: string,
  err: unknown,
  extras: AlertExtras,
): Promise<void> {
  try {
    const safeExtras = redactExtras(extras);
    captureException(err instanceof Error ? err : new Error(`${reason}${err ? `: ${sanitizeForDiscord(String(err))}` : ''}`), {
      tags: { area: 'stripe-webhook' },
      extra: { reason, ...safeExtras },
    });
    const rawMessage = err instanceof Error ? err.message : err ? String(err) : reason;
    const detail = Object.entries(safeExtras)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${v}`)
      .join(' · ');
    await sendDiscordMessage('', [{
      title: `🚨 Stripe webhook: ${reason}`,
      description: '```\n' + sanitizeForDiscord(rawMessage).slice(0, 400) + '\n```'
        + (detail ? `\n${sanitizeForDiscord(detail).slice(0, 300)}` : ''),
      color: 0xFF0000,
    }]);
  } catch (alertErr) {
    logger.error('[Stripe] Failed to deliver webhook failure alert', alertErr, { reason });
  }
}

/**
 * B109: atomically claim a webhook-triggered email send via the EmailSend
 * dedupe key (unique). Insert-then-send: a P2002 on the key means an earlier
 * delivery already sent (or is sending) this exact email, so the retry
 * skips it.
 *
 * Fails OPEN on unexpected errors: a broken guard must not block a
 * legitimate email — worst case is the pre-B109 duplicate-send behavior.
 */
export async function claimEmailSend(dedupeKey: string, to: string, emailType: string): Promise<boolean> {
  try {
    await prisma.emailSend.create({
      data: {
        dedupeKey,
        to,
        subject: `[claim] ${emailType}`,
        emailType,
        status: 'claimed',
        metadata: { guard: 'stripe-webhook' },
      },
    });
    return true;
  } catch (err) {
    if (prismaErrorCode(err) === 'P2002') return false;
    logger.error('[Stripe] Email-send claim failed — proceeding without dedupe', err, { dedupeKey });
    return true;
  }
}

/** Release a claim after a FAILED send so a later retry can send it. Best-effort. */
export async function releaseEmailClaim(dedupeKey: string): Promise<void> {
  try {
    await prisma.emailSend.delete({ where: { dedupeKey } });
  } catch (err) {
    logger.error('[Stripe] Failed to release email-send claim after failed send', err, { dedupeKey });
  }
}

export function prismaErrorCode(err: unknown): string | undefined {
  return (err as { code?: string } | null)?.code;
}

export function stripeIdOf(ref: string | { id: string } | null | undefined): string | null {
  if (!ref) return null;
  return typeof ref === 'string' ? ref : ref.id;
}

/**
 * Read a subscription period boundary as a Date.
 *
 * Stripe moved `current_period_start/end` off the Subscription object and
 * onto each SubscriptionItem in API version 2025-03-31 (the `stripe` v20
 * types only declare them on items). Older API versions still return them at
 * the root, so read both. Null when neither is present — callers fall back
 * to the value they already hold rather than guessing a period length.
 */
function subscriptionPeriodBoundary(
  sub: Stripe.Subscription,
  field: 'current_period_start' | 'current_period_end',
): Date | null {
  const rootValue = (sub as unknown as Record<string, unknown>)[field];
  const itemValue = sub.items?.data?.[0]?.[field];
  const unixSeconds = typeof rootValue === 'number' ? rootValue : itemValue;
  return typeof unixSeconds === 'number' && Number.isFinite(unixSeconds) ? new Date(unixSeconds * 1000) : null;
}

export function subscriptionPeriodEnd(sub: Stripe.Subscription): Date | null {
  return subscriptionPeriodBoundary(sub, 'current_period_end');
}

/**
 * Start of the current period. For a subscription whose renewal invoice is
 * unpaid, Stripe has ALREADY advanced the period, so the start of the current
 * period is the end of the last PAID period — the correct entitlement anchor.
 */
export function subscriptionPeriodStart(sub: Stripe.Subscription): Date | null {
  return subscriptionPeriodBoundary(sub, 'current_period_start');
}
