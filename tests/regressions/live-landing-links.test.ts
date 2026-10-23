/**
 * Register 2.25: a hard-coded link to a category landing is never printed
 * while that landing answers 404.
 *
 * A landing with 0 jobs answers 404 (TECH-06). On 2026-10-22 three live
 * surfaces linked one: the AGACNP vs AGPCNP post's body linked
 * /jobs/adult-gerontology, and /resources/private-practice-guide and the
 * private practice income calculator linked /jobs/private-practice; the
 * blog's related jobs box could add the second to any career post.
 *
 * They now drop such a link while the stats cron's fresh row for that
 * landing counts no job (lib/pseo/landing-verdicts.ts loadEmptyLandingSlugs),
 * the render rule itself. A landing with a few jobs renders (noindex), so its
 * links stay; a landing with no fresh row is unknown and keeps its links, and
 * so does every link while the rows cannot be read.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { brand } from '@/config/brand';

const h = vi.hoisted(() => ({ empty: vi.fn() }));
vi.mock('@/lib/pseo/landing-verdicts', () => ({ loadEmptyLandingSlugs: h.empty }));

import { landingSlugOf, mayLinkLanding, unlinkClosedLandings } from '@/lib/pseo/live-landing-links';
import { markdownToHtml, autoLinkStates, resanitizeBlogHtml } from '@/lib/blog';
import { autoLinkCategories } from '@/lib/autoLink';
import PrivatePracticeGuidePage from '@/app/resources/private-practice-guide/page';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** The two landings that answered 404 on 2026-10-22. */
const EMPTY = new Set(['adult-gerontology', 'private-practice']);

beforeEach(() => {
    vi.clearAllMocks();
});

describe('the rule', () => {
    it('reads a landing from a /jobs/<landing> link, ours whether written relative or absolute', () => {
        expect(landingSlugOf('/jobs/adult-gerontology')).toBe('adult-gerontology');
        expect(landingSlugOf('/jobs/private-practice/')).toBe('private-practice');
        expect(landingSlugOf('/jobs/private-practice?page=2')).toBe('private-practice');
        expect(landingSlugOf('/jobs/private-practice#roles')).toBe('private-practice');
        expect(landingSlugOf(`${brand.baseUrl}/jobs/private-practice`)).toBe('private-practice');
        expect(landingSlugOf('https://example.com/jobs/private-practice')).toBeNull();
        expect(landingSlugOf('/jobs/locations')).toBeNull();
        expect(landingSlugOf('/jobs/state/texas')).toBeNull();
        expect(landingSlugOf('/salary-guide')).toBeNull();
    });

    it('drops a link only to a landing known to be empty', () => {
        expect(mayLinkLanding('/jobs/adult-gerontology', EMPTY)).toBe(false);
        // A landing with a few jobs renders (noindex, follow), so it stays linked.
        expect(mayLinkLanding('/jobs/neonatal', EMPTY)).toBe(true);
        expect(mayLinkLanding('/jobs/locations', EMPTY)).toBe(true);
        expect(mayLinkLanding('/blog/np-salary-guide', EMPTY)).toBe(true);
    });

    it('keeps every link while the rows cannot be read', () => {
        expect(mayLinkLanding('/jobs/adult-gerontology', null)).toBe(true);
    });

    it('unwraps a link to an empty landing in rendered HTML and keeps its words', () => {
        const html = [
            '<p>The <a href="/jobs/adult-gerontology">adult-gerontology market</a>',
            ` and <a href="${brand.baseUrl}/jobs/private-practice" title="Private practice">private practice</a>,`,
            ' beside <a href="/jobs/family-practice" class="x">family practice</a>',
            ' and <a href="/jobs/locations">every state page</a>.</p>',
        ].join('');
        expect(unlinkClosedLandings(html, EMPTY)).toBe(
            '<p>The adult-gerontology market and private practice, beside <a href="/jobs/family-practice" class="x">family practice</a> and <a href="/jobs/locations">every state page</a>.</p>',
        );
        expect(unlinkClosedLandings(html, null)).toBe(html);
        expect(unlinkClosedLandings(html, new Set())).toBe(html);
    });
});

