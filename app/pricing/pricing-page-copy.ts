/**
 * /pricing copy, split by the launch-promo clock (backlog 2.1).
 *
 * app/pricing/page.tsx calls pricingPageCopy(now) at render time and again
 * in generateMetadata, never at module load, and re-renders hourly, so the
 * page stops offering free posts on config.promoEndsAt without a deploy
 * (lib/pricing-copy.ts explains why module scope is not enough). While the
 * promo runs every string below is exactly what the page printed before;
 * afterwards the page states the ladder as the current price. A Next.js
 * page may export only Next's own names, so the builder lives here, where
 * tests/regressions/pricing-pages-phase-switch.test.ts calls it with both
 * dates.
 *
 * The lifecycle sentences are the CANONICAL copy strings the other employer
 * surfaces (/for-employers, /faq, /terms, the post-job wizard, emails)
 * repeat, and every number in them is a lib/config token. They hold in both
 * phases:
 *
 *   FEATURES_LINE       — what EVERY post gets (no stripped tier).
 *   RENEWAL_EFFECT_LINE — what a renewal does and nothing more: it moves the
 *                         end date (apply-renewal.ts via
 *                         lib/expires-at.ts#renewalExpiresAt). It does not
 *                         reset the post's unlock or InMail counts
 *                         (lib/tier-limits.ts counts them per posting since
 *                         it was created), so no copy may say so.
 *   RENEWAL_CAP_LINE    — the config.renewalCapDays ceiling on renewals.
 *
 * The renewal PRICES are lib/pricing-copy.ts#RENEWAL_LINE, shared with every
 * surface that states them. The Employer plan is retired (owner decision,
 * 2026-10-24): neither phase offers it, and nothing here reads its price or
 * slot count.
 */
import { brand } from '@/config/brand';
import { config } from '@/lib/config';
import {
    FULL_PACKAGE,
    LADDER_FROM_LINE,
    LADDER_HEADLINE,
    LADDER_PRICES,
    PROMO_HEADLINE,
    PROMO_SUB,
    RENEWAL_LINE,
    ladderLine,
} from '@/lib/pricing-copy';

export const FEATURES_LINE = `Featured badge · Top placement · ${config.limits.candidateUnlocksPerPosting} candidate unlocks · ${config.limits.inmailsPerPosting} InMails · Applicant analytics`;
export const RENEWAL_EFFECT_LINE = `A renewal adds ${config.durationDays} days to the post: to its current end date while it is still live, or from the day you renew once it has ended. It does not add unlocks or InMails: a post has ${config.limits.candidateUnlocksPerPosting} unlocks and ${config.limits.inmailsPerPosting} InMails in total, however many times it is renewed.`;
export const RENEWAL_CAP_LINE = `Renewals can extend a post to at most ${config.renewalCapDays} days after it was first posted.`;

export interface PricingFaq {
    q: string;
    a: string;
}

/** Everything on /pricing (and in its metadata) that depends on the promo clock. */
export interface PricingPageCopy {
    /** config.isPromoActive(now): the $0 promo card renders only while true. */
    promoActive: boolean;
    eyebrow: string;
    headline: string;
    sub: string;
    /** Body of the listing-duration card. */
    listingRun: string;
    ladderEyebrow: string;
    ladderHeading: string;
    ladderIntro: string;
    ladderNote: string;
    /** Body of the comparison section's CTA card. */
    ctaBlurb: string;
    /** The post-a-job button: that CTA card, and the hero once the promo card is gone. */
    postCta: string;
    /**
     * The heading over the feature grid. Null while the promo runs: the $0
     * promo card leads the grid then, and carries the grid's heading and the
     * page's first button itself. Once that card is gone the page needs both,
     * or its H1 runs straight into the H3 feature cards and the first button
     * sits below the whole grid.
     */
    packageSection: { eyebrow: string; heading: string; intro: string } | null;
    /**
     * The leading FAQ entries, in page order; the page appends the evergreen
     * ones. They feed the FAQPage JSON-LD as well as the accordion.
     */
    pricingFaqs: PricingFaq[];
    meta: {
        title: string;
        description: string;
        ogDescription: string;
        ogImageTitle: string;
    };
}

/** True in both phases: "posts made free during the launch promo" is history once it ends. */
const INTRO_FAQ: PricingFaq = {
    q: 'What is the intro price, and who gets it?',
    a: `The intro price ($${config.introPrice}) applies to the first paid post per company email domain. It is scoped to your organization, not to a login, and posts made free during the launch promo don't use it up.`,
};

