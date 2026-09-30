/**
 * Indexing audit 2026-09, job page package: the JobPosting markup measured
 * against Google's JobPosting documentation
 * (https://developers.google.com/search/docs/appearance/structured-data/job-posting).
 *
 * The invariant the audit asked for (CS-03, GFJ-02, H-03): every JobPosting
 * the builder emits carries a physical jobLocation, or TELECOMMUTE plus
 * applicantLocationRequirements; a job with neither gets no JobPosting.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Job } from '@/lib/types';
import JobStructuredData, { buildJobPostingSchema, isEstimatedSalary } from '@/components/JobStructuredData';

type SchemaJob = Job & { professionClass?: string | null };

/**
 * A complete sentence of duties: GFJ-04 omits the JobPosting for a stub
 * description (under 80 characters of prose, or title plus metadata lines),
 * so every fixture carries real prose after its own wording.
 */
const DUTIES =
  'You will evaluate new patients, manage medications and work closely with therapists and primary care teams.';

function makeJob(overrides: Partial<SchemaJob> = {}): SchemaJob {
  return {
    id: '11111111-2222-3333-4444-555555555555',
    title: 'Psychiatric Nurse Practitioner',
    employer: 'Acme Health',
    slug: 'psychiatric-nurse-practitioner-11111111-2222-3333-4444-555555555555',
    location: 'Austin, TX',
    description: `Provide outpatient psychiatric care to adults in our Austin clinic. ${DUTIES}`,
    descriptionSummary: null,
    mode: 'In-Person',
    city: 'Austin',
    state: 'Texas',
    stateCode: 'TX',
    country: 'US',
    isRemote: false,
    isHybrid: false,
    jobType: 'Full-Time',
    salaryPeriod: null,
    minSalary: null,
    maxSalary: null,
    normalizedMinSalary: null,
    normalizedMaxSalary: null,
    originalPostedAt: new Date('2026-09-01T00:00:00Z'),
    createdAt: new Date('2026-09-02T10:00:00Z'),
    expiresAt: new Date('2026-10-31T00:00:00Z'),
    applyOnPlatform: false,
    newGradFriendly: false,
    minYearsExperience: null,
    externalId: null,
    companyWebsite: null,
    companyLogoUrl: null,
    ...overrides,
  } as unknown as SchemaJob;
}

const verifiedRemote: Partial<SchemaJob> = {
  location: 'Remote',
  mode: 'Remote',
  isRemote: true,
  isHybrid: false,
  city: null,
  state: null,
  stateCode: null,
  description: `This is a fully remote telepsychiatry position serving adult patients. ${DUTIES}`,
};

function schemaFor(job: SchemaJob): Record<string, unknown> {
  const schema = buildJobPostingSchema(job);
  if (!schema) throw new Error('expected a JobPosting');
  return schema;
}

/** The invariant: a location field of one kind or the other, never neither. */
function hasRequiredLocation(schema: Record<string, unknown>): boolean {
  if (schema.jobLocation) return true;
  return schema.jobLocationType === 'TELECOMMUTE' && schema.applicantLocationRequirements !== undefined;
}

describe('every emitted JobPosting carries jobLocation or TELECOMMUTE plus applicantLocationRequirements', () => {
  const fixtures: Array<[string, Partial<SchemaJob>]> = [
    ['on-site with city and state', {}],
    ['state only', { city: null }],
    ['city only', { state: null, stateCode: null, location: 'Charleston', city: 'Charleston' }],
    ['hybrid with a place', { mode: 'Hybrid', isHybrid: true }],
    ['verified remote', verifiedRemote],
    ['remote flag with a place but an on-site description', { isRemote: true, mode: 'Remote', description: `This role is on-site. ${DUTIES}` }],
    ['both flags true', { isRemote: true, isHybrid: true }],
    ['"2 Locations" with no columns', { location: '2 Locations', city: null, state: null, stateCode: null, mode: 'Hybrid', isHybrid: true }],
    ['"United States" flagged remote', { ...verifiedRemote, location: 'United States' }],
    ['facility name only', { location: 'MAIN CAMPUS', city: 'MAIN CAMPUS', state: null, stateCode: null }],
    ['non-US', { country: 'Iraq', city: 'Baghdad', state: null, stateCode: null, location: 'Baghdad, Iraq' }],
    ['multi-location', { location: 'Denver, CO; Aurora, CO', city: 'Denver', state: 'Colorado', stateCode: 'CO' }],
  ];

  it.each(fixtures)('%s', (_label, overrides) => {
    const schema = buildJobPostingSchema(makeJob(overrides));
    if (schema) expect(hasRequiredLocation(schema)).toBe(true);
  });

  it('omits the JobPosting when there is neither a place nor a verified remote declaration (GFJ-02)', () => {
    expect(buildJobPostingSchema(makeJob({ location: '2 Locations', city: null, state: null, stateCode: null, mode: 'Hybrid', isHybrid: true }))).toBeNull();
    expect(buildJobPostingSchema(makeJob({ ...verifiedRemote, location: 'United States' }))).toBeNull();
    expect(renderToStaticMarkup(React.createElement(JobStructuredData, {
      job: makeJob({ location: '2 Locations', city: null, state: null, stateCode: null }),
    }))).toBe('');
  });

  it('omits the JobPosting for a non-US listing (owner decision: non-US jobs are excluded)', () => {
    expect(buildJobPostingSchema(makeJob({ country: 'Iraq' }))).toBeNull();
  });
});

