/**
 * Planners behind scripts/indexing-fixes/*. The scripts only read and print
 * unless --apply is passed; these pin WHAT they would change, on row shapes
 * taken from production (fetched 2026-09-28).
 */
import { describe, it, expect } from 'vitest';
import {
  planFb3,
  planLocationCorrection,
  planPayCorrection,
  planDuplicateGroups,
  planLocationBackfill,
  planOnsiteReclassify,
  planRemoteReclassify,
  planStateOnlyTownBackfill,
  isPhantomState,
  isStubRow,
  nonUsWorkSite,
  workdayDetailUrl,
  isRawClampValue,
  planJobTypeRederive,
  legacyDetectJobType,
  isEmployerPosted,
  republishBlocker,
  shouldRepublishHeld,
  type JobRow,
} from '../../scripts/indexing-fixes/lib/planners';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BODY =
  'We are seeking a psychiatric nurse practitioner to provide medication management and psychiatric ' +
  'evaluations for adults. You will collaborate with therapists and a supervising psychiatrist, document ' +
  'visits in our EHR and take part in weekly case reviews. Requirements include an active license.';

function row(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: 'job-1',
    slug: 'psychiatric-clinician-job-1',
    title: 'Psychiatric Clinician',
    employer: 'Sol Mental Health',
    location: 'Austin, TX',
    description: BODY,
    city: 'Austin',
    state: 'Texas',
    stateCode: 'TX',
    country: 'US',
    isRemote: false,
    isHybrid: false,
    mode: 'In-Person',
    jobType: null,
    minSalary: null,
    maxSalary: null,
    salaryPeriod: null,
    salaryRange: null,
    normalizedMinSalary: null,
    normalizedMaxSalary: null,
    salaryIsEstimated: false,
    salaryConfidence: null,
    displaySalary: null,
    isPublished: true,
    isManuallyUnpublished: false,
    sourceType: 'external',
    sourceProvider: 'greenhouse',
    applyLink: 'https://example.com/apply',
    createdAt: new Date('2026-09-01T00:00:00Z'),
    expiresAt: new Date('2026-10-30T00:00:00Z'),
    ...overrides,
  };
}

const SOL_DESCRIPTION =
  `${BODY}\nBenefits include a CEU budget of $1,500 annually.\nCompensation $140,000 - $228,400+ depending on experience.`;

// The Sol Mental Health shape: raw $30,000 (the old clamp of a $1,500 CEU
// budget), normalized $48,000 (the normalizer's clamp), "$48k/yr" shown.
const SOL_PAY = {
  description: SOL_DESCRIPTION,
  minSalary: 30000,
  maxSalary: null,
  salaryPeriod: 'annual',
  normalizedMinSalary: 48000,
  normalizedMaxSalary: null,
  salaryConfidence: 0.5,
  displaySalary: '$48k/yr',
} as const;

describe('FB-3 and the Sol Mental Health correction', () => {
  const dc = row({
    location: '1730 Rhode Island Ave NW, Washington, DC, 20036',
    city: '1730',
    state: 'Rhode Island',
    stateCode: 'RI',
    ...SOL_PAY,
  });

  it('flags the DC row for its false state, number city and invented pay', () => {
    expect(planFb3(dc)?.reasons).toEqual(['wrong_state', 'address_or_number_city', 'pay_not_stated_by_employer']);
  });

  it('corrects it to Washington, DC and the stated range', () => {
    expect(planLocationCorrection(dc)?.next).toEqual({ city: 'Washington', state: 'District of Columbia', stateCode: 'DC' });
    const pay = planPayCorrection(dc)!;
    expect(pay.reason).toBe('clamped_raw_value');
    expect(pay.next).toMatchObject({
      minSalary: 140000,
      maxSalary: 228400,
      normalizedMinSalary: 140000,
      normalizedMaxSalary: 228400,
      salaryIsEstimated: false,
      displaySalary: '$140k to $228k/yr',
    });
  });

  // CQ-02 skeptic: an address stored as the city in the RIGHT state is messy
  // data, not false location. It is corrected in place, never unpublished.
  it('fixes an address city in place while keeping the correct state, without unpublishing', () => {
    const frederick = row({
      location: '5100 Buckeyestown Pike Suite 200 Frederick, MD 21704',
      city: '5100 Buckeyestown Pike Suite 200 Frederick',
      state: 'Maryland',
      stateCode: 'MD',
    });
    expect(planLocationCorrection(frederick)).toEqual({
      reasons: ['address_or_facility_city'],
      next: { city: 'Frederick', state: 'Maryland', stateCode: 'MD' },
    });
    expect(planFb3(frederick)).toBeNull();
  });

  it("leaves the Saint Luke's address city to the in-place correction", () => {
    const saintLukes = row({
      employer: "Saint Luke's Health System",
      location: '4401 Wornall Rd Kansas City, MO',
      city: '4401 Wornall Rd Kansas City',
      state: 'Missouri',
      stateCode: 'MO',
    });
    expect(planFb3(saintLukes)).toBeNull();
    expect(planLocationCorrection(saintLukes)).toEqual({
      reasons: ['address_or_facility_city'],
      next: { city: 'Kansas City', state: 'Missouri', stateCode: 'MO' },
    });
  });

  it('still unpublishes a bare street number shown as the city', () => {
    const numberOnly = row({ location: '1730 Rhode Island Ave NW, Washington, DC, 20036', city: '1730', state: 'District of Columbia', stateCode: 'DC' });
    expect(planFb3(numberOnly)?.reasons).toEqual(['address_or_number_city']);
    expect(planLocationCorrection(numberOnly)?.next).toEqual({ city: 'Washington', state: 'District of Columbia', stateCode: 'DC' });
  });

  it('clears a clamp value the posting never states', () => {
    const pay = planPayCorrection(row({ ...SOL_PAY, description: BODY }))!;
    expect(pay.next).toMatchObject({ minSalary: null, normalizedMinSalary: null, displaySalary: null });
  });

  it('re-normalizes a real figure the old normalizer raised to $48k', () => {
    const mrg = row({
      minSalary: 40000, maxSalary: 44000, salaryPeriod: 'annual',
      normalizedMinSalary: 48000, normalizedMaxSalary: 48000, salaryConfidence: 0.5, displaySalary: '$48k/yr',
    });
    const pay = planPayCorrection(mrg)!;
    expect(pay.reason).toBe('clamped_normalized_value');
    expect(pay.next).toMatchObject({ minSalary: 40000, maxSalary: 44000, normalizedMinSalary: 40000, normalizedMaxSalary: 44000 });
    expect(pay.next.salaryConfidence ?? 1).toBeLessThan(0.8);
  });

  it("does not unpublish a row whose raw figure is the employer's own (MRG $40k to $44k stored as $48k normalized)", () => {
    const mrg = row({
      minSalary: 40000, maxSalary: 44000, salaryPeriod: 'annual',
      normalizedMinSalary: 48000, normalizedMaxSalary: 48000, salaryConfidence: 0.5, displaySalary: '$48k/yr',
    });
    // correct-location-and-pay.ts fixes the normalized columns in place.
    expect(planPayCorrection(mrg)?.reason).toBe('clamped_normalized_value');
    expect(planFb3(mrg)).toBeNull();
  });

  it('leaves a correct row alone', () => {
    const ok = row({ minSalary: 140000, maxSalary: 180000, salaryPeriod: 'annual', normalizedMinSalary: 140000, normalizedMaxSalary: 180000, salaryConfidence: 1 });
    expect(planPayCorrection(ok)).toBeNull();
    expect(planLocationCorrection(ok)).toBeNull();
    expect(planFb3(ok)).toBeNull();
  });

  it('knows the old clamp bounds', () => {
    expect(isRawClampValue(30000, 'annual')).toBe(true);
    expect(isRawClampValue(350, 'hourly')).toBe(true);
    expect(isRawClampValue(125000, 'annual')).toBe(false);
  });
});

