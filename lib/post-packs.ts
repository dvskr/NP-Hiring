/**
 * lib/post-packs.ts — the 5-post pack's credits (server only).
 *
 * A pack is one EmployerPostPack row: config.packPosts credits bought once
 * for config.packPrice, spendable by the buying account (userId) only, until
 * expiresAt = packExpiresAt(purchasedAt). Each credit publishes one ordinary
 * post through /api/jobs/post-free, written ('pack', 'pack', postPackId).
 *
 *   usable   — status 'paid', expiresAt > now, creditsRemaining > 0
 *   used     — creditsTotal - creditsRemaining - creditsRevoked (a counter,
 *              so a hard-deleted post never hands a credit back)
 *   intro    — a paid pack bought through Stripe at the domain is the
 *              company's paid purchase: later single posts are $349
 *              (lib/pricing.ts#getNextPaidTier)
 *
 * No refunds (owner decision 2026-10-25). A refund the owner issues by hand
 * in Stripe, or a chargeback, still has to be honoured by the code:
 *   full refund  — status 'refunded', unused credits revoked for good, the
 *                  pack's posts taken down as a full refund of a post is
 *   dispute      — status 'disputed' (frozen: never usable, credits kept
 *                  counted), the pack's posts taken down
 *   dispute won  — status 'paid' again, the posts the dispute took down put
 *                  back and republished while inside their run
 *   dispute lost — the frozen credits revoked for good
 * The webhook (app/api/webhooks/stripe/post-pack-refunds.ts) runs these.
 * A partial refund changes nothing here; the webhook only alerts.
 *
 * The migration's CHECK (credits never below zero, never more used plus
 * revoked than sold) is the last line of defence behind spendPackCredit's
 * conditional decrement.
 *
 * Every query on an account's packs refuses a missing account id
 * (requireAccountId): Prisma reads `userId: undefined` as no filter at all,
 * so a caller that lost the id would read, or spend, every account's credits.
 */
import type { Prisma } from '@prisma/client';
import { prisma, type Db } from '@/lib/prisma';
import { config } from '@/lib/config';

/** EmployerPostPack.status. */
export type PostPackStatus = 'paid' | 'refunded' | 'disputed';

/** Attempts a counter compare-and-set makes before it gives up (revokeUnusedPackCredits). */
const MAX_REVOKE_ATTEMPTS = 3;

/**
 * When a pack bought at `purchasedAt` stops being usable: `months` calendar
 * months later in UTC, at the same time of day, clamped to the last day of
 * the target month (bought January 31, usable to January 31 a year on;
 * bought February 29, to February 28).
 */
export function packExpiresAt(purchasedAt: Date, months: number = config.packValidityMonths): Date {
  const monthIndex = purchasedAt.getUTCMonth() + months;
  const year = purchasedAt.getUTCFullYear() + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(
    year,
    month,
    Math.min(purchasedAt.getUTCDate(), lastDay),
    purchasedAt.getUTCHours(),
    purchasedAt.getUTCMinutes(),
    purchasedAt.getUTCSeconds(),
    purchasedAt.getUTCMilliseconds(),
  ));
}

/**
 * The account id a query on its packs filters by. Throws on a missing one
 * (security review L2): `userId: undefined` would match every account's packs.
 */
function requireAccountId(userId: string): string {
  if (typeof userId !== 'string' || userId === '') {
    throw new Error('A 5-post pack query needs the account id');
  }
  return userId;
}

/** The packs whose credits `userId` can spend at `now`. */
export function usablePackWhere(userId: string, now: Date): Prisma.EmployerPostPackWhereInput {
  return { userId: requireAccountId(userId), status: 'paid', expiresAt: { gt: now }, creditsRemaining: { gt: 0 } };
}

/**
 * The packs that still stand for `userId` at `now`: paid and unexpired,
 * whether or not a credit is left, so a used-up pack keeps reporting its
 * totals ("5 of 5 used") until it expires.
 */
export function currentPackWhere(userId: string, now: Date): Prisma.EmployerPostPackWhereInput {
  return { userId: requireAccountId(userId), status: 'paid', expiresAt: { gt: now } };
}

/** The order credits are spent in: the pack that expires first, then the oldest. */
const SPEND_ORDER: Prisma.EmployerPostPackOrderByWithRelationInput[] = [{ expiresAt: 'asc' }, { purchasedAt: 'asc' }];

export interface PackCreditStatus {
  /** At least one credit can be spent now. */
  usable: boolean;
  /** Credits left across the account's current packs. */
  remaining: number;
  /** Credits those packs have spent on posts (total less remaining; a revoked credit is neither). */
  used: number;
  /** Credits those packs hold, used or not (sold less revoked). */
  total: number;
  /**
   * When the pack a post spends from next expires. With every current pack
   * used up, when the last of them expires; null without a current pack.
   */
  expiresAt: Date | null;
}

