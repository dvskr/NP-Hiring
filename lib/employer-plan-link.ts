/**
 * lib/employer-plan-link.ts — the Employer plan's Stripe Payment Link.
 *
 * One place decides whether the plan can be sold right now and what URL a
 * buyer is sent to, so /pricing, the dashboard widget (/api/employer/plan)
 * and /api/employer/plan/subscribe can never disagree:
 *
 *   - the link must be a real Stripe Payment Link (https://buy.stripe.com/…)
 *     — a typo or a foreign URL fails CLOSED (no link) instead of turning the
 *     money CTA into someone else's payment page;
 *   - plan sales are closed while ENABLE_PAID_POSTING is off or the launch
 *     promo runs (every post is free then; a $399/month charge buys nothing);
 *   - a signed-in employer's link carries `client_reference_id` (their
 *     account id — the ONLY key the webhook attaches a plan by) and
 *     `prefilled_email`.
 */
import { getEnv, isFeatureEnabled } from '@/lib/env';
import { config } from '@/lib/config';
import { logger } from '@/lib/logger';

export const PLAN_PAYMENT_LINK_PREFIX = 'https://buy.stripe.com/';

/** The configured Payment Link if it is a well-formed Stripe link, else null. */
export function planPaymentLinkBase(): string | null {
  let raw: string | undefined;
  try {
    raw = getEnv().STRIPE_PLAN_PAYMENT_LINK;
  } catch {
    return null;
  }
  if (!raw) return null;
  if (!isValidPlanPaymentLink(raw)) {
    logger.error('STRIPE_PLAN_PAYMENT_LINK is not a Stripe Payment Link URL — plan checkout disabled', null);
    return null;
  }
  return raw;
}

export function isValidPlanPaymentLink(value: string): boolean {
  try {
    const url = new URL(value);
    return value.startsWith(PLAN_PAYMENT_LINK_PREFIX) && url.protocol === 'https:' && url.hostname === 'buy.stripe.com';
  } catch {
    return false;
  }
}

/** True when the plan can be bought right now (link configured, paid posting on, promo over). */
export function isPlanSaleOpen(now: Date = new Date()): boolean {
  try {
    return planPaymentLinkBase() !== null && isFeatureEnabled('paidPosting') && !config.isPromoActive(now);
  } catch {
    return false;
  }
}

/** The Payment Link for this signed-in employer, or null when plan sales are closed. */
export function buildPlanPaymentLink(account: { userId: string; email: string | null }, now: Date = new Date()): string | null {
  if (!isPlanSaleOpen(now)) return null;
  const base = planPaymentLinkBase();
  if (!base) return null;
  const url = new URL(base);
  url.searchParams.set('client_reference_id', account.userId);
  if (account.email) url.searchParams.set('prefilled_email', account.email);
  return url.toString();
}
