/**
 * lib/config.ts — the launch promo + 2027 ladder contract (2026-09-12).
 *
 * Every price the checkout, the webhook, the invoice and the marketing copy
 * use flows through these helpers, so this file pins the three things that
 * would silently mis-charge someone if they drifted:
 *
 *   - `isPromoActive` ends at exactly 2027-01-01T10:00:00Z (midnight
 *     Pacific/Honolulu, the last of the 50 states to leave December 31,
 *     2026) — exclusive, so the promise "free through December 31, 2026",
 *     printed with no time zone, is true at 11:59 pm local in every US zone;
 *   - `priceCentsForTier` maps every rung to the Stripe unit_amount declared
 *     beside its dollar value, and never falls back to a CHEAPER rung for an
 *     unknown / tampered tier;
 *   - `getTierLabel` is what the checkout product name and the dashboard
 *     badge print;
 *   - `renewalCapDays` is the cap the renewal code actually applies.
 */
import { describe, it, expect } from 'vitest';
import { config } from '@/lib/config';
import { renewalExpiresAt } from '@/lib/expires-at';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Calendar date of an instant in a zone, in the copy's "Month D, YYYY" form. */
const dateIn = (instant: number, timeZone: string): string =>
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(instant));

describe('config.isPromoActive — every post is free through December 31, 2026 in every US time zone', () => {
    it('is active one second before the boundary', () => {
        expect(config.isPromoActive(new Date('2027-01-01T09:59:59.000Z'))).toBe(true);
    });

    it('is inactive at exactly 2027-01-01T10:00:00Z (exclusive end)', () => {
        expect(config.isPromoActive(new Date('2027-01-01T10:00:00.000Z'))).toBe(false);
    });

    it('is inactive after the boundary', () => {
        expect(config.isPromoActive(new Date('2027-01-01T10:00:01.000Z'))).toBe(false);
        expect(config.isPromoActive(new Date('2027-06-01T00:00:00.000Z'))).toBe(false);
    });

    it('is active well inside the launch window', () => {
        expect(config.isPromoActive(new Date('2026-09-12T12:00:00.000Z'))).toBe(true);
        expect(config.isPromoActive(new Date('2026-12-31T23:59:59.000Z'))).toBe(true);
    });

    // The bug this boundary fixes: at 05:00Z (midnight Eastern) an employer in
    // Pacific time posting at 9 pm on December 31 was charged although every
    // surface promised the post free "through December 31, 2026".
    it.each([
        ['Eastern', 'America/New_York', '2027-01-01T04:59:00.000Z'],
        ['Central', 'America/Chicago', '2027-01-01T05:59:00.000Z'],
        ['Mountain', 'America/Denver', '2027-01-01T06:59:00.000Z'],
        ['Arizona', 'America/Phoenix', '2027-01-01T06:59:00.000Z'],
        ['Pacific', 'America/Los_Angeles', '2027-01-01T07:59:00.000Z'],
        ['Alaska', 'America/Anchorage', '2027-01-01T08:59:00.000Z'],
        ['Hawaii', 'Pacific/Honolulu', '2027-01-01T09:59:00.000Z'],
    ])('is still free at 11:59 pm on December 31 in %s time', (_name, timeZone, iso) => {
        const instant = Date.parse(iso);
        // The fixture really is 11:59 pm on the promised last day in that zone…
        expect(dateIn(instant, timeZone)).toBe(config.promoEndsLabel);
        expect(new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(instant))).toBe('23:59');
        // …and the promo honours it.
        expect(config.isPromoActive(new Date(instant))).toBe(true);
    });

    it('compares against config.promoEndsAt, which the quote endpoint echoes to the UI', () => {
        const endsAt = Date.parse(config.promoEndsAt);
        expect(endsAt).toBe(Date.UTC(2027, 0, 1, 10, 0, 0));
        expect(config.isPromoActive(new Date(endsAt - 1))).toBe(true);
        expect(config.isPromoActive(new Date(endsAt))).toBe(false);
    });

    it('ends exactly at midnight in Hawaii, the last US state to leave December 31', () => {
        const endsAt = Date.parse(config.promoEndsAt);
        expect(dateIn(endsAt - 1, 'Pacific/Honolulu')).toBe('December 31, 2026');
        expect(dateIn(endsAt, 'Pacific/Honolulu')).toBe('January 1, 2027');
    });

    it('carries the copy labels that match that instant, unchanged by the zone move', () => {
        expect(config.promoEndsLabel).toBe('December 31, 2026');
        expect(config.ladderStartsLabel).toBe('January 1, 2027');
        const endsAt = Date.parse(config.promoEndsAt);
        // The last free instant is on promoEndsLabel and the first paid one is
        // on ladderStartsLabel in the zone that defines the boundary, so no
        // printed date moved when the instant did.
        expect(dateIn(endsAt - 1, 'Pacific/Honolulu')).toBe(config.promoEndsLabel);
        expect(dateIn(endsAt, 'Pacific/Honolulu')).toBe(config.ladderStartsLabel);
        // In the zones east of Hawaii the promo only runs longer, never shorter:
        // the last free instant is already January 1 there.
        expect(dateIn(endsAt - 1, 'America/New_York')).toBe(config.ladderStartsLabel);
    });
});

describe('config.renewalCapDays — the renewal limit copy states is the one the code applies', () => {
    const createdAt = new Date('2027-02-01T00:00:00.000Z');

    it('caps an early renewal at renewalCapDays after the post was created', () => {
        // Renewed early, near the end of its first year: a full durationDays
        // extension would overshoot the cap, so the expiry lands on it.
        const now = new Date(createdAt.getTime() + 330 * DAY_MS);
        const currentExpiry = new Date(createdAt.getTime() + 340 * DAY_MS);
        const next = renewalExpiresAt({ currentExpiry, originalCreatedAt: createdAt, durationDays: config.durationDays, now });
        expect(next.getTime()).toBe(createdAt.getTime() + config.renewalCapDays * DAY_MS);
    });

    it('adds the full durationDays whenever the cap is not reached', () => {
        const now = new Date(createdAt.getTime() + 50 * DAY_MS);
        const currentExpiry = new Date(createdAt.getTime() + config.durationDays * DAY_MS);
        const next = renewalExpiresAt({ currentExpiry, originalCreatedAt: createdAt, durationDays: config.durationDays, now });
        expect(next.getTime()).toBe(currentExpiry.getTime() + config.durationDays * DAY_MS);
    });

    it('extends an already expired post from the renewal date, not from its old expiry', () => {
        const now = new Date(createdAt.getTime() + 100 * DAY_MS);
        const currentExpiry = new Date(createdAt.getTime() + config.durationDays * DAY_MS);
        const next = renewalExpiresAt({ currentExpiry, originalCreatedAt: createdAt, durationDays: config.durationDays, now });
        expect(next.getTime()).toBe(now.getTime() + config.durationDays * DAY_MS);
    });

    it('leaves room for at least one full renewal after a first listing', () => {
        expect(config.renewalCapDays).toBeGreaterThanOrEqual(2 * config.durationDays);
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
