/**
 * lib/employer-plan.ts — the $399/month Employer plan (config.planPrice).
 *
 * Model: an EmployerPlan row per employer (userId) holding `slots` concurrent
 * postings. Posts created under the plan are EmployerJob rows with
 * paymentStatus 'plan' / pricingTier 'plan'. They are live while the plan is
 * entitled (see isPlanEntitled) and for at most config.durationDays each; the
 * Inngest job in lib/inngest/functions/plan-lapse.ts pauses them when the
 * plan lapses and `resumePlanPosts` re-publishes them when it is paid again.
 *
 * Rows are written by the Stripe subscription webhook (Payment Link in
 * subscription mode), the plan reconciliation sweep and the admin grant API.
 * A plan the webhook could not tie to an employer account is stored with
 * userId = null and `email` set so an admin can attach it.
 */
import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';
import { logger } from '@/lib/logger';

/**
 *   active    — paid and current
 *   past_due  — renewal payment failed; entitled through the grace window
 *   cancelled — no longer billed; entitled only through the paid period
 *   pending   — checkout completed but the first payment has not settled
 *               (delayed-notification method, or SCA left the subscription
 *               'incomplete'); never entitled, promoted once paid
 */
export type PlanStatus = 'active' | 'past_due' | 'cancelled' | 'pending';

export const PLAN_STATUSES: readonly PlanStatus[] = ['active', 'past_due', 'cancelled', 'pending'];

/**
 * Stripe identity of the Employer plan price (tmp/stripe-bootstrap.js). The
 * webhook only treats a subscription checkout as the Employer plan when the
 * subscribed price carries this lookup key or the plan SKU metadata.
 */
export const PLAN_PRICE_LOOKUP_KEY = 'np_hiring_employer_plan_monthly';
export const PLAN_SKU = 'employer-plan';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Stripe subscription status → plan status.
 *
 *   active | trialing              → 'active'    (entitled)
 *   past_due | unpaid | paused     → 'past_due'  (entitled through the grace window;
 *                                                 Stripe Smart Retries usually recover it)
 *   canceled | incomplete_expired  → 'cancelled' (entitled only through the paid period)
 *   incomplete                     → 'pending'   (the first payment never succeeded — a
 *                                                 completed Checkout Session is not a
 *                                                 successful payment; never entitled)
 *
 * Any status a newer Stripe API adds is mapped to 'past_due' so an existing
 * paying row fails toward the grace window; the next event corrects it.
 */
export function mapStripeSubscriptionStatus(status: string | null | undefined): PlanStatus {
  switch (status) {
    case 'active':
    case 'trialing':
      return 'active';
    case 'canceled':
    case 'incomplete_expired':
      return 'cancelled';
    case 'incomplete':
      return 'pending';
    case 'past_due':
    case 'unpaid':
    case 'paused':
      return 'past_due';
    default:
      logger.warn('unknown Stripe subscription status — treating as past_due', { status: status ?? 'undefined' });
      return 'past_due';
  }
}

/** Instant after which an active/past_due plan no longer entitles posts (period end + grace). */
export function planEntitlementEndsAt(currentPeriodEnd: Date): Date {
  return new Date(currentPeriodEnd.getTime() + config.planGraceDays * DAY_MS);
}

/**
 * The ONE entitlement rule (webhook, posting gate, lapse sweep, admin page).
 *
 *   active | past_due → currentPeriodEnd + config.planGraceDays in the future
 *   cancelled         → currentPeriodEnd in the future, no grace: a cancel
 *                       keeps the paid-through period (the /pricing FAQ and
 *                       /terms §8 promise exactly that) and nothing more
 *   pending | other   → never
 */
export function isPlanEntitled(plan: { status: string; currentPeriodEnd: Date } | null | undefined, now: Date = new Date()): boolean {
  if (!plan) return false;
  if (plan.status === 'cancelled') return plan.currentPeriodEnd.getTime() > now.getTime();
  if (plan.status !== 'active' && plan.status !== 'past_due') return false;
  return planEntitlementEndsAt(plan.currentPeriodEnd).getTime() > now.getTime();
}

export async function getPlanForUser(userId: string) {
  return prisma.employerPlan.findUnique({ where: { userId } });
}

/** The plan row for a Stripe subscription, or null (subscription id is unique). */
export async function getPlanBySubscriptionId(stripeSubscriptionId: string) {
  return prisma.employerPlan.findUnique({ where: { stripeSubscriptionId } });
}

/**
 * Plans that no longer entitle posting and are attached to an employer —
 * the complement of isPlanEntitled. Unattached rows (userId null) cannot own
 * posts, so the lapse job never needs them. Used by
 * lib/inngest/functions/plan-lapse.ts.
 */
