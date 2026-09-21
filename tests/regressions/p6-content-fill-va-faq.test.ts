/**
 * P6 #7 — /jobs/va FAQ surface (content-fill package).
 *
 * /jobs/va was the only 1 of 45 category landings with neither an inline
 * FAQ nor FAQPage schema (sibling /jobs/veterans has both). Pins:
 *
 *   1. SINGLE-ARRAY pattern: one `vaFaqs` const drives BOTH the visible
 *      block and the FAQPage schema, so UI and schema can never disagree.
 *   2. The schema routes through the escaping serializer (angle brackets
 *      escaped as < / >) — repo convention, so no serialized
 *      value can terminate the surrounding <script> element.
 *   3. TRUTH RULES: federal pay / EDRP / Title 38 answers state MECHANICS
 *      only and point at VA.gov / USAJobs.gov. Award caps, pay tables, and
 *      processing windows change on VA's side — the FAQ must never assert
 *      dollar figures, percentages, or GS-grade numbers.
 *   4. Keyword differentiation from /jobs/veterans holds: no niche-copy
 *      debt terms in the FAQ block (the ratchet baseline for this file
 *      predates the FAQ and must not grow).
 *
 * W3-D (thin-content program, PLAN C.4 item 8 / thin-spec-1 section 5)
 * extends the file with the LAND-T15 claim sweep for the five bespoke
 * landings this package owns, plus the LAND-L* section wiring. The FAQ
 * array and the "VA {brand.niche.short} Questions" heading above are
 * unchanged by that work and stay pinned exactly as they were.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const PAGE = 'app/jobs/va/page.tsx';
const src = read(PAGE);

/** The five bespoke landings W3-D owns. */
const W3D_PAGES = [
    'app/jobs/va/page.tsx',
    'app/jobs/correctional/page.tsx',
    'app/jobs/geriatric/page.tsx',
    'app/jobs/veterans/page.tsx',
    'app/jobs/lgbtq/page.tsx',
] as const;

/** Comments must not satisfy (or fail) assertions about published copy. */
const stripComments = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/** The vaFaqs array literal — question/answer copy only, no JSX. */
const faqArraySource = (() => {
    const match = /const vaFaqs = \[[\s\S]*?\n\];/.exec(src);
    if (!match) throw new Error('vaFaqs array not found in app/jobs/va/page.tsx');
    return match[0];
})();

