/**
 * Adapter location defaults and the country passthrough (indexing audit
 * GFJ-01, CS-03, and the owner decision of 2026-09-29: US jobs only, and a
 * posting that includes the United States among its locations is a US job).
 *
 * Each adapter's mapping is a small exported helper, so the default a
 * location-less posting gets and the country list the normalizer's non-US
 * gate reads are pinned here without the network.
 */
import { describe, it, expect } from 'vitest';
import { greenhouseLocation } from '@/lib/aggregators/greenhouse';
import { leverCountry, leverLocation } from '@/lib/aggregators/lever';
import { smartRecruitersCountry, smartRecruitersLocation } from '@/lib/aggregators/smartrecruiters';
import { workableCountries, workableLocation } from '@/lib/aggregators/workable';
import { ashbyCountries, ashbyLocation } from '@/lib/aggregators/ashby';
import { usaJobsCountries, usaJobsLocation } from '@/lib/aggregators/usajobs';
import { hccCountries, hccLocation } from '@/lib/aggregators/healthcareercenter';
import { fantasticCountries, fantasticLocation } from '@/lib/aggregators/fantastic-jobs-db';
import { parseWorkdayDetail, resolveWorkdayLocation, workdayCountries } from '@/lib/aggregators/workday';
import { normalizeJobWithReason } from '@/lib/job-normalizer';

const BODY =
  'Provide psychiatric evaluation and medication management for adults in an outpatient clinic. Collaborate ' +
  'with therapists, document visits in the EHR and take part in weekly case reviews. This is a full-time ' +
  'position with paid time off and continuing education support.';

/** Ingest one raw adapter row through the normalizer. */
function ingest(source: string, over: Record<string, unknown>) {
  return normalizeJobWithReason(
    {
      title: 'Psychiatric Nurse Practitioner',
      company: 'Example Health',
      location: 'Denver, CO',
      description: BODY,
      applyLink: 'https://example.org/jobs/1',
      externalId: `${source}-example-1`,
      ...over,
    },
    source,
  );
}

describe('Greenhouse: a posting with no location is not remote', () => {
  it('defaults to "United States", never "Remote"', () => {
    expect(greenhouseLocation({})).toBe('United States');
    expect(greenhouseLocation({ location: null, offices: [] })).toBe('United States');
    expect(greenhouseLocation({ location: { name: '   ' }, offices: [{ name: '' }] })).toBe('United States');
  });

  it('uses the location name, else the first office', () => {
    expect(greenhouseLocation({ location: { name: 'Chicago, IL' } })).toBe('Chicago, IL');
    expect(greenhouseLocation({ location: null, offices: [{ name: 'Austin, TX' }, { name: 'Remote' }] })).toBe('Austin, TX');
  });

  it('the default publishes no TELECOMMUTE flag: an on-site job with no location is not stored remote', () => {
    const job = ingest('greenhouse', { location: greenhouseLocation({}), description: `${BODY} Patients are seen on site.` }).job;
    expect(job).toMatchObject({ isRemote: false, location: 'United States' });
  });
});

describe('Lever: "Remote" only when workplaceType says remote', () => {
  it('a location-less posting is "Remote" for workplaceType remote', () => {
    expect(leverLocation({ categories: {}, workplaceType: 'remote' })).toBe('Remote');
    expect(leverLocation({ categories: {}, workplaceType: ' Remote ' })).toBe('Remote');
  });

  it.each(['on-site', 'hybrid', 'unspecified', undefined])('and "United States" for workplaceType %s', (workplaceType) => {
    expect(leverLocation({ categories: {}, workplaceType })).toBe('United States');
  });

  it('lists every location, the primary first, without repeats', () => {
    expect(leverLocation({ categories: { location: 'Denver, CO', allLocations: ['Denver, CO', 'Aurora, CO'] } }))
      .toBe('Denver, CO; Aurora, CO');
    expect(leverLocation({ categories: { location: 'Denver, CO' }, workplaceType: 'remote' })).toBe('Denver, CO');
  });

  it('passes the country code only for a single-location posting', () => {
    expect(leverCountry({ country: 'CA', categories: { location: 'Toronto, ON' } })).toBe('CA');
    expect(leverCountry({ country: 'CA', categories: { allLocations: ['Toronto, ON', 'Seattle, WA'] } })).toBeUndefined();
    expect(leverCountry({ country: null, categories: {} })).toBeUndefined();
  });

  it('a Lever posting in Toronto and Seattle is a US job filed under Seattle', () => {
    const posting = { categories: { location: 'Toronto, ON', allLocations: ['Toronto, ON', 'Seattle, WA'] }, country: 'CA' };
    const result = ingest('lever', { location: leverLocation(posting), country: leverCountry(posting) });
    expect(result.rejectionReason).toBeUndefined();
    expect(result.job).toMatchObject({ city: 'Seattle', stateCode: 'WA', country: 'US' });
  });
});

