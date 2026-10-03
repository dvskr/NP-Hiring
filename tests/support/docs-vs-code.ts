/**
 * Helpers for the suites that read a document and the code it describes
 * side by side (tests/regressions/docs-pricing-system-matches-code.test.ts
 * and docs-pending-work-matches-code.test.ts).
 *
 * A document goes stale silently: nothing fails when the code moves on. The
 * suites derive the fact from the code wherever they can (a set, a status
 * map, a response shape, a function name) and then look for it in the
 * document, so the next change to either side fails with the other in view.
 */
import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(__dirname, '../..');

/** A repo file as text, with Windows line endings folded so one regex reads every checkout. */
export const readRepo = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

export const existsInRepo = (rel: string): boolean => fs.existsSync(path.join(ROOT, rel));

/**
 * The text of `doc` from `start` up to `end` (to the end of the document
 * when `end` is omitted). A missing marker throws: a restructured document
 * must fail loudly, never pass on an empty slice.
 */
export function between(doc: string, start: string, end?: string): string {
    const from = doc.indexOf(start);
    if (from < 0) throw new Error(`marker not found: ${start}`);
    if (end === undefined) return doc.slice(from);
    const to = doc.indexOf(end, from + start.length);
    if (to < 0) throw new Error(`marker not found after "${start}": ${end}`);
    return doc.slice(from, to);
}

/** The one line of `text` that contains `marker`. */
export function lineWith(text: string, marker: string): string {
    const line = text.split('\n').find((candidate) => candidate.includes(marker));
    if (line === undefined) throw new Error(`no line contains: ${marker}`);
    return line;
}

/**
 * A file path under a source root, as a document writes it in prose, a code
 * span or a diagram. A glob (`webhooks-stripe-*.test.ts`) is not a path, and
 * neither is a bare file name with no directory.
 */
const REPO_PATH = /(?<![\w./-])((?:app|lib|components|tests|scripts|prisma|docs|config|tmp)\/[A-Za-z0-9_\-./[\]]+\.(?:tsx?|mjs|cjs|js|md|prisma|sql|json))/g;

/** Every repo file path `doc` names, once each. */
export function repoPathsNamed(doc: string): string[] {
    return [...new Set([...doc.matchAll(REPO_PATH)].map((match) => match[1]))];
}

/** Source without JSX, block and line comments, so prose about a literal does not count as one. */
export function withoutComments(src: string): string {
    return src
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** Repo-relative paths of the files under `dir` whose name `keep` accepts, recursively. */
export function walk(dir: string, keep: (name: string) => boolean): string[] {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) return [];
    const out: string[] = [];
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) out.push(...walk(rel, keep));
        else if (keep(entry.name)) out.push(rel);
    }
    return out;
}

/** A non-test TypeScript source. */
export const isSource = (name: string): boolean => /\.tsx?$/.test(name) && !/\.(?:d|test)\.tsx?$/.test(name);