describe('GFJ-01: TELECOMMUTE only for a verified fully remote job', () => {
  it('the Compass case: an in-person Chicago job flagged isRemote emits its physical place', () => {
    const schema = schemaFor(makeJob({
      title: 'Psychiatric Nurse Practitioner - Evenings',
      location: 'Chicago, Illinois, United States',
      city: 'Chicago', state: 'Illinois', stateCode: 'IL',
      isRemote: true, mode: 'In-Person',
      description: `This is an onsite, full-time position. ${DUTIES}`,
    }));
    expect(schema.jobLocationType).toBeUndefined();
    expect(schema.applicantLocationRequirements).toBeUndefined();
    expect(schema.jobLocation).toMatchObject({
      '@type': 'Place',
      address: { addressLocality: 'Chicago', addressRegion: 'IL', addressCountry: 'US' },
    });
  });

  it('a verified remote job is TELECOMMUTE with Country USA and no jobLocation', () => {
    const schema = schemaFor(makeJob(verifiedRemote));
    expect(schema.jobLocationType).toBe('TELECOMMUTE');
    expect(schema.jobLocation).toBeUndefined();
    expect(schema.applicantLocationRequirements).toEqual({ '@type': 'Country', name: 'USA' });
  });
});

describe('GFJ-07: state-restricted remote jobs name the state', () => {
  it('"PMHNP, Remote TX" restricts applicants to Texas', () => {
    const schema = schemaFor(makeJob({ ...verifiedRemote, title: 'PMHNP, Remote TX Part Time, Up to 90 an Hour' }));
    expect(schema.applicantLocationRequirements).toEqual([{ '@type': 'State', name: 'Texas, USA' }]);
  });

  it('a location string naming states lists each one', () => {
    const schema = schemaFor(makeJob({ ...verifiedRemote, location: 'Remote - CA; Remote - NV' }));
    expect(schema.applicantLocationRequirements).toEqual([
      { '@type': 'State', name: 'California, USA' },
      { '@type': 'State', name: 'Nevada, USA' },
    ]);
  });

  /*
   * Review blocker (round 5): "Remote (excluding CA)" restricted applicants
   * to California, the one state the posting excludes, and an unverified
   * row emitted jobLocation addressRegion CA.
   */
  it('a state the posting excludes is never the applicant state or the jobLocation', () => {
    for (const location of ['Remote (excluding CA)', 'Remote - TX excluded', 'US Remote - All states except New York']) {
      const schema = schemaFor(makeJob({ ...verifiedRemote, location }));
      expect(schema.applicantLocationRequirements, location).toEqual({ '@type': 'Country', name: 'USA' });
    }
    const titled = schemaFor(makeJob({ ...verifiedRemote, title: 'PMHNP - All states except California, Remote' }));
    expect(titled.applicantLocationRequirements).toEqual({ '@type': 'Country', name: 'USA' });
    expect(buildJobPostingSchema(makeJob({
      location: 'Remote (excluding CA)', city: null, state: 'California', stateCode: null, mode: 'Hybrid', isHybrid: true,
    }))).toBeNull();
  });
});

