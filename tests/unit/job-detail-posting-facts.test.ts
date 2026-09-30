/**
 * Indexing audit 2026-09, job page package: the pure facts behind the job
 * detail page and its JobPosting markup (app/jobs/[slug]/job-posting-facts.ts).
 *
 * Fixtures are the live rows the audit cited (GFJ-01, GFJ-02, GFJ-06,
 * GFJ-07, GFJ-13, GFJ-15, GFJ-16, CS-03, H-03).
 */
import { describe, it, expect } from 'vitest';
import {
  STATE_EXCLUSION_RE,
  cleanRoleTitle,
  employmentTypeLabel,
  mapEmploymentTypes,
  resolveEmploymentTypes,
  isJobPostingEligible,
  isStubJobDescription,
  hasJobPostingLocation,
  isUsListing,
  isVerifiedFullyRemote,
  jobPostedAt,
  mapEmploymentType,
  parseLocationList,
  plausibleLocality,
  resolveJobPlaces,
  resolveRemoteApplicantStates,
  resolveRequisitionId,
  resolveWorkModeLabel,
  statesNamedAsLicense,
  statesNamedInTitle,
  statesNearRemoteToken,
  titleNamedPlace,
  type JobPostingFactsInput,
} from '@/app/jobs/[slug]/job-posting-facts';

function job(overrides: Partial<JobPostingFactsInput> = {}): JobPostingFactsInput {
  return {
    title: 'Psychiatric Nurse Practitioner',
    employer: 'Acme Health',
    // Real prose: GFJ-04 makes a stub description ineligible for JobPosting.
    description: 'Provide psychiatric care to adult patients. You will evaluate new patients, manage medications and work closely with therapists and primary care teams.',
    location: 'Austin, TX',
    mode: 'In-Person',
    isRemote: false,
    isHybrid: false,
    city: 'Austin',
    state: 'Texas',
    stateCode: 'TX',
    country: 'US',
    ...overrides,
  };
}

const remoteJob = (overrides: Partial<JobPostingFactsInput> = {}): JobPostingFactsInput =>
  job({
    location: 'Remote',
    mode: 'Remote',
    isRemote: true,
    isHybrid: false,
    city: null,
    state: null,
    stateCode: null,
    description: 'This is a fully remote telepsychiatry position. You will evaluate new patients, manage medications and work closely with therapists and primary care teams.',
    ...overrides,
  });

describe('GFJ-01: TELECOMMUTE only when every signal says 100% remote', () => {
  it('a remote-located, remote-flagged, remote-described job is verified', () => {
    expect(isVerifiedFullyRemote(remoteJob())).toBe(true);
    expect(resolveWorkModeLabel(remoteJob())).toBe('Remote');
  });

  it('the Compass case: isRemote on an in-person Chicago job is not remote', () => {
    const compass = job({
      title: 'Psychiatric Nurse Practitioner - Evenings',
      location: 'Chicago, Illinois, United States',
      mode: 'In-Person',
      isRemote: true,
      isHybrid: false,
      city: 'Chicago',
      state: 'Illinois',
      stateCode: 'IL',
      description: 'This is an onsite, full-time position.',
    });
    expect(isVerifiedFullyRemote(compass)).toBe(false);
    expect(resolveWorkModeLabel(compass)).toBe('In-Person');
  });

  it('both flags true (stale rows) is never remote', () => {
    expect(isVerifiedFullyRemote(remoteJob({ isHybrid: true }))).toBe(false);
  });

  it('mode must agree with the flags', () => {
    expect(isVerifiedFullyRemote(remoteJob({ mode: 'Hybrid' }))).toBe(false);
    expect(isVerifiedFullyRemote(remoteJob({ mode: null }))).toBe(false);
  });

  it('a location without a remote token ("United States", a street) is not proof', () => {
    expect(isVerifiedFullyRemote(remoteJob({ location: 'United States' }))).toBe(false);
    expect(isVerifiedFullyRemote(remoteJob({ location: 'Denver, CO' }))).toBe(false);
    expect(isVerifiedFullyRemote(remoteJob({ location: 'Telecommute' }))).toBe(true);
  });

  it('an on-site or hybrid description, or a negated remote statement, blocks it', () => {
    expect(isVerifiedFullyRemote(remoteJob({ description: 'This role is on-site at our clinic.' }))).toBe(false);
    expect(isVerifiedFullyRemote(remoteJob({ description: 'Hybrid: three days per week on site.' }))).toBe(false);
    expect(isVerifiedFullyRemote(remoteJob({ description: 'Fully remote. This is NOT a 100% remote position.' }))).toBe(false);
    expect(isVerifiedFullyRemote(remoteJob({ description: 'Remote Type: Onsite' }))).toBe(false);
  });

  it('an unverified remote mode shows no chip at all rather than "Remote"', () => {
    expect(resolveWorkModeLabel(remoteJob({ location: 'United States' }))).toBeNull();
    expect(resolveWorkModeLabel(job({ mode: 'Hybrid', isHybrid: true }))).toBe('Hybrid');
    expect(resolveWorkModeLabel(job({ mode: null, isHybrid: true }))).toBe('Hybrid');
    expect(resolveWorkModeLabel(job({ mode: null }))).toBeNull();
  });
});

