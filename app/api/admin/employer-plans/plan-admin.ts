/**
 * Shared pieces for the admin Employer-plan routes (list / grant / edit).
 *
 * Lives outside route.ts because Next.js App Router route files may only
 * export HTTP method handlers and the reserved segment-config fields — the
 * same reason app/api/admin/company-claims/claim-select.ts exists.
 *
 * Two things both routes need:
 *   - one Prisma selection + a "live plan posts per employer" count so the
 *     admin page shows slots used without a second round-trip;
 *   - the post-write side effects (resume / pause + email) so an admin
 *     grant, an admin cancel and the Stripe webhook all leave the employer's
 *     postings in the same state for the same status.
 */
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { createClient } from '@/lib/supabase/server';
import { config } from '@/lib/config';
import { logger } from '@/lib/logger';
import { sendPlanPausedEmail } from '@/lib/email-service';
import {
  PLAN_STATUSES,
  isPlanEntitled,
  pausePlanPosts,
  resumePlanPosts,
  type PlanStatus,
} from '@/lib/employer-plan';

export const PLAN_SELECT = {
  id: true,
  userId: true,
  email: true,
  status: true,
  slots: true,
  priceCents: true,
  currentPeriodEnd: true,
  stripeCustomerId: true,
  stripeSubscriptionId: true,
  source: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Upper bound on an admin-granted slot count — a typo guard, not a product limit. */
export const MAX_ADMIN_SLOTS = 50;

export const planStatusSchema = z.enum(PLAN_STATUSES as [PlanStatus, ...PlanStatus[]]);
export const slotsSchema = z.number().int().min(1).max(MAX_ADMIN_SLOTS);
/** ISO datetime or date-only string, coerced; must parse to a real instant. */
export const periodEndSchema = z.coerce.date().refine((d) => !Number.isNaN(d.getTime()), 'Invalid date');
export const emailSchema = z.string().trim().email().max(254);

export type AdminPlanRow = {
  id: string;
  userId: string | null;
  email: string;
  status: string;
  slots: number;
  priceCents: number;
  currentPeriodEnd: Date;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  source: string;
  createdAt: Date;
  updatedAt: Date;
};

export interface AdminPlanView extends AdminPlanRow {
  /** Live (published, unexpired) 'plan' posts owned by the attached employer. */
  used: number;
  /** Computed with the same rule the posting gate uses. */
  entitled: boolean;
}

/** Attach slot usage + entitlement to plan rows in one grouped query. */
export async function withUsage(rows: AdminPlanRow[], now: Date = new Date()): Promise<AdminPlanView[]> {
  const userIds = rows.map((r) => r.userId).filter((id): id is string => id !== null);
  const usage = new Map<string, number>();
  if (userIds.length > 0) {
    const grouped = await prisma.employerJob.groupBy({
      by: ['userId'],
      where: {
        userId: { in: userIds },
        paymentStatus: 'plan',
        job: { isPublished: true, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      },
      _count: { _all: true },
    });
    for (const g of grouped) {
      if (g.userId) usage.set(g.userId, g._count._all);
    }
  }
  return rows.map((row) => ({
    ...row,
    used: row.userId ? usage.get(row.userId) ?? 0 : 0,
    entitled: isPlanEntitled(row, now),
  }));
}

/** Supabase auth id of the employer account with this email, or null. */
export async function findEmployerByEmail(email: string): Promise<{ supabaseId: string; email: string } | null> {
  return prisma.userProfile.findFirst({
    where: { email: { equals: email, mode: 'insensitive' }, role: 'employer' },
    select: { supabaseId: true, email: true },
  });
}

/**
 * Bring the employer's postings in line with the plan's new state. Mirrors
 * the Stripe webhook: active/past_due and entitled → re-publish paused plan
 * posts (no-op when none); cancelled → posts stay live through the paid
 * period (currentPeriodEnd — the daily lapse sweep pauses them then), and
 * only a cancel with no paid time left pauses now and tells the employer.
 * Best-effort — the plan row is already written; a failure here is logged,
 * never thrown.
 */
export async function applyPlanStateToPosts(plan: AdminPlanRow, now: Date = new Date()): Promise<{ resumed: number; paused: number }> {
  if (!plan.userId) return { resumed: 0, paused: 0 };
  try {
    if (plan.status === 'cancelled') {
      if (isPlanEntitled(plan, now)) return { resumed: 0, paused: 0 };
      const paused = await pausePlanPosts(plan.userId, now);
      try {
        await sendPlanPausedEmail(plan.email, { reason: 'cancelled', pausedCount: paused.length });
      } catch (emailErr) {
        logger.error('[Admin Employer Plans] plan paused email failed', emailErr, { planId: plan.id });
      }
      return { resumed: 0, paused: paused.length };
    }
    if (isPlanEntitled(plan, now)) {
      const resumed = await resumePlanPosts(plan.userId, now);
      return { resumed: resumed.length, paused: 0 };
    }
    return { resumed: 0, paused: 0 };
  } catch (err) {
    logger.error('[Admin Employer Plans] failed to apply plan state to posts', err, { planId: plan.id });
    return { resumed: 0, paused: 0 };
  }
}

/**
 * Identity of the acting admin for the audit trail. requireApiAdmin returns
 * only pass/fail, so read the session again rather than trusting anything
 * client-supplied. Non-fatal: the action is still recorded without an actor.
 */
export async function currentAdminId(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}

/** Default period end for an admin grant with no explicit date: one calendar month out. */
export function defaultGrantPeriodEnd(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

export const DEFAULT_PLAN_SLOTS = config.planSlots;
