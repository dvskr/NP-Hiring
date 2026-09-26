/**
 * lib/pricing.ts — which ladder rung the employer's next post lands on.
 *
 * Contract (shared by /api/jobs/post-free, /api/employer/free-quota-status,
 * /api/create-checkout and the post-job UI):
 *
 *   promo   — config.isPromoActive(): every post is free ('promo' rows)
 *   plan    — employer holds an active Employer plan with a free slot ('plan' rows)
 *   intro   — first PAID post for this company domain: config.introPrice
 *   paid    — every later paid post: config.postingPrice
 *
 * The intro allowance is anchored on EmployerJob.quotaDomain (the immutable
 * signup-domain snapshot) and counts ONLY rows that were actually bought AS
 * A POST (paymentStatus 'paid' with a 'new' JobCharge, or a legacy paid row
 * that predates the ledger). Promo posts, legacy free posts, plan posts and
 * abandoned 'pending' checkouts never consume it — and neither does a promo
 * post that was later renewed: the renewal webhook flips it to 'paid', but
 * its only ledger entry is a 'renewal' charge and a renewal is not a post.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { config, type PostingMode, type PricingTier } from '@/lib/config';

export type PaidTier = Extract<PricingTier, 'intro' | 'pro'>;

/**
 * Narrow an untrusted value (Stripe session metadata, request body) to a
 * per-post ladder rung. Anything else — including 'plan', which is billed
 * by Stripe Billing and never through per-post Checkout — falls back to
 * 'pro' so a tampered or legacy metadata value can never under-charge.
 */
export function asPaidTier(value: unknown): PaidTier {
  return value === 'intro' ? 'intro' : 'pro';
}

/** Signup-email domains that can never post without a company email. Shared by every posting gate. */
export const FREE_EMAIL_DOMAINS: readonly string[] = [
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
  'aol.com', 'icloud.com', 'mail.com', 'protonmail.com',
  'ymail.com', 'live.com', 'msn.com', 'googlemail.com',
];

export function isFreeEmailDomain(domain: string | null | undefined): boolean {
  return !domain || FREE_EMAIL_DOMAINS.includes(domain.toLowerCase());
}

/** Lower-cased domain part of an email, or null. */
export function domainOf(email: string | null | undefined): string | null {
  const d = email?.toLowerCase().split('@')[1];
  return d && d.length > 0 ? d : null;
}

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Rows that count as a bought POST for the intro allowance. A 'paid' row
 * qualifies only when it carries a 'new' JobCharge (bought through Checkout)
 * or no charge at all (legacy paid rows from before the ledger existed).
 * Rows whose only charges are 'renewal' — a promo post renewed for
 * config.renewalPrice — are excluded on purpose: the owner's rule is "first
 * PAID post per company domain", and a renewal is not a post.
 */
export function paidPostWhere(quotaDomain: string): Prisma.EmployerJobWhereInput {
  return {
    quotaDomain,
    paymentStatus: 'paid',
    OR: [
      { jobCharges: { some: { type: 'new' } } },
      { jobCharges: { none: {} } },
    ],
  };
}

/** Posts (not renewals) ever paid for under this company domain. */
export async function countPaidPostsForDomain(quotaDomain: string, db: Db = prisma): Promise<number> {
  return db.employerJob.count({
    where: paidPostWhere(quotaDomain),
  });
}

/** 'intro' until the domain has one paid post, 'pro' afterwards. */
export async function getNextPaidTier(quotaDomain: string, db: Db = prisma): Promise<PaidTier> {
  const paid = await countPaidPostsForDomain(quotaDomain, db);
  return paid === 0 ? 'intro' : 'pro';
}