describe('CS-03 / GFJ-02 / H-03: physical places', () => {
  it('city and state columns make one place', () => {
    expect(resolveJobPlaces(job())).toEqual([{ locality: 'Austin', regionCode: 'TX' }]);
  });

  it('a state-only or city-only row is still a place', () => {
    expect(resolveJobPlaces(job({ city: null, location: 'Texas' }))).toEqual([{ locality: null, regionCode: 'TX' }]);
    expect(resolveJobPlaces(job({ city: 'Charleston', state: null, stateCode: null, location: 'Charleston' }))).toEqual([
      { locality: 'Charleston', regionCode: null },
    ]);
  });

  it('facility names and acronyms are never addressLocality', () => {
    expect(plausibleLocality('MAIN CAMPUS')).toBeNull();
    expect(plausibleLocality('ADVENTHEALTH PORTER')).toBeNull();
    expect(plausibleLocality('GBMC Hospital')).toBeNull();
    expect(plausibleLocality('MMC')).toBeNull();
    expect(plausibleLocality('Boston-')).toBe('Boston');
    expect(plausibleLocality('St. Joseph')).toBe('St. Joseph');
    expect(resolveJobPlaces(job({ city: 'MAIN CAMPUS', state: null, stateCode: null, location: 'MAIN CAMPUS' }))).toEqual([]);
  });

  it('the FB-3 split address (city "1730", state RI) never emits the false RI place', () => {
    const sol = job({ city: '1730', state: 'Rhode Island', stateCode: 'RI' });
    // Columns only: the split address yields nothing at all.
    expect(resolveJobPlaces({ ...sol, location: '1730 Rhode Island Ave NW Suite 400' })).toEqual([]);
    // With the full address in the location string, the District is read
    // from it and the RI column is still ignored.
    const places = resolveJobPlaces({ ...sol, location: '1730 Rhode Island Ave NW, Washington, DC' });
    expect(places.some((p) => p.regionCode === 'RI')).toBe(false);
    expect(places.every((p) => p.locality === null || !/\d/.test(p.locality))).toBe(true);
  });

  it('"2 Locations" / "United States" rows have no place', () => {
    const noPlace = job({ city: null, state: null, stateCode: null, location: '2 Locations', mode: 'Hybrid', isHybrid: true });
    expect(resolveJobPlaces(noPlace)).toEqual([]);
    expect(isJobPostingEligible(noPlace)).toBe(false);
    expect(isJobPostingEligible(job({ city: null, state: null, stateCode: null, location: 'United States' }))).toBe(false);
  });

  it('a multi-location string yields one place per location', () => {
    expect(parseLocationList('Denver, CO; Aurora, CO | Boulder, CO')).toEqual([
      { locality: 'Denver', regionCode: 'CO' },
      { locality: 'Aurora', regionCode: 'CO' },
      { locality: 'Boulder', regionCode: 'CO' },
    ]);
    const multi = job({ city: 'Denver', state: 'Colorado', stateCode: 'CO', location: 'Denver, CO; Aurora, CO' });
    expect(resolveJobPlaces(multi)).toEqual([
      { locality: 'Denver', regionCode: 'CO' },
      { locality: 'Aurora', regionCode: 'CO' },
    ]);
  });

  it('empty columns fall back to a cleanly parsed location string', () => {
    expect(resolveJobPlaces(job({ city: null, state: null, stateCode: null, location: 'Wauwatosa, WI' }))).toEqual([
      { locality: 'Wauwatosa', regionCode: 'WI' },
    ]);
  });

  it('non-US listings have no US place and are not eligible', () => {
    expect(isUsListing({ country: 'Iraq' })).toBe(false);
    expect(isUsListing({ country: 'United States' })).toBe(true);
    expect(isUsListing({ country: null })).toBe(true);
    expect(resolveJobPlaces(job({ country: 'Iraq' }))).toEqual([]);
    expect(isJobPostingEligible(job({ country: 'Iraq' }))).toBe(false);
  });

  it('eligible when a place exists or the job is verified remote', () => {
    expect(isJobPostingEligible(job())).toBe(true);
    expect(isJobPostingEligible(remoteJob())).toBe(true);
    expect(isJobPostingEligible(remoteJob({ location: 'United States' }))).toBe(false);
  });
});

