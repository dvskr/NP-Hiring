/**
 * GET /guides/library/<token>: the link in the guides email.
 *
 * Adds the purchase to this browser's library cookie and redirects to the
 * clean /guides/library page, so the token never sits in an address that
 * analytics, the browser history or a referrer header would carry. The
 * token is a 192-bit random bearer credential, which is why it travels only
 * in this one email link. Tokens are lowercase hex, which survives the
 * middleware's path lowercasing.
 */
import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { GUIDES_COOKIE, addToLibraryCookie, isAccessToken, libraryCookieOptions } from '@/lib/guides/access';
import { purchaseExists } from '@/lib/guides/library';

function redirect(req: NextRequest, to: string): NextResponse {
    const res = NextResponse.redirect(new URL(to, req.nextUrl.origin), 303);
    res.headers.set('Cache-Control', 'private, no-store');
    res.headers.set('Referrer-Policy', 'no-referrer');
    res.headers.set('X-Robots-Tag', 'noindex, nofollow');
    return res;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }): Promise<NextResponse> {
    const limited = await rateLimit(req, 'guides:library-link', RATE_LIMITS.guideAccess);
    if (limited) return limited;

    const { token } = await params;
    if (!isAccessToken(token)) return redirect(req, '/guides/library?error=link');

    let exists: boolean;
    try {
        exists = await purchaseExists(token);
    } catch (error) {
        logger.error('[GuideLibrary] Could not look up a library link', error);
        return redirect(req, '/guides/library?error=retry');
    }
    if (!exists) return redirect(req, '/guides/library?error=link');

    const res = redirect(req, '/guides/library');
    res.cookies.set(GUIDES_COOKIE, addToLibraryCookie(req.cookies.get(GUIDES_COOKIE)?.value, token), libraryCookieOptions());
    return res;
}
