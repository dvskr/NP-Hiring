/**
 * P6 #10 — EditorialByline on the three /resources guides (content-fill).
 *
 * fpa-guide, 1099-vs-w2, and private-practice-guide carried Article
 * JSON-LD + review stamps but no E-E-A-T byline, while blog coverage was
 * complete and pinned (p1-eeat-editorial-trust.test.ts). Pins, mirroring
 * the blog-template wiring:
 *
 *   1. Each guide renders the visible <EditorialByline /> component (the
 *      one that reads brand.editorial.reviewer and never invents a person).
 *   2. Each guide spreads editorialSchemaFields() into its Article JSON-LD
 *      — {} while the reviewer config is null, the real reviewer's Person
 *      once contracted, so schema and visible byline can never disagree.
 *   3. Authorship stays Organization-only inline — no fabricated Person
 *      literal anywhere in these files.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const GUIDES = [
    'app/resources/fpa-guide/page.tsx',
    'app/resources/1099-vs-w2/page.tsx',
    'app/resources/private-practice-guide/page.tsx',
] as const;

describe.each(GUIDES)('P6 #10 — %s', (guide) => {
    const src = read(guide);

    it('imports the byline component and schema helper', () => {
        expect(src).toMatch(
            /import EditorialByline, \{ editorialSchemaFields \} from '@\/components\/EditorialByline'/,
        );
    });

    it('renders the visible byline', () => {
        expect(src).toContain('<EditorialByline');
        // These guides are hand-maintained editorial content, not the
        // generated license-guide series — they must NOT pass generated.
        const sites = src.match(/<EditorialByline[^/]*\/>/g) ?? [];
        expect(sites.length).toBeGreaterThanOrEqual(1);
        for (const site of sites) {
            expect(site).not.toContain('generated');
        }
    });

    it('spreads editorialSchemaFields() into the Article JSON-LD object', () => {
        const articleStart = src.indexOf("'@type': 'Article'");
        expect(articleStart).toBeGreaterThan(-1);
        // The spread must sit inside the Article schema object (its script
        // block ends within the following serializer call), not in the
        // FAQPage or HowTo blocks.
        const articleBlock = src.slice(articleStart, articleStart + 1500);
        expect(articleBlock).toContain('...editorialSchemaFields(),');
    });

    it('keeps Organization authorship — no fabricated Person literal', () => {
        expect(src).toMatch(/author:\s*\{\s*'@type':\s*'Organization'/);
        expect(src).not.toContain("'@type': 'Person'");
    });

    it('keeps the real review-date constants the byline sits beside', () => {
        // The byline complements the existing review stamp; it must not
        // replace it or introduce render-time freshness.
        expect(src).toContain('LAST_REVIEWED');
        expect(src).toContain('dateModified: LAST_REVIEWED');
    });
});
