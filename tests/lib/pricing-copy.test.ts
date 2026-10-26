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
import {
    LADDER_PRICES,
    PACK_COMPARISON,
    PACK_FAQ_QUESTION,
    PACK_OFFER,
    PROMO_HEADLINE,
    PROMO_SUB,
    REFUND_ANSWER,
    RENEWAL_LINE,
    ladderLine,
    packDateLabel,
    packExpiresAtForUseBy,
    packFaqAnswer,
    packPriceLine,
    packUseByLabel,
    packUseByValue,
} from '@/lib/pricing-copy';

const LAST_PROMO_SECOND = new Date('2027-01-01T09:59:59.000Z');
const LADDER_START = new Date(config.promoEndsAt);
const LATER = new Date('2027-03-15T12:00:00.000Z');

/** The pack price as copy prints it ($1,245) and what one of its posts costs ($249). */
const PACK_PRICE = config.formatDollars(config.packPrice);
const PACK_PER_POST = config.formatDollars(config.packPrice / config.packPosts);

describe('ladderLine', () => {
    it('is dated while the promo runs', () => {
        expect(ladderLine(LAST_PROMO_SECOND)).toBe(
            `From ${config.ladderStartsLabel}: your first post is $${config.introPrice}, every post after that is $${config.postingPrice}, or buy ${config.packPosts} posts for ${PACK_PRICE}.`,
        );
    });

    it('is the plain present-tense price from the instant the promo ends', () => {
        expect(ladderLine(LADDER_START)).toBe(LADDER_PRICES);
        expect(ladderLine(LATER)).toBe(LADDER_PRICES);
        expect(ladderLine(LATER)).not.toContain(config.ladderStartsLabel);
    });

    it('states every price from config, never a typed figure, the 5-post pack included', () => {
        expect(LADDER_PRICES).toBe(
            `Your first post is $${config.introPrice}, every post after that is $${config.postingPrice}, or buy ${config.packPosts} posts for ${PACK_PRICE}.`,
        );
        expect(PACK_PRICE).toBe('$1,245');
    });
});

describe('RENEWAL_LINE', () => {
    it('names both renewal prices from config, the dearer one by the post price it renews, and pack posts at the base price', () => {
        expect(RENEWAL_LINE).toBe(
            `Renewals add ${config.durationDays} days: $${config.renewalPrice} for a promo, intro or pack post, $${config.proRenewalPrice} for a $${config.postingPrice} post.`,
        );
        // The two figures are the two rungs config maps a renewal to.
        expect(config.renewalPriceDollarsFor('base')).toBe(config.renewalPrice);
        expect(config.renewalPriceDollarsFor('pro')).toBe(config.proRenewalPrice);
    });
});

describe('the 5-post pack sentences (owner decisions 2026-10-24 and 2026-10-25)', () => {
    it('packPriceLine is dated while the promo runs, and plain once the ladder is live', () => {
        expect(packPriceLine(LAST_PROMO_SECOND)).toBe(`From ${config.ladderStartsLabel}, a ${config.packPosts}-post pack is ${PACK_PRICE}.`);
        for (const now of [LADDER_START, LATER]) {
            expect(packPriceLine(now)).toBe(`A ${config.packPosts}-post pack is ${PACK_PRICE}.`);
            expect(packPriceLine(now)).not.toContain(config.ladderStartsLabel);
        }
    });

    it('states the offer and the one comparison the owner allowed, never a saving', () => {
        expect(PACK_OFFER).toBe(`${config.packPosts} posts for ${PACK_PRICE}, ${PACK_PER_POST} a post`);
        expect(PACK_OFFER).toBe('5 posts for $1,245, $249 a post');
        expect(PACK_COMPARISON).toBe(`Bought one at a time at $${config.postingPrice}, five posts cost ${config.formatDollars(config.postingPrice * config.packPosts)}.`);
        expect(PACK_COMPARISON).toBe('Bought one at a time at $349, five posts cost $1,745.');
        for (const now of [LAST_PROMO_SECOND, LATER]) {
            for (const line of [PACK_OFFER, PACK_COMPARISON, packPriceLine(now), packFaqAnswer(now)]) {
                expect(line).not.toMatch(/\bsav(?:e|es|ing|ings)\b|\$500|discount/i);
            }
        }
    });

    it('the pack FAQ answers the terms: the price, the 12 months, the full package, the $199 renewal, the account and the intro price', () => {
        expect(PACK_FAQ_QUESTION).toBe(`How does the ${config.packPosts}-post pack work?`);
        for (const now of [LAST_PROMO_SECOND, LATER]) {
            expect(packFaqAnswer(now)).toBe(
                `${packPriceLine(now)} That is ${PACK_PER_POST} a post, to use within ${config.packValidityMonths} months of purchase. ${PACK_COMPARISON} Every pack post gets the full package and renews for $${config.renewalPrice}. The posts belong to the account that buys the pack, and buying a pack uses your company's intro price, so single posts after it are $${config.postingPrice}.`,
            );
        }
    });

    it('packUseByLabel names the last day the credits last in every US time zone, so it never names a day they miss', () => {
        // Bought on a US morning: expires that morning a year on, so the last
        // whole day is the day before in Hawaii, the last US zone.
        expect(packUseByLabel(new Date('2028-01-05T15:00:00.000Z'))).toBe('January 4, 2028');
        // Bought on a US evening, after UTC midnight: the UTC date would be a day late.
        expect(packUseByLabel(new Date('2028-06-11T01:00:00.000Z'))).toBe('June 9, 2028');
        // An expiry at midnight in Hawaii: the whole day before it is usable everywhere.
        expect(packUseByLabel(new Date('2028-01-05T10:00:00.000Z'))).toBe('January 4, 2028');
        // Across a leap day: the day before March 1, 2028 is February 29.
        expect(packUseByLabel(new Date('2028-03-01T12:00:00.000Z'))).toBe('February 29, 2028');
    });

    it('packDateLabel prints a pack date in the same zone, so the purchase and the use-by date read twelve months apart', () => {
        // Bought on a US evening, after UTC midnight: the date the buyer saw.
        expect(packDateLabel(new Date('2027-06-11T01:00:00.000Z'))).toBe('June 10, 2027');
        expect(packUseByLabel(new Date('2028-06-11T01:00:00.000Z'))).toBe('June 9, 2028');
    });
});