describe('CS-03: multi-location jobs emit a jobLocation array', () => {
  it('one Place per location', () => {
    const schema = schemaFor(makeJob({ location: 'Denver, CO; Aurora, CO', city: 'Denver', state: 'Colorado', stateCode: 'CO' }));
    expect(Array.isArray(schema.jobLocation)).toBe(true);
    expect((schema.jobLocation as Array<{ address: { addressLocality: string } }>).map((p) => p.address.addressLocality))
      .toEqual(['Denver', 'Aurora']);
  });

  it('a facility name is never addressLocality', () => {
    // The town comes from the location string ("Austin, TX"), never the
    // facility name in the city column (M-04 round 3: a state-only row takes
    // the town its one listed place names).
    const schema = schemaFor(makeJob({ city: 'MAIN CAMPUS' }));
    expect(schema.jobLocation).toEqual({
      '@type': 'Place',
      address: { '@type': 'PostalAddress', addressLocality: 'Austin', addressRegion: 'TX', addressCountry: 'US' },
    });
    const noTown = schemaFor(makeJob({ city: 'MAIN CAMPUS', location: 'MAIN CAMPUS' }));
    expect(noTown.jobLocation).toEqual({ '@type': 'Place', address: { '@type': 'PostalAddress', addressRegion: 'TX', addressCountry: 'US' } });
  });

  it('a state-only row takes the town its location string names (Thriveworks "VA - Chesterfield")', () => {
    const schema = schemaFor(makeJob({
      title: 'Psychiatric Nurse Practitioner - Fee For Service',
      employer: 'Thriveworks',
      location: 'VA - Chesterfield',
      city: null,
      state: 'Virginia',
      stateCode: null,
      mode: 'Hybrid',
      isHybrid: true,
    }));
    expect(schema.jobLocation).toEqual({
      '@type': 'Place',
      address: { '@type': 'PostalAddress', addressLocality: 'Chesterfield', addressRegion: 'VA', addressCountry: 'US' },
    });
  });
});

describe('GFJ-06: employmentType', () => {
  it('is omitted when the type is unknown, never defaulted to FULL_TIME', () => {
    expect('employmentType' in schemaFor(makeJob({ jobType: null }))).toBe(false);
  });

  it('maps Locum Tenens to CONTRACTOR and TEMPORARY, and PRN to PER_DIEM', () => {
    expect(schemaFor(makeJob({ jobType: 'Locum Tenens' })).employmentType).toEqual(['CONTRACTOR', 'TEMPORARY']);
    expect(schemaFor(makeJob({ jobType: 'PRN' })).employmentType).toBe('PER_DIEM');
    expect(schemaFor(makeJob({ jobType: 'Full-Time' })).employmentType).toBe('FULL_TIME');
  });
});

describe('H-03: employmentType names every type the posting offers', () => {
  it('is an array when the posting offers two schedules and one is stored', () => {
    const both = makeJob({
      jobType: 'Full-Time',
      description: `Full-time or part-time schedules are available for this role. ${DUTIES}`,
    });
    expect(schemaFor(both).employmentType).toEqual(['FULL_TIME', 'PART_TIME']);
    const titled = makeJob({ title: 'Psychiatric Nurse Practitioner (FT/PRN)', jobType: 'Full-Time' });
    expect(schemaFor(titled).employmentType).toEqual(['FULL_TIME', 'PER_DIEM']);
  });

  it('a PRN medication order never adds PER_DIEM to a full-time job', () => {
    const job = makeJob({
      jobType: 'Full-Time',
      description: `You will review PRN medication orders and manage PRN and scheduled medications. This is a full-time position. ${DUTIES}`,
    });
    expect(schemaFor(job).employmentType).toBe('FULL_TIME');
  });

  it.each<[string]>([
    ['Write PRN IM medication orders for agitation.'],
    ['Administer medications on a PRN basis.'],
    ['Monitor PRN/as needed medications.'],
    ['Authorize PRN restraints and seclusion when needed.'],
    ['Assess response to PRN interventions.'],
  ])('"%s" on a full-time job emits FULL_TIME alone (H-03 round 3)', (duty) => {
    const job = makeJob({ jobType: 'Full-Time', description: `${duty} This is a full-time role. ${DUTIES}` });
    expect(schemaFor(job).employmentType).toBe('FULL_TIME');
  });

  it('a stored Contract on a posting that states W-2 employment is not emitted as CONTRACTOR', () => {
    const w2FeeForService = makeJob({
      title: 'Psychiatric Nurse Practitioner, Fee For Service (W2)',
      jobType: 'Contract',
      description: `Provide telepsychiatry visits to adult clients. Build your own schedule. ${DUTIES}`,
    });
    expect(schemaFor(w2FeeForService).employmentType).toBe('FULL_TIME');
    const w2Contract = makeJob({
      jobType: 'Contract',
      description: `This is a W-2 contract position for 13 weeks. ${DUTIES}`,
    });
    expect('employmentType' in schemaFor(w2Contract)).toBe(false);
  });

  it('a stored Contract with no W-2 statement is kept (the employer or its ATS said so)', () => {
    expect(schemaFor(makeJob({ jobType: 'Contract' })).employmentType).toBe('CONTRACTOR');
  });
});