describe("MedElite: the employer's own $30,000 only looks like a clamp", () => {
  // Raw $30,000 to $90,000 is the posting's own range; only the normalized
  // minimum was raised to $48,000. The raw minimum equals the old annual
  // clamp bound, which made the first cut unpublish the row and, for the
  // unlabelled form, clear the employer's salary.
  const medelite = (description: string): JobRow => row({
    employer: 'MedElite',
    title: 'Psychiatric Nurse Practitioner',
    location: 'Stoughton, MA', city: 'Stoughton', state: 'Massachusetts', stateCode: 'MA',
    description: `${BODY}\n${description}`,
    minSalary: 30000, maxSalary: 90000, salaryPeriod: 'annual', salaryRange: '$30,000 to $90,000',
    normalizedMinSalary: 48000, normalizedMaxSalary: 90000, salaryConfidence: 0.5, displaySalary: '$48k to $90k/yr',
  });

  it.each([
    ['labelled', 'Salary Range: $30,000 - $90,000 depending on hours.'],
    ['unlabelled', 'This part-time role offers $30,000 - $90,000 depending on hours.'],
  ])('%s range: not FB-3, corrected in place to its own figure', (_label, text) => {
    const row = medelite(text);
    expect(planFb3(row)).toBeNull();
    const pay = planPayCorrection(row)!;
    expect(pay.reason).toBe('clamped_raw_value');
    expect(pay.next).toMatchObject({ minSalary: 30000, maxSalary: 90000, normalizedMinSalary: 30000, normalizedMaxSalary: 90000 });
  });
});

describe('Sentara: an invented $30,000 minimum under a stated "Pay Range:"', () => {
  const sentara = row({
    employer: 'Sentara Health',
    title: 'Nurse Practitioner Flex/PRN',
    location: 'Virginia Beach, VA', city: 'Virginia Beach', state: 'Virginia', stateCode: 'VA',
    description: `${BODY}\nPay Range: $107,785.60 - $312,000.00`,
    minSalary: 30000, maxSalary: 312000, salaryPeriod: 'annual',
    normalizedMinSalary: 48000, normalizedMaxSalary: 312000, salaryConfidence: 0.5, displaySalary: '$48k to $312k/yr',
  });

  it('corrects the pay to the stated range instead of clearing it', () => {
    const pay = planPayCorrection(sentara)!;
    expect(pay.next).toMatchObject({ minSalary: 107786, maxSalary: 312000, normalizedMinSalary: 107786 });
  });

  it('is FB-3, because the page showed a minimum the employer never stated', () => {
    expect(planFb3(sentara)?.reasons).toEqual(['pay_not_stated_by_employer']);
  });
});

describe('multi-location postings are never "wrong state"', () => {
  // Stored as b393f53 (and the fixed parser) read them: the first place.
  it.each([
    ['Kansas City, MO; Overland Park, KS', 'Kansas City', 'Missouri', 'MO'],
    ['Phoenix, AZ; Tucson, AZ', 'Phoenix', 'Arizona', 'AZ'],
    ['Vancouver, WA / Portland, OR', 'Vancouver', 'Washington', 'WA'],
    ['Remote - TX, FL, GA', null, 'Texas', 'TX'],
    ['TX, FL, GA', null, 'Texas', 'TX'],
    ['Seattle, WA, Portland, OR', 'Seattle', 'Washington', 'WA'],
  ])('%s stored as the first-listed place: nothing to do', (location, city, state, stateCode) => {
    const listed = row({ location, city, state, stateCode });
    expect(planFb3(listed)).toBeNull();
    expect(planLocationCorrection(listed)).toBeNull();
  });

  it.each([
    ['Kansas City, MO; Overland Park, KS', 'Overland Park', 'Kansas', 'KS'],
    ['Vancouver, WA / Portland, OR', 'Portland', 'Oregon', 'OR'],
    ['Remote - TX, FL, GA', null, 'Georgia', 'GA'],
  ])('%s stored as a later listed place: kept, not unpublished', (location, city, state, stateCode) => {
    const listed = row({ location, city, state, stateCode });
    expect(planFb3(listed)).toBeNull();
    expect(planLocationCorrection(listed)?.reasons ?? []).not.toContain('wrong_state');
  });

  it('clears a state code or a list stored as the city, in place', () => {
    const listed = row({ location: 'Remote - CA, NY', city: 'CA', state: 'New York', stateCode: 'NY' });
    expect(planFb3(listed)).toBeNull();
    expect(planLocationCorrection(listed)).toEqual({
      reasons: ['address_or_facility_city'],
      next: { city: null, state: 'New York', stateCode: 'NY' },
    });
  });

  it('still flags a state the text names only as a street', () => {
    const dc = row({ location: '1730 Rhode Island Ave NW, Washington, DC', city: 'Washington', state: 'Rhode Island', stateCode: 'RI' });
    expect(planLocationCorrection(dc)?.reasons).toEqual(['wrong_state']);
    expect(planFb3(dc)?.reasons).toEqual(['wrong_state']);
  });
});

