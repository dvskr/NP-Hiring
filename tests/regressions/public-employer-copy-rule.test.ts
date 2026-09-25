/**
 * Public employer surfaces copy rule (house style, owner direction 2026-09-12).
 *
 * The 2026-09-12 no-dash sweep skipped the public pages the pricing work
 * owned at the time: /pricing, /for-employers and its resources hub, /faq,
 * /testimonials, /success, the "How employers hire" band and the calculator
 * components under components/tools. A 2026-09-25 audit found every dash in
 * those files sits in a code comment, so this test locks the result in: the
 * VISIBLE text of those files carries
 *
 *   - no em dash (U+2014), no en dash (U+2013), no spaced hyphen;
 *   - no hyphen range ("1-2 years", "$120k-$140k", "A-Z"): ranges read "to".
 *
 * It also pins the claim-rule fixes made to these surfaces in the same pass
 * (an unmeasured "#1" ranking, a "5 minutes" posting time, a "two full
 * months" restatement of config.durationDays, uncited pay bands), so a later
 * copy edit cannot quietly bring one back.
 *
 * Visible text is read from the TypeScript AST (JSX text, string literals and
 * template segments), so comments, which may use dashes freely, never trip
 * it. Strings that look like CSS are skipped because their hyphens are
 * syntax, not prose. The extractor is exercised on a fixture first so a false
 * negative in it cannot silently pass the corpus.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve(__dirname, '../..');

/** The public employer surfaces this rule covers: directories and single files. */
const SURFACES: readonly string[] = [
    'app/pricing',
    'app/for-employers',
    'app/faq',
    'app/testimonials',
    'app/success',
    'components/EmployerHowItWorks.tsx',
    'components/tools',
];

interface VisibleText {
    text: string;
    line: number;
}

/**
 * Hyphens inside these are CSS syntax ("calc(100% - 20px)", a styled
 * template whose comments may use dashes), not prose.
 */
