/**
 * The guides store follows guidePhase() (lib/guides/phase.ts), read from the
 * deployment's Stripe settings, never from the promo clock (owner decision
 * 2026-11-26).
 *
 * Free phase (the Stripe key or the webhook secret missing, as in NP
 * Production today): every product is free to claim. Each price block reads
 * "Free" beside its struck catalog price, with no end date; the action is the
 * claim form; no Buy button renders, because none could work; the Product
 * JSON-LD offers price 0.
 *
 * Paid phase (both set): each block reads the catalog price, the action is
 * checkout (with the add-on checkbox where it applies), the copy says all
 * sales are final, nothing offers a free claim, and the JSON-LD carries the
 * catalog price.
 *
 * In both phases the sister board pointer stays on /guides, and every dollar
 * amount comes from the catalog. The phase is set through the environment the
 * pages read, as in production.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { brand } from '@/config/brand';
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
import { guidePriceCopy, type GuidePhase } from '@/lib/guides/phase';
import GuideAction, { addOnOffer } from '@/components/guides/GuideAction';
import GuidePrice from '@/components/guides/GuidePrice';
import * as storePage from '@/app/guides/page';
import * as productPage from '@/app/guides/[slug]/page';

const AFTER_PROMO = new Date(Date.parse(config.promoEndsAt) + 60 * 60 * 1000);
const PHASES: readonly GuidePhase[] = ['free', 'paid'];

const ROOT = process.cwd();
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** Put this deployment in `phase` through the two Stripe values the pages read. */
function setPhase(phase: GuidePhase): void {
    vi.stubEnv('STRIPE_SECRET_KEY', phase === 'paid' ? 'sk_test_x' : '');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', phase === 'paid' ? 'whsec_x' : '');
}

afterEach(() => {
    vi.unstubAllEnvs();
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

/** Every JSON-LD block in rendered markup, parsed. */
const jsonLdBlocks = (html: string): Array<Record<string, unknown>> =>
    [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]) as Record<string, unknown>);

const renderStore = (): string => renderToStaticMarkup(storePage.default() as ReactElement);

async function renderProduct(slug: string): Promise<string> {
    const element = await productPage.default({ params: Promise.resolve({ slug }) });
    return renderToStaticMarkup(element as ReactElement);
}

/** Every "$N" amount in a text. */
const dollarAmounts = (text: string): string[] => [...text.matchAll(/\$\d+(?:\.\d{2})?/g)].map((m) => m[0]);

/** Catalog prices, plus the two figures guidePriceCopy derives from them for a bundle: its guides bought one at a time, and what it saves. */
const CATALOG_PRICES = new Set([
    ...allProducts().map((product: Product) => formatPrice(product.priceCents)),
    ...BUNDLE_ORDER.flatMap((slug) => [formatPrice(separatePriceCents(BUNDLES[slug])), formatPrice(savingsCents(BUNDLES[slug]))]),
]);

/** Words that offer a guide at no cost. */
const FREE_OFFER = /Free for a limited time|Get them free|Get it free|free to claim|claimed at no cost|\bFree\b/;

