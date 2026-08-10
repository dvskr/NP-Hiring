/**
 * P6 sitemap-parity (completeness holes #1 + #12): the sitemap index,
 * the cities batch route, and lib/gsc-coverage.ts must all derive their
 * category allow-list from the SAME taxonomy-registry export.
 *
 * Background (hole #1): app/api/sitemaps/index/route.ts imported the
 * 28-slug STATE_ELIGIBLE_CATEGORY_SLUGS while cities/[batch]/route.ts
 * emitted against all 45 CITY_ELIGIBLE_CATEGORY_SLUGS. The index
 * therefore undercounted URLs → undercounted batches → tail batches
 * (carrying the setting×state URLs appended last) existed but were never
 * listed in the index, so their URLs were never submitted to Google.
 * lib/gsc-coverage.ts carried the same stale set, so the admin coverage
 * panel misreported 17 categories as sitemap-ineligible.
 *
 * B37 (tests/regressions/pseo-consistency-integrity.test.ts) pins only
 * the batch side; this suite pins the index + coverage mirrors and the
 * import parity itself, plus the batch route's header-comment counts
 * (hole #12: it said "42 slugs / 21 state-eligible" while the registry
 * is 45/28).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  ALL_CATEGORY_SLUGS,
  CITY_ELIGIBLE_CATEGORY_SLUGS,
  STATE_ELIGIBLE_CATEGORY_SLUGS,
} from '@/lib/pseo/taxonomy-registry';

const INDEX_ROUTE = 'app/api/sitemaps/index/route.ts';
const BATCH_ROUTE = 'app/api/sitemaps/cities/[batch]/route.ts';
const COVERAGE_LIB = 'lib/gsc-coverage.ts';

const read = (rel: string): string =>
  fs.readFileSync(path.join(process.cwd(), ...rel.split('/')), 'utf-8');

/** The category-set specifier a file imports from the taxonomy registry. */
function registryCategoryImport(source: string, file: string): string {
  const match = source.match(
    /import \{ ([A-Z_]+_CATEGORY_SLUGS) \} from '@\/lib\/pseo\/taxonomy-registry'/,
  );
  expect(
    match,
    `${file} must import a *_CATEGORY_SLUGS set from '@/lib/pseo/taxonomy-registry'`,
  ).not.toBeNull();
  return match![1];
}

describe('hole #1 — index and batch route derive from the SAME registry import', () => {
  const indexSrc = read(INDEX_ROUTE);
  const batchSrc = read(BATCH_ROUTE);

  it('both routes import the identical category-set export', () => {
    expect(registryCategoryImport(indexSrc, INDEX_ROUTE)).toBe(
      registryCategoryImport(batchSrc, BATCH_ROUTE),
    );
  });

  it('that shared export is the CITY-eligible set, not the state-eligible subset', () => {
    expect(registryCategoryImport(indexSrc, INDEX_ROUTE)).toBe(
      'CITY_ELIGIBLE_CATEGORY_SLUGS',
    );
    expect(indexSrc).not.toContain('STATE_ELIGIBLE_CATEGORY_SLUGS');
  });

  it('the index DB filter and its fallback estimate both use the shared set', () => {
    // DB path: the allow-list the pseoStats rows are checked against.
    expect(indexSrc).toContain('new Set(CITY_ELIGIBLE_CATEGORY_SLUGS)');
    // Catch path: the conservative estimate must size against the same set,
    // or a DB outage recreates the undercount.
    expect(indexSrc).toContain('CITY_ELIGIBLE_CATEGORY_SLUGS.length');
  });
});

describe('hole #1 — gsc-coverage mirrors the sitemap allow-list', () => {
  const covSrc = read(COVERAGE_LIB);

  it('imports the same CITY-eligible export as both sitemap routes', () => {
    expect(registryCategoryImport(covSrc, COVERAGE_LIB)).toBe(
      'CITY_ELIGIBLE_CATEGORY_SLUGS',
    );
    expect(covSrc).not.toContain('STATE_ELIGIBLE_CATEGORY_SLUGS');
  });
});

describe('registry invariant — the emitting set can never exceed the counting set', () => {
  it('CITY-eligible is the full slug set and a superset of state-eligible', () => {
    // Both routes import CITY_ELIGIBLE_CATEGORY_SLUGS (asserted above), so
    // index-vs-batch parity reduces to this registry-side invariant: the
    // batch route can never emit a category slug the index does not count.
    expect(new Set(CITY_ELIGIBLE_CATEGORY_SLUGS)).toEqual(new Set(ALL_CATEGORY_SLUGS));
    const citySet = new Set(CITY_ELIGIBLE_CATEGORY_SLUGS);
    for (const slug of STATE_ELIGIBLE_CATEGORY_SLUGS) {
      expect(citySet.has(slug), `state-eligible slug ${slug} must be city-eligible`).toBe(true);
    }
  });
});

describe('hole #12 — batch route header comment tracks the live registry counts', () => {
  const batchSrc = read(BATCH_ROUTE);

  it('quotes the real CITY-eligible and state-eligible sizes', () => {
    // Derived from the registry, not hardcoded: if the taxonomy grows, this
    // fails until the comment is updated alongside it.
    expect(batchSrc).toContain(`all ${CITY_ELIGIBLE_CATEGORY_SLUGS.length} slugs`);
    expect(batchSrc).toContain(`${STATE_ELIGIBLE_CATEGORY_SLUGS.length} state-eligible`);
  });

  it('the stale 42/21 counts never come back', () => {
    expect(batchSrc).not.toContain('42 slugs');
    expect(batchSrc).not.toContain('21 state-eligible');
    expect(batchSrc).not.toContain('21-slug');
  });
});