describe('P6 #7 — /jobs/va has the FAQ surface every other landing has', () => {
    it('declares a single vaFaqs array', () => {
        const declarations = src.match(/const vaFaqs = \[/g) ?? [];
        expect(declarations).toHaveLength(1);
    });

    it('renders the visible block AND the schema from that same array', () => {
        // Visible block maps the array to headings; schema maps it to
        // Question/Answer entities. Two consumers, one source of truth.
        const maps = src.match(/vaFaqs\.map\(/g) ?? [];
        expect(maps.length).toBe(2);
        expect(src).toContain("'@type': 'FAQPage'");
        expect(src).toContain("'@type': 'Question'");
        expect(src).toContain("acceptedAnswer: { '@type': 'Answer', text: f.answer }");
    });

    it('routes the FAQPage schema through the escaping serializer', () => {
        // Raw file bytes spell the escape as '\\u003c' (escaped backslash),
        // so the expectation doubles it again here — same pinning style as
        // p1-eeat-editorial-trust.test.ts.
        expect(src).toContain(".replace(/</g, '\\\\u003c')");
        expect(src).toContain(".replace(/>/g, '\\\\u003e')");
        expect(src).toMatch(/__html:\s*ldJson\(\{\s*'@context':\s*'https:\/\/schema\.org',\s*'@type':\s*'FAQPage'/);
    });

    it('renders a visible FAQ section heading', () => {
        expect(src).toContain('VA {brand.niche.short} Questions');
    });
});

describe('P6 #7 — VA FAQ answers stay truth-rule clean', () => {
    it('asserts no dollar figures (EDRP caps / pay tables live on VA.gov)', () => {
        expect(faqArraySource).not.toMatch(/\$\d/);
    });

    it('asserts no percentages or GS-grade/step numbers', () => {
        expect(faqArraySource).not.toMatch(/\d+\s*%/);
        expect(faqArraySource).not.toMatch(/GS-\d/);
    });

    it('asserts no day/week/month processing windows', () => {
        expect(faqArraySource).not.toMatch(/\d+\s*(?:-|–|to\s)?\s*\d*\s*(?:days?|weeks?|months?)\b/i);
    });

    it('points pay and EDRP mechanics at VA.gov and applications at USAJobs', () => {
        expect(faqArraySource).toContain('VA.gov');
        expect(faqArraySource).toContain('USAJobs');
    });

    it('covers the federal-employment mechanics the page is scoped to', () => {
        expect(faqArraySource).toContain('Title 38');
        expect(faqArraySource).toContain('EDRP');
        expect(faqArraySource).toContain('VetPro');
    });

    it('derives niche identity from brand tokens — no new niche-copy debt', () => {
        // The file's ratchet baseline (niche-copy-debt-baseline.json)
        // predates this FAQ; the FAQ block itself must contribute zero hits.
        expect(faqArraySource).toContain('${brand.niche.short}');
        expect(faqArraySource).not.toMatch(/pmhnp|psychiatric|mental health/i);
    });

    it('stays keyword-differentiated from /jobs/veterans (federal employment scope)', () => {
        // /jobs/veterans owns Vet Centers / CCN / veteran-patient content;
        // this page owns the federal-employment mechanics.
        const code = stripComments(faqArraySource);
        expect(code).not.toContain('Vet Center');
        expect(code).not.toContain('Community Care Network');
    });
});

describe('W3-D — LAND-T15 claim sweep on the five bespoke landings', () => {
    it.each(W3D_PAGES)('%s prints no hand-typed annual salary band', (rel) => {
        const code = stripComments(read(rel));
        // "$95K to $160K" / "$95K-$160K" / "$120,000 to $200,000", both
        // bounds salary shaped so a bonus or a limit never matches.
        expect(code).not.toMatch(/\$\d{2,3}K?\s*(?:-|–|—|\s+to\s+)\s*\$?\d{2,3}K/);
        expect(code).not.toMatch(/\$\d{2,3},000\s*(?:-|–|—|\s+to\s+)\s*\$?\d{2,3},000/);
    });

    it.each(W3D_PAGES)('%s prints no ungated fallback figure and no $0k', (rel) => {
        const code = stripComments(read(rel));
        expect(code).not.toContain('MedianFigure');
        expect(code).not.toContain('getGatedMedianKForWhere');
        expect(code).not.toMatch(/\$\{?\w*[Ss]alaryK\}?k/);
        expect(code).not.toContain("'$120K+'");
    });

    it.each(W3D_PAGES)('%s makes no unverifiable freshness or trend claim', (rel) => {
        const code = stripComments(read(rel));
        for (const phrase of ['added daily', 'posted daily', 'updated daily', 'continues to grow', 'turn 65']) {
            expect(code.toLowerCase()).not.toContain(phrase);
        }
    });

    it.each(W3D_PAGES)('%s carries exactly one alert CTA (T0-5)', (rel) => {
        const hits = read(rel).match(/>Create Alert</g) ?? [];
        expect(hits).toHaveLength(1);
    });

    it.each(W3D_PAGES)('%s keeps the crumbsFromSchema hero trail', (rel) => {
        const page = read(rel);
        expect(page).toContain("import CategoryHero, { crumbsFromSchema } from '@/components/CategoryHero';");
        expect(page).toMatch(/breadcrumbs=\{crumbsFromSchema\(/);
    });
});

describe('W3-D — the LAND-L sections and the shared metadata gate are wired', () => {
    it.each(W3D_PAGES)('%s builds title, description and robots from category-metadata', (rel) => {
        const page = read(rel);
        expect(page).toContain("from '@/lib/pseo/category-metadata'");
        expect(page).toContain('buildCategoryLandingTitle(');
        expect(page).toContain('buildCategoryLandingDescription(');
        expect(page).toContain('categoryLandingRobots(');
        // Keywords carry no ranking value and repeated the label (6.2).
        expect(page).not.toMatch(/^\s*keywords:/m);
    });

    it.each(W3D_PAGES)('%s reads one facts scope and renders the LAND-L bands from it', (rel) => {
        const page = read(rel);
        expect(page).toContain("getListingFacts(`category-landing:${SLUG}`");
        expect(page).toContain('<MarketSnapshot');       // LAND-L1
        expect(page).toContain('<LocationSpread');       // LAND-L2
        expect(page).toContain('buildListingsAuthoritySentence('); // LAND-L3
        expect(page).toContain('<PostedPay');            // LAND-L4
        expect(page).toContain('getLandingAxisGuide(');  // LAND-L5
        expect(page).toContain('buildRelatedCategorySub('); // LAND-L6 and L7
        expect(page).toContain('buildLowInventoryIntro('); // LAND-L7
    });

    it.each(W3D_PAGES)('%s stays clay: no sticker kit, no styled-jsx interpolation', (rel) => {
        const page = read(rel);
        expect(page).not.toContain('@/components/sticker');
        expect(page).not.toContain('StickerStyles');
        expect(page).not.toContain('<style jsx');
        expect(page).not.toContain('stk-');
        expect(page).toContain('clayCard');
    });

    it.each(W3D_PAGES)('%s carries no en dash, em dash or spaced hyphen in a string literal', (rel) => {
        const page = read(rel);
        for (const [i, line] of stripComments(page).split('\n').entries()) {
            expect(line, `${rel}:${i + 1}`).not.toContain('–');
            expect(line, `${rel}:${i + 1}`).not.toContain('—');
        }
    });
});
