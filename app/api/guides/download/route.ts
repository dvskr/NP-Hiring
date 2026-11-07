/**
 * GET /api/guides/download?guide=<slug>
 *
 * Authorised by the library cookie (np_guides), never by the URL. Counts the
 * download, then redirects to a 60-second signed link for the PDF. Every
 * refusal goes back to /guides/library with a reason the page explains.
 */
import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { isGuideSlug } from '@/lib/guides/catalog';
import { GUIDES_COOKIE, parseLibraryCookie } from '@/lib/guides/access';
import { authorizeDownload, releaseDownload, type DownloadDecision } from '@/lib/guides/library';
import { signedGuideUrl } from '@/lib/guides/storage';

function redirect(req: NextRequest, to: string): NextResponse {
    const res = NextResponse.redirect(new URL(to, req.nextUrl.origin), 302);
    res.headers.set('Cache-Control', 'private, no-store');
    res.headers.set('Referrer-Policy', 'no-referrer');
    res.headers.set('X-Robots-Tag', 'noindex, nofollow');
    return res;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
    const limited = await rateLimit(req, 'guides:download', RATE_LIMITS.guideAccess);
    if (limited) return limited;

    // Downloads start from the library page. A navigation from another site
    // carries the lax library cookie too, so without this a hostile page
    // could spend a reader's downloads by sending them here repeatedly.
    if (req.headers.get('sec-fetch-site') === 'cross-site') return redirect(req, '/guides/library');

    const guide = req.nextUrl.searchParams.get('guide') ?? '';
    if (!isGuideSlug(guide)) return redirect(req, '/guides/library?error=unknown');

    const tokens = parseLibraryCookie(req.cookies.get(GUIDES_COOKIE)?.value);
    let decision: DownloadDecision;
    try {
        decision = await authorizeDownload(tokens, guide);
    } catch (error) {
        logger.error('Could not authorise a guide download', error, { guide });
        return redirect(req, '/guides/library?error=unavailable');
    }
    if (!decision.ok) return redirect(req, `/guides/library?error=${decision.reason}`);

    const url = await signedGuideUrl(guide);
    if (!url) {
        // The reader got nothing, so the attempt must not count against them.
        await releaseDownload(decision.purchaseId).catch((error: unknown) => {
            logger.error('Could not release a failed guide download', error, { purchaseId: decision.purchaseId });
        });
        return redirect(req, '/guides/library?error=unavailable');
    }
    return redirect(req, url);
}