const noPackCredit = (): PackCreditStatus => ({ usable: false, remaining: 0, used: 0, total: 0, expiresAt: null });

/**
 * What the account holds and can spend now, across its current packs (paid
 * and unexpired: a used-up pack still counts, so its totals stay readable).
 * Pass a transaction client as `db` to read it through the transaction's
 * snapshot.
 */
export async function getPackCreditStatus(
  userId: string | null | undefined,
  now: Date = new Date(),
  db: Db = prisma,
): Promise<PackCreditStatus> {
  if (!userId) return noPackCredit();
  const packs = await db.employerPostPack.findMany({
    where: currentPackWhere(userId, now),
    select: { creditsRemaining: true, creditsTotal: true, creditsRevoked: true, expiresAt: true },
    orderBy: SPEND_ORDER,
  });
  if (packs.length === 0) return noPackCredit();
  const remaining = packs.reduce((sum, pack) => sum + pack.creditsRemaining, 0);
  const total = packs.reduce((sum, pack) => sum + pack.creditsTotal - pack.creditsRevoked, 0);
  // The pack a post spends next: the first in spend order with a credit left.
  const next = packs.find((pack) => pack.creditsRemaining > 0);
  return {
    usable: next !== undefined,
    remaining,
    used: total - remaining,
    total,
    expiresAt: (next ?? packs[packs.length - 1]).expiresAt,
  };
}

/** No usable credit to spend: none was there, or another request spent the last one first. */
export class PackCreditUnavailableError extends Error {
  constructor() {
    super('No usable 5-post pack credit');
    this.name = 'PackCreditUnavailableError';
  }
}

/**
 * Spend one credit, inside the caller's Serializable transaction (the one
 * /api/jobs/post-free creates the post in). One conditional decrement on the
 * pack that expires first, guarded by the same conditions that make a credit
 * usable: when it matches nothing (no usable pack, or a parallel post spent
 * the last credit between the read and the write) nothing is written and
 * PackCreditUnavailableError is thrown; the caller answers 409. A
 * serialization conflict surfaces as Prisma P2034, which the caller answers
 * the same way. A missing account id throws before anything is read.
 */
export async function spendPackCredit(tx: Prisma.TransactionClient, userId: string, now: Date): Promise<{ packId: string }> {
  const accountId = requireAccountId(userId);
  const pack = await tx.employerPostPack.findFirst({
    where: usablePackWhere(accountId, now),
    orderBy: SPEND_ORDER,
    select: { id: true },
  });
  if (!pack) throw new PackCreditUnavailableError();
  const { count } = await tx.employerPostPack.updateMany({
    where: { id: pack.id, userId: accountId, status: 'paid', expiresAt: { gt: now }, creditsRemaining: { gt: 0 } },
    data: { creditsRemaining: { decrement: 1 } },
  });
  if (count !== 1) throw new PackCreditUnavailableError();
  return { packId: pack.id };
}

/**
 * The packs that use up a domain's intro price: paid, and bought through
 * Stripe. Expired and used-up packs still count; refunded, disputed and
 * admin-comped ones do not, as refunded or disputed posts do not.
 */
export function paidPackWhere(quotaDomain: string): Prisma.EmployerPostPackWhereInput {
  return { quotaDomain, status: 'paid', source: 'stripe' };
}

/** Paid Stripe packs ever bought at the domain (lib/pricing.ts#getNextPaidTier). */
export async function countPaidPacksForDomain(quotaDomain: string, db: Db = prisma): Promise<number> {
  return db.employerPostPack.count({ where: paidPackWhere(quotaDomain) });
}

/**
 * Revoke a pack's unused credits for good and set its status: a full refund
 * (from 'paid' or 'disputed' to 'refunded') or a lost dispute ('disputed'
 * to 'disputed'). Compare-and-set on the counter, so a post spending a
 * credit at the same moment is never lost: the write matches only the
 * counter it read, and a miss re-reads and tries again. A pack already out
 * of `from` (a redelivered event) or gone changes nothing. Throws when the
 * counter will not hold still, so the webhook answers 500 and Stripe retries.
 */
