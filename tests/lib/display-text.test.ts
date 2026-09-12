/**
 * Employer-authored text (job titles, employer names, locations) is rendered
 * through normalizeDisplayText so dashes used as separators never reach the
 * page (owner direction 2026-09-12). The stored data and JSON-LD stay raw;
 * this pins the render-time helper only.
 */
import { describe, it, expect } from 'vitest';
import { normalizeDisplayText, displayText } from '@/lib/display-text';

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
