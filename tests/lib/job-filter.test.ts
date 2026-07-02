import { describe, it, expect } from 'vitest';
import { isRelevantJob } from '../../lib/utils/job-filter';

// NP Hiring pack regression suite. Cases derive from the donor fork's
// broadened all-NP + APRN-cohort classifier (PMHNP-Job-Board-Fork
// lib/utils/job-filter.ts, 2026-05-23): every NP specialty passes,
// non-NP provider classes and admin roles are vetoed.

describe('isRelevantJob — NP specialties previously blocked by the PMHNP pack (donor job-filter.ts:10-13)', () => {
    it('should PASS "Family Nurse Practitioner"', () => {
        expect(isRelevantJob('Family Nurse Practitioner', 'primary care clinic seeking an FNP')).toBe(true);
    });

    it('should PASS "Pediatric Nurse Practitioner"', () => {
        expect(isRelevantJob('Pediatric Nurse Practitioner', 'pediatric primary care role at our community clinic')).toBe(true);
    });

    it('should PASS "Women\'s Health Nurse Practitioner (WHNP-BC)"', () => {
        expect(isRelevantJob("Women's Health Nurse Practitioner (WHNP-BC)", 'OB/GYN practice seeking WHNP')).toBe(true);
    });

    it('should PASS "Acute Care Nurse Practitioner"', () => {
        expect(isRelevantJob('Acute Care Nurse Practitioner', 'ICU and step-down coverage')).toBe(true);
    });

    it('should PASS "Oncology Nurse Practitioner"', () => {
        expect(isRelevantJob('Oncology Nurse Practitioner', 'infusion center NP role')).toBe(true);
    });

    it('should PASS "Travel Nurse Practitioner - Med Surg"', () => {
        expect(isRelevantJob('Travel Nurse Practitioner - Med Surg', '13-week assignment')).toBe(true);
    });

    it('should PASS "Hospitalist Nurse Practitioner"', () => {
        expect(isRelevantJob('Hospitalist Nurse Practitioner', 'inpatient rounding team')).toBe(true);
    });

    it('should PASS "Urgent Care Nurse Practitioner"', () => {
        expect(isRelevantJob('Urgent Care Nurse Practitioner', 'walk-in clinic coverage')).toBe(true);
    });

    it('should PASS "Adult-Gerontology Acute Care Nurse Practitioner (AGACNP-BC)"', () => {
        expect(isRelevantJob('Adult-Gerontology Acute Care Nurse Practitioner (AGACNP-BC)', 'hospital medicine service')).toBe(true);
    });

    it('should PASS "Neonatal Nurse Practitioner (NICU)"', () => {
        expect(isRelevantJob('Neonatal Nurse Practitioner (NICU)', 'level III NICU coverage')).toBe(true);
    });

    it('should PASS a bare generic "Nurse Practitioner" title (donor job-filter.ts:8-9,21)', () => {
        expect(isRelevantJob('Nurse Practitioner', 'join our outpatient clinic full time')).toBe(true);
    });
});

describe('isRelevantJob — APRN cohort (CRNA / CNM / CNS) now in scope (donor job-filter.ts:135-148)', () => {
    it('should PASS "Certified Registered Nurse Anesthetist (CRNA)"', () => {
        expect(isRelevantJob('Certified Registered Nurse Anesthetist (CRNA)', 'anesthesia care team model')).toBe(true);
    });

    it('should PASS "Nurse Anesthetist"', () => {
        expect(isRelevantJob('Nurse Anesthetist', 'surgical services department')).toBe(true);
    });

    it('should PASS "Certified Nurse Midwife"', () => {
        expect(isRelevantJob('Certified Nurse Midwife', 'labor and delivery unit midwifery care')).toBe(true);
    });

    it('should PASS "Clinical Nurse Specialist - Med/Surg" (was a PMHNP-pack negative)', () => {
        expect(isRelevantJob('Clinical Nurse Specialist - Med/Surg', 'CNS role supporting nursing practice')).toBe(true);
    });
});