/**
 * M-04 review blocker (round 3): the Thriveworks rows store "VA -
 * Chesterfield" with state Virginia and no city, so every Virginia posting
 * of one role read as "Virginia" alone, in the <title> and in jobLocation.
 */
describe('M-04: a state-only row takes the town its one listed place names', () => {
  const thriveworks = (location: string): JobPostingFactsInput => job({
    title: 'Psychiatric Nurse Practitioner - Fee For Service',
    employer: 'Thriveworks',
    location,
    city: null,
    state: 'Virginia',
    stateCode: null,
    mode: 'Hybrid',
    isHybrid: true,
  });

  it('"VA - Chesterfield" and "VA - Norfolk" give two towns', () => {
    expect(resolveJobPlaces(thriveworks('VA - Chesterfield'))).toEqual([{ locality: 'Chesterfield', regionCode: 'VA' }]);
    expect(resolveJobPlaces(thriveworks('VA - Norfolk'))).toEqual([{ locality: 'Norfolk', regionCode: 'VA' }]);
  });

  it('a listed place in another state never replaces the columns', () => {
    expect(resolveJobPlaces(thriveworks('Denver, CO'))).toEqual([{ locality: null, regionCode: 'VA' }]);
  });

  it('a row whose columns already hold a town keeps it', () => {
    expect(resolveJobPlaces(job({ city: 'Austin', location: 'Round Rock, TX' }))).toEqual([{ locality: 'Austin', regionCode: 'TX' }]);
  });
});

describe('M-04: titleNamedPlace, the place the H1 names', () => {
  const titled = (title: string, overrides: Partial<JobPostingFactsInput> = {}): JobPostingFactsInput =>
    job({ title, city: null, state: null, stateCode: null, location: '2 Locations', ...overrides });

  it('reads a known town and its state out of the title (the DaVita "2 Locations" rows)', () => {
    expect(titleNamedPlace(titled('Nurse Practitioner - Denver, CO (Hybrid)'))).toEqual({ locality: 'Denver', regionCode: 'CO' });
    expect(titleNamedPlace(titled('Nurse Practitioner - Salem, OR (Hybrid)'))).toEqual({ locality: 'Salem', regionCode: 'OR' });
    expect(titleNamedPlace(titled('Nurse Practitioner- Terre Haute, IN - Hybrid Remote'))).toEqual({ locality: 'Terre Haute', regionCode: 'IN' });
    expect(titleNamedPlace(titled('Nurse Practitioner, Springboro/Miamisburg, OH - Hybrid Remote'))).toEqual({ locality: 'Springboro', regionCode: 'OH' });
  });

  it('a state alone is a state, never a town', () => {
    expect(titleNamedPlace(titled('Bilingual Psychiatric Advanced Practice Provider, Arizona, Remote'))).toEqual({ locality: null, regionCode: 'AZ' });
  });

  it('a specialty, a program or a bonus where the town would be is never a town', () => {
    for (const title of ['Nurse Practitioner - Float Pool, TX', 'Nurse Practitioner - Sign On Bonus, TX', 'Nurse Practitioner - Urgent Care, FL']) {
      expect(titleNamedPlace(titled(title))?.locality ?? null, title).toBeNull();
    }
    // An ambiguous code after a specialty ("PA" physician assistant, "OR"
    // operating room, "MA", "CT") names no place at all.
    for (const title of ['Nurse Practitioner - Urgent Care, MA', 'Nurse Practitioner - Primary Care, PA', 'NP - Family Medicine, OR', 'NP - Cardiology, CT']) {
      expect(titleNamedPlace(titled(title)), title).toBeNull();
    }
  });

  it('names nothing for a title without a place, or for a non-US row', () => {
    expect(titleNamedPlace(titled('Psychiatric Nurse Practitioner'))).toBeNull();
    expect(titleNamedPlace(titled('Nurse Practitioner - Denver, CO', { country: 'Canada' }))).toBeNull();
  });
});

