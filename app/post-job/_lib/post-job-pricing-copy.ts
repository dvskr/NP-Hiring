/**
 * The /post-job wizard's pricing sentences for `now`.
 *
 * While the launch promo runs they say every post is free through
 * config.promoEndsLabel (the sentences the wizard has always printed); from
 * config.promoEndsAt they state the ladder as the current price, in the
 * present tense, with no "free" and no "From January 1, 2027".
 *
 * The wizard calls this inside its component on every render, never at
 * module load: a module-scope string is evaluated once per bundle load (and
 * once at build for a prerendered page), so it would keep promising free
 * posting after the promo ends (lib/pricing-copy.ts). The wizard's content
 * renders in the browser (it sits under the page's useSearchParams Suspense
 * boundary), so the phase is the one in force when the employer opens it.
 *
 * Client-safe: imports only lib/config and lib/pricing-copy.
 */
import { config } from '@/lib/config';
import { PROMO_HEADLINE, ladderLine } from '@/lib/pricing-copy';

export interface PostJobPricingCopy {
  /** Under the page h1. */
  subtitle: string;
  /** Step 5, under "Your Posting Includes". */
  packageIntro: string;
  /** Step 5, under "Full Package for Every Post". */
  packagePrice: string;
}

export function postJobPricingCopy(now: Date = new Date()): PostJobPricingCopy {
  if (config.isPromoActive(now)) {
    return {
      subtitle: `${PROMO_HEADLINE}. Every feature included, no credit card required.`,
      packageIntro: 'Every job post gets the full package, free or paid',
      packagePrice: PROMO_HEADLINE,
    };
  }
  // The promo is over, so ladderLine is the undated present-tense sentence.
  const prices = ladderLine(now);
  return {
    subtitle: `Every feature included. ${prices}`,
    packageIntro: 'Every job post gets the full package',
    packagePrice: prices,
  };
}
