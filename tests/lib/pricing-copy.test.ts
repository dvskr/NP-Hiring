/**
 * lib/pricing-copy.ts: the pricing sentences switch at config.promoEndsAt,
 * evaluated per call, so no surface needs a deploy on the day the promo ends.
 *
 * 2027 re-price (owner decision 2026-10-24): the ladder is the intro price
 * then the posting price, the Employer plan is retired from every sentence,
 * and a renewal has two prices, which RENEWAL_LINE names by the post each
 * one renews.
 */
import { describe, it, expect } from 'vitest';
import { config } from '@/lib/config';
import * as pricingCopy from '@/lib/pricing-copy';
import { LADDER_PRICES, PROMO_HEADLINE, PROMO_SUB, RENEWAL_LINE, ladderLine } from '@/lib/pricing-copy';

const LAST_PROMO_SECOND = new Date('2027-01-01T09:59:59.000Z');
const LADDER_START = new Date(config.promoEndsAt);
const LATER = new Date('2027-03-15T12:00:00.000Z');

describe('ladderLine', () => {
    it('is dated while the promo runs', () => {
        expect(ladderLine(LAST_PROMO_SECOND)).toBe(
            `From ${config.ladderStartsLabel}: your first post is $${config.introPrice}, every post after that is $${config.postingPrice}.`,
        );
    });

    it('is the plain present-tense price from the instant the promo ends', () => {
        expect(ladderLine(LADDER_START)).toBe(LADDER_PRICES);
        expect(ladderLine(LATER)).toBe(LADDER_PRICES);
        expect(ladderLine(LATER)).not.toContain(config.ladderStartsLabel);
    });

    it('states every price from config, never a typed figure', () => {
        expect(LADDER_PRICES).toBe(
            `Your first post is $${config.introPrice}, every post after that is $${config.postingPrice}.`,
        );
    });
});

describe('RENEWAL_LINE', () => {
    it('names both renewal prices from config, the dearer one by the post price it renews', () => {
        expect(RENEWAL_LINE).toBe(
            `Renewals add ${config.durationDays} days: $${config.renewalPrice} for a promo or intro post, $${config.proRenewalPrice} for a $${config.postingPrice} post.`,
        );
        // The two figures are the two rungs config maps a renewal to.
        expect(config.renewalPriceDollarsFor('base')).toBe(config.renewalPrice);
        expect(config.renewalPriceDollarsFor('pro')).toBe(config.proRenewalPrice);
    });
});

describe('the Employer plan is retired from the shared sentences', () => {
    /** Every exported sentence, the clock-dependent ones on both sides of the switch. */
    const sentences = Object.entries(pricingCopy).flatMap(([name, value]) =>
        typeof value === 'function'
            ? [LAST_PROMO_SECOND, LATER].map((now) => [name, String((value as (at: Date) => unknown)(now))] as const)
            : [[name, String(value)] as const],
    );

    it('no sentence offers the plan, a monthly price or a slot count', () => {
        expect(sentences.length).toBeGreaterThanOrEqual(8);
        for (const [name, text] of sentences) {
            expect(text, name).not.toMatch(/\bplan\b|\/month|\bslots?\b|active jobs/i);
            expect(text, name).not.toContain(`$${config.planPrice}`);
        }
    });

    it('exports no plan sentence', () => {
        expect('planPriceLine' in pricingCopy).toBe(false);
    });
});

describe('the promo sentences', () => {
    it('carry their own end date and the full package', () => {
        expect(PROMO_HEADLINE).toBe(`Free through ${config.promoEndsLabel}`);
        expect(PROMO_SUB).toContain(`${config.durationDays}-day listing`);
        expect(PROMO_SUB).toContain(`${config.limits.candidateUnlocksPerPosting} candidate unlocks`);
        expect(PROMO_SUB).toContain(`${config.limits.inmailsPerPosting} InMails`);
    });

    it('use no dashes in visible text (house style)', () => {
        for (const line of [PROMO_HEADLINE, PROMO_SUB, LADDER_PRICES, RENEWAL_LINE, ladderLine(LAST_PROMO_SECOND)]) {
            expect(line).not.toMatch(/[–—]| - /);
        }
    });
});
