/**
 * The 5-post pack and the all-sales-final rule on the three pricing pages
 * (2027 re-price, phase 3; owner decisions 2026-10-24 and 2026-10-25).
 *
 * /pricing carries a pack card beside the two post cards. While the launch
 * promo runs the card states the pack price dated from the ladder's start
 * and offers no way to buy (the pack is sold only once the ladder is live).
 * From the switch its button goes to /employer/post-pack while the sale is
 * open (lib/post-pack-sale.ts#isPackSaleOpen: paid posting on, Stripe and the
 * webhook secret set) and to the support email otherwise.
 *
 * /pricing, /faq and /for-employers each answer the pack question and the
 * refund question, in the visible FAQ and in the FAQPage JSON-LD built from
 * the same array, with the shared sentences of lib/pricing-copy.ts: the
 * pack's terms (never a saving), and all sales final with only the two
 * exceptions /terms section 8 keeps.
 *
 * Each page is rendered for real at fixed instants on both sides of
 * config.promoEndsAt; isPackSaleOpen is the one input mocked, so each sale
 * state is pinned without an environment.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { brand } from '@/config/brand';
import { config } from '@/lib/config';
import { PACK_FAQ_QUESTION, REFUND_ANSWER, packFaqAnswer, packPriceLine } from '@/lib/pricing-copy';

const sale = vi.hoisted(() => ({ open: false }));
vi.mock('@/lib/post-pack-sale', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/post-pack-sale')>();
    return { ...actual, isPackSaleOpen: () => sale.open };
});
// The two async server components on /for-employers read the database; the
// page is rendered around them.
vi.mock('@/components/FeaturedTestimonials', () => ({ default: () => null }));
vi.mock('@/components/tools/EmployerBenchmarkWidget', () => ({ default: () => null }));

import * as pricingPage from '@/app/pricing/page';
import * as employersPage from '@/app/for-employers/page';
import * as faqPage from '@/app/faq/page';

const DURING_PROMO = new Date('2026-12-31T12:00:00.000Z');
const LADDER_START = new Date(config.promoEndsAt);
const LATER = new Date('2027-03-15T12:00:00.000Z');
const PACK_PRICE = config.formatDollars(config.packPrice);
const PACK_NAME = `${config.packPosts}-post pack`;
const BUY_LINK = 'href="/employer/post-pack"';
const SUPPORT_LINK = `href="mailto:${brand.email.support}"`;

afterEach(() => {
    vi.useRealTimers();
    sale.open = false;
});

/** Render `fn` with the system clock at `now` (only Date is faked). */
async function atClock<T>(now: Date, fn: () => T | Promise<T>): Promise<T> {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    try {
        return await fn();
    } finally {
        vi.useRealTimers();
    }
}

const renderPricing = (): string => renderToStaticMarkup(React.createElement(pricingPage.default));
const renderEmployers = async (): Promise<string> => renderToStaticMarkup(await employersPage.default());
const renderFaq = (): string => renderToStaticMarkup(React.createElement(faqPage.default));

/** The FAQPage JSON-LD a page rendered, as question and answer text. */
function faqEntities(html: string): { name: string; text: string }[] {
    for (const [, json] of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
        const data = JSON.parse(json) as { '@type'?: string; mainEntity?: { name: string; acceptedAnswer: { text: string } }[] };
        if (data['@type'] === 'FAQPage') return (data.mainEntity ?? []).map((q) => ({ name: q.name, text: q.acceptedAnswer.text }));
    }
    throw new Error('no FAQPage JSON-LD');
}

/** The ladder section of /pricing: from its heading to the comparison section. */
function ladderSection(html: string): string {
    const start = html.indexOf('class="pricing-ladder-grid"');
    const end = html.indexOf('How We Compare');
    expect(start, 'the ladder grid').toBeGreaterThan(-1);
    return html.slice(start, end);
}

/** The pack card: from its name to the end of the ladder grid. */
function packCard(html: string): string {
    const section = ladderSection(html);
    const start = section.indexOf(`>${PACK_NAME}<`);
    expect(start, 'the pack card').toBeGreaterThan(-1);
    return section.slice(start);
}

