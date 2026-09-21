/**
 * lib/config.ts — the launch promo + 2027 ladder contract (2026-09-12).
 *
 * Every price the checkout, the webhook, the invoice and the marketing copy
 * use flows through these helpers, so this file pins the three things that
 * would silently mis-charge someone if they drifted:
 *
 *   - `isPromoActive` ends at exactly 2027-01-01T05:00:00Z (midnight
 *     America/New_York on December 31, 2026) — exclusive, so the first
 *     instant of January 1 already prices the ladder;
 *   - `priceCentsForTier` maps every rung to the Stripe unit_amount declared
 *     beside its dollar value, and never falls back to a CHEAPER rung for an
 *     unknown / tampered tier;
 *   - `getTierLabel` is what the checkout product name and the dashboard
 *     badge print.
 */
import { describe, it, expect } from 'vitest';
import { config } from '@/lib/config';

describe('config.isPromoActive — every post is free until midnight ET on December 31, 2026', () => {
    it('is active one second before the boundary', () => {
        expect(config.isPromoActive(new Date('2027-01-01T04:59:59.000Z'))).toBe(true);
    });

    it('is inactive at exactly 2027-01-01T05:00:00Z (exclusive end)', () => {
        expect(config.isPromoActive(new Date('2027-01-01T05:00:00.000Z'))).toBe(false);
    });

    it('is inactive after the boundary', () => {
        expect(config.isPromoActive(new Date('2027-01-01T05:00:01.000Z'))).toBe(false);
        expect(config.isPromoActive(new Date('2027-06-01T00:00:00.000Z'))).toBe(false);
    });

    it('is active well inside the launch window', () => {
        expect(config.isPromoActive(new Date('2026-09-12T12:00:00.000Z'))).toBe(true);
        expect(config.isPromoActive(new Date('2026-12-31T23:59:59.000Z'))).toBe(true);
    });

    it('compares against config.promoEndsAt, which the quote endpoint echoes to the UI', () => {
        const endsAt = Date.parse(config.promoEndsAt);
        expect(endsAt).toBe(Date.UTC(2027, 0, 1, 5, 0, 0));
        expect(config.isPromoActive(new Date(endsAt - 1))).toBe(true);
        expect(config.isPromoActive(new Date(endsAt))).toBe(false);
    });

    it('carries the copy labels that match that instant', () => {
        expect(config.promoEndsLabel).toBe('December 31, 2026');
        expect(config.ladderStartsLabel).toBe('January 1, 2027');
    });
});

describe('config.priceCentsForTier — Stripe unit_amount per rung', () => {
    it("'intro' is the intro price, declared as a dollar/cent pair", () => {
        expect(config.priceCentsForTier('intro')).toBe(config.stripeIntroPriceInCents);
        expect(config.stripeIntroPriceInCents).toBe(config.introPrice * 100);
    });

    it("'pro' is the featured price, declared as a dollar/cent pair", () => {
        expect(config.priceCentsForTier('pro')).toBe(config.stripePriceInCents);
        expect(config.stripePriceInCents).toBe(config.postingPrice * 100);
    });

    it("'plan' is never charged through per-post Checkout", () => {
        expect(config.priceCentsForTier('plan')).toBe(0);
    });

    it('never under-charges an unknown, legacy or tampered tier (falls back to the featured price)', () => {
        for (const tier of [undefined, null, '', 'starter', 'growth', 'premium', 'INTRO', 'free']) {
            expect(config.priceCentsForTier(tier)).toBe(config.stripePriceInCents);
        }
    });

    it('agrees with priceDollarsForTier on every rung', () => {
        for (const tier of ['intro', 'pro', 'plan', undefined] as const) {
            expect(config.priceCentsForTier(tier)).toBe(config.priceDollarsForTier(tier) * 100);
        }
    });

    it('keeps the intro price strictly below the featured price (it is a discount, not a tier)', () => {
        expect(config.introPrice).toBeLessThan(config.postingPrice);
        expect(config.renewalPrice).toBeLessThan(config.postingPrice);
    });
});

describe('config.getTierLabel', () => {
    it.each([
        ['intro', 'Intro'],
        ['pro', 'Pro'],
        ['plan', 'Plan'],
    ])("labels '%s' as %s", (tier, label) => {
        expect(config.getTierLabel(tier)).toBe(label);
    });

    it("renders legacy / unknown values as 'Pro' (every legacy row was sold as a featured post)", () => {
        expect(config.getTierLabel(undefined)).toBe('Pro');
        expect(config.getTierLabel('starter')).toBe('Pro');
    });
});

describe('ladder invariants the copy surfaces depend on', () => {
    it('every post runs the same duration, whatever it cost', () => {
        for (const tier of ['intro', 'pro', 'plan', undefined]) {
            expect(config.getDurationDays(tier)).toBe(config.durationDays);
            expect(config.isFeaturedTier(tier)).toBe(true);
            expect(config.getTierLimits(tier)).toBe(config.limits);
        }
    });

    it('renewal cents match the renewal dollar price', () => {
        expect(config.stripeRenewalPriceInCents).toBe(config.renewalPrice * 100);
    });

    it('the plan is priced per month for a fixed slot count with a grace window', () => {
        expect(config.planSlots).toBeGreaterThan(0);
        expect(config.planGraceDays).toBeGreaterThan(0);
        expect(config.planPrice).toBeGreaterThan(config.postingPrice);
    });

    it('the legacy invoice fallback is decoupled from the live ladder', () => {
        // Pre-ledger invoices must keep printing what those rows actually paid;
        // getStripePriceInCents is that frozen fallback, never a live rung.
        for (const tier of ['intro', 'pro', 'plan', undefined]) {
            expect(config.getStripePriceInCents(tier)).toBe(config.legacyInvoiceFallbackCents);
        }
    });

    it('the promo abuse cap exists but is not a marketed number', () => {
        expect(config.promoMaxActivePostsPerDomain).toBeGreaterThan(1);
    });
});
