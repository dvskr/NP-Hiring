/**
 * Work mode and location at ingest (indexing audit GFJ-01, GFJ-02, CS-03):
 * fixtures are the texts the audit found misread on the live site.
 */
import { describe, it, expect } from 'vitest';
import {
  detectAtsRemoteType,
  detectMode,
  hasRemoteEvidence,
  mapAtsWorkMode,
  withoutNegatedModeStatements,
} from '@/lib/work-mode-detection';
import { normalizeJobWithReason } from '@/lib/job-normalizer';
import { planWorkModeRepair } from '@/lib/work-mode-integrity';
import {
  COMMON_NAME_TOWN_SLUGS,
  isKnownTown,
  isTownNamedLikeState,
  resolveLocationFallback,
  titleLocationCandidates,
  titleStateMentions,
} from '@/lib/location-fallback';
import { namesNonTownTitleWord, plausibleLocality } from '@/lib/locality';
import { CITIES } from '@/lib/pseo/city-data/cities';
import { CITY_SLUGS } from '@/lib/pseo/city-data/city-slugs-edge';
import { parseWorkdayDetail, resolveWorkdayLocation } from '@/lib/aggregators/workday';
import { greenhouseEmploymentType } from '@/lib/aggregators/greenhouse';
import { isVerifiedFullyRemote, resolveJobPlaces } from '@/app/jobs/[slug]/job-posting-facts';

const BODY =
  'Provide psychiatric evaluation and medication management for adults. Collaborate with therapists and a ' +
  'supervising psychiatrist, document visits in the EHR and take part in weekly case reviews. An active ' +
  'license and DEA registration are required. We offer paid time off and continuing education support.';

describe('detectMode: the audit fixtures', () => {
  it('Clover "Home-Based Care" is field work, not remote', () => {
    expect(detectMode('Nurse Practitioner, Home-Based Care. Visit members in their homes across the county.')).not.toBe('Remote');
    // GFJ-01 review: "home-based" alone is not remote, even as "home-based position".
    expect(detectMode('This is a home-based position; you will see patients by video.')).not.toBe('Remote');
    expect(detectMode('This is a home-based, remote position.')).toBe('Remote');
  });

  it('Seven Starling "Flexible Schedule, 100% Remote" is remote', () => {
    expect(detectMode('Flexible Schedule • 100% Remote • Perinatal psychiatry')).toBe('Remote');
  });

  it('"flexible schedule" alone is not hybrid', () => {
    expect(detectMode('Clinic-based role with a flexible schedule.')).toBe('In-Person');
    expect(detectMode('We offer a flexible schedule.')).toBeNull();
  });

  it('LifeStance "NOT a 100% remote position" is not remote', () => {
    expect(detectMode('Please note this is NOT a 100% remote position and requires some level of in-office presence.')).toBe('Hybrid');
    expect(detectMode('This is not a remote position. Patients are seen in our clinic.')).toBe('In-Person');
  });

  it('a Workday "Remote Type" field decides over other remote words', () => {
    const mgb = 'Remote Type Onsite Work Location 60 Fenwood Road. Our team uses remote patient monitoring and works from home on admin days.';
    expect(detectAtsRemoteType(mgb)).toBe('In-Person');
    expect(detectMode(mgb)).toBe('In-Person');
    expect(detectMode('Remote Type: Hybrid')).toBe('Hybrid');
    expect(detectMode('Remote Type Remote')).toBe('Remote');
  });

  it('an explicit 100% remote statement beats hybrid wording', () => {
    expect(detectMode('Our hybrid care model. This role is fully remote.')).toBe('Remote');
  });

  it('keeps the earlier rules: bare "remote" and bare "telehealth" are not remote', () => {
    expect(detectMode('Our team uses remote patient monitoring tools. This role is on-site at our clinic.')).toBe('In-Person');
    expect(detectMode('Experience with telehealth visits preferred.')).toBeNull();
    expect(detectMode('3 days in office, 2 days remote')).toBe('Hybrid');
    expect(detectMode('Telecommute')).toBe('Remote');
  });

  it('maps ATS work-mode fields', () => {
    expect(mapAtsWorkMode('remote')).toBe('Remote');
    expect(mapAtsWorkMode('on-site')).toBe('In-Person');
    expect(mapAtsWorkMode('Onsite')).toBe('In-Person');
    expect(mapAtsWorkMode('hybrid')).toBe('Hybrid');
    expect(mapAtsWorkMode('unspecified')).toBeNull();
    expect(mapAtsWorkMode(undefined)).toBeNull();
  });

  it('remote evidence is broader than a mode statement', () => {
    expect(hasRemoteEvidence('Visits are by telehealth.')).toBe(true);
    expect(hasRemoteEvidence('Inpatient unit at Lakeland Hospital.')).toBe(false);
  });
});

/**
 * GFJ-01 review: a negated telework, virtual, work from home or remote
 * statement was read as a claim. The VA announcement template on USAJOBS
 * ("Telework: Not Available", "Virtual: This is not a virtual position.")
 * stored an in-person VA medical center job as Remote, listed it on
 * /jobs/remote and could publish TELECOMMUTE. None of these may read Remote
 * or Hybrid.
 */
