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
 * If the best-effort 'new' charge write (activate-paid-job.ts) ever failed,
 * the rule falls back to the lower price.
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
  /** At most one 'new' charge; missing when the row was loaded without it. */
  jobCharges?: readonly unknown[] | null;
}

/**
 * The rung of a row loaded with NEW_POST_CHARGE_SELECT. The stored tier is
 * read as it is, never narrowed first (lib/pricing.ts#asPaidTier turns every
 * unknown tier into 'pro' to avoid under-charging a new post, which would
 * price a legacy row at the pro renewal here).
 */
export function renewalRungForRow(row: RenewalPriceRow): RenewalRung {
  return renewalRungFor({
    pricingTier: row.pricingTier,
    hasNewPostCharge: (row.jobCharges?.length ?? 0) > 0,
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
