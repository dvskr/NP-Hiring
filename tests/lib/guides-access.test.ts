/**
 * Library access is a cookie of bearer tokens (np_guides). The tokens have to
 * survive the middleware's path lowercasing (they travel in the email link
 * path), and a hostile cookie must never widen access or grow without bound.
 * The checkout cookie (np_guide_checkout) ties the success page to the
 * browser that paid.
 */
import { describe, expect, it } from 'vitest';
import {
    GUIDE_CHECKOUT_COOKIE,
    GUIDES_COOKIE,
    MAX_LIBRARY_TOKENS,
    MAX_PENDING_CHECKOUTS,
    addToCheckoutCookie,
    addToLibraryCookie,
    checkoutCookieOptions,
    isAccessToken,
    isCheckoutSessionId,
    libraryCookieOptions,
    newAccessToken,
    parseCheckoutCookie,
    parseLibraryCookie,
} from '@/lib/guides/access';

describe('cookie names', () => {
    it('are this site\'s own', () => {
        expect(GUIDES_COOKIE).toBe('np_guides');
        expect(GUIDE_CHECKOUT_COOKIE).toBe('np_guide_checkout');
    });
});

describe('access tokens', () => {
    it('are 48 lowercase hex characters and unique', () => {
        const tokens = new Set(Array.from({ length: 200 }, () => newAccessToken()));
        expect(tokens.size).toBe(200);
        for (const token of tokens) {
            expect(token).toMatch(/^[0-9a-f]{48}$/);
            expect(token.toLowerCase()).toBe(token);
            expect(isAccessToken(token)).toBe(true);
        }
    });

    it('rejects anything else', () => {
        for (const bad of ['', 'abc', 'A'.repeat(48), `${'a'.repeat(47)}g`, `${'a'.repeat(48)}.`, '../'.repeat(16)]) {
            expect(isAccessToken(bad), bad).toBe(false);
        }
    });
});

describe('the library cookie', () => {
    const a = 'a'.repeat(48);
    const b = 'b'.repeat(48);

    it('parses only well-formed tokens', () => {
        expect(parseLibraryCookie(undefined)).toEqual([]);
        expect(parseLibraryCookie(`${a}.junk.${b}..`)).toEqual([a, b]);
    });

    it('adds a token once, newest first', () => {
        const once = addToLibraryCookie(undefined, a);
        expect(parseLibraryCookie(addToLibraryCookie(once, a))).toEqual([a]);
        expect(parseLibraryCookie(addToLibraryCookie(once, b))).toEqual([b, a]);
    });

    it('never adds a malformed token', () => {
        expect(addToLibraryCookie(a, 'not-a-token')).toBe(a);
    });

    it('keeps at most the newest tokens', () => {
        let value: string | undefined;
        const tokens = Array.from({ length: MAX_LIBRARY_TOKENS + 5 }, () => newAccessToken());
        for (const token of tokens) value = addToLibraryCookie(value, token);
        const kept = parseLibraryCookie(value);
        expect(kept).toHaveLength(MAX_LIBRARY_TOKENS);
        expect(kept).toContain(tokens[tokens.length - 1]);
        expect(kept).not.toContain(tokens[0]);
    });

    it('is a year long, httpOnly, lax and site-wide', () => {
        const options = libraryCookieOptions();
        expect(options).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/' });
        expect(options.maxAge).toBeGreaterThan(60 * 60 * 24 * 300);
    });
});

describe('the checkout cookie', () => {
    const first = 'cs_test_FirstCheckout1234';
    const second = 'cs_live_SecondCheckout5678';

    it('accepts only Stripe Checkout session ids', () => {
        expect(isCheckoutSessionId(first)).toBe(true);
        for (const bad of ['', 'cs_test_', 'pi_123456789012', 'cs_test_abc.def', 'cs_prod_abcdefghijkl']) {
            expect(isCheckoutSessionId(bad), bad).toBe(false);
        }
    });

    it('remembers several recent checkouts, newest first', () => {
        const value = addToCheckoutCookie(addToCheckoutCookie(undefined, first), second);
        expect(parseCheckoutCookie(value)).toEqual([second, first]);
        expect(parseCheckoutCookie(addToCheckoutCookie(value, first))).toEqual([first, second]);
    });

    it('keeps at most a handful and drops junk', () => {
        let value: string | undefined = 'junk.cs_test_';
        const ids = Array.from({ length: MAX_PENDING_CHECKOUTS + 3 }, (_, i) => `cs_test_Checkout${String(i).padStart(6, '0')}`);
        for (const id of ids) value = addToCheckoutCookie(value, id);
        const kept = parseCheckoutCookie(value);
        expect(kept).toHaveLength(MAX_PENDING_CHECKOUTS);
        expect(kept[0]).toBe(ids[ids.length - 1]);
        expect(kept).not.toContain(ids[0]);
    });

    it('is httpOnly and lasts a day', () => {
        expect(checkoutCookieOptions()).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 });
    });
});
