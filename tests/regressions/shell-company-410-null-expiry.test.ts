/**
 * Regression guard for V1 (shell package): the middleware company 410
 * gate must use the same "active job" expiry semantics as the sitemap
 * (lib/active-job-filter.ts activeIndexableJobWhere), which counts
 * `expiresAt IS NULL` as active.
 *
 * The old PostgREST filter (`expires_at=gt.{now}`) EXCLUDED null-expiry
 * rows, so a company whose active jobs all had null expiresAt was listed
 * in the sitemap yet served HTTP 410 + noindex by middleware — "Submitted
 * URL returns 410" on a live indexable page. Null expiry is currently
 * only reachable via the admin job path, but the predicates must never
 * diverge again.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('V1 — company 410 gate counts null-expiry jobs as active', () => {
  it('middleware company job-count query includes expires_at.is.null', () => {
    const mw = read('middleware.ts');
    expect(mw).toContain('or=(expires_at.is.null,expires_at.gt.');
    // The old exclusive predicate must not reappear on the company count.
    expect(mw).not.toMatch(/company_id=eq\.[^\n]*&expires_at=gt\./);
  });

  it('sitemap active-job predicate still treats null expiry as active (parity anchor)', () => {
    const filter = read('lib/active-job-filter.ts');
    expect(filter).toMatch(/\{\s*expiresAt:\s*null\s*\}/);
    expect(filter).toMatch(/\{\s*expiresAt:\s*\{\s*gt:\s*now\s*\}\s*\}/);
  });

  it('job-detail 410 gate also keeps null expiry alive (never date-expires null)', () => {
    const mw = read('middleware.ts');
    // dateExpired must require a non-null expires_at before comparing.
    expect(mw).toMatch(/!!row\?\.expires_at\s*&&/);
  });
});
