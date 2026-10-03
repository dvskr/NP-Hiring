/**
 * P5 A2 — vs-competitor comparison pages: route/renderer drift-proofing.
 *
 * Static source checks (same style as the dead-code/orphan-route suites):
 *
 *   1. Every profile slug in lib/compare-data.ts has a physical
 *      app/compare/<slug>/page.tsx — the hub links derive from the same
 *      array, so this is what stops the hub advertising a 404.
 *   2. Reverse direction: every route folder under app/compare corresponds
 *      to a configured profile (no orphan comparison routes).
 *   3. The route files stay thin: they render the shared body from the
 *      shared data (single source — pages cannot drift from each other),
 *      read the profile per render and re-render hourly, because our price
 *      statements follow the launch-promo clock (backlog 2.1).
 *   4. The shared renderer keeps the trust invariants: escaped JSON-LD,
 *      nofollow on competitor links, the trademark/no-affiliation notice,
 *      the corrections contact, the review-date label, and NO images
 *      (competitor logos are deliberately never rendered — text names only).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { COMPETITOR_SLUGS } from '@/lib/compare-data';

const ROOT = path.resolve(__dirname, '../..');
const COMPARE_DIR = path.join(ROOT, 'app', 'compare');
const SHARED = path.join(COMPARE_DIR, 'comparison-shared.tsx');
const HUB = path.join(COMPARE_DIR, 'page.tsx');

const read = (p: string): string => fs.readFileSync(p, 'utf-8');

describe('compare routes: registry <-> filesystem drift', () => {
    it('every configured profile has a physical route folder with a page.tsx', () => {
        for (const slug of COMPETITOR_SLUGS) {
            const pagePath = path.join(COMPARE_DIR, slug, 'page.tsx');
            expect(fs.existsSync(pagePath), `missing route for slug "${slug}"`).toBe(true);
        }
    });

    it('every route folder under app/compare is a configured profile slug', () => {
        const slugs = new Set<string>(COMPETITOR_SLUGS);
        const folders = fs
            .readdirSync(COMPARE_DIR, { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => e.name);
        for (const folder of folders) {
            expect(slugs.has(folder), `orphan comparison route: app/compare/${folder}`).toBe(true);
        }
    });

    it('each route file is a thin wrapper over the shared data + renderer', () => {
        for (const slug of COMPETITOR_SLUGS) {
            const src = read(path.join(COMPARE_DIR, slug, 'page.tsx'));
            // The slug is typed, so a folder name that is not configured fails tsc.
            expect(src).toContain(`const SLUG: CompetitorSlug = '${slug}';`);
            expect(src).toContain('getCompetitorProfile');
            expect(src).toContain('buildCompareMetadata');
            expect(src).toContain('ComparisonPageBody');
            // Thin means thin: no page-local competitor copy blocks.
            expect(src.length).toBeLessThan(2000);
        }
    });

    it('each route reads its profile per render and re-renders hourly (launch-promo clock)', () => {
        for (const slug of COMPETITOR_SLUGS) {
            const src = read(path.join(COMPARE_DIR, slug, 'page.tsx'));
            expect(src, slug).toContain('export const revalidate = 3600;');
            // Metadata and body both read the profile at render time; static
            // metadata or a module-scope profile would be built once, at build.
            expect(src, slug).toContain('export async function generateMetadata()');
            expect(src, slug).not.toContain('export const metadata');
            expect(src.match(/getCompetitorProfile\(SLUG, new Date\(\)\)/g) ?? [], slug).toHaveLength(2);
            expect(src, slug).not.toMatch(/^const \w+ = getCompetitorProfile/m);
        }
    });
});

describe('compare shared renderer: trust invariants', () => {
    const src = read(SHARED);

    it('escapes JSON-LD with the repo convention (\\u003c)', () => {
        expect(src).toContain('\\\\u003c');
        expect(src).toContain("application/ld+json");
    });

    it('marks competitor links nofollow + noopener', () => {
        expect(src).toContain('rel="nofollow noopener noreferrer"');
    });

    it('carries the trademark / no-affiliation notice and corrections contact', () => {
        expect(src).toContain('trademarks of their respective owners');
        expect(src).toContain('not affiliated with');
        expect(src).toContain('brand.email.press');
    });

    it('renders the shared review-date label and the method footer', () => {
        expect(src).toContain('COMPARE_REVIEW_DATE_LABEL');
        expect(src).toContain('How we verified this page');
    });

    it('renders no images anywhere in the comparison surfaces (no logos)', () => {
        const surfaces = [
            src,
            read(HUB),
            ...COMPETITOR_SLUGS.map((slug) => read(path.join(COMPARE_DIR, slug, 'page.tsx'))),
        ];
        for (const fileSrc of surfaces) {
            expect(fileSrc).not.toMatch(/<img\b/i);
            expect(fileSrc).not.toContain("next/image");
        }
    });
});

describe('compare hub: single-source rendering', () => {
    const src = read(HUB);

    it('derives its cards and schema from the same profiles as the routes', () => {
        expect(src).toContain('const profiles = competitorProfiles(new Date());');
        expect(src).toContain('itemListElement: profiles.map(');
        expect(src).toContain('{profiles.map((profile) => (');
        // Card links are built from the array, not hand-typed hrefs — a
        // hand-typed href is exactly how a hub advertises a 404.
        expect(src).toContain('COMPARE_HUB_PATH}/${profile.slug}');
        for (const slug of COMPETITOR_SLUGS) {
            expect(src).not.toContain(`href="/compare/${slug}"`);
        }
    });

    it('has canonical metadata and the ground-rules section', () => {
        expect(src).toContain('alternates');
        expect(src).toContain('canonical');
        expect(src).toContain('How these comparisons work');
    });
});
