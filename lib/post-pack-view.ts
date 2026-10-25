/**
 * lib/post-pack-view.ts — one 5-post pack as the employer's pages show it
 * (2027 re-price, phase 3): GET /api/employer/post-packs, /employer/post-pack,
 * the dashboard usage widget and Settings, Billing all print these.
 *
 *   state  — active   paid, unexpired, a credit left
 *            used     paid, unexpired, every credit spent
 *            expired  paid, past its expiresAt
 *            refunded / disputed  as the webhook left it (lib/post-packs.ts)
 *   counts — total = sold less revoked, used = total less remaining, so a
 *            used-up pack still reads "5 of 5 posts used"
 *   links  — Stripe's hosted invoice page, https only (packInvoiceHref)
 *
 * Client-safe: imports lib/config and lib/pricing-copy only (Prisma for a
 * type). The dates print in the zone the pack's "Use by" date is counted in
 * (lib/pricing-copy.ts#packDateLabel).
 */
import type { Prisma } from '@prisma/client';
import { packDateLabel, packUseByLabel } from '@/lib/pricing-copy';

/** The columns a pack view reads. */
export const POST_PACK_VIEW_SELECT = {
  id: true,
  status: true,
  creditsTotal: true,
  creditsRemaining: true,
  creditsRevoked: true,
  amountCents: true,
  currency: true,
  purchasedAt: true,
  expiresAt: true,
  hostedInvoiceUrl: true,
  invoicePdfUrl: true,
  invoiceNumber: true,
} as const satisfies Prisma.EmployerPostPackSelect;

/** The most packs a page lists for one account: a bound on the read, far above what one account buys. */
export const MAX_PACKS_LISTED = 50;

export type PostPackState = 'active' | 'used' | 'expired' | 'refunded' | 'disputed';

/** A pack row as POST_PACK_VIEW_SELECT reads it. */
export interface PostPackRow {
  id: string;
  status: string;
  creditsTotal: number;
  creditsRemaining: number;
  creditsRevoked: number;
  amountCents: number;
  currency: string;
  purchasedAt: Date;
  expiresAt: Date;
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;
  invoiceNumber: string | null;
}

/** A pack as the pages receive it (dates as ISO strings, so it crosses to a client page). */
export interface PostPackView {
  id: string;
  state: PostPackState;
  /** Credits sold less revoked. */
  total: number;
  remaining: number;
  /** Credits spent on posts. */
  used: number;
  revoked: number;
  amountCents: number;
  currency: string;
  purchasedAt: string;
  expiresAt: string;
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;
  invoiceNumber: string | null;
}

/** The state of a pack at `now`. */
export function postPackState(row: Pick<PostPackRow, 'status' | 'creditsRemaining' | 'expiresAt'>, now: Date): PostPackState {
  if (row.status === 'refunded') return 'refunded';
  if (row.status === 'disputed') return 'disputed';
  if (row.expiresAt.getTime() <= now.getTime()) return 'expired';
  return row.creditsRemaining > 0 ? 'active' : 'used';
}

/** A pack row as the pages show it. */
export function toPostPackView(row: PostPackRow, now: Date): PostPackView {
  const total = row.creditsTotal - row.creditsRevoked;
  return {
    id: row.id,
    state: postPackState(row, now),
    total,
    remaining: row.creditsRemaining,
    used: total - row.creditsRemaining,
    revoked: row.creditsRevoked,
    amountCents: row.amountCents,
    currency: row.currency,
    purchasedAt: row.purchasedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    hostedInvoiceUrl: row.hostedInvoiceUrl,
    invoicePdfUrl: row.invoicePdfUrl,
    invoiceNumber: row.invoiceNumber,
  };
}

/**
 * "3 of 5 posts left" while a credit can be spent, else "5 of 5 posts used";
 * "No posts used" for a pack whose every credit was revoked unspent, never
 * "0 of 0". The noun follows the total.
 */
export function packCreditsLine(view: Pick<PostPackView, 'state' | 'total' | 'remaining' | 'used'>): string {
  if (view.total <= 0) return 'No posts used';
  const posts = view.total === 1 ? 'post' : 'posts';
  return view.state === 'active'
    ? `${view.remaining} of ${view.total} ${posts} left`
    : `${view.used} of ${view.total} ${posts} used`;
}

/**
 * Stripe's hosted invoice page for a pack, as the webhook stored it, or null
 * before it has one. Only an https link is ever handed to a page.
 */
export function packInvoiceHref(view: Pick<PostPackView, 'hostedInvoiceUrl'>): string | null {
  const url = view.hostedInvoiceUrl;
  return url && url.startsWith('https://') ? url : null;
}

/** The pack's date or state: "Use by <date>", "Expired <date>", "Refunded", "Disputed"; null for a used-up pack. */
export function packStatusLine(view: Pick<PostPackView, 'state' | 'expiresAt'>): string | null {
  switch (view.state) {
    case 'active': return `Use by ${packUseByLabel(new Date(view.expiresAt))}`;
    case 'expired': return `Expired ${packDateLabel(new Date(view.expiresAt))}`;
    case 'refunded': return 'Refunded';
    case 'disputed': return 'Disputed';
    default: return null;
  }
}
