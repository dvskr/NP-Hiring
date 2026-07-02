/**
 * classifyRelevance — sub-bucketed relevance gate, NP Hiring pack.
 *
 * Ported from the donor fork's broadened all-NP + APRN-cohort classifier
 * (PMHNP-Job-Board-Fork lib/utils/job-filter.ts, 2026-05-23). The donor
 * shipped no unit suite (only scripts/smoke-test.ts), so these cases pin
 * the donor's DOCUMENTED behavior (its header criteria + keyword lists)
 * against this template's tier/veto/rescue engine:
 *   - every NP specialty + APRN cohort passes,
 *   - generic "Nurse Practitioner" passes on its own,
 *   - dual-role NP-or-PA passes,
 *   - non-NP provider classes / admin roles are vetoed,
 *   - description-only NP mentions can't rescue an admin/generic title.
 */

import { describe, it, expect } from 'vitest';
import { classifyRelevance, isRelevantJob } from '@/lib/utils/job-filter';

describe('classifyRelevance — dual-role NP-or-PA postings (donor DUAL_ROLE_PATTERNS, job-filter.ts:269-292)', () => {
    it('Nurse Practitioner or Physician Assistant - Psychiatry Bethlehem', () => {
        const r = classifyRelevance(
            'Nurse Practitioner or Physician Assistant - Psychiatry Bethlehem (Full Time)',
            "St. Luke's is proud of...",
            "St. Luke's University Health Network",
        );
        expect(r).toEqual({ passes: true, reason: 'pass' });
    });

    it('Nurse Practitioner or Physician Assistant – Outpatient Adult Psychiatry', () => {
        const r = classifyRelevance(
            'Nurse Practitioner or Physician Assistant – Outpatient Adult Psychiatry - Cheshire, CT',
            'Specific experience in psychiatry...',
            'Hartford Healthcare',
        );
        expect(r.passes).toBe(true);
    });

    it('NP / Physician Assistant — desc recruits a Nurse Practitioner (hospital employer)', () => {
        const r = classifyRelevance(
            'NP / Physician Assistant',
            'Highland Hospital is seeking a Full Time Nurse Practitioner to join its growing Inpatient Psych team.',
            'Highland Hospital',
        );
        expect(r.passes).toBe(true);
    });

    it('dual-role in a non-psych specialty passes too (all-NP board)', () => {
        const r = classifyRelevance(
            'Nurse Practitioner or Physician Assistant - Cardiology',
            'Join our cardiology group.',
            'Heart Center of the Rockies',
        );
        expect(r.passes).toBe(true);
    });

    it('Mental Health Provider (Psychiatric PA or NP) - Augusta, GA', () => {
        const r = classifyRelevance(
            'Mental Health Provider (Psychiatric PA or NP) - Augusta, GA',
            'Geode Health is a rapidly growing, national provider of outpatient mental health services.',
            'Geode Health of Texas',
        );
        expect(r.passes).toBe(true);
    });
});

describe('classifyRelevance — Tier 2.5: employer-name signal (generic APP titles)', () => {
    it('passes a generic "Inpatient APP" title at a clinical employer when the JD recruits NPs', () => {
        const r = classifyRelevance(
            'Inpatient APP',
            'Join our nurse practitioner and physician assistant hospitalist team.',
            'St. Mary Medical Center',
        );
        expect(r.passes).toBe(true);
    });

    it('rejects a generic "Inpatient APP" title at a non-clinical employer (generic-title guard)', () => {
        const r = classifyRelevance(
            'Inpatient APP',
            'Join our nurse practitioner and physician assistant hospitalist team.',
            'Acme Staffing Group',
        );
        expect(r.passes).toBe(false);
        expect(r.reason).toBe('relevance_generic_title');
    });

    it('passes generic NP-or-PA title at an employer with no clinical name-pattern (title itself is the NP signal)', () => {
        const r = classifyRelevance(
            'Nurse Practitioner or Physician Assistant',
            '', // empty description (real fantastic-jobs-db case)
            'Senior PsychCare',
        );
        expect(r.passes).toBe(true);
    });

    it('passes generic APRN title (Tier-1 credential in title)', () => {
        const r = classifyRelevance(
            'Medical Services Advanced Practice Registered Nurse (APRN)',
            '',
            'KANZA MENTAL HEALTH AND GUIDANCE',
        );
        expect(r.passes).toBe(true);
    });

    it('passes bare "Nurse Practitioner Part Time" — generic NP titles are in-scope now (donor job-filter.ts:8-9)', () => {
        const r = classifyRelevance(
            'Nurse Practitioner Part Time',
            '',
            'Ascension Recovery Services',
        );
        expect(r.passes).toBe(true);
    });
});

