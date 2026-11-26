/**
 * lib/guides/phase.ts: which way the guides store hands out a guide, and the
 * price block every store surface prints.
 *
 * Owner decision (2026-11-26): the guides are sold at their catalog prices as
 * soon as this deployment can take the payment, and never on the posting
 * promo's clock (job posting stays free to config.promoEndsAt either way).
 * guidePhase() is the one check, read by the store pages, the claim route and
 * the checkout alike:
 *   - 'paid' when the Stripe key and STRIPE_WEBHOOK_SECRET are both set
 *     (trimmed, as lib/stripe.ts and the Stripe webhook read them): checkout
 *     opens (POST /api/guides/checkout) and the claim route refuses;
 *   - 'free' otherwise: every product, bundles included, is free to claim
 *     with an email address (POST /api/guides/claim), checkout refuses, and
 *     no page offers a Buy button, because none could work.
 * ENABLE_PAID_POSTING plays no part: it opens the paid posting routes and the
 * renewals, which stay closed until the owner turns it on.
 *
 * A Vercel deployment reads its environment when it is built and when it
 * runs, and a change to it takes a redeploy, so a page and the routes of one
 * deployment always see the same phase. A claim made in the free phase keeps
 * its library link and its downloads after the switch.
 */
import { cleanSecret } from '@/lib/clean-secret';
import { formatPrice, savingsCents, separatePriceCents, type Product } from '@/lib/guides/catalog';

/** Checkout Session and PaymentIntent metadata.type of a guide purchase. */
export const GUIDE_CHECKOUT_TYPE = 'guide';

export type GuidePhase = 'free' | 'paid';

/** 'paid' when this deployment can sell a guide (the Stripe key and the webhook secret are set), else 'free'. */
export function guidePhase(): GuidePhase {
    const stripeKey = cleanSecret(process.env.STRIPE_SECRET_KEY);
    const webhookSecret = cleanSecret(process.env.STRIPE_WEBHOOK_SECRET);
    return stripeKey && webhookSecret ? 'paid' : 'free';
}

export interface GuidePriceCopy {
    readonly phase: GuidePhase;
    /** The price as shown on a card: "Free" in the free phase, else "$29". */
    readonly price: string;
    /**
     * The price struck through beside the one shown: the catalog price beside "Free"; in the paid phase, a
     * bundle's guides bought one at a time; null for a single guide in the paid phase.
     */
    readonly listPrice: string | null;
    /** What a screen reader hears before listPrice when the note is not printed. */
    readonly listPriceLabel: string | null;
    /** The line under the price: the price after the free period, or what a bundle saves. */
    readonly note: string | null;
    /** The button label. */
    readonly cta: string;
}

/** The price block for one product in `phase`, every figure from the catalog. */
export function guidePriceCopy(product: Product, phase: GuidePhase = guidePhase()): GuidePriceCopy {
    const price = formatPrice(product.priceCents);
    if (phase === 'free') {
        return {
            phase,
            price: 'Free',
            listPrice: price,
            listPriceLabel: 'Regular price',
            note: `Free for a limited time, then ${price}`,
            cta: product.kind === 'bundle' ? 'Get them free' : 'Get it free',
        };
    }
    if (product.kind === 'bundle') {
        return {
            phase,
            price,
            listPrice: formatPrice(separatePriceCents(product)),
            listPriceLabel: 'Bought one at a time',
            note: `Save ${formatPrice(savingsCents(product))} on buying them one at a time`,
            cta: `Buy for ${price}`,
        };
    }
    return { phase, price, listPrice: null, listPriceLabel: null, note: null, cta: `Buy for ${price}` };
}
