/**
 * NP guides rewrite, November 2026: the two guides rewritten to rank for
 * their head queries.
 *
 *   how-to-become-a-nurse-practitioner  "how to become a nurse practitioner",
 *                                       "how long does it take to become a
 *                                       nurse practitioner"
 *   fnp-certification-aanp-vs-ancc      "aanp vs ancc", "which fnp exam is
 *                                       easier"
 *
 * Both posts are read through the repo's own loader (lib/blog-mdx-posts.ts),
 * the same code that serves them when no blog_posts row exists, so the FAQ
 * asserted here is the faq_json the FAQPage JSON-LD is built from.
 *
 * What other suites already own, and this one does not repeat:
 *   - tests/regressions/content-seo-2026-10-posts.test.ts: the figure
 *     allowlist and canonical statistic contracts for the how-to-become post;
 *   - tests/regressions/p5-cert-guides-series.test.ts: the certifying body
 *     pairings, the mechanics-only truth rules, the external host allowlist
 *     and the 900 to 1,500 word band for the FNP post.
 *
 * Title budget: the layout appends " | NP Hiring" to every blog title. The
 * 48 character page-part cap (TITLE_PAGE_PART_MAX in
 * lib/pseo/category-metadata.ts) governs pSEO listing titles only; blog
 * titles carry the 70 character cap the content-seo suite applies.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { getMdxPost, parseMdxFrontmatter } from '@/lib/blog-mdx-posts';
import { LICENSE_GUIDE_SLUG_REGEX } from '@/config/niche/content-map';
import { brand } from '@/config/brand';

const ROOT = process.cwd();
const APP_DIR = path.join(ROOT, 'app');
const BLOG_DIR = path.join(ROOT, 'content', 'blog');

const BLOG_TITLE_MAX = 70;
const DESCRIPTION_MIN = 110;
const DESCRIPTION_MAX = 155;
const QUICK_ANSWER_MIN_WORDS = 40;
const QUICK_ANSWER_MAX_WORDS = 60;
const FAQ_MIN_ENTRIES = 5;
const FAQ_MIN_ANSWER_CHARS = 60;
const SOURCES_MIN_LINKS = 3;
const REVIEWED_ISO = '2026-11-23T00:00:00.000Z';

interface GuideSpec {
    slug: string;
    /** The head query the title must lead with. */
    leadQuery: string;
    /** The original publish date, which the rewrite keeps. */
    publishedIso: string;
    /** Internal links the rewrite brief asked for. */
    requiredLinks: readonly string[];
}

const GUIDES: readonly GuideSpec[] = [
    {
        slug: 'how-to-become-a-nurse-practitioner',
        leadQuery: 'How to Become a Nurse Practitioner',
        publishedIso: '2026-10-13T00:00:00.000Z',
        requiredLinks: [
            '/resources/what-is-a-nurse-practitioner',
            '/resources/np-vs-pa',
            '/blog/fnp-certification-aanp-vs-ancc',
            '/blog/np-certification-overview',
            '/blog/how-to-evaluate-np-programs',
            '/scope-of-practice',
            '/resources/fpa-guide',
            '/jobs/new-grad',
            '/blog/new-grad-np-first-job',
            '/salary-guide',
        ],
    },
    {
        slug: 'fnp-certification-aanp-vs-ancc',
        leadQuery: 'AANP vs ANCC',
        publishedIso: '2026-08-06T00:00:00.000Z',
        requiredLinks: ['/blog/how-to-become-a-nurse-practitioner', '/blog/np-certification-overview', '/jobs/family-practice'],
    },
];

function readRaw(slug: string): string {
    return fs.readFileSync(path.join(BLOG_DIR, `${slug}.mdx`), 'utf8');
}

/** Removes link targets and code spans, so URLs and code cannot trip a prose rule. */
function stripLinksAndCode(text: string): string {
    return text.replace(/`[^`]*`/g, ' ').replace(/\]\([^)]*\)/g, ']');
}

/** Visible words of a markdown fragment: link text kept, markup dropped. */
function words(markdown: string): string[] {
    return markdown
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/[#*`>|]/g, '')
        .split(/\s+/)
        .filter(Boolean);
}

