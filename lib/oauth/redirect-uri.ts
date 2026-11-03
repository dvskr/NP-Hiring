/**
 * Redirect URIs: which ones a client may register, how a requested one is
 * matched against the registered list, and how the authorization response
 * is appended to it.
 *
 * SECURITY: a code or an error is only ever sent to a URI that matched the
 * client's registered list (design 2.4): exact string equality, except an
 * http loopback URI, whose port is ignored (RFC 8252 section 7.3) because a
 * native client listens on an ephemeral port. A fragment, a backslash,
 * whitespace, a control character or userinfo never matches.
 * tests/oauth/redirect-uri.test.ts
 */
import { DCR_MAX_REDIRECT_URI_LENGTH, MAX_REDIRECT_URI_LENGTH } from '@/lib/oauth/config';

const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Characters a redirect URI is refused for outright. Browsers read a
 * backslash as a slash and drop tabs and newlines, so a URI carrying one can
 * parse differently from how it reads.
 */
const UNSAFE_CHARACTER = /[\s\\\u0000-\u001f\u007f]/;

/** What the consent page and Connected apps say for a loopback redirect. */
export const LOOPBACK_HOST_LABEL = 'this computer';

function parseUrl(value: string): URL | null {
    try {
        return new URL(value);
    } catch {
        return null;
    }
}

/** A raw URI with no fragment, no unsafe character and no userinfo that parses, within the length cap. */
function parseCandidate(value: string, maxLength: number): URL | null {
    if (value.length === 0 || value.length > maxLength) return null;
    if (value.includes('#') || UNSAFE_CHARACTER.test(value)) return null;
    const url = parseUrl(value);
    if (!url || url.username || url.password) return null;
    return url;
}

/** An http URL on localhost, 127.0.0.1 or [::1]. An https loopback URL is not one: it matches exactly or not at all. */
export function isLoopbackRedirect(url: URL): boolean {
    return url.protocol === 'http:' && LOOPBACK_HOSTNAMES.has(url.hostname);
}

/**
 * True when `requested` may receive the authorization response for a client
 * that registered `registered` (design 2.4).
 */
export function redirectUriMatches(registered: readonly string[], requested: string): boolean {
    const url = parseCandidate(requested, MAX_REDIRECT_URI_LENGTH);
    if (!url) return false;
    if (registered.includes(requested)) return true;
    if (!isLoopbackRedirect(url)) return false;
    return registered.some((candidate) => {
        const entry = parseCandidate(candidate, MAX_REDIRECT_URI_LENGTH);
        return (
            entry !== null &&
            isLoopbackRedirect(entry) &&
            entry.hostname === url.hostname &&
            entry.pathname === url.pathname &&
            entry.search === url.search
        );
    });
}

/**
 * A redirect URI a client may register through POST /oauth/register: at most
 * 512 characters, no fragment, and either https on an allowed host (no port)
 * or http loopback on any port.
 */
export function isAllowedDcrRedirectUri(value: string, allowedHosts: readonly string[]): boolean {
    const url = parseCandidate(value, DCR_MAX_REDIRECT_URI_LENGTH);
    if (!url) return false;
    if (isLoopbackRedirect(url)) return true;
    return url.protocol === 'https:' && url.port === '' && allowedHosts.includes(url.hostname);
}

/**
 * A redirect URI a Client ID Metadata Document may list: https on any host
 * (the document itself comes from an allowlisted host) or http loopback.
 */
export function isAcceptableCimdRedirectUri(value: string): boolean {
    const url = parseCandidate(value, MAX_REDIRECT_URI_LENGTH);
    return url !== null && (url.protocol === 'https:' || isLoopbackRedirect(url));
}

/** The host a redirect URI sends the user to, or "this computer" for a loopback one. */
export function redirectHostLabel(redirectUri: string): string {
    const url = parseUrl(redirectUri);
    if (!url) return '';
    return LOOPBACK_HOSTNAMES.has(url.hostname) ? LOOPBACK_HOST_LABEL : url.hostname;
}

/**
 * The redirect URI with `query` appended, keeping any query it already has
 * byte for byte (design 2.6). Matched URIs never carry a fragment.
 */
export function appendQuery(uri: string, query: string): string {
    if (!query) return uri;
    if (!uri.includes('?')) return `${uri}?${query}`;
    return uri.endsWith('?') || uri.endsWith('&') ? `${uri}${query}` : `${uri}&${query}`;
}
