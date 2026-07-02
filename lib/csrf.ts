/**
 * CSRF Protection — Origin Header Verification
 *
 * Verifies that mutation requests (POST/PUT/PATCH/DELETE) originate
 * from our own domain by checking the Origin or Referer header.
 * This blocks cross-site form submissions and fetch() attacks.
 */

import { NextRequest, NextResponse } from 'next/server';
import { brand } from '@/config/brand';

// First-party origins derived from brand config so a fork on a new domain
// doesn't silently 403 every form POST. NEXT_PUBLIC_BASE_URL covers
// preview/staging deployments that differ from the canonical domain.
const ALLOWED_ORIGINS = [
    ...new Set(
        [
            brand.baseUrl,
            `https://www.${brand.domain}`,
            `https://dev.${brand.domain}`,
            process.env.NEXT_PUBLIC_BASE_URL,
            'http://localhost:3000',
            'http://localhost:3001',
        ].filter((origin): origin is string => Boolean(origin))
    ),
];

/**
 * Call at the top of any state-changing API handler (POST/PUT/PATCH/DELETE).
 * Returns null if the request is safe, or a 403 Response if CSRF is detected.
 *
 * Skips checking for:
 * - Requests with Bearer tokens (API/extension calls)
 * - Webhook endpoints (Stripe, etc.) — they have their own signature verification
 */
export function verifyCsrf(request: NextRequest): NextResponse | null {
    // Skip for non-browser clients (Bearer auth = API/extension)
    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
        return null;
    }

    const origin = request.headers.get('origin');
    const referer = request.headers.get('referer');

    // If neither header is present, the request likely came from a non-browser client
    // (e.g., Postman, curl, server-to-server). Allow these for now as they
    // can't carry session cookies anyway (SameSite protection).
    if (!origin && !referer) {
        return null;
    }

    // Check Origin header first (more reliable)
    if (origin) {
        if (ALLOWED_ORIGINS.includes(origin)) {
            return null;
        }
        return NextResponse.json(
            { error: 'Forbidden: cross-origin request blocked' },
            { status: 403 }
        );
    }

    // Fall back to Referer header
    if (referer) {
        try {
            const refererOrigin = new URL(referer).origin;
            if (ALLOWED_ORIGINS.includes(refererOrigin)) {
                return null;
            }
        } catch {
            // malformed referer
        }
        return NextResponse.json(
            { error: 'Forbidden: cross-origin request blocked' },
            { status: 403 }
        );
    }

    return null;
}