/** The text of one H2 section, up to the next H2. */
function sectionAfter(body: string, heading: RegExp): string {
    const parts = body.split(heading);
    return parts.length < 2 ? '' : parts[1].split(/^## /m)[0];
}

/** Every line that uses a dash as punctuation: em dash, en dash, spaced or doubled hyphen. */
function dashOffenders(raw: string): string[] {
    const offenders: string[] = [];
    raw.split(/\r?\n/).forEach((line, i) => {
        const text = stripLinksAndCode(line);
        if (/[—–]/.test(text)) offenders.push(`line ${i + 1}: em or en dash`);
        const trimmed = text.trim();
        if (/^-{3,}$/.test(trimmed)) return; // frontmatter fence or horizontal rule
        const prose = trimmed.startsWith('|')
            ? trimmed.replace(/\|\s*:?-{3,}:?\s*/g, '|') // table separator cells
            : trimmed.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, ''); // list markers
        if (/\S\s-\s\S/.test(prose) || /\s--\s|\w--\w/.test(prose)) {
            offenders.push(`line ${i + 1}: spaced or double hyphen: ${trimmed.slice(0, 80)}`);
        }
    });
    return offenders;
}

/** True when `/a/b` is served by a page or route under app/ (route groups and dynamic segments allowed). */
function appRouteExists(pathname: string): boolean {
    let dir = APP_DIR;
    for (const segment of pathname.split('/').filter(Boolean)) {
        const literal = path.join(dir, segment);
        if (fs.existsSync(literal) && fs.statSync(literal).isDirectory()) {
            dir = literal;
            continue;
        }
        const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
        const group = entries.find((e) => /^\(.+\)$/.test(e.name) && fs.existsSync(path.join(dir, e.name, segment)));
        if (group) {
            dir = path.join(dir, group.name, segment);
            continue;
        }
        const dynamic = entries.find((e) => /^\[.+\]$/.test(e.name));
        if (!dynamic) return false;
        dir = path.join(dir, dynamic.name);
    }
    return ['page.tsx', 'page.ts', 'route.ts'].some((f) => fs.existsSync(path.join(dir, f)));
}

