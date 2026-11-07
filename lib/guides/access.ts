import { randomBytes } from 'node:crypto';

/**
 * How a reader reaches their guides without an account.
 *
 * Each purchase or promo claim has a random access token. The delivery email
 * links to /guides/library/<token>, a route handler that adds the token to
 * the GUIDES_COOKIE and redirects to the clean /guides/library page, so the
 * token never sits in an address that analytics tags, the browser history or
 * a referrer header would carry. The success page (after a checkout) and the
 * claim route (during the launch promo) set the same cookie. Downloads are
 * authorised by the cookie, never by a URL.
 *
 * Tokens are lowercase hex because middleware lowercases every page path.
 */

export const GUIDES_COOKIE = 'np_guides';
/** httpOnly cookie set when a guide checkout starts: ties the success page to the browser that paid. */
export const GUIDE_CHECKOUT_COOKIE = 'np_guide_checkout';
/** Purchases one browser can hold in its library cookie; the oldest drop off past this. */
export const MAX_LIBRARY_TOKENS = 20;
/** Downloads per purchase before the store asks the reader to contact support. */
export const MAX_DOWNLOADS_PER_PURCHASE = 60;

const TOKEN_PATTERN = /^[0-9a-f]{48}$/;

export function newAccessToken(): string {
    return randomBytes(24).toString('hex');
}

export function isAccessToken(value: string): boolean {
    return TOKEN_PATTERN.test(value);
}

/** The valid tokens in a library cookie value, newest first, without duplicates. */
export function parseLibraryCookie(value: string | undefined | null): string[] {
    if (!value) return [];
    return [...new Set(value.split('.').filter(isAccessToken))].slice(0, MAX_LIBRARY_TOKENS);
}

/** The cookie value with `token` added at the front. */
export function addToLibraryCookie(value: string | undefined | null, token: string): string {
    if (!isAccessToken(token)) return parseLibraryCookie(value).join('.');
    return [token, ...parseLibraryCookie(value).filter((t) => t !== token)].slice(0, MAX_LIBRARY_TOKENS).join('.');
}

/** Checkouts one browser remembers, so a second tab does not cost the first its library cookie. */
export const MAX_PENDING_CHECKOUTS = 5;
const CHECKOUT_SESSION_PATTERN = /^cs_(test|live)_[A-Za-z0-9]{10,200}$/;

export function isCheckoutSessionId(value: string): boolean {
    return CHECKOUT_SESSION_PATTERN.test(value);
}

/** The checkout session ids in the checkout cookie, newest first. */
export function parseCheckoutCookie(value: string | undefined | null): string[] {
    if (!value) return [];
    return [...new Set(value.split('.').filter(isCheckoutSessionId))].slice(0, MAX_PENDING_CHECKOUTS);
}

/** The checkout cookie value with `sessionId` added at the front. */
export function addToCheckoutCookie(value: string | undefined | null, sessionId: string): string {
    const kept = parseCheckoutCookie(value).filter((id) => id !== sessionId);
    return (isCheckoutSessionId(sessionId) ? [sessionId, ...kept] : kept).slice(0, MAX_PENDING_CHECKOUTS).join('.');
}

export interface GuideCookieOptions {
    httpOnly: true;
    secure: boolean;
    sameSite: 'lax';
    path: string;
    maxAge: number;
}

/** Cookie options for the library cookie: a year, as long as browsers keep one. */
export function libraryCookieOptions(): GuideCookieOptions {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 365,
    };
}

/** Cookie options for the checkout cookie: a day, longer than any Checkout Session stays open. */
export function checkoutCookieOptions(): GuideCookieOptions {
    return { ...libraryCookieOptions(), maxAge: 60 * 60 * 24 };
}