describe('SmartRecruiters: the country passthrough', () => {
  it('passes location.country through as written', () => {
    expect(smartRecruitersCountry({ location: { city: 'Toronto', region: 'ON', country: 'ca' } })).toBe('ca');
    expect(smartRecruitersCountry({ location: { country: ' us ' } })).toBe('us');
    expect(smartRecruitersCountry({ location: {} })).toBeUndefined();
  });

  it('builds "City, Region", else "Remote" on the remote flag, else "United States"', () => {
    expect(smartRecruitersLocation({ location: { city: 'Austin', region: 'TX' } })).toBe('Austin, TX');
    expect(smartRecruitersLocation({ location: { remote: true } })).toBe('Remote');
    expect(smartRecruitersLocation({ location: {} })).toBe('United States');
  });

  it('a posting whose country is "ca" is rejected as non-US at ingest', () => {
    const posting = { location: { city: 'Toronto', region: 'ON', country: 'ca' } };
    const result = ingest('smartrecruiters', { location: smartRecruitersLocation(posting), country: smartRecruitersCountry(posting) });
    expect(result).toMatchObject({ job: null, rejectionReason: 'normalizer_non_us_location' });
  });

  it('a Canadian posting whose location defaulted to "United States" is still rejected on its country', () => {
    const posting = { location: { country: 'ca' } };
    const result = ingest('smartrecruiters', { location: smartRecruitersLocation(posting), country: smartRecruitersCountry(posting) });
    expect(result.rejectionReason).toBe('normalizer_non_us_location');
  });

  it('a "us" posting is kept', () => {
    const posting = { location: { city: 'Austin', region: 'TX', country: 'us' } };
    const result = ingest('smartrecruiters', { location: smartRecruitersLocation(posting), country: smartRecruitersCountry(posting) });
    expect(result.job).toMatchObject({ city: 'Austin', stateCode: 'TX' });
  });
});

describe('USAJOBS: every location country is passed', () => {
  const overseas = { PositionLocation: [{ CityName: 'Landstuhl', CountryCode: 'Germany' }] };
  const both = {
    PositionLocation: [
      { CityName: 'Landstuhl', CountryCode: 'Germany' },
      { CityName: 'Tampa, Florida', CountrySubDivisionCode: 'Florida', CountryCode: 'United States' },
    ],
  };

  it('lists each distinct CountryCode', () => {
    expect(usaJobsCountries(overseas)).toEqual(['Germany']);
    expect(usaJobsCountries(both)).toEqual(['Germany', 'United States']);
    expect(usaJobsCountries({ PositionLocation: [] })).toBeUndefined();
  });

  it('files a posting under its first US place', () => {
    expect(usaJobsLocation(both)).toBe('Tampa, Florida');
  });

  it('CountryCode "Germany" is rejected; "United States" is kept', () => {
    expect(ingest('usajobs', { employer: 'Department of the Army', location: 'Landstuhl', country: usaJobsCountries(overseas) }))
      .toMatchObject({ job: null, rejectionReason: 'normalizer_non_us_location' });
    const us = { PositionLocation: [{ CityName: 'Tampa, Florida', CountrySubDivisionCode: 'Florida', CountryCode: 'United States' }] };
    expect(ingest('usajobs', { employer: 'Department of Veterans Affairs', location: usaJobsLocation(us), country: usaJobsCountries(us) }).job)
      .toMatchObject({ city: 'Tampa', stateCode: 'FL' });
  });

  it('a posting open at an overseas base and a US medical center is kept', () => {
    const result = ingest('usajobs', { employer: 'Department of the Army', location: usaJobsLocation(both), country: usaJobsCountries(both) });
    expect(result.rejectionReason).toBeUndefined();
    expect(result.job).toMatchObject({ stateCode: 'FL' });
  });
});

describe('Fantastic Jobs DB: countries_derived', () => {
  const base = { remote_derived: false, cities_derived: [], regions_derived: [], locations_derived: [], countries_derived: [] };

  it('passes the whole list, or nothing when empty', () => {
    expect(fantasticCountries({ countries_derived: ['United States', 'Canada'] })).toEqual(['United States', 'Canada']);
    expect(fantasticCountries({ countries_derived: [] })).toBeUndefined();
  });

  it('a posting in the United States and Canada is filed under its US place', () => {
    expect(fantasticLocation({
      ...base,
      cities_derived: ['Toronto', 'Seattle'],
      regions_derived: ['Ontario', 'Washington'],
      locations_derived: ['Toronto, Ontario, Canada', 'Seattle, Washington, United States'],
      countries_derived: ['Canada', 'United States'],
    })).toBe('Seattle, Washington, United States');
  });

  it('["United States", "Canada"] is kept; ["Canada"] is rejected', () => {
    expect(ingest('fantastic-jobs-db', { location: 'Seattle, Washington, United States', countries: ['United States', 'Canada'] }).job)
      .toMatchObject({ city: 'Seattle', stateCode: 'WA', country: 'US' });
    expect(ingest('fantastic-jobs-db', { location: 'Toronto, Ontario, Canada', countries: ['Canada'] }))
      .toMatchObject({ job: null, rejectionReason: 'normalizer_non_us_location' });
  });
});

