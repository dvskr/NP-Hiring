/**
 * P0 #17 — the "Featured badge" is promised on every employer post (Terms §7,
 * /pricing + /faq feature lists, /for-employers, post-job emails) but had been
 * retired from the listing card (contractual/chargeback risk). These static
 * guards pin the restoration so a future JobCard edit can't silently re-break
 * the promise while the selling surfaces still make it. Static-source style
 * follows tests/regressions/audit-coverage-static.test.ts (node env, no DOM).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('P0 #17 — Featured badge restored on the listing card', () => {
  it('JobCard gates the badge on employer posts or admin-featured rows', () => {
    const src = read('components/JobCard.tsx');
    // sourceType='employer' covers all employer posts (rows are created with
    // isFeatured:false today); job.isFeatured honors admin-featured listings.
    expect(src).toMatch(
      /showFeaturedBadge\s*=\s*job\.isFeatured\s*\|\|\s*job\.sourceType === 'employer'/
    );
  });

  it('JobCard renders the featured Badge variant in both grid and list views', () => {
    const src = read('components/JobCard.tsx');
    const renders = src.match(/variant="featured"/g) ?? [];
    expect(renders.length).toBeGreaterThanOrEqual(2);
    const gated = src.match(/\{showFeaturedBadge && \(/g) ?? [];
    expect(gated.length).toBeGreaterThanOrEqual(2);
  });

  it('the Badge component still ships the featured variant the card relies on', () => {
    const src = read('components/ui/Badge.tsx');
    expect(src).toMatch(/featured:\s*\{/);
  });

  it('Terms §7 still promises the Featured badge the card now delivers', () => {
    const src = read('app/terms/page.tsx');
    expect(src).toContain('Featured badge');
  });

  it('post-job preview package summary lists the Featured badge with the other sold features', () => {
    const src = read('app/post-job/preview/page.tsx');
    expect(src).toMatch(/packageDetails = `Featured badge · Top placement/);
    // The card preview renders the real <JobCard> as an employer post, so the
    // restored badge shows in preview exactly as candidates will see it.
    expect(src).toMatch(/sourceType:\s*'employer'/);
  });
});
