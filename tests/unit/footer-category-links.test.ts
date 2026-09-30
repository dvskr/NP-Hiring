/**
 * The footer's category columns (indexing audit TECH-06, M-02, fixSoon 10):
 * every sitewide category link points at a landing the category-landing
 * index verdict admits, never an empty noindexed one.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
    FOOTER_CANDIDATE_SLUGS,
    FOOTER_FALLBACK_SLUGS,
    FOOTER_SETTING_LINKS,
    FOOTER_SPECIALTY_LINKS,
    selectFooterCategoryColumns,
} from '@/lib/pseo/footer-category-links';
import { ALL_CATEGORY_SLUGS } from '@/lib/pseo/taxonomy-registry';

const ROOT = process.cwd();
const hrefsOf = (columns: ReturnType<typeof selectFooterCategoryColumns>) =>
    columns.flatMap((column) => column.links.map((link) => link.href));

describe('selectFooterCategoryColumns', () => {
    it('links only the landings the verdict admits, in candidate order', () => {
        const columns = selectFooterCategoryColumns(new Set(['remote', 'part-time', 'pediatric', 'va']));
        expect(columns.map((c) => c.title)).toEqual(['Browse by Setting', 'Browse by Specialty']);
        expect(columns[0].links.map((l) => l.href)).toEqual(['/jobs/remote', '/jobs/part-time']);
        expect(columns[1].links.map((l) => l.href)).toEqual(['/jobs/pediatric', '/jobs/va']);
    });

    it('drops an empty landing and picks it back up once it passes the gate', () => {
        expect(hrefsOf(selectFooterCategoryColumns(new Set(['remote'])))).not.toContain('/jobs/veterans');
        expect(hrefsOf(selectFooterCategoryColumns(new Set(['remote', 'veterans'])))).toContain('/jobs/veterans');
    });

    it('an empty verdict set spends no category link', () => {
        expect(hrefsOf(selectFooterCategoryColumns(new Set()))).toEqual([]);
    });

    it('caps each column', () => {
        const columns = selectFooterCategoryColumns(new Set(FOOTER_CANDIDATE_SLUGS));
        expect(columns[0].links).toHaveLength(FOOTER_SETTING_LINKS);
        expect(columns[1].links).toHaveLength(FOOTER_SPECIALTY_LINKS);
    });

    it('M-02: the fallback never links VA, Veterans or Locum Tenens, and carries the replacements', () => {
        const hrefs = hrefsOf(selectFooterCategoryColumns(null));
        for (const empty of ['/jobs/va', '/jobs/veterans', '/jobs/locum-tenens']) expect(hrefs).not.toContain(empty);
        for (const added of ['psychiatric-mental-health', 'pediatric', 'urgent-care', 'part-time']) {
            expect(hrefs).toContain(`/jobs/${added}`);
            expect(FOOTER_FALLBACK_SLUGS.has(added)).toBe(true);
        }
    });

    it('every candidate is a taxonomy landing with a route', () => {
        for (const slug of FOOTER_CANDIDATE_SLUGS) {
            expect(ALL_CATEGORY_SLUGS, slug).toContain(slug);
            expect(fs.existsSync(path.join(ROOT, 'app', 'jobs', slug, 'page.tsx')), slug).toBe(true);
        }
    });
});

describe('the footer components', () => {
    it('the client footer carries no hardcoded category landing link any more', () => {
        const src = fs.readFileSync(path.join(ROOT, 'components/Footer.tsx'), 'utf8');
        for (const slug of FOOTER_CANDIDATE_SLUGS) expect(src, slug).not.toContain(`'/jobs/${slug}'`);
        expect(src).toContain('selectFooterCategoryColumns(null)');
    });

    it('the server footer passes the verdict-gated columns', () => {
        const src = fs.readFileSync(path.join(ROOT, 'components/SiteFooter.tsx'), 'utf8');
        expect(src).toContain('loadFooterIndexableLandings()');
        expect(src).toContain('<Footer categoryColumns={selectFooterCategoryColumns(indexable)} />');
    });

    /**
     * app/layout.tsx is outside this package; a handoff asks its owner to
     * render SiteFooter. Until it lands, every page renders the bare client
     * Footer, whose category columns come from the fixed fallback list, so a
     * fallback landing that falls below the index gate (for example
     * /jobs/telehealth under the strict fully remote predicate) stays linked
     * sitewide. This pin fails until the handoff lands.
     */
    it('app/layout.tsx renders the verdict-gated SiteFooter, not the bare client Footer', () => {
        const src = fs.readFileSync(path.join(ROOT, 'app/layout.tsx'), 'utf8');
        expect(src).toContain("import SiteFooter from '@/components/SiteFooter';");
        expect(src).toMatch(/<SiteFooter\s*\/>/);
        expect(src).not.toMatch(/<Footer\s*\/>/);
        expect(src).not.toContain("import Footer from '@/components/Footer';");
    });
});