describe('M-04: statesNamedAsLicense', () => {
  it('reads the state of a required license', () => {
    expect(statesNamedAsLicense("Psychiatric Mental Health Nurse Practitioner (PMHNP) - Women's Health - California license required")).toEqual(['CA']);
    expect(statesNamedAsLicense("PMHNP - Women's Health - Texas licensed required")).toEqual(['TX']);
    expect(statesNamedAsLicense('Nurse Practitioner, Licensed in Maryland')).toEqual(['MD']);
  });

  it('never reads a physician assistant license or a lowercase word as a state', () => {
    expect(statesNamedAsLicense('NP or PA license required')).toEqual([]);
    expect(statesNamedAsLicense('NP/PA, compact license preferred')).toEqual([]);
    expect(statesNamedAsLicense('Nurse Practitioner, multistate license')).toEqual([]);
  });
});

describe('M-04: statesNamedInTitle, every state a title names', () => {
  it('reads a state anywhere in the title, by name or code', () => {
    expect(statesNamedInTitle('North Carolina | Telehealth Psychiatric Mental Health Nurse Practitioner (PMHNP)')).toEqual(['NC']);
    expect(statesNamedInTitle('Nephrology PA or NP with CA License - Fully Virtual Opportunity')).toEqual(['CA']);
    expect(statesNamedInTitle('Psychiatric Nurse Practitioner - Oregon, Remote')).toEqual(['OR']);
    expect(statesNamedInTitle('Nurse Practitioner - West Virginia')).toEqual(['WV']);
  });

  it('lists every state of a multi-state title, each once', () => {
    expect(statesNamedInTitle('PMHNP - California and Texas license required').sort()).toEqual(['CA', 'TX']);
    expect(statesNamedInTitle('PMHNP - California/Nevada licensed').sort()).toEqual(['CA', 'NV']);
    expect(statesNamedInTitle('PMHNP - licensed in Oregon or Washington').sort()).toEqual(['OR', 'WA']);
    expect(statesNamedInTitle('PMHNP - CA, TX or FL license required').sort()).toEqual(['CA', 'FL', 'TX']);
    expect(statesNamedInTitle('Texas | PMHNP, Texas licensed')).toEqual(['TX']);
  });

  it('a bare code that is a credential, a service or a word is not a state', () => {
    expect(statesNamedInTitle('Telehealth Psychiatric Provider (MD, DO, NP or PA)')).toEqual([]);
    expect(statesNamedInTitle('NURSE PRACTITIONER OR PHYSICIAN ASSISTANT')).toEqual([]);
    expect(statesNamedInTitle('Nurse Practitioner, ID Clinic')).toEqual([]);
    expect(statesNamedInTitle('Nurse Practitioner, CT Surgery')).toEqual([]);
    expect(statesNamedInTitle('Nurse Practitioner, VA Community Clinic')).toEqual([]);
    expect(statesNamedInTitle('Psychiatric Nurse Practitioner')).toEqual([]);
    expect(statesNamedInTitle(null)).toEqual([]);
  });

  it('the same code beside a remote token or a license word is a state', () => {
    expect(statesNamedInTitle('Psychiatric NP, Remote OR')).toEqual(['OR']);
    expect(statesNamedInTitle('PMHNP, MD license required')).toEqual(['MD']);
    expect(statesNamedInTitle('Nurse Practitioner, Licensed in Maryland')).toEqual(['MD']);
  });

  /*
   * Review blocker (M-04): a word-like code listed beside another state
   * ("OR/WA", "ME/NH") was dropped, so a two-state title read as naming one
   * state and the <title> claimed the wrong single state.
   */
  it.each<[string, string[]]>([
    ['Telehealth PMHNP - OR/WA', ['OR', 'WA']],
    ['Telehealth PMHNP - OR, WA', ['OR', 'WA']],
    ['Telehealth PMHNP - OR and WA', ['OR', 'WA']],
    ['PMHNP - OR/WA license required', ['OR', 'WA']],
    ['Telehealth PMHNP - ME/NH', ['ME', 'NH']],
    ['Telehealth PMHNP - IN/OH', ['IN', 'OH']],
    ['Telehealth PMHNP - MD/DC/VA', ['DC', 'MD', 'VA']],
  ])('a word-like code listed beside another state counts: "%s" names %j', (title, codes) => {
    expect(statesNamedInTitle(title).sort()).toEqual(codes);
  });

  it('a word-like code not listed beside a state still does not count', () => {
    expect(statesNamedInTitle('Telehealth Psychiatric Provider (MD, DO, NP or PA)')).toEqual([]);
    expect(statesNamedInTitle('TELEHEALTH NP OR PA')).toEqual([]);
    expect(statesNamedInTitle('Nurse Practitioner, ID Clinic, Texas')).toEqual(['TX']);
    expect(statesNamedInTitle('CT Surgery Nurse Practitioner - Ohio')).toEqual(['OH']);
    expect(statesNamedInTitle('VA Community Clinic NP')).toEqual([]);
  });
});