const CSS_LIKE = /(\d+px|rgba?\(|var\(--|calc\(|linear-gradient|translate[XY]?\(|@media|@keyframes|!important|\{)/i;

/** Every piece of text a visitor can see, from one TS or TSX source. */
function extractVisibleText(src: string, fileName: string): VisibleText[] {
    const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true, kind);
    const out: VisibleText[] = [];
    const lineOf = (node: ts.Node): number => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

    const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
        if (ts.isJsxText(node)) {
            // Keep the surrounding spaces: `{min} - {max}` is a JSX text node
            // of exactly " - ", and that is a visible spaced hyphen.
            const text = node.text.replace(/\s+/g, ' ');
            if (text.trim() !== '') out.push({ text, line: lineOf(node) });
        } else if (
            ts.isStringLiteral(node) ||
            ts.isNoSubstitutionTemplateLiteral(node) ||
            ts.isTemplateHead(node) ||
            ts.isTemplateMiddle(node) ||
            ts.isTemplateTail(node)
        ) {
            const text = node.text;
            // A letterless string is a separator or a token ('-' in a slug,
            // '#1A2E35'), unless it is a spaced join or carries a real dash.
            const mayBeVisible = /[A-Za-z]/.test(text) || /\s-\s/.test(text) || /[–—]/.test(text);
            if (mayBeVisible && !CSS_LIKE.test(text)) out.push({ text, line: lineOf(node) });
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return out;
}

/** [pattern, why it is banned], checked against visible text only. */
const BANNED: readonly [RegExp, string][] = [
    [/[–—]/, 'em or en dash'],
    [/(?:^|\s)-(?:\s|$)/, 'spaced hyphen'],
    [/\b\d[\d,.]*\s*-\s*\d[\d,.]*\s*(?:yrs?|years?|hours?|days?|weeks?|months?|k|%)(?![A-Za-z])/i, 'hyphen range (ranges read "to")'],
    [/\$\d[\d,.]*k?\s*-\s*\$?\d/i, 'hyphen range (ranges read "to")'],
    [/\b[A-Z]-[A-Z]\b/, 'hyphen range (ranges read "to")'],
];

function violations(items: readonly VisibleText[]): string[] {
    const found: string[] = [];
    for (const item of items) {
        for (const [pattern, why] of BANNED) {
            if (pattern.test(item.text)) found.push(`${item.line}: ${why}: ${JSON.stringify(item.text.trim())}`);
        }
    }
    return found;
}

function walk(rel: string): string[] {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) return [];
    // Normalised so a single-file surface uses the same separator as the
    // directory entries path.join builds below (backslash on Windows).
    if (fs.statSync(abs).isFile()) return [path.normalize(rel)];
    const out: string[] = [];
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
        const child = path.join(rel, entry.name);
        if (entry.isDirectory()) out.push(...walk(child));
        else if (/\.tsx?$/.test(entry.name)) out.push(child);
    }
    return out;
}

const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** All visible text of one file, joined, for claim pins that must ignore comments. */
const visibleOf = (rel: string): string => extractVisibleText(read(rel), rel).map((v) => v.text).join('\n');

describe('public employer copy rule: the extractor', () => {
    const fixture = [
        'export const A = ({ min, max }: { min: number; max: number }) => (',
        '  // A comment — with a dash is never visible.',
        '  <div className="flex items-center gap-2" style={{ width: \'calc(100% - 20px)\' }}>',
        '    <p>Saved — will retry</p>',
        '    <span>{min} - {max}</span>',
        "    <i>{'1-2 years'}</i>",
        "    <b>{`Pay ${min} to ${max}`}</b>",
        "    <s>{'$120k-$140k'}</s>",
        "    <u data-slug={'a b'.replace(/ /g, '-')}>{'Name A-Z'}</u>",
        '  </div>',
        ');',
    ].join('\n');
    const found = violations(extractVisibleText(fixture, 'fixture.tsx'));

    it('flags dashes, spaced hyphens and hyphen ranges', () => {
        expect(found.some((v) => v.includes('em or en dash') && v.includes('Saved'))).toBe(true);
        expect(found.some((v) => v.includes('spaced hyphen') && v.includes('"-"'))).toBe(true);
        expect(found.some((v) => v.includes('hyphen range') && v.includes('1-2 years'))).toBe(true);
        expect(found.some((v) => v.includes('hyphen range') && v.includes('$120k-$140k'))).toBe(true);
        expect(found.some((v) => v.includes('hyphen range') && v.includes('Name A-Z'))).toBe(true);
    });

    it('ignores comments, CSS, class lists, a bare slug separator and clean "to" ranges', () => {
        expect(found.some((v) => v.includes('comment'))).toBe(false);
        expect(found.some((v) => v.includes('calc('))).toBe(false);
        expect(found.some((v) => v.includes('items-center'))).toBe(false);
        expect(found.some((v) => v.includes('Pay'))).toBe(false);
        expect(found).toHaveLength(5);
    });
});

describe('public employer copy rule: the surfaces', () => {
    const files = SURFACES.flatMap(walk);

    it('scans a plausible surface area (walker sanity check)', () => {
        expect(files).toContain(path.join('app', 'pricing', 'page.tsx'));
        expect(files).toContain(path.join('app', 'for-employers', 'resources', 'how-to-hire', 'page.tsx'));
        expect(files).toContain(path.join('components', 'EmployerHowItWorks.tsx'));
        expect(files).toContain(path.join('components', 'tools', 'EmployerCostPerHireCalculator.tsx'));
        expect(files.length).toBeGreaterThan(25);
    });

    it('no visible dash, spaced hyphen or hyphen range in any public employer file', () => {
        const failures = files.flatMap((rel) =>
            violations(extractVisibleText(read(rel), rel)).map((v) => `${rel}:${v}`),
        );
        expect(failures, failures.join('\n')).toEqual([]);
    });
});

describe('public employer copy rule: claim fixes stay fixed', () => {
    it('/faq states no unmeasured ranking, response time, freshness or pay band', () => {
        const faq = visibleOf('app/faq/page.tsx');
        expect(faq).not.toMatch(/#1\b/);
        expect(faq).not.toContain('usually much faster');
        expect(faq).not.toContain('added and updated daily');
        expect(faq).not.toMatch(/\$\d/);
        expect(faq).not.toContain('Top online programs');
        expect(faq).not.toContain('The largest');
        // The response window matches the promise /contact makes.
        expect(faq).toContain('within 24 to 48 hours');
    });

    it('/faq asks for the median salary, the statistic it actually cites', () => {
        const faq = visibleOf('app/faq/page.tsx');
        expect(faq).toContain('What is the median salary of a ');
        expect(faq).not.toMatch(/\baverage salary\b/i);
    });

    it('no surface restates the listing length or posting time by hand', () => {
        expect(visibleOf('components/EmployerHowItWorks.tsx')).not.toMatch(/\bin \d+ minutes\b/);
        for (const rel of ['app/pricing/page.tsx', 'app/for-employers/page.tsx']) {
            expect(visibleOf(rel), rel).not.toContain('two full months');
        }
    });
});