describe('classifyRelevance — behavioral-health / SUD segment stays in scope', () => {
    it('passes NP/PA role in a MAT program', () => {
        const r = classifyRelevance(
            'Nurse Practitioner / PA - Outpt. MAT (Tuesday - Saturday)',
            'Outpatient medication-assisted treatment program...',
            'On Demand / New Day Recovery',
        );
        expect(r.passes).toBe(true);
    });

    it('passes NP role at substance-use treatment center', () => {
        const r = classifyRelevance(
            'Inpatient Nurse Practitioner',
            'Avenues Recovery Center is a nationwide network of substance use treatment centers...',
            'Avenues Recovery',
        );
        expect(r.passes).toBe(true);
    });

    it('passes addiction psychiatric NP', () => {
        const r = classifyRelevance(
            'Addiction Psychiatric Nurse Practitioner',
            '',
            'Some Org',
        );
        expect(r.passes).toBe(true);
    });
});

describe('classifyRelevance — sub-bucketed rejection reasons', () => {
    it('clearly non-NP returns relevance_no_keyword', () => {
        const r = classifyRelevance(
            'Software Engineer',
            'We are hiring a backend developer.',
            'Tech Co',
        );
        expect(r).toEqual({ passes: false, reason: 'relevance_no_keyword' });
    });

    it('generic APP title with description-only NP mention returns relevance_generic_title', () => {
        // Title is bare "Outpatient APP". Description mentions NPs, so Tier 1
        // (catch-all) passes, but the generic-title guard fires because the
        // title alone doesn't confirm NP and the employer is non-clinical.
        const r = classifyRelevance(
            'Outpatient APP',
            'We are seeking an advanced practice provider; nurse practitioner applicants welcome.',
            'Acme Staffing Group',
        );
        expect(r.passes).toBe(false);
        expect(r.reason).toBe('relevance_generic_title');
    });

    it('RN title whose JD mentions NPs returns relevance_wrong_role (donor step 3, job-filter.ts:427-439)', () => {
        const r = classifyRelevance(
            'Registered Nurse — Behavioral Health',
            'Our RNs work alongside nurse practitioners and physicians.',
            'Generic Hospital',
        );
        expect(r.passes).toBe(false);
        expect(r.reason).toBe('relevance_wrong_role');
    });

    it('admin title whose JD recruits NPs returns relevance_wrong_role (donor "Engagement Specialist" guard)', () => {
        const r = classifyRelevance(
            'Talent Community - Nurse Practitioners',
            'Join our talent community for future nurse practitioner openings.',
            'Big Health System',
        );
        expect(r.passes).toBe(false);
        expect(r.reason).toBe('relevance_wrong_role');
    });
});

describe('isRelevantJob (legacy boolean wrapper)', () => {
    it("still works for callers that don't pass employer", () => {
        expect(isRelevantJob('Family Nurse Practitioner', 'desc')).toBe(true);
        expect(isRelevantJob('Software Engineer', 'desc')).toBe(false);
    });

    it('matches classifyRelevance.passes when employer is omitted', () => {
        const cases: Array<[string, string]> = [
            ['Family Nurse Practitioner', ''],
            ['Software Engineer', ''],
            ['Nurse Practitioner', 'join our primary care clinic'],
            ['Registered Nurse', 'work alongside our nurse practitioners'],
        ];
        for (const [title, desc] of cases) {
            const bool = isRelevantJob(title, desc);
            const cls = classifyRelevance(title, desc, '');
            expect(bool).toBe(cls.passes);
        }
    });
});