describe('statesNearRemoteToken reads a preposition in any case', () => {
  it('"REMOTE IN TEXAS" is Texas, and a bare "Remote IN" is still Indiana', () => {
    expect(statesNearRemoteToken('PSYCHIATRIC NURSE PRACTITIONER, REMOTE IN TEXAS')).toEqual(['TX']);
    expect(statesNearRemoteToken('Psychiatric NP, Remote in Texas')).toEqual(['TX']);
    expect(statesNearRemoteToken('Psychiatric NP, Remote IN')).toEqual(['IN']);
    expect(statesNearRemoteToken('Psychiatric NP, Remote IN, OH')).toEqual(['IN', 'OH']);
  });
});

describe('GFJ-07: remote jobs restricted to a state say so', () => {
  it('reads the state beside the title remote token', () => {
    expect(statesNearRemoteToken('PMHNP, Remote TX Part Time, Up to 90 an Hour')).toEqual(['TX']);
    expect(statesNearRemoteToken('Bilingual Psychiatric Nurse Practitioner - Oregon, Remote')).toEqual(['OR']);
    expect(statesNearRemoteToken('Psychiatric Advance Practice Provider, Iowa, Remote')).toEqual(['IA']);
    expect(statesNearRemoteToken('Telepsychiatry NP, Remote (CA, NV)')).toEqual(['CA', 'NV']);
    expect(statesNearRemoteToken('Nurse Practitioner, Remote in Texas')).toEqual(['TX']);
  });

  it('never reads PA (physician assistant) or lowercase words as states', () => {
    expect(statesNearRemoteToken('Remote NP/PA')).toEqual([]);
    expect(statesNearRemoteToken('NP or PA, Remote')).toEqual([]);
    expect(statesNearRemoteToken('Remote or hybrid NP')).toEqual([]);
    expect(statesNearRemoteToken('Remote Patient Monitoring NP')).toEqual([]);
  });

  it('collects states from the location string and the title', () => {
    expect(resolveRemoteApplicantStates(remoteJob({ location: 'Remote - TX' }))).toEqual(['Texas']);
    expect(resolveRemoteApplicantStates(remoteJob({ title: 'PMHNP, Remote TX' }))).toEqual(['Texas']);
    expect(resolveRemoteApplicantStates(remoteJob())).toEqual([]);
  });

  it('does not restrict by a stored state the employer never wrote', () => {
    expect(resolveRemoteApplicantStates(remoteJob({ state: 'New York', stateCode: 'NY' }))).toEqual([]);
  });

  it('reads every state listed after the location string remote token', () => {
    expect(resolveRemoteApplicantStates(remoteJob({ location: 'Remote - CA, NV' }))).toEqual(['California', 'Nevada']);
    expect(resolveRemoteApplicantStates(remoteJob({ location: 'Oregon, Remote' }))).toEqual(['Oregon']);
  });
});

/**
 * Review blocker (round 5): parseLocation reads "Remote (excluding CA)" as
 * California, so the excluded state became the applicant state, the
 * jobLocation and the title's place. A state written with exclusion wording
 * is where the job is NOT open.
 */
