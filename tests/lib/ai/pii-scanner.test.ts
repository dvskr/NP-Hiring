/**
 * Tests for the PII scanner findViolations() function. Doesn't run the CLI —
 * just validates the detection logic.
 */

import { describe, it, expect } from 'vitest';
import { __testing } from '@/scripts/scan-prompt-pii';

describe('PII scanner', () => {
    it('flags forbidden field references (case-insensitive)', () => {
        const violations = __testing.findViolations('test.json', 'system', 'Include the candidate deaNumber if present.');
        expect(violations.some((v) => v.pattern === 'field:deaNumber')).toBe(true);
    });

    it('flags raw 10-digit NPI numbers in the prompt body', () => {
        const violations = __testing.findViolations('test.json', 'user_template', 'Their identifier is 1234567890 — please review.');
        expect(violations.some((v) => v.pattern.includes('NPI'))).toBe(true);
    });

    it('flags DEA-shaped strings (XX9999999)', () => {
        const violations = __testing.findViolations('test.json', 'system', 'DEA AB1234567 must be checked.');
        expect(violations.some((v) => v.pattern.includes('DEA'))).toBe(true);
    });

    it('flags SSN-shaped strings', () => {
        const violations = __testing.findViolations('test.json', 'system', 'SSN 123-45-6789 should never appear here.');
        expect(violations.some((v) => v.pattern.includes('SSN'))).toBe(true);
    });

    it('flags demographic field references (race, ethnicity, gender)', () => {
        const violations = __testing.findViolations('test.json', 'system', 'Score uses race and ethnicity.');
        expect(violations.some((v) => v.pattern === 'field:race')).toBe(true);
        expect(violations.some((v) => v.pattern === 'field:ethnicity')).toBe(true);
    });

    it('does NOT flag clean prompt content', () => {
        const violations = __testing.findViolations('test.json', 'system', 'Score the candidate based on certifications and license states.');
        expect(violations).toEqual([]);
    });

    it('skips a field the prompt declares in its allow list, and only that field', () => {
        const allow = new Set(['race']);
        const violations = __testing.findViolations('test.json', 'system', 'Do NOT extract or infer race or religion.', allow);
        expect(violations.some((v) => v.pattern === 'field:race')).toBe(false);
        expect(violations.some((v) => v.pattern === 'field:religion')).toBe(true);
    });
});

// The CI step (npm run lint:pii-prompts, .github/workflows/ai-gates.yml) runs
// this same scan; running it here too means a prompt that trips it fails the
// local suite, not only CI. It failed every CI run from May to October 2026 on
// the resume parser's own "do not extract" list before the allow list named it.
describe('every registered prompt passes the PII scan', () => {
    it('finds no violation in lib/ai/prompts', async () => {
        const violations = await __testing.scanPrompts();
        expect(violations).toEqual([]);
    });
});
