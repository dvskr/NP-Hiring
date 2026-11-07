/**
 * The guides store follows the launch promo clock (lib/guides/phase.ts).
 *
 * Until config.promoEndsAt every product is free to claim: each price block
 * reads "Free" beside its struck catalog price and the date it ends, and the
 * action is the claim form. From that instant each block reads the catalog
 * price, the action is checkout (with the add-on checkbox where it applies)
 * and the copy says all sales are final. Every price the pages print comes
 * from guidePriceCopy(product, now), decided at render time, and both pages
 * re-render hourly so the switch shows within the hour.
 *
 * The clock is pinned on both sides of the switch; the pages read it through
 * `new Date()` per render, as in production.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { config } from '@/lib/config';
import {
    ADD_ON,
    BUNDLES,
    BUNDLE_ORDER,
    GUIDES,
    allProducts,
    formatPrice,
    savingsCents,
    separatePriceCents,
    type Product,
} from '@/lib/guides/catalog';
import { guidePriceCopy } from '@/lib/guides/phase';
import GuideAction, { addOnOffer } from '@/components/guides/GuideAction';
import GuidePrice from '@/components/guides/GuidePrice';
import * as storePage from '@/app/guides/page';
import * as productPage from '@/app/guides/[slug]/page';

const PROMO_RUNNING = new Date('2026-12-31T12:00:00.000Z');
const SWITCH = new Date(config.promoEndsAt);
const LAST_PROMO_MS = new Date(SWITCH.getTime() - 1);
const PAID = new Date(SWITCH.getTime() + 60 * 60 * 1000);

const ROOT = process.cwd();
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function pinClock(at: Date): void {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at);
}

afterEach(() => {
    vi.useRealTimers();
});

/** What a visitor reads: the text, without scripts, styles or tags. */
const textOf = (html: string): string =>
    html
        .replace(/<script[\s\S]*?<\/script>/g, ' ')
        .replace(/<style[\s\S]*?<\/style>/g, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&#x27;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ')
        .trim();

const renderStore = (): string => renderToStaticMarkup(storePage.default() as ReactElement);

async function renderProduct(slug: string): Promise<string> {
    const element = await productPage.default({ params: Promise.resolve({ slug }) });
    return renderToStaticMarkup(element as ReactElement);
}

/** Every "$N" amount in a text. */
const dollarAmounts = (text: string): string[] => [...text.matchAll(/\$\d+(?:\.\d{2})?/g)].map((m) => m[0]);

/**
 * Catalog prices, plus the two figures guidePriceCopy derives from them for a
 * bundle after the promo: its guides bought one at a time, and what it saves.
 */
const CATALOG_PRICES = new Set([
    ...allProducts().map((product: Product) => formatPrice(product.priceCents)),
    ...BUNDLE_ORDER.flatMap((slug) => [formatPrice(separatePriceCents(BUNDLES[slug])), formatPrice(savingsCents(BUNDLES[slug]))]),
]);

describe('the price block and action follow the phase', () => {
    it('promo: "Free", the struck catalog price, the end date, and the claim form', () => {
        const copy = guidePriceCopy(GUIDES['interview-prep-pack'], PROMO_RUNNING);
        expect(copy.phase).toBe('promo');
        const price = renderToStaticMarkup(createElement(GuidePrice, { copy }));
        expect(price).toContain('>Free<');
        expect(price).toContain('>$19<');
        expect(price).toContain(`Free through ${config.promoEndsLabel}, then $19`);

        const action = renderToStaticMarkup(createElement(GuideAction, { product: GUIDES['interview-prep-pack'], copy }));
        expect(action).toContain('type="email"');
        expect(action).toContain('Get it free');
        expect(action).not.toContain('Buy for');
    });

    it('paid: the catalog price only, and checkout with the add-on', () => {
        const product = GUIDES['interview-prep-pack'];
        const copy = guidePriceCopy(product, PAID);
        expect(copy.phase).toBe('paid');
        const price = renderToStaticMarkup(createElement(GuidePrice, { copy }));
        expect(textOf(price)).toBe('$19');

        const action = renderToStaticMarkup(createElement(GuideAction, { product, copy, addOn: addOnOffer(product, PAID) }));
        expect(action).toContain('Buy for $19');
        expect(action).toContain(`Add the <strong>${GUIDES[ADD_ON.guide].title}</strong> for ${formatPrice(ADD_ON.priceCents)}`);
        expect(action).not.toContain('type="email"');
        expect(action).not.toMatch(/\bfree\b/i);
    });

    it('takes the add-on total from guidePriceCopy, and offers no add-on with a product that has the report', () => {
        const product = GUIDES['telehealth-playbook'];
        expect(addOnOffer(product, PAID)?.ctaWithAddOn).toBe(`Buy for ${formatPrice(product.priceCents + ADD_ON.priceCents)}`);
        expect(addOnOffer(GUIDES['compensation-report'], PAID)).toBeNull();
        expect(addOnOffer(BUNDLES['career-bundle'], PAID)).toBeNull();
    });

    it('the claim form and the buy button post a product slug to their routes, never an amount', () => {
        const claim = read('components/guides/ClaimForm.tsx');
        expect(claim).toContain("fetch('/api/guides/claim'");
        expect(claim).toContain('JSON.stringify({ product, email: address })');
        const buy = read('components/guides/BuyButton.tsx');
        expect(buy).toContain("fetch('/api/guides/checkout'");
        expect(buy).toContain('JSON.stringify({ product, addOn: addOnChosen })');
        // Each sends exactly one body, and that is it.
        expect(claim.match(/JSON\.stringify\(\{[^}]*\}\)/g)).toEqual(['JSON.stringify({ product, email: address })']);
        expect(buy.match(/JSON\.stringify\(\{[^}]*\}\)/g)).toEqual(['JSON.stringify({ product, addOn: addOnChosen })']);
    });
});

