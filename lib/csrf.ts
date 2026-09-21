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
    if (origin === request.nextUrl.origin) return true;
    return isLoopbackSameHostOrigin(origin, request.headers.get('host'));
}

/**
 * Loopback hostnames a local server is reached on. `localhost` is already in
 * the static allowlist; 127.0.0.1 and [::1] are the same machine under a
 * different spelling.
 */
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Hostname part of a Host header value ("127.0.0.1:3000" -> "127.0.0.1"). */
export function hostnameFromHostHeader(host: string | null | undefined): string | null {
    if (!host) return null;
    const trimmed = host.trim().toLowerCase();
    if (!trimmed) return null;
    if (trimmed.startsWith('[')) {
        const close = trimmed.indexOf(']');
        return close > 0 ? trimmed.slice(0, close + 1) : null;
    }
    const colon = trimmed.indexOf(':');
    return colon === -1 ? trimmed : trimmed.slice(0, colon);
}

export function isLoopbackHostname(hostname: string | null | undefined): boolean {
    return hostname ? LOOPBACK_HOSTNAMES.has(hostname.toLowerCase()) : false;
}

/**
 * P10 platform-routing-db #7: under `next start` request.nextUrl.origin is
 * always http://localhost:<port>, so a browser on http://127.0.0.1:3000 got
 * 403 "cross-origin request blocked" on every mutation. Accept an Origin
 * ONLY when it names a loopback host AND is exactly the host the request was
 * sent to (the Host header). This never widens production: a deployed site's
 * requests carry its public Host, and a cross-site attacker cannot make a
 * victim's browser send a loopback Host to that site, so a loopback Origin
 * there still fails. Scheme must be http or https; anything else fails closed.
 */
export function isLoopbackSameHostOrigin(origin: string, hostHeader: string | null | undefined): boolean {
    let parsed: URL;
    try {
        parsed = new URL(origin);
    } catch {
        return false;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (parsed.origin !== origin) return false;
    if (!isLoopbackHostname(parsed.hostname)) return false;
    const host = hostHeader?.trim().toLowerCase();
    if (!host) return false;
    return parsed.host === host;
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