describe('GFJ-07: a state named with exclusion wording is never a place', () => {
  const EXCLUDING_LOCATIONS = [
    'Remote (excluding CA)',
    'Remote - except California',
    'Remote - Not available in CA',
    'Remote, US (excluding TX)',
    'Remote - TX excluded',
    'Remote - US (excluding CA, NY)',
    'US Remote - All states except New York',
  ];

  it.each(EXCLUDING_LOCATIONS)('STATE_EXCLUSION_RE reads "%s" as an exclusion', (location) => {
    expect(STATE_EXCLUSION_RE.test(location)).toBe(true);
  });

  it('STATE_EXCLUSION_RE leaves plain places and remote states alone', () => {
    for (const text of ['Remote - Texas', 'Texas (Remote)', 'Austin, TX', 'Denver, CO; Aurora, CO', 'PMHNP - California license required', 'Psychiatric Nurse Practitioner - Oregon, Remote']) {
      expect(STATE_EXCLUSION_RE.test(text), text).toBe(false);
    }
  });

  it.each(EXCLUDING_LOCATIONS)('"%s" lists no place and restricts no applicant', (location) => {
    expect(parseLocationList(location)).toEqual([]);
    expect(resolveRemoteApplicantStates(remoteJob({ location }))).toEqual([]);
  });

  it('a title that excludes a state names no place and no applicant state', () => {
    for (const title of ['PMHNP - All states except California, Remote', 'PMHNP - Anywhere except CA - Remote', 'Remote PMHNP (Texas excluded)']) {
      expect(titleNamedPlace({ title, description: null, country: 'US' }), title).toBeNull();
      expect(resolveRemoteApplicantStates(remoteJob({ title })), title).toEqual([]);
    }
  });

  it('a state-only column beside an excluding location string is not the job place', () => {
    const excluded = job({ city: null, state: 'California', stateCode: 'CA', location: 'Remote (excluding CA)', mode: 'Hybrid', isHybrid: true });
    expect(resolveJobPlaces(excluded)).toEqual([]);
    expect(isJobPostingEligible(excluded)).toBe(false);
  });

  it('guards: a town column, or a state written without exclusion wording, still counts', () => {
    expect(resolveJobPlaces(job({ location: 'Remote (excluding CA)' }))).toEqual([{ locality: 'Austin', regionCode: 'TX' }]);
    expect(resolveRemoteApplicantStates(remoteJob({ location: 'Remote - Texas' }))).toEqual(['Texas']);
    expect(resolveRemoteApplicantStates(remoteJob({ location: 'Texas (Remote)' }))).toEqual(['Texas']);
    expect(resolveJobPlaces(job())).toEqual([{ locality: 'Austin', regionCode: 'TX' }]);
  });
});

describe('H-03: resolveEmploymentTypes, the types the chip and employmentType show', () => {
  const typed = (jobType: string | null, description: string, title = 'Nurse Practitioner') => ({ jobType, title, description });

  it('completes the stored type with a second schedule the posting offers', () => {
    expect(resolveEmploymentTypes(typed('Full-Time', 'Full-time or part-time schedules are available.'))).toEqual(['Full-Time', 'Part-Time']);
    expect(mapEmploymentTypes(['Full-Time', 'Part-Time'])).toEqual(['FULL_TIME', 'PART_TIME']);
  });

  it('never contradicts a stored type the text does not also state', () => {
    expect(resolveEmploymentTypes(typed('Part-Time', 'Full-time or per diem shifts.'))).toEqual(['Part-Time']);
  });

  it('a PRN medication term adds no per diem', () => {
    expect(resolveEmploymentTypes(typed('Full-Time', 'Review PRN medication orders. This is a full-time position.'))).toEqual(['Full-Time']);
  });

  it('a stored Contract on a W-2 posting shows what the posting states instead', () => {
    expect(resolveEmploymentTypes(typed('Contract', 'Provide telepsychiatry visits. Build your own schedule.', 'Psychiatric Nurse Practitioner, Fee For Service (W2)')))
      .toEqual(['Full-Time']);
    expect(resolveEmploymentTypes(typed('Contract', 'This is a W-2 contract position for 13 weeks.'))).toEqual([]);
    expect(employmentTypeLabel(resolveEmploymentTypes(typed('Contract', 'This is a W-2 contract position for 13 weeks.')))).toBeNull();
  });

  it('a stored Contract without W-2 stays, and no type is ever invented', () => {
    expect(resolveEmploymentTypes(typed('Contract', 'Clinic care.'))).toEqual(['Contract']);
    expect(resolveEmploymentTypes(typed(null, 'Full-time role.'))).toEqual([]);
  });
});

describe('GFJ-06: employmentType', () => {
  it('omits an unknown type instead of defaulting to FULL_TIME', () => {
    expect(mapEmploymentType(null)).toBeUndefined();
    expect(mapEmploymentType('')).toBeUndefined();
    expect(mapEmploymentType('Seasonal Something')).toBeUndefined();
  });

  it('maps every stored vocabulary value', () => {
    expect(mapEmploymentType('Full-Time')).toBe('FULL_TIME');
    expect(mapEmploymentType('Part-Time')).toBe('PART_TIME');
    expect(mapEmploymentType('Contract')).toBe('CONTRACTOR');
    expect(mapEmploymentType('Per Diem')).toBe('PER_DIEM');
    expect(mapEmploymentType('PRN')).toBe('PER_DIEM');
    expect(mapEmploymentType('Internship')).toBe('INTERN');
    expect(mapEmploymentType('Locum Tenens')).toEqual(['CONTRACTOR', 'TEMPORARY']);
  });
});

