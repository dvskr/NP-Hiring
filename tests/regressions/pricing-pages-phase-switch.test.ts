/**
 * Backlog 2.1, package M1: /pricing, /for-employers and /faq state the launch
 * promo while it runs and the ladder as the current price afterwards, and
 * switch on their own at config.promoEndsAt.
 *
 * Before: all three printed "free through December 31, 2026" from module
 * scope or plain JSX, /faq had no revalidate (fully static), and /pricing
 * and /for-employers exported static metadata, so in 2027 they would have
 * kept advertising free posting (in the page, the FAQPage JSON-LD and the OG
 * card) until someone deployed.
 *
 * After: each page reads a sibling copy builder per render (and in
 * generateMetadata) and re-renders at least hourly. These tests
 *   1. call each builder on both sides of the switch: the promo output is
 *      what shipped, the ladder output states today's prices in the present
 *      tense and offers nothing free;
 *   2. render the REAL pages and their metadata from one module instance
 *      under a fake clock on both sides, so a page that ignores its builder
 *      or decides the phase at module load fails here;
 *   3. pin the hourly revalidate and the server-decided promo flag that the
 *      "How employers hire" client component receives.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Metadata } from 'next';
import { brand } from '@/config/brand';
import { config } from '@/lib/config';
import {
    FULL_PACKAGE,
    LADDER_FROM_LINE,
    LADDER_HEADLINE,
    LADDER_PRICES,
    PROMO_HEADLINE,
    PROMO_SUB,
    planPriceLine,
} from '@/lib/pricing-copy';
import { FEATURES_LINE, RENEWAL_LINE, pricingPageCopy } from '@/app/pricing/pricing-page-copy';
import { forEmployersCopy } from '@/app/for-employers/for-employers-copy';
import { employerPricingFaqs } from '@/app/faq/faq-employer-copy';
import * as pricingPage from '@/app/pricing/page';
import * as employersPage from '@/app/for-employers/page';
import * as faqPage from '@/app/faq/page';
import EmployerHowItWorks from '@/components/EmployerHowItWorks';

// The two async server components on /for-employers read the database; the
// page is rendered around them.
vi.mock('@/components/FeaturedTestimonials', () => ({ default: () => null }));
vi.mock('@/components/tools/EmployerBenchmarkWidget', () => ({ default: () => null }));

const DURING_PROMO = new Date('2026-12-31T12:00:00.000Z');
const LAST_PROMO_SECOND = new Date('2027-01-01T09:59:59.000Z');
const LADDER_START = new Date(config.promoEndsAt);
const LATER = new Date('2027-03-15T12:00:00.000Z');
const PROMO_TIMES = [DURING_PROMO, LAST_PROMO_SECOND] as const;
const LADDER_TIMES = [LADDER_START, LATER] as const;
const DASHES = /[–—]|\s-\s/;

/**
 * Free posting, or the dated ladder, stated as a current offer. Posts made
 * free during the launch promo may still be named as history (the intro
 * price answer, the renewal line), so the bare word "free" is not listed.
 */
const PROMO_OFFER: readonly [RegExp, string][] = [
    [/free through/i, 'the promo headline'],
    [/\b(is|are) free\b/i, 'posting stated as free'],
    [/launch period/i, 'the launch period as current'],
    [/no (credit )?card required/i, 'the promo sign-up hook'],
    [/\$0\b|\bFREE\b|\(launch promo\)/, 'a zero price'],
    [/Launch (Promo|Pricing)/, 'a promo label'],
    [/Post a Job: Free/, 'the free CTA'],
    [/until then/i, 'a countdown to the ladder'],
    [new RegExp(config.ladderStartsLabel), 'the ladder announced for a date that has passed'],
    [new RegExp(config.promoEndsLabel), 'the promo end date'],
];
const offersIn = (text: string): string[] =>
    PROMO_OFFER.filter(([pattern]) => pattern.test(text)).map(([pattern, why]) => `${pattern}: ${why}`);

