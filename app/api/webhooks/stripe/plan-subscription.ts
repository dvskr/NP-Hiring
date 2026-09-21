/**
 * Employer plan subscription lifecycle — `customer.subscription.updated` /
 * `.deleted` and `invoice.payment_failed`. Shared by the Stripe webhook and
 * the plan reconciliation sweep (which replays the live subscription).
 */
import type Stripe from 'stripe';
import { logger } from '@/lib/logger';
import {
  sendPlanActivatedEmail,
  sendPlanPausedEmail,
  sendPlanPaymentFailedEmail,
} from '@/lib/email-service';
import {
  getPlanBySubscriptionId,
  isPlanEntitled,
  mapStripeSubscriptionStatus,
  pausePlanPosts,
  planEntitlementEndsAt,
  resumePlanPosts,
  upsertPlan,
  type PlanStatus,
} from '@/lib/employer-plan';
import {
  alertWebhookFailure,
  claimEmailSend,
  releaseEmailClaim,
  stripeIdOf,
  subscriptionPeriodEnd,
  subscriptionPeriodStart,
} from './webhook-support';

type PlanRow = NonNullable<Awaited<ReturnType<typeof getPlanBySubscriptionId>>>;

export type SubscriptionEventType = 'customer.subscription.updated' | 'customer.subscription.deleted';

export interface SubscriptionChangeContext {
  eventId: string;
  /**
   * When the state being applied was observed: Stripe `event.created`
   * (seconds → Date) for a webhook, the time of a live retrieve for the sweep.
   * Anything older than the row's lastStripeEventAt is ignored.
   */
  observedAt?: Date;
}

export interface SubscriptionChangeResult {
  outcome: 'updated' | 'no-plan' | 'stale';
  status?: PlanStatus;
  pausedCount?: number;
}

/**
 * Status + paid-through anchor for a subscription, given the row as stored.
 *
 *   past_due  → the current period's START: Stripe advances the period when
 *               the renewal invoice is finalized, paid or not, so the period
 *               END would hand a failed renewal a full free cycle. The start
 *               is the end of the last PAID period, so start + planGraceDays
 *               is the intended grace window.
 *   cancelled → from 'pending' (never paid): now — nothing to honour; from
 *               'past_due': the anchored paid-through date (never the unpaid
 *               period's end); otherwise the paid period end.
 *   otherwise → the period end.
 */
export function planStateFromSubscription(
  subscription: Stripe.Subscription,
  eventType: SubscriptionEventType,
  existing: Pick<PlanRow, 'status' | 'currentPeriodEnd'>,
  now: Date = new Date(),
): { status: PlanStatus; currentPeriodEnd: Date } {
  const status: PlanStatus = eventType === 'customer.subscription.deleted'
    ? 'cancelled'
    : mapStripeSubscriptionStatus(subscription.status);
  const periodEnd = subscriptionPeriodEnd(subscription) ?? existing.currentPeriodEnd;

  if (status === 'past_due') {
    return { status, currentPeriodEnd: subscriptionPeriodStart(subscription) ?? existing.currentPeriodEnd };
  }
  if (status === 'cancelled') {
    if (existing.status === 'pending') return { status, currentPeriodEnd: now };
    if (existing.status === 'past_due') {
      const anchored = existing.currentPeriodEnd.getTime() < periodEnd.getTime() ? existing.currentPeriodEnd : periodEnd;
      return { status, currentPeriodEnd: anchored };
    }
  }
  return { status, currentPeriodEnd: periodEnd };
}

async function sendOnce(dedupeKey: string, to: string, emailType: string, send: () => Promise<unknown>, planId: string): Promise<void> {
  if (!(await claimEmailSend(dedupeKey, to, emailType))) return;
  try {
    await send();
  } catch (emailErr) {
    logger.error(`[Stripe] Failed to send ${emailType} email`, emailErr, { planId });
    await releaseEmailClaim(dedupeKey);
  }
}

/**
 * customer.subscription.updated / .deleted → keep the plan row's status and
 * paid-through date in step with Stripe. Keyed on the subscription id.
 *
 * Ordering: Stripe does not guarantee delivery order, so an event older than
 * the last one applied to the row is ignored (a stale 'active' can never
 * resurrect a cancelled plan, a stale 'past_due' never downgrades a
 * recovered one).
 *
 * An unknown subscription is alerted, not silently skipped: a paying
 * subscription with no row means entitlement is untracked. (The checkout
 * handler and the reconciliation sweep are the creators; the race with
 * checkout.session.completed self-corrects because checkout reads the live
 * subscription.)
 *
 * Side effects:
 *   - 'active' → re-publish paused plan posts (no-op when none); a plan
 *     promoted from 'pending' also gets its welcome email;
 *   - 'cancelled' still inside the paid period → posts stay live; the
 *     employer is told the date they come down (the lapse sweep pauses them);
 *   - 'cancelled' with nothing left to honour → pause now and email;
 *   - 'past_due' / 'pending' → nothing destructive (grace window).
 */
