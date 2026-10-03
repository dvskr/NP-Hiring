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
// The rule that decides whether a renewal may be pitched as a saving lives
// in lib/renewal-offer.ts, which imports only lib/config, so the dashboard
// and the edit page (client bundles that cannot load this Prisma-backed
// module) use the same rule as the emails and the cron instead of a copy.
// It is re-exported here so server importers keep this one import path.
// nextNewPostPrice stays here: it is the input that reads the database.
export {
  renewalSavings,
  resolveRenewalOffer,
  renewalSavingsLabel,
  type RenewalOffer,
  type RenewalSavings,
} from '@/lib/renewal-offer';

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
