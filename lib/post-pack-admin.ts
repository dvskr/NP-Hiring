/**
 * lib/post-pack-admin.ts — the 5-post pack back office (2027 re-price,
 * phase 3; plan section 3.9): what /admin/post-packs lists, and the three
 * changes an admin can make to one pack through
 * PATCH /api/admin/post-packs/:id.
 *
 *   revoke   take back a paid pack's unused posts, all of them or a count
 *            (a partial refund issued by hand in Stripe, which the webhook
 *            only alerts on; abuse)
 *   extend   move a paid pack's "Use by" date later, the date given as the
 *            employer reads it (lib/pricing-copy.ts#packExpiresAtForUseBy)
 *   restore  give back one post a paid pack spent (a post removed in error)
 *
 * Each change is planned from the row as read and written as a
 * compare-and-set on exactly what it was planned from, so a post spending a
 * credit at the same moment is never lost: a write that matches nothing
 * answers 409 and the admin reloads. The result always keeps the table's
 * CHECK (remaining and revoked never below zero, never more used plus revoked
 * than sold). Refunded and disputed packs belong to the Stripe webhook
 * (lib/post-packs.ts) and are never changed here.
 *
 * Client-safe (Prisma for types only), so the admin page and the routes
 * share one view.
 */
import type { Prisma } from '@prisma/client';
import { packExpiresAtForUseBy } from '@/lib/pricing-copy';
import { POST_PACK_VIEW_SELECT, toPostPackView, type PostPackRow, type PostPackView } from '@/lib/post-pack-view';

/** The columns the admin list and the change routes read. */
export const ADMIN_PACK_SELECT = {
  ...POST_PACK_VIEW_SELECT,
  userId: true,
  email: true,
  source: true,
  stripePaymentIntentId: true,
  refundedAt: true,
  updatedAt: true,
} as const satisfies Prisma.EmployerPostPackSelect;

/** The most packs the admin list reads, newest first: a bound on the read. */
export const MAX_ADMIN_PACKS_LISTED = 200;

/** How far ahead an admin may set a use-by date: a typo guard, not a product limit. */
export const MAX_USE_BY_YEARS_AHEAD = 3;

export interface AdminPackRow extends PostPackRow {
  userId: string | null;
  email: string;
  source: string;
  stripePaymentIntentId: string | null;
  refundedAt: Date | null;
  updatedAt: Date;
}

export interface AdminPackView extends PostPackView {
  userId: string | null;
  email: string;
  source: string;
  stripePaymentIntentId: string | null;
  refundedAt: string | null;
  updatedAt: string;
}

export function toAdminPackView(row: AdminPackRow, now: Date): AdminPackView {
  return {
    ...toPostPackView(row, now),
    userId: row.userId,
    email: row.email,
    source: row.source,
    stripePaymentIntentId: row.stripePaymentIntentId,
    refundedAt: row.refundedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** One change to one pack, as the PATCH body names it. */
export type PackAdminAction =
  | { action: 'revoke'; credits?: number }
  | { action: 'extend'; useBy: string }
  | { action: 'restore' };

/** What a change reads and writes: the audit trail records it before and after. */
export interface PackCounters {
  creditsRemaining: number;
  creditsRevoked: number;
  expiresAt: Date;
}

export type PackChangePlan =
  | {
    ok: true;
    where: Prisma.EmployerPostPackWhereInput;
    data: Prisma.EmployerPostPackUpdateManyMutationInput;
    previous: PackCounters;
    next: PackCounters;
  }
  | { ok: false; status: 400 | 409; error: string };

type PackAdminTarget = Pick<AdminPackRow, 'id' | 'status' | 'creditsTotal' | 'creditsRemaining' | 'creditsRevoked' | 'expiresAt'>;

const refuse = (status: 400 | 409, error: string): PackChangePlan => ({ ok: false, status, error });

/** The write a change makes to `pack` at `now`, or why it is refused. */
export function planPackChange(pack: PackAdminTarget, change: PackAdminAction, now: Date): PackChangePlan {
  if (pack.status !== 'paid') return refuse(409, `This pack is ${pack.status}. Only a paid pack can be changed here.`);
  const previous: PackCounters = { creditsRemaining: pack.creditsRemaining, creditsRevoked: pack.creditsRevoked, expiresAt: pack.expiresAt };
  // The counters it was planned from: a post spending a credit in between makes the write match nothing.
  const countersWhere = { id: pack.id, status: 'paid', creditsRemaining: pack.creditsRemaining, creditsRevoked: pack.creditsRevoked };

  switch (change.action) {
    case 'revoke': {
      const left = pack.creditsRemaining;
      if (left === 0) return refuse(409, 'This pack has no unused posts to revoke.');
      const credits = change.credits ?? left;
      if (credits > left) return refuse(409, `This pack has ${left} unused ${left === 1 ? 'post' : 'posts'}.`);
      const next = { ...previous, creditsRemaining: left - credits, creditsRevoked: pack.creditsRevoked + credits };
      return { ok: true, where: countersWhere, data: { creditsRemaining: next.creditsRemaining, creditsRevoked: next.creditsRevoked }, previous, next };
    }
    case 'extend': {
      const expiresAt = packExpiresAtForUseBy(change.useBy);
      if (!expiresAt) return refuse(400, 'Pick a real date, as YYYY-MM-DD.');
      if (expiresAt.getTime() <= now.getTime()) return refuse(409, 'Pick a use-by date in the future.');
      if (expiresAt.getTime() <= pack.expiresAt.getTime()) return refuse(409, 'Pick a use-by date after the current one.');
      const latest = new Date(now.getTime());
      latest.setUTCFullYear(latest.getUTCFullYear() + MAX_USE_BY_YEARS_AHEAD);
      if (expiresAt.getTime() > latest.getTime()) return refuse(409, `Pick a use-by date within ${MAX_USE_BY_YEARS_AHEAD} years.`);
      return {
        ok: true,
        where: { id: pack.id, status: 'paid', expiresAt: pack.expiresAt },
        data: { expiresAt },
        previous,
        next: { ...previous, expiresAt },
      };
    }
    case 'restore': {
      const used = pack.creditsTotal - pack.creditsRemaining - pack.creditsRevoked;
      if (used < 1) return refuse(409, 'This pack has no used posts to restore.');
      const next = { ...previous, creditsRemaining: pack.creditsRemaining + 1 };
      return { ok: true, where: countersWhere, data: { creditsRemaining: next.creditsRemaining }, previous, next };
    }
  }
}
