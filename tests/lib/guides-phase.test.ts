/**
 * lib/guides/phase.ts: guidePhase() is the one check the store pages, the
 * claim route and the checkout read (owner decision 2026-11-26). It is
 * 'paid' when the Stripe key and STRIPE_WEBHOOK_SECRET are both set
 * (trimmed), else 'free'. ENABLE_PAID_POSTING and the posting promo's clock
 * play no part, so the guides never wait on the posting ladder and never open
 * the renewals. guidePriceCopy prints the free offer (no end date: the free
 * period ends when the Stripe settings are added) or the catalog price.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { config } from '@/lib/config';
import { BUNDLES, GUIDES, allProducts, formatPrice } from '@/lib/guides/catalog';
import { GUIDE_CHECKOUT_TYPE, guidePhase, guidePriceCopy } from '@/lib/guides/phase';

const PROMO_RUNNING = new Date('2026-11-26T12:00:00.000Z');
const AFTER_PROMO = new Date(Date.parse(config.promoEndsAt) + 60 * 60 * 1000);

function stripeSettings(key: string, webhookSecret: string): void {
    vi.stubEnv('STRIPE_SECRET_KEY', key);
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', webhookSecret);
}

afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
});

describe('guidePhase', () => {
    it('tags a guide checkout and its payment intent as "guide"', () => {
        expect(GUIDE_CHECKOUT_TYPE).toBe('guide');
    });

    it('is paid only when the Stripe key and the webhook secret are both set', () => {
        stripeSettings('sk_live_x', 'whsec_x');
        expect(guidePhase()).toBe('paid');
        for (const [key, secret] of [['', ''], ['sk_live_x', ''], ['', 'whsec_x'], ['  ', 'whsec_x'], ['sk_live_x', '\n']] as const) {
            stripeSettings(key, secret);
            expect(guidePhase(), JSON.stringify([key, secret])).toBe('free');
        }
    });

    it('never reads ENABLE_PAID_POSTING', () => {
        for (const flag of ['true', 'false', '']) {
            vi.stubEnv('ENABLE_PAID_POSTING', flag);
            stripeSettings('', '');
            expect(guidePhase(), flag).toBe('free');
            stripeSettings('sk_live_x', 'whsec_x');
            expect(guidePhase(), flag).toBe('paid');
        }
    });

    it('never reads the promo clock: the same answer while the posting promo runs and after it', () => {
        const promoClock = vi.spyOn(config, 'isPromoActive');
        for (const at of [PROMO_RUNNING, AFTER_PROMO]) {
            vi.useFakeTimers({ toFake: ['Date'] });
            vi.setSystemTime(at);
            stripeSettings('', '');
            expect(guidePhase(), at.toISOString()).toBe('free');
            stripeSettings('sk_live_x', 'whsec_x');
            expect(guidePhase(), at.toISOString()).toBe('paid');
            for (const product of allProducts()) guidePriceCopy(product);
            vi.useRealTimers();
        }
        expect(promoClock).not.toHaveBeenCalled();
        promoClock.mockRestore();
    });
});

describe('guidePriceCopy', () => {
    it('free: "Free" beside the struck catalog price, with no end date, and the claim button', () => {
        const guide = GUIDES['interview-prep-pack'];
        const price = formatPrice(guide.priceCents);
        expect(guidePriceCopy(guide, 'free')).toEqual({
            phase: 'free',
            price: 'Free',
            listPrice: price,
            listPriceLabel: 'Regular price',
            note: `Free for a limited time, then ${price}`,
            cta: 'Get it free',
        });
        expect(price).toBe('$29');
        expect(guidePriceCopy(BUNDLES['complete-library'], 'free').cta).toBe('Get them free');
        for (const product of allProducts()) {
            expect(JSON.stringify(guidePriceCopy(product, 'free')), product.slug).not.toContain(config.promoEndsLabel);
        }
    });

    it('paid: only the catalog price of a single guide, and nothing says free', () => {
        const copy = guidePriceCopy(GUIDES['interview-prep-pack'], 'paid');
        expect(copy).toEqual({ phase: 'paid', price: '$29', listPrice: null, listPriceLabel: null, note: null, cta: 'Buy for $29' });
        expect(JSON.stringify(copy)).not.toMatch(/free/i);
    });

    it('paid: a bundle\'s separate total struck through and what it saves', () => {
        // 9 + 29 + 29 + 39 + 39 + 49 = $194 one at a time, $99 together.
        expect(guidePriceCopy(BUNDLES['complete-library'], 'paid')).toEqual({
            phase: 'paid',
            price: '$99',
            listPrice: '$194',
            listPriceLabel: 'Bought one at a time',
            note: 'Save $95 on buying them one at a time',
            cta: 'Buy for $99',
        });
        // 29 + 29 + 39 + 9 = $106 one at a time, $49 together.
        expect(guidePriceCopy(BUNDLES['career-bundle'], 'paid').note).toBe('Save $57 on buying them one at a time');
        // 49 + 39 + 9 = $97 one at a time, $59 together.
        expect(guidePriceCopy(BUNDLES['practice-owner-bundle'], 'paid').note).toBe('Save $38 on buying them one at a time');
    });

    it('reads the phase from the environment when none is given', () => {
        stripeSettings('', '');
        expect(guidePriceCopy(GUIDES['compensation-report']).phase).toBe('free');
        stripeSettings('sk_live_x', 'whsec_x');
        expect(guidePriceCopy(GUIDES['compensation-report']).phase).toBe('paid');
    });

    it('uses no dashes in either phase', () => {
        for (const phase of ['free', 'paid'] as const) {
            for (const product of allProducts()) {
                expect(JSON.stringify(guidePriceCopy(product, phase)), `${phase} ${product.slug}`).not.toMatch(/[–—]/);
            }
        }
    });
});