export async function handleSubscriptionChange(
  subscription: Stripe.Subscription,
  eventType: SubscriptionEventType,
  ctx: SubscriptionChangeContext,
): Promise<SubscriptionChangeResult> {
  const existing = await getPlanBySubscriptionId(subscription.id);
  if (!existing) {
    logger.warn('[Stripe] subscription event for unknown plan — skipping', { eventType, subscriptionId: subscription.id });
    if (subscription.status !== 'incomplete' && subscription.status !== 'incomplete_expired') {
      await alertWebhookFailure('subscription event for a subscription with no plan row', null, {
        eventId: ctx.eventId, eventType, subscriptionId: subscription.id, status: subscription.status,
      });
    }
    return { outcome: 'no-plan' };
  }

  if (ctx.observedAt && existing.lastStripeEventAt && ctx.observedAt.getTime() < existing.lastStripeEventAt.getTime()) {
    logger.info('[Stripe] out-of-order subscription event ignored', {
      eventType, subscriptionId: subscription.id, planId: existing.id,
    });
    return { outcome: 'stale', status: existing.status as PlanStatus };
  }

  const now = new Date();
  const next = planStateFromSubscription(subscription, eventType, existing, now);

  const updated = await upsertPlan({
    userId: existing.userId,
    email: existing.email,
    status: next.status,
    currentPeriodEnd: next.currentPeriodEnd,
    slots: existing.slots,
    priceCents: existing.priceCents,
    stripeCustomerId: stripeIdOf(subscription.customer) ?? existing.stripeCustomerId,
    stripeSubscriptionId: subscription.id,
    source: 'stripe',
    ...(ctx.observedAt && { lastStripeEventAt: ctx.observedAt }),
  });

  let pausedCount = 0;
  if (existing.userId) {
    const entitled = isPlanEntitled({ status: next.status, currentPeriodEnd: next.currentPeriodEnd }, now);
    if (next.status === 'cancelled') {
      pausedCount = await applyCancellation(existing, next.currentPeriodEnd, entitled, ctx.eventId, now);
    } else if (entitled && next.status === 'active') {
      await resumePlanPosts(existing.userId);
      if (existing.status === 'pending') {
        await sendOnce(`plan-activated:sub:${subscription.id}`, existing.email, 'plan_activated',
          () => sendPlanActivatedEmail(existing.email, { slots: updated.slots, currentPeriodEnd: next.currentPeriodEnd }), existing.id);
      }
    }
  }

  logger.info('[Stripe] employer plan subscription updated', {
    planId: existing.id, previousStatus: existing.status, status: next.status, eventType, pausedCount,
  });
  return { outcome: 'updated', status: next.status, pausedCount };
}

async function applyCancellation(existing: PlanRow & { userId: string | null }, liveUntil: Date, stillEntitled: boolean, eventId: string, now: Date): Promise<number> {
  if (!existing.userId) return 0;
  // A plan that was never entitled (pending) owns no live posts — nothing to tell.
  if (existing.status === 'pending') return 0;
  const emailKey = `plan-paused:${eventId}`;
  if (stillEntitled) {
    await sendOnce(emailKey, existing.email, 'plan_paused',
      () => sendPlanPausedEmail(existing.email, { reason: 'cancelled', pausedCount: 0, liveUntil }), existing.id);
    return 0;
  }
  const pausedCount = (await pausePlanPosts(existing.userId, now)).length;
  await sendOnce(emailKey, existing.email, 'plan_paused',
    () => sendPlanPausedEmail(existing.email, { reason: 'cancelled', pausedCount }), existing.id);
  return pausedCount;
}

/** Subscription id of an invoice across API shapes (root field pre-2025, parent.subscription_details after). */
export function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const root = (invoice as unknown as { subscription?: string | { id: string } | null }).subscription;
  return stripeIdOf(root ?? invoice.parent?.subscription_details?.subscription ?? null);
}

/**
 * invoice.payment_failed → dunning notice for an Employer plan subscription
 * while Smart Retries are still running, so the employer can fix the card
 * inside the grace window instead of discovering it when posts vanish. One
 * email per attempt. Invoices for anything other than a plan subscription
 * (per-post checkouts) are acknowledged and ignored.
 */
export async function handlePlanInvoicePaymentFailed(
  invoice: Stripe.Invoice,
): Promise<{ outcome: 'notified' | 'no-plan' }> {
  const subscriptionId = invoiceSubscriptionId(invoice);
  const plan = subscriptionId ? await getPlanBySubscriptionId(subscriptionId) : null;
  if (!plan) return { outcome: 'no-plan' };

  const nextPaymentAttempt = typeof invoice.next_payment_attempt === 'number' ? new Date(invoice.next_payment_attempt * 1000) : null;
  const entitledUntil = plan.status === 'active' || plan.status === 'past_due'
    ? planEntitlementEndsAt(plan.currentPeriodEnd)
    : null;
  logger.warn('[Stripe] employer plan invoice payment failed', {
    planId: plan.id, subscriptionId, invoiceId: invoice.id, attempt: invoice.attempt_count,
  });
  await sendOnce(`plan-payment-failed:${invoice.id}:${invoice.attempt_count}`, plan.email, 'plan_payment_failed',
    () => sendPlanPaymentFailedEmail(plan.email, { nextPaymentAttempt, entitledUntil }), plan.id);
  return { outcome: 'notified' };
}