describe('detectMode: negated remote statements are on site', () => {
  const NEGATIONS = [
    'Telework: Not Available',
    'Telework: Not Authorized',
    'Telework eligible: No',
    'Telework Eligible: No - Telework is not available for this position.',
    'Telework Eligibility: Not eligible',
    'Telework: Ad hoc',
    'Telework: Situational',
    'Virtual: This is not a virtual position.',
    'Telework: Not Available\nVirtual: This is not a virtual position.',
    'This is not a work from home position.',
    'This position is not a work-from-home position.',
    'This position is not remote-eligible.',
    'Work From Home: No',
    'WFH: No',
    'No WFH.',
    'No telecommuting.',
    'Telecommuting is not available.',
    'Telecommute: No',
    'Telecommute Eligible: No',
    'This position is not eligible for telework.',
    'This position is not eligible for telework or remote work.',
    'This is not a telework position.',
    'This position is not telework eligible.',
    'We do not offer telework.',
    'Telework is not an option for this role.',
    'no work from home',
    'Not eligible for work from home.',
    'Work from home is not an option.',
    'Working from home is not permitted.',
    'not eligible for remote work',
    'This position is not eligible for remote work.',
    'Remote work: Not available',
    'Remote work not permitted.',
    'Remote options are not available.',
    'Remote: No',
    'Remote Job: No',
    'Remote Work Eligible: No',
    'Remote-eligible: No',
    'Is this position remote? No.',
    'This role is not remote.',
    'This is a non-remote position.',
    'This role cannot be performed remotely.',
    'Hybrid or remote work is not available.',
    'This is not a virtual role.',
    'This is an in-person position; telework is not available.',
    // GFJ-01 review 3: contractions, "unable to", and dash fields with text after them on the line.
    "Telework isn't available.",
    "WFH isn't possible.",
    "Telecommuting isn't an option.",
    "Work from home isn't an option.",
    "Remote options aren't available.",
    'Telework is not currently available.',
    'Telework will not be authorized for this position.',
    'We are unable to offer work from home.',
    'We are not able to offer telework.',
    'Telework - No',
    'Work From Home - No',
    'WFH - No',
    'Telecommute - No',
    'Remote Job - No',
    'Telework Eligible - No',
    'Telework/Remote - No',
    'Telework - Not Available',
    'Telework - Ad hoc',
    // GFJ-01 review 4: any negator shortly before a term in the same clause, or a term followed by
    // a negated verb or a prohibition, is a denial; the wording is not enumerated.
    'This is not currently a remote position.',
    'This will not be a remote position.',
    'This is not considered a remote position.',
    'This position is not available for telework.',
    'This position is not available for work from home.',
    'Work from home is prohibited.',
    'Telework is prohibited for this position.',
    'This position does not qualify for telework.',
    'There is no option to work from home.',
    'There is no opportunity to work from home.',
    'You cannot work from home in this role.',
    'You will not be able to work from home.',
    'We do not currently offer telework.',
    'This role does not allow for telework.',
    'This role does not allow for work from home.',
    'Telework will not be considered.',
    'Telework is not an available option for this position.',
    'This role is not open to telework.',
    'This role is not open to work from home.',
    'Telework is not granted for this position.',
    // The same beyond the reviewer's list: other negators and verbs.
    "Telework won't be considered for this role.",
    'Telework is unavailable for this position.',
    'Telework does not apply to this position.',
    'Remote work is strictly prohibited.',
    'This role is neither remote nor hybrid.',
    'None of our roles are remote.',
    'This position is not eligible or approved for telework.',
    // A field whose value starts with not or never.
    'Telework: Not at this time',
    'Work from home: not at this time.',
    'Telework | Not currently',
  ];

  it.each(NEGATIONS)('%s', (text) => {
    expect(detectMode(text)).toBe('In-Person');
    expect(detectMode(`${text} ${BODY}`)).toBe('In-Person');
    expect(detectMode(`${text}\n${BODY}`)).toBe('In-Person');
  });

  it('a dash field at the end of a description is read before the location joins it (ingest text shape)', () => {
    expect(detectMode(`NP ${BODY} Telework - No Tampa, FL`)).toBe('In-Person');
    expect(detectMode(`NP ${BODY} Work From Home - No Tampa, FL`)).toBe('In-Person');
    expect(detectMode(`NP ${BODY} Telework Eligible - No Tampa, FL`)).toBe('In-Person');
    expect(withoutNegatedModeStatements(`${BODY}\nTelework - No`)).not.toMatch(/telework/i);
  });

  it('a perk after a dash or colon "no" is not a negated field', () => {
    expect(detectMode('Work from home - no commute. Remote position.')).toBe('Remote');
    expect(detectMode('Remote Role - No Weekends. Work from home.')).toBe('Remote');
    expect(detectMode('Remote role - no prior telehealth experience required. Work from home.')).toBe('Remote');
  });

  it('occasional remote or virtual work is neither a claim nor a denial', () => {
    expect(detectMode('On-site role with occasional remote opportunity.')).toBe('In-Person');
    expect(detectMode('Remote position with occasional virtual team meetings.')).toBe('Remote');
  });

  it('home-based without the word remote is not remote', () => {
    const homeVisits =
      "This is a home-based position. You will travel to patients' homes across the Denver metro area to provide in-home primary care visits.";
    expect(detectMode(homeVisits)).not.toBe('Remote');
    expect(detectMode(`${homeVisits} This is a remote position.`)).toBe('Remote');
  });

  it('"not a hybrid role" is not hybrid, and a full on-site week is on site', () => {
    expect(detectMode('This is not a hybrid role. This is not a remote role. Onsite at our clinic.')).toBe('In-Person');
    expect(detectMode('This is not a hybrid role. Onsite at our clinic.')).toBe('In-Person');
    expect(detectMode('5 days on-site each week')).toBe('In-Person');
    expect(detectMode('On-site five days per week at our Denver clinic.')).toBe('In-Person');
    expect(detectMode('3 days in office, 2 days remote')).toBe('Hybrid');
  });

  it('telework offered beside a duty station is hybrid, never remote', () => {
    expect(detectMode('Telework eligible: Yes')).toBe('Hybrid');
    expect(detectMode('Telework: Available\nVirtual: This is not a virtual position.')).toBe('Hybrid');
    expect(detectMode('Remote Job: No\nTelework eligible: Yes, as determined by agency policy.')).toBe('Hybrid');
    expect(detectMode('This position is eligible for telework.')).toBe('Hybrid');
  });

  /**
   * GFJ-01 review 3: a negated telework statement no longer outvotes the
   * job's own remote statement. A federal remote job is not telework
   * eligible, and the VA template for a virtual job says "Telework: Not
   * Available". A negated remote, virtual or work from home statement still
   * does.
   */
  it.each([
    'Telework: Not Available\nVirtual: This is a virtual position.',
    'Remote job: Yes\nTelework eligible: No',
    'This is a remote role. Telework: Not Available.',
    'This is a remote position; it is not a telework position.',
    'Virtual position. Telework: N/A (this is a fully virtual role)',
    'Remote - occasional travel to our Denver office required. Work from home position.',
    'Remote: occasional onsite meetings in Denver',
    'Remote position with occasional virtual team meetings.',
  ])('the job says it is remote: %s', (text) => {
    expect(detectMode(text)).toBe('Remote');
    expect(detectMode(`${text}\n${BODY}`)).toBe('Remote');
  });

  it('a telework negation still beats a bare telework mention, and a remote negation beats a remote claim', () => {
    expect(detectMode('Telework eligible: No ... Telework agreements are not offered.')).toBe('In-Person');
    expect(detectMode('Telework: Not Available. Our clinic supports telework for admin staff.')).toBe('In-Person');
    expect(detectMode('Telework: Not Available\nVirtual: This is not a virtual position.')).toBe('In-Person');
    expect(detectMode('Remote job: No\nTelework eligible: No')).toBe('In-Person');
    expect(detectMode('No work from home. Remote position candidates see our other listing.')).toBe('In-Person');
    // A labelled value is read by the term it denies, not by its label.
    expect(detectMode('Telework: This is not a virtual position.')).toBe('In-Person');
    expect(detectMode('Telework: This is a remote position and not a telework position.')).toBe('Remote');
  });

  it('keeps the positives', () => {
    expect(detectMode('Telework position, 100% remote')).toBe('Remote');
    expect(detectMode('fully remote, work from home position')).toBe('Remote');
    expect(detectMode('Telecommute')).toBe('Remote');
    expect(detectMode('Remote position, licensed in any US state.')).toBe('Remote');
    expect(detectMode('Remote - no travel required. Work from home.')).toBe('Remote');
    expect(detectMode('Remote Job: Yes')).toBe('Remote');
    expect(detectMode('This role is fully remote. It is not a hybrid role.')).toBe('Remote');
  });

  /**
   * GFJ-01 review 4: the general negation reads a clause, so a negator that
   * governs something else (a perk, an obligation, a condition, a contrast,
   * a question, another line) leaves a remote statement standing.
   */
  it.each([
    'No travel required for this remote position.',
    'No need to relocate as this is a remote position.',
    "You don't have to live nearby to work from home with us.",
    "You don't need to relocate to work from home.",
    'No commute, no problem: work from home.',
    'Never commute again. Work from home.',
    'This role does not include telework; it is a remote position.',
    "Don't miss this remote opportunity!",
    'This is not only a remote position, it is a flexible one.',
    'Not just remote: work from home anywhere in the US.',
    'We see patients whether or not you work from home. This is a remote position.',
    'Not sure if a remote position is right for you? This is a remote position.',
    'Never held a remote position? Our onboarding covers it. This is a remote role.',
    'No sales quotas\nWork from home',
    'No matter where you live, this is a remote position.',
    "Remote work isn't for everyone, but this is a remote position.",
    "Remote doesn't mean alone: this is a remote position with weekly team calls.",
    'Remote work is not new to us. This is a remote position.',
    'Work from home is not just a perk here. This is a remote position.',
    'Want to work from home? Never commute again. This is a remote position.',
    'Remote: not just a job. This is a remote position.',
  ])('a remote statement beside an unrelated negation stays remote: %s', (text) => {
    expect(detectMode(text)).toBe('Remote');
    expect(detectMode(`${text}\n${BODY}`)).toBe('Remote');
  });

  it('a contrast after the negation keeps the mode it states', () => {
    expect(detectMode('This role is not onsite but hybrid.')).toBe('Hybrid');
  });

  it('maps a "Hybrid Remote" ATS value to Hybrid', () => {
    expect(mapAtsWorkMode('Hybrid Remote')).toBe('Hybrid');
    expect(mapAtsWorkMode('hybrid-remote')).toBe('Hybrid');
    expect(detectMode('Remote Type: Hybrid Remote')).toBe('Hybrid');
  });
});