describe('GFJ-13: identifier is the employer requisition id', () => {
  it('parses the ATS id out of the ingest externalId', () => {
    expect(resolveRequisitionId('greenhouse-medelitellc-5408840008')).toBe('5408840008');
    expect(resolveRequisitionId('lever-acme-health-0f8c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f')).toBe('0f8c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f');
    expect(resolveRequisitionId('workday-multicare-ARNP-Inpatient-Psych_RS12345')).toBe('RS12345');
    expect(resolveRequisitionId('workday-davita-Nurse-Practitioner_R0123456-1')).toBe('R0123456-1');
    expect(resolveRequisitionId('usajobs-812345600')).toBe('812345600');
    expect(resolveRequisitionId('workable-tenant-A1B2C3D4E5')).toBe('A1B2C3D4E5');
  });

  it('third-party board ids and missing ids yield nothing', () => {
    expect(resolveRequisitionId('adzuna_4812345')).toBeNull();
    expect(resolveRequisitionId('fantasticjobs-linkedin-123456')).toBeNull();
    expect(resolveRequisitionId('hcc-98765')).toBeNull();
    expect(resolveRequisitionId('workday-acme-Nurse-Practitioner')).toBeNull();
    expect(resolveRequisitionId(null)).toBeNull();
  });
});

describe('GFJ-16: one posted date', () => {
  it('prefers the employer original date, else createdAt', () => {
    const created = new Date('2026-07-31T10:00:00Z');
    const original = new Date('2026-07-30T00:00:00Z');
    expect(jobPostedAt({ originalPostedAt: original, createdAt: created })).toEqual(original);
    expect(jobPostedAt({ originalPostedAt: null, createdAt: created })).toEqual(created);
    expect(jobPostedAt({ originalPostedAt: null, createdAt: '2026-07-31T10:00:00.000Z' })).toEqual(created);
  });
});

