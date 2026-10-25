/**
 * lib/renewal-price.ts: which renewal price a post pays (2027 re-price).
 *
 * A renewal costs the base price (config.renewalPrice) for every renewable
 * post except one that was BOUGHT at the posting price, which renews at the
 * pro price (config.proRenewalPrice). pricingTier plus paymentStatus cannot
 * tell those apart: a promo post is written ('promo', 'pro'), and the renewal
 * webhook rewrites a renewed promo post to ('paid', 'pro'), which is exactly
 * what a bought post reads as. The ledger tells them apart: only a post
 * bought through Checkout has a JobCharge of type 'new'.
 *
 * The rule, pinned case by case below:
 *   'pro'  - pricingTier 'pro' AND the row has a 'new' charge
 *   'base' - everything else: promo posts (renewed or not), intro posts,
 *            pack posts, legacy paid rows with no charge, and the legacy
 *            free_renewed / free_upgraded rows
 * If the best-effort 'new' charge write ever failed, the rule falls back to
 * the lower price.
 *
 * The module is client-safe (it imports only lib/config); the select that
 * loads the 'new' charge lives in Prisma-backed lib/pricing.ts.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { config, type RenewalRung } from '@/lib/config';
import { NEW_POST_CHARGE_SELECT } from '@/lib/pricing';
import { asRenewalRung, renewalRungFor, renewalRungForRow } from '@/lib/renewal-price';

interface Case {
    /** The row, as the database holds it. */
    row: string;
    pricingTier: string;
    /** Whether the row has a JobCharge of type 'new'. */
    hasNewPostCharge: boolean;
    rung: RenewalRung;
}

const PINNED_CASES: readonly Case[] = [
    { row: 'a promo post', pricingTier: 'pro', hasNewPostCharge: false, rung: 'base' },
    { row: 'a promo post that was renewed (its only charge is a renewal)', pricingTier: 'pro', hasNewPostCharge: false, rung: 'base' },
    { row: 'an intro post ($249 bought)', pricingTier: 'intro', hasNewPostCharge: true, rung: 'base' },
    { row: 'a post bought at the $349 posting price', pricingTier: 'pro', hasNewPostCharge: true, rung: 'pro' },
    { row: 'a post bought at $349 and renewed since (the new charge stays on the ledger)', pricingTier: 'pro', hasNewPostCharge: true, rung: 'pro' },
    { row: 'a pack post (the credit was the payment)', pricingTier: 'pack', hasNewPostCharge: false, rung: 'base' },
    { row: 'a legacy paid row with no charge on the ledger', pricingTier: 'pro', hasNewPostCharge: false, rung: 'base' },
    { row: 'a legacy free_renewed row', pricingTier: 'pro', hasNewPostCharge: false, rung: 'base' },
    { row: 'a legacy free_upgraded row', pricingTier: 'pro', hasNewPostCharge: false, rung: 'base' },
];

describe('renewalRungFor: the pinned cases', () => {
    it.each(PINNED_CASES)('$row renews at the $rung price', ({ pricingTier, hasNewPostCharge, rung }) => {
        expect(renewalRungFor({ pricingTier, hasNewPostCharge })).toBe(rung);
    });

    it("is 'pro' for exactly one input: the 'pro' tier with a 'new' charge", () => {
        const tiers = ['pro', 'intro', 'plan', 'pack', 'starter', 'growth', 'premium', 'PRO', ' pro', '', null, undefined];
        const rungs = tiers.flatMap((pricingTier) => [true, false].map((hasNewPostCharge) => ({
            pricingTier,
            hasNewPostCharge,
            rung: renewalRungFor({ pricingTier, hasNewPostCharge }),
        })));

        expect(rungs.filter(({ rung }) => rung === 'pro')).toEqual([
            { pricingTier: 'pro', hasNewPostCharge: true, rung: 'pro' },
        ]);
    });

    it("a 'new' charge on a row of any other tier does not lift it to the pro price", () => {
        for (const pricingTier of ['intro', 'plan', 'pack', 'starter', '', null, undefined]) {
            expect(renewalRungFor({ pricingTier, hasNewPostCharge: true })).toBe('base');
        }
    });

    it("the 'pro' tier without a 'new' charge falls back to the lower price", () => {
        expect(renewalRungFor({ pricingTier: 'pro', hasNewPostCharge: false })).toBe('base');
    });
});

