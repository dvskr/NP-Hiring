/**
 * CSRF Protection — Origin Header Verification
 *
 * Verifies that mutation requests (POST/PUT/PATCH/DELETE) originate
 * from our own domain by checking the Origin or Referer header.
 * This blocks cross-site form submissions and fetch() attacks.
 *
 * B98 design note (2026-07-18): protection is enforced CENTRALLY from
 * middleware.ts via `enforceApiCsrf()` for every mutation under /api/*,
 * instead of hand-adding `verifyCsrf()` to ~90 route handlers. Rationale:
 *   - one enforcement point → new routes are protected by default;
 *   - zero churn across route files (lowest-risk mechanical change);
 *   - identical acceptance rules to the existing per-route `verifyCsrf()`
 *     call sites (which remain in place as defense in depth).
 * Exemptions: Bearer-token requests (extension JWT, cron secrets) and
 * signature-verified endpoints (/api/webhooks/*, /api/inngest) — each of
 * those carries its own non-cookie authentication, so browser-cookie CSRF
 * does not apply.
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

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * API paths exempt from the middleware-level CSRF gate. Each verifies its
 * caller with a non-cookie credential, so the Origin check is meaningless
 * for them (senders are servers, not browsers):
 *   /api/webhooks/* — Stripe / Resend signature verification
 *   /api/inngest    — Inngest request signing (INNGEST_SIGNING_KEY)
 * Cron routes are deliberately NOT listed: Vercel cron sends a Bearer token
 * (skipped below) and admin manual triggers are same-origin browser calls
 * that pass the Origin check — so they keep CSRF protection for free.
 */
const CSRF_EXEMPT_API_PREFIXES = ['/api/webhooks', '/api/inngest'];

function isCsrfExemptPath(pathname: string): boolean {
    return CSRF_EXEMPT_API_PREFIXES.some(
        (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
    );
}

/**
 * True when `origin` is first-party. Beyond the static allowlist, an Origin
 * that exactly matches the origin actually being served (request.nextUrl)
 * is accepted — browsers set the Origin header themselves, so a page on
 * another site can never present ours. This keeps Vercel preview
 * deployments (URLs not in the static list) working without widening the
 * policy.
 */
function isAllowedOrigin(origin: string, request: NextRequest): boolean {
    if (ALLOWED_ORIGINS.includes(origin)) return true;
    return origin === request.nextUrl.origin;
}

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
        if (isAllowedOrigin(origin, request)) {
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
            if (isAllowedOrigin(refererOrigin, request)) {
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

/**
 * Middleware-level CSRF gate (B98). Applies `verifyCsrf` to every
 * state-changing request under /api/* except signature-verified endpoints.
 * Returns null when the request may proceed, or a 403 NextResponse.
 *
 * Safe-by-construction paths through this gate:
 * - GET/HEAD/OPTIONS (incl. CORS preflight): not mutations → skipped
 * - Extension / API clients: send `Authorization: Bearer …` → skipped
 * - Server-to-server callers (Vercel cron, Stripe CLI, RFC 8058
 *   List-Unsubscribe POSTs): no Origin/Referer headers → allowed (they
 *   cannot carry first-party session cookies cross-site anyway)
 * - Same-origin browser traffic (incl. preview deployments): Origin
 *   matches allowlist or the served origin → allowed
 */
export function enforceApiCsrf(request: NextRequest): NextResponse | null {
    const pathname = request.nextUrl.pathname;
    if (!pathname.startsWith('/api/')) return null;
    if (!MUTATION_METHODS.has(request.method.toUpperCase())) return null;
    if (isCsrfExemptPath(pathname)) return null;
    return verifyCsrf(request);
}
