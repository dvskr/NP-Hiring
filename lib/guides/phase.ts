/**
 * lib/guides/phase.ts: which way the guides store hands out a guide right
 * now, and the copy that changes with it.
 *
 * Owner decision (2026-11-07): the guides take their catalog prices from the
 * same instant the paid posting ladder starts (config.promoEndsAt). Until then
 * every product, bundles included, is free to claim with an email address
 * (POST /api/guides/claim) and Stripe is never called; after it, the guides are
 * sold through Stripe Checkout (POST /api/guides/checkout), all sales final.
 *
 * guideSaleClosedReason is the one copy of the paid gate, in the same order as
 * the 5-post pack's (lib/post-pack-sale.ts): paid posting on, the Stripe key and
 * STRIPE_WEBHOOK_SECRET set, the promo over. An environment that will not parse
 * reads as closed, and is logged.
 *
 * Every phase-dependent sentence comes from guidePriceCopy, decided at render or
 * send time, so no page prints "Free through ..." after the promo ends
 * (tests/regressions/promo-copy-static-guard.test.ts).
 */
import { getEnv, getPaidPostingStatus } from '@/lib/env';
import { config } from '@/lib/config';
import { logger } from '@/lib/logger';
import { formatPrice, savingsCents, separatePriceCents, type Product } from '@/lib/guides/catalog';

/** Checkout Session and PaymentIntent metadata.type of a guide purchase. */
export const GUIDE_CHECKOUT_TYPE = 'guide';

export type GuidePhase = 'promo' | 'paid';

export function guidePhase(now: Date = new Date()): GuidePhase {
    return config.isPromoActive(now) ? 'promo' : 'paid';
}

/** True while a guide can be claimed free (the launch promo). */
export function isGuideClaimOpen(now: Date = new Date()): boolean {
    return guidePhase(now) === 'promo';
}

/** Why a guide cannot be bought through Stripe right now; each is the code POST /api/guides/checkout answers. */
export type GuideSaleClosedReason = 'PAID_POSTING_DISABLED' | 'STRIPE_NOT_CONFIGURED' | 'PROMO_ACTIVE';

/** The first condition of the paid gate that fails at `now` (see the file header); null while guides can be sold. */
export function guideSaleClosedReason(now: Date = new Date()): GuideSaleClosedReason | null {
    try {
        const paidPosting = getPaidPostingStatus();
        if (!paidPosting.enabled) return 'PAID_POSTING_DISABLED';
        if (!paidPosting.stripeConfigured || !getEnv().STRIPE_WEBHOOK_SECRET) return 'STRIPE_NOT_CONFIGURED';
        return config.isPromoActive(now) ? 'PROMO_ACTIVE' : null;
    } catch (err) {
        logger.error('[GuideSale] The environment would not parse; the guides sale reads as closed', err);
        return 'STRIPE_NOT_CONFIGURED';
    }
}

/** True when a guide can be bought right now. */
export function isGuideSaleOpen(now: Date = new Date()): boolean {
    return guideSaleClosedReason(now) === null;
}

export interface GuidePriceCopy {
    readonly phase: GuidePhase;
    /** The price as shown on a card: "Free" during the promo, else "$19". */
    readonly price: string;
    /**
     * The price struck through beside the one shown: the catalog price beside "Free" during the promo; after it,
     * a bundle's guides bought one at a time; null for a single guide after the promo.
     */
    readonly listPrice: string | null;
    /** The line under the price: when the free period ends and what it costs after, or what a bundle saves. */
    readonly note: string | null;
    /** The button label. */
    readonly cta: string;
}

/** The price block for one product at `now`. */
export function guidePriceCopy(product: Product, now: Date = new Date()): GuidePriceCopy {
    const listPrice = formatPrice(product.priceCents);
    if (config.isPromoActive(now)) {
        return {
            phase: 'promo',
            price: 'Free',
            listPrice,
            note: `Free through ${config.promoEndsLabel}, then ${listPrice}`,
            cta: product.kind === 'bundle' ? 'Get them free' : 'Get it free',
        };
    }
    if (product.kind === 'bundle') {
        return {
            phase: 'paid',
            price: listPrice,
            listPrice: formatPrice(separatePriceCents(product)),
            note: `Save ${formatPrice(savingsCents(product))} on buying them one at a time`,
            cta: `Buy for ${listPrice}`,
        };
    }
    return { phase: 'paid', price: listPrice, listPrice: null, note: null, cta: `Buy for ${listPrice}` };
}
