/**
 * Category-tagger classifier tests — 42-slug NP taxonomy (2026-07).
 *
 * The classifier is the single source of truth for `Job.categoryTags`;
 * every taxonomy×state / taxonomy×city page gates on its output via
 * `categoryTags: { has: <slug> }`. These tests pin:
 *
 *   1. Registry sync — the tagger's canonical slug list must equal the
 *      taxonomy registry (drift here means pages that can never match).
 *   2. Title-anchored specialty rules — obvious-match + must-NOT-match
 *      pairs for the new NP specialty / APRN slugs.
 *   3. Exclusion chains (P9 lesson) — one job must not land on several
 *      sibling specialty pages at once.
 *   4. Word-boundary regressions — 'PRN' vs 'APRN', 'ICU' vs 'NICU',
 *      'hospital' vs 'hospitalist', 'CNS' vs "CNS depressants".
 */
import { describe, it, expect } from 'vitest';
import {
    classifyJobTags,
    CANONICAL_CATEGORY_SLUGS,
    type ClassifiableJob,
} from '@/lib/pseo/category-tagger';
import { ALL_CATEGORY_SLUGS } from '@/lib/pseo/taxonomy-registry';

function tags(job: Partial<ClassifiableJob> & { title: string }): string[] {
    return classifyJobTags(job);
}

describe('canonical slug list — registry sync', () => {
    it('matches lib/pseo/taxonomy-registry.ts exactly (42 slugs)', () => {
        expect(CANONICAL_CATEGORY_SLUGS).toHaveLength(42);
        expect([...CANONICAL_CATEGORY_SLUGS].sort()).toEqual([...ALL_CATEGORY_SLUGS].sort());
    });

    it('no longer carries the dropped PMHNP-era slugs', () => {
        for (const legacy of ['addiction', 'substance-abuse', 'child-adolescent', 'behavioral-health', 'crisis']) {
            expect(CANONICAL_CATEGORY_SLUGS).not.toContain(legacy);
        }
    });
});

