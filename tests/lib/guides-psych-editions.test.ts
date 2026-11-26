/**
 * The psych editions (owner decision 2026-11-26): the sister board's six
 * career guides and their library, sold in this board's guides store instead
 * of linked to the sister board's.
 *
 *   - Catalog: six guides and a library under `psych-` slugs that cannot
 *     collide with this board's own, at the owner's prices (the same as this
 *     board's guide on each subject), with the PDFs' page counts. Each edition
 *     offers its own compensation report as the add-on.
 *   - Phase: they follow guidePhase() like every product: free to claim until
 *     checkout is set up, then sold at the catalog price. Their Product
 *     JSON-LD offers this store's price at this store's page.
 *   - SEO: each page's canonical is the sister board's page for the same
 *     guide, so the two never compete; the pages stay indexable and crawlable.
 *   - Placement: a shelf on /guides right after the hero, before this board's
 *     own bundles, with a pointer to it in the hero; a card first in the
 *     sidebar of the psych specialty pages, and inline above their listings on
 *     a phone. Every link goes to this store's product pages.
 *   - Guards: every literal naming the specialty or the sister board lives in
 *     config/psych-editions.ts, no code file names either, and no copy has a
 *     dash.
 * The checkout and claim routes' handling of these slugs is pinned in
 * tests/api/guides-routes.test.ts and tests/api/guides-claim.test.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { brand } from '@/config/brand';
import { psychEditions } from '@/config/psych-editions';
import { sisterBoard } from '@/config/sister-board';
import {
    BUNDLES,
    BUNDLE_ORDER,
    GUIDES,
    GUIDE_SLUGS,
    OWN_GUIDE_SLUGS,
    PSYCH_BUNDLE_ORDER,
    PSYCH_GUIDE_SLUGS,
    addOnEligible,
    addOnFor,
    allProducts,
    bundlesContaining,
    editionProducts,
    formatPrice,
    getProduct,
    resolvePurchaseGuides,
    savingsCents,
    separatePriceCents,
    totalPages,
    type Product,
} from '@/lib/guides/catalog';
import { isSelfCanonical, productCanonicalUrl } from '@/lib/guides/canonical';
import { guidePriceCopy, type GuidePhase } from '@/lib/guides/phase';
import { productOgCard } from '@/lib/guides/og';
import { CATEGORY_AXES, PSYCH_SPECIALTY_SLUG } from '@/lib/pseo/taxonomy-registry';
import PsychGuidesCard from '@/components/guides/PsychGuidesCard';
import * as storePage from '@/app/guides/page';
import * as productPage from '@/app/guides/[slug]/page';
import { DONOR_COPY_RE } from '../e2e/helpers/seo';

const ROOT = process.cwd();
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const PSYCH = PSYCH_SPECIALTY_SLUG as string;
const OTHER_SPECIALTIES = CATEGORY_AXES.specialty.filter((slug) => slug !== PSYCH);
const PHASES: readonly GuidePhase[] = ['free', 'paid'];
const DASHES = /[–—]/;
const SPACED_HYPHEN = /(?:^|\s)-(?:\s|$)/;
/** The words the niche-copy and brand-leak scanners count, comments included. */
const NAMES = /pmhnp|psychiatric|mental health|akari/i;

/** Each psych product's slug on the sister board's store, whose page is its canonical. */
const SISTER_PAGES: Readonly<Record<string, string>> = {
    'psych-compensation-report': 'compensation-report',
    'psych-first-year-playbook': 'first-year-playbook',
    'psych-interview-prep-pack': 'interview-prep-pack',
    'psych-negotiation-guide': 'negotiate-like-a-pmhnp',
    'psych-telepsychiatry-playbook': 'telepsychiatry-playbook',
    'psych-launch-your-practice': 'launch-your-practice',
    'psych-library': 'complete-library',
};

const PSYCH_PRODUCTS: readonly Product[] = editionProducts('psych');

function setPhase(phase: GuidePhase): void {
    vi.stubEnv('STRIPE_SECRET_KEY', phase === 'paid' ? 'sk_test_x' : '');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', phase === 'paid' ? 'whsec_x' : '');
}

afterEach(() => {
    vi.unstubAllEnvs();
});

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

