/**
 * Pricing copy that changes when the launch promo ends.
 *
 * Until config.promoEndsAt every post is free and the ladder is announced
 * for config.ladderStartsLabel; from that instant the ladder IS the price.
 * Every employer-facing surface that states the price takes its sentence
 * from here, or branches on config.isPromoActive(now), at RENDER or SEND
 * time. Never at module load: a module-scope string is evaluated once per
 * server instance (and once at build for a static page), so it would keep
 * promising free posting after the promo ends. Pages that render this copy
 * also re-render at least hourly (`export const revalidate = 3600`) and
 * build their metadata in generateMetadata, so the switch needs no deploy.
 *
 * Client-safe: imports only lib/config (lib/pricing.ts loads Prisma).
 *
 * The Employer plan is retired (owner decision, 2026-10-24): no sentence here
 * offers it, and none may read the plan's price or slot count, which stay in
 * lib/config only for the dormant plan code.
 */
import { config } from '@/lib/config';

/** The promo headline: "Free through December 31, 2026". Only while config.isPromoActive(). */
export const PROMO_HEADLINE = `Free through ${config.promoEndsLabel}`;

/** What every free post includes. Only while config.isPromoActive(). */
export const PROMO_SUB = `Every job post is free during our launch period: ${config.durationDays}-day listing, Featured badge, top placement, ${config.limits.candidateUnlocksPerPosting} candidate unlocks and ${config.limits.inmailsPerPosting} InMails. No credit card required.`;

/** The two post prices as a present-tense sentence with no date: the price once the ladder is live. */
export const LADDER_PRICES = `Your first post is $${config.introPrice}, every post after that is $${config.postingPrice}.`;

/**
 * The ladder sentence for `now`. While the promo runs it is dated
 * ("From January 1, 2027: your first post is ..."); once the ladder is live
 * it is LADDER_PRICES.
 */
export function ladderLine(now: Date = new Date()): string {
  if (!config.isPromoActive(now)) return LADDER_PRICES;
  return `From ${config.ladderStartsLabel}: ${LADDER_PRICES.charAt(0).toLowerCase()}${LADDER_PRICES.slice(1)}`;
}

/**
 * The headline that replaces PROMO_HEADLINE once the ladder is live: the
 * /pricing H1 and the /for-employers hero, in the same words as the
 * ladder-phase email headline. Only after the promo.
 */
export const LADDER_HEADLINE = 'Simple per-post pricing';

/**
 * What every post includes, whatever it cost: the sentence that stands where
 * PROMO_SUB stood once the promo has ended (true in both phases, but the
 * promo copy already says it inside PROMO_SUB).
 */
export const FULL_PACKAGE = `Every post gets the full package: ${config.durationDays}-day listing, Featured badge, top placement, ${config.limits.candidateUnlocksPerPosting} candidate unlocks and ${config.limits.inmailsPerPosting} InMails.`;

/** The entry price, for CTA cards and descriptions once the ladder is live. Only after the promo. */
export const LADDER_FROM_LINE = `Posts start at $${config.introPrice}, with all features included.`;

/**
 * What a renewal costs, true in both phases: a renewal has two prices
 * (lib/renewal-price.ts decides which a post pays). The dearer one is named
 * by the post price it renews, because every post is Featured and "featured
 * post" no longer tells the two apart. Every surface that states both
 * prices prints this sentence; a surface about one post prints that post's
 * own price instead.
 */
export const RENEWAL_LINE = `Renewals add ${config.durationDays} days: $${config.renewalPrice} for a promo or intro post, $${config.proRenewalPrice} for a $${config.postingPrice} post.`;
