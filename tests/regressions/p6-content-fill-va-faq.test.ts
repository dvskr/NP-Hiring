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
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const PAGE = 'app/jobs/va/page.tsx';
const src = read(PAGE);

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
