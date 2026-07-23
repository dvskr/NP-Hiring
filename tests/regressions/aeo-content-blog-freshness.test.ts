/**
 * Regression guards — citation-trust sweep B45 + B53 + B54 (aeo-content).
 *
 * B45: the blog template carried donor-board dead code — a HowTo + FAQ
 * schema branch keyed to the donor's license-guide slug pattern
 * (slug.match on 'how-to-get-your-pmhnp-license-in-<state>-2026'),
 * which can never match this board's 'np-license-<state>' series (see
 * LICENSE_GUIDE_SLUG_PREFIX), plus a hardcoded FAQ map keyed to three
 * donor slugs whose answers quoted fabricated donor-era stats. The
 * series is unpublished (LICENSE_GUIDE_SERIES_PUBLISHED=false), so the
 * branch was removed; FAQ schema now comes only from post.faq_json.
 *
 * B54: the template fabricated freshness — the current year was
 * auto-appended to every metadata title and an always-current
 * "Updated {year}" badge rendered on every post. Both now use real
 * content dates (reviewed_at/updated_at) or nothing.
 *
 * B53: no author data exists in the blog source (BlogPost has no author
 * columns), so authorship stays Organization-level with no fabricated
 * Person or reviewer credentials (YMYL manual-action risk).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const blogSrc = fs.readFileSync(
    path.join(ROOT, 'app', 'blog', '[slug]', 'page.tsx'),
    'utf8'
);

describe('B45 — donor license-guide schema branch removed', () => {
    it('no slug.match against the donor license-guide pattern', () => {
        expect(blogSrc).not.toMatch(/slug\.match\(\/\^how-to-get-your/);
    });

    it('no HowTo schema remains in the template', () => {
        expect(blogSrc).not.toContain("'@type': 'HowTo'");
        expect(blogSrc).not.toContain('HowToStep');
    });

    it('no hardcoded donor-slug FAQ map remains', () => {
        expect(blogSrc).not.toMatch(/const blogFaqData/);
        expect(blogSrc).not.toMatch(/blogFaqData\[/);
    });

    it('FAQ schema resolves exclusively from post.faq_json', () => {
        expect(blogSrc).toMatch(/const faqQuestions = \(post\.faq_json && post\.faq_json\.length > 0\)\s*\?\s*post\.faq_json\s*:\s*null/);
    });

    it('the live license-guide detection still uses the board pattern', () => {
        expect(blogSrc).toContain('LICENSE_GUIDE_SLUG_REGEX');
    });
});

describe('B54 — no fabricated freshness signals', () => {
    it('metadata title is the post title — no auto-appended year', () => {
        expect(blogSrc).not.toContain('new Date().getFullYear()');
    });

    it('schema dateModified uses real editorial dates, never render time', () => {
        expect(blogSrc).toContain('dateModified: post.reviewed_at || post.updated_at');
        expect(blogSrc).not.toMatch(/dateModified:\s*new Date\(\)/);
    });

    it('the author-card badge shows a real date or nothing', () => {
        expect(blogSrc).toMatch(/Updated \{formatDate\(post\.reviewed_at \|\| post\.updated_at\)\}/);
    });
});

describe('B53 — Organization authorship without fabricated credentials', () => {
    it('BlogPosting author is the Organization', () => {
        expect(blogSrc).toMatch(/author:\s*\{\s*'@type':\s*'Organization'/);
    });

    it('no fabricated Person author or reviewedBy is emitted', () => {
        // `reviewedBy:` as an emitted schema key (the word appears in an
        // explanatory comment about why it must NOT be emitted).
        expect(blogSrc).not.toMatch(/reviewedBy:/);
        expect(blogSrc).not.toContain("'@type': 'Person'");
    });

    it('the blog source has no author columns to build a Person from (decision basis)', () => {
        const blogLib = fs.readFileSync(path.join(ROOT, 'lib', 'blog.ts'), 'utf8');
        const iface = blogLib.match(/export interface BlogPost \{[\s\S]*?\n\}/)?.[0] ?? '';
        expect(iface).not.toMatch(/author/i);
    });
});