/** Every string value in a copy object, for the house-style checks. */
const strings = (value: unknown): string[] =>
    typeof value === 'string'
        ? [value]
        : value && typeof value === 'object'
            ? Object.values(value).flatMap(strings)
            : [];

afterEach(() => {
    vi.useRealTimers();
});

/** Run `fn` with the system clock at `now` (only Date is faked). */
async function atClock<T>(now: Date, fn: () => T | Promise<T>): Promise<T> {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    try {
        return await fn();
    } finally {
        vi.useRealTimers();
    }
}

interface FaqEntity {
    name: string;
    text: string;
}

/** The FAQPage JSON-LD a page rendered, as question and answer text. */
function faqEntities(html: string): FaqEntity[] {
    for (const [, json] of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
        const data = JSON.parse(json) as {
            '@type'?: string;
            mainEntity?: { name: string; acceptedAnswer: { text: string } }[];
        };
        if (data['@type'] === 'FAQPage') {
            return (data.mainEntity ?? []).map((q) => ({ name: q.name, text: q.acceptedAnswer.text }));
        }
    }
    throw new Error('no FAQPage JSON-LD');
}

/** The title the edge OG card is asked to print, and the twitter card agrees. */
function ogCardTitle(meta: Metadata): string {
    const images = meta.openGraph?.images as { url: string }[];
    const twitter = meta.twitter as { images: string[] };
    expect(twitter.images).toEqual([images[0].url]);
    return new URL(images[0].url).searchParams.get('title') ?? '';
}

/** The headings of a rendered page, in document order, as [level, text]. */
function headingOutline(html: string): [number, string][] {
    return [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g)].map(([, level, inner]) => [
        Number(level),
        inner.replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim(),
    ]);
}

/** A heading may open a section one level down, never skip a level (axe heading-order). */
function skippedLevels(outline: [number, string][]): string[] {
    return outline.filter(([level], i) => level > (i === 0 ? 0 : outline[i - 1][0]) + 1).map(([level, text]) => `h${level} ${text}`);
}

const renderPricing = (): string => renderToStaticMarkup(React.createElement(pricingPage.default));
const renderEmployers = async (): Promise<string> => renderToStaticMarkup(await employersPage.default());
const renderFaq = (): string => renderToStaticMarkup(React.createElement(faqPage.default));

describe('lib/pricing-copy: the ladder-phase sentences the pages share', () => {
    it('planPriceLine is dated while the promo runs and the plain price from the switch', () => {
        for (const now of PROMO_TIMES) {
            expect(planPriceLine(now)).toBe(`From ${config.ladderStartsLabel}, the Employer plan is $${config.planPrice}/month.`);
        }
        for (const now of LADDER_TIMES) {
            expect(planPriceLine(now)).toBe(`The Employer plan is $${config.planPrice}/month.`);
        }
    });

    it('states the headline, the package and the entry price from config, with no promo offer', () => {
        expect(LADDER_HEADLINE).toBe('Simple per-post pricing');
        expect(FULL_PACKAGE).toBe(
            `Every post gets the full package: ${config.durationDays}-day listing, Featured badge, top placement, ${config.limits.candidateUnlocksPerPosting} candidate unlocks and ${config.limits.inmailsPerPosting} InMails.`,
        );
        expect(LADDER_FROM_LINE).toBe(`Posts start at $${config.introPrice}, with all features included.`);
        for (const line of [LADDER_HEADLINE, FULL_PACKAGE, LADDER_FROM_LINE, planPriceLine(LADDER_START)]) {
            expect(offersIn(line), line).toEqual([]);
            expect(line).not.toMatch(DASHES);
        }
    });
});