describe('GFJ-01 at ingest: negated remote statements and service-line titles', () => {
  const ingest = (over: Record<string, unknown>, source = 'greenhouse') =>
    normalizeJobWithReason(
      {
        title: 'Psychiatric Nurse Practitioner',
        company: 'Example Health',
        location: 'Denver, CO',
        applyLink: 'https://boards.greenhouse.io/example/jobs/1',
        externalId: 'greenhouse-example-1',
        description: BODY,
        ...over,
      },
      source,
    ).job;

  it('the VA USAJOBS template is an in-person job, never remote', () => {
    const job = ingest(
      {
        title: 'Nurse Practitioner (Primary Care)',
        company: 'Veterans Health Administration',
        location: 'Tampa, FL',
        description:
          `${BODY}\nWork Schedule: Monday to Friday, 8:00 am to 4:30 pm\nTelework: Not Available\n` +
          'Virtual: This is not a virtual position.\nRelocation/Moving Expenses Reimbursed: No',
        applyLink: 'https://www.usajobs.gov/job/812345600',
        externalId: 'usajobs-812345600',
      },
      'usajobs',
    );
    expect(job).toMatchObject({ mode: 'In-Person', isRemote: false, isHybrid: false, city: 'Tampa', stateCode: 'FL' });
  });

  const usajobs = (location: string, description: string) =>
    ingest(
      {
        title: 'Nurse Practitioner (Primary Care)',
        company: 'Veterans Health Administration',
        location,
        description,
        applyLink: 'https://www.usajobs.gov/job/812345600',
        externalId: 'usajobs-812345600',
      },
      'usajobs',
    );

  it.each(['Telework - No', "Work from home isn't an option.", 'Telework Eligible - No', 'We are unable to offer work from home.'])(
    'a description whose last line is "%s" is stored on site, never listed on /jobs/remote',
    (line) => {
      const job = usajobs('Tampa, FL', `${BODY}\n${line}`);
      expect(job).toMatchObject({ isRemote: false, isHybrid: false, city: 'Tampa', stateCode: 'FL' });
      expect(job?.mode).toBe('In-Person');
    },
  );

  it('a USAJOBS description ending "This position is not available for telework." is stored on site', () => {
    const job = usajobs('Tampa, FL', `${BODY}\nThis position is not available for telework.`);
    expect(job).toMatchObject({ mode: 'In-Person', isRemote: false, isHybrid: false, city: 'Tampa', stateCode: 'FL' });
  });

  it.each(['You cannot work from home in this role.', 'This is not currently a remote position.', 'Work from home is prohibited.'])(
    '"%s" on a posting whose location says nothing is stored on site (general negation)',
    (sentence) => {
      const job = ingest({ location: 'United States', description: `${sentence} ${BODY}` });
      expect(job).toMatchObject({ mode: 'In-Person', isRemote: false, isHybrid: false });
    },
  );

  it('the USAJOBS remote pair "Remote job: Yes / Telework eligible: No" is stored fully remote', () => {
    const job = usajobs('Remote', `${BODY}\nRemote job: Yes\nTelework eligible: No`);
    expect(job).toMatchObject({ mode: 'Remote', isRemote: true, isHybrid: false });
  });

  it('the VA virtual template "Telework: Not Available / Virtual: This is a virtual position." is stored fully remote', () => {
    const job = usajobs('Location Negotiable After Selection', `${BODY}\nTelework: Not Available\nVirtual: This is a virtual position.`);
    expect(job).toMatchObject({ mode: 'Remote', isRemote: true, isHybrid: false });
  });

  it('the work-mode repair keeps a stored federal remote row remote and clears a stored "Telework - No" one', () => {
    const row = {
      id: 'row-1',
      title: 'Nurse Practitioner (Primary Care)',
      employer: 'Veterans Health Administration',
      isPublished: true,
      sourceType: 'usajobs',
    };
    const remote = { ...row, location: 'Remote', description: `${BODY}\nRemote job: Yes\nTelework eligible: No`, mode: 'Remote', isRemote: true, isHybrid: false };
    expect(planWorkModeRepair(remote)).toBeNull();
    const onsite = { ...row, location: 'Tampa, FL', description: `${BODY}\nTelework - No`, mode: 'Remote', isRemote: true, isHybrid: false };
    expect(planWorkModeRepair(onsite)).toMatchObject({ newMode: 'In-Person', newIsRemote: false });
  });

  it.each([
    'This is not a work from home position.',
    'No telecommuting.',
    'This position is not eligible for telework.',
    'Remote Job: No',
  ])('"%s" on a posting whose location says nothing is stored on site', (sentence) => {
    const job = ingest({ location: 'United States', description: `${sentence} ${BODY}` });
    expect(job).toMatchObject({ isRemote: false, isHybrid: false });
    expect(job?.mode).toBe('In-Person');
  });

  it('a home-visit "home-based position" is never stored remote', () => {
    const job = ingest({
      title: 'Nurse Practitioner, In-Home Primary Care',
      description: `This is a home-based position. You will travel to patients' homes across the Denver metro area. ${BODY}`,
    });
    expect(job).toMatchObject({ isRemote: false });
    expect(job?.mode).not.toBe('Remote');
  });

  it('"Remote Patient Monitoring" in a title is a service line, not a work mode', () => {
    const job = ingest({
      title: 'Nurse Practitioner - Remote Patient Monitoring',
      description: `This role is on-site at our clinic. ${BODY}`,
    });
    expect(job).toMatchObject({ mode: 'In-Person', isRemote: false });
    const manager = ingest({
      title: 'Remote Patient Manager - Nurse Practitioner',
      location: 'Hollywood, FL',
      description: `Clinic-based role. ${BODY}`,
    });
    expect(manager).toMatchObject({ isRemote: false });
    // A title that also says remote as a mode still does.
    const remote = ingest({ title: 'Nurse Practitioner - Remote Patient Monitoring (Remote)', location: 'United States' });
    expect(remote).toMatchObject({ mode: 'Remote', isRemote: true });
  });

  it('"Non-Remote" and "Not Remote" in a title never mean remote', () => {
    expect(ingest({ title: 'Nurse Practitioner (Non-Remote)' })?.isRemote).toBe(false);
    expect(ingest({ title: 'Nurse Practitioner - Not Remote' })?.isRemote).toBe(false);
  });

  it('a stored remote flag on the VA template is not TELECOMMUTE', () => {
    expect(
      isVerifiedFullyRemote({
        title: 'Nurse Practitioner (Primary Care)',
        location: 'Remote',
        mode: 'Remote',
        isRemote: true,
        isHybrid: false,
        description: `${BODY}\nTelework: Not Available\nVirtual: This is not a virtual position.`,
      }),
    ).toBe(false);
  });
});

