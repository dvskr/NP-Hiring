/**
 * lib/guides/phase.ts: the guides take their catalog prices from the same
 * instant the paid posting ladder starts (config.promoEndsAt). Until then
 * every product is free to claim and Stripe is never called; after it the
 * guides are sold, behind the same gate as the 5-post pack: paid posting on,
 * the Stripe key and STRIPE_WEBHOOK_SECRET set, the promo over. Every
 * phase-dependent sentence comes from guidePriceCopy, decided at the instant
 * it is asked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { config } from '@/lib/config';
import { logger } from '@/lib/logger';

const env = vi.hoisted(() => ({
    getPaidPostingStatus: vi.fn(),
    getEnv: vi.fn(),
}));
vi.mock('@/lib/env', () => env);

import { BUNDLES, GUIDES } from '@/lib/guides/catalog';
import {
    GUIDE_CHECKOUT_TYPE,
    guidePhase,
    guidePriceCopy,
    guideSaleClosedReason,
    isGuideClaimOpen,
    isGuideSaleOpen,
} from '@/lib/guides/phase';

const LAST_PROMO_INSTANT = new Date(Date.parse(config.promoEndsAt) - 1);
const LADDER_START = new Date(config.promoEndsAt);

beforeEach(() => {
    vi.clearAllMocks();
    env.getPaidPostingStatus.mockReturnValue({ enabled: true, stripeConfigured: true, available: true });
    env.getEnv.mockReturnValue({ STRIPE_WEBHOOK_SECRET: 'whsec_x' });
});

describe('the phase', () => {
    it('is the promo until config.promoEndsAt, then paid, to the millisecond', () => {
        expect(guidePhase(LAST_PROMO_INSTANT)).toBe('promo');
        expect(guidePhase(LADDER_START)).toBe('paid');
        expect(isGuideClaimOpen(LAST_PROMO_INSTANT)).toBe(true);
        expect(isGuideClaimOpen(LADDER_START)).toBe(false);
    });

    it('is decided at the instant it is asked: the default is now', () => {
        const promoClock = vi.spyOn(config, 'isPromoActive').mockReturnValueOnce(false);
        expect(isGuideClaimOpen()).toBe(false);
        expect(promoClock).toHaveBeenCalledWith(expect.any(Date));
        promoClock.mockRestore();
    });

    it('tags a guide checkout and its payment intent as "guide"', () => {
        expect(GUIDE_CHECKOUT_TYPE).toBe('guide');
    });
});

describe('guideSaleClosedReason: the paid gate, in the order the checkout answers it', () => {
    it('is null once the promo is over with paid posting on and Stripe fully configured', () => {
        expect(guideSaleClosedReason(LADDER_START)).toBeNull();
        expect(isGuideSaleOpen(LADDER_START)).toBe(true);
    });

    it('is PROMO_ACTIVE until config.promoEndsAt', () => {
        expect(guideSaleClosedReason(LAST_PROMO_INSTANT)).toBe('PROMO_ACTIVE');
        expect(isGuideSaleOpen(LAST_PROMO_INSTANT)).toBe(false);
    });

    it('names paid posting first, then the Stripe key or the webhook secret, then the promo', () => {
        env.getPaidPostingStatus.mockReturnValue({ enabled: false, stripeConfigured: false, available: false });
        env.getEnv.mockReturnValue({ STRIPE_WEBHOOK_SECRET: undefined });
        expect(guideSaleClosedReason(LAST_PROMO_INSTANT)).toBe('PAID_POSTING_DISABLED');

        env.getPaidPostingStatus.mockReturnValue({ enabled: true, stripeConfigured: false, available: false });
        expect(guideSaleClosedReason(LAST_PROMO_INSTANT)).toBe('STRIPE_NOT_CONFIGURED');

        env.getPaidPostingStatus.mockReturnValue({ enabled: true, stripeConfigured: true, available: true });
        expect(guideSaleClosedReason(LADDER_START)).toBe('STRIPE_NOT_CONFIGURED');

        env.getEnv.mockReturnValue({ STRIPE_WEBHOOK_SECRET: 'whsec_x' });
        expect(guideSaleClosedReason(LAST_PROMO_INSTANT)).toBe('PROMO_ACTIVE');
    });

    it('reads an environment that will not parse as closed, and logs why', () => {
        const logged = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        env.getPaidPostingStatus.mockImplementation(() => { throw new Error('env invalid'); });

        expect(guideSaleClosedReason(LADDER_START)).toBe('STRIPE_NOT_CONFIGURED');
        expect(logged).toHaveBeenCalledWith(expect.stringContaining('would not parse'), expect.objectContaining({ message: 'env invalid' }));
        logged.mockRestore();
    });
});

describe('guidePriceCopy', () => {
    it('says free through the promo end, with the catalog price struck beside it', () => {
        const copy = guidePriceCopy(GUIDES['interview-prep-pack'], LAST_PROMO_INSTANT);
        expect(copy).toEqual({
            phase: 'promo',
            price: 'Free',
            listPrice: '$19',
            note: `Free through ${config.promoEndsLabel}, then $19`,
            cta: 'Get it free',
        });
        expect(guidePriceCopy(BUNDLES['complete-library'], LAST_PROMO_INSTANT).cta).toBe('Get them free');
    });

    it('states only the price of a single guide once the promo is over: nothing says free', () => {
        const copy = guidePriceCopy(GUIDES['interview-prep-pack'], LADDER_START);
        expect(copy).toEqual({ phase: 'paid', price: '$19', listPrice: null, note: null, cta: 'Buy for $19' });
        expect(JSON.stringify(copy)).not.toMatch(/free/i);
    });

    it('gives a bundle its separate total struck through and what it saves once the promo is over', () => {
        // 9 + 19 + 19 + 29 + 29 + 39 = $144 one at a time, $69 together.
        const copy = guidePriceCopy(BUNDLES['complete-library'], LADDER_START);
        expect(copy).toEqual({
            phase: 'paid',
            price: '$69',
            listPrice: '$144',
            note: 'Save $75 on buying them one at a time',
            cta: 'Buy for $69',
        });
        expect(JSON.stringify(copy)).not.toMatch(/free/i);
    });

    it('uses no dashes', () => {
        for (const now of [LAST_PROMO_INSTANT, LADDER_START]) {
            expect(JSON.stringify(guidePriceCopy(GUIDES['telehealth-playbook'], now))).not.toMatch(/[–—]/);
        }
    });
});
