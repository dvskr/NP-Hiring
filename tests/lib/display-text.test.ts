/**
 * Employer-authored text (job titles, employer names, locations) is rendered
 * through normalizeDisplayText so dashes used as separators never reach the
 * page (owner direction 2026-09-12). The stored data and JSON-LD stay raw;
 * this pins the render-time helper only.
 */
import { describe, it, expect } from 'vitest';
import { pluralize as pluralizeSource } from '@/lib/pseo/plural';
import {
    normalizeDisplayText,
    displayText,
    pluralize,
    formatCount,
    isAre,
    wasWere,
    truncateOnWord,
    indefiniteArticle,
    joinWithAnd,
} from '@/lib/display-text';

describe('normalizeDisplayText replaces dash separators with a middle dot', () => {
    it('spaced em dash', () => {
        expect(normalizeDisplayText('A — B')).toBe('A · B');
    });
    it('spaced hyphen', () => {
        expect(normalizeDisplayText('A - B')).toBe('A · B');
    });
    it('unspaced en dash', () => {
        expect(normalizeDisplayText('A–B')).toBe('A · B');
    });
    it('unspaced em dash and irregular whitespace collapse to one space each side', () => {
        expect(normalizeDisplayText('A—B')).toBe('A · B');
        expect(normalizeDisplayText('A   —  B')).toBe('A · B');
        expect(normalizeDisplayText('A \t-  B')).toBe('A · B');
    });
    it('real listing strings', () => {
        expect(normalizeDisplayText('PMHNP — Remote | Telehealth')).toBe('PMHNP · Remote | Telehealth');
        expect(normalizeDisplayText('Remote - USA')).toBe('Remote · USA');
        expect(normalizeDisplayText('NP/PA - Studio City')).toBe('NP/PA · Studio City');
        expect(normalizeDisplayText('Psychiatric NP — Outpatient — Austin, TX')).toBe('Psychiatric NP · Outpatient · Austin, TX');
    });
});

describe('normalizeDisplayText leaves in-word hyphens alone', () => {
    it('compound words', () => {
        expect(normalizeDisplayText('Full-Time')).toBe('Full-Time');
        expect(normalizeDisplayText('Part-time PMHNP')).toBe('Part-time PMHNP');
        expect(normalizeDisplayText('1099-vs-W2')).toBe('1099-vs-W2');
        expect(normalizeDisplayText('Nurse Practitioner - Full-Time')).toBe('Nurse Practitioner · Full-Time');
    });
    it('hyphen touching a word on one side only', () => {
        expect(normalizeDisplayText('Winston-Salem, NC')).toBe('Winston-Salem, NC');
        expect(normalizeDisplayText('-5 to 5')).toBe('-5 to 5');
    });
});

describe('normalizeDisplayText is idempotent and null-safe', () => {
    it('already-normalised strings are unchanged', () => {
        const once = normalizeDisplayText('A — B - C–D');
        expect(once).toBe('A · B · C · D');
        expect(normalizeDisplayText(once)).toBe(once);
        expect(normalizeDisplayText('A · B')).toBe('A · B');
    });
    it('plain strings pass through untouched', () => {
        expect(normalizeDisplayText('Sol Mental Health')).toBe('Sol Mental Health');
        expect(normalizeDisplayText('Washington, DC')).toBe('Washington, DC');
    });
    it('null, undefined and empty input return null', () => {
        expect(normalizeDisplayText(null)).toBeNull();
        expect(normalizeDisplayText(undefined)).toBeNull();
        expect(normalizeDisplayText('')).toBeNull();
    });
    it('never emits an en dash or em dash', () => {
        for (const s of ['A — B', 'A–B', 'A - B', 'A—B—C']) {
            expect(normalizeDisplayText(s)).not.toMatch(/[–—]/);
        }
    });
});

describe('displayText is the string-returning variant for template literals', () => {
    it('normalises like normalizeDisplayText', () => {
        expect(displayText('A — B')).toBe('A · B');
        expect(displayText('Full-Time')).toBe('Full-Time');
    });
    it('returns an empty string instead of null', () => {
        expect(displayText(null)).toBe('');
        expect(displayText(undefined)).toBe('');
        expect(displayText('')).toBe('');
    });
});

/*
 * pSEO thin-content helpers (PLAN C.3, T0-6): count grammar is the one
 * implementation in lib/pseo/plural.ts, truncation never ends mid-word,
 * and list joining follows the page specs' "{A}, {B} and {C}" shape.
 */
