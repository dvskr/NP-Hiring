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
 *
 * The 5-post pack (owner decisions 2026-10-24 and 2026-10-25) is sold from
 * the ladder's start, so its price is dated like the ladder while the promo
 * runs. Its copy states the offer (PACK_OFFER) and, where a comparison
 * helps, what the same posts cost one at a time (PACK_COMPARISON). It never
 * names a saving (register D40): a company's first single post is the intro
 * price, so its single posts cost less than that comparison, and the pack
 * uses up the intro price. No price here is typed as a figure; every one is
 * a config token.
 */
import { config } from '@/lib/config';

/** The pack price as copy prints it (config.formatDollars: thousands grouped). */
const PACK_PRICE = config.formatDollars(config.packPrice);

/** What one post costs inside the pack, as copy prints it. */
const PACK_PER_POST = config.formatDollars(config.packPrice / config.packPosts);

/** Small counts as words, for "five posts"; a larger count prints its digits. */
const COUNT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'] as const;
const countWord = (n: number): string => COUNT_WORDS[n] ?? String(n);

/** The promo headline: "Free through December 31, 2026". Only while config.isPromoActive(). */
export const PROMO_HEADLINE = `Free through ${config.promoEndsLabel}`;

/** What every free post includes. Only while config.isPromoActive(). */
export const PROMO_SUB = `Every job post is free during our launch period: ${config.durationDays}-day listing, Featured badge, top placement, ${config.limits.candidateUnlocksPerPosting} candidate unlocks and ${config.limits.inmailsPerPosting} InMails. No credit card required.`;

/**
 * The ladder as a present-tense sentence with no date, the 5-post pack
 * included: the price once the ladder is live.
 */
export const LADDER_PRICES = `Your first post is $${config.introPrice}, every post after that is $${config.postingPrice}, or buy ${config.packPosts} posts for ${PACK_PRICE}.`;

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
 * post" no longer tells the two apart. A pack post renews at the base price.
 * Every surface that states both prices prints this sentence; a surface
 * about one post prints that post's own price instead.
 */
export const RENEWAL_LINE = `Renewals add ${config.durationDays} days: $${config.renewalPrice} for a promo, intro or pack post, $${config.proRenewalPrice} for a $${config.postingPrice} post.`;

/** The pack in one phrase, for a card or a line: its posts, its price and the price a post. */
export const PACK_OFFER = `${config.packPosts} posts for ${PACK_PRICE}, ${PACK_PER_POST} a post`;

/**
 * The one comparison the owner allowed (register D40): what the same posts
 * cost one at a time at the posting price. It is a price, not a saving: a
 * company's first single post is the intro price.
 */
export const PACK_COMPARISON = `Bought one at a time at $${config.postingPrice}, ${countWord(config.packPosts)} posts cost ${config.formatDollars(config.postingPrice * config.packPosts)}.`;

/**
 * The pack's price for `now`: dated from config.ladderStartsLabel while the
 * promo runs (the pack is sold only once the ladder is live), plain after.
 */
export function packPriceLine(now: Date = new Date()): string {
  if (!config.isPromoActive(now)) return `A ${config.packPosts}-post pack is ${PACK_PRICE}.`;
  return `From ${config.ladderStartsLabel}, a ${config.packPosts}-post pack is ${PACK_PRICE}.`;
}

/** The pack question on /pricing, /faq and /for-employers (and their FAQPage JSON-LD). */
export const PACK_FAQ_QUESTION = `How does the ${config.packPosts}-post pack work?`;

/**
 * The pack answer for `now`: the price, the 12 months, the comparison, the
 * full package and the base renewal, the buying account (register D37) and
 * the intro price a pack uses up (lib/pricing.ts#getNextPaidTier).
 */
export function packFaqAnswer(now: Date = new Date()): string {
  return `${packPriceLine(now)} That is ${PACK_PER_POST} a post, to use within ${config.packValidityMonths} months of purchase. ${PACK_COMPARISON} Every pack post gets the full package and renews for $${config.renewalPrice}. The posts belong to the account that buys the pack, and buying a pack uses your company's intro price, so single posts after it are $${config.postingPrice}.`;
}

/** Hawaii keeps standard time all year (UTC-10): the last US zone to end a day. */
const LAST_US_TIME_ZONE = 'Pacific/Honolulu';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A pack date (a purchase, an expiry) as the pack surfaces print it, in the
 * zone packUseByLabel counts days in, so a purchase and its "Use by" date
 * read as the twelve months they are.
 */
export function packDateLabel(date: Date): string {
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: LAST_US_TIME_ZONE });
}

/**
 * The "Use by" date of a pack that stops being usable at `expiresAt`: the
 * last calendar day the credits last for the whole day in every US time
 * zone, so the date never names a day they miss. That is the day before the
 * expiry's date in Hawaii, the last US zone to end a day (as
 * config.promoEndsAt is set by the last US midnight). Credits expire at the
 * time of day they were bought (lib/post-packs.ts#packExpiresAt), which the
 * UTC date would overstate by a day for a purchase made on a US evening.
 */
export function packUseByLabel(expiresAt: Date): string {
  return packDateLabel(new Date(expiresAt.getTime() - DAY_MS));
}

/** Hawaii's offset from UTC, in hours: fixed, as Hawaii keeps no daylight time. */
const LAST_US_ZONE_UTC_OFFSET_HOURS = 10;
const USE_BY_VALUE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The date packUseByLabel prints, as YYYY-MM-DD (the /admin/post-packs date input). */
export function packUseByValue(expiresAt: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: LAST_US_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(expiresAt.getTime() - DAY_MS));
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/**
 * The inverse of packUseByValue: the expiresAt that makes a pack read "Use by"
 * that date, which is the end of the day in Hawaii (midnight starting the next
 * day there), so the credits last through the whole day in every US zone.
 * Null for anything but a real YYYY-MM-DD calendar date.
 */
export function packExpiresAtForUseBy(useBy: string): Date | null {
  const match = USE_BY_VALUE.exec(useBy);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return new Date(Date.UTC(year, month - 1, day + 1, LAST_US_ZONE_UTC_OFFSET_HOURS));
}

/**
 * The refund answer on /faq, /for-employers and /pricing (and their FAQPage
 * JSON-LD): all sales are final (owner decision 2026-10-25), with the two
 * exceptions /terms section 8 keeps, a refund the law requires and a billing
 * error. True in both phases: a promo post was never paid for.
 */
export const REFUND_ANSWER = `All sales are final. Job posts, renewals and ${config.packPosts}-post packs are not refundable, and neither are pack posts left unused when the pack expires or a posting we remove for breaking our Terms. We refund only where the law requires it, and we correct a billing error, such as a charge made twice for the same post. Promo posts involve no payment.`;
