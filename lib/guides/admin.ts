/**
 * The guides store back office (register 2.35): what /admin/guides lists, and
 * the one change support makes to a purchase, a new library link.
 *
 * A library token never expires, so a forwarded delivery email is lasting
 * access. rotateGuideAccess gives the purchase a fresh token, which cuts off
 * the old link and every browser cookie holding it (the library and download
 * routes look purchases up by token), then sends the delivery email again
 * with the new link. The send is claimed the way fulfill.ts#deliverOnce
 * claims it, and the claim also names the new token, so when two rotations
 * overlap only the link that is current gets sent.
 *
 * The token never leaves this module: the view carries no accessToken.
 * Server only (Prisma and the email sender); the admin page imports types.
 */
import type { GuidePurchase, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { MAX_DOWNLOADS_PER_PURCHASE, newAccessToken } from './access';
import { formatPrice, getProduct } from './catalog';
import { sendGuidePurchaseEmail } from './email';

/** The most purchases the admin list reads, newest first: a bound on the read. */
export const MAX_ADMIN_GUIDE_PURCHASES_LISTED = 100;

/** The longest email address there can be (RFC 5321). */
export const MAX_EMAIL_SEARCH_LENGTH = 254;

/** The columns the admin list reads. Never the access token. */
export const ADMIN_GUIDE_PURCHASE_SELECT = {
    id: true,
    createdAt: true,
    email: true,
    source: true,
    productSlug: true,
    guideSlugs: true,
    amountCents: true,
    downloadCount: true,
    emailSentAt: true,
    refundedAt: true,
    disputedAt: true,
} as const satisfies Prisma.GuidePurchaseSelect;

export type AdminGuidePurchaseRow = Pick<GuidePurchase, keyof typeof ADMIN_GUIDE_PURCHASE_SELECT>;

export type GuidePurchaseStatus = 'active' | 'refunded' | 'disputed';

export interface AdminGuidePurchaseView {
    readonly id: string;
    readonly createdAt: string;
    readonly email: string | null;
    readonly source: string;
    readonly productSlug: string;
    readonly productTitle: string;
    readonly guideCount: number;
    readonly amount: string;
    readonly downloadsUsed: number;
    readonly downloadsAllowed: number;
    readonly emailSentAt: string | null;
    readonly status: GuidePurchaseStatus;
}

function purchaseStatus(row: Pick<GuidePurchase, 'refundedAt' | 'disputedAt'>): GuidePurchaseStatus {
    if (row.refundedAt) return 'refunded';
    if (row.disputedAt) return 'disputed';
    return 'active';
}

/** The admin view of a purchase. Picks each field by name, so a full row's token never comes along. */
export function toAdminGuidePurchaseView(row: AdminGuidePurchaseRow): AdminGuidePurchaseView {
    return {
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        email: row.email,
        source: row.source,
        productSlug: row.productSlug,
        productTitle: getProduct(row.productSlug)?.title ?? row.productSlug,
        guideCount: row.guideSlugs.length,
        amount: formatPrice(row.amountCents),
        downloadsUsed: row.downloadCount,
        downloadsAllowed: MAX_DOWNLOADS_PER_PURCHASE,
        emailSentAt: row.emailSentAt?.toISOString() ?? null,
        status: purchaseStatus(row),
    };
}

export type EmailSearch =
    | { readonly ok: true; readonly email: string | null }
    | { readonly ok: false; readonly error: string };

/** The email to search for, trimmed; null for none. Refused when it cannot be an address. */
export function parseEmailSearch(raw: unknown): EmailSearch {
    if (raw === undefined || raw === null) return { ok: true, email: null };
    if (typeof raw !== 'string') return { ok: false, error: 'Enter an email address.' };
    const email = raw.trim();
    if (email === '') return { ok: true, email: null };
    if (email.length > MAX_EMAIL_SEARCH_LENGTH || !email.includes('@')) {
        return { ok: false, error: 'Enter a full email address.' };
    }
    return { ok: true, email };
}

export type GuidePurchaseList =
    | { readonly ok: true; readonly purchases: readonly AdminGuidePurchaseView[] }
    | { readonly ok: false; readonly error: string };

/** Purchases newest first, bounded; only those of `email` (any case) when one is given. */
export async function listGuidePurchases(email?: string | null): Promise<GuidePurchaseList> {
    const search = parseEmailSearch(email);
    if (!search.ok) return search;
    const rows = await prisma.guidePurchase.findMany({
        where: search.email ? { email: { equals: search.email, mode: 'insensitive' } } : {},
        orderBy: { createdAt: 'desc' },
        take: MAX_ADMIN_GUIDE_PURCHASES_LISTED,
        select: ADMIN_GUIDE_PURCHASE_SELECT,
    });
    return { ok: true, purchases: rows.map(toAdminGuidePurchaseView) };
}

/**
 * What became of the email carrying the new link. 'blocked': not sent,
 * because the purchase is refunded or disputed and its guides cannot be
 * downloaded, so an email saying they are ready would be wrong.
 */
export type GuideAccessDelivery = 'sent' | 'retry' | 'refused' | 'no-address' | 'blocked';

export interface GuideAccessRotation {
    readonly purchase: AdminGuidePurchaseView;
    readonly delivery: GuideAccessDelivery;
}

interface LinkDelivery {
    readonly delivery: GuideAccessDelivery;
    readonly sentAt: Date | null;
}

/** The purchase with a fresh token and no sent email on record, or null when no row has this id. */
async function replaceToken(id: string): Promise<GuidePurchase | null> {
    try {
        return await prisma.guidePurchase.update({
            where: { id },
            data: { accessToken: newAccessToken(), emailSentAt: null },
        });
    } catch (error) {
        if ((error as { code?: string } | null)?.code === 'P2025') return null;
        throw error;
    }
}

/** Claim the send, send, and release the claim when the send fails. */
async function deliverNewLink(purchase: GuidePurchase): Promise<LinkDelivery> {
    if (!purchase.email) return { delivery: 'no-address', sentAt: null };
    if (purchase.refundedAt || purchase.disputedAt) return { delivery: 'blocked', sentAt: null };
    const current = { id: purchase.id, accessToken: purchase.accessToken };
    const sentAt = new Date();
    const claim = await prisma.guidePurchase.updateMany({
        where: { ...current, emailSentAt: null },
        data: { emailSentAt: sentAt },
    });
    // Another rotation replaced this token, or claimed its send, in between.
    if (claim.count !== 1) return { delivery: 'retry', sentAt: null };
    const result = await sendGuidePurchaseEmail(purchase);
    if (result === 'sent') return { delivery: 'sent', sentAt };
    await prisma.guidePurchase.updateMany({ where: current, data: { emailSentAt: null } });
    return { delivery: result, sentAt: null };
}

/** deliverNewLink, with a database failure reported as 'retry': the link is replaced either way. */
async function deliverSafely(purchase: GuidePurchase): Promise<LinkDelivery> {
    try {
        return await deliverNewLink(purchase);
    } catch (error) {
        logger.error('[Admin Guides] new link email failed', error, { purchaseId: purchase.id });
        return { delivery: 'retry', sentAt: null };
    }
}

/**
 * Give purchase `id` a new library link and email it. Null when no purchase
 * has this id. Refunded and disputed purchases rotate too, without an email:
 * a new token only takes access away, and the download route still refuses
 * them. A disputed purchase restored later can be rotated again to send it.
 */
export async function rotateGuideAccess(id: string): Promise<GuideAccessRotation | null> {
    const purchase = await replaceToken(id);
    if (!purchase) return null;
    const { delivery, sentAt } = await deliverSafely(purchase);
    return { purchase: toAdminGuidePurchaseView({ ...purchase, emailSentAt: sentAt }), delivery };
}
