/**
 * lib/stripe.ts — the one place a server-side Stripe client is constructed.
 *
 * Every payment route, the webhook and the Inngest sweeps call getStripe()
 * instead of `new Stripe(key)` so the wire API version is pinned in ONE
 * place and cannot silently change under a live integration when the
 * `stripe` package is bumped. STRIPE_API_VERSION is the version the installed
 * SDK (stripe@20.0.0) is typed against; upgrading the SDK means changing it
 * here deliberately and re-checking the webhook payload shapes (notably
 * current_period_start/end, which moved from Subscription to SubscriptionItem).
 *
 * Lazy by design: a missing STRIPE_SECRET_KEY returns null so callers can
 * answer with a clean 503 instead of crashing at module import.
 */
import Stripe from 'stripe';

export const STRIPE_API_VERSION = '2025-11-17.clover' as const;

export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key, { apiVersion: STRIPE_API_VERSION });
}
