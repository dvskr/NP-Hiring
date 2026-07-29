/**
 * P1 #8 — E-E-A-T infrastructure without fabricated people.
 *
 * Pins:
 *   1. brand.editorial.reviewer DEFAULTS TO NULL — no invented reviewer
 *      ships until a real credentialed clinician is contracted.
 *   2. editorialSchemaFields() emits nothing while the reviewer config is
 *      null, and a schema.org Person derived from the SAME config object
 *      when populated (schema can never disagree with the visible byline).
 *   3. /editorial-policy exists, cites stats exclusively through
 *      lib/stats-sources.ts (no hardcoded figures), branches its review
 *      status on the reviewer config, and ships a canonical.
 *   4. app/blog/[slug]/page.tsx renders the byline (hero + author card —
 *      both the license-guide and generic branches flow through these
 *      shared blocks), spreads editorialSchemaFields() into the
 *      BlogPosting JSON-LD, and escapes its serialized schema.
 *   5. The byline component itself reads brand.editorial.reviewer and
 *      links the editorial policy — it never hardcodes a person.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { brand, type EditorialReviewer } from '@/config/brand';
import { editorialSchemaFields, reviewerDisplayName } from '@/components/EditorialByline';

const ROOT = process.cwd();
const read = (rel: string): string =>
    fs.readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * Collapse JSX indentation/newlines so prose assertions match the sentence
 * a reader actually sees. Without this, a claim is "absent" purely because
 * Prettier wrapped it across two lines — which would let a false claim slip
 * back in under a differently-wrapped phrasing.
 */
const prose = (src: string): string => src.replace(/\s+/g, ' ');

const SAMPLE_REVIEWER: EditorialReviewer = {
    name: 'Test Reviewer',
    credentials: 'DNP, APRN, FNP-BC',
    title: 'Clinical Reviewer',
    profileUrl: 'https://example.com/reviewer',
    npi: '1234567890',
};

describe('P1 #8 — reviewer config defaults', () => {
    it('brand.editorial.reviewer defaults to null (no fabricated person)', () => {
        expect(brand.editorial.reviewer).toBeNull();
    });

    it('policyPath points at /editorial-policy', () => {
        expect(brand.editorial.policyPath).toBe('/editorial-policy');
    });
});

describe('P1 #8 — editorialSchemaFields()', () => {
    it('emits nothing while the reviewer config is null (Organization-only schema)', () => {
        // Default argument reads brand.editorial.reviewer, which is null.
        expect(editorialSchemaFields()).toEqual({});
        expect(editorialSchemaFields(null)).toEqual({});
    });

    it('emits a Person derived from the reviewer object when populated', () => {
        const fields = editorialSchemaFields(SAMPLE_REVIEWER) as {
            reviewedBy?: Record<string, unknown>;
        };
        expect(fields.reviewedBy).toBeDefined();
        expect(fields.reviewedBy).toMatchObject({
            '@type': 'Person',
            name: SAMPLE_REVIEWER.name,
            honorificSuffix: SAMPLE_REVIEWER.credentials,
            jobTitle: SAMPLE_REVIEWER.title,
            url: SAMPLE_REVIEWER.profileUrl,
            identifier: {
                '@type': 'PropertyValue',
                propertyID: 'NPI',
                value: SAMPLE_REVIEWER.npi,
            },
        });
    });

    it('omits optional fields that are not provided (nothing invented)', () => {
        const fields = editorialSchemaFields({
            name: 'Test Reviewer',
            credentials: 'DNP',
        }) as { reviewedBy: Record<string, unknown> };
        expect(fields.reviewedBy).not.toHaveProperty('jobTitle');
        expect(fields.reviewedBy).not.toHaveProperty('url');
        expect(fields.reviewedBy).not.toHaveProperty('identifier');
    });

    it('reviewerDisplayName joins name and credentials', () => {
        expect(reviewerDisplayName(SAMPLE_REVIEWER)).toBe(
            'Test Reviewer, DNP, APRN, FNP-BC',
        );
    });
});

describe('P1 #8 — EditorialByline component source', () => {
    const src = read('components/EditorialByline.tsx');

    it('reads the reviewer from brand.editorial.reviewer (no hardcoded person)', () => {
        expect(src).toContain('brand.editorial.reviewer');
    });

    it('null-reviewer fallback credits the editorial team and links the policy', () => {
        expect(src).toContain('editorial team');
        expect(src).toContain('brand.editorial.policyPath');
    });

    it('has a generated-content branch that claims no human review', () => {
        // The 51-state license guide series is emitted from repo data and no
        // human read it. Claiming "Reviewed by the ... editorial team" on
        // those pages is a false statement about our own process.
        expect(src).toContain('generated');
        expect(src).toContain('not individually');
        expect(src).toMatch(/not individually\s*\n?\s*written or clinically reviewed/);
    });

    it('never asserts review of generated pages', () => {
        // REGRESSION GUARD: the old copy read "Reviewed by the {brand}
        // editorial team" for EVERY null-reviewer post, license guides
        // included. The non-generated branch now claims authorship, not
        // review, and the generated branch disclaims both.
        expect(src).not.toContain('Reviewed by the {brand.name} editorial team');
        expect(src).toContain('Written and maintained by the {brand.name} editorial team');
    });
});

