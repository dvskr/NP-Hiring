/**
 * Shared brand-leak scanner.
 *
 * Inventories occurrences of brand-identifying strings (domain, brand
 * name, legal entity) across production source. Two consumers:
 *
 *   - tests/regressions/brand-leak-ratchet.test.ts — CI ratchet that
 *     compares the scan against a checked-in baseline.
 *   - scripts/fork-preflight.ts — fork launch preflight that reports
 *     leftover original-brand strings on a re-niched board.
 *
 * Pure filesystem walk — no database, no network.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface BrandLeakPattern {
    name: string;
    re: RegExp;
}

/** Brand-identifying strings that must come from config, not source. */
export const BRAND_LEAK_PATTERNS: ReadonlyArray<BrandLeakPattern> = [
    { name: 'domain', re: /pmhnphiring/gi },
    { name: 'brand-name', re: /PMHNP Hiring/g },
    { name: 'legal-entity', re: /Akari/g },
];

/** Production surfaces the ratchet protects. */
export const BRAND_LEAK_SCAN_DIRS: ReadonlyArray<string> = [
    'app',
    'lib',
    'components',
    'types',
    'public',
];

export const BRAND_LEAK_SCAN_ROOT_FILES: ReadonlyArray<string> = [
    'middleware.ts',
    'next.config.ts',
    'instrumentation.ts',
    'instrumentation-client.ts',
    'vercel.json',
];

// Sanctioned homes for brand strings, plus non-production content that is
// per-board authored (tracked by Phase-1 content work, not this ratchet).
const EXCLUDE_DIRS = new Set(['node_modules', '.next', '.git']);
const EXCLUDE_PATH_PREFIXES = [
    'public/videos', // binary-adjacent niche-named media, replaced per board
];
const TEXT_EXTENSIONS = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css',
    '.txt', '.xml', '.webmanifest', '.md', '.html', '.svg',
]);

function isTextFile(filePath: string): boolean {
    return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function walk(dir: string, out: string[]): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (EXCLUDE_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(full, out);
        } else if (entry.isFile() && isTextFile(full)) {
            out.push(full);
        }
    }
}

function countMatches(content: string, patterns: ReadonlyArray<BrandLeakPattern>): number {
    let total = 0;
    for (const { re } of patterns) {
        const matches = content.match(re);
        if (matches) total += matches.length;
    }
    return total;
}

export interface BrandLeakScanOptions {
    /** Repo root the scan dirs / root files are resolved against. */
    root: string;
    /** Directories to walk (default: the ratchet's production surfaces). */
    dirs?: ReadonlyArray<string>;
    /** Individual root-level files to include (default: the ratchet's list). */
    rootFiles?: ReadonlyArray<string>;
    /** Patterns to count (default: domain + brand name + legal entity). */
    patterns?: ReadonlyArray<BrandLeakPattern>;
}

/**
 * Returns a map of repo-relative file path (forward slashes) → number of
 * brand-string occurrences, for every scanned file with at least one hit.
 */
export function scanBrandLeaks(options: BrandLeakScanOptions): Record<string, number> {
    const {
        root,
        dirs = BRAND_LEAK_SCAN_DIRS,
        rootFiles = BRAND_LEAK_SCAN_ROOT_FILES,
        patterns = BRAND_LEAK_PATTERNS,
    } = options;

    const files: string[] = [];
    for (const dir of dirs) {
        const abs = path.join(root, dir);
        if (fs.existsSync(abs)) walk(abs, files);
    }
    for (const f of rootFiles) {
        const abs = path.join(root, f);
        if (fs.existsSync(abs)) files.push(abs);
    }

    const counts: Record<string, number> = {};
    for (const file of files) {
        const rel = path.relative(root, file).replace(/\\/g, '/');
        if (EXCLUDE_PATH_PREFIXES.some((p) => rel.startsWith(p))) continue;
        const content = fs.readFileSync(file, 'utf-8');
        const n = countMatches(content, patterns);
        if (n > 0) counts[rel] = n;
    }
    return counts;
}