describe('non-US rows', () => {
  it('flags the International SOS Iraq rows filed under US cities', () => {
    const iraq = row({
      employer: 'International SOS',
      title: 'Certified Registered Nurse Anesthetist - (Iraq)',
      location: 'Philadelphia, PA', city: 'Philadelphia', state: 'Pennsylvania', stateCode: 'PA',
      description: `${BODY}\nMust be able to relocate to Iraq for the duration of the project.`,
    });
    expect(nonUsWorkSite(iraq)).toMatchObject({ country: 'IQ' });
    expect(planFb3(iraq)?.reasons).toContain('non_us_work_site');
  });

  it('never flags a US row', () => {
    expect(nonUsWorkSite(row())).toBeNull();
  });

  it('never flags a US row about veterans or military families', () => {
    const tampa = row({
      location: 'Tampa, FL', city: 'Tampa', state: 'Florida', stateCode: 'FL',
      description: `${BODY} Serve veterans who deployed to Iraq and Afghanistan. We support military families stationed in Germany.`,
    });
    expect(nonUsWorkSite(tampa)).toBeNull();
    expect(planFb3(tampa)).toBeNull();
  });

  // Owner decision 2026-09-29: a posting that lists the United States among
  // its places is a US job. The unpublish script must never pin one off the
  // site, even when its stored country column names the other place.
  it.each([
    { location: 'United States, Canada', country: 'CA' },
    { location: 'Remote (US, Canada)', country: 'US' },
    { location: 'Canada, United States', country: null },
    { title: 'Psychiatric NP - US, Canada', location: 'Toronto, ON', country: 'CA' },
  ])('never flags a row that lists the United States: %o', (over) => {
    expect(nonUsWorkSite(row({ city: null, state: null, stateCode: null, ...over }))).toBeNull();
  });

  it('still flags a row with no US place', () => {
    expect(nonUsWorkSite(row({ location: 'Remote - Canada', city: null, state: null, stateCode: null, country: 'US' })))
      .toMatchObject({ country: 'CA', evidence: 'location' });
  });

  // Review round 3: stored under California (the ISO code read as the state)
  // or kept as US (the brackets hid the country).
  it.each([
    { location: 'Toronto, ON, CA', city: null, state: 'California', stateCode: 'CA' },
    { location: 'Toronto, Ontario, CA', city: 'Ontario', state: 'California', stateCode: 'CA' },
    { location: 'CA-ON-Toronto', city: 'ON-Toronto', state: 'California', stateCode: 'CA' },
    { location: 'Remote (Canada)', city: null, state: null, stateCode: null },
  ])('flags a Canadian row stored as a US one: %o', (over) => {
    expect(nonUsWorkSite(row({ country: 'US', ...over }))).toMatchObject({ country: 'CA', evidence: 'location' });
  });

  it('never flags Ontario, California', () => {
    expect(nonUsWorkSite(row({ location: 'Ontario, CA', city: 'Ontario', state: 'California', stateCode: 'CA' }))).toBeNull();
    expect(nonUsWorkSite(row({ location: 'Hybrid (Ontario)', city: null, state: null, stateCode: null }))).toBeNull();
  });
});

describe('a region stored as the town is cleared in place (review round 3)', () => {
  it.each([
    ['Northern Virginia', 'Northern', 'Virginia', 'VA'],
    ['South Florida', 'South', 'Florida', 'FL'],
    ['Metro Detroit, MI', 'Metro Detroit', 'Michigan', 'MI'],
    ['Twin Cities, MN', 'Twin Cities', 'Minnesota', 'MN'],
  ])('%s stored as the town "%s": city cleared, state kept', (location, city, state, stateCode) => {
    expect(planLocationCorrection(row({ location, city, state, stateCode }))).toEqual({
      reasons: ['address_or_facility_city'],
      next: { city: null, state, stateCode },
    });
  });

  // Review round 4: a qualifier, a placeholder, a region suffix and a work
  // arrangement stored as the town.
  it.each([
    ['Within Texas', 'Within'],
    ['Unknown, TX', 'Unknown'],
    ['Houston Metro, TX', 'Houston Metro'],
    ['Field Based, TX', 'Field Based'],
  ])('%s stored as the town "%s": city cleared, Texas kept', (location, city) => {
    expect(planLocationCorrection(row({ location, city, state: 'Texas', stateCode: 'TX' }))).toEqual({
      reasons: ['address_or_facility_city'],
      next: { city: null, state: 'Texas', stateCode: 'TX' },
    });
  });

  it('leaves the town Central, LA alone', () => {
    expect(planLocationCorrection(row({ location: 'Central, LA', city: 'Central', state: 'Louisiana', stateCode: 'LA' }))).toBeNull();
  });

  // Review round 6: a street name, a bare site, district or custody word or a
  // facility code stored as the town.
  it.each([
    ['Main St, CO', 'Main St', 'Colorado', 'CO'],
    ['Oak Ave, TX', 'Oak Ave', 'Texas', 'TX'],
    ['Field - New Jersey', 'Field -', 'New Jersey', 'NJ'],
    ['Field - Georgia', 'Field -', 'Georgia', 'GA'],
    ['Corporate, TX', 'Corporate', 'Texas', 'TX'],
    ['Downtown, TX', 'Downtown', 'Texas', 'TX'],
    ['County Jail, TX', 'County Jail', 'Texas', 'TX'],
  ])('%s stored as the town "%s": city cleared, state kept', (location, city, state, stateCode) => {
    expect(planLocationCorrection(row({ location, city, state, stateCode }))).toEqual({
      reasons: ['address_or_facility_city'],
      next: { city: null, state, stateCode },
    });
  });

  it('files a coded site or a district of a known town under the town', () => {
    expect(planLocationCorrection(row({ location: 'MHC Nashville, TN', city: 'MHC Nashville', state: 'Tennessee', stateCode: 'TN' })))
      .toEqual({ reasons: ['address_or_facility_city'], next: { city: 'Nashville', state: 'Tennessee', stateCode: 'TN' } });
    expect(planLocationCorrection(row({ location: 'Downtown Atlanta, GA', city: 'Downtown Atlanta', state: 'Georgia', stateCode: 'GA' })))
      .toEqual({ reasons: ['address_or_facility_city'], next: { city: 'Atlanta', state: 'Georgia', stateCode: 'GA' } });
  });

  it('clears a facility code stored as the city of a row with no state', () => {
    const advent = row({ location: 'AH TAMPA PEPIN HEART INSTITUTE', city: 'AH TAMPA PEPIN HEART INSTITUTE', state: null, stateCode: null });
    expect(planLocationCorrection(advent)).toEqual({
      reasons: ['address_or_facility_city'],
      next: { city: null, state: null, stateCode: null },
    });
  });

  it('leaves real towns that share a word or a shape alone', () => {
    for (const [location, city, state, stateCode] of [
      ['Home, PA', 'Home', 'Pennsylvania', 'PA'],
      ['Federal Way, WA', 'Federal Way', 'Washington', 'WA'],
      ['Box Elder, SD', 'Box Elder', 'South Dakota', 'SD'],
      ['Southfield, MI', 'Southfield', 'Michigan', 'MI'],
    ]) {
      expect(planLocationCorrection(row({ location, city, state, stateCode })), location).toBeNull();
    }
  });
});

describe('stub rows', () => {
  it('flags the Televero stub', () => {
    expect(isStubRow(row({
      title: 'PMHNP, Remote TX Part Time, Up to 90 an Hour',
      description: 'PMHNP, Remote TX Part Time, Up to 90 an Hour\nEmployer: Televero Health\nDepartment: Clinical\nEmployment: Part-Time\nLocation: United States',
    }))).toBe(true);
    expect(isStubRow(row())).toBe(false);
  });
});