describe('classifyRelevance — off-specialty veto shrinks to non-human-NP roles', () => {
    const PRIMARY_CARE_DESC =
        'Provide primary care: annual physicals, preventive screenings, chronic disease management. We also offer behavioral health services.';

    it('PASSES a Family NP at a primary-care employer (was the PMHNP pack\'s biggest veto — now in-scope, donor job-filter.ts:10-13)', () => {
        const r = classifyRelevance('Family Nurse Practitioner', PRIMARY_CARE_DESC, 'One Medical');
        expect(r).toEqual({ passes: true, reason: 'pass' });
    });

    it('PASSES a hospice NP-or-PA (hospice NP is an NP specialty)', () => {
        const r = classifyRelevance(
            'Hospice Nurse Practitioner or Physician Assistant-(Voorhees, NJ)',
            'Provide hospice and palliative care to patients in their homes.',
            'Ennoble Care',
        );
        expect(r.passes).toBe(true);
    });

    it('rejects a veterinary "nurse practitioner" title', () => {
        const r = classifyRelevance(
            'Veterinary Nurse Practitioner',
            'Provide nursing care to companion animals at our clinic.',
            'Happy Paws Veterinary Clinic',
        );
        expect(r.passes).toBe(false);
        expect(r.reason).toBe('relevance_wrong_role');
    });
});

describe('classifyRelevance — bare dual-role generic titles', () => {
    it('PASSES a bare "NP or PA" primary-care post (primary-care NPs are in-scope on the all-NP board)', () => {
        const r = classifyRelevance(
            'Per Diem Nurse Practitioner or Physician Assistant',
            'Deliver primary care: annual visits, preventive care, and behavioral health support.',
            'One Medical',
        );
        expect(r.passes).toBe(true);
    });

    it('passes a bare "NP or PA" contractor post at an allowlisted employer', () => {
        const r = classifyRelevance(
            'Prescribing Nurse Practitioner or Physician Assistant - Contractor',
            'Join our clinical team supporting members.',
            'Lyra Health',
        );
        expect(r.passes).toBe(true);
    });

    it('passes a dual-role post whose title says psychiatry', () => {
        expect(
            classifyRelevance('Nurse Practitioner or Physician Assistant - Psychiatry', 'desc', 'Anytown Health').passes,
        ).toBe(true);
    });

    it('passes a dual-role OTP/opioid-treatment post', () => {
        const r = classifyRelevance(
            'Physician Assistant / Nurse Practitioner (OTP)',
            'Opioid treatment program; methadone and buprenorphine prescribing for substance use disorder.',
            'Porch Light Health',
        );
        expect(r.passes).toBe(true);
    });
});

describe('classifyRelevance — donor-vs-engine divergences (documented, intentional)', () => {
    it('ENGINE STRICTER: "Medical Director - Nurse Practitioner Program" is vetoed (donor\'s title-positive short-circuit would pass it)', () => {
        // Donor job-filter.ts:406,423 passed ANY title containing a positive
        // ('nurse practitioner'); this pack keeps 'nurse practitioner' out of
        // Tier-1 so admin titles that merely mention it stay veto-able.
        const r = classifyRelevance(
            'Medical Director - Nurse Practitioner Program',
            'Physician leader overseeing our NP program.',
            'Big Health System',
        );
        expect(r.passes).toBe(false);
        expect(r.reason).toBe('relevance_wrong_role');
    });

    it('ENGINE STRICTER: description-only bare "NP" abbreviation without any spelled-out credential does not pass', () => {
        // Donor's word-boundary ' np ' positive matched description-only
        // bare "NP" mentions (donor job-filter.ts:37,442-447). A raw 'np'
        // substring is unsafe in this engine, so such posts (rare — real
        // JDs spell out "nurse practitioner" or a credential) are rejected.
        const r = classifyRelevance(
            'Provider - Cardiology',
            'The NP will see 18 patients daily.',
            'Heart Group',
        );
        expect(r.passes).toBe(false);
        expect(r.reason).toBe('relevance_no_keyword');
    });
});
