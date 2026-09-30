/**
 * lib/pricing-copy.ts: the pricing sentences switch at config.promoEndsAt,
 * evaluated per call, so no surface needs a deploy on the day the promo ends.
 */
import { describe, it, expect } from 'vitest';
import { config } from '@/lib/config';
import { LADDER_PRICES, PROMO_HEADLINE, PROMO_SUB, ladderLine } from '@/lib/pricing-copy';

const LAST_PROMO_SECOND = new Date('2027-01-01T09:59:59.000Z');
const LADDER_START = new Date(config.promoEndsAt);
const LATER = new Date('2027-03-15T12:00:00.000Z');

describe('ladderLine', () => {
    it('is dated while the promo runs, with the wording the surfaces already printed', () => {
        expect(ladderLine(LAST_PROMO_SECOND)).toBe(
            `From ${config.ladderStartsLabel}: your first post is $${config.introPrice}, every post after that is $${config.postingPrice}, or $${config.planPrice}/month for ${config.planSlots} active jobs.`,
        );
    });

    it('is the plain present-tense price from the instant the promo ends', () => {
        expect(ladderLine(LADDER_START)).toBe(LADDER_PRICES);
        expect(ladderLine(LATER)).toBe(LADDER_PRICES);
        expect(ladderLine(LATER)).not.toContain(config.ladderStartsLabel);
    });

    it('states every price from config, never a typed figure', () => {
        expect(LADDER_PRICES).toBe(
            `Your first post is $${config.introPrice}, every post after that is $${config.postingPrice}, or $${config.planPrice}/month for ${config.planSlots} active jobs.`,
        );
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
        for (const line of [PROMO_HEADLINE, PROMO_SUB, LADDER_PRICES, ladderLine(LAST_PROMO_SECOND)]) {
            expect(line).not.toMatch(/[–—]| - /);
        }
    });
});