describe('duplicate groups (fixSoon 8)', () => {
  const a = row({ id: 'a', createdAt: new Date('2026-09-01T00:00:00Z') });
  const b = row({ id: 'b', createdAt: new Date('2026-09-02T00:00:00Z'), location: 'Austin, Texas, United States' });
  const c = row({ id: 'c', createdAt: new Date('2026-09-03T00:00:00Z') });

  it('keeps the oldest of an exact group and removes the rest', () => {
    const plan = planDuplicateGroups([c, b, a]);
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0].keep.id).toBe('a');
    expect(plan.groups[0].remove.map((r) => r.id)).toEqual(['b', 'c']);
  });

  it('keeps per-city requisitions separate (Thriveworks)', () => {
    const norfolk = row({ id: 'n', employer: 'Thriveworks', location: 'VA - Norfolk', description: `${BODY} Norfolk.` });
    const suffolk = row({ id: 's', employer: 'Thriveworks', location: 'VA - Suffolk', description: `${BODY} Norfolk.` });
    const plan = planDuplicateGroups([norfolk, suffolk]);
    expect(plan.groups).toHaveLength(0);
    expect(plan.review).toHaveLength(1);
  });

  it('lists a same-text pair at different sites for review only (BlueSky)', () => {
    const nc = row({ id: 'nc', employer: 'BlueSky Telepsych', location: 'North Carolina, United States' });
    const remote = row({ id: 'r', employer: 'BlueSky Telepsych', location: 'United States- Remote' });
    const plan = planDuplicateGroups([nc, remote]);
    expect(plan.groups).toHaveLength(0);
    expect(plan.review[0].map((r) => r.id)).toEqual(['nc', 'r']);
  });

  it('keeps two clinics of one employer in one city apart (Sol Mental Health, Washington, DC)', () => {
    const rhodeIsland = row({ id: 'ri', location: '1730 Rhode Island Ave NW, Washington, DC, 20036' });
    const wisconsin = row({ id: 'wi', location: '4200 Wisconsin Ave NW, Washington, DC, 20016' });
    const plan = planDuplicateGroups([rhodeIsland, wisconsin]);
    expect(plan.groups).toHaveLength(0);
    expect(plan.review[0].map((r) => r.id)).toEqual(['ri', 'wi']);
  });

  it('groups one address written two ways', () => {
    const one = row({ id: 'one', location: '4200 Wisconsin Avenue NW, Washington, DC 20016' });
    const two = row({ id: 'two', location: '4200 Wisconsin Ave. NW, Washington, DC, 20016', createdAt: new Date('2026-09-05T00:00:00Z') });
    expect(planDuplicateGroups([one, two]).groups).toHaveLength(1);
  });

  it('never groups rows with different text', () => {
    expect(planDuplicateGroups([a, row({ id: 'd', description: `${BODY} Different.` })]).groups).toHaveLength(0);
  });
});

describe('location backfill and remote reclassification (fixSoon 6)', () => {
  const noPlace = { city: null, state: null, stateCode: null, isRemote: false, isHybrid: true, mode: 'Hybrid' };

  it('reads "City, ST" from the title (DaVita)', () => {
    const plan = planLocationBackfill(row({ ...noPlace, title: 'Nurse Practitioner - Denver, CO (Hybrid)', location: '2 Locations' }));
    expect(plan).toMatchObject({ source: 'title', next: { city: 'Denver', stateCode: 'CO', location: 'Denver, CO' } });
  });

  it('reads a state name from a comma tail of the title (Ascend)', () => {
    const plan = planLocationBackfill(row({ ...noPlace, title: 'Psychiatric Advance Practice Provider, Iowa, Remote', location: 'Remote' }));
    expect(plan).toMatchObject({ source: 'title', next: { city: null, stateCode: 'IA' } });
  });

  it('reads a street address at the top of the description', () => {
    const plan = planLocationBackfill(row({ ...noPlace, title: 'Nurse Practitioner', location: '2 Locations', description: `2000 16th Street, Denver, Colorado, 80202\n${BODY}` }));
    expect(plan).toMatchObject({ source: 'description_address', next: { city: 'Denver', stateCode: 'CO' } });
  });

  it('reads a "work in City, State" phrase (Corewell St. Joseph, the live title names the town)', () => {
    const plan = planLocationBackfill(row({
      ...noPlace, title: 'NP/PA - Inpatient Psychiatry - St. Joseph', location: 'United States',
      description: `${BODY} This role is to work in St. Joseph, Michigan at Lakeland Hospital.`,
    }));
    expect(plan).toMatchObject({ source: 'description_phrase', next: { city: 'St. Joseph', stateCode: 'MI' } });
  });

  it('keeps only the state from a phrase town that no other source confirms', () => {
    const plan = planLocationBackfill(row({
      ...noPlace, title: 'NP/PA - Inpatient Psychiatry', location: 'United States',
      description: `${BODY} This role is to work in St. Joseph, Michigan at Lakeland Hospital.`,
    }));
    expect(plan).toMatchObject({ source: 'description_phrase', next: { city: null, stateCode: 'MI', location: 'Michigan' } });
  });

  it('prefers the Workday detail primary location when fetched', () => {
    const plan = planLocationBackfill(row({ ...noPlace, title: 'Nurse Practitioner', location: '2 Locations' }), 'Grand Rapids, MI');
    expect(plan).toMatchObject({ source: 'workday_detail', next: { city: 'Grand Rapids', stateCode: 'MI' } });
  });

  it('leaves unresolvable rows and fully remote rows alone', () => {
    expect(planLocationBackfill(row({ ...noPlace, title: 'Nurse Practitioner', location: '2 Locations' }))).toBeNull();
    expect(planLocationBackfill(row({ ...noPlace, isRemote: true, isHybrid: false, title: 'NP - Denver, CO' }))).toBeNull();
  });

  describe('a state-only row gets the one town its location string names (Thriveworks)', () => {
    const thriveworks = (location: string, overrides: Partial<JobRow> = {}): JobRow => row({
      employer: 'Thriveworks', title: 'Psychiatric Nurse Practitioner - Fee For Service', location,
      city: null, state: 'Virginia', stateCode: 'VA', ...overrides,
    });

    it('"VA - Chesterfield" and "VA - Norfolk" fill only the city', () => {
      expect(planStateOnlyTownBackfill(thriveworks('VA - Chesterfield'))).toEqual({
        evidence: 'VA - Chesterfield', next: { city: 'Chesterfield' },
      });
      expect(planStateOnlyTownBackfill(thriveworks('VA - Norfolk'))?.next).toEqual({ city: 'Norfolk' });
    });

    it('reads the state from the state name when the code is blank', () => {
      expect(planStateOnlyTownBackfill(thriveworks('VA - Norfolk', { stateCode: null }))?.next).toEqual({ city: 'Norfolk' });
    });

    it('the old backfill never planned these rows, because their state is set', () => {
      expect(planLocationBackfill(thriveworks('VA - Chesterfield'))).toBeNull();
    });

    it('skips a location that lists more than one place', () => {
      expect(planStateOnlyTownBackfill(thriveworks('Norfolk, VA; Richmond, VA'))).toBeNull();
      expect(planStateOnlyTownBackfill(thriveworks('Chesterfield or Richmond, VA'))).toBeNull();
      expect(planStateOnlyTownBackfill(thriveworks('Norfolk, VA / Raleigh, NC'))).toBeNull();
    });

    it('skips a town in another state, a non-town, a row with a city and a fully remote row', () => {
      expect(planStateOnlyTownBackfill(thriveworks('Raleigh, NC'))).toBeNull();
      expect(planStateOnlyTownBackfill(thriveworks('VA - Main Campus'))).toBeNull();
      expect(planStateOnlyTownBackfill(thriveworks('VA - Chesterfield', { city: 'Richmond' }))).toBeNull();
      expect(planStateOnlyTownBackfill(thriveworks('VA - Chesterfield', { isRemote: true, isHybrid: false }))).toBeNull();
      expect(planStateOnlyTownBackfill(thriveworks('Virginia'))).toBeNull();
      expect(planStateOnlyTownBackfill(thriveworks('VA - Chesterfield', { state: null, stateCode: null }))).toBeNull();
    });

    it('plans nothing once the town is stored (a re-run converges)', () => {
      expect(planStateOnlyTownBackfill(thriveworks('VA - Chesterfield', { city: 'Chesterfield' }))).toBeNull();
    });
  });

  it('reclassifies a remote-only row stored as hybrid when the text confirms it (Strive)', () => {
    const strive = row({
      ...noPlace, title: 'Nurse Practitioner - Eastern Time Zone', location: 'Remote',
      description: `${BODY} This is a fully remote position; you will see patients by video from home.`,
    });
    expect(planRemoteReclassify(strive)).toEqual({ next: { isRemote: true, isHybrid: false, mode: 'Remote' } });
  });

  it('does not reclassify when the text says hybrid or not fully remote', () => {
    expect(planRemoteReclassify(row({ ...noPlace, location: 'Remote', description: `${BODY} Hybrid schedule, 2 days in office.` }))).toBeNull();
    expect(planRemoteReclassify(row({ ...noPlace, location: 'Remote', description: `${BODY} This is NOT a 100% remote position.` }))).toBeNull();
    expect(planRemoteReclassify(row({ ...noPlace, location: 'Denver, CO', description: `${BODY} Fully remote.` }))).toBeNull();
  });

  it('spots a phantom "United States" state', () => {
    expect(isPhantomState(row({ state: 'United States', stateCode: null }))).toBe(true);
    expect(isPhantomState(row())).toBe(false);
  });
});

