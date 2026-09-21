/**
 * pSEO FAQ schema parity (PLAN.md C.0 "FAQ rendering", thin-spec 1 section
 * 9.6, package W2-STATE): the array that feeds the visible accordion is the
 * array that feeds the FAQPage JSON-LD, on the component and on the
 * category x state template that passes it `customFaqs`.
 *
 * Rendered with react-dom/server, no database:
 *   - every question and answer in the FAQPage graph is in the markup as a
 *     `<p class="faq-answer">`, in the same order, and nothing else is;
 *   - the schema is emitted only at 2 or more entries, the answers always;
 *   - an answer cannot close the script element (angle brackets escaped);
 *   - the template renders the band from ONE array (buildSettingStateFaqs),
 *     gates the Speakable '.faq-answer' selector on that array, and never
 *     falls back to the category-generic questions.
 *
 * Written as .test.ts with React.createElement because vitest.config.ts
 * includes only `tests/** /*.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CategoryFAQ from '@/components/CategoryFAQ';
import type { CategorySlug, FAQItem } from '@/lib/pseo/category-faq-data';
import { buildSettingStateFaqs, type FaqEntry } from '@/lib/pseo/listing-narrative';
import { emptyListingFacts, type ListingFacts } from '@/lib/pseo/listing-facts';
import { getPracticeEnvironment } from '@/lib/pseo/practice-environment';
import { buildLicenseGuideFaq, getLicenseGuideState } from '@/lib/blog-license-guides';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const STATE_TEMPLATE = 'lib/pseo/setting-state-template.tsx';
const CATEGORY: CategorySlug = 'remote';
const JSON_LD = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;

interface FaqPageGraph {
    '@type': string;
    mainEntity: Array<{ name: string; acceptedAnswer: { text: string } }>;
}

function renderBand(faqs: FAQItem[]): string {
    return renderToStaticMarkup(React.createElement(CategoryFAQ, { category: CATEGORY, totalJobs: 4, customFaqs: faqs }));
}

/** Every FAQPage graph in the markup, parsed. */
function faqGraphs(html: string): FaqPageGraph[] {
    return [...html.matchAll(JSON_LD)]
        .map((m) => JSON.parse(m[1]) as FaqPageGraph)
        .filter((graph) => graph['@type'] === 'FAQPage');
}

/** The visible answers, in document order. */
function visibleAnswers(html: string): string[] {
    return [...html.matchAll(/<p class="faq-answer">([\s\S]*?)<\/p>/g)].map((m) => m[1]);
}

const escapeHtml = (text: string): string =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

const TWO: FAQItem[] = [
    { question: 'How many remote listings are open in Texas?', answer: 'All 4 current remote listings in Texas are posted by Lakeside Health.' },
    { question: 'Is Texas part of the Nurse Licensure Compact?', answer: "Yes, Texas is a member; the APRN license itself is still issued by Texas. <script>alert('x')</script>" },
];

// ─── the component ──────────────────────────────────────────────────────────

describe('CategoryFAQ: one array feeds the accordion and the FAQPage JSON-LD', () => {
    it('the schema entries are the visible entries, in order, and nothing else', () => {
        const html = renderBand(TWO);
        const graphs = faqGraphs(html);
        expect(graphs).toHaveLength(1);
        expect(graphs[0].mainEntity.map((q) => ({ question: q.name, answer: q.acceptedAnswer.text }))).toEqual(TWO);
        expect(visibleAnswers(html)).toEqual(TWO.map((f) => escapeHtml(f.answer)));
        for (const faq of TWO) expect(html).toContain(escapeHtml(faq.question));
    });

    it('an answer can never close the script element', () => {
        const html = renderBand(TWO);
        // Only the JSON-LD's own closing tag exists; the answer's is escaped in both halves.
        expect(html.match(/<\/script>/g)).toHaveLength(1);
        expect(html).toContain('\\u003cscript>');
        expect(html).toContain('&lt;script&gt;');
    });

    it('a single entry renders its answer without a FAQPage graph', () => {
        const html = renderBand(TWO.slice(0, 1));
        expect(faqGraphs(html)).toHaveLength(0);
        expect(visibleAnswers(html)).toEqual([escapeHtml(TWO[0].answer)]);
    });
});

// ─── the category x state array ─────────────────────────────────────────────

describe('the category x state FAQ array is the FAQPage graph', () => {
    const env = getPracticeEnvironment('Texas');
    if (!env) throw new Error('fixture: Texas is missing from the practice dataset');
    const guide = buildLicenseGuideFaq(getLicenseGuideState(env.stateSlug)!);
    const physicianAnswer = guide.find((f) => /collaborating or supervising physician/i.test(f.name))!.text;
    const nlcAnswer = guide.find((f) => /Nurse Licensure Compact/i.test(f.name))!.text;
    const facts: ListingFacts = {
        ...emptyListingFacts(new Date('2026-09-16T12:00:00Z')),
        total: 4,
        distinctEmployers: 1,
        topEmployers: [{ name: 'Lakeside Health', count: 4, companyPath: null }],
        recency: { total: 4, datedCount: 4, last7: 1, last30: 2, newestPostedAt: new Date('2026-09-01T00:00:00Z') },
    };

    it('renders the license-guide answers and drops the pay question with its missing benchmark', () => {
        const stateFaqs: FaqEntry[] = buildSettingStateFaqs({ label: 'Remote', stateName: 'Texas', slug: 'remote', facts, physicianAnswer, nlcAnswer });
        expect(stateFaqs.map((f) => f.question)).toEqual([
            'How many Remote NP jobs are open in Texas?',
            'Do NPs need a collaborating physician in Texas?',
            'Is Texas part of the Nurse Licensure Compact?',
        ]);

        const html = renderBand(stateFaqs);
        const [graph] = faqGraphs(html);
        expect(graph.mainEntity.map((q) => ({ question: q.name, answer: q.acceptedAnswer.text }))).toEqual(stateFaqs);
        expect(visibleAnswers(html)).toEqual(stateFaqs.map((f) => escapeHtml(f.answer)));
    });
});

// ─── the template wiring ────────────────────────────────────────────────────

describe('lib/pseo/setting-state-template.tsx feeds the band from one array', () => {
    const code = stripComments(read(STATE_TEMPLATE));

    it('builds the array once with buildSettingStateFaqs and passes it as customFaqs', () => {
        expect(code.match(/buildSettingStateFaqs\(/g)).toHaveLength(1);
        expect(code).toContain('customFaqs={stateFaqs}');
        // No category-generic fallback: the band renders from the state array or not at all.
        expect(code).not.toMatch(/getCategoryFaqs\(/);
        expect(code).toMatch(/rendersFaqAnswers && \(\s*<CategoryFAQ/);
    });

    it('gates the Speakable selector on the same array', () => {
        expect(code).toContain('const rendersFaqAnswers = stateFaqs.length > 0');
        const selector = code.match(/cssSelector: ([\s\S]{0,240}?),\r?\n/);
        expect(selector).not.toBeNull();
        const [, ifTrue = '', ifFalse = ''] = selector![1].split(/\?|:/);
        expect(selector![1]).toContain('rendersFaqAnswers');
        expect(ifTrue).toContain('.faq-answer');
        expect(ifFalse).not.toContain('.faq-answer');
        expect(ifFalse).toContain('#answer-summary');
    });

    it('emits no FAQPage literal of its own (CategoryFAQ owns the schema)', () => {
        expect(code).not.toContain("'FAQPage'");
    });
});
