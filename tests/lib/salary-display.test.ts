/**
 * Salary display strings never carry a dash (owner direction 2026-09-12).
 *
 * Two surfaces: the formatter that writes displaySalary for new ingests, and
 * the normaliser every render point applies to strings that older ingests
 * stored with a hyphen or dash between the ends of a range.
 */
import { describe, it, expect } from 'vitest';
import { formatDisplaySalary, formatSalaryWithEstimate, normalizeDisplaySalary } from '@/lib/salary-display';

describe('formatDisplaySalary joins ranges with "to"', () => {
    it('annual ranges', () => {
        expect(formatDisplaySalary(150000, 180000, 'annual')).toBe('$150k to $180k/yr');
    });
    it('hourly ranges (converted back from the annualised value)', () => {
        expect(formatDisplaySalary(145 * 2080, 200 * 2080, 'hourly')).toBe('$145 to $200/hr');
    });
    it('single values are unchanged', () => {
        expect(formatDisplaySalary(150000, null, 'annual')).toBe('$150k/yr');
        expect(formatDisplaySalary(null, 60 * 2080, 'hr')).toBe('$60/hr');
    });
    it('never emits a hyphen, en dash or em dash', () => {
        for (const s of [formatDisplaySalary(95000, 140000, 'annual'), formatDisplaySalary(70 * 2080, 130 * 2080, 'hourly')]) {
            expect(s).not.toMatch(/[-–—]/);
        }
    });
});

describe('normalizeDisplaySalary rewrites stored range separators', () => {
    it('hyphenated k-ranges from earlier ingests', () => {
        expect(normalizeDisplaySalary('$112k-$140k/yr')).toBe('$112k to $140k/yr');
        expect(normalizeDisplaySalary('$58k - $75k/yr')).toBe('$58k to $75k/yr');
    });
    it('en and em dashes, hourly and plain-number forms', () => {
        expect(normalizeDisplaySalary('$60–$90/hr')).toBe('$60 to $90/hr');
        expect(normalizeDisplaySalary('$120,000 — $150,000')).toBe('$120,000 to $150,000');
        expect(normalizeDisplaySalary('150-200/hr')).toBe('150 to 200/hr');
    });
    it('is idempotent and leaves single values, suffixes and nulls alone', () => {
        expect(normalizeDisplaySalary('$112k to $140k/yr')).toBe('$112k to $140k/yr');
        expect(normalizeDisplaySalary('$150k/yr')).toBe('$150k/yr');
        expect(normalizeDisplaySalary('$60/hr+')).toBe('$60/hr+');
        expect(normalizeDisplaySalary('Competitive')).toBe('Competitive');
        expect(normalizeDisplaySalary(null)).toBeNull();
        expect(normalizeDisplaySalary(undefined)).toBeNull();
    });
    it('flows through formatSalaryWithEstimate', () => {
        expect(formatSalaryWithEstimate('$100k-$120k/yr', true)).toBe('~$100k to $120k/yr');
        expect(formatSalaryWithEstimate(null, false)).toBe('Competitive');
    });
});