describe('GFJ-15: the clean role title', () => {
  const ctx = { city: null, state: null, stateCode: null, employer: 'Acme Health' };

  it('strips pay, bonus, place and work-mode segments', () => {
    expect(cleanRoleTitle('PMHNP, Remote TX Part Time, Up to 90 an Hour', ctx)).toBe('PMHNP');
    expect(cleanRoleTitle('Nurse Practitioner - Denver, CO (Hybrid)', ctx)).toBe('Nurse Practitioner');
    expect(cleanRoleTitle('Nurse Practitioner - Newark, NJ- Hybrid Remote', ctx)).toBe('Nurse Practitioner');
    expect(cleanRoleTitle('$3000 Sign on Bonus - Nurse Practitioner or Physician Assistant (Baltimore County)', ctx))
      .toBe('Nurse Practitioner or Physician Assistant');
    expect(cleanRoleTitle('Family Nurse Practitioner - Sign-On Bonus Available', ctx)).toBe('Family Nurse Practitioner');
    expect(cleanRoleTitle('Psychiatric Advance Practice Provider, Iowa, Remote', ctx)).toBe('Psychiatric Advance Practice Provider');
    expect(cleanRoleTitle('Nurse Practitioner · Behavioral Health · Full Time', ctx)).toBe('Nurse Practitioner, Behavioral Health');
  });

  it('drops the stored city, the employer name and job codes', () => {
    expect(cleanRoleTitle('Gastroenterology Nurse Practitioner/ Physician Assistant , Houston', { ...ctx, city: 'Houston' }))
      .toBe('Gastroenterology Nurse Practitioner/ Physician Assistant');
    expect(cleanRoleTitle('Acme Health - PMHNP', ctx)).toBe('PMHNP');
    expect(cleanRoleTitle('Nurse Practitioner (Req #12345)', ctx)).toBe('Nurse Practitioner');
  });

  it('keeps role segments and role parentheticals, without dash separators', () => {
    expect(cleanRoleTitle('Psychiatric Nurse Practitioner - Evenings', ctx)).toBe('Psychiatric Nurse Practitioner, Evenings');
    expect(cleanRoleTitle('Psychiatric Nurse Practitioner (PMHNP)', ctx)).toBe('Psychiatric Nurse Practitioner (PMHNP)');
    expect(cleanRoleTitle('NP/PA - Inpatient Psychiatry', ctx)).toBe('NP/PA, Inpatient Psychiatry');
    expect(cleanRoleTitle('Full-Time Nurse Practitioner', ctx)).toBe('Full-Time Nurse Practitioner');
  });

  it('falls back to the stored title when every segment is noise', () => {
    expect(cleanRoleTitle('Remote - Texas', ctx)).toBe('Remote, Texas');
  });

  it('drops a town the title itself names when the city column is empty (M-04)', () => {
    expect(cleanRoleTitle('Nurse Practitioner, Parkersburg, WV- Hybrid Remote', ctx)).toBe('Nurse Practitioner');
    expect(cleanRoleTitle('Nurse Practitioner, Springboro/Miamisburg, OH - Hybrid Remote', ctx)).toBe('Nurse Practitioner');
    // A stored city still decides when there is one.
    expect(cleanRoleTitle('Nurse Practitioner, Parkersburg, WV', { ...ctx, city: 'Vienna', state: 'West Virginia', stateCode: 'WV' }))
      .toBe('Nurse Practitioner, Parkersburg');
    // A word the title does not tie to a state stays a role word.
    expect(cleanRoleTitle('Nurse Practitioner - Parkersburg', ctx)).toBe('Nurse Practitioner, Parkersburg');
  });

  /** Every "(" has its ")" and none closes before it opens. */
  function balanced(text: string): boolean {
    let depth = 0;
    for (const c of text) {
      if (c === '(') depth += 1;
      if (c === ')') depth -= 1;
      if (depth < 0) return false;
    }
    return depth === 0;
  }

  // Review blocker: the comma split cut numbers in half ("NP, 000") and the
  // separator split ran inside a parenthetical, leaving a stray "(".
  it.each<[string, string]>([
    ['NP - Up to $150,000', 'NP'],
    ['Family Nurse Practitioner (FNP) - Sign-On Bonus $10,000 - Urgent Care', 'Family Nurse Practitioner (FNP), Urgent Care'],
    ['Nurse Practitioner, $125,000 to $150,000', 'Nurse Practitioner'],
    ['Nurse Practitioner - 1,000 Bed Hospital', 'Nurse Practitioner, 1,000 Bed Hospital'],
    ['Psychiatric Nurse Practitioner (Remote - Oregon)', 'Psychiatric Nurse Practitioner'],
    ['Psychiatric Nurse Practitioner (Remote - Washington)', 'Psychiatric Nurse Practitioner'],
    ['Advanced Practice Provider (NP - Outpatient)', 'Advanced Practice Provider (NP, Outpatient)'],
    ['Family Nurse Practitioner (FNP - Remote)', 'Family Nurse Practitioner (FNP)'],
    ['Nurse Practitioner (Part-Time, Evenings)', 'Nurse Practitioner (Evenings)'],
    ['Nurse Practitioner (Outpatient - Denver, CO)', 'Nurse Practitioner (Outpatient)'],
    ['Nurse Practitioner (Remote', 'Nurse Practitioner'],
    ['Nurse Practitioner (Remote) Oncology', 'Nurse Practitioner Oncology'],
  ])('%s gives %s, whole words and balanced parentheses', (stored, role) => {
    const cleaned = cleanRoleTitle(stored, ctx);
    expect(cleaned).toBe(role);
    expect(balanced(cleaned)).toBe(true);
    // No word or number is cut: every word of the output is a word of the input.
    const inputWords = new Set(stored.split(/[\s,()]+/).filter(Boolean));
    for (const word of cleaned.split(/[\s,()]+/).filter(Boolean)) expect(inputWords.has(word), word).toBe(true);
  });
});

describe('GFJ-04: a stub description is not eligible for a JobPosting', () => {
  const TELEVERO =
    'PMHNP, Remote TX Part Time, Up to 90 an Hour\nEmployer: Televero Health\nDepartment: Clinical\nEmployment: Part-Time\nLocation: United States';

  it('flags the Televero title-plus-metadata stub', () => {
    const stub = remoteJob({ title: 'PMHNP, Remote TX Part Time, Up to 90 an Hour', description: TELEVERO });
    expect(isStubJobDescription(stub)).toBe(true);
    // The location rule alone would pass; the description rule does not.
    expect(hasJobPostingLocation(stub)).toBe(true);
    expect(isJobPostingEligible(stub)).toBe(false);
  });

  it('a real posting is not a stub', () => {
    expect(isStubJobDescription(job())).toBe(false);
    expect(isJobPostingEligible(job())).toBe(true);
  });
});

describe('CQ-02: plausibleLocality', () => {
  it('rejects practice names and keeps towns', () => {
    expect(plausibleLocality('SMG Psychiatric Specialists')).toBeNull();
    expect(plausibleLocality('Behavioral Associates')).toBeNull();
    expect(plausibleLocality('1730')).toBeNull();
    expect(plausibleLocality('Virginia Beach')).toBe('Virginia Beach');
  });
});