describe('isRelevantJob — Should Still Be Blocked (non-NP roles, donor job-filter.ts:163-261)', () => {
    it('should FAIL "Office Manager"', () => {
        expect(isRelevantJob('Office Manager', 'manage office operations at a clinic')).toBe(false);
    });

    it('should FAIL "Scheduling Coordinator"', () => {
        expect(isRelevantJob('Scheduling Coordinator', 'schedule patient appointments')).toBe(false);
    });

    it('should FAIL "Medical Director"', () => {
        expect(isRelevantJob('Medical Director', 'physician overseeing clinical operations')).toBe(false);
    });

    it('should FAIL "Registered Nurse"', () => {
        expect(isRelevantJob('Registered Nurse', 'RN in medical-surgical unit')).toBe(false);
    });

    it('should FAIL "Physical Therapist"', () => {
        expect(isRelevantJob('Physical Therapist', 'outpatient PT clinic')).toBe(false);
    });

    it('should FAIL "Social Worker - LCSW"', () => {
        expect(isRelevantJob('Social Worker - LCSW', 'licensed clinical social worker for mental health')).toBe(false);
    });

    it('should FAIL "Practice Manager"', () => {
        expect(isRelevantJob('Practice Manager', 'manage daily operations of a primary care practice')).toBe(false);
    });

    it('should FAIL "Director of Nursing"', () => {
        expect(isRelevantJob('Director of Nursing', 'oversee nursing staff in a hospital unit')).toBe(false);
    });

    it('should FAIL "Physician - Family Medicine"', () => {
        expect(isRelevantJob('Physician - Family Medicine', 'MD or DO for our family practice')).toBe(false);
    });

    it('should FAIL "Physician Assistant - Dermatology" (PA-only, not dual-role)', () => {
        expect(isRelevantJob('Physician Assistant - Dermatology', 'PA-C for busy dermatology practice')).toBe(false);
    });

    it('should FAIL "Pharmacist"', () => {
        expect(isRelevantJob('Pharmacist', 'retail pharmacy dispensing role')).toBe(false);
    });

    it('should FAIL "Medical Assistant"', () => {
        expect(isRelevantJob('Medical Assistant', 'clinical support staff')).toBe(false);
    });

    it('should FAIL "Psychiatrist" (physician, not NP)', () => {
        expect(isRelevantJob('Psychiatrist', 'outpatient psychiatry practice for an MD/DO')).toBe(false);
    });

    it('should FAIL "Licensed Practical Nurse (LPN)"', () => {
        expect(isRelevantJob('Licensed Practical Nurse (LPN)', 'long term care facility')).toBe(false);
    });
});

describe('isRelevantJob — Core PMHNP titles still pass (original niche in scope, donor job-filter.ts:90-106)', () => {
    it('should PASS "PMHNP"', () => {
        expect(isRelevantJob('PMHNP', 'psychiatric nurse practitioner role')).toBe(true);
    });

    it('should PASS "Psychiatric Nurse Practitioner"', () => {
        expect(isRelevantJob('Psychiatric Nurse Practitioner', 'full-time position in outpatient clinic')).toBe(true);
    });

    it('should PASS "Psychiatric Mental Health Nurse Practitioner"', () => {
        expect(isRelevantJob('Psychiatric Mental Health Nurse Practitioner', 'telehealth and in-person')).toBe(true);
    });

    it('should PASS "Nurse Practitioner - Psychiatry"', () => {
        expect(isRelevantJob('Nurse Practitioner - Psychiatry', 'behavioral health outpatient services')).toBe(true);
    });
});

describe('isRelevantJob — Previously Rejected Headway/Jooble Variants', () => {
    it('should PASS "Licensed Psychiatric NP"', () => {
        expect(isRelevantJob('Licensed Psychiatric NP', 'Headway licensed psychiatric nurse practitioner role')).toBe(true);
    });

    it('should PASS "Licensed Psychiatric Nurse Practitioner"', () => {
        expect(isRelevantJob('Licensed Psychiatric Nurse Practitioner', 'telehealth psychiatric care')).toBe(true);
    });

    it('should PASS "Licensed Psychiatric Nurse Practitioner (Virtual)"', () => {
        expect(isRelevantJob('Licensed Psychiatric Nurse Practitioner (Virtual)', 'virtual psychiatric NP role')).toBe(true);
    });
});