/** True when an internal href reaches a real page: an app route, an authored post or a license guide. */
function internalHrefResolves(href: string): boolean {
    const pathname = href.split(/[?#]/)[0].replace(/\/$/, '') || '/';
    if (pathname === '/') return fs.existsSync(path.join(APP_DIR, 'page.tsx'));
    const blog = pathname.match(/^\/blog\/([^/]+)$/);
    if (blog) return fs.existsSync(path.join(BLOG_DIR, `${blog[1]}.mdx`)) || LICENSE_GUIDE_SLUG_REGEX.test(blog[1]);
    return appRouteExists(pathname);
}

describe('the route check itself', () => {
    it('accepts real routes and posts and rejects invented ones', () => {
        // Arrange
        const real = ['/salary-guide', '/jobs/family-practice', '/blog/np-certification-overview', '/salary-guide/specialty/family-practice'];
        const invented = ['/no-such-page', '/blog/no-such-post', '/resources/no-such-guide'];

        // Act
        const realResults = real.map(internalHrefResolves);
        const inventedResults = invented.map(internalHrefResolves);

        // Assert
        expect(realResults).toEqual(real.map(() => true));
        expect(inventedResults).toEqual(invented.map(() => false));
    });

    it('flags dash punctuation and passes hyphenated compounds', () => {
        expect(dashOffenders('A full-time, RN-to-MSN role.')).toEqual([]);
        expect(dashOffenders('Steps — and timeline')).toHaveLength(1);
        expect(dashOffenders('Steps - and timeline')).toHaveLength(1);
    });
});

describe.each(GUIDES)('$slug', (guide) => {
    const raw = readRaw(guide.slug);
    const { data, content } = parseMdxFrontmatter(raw);
    const body = content.trim();
    const post = getMdxPost(guide.slug);

    it('is served by the repo MDX loader', () => {
        expect(post, `${guide.slug} was skipped by lib/blog-mdx-posts.ts`).not.toBeNull();
        expect(post?.slug).toBe(guide.slug);
        expect(post?.status).toBe('published');
    });

    it('extracts at least five FAQ entries, each a question with a real answer, from the visible section', () => {
        // Arrange
        const visibleQuestions = (sectionAfter(body, /^## Frequently asked questions\s*$/m).match(/^### .+$/gm) ?? []).map((q) =>
            q.replace(/^###\s+/, '').trim(),
        );

        // Act
        const faq = post?.faq_json ?? [];

        // Assert
        expect(faq.length, `${guide.slug}: ${faq.length} FAQ entries`).toBeGreaterThanOrEqual(FAQ_MIN_ENTRIES);
        expect(faq.map((entry) => entry.name)).toEqual(visibleQuestions);
        for (const entry of faq) {
            expect(entry.name, `${guide.slug}: FAQ heading is not a question`).toMatch(/\?$/);
            expect(entry.text.length, `${guide.slug}: "${entry.name}" has no real answer`).toBeGreaterThan(FAQ_MIN_ANSWER_CHARS);
        }
    });

    it('leads its title with the head query and fits the blog title budget', () => {
        const title = String(data.title);
        expect(title.startsWith(guide.leadQuery), `${guide.slug}: title does not lead with "${guide.leadQuery}"`).toBe(true);
        expect(title.length, `${guide.slug}: title is ${title.length} characters`).toBeLessThanOrEqual(BLOG_TITLE_MAX);
        // What the browser tab shows: the layout template appends the brand.
        expect(`${title} | ${brand.name}`.length).toBeLessThanOrEqual(BLOG_TITLE_MAX);
        expect(post?.title).toBe(title);
    });

    it('carries a meta description of 110 to 155 characters', () => {
        const description = String(data.description);
        expect(description.length, `${guide.slug}: description is ${description.length} characters`).toBeGreaterThanOrEqual(DESCRIPTION_MIN);
        expect(description.length, `${guide.slug}: description is ${description.length} characters`).toBeLessThanOrEqual(DESCRIPTION_MAX);
        expect(post?.meta_description).toBe(description);
    });

    it('keeps the original publish date and is reviewed on 2026-11-23, the dateModified source', () => {
        expect(post?.publish_date).toBe(guide.publishedIso);
        // app/blog/[slug]/page.tsx emits dateModified from reviewed_at.
        expect(post?.reviewed_at).toBe(REVIEWED_ISO);
        expect(post?.updated_at).toBe(REVIEWED_ISO);
    });

    it('opens with a Quick answer of 40 to 60 words', () => {
        const first = body.split(/\r?\n/).find((line) => line.trim().length > 0) ?? '';
        expect(first, `${guide.slug}: the first paragraph is not the Quick answer`).toMatch(/^\*\*Quick answer:\*\*\s+\S/);
        const count = words(first).length;
        expect(count, `${guide.slug}: quick answer is ${count} words`).toBeGreaterThanOrEqual(QUICK_ANSWER_MIN_WORDS);
        expect(count, `${guide.slug}: quick answer is ${count} words`).toBeLessThanOrEqual(QUICK_ANSWER_MAX_WORDS);
    });

    it('uses no em dash, en dash or spaced hyphen as punctuation', () => {
        expect(dashOffenders(raw), `${guide.slug}: dash punctuation`).toEqual([]);
    });

    it('links only internal paths that reach a real route or post, including every link the brief asked for', () => {
        // Arrange
        const hrefs = [...new Set([...body.matchAll(/\]\((\/[^)\s]*)\)/g)].map((m) => m[1]))];

        // Act
        const dead = hrefs.filter((href) => !internalHrefResolves(href));

        // Assert
        expect(dead, `${guide.slug}: internal href(s) with no route`).toEqual([]);
        for (const required of guide.requiredLinks) {
            expect(hrefs, `${guide.slug}: missing a link to ${required}`).toContain(required);
        }
    });

    it('ends with a Sources section of https links', () => {
        const h2s = body.match(/^## .+$/gm) ?? [];
        expect(h2s.at(-1)?.trim(), `${guide.slug}: the last H2 is not Sources`).toBe('## Sources');
        const urls = [...sectionAfter(body, /^## Sources\s*$/m).matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => m[1]);
        expect(urls.length, `${guide.slug}: Sources cites ${urls.length} links`).toBeGreaterThanOrEqual(SOURCES_MIN_LINKS);
        for (const url of urls) {
            expect(url.startsWith('https://'), `${guide.slug}: non-https source ${url}`).toBe(true);
        }
    });
});
