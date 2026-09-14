/**
 * Validated login return target for the admin layout guard (P10
 * platform-routing-db #6).
 *
 * The candidate is the middleware-forwarded request pathname
 * (REQUEST_PATHNAME_HEADER, always overwritten by middleware.ts). Only a
 * plain `/admin` or `/admin/<segments>` path survives. Anything else
 * (missing, protocol-relative, backslashes, dot segments, control
 * characters, a query or fragment, a non-admin path) falls back to `/admin`,
 * so the redirect can never point off-site or outside the console. The login
 * page additionally re-validates `?next=` with safeInternalPath.
 */

/** Header middleware.ts sets on every forwarded request. */
export const REQUEST_PATHNAME_HEADER = 'x-np-request-pathname';

const ADMIN_FALLBACK = '/admin';

const ADMIN_PATH_PATTERN = /^\/admin(?:\/[A-Za-z0-9_~%-][A-Za-z0-9._~%-]*)*$/;

export function adminReturnPath(candidate: string | null | undefined): string {
    if (!candidate) return ADMIN_FALLBACK;
    if (!ADMIN_PATH_PATTERN.test(candidate)) return ADMIN_FALLBACK;
    return candidate;
}
