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
 *   PLAN_TERMS          — the plan's billing shape.
 *   PLAN_POSTS_LINE     — how a plan post actually lives: it runs
 *                         config.durationDays like every post, is never
 *                         renewed (create-renewal-checkout 409s it), and
 *                         frees its slot when it ends or is closed, so the
 *                         employer posts again into it at no extra charge.
 *                         Plan posts come down when the plan ends
 *                         (lib/employer-plan.ts#pausePlanPosts).
 *   PLAN_CANCEL_LINE    — a cancel keeps plan posts up through the paid
 *                         period (isPlanEntitled), never past a post's own
 *                         config.durationDays.
 *   FEATURES_LINE       — what EVERY post gets (no stripped tier).
 *   RENEWAL_LINE        — +60 days on a promo/intro/featured post; plan
 *                         posts are not renewable. Promo posts made before
 *                         the ladder stay renewable, so it stays true.
 *   RENEWAL_EFFECT_LINE — what a renewal does and nothing more: it moves the
 *                         end date (apply-renewal.ts via
 *                         lib/expires-at.ts#renewalExpiresAt). It does not
 *                         reset the post's unlock or InMail counts
 *                         (lib/tier-limits.ts counts them per posting since
 *                         it was created), so no copy may say so.
 *   RENEWAL_CAP_LINE    — the config.renewalCapDays ceiling on renewals.
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
    ladderLine,
    planPriceLine,
} from '@/lib/pricing-copy';

export const PLAN_TERMS = `${config.planSlots} active job slots while you're subscribed. Swap jobs any time. Cancel any time.`;
export const PLAN_POSTS_LINE = `Each plan post runs ${config.durationDays} days. When one ends, or you close it to swap in another role, its slot opens up and you can post into it again at no extra charge. Plan posts come down if the plan ends.`;
export const PLAN_CANCEL_LINE = `If you cancel, your plan posts stay up through the end of the period you paid for, or until their ${config.durationDays} days run out if that comes first.`;
export const FEATURES_LINE = `Featured badge · Top placement · ${config.limits.candidateUnlocksPerPosting} candidate unlocks · ${config.limits.inmailsPerPosting} InMails · Applicant analytics`;
export const RENEWAL_LINE = `Renew a promo, intro or featured post for $${config.renewalPrice} (+${config.durationDays} days).`;
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

const LISTING_RUN_PLAN = `Plan posts run the same ${config.durationDays} days and come down sooner only if the plan ends.`;

function planFaq(now: Date): PricingFaq {
    return {
        q: 'How does the Employer plan work?',
        a: `${planPriceLine(now)} ${PLAN_TERMS} ${PLAN_POSTS_LINE} Every slot is a full Featured post with the same ${config.limits.candidateUnlocksPerPosting} unlocks and ${config.limits.inmailsPerPosting} InMails. The plan is billed month to month. ${PLAN_CANCEL_LINE}`,
    };
}

/** While the promo runs: the page as it shipped on 2026-09-12. */
function promoCopy(now: Date): PricingPageCopy {
    const ladder = ladderLine(now);
    return {
        promoActive: true,
        eyebrow: 'Launch Pricing',
        headline: PROMO_HEADLINE,
        sub: PROMO_SUB,
        listingRun: `Every post runs ${config.durationDays} days with no daily budget and no bidding, promo posts included. ${LISTING_RUN_PLAN}`,
        ladderEyebrow: 'After the launch period',
        ladderHeading: `Starting ${config.ladderStartsLabel}`,
        ladderIntro: ladder,
        ladderNote: `Until then, every post is free, and every rung gets the same package: ${FEATURES_LINE}.`,
        ctaBlurb: `Every post is free through ${config.promoEndsLabel}, with all features included. From ${config.ladderStartsLabel}, from $${config.introPrice}.`,
        postCta: 'Post a Job: Free',
        packageSection: null,
        pricingFaqs: [
            { q: 'How long is posting free?', a: `${PROMO_HEADLINE}. ${PROMO_SUB} Promo posts run the full ${config.durationDays} days even if that runs past the promo, and they can be renewed like an intro or featured post.` },
            { q: `What happens on ${config.ladderStartsLabel}?`, a: `${ladder} ${RENEWAL_LINE} Every post, whether promo, intro, featured, or plan, gets exactly the same features. There is no stripped-down tier.` },
            INTRO_FAQ,
            planFaq(now),
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
        listingRun: `Every post runs ${config.durationDays} days with no daily budget and no bidding. ${LISTING_RUN_PLAN}`,
        ladderEyebrow: 'Per post or by the month',
        ladderHeading: 'Three ways to post',
        ladderIntro: ladderLine(now),
        ladderNote: `Every rung gets the same package: ${FEATURES_LINE}.`,
        ctaBlurb: `${LADDER_FROM_LINE} No bidding, no contracts.`,
        postCta: 'Post a Job',
        // The heading /for-employers gives the same grid, and the promo card's
        // own line without the promo.
        packageSection: {
            eyebrow: "What's Included",
            heading: 'Every Post Gets the Full Package',
            intro: 'No tiers. No downgrades. Whether intro, featured, or plan, you get everything.',
        },
        pricingFaqs: [
            { q: 'How much does it cost to post a job?', a: `${LADDER_PRICES} ${FULL_PACKAGE}` },
            { q: 'Do all prices include the same features?', a: 'Yes. Every post, whether intro, featured, or plan, gets exactly the same features. There is no stripped-down tier.' },
            INTRO_FAQ,
            planFaq(now),
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
