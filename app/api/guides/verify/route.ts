/**
 * GET /api/guides/verify?session_id=cs_...
 *
 * Used by /guides/success. Confirms the Checkout session with Stripe and
 * records the purchase if the webhook has not yet (lib/guides/fulfill.ts is
 * safe to run twice). When the request comes from the browser that started
 * the checkout (the np_guide_checkout cookie), it also adds the purchase to
 * that browser's library cookie.
 *
 * It never sends the delivery email: the webhook does, and Stripe retries the
 * webhook until the send succeeds. `emailed` says whether it has gone out
 * yet; the success page asks again until it has.
 */
import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { logger } from '@/lib/logger';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import {
    GUIDE_CHECKOUT_COOKIE,
    GUIDES_COOKIE,
    addToLibraryCookie,
    isCheckoutSessionId,
    libraryCookieOptions,
    parseCheckoutCookie,
} from '@/lib/guides/access';
import { GUIDE_CHECKOUT_TYPE, emailDelivered, fulfillGuideSession } from '@/lib/guides/fulfill';

function noStore(res: NextResponse): NextResponse {
    res.headers.set('Cache-Control', 'private, no-store');
    return res;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
    const limited = await rateLimit(req, 'guides:verify', RATE_LIMITS.guideAccess);
    if (limited) return limited;

    const sessionId = req.nextUrl.searchParams.get('session_id') ?? '';
    if (!isCheckoutSessionId(sessionId)) {
        return noStore(NextResponse.json({ error: 'Missing or invalid session.' }, { status: 400 }));
    }

    const stripe = getStripe();
    if (!stripe) return noStore(NextResponse.json({ error: 'Payments are unavailable right now.' }, { status: 503 }));

    let session: Stripe.Checkout.Session;
    try {
        session = await stripe.checkout.sessions.retrieve(sessionId);
    } catch {
        return noStore(NextResponse.json({ error: 'We could not find that checkout.' }, { status: 404 }));
    }
    if (session.metadata?.type !== GUIDE_CHECKOUT_TYPE) {
        return noStore(NextResponse.json({ error: 'We could not find that checkout.' }, { status: 404 }));
    }
    if (session.payment_status !== 'paid') {
        return noStore(NextResponse.json({ paid: false, error: 'Payment was not completed.' }, { status: 402 }));
    }

    try {
        const result = await fulfillGuideSession(session, { sendEmail: false });
        if (result.status !== 'fulfilled') {
            logger.error('Paid guide session could not be fulfilled', null, { sessionId, status: result.status });
            return noStore(NextResponse.json({ error: 'Your payment went through, but we could not prepare your guides. Please contact support.' }, { status: 500 }));
        }
        const { purchase } = result;
        const sameBrowser = parseCheckoutCookie(req.cookies.get(GUIDE_CHECKOUT_COOKIE)?.value).includes(session.id);
        const res = NextResponse.json({
            paid: true,
            product: purchase.productSlug,
            guides: purchase.guideSlugs,
            amountCents: session.amount_total ?? purchase.amountCents,
            emailed: emailDelivered(result.delivery),
            inLibrary: sameBrowser,
        });
        if (sameBrowser) {
            res.cookies.set(
                GUIDES_COOKIE,
                addToLibraryCookie(req.cookies.get(GUIDES_COOKIE)?.value, purchase.accessToken),
                libraryCookieOptions(),
            );
        }
        return noStore(res);
    } catch (error) {
        logger.error('Guide verification failed', error, { sessionId });
        return noStore(NextResponse.json({ error: 'Something went wrong preparing your guides. Please refresh in a moment.' }, { status: 500 }));
    }
}
