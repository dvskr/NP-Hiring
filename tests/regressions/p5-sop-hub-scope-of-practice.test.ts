/**
 * Regression guards for the /scope-of-practice hub (P5 sop-hub).
 *
 * The hub is a YMYL regulatory surface, so these pins are about truth and
 * drift, in four groups:
 *
 *   1. DATA FIDELITY — every rendered row is a verbatim join of
 *      lib/state-practice-authority.ts (AANP tiers + details) and
 *      lib/blog-license-guides.ts (verified NCSBN board names/URLs), and
 *      the tier counts agree with STAT_SOURCES.fullPracticeStates — the
 *      "27 states + DC" figure cited on /jobs, /faq, and /salary-guide.
 *   2. TRUTH GUARDS — the hub must NOT render NLC membership booleans
 *      (the repo's canonical non-member set is documented stale in
 *      app/resources/fpa-guide/page.tsx — verified against NCSBN
 *      2026-07-29 and re-verified 2026-08-06: CT/MA/RI/WA have enacted
 *      the compact, Alaska is missing). Until that set is corrected at
 *      its source, the hub links the live NCSBN roster instead. It must
 *      also not hardcode any external URL beyond schema.org (board/AANP/
 *      roster links flow from the data module), and must not fabricate
 *      freshness with render-time dates.
 *   3. SCHEMA PARITY — FAQPage JSON-LD derives from the SAME array as the
 *      visible FAQ, with angle-bracket escaping.
 *   4. ACCESSIBILITY — the interactive explorer keeps its labelled search
 *      input, aria-pressed tier filters, aria-sort headers, and aria-live
 *      result count.
 *
 * Static source assertions follow the repo's pin pattern
 * (tests/regressions/p2-trust-surfaces-accessibility-press.test.ts) — the
 * vitest env is node-only, so server components are read as source.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
    AANP_STATE_PRACTICE_URL,
    NLC_LIVE_ROSTER_URL,
    SOP_COUNTS,
    SOP_LAST_REVIEWED,
    SOP_PUBLISHED_AT,
    SOP_STATE_ROWS,
    buildSopFaqs,
} from '@/components/ScopeOfPracticeData';
import { STATE_PRACTICE_AUTHORITY } from '@/lib/state-practice-authority';
import { LICENSE_GUIDE_STATES } from '@/lib/blog-license-guides';
import { LICENSE_GUIDE_SERIES_PUBLISHED, licenseGuideSlug } from '@/config/niche/content-map';
import { STAT_SOURCES } from '@/lib/stats-sources';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const pageSrc = read('app/scope-of-practice/page.tsx');
const dataSrc = read('components/ScopeOfPracticeData.ts');
const explorerSrc = read('components/ScopeOfPracticeExplorer.tsx');
const resourcesSrc = read('app/resources/page.tsx');
const fpaGuideSrc = read('app/resources/fpa-guide/page.tsx');

/**
 * Strip comments before "must NOT contain" checks — the files' own doc
 * comments name the tokens whose absence they explain (nlcMember, the
 * stale non-member set), and a comment must not trip the guard that keeps
 * the token banned from code.
 */
const code = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