/** While the promo runs: the promo first, then the ladder dated from its start. */
function promoCopy(now: Date): PricingPageCopy {
    const ladder = ladderLine(now);
    return {
        promoActive: true,
        eyebrow: 'Launch Pricing',
        headline: PROMO_HEADLINE,
        sub: PROMO_SUB,
        listingRun: `Every post runs ${config.durationDays} days with no daily budget and no bidding, promo posts included.`,
        ladderEyebrow: 'After the launch period',
        ladderHeading: `Starting ${config.ladderStartsLabel}`,
        ladderIntro: ladder,
        ladderNote: `Until then, every post is free, and every rung gets the same package: ${FEATURES_LINE}.`,
        ctaBlurb: `Every post is free through ${config.promoEndsLabel}, with all features included. From ${config.ladderStartsLabel}, from $${config.introPrice}.`,
        postCta: 'Post a Job: Free',
        packageSection: null,
        pricingFaqs: [
            { q: 'How long is posting free?', a: `${PROMO_HEADLINE}. ${PROMO_SUB} Promo posts run the full ${config.durationDays} days even if that runs past the promo, and they can be renewed like an intro or featured post.` },
            { q: `What happens on ${config.ladderStartsLabel}?`, a: `${ladder} ${RENEWAL_LINE} Every post, whether promo, intro, or featured, gets exactly the same features. There is no stripped-down tier.` },
            INTRO_FAQ,
        ],
        meta: {
            title: `Pricing | ${brand.niche.short} Job Board | Free Through ${config.promoEndsLabel}`,
            description: `Every ${brand.niche.short} job post is free through ${config.promoEndsLabel}, all features included. ${ladder} No bidding, no contracts.`,
            ogDescription: `Post ${brand.niche.short} jobs free through ${config.promoEndsLabel}. ${ladder} Every post gets the full package.`,
            ogImageTitle: `Pricing: free through ${config.promoEndsLabel}`,
        },
    };
}

/**
 * Once the ladder is live: the prices in the present tense. No "free", no
 * "launch period", no dated "From <ladderStartsLabel>"; promo posts appear
 * only as history (the intro answer, the renewal line).
 */
function ladderCopy(now: Date): PricingPageCopy {
    return {
        promoActive: false,
        eyebrow: 'Pricing',
        headline: LADDER_HEADLINE,
        sub: `${ladderLine(now)} ${FULL_PACKAGE}`,
        listingRun: `Every post runs ${config.durationDays} days with no daily budget and no bidding.`,
        // Register D17: plain per-post wording where "Per post or by the
        // month" and "Three ways to post" stood while the plan was on sale.
        ladderEyebrow: 'Per post',
        ladderHeading: 'What a post costs',
        ladderIntro: ladderLine(now),
        ladderNote: `Every rung gets the same package: ${FEATURES_LINE}.`,
        ctaBlurb: `${LADDER_FROM_LINE} No bidding, no contracts.`,
        postCta: 'Post a Job',
        // The heading /for-employers gives the same grid, and the promo card's
        // own line without the promo.
        packageSection: {
            eyebrow: "What's Included",
            heading: 'Every Post Gets the Full Package',
            intro: 'No tiers. No downgrades. Whether intro or featured, you get everything.',
        },
        pricingFaqs: [
            { q: 'How much does it cost to post a job?', a: `${LADDER_PRICES} ${FULL_PACKAGE}` },
            { q: 'Do all prices include the same features?', a: 'Yes. Every post, whether intro or featured, gets exactly the same features. There is no stripped-down tier.' },
            INTRO_FAQ,
        ],
        meta: {
            title: `Pricing | ${brand.niche.short} Job Board | Posts From $${config.introPrice}`,
            description: `Every ${brand.niche.short} job post includes all features. ${LADDER_PRICES} No bidding, no contracts.`,
            ogDescription: `Post ${brand.niche.short} jobs from $${config.introPrice}. ${LADDER_PRICES} Every post gets the full package.`,
            ogImageTitle: `Pricing: posts from $${config.introPrice}`,
        },
    };
}

/** The /pricing copy for `now`. Call it per render, never at module load. */
export function pricingPageCopy(now: Date): PricingPageCopy {
    return config.isPromoActive(now) ? promoCopy(now) : ladderCopy(now);
}