const hrefs = (html: string): string[] => [...html.matchAll(/<a\b[^>]*href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));

const renderStore = (): string => renderToStaticMarkup(storePage.default() as ReactElement);

async function renderProduct(slug: string): Promise<string> {
    return renderToStaticMarkup((await productPage.default({ params: Promise.resolve({ slug }) })) as ReactElement);
}

function collectStrings(value: unknown): string[] {
    if (typeof value === 'string') return [value];
    if (value && typeof value === 'object') return Object.values(value).flatMap(collectStrings);
    return [];
}

describe('the catalog', () => {
    it('adds six psych guides under psych- slugs that collide with nothing of this board\'s', () => {
        expect(PSYCH_GUIDE_SLUGS).toHaveLength(6);
        expect(GUIDE_SLUGS).toEqual([...OWN_GUIDE_SLUGS, ...PSYCH_GUIDE_SLUGS]);
        const ownSlugs = new Set<string>([...OWN_GUIDE_SLUGS, ...BUNDLE_ORDER]);
        for (const slug of [...PSYCH_GUIDE_SLUGS, ...PSYCH_BUNDLE_ORDER]) {
            expect(slug).toMatch(/^psych-[a-z0-9-]+$/);
            expect(ownSlugs.has(slug), slug).toBe(false);
            expect(slug, 'a slug is code: it may not carry a name the scanners count').not.toMatch(NAMES);
        }
        expect(new Set(allProducts().map((product) => product.slug)).size).toBe(allProducts().length);
        expect(Object.keys(psychEditions.guides).sort()).toEqual([...PSYCH_GUIDE_SLUGS].sort());
    });

    it('prices each edition like this board\'s guide on the same subject: $9, $29, $29, $39, $39 and $49', () => {
        expect(PSYCH_GUIDE_SLUGS.map((slug) => GUIDES[slug].priceCents)).toEqual([900, 2900, 2900, 3900, 3900, 4900]);
        expect(PSYCH_GUIDE_SLUGS.map((slug, index) => GUIDES[slug].priceCents === GUIDES[OWN_GUIDE_SLUGS[index]].priceCents)).toEqual(Array(6).fill(true));
    });

    it('keeps each PDF\'s page count, cover excluded', () => {
        expect(PSYCH_GUIDE_SLUGS.map((slug) => GUIDES[slug].pages)).toEqual([29, 29, 33, 37, 31, 44]);
    });

    it('takes every edition\'s copy and file name from config, word for word', () => {
        for (const slug of PSYCH_GUIDE_SLUGS) {
            const guide = GUIDES[slug];
            const copy = psychEditions.guides[slug];
            expect(guide).toMatchObject({
                kind: 'guide',
                edition: 'psych',
                slug,
                title: copy.title,
                subtitle: copy.subtitle,
                sourceFile: copy.sourceFile,
                audience: copy.audience,
                summary: copy.summary,
                contents: copy.contents,
                sisterSlug: SISTER_PAGES[slug],
            });
            expect(guide.sourceFile, slug).toMatch(/\.pdf$/);
            expect(guide.contents.length, slug).toBeGreaterThan(5);
        }
    });

    it('sells the Psychiatric NP Library: all six at $99, $95 under buying them one at a time', () => {
        const library = BUNDLES['psych-library'];
        expect(PSYCH_BUNDLE_ORDER).toEqual(['psych-library']);
        expect(library).toMatchObject({ kind: 'bundle', edition: 'psych', title: 'Psychiatric NP Library', priceCents: 9900, bestValue: true });
        expect(library.guides).toEqual([...PSYCH_GUIDE_SLUGS]);
        expect(separatePriceCents(library)).toBe(19400);
        expect(savingsCents(library)).toBe(9500);
        expect(totalPages(library)).toBe(203);
        expect(getProduct('psych-library')).toBe(library);
        expect(editionProducts('psych')).toEqual([library, ...PSYCH_GUIDE_SLUGS.map((slug) => GUIDES[slug])]);
    });

    it('keeps the editions apart: this board\'s bundles hold none, and the library holds only them', () => {
        for (const slug of BUNDLE_ORDER) {
            expect(BUNDLES[slug].guides.filter((guide) => guide.startsWith('psych-')), slug).toEqual([]);
        }
        for (const slug of PSYCH_GUIDE_SLUGS) {
            expect(bundlesContaining(slug).map((bundle) => bundle.slug), slug).toEqual(['psych-library']);
        }
        expect(bundlesContaining('compensation-report').map((bundle) => bundle.slug)).not.toContain('psych-library');
    });

    it('offers each edition its own compensation report as the add-on, at $5', () => {
        for (const product of PSYCH_PRODUCTS) {
            expect(addOnFor(product), product.slug).toEqual({ guide: 'psych-compensation-report', priceCents: 500 });
        }
        expect(addOnFor(GUIDES['interview-prep-pack'])).toEqual({ guide: 'compensation-report', priceCents: 500 });
        expect(addOnEligible(GUIDES['psych-launch-your-practice'])).toBe(true);
        expect(addOnEligible(GUIDES['psych-compensation-report'])).toBe(false);
        expect(addOnEligible(BUNDLES['psych-library'])).toBe(false);
        expect(resolvePurchaseGuides(GUIDES['psych-launch-your-practice'], true)).toEqual(['psych-launch-your-practice', 'psych-compensation-report']);
        expect(resolvePurchaseGuides(GUIDES['psych-launch-your-practice'], false)).toEqual(['psych-launch-your-practice']);
    });
});