describe('NP specialty rules — obvious match / must-not-match', () => {
    it('family-practice: FNP titles match', () => {
        expect(tags({ title: 'Family Nurse Practitioner (FNP)' })).toContain('family-practice');
        expect(tags({ title: 'FNP - Outpatient Clinic' })).toContain('family-practice');
    });
    it('family-practice: psych titles do not match', () => {
        expect(tags({ title: 'Psychiatric Mental Health Nurse Practitioner' })).not.toContain('family-practice');
    });

    it('anesthesia: CRNA titles match', () => {
        expect(tags({ title: 'CRNA - Cardiac Surgery Team' })).toContain('anesthesia');
        expect(tags({ title: 'Certified Registered Nurse Anesthetist' })).toContain('anesthesia');
    });
    it('anesthesia: non-CRNA NP titles do not match', () => {
        expect(tags({ title: 'Family Nurse Practitioner' })).not.toContain('anesthesia');
    });

    it('midwifery: CNM titles match', () => {
        expect(tags({ title: 'Certified Nurse Midwife (CNM)' })).toContain('midwifery');
        expect(tags({ title: 'CNM - Labor & Delivery' })).toContain('midwifery');
    });
    it('midwifery: WHNP titles do not match', () => {
        const t = tags({ title: "Women's Health Nurse Practitioner (WHNP)" });
        expect(t).toContain('women-health');
        expect(t).not.toContain('midwifery');
    });

    it('clinical-nurse-specialist: CNS titles match', () => {
        expect(tags({ title: 'Clinical Nurse Specialist - Med/Surg' })).toContain('clinical-nurse-specialist');
        expect(tags({ title: 'Oncology CNS' })).toContain('clinical-nurse-specialist');
    });
    it('clinical-nurse-specialist: "CNS depressants" in a psych description does not match (title-only rule)', () => {
        const t = tags({
            title: 'Psychiatric Nurse Practitioner',
            description: 'Prescribe and manage CNS stimulants and CNS depressants per protocol.',
        });
        expect(t).not.toContain('clinical-nurse-specialist');
        expect(t).toContain('psychiatric-mental-health');
    });

    it('psychiatric-mental-health: PMHNP titles match', () => {
        expect(tags({ title: 'PMHNP - Telepsychiatry' })).toContain('psychiatric-mental-health');
        expect(tags({ title: 'Mental Health Nurse Practitioner' })).toContain('psychiatric-mental-health');
    });
    it('psychiatric-mental-health: family practice titles do not match', () => {
        expect(tags({ title: 'Family Practice Nurse Practitioner' })).not.toContain('psychiatric-mental-health');
    });

    it('oncology: onc/heme titles match', () => {
        expect(tags({ title: 'Hematology/Oncology Nurse Practitioner' })).toContain('oncology');
    });
    it('oncology: dermatology titles do not match', () => {
        expect(tags({ title: 'Dermatology Nurse Practitioner' })).not.toContain('oncology');
    });

    it('cardiology: cardiovascular titles match', () => {
        expect(tags({ title: 'Heart Failure Nurse Practitioner' })).toContain('cardiology');
        expect(tags({ title: 'Cardiovascular NP - Cath Lab' })).toContain('cardiology');
    });
    it('cardiology: oncology titles do not match', () => {
        expect(tags({ title: 'Oncology Nurse Practitioner' })).not.toContain('cardiology');
    });

    it('emergency: EM titles match', () => {
        expect(tags({ title: 'Emergency Medicine Nurse Practitioner' })).toContain('emergency');
    });
    it('emergency: urgent-care titles do not match', () => {
        const t = tags({ title: 'Urgent Care Nurse Practitioner' });
        expect(t).toContain('urgent-care');
        expect(t).not.toContain('emergency');
    });

    it('neonatal: NNP/NICU titles match', () => {
        expect(tags({ title: 'Neonatal Nurse Practitioner (NNP)' })).toContain('neonatal');
        expect(tags({ title: 'NNP - Level III NICU' })).toContain('neonatal');
    });
    it('neonatal: NICU title does not leak into acute-care via the ICU token', () => {
        expect(tags({ title: 'Neonatal Nurse Practitioner - Level III NICU' })).not.toContain('acute-care');
    });

    it('pediatric: PNP titles match', () => {
        expect(tags({ title: 'Pediatric Nurse Practitioner (PNP)' })).toContain('pediatric');
    });
    it('pediatric: adult-gerontology titles do not match', () => {
        expect(tags({ title: 'Adult-Gerontology Nurse Practitioner' })).not.toContain('pediatric');
    });

    it('adult-gerontology: AGNP/AGACNP titles match', () => {
        expect(tags({ title: 'Adult-Gerontology Primary Care Nurse Practitioner' })).toContain('adult-gerontology');
        expect(tags({ title: 'AGACNP - Trauma Service' })).toContain('adult-gerontology');
    });

    it('acute-care: ICU / critical-care titles match', () => {
        expect(tags({ title: 'Acute Care Nurse Practitioner - ICU' })).toContain('acute-care');
        expect(tags({ title: 'Critical Care NP' })).toContain('acute-care');
    });

    it('hospitalist: matches without dragging in the hospital employer tag', () => {
        const t = tags({ title: 'Hospitalist Nurse Practitioner' });
        expect(t).toContain('hospitalist');
        expect(t).not.toContain('hospital');
    });
    it('hospital employer tag still fires for plain hospital titles', () => {
        expect(tags({ title: 'Nurse Practitioner - Regional Medical Center' })).toContain('hospital');
    });
});