describe('P1 #8 — /editorial-policy page', () => {
    const src = read('app/editorial-policy/page.tsx');
    const text = prose(src);

    it('exists with a canonical and indexable metadata', () => {
        expect(src).toContain('export const metadata');
        expect(src).toContain('${brand.baseUrl}/editorial-policy');
        expect(src).toContain('index: true');
    });

    it('cites statistics exclusively through lib/stats-sources.ts', () => {
        expect(src).toMatch(/from '@\/lib\/stats-sources'/);
        expect(src).toContain('STAT_SOURCES');
        // No hardcoded figures — every number renders from the source file.
        expect(src).not.toMatch(/129,?210/);
        expect(src).not.toContain('90 million');
        expect(src).not.toMatch(/\b45%/);
        expect(src).not.toMatch(/\b27 states/);
    });

    it('review status branches on the reviewer config (honest pending state)', () => {
        expect(src).toContain('brand.editorial.reviewer');
        expect(src).toContain('not yet been clinically reviewed');
    });

    it('scopes the licensure-detail promise to the generated guide series', () => {
        // The license guide series genuinely never quotes fees / CE hours /
        // renewal cycles / processing times (see the truth-rules docblock in
        // lib/blog-license-guides.ts) and answers each with a board link.
        // The promise is pinned to THAT series, not to the whole site.
        expect(text).toContain('state license guide series never quotes them');
        expect(text).toContain('board of nursing');
    });

    it('does NOT claim site-wide that licensure figures are never stated as fact', () => {
        // REGRESSION GUARD. components/LicensureChecker.tsx (rendered on
        // /resources) hardcodes a Key Costs block — exam $315-$395, DEA
        // $888/3 years, renewal every 2-3 years, CE 25-50 hours/cycle — and
        // every lib/metro-data.ts licensureNote asserts a board processing
        // window. A site-wide "never stated as fact" claim here is therefore
        // falsifiable by the site's own live pages. Neither file is owned by
        // this package, so the POLICY PAGE must stay accurate about them.
        expect(text).not.toContain('never stated as fact on our pages');
        expect(text).not.toContain('are never stated as fact');
    });

    it('discloses the licensure-checker and metro estimate figures', () => {
        // Those surfaces DO show cost ranges and processing windows. The
        // policy page names them rather than pretending they do not exist.
        expect(text).toContain('licensure checker');
        expect(text).toContain('metro market pages');
        expect(text).toContain('orientation figures');
    });

    it('does NOT promise that every statistic on the site carries a source and date', () => {
        // REGRESSION GUARD. lib/metro-data.ts avgCostOfLiving ('37% above US
        // average') renders unsourced on the metro pages, and the licensure
        // checker's dollar figures carry no source or as-of date. The promise
        // is scoped to the headline stats that flow through
        // lib/stats-sources.ts — which is exactly what the table renders.
        expect(text).not.toContain('Every statistic we publish');
        expect(text).toContain('The headline statistics we publish');
    });

    it('describes the license guide series as generated, not hand-written', () => {
        // 51 guides are emitted from repo data by lib/blog-license-guides.ts
        // and LICENSE_GUIDE_SERIES_PUBLISHED is true, so they are live. The
        // policy page must not imply a human wrote each one.
        expect(text).toContain('generated programmatically');
        expect(text).toContain('generated-content byline');
    });

    it('correction contact derives from brand config', () => {
        expect(src).toContain('brand.email.contact');
    });
});

describe('P1 #8 — blog template wiring', () => {
    const src = read('app/blog/[slug]/page.tsx');

    it('renders the visible byline in the hero and the author card', () => {
        const matches = src.match(/<EditorialByline/g) ?? [];
        expect(matches.length).toBeGreaterThanOrEqual(2);
    });

    it('passes the generated flag on EVERY byline it renders', () => {
        // Both byline sites must mark license-guide posts as generated —
        // a byline that claims review in the hero and disclaims it in the
        // author card (or vice versa) is worse than either alone.
        const sites = src.match(/<EditorialByline[^/]*\/>/g) ?? [];
        expect(sites.length).toBeGreaterThanOrEqual(2);
        for (const site of sites) {
            expect(site).toContain('generated={Boolean(licenseSlugMatch)}');
        }
    });

    it('derives the generated flag from the license-guide slug regex', () => {
        expect(src).toContain('LICENSE_GUIDE_SLUG_REGEX');
        expect(src).toMatch(/licenseSlugMatch\s*=\s*slug\.match\(LICENSE_GUIDE_SLUG_REGEX\)/);
    });

    it('spreads editorialSchemaFields() into the BlogPosting JSON-LD', () => {
        expect(src).toContain('...editorialSchemaFields(),');
        expect(src).toMatch(/from '@\/components\/EditorialByline'/);
    });

    it('keeps Organization authorship inline (no fabricated Person in this file)', () => {
        expect(src).toMatch(/author:\s*\{\s*'@type':\s*'Organization'/);
        expect(src).not.toContain("'@type': 'Person'");
    });

    it('escapes serialized JSON-LD with the repo chain', () => {
        // The page source spells the escape as '\\u003c' (escaped backslash
        // in its raw bytes), so the expectation doubles it again here.
        expect(src).toContain(".replace(/</g, '\\\\u003c')");
        // All four schema scripts route through the escaping serializer.
        expect(src).not.toMatch(/__html:\s*JSON\.stringify\(/);
    });

    it('links the editorial policy from the author card', () => {
        expect(src).toContain('href="/editorial-policy"');
    });
});