describe('Workable, Ashby and HealthCareerCenter: the country list and the US place', () => {
  it('Workable lists every country and prefers the first US place', () => {
    const job = {
      location: { city: 'Toronto', region: 'Ontario', countryCode: 'CA' },
      locations: [{ city: 'Austin', region: 'Texas', countryCode: 'US' }],
    };
    expect(workableCountries(job)).toEqual(['CA', 'US']);
    expect(workableLocation(job)).toBe('Austin, Texas');
    expect(workableCountries({})).toBeUndefined();
    expect(workableLocation({})).toBe('United States');
  });

  it('Ashby lists every address country and prefers a US secondary address', () => {
    const job = {
      address: { postalAddress: { addressLocality: 'Toronto', addressRegion: 'Ontario', addressCountry: 'Canada' } },
      secondaryLocations: [{ address: { postalAddress: { addressLocality: 'Boston', addressRegion: 'MA', addressCountry: 'United States' } } }],
    };
    expect(ashbyCountries(job)).toEqual(['Canada', 'United States']);
    expect(ashbyLocation(job)).toBe('Boston, MA');
    expect(ashbyCountries({})).toBeUndefined();
  });

  it('HealthCareerCenter reads one Place or a list, and a Country object', () => {
    const post = {
      jobLocation: [
        { address: { addressLocality: 'Toronto', addressRegion: 'ON', addressCountry: { '@type': 'Country', name: 'CA' } } },
        { address: { addressLocality: 'Buffalo', addressRegion: 'NY', addressCountry: 'US' } },
      ],
    };
    expect(hccCountries(post)).toEqual(['CA', 'US']);
    expect(hccLocation(post)).toBe('Buffalo, NY');
    expect(hccCountries({ jobLocation: { address: { addressCountry: 'Canada' } } })).toEqual(['Canada']);
    expect(hccCountries({ jobLocation: null })).toBeUndefined();
  });

  it('each mixed list keeps the posting at ingest', () => {
    expect(ingest('workable', { location: 'Austin, Texas', country: ['CA', 'US'] }).job).toMatchObject({ stateCode: 'TX' });
    expect(ingest('ashby', { location: 'Boston, MA', country: ['Canada', 'United States'] }).job).toMatchObject({ stateCode: 'MA' });
    expect(ingest('healthcareercenter', { location: 'Buffalo, NY', country: ['CA', 'US'] }).job).toMatchObject({ stateCode: 'NY' });
  });
});

describe('Workday: the requisition country and its further sites', () => {
  it('passes the detail country alone for a single-site requisition', () => {
    expect(workdayCountries({ country: 'US', additionalLocations: [] })).toEqual(['US']);
    expect(workdayCountries({ country: 'CA', additionalLocations: [] })).toEqual(['CA']);
    expect(workdayCountries({ additionalLocations: ['Denver, CO'] })).toBeUndefined();
  });

  it('adds the United States when a further site is a US place', () => {
    expect(workdayCountries({ country: 'CA', additionalLocations: ['Detroit, MI'] })).toEqual(['CA', 'US']);
    expect(workdayCountries({ country: 'US', additionalLocations: ['Detroit, MI'] })).toEqual(['US']);
    expect(workdayCountries({ country: 'CA', additionalLocations: ['Vancouver, BC'] })).toEqual(['CA']);
  });

  it('a Toronto requisition with a Detroit site is kept and filed under Detroit, MI', () => {
    const details = parseWorkdayDetail({
      jobPostingInfo: {
        location: 'Toronto, ON',
        additionalLocations: ['Detroit, MI'],
        jobRequisitionLocation: { country: { alpha2Code: 'CA' } },
      },
    });
    const result = ingest('workday', {
      location: resolveWorkdayLocation('2 Locations', details),
      country: workdayCountries(details),
    });
    expect(result.rejectionReason).toBeUndefined();
    expect(result.job).toMatchObject({ city: 'Detroit', stateCode: 'MI', country: 'US' });
  });

  it('a Toronto-only requisition is rejected on its country', () => {
    const details = parseWorkdayDetail({
      jobPostingInfo: { location: 'Toronto, ON', jobRequisitionLocation: { country: { alpha2Code: 'CA' } } },
    });
    expect(ingest('workday', { location: resolveWorkdayLocation('Toronto, ON', details), country: workdayCountries(details) }))
      .toMatchObject({ job: null, rejectionReason: 'normalizer_non_us_location' });
  });
});
