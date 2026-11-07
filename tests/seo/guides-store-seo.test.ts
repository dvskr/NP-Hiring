/**
 * The guides store's search and crawl surface: the store and its product
 * pages are crawlable, linked sitewide and self canonical, with share cards
 * from the site's own /api/og renderer; a reader's library and the
 * post-checkout page are private (noindex, no referrer, blocked in
 * robots.txt). The sitemap entries are pinned in
 * tests/regressions/sitemap-content-lastmod.test.ts.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import robotsHandler from '@/app/robots';
import { brand } from '@/config/brand';
import { allProducts } from '@/lib/guides/catalog';
import * as storePage from '@/app/guides/page';
import * as productPage from '@/app/guides/[slug]/page';
import { metadata as successMetadata } from '@/app/guides/success/layout';

const read = (rel: string): string => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const asArray = (v: string | string[] | undefined): string[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

describe('robots.txt and the guides store', () => {
    const robots = robotsHandler();
    const rules = Array.isArray(robots.rules) ? robots.rules : [robots.rules];

    it.each(['*', 'GPTBot', 'ClaudeBot', 'AhrefsBot'])('%s may not fetch the library or the success page, and may fetch the store', (agent) => {
        const rule = rules.find((r) => asArray(r.userAgent).includes(agent));
        expect(rule, `no rule block for ${agent}`).toBeDefined();
        const disallow = asArray(rule!.disallow);
        const blocked = (page: string): boolean => disallow.some((prefix) => page.startsWith(prefix));
        // ClaudeBot's block keeps its own short list of account surfaces
        // (it carries no /success either); every other block takes FULL_DISALLOW.
        if (agent !== 'ClaudeBot') {
            expect(blocked('/guides/library'), `${agent} /guides/library`).toBe(true);
            expect(blocked('/guides/library/0123abcd'), `${agent} a library link`).toBe(true);
            expect(blocked('/guides/success'), `${agent} /guides/success`).toBe(true);
        }
        expect(blocked('/guides'), `${agent} /guides`).toBe(false);
        for (const product of allProducts()) expect(blocked(`/guides/${product.slug}`), `${agent} ${product.slug}`).toBe(false);
    });

    it('the private pages also answer noindex and send no referrer', () => {
        expect(successMetadata.robots).toEqual({ index: false, follow: false });
        expect(successMetadata.referrer).toBe('no-referrer');
        const route = read('app/guides/library/[token]/route.ts');
        expect(route).toContain("'X-Robots-Tag', 'noindex, nofollow'");
        expect(route).toContain("'Referrer-Policy', 'no-referrer'");
        expect(route).toContain("'Cache-Control', 'private, no-store'");
    });
});

describe('the store pages are indexable and share on the site renderer', () => {
    it('/guides is self canonical with an /api/og page card', async () => {
        const metadata = await storePage.generateMetadata();
        expect(metadata.alternates?.canonical).toBe(`${brand.baseUrl}/guides`);
        expect(metadata.robots).toBeUndefined();
        const image = JSON.stringify(metadata.openGraph?.images);
        expect(image).toContain(`${brand.baseUrl}/api/og?title=`);
        expect(image).toContain('&type=page');
    });

    it('every product page is self canonical with its own card', async () => {
        for (const product of allProducts()) {
            const metadata = await productPage.generateMetadata({ params: Promise.resolve({ slug: product.slug }) });
            expect(metadata.alternates?.canonical, product.slug).toBe(`${brand.baseUrl}/guides/${product.slug}`);
            expect(metadata.robots, product.slug).toBeUndefined();
            expect(JSON.stringify(metadata.openGraph?.images), product.slug).toContain('/api/og?title=');
        }
    });
});

describe('the store is linked sitewide', () => {
    it('from the footer and the mobile menu', () => {
        expect(read('components/Footer.tsx')).toContain("href: '/guides'");
        const header = read('components/Header.tsx');
        const extra = header.slice(header.indexOf('const mobileExtraLinks = ['), header.indexOf('];', header.indexOf('const mobileExtraLinks = [')));
        expect(extra).toContain("{ href: '/guides', label: 'Career Guides', icon: Library }");
    });

    it('from the job seeker dashboard', () => {
        const dashboard = read('components/dashboard/DashboardContent.tsx');
        expect(dashboard).toContain("{ icon: BookOpen, label: 'Career Guides', href: '/guides' }");
        expect(dashboard).toContain('<GuideShelf />');
    });

    it('in llms.txt, without a price or a free claim the static file could not keep true', () => {
        for (const file of ['public/llms.txt', 'public/llms-full.txt']) {
            const line = read(file).split('\n').find((l) => l.startsWith('- /guides'));
            expect(line, file).toBeDefined();
            expect(line, file).not.toMatch(/\$\d|\bfree\b/i);
            expect(read(file), file).not.toMatch(/100% free/i);
        }
    });
});