/** Visible text, entities decoded the way renderToStaticMarkup writes them. */
const text = (html: string): string =>
    html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ');

describe('/pricing: the 5-post pack card', () => {
    it('stands beside the two post cards, priced from config', async () => {
        for (const now of [DURING_PROMO, LATER]) {
            const card = text(packCard(await atClock(now, renderPricing)));
            expect(card).toContain(PACK_PRICE);
            expect(card).toContain(`for ${config.packPosts} posts`);
            expect(card).toContain(`${config.formatDollars(config.packPrice / config.packPosts)} a post, to use within ${config.packValidityMonths} months`);
            expect(card).toContain(`Bought one at a time at $${config.postingPrice}, five posts cost ${config.formatDollars(config.postingPrice * config.packPosts)}.`);
            expect(card).not.toMatch(/\bsav(?:e|es|ing)\b|\$500|discount/i);
        }
    });

    it('while the promo runs: the price dated from the ladder start, and no way to buy', async () => {
        sale.open = true; // even if the gate read open, the promo offers no purchase
        const html = await atClock(DURING_PROMO, renderPricing);
        const card = packCard(html);
        expect(text(card)).toContain(packPriceLine(DURING_PROMO));
        expect(text(card)).toContain(`From ${config.ladderStartsLabel}, a ${config.packPosts}-post pack is ${PACK_PRICE}.`);
        expect(card).not.toContain(BUY_LINK);
        expect(card).not.toContain(SUPPORT_LINK);
        expect(card).not.toMatch(/<a\b/);
        expect(html).not.toContain(BUY_LINK);
    });

    it('once the ladder is live, with the sale open: the button goes to /employer/post-pack', async () => {
        sale.open = true;
        for (const now of [LADDER_START, LATER]) {
            const card = packCard(await atClock(now, renderPricing));
            expect(card).toContain(BUY_LINK);
            expect(text(card)).toContain(`Buy ${config.packPosts} posts`);
            expect(card).not.toContain(SUPPORT_LINK);
            // The ladder is the current price: no date on the card.
            expect(text(card)).not.toContain(config.ladderStartsLabel);
        }
    });

    it('once the ladder is live, with the sale closed: the button goes to the support email', async () => {
        sale.open = false;
        for (const now of [LADDER_START, LATER]) {
            const html = await atClock(now, renderPricing);
            const card = packCard(html);
            expect(card).toContain(SUPPORT_LINK);
            expect(text(card)).toContain('Ask about the pack');
            expect(html).not.toContain(BUY_LINK);
        }
    });
});

describe('the pack and refund answers: the same sentences on all three pages, visible and in the JSON-LD', () => {
    const PAGES = [
        ['/pricing', renderPricing],
        ['/faq', renderFaq],
        ['/for-employers', renderEmployers],
    ] as const;

    it.each(PAGES)('%s answers the pack question for the clock it renders at', async (_page, render) => {
        for (const now of [DURING_PROMO, LATER]) {
            const html = await atClock(now, render);
            const entities = faqEntities(html);
            expect(entities).toContainEqual({ name: PACK_FAQ_QUESTION, text: packFaqAnswer(now) });
            expect(text(html)).toContain(packFaqAnswer(now));
        }
    });

    it.each(PAGES)('%s says all sales are final, with the two exceptions /terms keeps', async (_page, render) => {
        for (const now of [DURING_PROMO, LATER]) {
            const html = await atClock(now, render);
            const refund = faqEntities(html).filter(({ name }) => /refund/i.test(name));
            expect(refund).toHaveLength(1);
            expect(refund[0].text.startsWith(REFUND_ANSWER)).toBe(true);
            expect(text(html)).toContain(REFUND_ANSWER);
            for (const { text: answer } of faqEntities(html)) {
                expect(answer).not.toMatch(/within 7 days|case by case|generally non-refundable|refunds?, if granted/i);
            }
        }
    });
});
