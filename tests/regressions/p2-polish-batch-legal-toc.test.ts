/**
 * P3 #13 — table of contents on the long legal pages.
 *
 * /privacy (16 sections) and /terms (18 sections) were unbroken walls of
 * prose: no in-page navigation, no heading anchors, so nothing could deep
 * link to the refund clause or the CCPA section.
 *
 * The failure mode a TOC introduces is drift — a heading gets renamed or a
 * section inserted, and the TOC quietly points at an anchor that no longer
 * exists (a dead in-page link, invisible in CI). This guard pins the two
 * halves together: every TOC entry must have a heading carrying that exact
 * `id` AND that exact title text, and the counts must match, so neither
 * side can move alone.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

interface TocEntry {
    id: string;
    title: string;
}

/** Pull `{ id: 'x', title: '...' }` pairs out of the page's SECTIONS array. */
function parseTocEntries(src: string, constName: string): TocEntry[] {
    const block = src.match(new RegExp(`const ${constName}[^=]*=\\s*\\[([\\s\\S]*?)\\n\\];`));
    if (!block) throw new Error(`${constName} array not found`);
    return [...block[1].matchAll(/\{ id: '([^']+)', title: (?:'([^']*)'|"([^"]*)") \}/g)].map((m) => ({
        id: m[1],
        title: m[2] ?? m[3],
    }));
}

/** JSX heading text → plain text (the pages escape apostrophes as &apos;). */
function normalizeHeading(text: string): string {
    return text
        .replace(/&apos;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .trim();
}

/** Every `<h2 id="..." style={h2Style}>Title</h2>` in document order. */
function parseHeadings(src: string): TocEntry[] {
    return [...src.matchAll(/<h2 id="([^"]+)" style=\{h2Style\}>([\s\S]*?)<\/h2>/g)].map((m) => ({
        id: m[1],
        title: normalizeHeading(m[2]),
    }));
}

const PAGES = [
    { rel: 'app/privacy/page.tsx', constName: 'PRIVACY_SECTIONS', tocId: 'privacy-toc-heading', minSections: 16 },
    { rel: 'app/terms/page.tsx', constName: 'TERMS_SECTIONS', tocId: 'terms-toc-heading', minSections: 18 },
] as const;

describe.each(PAGES)('P3 #13 — $rel table of contents', ({ rel, constName, tocId, minSections }) => {
    const src = read(rel);
    const entries = parseTocEntries(src, constName);
    const headings = parseHeadings(src);

    it('renders a labelled navigation landmark', () => {
        expect(src).toContain(`aria-labelledby="${tocId}"`);
        expect(src).toContain(`id="${tocId}"`);
        expect(src).toContain(`{${constName}.map(`);
        expect(src).toContain('href={`#${s.id}`}');
    });

    it(`still covers all ${minSections} sections`, () => {
        expect(entries.length).toBe(minSections);
        expect(headings.length).toBe(minSections);
    });

    it('every TOC entry matches a heading with the same id AND title, in order', () => {
        expect(headings.map((h) => h.id)).toEqual(entries.map((e) => e.id));
        expect(headings.map((h) => h.title)).toEqual(entries.map((e) => e.title));
    });

    it('section ids are unique and anchor-safe', () => {
        const ids = entries.map((e) => e.id);
        expect(new Set(ids).size, `duplicate section id in ${constName}`).toBe(ids.length);
        for (const id of ids) {
            expect(id, `"${id}" is not a lowercase-hyphenated anchor`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        }
    });

    it('headings clear the sticky header when jumped to', () => {
        expect(src, 'h2Style needs scrollMarginTop or anchors land under the header').toContain('scrollMarginTop');
    });
});
