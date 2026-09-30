/**
 * /editorial-policy describes the state license guide series as it renders
 * today (owner decision 4: lib/license-guide-facts.ts is filled, and guides
 * index only through isLicenseGuideIndexable).
 *
 * The page used to say the series "never quotes" fees, CE hours, renewal
 * cycles or processing times. The guides now print them in a cited licensing
 * facts section, so that sentence is false while any state has facts. Pins:
 *   1. With facts in the table, the rendered page carries the cited-section
 *      account, not the "never quotes them" sentence (the tripwire the
 *      content-guides skeptic asked for).
 *   2. Every clause of that account holds against the data: each rendered
 *      fact has an https source and a real check date; a processing-time row
 *      exists only where the entry holds one; an indexable guide is verified
 *      (the second reviewer) and carries the three required facts; and the
 *      counts come from the same predicate the guide robots tag reads.
 *   3. The page never claims every figure shown was second-reviewed, because
 *      facts render for unverified entries too; only indexing waits. The
 *      second review is scoped to the licensing facts section, and the
 *      continuing education promise to the renewal requirement the table
 *      carries (practice authority CE thresholds print outside it).
 *   4. With an empty table the page falls back to the "never quotes" form.
 *   5. A configured author is named in Review status; generated guides are
 *      said to carry no named author or reviewer, which the byline and the
 *      post page's schema wiring bear out.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LICENSE_GUIDE_FACTS } from '@/lib/license-guide-facts';
import { STATE_PRACTICE_AUTHORITY } from '@/lib/state-practice-authority';
import {
    getAllLicenseGuideSlugs,
    getIndexableLicenseGuideSlugs,
    getLicenseGuideFactRows,
    getLicenseGuideState,
    getLicenseGuideStatesWithFacts,
    isBlogSlugIndexable,
    isLicenseGuideStateIndexable,
} from '@/lib/blog-license-guides';

// Importing '@/app/editorial-policy/page' pulls in the whole license guide
// and stats graph. Alone that takes about 3 seconds inside a test body; on a
// loaded batch it passed vitest's 5 second default and failed the file.
vi.setConfig({ testTimeout: 60_000 });

const ROOT = process.cwd();
const read =(rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** Visible text of rendered markup, scripts dropped, entities decoded. */
function visibleText(html: string): string {
    return html
        .replace(/<script[\s\S]*?<\/script>/g, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&#x27;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .replace(/ ([.,;:)])/g, '$1')
        .replace(/\( /g, '(');
}

async function renderPolicy(): Promise<string> {
    const { default: EditorialPolicyPage } = await import('@/app/editorial-policy/page');
    return visibleText(renderToStaticMarkup(React.createElement(EditorialPolicyPage)));
}

/** The sentence of `text` that contains `needle`. */
function sentenceWith(text: string, needle: string): string {
    const sentence = text.split(/(?<=[.;])\s+(?=[A-Z])/).find((s) => s.includes(needle));
    expect(sentence, `no sentence contains "${needle}"`).toBeDefined();
    return sentence!;
}

const OLD_CLAIM = 'state license guide series never quotes them';
const CITED_CLAIM =
    'state license guide series quotes application fees, the continuing education required for renewal, renewal cycles and processing times only in a cited licensing facts section';

afterEach(() => {
    vi.doUnmock('@/lib/blog-license-guides');
    vi.doUnmock('@/config/brand');
    vi.resetModules();
});

describe('with the facts table filled', () => {
    it('the data really does put facts on guides (so the old sentence would be false)', () => {
        expect(getLicenseGuideStatesWithFacts().length).toBeGreaterThan(0);
    });

    it('renders the cited-section account and drops the "never quotes" sentence', async () => {
        const text = await renderPolicy();
        expect(text).toContain(CITED_CLAIM);
        expect(text).not.toContain(OLD_CLAIM);
        expect(text).not.toMatch(/do not hold verified per-state data/i);
        expect(text).toContain("answered with a link to that state's board of nursing");
    });

    it('prints the indexable and total guide counts from the robots predicate', async () => {
        const text = await renderPolicy();
        const indexable = getIndexableLicenseGuideSlugs().length;
        const all = getAllLicenseGuideSlugs().length;
        expect(text).toContain(`Today, ${indexable} of our ${all} guides meet that bar.`);
        expect(indexable).toBe(getAllLicenseGuideSlugs().filter((slug) => isBlogSlugIndexable(slug)).length);
    });

    it('keeps the licensure checker paragraph true without leaning on the old rule', async () => {
        const text = await renderPolicy();
        expect(text).not.toContain('follows the same rule');
        expect(text).toContain('Our licensure checker quotes none of these figures.');
    });

    it('is in house style: no en dash, em dash or spaced hyphen, and says "to" for ranges', async () => {
        const text = await renderPolicy();
        const paragraph = sentenceWith(text, 'State practice-authority classifications derive');
        const start = text.indexOf(paragraph);
        const passage = text.slice(start, text.indexOf('Our licensure checker', start));
        expect(passage).not.toMatch(/[–—]| - /);
        expect(passage).not.toMatch(/\baverage\b/i);
    });
});

describe('every clause of the account holds against lib/license-guide-facts.ts', () => {
    const statesWithFacts = getLicenseGuideStatesWithFacts();

    it('each rendered figure sits beside an https source and a real check date', () => {
        for (const s of statesWithFacts) {
            for (const { label, fact } of getLicenseGuideFactRows(s.code)) {
                expect(new URL(fact.sourceUrl).protocol, `${s.code} ${label}`).toBe('https:');
                expect(fact.sourceName.trim().length, `${s.code} ${label}`).toBeGreaterThan(0);
                expect(fact.checkedOn, `${s.code} ${label}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            }
        }
    });

    it('a processing-time row renders only where the entry holds a published one', () => {
        let withoutProcessingTime = 0;
        for (const s of statesWithFacts) {
            const hasRow = getLicenseGuideFactRows(s.code).some(({ label }) => label === 'Processing time');
            const entry = LICENSE_GUIDE_FACTS[s.code];
            if (hasRow) expect(entry.processingTime, s.code).not.toBeNull();
            if (entry.processingTime === null) {
                expect(hasRow, s.code).toBe(false);
                withoutProcessingTime += 1;
            }
        }
        // The "otherwise the guide leaves that row out" clause is exercised by real data.
        expect(withoutProcessingTime).toBeGreaterThan(0);
    });

    it('an indexable guide is second-reviewed and lists the fee, renewal cycle and CE requirement', () => {
        expect(getIndexableLicenseGuideSlugs().length).toBeGreaterThan(0);
        for (const slug of getIndexableLicenseGuideSlugs()) {
            const state = getLicenseGuideState(slug.replace(/^np-license-/, ''));
            expect(state, slug).not.toBeNull();
            const entry = LICENSE_GUIDE_FACTS[state!.code];
            expect(entry.verified, slug).toBe(true);
            const labels = getLicenseGuideFactRows(state!.code).map((row) => row.label);
            expect(labels, slug).toEqual(expect.arrayContaining([
                'Initial application fee',
                'Renewal cycle',
                'Continuing education for renewal',
            ]));
        }
    });

    it('never claims every figure shown was second-reviewed while unverified entries render facts', async () => {
        const unverifiedButShown = statesWithFacts.filter((s) => LICENSE_GUIDE_FACTS[s.code]?.verified !== true);
        const text = await renderPolicy();
        const second = sentenceWith(text, 'second reviewer');
        // The second review is tied to search results, not to what a guide shows.
        expect(second).toMatch(/^A guide can appear in search results only once/);
        expect(text.split('second reviewer').length - 1).toBe(1);
        // The verified flag covers the licensing fact values only. An indexable
        // guide also prints the BLS median, the growth projection, the full
        // practice state count and live job counts, which nobody re-reads.
        expect(second).toContain('a second reviewer has re-read every figure in its licensing facts section at its source');
        expect(text).not.toContain('re-read every figure on it');
        for (const s of unverifiedButShown) {
            expect(isLicenseGuideStateIndexable(s.stateSlug), s.code).toBe(false);
        }
    });

    it('scopes the continuing education clause to renewal, because practice authority CE prints outside the section', async () => {
        // The facts table carries only the renewal requirement.
        for (const s of statesWithFacts) {
            const ceLabels = getLicenseGuideFactRows(s.code)
                .map(({ label }) => label)
                .filter((label) => /continuing education/i.test(label));
            for (const label of ceLabels) expect(label, s.code).toBe('Continuing education for renewal');
        }
        // A guide prints its state's practice authority rule verbatim, outside
        // the facts section and with no source link. Illinois's rule names a
        // continuing education threshold for full practice authority, so a
        // promise covering every continuing education requirement is false.
        expect(STATE_PRACTICE_AUTHORITY.Illinois.details).toMatch(/\d+ hours of continuing education/);
        const text = await renderPolicy();
        expect(text).toContain('the continuing education required for renewal');
        expect(text).not.toMatch(/quotes application fees, continuing education requirements/);
    });

    it('the noindex clause matches the post page: a non-indexable guide renders noindex, follow', () => {
        const post = read('app/blog/[slug]/page.tsx');
        expect(post).toContain('!isLicenseGuideStateIndexable(licenseMatch[1])');
        expect(post).toContain('robots: { index: false, follow: true }');
    });
});

describe('with an empty facts table', () => {
    it('falls back to the "never quotes them" form', async () => {
        vi.resetModules();
        vi.doMock('@/lib/blog-license-guides', async (importOriginal) => {
            const actual = await importOriginal<typeof import('@/lib/blog-license-guides')>();
            return {
                ...actual,
                getLicenseGuideStatesWithFacts: () => [],
                getIndexableLicenseGuideSlugs: () => [],
            };
        });
        const text = await renderPolicy();
        expect(text).toContain(OLD_CLAIM);
        expect(text).not.toContain(CITED_CLAIM);
    });
});

describe('Review status: authorship', () => {
    it('with no author configured, names nobody and says generated guides name nobody', async () => {
        const text = await renderPolicy();
        expect(text).not.toContain('are written by');
        expect(text).toContain('Our generated state license guides never carry a named author or clinical reviewer');
    });

    it('with an author configured, names them from the same record, with the bio link', async () => {
        vi.resetModules();
        vi.doMock('@/config/brand', async (importOriginal) => {
            const actual = await importOriginal<typeof import('@/config/brand')>();
            return {
                ...actual,
                brand: {
                    ...actual.brand,
                    editorial: {
                        ...actual.brand.editorial,
                        author: { name: 'Test Author', credentials: 'MSN, APRN', title: 'Editor', profileUrl: '/about#editor' },
                    },
                },
            };
        });
        const { default: EditorialPolicyPage } = await import('@/app/editorial-policy/page');
        const html = renderToStaticMarkup(React.createElement(EditorialPolicyPage));
        const text = visibleText(html);
        expect(text).toContain('Our hand-written articles and guides are written by Test Author, MSN, APRN (Editor) (bio).');
        expect(html).toContain('href="/about#editor"');
        expect(text).toContain('Our generated state license guides never carry a named author or clinical reviewer');
    });

    it('the generated-guide sentence is true of the byline and the schema wiring', () => {
        const byline = read('components/EditorialByline.tsx');
        expect(byline).toMatch(/generated \? \(\s*<span>\s*Generated by \{brand\.name\} from structured state licensure data/);
        const post = read('app/blog/[slug]/page.tsx');
        expect(post).toContain('const namedPeople = licenseSlugMatch ? {} : editorialSchemaFields();');
        expect(post.match(/<EditorialByline[^>]*generated=\{Boolean\(licenseSlugMatch\)\}/g)?.length).toBeGreaterThanOrEqual(2);
    });
});