describe('the phase', () => {
    it('free: every edition and the library are free to claim, beside the catalog price', () => {
        for (const product of PSYCH_PRODUCTS) {
            const copy = guidePriceCopy(product, 'free');
            expect(copy.price, product.slug).toBe('Free');
            expect(copy.listPrice, product.slug).toBe(formatPrice(product.priceCents));
            expect(copy.cta, product.slug).toBe(product.kind === 'bundle' ? 'Get them free' : 'Get it free');
        }
    });

    it('paid: the catalog price, and the library\'s saving', () => {
        expect(guidePriceCopy(GUIDES['psych-negotiation-guide'], 'paid')).toMatchObject({ price: '$39', cta: 'Buy for $39' });
        expect(guidePriceCopy(BUNDLES['psych-library'], 'paid')).toEqual({
            phase: 'paid',
            price: '$99',
            listPrice: '$194',
            listPriceLabel: 'Bought one at a time',
            note: 'Save $95 on buying them one at a time',
            cta: 'Buy for $99',
        });
    });

    it('free: an edition\'s page offers the claim form and no Buy button', async () => {
        setPhase('free');
        const html = await renderProduct('psych-first-year-playbook');
        expect(html).toContain('type="email"');
        expect(textOf(html)).toContain('Free for a limited time, then $29');
        expect(textOf(html)).not.toContain('Buy for');
    });

    it('paid: an edition\'s page sells it at the catalog price with its own report as the add-on', async () => {
        setPhase('paid');
        const text = textOf(await renderProduct('psych-interview-prep-pack'));
        expect(text).toContain('Buy for $29');
        expect(text).toContain(`Add the ${GUIDES['psych-compensation-report'].title} for $5`);
        expect(text).not.toContain(GUIDES['compensation-report'].title);
        expect(text).toContain('All sales are final');
    });

    it.each(PHASES)('%s: each edition\'s Product JSON-LD offers this store\'s price at this store\'s page', async (phase) => {
        setPhase(phase);
        for (const product of PSYCH_PRODUCTS) {
            const html = await renderProduct(product.slug);
            const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]) as Record<string, unknown>);
            const data = blocks.find((block) => block['@type'] === 'Product') as { url: string; offers: { price: string; url: string; priceCurrency: string } };
            expect(data.url, product.slug).toBe(`${brand.baseUrl}/guides/${product.slug}`);
            expect(data.offers.url, product.slug).toBe(`${brand.baseUrl}/guides/${product.slug}`);
            expect(data.offers.priceCurrency).toBe('USD');
            expect(data.offers.price, `${phase} ${product.slug}`).toBe(phase === 'free' ? '0.00' : (product.priceCents / 100).toFixed(2));
        }
    });
});