/** Currently-live promo posts for a domain (abuse guard during the launch promo). */
export async function countActivePromoPostsForDomain(quotaDomain: string, db: Db = prisma, now: Date = new Date()): Promise<number> {
  return db.employerJob.count({
    where: {
      quotaDomain,
      paymentStatus: 'promo',
      job: { isPublished: true, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    },
  });
}

/**
 * Live 'plan' posts for an employer, counted through the caller's client so
 * /api/jobs/post-free can re-check the slot inside its Serializable
 * transaction (lib/employer-plan.ts#countActivePlanPosts reads through the
 * global client and would not be covered by the transaction's snapshot).
 */
export async function countActivePlanPostsForUser(userId: string, db: Db = prisma, now: Date = new Date()): Promise<number> {
  return db.employerJob.count({
    where: {
      userId,
      paymentStatus: 'plan',
      job: { isPublished: true, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    },
  });
}

export interface PricingQuote {
  mode: PostingMode;
  /** Ladder rung the row will be written with. */
  tier: PricingTier;
  /** Dollars the employer pays now (0 for promo/plan). */
  price: number;
  priceCents: number;
  /** True when no Stripe checkout is needed. */
  willBeFree: boolean;
  durationDays: number;
}

export function quoteForMode(mode: PostingMode): PricingQuote {
  switch (mode) {
    case 'promo':
      return { mode, tier: 'pro', price: 0, priceCents: 0, willBeFree: true, durationDays: config.durationDays };
    case 'plan':
      return { mode, tier: 'plan', price: 0, priceCents: 0, willBeFree: true, durationDays: config.durationDays };
    case 'intro':
      return { mode, tier: 'intro', price: config.introPrice, priceCents: config.stripeIntroPriceInCents, willBeFree: false, durationDays: config.durationDays };
    case 'paid':
    default:
      return { mode: 'paid', tier: 'pro', price: config.postingPrice, priceCents: config.stripePriceInCents, willBeFree: false, durationDays: config.durationDays };
  }
}

/**
 * Resolve the employer's next-post mode. `hasPlanSlot` is supplied by the
 * caller (lib/employer-plan.ts#getPlanSlotStatus) so this module stays free
 * of plan-table knowledge and is trivially unit-testable.
 */
export async function resolvePostingMode(opts: {
  quotaDomain: string;
  hasPlanSlot: boolean;
  now?: Date;
  db?: Db;
}): Promise<PricingQuote> {
  const now = opts.now ?? new Date();
  if (config.isPromoActive(now)) return quoteForMode('promo');
  if (opts.hasPlanSlot) return quoteForMode('plan');
  const tier = await getNextPaidTier(opts.quotaDomain, opts.db ?? prisma);
  return quoteForMode(tier === 'intro' ? 'intro' : 'paid');
}

// ─── Renewal offer (config.renewalPrice) ─────────────────────────────
//
// A renewal is only worth pitching as a saving when it is cheaper than the
// new post the SAME reader would otherwise buy. That is never true during
// the launch promo (a new post is free) or for an employer with a free
// Employer plan slot, and a domain whose next post is the intro price saves
// far less than the list prices suggest. These helpers are the one place
// the claim is decided; server surfaces phrase it through
// renewalSavingsLabel. The two client surfaces (dashboard, edit page) cannot
// import this module (it loads the Prisma client) and mirror the same rule.

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
 *                  (nextNewPostPrice below), or null/undefined when unknown;
 *                  unknown compares with config.postingPrice and says so
 *
 * A saving is claimed only when the renewal can be bought, the promo is over
 * and the renewal is actually cheaper than the price it is compared with.
 */
export function resolveRenewalOffer(opts: {
  purchasable: boolean;
  nextPostPrice?: number | null;
  now?: Date;
}): RenewalOffer {
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
 * The reader's next new-post price in dollars, for comparing with a renewal:
 * resolvePostingMode's price (0 during the promo or with a free plan slot,
 * config.introPrice for a domain's first paid post, config.postingPrice
 * after that). Null when the row carries no quota domain.
 */
export async function nextNewPostPrice(opts: {
  quotaDomain: string | null | undefined;
  hasPlanSlot: boolean;
  now?: Date;
  db?: Db;
}): Promise<number | null> {
  if (!opts.quotaDomain) return null;
  const quote = await resolvePostingMode({
    quotaDomain: opts.quotaDomain,
    hasPlanSlot: opts.hasPlanSlot,
    now: opts.now,
    db: opts.db,
  });
  return quote.price;
}
