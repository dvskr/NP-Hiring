/**
 * P7 runtime fix D5 (MEDIUM) — the catch-all 404 must stay force-dynamic.
 *
 * app/[...catchall]/page.tsx exists only to call notFound() so unmatched URLs
 * reach the branded app/not-found.tsx. Under `next start` the segment's
 * prerendered/static output interacted badly with the not-found boundary:
 * the FIRST hit to an unmatched URL rendered the bare
 * `<html id="__next_error__">` shell (title but zero H1, no site chrome, no
 * recovery UI) and REPEAT hits returned 0-byte bodies — reproduced across 4
 * different URLs. Routes that call notFound() during a dynamic render
 * (e.g. /testimonials pre-approval) reached the branded 404 correctly, so
 * the fix opts the catch-all into the same dynamic path with
 * `export const dynamic = 'force-dynamic'`. Nothing here is worth caching —
 * the route only 404s.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('D5 — catch-all 404 renders through the dynamic not-found path', () => {
    const catchall = read('app/[...catchall]/page.tsx');

    it("exports dynamic = 'force-dynamic' (load-bearing, see file comment)", () => {
        expect(catchall).toMatch(/export const dynamic\s*=\s*'force-dynamic'/);
    });

    it('still delegates to the not-found boundary via notFound()', () => {
        expect(catchall).toMatch(/from 'next\/navigation'/);
        expect(catchall).toMatch(/notFound\(\)/);
    });

    it('does not accidentally re-enable static output (no revalidate/generateStaticParams)', () => {
        expect(catchall).not.toMatch(/export const revalidate/);
        expect(catchall).not.toMatch(/generateStaticParams/);
    });

    it('the branded app/not-found.tsx it delegates to still exists with real recovery UI', () => {
        const notFound = read('app/not-found.tsx');
        // The runtime defect was the bare __next_error__ shell: no H1, no
        // links. Pin the branded page's essentials so the delegation target
        // stays a real page.
        expect(notFound).toMatch(/<h1/i);
        expect(notFound).toMatch(/href=/);
    });
});
