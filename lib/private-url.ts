/**
 * Address parts that carry a credential, an id or an address, kept out of
 * error reports and analytics.
 *
 *   - Sentry: every event and transaction goes through scrubSentryEvent
 *     (sentry.server.config.ts, sentry.edge.config.ts,
 *     instrumentation-client.ts), which masks guide library tokens (in the
 *     email link path, in the library cookie, or bare) and Stripe Checkout
 *     session ids in a query string, wherever they appear in the event.
 *   - Server logs: lib/logger.ts masks the same tokens in every line it
 *     writes, so a logged row, error or address cannot carry one.
 *   - Google Analytics: lib/analytics.ts reports only allowlisted query
 *     parameters and swaps the token segment of /guides/library/<token> for
 *     its route name, so neither reaches Google.
 *   - withoutPrivateQueryParams strips the private parameters from any other
 *     address that must leave the site.
 */

/** Query parameters that carry a credential, an id or an address. */
export const PRIVATE_QUERY_PARAMS: readonly string[] = [
    'token',
    'session_id',
    'email',
    'code',
    'r',
    'access_token',
    'refresh_token',
];

/** The address without its private query parameters. Works on absolute URLs and on paths. */
export function withoutPrivateQueryParams(address: string): string {
    const queryStart = address.indexOf('?');
    if (queryStart < 0) return address;
    const hashStart = address.indexOf('#', queryStart);
    const base = address.slice(0, queryStart);
    const query = address.slice(queryStart + 1, hashStart < 0 ? undefined : hashStart);
    const hash = hashStart < 0 ? '' : address.slice(hashStart);
    const params = new URLSearchParams(query);
    for (const key of [...params.keys()]) {
        if (PRIVATE_QUERY_PARAMS.includes(key.toLowerCase())) params.delete(key);
    }
    const kept = params.toString();
    return `${base}${kept ? `?${kept}` : ''}${hash}`;
}

/** A guide library access token in the email link path. */
const LIBRARY_TOKEN_PATH = /\/guides\/library\/[0-9a-f]{48}/gi;
/** A Stripe Checkout session id in a query string. */
const SESSION_ID_PARAM = /([?&]session_id=)[^&#"'\s\\]+/gi;
/** The library cookie (lib/guides/access.ts GUIDES_COOKIE) in a cookie header. */
const LIBRARY_COOKIE = /(np_guides=)[^;&#"'\s\\]+/gi;
/**
 * A bare access token (lib/guides/access.ts newAccessToken: 48 lowercase hex
 * characters) anywhere else: a logged row, an error message, a header. No id
 * the site logs has that length (Sentry ids are 16 or 32, git and Stripe
 * hashes 40 or 64), and the guards keep a longer hex run whole. A JSON escape
 * (\n, \t and the like) before the token counts as a boundary, because a log
 * line and a Sentry event are masked as serialised JSON.
 */
const BARE_ACCESS_TOKEN = /(?:(?<![0-9a-z])|(?<=\\[nrtbf]))[0-9a-f]{48}(?![0-9a-z])/gi;

/** Text with guide library tokens, the library cookie and checkout session ids masked. */
export function maskPrivateTokens(text: string): string {
    return text
        .replace(LIBRARY_TOKEN_PATH, '/guides/library/[token]')
        .replace(LIBRARY_COOKIE, '$1[redacted]')
        .replace(BARE_ACCESS_TOKEN, '[token]')
        .replace(SESSION_ID_PARAM, '$1[redacted]');
}

/**
 * A Sentry event with those tokens masked wherever they appear (request
 * url, transaction name, spans, breadcrumbs). Events without one pass
 * through untouched.
 */
export function scrubSentryEvent<T>(event: T): T {
    try {
        const json = JSON.stringify(event);
        const masked = maskPrivateTokens(json);
        return masked === json ? event : (JSON.parse(masked) as T);
    } catch {
        return event;
    }
}
