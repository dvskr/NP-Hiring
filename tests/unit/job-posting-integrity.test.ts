/**
 * The daily job-posting integrity check (indexing audit GFJ-01, GFJ-04,
 * CS-03): stub descriptions, work-mode invariants and drift, and the count
 * of jobs that emit no JobPosting location.
 */
import { describe, it, expect } from 'vitest';
import {
  evaluateJobPostingIntegrity,
  formatIntegrityAlert,
  MISSING_LOCATION_ALERT_SHARE,
  type IntegrityRow,
} from '@/app/api/cron/job-posting-integrity/evaluate';
import { planWorkModeRepair, workModeViolations } from '@/lib/work-mode-integrity';
import { CRON_BATCHES } from '@/config/cron-schedule';

const PROSE =
  'Provide psychiatric evaluation and medication management for adults. You will work closely with therapists, ' +
  'document visits in the EHR and take part in weekly case reviews.';

let seq = 0;
function row(overrides: Partial<IntegrityRow> = {}): IntegrityRow {
  seq += 1;
  return {
    id: `job-${seq}`,
    slug: `nurse-practitioner-job-${seq}`,
    title: 'Nurse Practitioner',
    employer: 'Acme Health',
    location: 'Austin, TX',
    description: `This clinic-based role is in person. ${PROSE}`,
    mode: 'In-Person',
    isRemote: false,
    isHybrid: false,
    isPublished: true,
    sourceType: 'external',
    city: 'Austin',
    state: 'Texas',
    stateCode: 'TX',
    country: 'US',
    ...overrides,
  };
}

describe('evaluateJobPostingIntegrity', () => {
  it('a consistent inventory is healthy', () => {
    const report = evaluateJobPostingIntegrity([row(), row(), row()]);
    expect(report.failures).toEqual([]);
    expect(report.scanned).toBe(3);
    expect(report.missingJobPostingLocation.count).toBe(0);
  });

  it('GFJ-04: a stub description fails the check', () => {
    const stub = row({
      title: 'PMHNP, Remote TX Part Time, Up to 90 an Hour',
      description: 'PMHNP, Remote TX Part Time, Up to 90 an Hour\nEmployer: Televero Health\nDepartment: Clinical\nEmployment: Part-Time\nLocation: United States',
    });
    const report = evaluateJobPostingIntegrity([row(), stub]);
    expect(report.stubDescriptions.count).toBe(1);
    expect(report.stubDescriptions.examples[0].id).toBe(stub.id);
    expect(report.failures.join(' ')).toMatch(/stub description/);
  });

  it('GFJ-01: an on-site job flagged remote fails (remote without evidence and drift)', () => {
    const corewell = row({
      title: 'NP/PA - Inpatient Psychiatry - St. Joseph',
      location: 'St. Joseph, MI',
      city: 'St. Joseph',
      state: 'Michigan',
      stateCode: 'MI',
      description: `Inpatient unit at Lakeland Hospital. ${PROSE}`,
      mode: 'Remote',
      isRemote: true,
    });
    const report = evaluateJobPostingIntegrity([corewell]);
    expect(report.workModeViolations.remote_without_evidence.count).toBe(1);
    expect(report.workModeFlagDrift.count).toBe(1);
    expect(report.falseRemoteDrift).toBe(1);
    expect(report.failures.length).toBeGreaterThanOrEqual(2);
  });

  it('GFJ-01: both flags true fails', () => {
    const both = row({ mode: 'Hybrid', isRemote: true, isHybrid: true, description: `Hybrid schedule, two days remote. ${PROSE}` });
    const report = evaluateJobPostingIntegrity([both]);
    expect(report.workModeViolations.both_flags.count).toBe(1);
  });

  it('CS-03: counts jobs with no JobPosting location and fails only above the alert share', () => {
    const noPlace = () => row({ location: '2 Locations', city: null, state: null, stateCode: null });
    const few = evaluateJobPostingIntegrity([noPlace(), ...Array.from({ length: 30 }, () => row())]);
    expect(few.missingJobPostingLocation.count).toBe(1);
    expect(few.missingJobPostingLocation.share).toBeLessThan(MISSING_LOCATION_ALERT_SHARE);
    expect(few.failures).toEqual([]);

    const many = evaluateJobPostingIntegrity([noPlace(), noPlace(), row(), row()]);
    expect(many.missingJobPostingLocation.share).toBe(0.5);
    expect(many.failures.join(' ')).toMatch(/no JobPosting location/);
  });

  it('formats an alert with example URLs', () => {
    const stub = row({ description: 'Nurse Practitioner\nEmployer: Acme\nDepartment: Clinical' });
    const text = formatIntegrityAlert(evaluateJobPostingIntegrity([stub]), 'https://nphiring.com');
    expect(text).toContain(`https://nphiring.com/jobs/${stub.slug}`);
    expect(text.length).toBeLessThanOrEqual(1900);
  });
});

describe('workModeViolations and planWorkModeRepair', () => {
  it('flags every inconsistent pair', () => {
    expect(workModeViolations(row({ mode: 'Remote', isRemote: false, location: 'Remote' }))).toContain('flags_disagree_with_mode');
    expect(workModeViolations(row({ mode: 'In-Person', isHybrid: true }))).toContain('flags_disagree_with_mode');
    expect(workModeViolations(row({ mode: null, isRemote: false, isHybrid: false }))).toEqual([]);
    expect(workModeViolations(row({ mode: 'Remote', isRemote: true, location: 'Remote', description: `Fully remote role. ${PROSE}` }))).toEqual([]);
  });

  it('employer-declared modes are authoritative', () => {
    const employer = row({ sourceType: 'employer', mode: 'Remote', isRemote: true, location: 'Austin, TX', description: `On-site clinic. ${PROSE}` });
    expect(planWorkModeRepair(employer)).toBeNull();
  });

  it('reads an ATS "Remote Type" line as the structured mode, as ingest does', () => {
    const mgb = row({ title: 'NP (Remote)', mode: 'Remote', isRemote: true, description: `Remote Type Onsite\n${PROSE}` });
    expect(planWorkModeRepair(mgb)).toMatchObject({ newMode: 'In-Person', newIsRemote: false });
  });
});

describe('scheduling', () => {
  it('runs in the daily batch ahead of index-urls', () => {
    const daily = CRON_BATCHES.find((b) => b.group === 'daily');
    const paths = daily?.targets.map((t) => t.path) ?? [];
    expect(paths).toContain('/api/cron/job-posting-integrity');
    expect(paths.indexOf('/api/cron/job-posting-integrity')).toBeLessThan(paths.indexOf('/api/cron/index-urls'));
  });
});