describe('/pricing: the copy builder', () => {
    it('keeps the promo page as it shipped, up to the last promo second', () => {
        for (const now of PROMO_TIMES) {
            const copy = pricingPageCopy(now);
            expect(copy.promoActive).toBe(true);
            expect(copy.eyebrow).toBe('Launch Pricing');
            expect(copy.headline).toBe(PROMO_HEADLINE);
            expect(copy.sub).toBe(PROMO_SUB);
            expect(copy.listingRun).toBe(
                `Every post runs ${config.durationDays} days with no daily budget and no bidding, promo posts included. Plan posts run the same ${config.durationDays} days and come down sooner only if the plan ends.`,
            );
            expect(copy.ladderEyebrow).toBe('After the launch period');
            expect(copy.ladderHeading).toBe(`Starting ${config.ladderStartsLabel}`);
            expect(copy.ladderIntro).toBe(
                `From ${config.ladderStartsLabel}: your first post is $${config.introPrice}, every post after that is $${config.postingPrice}, or $${config.planPrice}/month for ${config.planSlots} active jobs.`,
            );
            expect(copy.ladderNote).toBe(`Until then, every post is free, and every rung gets the same package: ${FEATURES_LINE}.`);
            expect(copy.ctaBlurb).toBe(
                `Every post is free through ${config.promoEndsLabel}, with all features included. From ${config.ladderStartsLabel}, from $${config.introPrice}.`,
            );
            expect(copy.postCta).toBe('Post a Job: Free');
            // The promo card leads the feature grid and carries its heading.
            expect(copy.packageSection).toBeNull();
            expect(copy.pricingFaqs.map((f) => f.q)).toEqual([
                'How long is posting free?',
                `What happens on ${config.ladderStartsLabel}?`,
                'What is the intro price, and who gets it?',
                'How does the Employer plan work?',
            ]);
            expect(copy.pricingFaqs[0].a).toBe(
                `${PROMO_HEADLINE}. ${PROMO_SUB} Promo posts run the full ${config.durationDays} days even if that runs past the promo, and they can be renewed like an intro or featured post.`,
            );
            expect(copy.pricingFaqs[1].a).toBe(
                `${copy.ladderIntro} ${RENEWAL_LINE} Every post, whether promo, intro, featured, or plan, gets exactly the same features. There is no stripped-down tier.`,
            );
            expect(copy.meta).toEqual({
                title: `Pricing | ${brand.niche.short} Job Board | Free Through ${config.promoEndsLabel}`,
                description: `Every ${brand.niche.short} job post is free through ${config.promoEndsLabel}, all features included. ${copy.ladderIntro} No bidding, no contracts.`,
                ogDescription: `Post ${brand.niche.short} jobs free through ${config.promoEndsLabel}. ${copy.ladderIntro} Every post gets the full package.`,
                ogImageTitle: `Pricing: free through ${config.promoEndsLabel}`,
            });
        }
    });

    it('states the ladder as the current price from the switch instant, and offers nothing free', () => {
        for (const now of LADDER_TIMES) {
            const copy = pricingPageCopy(now);
            expect(copy.promoActive).toBe(false);
            expect(copy.eyebrow).toBe('Pricing');
            expect(copy.headline).toBe(LADDER_HEADLINE);
            expect(copy.sub).toBe(`${LADDER_PRICES} ${FULL_PACKAGE}`);
            expect(copy.listingRun).toBe(
                `Every post runs ${config.durationDays} days with no daily budget and no bidding. Plan posts run the same ${config.durationDays} days and come down sooner only if the plan ends.`,
            );
            expect(copy.ladderIntro).toBe(LADDER_PRICES);
            expect(copy.ladderNote).toBe(`Every rung gets the same package: ${FEATURES_LINE}.`);
            expect(copy.ctaBlurb).toBe(`${LADDER_FROM_LINE} No bidding, no contracts.`);
            expect(copy.postCta).toBe('Post a Job');
            expect(copy.packageSection).toEqual({
                eyebrow: "What's Included",
                heading: 'Every Post Gets the Full Package',
                intro: 'No tiers. No downgrades. Whether intro, featured, or plan, you get everything.',
            });
            expect(copy.meta.title).toBe(`Pricing | ${brand.niche.short} Job Board | Posts From $${config.introPrice}`);
            expect(copy.meta.ogImageTitle).toBe(`Pricing: posts from $${config.introPrice}`);
            expect(copy.meta.description).toContain(LADDER_PRICES);
            expect(offersIn(JSON.stringify(copy))).toEqual([]);
            for (const line of strings(copy)) expect(line, line).not.toMatch(DASHES);
        }
    });

    it('turns the two promo FAQ entries into present-tense price answers', () => {
        const [cost, features, intro, plan] = pricingPageCopy(LADDER_START).pricingFaqs;
        expect(cost).toEqual({ q: 'How much does it cost to post a job?', a: `${LADDER_PRICES} ${FULL_PACKAGE}` });
        expect(features).toEqual({
            q: 'Do all prices include the same features?',
            a: 'Yes. Every post, whether intro, featured, or plan, gets exactly the same features. There is no stripped-down tier.',
        });
        // The intro answer is true in both phases: promo posts are history.
        expect(intro).toEqual(pricingPageCopy(DURING_PROMO).pricingFaqs[2]);
        expect(intro.a).toContain("posts made free during the launch promo don't use it up");
        expect(plan.a.startsWith(`The Employer plan is $${config.planPrice}/month.`)).toBe(true);
    });
});

