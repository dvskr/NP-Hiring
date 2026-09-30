/**
 * Employment type detection (indexing audit H-03 and M-06): fixtures are the
 * texts the audit found mislabelled on the live site.
 */
import { describe, it, expect } from 'vitest';
import {
  detectJobType,
  detectJobTypes,
  interpretJobTypeValue,
  labelledJobTypes,
  resolveJobType,
  statesW2Employment,
  stripJobTypeBoilerplate,
  titleJobTypes,
} from '@/lib/job-type-detection';
import { canonicalizeJobType, normalizeJobWithReason } from '@/lib/job-normalizer';

const ADVOCATE =
  'Nurse Practitioner Behavioral Health Full Time\n' +
  'Aurora Psychiatric Hospital 1220 Dewey Ave\n' +
  'Status: Full time\n' +
  'Shift: Day\n' +
  'Hours Per Week: 40\n' +
  'Provide psychiatric evaluation and medication management for adult inpatients on the unit.\n' +
  'Benefits: Our benefits are designed for the whole person (e.g., full-time, part-time, per diem, temporary). ' +
  'Premium pay is available for eligible team members.';

const HIGHMARK =
  'Provide primary care to patients in the clinic. Collaborate with physicians and staff.\n' +
  'California Consumer Privacy Act: Employees, Contractors, and Applicants Notice.\n' +
  'Highmark Health is an equal opportunity employer.';

const THRIVEWORKS =
  'Psychiatric Nurse Practitioner, Fee For Service (W2).\n' +
  'Provide telepsychiatry visits to adult clients. Build your own schedule.';

const COREWELL =
  'Employment Type Full time\n' +
  'Shift Day (United States of America)\n' +
  'Provide PRN coverage for the inpatient psychiatric unit when the attending is away.';

const CENTENE =
  'The position is full-time. Manage a panel of members. ' +
  'Work is performed under contractual arrangements with state Medicaid programs.';

const MULTICARE =
  'This position is covered by a union contract. Provide inpatient psychiatric care to pediatric patients.';

describe('detectJobType: the audit fixtures', () => {
  it('Advocate: "Status: Full time" wins over the benefits enumeration', () => {
    expect(resolveJobType({ canonicalAts: null, title: 'Nurse Practitioner Behavioral Health', description: ADVOCATE }).jobType).toBe('Full-Time');
    expect(detectJobType(ADVOCATE)).toBe('Full-Time');
    expect(labelledJobTypes(ADVOCATE)).toEqual(['Full-Time']);
  });

  it('Advocate: the "(e.g., full-time, part-time, per diem, temporary)" list alone states nothing', () => {
    expect(detectJobType('Our benefits vary (e.g., full-time, part-time, per diem, temporary).')).toBeNull();
  });

  it('Highmark: "Employees, Contractors, and Applicants Notice" is not a contract', () => {
    expect(detectJobType(HIGHMARK)).toBeNull();
  });

  it('Thriveworks: "Fee For Service (W2)" is W-2 employment, never a contract', () => {
    expect(detectJobType(THRIVEWORKS)).not.toBe('Contract');
    expect(resolveJobType({ canonicalAts: null, title: 'Psychiatric Nurse Practitioner', description: THRIVEWORKS })).toEqual({
      jobType: 'Full-Time',
      types: ['Full-Time'],
      source: 'w2',
    });
  });

  it('Corewell: "Employment Type Full time" beats "PRN coverage"', () => {
    expect(resolveJobType({ canonicalAts: null, title: 'NP/PA - Inpatient Psychiatry - St. Joseph', description: COREWELL }).jobType).toBe('Full-Time');
  });

  it('Centene: "contractual" is not a contract', () => {
    expect(detectJobType(CENTENE)).toBe('Full-Time');
  });

  it('MultiCare: "union contract" is not a contract', () => {
    expect(detectJobType(MULTICARE)).toBeNull();
  });

  it('Monarch: "Full Time ... 36 hours" is full time', () => {
    expect(resolveJobType({ canonicalAts: null, title: 'PMHNP', description: 'Hours per week: 36. Outpatient clinic.' }).jobType).toBe('Full-Time');
  });
});

