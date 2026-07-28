/**
 * Static regression guards for B20 — the ten exported-but-never-imported
 * components (including BulkUnlockToolbar, which duplicated the live
 * bulk-unlock logic in CandidateSearchClient) were deleted after a
 * zero-consumer audit. These pins keep all ten deleted and make sure no
 * import of them is ever reintroduced.
 *
 * (WhyUs / Comparison / Testimonial are additionally pinned by
 * tests/regressions/aeo-content-inventory-claims.test.ts as part of B10 —
 * the duplicate pin here documents the full B20 list in one place.)
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

const DELETED_COMPONENTS = [
  'components/BrowseByState.tsx',
  'components/Comparison.tsx',
  'components/FloatingSocial.tsx',
  'components/ShareMenu.tsx',
  'components/StatsCounter.tsx',
  'components/Testimonial.tsx',
  'components/WhyUs.tsx',
  'components/auth/LoginForm.tsx',
  'components/employer/BulkUnlockToolbar.tsx',
  'components/ui/Input.tsx',
] as const;

// Module specifiers as they would appear in an import statement. The closing
// quote prevents false positives on longer names (FeaturedTestimonials,
// InputMask, ...).
const IMPORT_PATTERN =
  /from\s+['"][^'"]*components\/(BrowseByState|Comparison|FloatingSocial|ShareMenu|StatsCounter|Testimonial|WhyUs|auth\/LoginForm|employer\/BulkUnlockToolbar|ui\/Input)['"]/;

function collectSources(): string[] {
  const acc: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) acc.push(full);
    }
  };
  for (const d of ['app', 'components', 'lib']) {
    const abs = path.join(ROOT, d);
    if (fs.existsSync(abs)) walk(abs);
  }
  return acc;
}

describe('B20 — the ten never-imported components stay deleted', () => {
  for (const rel of DELETED_COMPONENTS) {
    it(`${rel} does not exist`, () => {
      expect(fs.existsSync(path.join(ROOT, rel))).toBe(false);
    });
  }

  it('nothing imports any of the deleted components', () => {
    const offenders = collectSources().filter((f) =>
      IMPORT_PATTERN.test(fs.readFileSync(f, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('the live bulk-unlock path (CandidateSearchClient) is still present', () => {
    // BulkUnlockToolbar duplicated this logic; deleting it must not have
    // taken the live implementation with it.
    const src = fs.readFileSync(
      path.join(ROOT, 'components/employer/CandidateSearchClient.tsx'),
      'utf8',
    );
    expect(src).toMatch(/unlock-bulk/);
  });
});