describe('/pricing: the rendered page and its metadata follow the clock', () => {
    it('re-renders hourly and builds its metadata per request, not at build', () => {
        expect(pricingPage.revalidate).toBe(3600);
        expect(typeof pricingPage.generateMetadata).toBe('function');
        expect('metadata' in pricingPage).toBe(false);
    });

    it('renders the promo page while the promo runs', async () => {
        const html = await atClock(DURING_PROMO, renderPricing);
        expect(html).toContain('Launch Pricing');
        expect(html).toContain(PROMO_HEADLINE);
        expect(html).toContain('Launch Promo');
        expect(html).toContain('>$0<');
        expect(html).toContain('Post a Job: Free');
        expect(html).toContain(`Starting ${config.ladderStartsLabel}`);
        const faqs = faqEntities(html);
        expect(faqs[0].name).toBe('How long is posting free?');
        expect(faqs.map((f) => f.name)).toContain('What does renewal cost?');
    });

    it('renders the ladder from the same module once the promo has ended', async () => {
        for (const now of LADDER_TIMES) {
            const html = await atClock(now, renderPricing);
            expect(html).toContain('>Pricing<');
            expect(html).toContain(`>${LADDER_HEADLINE}<`);
            expect(html).toContain('Three ways to post');
            expect(html).not.toContain('Full Package on Every Post');
            expect(offersIn(html)).toEqual([]);
            const faqs = faqEntities(html);
            // The JSON-LD is the visible list: the clock's entries, then the evergreen ones.
            const copy = pricingPageCopy(now);
            expect(faqs.slice(0, copy.pricingFaqs.length)).toEqual(copy.pricingFaqs.map(({ q, a }) => ({ name: q, text: a })));
            expect(faqs[0]).toEqual({ name: 'How much does it cost to post a job?', text: `${LADDER_PRICES} ${FULL_PACKAGE}` });
            expect(faqs.map((f) => f.name)).toContain('What does renewal cost?');
        }
    });

    describe('the heading outline and the first button, with and without the promo card', () => {
        const FEATURE_CARDS = [
            `${config.durationDays}-Day Listing`,
            'Featured Badge',
            'Top Search Placement',
            'Daily Job Alerts',
            `${config.limits.candidateUnlocksPerPosting} Candidate Unlocks`,
            `${config.limits.inmailsPerPosting} InMails`,
            'Live Analytics',
        ].map((title): [number, string] => [3, title]);
        const afterTheGrid = (ladderHeading: string): [number, string][] => [
            [2, ladderHeading],
            [3, `${config.getTierLabel('intro')} post`],
            [3, 'Featured post'],
            [3, 'Employer plan'],
            [2, 'How We Compare'],
            [3, `Ready to Hire Your Next ${brand.niche.short}?`],
            [2, 'Frequently Asked Questions'],
        ];
        /** Where the first link to /post-job sits relative to the feature grid, and its label. */
        const firstPostJobLink = (html: string): { aboveTheGrid: boolean; label: string } => {
            const link = html.match(/<a\b[^>]*href="\/post-job"[^>]*>([\s\S]*?)<\/a>/);
            const grid = html.indexOf('class="bento-grid"');
            expect(link, 'a link to /post-job').not.toBeNull();
            expect(grid, 'the feature grid').toBeGreaterThan(-1);
            return { aboveTheGrid: (link?.index ?? Infinity) < grid, label: (link?.[1] ?? '').replace(/<[^>]+>/g, '').trim() };
        };

        it('while the promo runs the promo card carries both, exactly as before', async () => {
            const html = await atClock(DURING_PROMO, renderPricing);
            const outline = headingOutline(html);
            expect(outline).toEqual([
                [1, PROMO_HEADLINE],
                [2, 'Full Package on Every Post'],
                ...FEATURE_CARDS,
                ...afterTheGrid(`Starting ${config.ladderStartsLabel}`),
            ]);
            expect(skippedLevels(outline)).toEqual([]);
            // The first button is the promo card's, inside the grid; the hero has none.
            expect(firstPostJobLink(html)).toEqual({ aboveTheGrid: false, label: 'Post a Job: Free' });
            expect(html).not.toContain('Every Post Gets the Full Package');
        });

        it('once the promo card is gone the feature grid has its own H2 and the hero has the button', async () => {
            // The promo card held the only H2 above the grid and the page's
            // first button. Without them the ladder page ran its H1 straight
            // into seven H3 cards (a skipped heading level), and the first
            // button sat below the whole grid.
            for (const now of LADDER_TIMES) {
                const html = await atClock(now, renderPricing);
                const outline = headingOutline(html);
                expect(outline).toEqual([
                    [1, LADDER_HEADLINE],
                    [2, 'Every Post Gets the Full Package'],
                    ...FEATURE_CARDS,
                    ...afterTheGrid('Three ways to post'),
                ]);
                expect(skippedLevels(outline)).toEqual([]);
                expect(firstPostJobLink(html)).toEqual({ aboveTheGrid: true, label: 'Post a Job' });
                expect(html).toContain('No tiers. No downgrades. Whether intro, featured, or plan, you get everything.');
            }
        });
    });

    it('builds the title, description and OG card for the clock it runs at', async () => {
        const promo = await atClock(DURING_PROMO, () => pricingPage.generateMetadata());
        expect(promo.title).toBe(`Pricing | ${brand.niche.short} Job Board | Free Through ${config.promoEndsLabel}`);
        expect(ogCardTitle(promo)).toBe(`Pricing: free through ${config.promoEndsLabel}`);

        const ladder = await atClock(LADDER_START, () => pricingPage.generateMetadata());
        expect(ladder.title).toBe(`Pricing | ${brand.niche.short} Job Board | Posts From $${config.introPrice}`);
        expect(ladder.description).toBe(`Every ${brand.niche.short} job post includes all features. ${LADDER_PRICES} No bidding, no contracts.`);
        expect(ladder.openGraph?.description).toBe(`Post ${brand.niche.short} jobs from $${config.introPrice}. ${LADDER_PRICES} Every post gets the full package.`);
        expect(ogCardTitle(ladder)).toBe(`Pricing: posts from $${config.introPrice}`);
        expect(offersIn(JSON.stringify(ladder))).toEqual([]);
        expect(ladder.alternates?.canonical).toBe(`${brand.baseUrl}/pricing`);
    });
});