describe('isVerifiedFullyRemote reads the fixed detector', () => {
  const remoteRow = {
    title: 'Psychiatric Nurse Practitioner',
    location: 'Remote',
    mode: 'Remote',
    isRemote: true,
    isHybrid: false,
  };

  it('a stored remote flag on a "NOT a 100% remote" posting is not TELECOMMUTE', () => {
    expect(isVerifiedFullyRemote({ ...remoteRow, description: 'This is NOT a 100% remote position.' })).toBe(false);
  });

  it('"Flexible Schedule, 100% Remote" is', () => {
    expect(isVerifiedFullyRemote({ ...remoteRow, description: 'Flexible Schedule. 100% Remote.' })).toBe(true);
  });
});

describe('ingest: structured work mode and location fallback', () => {
  const raw = (over: Record<string, unknown>) => ({
    title: 'Nurse Practitioner',
    company: 'Example Health',
    location: 'Denver, CO',
    description: BODY,
    applyLink: 'https://example.wd1.myworkdayjobs.com/en-US/External/job/x_R1',
    externalId: 'workday-example-x_R1',
    ...over,
  });

  it('a Workday remoteType of Onsite beats "(Remote)" in the title', () => {
    const job = normalizeJobWithReason(raw({ title: 'ARNP Inpatient Psych (Remote)', workMode: 'Onsite' }), 'workday').job;
    expect(job).toMatchObject({ mode: 'In-Person', isRemote: false, isHybrid: false });
  });

  it('a "Remote Type Onsite" line in the description beats the title', () => {
    const job = normalizeJobWithReason(raw({ title: 'NP (Remote)', description: `Remote Type Onsite\n${BODY}` }), 'workday').job;
    expect(job?.mode).toBe('In-Person');
  });

  it('a Lever workplaceType of remote is fully remote', () => {
    const job = normalizeJobWithReason(raw({ location: 'United States', workMode: 'remote' }), 'lever').job;
    expect(job).toMatchObject({ mode: 'Remote', isRemote: true, isHybrid: false });
  });

  it('DaVita "2 Locations" with "Denver, CO" in the title is filed under Denver, CO', () => {
    const job = normalizeJobWithReason(raw({ title: 'Nurse Practitioner - Denver, CO (Hybrid)', location: '2 Locations' }), 'workday').job;
    expect(job).toMatchObject({ city: 'Denver', stateCode: 'CO', location: 'Denver, CO', mode: 'Hybrid' });
  });

  it('a labelled description line resolves a vague location', () => {
    const job = normalizeJobWithReason(raw({ location: 'Ambulatory NYP/CU', description: `Location | New York, New York\n${BODY}` }), 'workday').job;
    expect(job).toMatchObject({ city: 'New York', stateCode: 'NY', location: 'New York, NY' });
  });

  it('a location that names a state is never replaced', () => {
    const job = normalizeJobWithReason(raw({ title: 'Nurse Practitioner - Denver, CO', location: 'Aurora, CO' }), 'workday').job;
    expect(job).toMatchObject({ city: 'Aurora', location: 'Aurora, CO' });
  });

  it('a fully remote row keeps its vague location (no state guessed from the text)', () => {
    const job = normalizeJobWithReason(raw({ title: 'PMHNP - Remote', location: 'United States', description: `Work in Dallas, TX once a year. ${BODY}` }), 'lever').job;
    expect(job).toMatchObject({ isRemote: true, stateCode: null, location: 'United States' });
  });
});

/**
 * GFJ-01 end to end: what ingest stores (mode and the isRemote / isHybrid
 * pair behind /jobs/remote and JobPosting TELECOMMUTE) for the audit's live
 * texts, through normalizeJobWithReason.
 */
