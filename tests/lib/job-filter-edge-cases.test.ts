import { describe, it, expect } from 'vitest';
import { isRelevantJob } from '../../lib/utils/job-filter';

// Edge cases for the NP Hiring pack (all-NP + APRN cohort). Structure
// mirrors the template's PMHNP edge suite; assertions are NP ones.

describe('isRelevantJob — Edge cases', () => {
    it('handles empty title with relevant description', () => {
        // Filter still passes because description contains an NP credential
        expect(isRelevantJob('', 'seeking a family nurse practitioner')).toBe(true);
    });

    it('handles empty description', () => {
        expect(isRelevantJob('PMHNP', '')).toBe(true);
    });

    it('handles bare NP-specialty title with empty description', () => {
        expect(isRelevantJob('Nurse Practitioner', '')).toBe(true);
    });

    it('handles both empty', () => {
        expect(isRelevantJob('', '')).toBe(false);
    });

    it('handles very long title (500+ chars)', () => {
        const longTitle = 'Family Nurse Practitioner ' + 'A'.repeat(500);
        expect(isRelevantJob(longTitle, 'primary care')).toBe(true);
    });

    it('handles unicode characters in title', () => {
        expect(isRelevantJob('CRNA — Certified Registered Nurse Anesthetist™', 'anesthesia role')).toBe(true);
    });

    it('handles title with ONLY negative keyword (no positive match)', () => {
        expect(isRelevantJob('Medical Coding Specialist', 'coding and billing for healthcare')).toBe(false);
    });

    it('handles title where negative keyword is substring of valid word', () => {
        // "coding" should not match inside "clinical coding guidelines"
        expect(isRelevantJob('Family Nurse Practitioner', 'familiar with clinical coding guidelines')).toBe(true);
    });

    it('passes case-insensitive "fnp-c"', () => {
        expect(isRelevantJob('fnp-c opening', 'job opening')).toBe(true);
    });

    it('passes case-insensitive "FNP-C"', () => {
        expect(isRelevantJob('FNP-C Opening', 'job opening')).toBe(true);
    });

    it('passes bare dual-role "NP/PA" title (donor accepted via \\bnp\\b)', () => {
        expect(isRelevantJob('NP/PA - Urgent Care', 'staff our urgent care clinics')).toBe(true);
    });

    it('blocks veterinary nurse practitioner (non-human NP role)', () => {
        // Donor note: the donor's title-positive short-circuit would have
        // passed this; the template engine's negative check vetoes it —
        // kept intentionally ('veterinary' NEGATIVE_KEYWORDS addition).
        expect(isRelevantJob('Veterinary Nurse Practitioner', 'animal care clinic')).toBe(false);
    });

    it('blocks veterinary technician (no NP signal at all)', () => {
        expect(isRelevantJob('Veterinary Technician', 'animal hospital support role')).toBe(false);
    });

    it('blocks medical assistant roles', () => {
        expect(isRelevantJob('Medical Assistant', 'clinical support staff')).toBe(false);
    });

    it('handles title with both positive and negative keywords', () => {
        // "PMHNP" is positive; even with "Medical Assistant" in the title it
        // should still pass because the title carries a Tier-1 credential.
        expect(isRelevantJob('PMHNP / Medical Assistant supervisor', 'psychiatric care')).toBe(true);
    });

    it('does not false-positive on "scrna" (single-cell RNA) in descriptions', () => {
        // The donor's ' crna ' padding lesson (donor job-filter.ts:29-32):
        // research postings mentioning scRNA-seq must not match the CRNA
        // credential.
        expect(isRelevantJob('Research Scientist', 'experience with scrna sequencing pipelines')).toBe(false);
    });
});
