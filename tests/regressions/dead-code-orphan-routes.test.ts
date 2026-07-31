/**
 * Static regression guards for the dead-code backlog items covering orphaned
 * API surfaces (B15, B18, B23, B24). The routes below were deleted after a
 * zero-consumer audit; these pins keep them deleted and keep the surviving
 * write paths live. Each test reads the real source so a future edit can't
 * silently revert the cleanup.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));

/** Collect runtime source files (app/components/lib + extension src). */
function collectRuntimeSources(): string[] {
  const acc: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) acc.push(full);
    }
  };
  for (const d of ['app', 'components', 'lib', 'pmhnp-autofill-extension/src']) {
    const abs = path.join(ROOT, d);
    if (fs.existsSync(abs)) walk(abs);
  }
  return acc;
}

/** Files whose source contains a quoted reference to the given endpoint. */
function referencesEndpoint(endpoint: string): string[] {
  const pattern = new RegExp(`['"\`]${endpoint.replace(/\//g, '\\/')}['"\`]`);
  return collectRuntimeSources().filter((f) =>
    pattern.test(fs.readFileSync(f, 'utf8')),
  );
}

describe('B18 — legacy /api/candidate-profile write endpoint stays deleted', () => {
  it('the route directory is gone', () => {
    expect(exists('app/api/candidate-profile/route.ts')).toBe(false);
    expect(exists('app/api/candidate-profile')).toBe(false);
  });

  it('no runtime code references /api/candidate-profile', () => {
    expect(referencesEndpoint('/api/candidate-profile')).toEqual([]);
  });

  it('the canonical profile pipeline (with embedding refresh) is still the write path', () => {
    const src = read('app/api/auth/profile/route.ts');
    expect(src).toMatch(/embedding\.refresh\.candidate/);
  });
});

describe('B23 — orphaned ops endpoints stay deleted', () => {
  it('/api/companies is gone', () => {
    // The real invariant is the absence of the orphaned COLLECTION endpoint,
    // not the absence of the directory. `app/api/companies/` was later
    // repopulated by an unrelated surface (the employer profile-claim
    // endpoint), so the directory-level proxy that used to sit here was
    // narrowed away. The full B23 invariant — collection route gone, nothing
    // referencing the bare `/api/companies` path, and an enumeration of every
    // route that does live under that directory — is restated in
    // tests/regressions/p4-company-claim-surfaces.test.ts.
    expect(exists('app/api/companies/route.ts')).toBe(false);
  });

  it('/api/pseo/health is gone', () => {
    expect(exists('app/api/pseo/health/route.ts')).toBe(false);
    expect(exists('app/api/pseo/health')).toBe(false);
  });

  it('no runtime code references either endpoint', () => {
    expect(referencesEndpoint('/api/companies')).toEqual([]);
    expect(referencesEndpoint('/api/pseo/health')).toEqual([]);
  });
});

describe('B24 — /api/jobs/featured external API stays deleted', () => {
  it('the route directory is gone', () => {
    expect(exists('app/api/jobs/featured/route.ts')).toBe(false);
    expect(exists('app/api/jobs/featured')).toBe(false);
  });

  it('no runtime code references /api/jobs/featured', () => {
    expect(referencesEndpoint('/api/jobs/featured')).toEqual([]);
  });

  it('BLOG_API_KEY is not orphaned — the blog content API still consumes it', () => {
    // The env var stays in .env.example for app/api/blog, not for the
    // deleted featured-jobs API. If this consumer ever goes away too, the
    // env references should be removed with it.
    expect(read('app/api/blog/route.ts')).toContain('BLOG_API_KEY');
  });
});

describe('B15 — source-analytics orphaned aggregation stays deleted, live paths stay live', () => {
  it('lib/source-analytics.ts no longer defines updateDailyStats', () => {
    const src = read('lib/source-analytics.ts');
    expect(src).not.toMatch(/function updateDailyStats/);
    expect(src).not.toMatch(/export\s+(async\s+)?function\s+updateDailyStats/);
  });

  it('the sources endpoint no longer exposes the update-daily POST action', () => {
    // (The tombstone NOTE comment in the file mentions 'update-daily' by
    // name, so this pins the absence of the handler, not the string.)
    const src = read('app/api/analytics/sources/route.ts');
    expect(src).not.toMatch(/export\s+(async\s+)?function\s+POST/);
    expect(src).not.toMatch(/case\s+'update-daily'/);
  });

  it('both retained analytics GET endpoints stay admin-gated', () => {
    for (const rel of [
      'app/api/analytics/sources/route.ts',
      'app/api/analytics/clicks/route.ts',
    ]) {
      const src = read(rel);
      expect(src, `${rel} must reject non-admin viewers`).toMatch(
        /role\s*!==\s*'admin'/,
      );
      expect(src, `${rel} must return 403 for non-admins`).toMatch(/status:\s*403/);
    }
  });

  it('the live ingestion-stats write path is still wired', () => {
    const src = read('lib/ingestion-service.ts');
    expect(src).toMatch(/import\s*\{\s*recordIngestionStats\s*\}\s*from\s*'\.\/source-analytics'/);
    expect(src).toMatch(/recordIngestionStats\(/);
  });
});