describe('GFJ-01 at ingest: the stored work mode', () => {
  const ingest = (over: Record<string, unknown>, source = 'greenhouse') =>
    normalizeJobWithReason(
      {
        title: 'Psychiatric Nurse Practitioner',
        company: 'Example Health',
        location: 'Denver, CO',
        applyLink: 'https://boards.greenhouse.io/example/jobs/1',
        externalId: 'greenhouse-example-1',
        ...over,
      },
      source,
    ).job;

  it('Clover "Home-Based Care" (home visits) is never stored remote', () => {
    const job = ingest({ title: 'Nurse Practitioner, Home-Based Care', description: `Visit members in their homes across the county. ${BODY}` });
    expect(job).toMatchObject({ isRemote: false });
    expect(job?.mode).not.toBe('Remote');
  });

  it('Seven Starling "Flexible Schedule, 100% Remote" is stored fully remote', () => {
    const job = ingest({ location: 'United States', description: `Flexible Schedule. 100% Remote. ${BODY}` });
    expect(job).toMatchObject({ mode: 'Remote', isRemote: true, isHybrid: false });
  });

  it('a flexible schedule at a clinic is not hybrid', () => {
    const job = ingest({ description: `Clinic-based role with a flexible schedule. ${BODY}` });
    expect(job).toMatchObject({ mode: 'In-Person', isRemote: false, isHybrid: false });
  });

  it('LifeStance "NOT a 100% remote position" is hybrid, never remote', () => {
    const job = ingest({
      description: `Please note this is NOT a 100% remote position and requires some level of in-office presence. ${BODY}`,
    });
    expect(job).toMatchObject({ mode: 'Hybrid', isRemote: false, isHybrid: true });
  });

  it('"This is not a remote position" is stored on site', () => {
    const job = ingest({ description: `This is not a remote position. Patients are seen in our clinic. ${BODY}` });
    expect(job).toMatchObject({ mode: 'In-Person', isRemote: false });
  });

  it('a Workday remoteType read from the detail endpoint decides the mode', () => {
    const hybrid = parseWorkdayDetail({ jobPostingInfo: { remoteType: { descriptor: 'Hybrid' } } });
    const onsite = parseWorkdayDetail({ jobPostingInfo: { remoteType: 'Onsite' } });
    const raw = (remoteType: string | undefined) => ({
      title: 'PMHNP - Remote',
      description: `Work from home. ${BODY}`,
      applyLink: 'https://example.wd1.myworkdayjobs.com/en-US/External/job/x_R1',
      externalId: 'workday-example-x_R1',
      ...(remoteType ? { workMode: remoteType } : {}),
    });
    expect(ingest(raw(hybrid.remoteType), 'workday')).toMatchObject({ mode: 'Hybrid', isRemote: false, isHybrid: true });
    expect(ingest(raw(onsite.remoteType), 'workday')).toMatchObject({ mode: 'In-Person', isRemote: false, isHybrid: false });
  });

  it('a "Remote Type: Onsite" line beats "100% remote" elsewhere in the text', () => {
    const job = ingest({ location: 'United States', description: `Remote Type: Onsite\n100% remote documentation days. ${BODY}` });
    expect(job).toMatchObject({ mode: 'In-Person', isRemote: false });
  });
});

describe('resolveLocationFallback', () => {
  it('never reads the first state name anywhere in the text', () => {
    expect(resolveLocationFallback({ title: 'Nurse Practitioner', description: 'Our Virginia headquarters supports clinics nationwide.' })).toBeNull();
  });

  it('reads "work in City, State" and a top address line', () => {
    expect(resolveLocationFallback({ title: 'NP/PA - Inpatient Psychiatry - St. Joseph', description: 'Join us to work in St. Joseph, Michigan on the inpatient unit.' }))
      .toMatchObject({ source: 'description_phrase', city: 'St. Joseph', stateCode: 'MI', label: 'St. Joseph, MI' });
    expect(resolveLocationFallback({ title: 'NP/PA', description: 'Join us to work in Grand Rapids, Michigan on the inpatient unit.' }))
      .toMatchObject({ source: 'description_phrase', city: 'Grand Rapids', stateCode: 'MI', label: 'Grand Rapids, MI' });
    expect(resolveLocationFallback({ title: 'NP', description: '2000 16th Street, Denver, Colorado, 80202\nPrimary care.' }))
      .toMatchObject({ source: 'description_address', city: 'Denver', stateCode: 'CO' });
  });

  it('a phrase town the city dataset does not know and the title does not name keeps only the state', () => {
    // "St. Joseph, MI" is not in lib/pseo/city-data; "based at Mercy, OH" names a hospital.
    expect(resolveLocationFallback({ title: 'NP/PA', description: 'Join us to work in St. Joseph, Michigan on the inpatient unit.' }))
      .toMatchObject({ source: 'description_phrase', city: null, stateCode: 'MI', label: 'Michigan' });
    expect(resolveLocationFallback({ title: 'Nurse Practitioner', description: `${BODY} This position is based at Mercy, OH.` }))
      .toMatchObject({ source: 'description_phrase', city: null, stateCode: 'OH' });
  });

  it('a state-only title segment gives the state', () => {
    expect(resolveLocationFallback({ title: 'Psychiatric Advance Practice Provider, Iowa, Remote', description: '' }))
      .toMatchObject({ source: 'title', city: null, stateCode: 'IA', label: 'Iowa' });
  });
});

/**
 * The live DaVita postings (rows 4909a5e1, 774cde52, 3251e62d, b545cb53 on
 * nphiring.com, 2026-09-29). The description opens the way the Workday
 * posting does: posting date, then a street address that is often another
 * clinic than the one the title names.
 */
function davitaDescription(address: string, place: string): string {
  return (
    `Posting Date\n\n09/23/2026\n\n${address}\n\n` +
    'Are you a Nurse Practitioner ready to transform lives and make a real difference for patients with complex ' +
    `kidney conditions? DaVita IKC is looking for a passionate NP to join our team in ${place}, helping patients ` +
    'navigate a challenging healthcare system while receiving holistic, integrated care.\n\nPosition Details:\n\n' +
    `• Location: ${place} Occasional work from home (telehealth) with travel across an assigned geographic area, ` +
    'including dialysis clinics and nephrology practices. Travel expectations may vary based on business needs and ' +
    'patient population.\n• Clinical Care & Evaluation: The primary responsibility is to evaluate and manage patients ' +
    'with chronic kidney disease, collaborating with nephrologists and care teams.'
  );
}

const TERRE_HAUTE = {
  title: 'Nurse Practitioner- Terre Haute, IN - Hybrid Remote',
  location: '05474 - Terre Haute Dialysis',
  description: davitaDescription('504 6th Ave, Terre Haute, Indiana, 47807, United States of America', 'Terre Haute, IN'),
};
const NEWARK = {
  title: 'Nurse Practitioner- Newark, NJ- Hybrid Remote',
  location: '2 Locations',
  description: davitaDescription('14-20 Prospect St, East Orange, New Jersey, 07017-2238, United States of America', 'Newark, NJ'),
};
const FREEHOLD = {
  title: 'Nurse Practitioner- Freehold, NJ- Hybrid Remote',
  location: '2 Locations',
  description: davitaDescription('267 W Merrick Rd, Freeport, New York, 11520-3346, United States of America', 'Freehold, NJ'),
};
const SPRINGBORO = {
  title: 'Nurse Practitioner, Springboro/Miamisburg, OH - Hybrid Remote',
  location: '2 Locations',
  description: davitaDescription('241 W Schrock Rd, Westerville, Ohio, 43081-2874, United States of America', 'Springboro/Miamisburg, OH.'),
};

