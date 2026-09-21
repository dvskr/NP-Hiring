/**
 * Sticker kit pins (PLAN.md B.2, W0-STK).
 *
 * The kit is the shared foundation every restyled pSEO page renders through,
 * so its contract is pinned at the source:
 *
 *   - STICKER_CSS is a static string (no `${`): styled-jsx interpolation
 *     deadlocks the Turbopack route compile (inventory.md 6.7).
 *   - Every hover lift has a reduced-motion gate (globals.css's gate is an
 *     allowlist and never reaches these classes).
 *   - Focus is always visible on every interactive sticker.
 *   - The shared rules match app/resources/page.tsx byte for byte (after
 *     whitespace), so the two surfaces cannot drift.
 *   - The accordion is native <details> with every answer in server HTML
 *     under the `faq-answer` Speakable hook, and the card is a link only
 *     when it has an href.
 *   - House style: no em or en dash anywhere in the kit.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { STICKER_BAR_WIDTHS, STICKER_CSS, STICKER_FILLS, stickerBarWidth, stickerFill } from '@/lib/design/sticker-css';
import StickerAccordion from '@/components/sticker/StickerAccordion';
import StickerCard from '@/components/sticker/StickerCard';
import StickerTile from '@/components/sticker/StickerTile';

const ROOT = path.resolve(__dirname, '../..');
const KIT_DIR = path.join(ROOT, 'components', 'sticker');
const CSS_MODULE = path.join(ROOT, 'lib', 'design', 'sticker-css.ts');
const RESOURCES_PAGE = path.join(ROOT, 'app', 'resources', 'page.tsx');

const REDUCED_MOTION = '@media (prefers-reduced-motion: reduce)';

function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else out.push(full);
    }
    return out;
}

const kitFiles = (): string[] => walk(KIT_DIR).filter((f) => /\.(ts|tsx)$/.test(f));
const read = (file: string): string => fs.readFileSync(file, 'utf-8');

interface Rule { selector: string; decls: string }

/**
 * Every leaf rule (`selector { declarations }`) in the string, wherever it
 * nests. `[^{}]` never crosses a brace, so an at-rule header is skipped and
 * only its inner rules are returned.
 */
function leafRules(css: string): Rule[] {
    const rules: Rule[] = [];
    const uncommented = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of uncommented.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        rules.push({ selector: m[1].trim(), decls: m[2].replace(/\s+/g, ' ').trim() });
    }
    return rules;
}

/** Body of the block that opens at the first `{` after `openIndex`, walking nested braces. */
function blockAfter(css: string, from: number): { body: string; end: number } {
    const open = css.indexOf('{', from);
    let depth = 0;
    for (let i = open; i < css.length; i++) {
        if (css[i] === '{') depth++;
        if (css[i] === '}') depth--;
        if (depth === 0) return { body: css.slice(open + 1, i), end: i + 1 };
    }
    throw new Error('unbalanced braces');
}

/** Split the string into the reduced-motion bodies and everything else. */
function splitReducedMotion(css: string): { reduced: string; rest: string } {
    let rest = '';
    let reduced = '';
    let cursor = 0;
    for (;;) {
        const at = css.indexOf(REDUCED_MOTION, cursor);
        if (at < 0) break;
        const { body, end } = blockAfter(css, at);
        rest += css.slice(cursor, at);
        reduced += body;
        cursor = end;
    }
    rest += css.slice(cursor);
    return { reduced, rest };
}

const splitSelectors = (selector: string): string[] => selector.split(',').map((s) => s.trim()).filter(Boolean);

