/**
 * Indexing audit CQ-13: one primary URL per intent.
 *
 *   - "1099 vs W-2 for NPs": /resources/1099-vs-w2 is primary. The blog post
 *     at /blog/np-1099-vs-w2 now serves a different intent (negotiating a
 *     1099 contract) and links the primary for the comparison.
 *   - "NP salary": /salary-guide is primary. The blog post at
 *     /blog/np-salary-guide now explains what moves NP pay and links the
 *     primary for the figures.
 *   - "practice authority by state": /scope-of-practice is the one state by
 *     state reference; /resources/fpa-guide explains what full practice
 *     authority means and links the explorer instead of repeating its table.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseMdxFrontmatter } from '@/lib/blog-mdx-posts';
import { HOMEPAGE_FEATURED_POSTS } from '@/config/niche/content-map';
import FPAGuidePage, { metadata as fpaMetadata } from '@/app/resources/fpa-guide/page';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const post = (slug: string) => parseMdxFrontmatter(read(`content/blog/${slug}.mdx`));

/** Every markdown link [text](href) in a body. */
const links = (body: string): Array<{ text: string; href: string }> =>
    [...body.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)].map((m) => ({ text: m[1], href: m[2] }));

const quickAnswer = (body: string) => body.split(/\r?\n---\r?\n/)[0];

/**
 * Prose split into sentences: at line breaks, and after a full stop,
 * question or exclamation mark followed by whitespace and a capital, a link
 * or emphasis. URLs keep their dots because no whitespace follows them.
 */