describe('/for-employers: the copy builder', () => {
    it('keeps the promo page as it shipped, up to the last promo second', () => {
        for (const now of PROMO_TIMES) {
            const copy = forEmployersCopy(now);
            const ladder = `From ${config.ladderStartsLabel}: your first post is $${config.introPrice}, every post after that is $${config.postingPrice}, or $${config.planPrice}/month for ${config.planSlots} active jobs.`;
            expect(copy.promoActive).toBe(true);
            expect(copy.headline).toBe(PROMO_HEADLINE);
            expect(copy.postCta).toBe('Post a Job: Free');
            expect(copy.receiptTotal).toBe('FREE (launch promo)');
            expect(copy.receiptStamp).toBe(PROMO_HEADLINE);
            expect(copy.ladder).toBe(ladder);
            expect(copy.bentoEyebrow).toBe(`Free Through ${config.promoEndsLabel} · Then From $${config.introPrice}`);
            expect(copy.bentoIntro).toBe('No tiers. No feature gates. Promo, intro, featured, or plan: every listing gets the same premium treatment.');
            expect(copy.listingRun).toBe(
                `Every job runs ${config.durationDays} days with no daily budget and no bidding. Promo posts get the same run and the same features; plan posts run the same ${config.durationDays} days and come down sooner only if the plan ends.`,
            );
            expect(copy.ctaBlurb).toBe(
                `Every post is free through ${config.promoEndsLabel} with all features included. From ${config.ladderStartsLabel}, from $${config.introPrice}.`,
            );
            expect(copy.pricingFaqs.map((f) => f.q)).toEqual([
                `How much does it cost to hire on ${brand.name}?`,
                'What does every job post include?',
                'How does the Employer plan work?',
            ]);
            expect(copy.pricingFaqs[0].a).toBe(
                `${PROMO_HEADLINE}. ${PROMO_SUB} ${ladder} Renew a promo, intro or featured post for $${config.renewalPrice} (+${config.durationDays} days). No pay-per-click bidding, no contracts.`,
            );
            expect(copy.pricingFaqs[1].a.startsWith('Every post (free during the promo, intro, featured, or posted from an Employer plan slot) includes the full package')).toBe(true);
            expect(copy.meta).toEqual({
                description: `Hire ${brand.niche.long}s. Every post is free through ${config.promoEndsLabel} with all features included. Reach candidates actively searching for ${brand.niche.short} roles.`,
                ogImageTitle: `Hire ${brand.niche.short}s: free through ${config.promoEndsLabel}`,
            });
        }
    });

    it('states the ladder as the current price from the switch instant, and offers nothing free', () => {
        for (const now of LADDER_TIMES) {
            const copy = forEmployersCopy(now);
            expect(copy.promoActive).toBe(false);
            expect(copy.headline).toBe(LADDER_HEADLINE);
            expect(copy.postCta).toBe('Post a Job');
            expect(copy.receiptTotal).toBe(`From $${config.introPrice}`);
            expect(copy.receiptStamp).toBe('No bidding, no contracts');
            expect(copy.ladder).toBe(LADDER_PRICES);
            expect(copy.bentoEyebrow).toBe(`Flat Per-Post Pricing · From $${config.introPrice}`);
            expect(copy.bentoIntro).toBe('No tiers. No feature gates. Intro, featured, or plan: every listing gets the same premium treatment.');
            expect(copy.listingRun).toBe(
                `Every job runs ${config.durationDays} days with no daily budget and no bidding. Plan posts run the same ${config.durationDays} days and come down sooner only if the plan ends.`,
            );
            expect(copy.ctaBlurb).toBe(`${LADDER_FROM_LINE} No bidding, no contracts.`);
            expect(copy.pricingFaqs[0].a).toBe(
                `${LADDER_PRICES} ${FULL_PACKAGE} Renew a promo, intro or featured post for $${config.renewalPrice} (+${config.durationDays} days). No pay-per-click bidding, no contracts.`,
            );
            expect(copy.pricingFaqs[1].a.startsWith('Every post (intro, featured, or posted from an Employer plan slot) includes the full package')).toBe(true);
            expect(copy.pricingFaqs[2].a.startsWith(`The Employer plan is $${config.planPrice}/month.`)).toBe(true);
            expect(copy.meta).toEqual({
                description: `Hire ${brand.niche.long}s. ${LADDER_FROM_LINE} Reach candidates actively searching for ${brand.niche.short} roles.`,
                ogImageTitle: `Hire ${brand.niche.short}s: posts from $${config.introPrice}`,
            });
            expect(offersIn(JSON.stringify(copy))).toEqual([]);
            for (const line of strings(copy)) expect(line, line).not.toMatch(DASHES);
        }
    });
});