describe('detectJobType: word boundaries and explicit contracts', () => {
  it.each<[string, string | null]>([
    ['1099 independent practice', 'Contract'],
    ['This is an independent contractor role.', 'Contract'],
    // Free text reads Contract only from 1099 or independent contractor: a
    // fixed-term assignment may be W-2 employment (H-03).
    ['A 6-month contract assignment in Dallas.', null],
    ['Contract position for 6 months', null],
    ['Contractors must follow the vendor policy.', null],
    ['fee for service reimbursement model', null],
    ['1099 or W-2 options are available.', 'Full-Time'],
    ['Must be a US citizen or permanent resident.', null],
    ['Per diem allowance for travel is included.', null],
    ['APRN license required.', null],
  ])('%s -> %s', (text, expected) => {
    expect(detectJobType(text)).toBe(expected);
  });
});

describe('detectJobTypes: both schedules', () => {
  it('returns both types when both are offered, first named first', () => {
    expect(detectJobTypes('We are hiring for full-time or part-time schedules.')).toEqual(['Full-Time', 'Part-Time']);
    expect(detectJobTypes('Part-time or full-time schedules available.')).toEqual(['Part-Time', 'Full-Time']);
    expect(titleJobTypes('PMHNP (FT/PRN)')).toEqual(['Full-Time', 'Per Diem']);
  });

  it('a benefits policy sentence about employee groups is ignored', () => {
    expect(detectJobTypes('Full-time and part-time employees are eligible for PTO. This per diem role covers weekends.'))
      .toEqual(['Per Diem']);
  });

  it('keeps a sentence that states this job is benefits eligible', () => {
    expect(detectJobType('This is a full-time, benefits-eligible position.')).toBe('Full-Time');
  });

  it('strips EEO and privacy sentences', () => {
    expect(stripJobTypeBoilerplate('Provide care.\nWe are an equal opportunity employer for full-time staff.')).toBe('Provide care.');
  });
});

describe('labelled values', () => {
  it.each<[string, string[]]>([
    ['Full time', ['Full-Time']],
    ['Regular Part-Time', ['Part-Time']],
    ['PRN', ['Per Diem']],
    ['Casual', ['Per Diem']],
    ['Contract', ['Contract']],
    ['1099', ['Contract']],
    // A temporary employee is not a contractor.
    ['Temporary', []],
    ['Temp', []],
    ['As Needed (PRN)', ['Per Diem']],
    ['PRN (as needed)', ['Per Diem']],
    ['Exempt', []],
  ])('%s -> %j', (value, expected) => {
    expect(interpretJobTypeValue(value)).toEqual(expected);
  });

  it('reads Job Type, Schedule and FTE lines', () => {
    expect(labelledJobTypes('Job Type: Part-time\nPsychiatric care.')).toEqual(['Part-Time']);
    expect(labelledJobTypes('Schedule: Part-time, Monday to Wednesday')).toEqual(['Part-Time']);
    expect(labelledJobTypes('FTE: 0.5')).toEqual(['Part-Time']);
    expect(labelledJobTypes('FTE: 1.0')).toEqual(['Full-Time']);
    expect(labelledJobTypes('Hours Per Week: 20')).toEqual(['Part-Time']);
  });

  it('never reads a status that names no type', () => {
    expect(labelledJobTypes('Status: Active license required')).toEqual([]);
  });
});

describe('resolveJobType precedence', () => {
  it('the ATS field wins, then the title, then a labelled line, then the text', () => {
    expect(resolveJobType({ canonicalAts: 'Part-Time', title: 'NP - Full Time', description: 'Status: Full time' }).source).toBe('ats');
    expect(resolveJobType({ canonicalAts: null, title: 'NP - Part Time', description: 'Status: Full time' })).toEqual({
      jobType: 'Part-Time', types: ['Part-Time'], source: 'title',
    });
    expect(resolveJobType({ canonicalAts: null, title: 'NP', description: 'Status: Full time. Weekend per diem coverage.' }).source).toBe('label');
    expect(resolveJobType({ canonicalAts: null, title: 'NP', description: 'We need a per diem NP.' }).source).toBe('text');
    expect(resolveJobType({ canonicalAts: null, title: 'NP', description: 'Psychiatric care.' })).toEqual({ jobType: null, types: [], source: null });
  });

  it('a bare "Contract" in the title is an explicit statement', () => {
    expect(resolveJobType({ canonicalAts: null, title: 'Nurse Practitioner - Contract', description: 'Clinic care.' }).jobType).toBe('Contract');
  });
});

