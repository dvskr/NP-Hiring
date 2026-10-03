/**
 * lib/next-post-quote.ts: a 'promo' quote the browser fetched before
 * config.promoEndsAt stops counting at that instant, so the preview, the
 * checkout and the dashboard usage strip never keep promising a free post
 * after the promo has ended. Every other quote passes through untouched.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '@/lib/config';
import { currentQuote } from '@/lib/next-post-quote';

const DURING_PROMO = new Date('2026-12-31T12:00:00.000Z');
const LAST_PROMO_INSTANT = new Date(Date.parse(config.promoEndsAt) - 1);
const LADDER_START = new Date(config.promoEndsAt);
const AFTER_PROMO = new Date('2027-03-01T12:00:00.000Z');

const PROMO = { eligible: true, mode: 'promo' as const, willBeFree: true, price: 0 };
const PLAN = { eligible: true, mode: 'plan' as const, willBeFree: true, price: 0 };
const INTRO = { eligible: true, mode: 'intro' as const, willBeFree: false, price: config.introPrice };
const PAID = { eligible: true, mode: 'paid' as const, willBeFree: false, price: config.postingPrice };
const INELIGIBLE: { eligible: boolean; reason: string; mode?: string } = { eligible: false, reason: 'free-email-provider' };

afterEach(() => {
    vi.useRealTimers();
});

describe('currentQuote', () => {
    it('keeps a promo quote while the promo runs, to the last instant', () => {
        expect(currentQuote(PROMO, DURING_PROMO)).toBe(PROMO);
        expect(currentQuote(PROMO, LAST_PROMO_INSTANT)).toBe(PROMO);
    });

    it('drops a promo quote from the instant the promo ends', () => {
        expect(currentQuote(PROMO, LADDER_START)).toBeNull();
        expect(currentQuote(PROMO, AFTER_PROMO)).toBeNull();
    });

    it('passes every other quote through in both phases', () => {
        for (const now of [DURING_PROMO, AFTER_PROMO]) {
            for (const quote of [PLAN, INTRO, PAID, INELIGIBLE]) {
                expect(currentQuote(quote, now)).toBe(quote);
            }
        }
    });

    it('no quote is no quote', () => {
        expect(currentQuote(null, AFTER_PROMO)).toBeNull();
        expect(currentQuote(undefined, DURING_PROMO)).toBeNull();
    });

    it('reads the clock at call time when no instant is passed', () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(DURING_PROMO);
        expect(currentQuote(PROMO)).toBe(PROMO);
        vi.setSystemTime(AFTER_PROMO);
        expect(currentQuote(PROMO)).toBeNull();
    });

    it('is client-safe: it imports lib/config and nothing else', () => {
        const src = fs.readFileSync(path.join(process.cwd(), 'lib/next-post-quote.ts'), 'utf8');
        const imports = [...src.matchAll(/^import[^;]*from '([^']+)';/gm)].map((m) => m[1]);
        expect(imports).toEqual(['@/lib/config']);
    });
});
