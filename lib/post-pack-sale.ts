/**
 * lib/post-pack-sale.ts — whether the 5-post pack can be sold right now,
 * and the identifiers its checkout, webhook and GA event share.
 *
 * The same gate the Employer plan sale used (lib/employer-plan-link.ts
 * isPlanSaleOpen, backlog 2.16), without the Payment Link: the pack is sold
 * through a Checkout Session the server creates (/api/create-pack-checkout).
 * Closed unless every one holds:
 *   - the launch promo is over: every post is free until config.promoEndsAt,
 *     so a pack would buy nothing (owner decision: sold once the ladder is
 *     live);
 *   - paid posting is on and the Stripe key is set (getPaidPostingStatus);
 *   - STRIPE_WEBHOOK_SECRET is set: without it POST /api/webhooks/stripe
 *     answers 503, and Stripe would take money the webhook cannot record.
 * An environment that will not parse reads as closed.
 */
import { getEnv, getPaidPostingStatus } from '@/lib/env';
import { config } from '@/lib/config';

/** Checkout Session metadata.type of a pack purchase: how the webhook and the sweep tell it from a post. */
export const POST_PACK_CHECKOUT_TYPE = 'post_pack';

/** The pack's SKU: Checkout metadata.sku and the GA purchase item id. */
export const POST_PACK_SKU = `post-pack-${config.packPosts}`;

/** True when a pack can be bought right now (see the file header). */
export function isPackSaleOpen(now: Date = new Date()): boolean {
  try {
    return getPaidPostingStatus().available
      && !!getEnv().STRIPE_WEBHOOK_SECRET
      && !config.isPromoActive(now);
  } catch {
    return false;
  }
}