describe('/guides', () => {
    it('re-renders hourly, like /pricing', () => {
        expect(storePage.revalidate).toBe(3600);
    });

    it('promo: every bundle can be claimed and every block says when the free period ends', () => {
        pinClock(PROMO_RUNNING);
        const html = renderStore();
        const text = textOf(html);
        expect(text).toContain(guidePriceCopy(BUNDLES['complete-library'], PROMO_RUNNING).note);
        expect(text).toContain(guidePriceCopy(BUNDLES['career-bundle'], PROMO_RUNNING).note);
        expect(html.match(/type="email"/g)?.length).toBe(3);
        expect(text).toContain('Get them free');
        expect(text).not.toContain('Buy for');
        expect(text).not.toContain('One-time purchase');
        expect(text).not.toContain('All sales are final');
        expect(text).toContain(`through ${config.promoEndsLabel}`);
    });

    it('promo holds to the last millisecond', () => {
        pinClock(LAST_PROMO_MS);
        expect(textOf(renderStore())).toContain('Get them free');
    });

    it('paid: catalog prices, checkout, all sales final, and no free offer', () => {
        pinClock(PAID);
        const html = renderStore();
        const text = textOf(html);
        for (const slug of ['complete-library', 'career-bundle', 'practice-owner-bundle'] as const) {
            expect(text).toContain(`Buy for ${formatPrice(BUNDLES[slug].priceCents)}`);
        }
        expect(html).not.toContain('type="email"');
        expect(text).not.toMatch(/Free through|Get them free|Get it free|claim/i);
        expect(text).toContain('One-time purchase');
        expect(text).toContain('All sales are final');
    });

    it.each([['promo', PROMO_RUNNING], ['paid', PAID]] as const)('%s: every dollar amount on the page is a catalog price', (_phase, at) => {
        pinClock(at);
        const amounts = dollarAmounts(textOf(renderStore()));
        expect(amounts.length).toBeGreaterThan(0);
        expect(amounts.filter((amount) => !CATALOG_PRICES.has(amount))).toEqual([]);
    });

    it('links every product page', () => {
        pinClock(PROMO_RUNNING);
        const html = renderStore();
        for (const product of allProducts()) expect(html, product.slug).toContain(`href="/guides/${product.slug}"`);
    });

    it('states the phase in its metadata, decided per render', async () => {
        pinClock(PROMO_RUNNING);
        expect((await storePage.generateMetadata()).description).toContain(`Free to claim through ${config.promoEndsLabel}.`);
        pinClock(PAID);
        const paid = await storePage.generateMetadata();
        expect(paid.description).toContain('All sales are final.');
        expect(paid.description).not.toMatch(/\bfree\b/i);
        expect(paid.alternates?.canonical).toMatch(/\/guides$/);
    });
});