describe('on-site rows flagged remote (fixSoon 6, CS-03 skeptic fix item 3)', () => {
  const LAKELAND =
    `${BODY} Corewell Health South is seeking an additional APP for our inpatient psychiatric services to work in ` +
    'St. Joseph, Michigan at Lakeland Hospital. Every patient is seen every day.';

  it('sets the Corewell inpatient role (old fallback: Remote) to In-Person and backfills St. Joseph, MI', () => {
    const corewell = row({
      employer: 'Corewell Health', title: 'NP/PA - Inpatient Psychiatry - St. Joseph',
      location: 'United States', city: null, state: null, stateCode: null,
      isRemote: true, isHybrid: false, mode: 'Remote', description: LAKELAND,
    });
    const plan = planOnsiteReclassify(corewell)!;
    expect(plan.next).toEqual({ isRemote: false, isHybrid: false, mode: 'In-Person' });
    const backfill = planLocationBackfill({ ...corewell, ...plan.next });
    expect(backfill).toMatchObject({ next: { city: 'St. Joseph', stateCode: 'MI', location: 'St. Joseph, MI' } });
  });

  it('reads the live Corewell row (both flags on, mode Hybrid from a vaccine-policy line) as In-Person', () => {
    const corewell = row({
      employer: 'Corewell Health', title: 'NP/PA - Inpatient Psychiatry - St. Joseph',
      location: 'United States', city: null, state: null, stateCode: null,
      isRemote: true, isHybrid: true, mode: 'Hybrid',
      description: `${LAKELAND} Varicella, Tdap, and Influenza vaccine requirement if in an on-site or hybrid workplace category.`,
    });
    expect(planOnsiteReclassify(corewell)?.next).toEqual({ isRemote: false, isHybrid: false, mode: 'In-Person' });
  });

  it('keeps a stated hybrid schedule hybrid, with the flags following the mode', () => {
    const hybrid = row({
      location: 'United States', city: null, state: null, stateCode: null, isRemote: true, isHybrid: false, mode: 'Remote',
      description: `${BODY} Hybrid schedule with three days in clinic each week.`,
    });
    expect(planOnsiteReclassify(hybrid)?.next).toEqual({ isRemote: false, isHybrid: true, mode: 'Hybrid' });
  });

  it.each([
    ['a remote token in the location', { location: 'Remote' }],
    ['remote wording in the description', { description: `${BODY} This is a remote position.` }],
    ['work from home wording', { description: `${BODY} You will work from home three days a week.` }],
    ['telehealth wording', { description: `${BODY} Visits are by telehealth.` }],
    ['remote wording in the title', { title: 'PMHNP - Remote' }],
  ])('leaves a remote-flagged row alone when there is %s', (_label, overrides) => {
    const flagged = row({ location: 'United States', city: null, state: null, stateCode: null, isRemote: true, mode: 'Remote', ...overrides });
    expect(planOnsiteReclassify(flagged)).toBeNull();
  });

  it('never touches a row that is not flagged remote', () => {
    expect(planOnsiteReclassify(row())).toBeNull();
    expect(planOnsiteReclassify(row({ isHybrid: true, mode: 'Hybrid' }))).toBeNull();
  });

  // GFJ-01 review: a statement that denies remote work is not evidence for it.
  it('sets a VA row whose only remote wording is "Telework: Not Available" to In-Person', () => {
    const va = row({
      employer: 'Veterans Health Administration', title: 'Nurse Practitioner (Primary Care)',
      location: 'Tampa, FL', city: 'Tampa', state: 'Florida', stateCode: 'FL', isRemote: true, mode: 'Remote',
      description: `${BODY}\nTelework: Not Available\nVirtual: This is not a virtual position.\nRelocation/Moving Expenses Reimbursed: No`,
    });
    expect(planOnsiteReclassify(va)).toEqual({ statedMode: 'In-Person', next: { isRemote: false, isHybrid: false, mode: 'In-Person' } });
    const notRemote = row({
      location: 'Austin, TX', isRemote: true, mode: 'Remote', description: `${BODY} This is not a remote position.`,
    });
    expect(planOnsiteReclassify(notRemote)?.next).toEqual({ isRemote: false, isHybrid: false, mode: 'In-Person' });
  });

  it('leaves a row alone when telework is offered as well as denied elsewhere', () => {
    const va = row({
      location: 'Tampa, FL', isRemote: true, mode: 'Remote',
      description: `${BODY}\nTelework: Available\nVirtual: This is not a virtual position.`,
    });
    expect(planOnsiteReclassify(va)).toBeNull();
  });
});