/**
 * GAPS review blocker (H-03): "PRN" that names a medication or an order is
 * not a schedule. On this board the wording is common, and it used to turn
 * full-time roles into PER_DIEM.
 */
describe('H-03: PRN as a medication or order term is not per diem', () => {
  const resolve = (description: string, title = 'Nurse Practitioner') =>
    resolveJobType({ canonicalAts: null, title, description });

  it.each<[string, string]>([
    ['reviewing PRN medication orders', 'Responsibilities include reviewing PRN medication orders for the unit. This is a full-time position.'],
    ['order medications as needed (PRN)', 'Order medications as needed (PRN). We offer a full-time schedule.'],
    ['PRN and scheduled medications', 'You will manage PRN and scheduled medications for 20 patients. Full time, day shift.'],
    ['PRN meds', 'Administer PRN meds and document the response. This full-time role is on days.'],
  ])('%s, beside a full-time statement, is Full-Time', (_label, description) => {
    expect(resolve(description)).toMatchObject({ jobType: 'Full-Time', types: ['Full-Time'] });
  });

  it.each<[string]>([
    ['Order medications as needed (PRN).'],
    ['Review PRN orders daily.'],
    ['Provide PRN coverage for the unit.'],
  ])('%s alone states no type', (description) => {
    expect(resolve(description)).toEqual({ jobType: null, types: [], source: null });
  });

  it('PRN as a schedule still reads as per diem, in text, titles and labels', () => {
    expect(resolve('This is an as needed (PRN) position.').jobType).toBe('Per Diem');
    expect(resolve('Work on an as-needed (PRN) basis.').jobType).toBe('Per Diem');
    expect(resolve('We are hiring a PRN nurse practitioner for weekend shifts.').jobType).toBe('Per Diem');
    expect(resolve('Status: As Needed (PRN)')).toMatchObject({ jobType: 'Per Diem', source: 'label' });
    expect(resolve('Clinic care.', 'PRN Nurse Practitioner')).toMatchObject({ jobType: 'Per Diem', source: 'title' });
    expect(titleJobTypes('PMHNP (FT/PRN)')).toEqual(['Full-Time', 'Per Diem']);
    expect(titleJobTypes('NP - PRN Medication Management')).toEqual([]);
  });

  it('matches PRN only as a whole word', () => {
    expect(detectJobType('Sprint planning, sprn and prnt codes are not schedules.')).toBeNull();
  });
});

/**
 * Review blocker (H-03, second round): a clinical word written BEFORE "PRN",
 * or a clinical noun the first list missed, still read PRN as a schedule, so
 * a full-time job showed "Per Diem or Full-Time" and emitted
 * ['PER_DIEM', 'FULL_TIME'].
 */