describe('renewalRungForRow: the rung of a row loaded with NEW_POST_CHARGE_SELECT', () => {
    it("is 'pro' for a 'pro' row whose query found a 'new' charge", () => {
        expect(renewalRungForRow({ pricingTier: 'pro', jobCharges: [{ id: 'jc-1' }] })).toBe('pro');
    });

    it('is base for a row whose query found no new charge', () => {
        expect(renewalRungForRow({ pricingTier: 'pro', jobCharges: [] })).toBe('base');
    });

    it('is base for a row that was loaded without the charges (the lower price is the fallback)', () => {
        expect(renewalRungForRow({ pricingTier: 'pro' })).toBe('base');
        expect(renewalRungForRow({ pricingTier: 'pro', jobCharges: undefined })).toBe('base');
        expect(renewalRungForRow({ pricingTier: 'pro', jobCharges: null })).toBe('base');
    });

    it('reads the STORED tier: an unknown tier with a new charge is base, not the pro price asPaidTier would narrow it to', () => {
        expect(renewalRungForRow({ pricingTier: 'starter', jobCharges: [{ id: 'jc-1' }] })).toBe('base');
        expect(renewalRungForRow({ pricingTier: 'intro', jobCharges: [{ id: 'jc-1' }] })).toBe('base');
        expect(renewalRungForRow({ pricingTier: undefined, jobCharges: [{ id: 'jc-1' }] })).toBe('base');
    });

    it('agrees with renewalRungFor on every pinned case', () => {
        for (const { pricingTier, hasNewPostCharge, rung } of PINNED_CASES) {
            const jobCharges = hasNewPostCharge ? [{ id: 'jc-1' }] : [];
            expect(renewalRungForRow({ pricingTier, jobCharges })).toBe(rung);
        }
    });

    it('prices the rung through config, so a row never carries its own amount', () => {
        const bought = { pricingTier: 'pro', jobCharges: [{ id: 'jc-1' }] };
        const promo = { pricingTier: 'pro', jobCharges: [] };

        expect(config.renewalPriceCentsFor(renewalRungForRow(bought))).toBe(config.stripeProRenewalPriceInCents);
        expect(config.renewalPriceCentsFor(renewalRungForRow(promo))).toBe(config.stripeRenewalPriceInCents);
        expect(config.renewalPriceDollarsFor(renewalRungForRow(bought))).toBe(config.proRenewalPrice);
        expect(config.renewalPriceDollarsFor(renewalRungForRow(promo))).toBe(config.renewalPrice);
    });
});

describe('asRenewalRung: the rung a renewal session carries in its metadata', () => {
    it("keeps 'pro' and 'base'", () => {
        expect(asRenewalRung('pro')).toBe('pro');
        expect(asRenewalRung('base')).toBe('base');
    });

    it('reads a session minted before rungs existed (no metadata) as the base price', () => {
        expect(asRenewalRung(undefined)).toBe('base');
        expect(asRenewalRung(null)).toBe('base');
        expect(asRenewalRung('')).toBe('base');
    });

    it('reads anything else as the base price too', () => {
        for (const value of ['gold', 'PRO', 'plan', 'intro', 24900, {}, ['pro']]) {
            expect(asRenewalRung(value)).toBe('base');
        }
    });
});

describe('NEW_POST_CHARGE_SELECT: the query fragment that finds a bought post', () => {
    it("asks for one 'new' charge and nothing else about it", () => {
        expect(NEW_POST_CHARGE_SELECT).toEqual({
            jobCharges: { where: { type: 'new' }, select: { id: true }, take: 1 },
        });
    });

    it("never asks for renewal charges: a renewed promo post must not read as a bought one", () => {
        expect(JSON.stringify(NEW_POST_CHARGE_SELECT)).not.toContain('renewal');
    });
});

describe('lib/renewal-price.ts stays client-safe', () => {
    it('imports lib/config and nothing else, so the dashboard and the edit page can load it', () => {
        const source = fs.readFileSync(path.join(process.cwd(), 'lib/renewal-price.ts'), 'utf8');
        const specifiers = [...source.matchAll(/^\s*import\s[^'"]*from\s+['"]([^'"]+)['"]/gm)].map((match) => match[1]);

        expect(specifiers).toEqual(['@/lib/config']);
    });
});
