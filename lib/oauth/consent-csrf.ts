/**
 * The consent page's CSRF token (design 2.6).
 *
 * The page signs the signed-in user, the time and the exact authorization
 * parameters it showed; the decision route accepts Allow or Cancel only with
 * a token that verifies for its own session user and the parameters in its
 * body, issued in the last 10 minutes. A page on another site cannot read
 * the token, a token from one account does not work for another, and the
 * parameters cannot be swapped after the user saw them (another redirect
 * URI, wider scopes).
 *
 * Format: `<issuedAt seconds>.<base64url HMAC-SHA256>` keyed with
 * MCP_OAUTH_SIGNING_SECRET. The MAC input starts with "consent:" so it can
 * never collide with an access token signature, whose input starts with a
 * base64url JWT header. tests/oauth/consent-csrf.test.ts
 */
import { AUTHORIZE_PARAM_KEYS, type AuthorizeParams } from '@/lib/oauth/authorize-params';
import { CONSENT_TOKEN_TTL_SECONDS, oauthSigningSecret } from '@/lib/oauth/config';
import { constantTimeEqual, hmacSha256 } from '@/lib/oauth/crypto';

const DOMAIN = 'consent:';
const TOKEN_SHAPE = /^(\d{1,12})\.([A-Za-z0-9_-]{43})$/;
/** A token stamped this far in the future still verifies: instances' clocks differ by a little. */
const CLOCK_SKEW_SECONDS = 60;

function consentMac(secret: string, userId: string, issuedAt: number, params: AuthorizeParams): string {
    // JSON of fixed positions: no value can shift into a neighbour's place.
    const fields = AUTHORIZE_PARAM_KEYS.map((key) => params[key] ?? null);
    return hmacSha256(secret, `${DOMAIN}${JSON.stringify([userId, issuedAt, fields])}`);
}

/** A token for this user and these parameters. Throws without a signing secret (callers check first). */
export function createConsentToken(userId: string, params: AuthorizeParams, now: number = Date.now()): string {
    const secret = oauthSigningSecret();
    if (!secret) throw new Error('MCP_OAUTH_SIGNING_SECRET is missing or shorter than 32 characters');
    const issuedAt = Math.floor(now / 1000);
    return `${issuedAt}.${consentMac(secret, userId, issuedAt, params)}`;
}

/** True when the token was issued by this server for this user and these parameters in the last 10 minutes. */
export function verifyConsentToken(token: unknown, userId: string, params: AuthorizeParams, now: number = Date.now()): boolean {
    const secret = oauthSigningSecret();
    if (!secret || typeof token !== 'string') return false;
    const match = TOKEN_SHAPE.exec(token);
    if (!match) return false;
    const issuedAt = Number(match[1]);
    const age = Math.floor(now / 1000) - issuedAt;
    if (age < -CLOCK_SKEW_SECONDS || age > CONSENT_TOKEN_TTL_SECONDS) return false;
    return constantTimeEqual(consentMac(secret, userId, issuedAt, params), match[2]);
}
