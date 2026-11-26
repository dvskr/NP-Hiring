/**
 * Sentry NP-HIRING-3: "TypeError: network error" reached the error pages when
 * the page data of a client navigation was cut off after the server had
 * answered 200. No frame of ours was in it. The error pages leave exactly that
 * rejection unreported, and nothing that merely resembles it.
 */
import { describe, expect, it } from 'vitest';
import { isDroppedConnection } from '@/lib/dropped-connection';

describe('isDroppedConnection', () => {
    it("is Chrome's rejection for a response body cut off mid-read", () => {
        expect(isDroppedConnection(new TypeError('network error'))).toBe(true);
    });

    it.each([
        ['a fetch that never connected', new TypeError('Failed to fetch')],
        ['a TypeError from our own code', new TypeError("Cannot read properties of undefined (reading 'salary')")],
        ['an Error of another class with the same words', new Error('network error')],
        ['a TypeError that only contains the words', new TypeError('network error while loading chunk 412')],
    ])('is not %s', (_label, error) => {
        expect(isDroppedConnection(error)).toBe(false);
    });
});
