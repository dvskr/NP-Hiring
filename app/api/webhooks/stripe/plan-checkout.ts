/**
 * Employer plan ($399/month, config.planPrice) checkout fulfilment.
 *
 * Shared by the Stripe webhook (`checkout.session.completed` and
 * `checkout.session.async_payment_succeeded` in subscription mode) and the
 * daily plan reconciliation sweep (lib/inngest/functions/plan-reconciliation.ts)
 * so both run exactly the same rules.
 *
 * Account linking: the plan is attached ONLY by a server-issued account
 * reference — `client_reference_id` (added to the Payment Link by
 * /api/employer/plan and /api/employer/plan/subscribe for a signed-in
 * employer) or `metadata.userId` — and only when it resolves to an employer
 * profile. The checkout email is typed by the buyer and proves nothing, so an
 * email match never attaches: the row is stored unattached and an admin links
 * it (the alert says whether the email matches an employer account).
 *
 * Money rules:
 *   - a session whose payment has not settled (payment_status 'unpaid', or a
 *     subscription still 'incomplete') is stored 'pending' — never entitled,
 *     no posts resumed, no welcome email; async_payment_succeeded or the
 *     subscription turning 'active' promotes it;
 *   - only the Employer plan price (lookup key / SKU) is fulfilled, and the
 *     stored price is what Stripe's price actually says;
 *   - a second live subscription for an employer who already has one is
 *     tracked on a separate unattached row and alerted — never silently
 *     written over the first.
 *
 * Throws on Stripe/DB failures so the webhook can 500 and let Stripe retry.
 */