export async function revokeUnusedPackCredits(
  packId: string,
  from: readonly PostPackStatus[],
  to: PostPackStatus,
  db: Db = prisma,
): Promise<{ changed: boolean; revoked: number }> {
  for (let attempt = 1; attempt <= MAX_REVOKE_ATTEMPTS; attempt += 1) {
    const pack = await db.employerPostPack.findUnique({ where: { id: packId }, select: { status: true, creditsRemaining: true } });
    if (!pack || !from.includes(pack.status as PostPackStatus)) return { changed: false, revoked: 0 };
    const { count } = await db.employerPostPack.updateMany({
      where: { id: packId, status: pack.status, creditsRemaining: pack.creditsRemaining },
      data: { status: to, creditsRemaining: 0, creditsRevoked: { increment: pack.creditsRemaining } },
    });
    if (count === 1) return { changed: true, revoked: pack.creditsRemaining };
  }
  throw new Error(`post pack ${packId}: its credits kept changing while they were being revoked`);
}

/** A dispute opened: freeze a paid pack ('disputed' is never usable). True when this call froze it. */
export async function freezePack(packId: string, db: Db = prisma): Promise<boolean> {
  const { count } = await db.employerPostPack.updateMany({ where: { id: packId, status: 'paid' }, data: { status: 'disputed' } });
  return count > 0;
}

/** A dispute won: unfreeze the pack, only while it is still disputed (a refund since then wins). */
export async function unfreezePack(packId: string, db: Db = prisma): Promise<boolean> {
  const { count } = await db.employerPostPack.updateMany({ where: { id: packId, status: 'disputed' }, data: { status: 'paid' } });
  return count > 0;
}

/**
 * Take down the posts that still stand on a pack (paymentStatus 'pack'): set
 * them to `status` and unpublish them, as a full refund of a post does. A
 * renewed pack post is 'paid', with its own renewal payment, and stays up:
 * both writes match only rows still 'pack', so a post renewed in between
 * keeps its listing. Returns the job ids taken down.
 *
 * Two writes, ordered so that a failure between them is finished by the
 * redelivered event (code review M1): the unpublish goes first, and the
 * status flips last. A failed flip leaves the rows 'pack', which the retry
 * selects and takes down again; flipped first, a failed unpublish left
 * 'refunded' posts live that no retry selected any more.
 */
export async function takeDownPackPosts(packId: string, status: 'refunded' | 'disputed', db: Db = prisma): Promise<string[]> {
  const rows = await db.employerJob.findMany({ where: { postPackId: packId, paymentStatus: 'pack' }, select: { id: true, jobId: true } });
  if (rows.length === 0) return [];
  const jobIds = rows.map((row) => row.jobId);
  await db.job.updateMany({
    where: { id: { in: jobIds }, employerJobs: { postPackId: packId, paymentStatus: 'pack' } },
    data: { isPublished: false },
  });
  await db.employerJob.updateMany({ where: { id: { in: rows.map((row) => row.id) }, paymentStatus: 'pack' }, data: { paymentStatus: status } });
  return jobIds;
}

/**
 * A dispute won: put back the posts that dispute took down. Those are the
 * pack's 'disputed' rows with no JobCharge at all (a pack post is created
 * with none, and a renewed one is 'paid'); a pack post disputed through its
 * own renewal charge carries that charge and is left to the JobCharge path.
 * Each goes back to 'pack', and is republished while inside its run, not
 * archived and not paused by the employer.
 *
 * As in takeDownPackPosts, the listing is written first, matched on the
 * status the rows still hold ('disputed'), and the status flips last, so the
 * redelivered event finishes whichever write failed (code review M1).
 */
export async function restorePackPosts(
  packId: string,
  now: Date = new Date(),
  db: Db = prisma,
): Promise<{ restored: number; republished: string[] }> {
  const rows = await db.employerJob.findMany({
    where: { postPackId: packId, paymentStatus: 'disputed', jobCharges: { none: {} } },
    select: { id: true, jobId: true, job: { select: { expiresAt: true, archivedAt: true, isManuallyUnpublished: true } } },
  });
  if (rows.length === 0) return { restored: 0, republished: [] };
  const republished = rows
    .filter(({ job }) => !job.archivedAt && !job.isManuallyUnpublished && !!job.expiresAt && job.expiresAt.getTime() > now.getTime())
    .map((row) => row.jobId);
  if (republished.length > 0) {
    // A revival: each post is public again, so its content counts as changed
    // now (sitemap lastmod, "Last updated"; indexing audit fixSoon 5).
    await db.job.updateMany({
      where: { id: { in: republished }, archivedAt: null, employerJobs: { postPackId: packId, paymentStatus: 'disputed' } },
      data: { isPublished: true, contentChangedAt: now },
    });
  }
  const { count } = await db.employerJob.updateMany({
    where: { id: { in: rows.map((row) => row.id) }, paymentStatus: 'disputed' },
    data: { paymentStatus: 'pack' },
  });
  return { restored: count, republished };
}