describe('title places when the dash touches the role (CS-03 review)', () => {
  it('splits on a dash with whitespace on either side, never inside a hyphenated town', () => {
    expect(titleLocationCandidates(TERRE_HAUTE.title)).toEqual(['Terre Haute, IN']);
    expect(titleLocationCandidates(NEWARK.title)).toEqual(['Newark, NJ']);
    expect(titleLocationCandidates(FREEHOLD.title)).toEqual(['Freehold, NJ']);
    expect(titleLocationCandidates('Winston-Salem, NC - Nurse Practitioner')).toEqual(['Winston-Salem, NC']);
  });

  it('takes the first town of a slash pair and reads a bare state segment', () => {
    expect(titleLocationCandidates(SPRINGBORO.title)).toEqual(['Springboro, OH']);
    expect(titleLocationCandidates('Nurse Practitioner - Midtown/Buckhead - GA')).toEqual(['GA']);
  });

  it('never reads a credential or an all-capitals word as a state, nor the town in "Washington, DC"', () => {
    expect(titleLocationCandidates('APP (NP, PA)')).toEqual([]);
    expect(titleLocationCandidates('NP/PA - Inpatient Psychiatry - St. Joseph')).toEqual([]);
    expect(titleLocationCandidates('NURSE PRACTITIONER - OR')).toEqual([]);
    expect(titleLocationCandidates('Nurse Practitioner - Washington, DC')).toEqual(['Washington, DC']);
  });

  it('notes a state the title names loosely, but not "PA" in "NP/PA"', () => {
    expect([...titleStateMentions('Nurse Practitioner Freehold NJ')]).toEqual(['NJ']);
    expect([...titleStateMentions('NP/PA - Inpatient Psychiatry - St. Joseph')]).toEqual([]);
    expect([...titleStateMentions('Nurse Practitioner - Richmond VA')]).toEqual(['VA']);
  });

  it('role words are not a town (lib/locality.ts)', () => {
    expect(plausibleLocality('Nurse Practitioner- Terre Haute')).toBeNull();
    expect(plausibleLocality('Psychiatric Advance Practice Provider')).toBeNull();
    expect(plausibleLocality('PMHNP Denver')).toBeNull();
    expect(plausibleLocality('Hybrid')).toBeNull();
    expect(plausibleLocality('Terre Haute')).toBe('Terre Haute');
  });

  it('a polluted city from any source is rejected whole, and never reaches the JobPosting', () => {
    expect(resolveLocationFallback({ title: 'NP', description: 'Location: Nurse Practitioner- Terre Haute, IN' })).toBeNull();
    const places = resolveJobPlaces({
      title: TERRE_HAUTE.title,
      location: 'Nurse Practitioner- Terre Haute, IN',
      city: 'Nurse Practitioner- Terre Haute',
      state: 'Indiana',
      stateCode: 'IN',
      isRemote: false,
      isHybrid: true,
    });
    expect(places).toEqual([{ locality: null, regionCode: 'IN' }]);
  });
});

describe('the title has authority over the description (CS-03 review)', () => {
  it('Freehold, NJ is never filed under the Freeport, NY address that opens its description', () => {
    expect(resolveLocationFallback(FREEHOLD)).toMatchObject({ source: 'title', city: 'Freehold', stateCode: 'NJ', label: 'Freehold, NJ' });
  });

  it('Springboro/Miamisburg, OH is never filed under the Westerville address', () => {
    expect(resolveLocationFallback(SPRINGBORO)).toMatchObject({ source: 'title', city: 'Springboro', stateCode: 'OH' });
  });

  it('a description address in another state than the title names is skipped', () => {
    const freeport = '267 W Merrick Rd, Freeport, New York, 11520-3346, United States of America';
    expect(resolveLocationFallback({ title: 'Nurse Practitioner Freehold NJ', description: `${freeport}\n${BODY}` })).toBeNull();
  });

  it('a description address in the title state keeps only the state when the title names another town', () => {
    const eastOrange = '100 Main Street, East Orange, New Jersey, 07017, United States of America';
    expect(resolveLocationFallback({ title: 'Nurse Practitioner Freehold NJ', description: `${eastOrange}\n${BODY}` }))
      .toMatchObject({ source: 'description_address', city: null, stateCode: 'NJ', label: 'New Jersey' });
  });

  it('a state-only title is refined only by a source naming a town the title also names', () => {
    expect(resolveLocationFallback({ title: 'Nurse Practitioner - Des Moines - Iowa', description: `Location: Des Moines, Iowa\n${BODY}` }))
      .toMatchObject({ source: 'description_label', city: 'Des Moines', stateCode: 'IA' });
    expect(resolveLocationFallback({ title: 'Nurse Practitioner - Iowa', description: `Location: Ames, Iowa\n${BODY}` }))
      .toMatchObject({ source: 'title', city: null, stateCode: 'IA' });
  });

  it('a Workday primary location in another state never outvotes the title', () => {
    expect(resolveLocationFallback({ title: 'Nurse Practitioner - Midtown/Buckhead - GA', description: '', workdayPrimaryLocation: 'Freeport, NY' }))
      .toMatchObject({ source: 'title', city: null, stateCode: 'GA', label: 'Georgia' });
  });

  it('a title that names no place still reads the description (Corewell St. Joseph)', () => {
    expect(resolveLocationFallback({ title: 'NP/PA - Inpatient Psychiatry - St. Joseph', description: `${BODY} Join us to work in St. Joseph, Michigan.` }))
      .toMatchObject({ source: 'description_phrase', city: 'St. Joseph', stateCode: 'MI' });
  });
});

/**
 * Titles that put a specialty, setting or schedule, or a second state, where
 * a town would go. Before the second CS-03 review each was stored as a false
 * town ("Urgent Care, FL", "Georgia" in Alabama) and reached the JobPosting
 * addressLocality and the listing city tallies.
 */
const SPECIALTY_OR_SCHEDULE_TITLES: Array<[string, string]> = [
  ['Nurse Practitioner - Urgent Care, FL', 'FL'],
  ['Nurse Practitioner, Primary Care, TX', 'TX'],
  ['NP, Dermatology, AZ', 'AZ'],
  ['Nurse Practitioner, Pediatrics, GA', 'GA'],
  ['Family Nurse Practitioner, Hospice, NC', 'NC'],
  ['Nurse Practitioner, Outpatient, WI', 'WI'],
  ['Nurse Practitioner, Per Diem, TX', 'TX'],
  ['Nurse Practitioner, Full Time, CA', 'CA'],
  ['NP - Nights, AZ', 'AZ'],
  ['Nurse Practitioner, Days, NY', 'NY'],
];
const TWO_STATE_TITLES: Array<[string, string, string[]]> = [
  ['Nurse Practitioner - Georgia, Alabama', 'GA', ['Georgia', 'Alabama']],
  ['Travel Nurse Practitioner, Ohio, Indiana', 'OH', ['Ohio', 'Indiana']],
  // The dataset slugs "kansas-mo" and "michigan-in" are Kansas City and
  // Michigan City with "City" dropped; neither makes "Kansas" a town.
  ['Nurse Practitioner - Kansas, Missouri', 'KS', ['Kansas', 'Missouri']],
  ['Nurse Practitioner - Michigan, Indiana', 'MI', ['Michigan', 'Indiana']],
];

