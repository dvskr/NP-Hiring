/**
 * Regression guards for job-page schema/URL/metadata fixes (B29, B31, B32, B34, B35).
 *
 * B29 — JSON-LD serialization must escape </> so aggregator content
 *   containing "</script>" can never break out of the script element
 *   (schema corruption + XSS vector).
 *
 * B31 — the page mirrors middleware's expired predicate (unpublished OR
 *   date-expired); middleware-side pin lives in seo-sitemaps-middleware.test.ts.
 *
 * B32 — /data-request and /do-not-sell must ship real metadata (the pages
 *   are client components, so it lives in their layouts).
 *
 * B34 — one canonical URL form per job across metadata, JSON-LD,
 *   BreadcrumbSchema, and ShareButtons.
 *
 * B35 — robots.txt blocks /employer/analytics like every sibling surface.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const ESCAPE_PATTERN = ".replace(/</g, '\\\\u003c')";

describe('B29 — JSON-LD emitters escape aggregator content', () => {
  it.each([
    'components/JobStructuredData.tsx',
    'components/BreadcrumbSchema.tsx',
    'components/Breadcrumbs.tsx',
  ])('%s escapes < in its serialized schema', (rel) => {
    const src = read(rel);
    expect(src).toContain(ESCAPE_PATTERN);
    // No remaining unescaped one-liner serialization into the script tag.
    expect(src).not.toMatch(/__html:\s*JSON\.stringify\([^)]*\)\s*\}\}/);
  });
});

describe('B31 — page mirrors the middleware expired predicate', () => {
  const page = read('app/jobs/[slug]/page.tsx');

  it('getJob selects expiresAt and classifies date-expired jobs as expired', () => {
    expect(page).toMatch(/select: \{ id: true, isPublished: true, expiresAt: true/);
    expect(page).toMatch(/anyJob\.expiresAt\.getTime\(\) < Date\.now\(\)/);
    expect(page).toMatch(/if \(!anyJob\.isPublished \|\| dateExpired\)/);
  });
});

describe('B32 — privacy pages ship title/description/canonical', () => {
  it.each([
    ['app/data-request/layout.tsx', '/data-request'],
    ['app/do-not-sell/layout.tsx', '/do-not-sell'],
  ])('%s exports metadata with a canonical for %s', (rel, route) => {
    const src = read(rel);
    expect(src).toContain('export const metadata');
    expect(src).toContain('title:');
    expect(src).toContain('description:');
    expect(src).toContain(`\${brand.baseUrl}${route}`);
  });
});

describe('B34 — one canonical URL form per job page', () => {
  const page = read('app/jobs/[slug]/page.tsx');

  it('page body derives a single canonicalJobUrl from the stored slug', () => {
    expect(page).toContain(
      'const canonicalJobUrl = `${brand.baseUrl}/jobs/${job.slug || slugify(job.title, job.id)}`'
    );
  });

  it('ShareButtons no longer re-slugify the title into a divergent URL', () => {
    expect(page).not.toMatch(/ShareButtons[\s\S]{0,80}slugify\(job\.title/);
    expect(page.match(/url=\{canonicalJobUrl\}/g)?.length).toBe(2);
  });

  it('BreadcrumbSchema no longer falls back to the bare-id URL form', () => {
    expect(page).not.toContain('/jobs/${job.slug || job.id}`');
    expect(page).toMatch(/name: job\.title, url: canonicalJobUrl/);
  });
});

describe('B35 — robots blocks /employer/analytics like its siblings', () => {
  const robots = read('app/robots.ts');

  it('appears in FULL_DISALLOW, SOCIAL_DISALLOW, and the ClaudeBot rule', () => {
    const occurrences = robots.match(/'\/employer\/analytics',/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(3);
  });
});