describe('search: one page per guide across the two boards', () => {
    it('each edition\'s canonical is the sister board\'s page for the same guide', async () => {
        for (const product of PSYCH_PRODUCTS) {
            const expected = `https://pmhnphiring.com/guides/${SISTER_PAGES[product.slug]}`;
            expect(productCanonicalUrl(product), product.slug).toBe(expected);
            expect(isSelfCanonical(product), product.slug).toBe(false);
            const metadata = await productPage.generateMetadata({ params: Promise.resolve({ slug: product.slug }) });
            expect(metadata.alternates?.canonical, product.slug).toBe(expected);
            // Canonical, not noindex: the page stays indexable and its links are followed.
            expect(metadata.robots, product.slug).toBeUndefined();
            // The share card and its address stay this store's page, where it is claimed or bought.
            expect(metadata.openGraph?.url, product.slug).toBe(`${brand.baseUrl}/guides/${product.slug}`);
        }
    });

    it('this board\'s own products stay self canonical', async () => {
        for (const product of editionProducts('own')) {
            expect(isSelfCanonical(product), product.slug).toBe(true);
            const metadata = await productPage.generateMetadata({ params: Promise.resolve({ slug: product.slug }) });
            expect(metadata.alternates?.canonical, product.slug).toBe(`${brand.baseUrl}/guides/${product.slug}`);
        }
    });

    it('builds the canonical from the sister board config, with no tracking tags', () => {
        for (const product of PSYCH_PRODUCTS) {
            const url = new URL(productCanonicalUrl(product));
            expect(url.origin).toBe(sisterBoard.baseUrl);
            expect(url.pathname).toBe(`${sisterBoard.paths.guides}/${SISTER_PAGES[product.slug]}`);
            expect(url.search).toBe('');
        }
    });

    it('names the edition and its readers in the title and the share card, without a figure', async () => {
        const guide = await productPage.generateMetadata({ params: Promise.resolve({ slug: 'psych-negotiation-guide' }) });
        expect(guide.title).toBe(`Negotiate Like a PMHNP: ${psychEditions.labels.guideKind}`);
        const library = await productPage.generateMetadata({ params: Promise.resolve({ slug: 'psych-library' }) });
        expect(library.title).toBe(`Psychiatric NP Library: ${psychEditions.labels.bundleKind}`);
        for (const product of PSYCH_PRODUCTS) {
            const card = productOgCard(product);
            expect(card.subtitle).toBe(product.kind === 'guide' ? psychEditions.labels.ogGuide : psychEditions.labels.ogBundle);
            expect(`${card.title} ${card.subtitle}`, product.slug).not.toMatch(/\d|\$/);
        }
    });
});

