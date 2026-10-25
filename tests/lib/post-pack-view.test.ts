/**
 * lib/post-pack-view.ts — one 5-post pack as the employer's pages show it
 * (2027 re-price, phase 3): GET /api/employer/post-packs, /employer/post-pack
 * and Settings, Billing.
 *
 * Pinned:
 *   - the state a pack is in at `now`: active (paid, unexpired, a credit
 *     left), used (paid, unexpired, none left), expired, refunded, disputed;
 *   - the counts: total is sold less revoked, used is total less remaining,
 *     so a used-up pack reads "5 of 5 posts used" (the review fix of phase 3);
 *   - the lines the pages print, from config and the shared date labels,
 *     never "0 of 0" for a pack whose every credit was revoked;
 *   - the invoice link the pages print: Stripe's hosted invoice page, https
 *     only.
 */
import { describe, it, expect } from 'vitest';
import { config } from '@/lib/config';
import { packDateLabel, packUseByLabel } from '@/lib/pricing-copy';
import { POST_PACK_VIEW_SELECT, packCreditsLine, packInvoiceHref, packStatusLine, postPackState, toPostPackView } from '@/lib/post-pack-view';

const NOW = new Date('2027-06-01T12:00:00.000Z');
const EXPIRES = new Date('2028-03-01T12:00:00.000Z');

function row(overrides: Record<string, unknown> = {}) {
    return {
        id: 'pack-1',
        status: 'paid',
        creditsTotal: config.packPosts,
        creditsRemaining: 3,
        creditsRevoked: 0,
        amountCents: config.stripePackPriceInCents,
        currency: 'usd',
        purchasedAt: new Date('2027-03-01T12:00:00.000Z'),
        expiresAt: EXPIRES,
        hostedInvoiceUrl: 'https://invoice.stripe.test/i/abc',
        invoicePdfUrl: null,
        invoiceNumber: 'INV-0042',
        ...overrides,
    };
}

describe('postPackState', () => {
    it.each([
        ['active', row()],
        ['used', row({ creditsRemaining: 0 })],
        ['expired', row({ expiresAt: new Date('2027-05-01T00:00:00.000Z') })],
        ['refunded', row({ status: 'refunded', creditsRemaining: 0, creditsRevoked: 3 })],
        ['disputed', row({ status: 'disputed' })],
    ])('%s', (state, pack) => {
        expect(postPackState(pack, NOW)).toBe(state);
    });
});

describe('toPostPackView', () => {
    it('counts sold less revoked, and used as total less remaining', () => {
        expect(toPostPackView(row(), NOW)).toEqual({
            id: 'pack-1',
            state: 'active',
            total: config.packPosts,
            remaining: 3,
            used: config.packPosts - 3,
            revoked: 0,
            amountCents: config.stripePackPriceInCents,
            currency: 'usd',
            purchasedAt: '2027-03-01T12:00:00.000Z',
            expiresAt: EXPIRES.toISOString(),
            hostedInvoiceUrl: 'https://invoice.stripe.test/i/abc',
            invoicePdfUrl: null,
            invoiceNumber: 'INV-0042',
        });
        expect(toPostPackView(row({ creditsRemaining: 0, creditsRevoked: 3, status: 'refunded' }), NOW)).toMatchObject({ total: 2, remaining: 0, used: 2, revoked: 3 });
    });

    it('selects exactly the fields the view reads', () => {
        expect(Object.keys(POST_PACK_VIEW_SELECT).sort()).toEqual(Object.keys(row()).sort());
    });
});

describe('the lines the pages print', () => {
    it('an active pack: the posts left of the total, and the date to use them by', () => {
        const view = toPostPackView(row(), NOW);
        expect(packCreditsLine(view)).toBe(`3 of ${config.packPosts} posts left`);
        expect(packStatusLine(view)).toBe(`Use by ${packUseByLabel(EXPIRES)}`);
    });

    it('a used-up pack: "5 of 5 posts used", with no date to use it by', () => {
        const view = toPostPackView(row({ creditsRemaining: 0 }), NOW);
        expect(packCreditsLine(view)).toBe(`${config.packPosts} of ${config.packPosts} posts used`);
        expect(packStatusLine(view)).toBeNull();
    });

    it('an expired, refunded or disputed pack: the posts used, and the state', () => {
        const expired = toPostPackView(row({ expiresAt: new Date('2027-05-01T00:00:00.000Z') }), NOW);
        expect(packCreditsLine(expired)).toBe(`2 of ${config.packPosts} posts used`);
        expect(packStatusLine(expired)).toBe(`Expired ${packDateLabel(new Date('2027-05-01T00:00:00.000Z'))}`);
        expect(packStatusLine(toPostPackView(row({ status: 'refunded', creditsRemaining: 0, creditsRevoked: 3 }), NOW))).toBe('Refunded');
        expect(packStatusLine(toPostPackView(row({ status: 'disputed' }), NOW))).toBe('Disputed');
    });

    it('the noun follows the total', () => {
        expect(packCreditsLine(toPostPackView(row({ creditsRemaining: 1 }), NOW))).toBe(`1 of ${config.packPosts} posts left`);
        // A refunded pack whose other credits were revoked holds one post.
        expect(packCreditsLine(toPostPackView(row({ status: 'refunded', creditsRemaining: 0, creditsRevoked: config.packPosts - 1 }), NOW))).toBe('1 of 1 post used');
    });

    it('a pack with every credit revoked and none used reads "No posts used", never "0 of 0"', () => {
        const view = toPostPackView(row({ status: 'refunded', creditsRemaining: 0, creditsRevoked: config.packPosts }), NOW);
        expect(packCreditsLine(view)).toBe('No posts used');
        expect(packStatusLine(view)).toBe('Refunded');
    });
});

describe('packInvoiceHref', () => {
    it("is Stripe's hosted invoice page, and null without one", () => {
        expect(packInvoiceHref(toPostPackView(row(), NOW))).toBe('https://invoice.stripe.test/i/abc');
        expect(packInvoiceHref(toPostPackView(row({ hostedInvoiceUrl: null }), NOW))).toBeNull();
    });

    it('never hands a page a link that is not https', () => {
        for (const hostedInvoiceUrl of ['', 'javascript:alert(1)', 'http://invoice.stripe.test/i/abc', ' https://invoice.stripe.test/i/abc']) {
            expect(packInvoiceHref({ hostedInvoiceUrl }), hostedInvoiceUrl).toBeNull();
        }
    });
});
