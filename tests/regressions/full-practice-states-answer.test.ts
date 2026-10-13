/**
 * /scope-of-practice quick answer and its FAQ twin (SEO/AEO release
 * 2026-10-06). lib/full-practice-states.ts derives the count, the state list
 * and the AANP vintage from lib/state-practice-authority.ts and
 * STAT_SOURCES.fullPracticeStates. These pins keep the visible answer, the
 * FAQPage text and the canonical "27 states + DC" figure in agreement, and
 * keep the copy inside the house style (no em dash, en dash or spaced hyphen).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    buildFullPracticeAnswer,
    buildFullPracticeFaq,
    getAanpMapVintage,
    getFullPracticeStateNames,
    isDcFullPractice,
    joinWithAnd,
} from '@/lib/full-practice-states';
import { STATE_PRACTICE_AUTHORITY } from '@/lib/state-practice-authority';
import { STAT_SOURCES } from '@/lib/stats-sources';

const DASH_AS_PUNCTUATION = /[–—]| - /;

describe('full practice states answer', () => {
    const answer = buildFullPracticeAnswer();

    it('the count agrees with the canonical AANP figure', () => {
        expect(answer.count).toBe(Number(STAT_SOURCES.fullPracticeStates.value));
        expect(answer.states).toHaveLength(answer.count);
    });

    it('D.C. is named after the states, never counted as one', () => {
        expect(isDcFullPractice()).toBe(true);
        expect(answer.includesDc).toBe(true);
        expect(answer.states).not.toContain('District of Columbia');
        expect(answer.summary).toContain(`${answer.count} states plus the District of Columbia`);
        expect(answer.summary.trim().endsWith('and the District of Columbia.')).toBe(true);
    });

    it('every full practice state in the dataset is named, alphabetically', () => {
        const fromDataset = Object.entries(STATE_PRACTICE_AUTHORITY)
            .filter(([name, info]) => info.authority === 'full' && name !== 'District of Columbia')
            .map(([name]) => name);
        expect([...getFullPracticeStateNames()]).toEqual([...fromDataset].sort((a, b) => a.localeCompare(b)));
        for (const state of answer.states) expect(answer.summary).toContain(state);
    });

    it('attributes AANP with the map vintage and links the cited source', () => {
        expect(getAanpMapVintage()).toBe('May 2026');
        expect(answer.attribution).toContain(STAT_SOURCES.fullPracticeStates.source);
        expect(answer.attribution).toContain('May 2026');
        expect(answer.sourceUrl).toBe(STAT_SOURCES.fullPracticeStates.sourceUrl);
    });

    it('the FAQ entry carries exactly the visible answer text', () => {
        const faq = buildFullPracticeFaq();
        expect(faq.answer).toBe(answer.text);
        expect(answer.text).toBe(`${answer.summary} ${answer.attribution} ${answer.caveat}`);
    });

    it('the copy follows the house style', () => {
        const faq = buildFullPracticeFaq();
        for (const text of [faq.question, faq.answer]) {
            expect(text, text).not.toMatch(DASH_AS_PUNCTUATION);
        }
    });

    it('joinWithAnd uses the serial comma', () => {
        expect(joinWithAnd([])).toBe('');
        expect(joinWithAnd(['A'])).toBe('A');
        expect(joinWithAnd(['A', 'B'])).toBe('A and B');
        expect(joinWithAnd(['A', 'B', 'C'])).toBe('A, B, and C');
    });

    it('/scope-of-practice renders the answer and leads its FAQ with it', () => {
        const page = fs.readFileSync(path.resolve(__dirname, '../../app/scope-of-practice/page.tsx'), 'utf-8');
        expect(page).toContain('buildFullPracticeAnswer()');
        expect(page).toContain('[buildFullPracticeFaq(), ...buildSopFaqs()]');
    });
});
