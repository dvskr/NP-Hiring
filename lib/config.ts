/**
 * Pricing Config — Launch promo + 2027 ladder
 *
 * ── Launch promo (through December 31, 2026) ─────────────────────────
 * EVERY employer post is free: 60 days, Featured badge, top placement,
 * 25 candidate unlocks + 25 InMails. Promo posts are written with
 * EmployerJob.paymentStatus = 'promo'. They are renewable at the normal
 * renewal price and they do NOT consume the intro-price allowance below.
 * `promoMaxActivePostsPerDomain` is an abuse guard only (never marketed).
 *
 * ── From January 1, 2027 ─────────────────────────────────────────────
 *   Intro post   $249 / 60 days — the FIRST PAID post per company domain
 *   Featured post $349 / 60 days — every later post
 *   Renewal      +60 days, capped at `renewalCapDays` after the post was
 *                 created. It does NOT reset the post's unlock or InMail
 *                 counters. A renewal has two prices:
 *                   $199 (`renewalPrice`)    — 'base': promo, intro, pack
 *                                              and legacy posts
 *                   $249 (`proRenewalPrice`) — 'pro': a post bought at the
 *                                              $349 posting price
 *                 lib/renewal-price.ts decides which a post pays;
 *                 `renewalPriceCentsFor` / `renewalPriceDollarsFor` are the
 *                 only mapping code should use.
 *   Employer plan — RETIRED (owner decision, 2026-10-24). No page, email,
 *                 FAQ, checkout rail or calculator offers it, and plan
 *                 posts stay non-renewable (create-renewal-checkout 409s
 *                 them). `planPrice`, `planSlots`, `planGraceDays` and the
 *                 'plan' tier remain only because dormant plan code still
 *                 reads them; they go when that code does.
 *
 * Every post, whatever it cost, gets the SAME features. The ladder is
 * purely price + billing shape; there is no stripped-down tier.
 *
 * Source-of-truth rules:
 *   - Dollar values and Stripe cent values are declared as pairs here and
 *     nowhere else; `priceCentsForTier` and `renewalPriceCentsFor` are the
 *     only mappings code should use.
 *   - Marketing copy is hand-written around these constants (pricing /
 *     for-employers / faq / terms / emails). Change a number here and
 *     revisit the copy surfaces listed in docs/pricing-system.md.
 *   - EmployerJob.pricingTier records which ladder rung a row was sold at:
 *     'intro' | 'pro' | 'plan'. Legacy rows carry 'pro'.
 *   - EmployerJob.paymentStatus: 'promo' (launch-free) | 'pending' | 'paid'
 *     | 'plan' (posted under an active Employer plan) | 'refunded' |
 *     'expired' | legacy 'free' / 'free_renewed' / 'free_upgraded'.
 */

export type PricingTier = 'intro' | 'pro' | 'plan';

/** What the employer's NEXT post will be, as reported by /api/employer/free-quota-status. */
export type PostingMode = 'promo' | 'plan' | 'intro' | 'paid';

/**
 * Which of the two renewal prices a post pays: 'base' (`renewalPrice`) or
 * 'pro' (`proRenewalPrice`). lib/renewal-price.ts decides it from the row.
 */
export type RenewalRung = 'base' | 'pro';

/**
 * The promo ends at midnight in Hawaii (HST, UTC-10, no daylight saving in
 * December), the last of the 50 states to leave December 31. Every surface
 * says "free through December 31, 2026" with no time zone, so the boundary
 * has to be the LAST US midnight: an employer in Eastern, Central, Mountain,
 * Pacific, Alaska or Hawaii time who posts at 11:59 pm on December 31 local
 * time is still inside the promo. (It was 05:00Z, midnight Eastern, which
 * charged a Pacific employer posting at 9 pm on December 31.) An Eastern
 * employer therefore keeps free posting until 5 am ET on January 1, which is
 * more generous than the copy, never less. tests/lib/config-pricing.test.ts
 * pins the instant, every US zone's 11:59 pm, and both labels below.
 */
const PROMO_ENDS_AT_ISO = '2027-01-01T10:00:00.000Z'; // 2027-01-01 00:00 Pacific/Honolulu (HST)

