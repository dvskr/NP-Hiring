/**
 * lib/stripe.ts — the one place a server-side Stripe client is constructed.
 *
 * Every payment route, the webhook and the Inngest sweeps call getStripe()
 * instead of `new Stripe(key)` so the wire API version is pinned in ONE
 * place and cannot silently change under a live integration when the
 * `stripe` package is bumped. STRIPE_API_VERSION is the version the installed
 * SDK (stripe@22.6.2) is typed against; upgrading the SDK means changing it
 * here deliberately and re-checking the webhook payload shapes (notably
 * current_period_start/end, which moved from Subscription to SubscriptionItem).
 * Register 2.8 (2026-10-22) moved it from 2025-11-17.clover: none of the
 * Dahlia breaking changes touches a field this code sends or reads.
 * tests/lib/stripe-api-version.test.ts holds it to the installed SDK.
 *
 * Lazy by design: a missing STRIPE_SECRET_KEY returns null so callers can
 * answer with a clean 503 instead of crashing at module import.
 */
import Stripe from 'stripe';
import { cleanSecret } from '@/lib/clean-secret';

export const STRIPE_API_VERSION = '2026-08-26.dahlia' as const;

export function getStripe(): Stripe | null {
  // Trimmed, and unset when only whitespace (cleanSecret, register 2.26).
  const key = cleanSecret(process.env.STRIPE_SECRET_KEY);
  if (!key) return null;
  return new Stripe(key, { apiVersion: STRIPE_API_VERSION });
}