describe('/for-employers: the rendered page and its metadata follow the clock', () => {
    it('re-renders hourly and builds its metadata per request, not at build', () => {
        expect(employersPage.revalidate).toBe(3600);
        expect(typeof employersPage.generateMetadata).toBe('function');
        expect('metadata' in employersPage).toBe(false);
    });

    it('renders the promo receipt, CTAs and "How employers hire" button while the promo runs', async () => {
        const html = await atClock(DURING_PROMO, renderEmployers);
        expect(html).toContain(`${PROMO_HEADLINE}.<br/>`);
        expect(html).toContain('FREE (launch promo)');
        expect(html).toContain('Post a Job: Free');
        expect(html).toContain(`Post a Job (Free Through ${config.promoEndsLabel})`);
        expect(faqEntities(html)[0].name).toBe(`How much does it cost to hire on ${brand.name}?`);
    });

    it('renders the ladder from the same module once the promo has ended', async () => {
        for (const now of LADDER_TIMES) {
            const html = await atClock(now, renderEmployers);
            expect(html).toContain(`${LADDER_HEADLINE}.<br/>`);
            expect(html).toContain(`From $${config.introPrice}`);
            expect(html).toContain('No bidding, no contracts');
            expect(offersIn(html)).toEqual([]);
            // The client component got the server's flag: no promo CTA.
            expect(html).not.toMatch(/Free Through/i);
            const faqs = faqEntities(html);
            const copy = forEmployersCopy(now);
            expect(faqs.slice(0, copy.pricingFaqs.length)).toEqual(copy.pricingFaqs.map(({ q, a }) => ({ name: q, text: a })));
            // The evergreen entries follow, the screening commitment included.
            expect(faqs.map((f) => f.name)).toContain('Who sees my job posting?');
            expect(faqs.find((f) => f.name === 'Who sees my job posting?')?.text).toContain(
                'listings are screened at ingest and removed when flagged out of scope',
            );
        }
    });

    it('builds the description and OG card for the clock it runs at', async () => {
        const promo = await atClock(DURING_PROMO, () => employersPage.generateMetadata());
        expect(promo.description).toContain(`free through ${config.promoEndsLabel}`);
        expect(ogCardTitle(promo)).toBe(`Hire ${brand.niche.short}s: free through ${config.promoEndsLabel}`);

        const ladder = await atClock(LADDER_START, () => employersPage.generateMetadata());
        expect(ladder.title).toBe(`For Employers | Hire ${brand.niche.short}s | ${brand.niche.short} Job Board`);
        expect(ladder.description).toBe(`Hire ${brand.niche.long}s. ${LADDER_FROM_LINE} Reach candidates actively searching for ${brand.niche.short} roles.`);
        expect(ogCardTitle(ladder)).toBe(`Hire ${brand.niche.short}s: posts from $${config.introPrice}`);
        expect(offersIn(JSON.stringify(ladder))).toEqual([]);
        expect(ladder.alternates?.canonical).toBe(`${brand.baseUrl}/for-employers`);
    });
});