describe('/guides: the shelf right after the hero', () => {
    it.each(PHASES)('%s: the hero points to the shelf, and the shelf sits before this board\'s own bundles', (phase) => {
        setPhase(phase);
        const html = renderStore();
        const h1 = html.indexOf('id="guides-heading"');
        const jump = html.indexOf('href="#psych-editions"');
        const ownLibrary = html.indexOf('id="library-heading"');
        const shelf = html.indexOf('id="psych-editions"');
        const ownBundles = html.indexOf('id="bundles-heading"');
        const ownSingles = html.indexOf('id="singles-heading"');
        const faq = html.indexOf('id="faq-heading"');
        expect(h1).toBeGreaterThan(-1);
        // The pointer is in the hero, under the pills and above this board's library card.
        expect(jump).toBeGreaterThan(h1);
        expect(jump).toBeLessThan(ownLibrary);
        // The shelf is the next band after the hero.
        expect(shelf).toBeGreaterThan(ownLibrary);
        expect(shelf).toBeLessThan(ownBundles);
        expect(ownBundles).toBeLessThan(ownSingles);
        expect(ownSingles).toBeLessThan(faq);
        expect(html.match(/id="psych-editions"/g)).toHaveLength(1);
        expect(html.slice(shelf, ownBundles)).toContain(psychEditions.store.heading);
    });

    it.each(PHASES)('%s: the shelf links every edition and the library to this store\'s pages, with the price of the phase', (phase) => {
        setPhase(phase);
        const html = renderStore();
        const shelf = html.slice(html.indexOf('id="psych-editions"'), html.indexOf('id="bundles-heading"'));
        for (const product of PSYCH_PRODUCTS) expect(shelf, product.slug).toContain(`href="/guides/${product.slug}"`);
        expect(hrefs(shelf).filter((href) => !href.startsWith('/guides/psych-'))).toEqual([]);
        const text = textOf(shelf);
        if (phase === 'free') {
            expect(shelf).toContain('type="email"');
            expect(text).toContain(guidePriceCopy(BUNDLES['psych-library'], 'free').note);
        } else {
            expect(text).toContain('Buy for $99');
            expect(text).toContain('Save $95 on buying them one at a time');
        }
    });

    it('credits the sister board once, inside the one data-sister-board block, and links nowhere on it', () => {
        const html = renderStore();
        expect(html.match(/data-sister-board/g)).toHaveLength(1);
        expect(html).toMatch(new RegExp(`data-sister-board="">${psychEditions.attribution}<`));
        expect(hrefs(html).filter((href) => href.startsWith(sisterBoard.baseUrl))).toEqual([]);
    });

    it('an edition\'s own page credits the sister board and offers only its own library', async () => {
        const html = await renderProduct('psych-telepsychiatry-playbook');
        const text = textOf(html);
        expect(html).toContain(`data-sister-board="" style="margin:0">${psychEditions.attribution}<`);
        expect(text).toContain(psychEditions.labels.edition);
        expect(text).toContain(BUNDLES['psych-library'].title);
        for (const slug of BUNDLE_ORDER) expect(text, slug).not.toContain(BUNDLES[slug].title);
        expect(hrefs(html).filter((href) => href.startsWith(sisterBoard.baseUrl))).toEqual([]);
    });
});

describe('the psych specialty pages: the card', () => {
    const placements = ['sidebar', 'inline'] as const;

    it('renders on the psych specialty only', () => {
        for (const placement of placements) {
            for (const slug of OTHER_SPECIALTIES) {
                expect(renderToStaticMarkup(createElement(PsychGuidesCard, { categorySlug: slug, placement })), `${placement} ${slug}`).toBe('');
            }
            expect(renderToStaticMarkup(createElement(PsychGuidesCard, { categorySlug: PSYCH, placement }))).toContain(psychEditions.card.heading);
        }
    });

    it('links only this store\'s pages: every edition from the sidebar, the library from both', () => {
        const sidebar = renderToStaticMarkup(createElement(PsychGuidesCard, { categorySlug: PSYCH, placement: 'sidebar' }));
        expect(hrefs(sidebar)).toEqual([...PSYCH_GUIDE_SLUGS.map((slug) => `/guides/${slug}`), '/guides/psych-library']);
        const inline = renderToStaticMarkup(createElement(PsychGuidesCard, { categorySlug: PSYCH, placement: 'inline' }));
        expect(hrefs(inline)).toEqual(['/guides/psych-library']);
        for (const html of [sidebar, inline]) expect(html).not.toContain('target="_blank"');
    });

    it('shows the sidebar card from the lg breakpoint and the inline card below it', () => {
        expect(renderToStaticMarkup(createElement(PsychGuidesCard, { categorySlug: PSYCH, placement: 'sidebar' }))).toMatch(/<aside[^>]*class="hidden lg:block"/);
        expect(renderToStaticMarkup(createElement(PsychGuidesCard, { categorySlug: PSYCH, placement: 'inline' }))).toMatch(/<aside[^>]*class="lg:hidden"/);
    });

    it('names no price, never says free, and stays clear of the job pages\' donor copy guard', () => {
        for (const placement of placements) {
            const text = textOf(renderToStaticMarkup(createElement(PsychGuidesCard, { categorySlug: PSYCH, placement })));
            expect(text, placement).not.toMatch(/\$\d|\bfree\b/i);
            expect(text, placement).not.toMatch(DONOR_COPY_RE);
            expect(text, placement).not.toMatch(DASHES);
        }
    });

    it('is first in the sidebar of the landing, state and city templates, and first in their listings on a phone', () => {
        // [template, the page's specialty prop]
        for (const [file, prop] of [
            ['lib/pseo/category-landing-template.tsx', 'slug'],
            ['lib/pseo/setting-state-template.tsx', 'settingKey'],
            ['lib/pseo/category-city-template.tsx', 'categoryKey'],
        ] as const) {
            const template = read(file);
            expect(template, file).toContain("import PsychGuidesCard from '@/components/guides/PsychGuidesCard';");
            const listings = template.indexOf('<div className="lg:col-span-3">');
            const inline = template.indexOf(`<PsychGuidesCard categorySlug={${prop}} placement="inline" />`);
            const positions = template.indexOf('Positions', inline);
            const sidebar = template.indexOf('<div className="lg:col-span-1">');
            const card = template.indexOf(`<PsychGuidesCard categorySlug={${prop}} placement="sidebar" />`);
            const alert = template.indexOf('Create Alert', sidebar);
            expect(listings, file).toBeGreaterThan(-1);
            expect(inline, file).toBeGreaterThan(listings);
            expect(inline, file).toBeLessThan(positions);
            // Nothing renders between the listings column and the inline card but comments.
            expect(template.slice(listings, inline).replace(/\{\/\*[\s\S]*?\*\/\}/g, '').trim(), file).toBe('<div className="lg:col-span-3">');
            expect(card, file).toBeGreaterThan(sidebar);
            expect(card, file).toBeLessThan(alert);
            expect(template.slice(sidebar, card).replace(/\{\/\*[\s\S]*?\*\/\}/g, '').trim(), file).toBe('<div className="lg:col-span-1">');
            expect(template.match(/<PsychGuidesCard /g), file).toHaveLength(2);
        }
        // Each psych specialty route renders one of those templates with the psych slug.
        expect(read(`app/jobs/${PSYCH}/page.tsx`)).toContain('<CategoryLandingPage slug={CATEGORY_SLUG}');
        expect(read(`app/jobs/${PSYCH}/[state]/page.tsx`)).toContain('<SettingStatePage settingKey={SETTING_KEY}');
        expect(read(`app/jobs/${PSYCH}/city/[slug]/page.tsx`)).toContain('<CategoryCityPage categoryKey={CATEGORY_KEY}');
    });
});

