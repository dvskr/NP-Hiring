/**
 * P6 completeness hole #5 (nav-mesh) — the /compare cluster (hub + 3
 * vs-competitor pages) had ZERO human-navigable inbound links: no Header,
 * Footer, homepage, resources, press, or blog link anywhere. Reachable only
 * via sitemap or direct URL, violating the repo's own orphan rule documented
 * in app/sitemap.ts. Same orphan class as the earlier /for-programs and
 * /press fixes (tests/regressions/p0-seo-plumbing-footer-links.test.ts,
 * p2-trust-surfaces-accessibility-press.test.ts).
 *
 * These tests pin the fix:
 *   1. the sitewide Footer links the /compare hub (discovery path on every
 *      page);
 *   2. the /resources hub carries an in-content mention;
 *   3. both links use the exact COMPARE_HUB_PATH the cluster canonicalizes
 *      on (lib/compare-data.ts), and that path has a physical route — a
 *      renamed hub path fails here instead of shipping dead footer links.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { COMPARE_HUB_PATH } from '@/lib/compare-data';

const ROOT = process.cwd();
const FOOTER = fs.readFileSync(path.join(ROOT, 'components/Footer.tsx'), 'utf8');
const RESOURCES = fs.readFileSync(path.join(ROOT, 'app/resources/page.tsx'), 'utf8');

/** String-literal hrefs in a source file (object-literal + JSX forms). */
const extractHrefs = (src: string): string[] => {
    const hrefs: string[] = [];
    for (const m of src.matchAll(/href:\s*'([^']+)'/g)) hrefs.push(m[1]);
    for (const m of src.matchAll(/href="([^"]+)"/g)) hrefs.push(m[1]);
    return hrefs;
};

describe('P6 #5 — /compare cluster has human-navigable inbound links', () => {
    it('the sitewide Footer links the /compare hub', () => {
        expect(extractHrefs(FOOTER)).toContain(COMPARE_HUB_PATH);
    });

    it('the /resources hub links the /compare hub', () => {
        expect(extractHrefs(RESOURCES)).toContain(COMPARE_HUB_PATH);
    });

    it('the linked hub path resolves to a physical route', () => {
        // COMPARE_HUB_PATH is '/<segment>' — map it onto app/<segment>/page.tsx.
        const routeDir = COMPARE_HUB_PATH.replace(/^\//, '').split('/');
        const pagePath = path.join(ROOT, 'app', ...routeDir, 'page.tsx');
        expect(
            fs.existsSync(pagePath),
            `COMPARE_HUB_PATH ("${COMPARE_HUB_PATH}") has no page at ${pagePath}`,
        ).toBe(true);
    });

    it('the inbound links never hand-type a path that drifts from COMPARE_HUB_PATH', () => {
        // Any href starting with /compare must BE the hub path (deep links to
        // vs-competitor pages belong on the hub, which derives them from
        // COMPETITOR_PROFILES — a hand-typed deep link is how nav ships 404s).
        for (const src of [FOOTER, RESOURCES]) {
            const compareHrefs = extractHrefs(src).filter((h) => h.startsWith('/compare'));
            expect(compareHrefs.length).toBeGreaterThan(0);
            for (const href of compareHrefs) {
                expect(href).toBe(COMPARE_HUB_PATH);
            }
        }
    });
});
