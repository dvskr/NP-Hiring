/**
 * /guides/[slug] for one of this board's own guides, which has preview copy
 * (lib/guides/previews), rendered: what a reader, a crawler and an answer
 * engine get. The page is called the way Next calls it and the HTML is read
 * for its text, sections, links and JSON-LD, in both phases of the store
 * (lib/guides/phase.ts): free to claim until checkout is set up, sold at the
 * catalog price once it is. Behaviour, not source shape.
 *
 * Every one of the six guides has preview copy, and every check on the page
 * runs for each of them. Also pinned: the bundles and the psych editions,
 * which have no preview copy, still render the plain product page. The
 * paid-chapter phrase check, which needs the PDFs, is
 * tests/lib/guides-preview-paid-overlap.test.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { brand } from '@/config/brand';
import GuideProductPage, { generateMetadata } from '@/app/guides/[slug]/page';
import {
    ADD_ON,
    BUNDLES,
    GUIDES,
    OWN_GUIDE_SLUGS,
    PSYCH_GUIDE_SLUGS,
    allProducts,
    formatPrice,
    type OwnGuideSlug,
    type Product,
} from '@/lib/guides/catalog';
import { excerptText, parseExcerpt } from '@/lib/guides/excerpt';
import { productOgCard, guideOgImageUrl } from '@/lib/guides/og';
import { guidePriceCopy, type GuidePhase } from '@/lib/guides/phase';
import {
    GUIDE_PREVIEWS,
    getGuidePreview,
    previewChapterCount,
    previewSearchTitle,
    previewSummary,
    type GuidePreview,
} from '@/lib/guides/previews';
import { SERP_TITLE_MAX, DESCRIPTION_MAX } from '@/lib/pseo/category-metadata';
import { STATE_CODES } from '@/lib/pseo/setting-state-config';
import { getStatesByAuthority } from '@/lib/state-practice-authority';
import { DONOR_COPY_RE } from '../e2e/helpers/seo';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PHASES: readonly GuidePhase[] = ['free', 'paid'];
const DASH = /[–—]|\s-\s/;

/** The words the niche-copy and brand-leak scanners count: no preview may carry one. */
const NAMES = /pmhnp|psychiatric|mental health|akari/i;

/** Words that offer a guide at no cost (tests/app/guides-store-phase.test.ts): the price block says that, never the copy. */
const FREE_OFFER = /Free for a limited time|Get them free|Get it free|free to claim|claimed at no cost|\bFree\b|free (?:preview|chapter|excerpt|summary|download|to read)/i;

function setPhase(phase: GuidePhase): void {
    vi.stubEnv('STRIPE_SECRET_KEY', phase === 'paid' ? 'sk_test_x' : '');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', phase === 'paid' ? 'whsec_x' : '');
}

afterEach(() => {
    vi.unstubAllEnvs();
});

/** The excerpt markup's "- " list markers open a line; they are markup, not punctuation. */
const withoutListMarkers = (text: string): string => text.replace(/^[ \t]*- /gm, '');