describe('the price block and the action follow the phase', () => {
    it('free: "Free", the struck catalog price, no end date, and the claim form with no Buy button', () => {
        const product = GUIDES['interview-prep-pack'];
        const copy = guidePriceCopy(product, 'free');
        const price = renderToStaticMarkup(createElement(GuidePrice, { copy }));
        expect(price).toContain('>Free<');
        expect(price).toContain(`>${formatPrice(product.priceCents)}<`);
        expect(price).toContain(`Free for a limited time, then ${formatPrice(product.priceCents)}`);
        expect(price).not.toContain(config.promoEndsLabel);

        const action = renderToStaticMarkup(createElement(GuideAction, { product, copy }));
        expect(action).toContain('type="email"');
        expect(action).toContain('Get it free');
        expect(action).not.toContain('Buy for');
    });

    it('paid: the catalog price only, and checkout with the add-on', () => {
        const product = GUIDES['interview-prep-pack'];
        const copy = guidePriceCopy(product, 'paid');
        expect(textOf(renderToStaticMarkup(createElement(GuidePrice, { copy })))).toBe(formatPrice(product.priceCents));

        const action = renderToStaticMarkup(createElement(GuideAction, { product, copy, addOn: addOnOffer(product) }));
        expect(action).toContain(`Buy for ${formatPrice(product.priceCents)}`);
        expect(action).toContain(`Add the <strong>${GUIDES[ADD_ON.guide].title}</strong> for ${formatPrice(ADD_ON.priceCents)}`);
        expect(action).not.toContain('type="email"');
        expect(action).not.toMatch(/\bfree\b/i);
    });

    it('names the struck price for a screen reader when a row of cards leaves the note out', () => {
        const bundle = BUNDLES['career-bundle'];
        const free = renderToStaticMarkup(createElement(GuidePrice, { copy: guidePriceCopy(bundle, 'free'), withNote: false }));
        expect(textOf(free)).toBe(`Free Regular price: ${formatPrice(bundle.priceCents)}`);
        const paid = renderToStaticMarkup(createElement(GuidePrice, { copy: guidePriceCopy(bundle, 'paid'), withNote: false }));
        expect(textOf(paid)).toBe(`${formatPrice(bundle.priceCents)} Bought one at a time: ${formatPrice(separatePriceCents(bundle))}`);
    });

    it('takes the add-on total from guidePriceCopy, and offers no add-on with a product that has the report', () => {
        const product = GUIDES['telehealth-playbook'];
        expect(addOnOffer(product)?.ctaWithAddOn).toBe(`Buy for ${formatPrice(product.priceCents + ADD_ON.priceCents)}`);
        expect(addOnOffer(GUIDES['compensation-report'])).toBeNull();
        expect(addOnOffer(BUNDLES['career-bundle'])).toBeNull();
    });

    it('the claim form and the buy button post a product slug to their routes, never an amount', () => {
        const claim = read('components/guides/ClaimForm.tsx');
        expect(claim).toContain("fetch('/api/guides/claim'");
        const buy = read('components/guides/BuyButton.tsx');
        expect(buy).toContain("fetch('/api/guides/checkout'");
        expect(claim.match(/JSON\.stringify\(\{[^}]*\}\)/g)).toEqual(['JSON.stringify({ product, email: address, newsletter })']);
        expect(buy.match(/JSON\.stringify\(\{[^}]*\}\)/g)).toEqual(['JSON.stringify({ product, addOn: addOnChosen })']);
    });
});

