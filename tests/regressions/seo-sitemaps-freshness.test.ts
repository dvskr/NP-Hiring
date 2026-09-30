/**
 * Regression guards for sitemap freshness/consistency fixes (B27, B28, B30, B33).
 *
 * B27 — lastmod must reflect REAL freshness, not "today" or one site-wide
 *   date. Since the indexing audit (CS-02, TECH-04, GFJ-10) that means
 *   CONTENT freshness: Job.updatedAt moves on every view count and link
 *   check, and PseoStats.updatedAt on every cron run, so neither is a
 *   lastmod. Job URLs carry Job.contentChangedAt (createdAt before the
 *   column), and every listing page the newest such date among its jobs
 *   (behaviour: tests/regressions/sitemap-content-lastmod.test.ts).
 *
 * B28 — activeIndexableJobWhere() bakes `now` into the returned where
 *   clause, so it must be computed per request. Frozen at module scope, a
 *   warm serverless instance kept expired jobs in the sitemap that
 *   middleware serves as 410 ("Submitted URL returns 410" in GSC).
 *
 * B30 — the sitemap must emit valid company slugs (legacy rows store
 *   space-form normalizedName, which produced invalid literal-space URLs).
 *   It now emits the profile route's own display-name slug
 *   (companyProfilePath, lib/company-slug.ts), which is always kebab.
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
  it('cities batch dates each URL from its listed jobs, never from the cron heartbeat', () => {
    const src = read('app/api/sitemaps/cities/[batch]/route.ts');
    // The gate projection no longer carries updatedAt: it filters on it only.
    expect(src).toContain('SELECT "categorySlug", "locationSlug", "totalJobs", "distinctEmployers", "indexable"');
    expect(src).toContain('listingContentDates(batchUrls)');
    expect(src).not.toContain('toLastmod(row.updatedAt)');
    // The fabricated single "today" stamp must not come back.
    expect(src).not.toMatch(/const lastmod = new Date\(\)\.toISOString\(\)/);
  });

  it('jobs batch emits the content date, not the write timestamp', () => {
    const src = read('app/api/sitemaps/jobs/[batch]/route.ts');
    expect(src).toContain('lastmodTag(jobContentDate(j))');
    expect(src).not.toContain('updatedAt: true');
  });

  it('primary sitemap aggregates per-section content dates', () => {
    const src = read('app/sitemap.ts');
    // States, directories, cities, and companies each carry real dates.
    expect(src.match(/_max: JOB_CONTENT_DATE_FIELDS/g)?.length).toBeGreaterThanOrEqual(4);
    expect(src).not.toMatch(/_max: \{ updatedAt: true \}/);
    expect(src).not.toMatch(/orderBy: \{ updatedAt: 'desc' \}/);
    expect(src).toContain('stateLastmod');
    expect(src).toContain('companyLastmod');
    expect(src).toContain('jobContentDate(c._max)');
  });
});

describe('B30 — sitemap emits canonical kebab company slugs', () => {
  it('company URLs come from the shared slug builder', () => {
    const src = read('app/sitemap.ts');
    expect(src).toContain('url: `${baseUrl}${companyProfilePath(c)}`');
    // Raw space-form interpolation must not return.
    expect(src).not.toMatch(/companies\/\$\{c\.normalizedName\}`/);
  });
});

describe('B33 — metro pages are inventory-gated in the sitemap', () => {
  const src = read('app/sitemap.ts');

  it('metro pages are no longer emitted unconditionally in staticPages', () => {
    // Gating exists: a metroPages section driven by the canonical inventory
    // inside the shared metro scope, through the same gate the page uses.
    expect(src).toContain('let metroPages');
    expect(src).toContain('loadMetroIndexInput(metro, now)');
    expect(src).toContain('shouldIndexMetro(indexInput)');
    // The metro's lastmod reads the same scope.
    expect(src).toContain('metroContentDate(metro, now)');
  });

  it('the metro scope has one definition shared with the page', () => {
    // The in-sitemap adjacency copy (METRO_ADJACENT_CITIES) is gone; the
    // scope predicate lives in lib/pseo/listing-facts.ts for both consumers.
    expect(src).not.toContain('METRO_ADJACENT_CITIES');
    expect(src).toContain('metroScopeWhere(metro)');
    expect(src).toMatch(/import \{[^}]*metroScopeWhere[^}]*\} from '@\/lib\/pseo\/listing-facts'/);
  });

  it('metroPages are included in both the primary list and the degraded fallback', () => {
    expect(src.match(/\.\.\.metroPages,/g)?.length).toBe(2);
  });
});
