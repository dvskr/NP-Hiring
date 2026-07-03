/**
 * Shared brand-leak + niche-copy scanners.
 *
 * Two scanners over the same production-source walk:
 *
 *   1. `scanBrandLeaks` — occurrences of brand-identifying strings
 *      (domain, brand name, legal entity). Consumers:
 *        - tests/regressions/brand-leak-ratchet.test.ts — CI ratchet that
 *          compares the scan against a checked-in baseline.
 *        - scripts/fork-preflight.ts — fork launch preflight that reports
 *          leftover original-brand strings on a re-niched board.
 *
 *   2. `scanNicheCopyDebt` — occurrences of the template's REFERENCE-NICHE
 *      terms (PMHNP / psychiatric / mental health). Consumers:
 *        - tests/regressions/niche-copy-debt.test.ts — CI ratchet with its
 *          own baseline (niche-copy-debt-baseline.json).
 *        - scripts/fork-preflight.ts §5 — WARN-level debt report.
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

function collectScanFiles(
    root: string,
    dirs: ReadonlyArray<string>,
    rootFiles: ReadonlyArray<string>,
): string[] {
    const files: string[] = [];
    for (const dir of dirs) {
        const abs = path.join(root, dir);
        if (fs.existsSync(abs)) walk(abs, files);
    }
    for (const f of rootFiles) {
        const abs = path.join(root, f);
        if (fs.existsSync(abs)) files.push(abs);
    }
    return files;
}

function countPerFile(
    root: string,
    files: ReadonlyArray<string>,
    patterns: ReadonlyArray<BrandLeakPattern>,
    excludePathPrefixes: ReadonlyArray<string>,
): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const file of files) {
        const rel = path.relative(root, file).replace(/\\/g, '/');
        if (excludePathPrefixes.some((p) => rel.startsWith(p))) continue;
        const content = fs.readFileSync(file, 'utf-8');
        const n = countMatches(content, patterns);
        if (n > 0) counts[rel] = n;
    }
    return counts;
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

    const files = collectScanFiles(root, dirs, rootFiles);
    return countPerFile(root, files, patterns, EXCLUDE_PATH_PREFIXES);
}

// ─── niche-copy debt scanner ────────────────────────────────────────────────

/**
 * Terms that identify the TEMPLATE's reference niche (PMHNP). Unlike the
 * brand-leak patterns, these are not "must never appear" strings — they
 * track copy still WRITTEN FOR the reference niche rather than derived
 * from `brand.niche` tokens in config/brand.ts.
 */
export const TEMPLATE_REFERENCE_NICHE_TERMS: ReadonlyArray<RegExp> = [
    /pmhnp/gi,
    /psychiatric/gi,
    /mental health/gi,
];

// Same exclusions as the brand scan, PLUS config/ — config/brand.ts and
// config/niche/* are the sanctioned source of truth for niche terms, so
// hits there are definitionally not debt.
const NICHE_COPY_EXCLUDE_PATH_PREFIXES = [
    ...EXCLUDE_PATH_PREFIXES,
    'config/',
];

export interface NicheCopyDebtScanOptions {
    /** Repo root the scan dirs / root files are resolved against. */
    root: string;
}

/**
 * Inventories occurrences of the template's reference-niche terms across
 * the same production surfaces as the brand scan (same dirs, root files,
 * and exclusions — plus config/, the source of truth).
 *
 * Returns a map of repo-relative file path (forward slashes) → number of
 * reference-niche-term occurrences, for every file with at least one hit.
 *
 * Interpretation:
 *   - On the TEMPLATE, most hits are expected — PMHNP *is* the reference
 *     niche, so its own copy legitimately says "psychiatric", "mental
 *     health", etc. The ratchet only guards against NEW hardcoded niche
 *     copy creeping in where a `brand.niche` token should be used.
 *   - On a FORK, this is where the scanner earns its keep: every hit is
 *     either an intentional specialty mention (e.g. a psych category on a
 *     general NP board) or copy that was never rewritten for the new
 *     niche. The per-file counts are the fork's copy-rewrite worklist.
 */
export function scanNicheCopyDebt(options: NicheCopyDebtScanOptions): Record<string, number> {
    const { root } = options;
    const files = collectScanFiles(root, BRAND_LEAK_SCAN_DIRS, BRAND_LEAK_SCAN_ROOT_FILES);
    const patterns: BrandLeakPattern[] = TEMPLATE_REFERENCE_NICHE_TERMS.map((re, i) => ({
        name: `reference-niche-term-${i}`,
        re,
    }));
    return countPerFile(root, files, patterns, NICHE_COPY_EXCLUDE_PATH_PREFIXES);
}