describe('a specialty, setting, schedule or second state is never a town (CS-03 review 2)', () => {
  it.each(SPECIALTY_OR_SCHEDULE_TITLES)('"%s" gives the state only', (title, stateCode) => {
    expect(resolveLocationFallback({ title, description: '' })).toMatchObject({ source: 'title', city: null, stateCode });
    expect(titleLocationCandidates(title)).toEqual([stateCode]);
  });

  it.each(TWO_STATE_TITLES)('"%s" names two states and no town', (title, stateCode, candidates) => {
    expect(titleLocationCandidates(title)).toEqual(candidates);
    expect(resolveLocationFallback({ title, description: '' })).toMatchObject({ source: 'title', city: null, stateCode });
  });

  it('a real town named like a state still reads as a town', () => {
    expect(titleLocationCandidates('Nurse Practitioner - Indiana, PA')).toEqual(['Indiana, PA']);
    expect(titleLocationCandidates('Nurse Practitioner - Washington, PA')).toEqual(['Washington, PA']);
    expect(titleLocationCandidates('Nurse Practitioner - New York, NY')).toEqual(['New York, NY']);
    expect(resolveLocationFallback({ title: 'Nurse Practitioner - Washington, DC', description: '' }))
      .toMatchObject({ city: 'Washington', stateCode: 'DC' });
  });

  it('a description source whose town is a specialty or a region keeps only the state', () => {
    expect(resolveLocationFallback({ title: 'Nurse Practitioner', description: `Location: Urgent Care, FL\n${BODY}` }))
      .toMatchObject({ source: 'description_label', city: null, stateCode: 'FL' });
    expect(resolveLocationFallback({ title: 'Nurse Practitioner', description: `Location: Greater Houston Area, TX\n${BODY}` }))
      .toMatchObject({ source: 'description_label', city: null, stateCode: 'TX' });
  });

  it('ingest of a Greenhouse "Urgent Care, FL" title with no location stores Florida, no town', () => {
    const job = normalizeJobWithReason(
      {
        title: 'Nurse Practitioner - Urgent Care, FL',
        company: 'Example Health',
        location: 'United States',
        description: BODY,
        applyLink: 'https://boards.greenhouse.io/example/jobs/1',
        externalId: 'greenhouse-example-1',
      },
      'greenhouse',
    ).job;
    expect(job).toMatchObject({ city: null, stateCode: 'FL', location: 'Florida' });
  });

  it('a stored specialty "city" never reaches addressLocality', () => {
    expect(plausibleLocality('Urgent Care')).toBeNull();
    expect(plausibleLocality('Per Diem')).toBeNull();
    expect(plausibleLocality('Nights')).toBeNull();
    expect(plausibleLocality('Dermatology')).toBeNull();
    expect(plausibleLocality('Travelers Rest')).toBe('Travelers Rest');
    expect(plausibleLocality('Mountain Home')).toBe('Mountain Home');
    const places = resolveJobPlaces({
      title: 'Nurse Practitioner - Urgent Care, FL',
      location: 'Urgent Care, FL',
      city: 'Urgent Care',
      state: 'Florida',
      stateCode: 'FL',
      isRemote: false,
      isHybrid: false,
    });
    expect(places).toEqual([{ locality: null, regionCode: 'FL' }]);
  });

  it.each([
    ['Nurse Practitioner - Float Pool, TX', 'TX'],
    ['Nurse Practitioner - Sign On Bonus, TX', 'TX'],
    ['Nurse Practitioner - Greater Houston, TX', 'TX'],
    ['Nurse Practitioner - Houston Metro, TX', 'TX'],
    ['Nurse Practitioner - Skilled Nursing, FL', 'FL'],
    ['Nurse Practitioner - Home Visits, MI', 'MI'],
    ['Nurse Practitioner - Supervisor, TX', 'TX'],
    ['Nurse Practitioner - Bilingual, TX', 'TX'],
    ['Nurse Practitioner - Suboxone, TX', 'TX'],
    ['Nurse Practitioner - Statewide, TX', 'TX'],
    ['Nurse Practitioner - North, TX', 'TX'],
    ['APP - Neuro, OH', 'OH'],
  ])('"%s": a title town must be a known town, so this gives the state only', (title, stateCode) => {
    expect(resolveLocationFallback({ title, description: BODY })).toMatchObject({ source: 'title', city: null, stateCode });
  });

  it('an ambiguous code after a word that is not a town names no state ("Ortho, PA")', () => {
    expect(titleLocationCandidates('APP - Ortho, PA')).toEqual([]);
    expect(resolveLocationFallback({ title: 'APP - Ortho, PA', description: BODY })).toBeNull();
  });

  it('a town outside the city dataset counts when the description writes it with its state', () => {
    expect(isKnownTown('Lead', 'SD')).toBe(false);
    expect(resolveLocationFallback({ title: 'Nurse Practitioner - Lead, SD', description: BODY }))
      .toMatchObject({ city: null, stateCode: 'SD' });
    expect(resolveLocationFallback({ title: 'Nurse Practitioner - Lead, SD', description: `Location: Lead, South Dakota\n${BODY}` }))
      .toMatchObject({ source: 'title', city: 'Lead', stateCode: 'SD', label: 'Lead, SD' });
    expect(resolveLocationFallback({ title: 'Nurse Practitioner - Lead, SD', description: `${BODY} Join our team in Lead, SD.` }))
      .toMatchObject({ city: 'Lead', stateCode: 'SD' });
  });

  it('knows towns under the names a title uses', () => {
    expect(isKnownTown('Nashville', 'TN')).toBe(true);
    expect(isKnownTown('Indianapolis', 'IN')).toBe(true);
    expect(isKnownTown('Honolulu', 'HI')).toBe(true);
    expect(isKnownTown('Kansas City', 'MO')).toBe(true);
    expect(isKnownTown('Saint Louis', 'MO')).toBe(true);
    expect(isKnownTown('Ft. Worth', 'TX')).toBe(true);
    expect(isKnownTown("Lee's Summit", 'MO')).toBe(true);
    expect(isKnownTown('Float Pool', 'TX')).toBe(false);
    expect(resolveLocationFallback({ title: 'Nurse Practitioner - Nashville, TN', description: BODY }))
      .toMatchObject({ city: 'Nashville', stateCode: 'TN' });
  });

  it('every common-name alias points at a town in the city dataset', () => {
    for (const datasetSlug of Object.values(COMMON_NAME_TOWN_SLUGS)) expect(CITY_SLUGS.has(datasetSlug)).toBe(true);
    // Every dataset town is known under its own name, except the two whose
    // formal names carry a slash that the dataset slug deletes.
    const unknown = CITIES.filter((c) => !isKnownTown(c.name, c.stateCode)).map((c) => `${c.name}, ${c.stateCode}`);
    expect(unknown).toEqual([
      'Louisville/Jefferson County metro government (balance), KY',
      'Hartsville/Trousdale County, TN',
    ]);
    expect(isKnownTown('Louisville', 'KY')).toBe(true);
    expect(isKnownTown('Hartsville', 'TN')).toBe(true);
  });

  it('a state name is a town exactly when the city dataset has a town of that exact name', () => {
    const STATES = [...new Set(CITIES.map((c) => c.state))];
    const CODES = [...new Set(CITIES.map((c) => c.stateCode))];
    const expected = CITIES.filter((c) => STATES.includes(c.name)).map((c) => `${c.name}, ${c.stateCode}`).sort();
    const accepted = STATES.flatMap((name) => CODES.filter((code) => isTownNamedLikeState(name, code)).map((code) => `${name}, ${code}`)).sort();
    expect(accepted).toEqual(expected);
    expect(accepted).toContain('Washington, DC');
    expect(accepted).not.toContain('Kansas, MO');
  });

  it('no town in the city dataset is rejected as a specialty or schedule word', () => {
    const rejected = CITIES.filter((c) => namesNonTownTitleWord(c.name)).map((c) => `${c.name}, ${c.stateCode}`);
    expect(rejected).toEqual([]);
  });
});

