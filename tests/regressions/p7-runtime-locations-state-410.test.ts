/**
 * P7 runtime fix D2 (HIGH) — /jobs/locations/[state] must not be swallowed by
 * the category×state 410 gate.
 *
 * middleware.ts's "structurally invalid pSEO URL" gate treats
 * /jobs/{cat}/{x} as a category×state page and 410s unknown taxonomies.
 * 'locations' is a NAMESPACE segment (the per-state city directory,
 * app/jobs/locations/[state]/page.tsx), not a taxonomy — but it was missing
 * from the gate's exclusion list, so all 51 state directories returned
 * 410 Gone + noindex while the live /jobs/locations hub linked straight to
 * them (runtime-verified on TX/CA/NY/IL/PA).
 *
 * Drift-proof guard: the exclusion list is asserted against
 * JOBS_NAMESPACE_SEGMENTS in lib/pseo/taxonomy-registry.ts — the registry the
 * middleware's own header comment points at — so adding a namespace segment
 * without excluding it here fails the suite.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { JOBS_NAMESPACE_SEGMENTS } from '@/lib/pseo/taxonomy-registry';

const ROOT = process.cwd();
const mw = fs.readFileSync(path.join(ROOT, 'middleware.ts'), 'utf8');

describe('D2 — category×state 410 gate excludes every /jobs/ namespace segment', () => {
    // The gate's guard condition: segs.length === 3 && segs[1] !== '...' && ...
    const gateLine = mw
        .split('\n')
        .find((l) => l.includes('segs.length === 3') && l.includes("segs[1] !== 'city'"));

    it('the gate condition line exists (gate not silently restructured)', () => {
        expect(gateLine).toBeDefined();
    });

    it("explicitly skips 'locations' (the per-state city directory)", () => {
        expect(gateLine).toContain("segs[1] !== 'locations'");
    });

    it('skips every namespace segment from the registry', () => {
        // 'state' never reaches the else-if (its own branch handles it above);
        // every other namespace segment must be excluded on the gate line.
        for (const seg of JOBS_NAMESPACE_SEGMENTS) {
            if (seg === 'state') {
                expect(mw).toContain("segs[1] === 'state'");
                continue;
            }
            expect(gateLine).toContain(`segs[1] !== '${seg}'`);
        }
    });

    it('registry still declares locations as a namespace segment (test premise)', () => {
        expect(JOBS_NAMESPACE_SEGMENTS).toContain('locations');
    });

    it('the state directory page the gate was blocking still exists and 404-gates itself', () => {
        const page = fs.readFileSync(
            path.join(ROOT, 'app/jobs/locations/[state]/page.tsx'),
            'utf8',
        );
        // Thin/empty directories stay a page-level notFound(), NOT a middleware
        // 410 — that is the documented split this fix restores.
        expect(page).toContain('shouldRenderStateCityDirectory');
        expect(page).toContain('notFound()');
    });
});