import type Stripe from 'stripe';
import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';
import { logger } from '@/lib/logger';
import { isFeatureEnabled } from '@/lib/env';
import { anonymizeEmail } from '@/lib/server-utils';
import {
  sendPlanActivatedEmail,
  sendPlanLinkPendingEmail,
} from '@/lib/email-service';
import {
  PLAN_PRICE_LOOKUP_KEY,
  PLAN_SKU,
  PlanSubscriptionConflictError,
  getPlanBySubscriptionId,
  getPlanForUser,
  isPlanEntitled,
  mapStripeSubscriptionStatus,
  resumePlanPosts,
  upsertPlan,
  wouldOrphanSubscription,
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

export type PlanCheckoutOutcome =
  | 'activated'
  | 'pending_payment'
  | 'unmatched'
  | 'duplicate_subscription'
  | 'not_plan'
  | 'no-email'
  | 'no-subscription';

export interface PlanCheckoutContext {
  /** Stripe event id, or a synthetic label for the reconciliation sweep. */
  eventId: string;
  /** Stripe `event.created` (seconds). Omitted by the sweep. */
  eventCreated?: number;
}

/** True when the subscription is for the Employer plan price. */
export function isEmployerPlanSubscription(subscription: Stripe.Subscription): boolean {
  const price = subscription.items?.data?.[0]?.price;
  return price?.lookup_key === PLAN_PRICE_LOOKUP_KEY
    || price?.metadata?.sku === PLAN_SKU
    || subscription.metadata?.sku === PLAN_SKU;
}

/** Resolve the employer account from the server-issued checkout reference only. */
async function resolveReferencedEmployer(session: Stripe.Checkout.Session): Promise<string | null> {
  const references = [session.client_reference_id, session.metadata?.userId]
    .filter((ref): ref is string => typeof ref === 'string' && ref.trim().length > 0);
  for (const ref of references) {
    const profile = await prisma.userProfile.findFirst({
      where: { supabaseId: ref.trim(), role: 'employer' },
      select: { supabaseId: true },
    });
    if (profile) return profile.supabaseId;
  }
  return null;
}

async function emailMatchesEmployer(email: string): Promise<boolean> {
  const profile = await prisma.userProfile.findFirst({
    where: { email: { equals: email, mode: 'insensitive' }, role: 'employer' },
    select: { supabaseId: true },
  });
  return !!profile;
}

/** Plan sales are closed while paid posting is off or the free launch promo runs. */
function planSalesOpen(): boolean {
  try {
    return isFeatureEnabled('paidPosting') && !config.isPromoActive();
  } catch {
    return false;
  }
}

async function sendOnce(dedupeKey: string, to: string, emailType: string, send: () => Promise<unknown>, context: Record<string, string>): Promise<void> {
  if (!(await claimEmailSend(dedupeKey, to, emailType))) return;
  try {
    await send();
  } catch (emailErr) {
    logger.error(`[Stripe] Failed to send ${emailType} email`, emailErr, context);
    await releaseEmailClaim(dedupeKey);
  }
}

export async function handlePlanCheckout(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
  ctx: PlanCheckoutContext,
): Promise<{ outcome: PlanCheckoutOutcome }> {
  const { eventId } = ctx;
  const email = session.customer_details?.email ?? session.customer_email ?? null;
  const subscriptionId = stripeIdOf(session.subscription);
  const customerId = stripeIdOf(session.customer);

  if (!email) {
    // Won't get better on retry; keep the dedupe row, tell a human.
    logger.error('[Stripe] plan checkout has no customer email', null, { sessionId: session.id, subscriptionId: subscriptionId ?? undefined });
    await alertWebhookFailure('plan checkout has no customer email', null, {
      eventId, sessionId: session.id, subscriptionId: subscriptionId ?? undefined,
    });
    return { outcome: 'no-email' };
  }
  const emailHash = anonymizeEmail(email);
  if (!subscriptionId) {
    logger.error('[Stripe] plan checkout has no subscription id', null, { sessionId: session.id, emailHash });
    await alertWebhookFailure('plan checkout has no subscription id', null, { eventId, sessionId: session.id, emailHash });
    return { outcome: 'no-subscription' };
  }

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  if (!isEmployerPlanSubscription(subscription)) {
    logger.error('[Stripe] subscription checkout is not for the Employer plan price — not fulfilled', null, { sessionId: session.id, subscriptionId });
    await alertWebhookFailure('subscription checkout is not the Employer plan — nothing granted', null, { eventId, sessionId: session.id, subscriptionId });
    return { outcome: 'not_plan' };
  }
  const periodEnd = subscriptionPeriodEnd(subscription);
  if (!periodEnd) {
    // A subscription with no period end is malformed for our purposes;
    // throw so the event is retried rather than storing a bogus window.
    throw new Error(`Stripe subscription ${subscriptionId} has no current_period_end`);
  }

  const mapped = mapStripeSubscriptionStatus(subscription.status);
  // A completed Checkout Session is not a successful payment.
  const status: PlanStatus = session.payment_status === 'unpaid' && mapped !== 'cancelled' ? 'pending' : mapped;
  // past_due: Stripe already advanced the period to the unpaid one, so the
  // paid-through anchor is the current period's START (see handleSubscriptionChange).
  const currentPeriodEnd = status === 'past_due' ? (subscriptionPeriodStart(subscription) ?? periodEnd) : periodEnd;
  const priceCents = subscription.items?.data?.[0]?.price?.unit_amount ?? undefined;

  const userId = await resolveReferencedEmployer(session);
  const previous = await getPlanBySubscriptionId(subscriptionId);
  const baseInput = {
    email,
    status,
    currentPeriodEnd,
    priceCents,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    source: 'stripe' as const,
    ...(ctx.eventCreated !== undefined && { lastStripeEventAt: new Date(ctx.eventCreated * 1000) }),
  };

  if (!planSalesOpen()) {
    // Money was taken while plan sales are meant to be closed. Still record
    // the row (below) so nothing is lost, but an operator must refund.
    await alertWebhookFailure('Employer plan purchased while plan sales are closed (paid posting off or launch promo) — refund required', null, {
      eventId, sessionId: session.id, subscriptionId,
    });
  }

  // Duplicate subscription: the employer already has a row tracking a
  // different live subscription.
  const current = userId ? await getPlanForUser(userId) : null;
  const conflictRow = current && current.stripeSubscriptionId !== subscriptionId && wouldOrphanSubscription(current, subscriptionId)
    ? current
    : null;

  let plan;
  let duplicateOf: { planId: string; subscriptionId: string | null } | null = conflictRow
    ? { planId: conflictRow.id, subscriptionId: conflictRow.stripeSubscriptionId }
    : null;
  if (!duplicateOf) {
    try {
      plan = await upsertPlan({ ...baseInput, userId });
    } catch (err) {
      if (!(err instanceof PlanSubscriptionConflictError)) throw err;
      duplicateOf = { planId: err.existing.id, subscriptionId: err.existing.stripeSubscriptionId };
    }
  }

  if (duplicateOf) {
    // Track the new subscription on its own unattached row so its events
    // resolve, leave the live plan untouched, and page a human to refund /
    // cancel one of the two (policy is an owner decision).
    plan = await upsertPlan({ ...baseInput, userId: null }, { detached: true });
    logger.error('[Stripe] duplicate employer subscription — stored detached, not granted', null, {
      sessionId: session.id, planId: plan.id, existingPlanId: duplicateOf.planId, subscriptionId,
    });
    await alertWebhookFailure('duplicate employer subscription — cancel/refund one of them', null, {
      eventId,
      sessionId: session.id,
      planId: plan.id,
      existingPlanId: duplicateOf.planId,
      oldSubscriptionId: duplicateOf.subscriptionId ?? undefined,
      newSubscriptionId: subscriptionId,
      emailHash,
    });
    return { outcome: 'duplicate_subscription' };
  }

  if (!plan) throw new Error(`employer plan upsert produced no row for ${subscriptionId}`);
  const row = plan;

  if (status === 'pending') {
    logger.info('[Stripe] plan checkout completed but payment not settled — stored pending', {
      planId: row.id, sessionId: session.id, subscriptionId, paymentStatus: session.payment_status, subscriptionStatus: subscription.status,
    });
    return { outcome: 'pending_payment' };
  }

  if (!userId) {
    if (status === 'active') {
      await sendOnce(`plan-link-pending:${session.id}`, email, 'plan_link_pending', () => sendPlanLinkPendingEmail(email), { planId: row.id });
    }
    const hint = (await emailMatchesEmployer(email)) ? 'yes' : 'no';
    logger.warn('[Stripe] plan checkout carried no employer account reference — stored unattached', {
      planId: row.id, emailHash, subscriptionId, emailMatchesEmployer: hint,
    });
    await alertWebhookFailure('plan checkout matched no employer', null, {
      eventId, sessionId: session.id, planId: row.id, emailHash, subscriptionId, emailMatchesEmployer: hint,
    });
    return { outcome: 'unmatched' };
  }

  if (isPlanEntitled(row)) {
    // Re-subscribing after a lapse: bring paused plan posts back within slots.
    await resumePlanPosts(userId);
  }

  if (status === 'active') {
    // Welcome email behind the B109 claim. A plan that was 'pending' is
    // promoted by EITHER this path (async_payment_succeeded) or the
    // subscription turning active — both use the subscription-scoped key so
    // exactly one of them sends.
    const emailKey = previous?.status === 'pending' ? `plan-activated:sub:${subscriptionId}` : `plan-activated:${session.id}`;
    await sendOnce(emailKey, email, 'plan_activated', () => sendPlanActivatedEmail(email, { slots: row.slots, currentPeriodEnd }), { planId: row.id });
  }

  logger.info('[Stripe] employer plan activated', { planId: row.id, userId, status, subscriptionId });
  return { outcome: 'activated' };
}

/**
 * `checkout.session.async_payment_failed` for a plan checkout: the delayed
 * payment never arrived. The row stays non-entitled — a still-'pending' row
 * is closed as 'cancelled' with no paid-through time — and a human is told.
 */
export async function handlePlanAsyncPaymentFailed(
  session: Stripe.Checkout.Session,
  eventId: string,
): Promise<{ outcome: 'closed' | 'no-plan' | 'not-pending' }> {
  const subscriptionId = stripeIdOf(session.subscription);
  const plan = subscriptionId ? await getPlanBySubscriptionId(subscriptionId) : null;
  await alertWebhookFailure('Employer plan delayed payment failed — plan not granted', null, {
    eventId, sessionId: session.id, subscriptionId: subscriptionId ?? undefined, planId: plan?.id,
  });
  if (!plan) return { outcome: 'no-plan' };
  if (plan.status !== 'pending') return { outcome: 'not-pending' };
  await upsertPlan({
    userId: plan.userId,
    email: plan.email,
    status: 'cancelled',
    currentPeriodEnd: new Date(),
    slots: plan.slots,
    priceCents: plan.priceCents,
    stripeSubscriptionId: plan.stripeSubscriptionId,
    source: 'stripe',
  });
  logger.warn('[Stripe] plan delayed payment failed — pending plan closed', { planId: plan.id, subscriptionId });
  return { outcome: 'closed' };
}