describe('GFJ-08: hiringOrganization carries logo and sameAs when known', () => {
  it('emits both when the page resolved them', () => {
    const org = schemaFor(makeJob({ companyWebsite: 'www.acmehealth.com', companyLogoUrl: 'https://cdn.example.com/acme.png' }))
      .hiringOrganization as Record<string, unknown>;
    expect(org).toEqual({
      '@type': 'Organization',
      name: 'Acme Health',
      sameAs: 'https://www.acmehealth.com/',
      logo: 'https://cdn.example.com/acme.png',
    });
  });

  it('drops a value that is not an absolute http(s) URL', () => {
    const org = schemaFor(makeJob({ companyWebsite: 'javascript:alert(1)', companyLogoUrl: '/relative.png' }))
      .hiringOrganization as Record<string, unknown>;
    expect(org).toEqual({ '@type': 'Organization', name: 'Acme Health' });
  });
});

describe('GFJ-12: no experienceInPlaceOfEducation', () => {
  it('a new-grad-friendly posting with no minimum states 0 months and nothing else', () => {
    const schema = schemaFor(makeJob({ newGradFriendly: true }));
    expect('experienceInPlaceOfEducation' in schema).toBe(false);
    expect(schema.experienceRequirements).toEqual({ '@type': 'OccupationalExperienceRequirements', monthsOfExperience: 0 });
  });

  it('a stated minimum wins', () => {
    const schema = schemaFor(makeJob({ newGradFriendly: true, minYearsExperience: 1 }));
    expect(schema.experienceRequirements).toEqual({ '@type': 'OccupationalExperienceRequirements', monthsOfExperience: 12 });
    expect('experienceInPlaceOfEducation' in schema).toBe(false);
  });

  it('a new-graduate program title states 0 months, as its "New grad welcome" chip does', () => {
    // effectiveExperienceLabel shows "New grad welcome" for this title
    // whatever minimum the row holds; the markup must not claim 5 years.
    const residency = makeJob({ title: 'Nurse Practitioner Residency Program', minYearsExperience: 5, experienceLabel: '5+ yrs' } as Partial<SchemaJob>);
    expect(schemaFor(residency).experienceRequirements).toEqual({ '@type': 'OccupationalExperienceRequirements', monthsOfExperience: 0 });
  });

  it('nothing known, nothing claimed', () => {
    expect('experienceRequirements' in schemaFor(makeJob())).toBe(false);
  });
});

describe('GFJ-13: identifier is the employer requisition id', () => {
  it('uses the ATS id under the employer name', () => {
    expect(schemaFor(makeJob({ externalId: 'greenhouse-acmehealth-5408840008' })).identifier).toEqual({
      '@type': 'PropertyValue', name: 'Acme Health', value: '5408840008',
    });
  });

  it('is omitted when there is no employer id (never the site UUID)', () => {
    expect('identifier' in schemaFor(makeJob({ externalId: null }))).toBe(false);
    expect('identifier' in schemaFor(makeJob({ externalId: 'adzuna_1234567' }))).toBe(false);
  });
});

describe('GFJ-15 and GFJ-16: title and datePosted', () => {
  it('title is the clean role title', () => {
    expect(schemaFor(makeJob({ title: 'Family Nurse Practitioner - Sign-On Bonus Available' })).title).toBe('Family Nurse Practitioner');
  });

  it('datePosted is the employer original date, the same field the page shows', () => {
    expect(schemaFor(makeJob()).datePosted).toBe('2026-09-01T00:00:00.000Z');
    expect(schemaFor(makeJob({ originalPostedAt: null })).datePosted).toBe('2026-09-02T10:00:00.000Z');
  });
});