describe('/faq: the employer pricing answers follow the clock', () => {
    it('keeps the promo answers as they shipped, up to the last promo second', () => {
        for (const now of PROMO_TIMES) {
            const [cost, features, intro, plan] = employerPricingFaqs(now);
            expect(cost).toEqual({
                question: 'How much does it cost to post a job?',
                answer: `${PROMO_HEADLINE}. ${PROMO_SUB} From ${config.ladderStartsLabel}: your first post is $${config.introPrice}, every post after that is $${config.postingPrice}, or $${config.planPrice}/month for ${config.planSlots} active jobs.`,
            });
            expect(features.answer.startsWith('Every job post, whether free during the promo, intro, featured, or posted from an Employer plan slot, gets the same features')).toBe(true);
            expect(intro.answer).toBe(
                `From ${config.ladderStartsLabel}, the first paid post per company email domain is $${config.introPrice} instead of $${config.postingPrice}. It is scoped to your organization's domain, not to a login, and posts made free during the launch promo do not use it up.`,
            );
            expect(plan.answer.startsWith(`From ${config.ladderStartsLabel}, the Employer plan is $${config.planPrice}/month.`)).toBe(true);
        }
    });

    it('states the ladder as the current price from the switch instant, and offers nothing free', () => {
        for (const now of LADDER_TIMES) {
            const faqs = employerPricingFaqs(now);
            const [cost, features, intro, plan] = faqs;
            expect(cost).toEqual({ question: 'How much does it cost to post a job?', answer: `${LADDER_PRICES} ${FULL_PACKAGE}` });
            expect(features.answer.startsWith('Every job post, whether intro, featured, or posted from an Employer plan slot, gets the same features')).toBe(true);
            expect(intro.answer.startsWith(`The first paid post per company email domain is $${config.introPrice} instead of $${config.postingPrice}.`)).toBe(true);
            expect(plan.answer.startsWith(`The Employer plan is $${config.planPrice}/month.`)).toBe(true);
            expect(offersIn(JSON.stringify(faqs))).toEqual([]);
            for (const line of strings(faqs)) expect(line, line).not.toMatch(DASHES);
        }
    });

    it('is no longer fully static: it re-renders hourly, and its metadata names no price', () => {
        expect(faqPage.revalidate).toBe(3600);
        expect(offersIn(JSON.stringify(faqPage.metadata))).toEqual([]);
        expect(JSON.stringify(faqPage.metadata)).not.toMatch(/\$\d/);
    });

    it('renders the answers, visible and in the FAQPage JSON-LD, for the clock it renders at', async () => {
        const promo = faqEntities(await atClock(DURING_PROMO, renderFaq));
        expect(promo.find((f) => f.name === 'How much does it cost to post a job?')?.text).toContain(PROMO_HEADLINE);

        for (const now of LADDER_TIMES) {
            const html = await atClock(now, renderFaq);
            expect(offersIn(html)).toEqual([]);
            const entities = faqEntities(html);
            for (const { question, answer } of employerPricingFaqs(now)) {
                expect(entities).toContainEqual({ name: question, text: answer });
            }
            // The renewal answers are unchanged and still follow the pricing FAQ.
            expect(entities.map((f) => f.name)).toContain('How long do job postings last, and what does renewal cost?');
        }
    });
});

describe('EmployerHowItWorks takes the phase from the server page', () => {
    const cta = (promoActive?: boolean): string =>
        renderToStaticMarkup(React.createElement(EmployerHowItWorks, promoActive === undefined ? {} : { promoActive }));

    it('prints the label the server decided, whatever the clock where it renders', async () => {
        const ladderLabel = await atClock(DURING_PROMO, () => cta(false));
        expect(ladderLabel).toContain('Post a Job');
        expect(ladderLabel).not.toMatch(/Free Through/i);

        const promoLabel = await atClock(LADDER_START, () => cta(true));
        expect(promoLabel).toContain(`Post a Job (Free Through ${config.promoEndsLabel})`);
    });

    it('falls back to its own render clock when a page passes no flag', async () => {
        expect(await atClock(DURING_PROMO, () => cta())).toContain(`Post a Job (Free Through ${config.promoEndsLabel})`);
        expect(await atClock(LADDER_START, () => cta())).not.toMatch(/Free Through/i);
    });
});
