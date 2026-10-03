/**
 * The post-a-job call to action on the employer resources pages: the hub,
 * the template library and every template page (backlog 2.1). The job
 * description guide states no price and uses the button label alone.
 *
 * While the launch promo runs it is the sentence and the button those pages
 * have printed since 2026-09-12. Once config.promoEndsAt has passed it
 * states the ladder as the current price, in the shared sentences of
 * lib/pricing-copy.ts, and the button no longer says "Free". Each page calls
 * postJobCta(new Date()) per render and re-renders hourly, never at module
 * load (lib/pricing-copy.ts explains why), so the switch needs no deploy.
 * Not a route file: a Next.js page may export only Next's own names, and
 * tests call this with both dates.
 */
import { config } from '@/lib/config';
import { FULL_PACKAGE, LADDER_PRICES } from '@/lib/pricing-copy';

export interface PostJobCta {
  /** The price with what every post includes: the hub and each template page. */
  offer: string;
  /** The price alone: the template library, whose CTA already explains the templates. */
  price: string;
  /** The button label: every page above, and the job description guide. */
  button: string;
}

/** The post-a-job CTA for `now`. */
export function postJobCta(now: Date): PostJobCta {
  if (config.isPromoActive(now)) {
    return {
      offer: `Every post is free through ${config.promoEndsLabel}, with every feature included.`,
      price: `Every post is free through ${config.promoEndsLabel}.`,
      button: 'Post a Job: Free',
    };
  }
  return {
    offer: `${LADDER_PRICES} ${FULL_PACKAGE}`,
    price: LADDER_PRICES,
    button: 'Post a Job',
  };
}