describe('guards: names in config, no dash in the copy', () => {
    /** Every code file of the store, the card and the sister board helper. */
    function codeFiles(): string[] {
        const walk = (dir: string): string[] =>
            fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
                const rel = `${dir}/${entry.name}`;
                if (entry.isDirectory()) return walk(rel);
                return /\.tsx?$/.test(entry.name) ? [rel] : [];
            });
        return [
            ...walk('lib/guides'),
            ...walk('components/guides'),
            ...walk('app/guides'),
            ...walk('app/api/guides'),
            'lib/sister-board.ts',
            'app/sitemap.ts',
            'app/api/sitemaps/lastmod.ts',
        ];
    }

    it('no code file names the specialty or the sister board, comments included: config/ does', () => {
        const files = codeFiles();
        expect(files.length).toBeGreaterThan(20);
        expect(files.filter((file) => NAMES.test(read(file)))).toEqual([]);
        expect(read('config/psych-editions.ts')).toMatch(NAMES);
    });

    it('the config copy has no dash, and its shelf, card and label copy no price, figure or free claim', () => {
        const strings = collectStrings(psychEditions);
        expect(strings.length).toBeGreaterThan(60);
        for (const line of strings) {
            expect(line, line).not.toMatch(DASHES);
            expect(SPACED_HYPHEN.test(line), line).toBe(false);
        }
        for (const line of collectStrings({ ...psychEditions.store, ...psychEditions.card, ...psychEditions.labels, attribution: psychEditions.attribution })) {
            expect(line, line).not.toMatch(/\d|\$|\bfree\b/i);
        }
        // The job pages' card never names the sister board.
        expect(collectStrings(psychEditions.card).join(' ')).not.toMatch(DONOR_COPY_RE);
    });

    it.each(PHASES)('%s: no rendered page of an edition carries a dash', async (phase) => {
        setPhase(phase);
        for (const product of PSYCH_PRODUCTS) {
            const text = textOf(await renderProduct(product.slug));
            expect(text.match(DASHES)?.[0], product.slug).toBeUndefined();
            expect(SPACED_HYPHEN.test(text), product.slug).toBe(false);
        }
    });
});
