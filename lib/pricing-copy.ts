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
 */
import { config } from '@/lib/config';

/** The promo headline: "Free through December 31, 2026". Only while config.isPromoActive(). */
export const PROMO_HEADLINE = `Free through ${config.promoEndsLabel}`;

/** What every free post includes. Only while config.isPromoActive(). */
export const PROMO_SUB = `Every job post is free during our launch period: ${config.durationDays}-day listing, Featured badge, top placement, ${config.limits.candidateUnlocksPerPosting} candidate unlocks and ${config.limits.inmailsPerPosting} InMails. No credit card required.`;

/** The three prices as a present-tense sentence with no date: the price once the ladder is live. */
export const LADDER_PRICES = `Your first post is $${config.introPrice}, every post after that is $${config.postingPrice}, or $${config.planPrice}/month for ${config.planSlots} active jobs.`;

/**
 * The ladder sentence for `now`. While the promo runs it is dated
 * ("From January 1, 2027: your first post is $199, ..."), exactly the
 * LADDER_LINE the surfaces printed before this module existed; once the
 * ladder is live it is LADDER_PRICES.
 */
export function ladderLine(now: Date = new Date()): string {
  if (!config.isPromoActive(now)) return LADDER_PRICES;
  return `From ${config.ladderStartsLabel}: ${LADDER_PRICES.charAt(0).toLowerCase()}${LADDER_PRICES.slice(1)}`;
}