describe('exclusion chains (P9 sibling dedupe)', () => {
    it('pediatric psych roles land on psychiatric-mental-health only', () => {
        const t = tags({ title: 'Pediatric Psychiatric Nurse Practitioner' });
        expect(t).toContain('psychiatric-mental-health');
        expect(t).not.toContain('pediatric');
    });

    it('pediatric/neonatal combo titles land on neonatal only', () => {
        const t = tags({ title: 'Pediatric/Neonatal Nurse Practitioner' });
        expect(t).toContain('neonatal');
        expect(t).not.toContain('pediatric');
    });

    it('psychiatric emergency roles land on psychiatric-mental-health, not emergency', () => {
        const t = tags({ title: 'Psychiatric Emergency Services Nurse Practitioner' });
        expect(t).toContain('psychiatric-mental-health');
        expect(t).not.toContain('emergency');
    });

    it('FNP primary-care titles land on family-practice only', () => {
        const t = tags({ title: 'FNP - Primary Care Clinic' });
        expect(t).toContain('family-practice');
        expect(t).not.toContain('primary-care');
    });
    it('plain primary-care titles still tag primary-care', () => {
        expect(tags({ title: 'Primary Care Nurse Practitioner' })).toContain('primary-care');
    });

    it('outpatient excludes itself when inpatient also matched', () => {
        const t = tags({ title: 'Inpatient/Outpatient Psychiatric NP' });
        expect(t).toContain('inpatient');
        expect(t).not.toContain('outpatient');
    });

    it('entry-level defers to new-grad (alias canonicalization)', () => {
        const t = tags({ title: 'Entry-Level New Grad Nurse Practitioner Fellowship' });
        expect(t).toContain('new-grad');
        expect(t).not.toContain('entry-level');
    });

    it('mid-career defers to senior', () => {
        const t = tags({ title: 'Experienced Lead Nurse Practitioner' });
        expect(t).toContain('senior');
        expect(t).not.toContain('mid-career');
    });

    it('generic veterans mentions defer to the VA tag when the employer is the VA', () => {
        const t = tags({
            title: 'Nurse Practitioner',
            description: 'Join the VA Medical Center team serving veterans across the region.',
        });
        expect(t).toContain('va');
        expect(t).not.toContain('veterans');
    });
});

describe('job-type + word-boundary regressions', () => {
    it('per-diem: PRN in the title matches', () => {
        expect(tags({ title: 'Nurse Practitioner (PRN)' })).toContain('per-diem');
        expect(tags({ title: 'PRN Family Nurse Practitioner' })).toContain('per-diem');
    });

    it("per-diem: 'APRN' anywhere must NOT trigger the PRN keyword", () => {
        const t = tags({
            title: 'APRN - Nurse Practitioner',
            description: 'Seeking an APRN to join our outpatient clinic full of APRN colleagues.',
        });
        expect(t).not.toContain('per-diem');
    });

    it('full-time via structural jobType; part-time defers to full-time', () => {
        expect(tags({ title: 'Nurse Practitioner', jobType: 'Full-time' })).toContain('full-time');
        const both = tags({ title: 'Nurse Practitioner - Full Time or Part Time' });
        expect(both).toContain('full-time');
        expect(both).not.toContain('part-time');
    });

    it('remote via structural isRemote', () => {
        expect(tags({ title: 'Nurse Practitioner', isRemote: true })).toContain('remote');
    });

    it('new setting slugs: urgent-care and home-health', () => {
        expect(tags({ title: 'Urgent Care NP - Evenings' })).toContain('urgent-care');
        expect(tags({ title: 'Home Health Nurse Practitioner' })).toContain('home-health');
    });
});

describe('output determinism', () => {
    it('returns tags in canonical slug order', () => {
        const t = tags({
            title: 'Remote Telehealth PMHNP - Full-Time',
            isRemote: true,
            jobType: 'Full-Time',
        });
        expect(t).toEqual(['remote', 'telehealth', 'full-time', 'psychiatric-mental-health']);
    });

    it('same input → same output', () => {
        const job = { title: 'CRNA - Ambulatory Surgery Center', jobType: 'Full-time' };
        expect(tags(job)).toEqual(tags(job));
    });
});
