/**
 * Regression guards — audit F12 (content-integrity package).
 *
 * /resources advertised "85+ Free Articles" and "50-state licensure guides"
 * that do not exist on this board (config/niche/content-map.ts: no authored
 * posts, license-guide series unwritten), and its salary-guide PDF fallback
 * pointed at the donor board's PMHNP-branded asset, 404ing the lead magnet
 * unless the env override was set.
 *
 * These are static source guards (mirroring audit-highs-static.test.ts):
 * they read the real files so a future edit can't silently reintroduce the
 * bait-and-switch metadata or the donor-asset fallback.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('F12 — /resources metadata matches actual inventory', () => {
  it('no longer advertises "85+ Free Articles" or "50-state licensure guides"', () => {
    const src = read('app/resources/page.tsx');
    expect(src).not.toContain('85+');
    expect(src).not.toContain('50-state licensure guides');
  });

  it('title/description describe the real inventory (salary tool, licensure checker, guides)', () => {
    const src = read('app/resources/page.tsx');
    expect(src).toContain('Career Resources — Salary Tool & Licensure Checker');
    expect(src).toContain('interactive salary calculator');
    expect(src).toContain('Full Practice Authority');
    expect(src).toContain('1099 vs W2');
  });

  it('does not claim "thousands" of positions in the CTA', () => {
    const src = read('app/resources/page.tsx');
    expect(src).not.toContain('thousands of');
  });
});

describe('F12 — salary-guide PDF fallback derives from config/brand.ts', () => {
  it('falls back to brand.assets.salaryGuidePdf, not the donor PMHNP asset', () => {
    const src = read('app/resources/page.tsx');
    expect(src).not.toContain('PMHNP_Salary_Guide');
    expect(src).toContain('brand.assets.salaryGuidePdf');
    // Env override stays first in the chain.
    expect(src).toMatch(/process\.env\.SALARY_GUIDE_URL\s*\|\|\s*brand\.assets\.salaryGuidePdf/);
  });

  it('brand.assets.salaryGuidePdf points at this board\'s own asset', () => {
    const src = read('config/brand.ts');
    expect(src).toMatch(/salaryGuidePdf:\s*'[^']*NP_Salary_Guide\.pdf'/);
  });
});

describe('F12 — empty-inventory sections are gated, not advertised', () => {
  it('state-guide grid ("50-State Coverage") renders only when guides exist', () => {
    const src = read('app/resources/page.tsx');
    expect(src).toContain('{sortedStates.length > 0 && (');
  });

  it('article section renders only when published articles exist', () => {
    const src = read('app/resources/page.tsx');
    expect(src).toContain('{articles.length > 0 && (');
  });
});