export const config = {
  // ─── Launch promo ───
  /** Instant the promo ends (exclusive). Compare with `isPromoActive`. */
  promoEndsAt: PROMO_ENDS_AT_ISO,
  /**
   * Human label used in copy: "Free through December 31, 2026". It is the
   * calendar date of the instant just before promoEndsAt in Pacific/Honolulu
   * (and in every other US zone), so it never names a day the promo misses.
   */
  promoEndsLabel: 'December 31, 2026',
  /** First day of the paid ladder, for copy: the date of promoEndsAt in Pacific/Honolulu. */
  ladderStartsLabel: 'January 1, 2027',
  /** Abuse guard: max concurrently-live promo posts per signup domain. Not marketed. */
  promoMaxActivePostsPerDomain: 10,

  // ─── Per-post ladder (effective January 1, 2027) ───
  introPrice: 249,            // dollars — first PAID post per company domain
  stripeIntroPriceInCents: 24900,
  postingPrice: 349,          // dollars — every later post
  stripePriceInCents: 34900,
  // Renewal: +60 days. The base price is what every reader of `renewalPrice`
  // / `stripeRenewalPriceInCents` has always meant; the pro price is only for
  // a post bought at `postingPrice` (see renewalPriceCentsFor below).
  renewalPrice: 199,          // dollars — base: promo / intro / pack / legacy posts
  stripeRenewalPriceInCents: 19900,
  proRenewalPrice: 249,       // dollars — a post bought at the posting price
  stripeProRenewalPriceInCents: 24900,
  /** Listing duration for EVERY post (promo, intro, pro, plan) and every renewal. */
  durationDays: 60,
  /**
   * A renewal never pushes a post's expiry past this many days after the post
   * was created: lib/expires-at.ts#renewalExpiresAt caps at its default
   * `maxFromOriginalDays`, which the renewal webhook does not override. Copy
   * that says "renewing adds 60 days" states this limit with this token, and
   * tests/lib/config-pricing.test.ts fails if the two ever disagree.
   */
  renewalCapDays: 365,

  // ─── Employer plan (effective January 1, 2027) ───
  planPrice: 399,             // dollars per month
  planSlots: 5,               // concurrent active postings included (each runs durationDays, never renewed)
  /** Days after currentPeriodEnd before plan posts are paused (covers Stripe Smart Retries). */
  planGraceDays: 3,

  // Every post is featured (no differentiation between rungs)
  isFeatured: true,

  // Every post gets the same limits
  limits: {
    candidateUnlocksPerPosting: 25,
    inmailsPerPosting: 25,
  },

  // Cross-posting safety cap on candidate unlocks. The per-posting limit
  // (25) prevents abuse within a single posting, but an employer with N
  // active postings has N×25 total — fine for normal hiring, suspicious for
  // mass scraping. Cap at 50 unique unlocks across ALL postings in any
  // rolling 24h window. Real hiring teams don't review more than ~50
  // profiles in a single day; scrapers do.
  dailyUnlockCap: 50,

  // ─── Helper Functions ───

  formatPrice: (amount: number) => {
    if (amount === 0) return 'FREE'
    return `$${amount}`
  },

  /**
   * True while the launch promo is running (every post free). Pass `now`
   * explicitly in tests; production callers use the default.
   */
  isPromoActive: (now: Date = new Date()): boolean => now.getTime() < Date.parse(PROMO_ENDS_AT_ISO),

  /**
   * Stripe unit_amount for a ladder rung. 'plan' is billed by Stripe
   * Billing (subscription), never through per-post Checkout, so it maps to 0.
   */
  priceCentsForTier: (tier: PricingTier | string | null | undefined): number => {
    switch (tier) {
      case 'intro': return config.stripeIntroPriceInCents;
      case 'plan': return 0;
      case 'pro':
      default: return config.stripePriceInCents;
    }
  },

  /** Dollar price for a ladder rung (0 for 'plan'). */
  priceDollarsForTier: (tier: PricingTier | string | null | undefined): number => {
    switch (tier) {
      case 'intro': return config.introPrice;
      case 'plan': return 0;
      case 'pro':
      default: return config.postingPrice;
    }
  },

  /**
   * Stripe unit_amount for a renewal. Only 'pro' (a post bought at the
   * posting price) costs more; anything else is the base price, which is also
   * the fallback lib/renewal-price.ts documents for a missing ledger row.
   */
  renewalPriceCentsFor: (rung: RenewalRung): number =>
    rung === 'pro' ? config.stripeProRenewalPriceInCents : config.stripeRenewalPriceInCents,

  /** Dollar price of a renewal, from the same pairs as `renewalPriceCentsFor`. */
  renewalPriceDollarsFor: (rung: RenewalRung): number =>
    rung === 'pro' ? config.proRenewalPrice : config.renewalPrice,

  /** Display label for a ladder rung. Legacy/unknown values render as 'Pro'. */
  getTierLabel: (tier?: PricingTier | string): string => {
    switch (tier) {
      case 'intro': return 'Intro';
      case 'plan': return 'Plan';
      default: return 'Pro';
    }
  },

  /**
   * Duration in days. Always config.durationDays — parameter retained for
   * call-site backward compatibility.
   */
  getDurationDays: (_tier?: PricingTier | string) => config.durationDays,

  /** All posts are featured. */
  isFeaturedTier: (_tier?: PricingTier | string) => true,

  /** Returns limits for a posting. All tiers get the same limits. */
  getTierLimits: (_tier?: PricingTier | string) => config.limits,

  // ─── Legacy invoice fallback (B11 / audit #2) ───
  // Frozen historical launch price ($199) for the invoice/receipt fallback
  // path ONLY. Post-2026-04-30 charges are invoiced from the JobCharge
  // ledger (amountCents = what Stripe actually charged); this constant only
  // covers pre-ledger rows that have no JobCharge. It is deliberately
  // DECOUPLED from the live ladder so a list-price change can never rewrite
  // historical invoices. Do not reuse for live pricing.
  legacyInvoiceFallbackCents: 19900,

  // Kept for active reference by app/api/employer/invoice/route.ts and the
  // receipt route: fallback amount when no JobCharge ledger row exists
  // (pre-2026-04-30 payments). Returns the frozen historical price those
  // rows actually paid — NOT the current list price.
  getStripePriceInCents: (_tier?: PricingTier | string) => config.legacyInvoiceFallbackCents,
}

// Type export
export type Config = typeof config
