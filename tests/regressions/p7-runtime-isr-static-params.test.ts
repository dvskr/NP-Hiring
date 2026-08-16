/**
 * P7 runtime fix D3 (HIGH) — `revalidate` alone is NOT ISR on a dynamic
 * segment.
 *
 * Without a generateStaticParams export, Next renders a dynamic-segment page
 * fully dynamically on every request. Runtime-verified: /jobs/<uuid> and
 * /jobs/city/austin-tx returned `private, no-cache, no-store` with no
 * x-nextjs-cache on repeat hits and cost 0.5–5.6 s of DB work per hit —
 * while /salary-guide/alabama (which DOES export generateStaticParams)
 * served a real ISR HIT. Meanwhile middleware excludes job-detail URLs from
 * the crawler edge cache on the premise ISR covers them, so an un-ISR'd
 * job-detail route is the exact Googlebot-burst → DB-pool-exhaustion
 * scenario that exclusion was written to prevent.
 *
 * The fix: `export function generateStaticParams() { return [] }` on each
 * flagged detail route — prerenders nothing at build (no DB fan-out over
 * thousands of slugs) but flips the route to on-demand static generation:
 * first hit renders + caches, later hits serve the cache until `revalidate`
 * expires.
 *
 * Scope note: the ~75 generated /jobs/{category}/... pSEO pages also export
 * revalidate without generateStaticParams, but they are NOT excluded from the
 * middleware crawler edge cache (only job-detail URLs are), so crawler bursts
 * against them are already absorbed at the edge. The five routes below are
 * the runtime-flagged set.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const FLAGGED_DETAIL_ROUTES = [
    'app/jobs/[slug]/page.tsx',
    'app/blog/[slug]/page.tsx',
    'app/companies/[slug]/page.tsx',
    'app/jobs/city/[slug]/page.tsx',
    'app/jobs/locations/[state]/page.tsx',
] as const;

describe('D3 — detail routes export generateStaticParams so revalidate is real ISR', () => {
    for (const rel of FLAGGED_DETAIL_ROUTES) {
        describe(rel, () => {
            const src = read(rel);

            it('exports generateStaticParams', () => {
                expect(src).toMatch(/export\s+(async\s+)?function\s+generateStaticParams/);
            });

            it('keeps its revalidate export (the half generateStaticParams activates)', () => {
                expect(src).toMatch(/export const revalidate\s*=\s*3600/);
            });

            it('returns an empty array (no build-time DB fan-out over live slugs)', () => {
                // Match the body of the generateStaticParams function.
                const fn = src.match(
                    /export\s+(?:async\s+)?function\s+generateStaticParams[^{]*\{([\s\S]*?)\n\}/,
                );
                expect(fn).not.toBeNull();
                expect(fn![1]).toMatch(/return\s*\[\]/);
            });

            it('does not force dynamic rendering (would void the ISR it just gained)', () => {
                expect(src).not.toMatch(/export const dynamic\s*=\s*['"]force-dynamic['"]/);
                expect(src).not.toMatch(/export const dynamicParams\s*=\s*false/);
            });
        });
    }

    it('middleware still documents + keeps the job-detail crawler-cache exclusion this ISR justifies', () => {
        const mw = read('middleware.ts');
        expect(mw).toMatch(/isJobDetailUrl/);
        expect(mw).toMatch(/generateStaticParams/); // the premise is written down
    });
});