/** An opening tag that hides its element from people: the hidden attribute or class, display none, aria-hidden. */
const HIDING_TAG = /\shidden(?=[\s=>/])|class="(?:[^"]*\s)?hidden(?:\s[^"]*)?"|display:\s*none|aria-hidden="true"/;
const hides = (html: string): boolean => [...html.matchAll(/<[a-z][^>]*>/gi)].some(([tag]) => HIDING_TAG.test(tag));

const decode = (s: string): string =>
    s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Inline tags join the words around them; every other tag is a word break. */
const INLINE_TAG = /<\/?(?:a|strong|em|b|i)\b[^>]*>/g;

const textOf = (fragment: string): string => squash(decode(fragment.replace(INLINE_TAG, '').replace(/<[^>]+>/g, ' ')));

function visibleText(html: string): string {
    return textOf(html.replace(/<script\b[\s\S]*?<\/script>/g, ' ').replace(/<style\b[\s\S]*?<\/style>/g, ' '));
}

/** The HTML of the element that carries `id="..."`, from its opening tag up to its closing tag. */
function elementById(html: string, id: string, tag = 'section'): string {
    const at = html.indexOf(`id="${id}"`);
    expect(at, `#${id}`).toBeGreaterThan(-1);
    const open = html.lastIndexOf(`<${tag}`, at);
    return html.slice(open, html.indexOf(`</${tag}>`, at) + tag.length + 3);
}

/** The band (a StickerStage section) a heading names. */
function bandOf(html: string, headingId: string): string {
    const match = new RegExp(`<section\\b[^>]*aria-labelledby="${headingId}"[^>]*>[\\s\\S]*?</section>`).exec(html);
    expect(match, headingId).not.toBeNull();
    return match![0];
}

function jsonLdBlocks(html: string): Array<Record<string, unknown>> {
    return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
}

const headings = (html: string): Array<{ level: number; text: string }> =>
    [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g)].map((m) => ({ level: Number(m[1]), text: textOf(m[2]) }));

async function render(slug: string, phase: GuidePhase = 'free'): Promise<string> {
    setPhase(phase);
    const element = await GuideProductPage({ params: Promise.resolve({ slug }) });
    return renderToStaticMarkup(element as ReactElement).replace(/<!-- -->/g, '');
}

const metadataFor = (slug: string): Promise<Metadata> => generateMetadata({ params: Promise.resolve({ slug }) });

/** Every string in a preview, with the field it sits in. */
function previewStrings(value: unknown, field = ''): Array<{ field: string; text: string }> {
    if (typeof value === 'string') return [{ field, text: value }];
    if (Array.isArray(value)) return value.flatMap((item, index) => previewStrings(item, `${field}[${index}]`));
    if (value && typeof value === 'object') {
        return Object.entries(value).flatMap(([key, item]) => previewStrings(item, field ? `${field}.${key}` : key));
    }
    return [];
}

/** A catalog price written out, e.g. "$9", but not the start of "$9,000" or "$9.50". */
const priceLiteral = (cents: number): RegExp => new RegExp(`${formatPrice(cents).replace('$', '\\$').replace('.', '\\.')}(?![\\d,]|\\.\\d)`);

/**
 * Text no preview may print, wherever it sits, the contents included: the
 * guides' known defects (the unsourced "hire faster" claim in any wording,
 * the compensation report's "specialty choice moves" line, the negotiation
 * guide's licenses total whose parts do not add up, the "no shortcut"
 * licensing sentence) and any pointer to another edition of a guide.
 */
const DEFECT_PHRASES = [
    /hires? faster/i,
    /\bhires?\b(?:\s+\w+){0,3}\s+faster\b/i,
    /hire fast/i,
    /specialty choice moves/i,
    /\$1,350/,
    /no shortcut/i,
    /edition at/i,
    /pmhnphiring/i,
];
/**
 * Date-bound DEA text, stale once the telehealth prescribing rules change:
 * out of every field but a chapter title in the contents, which prints the
 * chapter's name as the PDF does.
 */
const DATE_PHRASES = [/January 1, 2027/, /January 2027/, /December 31, 2026/, /flexibilities/i, /special registration/i, /\bDEA change\b/i, /October 30, 2026/, /November 7, 2026/];
const CHAPTER_TITLE = /^toc\[\d+\]\.title$/;

/**
 * An AANP pay figure: "AANP" and a dollar figure in one sentence. An exam fee
 * for AANP members ("$240 for AANP members") is a fee the certification
 * boards set, not an AANP figure, and AANPCB is another body.
 */
const AANP_FIGURE = /\bAANP\b(?!\s+(?:student\s+)?members?\b)[^.]*\$\d/;

/**
 * Practice authority counts as a preview writes them: "27 states and DC",
 * "Full practice (27 + DC)", "the other 23 states", "12 states reduced and
 * 11 restricted", "23 states (12 reduced and 11 restricted)". Each must be
 * the count lib/state-practice-authority.ts derives.
 */
const FULL_COUNT = /\b(\d{1,2})\s+(?:states?|jurisdictions?)\s*(?:\+|plus|and)\s*(?:DC|D\.C\.|the District of Columbia)|\((\d{1,2})\s*\+\s*DC\)/gi;
const OTHER_STATES = /\bother (\d{1,2})(?: states)?\b/gi;
const REDUCED_AND_RESTRICTED = /\b(\d{1,2})(?: states)? (?:as )?reduced(?: practice)? and (\d{1,2})(?: as)? restricted\b/gi;
const NON_FULL = /\b(\d{1,2}) states \((\d{1,2}) reduced and (\d{1,2}) restricted\)/gi;
/** "50 states and the District of Columbia" is the whole country, not a practice authority count. */
const WHOLE_COUNTRY = new Set([50, 51]);

const FULL_STATES = getStatesByAuthority('full').filter((state) => state !== 'District of Columbia');
const REDUCED_STATES = getStatesByAuthority('reduced');
const RESTRICTED_STATES = getStatesByAuthority('restricted');
const codes = (states: readonly string[]): string[] => states.map((state) => STATE_CODES[state] ?? (state === 'District of Columbia' ? 'DC' : state)).sort();

const PREVIEW_ENTRIES = OWN_GUIDE_SLUGS.map((slug) => [slug, GUIDE_PREVIEWS[slug]] as [OwnGuideSlug, GuidePreview]);
const WITHOUT_PREVIEW: Product[] = allProducts().filter((product) => !getGuidePreview(product.slug));

/**
 * Per guide: a sentence of its excerpt as the reader sees it, the text of one
 * of its excerpt tables (by position), and the free pages it links that own
 * the head terms.
 */
const SPOT_CHECKS: Record<OwnGuideSlug, { sentences: string[]; table: [number, string]; links: string[] }> = {
    'compensation-report': {
        sentences: ['BLS is the only source that counts all 323,040 employed U.S. NPs, so it is the baseline for this report.', 'Chapter 3 lists all 50 states and the District of Columbia.'],
        table: [1, 'California $168,520 Restricted'],
        links: ['/salary-guide', '/tools/1099-vs-w2-calculator', '/jobs/new-grad', '/blog/highest-paying-np-specialties'],
    },
    'first-year-playbook': {
        sentences: ['Any two red flags together are a reason to keep looking.', 'Never accept referrals as part of the payment. Keep the agreement about supervision and consultation only.'],
        table: [0, 'New York NY A written practice agreement until you pass 3,600 hours'],
        links: ['/scope-of-practice', '/blog/new-grad-np-first-job', '/blog/fnp-certification-aanp-vs-ancc'],
    },
    'interview-prep-pack': {
        sentences: ['Say out loud when you would call the physician, transfer to the ED or consult a specialist.'],
        table: [0, '1. Recruiter screen Recruiter or talent partner 15 to 30 minutes, phone or video'],
        links: ['/blog/np-interview-questions'],
    },
    'negotiate-like-an-np': {
        sentences: ['Unpaid inbox and charting time is the biggest leak in primary care and specialty clinic jobs.', 'PTO is already inside the salary, so do not add it again.'],
        table: [0, 'Walk-away $110,000 $125,000'],
        links: ['/tools/1099-vs-w2-calculator', '/resources/1099-vs-w2', '/blog/np-salary-negotiation-guide'],
    },
    'telehealth-playbook': {
        sentences: ['The NLC does not cover APRNs.', 'If you are not licensed in Colorado, reschedule the visit.'],
        table: [0, 'Not in the NLC Alaska, California, District of Columbia, Hawaii'],
        links: ['/blog/aprn-compact-states', '/jobs/remote', '/scope-of-practice'],
    },
    'launch-your-practice': {
        sentences: ['Indiana is still a reduced-practice state.', 'All hours must be completed in California.'],
        table: [2, '104 NP 3 more years or 4,600 more hours as a 103 NP in good standing'],
        links: ['/resources/private-practice-guide', '/scope-of-practice', '/salary-guide'],
    },
};

// ─── The preview copy itself ─────────────────────────────────────────────────

describe('preview copy', () => {
    it('exists for each of this board\'s own guides, and for no bundle or psych edition', () => {
        for (const slug of OWN_GUIDE_SLUGS) expect(getGuidePreview(slug), slug).not.toBeNull();
        for (const slug of [...Object.keys(BUNDLES), ...PSYCH_GUIDE_SLUGS]) expect(getGuidePreview(slug), slug).toBeNull();
        expect(getGuidePreview('constructor')).toBeNull();
        expect(getGuidePreview('__proto__')).toBeNull();
        expect(Object.keys(GUIDE_PREVIEWS)).toEqual([...OWN_GUIDE_SLUGS]);
    });

    it.each(PREVIEW_ENTRIES)('%s: no dash used as punctuation in any field', (_slug, preview) => {
        for (const { field, text } of previewStrings(preview)) expect(withoutListMarkers(text), field).not.toMatch(DASH);
    });

    it('reads a list marker as markup and a spaced hyphen in a sentence as a dash', () => {
        expect(withoutListMarkers('Your space:\n- A room with a door\n- A neutral background')).not.toMatch(DASH);
        expect(withoutListMarkers('Pick one - then book it')).toMatch(DASH);
    });

    it('reads the hidden attribute or class as hiding, and the word "hidden" in copy or an id as copy', () => {
        expect(hides('<div hidden="">x</div>')).toBe(true);
        expect(hides('<div class="md:block hidden">x</div>')).toBe(true);
        expect(hides('<p style="display:none">x</p>')).toBe(true);
        expect(hides('<p>the hidden costs that shrink a salary</p>')).toBe(false);
        expect(hides('<h3 id="excerpt-hidden-costs-that-shrink-a-salary">Hidden costs</h3>')).toBe(false);
    });

    it.each(PREVIEW_ENTRIES)('%s: names neither the sister board nor the specialty the scanners count, in any field', (_slug, preview) => {
        for (const { field, text } of previewStrings(preview)) {
            expect(text, field).not.toMatch(NAMES);
            expect(text, field).not.toMatch(DONOR_COPY_RE);
        }
    });

    it.each(PREVIEW_ENTRIES)('%s: none of the known guide defects, and no date-bound DEA text outside a chapter title', (_slug, preview) => {
        for (const { field, text } of previewStrings(preview)) {
            for (const phrase of DEFECT_PHRASES) expect(text, field).not.toMatch(phrase);
            if (CHAPTER_TITLE.test(field)) continue;
            for (const phrase of DATE_PHRASES) expect(text, field).not.toMatch(phrase);
        }
    });

    it.each(PREVIEW_ENTRIES)('%s: no catalog price and no free offer is typed into the copy', (_slug, preview) => {
        const prices = [...allProducts().map((product) => product.priceCents), ADD_ON.priceCents];
        for (const { field, text } of previewStrings(preview)) {
            for (const cents of prices) expect(text, `${field} types ${formatPrice(cents)}`).not.toMatch(priceLiteral(cents));
            expect(text, field).not.toMatch(FREE_OFFER);
        }
    });

    // The excerpt is the guide's own text, and its scripts are written for the
    // reader to say ("I'm targeting a base of ..."); the first-person check is
    // for the page's own copy.
    it.each(PREVIEW_ENTRIES)('%s: speaks as the company, with no exclamation marks', (_slug, preview) => {
        for (const { field, text } of previewStrings(preview)) {
            expect(text, field).not.toContain('!');
            if (field === 'excerpt.body' || field.startsWith('toc')) continue;
            expect(text, field).not.toMatch(/\bI\b|\bI'm\b|\bmy\b/);
        }
    });

    it.each(PREVIEW_ENTRIES)('%s: labels every AANP figure with its earnings year', (_slug, preview) => {
        for (const { field, text } of previewStrings(preview)) {
            if (field.startsWith('toc')) continue;
            for (const sentence of text.split(/(?<=\.)\s+(?=[A-Z])|\n+/)) {
                if (!AANP_FIGURE.test(sentence)) continue;
                expect(sentence, field).toMatch(/2023 earnings/);
            }
        }
    });

    it.each(PREVIEW_ENTRIES)('%s: every practice authority count and state list it states is the one the state table derives', (_slug, preview) => {
        for (const { field, text } of previewStrings(preview)) {
            for (const m of text.matchAll(FULL_COUNT)) {
                const count = Number(m[1] ?? m[2]);
                if (WHOLE_COUNTRY.has(count)) continue;
                expect(count, `${field}: "${m[0]}"`).toBe(FULL_STATES.length);
            }
            for (const m of text.matchAll(OTHER_STATES)) expect(Number(m[1]), `${field}: "${m[0]}"`).toBe(50 - FULL_STATES.length);
            for (const m of text.matchAll(REDUCED_AND_RESTRICTED)) {
                expect([Number(m[1]), Number(m[2])], `${field}: "${m[0]}"`).toEqual([REDUCED_STATES.length, RESTRICTED_STATES.length]);
            }
            for (const m of text.matchAll(NON_FULL)) {
                expect([Number(m[1]), Number(m[2]), Number(m[3])], `${field}: "${m[0]}"`).toEqual([REDUCED_STATES.length + RESTRICTED_STATES.length, REDUCED_STATES.length, RESTRICTED_STATES.length]);
            }
        }
        // A table row that lists a tier's states lists exactly the table's states.
        for (const block of parseExcerpt(preview.excerpt.body)) {
            if (block.kind !== 'table') continue;
            for (const row of block.rows) {
                const tier = /^(?:full|reduced|restricted)/i.exec(row[0])?.[0].toLowerCase();
                const list = row.find((cell) => /^(?:[A-Z]{2}, )+[A-Z]{2}$/.test(cell));
                if (!tier || !list) continue;
                const expected = tier === 'full' ? codes([...FULL_STATES, 'District of Columbia']) : codes(tier === 'reduced' ? REDUCED_STATES : RESTRICTED_STATES);
                expect(list.split(', ').sort(), row[0]).toEqual(expected);
            }
        }
    });

    it('counts practice authority however a preview writes it', () => {
        const full = (text: string) => [...text.matchAll(FULL_COUNT)].map((m) => Number(m[1] ?? m[2]));
        expect(full('As of October 2026, 27 states and DC let an NP practice')).toEqual([27]);
        expect(full('| Full practice (27 + DC) | AK, AZ |')).toEqual([27]);
        expect(full('all 50 states and the District of Columbia')).toEqual([50]);
        expect([...'12 states reduced and 11 restricted'.matchAll(REDUCED_AND_RESTRICTED)].map((m) => [m[1], m[2]])).toEqual([['12', '11']]);
        expect([...'23 states (12 reduced and 11 restricted) require'.matchAll(NON_FULL)]).toHaveLength(1);
    });

    it('names the full practice states the table lists, and only those', () => {
        const answer = GUIDE_PREVIEWS['launch-your-practice'].faq.find((item) => /What states let/.test(item.question))!.answer;
        for (const state of FULL_STATES) expect(answer, state).toContain(state);
        for (const state of [...REDUCED_STATES, ...RESTRICTED_STATES]) expect(answer, state).not.toMatch(new RegExp(`\\b${state}\\b`));
    });

    it('reads an exam fee for AANP members as a fee, and an AANP pay figure as a figure', () => {
        expect(AANP_FIGURE.test('costs $315, or $240 for AANP members.')).toBe(false);
        expect(AANP_FIGURE.test('$340 AANP member; $290 AANP student member')).toBe(false);
        expect(AANP_FIGURE.test("AANPCB's FNP-C costs $315")).toBe(false);
        expect(AANP_FIGURE.test("AANP's 2024 report puts the full-time median base salary at $120,000")).toBe(true);
    });

    it.each(PREVIEW_ENTRIES)('%s: an intro of 2 to 4 sentences and 45 to 80 words', (_slug, preview) => {
        const words = preview.intro.split(/\s+/).filter(Boolean).length;
        const sentences = preview.intro.split(/(?<=[.?])\s+(?=[A-Z])/).length;
        expect(words).toBeGreaterThanOrEqual(45);
        expect(words).toBeLessThanOrEqual(80);
        expect(sentences).toBeGreaterThanOrEqual(2);
        expect(sentences).toBeLessThanOrEqual(4);
    });

    it.each(PREVIEW_ENTRIES)('%s: 3 to 5 key figures, each with a source; 5 to 7 questions', (_slug, preview) => {
        expect(preview.keyFigures.length).toBeGreaterThanOrEqual(3);
        expect(preview.keyFigures.length).toBeLessThanOrEqual(5);
        for (const item of preview.keyFigures) expect(item.source.trim(), item.title).not.toBe('');
        expect(preview.faq.length).toBeGreaterThanOrEqual(5);
        expect(preview.faq.length).toBeLessThanOrEqual(7);
    });

    it.each(PREVIEW_ENTRIES)('%s: every linked phrase occurs in its sentence once and points at a site path', (_slug, preview) => {
        for (const item of [...preview.keyFigures, ...preview.faq]) {
            if (!item.link) continue;
            const text = 'answer' in item ? item.answer : item.text;
            expect(text).toContain(item.link.phrase);
            expect(text.split(item.link.phrase), item.link.phrase).toHaveLength(2);
            expect(item.link.href).toMatch(/^\/[a-z0-9/-]+$/);
            expect(item.link.href).not.toMatch(/^\/guides\b/);
        }
    });

    it.each(PREVIEW_ENTRIES)('%s: a full excerpt, every table row as wide as its header', (_slug, preview) => {
        const blocks = parseExcerpt(preview.excerpt.body);
        const words = excerptText(blocks).join(' ').match(/[A-Za-z0-9$%][A-Za-z0-9$%.,'/:+-]*/g) ?? [];
        expect(words.length).toBeGreaterThanOrEqual(700);
        for (const block of blocks) {
            if (block.kind !== 'table') continue;
            for (const row of block.rows) expect(row, block.header.join(' | ')).toHaveLength(block.header.length);
        }
        expect(preview.excerpt.bridge).toContain(`of ${previewChapterCount(preview)}.`);
        expect(preview.excerpt.pages.length).toBeGreaterThan(0);
        expect([...preview.excerpt.pages].sort((a, b) => a - b)).toEqual(preview.excerpt.pages);
    });

    it.each(PREVIEW_ENTRIES)('%s: contents with one entry per title, unique sections, chapters in order and at least one shown in full', (_slug, preview) => {
        const titles = preview.toc.map((entry) => entry.title);
        expect(new Set(titles).size).toBe(titles.length);
        for (const entry of preview.toc) expect(new Set(entry.sections).size, entry.title).toBe(entry.sections.length);
        expect(preview.toc.some((entry) => entry.inExcerpt)).toBe(true);
        const chapters = preview.toc.flatMap((entry) => (entry.chapter === undefined ? [] : [entry.chapter]));
        expect(chapters).toEqual(chapters.map((_n, index) => index + 1));
        const pages = preview.toc.map((entry) => entry.page);
        expect([...pages].sort((a, b) => a - b)).toEqual(pages);
    });

    it.each(PREVIEW_ENTRIES)('%s: dates that parse, and a page date no older than the edition', (_slug, preview) => {
        const updated = Date.parse(`${preview.edition.updated}T00:00:00Z`);
        const content = Date.parse(`${preview.contentDate}T00:00:00Z`);
        expect(Number.isNaN(updated)).toBe(false);
        expect(content).toBeGreaterThanOrEqual(updated);
    });
});

// ─── Metadata ────────────────────────────────────────────────────────────────

describe('metadata for a preview page', () => {
    it.each(PREVIEW_ENTRIES)('%s: an absolute title of 60 characters or fewer with the brand at most once, and a 120 to 155 character description', async (slug, preview) => {
        for (const phase of PHASES) {
            setPhase(phase);
            const meta = await metadataFor(slug);
            expect(meta.title).toEqual({ absolute: previewSearchTitle(preview) });
            const title = (meta.title as { absolute: string }).absolute;
            expect(title.length, title).toBeLessThanOrEqual(SERP_TITLE_MAX);
            expect(title.split(brand.name).length - 1, title).toBeLessThanOrEqual(1);
            expect(title.startsWith(preview.seo.title)).toBe(true);
            expect(title).not.toMatch(DASH);

            const description = String(meta.description);
            expect(description).toBe(preview.seo.description);
            expect(description.length, description).toBeGreaterThanOrEqual(120);
            expect(description.length, description).toBeLessThanOrEqual(DESCRIPTION_MAX);
            expect(description).not.toMatch(DASH);
            expect(description).not.toMatch(/\$\d/);
            expect(description).not.toMatch(FREE_OFFER);
        }
    });

    it.each([
        ['compensation-report', 'Nurse Practitioner Compensation 2026 Report | NP Hiring'],
        ['first-year-playbook', 'Collaborative Agreement for Nurse Practitioners | NP Hiring'],
        ['interview-prep-pack', 'Nurse Practitioner Interview Questions and Answers PDF'],
        ['negotiate-like-an-np', 'Nurse Practitioner Contract Negotiation Guide | NP Hiring'],
        ['telehealth-playbook', 'How to Get an NP License in Multiple States | NP Hiring'],
        ['launch-your-practice', 'How to Open Your Own Clinic as a Nurse Practitioner'],
    ])('%s leads with its search, and keeps the brand when it fits', async (slug, expected) => {
        const meta = await metadataFor(slug);
        expect((meta.title as { absolute: string }).absolute).toBe(expected);
    });

    it.each(PREVIEW_ENTRIES)('%s: share card without the brand, canonical to itself, indexable', async (slug, preview) => {
        const meta = await metadataFor(slug);
        const og = meta.openGraph as { title?: string; description?: string; url?: string; images?: Array<{ url: string }> };
        expect(og.title).toBe(preview.seo.title);
        expect(og.description).toBe(preview.seo.description);
        expect(og.url).toBe(`${brand.baseUrl}/guides/${slug}`);
        expect(og.images?.[0]?.url).toBe(guideOgImageUrl(productOgCard(GUIDES[slug])));
        expect(meta.alternates?.canonical).toBe(`${brand.baseUrl}/guides/${slug}`);
        expect(meta.robots).toBeUndefined();
    });
});

// ─── The page a reader and a crawler get ─────────────────────────────────────

describe.each(PREVIEW_ENTRIES)('the %s preview page', (SLUG, preview) => {
    const guide = GUIDES[SLUG];
    const spot = SPOT_CHECKS[SLUG];

    it('puts the whole excerpt in the server HTML, in an excerpt section nothing hides', async () => {
        const html = await render(SLUG);
        const section = elementById(html, 'guide-excerpt');
        expect(hides(section)).toBe(false);
        const text = visibleText(section);
        for (const piece of excerptText(parseExcerpt(preview.excerpt.body))) {
            expect(text, piece.slice(0, 60)).toContain(squash(piece));
        }
        expect(text).not.toContain('**');
        expect(text).not.toContain('```');
        for (const sentence of spot.sentences) expect(text).toContain(sentence);
    });

    it('renders the excerpt tables as real tables with a header row', async () => {
        const section = elementById(await render(SLUG), 'guide-excerpt');
        const tables = parseExcerpt(preview.excerpt.body).filter((block) => block.kind === 'table');
        const rendered = [...section.matchAll(/<table\b[\s\S]*?<\/table>/g)].map((m) => m[0]);
        expect(rendered).toHaveLength(tables.length);
        for (const table of rendered) {
            expect(table).toMatch(/<thead><tr><th scope="col">/);
            expect(table).toMatch(/<tbody><tr><td>/);
        }
        const [index, row] = spot.table;
        expect(textOf(rendered[index])).toContain(row);
    });

    it("closes the excerpt with the guide's own disclaimer and a link to the buy block", async () => {
        const html = await render(SLUG);
        const text = visibleText(elementById(html, 'guide-excerpt'));
        expect(preview.disclaimer).toBe(`This ${preview.noun === 'pack' ? 'guide' : preview.noun} is for education only. It is not legal, tax, financial, billing or clinical advice.`);
        expect(text).toContain(preview.disclaimer);
        expect(text).toContain(preview.excerpt.bridge);
        expect(elementById(html, 'guide-excerpt')).toContain('href="#buy-guide"');
        expect(html).toContain('id="buy-guide"');
    });

    it.each(PHASES)('%s: opens with the H1 and the answer to the search, then the price block and the action of the phase, twice', async (phase) => {
        const html = await render(SLUG, phase);
        const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>\s*<p\b[^>]*>([\s\S]*?)<\/p>/.exec(html);
        expect(h1, 'a paragraph straight after the H1').not.toBeNull();
        expect(textOf(h1![1])).toBe(preview.h1);
        expect(textOf(h1![2])).toBe(preview.intro);

        const copy = guidePriceCopy(guide, phase);
        const excerptAt = html.indexOf('id="guide-excerpt"');
        const firstAction = html.indexOf(copy.cta);
        expect(firstAction).toBeGreaterThan(-1);
        expect(firstAction).toBeLessThan(excerptAt);
        expect(html.split(`>${copy.cta}<`), copy.cta).toHaveLength(3);
        expect(html.indexOf(`>${copy.cta}<`, html.indexOf('id="buy-guide"'))).toBeGreaterThan(-1);
        expect(visibleText(html)).toContain(`${preview.edition.name} edition, updated October 24, 2026`);
    });

    it('free: claims, with no Buy button, no add-on and no checkout copy', async () => {
        const html = await render(SLUG, 'free');
        const text = visibleText(html);
        expect(html.match(/type="email"/g)).toHaveLength(2);
        expect(text).toContain(guidePriceCopy(guide, 'free').note);
        expect(text).not.toContain('Buy for');
        expect(text).not.toContain('Add the');
        expect(text).not.toContain('All sales are final');
        expect(text).not.toContain('Pay once, keep it');
    });

    it('paid: sells at the catalog price, says all sales are final, and offers nothing free', async () => {
        const html = await render(SLUG, 'paid');
        const text = visibleText(html);
        expect(html).not.toContain('type="email"');
        expect(text).toContain(`Buy for ${formatPrice(guide.priceCents)}`);
        expect(text).toContain('All sales are final');
        expect(text).toContain('Pay once, keep it');
        expect(text).not.toMatch(FREE_OFFER);
        if (SLUG !== ADD_ON.guide) expect(text).toContain(`Add the ${GUIDES[ADD_ON.guide].title} for ${formatPrice(ADD_ON.priceCents)}`);
        else expect(text).not.toContain('Add the');
    });

    it('lays the sections out in order', async () => {
        const html = await render(SLUG);
        const order = [
            'id="product-heading"',
            'id="guide-excerpt"',
            'id="guide-contents-heading"',
            'id="guide-figures-heading"',
            'id="guide-audience-heading"',
            'id="guide-faq-heading"',
            'id="buy-guide"',
            'id="bundles-heading"',
            'id="guide-others-heading"',
            `mailto:${brand.email.support}`,
        ];
        const at = order.map((marker) => html.indexOf(marker));
        for (const [index, position] of at.entries()) expect(position, order[index]).toBeGreaterThan(-1);
        expect([...at].sort((a, b) => a - b)).toEqual(at);
    });

    it('gives no two neighbouring bands the same ground', async () => {
        const html = await render(SLUG);
        const grounds = [...html.matchAll(/<section class="stk-stage stk-stage-([a-z]+)/g)].map((m) => m[1]);
        expect(grounds.length).toBeGreaterThan(8);
        grounds.forEach((ground, index) => {
            if (index > 0) expect(ground, `band ${index}`).not.toBe(grounds[index - 1]);
        });
    });

    it('lists every chapter with its sections and marks the ones shown in full', async () => {
        const html = await render(SLUG);
        const toc = /<ol class="guide-toc">[\s\S]*?<\/ol>/.exec(html)?.[0] ?? '';
        const text = textOf(toc);
        for (const entry of preview.toc) {
            expect(text).toContain(entry.chapter === undefined ? entry.title : `Chapter ${entry.chapter}: ${entry.title}`);
            for (const section of entry.sections) expect(text).toContain(section);
        }
        expect(toc.match(/href="#guide-excerpt"/g)).toHaveLength(preview.toc.filter((entry) => entry.inExcerpt).length);
        expect(visibleText(html)).toContain(`Inside the full ${preview.noun}: ${previewChapterCount(preview)} chapters, ${guide.pages} pages`);
    });

    it('prints a source under every key figure', async () => {
        const text = visibleText(await render(SLUG));
        for (const item of preview.keyFigures) {
            expect(text).toContain(item.title);
            expect(text).toContain(`Source: ${item.source}`);
            if (item.figure) expect(text).toContain(item.figure);
        }
    });

    it('says what the guide is in the words its Product markup uses', async () => {
        const html = await render(SLUG);
        const audience = visibleText(bandOf(html, 'guide-audience-heading'));
        expect(audience).toContain(guide.audience);
        expect(audience).toContain(`In short ${previewSummary(guide, preview)}`);
    });

    it('shows the FAQ open: a third-level heading per question and its answer', async () => {
        const html = await render(SLUG);
        const faq = /<div class="guide-faq">[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';
        const items = [...faq.matchAll(/<h3>([\s\S]*?)<\/h3>\s*<p>([\s\S]*?)<\/p>/g)].map((m) => ({ question: textOf(m[1]), answer: textOf(m[2]) }));
        expect(items).toEqual(preview.faq.map(({ question, answer }) => ({ question, answer })));
        expect(faq).not.toMatch(/<details|<summary/);
    });

    it('links out to the free pages that own the head terms', async () => {
        const html = await render(SLUG);
        for (const href of spot.links) expect(html, href).toContain(`href="${href}"`);
    });

    it('never skips a heading level and has one H1', async () => {
        const levels = headings(await render(SLUG)).map((h) => h.level);
        expect(levels.filter((level) => level === 1)).toHaveLength(1);
        levels.forEach((level, index) => {
            if (index > 0) expect(level, `heading ${index}`).toBeLessThanOrEqual(levels[index - 1] + 1);
        });
    });

    it.each(PHASES)('%s: no dash punctuation, defect, date-bound text or other edition anywhere a reader can see it, the contents aside', async (phase) => {
        const html = await render(SLUG, phase);
        const text = visibleText(html.replace(/<ol class="guide-toc">[\s\S]*?<\/ol>/, ' '));
        expect(text).not.toMatch(/[–—]/);
        expect(/(?:^|\s)-(?:\s|$)/.test(text)).toBe(false);
        for (const phrase of [...DEFECT_PHRASES, ...DATE_PHRASES]) expect(text).not.toMatch(phrase);
        expect(text).not.toMatch(NAMES);
        expect(html).not.toContain('data-sister-board');
    });

    it.each(PHASES)('%s: shows this board\'s other five guides with the price of the phase', async (phase) => {
        const html = await render(SLUG, phase);
        const others = bandOf(html, 'guide-others-heading');
        const links = [...others.matchAll(/href="\/guides\/([a-z0-9-]+)"/g)].map((m) => m[1]);
        expect(links).toEqual(OWN_GUIDE_SLUGS.filter((slug) => slug !== SLUG));
        for (const slug of links) {
            const other = GUIDES[slug as OwnGuideSlug];
            const copy = guidePriceCopy(other, phase);
            expect(textOf(others)).toContain(`${other.title} ${other.subtitle} ${copy.price}`);
        }
    });
});

describe('guide-specific copy', () => {
    it('the interview pack sets its pay script and its note template apart, line for line', async () => {
        const section = elementById(await render('interview-prep-pack'), 'guide-excerpt');
        const boxes = [...section.matchAll(/<pre class="guide-excerpt-template">([\s\S]*?)<\/pre>/g)].map((m) => decode(m[1]));
        expect(boxes).toHaveLength(2);
        expect(boxes[0]).toMatch(/^"Based on the role and my research/);
        expect(boxes[1].split('\n')[0]).toBe('TELEHEALTH VISIT NOTE (real-time audio-video)');
        expect(boxes[1].split('\n').at(-1)).toBe('Time / MDM: [total time or MDM level]');
    });

    it('numbered steps are real ordered lists, their bold leads kept', async () => {
        const section = elementById(await render('interview-prep-pack'), 'guide-excerpt');
        expect(section).toContain('<ol><li><strong>Stability first.</strong> Check airway, breathing, circulation');
        expect(section.match(/<ol>/g)).toHaveLength(2);
    });

    it('the telehealth page swaps the catalog summary, which names a dated prescribing rule, for its own', async () => {
        const preview = getGuidePreview('telehealth-playbook') as GuidePreview;
        const catalogSummary = GUIDES['telehealth-playbook'].summary;
        expect(catalogSummary).toMatch(/January 1, 2027/);
        expect(preview.summary).toBeDefined();
        const html = await render('telehealth-playbook');
        expect(visibleText(html)).not.toContain(catalogSummary);
        const product = jsonLdBlocks(html).find((block) => block['@type'] === 'Product')!;
        expect(product.description).toBe(preview.summary);
        expect(JSON.stringify(jsonLdBlocks(html))).not.toMatch(/January 1, 2027|December 31, 2026/);
    });

    it('every other guide keeps the catalog summary on its page and in its markup', async () => {
        for (const [slug, preview] of PREVIEW_ENTRIES) {
            if (slug === 'telehealth-playbook') continue;
            expect(preview.summary, slug).toBeUndefined();
            const product = jsonLdBlocks(await render(slug)).find((block) => block['@type'] === 'Product')!;
            expect(product.description, slug).toBe(GUIDES[slug].summary);
        }
    });
});

// ─── Structured data ─────────────────────────────────────────────────────────

describe.each(PREVIEW_ENTRIES)('the %s preview page JSON-LD', (SLUG, preview) => {
    const guide = GUIDES[SLUG];
    const url = `${brand.baseUrl}/guides/${SLUG}`;

    type Node = Record<string, unknown>;
    const byType = (blocks: Node[], type: string): Node => {
        const found = blocks.filter((block) => block['@type'] === type);
        expect(found, type).toHaveLength(1);
        return found[0];
    };

    it('is three parseable blocks: the breadcrumb trail, a Product and an FAQPage', async () => {
        const blocks = jsonLdBlocks(await render(SLUG));
        expect(blocks.map((block) => block['@type']).sort()).toEqual(['BreadcrumbList', 'FAQPage', 'Product']);
        for (const block of blocks) expect(block['@context']).toBe('https://schema.org');
    });

    it.each(PHASES)('%s: prices the Offer as the page does, from the catalog', async (phase) => {
        const html = await render(SLUG, phase);
        const product = byType(jsonLdBlocks(html), 'Product');
        const offer = product.offers as Node;
        expect(product['@id']).toBe(`${url}#product`);
        expect(product.url).toBe(url);
        expect(product.name).toBe(guide.title);
        expect(product.sku).toBe(SLUG);
        expect(product.description).toBe(previewSummary(guide, preview));
        expect(offer.price).toBe(phase === 'free' ? '0.00' : (guide.priceCents / 100).toFixed(2));
        expect(offer.priceCurrency).toBe('USD');
        expect(offer.availability).toBe('https://schema.org/InStock');
        expect(offer.url).toBe(url);
        if (phase === 'paid') {
            expect(offer.hasMerchantReturnPolicy).toEqual({
                '@type': 'MerchantReturnPolicy',
                applicableCountry: 'US',
                returnPolicyCategory: 'https://schema.org/MerchantReturnNotPermitted',
            });
            expect(visibleText(html)).toContain(formatPrice(guide.priceCents));
        } else {
            expect(offer.hasMerchantReturnPolicy).toBeUndefined();
        }
    });

    it('holds exactly the questions and answers the page shows', async () => {
        const faq = byType(jsonLdBlocks(await render(SLUG)), 'FAQPage');
        expect(faq['@id']).toBe(`${url}#faq`);
        const items = (faq.mainEntity as Node[]).map((q) => ({ question: q.name, answer: (q.acceptedAnswer as Node).text, type: q['@type'] }));
        expect(items).toEqual(preview.faq.map(({ question, answer }) => ({ question, answer, type: 'Question' })));
    });

    it('marks up the breadcrumb trail the page shows', async () => {
        const html = await render(SLUG);
        const crumbs = ((byType(jsonLdBlocks(html), 'BreadcrumbList')).itemListElement as Node[]).map((item) => [item.position, item.name]);
        expect(crumbs).toEqual([
            [1, 'Home'],
            [2, 'Career Guides'],
            [3, guide.title],
        ]);
        const nav = /<nav aria-label="Breadcrumb"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
        expect(textOf(nav)).toBe(`Home Career Guides ${guide.title}`);
    });

    it('makes no rating, review, Book or Article claim, and goes through the escaping serializer', async () => {
        const html = await render(SLUG);
        for (const [, raw] of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
            expect(raw).not.toMatch(/aggregateRating|"review"|"Book"|"Article"|"HowTo"/);
            expect(raw).not.toContain('<');
        }
    });
});

// ─── Pages without a preview ─────────────────────────────────────────────────

describe('a product without preview copy keeps the plain product page', () => {
    it('covers the bundles and the psych editions, the only products without a preview', () => {
        expect(WITHOUT_PREVIEW.length).toBe(allProducts().length - PREVIEW_ENTRIES.length);
        expect(WITHOUT_PREVIEW.map((product) => product.slug).sort()).toEqual([...Object.keys(BUNDLES), ...PSYCH_GUIDE_SLUGS].sort());
    });

    it.each(WITHOUT_PREVIEW.map((product) => [product.slug, product] as const))('%s: the plain page, its chapter list and no preview markup', async (slug, product) => {
        const html = await render(slug);
        expect(textOf(/<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? '')).toBe(product.title);
        expect(html).not.toMatch(/id="guide-excerpt"|guide-toc|guide-faq|FAQPage/);
        const text = visibleText(html);
        expect(text).toContain(product.subtitle);
        if (product.kind === 'guide') for (const chapter of product.contents) expect(text).toContain(chapter);
        const meta = await metadataFor(slug);
        expect(typeof meta.title).toBe('string');
        expect(String(meta.description)).toContain(product.summary);
    });
});