describe('workdayDetailUrl', () => {
  it('maps an apply link to the CXS detail endpoint', () => {
    expect(workdayDetailUrl('https://davita.wd1.myworkdayjobs.com/en-US/DKC_External/job/Denver-CO/Nurse-Practitioner_R0123?source=x'))
      .toBe('https://davita.wd1.myworkdayjobs.com/wday/cxs/davita/DKC_External/job/Denver-CO/Nurse-Practitioner_R0123');
    expect(workdayDetailUrl('https://example.com/job/1')).toBeNull();
    expect(workdayDetailUrl(null)).toBeNull();
  });
});

describe('employment type re-derived with the fixed rules (H-03 f)', () => {
  const ADVOCATE_TEXT =
    `${BODY}\nStatus: Full time\nHours Per Week: 40\n` +
    'Benefits vary by role (e.g., full-time, part-time, per diem, temporary).';

  it('the Advocate "Status: Full time" row stored as Per Diem becomes Full-Time', () => {
    const advocate = row({
      employer: 'Advocate Health',
      title: 'Nurse Practitioner Behavioral Health',
      description: ADVOCATE_TEXT,
      jobType: 'Per Diem',
      sourceProvider: 'workday',
    });
    expect(planJobTypeRederive(advocate)).toEqual({
      reason: 'text_detector_fix',
      source: 'label',
      types: ['Full-Time'],
      next: { jobType: 'Full-Time' },
    });
  });

  it('a Highmark "Contractors ... Notice" row loses Contract when the text states no type', () => {
    const highmark = row({
      employer: 'Highmark Health',
      description: `${BODY}\nCalifornia Consumer Privacy Act: Employees, Contractors, and Applicants Notice.`,
      jobType: 'Contract',
      sourceProvider: 'workday',
    });
    expect(planJobTypeRederive(highmark)?.next).toEqual({ jobType: null });
  });

  it('the Thriveworks "Fee For Service (W2)" row stored as Contract becomes Full-Time (W-2)', () => {
    const thriveworks = row({
      employer: 'Thriveworks',
      title: 'Psychiatric Nurse Practitioner, Fee For Service (W2)',
      jobType: 'Contract',
      sourceProvider: 'greenhouse',
    });
    const plan = planJobTypeRederive(thriveworks);
    expect(plan?.next.jobType).toBe('Full-Time');
    expect(plan?.source).toBe('w2');
  });

  it('the Corewell "PRN coverage" row with "Employment Type Full time" becomes Full-Time', () => {
    const corewell = row({
      employer: 'Corewell Health',
      title: 'NP/PA - Inpatient Psychiatry - St. Joseph',
      description: `Employment Type Full time\n${BODY} Provide PRN coverage when the attending is away.`,
      jobType: 'Per Diem',
      sourceProvider: 'workday',
    });
    expect(planJobTypeRederive(corewell)?.next).toEqual({ jobType: 'Full-Time' });
  });

  it('fills a missing type', () => {
    const plan = planJobTypeRederive(row({ description: `${BODY} This is a part-time role.` }));
    expect(plan).toEqual({ reason: 'missing_type', source: 'text', types: ['Part-Time'], next: { jobType: 'Part-Time' } });
  });

  it('leaves a type the old detector did not produce (an ATS field, enrichment or a person)', () => {
    // The old detector would say Per Diem for this text; Full-Time came from elsewhere.
    expect(planJobTypeRederive(row({ description: `${BODY} PRN coverage.`, jobType: 'Full-Time', sourceProvider: 'workday' }))).toBeNull();
  });

  it('leaves providers that passed a structured type, and employer-posted rows', () => {
    const smart = row({ description: ADVOCATE_TEXT, jobType: 'Per Diem', sourceProvider: 'smartrecruiters' });
    expect(planJobTypeRederive(smart)).toBeNull();
    const employer = row({ description: ADVOCATE_TEXT, jobType: 'Per Diem', sourceType: 'employer', sourceProvider: null });
    expect(planJobTypeRederive(employer)).toBeNull();
  });

  it('plans nothing when the fixed answer is the stored one', () => {
    expect(planJobTypeRederive(row({ description: `${BODY} Full-time position.`, jobType: 'Full-Time', sourceProvider: 'workday' }))).toBeNull();
  });

  it('legacyDetectJobType reproduces the old substring order', () => {
    expect(legacyDetectJobType('union contract. full-time role')).toBe('Contract');
    expect(legacyDetectJobType('Status: Full time (e.g., full-time, part-time, per diem)')).toBe('Per Diem');
  });
});

