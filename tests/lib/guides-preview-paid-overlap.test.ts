/**
 * The paid-chapter phrase overlap check: no guide preview (lib/guides/previews)
 * copies the part of its guide a reader pays for.
 *
 * Each preview's excerpt names the printed pages it quotes (excerpt.pages).
 * Those pages and the front matter (every page before Chapter 1 starts: the
 * cover, any summary the guide gives away and the "About" page with its
 * disclaimer) are the shown pages; every other page of the PDF is sold. A
 * phrase here is a run of 5 words in a row (numbers break a run, so a table
 * of figures is data, not prose), compared after case, quotes, hyphens and
 * thousands separators are evened out.
 *
 *   - The excerpt may quote only the shown pages: a run it shares with a
 *     sold page must also be on a shown page.
 *   - Every other field the page prints (title, description, H1, intro,
 *     notes, the bridge, key figures, FAQ, the summary) may repeat what the
 *     page already shows (the excerpt, the front matter, the table of
 *     contents and the catalog's copy for the guide), and nothing else from
 *     the guide: a run it shares with a sold page must be in one of those. So
 *     overlap with the paid chapters is 0 beyond what the page shows.
 *   - The table of contents is the guide's own bookmarks by design: each
 *     title and section must be one of the PDF's bookmarks, and is not
 *     compared.
 *   - The disclaimer is the guide's own, word for word.
 *   - The excerpt stays a preview: at most 15% of the guide's words.
 *
 * The PDFs are sold content and never in the repository (the "NP Guides"
 * folder is ignored), so the check reads them where they are: NP_GUIDES_DIR,
 * or the checkout's own "NP Guides" folder. Where neither holds all six it
 * skips, and says so; run it before changing a preview:
 *   NP_GUIDES_DIR="<path to NP Guides>" npx vitest run tests/lib/guides-preview-paid-overlap.test.ts
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { GUIDES, OWN_GUIDE_SLUGS, type OwnGuideSlug } from '@/lib/guides/catalog';
import { excerptText, parseExcerpt } from '@/lib/guides/excerpt';
import { GUIDE_PREVIEWS, type GuidePreview } from '@/lib/guides/previews';

const GUIDES_DIR = process.env.NP_GUIDES_DIR ?? path.join(process.cwd(), 'NP Guides');
const RUN_LENGTH = 5;
const MAX_EXCERPT_SHARE = 0.15;

const pdfPath = (slug: OwnGuideSlug): string => path.join(GUIDES_DIR, GUIDES[slug].sourceFile);
const AVAILABLE = OWN_GUIDE_SLUGS.every((slug) => fs.existsSync(pdfPath(slug)));

/** Lower case, straight quotes, ligatures and thousands separators evened out. */
function normalize(text: string): string {
    return text
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[‘’ʼ]/g, "'")
        .replace(/[“”]/g, '"')
        .replace(/(\d),(?=\d{3}\b)/g, '$1');
}

