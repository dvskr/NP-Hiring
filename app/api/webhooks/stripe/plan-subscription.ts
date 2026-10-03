/**
 * Employer plan subscription lifecycle — `customer.subscription.updated` /
 * `.deleted` and `invoice.payment_failed`. Shared by the Stripe webhook and
 * the plan reconciliation sweep, which both apply the subscription as
 * re-read from Stripe rather than an event payload: the webhook through
 * applySubscriptionEvent, the sweep by handing its own retrieve to
 * handleSubscriptionChange.
 */
import type Stripe from 'stripe';
import { logger } from '@/lib/logger';
import {
  sendPlanActivatedEmail,
  sendPlanPausedEmail,
  sendPlanPaymentFailedEmail,
} from '@/lib/email-service';
import {
  StalePlanWriteError,
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
   * When the state being applied was observed: the moment the read that
   * returned it was SENT to Stripe (the webhook and the sweep both re-read
   * the subscription), taken before the request and never when the answer
   * arrives. Stripe evaluated the read no earlier than that, so the stamp
   * never claims a state is fresher than it is, however late the answer
   * comes back (see applySubscriptionEvent).
   * Anything older than the row's lastStripeEventAt is ignored.
   */
  observedAt?: Date;
}

export interface SubscriptionChangeResult {
  outcome: 'updated' | 'no-plan' | 'stale';
  status?: PlanStatus;
  pausedCount?: number;
}

export interface SubscriptionEventContext {
  eventId: string;
}

export interface SubscriptionEventResult {
  /** 'subscription-missing': an .updated for a subscription Stripe does not have — alerted, nothing written. */
  outcome: SubscriptionChangeResult['outcome'] | 'subscription-missing';
  status?: PlanStatus;
  pausedCount?: number;
}

/**
 * Stripe has no such object (404 / `resource_missing`): a subscription wiped
 * with deleted test data, or one from another account or mode. Unlike a
 * network, rate-limit or API error, a retry gets the same answer. Shared
 * with the reconciliation sweep so both agree on what "gone" means.
 */
export function isMissingStripeResource(err: unknown): boolean {
  const e = err as { code?: string; statusCode?: number } | null;
  return e?.code === 'resource_missing' || e?.statusCode === 404;
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
 * Webhook entry point for customer.subscription.updated / .deleted.
 *
 * The event payload is NOT applied. Stripe does not guarantee delivery order
 * and stamps `event.created` in whole seconds, so two events from the same
 * second cannot be ordered by their payloads: past_due then active, delivered
 * reversed, would leave a recovered plan past_due, and a .deleted followed by
 * a same-second .updated(active) would resurrect a cancelled plan. Instead
 * the subscription is re-read and the live state applied: the replay the
 * reconciliation sweep runs. Whatever order the events arrive in, the last
 * one processed applies the freshest state.
 *
 * The stamp is the time the read is SENT, taken before the request. Answers
 * do not come back in the order Stripe evaluated the reads, so a stamp taken
 * on arrival would hand a slow answer carrying the OLDER state the NEWER
 * stamp: it would pass both stale guards and land last, or reach the row
 * first and have the fresher delivery refused as stale. A send time is a
 * lower bound on when Stripe evaluated the read. The delivery for the
 * latest change sends its read after that change, so it out-stamps every
 * read that saw an older state, and the guards converge on the final state.
 * (The stamps are this server's clock, so instances only need to agree to
 * within the time Stripe takes to deliver an event.)
 *
 *   - any retrieve failure other than "no such subscription" throws, so the
 *     webhook answers 500, drops its dedupe claim and Stripe retries;
 *   - Stripe no longer has the subscription (isMissingStripeResource):
 *       .deleted → the payload's cancellation is applied (nothing fresher
 *                  exists; throwing would fail every retry until Stripe
 *                  gives up, and the plan would never be cancelled);
 *       .updated → alerted and acknowledged with nothing written, like an
 *                  event for an unknown plan.
 */
export async function applySubscriptionEvent(
  stripe: Stripe,
  payload: Stripe.Subscription,
  eventType: SubscriptionEventType,
  ctx: SubscriptionEventContext,
): Promise<SubscriptionEventResult> {
  // Before the request goes out, never once the answer is in hand (see above).
  const observedAt = new Date();
  let live: Stripe.Subscription;
  try {
    live = await stripe.subscriptions.retrieve(payload.id);
  } catch (err) {
    if (!isMissingStripeResource(err)) throw err;
    return applyVanishedSubscription(payload, eventType, ctx, observedAt);
  }
  return handleSubscriptionChange(live, eventType, { eventId: ctx.eventId, observedAt });
}

async function applyVanishedSubscription(
  payload: Stripe.Subscription,
  eventType: SubscriptionEventType,
  ctx: SubscriptionEventContext,
  readSentAt: Date,
): Promise<SubscriptionEventResult> {
  if (eventType === 'customer.subscription.deleted') {
    logger.warn('[Stripe] deleted subscription no longer exists in Stripe; applying the event payload', {
      eventId: ctx.eventId, subscriptionId: payload.id,
    });
    // "No such subscription" is itself a live observation, made by the read
    // that was just refused, so the cancellation carries that read's stamp.
    // The event's own `created` (Stripe's clock, whole seconds) would rank it
    // behind any read stamped later in the same second, and the plan would
    // keep that read's state although nothing can be fresher than the end of
    // a subscription that no longer exists.
    return handleSubscriptionChange(payload, eventType, { eventId: ctx.eventId, observedAt: readSentAt });
  }
  logger.warn('[Stripe] subscription event for a subscription Stripe does not have; skipping', {
    eventId: ctx.eventId, eventType, subscriptionId: payload.id,
  });
  await alertWebhookFailure('subscription event for a subscription Stripe does not have', null, {
    eventId: ctx.eventId, eventType, subscriptionId: payload.id, status: payload.status,
  });
  return { outcome: 'subscription-missing' };
}

