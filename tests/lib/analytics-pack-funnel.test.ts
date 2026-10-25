/**
 * The browser funnel events for the 5-post pack (2027 re-price, phase 3;
 * plan section 3.9):
 *   - begin_checkout when the employer leaves for the pack's Stripe Checkout,
 *     valued at the pack price (1245) with checkout_type 'pack';
 *   - submit_free_post for a post published with a pack credit, with
 *     posting_mode 'pack', so pack posts stay separable from promo posts.
 * The server's purchase event for the pack is pinned in
 * tests/regressions/ga-measurement-protocol.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { config } from '@/lib/config';
import { trackBeginCheckout, trackSubmitFreePost } from '@/lib/analytics';

const gtag = vi.fn();

beforeEach(() => {
    gtag.mockReset();
    vi.stubGlobal('window', { gtag });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('the 5-post pack funnel events', () => {
    it("begin_checkout for the pack carries its price and checkout_type 'pack'", () => {
        trackBeginCheckout(config.stripePackPriceInCents, 'pack');

        expect(gtag).toHaveBeenCalledWith('event', 'begin_checkout', {
            currency: 'USD',
            value: config.packPrice,
            checkout_type: 'pack',
        });
        expect(config.packPrice).toBe(1245);
    });

    it("submit_free_post for a pack post carries posting_mode 'pack'", () => {
        trackSubmitFreePost('job-1', 'pack');

        expect(gtag).toHaveBeenCalledWith('event', 'submit_free_post', { job_id: 'job-1', posting_mode: 'pack' });
    });

    it('a promo post still reports its own mode', () => {
        trackSubmitFreePost('job-2', 'promo');

        expect(gtag).toHaveBeenCalledWith('event', 'submit_free_post', { job_id: 'job-2', posting_mode: 'promo' });
    });
});
