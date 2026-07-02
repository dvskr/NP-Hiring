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
// Scan machinery (patterns, scan dirs, walker) is shared with
// scripts/fork-preflight.ts — see tests/regressions/brand-leak-scan.ts.
import { scanBrandLeaks } from './brand-leak-scan';

const ROOT = path.resolve(__dirname, '../..');
const BASELINE_PATH = path.join(__dirname, 'brand-leak-baseline.json');

describe('brand-leak ratchet', () => {
  it('no production file gains brand-string occurrences beyond the baseline', () => {
    const current = scanBrandLeaks({ root: ROOT });

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
