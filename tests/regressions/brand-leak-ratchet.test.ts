/**
 * Brand-leak ratchet.
 *
 * Production code must read brand identity from config/brand.ts (and niche
 * tuning from config/niche/*) — never hardcode it. This test inventories
 * every occurrence of brand-identifying strings in production source and
 * compares against a checked-in baseline:
 *
 *   - a file NOT in the baseline containing a brand string  → FAIL (new leak)
 *   - a file exceeding its baselined count                  → FAIL (leak grew)
 *   - counts shrinking                                      → PASS (tighten the
 *     baseline when convenient — see below)
 *
 * The baseline is the honest TODO list of remaining Phase-1 copy work
 * (niche copy in category pages, marketing components, llms.txt, etc.).
 * It only ever ratchets DOWN.
 *
 * To regenerate the baseline after intentionally removing leaks:
 *   UPDATE_BRAND_LEAK_BASELINE=1 npx vitest run tests/regressions/brand-leak-ratchet.test.ts
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const BASELINE_PATH = path.join(__dirname, 'brand-leak-baseline.json');

// Brand-identifying strings that must come from config, not source.
const PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'domain', re: /pmhnphiring/gi },
  { name: 'brand-name', re: /PMHNP Hiring/g },
  { name: 'legal-entity', re: /Akari/g },
];

// Production surfaces the ratchet protects.
const SCAN_DIRS = ['app', 'lib', 'components', 'types', 'public'];
const SCAN_ROOT_FILES = [
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

function countMatches(content: string): number {
  let total = 0;
  for (const { re } of PATTERNS) {
    const matches = content.match(re);
    if (matches) total += matches.length;
  }
  return total;
}

function scan(): Record<string, number> {
  const files: string[] = [];
  for (const dir of SCAN_DIRS) {
    const abs = path.join(ROOT, dir);
    if (fs.existsSync(abs)) walk(abs, files);
  }
  for (const f of SCAN_ROOT_FILES) {
    const abs = path.join(ROOT, f);
    if (fs.existsSync(abs)) files.push(abs);
  }

  const counts: Record<string, number> = {};
  for (const file of files) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    if (EXCLUDE_PATH_PREFIXES.some((p) => rel.startsWith(p))) continue;
    const content = fs.readFileSync(file, 'utf-8');
    const n = countMatches(content);
    if (n > 0) counts[rel] = n;
  }
  return counts;
}

describe('brand-leak ratchet', () => {
  it('no production file gains brand-string occurrences beyond the baseline', () => {
    const current = scan();

    if (process.env.UPDATE_BRAND_LEAK_BASELINE === '1') {
      const sorted = Object.fromEntries(
        Object.entries(current).sort(([a], [b]) => a.localeCompare(b)),
      );
      fs.writeFileSync(BASELINE_PATH, JSON.stringify(sorted, null, 2) + '\n');
      // eslint-disable-next-line no-console
      console.log(
        `[brand-leak-ratchet] baseline regenerated: ${Object.keys(sorted).length} files`,
      );
      return;
    }

    expect(
      fs.existsSync(BASELINE_PATH),
      'baseline missing — run UPDATE_BRAND_LEAK_BASELINE=1 vitest run tests/regressions/brand-leak-ratchet.test.ts',
    ).toBe(true);
    const baseline: Record<string, number> = JSON.parse(
      fs.readFileSync(BASELINE_PATH, 'utf-8'),
    );

    const newLeaks: string[] = [];
    const grownLeaks: string[] = [];
    for (const [file, count] of Object.entries(current)) {
      const allowed = baseline[file];
      if (allowed === undefined) {
        newLeaks.push(`${file} (${count})`);
      } else if (count > allowed) {
        grownLeaks.push(`${file} (${count} > baseline ${allowed})`);
      }
    }

    const message = [
      newLeaks.length
        ? `NEW brand leaks (read brand from config/brand.ts instead):\n  ${newLeaks.join('\n  ')}`
        : '',
      grownLeaks.length
        ? `GROWN brand leaks:\n  ${grownLeaks.join('\n  ')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    expect(newLeaks.length + grownLeaks.length, message).toBe(0);
  });
});
