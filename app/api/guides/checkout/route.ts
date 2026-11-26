/**
 * POST /api/guides/checkout  { product, addOn? }  ->  { url, amountCents }
 *
 * Opens a Stripe Checkout session for one product from the guides store,
 * once this deployment can take the payment: lib/guides/phase.ts#guidePhase
 * is 'paid' when the Stripe key and the webhook secret are both set, and the
 * pages show a Buy button only then. ENABLE_PAID_POSTING and the posting
 * promo play no part. Otherwise every guide is claimed free
 * (POST /api/guides/claim) and this route refuses before calling Stripe:
 *   503 STRIPE_NOT_CONFIGURED  the Stripe key or the webhook secret is
 *                              missing: without the secret the webhook could
 *                              not record the sale
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
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { verifyCsrf } from '@/lib/csrf';
import { gaCheckoutMetadata } from '@/lib/analytics-server';
import { GUIDES, addOnEligible, addOnFor, getProduct, productGuides, type Product } from '@/lib/guides/catalog';
import { GUIDE_CHECKOUT_COOKIE, addToCheckoutCookie, checkoutCookieOptions } from '@/lib/guides/access';
import { GUIDE_CHECKOUT_TYPE, guidePhase } from '@/lib/guides/phase';
import { addOnMetadataValue } from '@/lib/guides/fulfill';

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

/** The add-on of the product's own edition (lib/guides/catalog.ts#addOnFor). */
function addOnLineItem(product: Product): Stripe.Checkout.SessionCreateParams.LineItem {
    const addOn = addOnFor(product);
    const guide = GUIDES[addOn.guide];
    return {
        quantity: 1,
        price_data: {
            currency: 'usd',
            unit_amount: addOn.priceCents,
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

/**
 * The answer while guides cannot be bought (see the file header). The pages
 * offer the free claim then, so the reader is sent back to it.
 */
function saleClosed(): NextResponse {
    logger.warn('Guide checkout attempted while the guides are free to claim (Stripe or its webhook secret is not set)');
    return NextResponse.json(
        { error: 'The guides are free to claim right now. Refresh the page to claim one.', code: 'STRIPE_NOT_CONFIGURED' },
        { status: 503 },
    );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
    const csrfError = verifyCsrf(req);
    if (csrfError) return csrfError;

    const limited = await rateLimit(req, 'guides:checkout', RATE_LIMITS.guideCheckout);
    if (limited) return limited;

    const stripe = guidePhase() === 'paid' ? getStripe() : null;
    if (!stripe) return saleClosed();

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
            line_items: withAddOn ? [productLineItem(product), addOnLineItem(product)] : [productLineItem(product)],
            metadata: {
                type: GUIDE_CHECKOUT_TYPE,
                product: product.slug,
                addOn: withAddOn ? addOnMetadataValue(product) : '',
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
        const amountCents = product.priceCents + (withAddOn ? addOnFor(product).priceCents : 0);
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