export async function findLapsedPlans(now: Date = new Date()) {
  // active/past_due entitlement ends at currentPeriodEnd + grace, so those
  // lapse when currentPeriodEnd < now - grace; a cancelled plan lapses at
  // currentPeriodEnd itself; a pending plan was never entitled.
  const periodEndCutoff = new Date(now.getTime() - config.planGraceDays * DAY_MS);
  return prisma.employerPlan.findMany({
    where: {
      userId: { not: null },
      OR: [
        { status: 'cancelled', currentPeriodEnd: { lte: now } },
        { status: 'pending' },
        { status: { notIn: ['cancelled', 'pending'] }, currentPeriodEnd: { lt: periodEndCutoff } },
      ],
    },
    select: { id: true, userId: true, email: true, status: true, currentPeriodEnd: true },
    orderBy: { currentPeriodEnd: 'asc' },
  });
}

/** The employer's plan if it currently entitles posting, else null. */
export async function getActivePlan(userId: string, now: Date = new Date()) {
  const plan = await getPlanForUser(userId);
  return isPlanEntitled(plan, now) ? plan : null;
}

/** Live 'plan' posts for this employer (published, not expired). */
export async function countActivePlanPosts(userId: string, now: Date = new Date()): Promise<number> {
  return prisma.employerJob.count({
    where: {
      userId,
      paymentStatus: 'plan',
      job: { isPublished: true, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    },
  });
}

export interface PlanSlotStatus {
  plan: Awaited<ReturnType<typeof getPlanForUser>>;
  entitled: boolean;
  slots: number;
  used: number;
  remaining: number;
  /** True when the employer can post one more job under the plan right now. */
  canPost: boolean;
}

export async function getPlanSlotStatus(userId: string, now: Date = new Date()): Promise<PlanSlotStatus> {
  const plan = await getPlanForUser(userId);
  const entitled = isPlanEntitled(plan, now);
  const slots = plan?.slots ?? 0;
  const used = entitled ? await countActivePlanPosts(userId, now) : 0;
  const remaining = entitled ? Math.max(0, slots - used) : 0;
  return { plan, entitled, slots, used, remaining, canPost: entitled && remaining > 0 };
}

type PlanRow = NonNullable<Awaited<ReturnType<typeof getPlanForUser>>>;

export interface ExistingPlanMatch {
  row: PlanRow;
  /** 'subscription' = the SAME subscription; 'user' / 'email' = a row that merely shares the owner. */
  matchedBy: 'subscription' | 'user' | 'email';
}

/** The row an upsert would write to: subscription id → userId → unattached row with the same email. */
export async function findExistingPlanRow(keys: { stripeSubscriptionId: string | null; userId: string | null; email: string | null }): Promise<ExistingPlanMatch | null> {
  if (keys.stripeSubscriptionId) {
    const bySubscription = await prisma.employerPlan.findUnique({ where: { stripeSubscriptionId: keys.stripeSubscriptionId } });
    if (bySubscription) return { row: bySubscription, matchedBy: 'subscription' };
  }
  if (keys.userId) {
    const byUser = await prisma.employerPlan.findUnique({ where: { userId: keys.userId } });
    if (byUser) return { row: byUser, matchedBy: 'user' };
  }
  if (!keys.email) return null;
  const byEmail = await prisma.employerPlan.findFirst({ where: { email: keys.email, userId: null } });
  return byEmail ? { row: byEmail, matchedBy: 'email' } : null;
}

/** True when writing `incomingSubscriptionId` onto `row` would orphan a different, still-live subscription. */
export function wouldOrphanSubscription(
  row: { stripeSubscriptionId: string | null; status: string },
  incomingSubscriptionId: string | null | undefined,
): boolean {
  return !!incomingSubscriptionId
    && !!row.stripeSubscriptionId
    && row.stripeSubscriptionId !== incomingSubscriptionId
    && row.status !== 'cancelled';
}

/**
 * Thrown by upsertPlan instead of silently overwriting a row that already
 * tracks a DIFFERENT, still-live Stripe subscription. Overwriting would
 * orphan that subscription: it keeps billing, and every later event for it
 * resolves to no row. The caller alerts so a human decides.
 */
export class PlanSubscriptionConflictError extends Error {
  readonly existing: PlanRow;
  readonly incomingSubscriptionId: string;

  constructor(existing: PlanRow, incomingSubscriptionId: string) {
    super(`employer plan ${existing.id} already tracks a live subscription; refusing to overwrite it with ${incomingSubscriptionId}`);
    this.name = 'PlanSubscriptionConflictError';
    this.existing = existing;
    this.incomingSubscriptionId = incomingSubscriptionId;
  }
}

export interface UpsertPlanInput {
  /** Supabase auth id; null when the checkout could not be tied to an employer account. */
  userId: string | null;
  email: string;
  status: PlanStatus;
  currentPeriodEnd: Date;
  slots?: number;
  priceCents?: number;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  source: 'stripe' | 'admin';
  /** `created` of the Stripe event (or the time of a live read) this write reflects. */
  lastStripeEventAt?: Date;
}

export interface UpsertPlanOptions {
  /**
   * Only ever write the row for this exact subscription, or create a new
   * UNATTACHED row — never reuse a row found by userId/email. Used to track
   * a duplicate subscription without touching the employer's live plan.
   */
  detached?: boolean;
}

/**
 * Create or update the plan row. One row per employer: the lookup falls
 * through stripeSubscriptionId → userId → unattached row with the same email,
 * and the first hit is updated in place. The fall-through matters in two real
 * sequences:
 *   - admin grant, then the employer subscribes via Stripe: the Stripe row
 *     must REPLACE the grant (userId is unique) rather than fail with P2002;
 *   - Stripe checkout that matched no account (userId null), then an admin
 *     attaches or the employer subscribes again: the orphan row is reused
 *     instead of leaving a duplicate behind.
 *
 * Guards:
 *   - a row found by userId/email that tracks a DIFFERENT live subscription
 *     is never overwritten (PlanSubscriptionConflictError);
 *   - Stripe ids are written only when the caller passes them, so an admin
 *     write can never sever the webhook link of a paying subscription;
 *   - a row with a Stripe subscription stays Stripe-owned: an admin write
 *     keeps its status, period end and `source: 'stripe'`.
 */
export async function upsertPlan(input: UpsertPlanInput, options: UpsertPlanOptions = {}) {
  const email = input.email.toLowerCase();
  const subscriptionId = input.stripeSubscriptionId ?? null;

  const match = options.detached
    ? (subscriptionId ? await findExistingPlanRow({ stripeSubscriptionId: subscriptionId, userId: null, email: null }) : null)
    : await findExistingPlanRow({ stripeSubscriptionId: subscriptionId, userId: input.userId, email });

  if (match && match.matchedBy !== 'subscription' && wouldOrphanSubscription(match.row, subscriptionId)) {
    throw new PlanSubscriptionConflictError(match.row, subscriptionId as string);
  }

  const existing = match?.row ?? null;
  const stripeOwned = !!existing?.stripeSubscriptionId;
  const keepStripeState = input.source === 'admin' && stripeOwned && existing !== null;

  const data = {
    userId: options.detached ? (existing?.userId ?? null) : input.userId,
    email,
    status: keepStripeState ? existing.status : input.status,
    currentPeriodEnd: keepStripeState ? existing.currentPeriodEnd : input.currentPeriodEnd,
    slots: input.slots ?? config.planSlots,
    priceCents: input.priceCents ?? config.planPrice * 100,
    ...(input.stripeCustomerId !== undefined && { stripeCustomerId: input.stripeCustomerId }),
    ...(input.stripeSubscriptionId !== undefined && { stripeSubscriptionId: input.stripeSubscriptionId }),
    ...(input.lastStripeEventAt !== undefined && { lastStripeEventAt: input.lastStripeEventAt }),
    source: stripeOwned ? 'stripe' : input.source,
  };

  if (existing) {
    const updated = await prisma.employerPlan.update({ where: { id: existing.id }, data });
    logger.info('employer plan updated', { planId: updated.id, userId: updated.userId ?? undefined, status: updated.status, source: data.source });
    return updated;
  }
  const created = await prisma.employerPlan.create({ data });
  logger.info('employer plan created', { planId: created.id, userId: created.userId ?? undefined, status: created.status, source: data.source });
  return created;
}

/**
 * Pause every live 'plan' post for a lapsed plan: unpublish, keep the row.
 * Returns the affected job ids so the caller can email the employer.
 */
export async function pausePlanPosts(userId: string, now: Date = new Date()): Promise<string[]> {
  const rows = await prisma.employerJob.findMany({
    where: {
      userId,
      paymentStatus: 'plan',
      job: { isPublished: true, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    },
    select: { jobId: true },
  });
  if (rows.length === 0) return [];
  const jobIds = rows.map((r) => r.jobId);
  await prisma.job.updateMany({ where: { id: { in: jobIds } }, data: { isPublished: false } });
  logger.info('employer plan posts paused', { userId, count: jobIds.length });
  return jobIds;
}

/**
 * Re-publish paused 'plan' posts whose 60-day window has not elapsed, up to
 * the plan's slot count (newest first). Used when a lapsed plan is paid again.
 */
export async function resumePlanPosts(userId: string, now: Date = new Date()): Promise<string[]> {
  const status = await getPlanSlotStatus(userId, now);
  if (!status.canPost) return [];
  const rows = await prisma.employerJob.findMany({
    where: {
      userId,
      paymentStatus: 'plan',
      job: { isPublished: false, archivedAt: null, expiresAt: { gt: now } },
    },
    select: { jobId: true },
    orderBy: { createdAt: 'desc' },
    take: status.remaining,
  });
  if (rows.length === 0) return [];
  const jobIds = rows.map((r) => r.jobId);
  await prisma.job.updateMany({ where: { id: { in: jobIds } }, data: { isPublished: true } });
  logger.info('employer plan posts resumed', { userId, count: jobIds.length });
  return jobIds;
}