describe('GFJ-03: directApply is false (owner decision 2026-09: applying requires an account)', () => {
  // Google: "If the user has to click apply, complete an application form,
  // sign in or log in more than once in the application journey, it means
  // that you aren't offering a direct apply experience." An external job
  // applies on the employer's ATS; an Easy Apply visitor from Google signs
  // up (and confirms) before the form.
  it('is false for an external ATS job', () => {
    expect(schemaFor(makeJob({ applyOnPlatform: false, applyLink: 'https://job-boards.greenhouse.io/acme/jobs/1' } as Partial<SchemaJob>)).directApply).toBe(false);
  });

  it('is false for an on-platform Easy Apply job too, behind the account step', () => {
    expect(schemaFor(makeJob({ applyOnPlatform: true })).directApply).toBe(false);
  });

  it('is never true, whatever the job', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'components/JobStructuredData.tsx'), 'utf8');
    expect(src).toContain('directApply: false,');
    expect(src).not.toMatch(/directApply:\s*(?:true|job\.|!)/);
  });
});

describe('the rendered script stays escape-safe', () => {
  it('escapes < and > from aggregator content', () => {
    const html = renderToStaticMarkup(React.createElement(JobStructuredData, {
      job: makeJob({ description: `Bad </script><script>alert(1)</script> text. ${DUTIES}` }),
    }));
    expect(html).toContain('application/ld+json');
    expect(html).not.toContain('</script><script>');
  });
});

describe('GFJ-04: a stub description emits no JobPosting', () => {
  it('the Televero title-plus-metadata stub gets no markup', () => {
    const televero = makeJob({
      ...verifiedRemote,
      title: 'PMHNP, Remote TX Part Time, Up to 90 an Hour',
      description:
        'PMHNP, Remote TX Part Time, Up to 90 an Hour\nEmployer: Televero Health\nDepartment: Clinical\nEmployment: Part-Time\nLocation: United States',
    });
    expect(buildJobPostingSchema(televero)).toBeNull();
    expect(renderToStaticMarkup(React.createElement(JobStructuredData, { job: televero }))).toBe('');
  });

  it('a description with almost no prose gets no markup', () => {
    expect(buildJobPostingSchema(makeJob({ description: 'Nurse practitioner needed.' }))).toBeNull();
  });
});

describe('CQ-02: baseSalary only for pay the employer stated', () => {
  const paid: Partial<SchemaJob> = {
    minSalary: 140000,
    maxSalary: 180000,
    salaryPeriod: 'annual',
    normalizedMinSalary: 140000,
    normalizedMaxSalary: 180000,
  };

  it('emits baseSalary for a trusted figure', () => {
    const schema = schemaFor(makeJob({ ...paid, salaryIsEstimated: false, salaryConfidence: 1 }));
    expect(schema.baseSalary).toMatchObject({ currency: 'USD', value: { minValue: 140000, maxValue: 180000, unitText: 'YEAR' } });
  });

  it('omits baseSalary when the ingest conflict check flagged the row', () => {
    expect(schemaFor(makeJob({ ...paid, salaryIsEstimated: true, salaryConfidence: 0.4 })).baseSalary).toBeUndefined();
  });

  it('omits baseSalary for a source range marked estimated, whatever its confidence', () => {
    expect(schemaFor(makeJob({ ...paid, salaryIsEstimated: true, salaryConfidence: 0.6 })).baseSalary).toBeUndefined();
  });

  it('omits baseSalary at or below the conflict confidence floor', () => {
    expect(schemaFor(makeJob({ ...paid, salaryIsEstimated: false, salaryConfidence: 0.3 })).baseSalary).toBeUndefined();
  });

  it('keeps an employer-stated wide range or hourly rate (confidence below 0.8 but above the floor)', () => {
    expect(schemaFor(makeJob({ ...paid, salaryIsEstimated: false, salaryConfidence: 0.7 })).baseSalary).toBeDefined();
    const hourly = makeJob({ minSalary: 85, maxSalary: 90, salaryPeriod: 'hourly', normalizedMinSalary: 176800, normalizedMaxSalary: 187200, salaryIsEstimated: false, salaryConfidence: 0.9 });
    expect(schemaFor(hourly).baseSalary).toMatchObject({ value: { minValue: 85, maxValue: 90, unitText: 'HOUR' } });
  });

  it('isEstimatedSalary reads both signals', () => {
    expect(isEstimatedSalary({ salaryIsEstimated: true, salaryConfidence: 1 })).toBe(true);
    expect(isEstimatedSalary({ salaryIsEstimated: false, salaryConfidence: 0.4 })).toBe(true);
    expect(isEstimatedSalary({ salaryIsEstimated: false, salaryConfidence: 0.5 })).toBe(false);
    expect(isEstimatedSalary({ salaryIsEstimated: null, salaryConfidence: null })).toBe(false);
  });
});