describe('a blog post, through the page pipeline', () => {
    const body = read('content/blog/agacnp-vs-agpcnp.mdx').replace(/^---[\s\S]*?\n---\r?\n/, '');
    const render = (empty: ReadonlySet<string> | null): string => {
        let html = markdownToHtml(body);
        html = autoLinkStates(html);
        html = autoLinkCategories(html);
        html = unlinkClosedLandings(html, empty);
        return resanitizeBlogHtml(html);
    };

    it('drops the link to the empty adult-gerontology landing and keeps the sentence', () => {
        const html = render(EMPTY);
        expect(html).not.toContain('href="/jobs/adult-gerontology"');
        expect(html).toContain('adult-gerontology market');
        expect(html).toContain('href="/jobs/primary-care"');
    });

    it('keeps it while the landing has jobs', () => {
        expect(render(new Set())).toContain('href="/jobs/adult-gerontology"');
    });
});

describe('the private practice guide', () => {
    it('links /jobs/private-practice only while that landing has jobs', async () => {
        h.empty.mockResolvedValue(EMPTY);
        const closed = renderToStaticMarkup(await PrivatePracticeGuidePage());
        expect(closed).not.toContain('href="/jobs/private-practice"');
        expect(closed).toContain('href="/salary-guide"');

        h.empty.mockResolvedValue(new Set(['adult-gerontology']));
        expect(renderToStaticMarkup(await PrivatePracticeGuidePage())).toContain('href="/jobs/private-practice"');

        h.empty.mockResolvedValue(null);
        expect(renderToStaticMarkup(await PrivatePracticeGuidePage())).toContain('href="/jobs/private-practice"');
    });

    it('re-renders hourly, so the link follows the rows', () => {
        expect(read('app/resources/private-practice-guide/page.tsx')).toMatch(/export const revalidate = 3600;/);
    });
});

describe('the other surfaces use the same rule', () => {
    it('the private practice income calculator filters its cards with it and re-renders hourly', () => {
        const src = read('app/tools/private-practice-revenue-calculator/page.tsx');
        expect(src).toMatch(/export const revalidate = 3600;/);
        expect(src).toContain("loadEmptyLandingSlugs('private-practice-calculator')");
        expect(src).toMatch(/\.filter\(\(l\) => mayLinkLanding\(l\.href, emptyLandings\)\)/);
    });

    it('a blog post unwraps empty landings after the auto-linkers and before the re-sanitize', () => {
        const src = read('app/blog/[slug]/page.tsx');
        expect(src).toContain("loadEmptyLandingSlugs('blog-post')");
        const autoLink = src.indexOf('contentHtml = autoLinkCategories(contentHtml);');
        const unlink = src.indexOf('contentHtml = unlinkClosedLandings(contentHtml, emptyLandings);');
        const resanitize = src.indexOf('contentHtml = resanitizeBlogHtml(contentHtml);');
        expect(autoLink).toBeGreaterThan(-1);
        expect(unlink).toBeGreaterThan(autoLink);
        expect(resanitize).toBeGreaterThan(unlink);
    });

    it("the blog's related jobs box drops an empty landing", () => {
        const src = read('app/blog/[slug]/page.tsx');
        expect(src).toContain('careerPostCta(post, emptyLandings)');
        expect(src).toMatch(/\.filter\(\(l\) => l\.match\.test\(fullText\) && mayLinkLanding\(l\.href, emptyLandings\)\)/);
    });

    it('the category auto-linker links only pages that exist', () => {
        const hrefs = [...read('lib/autoLink.ts').matchAll(/href: '(\/[^']+)'/g)].map((match) => match[1]);
        expect(hrefs.length).toBeGreaterThan(5);
        for (const href of hrefs) {
            expect(fs.existsSync(path.join(ROOT, 'app', ...href.split('/').filter(Boolean), 'page.tsx')), href).toBe(true);
        }
    });
});
