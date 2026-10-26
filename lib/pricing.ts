/**
 * lib/pricing.ts — which ladder rung the employer's next post lands on.
 *
 * Contract (shared by /api/jobs/post-free, /api/employer/free-quota-status,
 * /api/create-checkout and the post-job UI):
 *
 *   promo   — config.isPromoActive(): every post is free ('promo' rows)
 *   pack    — the employer holds a usable 5-post pack credit ('pack' rows;
 *             lib/post-packs.ts)
 *   intro   — first PAID purchase for this company domain: config.introPrice
 *   paid    — every later paid post: config.postingPrice
 *
 * The intro allowance is anchored on EmployerJob.quotaDomain (the immutable
 * signup-domain snapshot) and is used up by a row that was actually bought
 * AS A POST (paymentStatus 'paid' with a 'new' JobCharge, or a legacy paid
 * row that predates the ledger), or by a paid 5-post pack bought through
 * Stripe at the domain (owner decision 2026-10-24: the pack is the company's
 * paid purchase). Promo posts, pack posts, legacy free and plan posts,
 * abandoned 'pending' checkouts, refunded, disputed or admin-comped packs
 * never consume it, and neither does a promo post that was later renewed:
 * the renewal webhook flips it to 'paid', but its only ledger entry is a
 * 'renewal' charge and a renewal is not a post.
 *
 * The Employer plan mode went in phase 2 of the 2027 re-price and the plan
 * code in phase 4 (no plan row exists in production).
 */
import type { Prisma } from '@prisma/client';
import { prisma, type Db } from '@/lib/prisma';
import { config, type PostingMode, type PricingTier } from '@/lib/config';
import { countPaidPacksForDomain } from '@/lib/post-packs';

export type PaidTier = Extract<PricingTier, 'intro' | 'pro'>;

/**
 * Narrow an untrusted value (Stripe session metadata, request body) to a
 * per-post ladder rung. Anything else — including 'pack', whose posts are
 * paid for by the pack, and a legacy 'plan' value — falls back to 'pro' so
 * a tampered or legacy metadata value can never under-charge.
 */
export function asPaidTier(value: unknown): PaidTier {
  return value === 'intro' ? 'intro' : 'pro';
}

/** The tier a renewal carries and writes back: the row's own rung, a pack post included. */
export type RenewalTier = Extract<PricingTier, 'intro' | 'pro' | 'pack'>;

/**
 * Narrow a row's pricingTier, or a renewal session's metadata.tier, to the
 * tier a renewal keeps: 'intro' and 'pack' stay (a 5-post pack post keeps
 * 'pack' once renewed, owner decision 2026-10-24), anything else is 'pro',
 * so a tampered or legacy value is never written to the row. The renewal
 * price is not decided here (lib/renewal-price.ts).
 */
export function asRenewalTier(value: unknown): RenewalTier {
  return value === 'intro' || value === 'pack' ? value : 'pro';
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

/**
 * The query fragment that finds out whether an EmployerJob was bought as a
 * post: spread it into the query's `include`. It loads at most one 'new'
 * JobCharge (one is all the answer needs), and never a 'renewal' charge: a
 * renewed promo post reads ('paid', 'pro') exactly like a bought post, and
 * only the 'new' charge tells them apart. lib/renewal-price.ts#renewalRungForRow
 * turns the loaded row into the renewal price it pays.
 */
export const NEW_POST_CHARGE_SELECT = {
  jobCharges: { where: { type: 'new' }, select: { id: true }, take: 1 },
} as const satisfies Prisma.EmployerJobInclude;

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

/**
 * 'intro' until the domain has one paid post or one paid Stripe pack, 'pro'
 * afterwards. The pack count is read only while no paid post decides it.
 */
export async function getNextPaidTier(quotaDomain: string, db: Db = prisma): Promise<PaidTier> {
  const paid = (await countPaidPostsForDomain(quotaDomain, db)) || (await countPaidPacksForDomain(quotaDomain, db));
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

export interface PricingQuote {
  mode: PostingMode;
  /** Ladder rung the row will be written with. */
  tier: PricingTier;
  /** Dollars the employer pays now (0 for promo and pack). */
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
    case 'pack':
      return { mode, tier: 'pack', price: 0, priceCents: 0, willBeFree: true, durationDays: config.durationDays };
    case 'intro':
      return { mode, tier: 'intro', price: config.introPrice, priceCents: config.stripeIntroPriceInCents, willBeFree: false, durationDays: config.durationDays };
    case 'paid':
    default:
      return { mode: 'paid', tier: 'pro', price: config.postingPrice, priceCents: config.stripePriceInCents, willBeFree: false, durationDays: config.durationDays };
  }
}

/**
 * Resolve the employer's next-post mode: promo, then a usable pack credit,
 * then intro, then paid. `hasPackCredit` is supplied by the caller
 * (lib/post-packs.ts#getPackCreditStatus) so this module stays trivially
 * unit-testable; the promo wins over a credit, which stays unspent.
 */
export async function resolvePostingMode(opts: {
  quotaDomain: string;
  hasPackCredit: boolean;
  now?: Date;
  db?: Db;
}): Promise<PricingQuote> {
  const now = opts.now ?? new Date();
  if (config.isPromoActive(now)) return quoteForMode('promo');
  if (opts.hasPackCredit) return quoteForMode('pack');
  const tier = await getNextPaidTier(opts.quotaDomain, opts.db ?? prisma);
  return quoteForMode(tier === 'intro' ? 'intro' : 'paid');
}

// ─── Renewal offer ───────────────────────────────────────────────────
//
// Which of the two renewal prices a post pays is lib/renewal-price.ts (it
// needs NEW_POST_CHARGE_SELECT above). The rule that decides whether a
// renewal may be pitched as a saving, against that price, lives in
// lib/renewal-offer.ts, which imports only lib/config, so the dashboard
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
 * resolvePostingMode's price (0 during the promo or with a usable pack
 * credit, config.introPrice for a domain's first paid purchase,
 * config.postingPrice after that). Null when the row carries no quota domain.
 */
export async function nextNewPostPrice(opts: {
  quotaDomain: string | null | undefined;
  hasPackCredit: boolean;
  now?: Date;
  db?: Db;
}): Promise<number | null> {
  if (!opts.quotaDomain) return null;
  const quote = await resolvePostingMode({
    quotaDomain: opts.quotaDomain,
    hasPackCredit: opts.hasPackCredit,
    now: opts.now,
    db: opts.db,
  });
  return quote.price;
}
