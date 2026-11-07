/**
 * POST /api/guides/checkout  { product, addOn? }  ->  { url, amountCents }
 *
 * Opens a Stripe Checkout session for one product from the guides store,
 * from config.promoEndsAt on. Until then every guide is claimed free
 * (POST /api/guides/claim) and this route never calls Stripe. Refused, in
 * this order, by lib/guides/phase.ts#guideSaleClosedReason:
 *   503 PAID_POSTING_DISABLED  ENABLE_PAID_POSTING is off
 *   503 STRIPE_NOT_CONFIGURED  the Stripe key or the webhook secret is
 *                              missing: without the secret the webhook could
 *                              not record the sale
 *   409 PROMO_ACTIVE           the launch promo is still running
 *
 * Creates nothing in the database: the purchase is recorded by
 * lib/guides/fulfill.ts once Stripe reports the session paid, keyed on the
 * session id. Amounts come from lib/guides/catalog.ts, never the request.
 *
 * Signing in is optional. A signed-in buyer's email is prefilled and their
 * user id is kept on the purchase. The GA ids are captured as on every
 * checkout (lib/analytics-server.ts#gaCheckoutMetadata), empty without
 * analytics consent.
 */
import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { z } from 'zod';
import { getStripe } from '@/lib/stripe';
import { getBaseUrl } from '@/lib/env';
import { config } from '@/lib/config';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { verifyCsrf } from '@/lib/csrf';
import { gaCheckoutMetadata } from '@/lib/analytics-server';
import { ADD_ON, GUIDES, addOnEligible, getProduct, productGuides, type Product } from '@/lib/guides/catalog';
import { GUIDE_CHECKOUT_COOKIE, addToCheckoutCookie, checkoutCookieOptions } from '@/lib/guides/access';
import { GUIDE_CHECKOUT_TYPE, guideSaleClosedReason, type GuideSaleClosedReason } from '@/lib/guides/phase';
import { ADD_ON_METADATA_VALUE } from '@/lib/guides/fulfill';

const BODY = z.object({
    product: z.string().min(1).max(64),
    addOn: z.boolean().optional(),
});

function productLineItem(product: Product): Stripe.Checkout.SessionCreateParams.LineItem {
    const description =
        product.kind === 'guide'
            ? `${product.subtitle}. ${product.pages}-page PDF, the latest edition on every download.`
            : `Includes ${productGuides(product).map((slug) => GUIDES[slug].title).join(', ')}. PDF downloads, the latest edition on every download.`;
    return {
        quantity: 1,
        price_data: {
            currency: 'usd',
            unit_amount: product.priceCents,
            product_data: { name: product.title, description },
        },
    };
}

function addOnLineItem(): Stripe.Checkout.SessionCreateParams.LineItem {
    const guide = GUIDES[ADD_ON.guide];
    return {
        quantity: 1,
        price_data: {
            currency: 'usd',
            unit_amount: ADD_ON.priceCents,
            product_data: { name: `Add-on: ${guide.title}`, description: `${guide.pages}-page PDF.` },
        },
    };
}

/** The signed-in buyer, if any. Checkout never requires an account. */
async function optionalUser(): Promise<{ id: string; email: string | null } | null> {
    try {
        const supabase = await createClient();
        const { data } = await supabase.auth.getUser();
        return data.user ? { id: data.user.id, email: data.user.email ?? null } : null;
    } catch {
        return null;
    }
}

/** The answer while guides cannot be bought (see the file header). */
function saleClosed(reason: GuideSaleClosedReason): NextResponse {
    if (reason === 'PROMO_ACTIVE') {
        return NextResponse.json({ error: `The guides go on sale on ${config.ladderStartsLabel}.`, code: reason }, { status: 409 });
    }
    if (reason === 'STRIPE_NOT_CONFIGURED') {
        logger.error('Guide checkout attempted but Stripe or its webhook secret is not configured', null);
    }
    return NextResponse.json({ error: 'Checkout is unavailable right now. Please try again later.', code: reason }, { status: 503 });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
    const csrfError = verifyCsrf(req);
    if (csrfError) return csrfError;

    const limited = await rateLimit(req, 'guides:checkout', RATE_LIMITS.guideCheckout);
    if (limited) return limited;

    const closed = guideSaleClosedReason(new Date());
    const stripe = closed ? null : getStripe();
    if (closed || !stripe) return saleClosed(closed ?? 'STRIPE_NOT_CONFIGURED');

    let body: z.infer<typeof BODY>;
    try {
        body = BODY.parse(await req.json());
    } catch {
        return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
    }

    const product = getProduct(body.product);
    if (!product) return NextResponse.json({ error: 'That guide is not in the store.' }, { status: 400 });
    const withAddOn = body.addOn === true && addOnEligible(product);

    const user = await optionalUser();

    try {
        const baseUrl = getBaseUrl().replace(/\/$/, '');
        const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            // Card only: a completed session is then always paid, so a
            // delayed payment method can never leave a purchase waiting.
            payment_method_types: ['card'],
            customer_email: user?.email ?? undefined,
            // No promotion codes: any unrestricted code in the account would
            // apply here. Turn on only with codes limited to guide products.
            line_items: withAddOn ? [productLineItem(product), addOnLineItem()] : [productLineItem(product)],
            metadata: {
                type: GUIDE_CHECKOUT_TYPE,
                product: product.slug,
                addOn: withAddOn ? ADD_ON_METADATA_VALUE : '',
                userId: user?.id ?? '',
                ...gaCheckoutMetadata(req),
            },
            // Lets a refund or dispute that reaches the webhook before the
            // purchase row recognise the payment as a guide sale.
            payment_intent_data: { metadata: { type: GUIDE_CHECKOUT_TYPE, product: product.slug } },
            success_url: `${baseUrl}/guides/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${baseUrl}/guides/${product.slug}`,
        });

        if (!session.url) {
            logger.error('Stripe returned a guide session with no URL', null, { sessionId: session.id });
            return NextResponse.json({ error: 'Could not start checkout. Please try again.' }, { status: 502 });
        }

        // amountCents is for the button's GA begin_checkout; Stripe charges the line items.
        const amountCents = product.priceCents + (withAddOn ? ADD_ON.priceCents : 0);
        const res = NextResponse.json({ url: session.url, amountCents });
        // Ties the success page to this browser: only it receives the
        // library cookie straight away. Anyone else holding the session id
        // learns that it was paid, and the buyer gets the link by email.
        res.cookies.set(
            GUIDE_CHECKOUT_COOKIE,
            addToCheckoutCookie(req.cookies.get(GUIDE_CHECKOUT_COOKIE)?.value, session.id),
            checkoutCookieOptions(),
        );
        return res;
    } catch (error) {
        logger.error('Failed to create a guide checkout', error, { product: product.slug });
        return NextResponse.json({ error: 'Could not start checkout. Please try again.' }, { status: 500 });
    }
}
