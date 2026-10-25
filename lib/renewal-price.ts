/**
 * lib/renewal-price.ts — which renewal price a post pays.
 *
 * A renewal costs the base price (config.renewalPrice) for every renewable
 * post except one that was BOUGHT at the posting price, which renews at the
 * pro price (config.proRenewalPrice). pricingTier plus paymentStatus cannot
 * tell those apart: a promo post is written ('promo', 'pro'), and the renewal
 * webhook rewrites a renewed promo post to ('paid', 'pro'), which is exactly
 * what a bought post reads as. The ledger tells them apart: only a post
 * bought through Checkout has a JobCharge of type 'new'
 * (lib/pricing.ts#NEW_POST_CHARGE_SELECT loads it; lib/pricing.ts#paidPostWhere
 * relies on the same fact).
 *
 *   'pro'  — pricingTier 'pro' AND the row has a 'new' charge
 *   'base' — everything else: promo posts (renewed or not), intro posts, pack
 *            posts, legacy paid rows with no charge, legacy free_renewed and
 *            free_upgraded rows
 *
 * If the 'new' charge write (activate-paid-job.ts) ever failed, the rule
 * falls back to the lower price; the webhook now answers 500 on that failure,
 * so Stripe's retry records the charge.
 *
 * A row loaded WITHOUT NEW_POST_CHARGE_SELECT is not that case: its price
 * cannot be told, and guessing the lower one undercharged every post bought
 * at the posting price (review 2.28 M1). RenewalPriceRow requires
 * jobCharges, so such a query fails type-check, and renewalRungForRow throws
 * at run time instead of guessing.
 *
 * Client-safe: it imports only lib/config, so the dashboard and the edit page
 * can share the rung type; tests/lib/renewal-price.test.ts fails if that
 * ever changes. The price itself is config.renewalPriceCentsFor /
 * renewalPriceDollarsFor.
 */
import type { RenewalRung } from '@/lib/config';

/** What decides a post's renewal rung. */
export interface RenewalRungInputs {
  /** EmployerJob.pricingTier as stored. */
  pricingTier: string | null | undefined;
  /** The row has a JobCharge of type 'new', that is, it was bought through Checkout. */
  hasNewPostCharge: boolean;
}

/** The rung of one post: 'pro' only for a 'pro' post that was bought. */
export function renewalRungFor({ pricingTier, hasNewPostCharge }: RenewalRungInputs): RenewalRung {
  return pricingTier === 'pro' && hasNewPostCharge ? 'pro' : 'base';
}

/** An EmployerJob loaded with lib/pricing.ts#NEW_POST_CHARGE_SELECT. */
export interface RenewalPriceRow {
  pricingTier?: string | null;
  /**
   * At most one 'new' charge. Required: a row loaded without the select
   * cannot be priced, so leaving it out fails type-check.
   */
  jobCharges: readonly unknown[];
}

/**
 * The rung of a row loaded with NEW_POST_CHARGE_SELECT. The stored tier is
 * read as it is, never narrowed first (lib/pricing.ts#asPaidTier turns every
 * unknown tier into 'pro' to avoid under-charging a new post, which would
 * price a legacy row at the pro renewal here). Throws for a row whose
 * charges were not loaded (a cast past the type): the renewal checkout
 * answers a logged 500 and sells nothing at a guessed price.
 */
export function renewalRungForRow(row: RenewalPriceRow): RenewalRung {
  if (!Array.isArray(row.jobCharges)) {
    throw new Error('renewalRungForRow: the row was loaded without NEW_POST_CHARGE_SELECT, so its renewal price is unknown');
  }
  return renewalRungFor({
    pricingTier: row.pricingTier,
    hasNewPostCharge: row.jobCharges.length > 0,
  });
}

/**
 * Narrow an untrusted value (a Checkout Session's metadata.renewalRung) to a
 * rung. A session minted before rungs existed carries none, and every
 * renewal then cost the base price.
 */
export function asRenewalRung(value: unknown): RenewalRung {
  return value === 'pro' ? 'pro' : 'base';
}