describe('sticker kit: CSS delivery rule', () => {
    it('STICKER_CSS carries no template interpolation', () => {
        expect(STICKER_CSS.includes('${')).toBe(false);
    });

    it('the CSS module and every kit file stay free of styled-jsx', () => {
        for (const file of [CSS_MODULE, ...kitFiles()]) {
            expect(read(file), path.relative(ROOT, file)).not.toMatch(/<style jsx/);
        }
    });

    it('every kit component is a server component with no client hooks', () => {
        for (const file of kitFiles()) {
            const src = read(file);
            const rel = path.relative(ROOT, file);
            expect(src, rel).not.toMatch(/['"]use client['"]/);
            expect(src, rel).not.toMatch(/\buse(State|Effect|Ref)\s*\(/);
            expect(src, rel).not.toMatch(/\bonClick\b/);
        }
    });

    it('exports the homepage chip fills and bar widths', () => {
        expect([...STICKER_FILLS]).toEqual(['#D5F5F1', '#FBCFE8', '#FDE3C8', '#B9EBD6']);
        expect([...STICKER_BAR_WIDTHS]).toEqual(['38%', '64%', '22%', '50%']);
        expect(stickerFill(5)).toBe('#FBCFE8');
        expect(stickerBarWidth(7)).toBe('50%');
        expect(stickerFill(-1)).toBe('#B9EBD6');
    });
});

describe('sticker kit: motion and focus', () => {
    it('every hover transform has a transform: none in the reduced-motion block', () => {
        const { reduced, rest } = splitReducedMotion(STICKER_CSS);
        const gated = new Set(
            leafRules(reduced)
                .filter((r) => /transform\s*:\s*none/.test(r.decls))
                .flatMap((r) => splitSelectors(r.selector)),
        );
        const hoverLifts = leafRules(rest)
            .filter((r) => r.selector.includes(':hover') && /(^|[^-\w])transform\s*:\s*(?!none)/.test(r.decls))
            .flatMap((r) => splitSelectors(r.selector));
        expect(hoverLifts.length).toBeGreaterThan(0);
        for (const selector of hoverLifts) {
            expect(gated.has(selector), `${selector} lifts on hover but is not gated`).toBe(true);
        }
    });

    it('draws a focus-visible outline on every interactive sticker', () => {
        for (const selector of ['a.stk-card', '.stk-more', '.stk-btn', '.stk-tile', '.stk-pill', '.stk-state', 'summary']) {
            const escaped = selector.replace(/[.]/g, '\\.');
            expect(STICKER_CSS, selector).toMatch(new RegExp(`${escaped}:focus-visible\\s*\\{[^}]*outline:\\s*3px solid`));
        }
    });
});

describe('sticker kit: parity with /resources', () => {
    const resourcesCss = (): string => {
        const match = read(RESOURCES_PAGE).match(/<style>\{`([\s\S]*?)`\}<\/style>/);
        if (!match) throw new Error('app/resources/page.tsx has no plain <style> block');
        return match[1];
    };

    /** First declaration block for each selector (top-level rules come first in both files). */
    const firstRules = (css: string): Map<string, string> => {
        const map = new Map<string, string>();
        for (const r of leafRules(css)) {
            if (!map.has(r.selector)) map.set(r.selector, r.decls);
        }
        return map;
    };

    const SHARED_SELECTORS = [
        '.stk-grid', '.stk-card', 'a.stk-card', 'a.stk-card:hover', 'a.stk-card:focus-visible',
        '.stk-top', '.stk-chip', '.stk-icon', '.stk-icon-lg', '.stk-title', '.stk-desc',
        '.stk-bar', '.stk-track', '.stk-fill', '.stk-action', '.stk-wide', '.stk-body',
        '.stk-grid-2 > .stk-card:last-child:nth-child(odd)', '.stk-body .stk-chip',
        '.stk-more', '.stk-more:hover', '.stk-more:focus-visible',
        '.stk-stage', '.stk-stage-grid', '.stk-stage-mint', '.stk-stage-peach', '.stk-stage-blush', '.stk-stage-cream',
        '.stk-head', '.stk-eyebrow', '.stk-h1', '.stk-h2', '.stk-lede',
        '.stk-stat', '.stk-stat-value', '.stk-stat-label',
        '.stk-frame', '.stk-frame > *',
        '.stk-state', '.stk-state-img', '.stk-state-name', '.stk-state:hover', '.stk-state:focus-visible',
        '.stk-cat-head', '.stk-cat-title', '.stk-cat-count',
        '.stk-link', '.stk-link:hover', '.stk-link:focus-visible',
        '.stk-cta', '.stk-icon-on-berry', '.stk-cta-title', '.stk-cta-lede',
        '.stk-btn', '.stk-btn:hover', '.stk-btn:focus-visible', '.stk-btn-ghost',
    ];

    it('shared rules match the /resources stylesheet declaration for declaration', () => {
        const reference = firstRules(resourcesCss());
        const kit = firstRules(STICKER_CSS);
        for (const selector of SHARED_SELECTORS) {
            expect(reference.has(selector), `${selector} missing from /resources`).toBe(true);
            expect(kit.get(selector), selector).toBe(reference.get(selector));
        }
    });

    it('collapses the stage and CTA padding at the /resources breakpoint', () => {
        const mobile = STICKER_CSS.slice(STICKER_CSS.indexOf('@media (max-width: 768px)'));
        expect(mobile).toMatch(/\.stk-stage \{ padding: 60px 16px; \}/);
        expect(mobile).toMatch(/\.stk-cta \{ padding: 36px 20px; \}/);
    });
});

describe('sticker kit: new primitives', () => {
    it('declares every B.2 addition', () => {
        for (const selector of [
            '.stk-tile', '.stk-pill', '.stk-acc', '.stk-list', '.stk-table', '.stk-bento', '.stk-img',
            '.stk-jobs .jc-card, .stk-jobs .jc-list-card', '.pseo-crumb-band',
        ]) {
            expect(STICKER_CSS, selector).toContain(`${selector} {`);
        }
    });

    it('overrides only the JobCard surface, with square corners and a hard shadow', () => {
        const rule = leafRules(STICKER_CSS).find((r) => r.selector === '.stk-jobs .jc-card, .stk-jobs .jc-list-card');
        expect(rule?.decls).toContain('border-radius: 0 !important');
        expect(rule?.decls).toContain('border: 2px solid #7A1C2B !important');
        expect(rule?.decls).toContain('box-shadow: 4px 4px 0 #7A1C2B !important');
        expect(rule?.decls).toContain('background-color: #fff !important');
        const jobRules = leafRules(STICKER_CSS).filter((r) => r.selector.includes('.stk-jobs'));
        expect(jobRules).toHaveLength(1);
    });

    it('collapses the bento grid at 1024 and 768', () => {
        expect(STICKER_CSS).toMatch(/\.stk-bento \{ display: grid; grid-template-columns: repeat\(12, minmax\(0, 1fr\)\)/);
        const tablet = blockAfter(STICKER_CSS, STICKER_CSS.indexOf('@media (min-width: 769px) and (max-width: 1024px)')).body;
        const phone = blockAfter(STICKER_CSS, STICKER_CSS.indexOf('@media (max-width: 768px)')).body;
        expect(tablet).toMatch(/\.stk-bento \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
        expect(phone).toMatch(/\.stk-bento \{ grid-template-columns: 1fr; \}/);
    });

    it('hides the current-page crumb inside the crumb band and rules its bottom edge', () => {
        const band = leafRules(STICKER_CSS).find((r) => r.selector === '.pseo-crumb-band');
        expect(band?.decls).toContain('border-bottom: 2px solid #7A1C2B');
        expect(STICKER_CSS).toMatch(/\.pseo-crumb-band nav ol li:last-child \{ position: absolute; width: 1px; height: 1px;/);
    });
});

describe('sticker kit: server markup', () => {
    const faqs = [
        { question: 'First question?', answer: 'First answer in the HTML.' },
        { question: 'Second question?', answer: 'Second answer, also in the HTML.' },
    ];

    it('StickerAccordion renders native details with every answer under faq-answer', () => {
        const html = renderToStaticMarkup(React.createElement(StickerAccordion, { items: faqs }));
        expect(html.match(/<details /g)).toHaveLength(2);
        expect(html.match(/<summary>/g)).toHaveLength(2);
        expect(html).toContain('<details class="stk-acc" open="">');
        expect(html.match(/ open=""/g)).toHaveLength(1);
        expect(html).toContain('<p class="faq-answer">First answer in the HTML.</p>');
        expect(html).toContain('<p class="faq-answer">Second answer, also in the HTML.</p>');
        expect(html).not.toContain('<button');
    });

    it('StickerAccordion keeps the pinned faq-answer literal beside the answer', () => {
        const src = read(path.join(KIT_DIR, 'StickerAccordion.tsx'));
        expect(src).toMatch(/<p className="faq-answer">[\s\S]{0,200}\{faq\.answer\}/);
    });

    it('StickerAccordion renders nothing for an empty list', () => {
        expect(renderToStaticMarkup(React.createElement(StickerAccordion, { items: [] }))).toBe('');
    });

    it('StickerCard is a link with an href and a static div without', () => {
        const linked = renderToStaticMarkup(
            React.createElement(StickerCard, { href: '/jobs', chip: 'Chip', title: 'Linked', desc: 'Copy', action: 'Open' }),
        );
        expect(linked).toMatch(/^<a [^>]*href="\/jobs"/);
        expect(linked).toMatch(/^<a [^>]*class="stk-card"/);
        expect(linked).toContain('<h3 class="stk-title font-heading">Linked</h3>');
        expect(linked).toContain('<span class="stk-action">Open →</span>');

        const still = renderToStaticMarkup(React.createElement(StickerCard, { title: 'Static' }));
        expect(still).toMatch(/^<div class="stk-card stk-static">/);
        expect(still).not.toContain('stk-bar');
    });

    it('StickerTile omits a zero count and formats a positive one', () => {
        const zero = renderToStaticMarkup(React.createElement(StickerTile, { href: '/a', label: 'Austin', count: 0 }));
        expect(zero).not.toContain('stk-cat-count');
        const many = renderToStaticMarkup(React.createElement(StickerTile, { href: '/a', label: 'Austin', count: 1204 }));
        expect(many).toContain('<span class="stk-cat-count">1,204</span>');
    });
});

describe('sticker kit: house style', () => {
    // Built from code points so this file never carries the characters it bans.
    const EM_OR_EN_DASH = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);
    const SPACED_HYPHEN = /\S\x20-\x20\S/;

    it('contains no em dash, en dash or spaced hyphen', () => {
        for (const file of [CSS_MODULE, ...kitFiles()]) {
            const src = read(file);
            const rel = path.relative(ROOT, file);
            expect(src, `${rel} has an em or en dash`).not.toMatch(EM_OR_EN_DASH);
            expect(src, `${rel} has a spaced hyphen`).not.toMatch(SPACED_HYPHEN);
            expect(src, `${rel} logs to the console`).not.toMatch(/console\.log/);
        }
    });
});
