/**
 * Rules the widget source keeps, checked on the source itself:
 *   - copy: no em dash, en dash or spaced hyphen in any string or JSX text
 *     (owner house style);
 *   - host rules: no window.open, alert, confirm, prompt, clipboard, web
 *     storage or network calls (links go through app.openLink, data through
 *     app.callServerTool);
 *   - imports: runtime values only from preact, the ext-apps SDK and
 *     lib/mcp/tool-names.ts; lib/mcp/contracts.ts as types only.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '../../../lib/mcp/widgets/src');

function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(full);
        return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
    });
}

function parse(file: string): ts.SourceFile {
    const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, kind);
}

/** Every string a user could see: string and template literals and JSX text (module specifiers excluded). */
function visibleStrings(source: ts.SourceFile): string[] {
    const found: string[] = [];
    const visit = (node: ts.Node) => {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
        if (
            ts.isStringLiteral(node) ||
            ts.isNoSubstitutionTemplateLiteral(node) ||
            ts.isTemplateHead(node) ||
            ts.isTemplateMiddle(node) ||
            ts.isTemplateTail(node)
        ) {
            found.push(node.text);
        } else if (ts.isJsxText(node)) {
            found.push(node.getText(source));
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return found;
}

const files = sourceFiles(SRC);
const relative = (file: string) => path.relative(SRC, file).replace(/\\/g, '/');

describe('widget source rules', () => {
    it('finds the widget source', () => {
        expect(files.map(relative)).toEqual(expect.arrayContaining(['main.tsx', 'copy.ts', 'views/job-list.tsx']));
    });

    it('has no em dash, en dash or spaced hyphen in any user-visible string', () => {
        const offenders = files.flatMap((file) =>
            visibleStrings(parse(file))
                .filter((text) => /[–—]|\s-\s/.test(text))
                .map((text) => `${relative(file)}: ${JSON.stringify(text)}`),
        );
        expect(offenders).toEqual([]);
    });

    it('never opens windows, prompts, stores, copies or fetches on its own', () => {
        const forbidden = [
            /\bwindow\.open\s*\(/,
            /\balert\s*\(/,
            /(?<![.\w])confirm\s*\(/,
            /(?<![.\w])prompt\s*\(/,
            /\blocalStorage\b/,
            /\bsessionStorage\b/,
            /\bindexedDB\b/,
            /\bnavigator\.clipboard\b/,
            /\bdocument\.cookie\b/,
            /\bfetch\s*\(/,
            /\bXMLHttpRequest\b/,
            /\bWebSocket\b/,
            /\bEventSource\b/,
            /\bsendBeacon\b/,
        ];
        const printer = ts.createPrinter({ removeComments: true });
        const offenders = files.flatMap((file) => {
            const code = printer.printFile(parse(file));
            return forbidden.filter((pattern) => pattern.test(code)).map((pattern) => `${relative(file)}: ${pattern}`);
        });
        expect(offenders).toEqual([]);
    });

    it('imports runtime values only from preact, the ext-apps SDK and tool-names, and contracts as types', () => {
        const runtimePackages = new Set(['preact', 'preact/hooks', '@modelcontextprotocol/ext-apps']);
        const offenders: string[] = [];
        for (const file of files) {
            for (const statement of parse(file).statements) {
                if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
                const specifier = statement.moduleSpecifier;
                if (!specifier || !ts.isStringLiteral(specifier)) continue;
                const from = specifier.text;
                const typeOnly = ts.isImportDeclaration(statement)
                    ? statement.importClause?.isTypeOnly === true
                    : statement.isTypeOnly;
                if (runtimePackages.has(from)) continue;
                if (from.startsWith('.')) {
                    const target = path.resolve(path.dirname(file), from);
                    const inside = target.startsWith(SRC + path.sep);
                    const base = path.basename(target);
                    if (inside) continue;
                    if (base === 'tool-names') continue;
                    if (base === 'contracts' && typeOnly) continue;
                }
                offenders.push(`${relative(file)} imports ${from}${typeOnly ? ' (type)' : ''}`);
            }
        }
        expect(offenders).toEqual([]);
    });
});
