/**
 * lib/post-pack-sale.ts — whether the 5-post pack can be sold right now,
 * and the identifiers its checkout, webhook and GA event share.
 *
 * The same gate the retired Employer plan's sale used (backlog 2.16; its
 * code was deleted in phase 4 of the 2027 re-price), without the Payment
 * Link: the pack is sold through a Checkout Session the server creates
 * (/api/create-pack-checkout).
 * Closed unless every one holds, checked in this order:
 *   - paid posting is on (ENABLE_PAID_POSTING);
 *   - the Stripe key and STRIPE_WEBHOOK_SECRET are set: without the secret
 *     POST /api/webhooks/stripe answers 503, and Stripe would take money the
 *     webhook cannot record;
 *   - the launch promo is over: every post is free until config.promoEndsAt,
 *     so a pack would buy nothing (owner decision: sold once the ladder is
 *     live).
 * packSaleClosedReason names the first that fails, and is the one copy of
 * the gate: isPackSaleOpen reads it, and /api/create-pack-checkout answers
 * with it. An environment that will not parse reads as closed, and is logged.
 */
import { getEnv, getPaidPostingStatus } from '@/lib/env';
import { config } from '@/lib/config';
import { logger } from '@/lib/logger';

/** Checkout Session metadata.type of a pack purchase: how the webhook and the sweep tell it from a post. */
export const POST_PACK_CHECKOUT_TYPE = 'post_pack';

/** The pack's SKU: Checkout metadata.sku and the GA purchase item id. */
export const POST_PACK_SKU = `post-pack-${config.packPosts}`;

/**
 * Who a pack is sold to, as the server names them: the signed-in account,
 * its sign-in email, and the signup domain the intro rule reads.
 */
export interface PackBuyer {
  userId: string;
  email: string;
  quotaDomain: string;
}

/** Why the pack cannot be sold right now; each is the code /api/create-pack-checkout answers. */
export type PackSaleClosedReason = 'PAID_POSTING_DISABLED' | 'STRIPE_NOT_CONFIGURED' | 'PROMO_ACTIVE';

/** The first condition of the gate that fails at `now` (see the file header); null while the pack can be sold. */
export function packSaleClosedReason(now: Date = new Date()): PackSaleClosedReason | null {
  try {
    const paidPosting = getPaidPostingStatus();
    if (!paidPosting.enabled) return 'PAID_POSTING_DISABLED';
    if (!paidPosting.stripeConfigured || !getEnv().STRIPE_WEBHOOK_SECRET) return 'STRIPE_NOT_CONFIGURED';
    return config.isPromoActive(now) ? 'PROMO_ACTIVE' : null;
  } catch (err) {
    // Nothing about Stripe can be trusted from an environment that will not parse.
    logger.error('[PackSale] The environment would not parse; the 5-post pack sale reads as closed', err);
    return 'STRIPE_NOT_CONFIGURED';
  }
}

/** True when a pack can be bought right now (see the file header). */
export function isPackSaleOpen(now: Date = new Date()): boolean {
  return packSaleClosedReason(now) === null;
}
