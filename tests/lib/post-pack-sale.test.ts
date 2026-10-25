/**
 * lib/post-pack-sale.ts — whether the 5-post pack can be sold right now
 * (2027 re-price, phase 2: the backend ships dark).
 *
 * The same gate the Employer plan sale used (lib/employer-plan-link.ts
 * isPlanSaleOpen, backlog 2.16), without the Payment Link: the pack is sold
 * through a Checkout Session the server creates. Closed unless every one
 * holds:
 *   - the launch promo is over: every post is free until config.promoEndsAt,
 *     so a pack would buy nothing (owner decision: sold only once the ladder
 *     is live);
 *   - paid posting is on and the Stripe key is set (getPaidPostingStatus);
 *   - STRIPE_WEBHOOK_SECRET is set: without it the webhook answers 503 and
 *     could not record the sale.
 * An unreadable environment reads as closed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { config } from '@/lib/config';

const env = vi.hoisted(() => ({
    getPaidPostingStatus: vi.fn(),
    getEnv: vi.fn(),
}));
vi.mock('@/lib/env', () => env);

import { POST_PACK_CHECKOUT_TYPE, POST_PACK_SKU, isPackSaleOpen } from '@/lib/post-pack-sale';

const LAST_PROMO_INSTANT = new Date(Date.parse(config.promoEndsAt) - 1);
const LADDER_START = new Date(config.promoEndsAt);

beforeEach(() => {
    vi.clearAllMocks();
    env.getPaidPostingStatus.mockReturnValue({ enabled: true, stripeConfigured: true, available: true });
    env.getEnv.mockReturnValue({ STRIPE_WEBHOOK_SECRET: 'whsec_x' });
});

describe('isPackSaleOpen', () => {
    it('opens at config.promoEndsAt, not an instant before', () => {
        expect(isPackSaleOpen(LAST_PROMO_INSTANT)).toBe(false);
        expect(isPackSaleOpen(LADDER_START)).toBe(true);
    });

    it('stays closed after the promo while paid posting is off or the Stripe key is missing', () => {
        env.getPaidPostingStatus.mockReturnValue({ enabled: false, stripeConfigured: true, available: false });
        expect(isPackSaleOpen(LADDER_START)).toBe(false);
        env.getPaidPostingStatus.mockReturnValue({ enabled: true, stripeConfigured: false, available: false });
        expect(isPackSaleOpen(LADDER_START)).toBe(false);
    });

    it('stays closed without the webhook secret, which the sale could not be recorded without', () => {
        env.getEnv.mockReturnValue({ STRIPE_WEBHOOK_SECRET: undefined });
        expect(isPackSaleOpen(LADDER_START)).toBe(false);
    });

    it('reads an environment that will not parse as closed', () => {
        env.getPaidPostingStatus.mockImplementation(() => { throw new Error('env invalid'); });
        expect(isPackSaleOpen(LADDER_START)).toBe(false);
    });

    it('decides at the instant it is asked: the default is now', () => {
        const promoClock = vi.spyOn(config, 'isPromoActive').mockReturnValueOnce(false);
        expect(isPackSaleOpen()).toBe(true);
        expect(promoClock).toHaveBeenCalledWith(expect.any(Date));
        promoClock.mockRestore();
    });
});

describe('the identifiers the checkout, the webhook and GA share', () => {
    it('names the Checkout Session type and the item', () => {
        expect(POST_PACK_CHECKOUT_TYPE).toBe('post_pack');
        expect(POST_PACK_SKU).toBe('post-pack-5');
        expect(POST_PACK_SKU).toBe(`post-pack-${config.packPosts}`);
    });
});