describe('/guides/[slug]', () => {
    it('builds one static page per product, re-renders hourly, and 404s anything else', () => {
        expect(productPage.revalidate).toBe(3600);
        expect(productPage.dynamicParams).toBe(false);
        expect(productPage.generateStaticParams()).toEqual(allProducts().map((product) => ({ slug: product.slug })));
    });

    it('promo: the claim form, no add-on, no checkout copy', async () => {
        pinClock(PROMO_RUNNING);
        const html = await renderProduct('interview-prep-pack');
        const text = textOf(html);
        expect(text).toContain(guidePriceCopy(GUIDES['interview-prep-pack'], PROMO_RUNNING).note);
        expect(text).toContain('Get it free');
        expect(html).toContain('type="email"');
        expect(text).not.toContain('Add the');
        expect(text).not.toContain('Buy for');
        expect(text).not.toContain('All sales are final');
    });

    it('paid: checkout, the add-on checkbox where it applies, and all sales final', async () => {
        pinClock(PAID);
        const guide = textOf(await renderProduct('interview-prep-pack'));
        expect(guide).toContain('Buy for $19');
        expect(guide).toContain(`Add the ${GUIDES[ADD_ON.guide].title} for ${formatPrice(ADD_ON.priceCents)}`);
        expect(guide).toContain('All sales are final');
        expect(guide).not.toMatch(/Free through|Get it free/);

        const report = textOf(await renderProduct('compensation-report'));
        expect(report).toContain('Buy for $9');
        expect(report).not.toContain('Add the');

        const bundle = textOf(await renderProduct('career-bundle'));
        expect(bundle).toContain('Buy for $39');
        expect(bundle).not.toContain('Add the');
    });

    it('lists every chapter of a guide, the guides of a bundle, and the bundles that hold a guide', async () => {
        pinClock(PROMO_RUNNING);
        const guide = textOf(await renderProduct('launch-your-practice'));
        for (const chapter of GUIDES['launch-your-practice'].contents) expect(guide).toContain(chapter);
        expect(guide).toContain(BUNDLES['practice-owner-bundle'].title);
        expect(guide).toContain(BUNDLES['complete-library'].title);
        expect(guide).not.toContain(BUNDLES['career-bundle'].title);

        const bundle = await renderProduct('practice-owner-bundle');
        for (const slug of BUNDLES['practice-owner-bundle'].guides) expect(bundle).toContain(`href="/guides/${slug}"`);
    });

    it.each([['promo', PROMO_RUNNING], ['paid', PAID]] as const)('%s: every dollar amount is a catalog price, or the add-on and its total', async (_phase, at) => {
        pinClock(at);
        const allowed = new Set([
            ...CATALOG_PRICES,
            formatPrice(ADD_ON.priceCents),
            ...allProducts().map((product) => formatPrice(product.priceCents + ADD_ON.priceCents)),
        ]);
        for (const product of allProducts()) {
            const amounts = dollarAmounts(textOf(await renderProduct(product.slug)));
            expect(amounts.filter((amount) => !allowed.has(amount)), product.slug).toEqual([]);
        }
    });

    it('states the phase in its metadata and never a price on the share card', async () => {
        pinClock(PROMO_RUNNING);
        const promo = await productPage.generateMetadata({ params: Promise.resolve({ slug: 'negotiate-like-an-np' }) });
        expect(promo.description).toContain(`Free to claim through ${config.promoEndsLabel}.`);
        pinClock(PAID);
        const paid = await productPage.generateMetadata({ params: Promise.resolve({ slug: 'negotiate-like-an-np' }) });
        expect(paid.description).toContain('All sales are final.');
        const images = JSON.stringify(paid.openGraph?.images ?? []);
        expect(decodeURIComponent(images)).not.toMatch(/\$\d|\bfree\b/i);
        expect(await productPage.generateMetadata({ params: Promise.resolve({ slug: 'nope' }) })).toEqual({});
    });
});

describe('guides copy: no dashes, in either phase', () => {
    const DASHES = /[–—]/;
    const SPACED_HYPHEN = /(?:^|\s)-(?:\s|$)/;

    it.each([['promo', PROMO_RUNNING], ['paid', PAID]] as const)('%s: the store and every product page', async (_phase, at) => {
        pinClock(at);
        const pages = [textOf(renderStore()), ...(await Promise.all(allProducts().map(async (product) => textOf(await renderProduct(product.slug)))))];
        for (const text of pages) {
            expect(text.match(DASHES)?.[0], text.slice(0, 80)).toBeUndefined();
            expect(SPACED_HYPHEN.test(text), text.slice(0, 80)).toBe(false);
        }
    });

    it('no source file of the store or its components carries a dash', () => {
        const files = [
            'app/guides/page.tsx',
            'app/guides/guides-copy.ts',
            'app/guides/[slug]/page.tsx',
            'app/guides/success/page.tsx',
            'app/guides/success/layout.tsx',
            'app/guides/library/page.tsx',
            'app/guides/library/[token]/route.ts',
            'components/guides/BuyButton.tsx',
            'components/guides/ClaimForm.tsx',
            'components/guides/GuideAction.tsx',
            'components/guides/GuideCover.tsx',
            'components/guides/GuidePrice.tsx',
            'components/guides/GuidePromo.tsx',
            'components/guides/styles.ts',
            'lib/guides/job-guide.ts',
            'lib/guides/og.ts',
        ];
        const found = files.filter((file) => DASHES.test(read(file)));
        expect(found).toEqual([]);
    });
});