/**
 * Apply one observed subscription state → keep the plan row's status and
 * paid-through date in step with Stripe. Keyed on the subscription id. The
 * webhook (applySubscriptionEvent) and the sweep pass a live read; only a
 * .deleted whose subscription Stripe no longer has falls back to its payload.
 *
 * Ordering: the webhook applies the live subscription on every event (see
 * applySubscriptionEvent), so arrival order does not decide the outcome. A
 * state observed before the last one applied to the row is still ignored:
 * two deliveries processed at once each read the subscription, and a read
 * sent earlier must never overwrite one sent later (a stale 'active' cannot
 * resurrect a plan the cancellation's delivery has cancelled, a stale
 * 'past_due' cannot downgrade a recovered one). The row read below is
 * checked first, and the write checks again in its own WHERE (upsertPlan's
 * rejectStale), since a fresher write can land between that read and this
 * write. Either way the result is 'stale', with nothing sent, resumed or
 * paused.
 *
 * Repeat cancellations: because every event re-applies the live state, a
 * cancellation also reaches a row that is already cancelled: a late or
 * same-second event processed after the .deleted, or the redelivery of the
 * cancellation itself when its side effects failed after the row write had
 * landed. Its paid-through date was anchored when the cancellation first
 * applied (now for a plan that never paid, the last paid period for a
 * past_due one) and never moves later: the period end
 * planStateFromSubscription hands back is time nobody paid for. It is not
 * announced a second time, but the row cannot tell a late repeat from a
 * first application that stopped short, so a pause that is due is still
 * carried out (applyCancellation's `repeat`).
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
 *   - 'cancelled' on a row already cancelled → no second notice; once
 *     nothing paid is left, any plan post still live is paused, and the
 *     employer is told only if that took posts down;
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
  const mapped = planStateFromSubscription(subscription, eventType, existing, now);
  const repeatCancellation = existing.status === 'cancelled' && mapped.status === 'cancelled';
  const next = repeatCancellation && existing.currentPeriodEnd.getTime() < mapped.currentPeriodEnd.getTime()
    ? { status: mapped.status, currentPeriodEnd: existing.currentPeriodEnd }
    : mapped;

  let updated: PlanRow;
  try {
    updated = await upsertPlan({
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
    }, { rejectStale: true });
  } catch (err) {
    if (!(err instanceof StalePlanWriteError)) throw err;
    // A delivery that read the subscription later wrote first: its state
    // stands, and so do the side effects it ran.
    logger.info('[Stripe] subscription event overtaken by a fresher write; not applied', {
      eventType, subscriptionId: subscription.id, planId: existing.id,
    });
    return { outcome: 'stale', status: (err.current?.status ?? existing.status) as PlanStatus };
  }

  let pausedCount = 0;
  if (existing.userId) {
    const entitled = isPlanEntitled({ status: next.status, currentPeriodEnd: next.currentPeriodEnd }, now);
    if (next.status === 'cancelled') {
      pausedCount = await applyCancellation(existing, next.currentPeriodEnd, entitled, ctx.eventId, now, repeatCancellation);
    } else if (entitled && next.status === 'active') {
      await resumePlanPosts(existing.userId);
      if (existing.status === 'pending') {
        await sendOnce(`plan-activated:sub:${subscription.id}`, existing.email, 'plan_activated',
          () => sendPlanActivatedEmail(existing.email, { slots: updated.slots, currentPeriodEnd: next.currentPeriodEnd }), existing.id);
      }
    }
  }

  logger.info('[Stripe] employer plan subscription updated', {
    planId: existing.id, previousStatus: existing.status, status: next.status, eventType, pausedCount, repeatCancellation,
  });
  return { outcome: 'updated', status: next.status, pausedCount };
}

/**
 * Side effects of a cancellation: the notice, and the pause once nothing
 * paid is left.
 *
 * `repeat`: the row was already cancelled when this cancellation arrived. It
 * was announced when it first applied, so it is not announced again. The
 * pause may still be owed, though: a first application can stop between its
 * row write and these side effects (pausePlanPosts throws and the webhook
 * answers 500, or the function dies), and its redelivery then finds the row
 * cancelled and comes through here as a repeat. So a repeat still runs the
 * pause when it is due. pausePlanPosts takes down only what is still live,
 * and a repeat tells the employer only when it took something down, which
 * is the lapse sweep's rule. Inside the paid period a repeat has nothing to
 * finish: the posts stay up until the lapse sweep pauses them.
 */
async function applyCancellation(
  existing: PlanRow & { userId: string | null },
  liveUntil: Date,
  stillEntitled: boolean,
  eventId: string,
  now: Date,
  repeat: boolean,
): Promise<number> {
  if (!existing.userId) return 0;
  // A plan that was never entitled (pending) owns no live posts — nothing to tell.
  if (existing.status === 'pending') return 0;
  const emailKey = `plan-paused:${eventId}`;
  if (stillEntitled) {
    if (repeat) return 0;
    await sendOnce(emailKey, existing.email, 'plan_paused',
      () => sendPlanPausedEmail(existing.email, { reason: 'cancelled', pausedCount: 0, liveUntil }), existing.id);
    return 0;
  }
  const pausedCount = (await pausePlanPosts(existing.userId, now)).length;
  if (repeat && pausedCount === 0) return 0;
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
