/**
 * Niche-copy debt ratchet.
 *
 * Niche IDENTITY strings in production source must derive from the
 * `brand.niche` tokens in config/brand.ts (short / medium / long /
 * descriptor / adjective / category) — never be hardcoded. This test
 * inventories every occurrence of the template's REFERENCE-NICHE terms
 * (PMHNP / psychiatric / mental health) in production source and compares
 * against a checked-in baseline:
 *
 *   - a file NOT in the baseline containing a niche term  → FAIL (new debt)
 *   - a file exceeding its baselined count                → FAIL (debt grew)
 *   - counts shrinking                                    → PASS (tighten the
 *     baseline when convenient — see below)
 *
 * What the baseline means: on the TEMPLATE most hits are expected — PMHNP
 * *is* the reference niche, so the baseline is large and that's fine. The
 * ratchet only stops NEW hardcoded niche copy from creeping in where a
 * `brand.niche` token should be used. On a FORK, the baseline is the copy
 * rewrite worklist: every entry is either an intentional specialty mention
 * or copy still written for the original PMHNP niche.
 *
 * MISSING-BASELINE BEHAVIOR (deliberate): if niche-copy-debt-baseline.json
 * does not exist yet, this test PASSES with a console warning instead of
 * failing. The template-wide niche-copy tokenization pass runs across many
 * files concurrently; generating the baseline mid-pass would freeze a
 * half-tokenized inventory, so the orchestrator generates it once, at the
 * END of the pass. Until then the ratchet is intentionally unarmed.
 *
 * To (re)generate the baseline:
 *   UPDATE_NICHE_COPY_BASELINE=1 npx vitest run tests/regressions/niche-copy-debt.test.ts
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
// Scan machinery (terms, scan dirs, walker) is shared with the brand-leak
// ratchet and scripts/fork-preflight.ts — see tests/regressions/brand-leak-scan.ts.
import { scanNicheCopyDebt } from './brand-leak-scan';

const ROOT = path.resolve(__dirname, '../..');
const BASELINE_PATH = path.join(__dirname, 'niche-copy-debt-baseline.json');

describe('niche-copy debt ratchet', () => {
  it('no production file gains reference-niche copy beyond the baseline', () => {
    const current = scanNicheCopyDebt({ root: ROOT });

    if (process.env.UPDATE_NICHE_COPY_BASELINE === '1') {
      const sorted = Object.fromEntries(
        Object.entries(current).sort(([a], [b]) => a.localeCompare(b)),
      );
      fs.writeFileSync(BASELINE_PATH, JSON.stringify(sorted, null, 2) + '\n');
      // eslint-disable-next-line no-console
      console.log(
        `[niche-copy-debt] baseline regenerated: ${Object.keys(sorted).length} files`,
      );
      return;
    }

    if (!fs.existsSync(BASELINE_PATH)) {
      // Deliberate: PASS, don't fail — see the MISSING-BASELINE BEHAVIOR
      // note in the header. The orchestrator generates the baseline after
      // the tokenization pass completes.
      // eslint-disable-next-line no-console
      console.warn(
        '[niche-copy-debt] baseline missing — PASSING by design (ratchet unarmed). ' +
        'Once the niche-copy tokenization pass is complete, generate it with: ' +
        'UPDATE_NICHE_COPY_BASELINE=1 npx vitest run tests/regressions/niche-copy-debt.test.ts',
      );
      return;
    }

    const baseline: Record<string, number> = JSON.parse(
      fs.readFileSync(BASELINE_PATH, 'utf-8'),
    );

    const newDebt: string[] = [];
    const grownDebt: string[] = [];
    for (const [file, count] of Object.entries(current)) {
      const allowed = baseline[file];
      if (allowed === undefined) {
        newDebt.push(`${file} (${count})`);
      } else if (count > allowed) {
        grownDebt.push(`${file} (${count} > baseline ${allowed})`);
      }
    }

    const message = [
      newDebt.length
        ? `NEW niche-copy debt (derive niche identity from the brand.niche tokens in config/brand.ts — short/medium/long/descriptor/adjective/category — instead of hardcoding PMHNP/psychiatric/mental-health copy):\n  ${newDebt.join('\n  ')}`
        : '',
      grownDebt.length
        ? `GROWN niche-copy debt (use brand.niche tokens for the added copy):\n  ${grownDebt.join('\n  ')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    expect(newDebt.length + grownDebt.length, message).toBe(0);
  });
});