describe('data fidelity — rows are a verbatim join of the canonical datasets', () => {
    it('renders exactly the 51 jurisdictions of the practice-authority dataset, alphabetical', () => {
        expect(SOP_STATE_ROWS).toHaveLength(51);
        expect(SOP_STATE_ROWS.map((r) => r.name)).toEqual(
            Object.keys(STATE_PRACTICE_AUTHORITY).sort((a, b) => a.localeCompare(b)),
        );
    });

    it('every row republishes its state entry verbatim — tier, label, details', () => {
        for (const row of SOP_STATE_ROWS) {
            const info = STATE_PRACTICE_AUTHORITY[row.name];
            expect(info, row.name).toBeDefined();
            expect(row.authority, row.name).toBe(info.authority);
            expect(row.authorityLabel, row.name).toBe(info.description);
            expect(row.details, row.name).toBe(info.details);
        }
    });

    it('board names and board URLs come from the verified NCSBN directory data', () => {
        for (const row of SOP_STATE_ROWS) {
            const guide = LICENSE_GUIDE_STATES.find((s) => s.name === row.name);
            expect(guide, row.name).toBeDefined();
            expect(row.boardName, row.name).toBe(guide!.boardName);
            expect(row.boardUrl, row.name).toBe(guide!.boardUrl);
            expect(row.boardUrl, row.name).toMatch(/^https:\/\/www\.ncsbn\.org\/bon-member-details\//);
            expect(row.code, row.name).toBe(guide!.code);
            expect(row.stateSlug, row.name).toBe(guide!.stateSlug);
        }
    });

    it('internal links target the canonical state routes, and anchors equal state slugs', () => {
        for (const row of SOP_STATE_ROWS) {
            expect(row.anchorId, row.name).toBe(row.stateSlug);
            expect(row.salaryHref, row.name).toBe(`/salary-guide/${row.stateSlug}`);
            expect(row.jobsHref, row.name).toBe(`/jobs/state/${row.stateSlug}`);
        }
    });

    it('licensure-guide links are gated on the series flag so the hub can never emit 404s', () => {
        for (const row of SOP_STATE_ROWS) {
            if (LICENSE_GUIDE_SERIES_PUBLISHED) {
                expect(row.licenseGuideHref, row.name).toBe(`/blog/${licenseGuideSlug(row.stateSlug)}`);
            } else {
                expect(row.licenseGuideHref, row.name).toBeNull();
            }
        }
    });

    it('tier counts agree with STAT_SOURCES.fullPracticeStates and sum to 51', () => {
        // The full count is rendered as "<n> states + DC", so DC is excluded
        // from it (the fpa-guide fullStateCount correction).
        expect(SOP_COUNTS.full).toBe(Number(STAT_SOURCES.fullPracticeStates.value));
        expect(SOP_COUNTS.full + 1 + SOP_COUNTS.reduced + SOP_COUNTS.restricted).toBe(51);
        expect(SOP_COUNTS.total).toBe(51);
    });
});

describe('truth guards — no stale NLC booleans, no unsourced externals, no fabricated freshness', () => {
    const surfaces: Array<[string, string]> = [
        ['app/scope-of-practice/page.tsx', pageSrc],
        ['components/ScopeOfPracticeData.ts', dataSrc],
        ['components/ScopeOfPracticeExplorer.tsx', explorerSrc],
    ];

    it('no surface consumes the stale NLC membership set (comments excluded)', () => {
        for (const [name, src] of surfaces) {
            const stripped = code(src);
            expect(stripped, `${name} must not read nlcMember`).not.toMatch(/nlcMember/);
            expect(stripped, `${name} must not read the NLC non-member set`).not.toMatch(/NLC_NON_MEMBER/);
        }
    });

    it('compact membership is answered by the live roster — the same URL /resources/fpa-guide links', () => {
        expect(NLC_LIVE_ROSTER_URL).toBe('https://www.nursecompact.com/');
        expect(fpaGuideSrc).toContain(NLC_LIVE_ROSTER_URL);
        expect(pageSrc).toContain('NLC_LIVE_ROSTER_URL');
    });

    it('the page hardcodes no external URL — schema.org context only', () => {
        const urls = code(pageSrc).match(/https?:\/\/[^\s'"`)]+/g) ?? [];
        for (const url of urls) {
            expect(url, 'external links must flow from the data module, not page literals').toMatch(/^https:\/\/schema\.org/);
        }
    });

    it('the AANP classification source is the stats-sources URL, not a retyped literal', () => {
        expect(AANP_STATE_PRACTICE_URL).toBe(STAT_SOURCES.fullPracticeStates.sourceUrl);
        expect(pageSrc).toContain('AANP_STATE_PRACTICE_URL');
    });

    it('freshness comes from real literals, never render time', () => {
        expect(SOP_LAST_REVIEWED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(SOP_PUBLISHED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        // Bare new Date() at render time fabricates freshness (audit B54).
        expect(code(pageSrc)).not.toMatch(/new Date\(\)/);
        // The visible "Last reviewed" line and Article.dateModified render
        // the same constant.
        expect(pageSrc).toContain('Last reviewed: {new Date(`${SOP_LAST_REVIEWED}');
        expect(pageSrc).toContain('dateModified: SOP_LAST_REVIEWED');
        expect(pageSrc).toContain('SOP_SOURCE_LINE');
    });

    it('the FAQ invents no dollar figures', () => {
        for (const faq of buildSopFaqs()) {
            expect(faq.answer, faq.question).not.toMatch(/\$\d/);
        }
    });
});

describe('schema parity — FAQPage JSON-LD and the visible FAQ share one array', () => {
    it('buildSopFaqs is non-trivial and cites its sources', () => {
        const faqs = buildSopFaqs();
        expect(faqs.length).toBeGreaterThanOrEqual(4);
        const joined = faqs.map((f) => f.answer).join('\n');
        expect(joined).toContain(STAT_SOURCES.fullPracticeStates.source);
        expect(joined).toContain(NLC_LIVE_ROSTER_URL);
    });

    it('the page maps the same sopFaqs variable into JSON-LD and the visible section', () => {
        const occurrences = pageSrc.split('sopFaqs.map((faq)').length - 1;
        expect(occurrences).toBeGreaterThanOrEqual(2);
        expect(pageSrc).toContain("'@type': 'FAQPage'");
    });

    it('JSON-LD is serialized with angle-bracket escaping (repo ldJson convention)', () => {
        expect(pageSrc).toContain('\\\\u003c');
    });
});

describe('accessibility + interaction contract of the explorer', () => {
    it('keeps the labelled search input', () => {
        expect(explorerSrc).toContain('htmlFor="sop-state-search"');
        expect(explorerSrc).toContain('id="sop-state-search"');
    });

    it('keeps aria-pressed tier filters, aria-sort headers, and the aria-live count', () => {
        expect(explorerSrc).toContain('aria-pressed');
        expect(explorerSrc).toContain('aria-sort');
        expect(explorerSrc).toContain('aria-live="polite"');
    });

    it('sorting and filtering are operated by native buttons (keyboard-native)', () => {
        // No /s flag: TS1501 under the repo's ES2017 target, and unnecessary —
        // the pattern has no '.' metacharacter ([^>] already matches newlines).
        expect(explorerSrc).toMatch(/<button[^>]*type="button"[^>]*onClick=\{\(\) => toggleSort/);
    });

    it('state names deep-link to the per-state sections the page renders', () => {
        expect(explorerSrc).toContain('href={`#${row.anchorId}`}');
        expect(pageSrc).toContain('id={row.anchorId}');
    });

    it('tier colors come from the board-wide getAuthorityColor helper in both surfaces', () => {
        expect(explorerSrc).toMatch(/getAuthorityColor/);
        expect(pageSrc).toMatch(/getAuthorityColor/);
    });
});

describe('interlinking', () => {
    it('/resources links the hub', () => {
        expect(resourcesSrc).toContain('href="/scope-of-practice"');
    });

    it('the hub cross-links the FPA guide, the licensure checker, and the salary guide', () => {
        expect(pageSrc).toContain('href="/resources/fpa-guide"');
        expect(pageSrc).toContain('href="/tools/licensure-checker"');
        expect(pageSrc).toContain('href="/salary-guide"');
    });
});