describe('location backfill reads the shared ingest resolver (CS-03)', () => {
  it('a DaVita "2 Locations" row gets the title place, and the location text becomes "City, ST"', () => {
    const davita = row({
      employer: 'DaVita',
      title: 'Nurse Practitioner - Denver, CO (Hybrid)',
      location: '2 Locations',
      city: null,
      state: null,
      stateCode: null,
      isHybrid: true,
      mode: 'Hybrid',
    });
    expect(planLocationBackfill(davita)).toEqual({
      source: 'title',
      evidence: 'Denver, CO',
      next: { city: 'Denver', state: 'Colorado', stateCode: 'CO', location: 'Denver, CO' },
    });
  });

  // The live DaVita rows (2026-09-29): the dash touches the role, and the
  // address that opens the description is often another clinic.
  const davitaRow = (id: string, title: string, location: string, address: string) =>
    row({
      id,
      employer: 'DaVita',
      title,
      location,
      description: `Posting Date\n\n09/23/2026\n\n${address}\n\n${BODY}`,
      city: null,
      state: null,
      stateCode: null,
      isHybrid: true,
      mode: 'Hybrid',
      sourceProvider: 'workday',
    });

  it('Terre Haute, IN from "Nurse Practitioner- Terre Haute, IN - Hybrid Remote", not "Nurse Practitioner- Terre Haute"', () => {
    const terreHaute = davitaRow(
      '4909a5e1',
      'Nurse Practitioner- Terre Haute, IN - Hybrid Remote',
      '05474 - Terre Haute Dialysis',
      '504 6th Ave, Terre Haute, Indiana, 47807, United States of America',
    );
    expect(planLocationBackfill(terreHaute)).toEqual({
      source: 'title',
      evidence: 'Terre Haute, IN',
      next: { city: 'Terre Haute', state: 'Indiana', stateCode: 'IN', location: 'Terre Haute, IN' },
    });
  });

  it('Newark, NJ from "Nurse Practitioner- Newark, NJ- Hybrid Remote"', () => {
    const newark = davitaRow(
      '774cde52',
      'Nurse Practitioner- Newark, NJ- Hybrid Remote',
      '2 Locations',
      '14-20 Prospect St, East Orange, New Jersey, 07017-2238, United States of America',
    );
    expect(planLocationBackfill(newark)?.next).toEqual({ city: 'Newark', state: 'New Jersey', stateCode: 'NJ', location: 'Newark, NJ' });
  });

  it('Freehold, NJ, never the Freeport, NY address or Workday location', () => {
    const freehold = davitaRow(
      '3251e62d',
      'Nurse Practitioner- Freehold, NJ- Hybrid Remote',
      '2 Locations',
      '267 W Merrick Rd, Freeport, New York, 11520-3346, United States of America',
    );
    expect(planLocationBackfill(freehold)?.next).toMatchObject({ city: 'Freehold', stateCode: 'NJ', location: 'Freehold, NJ' });
    expect(planLocationBackfill(freehold, 'Freeport, NY')?.next).toMatchObject({ city: 'Freehold', stateCode: 'NJ' });
  });

  // Second CS-03 review: a specialty, setting, schedule or second state in
  // front of the state was stored as the town ("Urgent Care", "Georgia").
  const vague = (title: string) =>
    row({ title, location: 'United States', city: null, state: null, stateCode: null, isHybrid: false, mode: 'In-Person' });

  it.each([
    ['Nurse Practitioner - Urgent Care, FL', 'FL', 'Florida', 'FL'],
    ['Nurse Practitioner, Primary Care, TX', 'TX', 'Texas', 'TX'],
    ['NP, Dermatology, AZ', 'AZ', 'Arizona', 'AZ'],
    ['Nurse Practitioner, Pediatrics, GA', 'GA', 'Georgia', 'GA'],
    ['Family Nurse Practitioner, Hospice, NC', 'NC', 'North Carolina', 'NC'],
    ['Nurse Practitioner, Outpatient, WI', 'WI', 'Wisconsin', 'WI'],
    ['Nurse Practitioner, Per Diem, TX', 'TX', 'Texas', 'TX'],
    ['Nurse Practitioner, Full Time, CA', 'CA', 'California', 'CA'],
    ['NP - Nights, AZ', 'AZ', 'Arizona', 'AZ'],
    ['Nurse Practitioner, Days, NY', 'NY', 'New York', 'NY'],
    ['Nurse Practitioner - Georgia, Alabama', 'GA', 'Georgia', 'Georgia'],
    ['Travel Nurse Practitioner, Ohio, Indiana', 'OH', 'Ohio', 'Ohio'],
    ['Nurse Practitioner - Kansas, Missouri', 'KS', 'Kansas', 'Kansas'],
    ['Nurse Practitioner - Float Pool, TX', 'TX', 'Texas', 'TX'],
    ['Nurse Practitioner - Greater Houston, TX', 'TX', 'Texas', 'TX'],
  ])('"%s" is backfilled with the state only, never a town', (title, stateCode, state, evidence) => {
    expect(planLocationBackfill(vague(title))).toEqual({
      source: 'title',
      evidence,
      next: { city: null, state, stateCode, location: state },
    });
  });

  it('a real town named like a state is still backfilled as the town (Indiana, PA)', () => {
    expect(planLocationBackfill(vague('Nurse Practitioner - Indiana, PA'))?.next).toEqual({
      city: 'Indiana',
      state: 'Pennsylvania',
      stateCode: 'PA',
      location: 'Indiana, PA',
    });
  });

  it('Springboro, OH from "Springboro/Miamisburg, OH", never the Westerville address', () => {
    const springboro = davitaRow(
      'b545cb53',
      'Nurse Practitioner, Springboro/Miamisburg, OH - Hybrid Remote',
      '2 Locations',
      '241 W Schrock Rd, Westerville, Ohio, 43081-2874, United States of America',
    );
    expect(planLocationBackfill(springboro)).toMatchObject({
      source: 'title',
      next: { city: 'Springboro', stateCode: 'OH', location: 'Springboro, OH' },
    });
  });
});

describe('a stored "Remote" location is placed only by the title (review fix)', () => {
  // A text-only In-Person reading cleared the remote flag, so the row needs
  // a backfill; its description names the employer's office, not a site.
  const remoteText = row({
    title: 'Psychiatric Nurse Practitioner',
    location: 'Remote',
    description: `${BODY} We are based in New York, NY. Requires 1+ year of experience in an outpatient setting.`,
    city: null,
    state: null,
    stateCode: null,
    isRemote: false,
    isHybrid: false,
    mode: 'In-Person',
  });

  it('plans nothing from a description office for a row whose location says "Remote"', () => {
    expect(planLocationBackfill(remoteText)).toBeNull();
  });

  it('ignores a fetched Workday location for such a row too', () => {
    expect(planLocationBackfill(remoteText, 'Grand Rapids, MI')).toBeNull();
  });

  it('a place the title names still fills it (the Ascend shape)', () => {
    expect(planLocationBackfill({ ...remoteText, title: 'Psychiatric Nurse Practitioner - Nashville, TN' }))
      .toMatchObject({ source: 'title', next: { city: 'Nashville', stateCode: 'TN' } });
  });

  it('a vague location that does not say remote still reads the description', () => {
    expect(planLocationBackfill({ ...remoteText, location: '2 Locations', description: `Location: Denver, CO\n${BODY}` }))
      .toMatchObject({ source: 'description_label', next: { stateCode: 'CO' } });
  });
});