const sentences = (body: string): string[] =>
    body.split(/\r?\n+|(?<=[.!?])\s+(?=[A-Z[*_(])/).filter((s) => s.trim().length > 0);

/** Wording that promises a state by state answer, which /scope-of-practice now owns. */
const PER_STATE_INTENT = /per-state|state[ -]by[ -]state|your state['’]s entry/i;

const BLOG_SOURCES = [
    ...fs.readdirSync(path.join(ROOT, 'content', 'blog')).filter((f) => f.endsWith('.mdx')).map((f) => `content/blog/${f}`),
    'lib/blog-ceu-guide.ts',
];

describe('/blog/np-1099-vs-w2 serves the contract-negotiation intent', () => {
    const { data, content } = post('np-1099-vs-w2');

    it('is titled and described as a contract guide, not as the comparison', () => {
        expect(String(data.title)).toMatch(/contract/i);
        expect(String(data.title)).not.toMatch(/\bvs\.?\s*W-?2\b/i);
        expect(String(data.description)).toMatch(/contract/i);
        expect(String(data.reviewed) >= '2026-09-28').toBe(true);
    });

    it('hands the comparison to the primary page and its calculator', () => {
        expect(quickAnswer(content)).toContain('](/resources/1099-vs-w2)');
        expect(content).toContain('](/tools/1099-vs-w2-calculator)');
    });

    it('no longer carries the comparison sections the primary page covers', () => {
        for (const heading of ['## The structural difference', '## The math that closes the gap', '## When each structure wins']) {
            expect(content).not.toContain(heading);
        }
        expect(content).toContain('## Guaranteed volume and cancellation');
        expect(content).toContain('## Termination and restrictive covenants');
    });
});

/**
 * The audit's CQ-13 fix names /resources/1099-vs-w2 the primary comparison
 * page "with the calculator as the tool it links to", so the three URLs of the
 * cluster are wired around it: the primary links its calculator and the
 * retitled contract post, and both of those link back to it. These cases pass
 * once the app/resources/1099-vs-w2/page.tsx handoff lands.
 */
describe('/resources/1099-vs-w2 is the hub of the 1099 cluster', () => {
    const src = read('app/resources/1099-vs-w2/page.tsx');

    it('links the calculator and the contract post from its related grid', () => {
        expect(src).toContain('href="/tools/1099-vs-w2-calculator"');
        expect(src).toContain('href="/blog/np-1099-vs-w2"');
    });

    it('names the contract post for its own intent, not as a second comparison', () => {
        const card = src.slice(src.indexOf('href="/blog/np-1099-vs-w2"'), src.indexOf('href="/blog/np-1099-vs-w2"') + 600);
        const title = card.match(/<h3[^>]*>([^<]*(?:\{[^}]*\}[^<]*)*)<\/h3>/)?.[1] ?? '';
        expect(title).toMatch(/contract/i);
        expect(title).not.toMatch(/\bvs\.?\b|versus/i);
    });

    it('the calculator links back to the primary comparison page', () => {
        expect(read('app/tools/1099-vs-w2-calculator/page.tsx')).toMatch(/href[=:]\s*["'{`]*\/resources\/1099-vs-w2["'`]/);
    });
});

describe('/blog/np-salary-guide serves the "what moves pay" intent', () => {
    const { data, content } = post('np-salary-guide');

    it('is no longer titled as a salary guide', () => {
        expect(String(data.title)).not.toMatch(/salary guide/i);
        expect(String(data.title)).toMatch(/what moves/i);
        expect(String(data.reviewed) >= '2026-09-28').toBe(true);
    });

    it('sends the reader to the primary page for the figures', () => {
        expect(quickAnswer(content)).toContain('](/salary-guide)');
    });

    it('promises a state median only where the salary guide gate publishes one', () => {
        // /salary-guide publishes a state median only for a state with enough
        // postings with disclosed pay from enough employers (plus the
        // employer-share cap), so most states have none. The quick answer is
        // the likeliest search snippet and must not promise every state.
        const answer = quickAnswer(content);
        expect(answer).not.toMatch(/each state['’]s median|every state['’]s median|median for (?:each|every) state/i);
        expect(answer).toContain('a state median wherever enough postings with disclosed pay from enough employers support one');
        for (const sentence of sentences(content)) {
            if (!/state medians?\b/i.test(sentence)) continue;
            expect(sentence, 'a state median claim must carry the gate').toMatch(/where(?:ver)? (?:one is published|enough)|this board can support/i);
        }
    });

    it('does not answer the primary page\'s own question in its FAQ', () => {
        expect(content).not.toMatch(/^### What is the median nurse practitioner salary\?/m);
    });
});

describe('internal links name each page for its own intent', () => {
    const files = BLOG_SOURCES;

    it('a comparison anchor points at /resources/1099-vs-w2, never at the contract post', () => {
        for (const file of files) {
            for (const { text, href } of links(read(file))) {
                if (href === '/blog/np-1099-vs-w2') {
                    expect(text, `${file}: "${text}" sends a comparison reader to the contract post`).not.toMatch(/\bvs\.?\b|versus|breakdown|explainer/i);
                }
                if (/1099 (?:vs\.?|versus) W-?2/i.test(text) && !/calculator/i.test(text)) {
                    expect(href, `${file}: "${text}"`).toBe('/resources/1099-vs-w2');
                }
            }
        }
    });

    it('no post calls the pay-factors post a salary guide', () => {
        for (const file of files) {
            for (const { text, href } of links(read(file))) {
                if (href === '/blog/np-salary-guide') expect(text, file).not.toMatch(/salary guide/i);
            }
        }
    });

    it('no post sends a state by state reader to /resources/fpa-guide', () => {
        const sources = [...files, 'lib/blog-license-guides.ts'];
        for (const file of sources) {
            for (const sentence of sentences(read(file))) {
                if (!sentence.includes('/resources/fpa-guide')) continue;
                expect(sentence, `${file}: the per-state picture lives on /scope-of-practice`).not.toMatch(PER_STATE_INTENT);
            }
        }
    });

    it('the program evaluation post sends the per-state picture to the explorer', () => {
        const { content } = post('how-to-evaluate-np-programs');
        expect(content).toContain('The [scope of practice explorer](/scope-of-practice) has the per-state picture.');
        expect(content).toContain('The [full practice authority guide](/resources/fpa-guide) explains what the classification changes.');
    });

    it('the sentence splitter catches the old wording (guards the guard)', () => {
        const old = 'That count varies. The [full practice authority guide](/resources/fpa-guide) has the per-state picture. That landscape matters.';
        const hits = sentences(old).filter((s) => s.includes('/resources/fpa-guide'));
        expect(hits).toEqual(['The [full practice authority guide](/resources/fpa-guide) has the per-state picture.']);
        expect(hits[0]).toMatch(PER_STATE_INTENT);
    });
});

describe('the blog_posts mirror refresh names the posts this fix rewrote or relinked', () => {
    const src = read('scripts/indexing-fixes/refresh-rewritten-blog-posts.ts');
    const block = src.match(/const SLUGS = \[([\s\S]*?)\] as const;/);
    const slugs = block ? [...block[1].matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]) : [];

    it('lists the rewritten and relinked posts, each backed by a content/blog file', () => {
        expect(slugs).toEqual(expect.arrayContaining(['np-1099-vs-w2', 'np-salary-guide', 'how-to-evaluate-np-programs']));
        for (const slug of slugs) {
            expect(fs.existsSync(path.join(ROOT, 'content', 'blog', `${slug}.mdx`)), slug).toBe(true);
        }
    });

    it('stays a dry run unless --apply is passed, and writes in one transaction', () => {
        expect(src).toContain("process.argv.includes('--apply')");
        expect(src).toContain('prisma.$transaction(');
    });
});

/**
 * The homepage reading tape (components/HomepageBlogSection.tsx, mounted in
 * app/page.tsx) is the site's strongest internal link. Its cards must name
 * each retitled post for its new intent, and match the post's own title.
 * These cases pass once the config/niche/content-map.ts handoff lands.
 */
describe('the homepage reading tape names each retitled post for its own intent', () => {
    const cards = (href: string) => HOMEPAGE_FEATURED_POSTS.filter((p) => p.href === href);

    it('the contract post card promises no comparison and no take-home math', () => {
        const { data } = post('np-1099-vs-w2');
        for (const card of cards('/blog/np-1099-vs-w2')) {
            expect(`${card.title} ${card.description}`).not.toMatch(/\bvs\.?\b|versus|take-home/i);
            expect(card.title).toBe(String(data.title));
        }
    });

    it('the pay-factors post card is not called a salary guide', () => {
        const { data } = post('np-salary-guide');
        for (const card of cards('/blog/np-salary-guide')) {
            expect(`${card.title} ${card.description}`).not.toMatch(/salary guide/i);
            expect(card.title).toBe(String(data.title));
        }
    });

    it('the empty-blog fallback card does not promise a state list from the FPA guide', () => {
        const fallback = read('components/HomepageBlogSection.tsx')
            .split(/\r?\n/)
            .filter((line) => line.includes("href: '/resources/fpa-guide'"));
        for (const line of fallback) expect(line).not.toMatch(PER_STATE_INTENT);
    });
});

/**
 * Narrowing /resources/fpa-guide made these descriptions of it false: it no
 * longer classifies all 50 states, prints a state's entry, or deep-links
 * boards. Each now names the guide for its concept, and the state by state
 * promise moves to /scope-of-practice. These cases pass once the handoffs for
 * the listed (non content-guides) files land.
 */
describe('site copy describes /resources/fpa-guide as the concept guide', () => {
    const STALE: ReadonlyArray<readonly [file: string, stale: string]> = [
        ['app/resources/private-practice-guide/page.tsx', "Read your state's entry in the Full Practice Authority guide"],
        ['app/resources/private-practice-guide/page.tsx', 'Whether, and when, your state lets you practice without an agreement.'],
        ['app/page.tsx', 'All 50 states classified'],
        ['app/resources/page.tsx', 'All 50 states classified'],
        ['app/resources/page.tsx', "badge: '50 States'"],
        ['app/tools/licensure-checker/page.tsx', 'All 50 states classified'],
        ['app/press/page.tsx', 'Per-state detail, including what each classification means in practice, is on our'],
        ['public/llms.txt', '/resources/fpa-guide: Full practice authority by state'],
        ['public/llms-full.txt', '/resources/fpa-guide: Full practice authority by state'],
        ['components/HomepageBlogSection.tsx', 'Full Practice Authority, state by state'],
        ['app/for-job-seekers/page.tsx', 'Which states let you practice independently?'],
        ['app/resources/1099-vs-w2/page.tsx', 'so check its classification first'],
        ['app/tools/private-practice-revenue-calculator/page.tsx', 'Whether an independent practice is available to you at all.'],
        ['lib/compare-data.ts', 'a full practice-authority guide, each linking to the actual state board'],
        ['lib/compare-data.ts', 'a practice-authority guide with board deep-links'],
    ];

    it.each(STALE)('%s no longer says "%s"', (file, stale) => {
        expect(read(file)).not.toContain(stale);
    });

    it('the private practice guide sends step 1 readers to the explorer', () => {
        const src = read('app/resources/private-practice-guide/page.tsx');
        expect(src).toContain("Read your state's entry in the scope of practice explorer for its specific requirement.");
        expect(src).toMatch(/link: \{ href: '\/scope-of-practice'/);
    });

    it('the llms files list the explorer as the by-state reference', () => {
        for (const file of ['public/llms.txt', 'public/llms-full.txt']) {
            const src = read(file);
            expect(src, file).toContain('- /scope-of-practice: Practice authority rules by state');
            expect(src, file).toContain('- /resources/fpa-guide: What full practice authority means');
        }
    });
});

describe('/resources/fpa-guide explains FPA and links the state explorer', () => {
    const src = read('app/resources/fpa-guide/page.tsx');

    it('no longer prints the per-state table', () => {
        expect(src).not.toContain('<table');
        expect(src).not.toContain('STATE_PRACTICE_AUTHORITY');
        expect(src).not.toContain('info.details');
        expect(src).not.toContain('All 50 States');
    });

    it('links /scope-of-practice wherever it used to send the reader to its own table', () => {
        expect(src).toContain("const SCOPE_EXPLORER_PATH = '/scope-of-practice';");
        expect((src.match(/SCOPE_EXPLORER_PATH/g) ?? []).length).toBeGreaterThanOrEqual(5);
        expect(src).not.toMatch(/table (?:on this page|above|below)/);
    });

    it('is titled for the concept, not for the state list', () => {
        expect(String(fpaMetadata.title)).toMatch(/what full practice authority means/i);
        expect(String(fpaMetadata.title)).not.toMatch(/all 50|state.by.state/i);
        expect(String(fpaMetadata.description)).not.toMatch(/state-by-state/i);
    });

    it('renders one H1, the explorer link, and no dash in its visible copy', () => {
        const html = renderToStaticMarkup(React.createElement(FPAGuidePage));
        expect(html.match(/<h1\b/g)).toHaveLength(1);
        expect(html).toContain('href="/scope-of-practice"');
        expect(html).toContain('How to Read Your State&#x27;s Practice Rule');
        const text = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ');
        expect(text).not.toMatch(/[–—]| - /);
        expect(text).toMatch(/Last Updated: [A-Z][a-z]+ \d{4}/);
    });

    it('says median, never averages, and makes no inventory count claim', () => {
        const copy = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
        expect(copy).not.toMatch(/\baverages\b/i);
        expect(copy).not.toMatch(/\bthousands of\b/i);
    });

    it('/scope-of-practice stays the state-by-state reference', () => {
        const scope = read('app/scope-of-practice/page.tsx');
        expect(scope).toContain('Scope of Practice by State');
        expect(scope).toContain('<ScopeOfPracticeExplorer');
        expect(scope).toContain('href="/resources/fpa-guide"');
    });
});