describe('H-03: PRN after a medication word, or before a usage noun, is not per diem', () => {
  const resolve = (description: string, title = 'Psychiatric Nurse Practitioner') =>
    resolveJobType({ canonicalAts: null, title, description });

  it.each<[string]>([
    ['Order medications PRN as clinically indicated. Full-time.'],
    ['Administer meds PRN and document. Full-time.'],
    ['Document PRN effectiveness within one hour. Full-time.'],
    ['Manage PRN psych meds for the unit. Full-time.'],
    ['Prescribe PRN as clinically indicated. Full-time.'],
    ['Reassess the patient after each dose (PRN). Full-time.'],
  ])('%s is Full-Time only', (description) => {
    expect(resolve(description)).toMatchObject({ jobType: 'Full-Time', types: ['Full-Time'] });
  });

  it('PRN usage and PRN psychotropic orders alone state no type', () => {
    expect(resolve('Review PRN usage and PRN psychotropic orders weekly.')).toEqual({ jobType: null, types: [], source: null });
    expect(resolve('Track PRN utilization and PRN response on the unit.')).toEqual({ jobType: null, types: [], source: null });
  });

  it('PRN as a schedule still reads as per diem', () => {
    expect(resolve('We need NPs to cover shifts PRN.').jobType).toBe('Per Diem');
    expect(resolve('Must be available PRN for weekend coverage.').jobType).toBe('Per Diem');
    expect(resolve('Work on a PRN basis.').jobType).toBe('Per Diem');
    expect(resolve('Status: As Needed (PRN)')).toMatchObject({ jobType: 'Per Diem', types: ['Per Diem'], source: 'label' });
    expect(resolve('Clinic care.', 'PMHNP (FT/PRN)')).toMatchObject({ jobType: 'Full-Time', types: ['Full-Time', 'Per Diem'], source: 'title' });
    expect(resolve('Join our PRN team. Order medications PRN as clinically indicated.').jobType).toBe('Per Diem');
  });

  it('"administrative PRN" is a schedule, not a dosing verb', () => {
    expect(resolve('This is an administrative PRN position.').jobType).toBe('Per Diem');
  });
});

/**
 * Review blocker (H-03, third round): a route between PRN and its noun ("PRN
 * IM"), "on a PRN basis" after a medication word, the slash gloss "PRN/as
 * needed", and clinical nouns the lists missed (restraints, seclusion,
 * interventions) still read PRN as a schedule, so a full-time job showed
 * "Per Diem or Full-Time".
 */
describe('H-03: PRN with a route, a basis, a slash gloss or an intervention is not per diem', () => {
  const resolve = (description: string, title = 'Psychiatric Nurse Practitioner') =>
    resolveJobType({ canonicalAts: null, title, description });

  const CLINICAL_PRN: Array<[string, string]> = [
    ['Write PRN IM medication orders for agitation.', 'Full-time role.'],
    ['Administer medications on a PRN basis.', 'We offer a full-time schedule.'],
    ['Monitor PRN/as needed medications.', 'Full-time.'],
    ['Authorize PRN restraints and seclusion when needed.', 'Full-time role.'],
    ['Assess response to PRN interventions.', 'Full-time.'],
    ['Give medications on an as-needed (PRN) basis.', 'Full-time.'],
    ['Order PRN chemical restraint only as a last resort.', 'Full-time.'],
    ['Review PRN benzodiazepines and PRN hypnotics weekly.', 'Full-time.'],
  ];

  it.each(CLINICAL_PRN)('"%s %s" is Full-Time only', (duty, schedule) => {
    expect(resolve(`${duty} ${schedule}`)).toMatchObject({ jobType: 'Full-Time', types: ['Full-Time'] });
  });

  it.each(CLINICAL_PRN)('"%s" with no other type states none', (duty) => {
    expect(resolve(duty)).toEqual({ jobType: null, types: [], source: null });
  });

  it.each<[string, string, string[]]>([
    ['This is a PRN position.', 'Nurse Practitioner', ['Per Diem']],
    ['Work on a PRN basis.', 'Nurse Practitioner', ['Per Diem']],
    ['Work on an as-needed (PRN) basis.', 'Nurse Practitioner', ['Per Diem']],
    ['Cover shifts PRN.', 'Nurse Practitioner', ['Per Diem']],
    ['Status: PRN', 'Nurse Practitioner', ['Per Diem']],
    ['We are hiring a PRN Nurse Practitioner.', 'Nurse Practitioner', ['Per Diem']],
    ['Full-time and PRN positions available.', 'Nurse Practitioner', ['Full-Time', 'Per Diem']],
    ['Clinic care.', 'PMHNP (FT/PRN)', ['Full-Time', 'Per Diem']],
  ])('the schedule "%s" (title "%s") still reads %j', (description, title, types) => {
    expect(resolve(description, title).types).toEqual(types);
  });
});

