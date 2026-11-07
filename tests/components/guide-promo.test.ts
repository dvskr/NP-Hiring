/**
 * Links into the guides store from the rest of the site.
 *
 * The cards take their titles and page counts from the catalog, a job page
 * points its reader at the guide that fits that job, and the store pages
 * start right under the header. The cards print no price and no phase copy:
 * they sit on pages rebuilt daily or never, which could still say "free"
 * after the free period ends, so the price lives on the store pages alone.
 */
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ usePathname: vi.fn() }));

import { usePathname } from 'next/navigation';
import GuidePromo, { GuideShelf } from '@/components/guides/GuidePromo';
import MainContent from '@/components/MainContent';
import { BUNDLES, GUIDES, allProducts, formatPrice } from '@/lib/guides/catalog';
import { guideForJob } from '@/lib/guides/job-guide';

const DASHES = /[–—]/;

describe('GuidePromo', () => {
    it('links a guide to its store page with the catalog title, subtitle and page count', () => {
        const html = renderToStaticMarkup(createElement(GuidePromo, {
            slug: 'negotiate-like-an-np',
            heading: 'Weighing an offer?',
        }));
        const guide = GUIDES['negotiate-like-an-np'];

        expect(html).toContain('href="/guides/negotiate-like-an-np"');
        expect(html).toContain(guide.title);
        expect(html).toContain(`${guide.pages} pages`);
        expect(html).toContain('Weighing an offer?');
        expect(html).toContain(guide.subtitle);
        expect(html).toContain('See the guide');
    });

    it('shows a bundle with the pitch it was given', () => {
        const html = renderToStaticMarkup(createElement(GuidePromo, {
            slug: 'complete-library',
            heading: 'Go deeper',
            pitch: 'All six guides.',
        }));

        expect(html).toContain('href="/guides/complete-library"');
        expect(html).toContain('See the bundle');
        expect(html).toContain('All six guides.');
        expect(html).toContain(`${BUNDLES['complete-library'].guides.length} guides`);
    });

    it('prints no price and no free wording for any product, in either variant', () => {
        for (const product of allProducts()) {
            for (const variant of ['clay', 'sticker'] as const) {
                const html = renderToStaticMarkup(createElement(GuidePromo, { slug: product.slug, heading: 'Heading', variant }));
                expect(html, `${product.slug} ${variant}`).not.toContain(formatPrice(product.priceCents));
                expect(html, `${product.slug} ${variant}`).not.toMatch(/\$\d|\bfree\b/i);
                expect(DASHES.test(html), `${product.slug} ${variant}`).toBe(false);
            }
        }
    });

    it('renders the sticker variant with the sticker frame and chip', () => {
        const html = renderToStaticMarkup(createElement(GuidePromo, { slug: 'complete-library', heading: 'Go deeper', variant: 'sticker' }));
        expect(html).toContain('stk-chip');
        expect(html).toContain('border:2px solid #7A1C2B');
        expect(html).toContain('box-shadow:5px 5px 0 #7A1C2B');
    });
});

describe('GuideShelf', () => {
    it('lists each guide with its page count, links to the whole store, and prints no price', () => {
        const html = renderToStaticMarkup(createElement(GuideShelf, { guides: ['compensation-report', 'interview-prep-pack'] }));

        expect(html).toContain('href="/guides/compensation-report"');
        expect(html).toContain(`${GUIDES['compensation-report'].pages} pages`);
        expect(html).toContain('href="/guides/interview-prep-pack"');
        expect(html).toContain('href="/guides"');
        expect(html).not.toMatch(/\$\d|\bfree\b/i);
    });

    it('defaults to the job search guides', () => {
        const html = renderToStaticMarkup(createElement(GuideShelf));
        for (const slug of ['compensation-report', 'interview-prep-pack', 'negotiate-like-an-np', 'first-year-playbook']) {
            expect(html).toContain(`href="/guides/${slug}"`);
        }
    });
});

describe('guideForJob', () => {
    it('gives a new grad job the first-year guide, even when it is remote', () => {
        expect(guideForJob({ newGradFriendly: true, isRemote: true }).slug).toBe('first-year-playbook');
    });

    it('gives a remote or telehealth job the telehealth guide', () => {
        expect(guideForJob({ isRemote: true }).slug).toBe('telehealth-playbook');
        expect(guideForJob({ mode: 'Telehealth' }).slug).toBe('telehealth-playbook');
        expect(guideForJob({ mode: 'Remote' }).slug).toBe('telehealth-playbook');
    });

    it('gives a contract or 1099 job the negotiation guide', () => {
        expect(guideForJob({ jobType: 'Contract' }).slug).toBe('negotiate-like-an-np');
        expect(guideForJob({ jobType: 'Full-Time', title: '1099 Family Nurse Practitioner' }).slug).toBe('negotiate-like-an-np');
        expect(guideForJob({ jobType: '1099' }).slug).toBe('negotiate-like-an-np');
    });

    it('gives any other job interview prep', () => {
        expect(guideForJob({ jobType: 'Full-Time', mode: 'In-Person' }).slug).toBe('interview-prep-pack');
        expect(guideForJob({ title: 'NP, 10991 Main St clinic' }).slug).toBe('interview-prep-pack');
        expect(guideForJob({}).slug).toBe('interview-prep-pack');
    });

    it('writes every pick without a dash and without a price', () => {
        for (const signals of [{ newGradFriendly: true }, { isRemote: true }, { jobType: 'Contract' }, {}]) {
            const pick = guideForJob(signals);
            expect(DASHES.test(`${pick.heading} ${pick.pitch}`), pick.slug).toBe(false);
            expect(`${pick.heading} ${pick.pitch}`).not.toMatch(/\$\d|\bfree\b/i);
        }
    });
});

describe('the guides pages under the header', () => {
    const mainClass = (pathname: string): string => {
        vi.mocked(usePathname).mockReturnValue(pathname);
        const html = renderToStaticMarkup(createElement(MainContent, null, 'page'));
        return html.match(/class="([^"]*)"/)?.[1] ?? '';
    };

    it.each(['/guides', '/guides/negotiate-like-an-np', '/guides/success', '/guides/library'])(
        'adds no extra top padding on %s, so the page starts right under the header',
        (pathname) => {
            expect(mainClass(pathname)).not.toContain('pt-16');
        },
    );

    it('still pads a page that has no layout of its own', () => {
        expect(mainClass('/some-page')).toContain('pt-16');
    });
});
