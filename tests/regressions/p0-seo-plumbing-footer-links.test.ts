/**
 * Regression (content audit P0 #2 + #7, footer half) — the sitewide footer
 * linked three donor-board category slugs (behavioral-health,
 * substance-abuse, child-adolescent) that middleware serves as 410 Gone:
 * every page on the site footer-linked three dead URLs, burning crawl
 * budget and diluting internal-link equity. Separately, /for-programs had
 * ZERO inbound links anywhere in the UI (orphan page).
 *
 * These tests pin the fix:
 *  1. the three dead donor slugs never return to the footer;
 *  2. EVERY /jobs/<segment> footer link resolves against the drift-guarded
 *     taxonomy registry (lib/pseo/taxonomy-registry.ts) — the same source
 *     middleware uses to decide what 410s — so a future taxonomy change
 *     that orphans a footer link fails CI instead of shipping dead links;
 *  3. every linked category slug has a physical app/jobs/<slug>/page.tsx;
 *  4. the /for-programs discovery link exists.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
    ALL_CATEGORY_SLUGS,
    JOBS_NAMESPACE_SEGMENTS,
} from '@/lib/pseo/taxonomy-registry';
import {
    FOOTER_CANDIDATE_SLUGS,
    selectFooterCategoryColumns,
} from '@/lib/pseo/footer-category-links';

const ROOT = process.cwd();
// The category columns moved to lib/pseo/footer-category-links.ts (indexing
// audit TECH-06 / M-02: chosen by the landing index verdict); the rest of
// the footer is still literal in components/Footer.tsx.
const FOOTER = fs.readFileSync(path.join(ROOT, 'components/Footer.tsx'), 'utf8')
    + fs.readFileSync(path.join(ROOT, 'lib/pseo/footer-category-links.ts'), 'utf8');

/** All string-literal hrefs in the footer source (linkColumns + JSX). */
const extractHrefs = (src: string): string[] => {
    const hrefs: string[] = [];
    for (const m of src.matchAll(/href:\s*'([^']+)'/g)) hrefs.push(m[1]);
    for (const m of src.matchAll(/href="([^"]+)"/g)) hrefs.push(m[1]);
    return hrefs;
};

const jobsHrefs = [
    ...extractHrefs(FOOTER),
    // Every category link either column can ever carry.
    ...FOOTER_CANDIDATE_SLUGS.map((slug) => `/jobs/${slug}`),
].filter((h) => h === '/jobs' || h.startsWith('/jobs/'));

describe('P0 #2 — footer must not link 410\'d donor category slugs', () => {
    it.each(['behavioral-health', 'substance-abuse', 'child-adolescent'])(
        'dead donor slug "%s" is gone from the footer',
        (slug) => {
            expect(FOOTER).not.toContain(`/jobs/${slug}`);
        },
    );

    it('every /jobs footer link resolves against the taxonomy registry', () => {
        expect(jobsHrefs.length).toBeGreaterThan(0);
        const validTopSegments = new Set([
            ...ALL_CATEGORY_SLUGS,
            ...JOBS_NAMESPACE_SEGMENTS,
        ]);
        const dead = jobsHrefs.filter((href) => {
            if (href === '/jobs') return false; // the /jobs hub itself
            const segment = href.slice('/jobs/'.length).split('/')[0];
            return !validTopSegments.has(segment);
        });
        expect(
            dead,
            `Footer links /jobs segments unknown to lib/pseo/taxonomy-registry.ts (middleware 410s these): ${dead.join(', ')}`,
        ).toEqual([]);
    });

    it('every linked category slug has a physical app/jobs/<slug>/page.tsx', () => {
        const categorySet = new Set(ALL_CATEGORY_SLUGS);
        const linkedCategorySlugs = jobsHrefs
            .filter((h) => h !== '/jobs')
            .map((h) => h.slice('/jobs/'.length).split('/')[0])
            .filter((seg) => categorySet.has(seg));
        expect(linkedCategorySlugs.length).toBeGreaterThan(0);
        const missing = linkedCategorySlugs.filter(
            (slug) => !fs.existsSync(path.join(ROOT, 'app', 'jobs', slug, 'page.tsx')),
        );
        expect(
            missing,
            `Footer links category slugs with no route folder: ${missing.join(', ')}`,
        ).toEqual([]);
    });

    it('the replacement specialty hubs are present in the fallback columns', () => {
        const hrefs = selectFooterCategoryColumns(null).flatMap((column) => column.links.map((link) => link.href));
        for (const slug of ['family-practice', 'primary-care', 'acute-care']) {
            expect(hrefs).toContain(`/jobs/${slug}`);
        }
    });
});

describe('P0 #7 — /for-programs is footer-linked (orphan-page fix)', () => {
    it('footer contains a /for-programs link', () => {
        expect(FOOTER).toContain("href: '/for-programs'");
    });
});

/**
 * Backlog 2.10: /scope-of-practice is in the sitemap and, since audit CQ-13,
 * the one state-by-state practice reference, but no header or footer link
 * reached it. The footer carries it in the job-seeker column beside the
 * salary guide, with the page's own H1 as the anchor text.
 */
describe('Backlog 2.10 — /scope-of-practice is footer-linked', () => {
    /** One Footer.tsx column's literal link list, up to its closing bracket. */
    const footerColumn = (title: string): string => {
        const start = FOOTER.indexOf(`title: '${title}'`);
        expect(start, `footer column "${title}" not found`).toBeGreaterThan(-1);
        return FOOTER.slice(start, FOOTER.indexOf('],', start));
    };

    it('the For Job Seekers column links it', () => {
        expect(extractHrefs(footerColumn('For Job Seekers'))).toContain('/scope-of-practice');
    });

    it("the anchor text is the page's own H1, built from the same brand token", () => {
        const page = fs.readFileSync(path.join(ROOT, 'app/scope-of-practice/page.tsx'), 'utf8');
        const h1 = page.match(/<h1[^>]*>\s*([^<]+?)\s*<\/h1>/)?.[1];
        expect(h1).toBe('{brand.niche.short} Scope of Practice by State');
        expect(footerColumn('For Job Seekers')).toContain(
            "{ label: `${brand.niche.short} Scope of Practice by State`, href: '/scope-of-practice' }",
        );
    });
});