/**
 * Review blocker (H-03, fourth round): the free-text PRN rule was a
 * blocklist of clinical nouns, and each round found phrasings it missed. It
 * is now an allowlist of schedule contexts: a PRN with no schedule word
 * around it states no type, so none of these medication and order texts can
 * turn a full-time job into "Per Diem or Full-Time".
 */
describe('H-03: free-text PRN counts only in a schedule context', () => {
  const resolve = (description: string, title = 'Psychiatric Nurse Practitioner') =>
    resolveJobType({ canonicalAts: null, title, description });

  const MEDICATION_AND_ORDER_PRN: string[] = [
    'Follow PRN protocols for agitation.',
    'Complete PRN documentation.',
    'Oversee PRN pain management.',
    'Give PRN Haldol and Ativan per protocol.',
    'Complete PRN assessments.',
    'Set PRN parameters.',
    'Provide PRN monitoring.',
    'Handle PRN management for residents.',
    'Review PRN lists weekly.',
    'Assess PRN needs.',
    'Reduce PRN frequency.',
    'Evaluate PRN trends.',
    'Order meds on an as needed basis (PRN).',
    'Track PRN medication usage (e.g., PRN Ativan, PRN Haldol).',
  ];

  it.each(MEDICATION_AND_ORDER_PRN)('"%s" beside a full-time schedule is Full-Time only', (duty) => {
    expect(resolve(`${duty} We offer a full-time schedule.`)).toEqual({ jobType: 'Full-Time', types: ['Full-Time'], source: 'text' });
  });

  it.each(MEDICATION_AND_ORDER_PRN)('"%s" alone states no type', (duty) => {
    expect(resolve(duty)).toEqual({ jobType: null, types: [], source: null });
    expect(detectJobTypes(duty)).toEqual([]);
  });

  it.each<[string]>([
    ['PRN coverage'],
    ['PRN weekends available'],
    ['Seeking PRN NPs'],
    ['PRN nights and evenings'],
    ['We need a PRN provider for the clinic.'],
    ['Work PRN hours that fit your life.'],
    ['Join as a PRN clinician.'],
  ])('the schedule "%s" still reads as Per Diem', (text) => {
    expect(detectJobType(text)).toBe('Per Diem');
    expect(resolve(text).types).toEqual(['Per Diem']);
  });

  it('PRN beside another schedule reads as both', () => {
    expect(detectJobTypes('Part-time or PRN schedules considered.')).toEqual(['Part-Time', 'Per Diem']);
    expect(detectJobTypes('Hiring FT/PRN providers.')).toEqual(['Per Diem']);
    expect(detectJobTypes('Full time, PRN also welcome.')).toEqual(['Full-Time', 'Per Diem']);
  });

  it('a schedule context never rescues a medication PRN', () => {
    expect(detectJobTypes('Haldol is a PRN medication for agitation.')).toEqual([]);
    expect(detectJobTypes('Must be available to write PRN medication orders.')).toEqual([]);
    expect(detectJobTypes('Full-time and PRN medication management.')).toEqual(['Full-Time']);
  });

  /*
   * Review blocker (H-03, fifth round): the allowlist accepted "is a PRN" but
   * not the plain self statement "This position is PRN", and it read PRN
   * beside another schedule only when PRN came second ("Part-time or PRN"),
   * so "PRN or part-time" lost its Per Diem half.
   */
  it.each<[string]>([
    ['This position is PRN.'],
    ['The position is PRN.'],
    ['This role is PRN.'],
    ['The role is PRN.'],
    ['Position is PRN'],
    ['This job will be PRN.'],
    ['The schedule is PRN.'],
  ])('the self statement "%s" reads as Per Diem', (text) => {
    expect(resolve(text)).toEqual({ jobType: 'Per Diem', types: ['Per Diem'], source: 'text' });
  });

  it('PRN named before another schedule reads as both, PRN first', () => {
    expect(resolve('PRN or part-time schedules considered.').types).toEqual(['Per Diem', 'Part-Time']);
    expect(resolve('PRN or full-time schedules available.').types).toEqual(['Per Diem', 'Full-Time']);
    expect(detectJobTypes('PRN/part-time openings.')).toEqual(['Per Diem', 'Part-Time']);
    expect(detectJobTypes('Part-time or PRN schedules considered.')).toEqual(['Part-Time', 'Per Diem']);
  });

  it.each<[string]>([
    ['The medication is PRN.'],
    ['The order is PRN.'],
    ['Haldol is PRN for agitation.'],
    ['This position is PRN medication focused.'],
  ])('"%s" is a medication or order statement, not a schedule', (text) => {
    expect(resolve(text)).toEqual({ jobType: null, types: [], source: null });
    expect(detectJobTypes(text)).toEqual([]);
  });

  it('a medication PRN before a schedule word states only that schedule', () => {
    expect(detectJobTypes('Give meds PRN, full-time position.')).toEqual(['Full-Time']);
    expect(detectJobTypes('Manage PRN medications or full-time coverage.')).toEqual(['Full-Time']);
  });
});

