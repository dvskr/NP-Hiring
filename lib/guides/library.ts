/**
 * The reader's side of the guides store: what a browser's library cookie
 * unlocks, and the download counter behind each purchase.
 *
 * A purchase is a paid Stripe sale or a launch-promo claim; both unlock their
 * guides the same way. A refunded or disputed sale unlocks nothing (a promo
 * claim is never either: it has no payment).
 */
import { prisma } from '@/lib/prisma';
import { GUIDE_SLUGS, type GuideSlug, isGuideSlug } from './catalog';
import { MAX_DOWNLOADS_PER_PURCHASE } from './access';

/** One purchase as the library page shows it. */
export interface LibraryPurchase {
    readonly id: string;
    readonly productSlug: string;
    readonly guideSlugs: readonly GuideSlug[];
    readonly purchasedAt: Date;
    readonly revoked: boolean;
}

export interface Library {
    readonly purchases: readonly LibraryPurchase[];
    /** Every guide this browser may download, in store order. */
    readonly guides: readonly GuideSlug[];
}

export async function loadLibrary(tokens: readonly string[]): Promise<Library> {
    if (!tokens.length) return { purchases: [], guides: [] };
    const rows = await prisma.guidePurchase.findMany({
        where: { accessToken: { in: [...tokens] } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, productSlug: true, guideSlugs: true, createdAt: true, refundedAt: true, disputedAt: true },
    });
    const purchases = rows.map((row) => ({
        id: row.id,
        productSlug: row.productSlug,
        guideSlugs: row.guideSlugs.filter(isGuideSlug),
        purchasedAt: row.createdAt,
        revoked: Boolean(row.refundedAt || row.disputedAt),
    }));
    const owned = new Set(purchases.filter((p) => !p.revoked).flatMap((p) => p.guideSlugs));
    return { purchases, guides: GUIDE_SLUGS.filter((slug) => owned.has(slug)) };
}

export type DownloadDecision =
    | { readonly ok: true; readonly purchaseId: string }
    | { readonly ok: false; readonly reason: 'no-access' | 'revoked' | 'limit' };

/**
 * Whether this browser may download `guide`, counting the download when it
 * may. The count is incremented conditionally in one statement, so parallel
 * clicks cannot run a purchase past its limit.
 */
export async function authorizeDownload(tokens: readonly string[], guide: GuideSlug): Promise<DownloadDecision> {
    if (!tokens.length) return { ok: false, reason: 'no-access' };
    const purchases = await prisma.guidePurchase.findMany({
        where: { accessToken: { in: [...tokens] }, guideSlugs: { has: guide } },
        select: { id: true, refundedAt: true, disputedAt: true, downloadCount: true },
        orderBy: { downloadCount: 'asc' },
    });
    if (!purchases.length) return { ok: false, reason: 'no-access' };
    const active = purchases.filter((p) => !p.refundedAt && !p.disputedAt);
    if (!active.length) return { ok: false, reason: 'revoked' };

    for (const purchase of active) {
        const counted = await prisma.guidePurchase.updateMany({
            where: { id: purchase.id, downloadCount: { lt: MAX_DOWNLOADS_PER_PURCHASE }, refundedAt: null, disputedAt: null },
            data: { downloadCount: { increment: 1 } },
        });
        if (counted.count === 1) return { ok: true, purchaseId: purchase.id };
    }
    return { ok: false, reason: 'limit' };
}

/** Give back a counted download whose file could not be served. */
export async function releaseDownload(purchaseId: string): Promise<void> {
    await prisma.guidePurchase.updateMany({
        where: { id: purchaseId, downloadCount: { gt: 0 } },
        data: { downloadCount: { decrement: 1 } },
    });
}

export async function purchaseExists(accessToken: string): Promise<boolean> {
    return (await prisma.guidePurchase.count({ where: { accessToken } })) > 0;
}