describe('/guides', () => {
    it('re-renders hourly, so it follows the settings the claim route and checkout read', () => {
        expect(storePage.revalidate).toBe(3600);
    });

    it('free: every product can be claimed, no Buy button, and no end date anywhere', () => {
        setPhase('free');
        const html = renderStore();
        const text = textOf(html);
        expect(text).toContain(guidePriceCopy(BUNDLES['complete-library'], 'free').note);
        expect(text).toContain(guidePriceCopy(BUNDLES['career-bundle'], 'free').note);
        expect(html.match(/type="email"/g)?.length).toBe(3);
        expect(text).toContain('Get them free');
        expect(text).not.toContain('Buy for');
        expect(text).not.toContain('One-time purchase');
        expect(text).not.toContain('All sales are final');
        expect(text).not.toContain(config.promoEndsLabel);
    });

    it('free: still so after the posting promo ends, while checkout is not set up', () => {
        setPhase('free');
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(AFTER_PROMO);
        const text = textOf(renderStore());
        expect(text).toContain('Get them free');
        expect(text).not.toContain('Buy for');
    });

    it('paid: catalog prices, checkout on every bundle, all sales final, and no free offer, even while the posting promo runs', () => {
        setPhase('paid');
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-11-26T12:00:00.000Z'));
        const html = renderStore();
        const text = textOf(html);
        for (const slug of BUNDLE_ORDER) {
            expect(text).toContain(`Buy for ${formatPrice(BUNDLES[slug].priceCents)}`);
        }
        expect(html).not.toContain('type="email"');
        expect(text).not.toMatch(FREE_OFFER);
        expect(text).toContain('One-time purchase');
        expect(text).toContain('Secure checkout by Stripe');
        expect(text).toContain('All sales are final');
    });

    it.each(PHASES)('%s: every dollar amount on the page is a catalog price', (phase) => {
        setPhase(phase);
        const amounts = dollarAmounts(textOf(renderStore()));
        expect(amounts.length).toBeGreaterThan(0);
        expect(amounts.filter((amount) => !CATALOG_PRICES.has(amount))).toEqual([]);
    });

    it.each(PHASES)('%s: links every product page, lists them in its ItemList JSON-LD, and keeps the sister board pointer', (phase) => {
        setPhase(phase);
        const html = renderStore();
        for (const product of allProducts()) expect(html, product.slug).toContain(`href="/guides/${product.slug}"`);
        const list = jsonLdBlocks(html).find((block) => block['@type'] === 'ItemList') as { itemListElement: Array<{ url: string }> };
        expect(list.itemListElement.map((item) => item.url)).toEqual(allProducts().map((product) => `${brand.baseUrl}/guides/${product.slug}`));
        expect(html.match(/data-sister-board/g)).toHaveLength(1);
    });

    it('states the phase in its metadata', async () => {
        setPhase('free');
        const free = await storePage.generateMetadata();
        expect(free.description).toContain('Free to claim for a limited time.');
        expect(free.description).not.toContain(config.promoEndsLabel);
        setPhase('paid');
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

    it('free: the claim form, no add-on, no Buy button, no checkout copy', async () => {
        setPhase('free');
        const product = GUIDES['interview-prep-pack'];
        const html = await renderProduct(product.slug);
        const text = textOf(html);
        expect(text).toContain(guidePriceCopy(product, 'free').note);
        expect(text).toContain('Get it free');
        expect(html).toContain('type="email"');
        expect(text).not.toContain('Add the');
        expect(text).not.toContain('Buy for');
        expect(text).not.toContain('All sales are final');
    });

    it('paid: checkout, the add-on checkbox where it applies, and all sales final', async () => {
        setPhase('paid');
        const guide = GUIDES['interview-prep-pack'];
        const page = textOf(await renderProduct(guide.slug));
        expect(page).toContain(`Buy for ${formatPrice(guide.priceCents)}`);
        expect(page).toContain(`Add the ${GUIDES[ADD_ON.guide].title} for ${formatPrice(ADD_ON.priceCents)}`);
        expect(page).toContain('All sales are final');
        expect(page).toContain('Pay once, keep it');
        expect(page).not.toMatch(FREE_OFFER);

        const report = textOf(await renderProduct('compensation-report'));
        expect(report).toContain(`Buy for ${formatPrice(GUIDES['compensation-report'].priceCents)}`);
        expect(report).not.toContain('Add the');

        const bundle = textOf(await renderProduct('career-bundle'));
        expect(bundle).toContain(`Buy for ${formatPrice(BUNDLES['career-bundle'].priceCents)}`);
        expect(bundle).toContain(`Save ${formatPrice(savingsCents(BUNDLES['career-bundle']))}`);
        expect(bundle).not.toContain('Add the');
    });

    it.each(PHASES)('%s: the Product JSON-LD offers what the page offers', async (phase) => {
        setPhase(phase);
        for (const product of allProducts()) {
            const data = jsonLdBlocks(await renderProduct(product.slug)).find((block) => block['@type'] === 'Product') as {
                name: string;
                sku: string;
                url: string;
                offers: { '@type': string; price: string; priceCurrency: string; availability: string };
            };
            expect(data, product.slug).toBeDefined();
            expect(data.name).toBe(product.title);
            expect(data.sku).toBe(product.slug);
            expect(data.url).toBe(`${brand.baseUrl}/guides/${product.slug}`);
            expect(data.offers).toMatchObject({ '@type': 'Offer', priceCurrency: 'USD', availability: 'https://schema.org/InStock' });
            // Free to claim, or the price the page prints and the checkout charges.
            expect(data.offers.price, `${phase} ${product.slug}`).toBe(phase === 'free' ? '0.00' : (product.priceCents / 100).toFixed(2));
        }
    });

    it('lists every chapter of a guide, the guides of a bundle, and the bundles that hold a guide', async () => {
        const guide = textOf(await renderProduct('launch-your-practice'));
        for (const chapter of GUIDES['launch-your-practice'].contents) expect(guide).toContain(chapter);
        expect(guide).toContain(BUNDLES['practice-owner-bundle'].title);
        expect(guide).toContain(BUNDLES['complete-library'].title);
        expect(guide).not.toContain(BUNDLES['career-bundle'].title);

        const bundle = await renderProduct('practice-owner-bundle');
        for (const slug of BUNDLES['practice-owner-bundle'].guides) expect(bundle).toContain(`href="/guides/${slug}"`);
    });

    it.each(PHASES)('%s: every dollar amount is a catalog price, or the add-on and its total', async (phase) => {
        setPhase(phase);
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
        setPhase('free');
        const free = await productPage.generateMetadata({ params: Promise.resolve({ slug: 'negotiate-like-an-np' }) });
        expect(free.description).toContain('Free to claim for a limited time.');
        setPhase('paid');
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

    it.each(PHASES)('%s: the store and every product page', async (phase) => {
        setPhase(phase);
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
            'components/guides/GuideSchema.tsx',
            'components/guides/styles.ts',
            'components/sister-board/SisterBoardGuidesSection.tsx',
            'lib/guides/job-guide.ts',
            'lib/guides/og.ts',
            'lib/guides/phase.ts',
            'lib/guides/schema.ts',
        ];
        const found = files.filter((file) => DASHES.test(read(file)));
        expect(found).toEqual([]);
    });
});
