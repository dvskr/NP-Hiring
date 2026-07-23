/**
 * Regression guards for sitemap freshness/consistency fixes (B27, B28, B30, B33).
 *
 * B27 — lastmod must reflect REAL freshness, not "today" or one site-wide
 *   date. Cities batches use pseoStats.updatedAt per row; the primary
 *   sitemap uses per-section _max(updatedAt) aggregates.
 *
 * B28 — activeIndexableJobWhere() bakes `now` into the returned where
 *   clause, so it must be computed per request. Frozen at module scope, a
 *   warm serverless instance kept expired jobs in the sitemap that
 *   middleware serves as 410 ("Submitted URL returns 410" in GSC).
 *
 * B30 — the sitemap must emit kebab company slugs (legacy rows store
 *   space-form normalizedName, which produced invalid literal-space URLs).
 *
 * B33 — metro pages must be inventory-gated, not advertised unconditionally.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('B28 — active-job filter is computed per request, never at module scope', () => {
  it('app/sitemap.ts has no module-scope activeIndexableJobWhere() freeze', () => {
    const src = read('app/sitemap.ts');
    // A top-level (non-indented) const assignment is the frozen pattern.
    expect(src).not.toMatch(/^const \w+ = activeIndexableJobWhere\(\)/m);
    // It must still be called somewhere inside the request handler.
    expect(src).toContain('activeIndexableJobWhere()');
  });

  it('jobs batch route has no module-scope activeIndexableJobWhere() freeze', () => {
    const src = read('app/api/sitemaps/jobs/[batch]/route.ts');
    expect(src).not.toMatch(/^const \w+ = activeIndexableJobWhere\(\)/m);
    expect(src).toContain('activeIndexableJobWhere()');
  });

  it('sitemap index route computes the filter per request (parity anchor)', () => {
    const src = read('app/api/sitemaps/index/route.ts');
    expect(src).not.toMatch(/^const \w+ = activeIndexableJobWhere\(\)/m);
  });
});

describe('B27 — real lastmod values', () => {
  it('cities batch selects pseoStats.updatedAt and emits it per URL', () => {
    const src = read('app/api/sitemaps/cities/[batch]/route.ts');
    expect(src).toMatch(/select: \{ categorySlug: true, locationSlug: true, updatedAt: true \}/);
    expect(src).toContain('toLastmod(row.updatedAt)');
    // The fabricated single "today" stamp must not come back.
    expect(src).not.toMatch(/const lastmod = new Date\(\)\.toISOString\(\)/);
  });

  it('primary sitemap aggregates per-section _max(updatedAt)', () => {
    const src = read('app/sitemap.ts');
    // States, salary-guide states, cities, and companies each carry real dates.
    expect(src.match(/_max: \{ updatedAt: true \}/g)?.length).toBeGreaterThanOrEqual(4);
    expect(src).toContain('stateLastmod');
    expect(src).toContain('companyLastmod');
    expect(src).toMatch(/c\._max\.updatedAt \?\? latestJobDate/);
  });
});

describe('B30 — sitemap emits canonical kebab company slugs', () => {
  it('company URLs are kebab-encoded from normalizedName', () => {
    const src = read('app/sitemap.ts');
    expect(src).toContain("c.normalizedName.replace(/ /g, '-')");
    // Raw space-form interpolation must not return.
    expect(src).not.toMatch(/companies\/\$\{c\.normalizedName\}`/);
  });
});

describe('B33 — metro pages are inventory-gated in the sitemap', () => {
  const src = read('app/sitemap.ts');

  it('metro pages are no longer emitted unconditionally in staticPages', () => {
    // Gating exists: a metroPages section driven by a job groupBy.
    expect(src).toContain('let metroPages');
    expect(src).toContain('metroCityRows');
    expect(src).toMatch(/by: \['city', 'stateCode'\]/);
  });

  it('adjacency sets mirror the metro page inventory match', () => {
    // Must stay in lockstep with getMetroStats in app/jobs/metro/[slug]/page.tsx.
    expect(src).toContain('METRO_ADJACENT_CITIES');
    const metroPage = read('app/jobs/metro/[slug]/page.tsx');
    for (const adjacent of ['Brooklyn', 'St. Petersburg', 'Fort Worth']) {
      expect(src).toContain(adjacent);
      expect(metroPage).toContain(adjacent);
    }
  });

  it('metroPages are included in both the primary list and the degraded fallback', () => {
    expect(src.match(/\.\.\.metroPages,/g)?.length).toBe(2);
  });
});