describe('the use-by date as an admin sets it (/admin/post-packs)', () => {
    it('packUseByValue is the date packUseByLabel prints, as YYYY-MM-DD for a date input', () => {
        expect(packUseByValue(new Date('2028-01-05T15:00:00.000Z'))).toBe('2028-01-04');
        expect(packUseByValue(new Date('2028-06-11T01:00:00.000Z'))).toBe('2028-06-09');
        expect(packUseByValue(new Date('2028-03-01T12:00:00.000Z'))).toBe('2028-02-29');
    });

    it('packExpiresAtForUseBy is the end of that day in Hawaii, so the pack reads "Use by" exactly that date', () => {
        expect(packExpiresAtForUseBy('2028-02-29')?.toISOString()).toBe('2028-03-01T10:00:00.000Z');
        for (const useBy of ['2028-02-29', '2027-12-31', '2028-01-01', '2029-06-30']) {
            const expiresAt = packExpiresAtForUseBy(useBy);
            expect(expiresAt, useBy).not.toBeNull();
            expect(packUseByValue(expiresAt as Date)).toBe(useBy);
        }
        expect(packUseByLabel(packExpiresAtForUseBy('2027-12-31') as Date)).toBe('December 31, 2027');
        // The credits then last through the whole day in every US zone: midnight in Hawaii is 5am in New York.
        expect((packExpiresAtForUseBy('2027-12-31') as Date).getTime()).toBe(Date.UTC(2028, 0, 1, 10));
    });

    it('packExpiresAtForUseBy refuses anything but a real calendar date', () => {
        for (const useBy of ['', '2027-02-29', '2027-13-01', '2027-04-31', '2027-1-5', '05/01/2027', '2027-05-01T00:00:00Z', '0099-01-01']) {
            expect(packExpiresAtForUseBy(useBy), useBy).toBeNull();
        }
    });
});

describe('the refund answer (owner decision 2026-10-25: all sales are final)', () => {
    it('says every sale is final and names only the two exceptions /terms keeps', () => {
        expect(REFUND_ANSWER).toBe(
            `All sales are final. Job posts, renewals and ${config.packPosts}-post packs are not refundable, and neither are pack posts left unused when the pack expires or a posting we remove for breaking our Terms. We refund only where the law requires it, and we correct a billing error, such as a charge made twice for the same post. Promo posts involve no payment.`,
        );
        expect(REFUND_ANSWER).not.toMatch(/7 days|case by case|sole discretion|generally non-refundable|if granted/i);
    });
});

describe('the Employer plan is retired from the shared sentences', () => {
    /** The retired plan's monthly price: config no longer holds it (phase 4 deleted the plan code). */
    const RETIRED_PLAN_PRICE = '$399';
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
            expect(text, name).not.toContain(RETIRED_PLAN_PRICE);
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
        for (const line of [
            PROMO_HEADLINE, PROMO_SUB, LADDER_PRICES, RENEWAL_LINE, ladderLine(LAST_PROMO_SECOND),
            PACK_OFFER, PACK_COMPARISON, REFUND_ANSWER, packPriceLine(LAST_PROMO_SECOND), packFaqAnswer(LAST_PROMO_SECOND), packFaqAnswer(LATER),
        ]) {
            expect(line).not.toMatch(/[–—]| - /);
        }
    });
});
