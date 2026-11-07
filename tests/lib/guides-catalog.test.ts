/**
 * The guides store catalog is the only source of what the store charges.
 * These tests pin the published prices and the bundle promises the store
 * pages make from them, so a price edit that breaks a promise fails here
 * instead of on the live page. The store copy rules ride along: no en or em
 * dash anywhere in a product, and share cards that are short, carry no
 * figures and never a price.
 */
import { describe, expect, it } from 'vitest';
import {
    ADD_ON,
    BUNDLES,
    BUNDLE_ORDER,
    GUIDES,
    GUIDE_SLUGS,
    addOnEligible,
    allProducts,
    bundlesContaining,
    formatPrice,
    getProduct,
    resolvePurchaseGuides,
    savingsCents,
    separatePriceCents,
    totalPages,
} from '@/lib/guides/catalog';
import { GUIDES_STORE_OG_CARD, guideOgImageUrl, productOgCard, type GuideOgCard } from '@/lib/guides/og';

const DASHES = /[–—]/;
const SPACED_HYPHEN = /(?:^|\s)-(?:\s|$)/;

/** The card copy rules: short enough for the card, and no figure, price, percent or dash. */
function cardBreaks(card: GuideOgCard): string[] {
    const breaks: string[] = [];
    if (card.title.length > 44) breaks.push(`title over 44 characters: ${card.title}`);
    if (card.subtitle.length > 60) breaks.push(`subtitle over 60 characters: ${card.subtitle}`);
    if (/\d|\$|%|[–—]/.test(`${card.title} ${card.subtitle}`)) breaks.push(`a figure, price or dash: ${card.title} / ${card.subtitle}`);
    return breaks;
}

describe('guide prices', () => {
    it('charges the published price for every product', () => {
        expect(Object.fromEntries(allProducts().map((p) => [p.slug, p.priceCents]))).toEqual({
            'compensation-report': 900,
            'first-year-playbook': 1900,
            'interview-prep-pack': 1900,
            'negotiate-like-an-np': 2900,
            'telehealth-playbook': 2900,
            'launch-your-practice': 3900,
            'career-bundle': 3900,
            'practice-owner-bundle': 4900,
            'complete-library': 6900,
        });
        expect(ADD_ON).toEqual({ guide: 'compensation-report', priceCents: 500 });
    });

    it('prices every bundle below its guides bought one at a time', () => {
        for (const slug of BUNDLE_ORDER) {
            const bundle = BUNDLES[slug];
            expect(savingsCents(bundle), slug).toBeGreaterThan(0);
            expect(separatePriceCents(bundle) - savingsCents(bundle)).toBe(bundle.priceCents);
        }
    });

    it('keeps the Complete Library promise: all six guides for less than half the separate price', () => {
        const library = BUNDLES['complete-library'];
        expect([...library.guides].sort()).toEqual([...GUIDE_SLUGS].sort());
        expect(library.priceCents * 2).toBeLessThan(separatePriceCents(library));
        expect(library.bestValue).toBe(true);
    });

    it('makes the Complete Library the cheapest way to own every guide', () => {
        const career = BUNDLES['career-bundle'];
        const owner = BUNDLES['practice-owner-bundle'];
        expect(BUNDLES['complete-library'].priceCents).toBeLessThan(career.priceCents + owner.priceCents);
    });
});

describe('the checkout add-on', () => {
    it('is offered only with products that do not already include it', () => {
        expect(addOnEligible(GUIDES['interview-prep-pack'])).toBe(true);
        expect(addOnEligible(GUIDES['compensation-report'])).toBe(false);
        for (const slug of BUNDLE_ORDER) expect(addOnEligible(BUNDLES[slug]), slug).toBe(false);
    });

    it('unlocks the add-on guide only when it was bought and eligible', () => {
        expect(resolvePurchaseGuides(GUIDES['interview-prep-pack'], true)).toEqual(['interview-prep-pack', 'compensation-report']);
        expect(resolvePurchaseGuides(GUIDES['interview-prep-pack'], false)).toEqual(['interview-prep-pack']);
        expect(resolvePurchaseGuides(BUNDLES['career-bundle'], true)).toEqual(BUNDLES['career-bundle'].guides);
    });
});

describe('catalog lookups', () => {
    it('resolves every product slug and nothing else', () => {
        for (const product of allProducts()) expect(getProduct(product.slug)).toBe(product);
        expect(getProduct('library')).toBeNull();
        expect(getProduct('success')).toBeNull();
        expect(getProduct('__proto__')).toBeNull();
        expect(getProduct('constructor')).toBeNull();
        expect(getProduct('')).toBeNull();
    });

    it('lists the bundles that contain a guide, cheapest first', () => {
        expect(bundlesContaining('compensation-report').map((b) => b.slug)).toEqual(['career-bundle', 'practice-owner-bundle', 'complete-library']);
        expect(bundlesContaining('launch-your-practice').map((b) => b.slug)).toEqual(['practice-owner-bundle', 'complete-library']);
    });

    it('formats whole and fractional dollar amounts', () => {
        expect(formatPrice(6900)).toBe('$69');
        expect(formatPrice(450)).toBe('$4.50');
    });

    it('adds up page counts across a bundle', () => {
        expect(totalPages(BUNDLES['complete-library'])).toBe(GUIDE_SLUGS.reduce((sum, slug) => sum + GUIDES[slug].pages, 0));
    });

    it('uses lowercase slugs, which survive the middleware path lowercasing, and none collides with a store route', () => {
        for (const product of allProducts()) {
            expect(product.slug).toMatch(/^[a-z0-9-]+$/);
            // /guides/library and /guides/success are routes of their own.
            expect(['library', 'success']).not.toContain(product.slug);
        }
    });
});

describe('store copy', () => {
    it('contains no en or em dash and no spaced hyphen in any product', () => {
        for (const product of allProducts()) {
            const text = JSON.stringify(product);
            expect(DASHES.test(text), product.slug).toBe(false);
            const strings = Object.values(product).flat().filter((value): value is string => typeof value === 'string');
            for (const line of strings) expect(SPACED_HYPHEN.test(line), `${product.slug}: ${line}`).toBe(false);
        }
    });

    it('gives the store and every product a share card that follows the card copy rules', () => {
        expect(cardBreaks(GUIDES_STORE_OG_CARD)).toEqual([]);
        for (const product of allProducts()) {
            expect(cardBreaks(productOgCard(product)), product.slug).toEqual([]);
        }
        // The year in a title is dropped, not the rest of it.
        expect(productOgCard(GUIDES['compensation-report']).title).toBe(GUIDES['compensation-report'].title.replace(/^\d{4}\s+/, ''));
    });

    it('builds the share card on the site renderer, page mode, with both lines', () => {
        const url = new URL(guideOgImageUrl(productOgCard(BUNDLES['career-bundle'])));
        expect(url.pathname).toBe('/api/og');
        expect(url.searchParams.get('type')).toBe('page');
        expect(url.searchParams.get('title')).toBe('Career Bundle');
        expect(url.searchParams.get('subtitle')).toBe(productOgCard(BUNDLES['career-bundle']).subtitle);
    });
});
