/**
 * lib/renewal-offer.ts — the renewal offer (config.renewalPrice): whether a
 * saving may be claimed for it, and in which words.
 *
 * A renewal is only worth pitching as a saving when it is cheaper than the
 * new post the SAME reader would otherwise buy. That is never true during
 * the launch promo (a new post is free) or for an employer with a free
 * Employer plan slot, and a domain whose next post is the intro price saves
 * far less than the list prices suggest. This module is the one place the
 * claim is decided, for every surface: the expiry emails and the cron phrase
 * it through renewalSavingsLabel, the dashboard and the edit page through
 * renewalSavingsLine.
 *
 * Client-safe: it imports only lib/config. The dashboard and the edit page
 * are client bundles and cannot import lib/pricing.ts (it loads the Prisma
 * client), which is why each used to carry its own copy of this rule.
 * lib/pricing.ts re-exports renewalSavings, resolveRenewalOffer,
 * renewalSavingsLabel and their types, so server importers kept their import
 * path, and keeps nextNewPostPrice, the one input that needs the database.
 * tests/lib/renewal-offer.test.ts fails if this file ever imports Prisma or
 * lib/pricing.
 */
import { config } from '@/lib/config';

/**
 * What a renewal saves against a new post. `basis` says which new-post price
 * the claim is made against, so the wording can say so:
 *   'next-post'  — the reader's own next new post (resolvePostingMode's price)
 *   'list-price' — the standard post price (config.postingPrice), for a
 *                  surface that does not know the reader's quota domain
 */
export interface RenewalSavings {
  /** Whole dollars saved. */
  dollars: number;
  /** Whole percent saved, rounded DOWN so the claim never overstates. */
  percent: number;
  /** The new-post price, in dollars, the renewal is compared with. */
  comparedWith: number;
  basis: 'next-post' | 'list-price';
}

export interface RenewalOffer {
  /** A renewal can be bought right now: paid posting enabled and Stripe configured. */
  purchasable: boolean;
  /** The launch promo is running, so every new post is free. */
  promoActive: boolean;
  /** config.renewalPrice, in dollars. */
  price: number;
  /** A savings claim that is true for this reader, or null when none is. */
  savings: RenewalSavings | null;
}

/** The inputs that decide one reader's renewal offer (see resolveRenewalOffer). */
export interface RenewalOfferInputs {
  purchasable: boolean;
  nextPostPrice?: number | null;
  now?: Date;
}

/** Savings of `renewalPrice` against `comparedWith`, or null when the renewal is not cheaper by at least 1%. */
export function renewalSavings(
  comparedWith: number,
  basis: RenewalSavings['basis'],
  renewalPrice: number = config.renewalPrice,
): RenewalSavings | null {
  if (!Number.isFinite(comparedWith) || comparedWith <= renewalPrice) return null;
  const dollars = comparedWith - renewalPrice;
  const percent = Math.floor((dollars / comparedWith) * 100);
  if (percent < 1) return null;
  return { dollars, percent, comparedWith, basis };
}

/**
 * Decide the renewal offer for one reader.
 *
 *   purchasable  — the caller's paid-posting check (lib/env#getPaidPostingStatus,
 *                  the same one behind /api/create-checkout/availability);
 *                  when false no renewal is offered, so no saving is claimed
 *   nextPostPrice — the reader's own next new-post price in dollars
 *                  (lib/pricing.ts#nextNewPostPrice, or the `price` of
 *                  /api/employer/free-quota-status in the browser), or
 *                  null/undefined when unknown; unknown compares with
 *                  config.postingPrice and says so
 *
 * A saving is claimed only when the renewal can be bought, the promo is over
 * and the renewal is actually cheaper than the price it is compared with.
 */
export function resolveRenewalOffer(opts: RenewalOfferInputs): RenewalOffer {
  const promoActive = config.isPromoActive(opts.now ?? new Date());
  const known = typeof opts.nextPostPrice === 'number' && Number.isFinite(opts.nextPostPrice);
  const savings = opts.purchasable && !promoActive
    ? (known
      ? renewalSavings(opts.nextPostPrice as number, 'next-post')
      : renewalSavings(config.postingPrice, 'list-price'))
    : null;
  return { purchasable: opts.purchasable, promoActive, price: config.renewalPrice, savings };
}

/** The savings claim in words that name the price it is measured against. */
export function renewalSavingsLabel(savings: RenewalSavings): string {
  return savings.basis === 'next-post'
    ? `Save ${savings.percent}% vs. your next new post at $${savings.comparedWith}`
    : `Save ${savings.percent}% vs. the $${savings.comparedWith} post price`;
}

/**
 * The line a page prints beside the renewal price: resolveRenewalOffer's
 * claim in renewalSavingsLabel's words, or null when no saving is true for
 * this reader. Decided per call, so a page that calls it while rendering
 * claims nothing during the promo and names the saving from the moment the
 * promo ends, with no deploy.
 */
export function renewalSavingsLine(opts: RenewalOfferInputs): string | null {
  const { savings } = resolveRenewalOffer(opts);
  return savings ? renewalSavingsLabel(savings) : null;
}
