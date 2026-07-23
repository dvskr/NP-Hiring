/**
 * Regression guards for the seo-sitemaps middleware fixes (B26, B30, B31).
 *
 * B26 — trailing-slash + case normalization must run BEFORE the 410 gates.
 *   Mixed-case / trailing-slash variants of valid pages (/jobs/Remote,
 *   /companies/Acme-X) previously failed the case-sensitive allowlist/DB
 *   lookups and were served 410 + noindex instead of a 301 to canonical.
 *
 * B30 — the company 410 gate must apply the SAME kebab→legacy-space
 *   fallback as the page resolver (app/companies/[slug]/page.tsx), or it
 *   410s the exact kebab URLs the sitemap now emits for legacy rows.
 *
 * B31 — the middleware 410 predicate (unpublished OR date-expired) is the
 *   authoritative expired-job behavior; the page mirrors it (see the
 *   page-side pins in seo-sitemaps-page-schema.test.ts).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('B26 — URL normalization runs before the 410 gates', () => {
  const mw = read('middleware.ts');

  it('trailing-slash strip appears before the first 410 gate', () => {
    const trailingSlashIdx = mw.indexOf("pathname.endsWith('/')");
    const first410Idx = mw.indexOf('410 Gone for Deleted/Expired Job URLs');
    expect(trailingSlashIdx).toBeGreaterThan(-1);
    expect(first410Idx).toBeGreaterThan(-1);
    expect(trailingSlashIdx).toBeLessThan(first410Idx);
  });

  it('case-fold redirect appears before the first 410 gate', () => {
    const caseFoldIdx = mw.indexOf('/[A-Z]/.test(pathname)');
    const first410Idx = mw.indexOf('410 Gone for Deleted/Expired Job URLs');
    expect(caseFoldIdx).toBeGreaterThan(-1);
    expect(caseFoldIdx).toBeLessThan(first410Idx);
  });

  it('normalization blocks are not duplicated after the gates', () => {
    // Exactly one live trailing-slash strip and one case-fold.
    expect(mw.match(/pathname\.endsWith\('\/'\)/g)?.length).toBe(1);
    expect(mw.match(/\/\[A-Z\]\/\.test\(pathname\)/g)?.length).toBe(1);
  });
});

describe('B30 — company 410 gate resolves kebab slugs against legacy space rows', () => {
  const mw = read('middleware.ts');

  it('falls back to the legacy space form before ruling 410', () => {
    expect(mw).toContain("decodedSlug.replace(/-/g, ' ')");
  });

  it('never 410s on a non-definitive (failed) legacy lookup', () => {
    expect(mw).toContain('lookupDefinitive');
    expect(mw).toMatch(/else if \(lookupDefinitive\)/);
  });

  it('page resolver still applies the same kebab→space fallback (parity anchor)', () => {
    const page = read('app/companies/[slug]/page.tsx');
    expect(page).toContain("slug.replace(/-/g, ' ')");
  });
});

describe('B31 — middleware stays the authoritative expired-job 410', () => {
  const mw = read('middleware.ts');

  it('410 predicate covers absent, unpublished, and date-expired rows', () => {
    expect(mw).toMatch(/rows\.length === 0 \|\| !row\.is_published \|\| dateExpired/);
  });
});
