/**
 * Employer surfaces copy rule (house style, owner direction 2026-09-12).
 *
 * The employer application (the /post-job wizard, preview and checkout, the
 * /employer pages and components/employer) is a working product: labels,
 * empty states, status text and form help an employer acts on. This test
 * holds its VISIBLE text to the same rules as the public pages:
 *
 *   - no em dash (U+2014), no en dash (U+2013), no spaced hyphen;
 *   - ranges read "to" ("1 to 2 yrs", "Name (A to Z)"), never a hyphen;
 *   - no unsourced multiplier or percentage claims ("3x more views",
 *     "~40%"): the claim rule says every number traces to a named function
 *     or a stats source, and none of those ever measured these;
 *   - stored salary strings pass through normalizeDisplaySalary before
 *     they render, because older ingests wrote "$112k-$140k/yr".
 *
 * Visible text is read from the TypeScript AST (JSX text, string literals
 * and template segments), so comments, which may use dashes freely, never
 * trip it. CSS strings and class lists are skipped because their hyphens
 * are syntax, not prose. The extractor is exercised on a fixture first so a
 * false negative in it cannot silently pass the corpus.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve(__dirname, '../..');

/** The employer application surfaces this rule covers (no API routes). */
const EMPLOYER_DIRS: readonly string[] = ['app/post-job', 'app/employer', 'components/employer'];

interface VisibleText {
    text: string;
    line: number;
    kind: 'jsx' | 'string';
}

/**
 * Hyphens inside these are CSS syntax ("calc(100% - 20px)", "inset 0 -1px"),
 * not prose. Class lists need no skip: none of the banned shapes can occur
 * in one, and a class-list heuristic would also swallow "1-2 yrs".
 */
const CSS_LIKE = /(\d+px|rgba?\(|var\(--|calc\(|linear-gradient|translate[XY]?\(|@media|@keyframes|!important|\{)/i;

/** Every piece of text a user can see, from one TS or TSX source. */
export function extractVisibleText(src: string, fileName: string): VisibleText[] {
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
            if (text.trim() !== '') out.push({ text, line: lineOf(node), kind: 'jsx' });
        } else if (
            ts.isStringLiteral(node) ||
            ts.isNoSubstitutionTemplateLiteral(node) ||
            ts.isTemplateHead(node) ||
            ts.isTemplateMiddle(node) ||
            ts.isTemplateTail(node)
        ) {
            const text = node.text;
            // A letterless string is a separator or a token ('-' in a slug
            // replace, '#1A2E35'), unless it is a spaced join like ' - '
            // or carries a real dash character.
            const mayBeVisible = /[A-Za-z]/.test(text) || /\s-\s/.test(text) || /[–—]/.test(text);
            if (mayBeVisible && !CSS_LIKE.test(text)) {
                out.push({ text, line: lineOf(node), kind: 'string' });
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return out;
}

/** [pattern, why it is banned] — checked against visible text only. */
const BANNED: readonly [RegExp, string][] = [
    [/[–—]/, 'em or en dash'],
    [/(?:^|\s)-(?:\s|$)/, 'spaced hyphen'],
    [/\b\d[\d,.]*\s*-\s*\d[\d,.]*\s*(?:yrs?|years?|hours?|days?|weeks?|months?|k|%)(?![A-Za-z])/i, 'hyphen range (ranges read "to")'],
    [/\b[A-Z]-[A-Z]\b/, 'hyphen range (ranges read "to")'],
    [/\d\s*[×x]\s*(?:more|the)\b/i, 'unsourced multiplier claim'],
    [/~\s*\d+\s*%/, 'unsourced percentage claim'],
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

function walk(dir: string): string[] {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) return [];
    const out: string[] = [];
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
        const rel = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(rel));
        else if (/\.tsx?$/.test(entry.name)) out.push(rel);
    }
    return out;
}

const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('employer copy rule: the extractor', () => {
    const fixture = [
        "export const A = ({ min, max }: { min: number; max: number }) => (",
        '  // A comment — with a dash is never visible.',
        '  <div className="flex items-center gap-2" style={{ width: \'calc(100% - 20px)\' }}>',
        '    <p>Saved — will retry</p>',
        '    <span>{min} - {max}</span>',
        "    {'Loading - please wait'}",
        "    <b>{`Pay ${min} to ${max}`}</b>",
        "    <i>{'1-2 yrs'}</i>",
        "    <s>{[min, max].join(' - ')}</s>",
        "    <u download={`invoice-${'a b'.replace(/ /g, '-')}.pdf`}>{'Name A-Z'}</u>",
        '    <em>Get 3× more views</em>',
        '  </div>',
        ');',
    ].join('\n');
    const found = violations(extractVisibleText(fixture, 'fixture.tsx'));

    it('flags dashes, spaced hyphens, hyphen ranges and multipliers', () => {
        expect(found.some((v) => v.includes('em or en dash') && v.includes('Saved'))).toBe(true);
        expect(found.some((v) => v.includes('spaced hyphen') && v.includes('"-"'))).toBe(true);
        expect(found.some((v) => v.includes('spaced hyphen') && v.includes('Loading'))).toBe(true);
        expect(found.some((v) => v.includes('hyphen range') && v.includes('1-2 yrs'))).toBe(true);
        expect(found.some((v) => v.includes('hyphen range') && v.includes('Name A-Z'))).toBe(true);
        expect(found.some((v) => v.includes('multiplier') && v.includes('3× more'))).toBe(true);
    });

    it('ignores comments, CSS, class lists, a bare slug separator and clean "to" ranges', () => {
        expect(found.some((v) => v.includes('comment'))).toBe(false);
        expect(found.some((v) => v.includes('calc('))).toBe(false);
        expect(found.some((v) => v.includes('items-center'))).toBe(false);
        expect(found.some((v) => v.includes('Pay'))).toBe(false);
        // Two spaced hyphens (the JSX " - " and the ' - ' join) plus the
        // five other shapes above, and nothing from the '-' slug separator.
        expect(found).toHaveLength(7);
    });
});

describe('employer copy rule: the employer application surfaces', () => {
    const files = EMPLOYER_DIRS.flatMap(walk);

    it('scans a plausible surface area (walker sanity check)', () => {
        expect(files).toContain(path.join('app', 'post-job', 'page.tsx'));
        expect(files).toContain(path.join('app', 'employer', 'settings', 'EmployerSettingsClient.tsx'));
        expect(files).toContain(path.join('components', 'employer', 'EmployerDashboardClient.tsx'));
        expect(files.length).toBeGreaterThan(20);
    });

    it('no visible dash, hyphen range or unsourced multiplier in any employer file', () => {
        const failures = files.flatMap((rel) =>
            violations(extractVisibleText(read(rel), rel)).map((v) => `${rel}:${v}`),
        );
        expect(failures, failures.join('\n')).toEqual([]);
    });

    it('the salary competitiveness list normalises the stored salary string', () => {
        const src = read('components/employer/AnalyticsTab.tsx');
        expect(src).toContain("import { normalizeDisplaySalary } from '@/lib/salary-display'");
        expect(src).toContain('normalizeDisplaySalary(job.displaySalary)');
        expect(src).not.toMatch(/\{job\.displaySalary \|\|/);
    });

    it('the no-charge price captions never print $0', () => {
        const src = read('app/post-job/preview/page.tsx');
        const captions = src.slice(src.indexOf('const priceCaption'), src.indexOf('const primaryCtaLabel'));
        expect(captions).not.toContain('$0');
        expect(captions).toContain('Every post is free during our launch period through ${config.promoEndsLabel}.');
        expect(captions).toContain('Included in your Employer plan.');
    });
});