describe('ingest stores the place the live DaVita titles name (CS-03 review)', () => {
  const ingest = (fixture: { title: string; location: string; description: string }) =>
    normalizeJobWithReason(
      {
        ...fixture,
        company: 'DaVita',
        applyLink: 'https://davita.wd1.myworkdayjobs.com/en-US/DKC_External/job/Nurse-Practitioner_R1',
        externalId: 'workday-davita-Nurse-Practitioner_R1',
      },
      'workday',
    ).job;

  it('Terre Haute, IN (row 4909a5e1), not "Nurse Practitioner- Terre Haute"', () => {
    expect(ingest(TERRE_HAUTE)).toMatchObject({ location: 'Terre Haute, IN', city: 'Terre Haute', stateCode: 'IN', mode: 'Hybrid' });
  });

  it('Newark, NJ (row 774cde52), not the East Orange address', () => {
    expect(ingest(NEWARK)).toMatchObject({ location: 'Newark, NJ', city: 'Newark', stateCode: 'NJ' });
  });

  it('Freehold, NJ (row 3251e62d), never Freeport, NY', () => {
    expect(ingest(FREEHOLD)).toMatchObject({ location: 'Freehold, NJ', city: 'Freehold', stateCode: 'NJ' });
  });

  it('Springboro, OH (row b545cb53), never Westerville', () => {
    expect(ingest(SPRINGBORO)).toMatchObject({ location: 'Springboro, OH', city: 'Springboro', stateCode: 'OH' });
  });
});

describe('Workday multi-location rows emit a jobLocation array', () => {
  it('the joined location string yields one Place per site', () => {
    const location = resolveWorkdayLocation('2 Locations', { primaryLocation: 'Denver, CO', additionalLocations: ['Aurora, CO'] });
    const places = resolveJobPlaces({
      title: 'Nurse Practitioner',
      location,
      city: 'Denver',
      state: 'Colorado',
      stateCode: 'CO',
      isRemote: false,
      isHybrid: false,
    });
    expect(places).toEqual([
      { locality: 'Denver', regionCode: 'CO' },
      { locality: 'Aurora', regionCode: 'CO' },
    ]);
  });

  it('parseWorkdayDetail reads timeType and remoteType', () => {
    const detail = parseWorkdayDetail({ jobPostingInfo: { timeType: 'Full time', remoteType: 'Hybrid' } });
    expect(detail).toMatchObject({ timeType: 'Full time', remoteType: 'Hybrid' });
    expect(parseWorkdayDetail({ jobPostingInfo: {} }).timeType).toBeUndefined();
  });
});

describe('Greenhouse employment-type metadata (H-03 e)', () => {
  it('reads the employment type custom field in any value shape (raw; the normalizer canonicalizes)', () => {
    expect(greenhouseEmploymentType([{ name: 'Employment Type', value: 'Full-Time' }])).toBe('Full-Time');
    expect(greenhouseEmploymentType([{ name: 'Job Type', value: ['Part-time'] }])).toBe('Part-time');
    expect(greenhouseEmploymentType([{ name: 'Time Type', value: { name: 'Per Diem' } }])).toBe('Per Diem');
    expect(greenhouseEmploymentType([{ name: 'Department', value: 'Clinical' }])).toBeUndefined();
    expect(greenhouseEmploymentType(undefined)).toBeUndefined();
  });
});

describe('a location field that says remote is never replaced from the description (review fix)', () => {
  // The probe: a text-only In-Person reading ("outpatient setting") clears
  // the remote flag, and the description names the employer's office. The
  // location fallback used to store that office as the work site, so a
  // remote telehealth job published an on-site New York address.
  const ingest = (description: string, overrides: { title?: string; location?: string } = {}) =>
    normalizeJobWithReason(
      {
        title: overrides.title ?? 'Psychiatric Nurse Practitioner',
        company: 'Example Telepsychiatry',
        location: overrides.location ?? 'Remote',
        description,
        applyLink: 'https://boards.greenhouse.io/example/jobs/2',
        externalId: 'greenhouse-example-2',
      },
      'greenhouse',
    ).job;

  const OFFICE = `${BODY} We are based in New York, NY.`;

  it('the probe case keeps location "Remote" with no city or state', () => {
    const job = ingest(`${OFFICE} Requires 1+ year of experience in an outpatient setting.`);
    expect(job).toBeTruthy();
    expect(job).toMatchObject({ location: 'Remote', city: null, stateCode: null });
    // The path under test: the text reading made it a not fully remote job.
    expect(job!.mode).toBe('In-Person');
  });

  it('the same text without the In-Person phrase stays a remote job, as before', () => {
    const job = ingest(OFFICE);
    expect(job).toMatchObject({ location: 'Remote', city: null, stateCode: null, mode: 'Remote' });
  });

  it('a place the title names still files the job there', () => {
    const job = ingest(`${OFFICE} Requires 1+ year of experience in an outpatient setting.`, {
      title: 'Psychiatric Nurse Practitioner - Nashville, TN',
    });
    expect(job).toMatchObject({ city: 'Nashville', stateCode: 'TN', location: 'Nashville, TN' });
  });

  it('"LA, CA" is filed under California, not Louisiana (location parser review fix)', () => {
    const job = ingest(BODY, { location: 'LA, CA' });
    expect(job).toMatchObject({ state: 'California', stateCode: 'CA' });
  });

  it('a location field with no place and no remote word still reads the description', () => {
    const job = ingest(`Location: Denver, CO\n${BODY} Requires experience in an outpatient setting.`, {
      location: '2 Locations',
    });
    expect(job).toMatchObject({ stateCode: 'CO' });
  });
});
