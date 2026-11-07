/**
 * POST /api/guides/claim  { product, email, newsletter? }  ->  { ok: true, emailed, guides, inLibrary }
 *
 * The launch promo's way to the guides: until config.promoEndsAt every
 * product, bundles included, is free to claim with an email address
 * (lib/guides/phase.ts#isGuideClaimOpen). Stripe is never called.
 *
 *   409 PROMO_ENDED  the promo is over: guides are bought through
 *                    POST /api/guides/checkout from then on
 *   400              a malformed body or an unknown product
 *   429              5 claims a minute from this IP, or 6 new claims an hour
 *                    for this email address from any IP
 *                    (RATE_LIMITS.guideClaim, guideClaimPerEmail). A claim the
 *                    address already holds never counts: it is re-sent at most
 *                    once per 10 minutes instead, so nobody can lock an owner
 *                    out of their own guides by spending the address's limit.
 *
 * lib/guides/fulfill.ts#fulfillPromoClaim records the claim (source 'promo',
 * amount 0, no Stripe ids, the product's own guides and never the checkout
 * add-on) and sends the delivery email. When the email already holds a claim
 * with every guide of the product, that claim is re-used instead and its email
 * re-sent at most once per 10 minutes.
 *
 * The guides reach a browser through the emailed link, which proves the
 * reader owns the address. Only a reader signed in with that confirmed
 * address gets them in this browser's library at once (inLibrary). So the
 * answer is the same whether or not the address held a claim before, and a
 * claim made with someone else's address gives this browser nothing.
 *
 * `newsletter: true` (an unticked box on the form) also opts the address in
 * to the newsletter (lib/newsletter.ts): as the public signup does for the
 * address's signed-in owner, and for anyone else only when the site has
 * never seen the address.
 */
import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { checkRateLimit, rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { verifyCsrf } from '@/lib/csrf';
import { subscribeNewAddressToNewsletter, subscribeToNewsletter } from '@/lib/newsletter';
import { getProduct, isGuideSlug, productGuides } from '@/lib/guides/catalog';
import { GUIDES_COOKIE, addToLibraryCookie, libraryCookieOptions } from '@/lib/guides/access';
import { isGuideClaimOpen } from '@/lib/guides/phase';
import { emailDelivered, findReusableClaim, fulfillPromoClaim } from '@/lib/guides/fulfill';

/** The email lead source of a newsletter opt-in made on the claim form. */
const GUIDE_CLAIM_NEWSLETTER_SOURCE = 'guide_claim';

const BODY = z.object({
    product: z.string().min(1).max(64),
    email: z.string().trim().toLowerCase().max(254).email(),
    newsletter: z.boolean().optional(),
});

function noStore(res: NextResponse): NextResponse {
    res.headers.set('Cache-Control', 'private, no-store');
    return res;
}

/**
 * 429 when this address has been claimed for RATE_LIMITS.guideClaimPerEmail
 * times this hour, from any IP: each claim can send a delivery email, and the
 * address is not verified. Keyed on a hash, so the limiter never stores it.
 */
async function emailLimited(email: string): Promise<NextResponse | null> {
    const key = `ratelimit:guides:claim-email:${createHash('sha256').update(email).digest('hex').slice(0, 32)}`;
    const { success, reset } = await checkRateLimit(key, RATE_LIMITS.guideClaimPerEmail);
    if (success) return null;
    const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
    return NextResponse.json(
        { error: 'Too many requests for this email address. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    );
}

interface SignedInReader {
    readonly userId: string;
    /** The account's address, lowercased, when it is confirmed. */
    readonly confirmedEmail: string | null;
}

/** The signed-in reader, if any. Claiming never requires an account. */
async function signedInReader(): Promise<SignedInReader | null> {
    try {
        const supabase = await createClient();
        const { data } = await supabase.auth.getUser();
        const user = data.user;
        if (!user) return null;
        const confirmed = user.email && user.email_confirmed_at ? user.email.trim().toLowerCase() : null;
        return { userId: user.id, confirmedEmail: confirmed };
    } catch {
        return null;
    }
}

/**
 * The newsletter box. The address's signed-in owner opts in as on the public
 * signup; anyone else can only subscribe an address the site has never seen,
 * so a claim can never re-subscribe someone who unsubscribed. Never fails
 * the claim: the guides are what the reader asked for.
 */
async function optInIfAsked(asked: boolean | undefined, email: string, ownsAddress: boolean): Promise<void> {
    if (!asked) return;
    try {
        if (ownsAddress) await subscribeToNewsletter(email, GUIDE_CLAIM_NEWSLETTER_SOURCE);
        else await subscribeNewAddressToNewsletter(email, GUIDE_CLAIM_NEWSLETTER_SOURCE);
    } catch (error) {
        logger.error('Newsletter opt-in on a guide claim failed', error);
    }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
    const csrfError = verifyCsrf(req);
    if (csrfError) return csrfError;

    const limited = await rateLimit(req, 'guides:claim', RATE_LIMITS.guideClaim);
    if (limited) return limited;

    const now = new Date();
    if (!isGuideClaimOpen(now)) {
        return noStore(NextResponse.json({ error: 'This offer has ended.', code: 'PROMO_ENDED' }, { status: 409 }));
    }

    let raw: unknown;
    try {
        raw = await req.json();
    } catch {
        return noStore(NextResponse.json({ error: 'Invalid request.' }, { status: 400 }));
    }
    const parsed = BODY.safeParse(raw);
    if (!parsed.success) {
        const badEmail = parsed.error.issues.some((issue) => issue.path[0] === 'email');
        return noStore(NextResponse.json({ error: badEmail ? 'Enter a valid email address.' : 'Invalid request.' }, { status: 400 }));
    }
    const { email, newsletter } = parsed.data;

    const product = getProduct(parsed.data.product);
    if (!product) return noStore(NextResponse.json({ error: 'That guide is not in the store.' }, { status: 400 }));

    try {
        const existing = await findReusableClaim(product, email);
        if (!existing) {
            const tooMany = await emailLimited(email);
            if (tooMany) return noStore(tooMany);
        }
        const reader = await signedInReader();
        const result = await fulfillPromoClaim(product, email, reader?.userId ?? null, now, existing);
        const ownsAddress = reader?.confirmedEmail === email;
        await optInIfAsked(newsletter, email, ownsAddress);

        const res = NextResponse.json({
            ok: true,
            emailed: emailDelivered(result.delivery),
            guides: productGuides(product).filter(isGuideSlug),
            inLibrary: ownsAddress,
        });
        if (ownsAddress) {
            res.cookies.set(
                GUIDES_COOKIE,
                addToLibraryCookie(req.cookies.get(GUIDES_COOKIE)?.value, result.purchase.accessToken),
                libraryCookieOptions(),
            );
        }
        return noStore(res);
    } catch (error) {
        logger.error('Guide claim failed', error, { product: product.slug });
        return noStore(NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 }));
    }
}