/** Tokens in reading order: words (anything with a letter) and numbers. Hyphens and punctuation split. */
function tokens(text: string): string[] {
    return normalize(text).match(/[a-z0-9]+(?:['.][a-z0-9]+)*/g) ?? [];
}

const isWord = (token: string): boolean => /[a-z]/.test(token);

/** Every run of RUN_LENGTH words in a row; a number ends a run. */
function wordRuns(text: string): Set<string> {
    const out = new Set<string>();
    let words: string[] = [];
    for (const token of tokens(text)) {
        if (!isWord(token)) {
            words = [];
            continue;
        }
        words.push(token);
        if (words.length >= RUN_LENGTH) out.add(words.slice(-RUN_LENGTH).join(' '));
    }
    return out;
}

const runsOf = (texts: readonly string[]): Set<string> => {
    const out = new Set<string>();
    for (const text of texts) for (const run of wordRuns(text)) out.add(run);
    return out;
};

/** Every string in a value, with the field it sits in. */
function fieldStrings(value: unknown, field = ''): Array<{ field: string; text: string }> {
    if (typeof value === 'string') return [{ field, text: value }];
    if (Array.isArray(value)) return value.flatMap((item, index) => fieldStrings(item, `${field}[${index}]`));
    if (value && typeof value === 'object') {
        return Object.entries(value).flatMap(([key, item]) => fieldStrings(item, field ? `${field}.${key}` : key));
    }
    return [];
}

interface GuideText {
    /** Text per PDF page, index 0 = the cover, so an index is the printed page number. */
    readonly pages: readonly string[];
    /** The PDF's bookmark titles, every level. */
    readonly bookmarks: ReadonlySet<string>;
    /** Page indexes the preview may quote: the front matter and the excerpt's pages. */
    readonly shown: ReadonlySet<number>;
    readonly frontMatter: ReadonlySet<number>;
}

interface OutlineItem {
    readonly title: string;
    readonly items?: readonly OutlineItem[];
}

interface PdfParser {
    getText(): Promise<{ readonly pages: ReadonlyArray<{ readonly num: number; readonly text: string }> }>;
    getInfo(): Promise<{ readonly outline?: readonly OutlineItem[] | null }>;
    destroy(): Promise<void>;
}

const flatten = (items: readonly OutlineItem[]): string[] => items.flatMap((item) => [item.title, ...flatten(item.items ?? [])]);

async function readPdf(file: string): Promise<{ pages: string[]; bookmarks: string[] }> {
    const { PDFParse } = (await import('pdf-parse')) as unknown as { PDFParse: new (options: Record<string, unknown>) => PdfParser };
    const parser = new PDFParse({ data: new Uint8Array(fs.readFileSync(file)), disableWorker: true, verbosity: 0 });
    try {
        const result = await parser.getText();
        const info = await parser.getInfo();
        return {
            pages: [...result.pages].sort((a, b) => a.num - b.num).map((page) => page.text),
            bookmarks: flatten(info.outline ?? []),
        };
    } finally {
        await parser.destroy();
    }
}

const texts = new Map<OwnGuideSlug, GuideText>();

/** A bookmark or a heading as the contents print it: case, quotes and spacing evened out. */
const headingKey = (text: string): string => tokens(text).join(' ');

function guideText(pages: string[], bookmarks: string[], preview: GuidePreview): GuideText {
    const disclaimer = normalize(preview.disclaimer).replace(/\s+/g, ' ');
    const firstChapter = pages.findIndex((page) => /\bchapter 1:/.test(normalize(page).replace(/\s+/g, ' ')));
    expect(firstChapter, 'a page that opens Chapter 1').toBeGreaterThan(0);
    const frontMatter = new Set<number>();
    pages.forEach((page, index) => {
        if (index < firstChapter || normalize(page).replace(/\s+/g, ' ').includes(disclaimer)) frontMatter.add(index);
    });
    const shown = new Set<number>([...frontMatter, ...preview.excerpt.pages]);
    return { pages, bookmarks: new Set(bookmarks.map(headingKey)), shown, frontMatter };
}

const ENTRIES = OWN_GUIDE_SLUGS.map((slug) => [slug, GUIDE_PREVIEWS[slug]] as const);

describe.skipIf(!AVAILABLE)('previews copy nothing from the paid chapters', () => {
    beforeAll(async () => {
        for (const [slug, preview] of ENTRIES) {
            const { pages, bookmarks } = await readPdf(pdfPath(slug));
            texts.set(slug, guideText(pages, bookmarks, preview));
        }
    }, 120_000);

    /** Where a run occurs among the sold pages, as printed page numbers. */
    function soldPagesWith(guide: GuideText, run: string): number[] {
        return guide.pages.flatMap((page, index) => (!guide.shown.has(index) && wordRuns(page).has(run) ? [index] : []));
    }

    it.each(ENTRIES)('%s: the excerpt quotes only the pages it names', (slug, preview) => {
        const guide = texts.get(slug)!;
        const shownRuns = runsOf(guide.pages.filter((_page, index) => guide.shown.has(index)));
        const soldRuns = runsOf(guide.pages.filter((_page, index) => !guide.shown.has(index)));
        const pieces = excerptText(parseExcerpt(preview.excerpt.body));
        const copied = [...runsOf(pieces)].filter((run) => soldRuns.has(run) && !shownRuns.has(run));
        expect(copied.map((run) => `"${run}" (sold page ${soldPagesWith(guide, run).join(', ')})`)).toEqual([]);
    });

    it.each(ENTRIES)('%s: the page copy repeats what the page shows, and no paid chapter', (slug, preview) => {
        const guide = texts.get(slug)!;
        const catalog = GUIDES[slug];
        const soldRuns = runsOf(guide.pages.filter((_page, index) => !guide.shown.has(index)));
        const allowed = new Set([
            ...runsOf(excerptText(parseExcerpt(preview.excerpt.body))),
            ...runsOf(guide.pages.filter((_page, index) => guide.frontMatter.has(index))),
            ...runsOf(preview.toc.flatMap((entry) => [entry.title, ...entry.sections])),
            ...runsOf([catalog.title, catalog.subtitle, catalog.audience, catalog.summary, ...catalog.contents]),
        ]);
        const { excerpt, toc, disclaimer, ...pageCopy } = preview;
        const fields = [
            ...fieldStrings(pageCopy),
            ...fieldStrings({ heading: excerpt.heading, note: excerpt.note, bridge: excerpt.bridge }, 'excerpt'),
        ];
        expect(toc.length + disclaimer.length).toBeGreaterThan(0);
        const copied = fields.flatMap(({ field, text }) =>
            [...wordRuns(text)].filter((run) => soldRuns.has(run) && !allowed.has(run)).map((run) => `${field}: "${run}" (sold page ${soldPagesWith(guide, run).join(', ')})`),
        );
        expect(copied).toEqual([]);
    });

    it.each(ENTRIES)('%s: the contents print only the PDF\'s bookmarks, and the disclaimer is the guide\'s own', (slug, preview) => {
        const guide = texts.get(slug)!;
        expect(guide.bookmarks.size).toBeGreaterThan(10);
        for (const entry of preview.toc) {
            const title = entry.chapter === undefined ? entry.title : `Chapter ${entry.chapter}: ${entry.title}`;
            expect(guide.bookmarks.has(headingKey(title)), `${slug}: ${title}`).toBe(true);
            for (const section of entry.sections) expect(guide.bookmarks.has(headingKey(section)), `${slug}: ${section}`).toBe(true);
        }
        const about = [...guide.frontMatter].map((index) => normalize(guide.pages[index]).replace(/\s+/g, ' ')).join(' ');
        expect(about).toContain(normalize(preview.disclaimer));
    });

    it.each(ENTRIES)('%s: the excerpt is a preview, not the guide', (slug, preview) => {
        const guide = texts.get(slug)!;
        const excerptWords = excerptText(parseExcerpt(preview.excerpt.body)).flatMap(tokens).length;
        const guideWords = guide.pages.flatMap(tokens).length;
        expect(excerptWords / guideWords, `${excerptWords} of ${guideWords}`).toBeLessThanOrEqual(MAX_EXCERPT_SHARE);
        // The pages it names are real pages of the guide, inside the PDF.
        for (const printed of preview.excerpt.pages) {
            expect(printed).toBeGreaterThan(0);
            expect(printed).toBeLessThan(guide.pages.length);
        }
    });
});

describe('the overlap check itself', () => {
    it('reads runs of five words, broken by numbers, whatever the case, quotes or hyphens', () => {
        expect([...wordRuns('Five unpaid hours a week over 46 working weeks')]).toEqual(['five unpaid hours a week', 'unpaid hours a week over']);
        expect(wordRuns('The employer’s Self-Employed rate')).toEqual(wordRuns("the employer's self employed rate"));
        expect(wordRuns('$132,300 is the median of 323,040 NPs').size).toBe(0);
    });

    it('says where the PDFs are looked for, and skips only when they are missing', () => {
        expect(GUIDES_DIR.length).toBeGreaterThan(0);
        if (!AVAILABLE) {
            console.warn(`[guides-preview-paid-overlap] the guide PDFs are not in ${GUIDES_DIR}; set NP_GUIDES_DIR to run the overlap check.`);
        }
        expect(typeof AVAILABLE).toBe('boolean');
    });
});
