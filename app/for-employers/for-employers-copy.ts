/**
 * /for-employers copy, split by the launch-promo clock (backlog 2.1).
 *
 * app/for-employers/page.tsx calls forEmployersCopy(now) at render time and
 * again in generateMetadata, never at module load, and re-renders hourly, so
 * the receipt hero, the pricing card, the FAQ (and its FAQPage JSON-LD), the
 * CTAs and the OG card stop offering free posts on config.promoEndsAt
 * without a deploy (lib/pricing-copy.ts explains why module scope is not
 * enough). While the promo runs every string below is exactly what the page
 * printed before; afterwards it states the ladder as the current price.
 * A Next.js page may export only Next's own names, so the builder lives
 * here, where tests/regressions/pricing-pages-phase-switch.test.ts calls it
 * with both dates.
 *
 * Every number and date is a lib/config token, and the pricing sentences are
 * the canonical ones /pricing renders (lib/pricing-copy.ts and
 * app/pricing/pricing-page-copy.ts): never invent a figure here. The
 * Employer plan is retired (owner decision, 2026-10-24): neither phase
 * offers it. The 5-post pack answer is the shared one, dated while the promo
 * runs.
 */
import { brand } from '@/config/brand';
import { config } from '@/lib/config';
import {
  FULL_PACKAGE,
  LADDER_FROM_LINE,
  LADDER_HEADLINE,
  LADDER_PRICES,
  PACK_FAQ_QUESTION,
  PROMO_HEADLINE,
  PROMO_SUB,
  RENEWAL_LINE,
  ladderLine,
  packFaqAnswer,
} from '@/lib/pricing-copy';

export interface EmployerFaq {
  q: string;
  a: string;
}

/** Everything on /for-employers (and in its metadata) that depends on the promo clock. */
export interface ForEmployersCopy {
  /** config.isPromoActive(now), also handed to EmployerHowItWorks so its CTA agrees. */
  promoActive: boolean;
  /** First line of the receipt hero H1, and the pricing card's title. */
  headline: string;
  /** The primary "post a job" button in the hero and the closing CTA card. */
  postCta: string;
  receiptTotal: string;
  receiptStamp: string;
  /** ladderLine(now): the receipt disclosure and the pricing card. */
  ladder: string;
  bentoEyebrow: string;
  bentoIntro: string;
  /** Body of the listing-duration card. */
  listingRun: string;
  ctaBlurb: string;
  /**
   * The leading FAQ entries, in page order; the page appends the evergreen
   * ones. They feed the FAQPage JSON-LD as well as the accordion.
   */
  pricingFaqs: EmployerFaq[];
  meta: { description: string; ogImageTitle: string };
}

/** Every post includes the same package; `kinds` names the post types a reader can buy now. */
const includesAnswer = (kinds: string): string =>
  `Every post (${kinds}) includes the full package: a ${config.durationDays}-day listing, Featured badge, top search placement, ${config.limits.candidateUnlocksPerPosting} candidate profile unlocks, ${config.limits.inmailsPerPosting} InMails, up to 5 screening questions, and a live analytics dashboard. There is no stripped-down tier.`;

const COST_QUESTION = `How much does it cost to hire on ${brand.name}?`;
const LISTING_RUN_LEAD = `Every job runs ${config.durationDays} days with no daily budget and no bidding.`;

/** While the promo runs: the promo first, then the ladder dated from its start. */
function promoCopy(now: Date): ForEmployersCopy {
  const ladder = ladderLine(now);
  return {
    promoActive: true,
    headline: PROMO_HEADLINE,
    postCta: 'Post a Job: Free',
    receiptTotal: `${config.formatPrice(0)} (launch promo)`,
    receiptStamp: PROMO_HEADLINE,
    ladder,
    bentoEyebrow: `Free Through ${config.promoEndsLabel} · Then From $${config.introPrice}`,
    bentoIntro: 'No tiers. No feature gates. Promo, intro, or featured: every listing gets the same premium treatment.',
    listingRun: `${LISTING_RUN_LEAD} Promo posts get the same run and the same features.`,
    ctaBlurb: `Every post is free through ${config.promoEndsLabel} with all features included. From ${config.ladderStartsLabel}, from $${config.introPrice}.`,
    pricingFaqs: [
      { q: COST_QUESTION, a: `${PROMO_HEADLINE}. ${PROMO_SUB} ${ladder} ${RENEWAL_LINE} No pay-per-click bidding, no contracts.` },
      { q: 'What does every job post include?', a: includesAnswer('free during the promo, intro, or featured') },
      { q: PACK_FAQ_QUESTION, a: packFaqAnswer(now) },
    ],
    meta: {
      description: `Hire ${brand.niche.long}s. Every post is free through ${config.promoEndsLabel} with all features included. Reach candidates actively searching for ${brand.niche.short} roles.`,
      ogImageTitle: `Hire ${brand.niche.short}s: free through ${config.promoEndsLabel}`,
    },
  };
}

/**
 * Once the ladder is live: the prices in the present tense. No "free", no
 * "launch promo" offer, no dated "From <ladderStartsLabel>"; promo posts
 * appear only where they are history (renewals, refunds).
 */
function ladderCopy(now: Date): ForEmployersCopy {
  return {
    promoActive: false,
    headline: LADDER_HEADLINE,
    postCta: 'Post a Job',
    receiptTotal: `From ${config.formatPrice(config.introPrice)}`,
    receiptStamp: 'No bidding, no contracts',
    ladder: ladderLine(now),
    bentoEyebrow: `Flat Per-Post Pricing · From $${config.introPrice}`,
    bentoIntro: 'No tiers. No feature gates. Intro or featured: every listing gets the same premium treatment.',
    listingRun: LISTING_RUN_LEAD,
    ctaBlurb: `${LADDER_FROM_LINE} No bidding, no contracts.`,
    pricingFaqs: [
      { q: COST_QUESTION, a: `${LADDER_PRICES} ${FULL_PACKAGE} ${RENEWAL_LINE} No pay-per-click bidding, no contracts.` },
      { q: 'What does every job post include?', a: includesAnswer('intro or featured') },
      { q: PACK_FAQ_QUESTION, a: packFaqAnswer(now) },
    ],
    meta: {
      description: `Hire ${brand.niche.long}s. ${LADDER_FROM_LINE} Reach candidates actively searching for ${brand.niche.short} roles.`,
      ogImageTitle: `Hire ${brand.niche.short}s: posts from $${config.introPrice}`,
    },
  };
}

/** The /for-employers copy for `now`. Call it per render, never at module load. */
export function forEmployersCopy(now: Date): ForEmployersCopy {
  return config.isPromoActive(now) ? promoCopy(now) : ladderCopy(now);
}