describe('pluralize, formatCount, isAre and wasWere', () => {
    it('pluralize is the lib/pseo/plural implementation, not a copy', () => {
        expect(pluralize).toBe(pluralizeSource);
    });
    it('singular at exactly one, plural otherwise', () => {
        expect(pluralize(1, 'role')).toBe('role');
        expect(pluralize(0, 'role')).toBe('roles');
        expect(pluralize(2, 'city', 'cities')).toBe('cities');
        expect(formatCount(1, 'live role')).toBe('1 live role');
        expect(formatCount(12, 'live role')).toBe('12 live roles');
        expect(formatCount(1, 'city', 'cities')).toBe('1 city');
    });
    it('verb agreement in both tenses', () => {
        expect(isAre(1)).toBe('is');
        expect(isAre(0)).toBe('are');
        expect(isAre(3)).toBe('are');
        expect(wasWere(1)).toBe('was');
        expect(wasWere(0)).toBe('were');
        expect(wasWere(3)).toBe('were');
    });
});

describe('truncateOnWord', () => {
    const SENTENCE = '52 open nurse practitioner roles in Pennsylvania from 14 employers, led by Philadelphia and Pittsburgh. Reduced Practice state.';

    it('returns the trimmed text untouched when it fits', () => {
        expect(truncateOnWord('  short text  ', 155)).toBe('short text');
    });
    it('never ends mid-word at any budget', () => {
        for (let max = 1; max <= SENTENCE.length; max += 1) {
            const out = truncateOnWord(SENTENCE, max);
            expect(out.length, `budget ${max}`).toBeLessThanOrEqual(max);
            expect(SENTENCE.startsWith(out), `budget ${max}`).toBe(true);
            // The character after the cut is never a word character (the
            // cut lands on whitespace, on a separator the tail strip
            // removed, or at the end of the text). The only tolerated
            // mid-word cut is a budget shorter than the first word.
            const next = SENTENCE.charAt(out.length);
            const boundary = next === '' || /\W/.test(next) || max < SENTENCE.indexOf(' ');
            expect(boundary, `budget ${max}: "${out}"`).toBe(true);
            expect(out, `budget ${max}`).not.toMatch(/[\s,;:(]$/);
        }
    });
    it('strips a dangling comma, colon, semicolon or open bracket at the cut', () => {
        expect(truncateOnWord('alpha beta, gamma delta', 11)).toBe('alpha beta');
        expect(truncateOnWord('alpha beta: gamma delta', 11)).toBe('alpha beta');
        expect(truncateOnWord('alpha beta (gamma delta', 12)).toBe('alpha beta');
    });
    it('keeps a cut that lands exactly on a word boundary', () => {
        expect(truncateOnWord('alpha beta gamma', 10)).toBe('alpha beta');
        expect(truncateOnWord('alpha beta gamma', 11)).toBe('alpha beta');
    });
    it('counts the suffix toward the budget', () => {
        const out = truncateOnWord('alpha beta gamma delta', 13, '…');
        expect(out).toBe('alpha beta…');
        expect(out.length).toBeLessThanOrEqual(13);
    });
    it('clips a single word longer than the budget because there is no boundary to honour', () => {
        expect(truncateOnWord('Supercalifragilistic', 5)).toBe('Super');
    });
});

describe('joinWithAnd', () => {
    it('joins with "and" and no serial comma', () => {
        expect(joinWithAnd([])).toBe('');
        expect(joinWithAnd(['A'])).toBe('A');
        expect(joinWithAnd(['A', 'B'])).toBe('A and B');
        expect(joinWithAnd(['A', 'B', 'C'])).toBe('A, B and C');
        expect(joinWithAnd(['Texas (4)', 'Ohio (2)', 'Iowa (1)'])).toBe('Texas (4), Ohio (2) and Iowa (1)');
    });
});

describe('indefiniteArticle', () => {
    it('follows the spoken letter for acronyms and the leading vowel for words', () => {
        expect(indefiniteArticle('NP')).toBe('an');
        expect(indefiniteArticle('FNP')).toBe('an');
        expect(indefiniteArticle('CRNA')).toBe('a');
        expect(indefiniteArticle('CNM')).toBe('a');
        expect(indefiniteArticle('apple')).toBe('an');
        expect(indefiniteArticle('nurse')).toBe('a');
        expect(indefiniteArticle('')).toBe('a');
    });
});