describe('H-03: Contract only from 1099 or an independent contractor, never beside W-2', () => {
  const resolve = (title: string, description: string, canonicalAts: string | null = null) =>
    resolveJobType({ canonicalAts, title, description });

  it('an independent contractor arrangement is Contract', () => {
    expect(resolve('NP', 'Paid as a 1099 independent contractor.').jobType).toBe('Contract');
  });

  it('a W-2 posting is never Contract, from the ATS, the title or the text', () => {
    expect(resolve('NP', 'This is a W-2 position.', 'Contract').jobType).not.toBe('Contract');
    expect(resolve('NP - Contract', 'W-2 employment with benefits.').jobType).not.toBe('Contract');
    expect(resolve('NP', '1099 or W-2 options are available.').jobType).not.toBe('Contract');
  });

  it('a vetoed contract beside W-2 is a fixed-term arrangement, never read as full time', () => {
    expect(resolve('NP', 'This is a W-2 position.', 'Contract')).toEqual({ jobType: null, types: [], source: null });
    expect(resolve('NP - Contract', 'W-2 employment with benefits.')).toEqual({ jobType: null, types: [], source: null });
    expect(resolve('NP', 'This is a W-2 contract position for 13 weeks.')).toEqual({ jobType: null, types: [], source: null });
  });

  it('W-2 alone still reads as full time (the Thriveworks rows)', () => {
    expect(resolve('Psychiatric Nurse Practitioner', THRIVEWORKS)).toEqual({ jobType: 'Full-Time', types: ['Full-Time'], source: 'w2' });
    expect(statesW2Employment('NP', THRIVEWORKS)).toBe(true);
    expect(statesW2Employment('NP', 'Clinic care.')).toBe(false);
  });

  it('a labelled "Temporary" is not a contract', () => {
    expect(resolve('NP', 'Employment Type: Temporary')).toEqual({ jobType: null, types: [], source: null });
  });
});

describe('canonicalizeJobType reads free-form ATS values', () => {
  it.each<[string, string | null]>([
    ['FULL_TIME', 'Full-Time'],
    ['Full time', 'Full-Time'],
    ['Full-Time Salaried', 'Full-Time'],
    ['Regular Part Time', 'Part-Time'],
    ['OTHER_EMPLOYMENT_TYPE', null],
    ['Healthcare', null],
    ['Regular', null],
  ])('%s -> %s', (raw, expected) => {
    expect(canonicalizeJobType(raw)).toBe(expected);
  });
});

describe('ingest stores the resolved type', () => {
  const raw = (over: Record<string, unknown>) => ({
    title: 'Nurse Practitioner Behavioral Health',
    company: 'Advocate Health',
    location: 'Milwaukee, WI',
    description: ADVOCATE,
    applyLink: 'https://aah.wd5.myworkdayjobs.com/en-US/External/job/x_R123',
    externalId: 'workday-aah-x_R123',
    ...over,
  });

  it('Advocate row: Full-Time, not Per Diem', () => {
    expect(normalizeJobWithReason(raw({}), 'workday').job?.jobType).toBe('Full-Time');
  });

  it('a Workday timeType beats the text', () => {
    expect(normalizeJobWithReason(raw({ jobType: 'Part time' }), 'workday').job?.jobType).toBe('Part-Time');
  });
});