describe('employer-posted rows are never unpublished by these scripts (review fix)', () => {
  it('knows which rows an employer posted', () => {
    expect(isEmployerPosted(row({ sourceType: 'employer' }))).toBe(true);
    expect(isEmployerPosted(row({ sourceType: 'direct' }))).toBe(true);
    expect(isEmployerPosted(row({ sourceType: 'external' }))).toBe(false);
    expect(isEmployerPosted(row({ sourceType: null }))).toBe(false);
  });

  describe('duplicate groups', () => {
    // The probe: the employer's own post is newer than an aggregated copy of
    // the same posting, and its text is the same wrapped in <p>.
    const employer = row({
      id: 'employer-post',
      sourceType: 'employer',
      sourceProvider: null,
      location: 'Denver, CO',
      city: 'Denver',
      state: 'Colorado',
      stateCode: 'CO',
      description: `<p>${BODY}</p>`,
      createdAt: new Date('2026-09-20T00:00:00Z'),
    });
    const aggregated = row({
      id: 'aggregated-copy',
      location: 'Denver, Colorado, United States',
      city: 'Denver',
      state: 'Colorado',
      stateCode: 'CO',
      createdAt: new Date('2026-09-10T00:00:00Z'),
    });

    it('keeps an employer row newer than an aggregated copy, and removes only the copy', () => {
      const plan = planDuplicateGroups([aggregated, employer]);
      expect(plan.groups).toHaveLength(1);
      expect(plan.groups[0].keep.id).toBe('employer-post');
      expect(plan.groups[0].remove.map((r) => r.id)).toEqual(['aggregated-copy']);
    });

    it('with several aggregated copies, still keeps the one employer row and removes every copy', () => {
      const older = { ...aggregated, id: 'older-copy', createdAt: new Date('2026-09-05T00:00:00Z') };
      const plan = planDuplicateGroups([employer, aggregated, older]);
      expect(plan.groups).toHaveLength(1);
      expect(plan.groups[0].keep.id).toBe('employer-post');
      expect(plan.groups[0].remove.map((r) => r.id)).toEqual(['older-copy', 'aggregated-copy']);
    });

    it('sends a group with two employer rows to review, and removes nothing', () => {
      const repost = { ...employer, id: 'employer-repost', sourceType: 'direct', createdAt: new Date('2026-09-25T00:00:00Z') };
      const plan = planDuplicateGroups([employer, repost, aggregated]);
      expect(plan.groups).toHaveLength(0);
      expect(plan.review).toHaveLength(1);
      expect(plan.review[0].map((r) => r.id)).toEqual(['aggregated-copy', 'employer-post', 'employer-repost']);
    });

    it('an employer row never appears in any remove list', () => {
      const repost = { ...employer, id: 'employer-repost', createdAt: new Date('2026-09-25T00:00:00Z') };
      for (const rows of [[aggregated, employer], [employer, repost], [employer, repost, aggregated]]) {
        const removed = planDuplicateGroups(rows).groups.flatMap((g) => g.remove);
        expect(removed.filter(isEmployerPosted)).toEqual([]);
      }
    });

    it('two aggregated copies still keep the oldest, as before', () => {
      const newer = { ...aggregated, id: 'newer-copy', createdAt: new Date('2026-09-15T00:00:00Z') };
      const plan = planDuplicateGroups([newer, aggregated]);
      expect(plan.groups[0].keep.id).toBe('aggregated-copy');
      expect(plan.groups[0].remove.map((r) => r.id)).toEqual(['newer-copy']);
    });
  });

  describe('the stub, non-US and FB-3 runners read only aggregated rows', () => {
    const script = (name: string) => readFileSync(resolve(__dirname, `../../scripts/indexing-fixes/${name}.ts`), 'utf8');

    it.each(['hold-stub-description-jobs', 'unpublish-non-us-jobs', 'unpublish-misrepresented-jobs'])('%s', (name) => {
      const src = script(name);
      // The rows it may write: published and aggregated only.
      expect(src).toContain("where: { isPublished: true, sourceType: 'external', ...rowFilter(opts) },");
      // Employer or direct rows are read only to be listed.
      expect(src).toContain('where: { isPublished: true, sourceType: { in: [...EMPLOYER_POSTED_SOURCE_TYPES] }, ...rowFilter(opts) },');
      expect(src).toContain('REVIEW (employer-posted, not changed)');
      // No other job query, and every write comes from the aggregated rows.
      expect(src.match(/prisma\.job\.findMany\(/g) ?? []).toHaveLength(2);
      expect(src).not.toMatch(/where: \{ isPublished: true, \.\.\.rowFilter\(opts\) \}/);
      expect(src.match(/writes\.push\(/g) ?? []).toHaveLength(1);
      expect(src).toMatch(/for \(const row of rows\) \{[\s\S]*?writes\.push\(/);
      expect(src.indexOf('writes.push(')).toBeLessThan(src.indexOf('employerRows.flatMap('));
    });

    it('an employer Quill post under 80 characters reads as a stub, which is why the query excludes it', () => {
      const quill = row({
        sourceType: 'employer',
        title: 'PMHNP',
        description: '<p>PMHNP needed for our Dallas outpatient clinic. Full time, apply today.</p>',
      });
      expect(isStubRow(quill)).toBe(true);
      expect(isEmployerPosted(quill)).toBe(true);
    });
  });
});

describe('FB-3 re-publish needs a corrected row that passes every gate (review fix)', () => {
  const heldDc = row({
    location: '1730 Rhode Island Ave NW, Washington, DC, 20036',
    city: '1730',
    state: 'Rhode Island',
    stateCode: 'RI',
    ...SOL_PAY,
    isPublished: false,
    isManuallyUnpublished: true,
  });
  const locNext = planLocationCorrection(heldDc)!.next;
  const payNext = planPayCorrection(heldDc)!.next;

  it('a row held for pay stays held on an --only=location run', () => {
    expect(shouldRepublishHeld(heldDc, { ...locNext }, ['location'])).toBe(false);
    expect(republishBlocker(heldDc, { ...locNext }, ['location'])).toBe('run without --only');
  });

  it('a row held for a wrong state stays held on an --only=pay run', () => {
    expect(shouldRepublishHeld(heldDc, { ...payNext }, ['pay'])).toBe(false);
  });

  it('names the FB-3 reason left when a correction is missing', () => {
    expect(republishBlocker(heldDc, { ...locNext }, null)).toBe('pay_not_stated_by_employer');
    expect(republishBlocker(heldDc, { ...payNext }, null)).toContain('wrong_state');
  });

  it('a stub held row stays held', () => {
    const stub = row({
      title: 'PMHNP, Remote TX Part Time, Up to 90 an Hour',
      description: 'PMHNP, Remote TX Part Time, Up to 90 an Hour\nEmployer: Televero Health\nDepartment: Clinical\nEmployment: Part-Time\nLocation: United States',
      isPublished: false,
      isManuallyUnpublished: true,
    });
    expect(planFb3(stub)).toBeNull();
    expect(shouldRepublishHeld(stub, {}, null)).toBe(false);
    expect(republishBlocker(stub, {}, null)).toBe('stub description');
  });

  it('a non-US row stays held', () => {
    const toronto = row({
      location: 'Toronto, Ontario, Canada', city: 'Toronto', state: null, stateCode: null, country: 'CA',
      isPublished: false, isManuallyUnpublished: true,
    });
    expect(shouldRepublishHeld(toronto, {}, null)).toBe(false);
    expect(republishBlocker(toronto, {}, null)).toMatch(/^work site CA/);
  });

  it('a fully corrected row is re-published, on a full run or with both corrections named', () => {
    const next = { ...locNext, ...payNext };
    expect(planFb3({ ...heldDc, ...next } as JobRow)).toBeNull();
    expect(shouldRepublishHeld(heldDc, next, null)).toBe(true);
    expect(shouldRepublishHeld(heldDc, next, ['location', 'pay'])).toBe(true);
    expect(republishBlocker(heldDc, next, null)).toBeNull();
  });

  it('the runner re-publishes only through the gate', () => {
    const src = readFileSync(resolve(__dirname, '../../scripts/indexing-fixes/correct-location-and-pay.ts'), 'utf8');
    expect(src).toContain('const blocker = held ? republishBlocker(row, next, opts.only) : null;');
    expect(src).toContain('const republish = held && !expired && blocker === null;');
    expect(src).toContain('notes.push(`stays held: ${blocker}`)');
    expect(src).not.toContain('const republish = held && !foreign && !expired;');
  });
});
