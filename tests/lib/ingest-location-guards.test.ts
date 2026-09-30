/**
 * No junk city at ingest (indexing audit CQ-02, the GAPS review blocker).
 * The review ran each description below through normalizeJobWithReason (a
 * Greenhouse row whose location is "United States") and buildJobPostingSchema:
 *   - "Locations: Denver, CO" stored the city "s: Denver";
 *   - "Location: Remote - must reside in Texas" stored "must reside in", TX;
 *   - "Location: Remote, must be licensed in the state of Florida" stored
 *     "must be licensed in the state of", FL;
 *   - "1 year of experience, must hold an active Florida license" stored
 *     "must hold an active", FL (read as an address line);
 *   - "2 years in Urgent Care, California or Nevada license preferred" filed
 *     the job under California.
 * The same values would have reached live rows through the repair script
 * (planLocationBackfill) and JobPosting addressLocality. Now "Locations:
 * Denver, CO" gives Denver, CO, and the other four give no place at all.
 */
import { describe, it, expect } from 'vitest';
import { resolveLocationFallback } from '@/lib/location-fallback';
import { normalizeJobWithReason } from '@/lib/job-normalizer';
import { mergeLlmIntoNormalized } from '@/lib/ingestion-service';
import { planLocationBackfill, type JobRow } from '../../scripts/indexing-fixes/lib/planners';
import type { LLMExtractResult } from '@/lib/llm-enrichment';

const BODY =
  'Provide psychiatric evaluation and medication management for adults. Collaborate with therapists and a ' +
  'supervising psychiatrist, document visits in the EHR and take part in weekly case reviews. This is a ' +
  'full-time position with paid time off and continuing education support.';

const NO_PLACE_LINES = [
  'Location: Remote - must reside in Texas',
  'Location: Remote, must be licensed in the state of Florida',
  '1 year of experience, must hold an active Florida license',
  '2 years in Urgent Care, California or Nevada license preferred',
];

function ingest(firstLine: string) {
  return normalizeJobWithReason(
    {
      title: 'Nurse Practitioner',
      company: 'Example Health',
      location: 'United States',
      description: `${firstLine}\n${BODY}`,
      applyLink: 'https://boards.greenhouse.io/example/jobs/1',
      externalId: 'greenhouse-example-1',
    },
    'greenhouse',
  );
}

function row(description: string): JobRow {
  return {
    id: 'job-1',
    slug: 'nurse-practitioner-job-1',
    title: 'Nurse Practitioner',
    employer: 'Example Health',
    location: 'United States',
    description,
    city: null,
    state: null,
    stateCode: null,
    country: 'US',
    isRemote: false,
    isHybrid: false,
    mode: null,
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
    applyLink: 'https://boards.greenhouse.io/example/jobs/1',
    createdAt: new Date('2026-09-20T00:00:00Z'),
    expiresAt: null,
  };
}

describe('"Locations: Denver, CO" gives Denver, never "s: Denver"', () => {
  it('through resolveLocationFallback', () => {
    expect(resolveLocationFallback({ title: 'Nurse Practitioner', description: `Locations: Denver, CO\n${BODY}` }))
      .toMatchObject({ source: 'description_label', city: 'Denver', stateCode: 'CO', label: 'Denver, CO' });
  });

  it('through normalizeJobWithReason', () => {
    expect(ingest('Locations: Denver, CO').job).toMatchObject({ city: 'Denver', stateCode: 'CO', location: 'Denver, CO' });
  });

  it('through the repair planner', () => {
    expect(planLocationBackfill(row(`Locations: Denver, CO\n${BODY}`))?.next)
      .toMatchObject({ city: 'Denver', stateCode: 'CO', location: 'Denver, CO' });
  });

  it('a labelled known town keeps its city, re-cased and in the dataset spelling', () => {
    expect(resolveLocationFallback({ title: 'Nurse Practitioner', description: `Location: College Station, TX\n${BODY}` }))
      .toMatchObject({ city: 'College Station', stateCode: 'TX' });
    expect(resolveLocationFallback({ title: 'Nurse Practitioner', description: `Location: san antonio, tx\n${BODY}` }))
      .toMatchObject({ city: 'San Antonio', stateCode: 'TX' });
    expect(resolveLocationFallback({ title: 'Nurse Practitioner', description: `Location: Saint Louis, MO\n${BODY}` }))
      .toMatchObject({ city: 'St. Louis', stateCode: 'MO', label: 'St. Louis, MO' });
  });

  it('a label with no separator is not a label', () => {
    expect(resolveLocationFallback({ title: 'Nurse Practitioner', description: `Locations Denver CO area\n${BODY}` })).toBeNull();
  });
});

describe.each(NO_PLACE_LINES)('"%s" names no work site', (line) => {
  it('resolveLocationFallback finds no place', () => {
    expect(resolveLocationFallback({ title: 'Nurse Practitioner', description: `${line}\n${BODY}` })).toBeNull();
  });

  it('ingest keeps the job with no city and no state', () => {
    const result = ingest(line);
    expect(result.rejectionReason).toBeUndefined();
    expect(result.job).toMatchObject({ city: null, stateCode: null, location: 'United States' });
  });

  it('the repair planner plans nothing', () => {
    expect(planLocationBackfill(row(`${line}\n${BODY}`))).toBeNull();
  });
});

describe('a top address line must be shaped like an address', () => {
  it('a house number and a street word, or a state and ZIP, still count', () => {
    expect(resolveLocationFallback({ title: 'NP', description: `2000 16th Street, Denver, Colorado, 80202\n${BODY}` }))
      .toMatchObject({ source: 'description_address', city: 'Denver', stateCode: 'CO' });
    expect(resolveLocationFallback({ title: 'NP', description: `5100 Buckeyestown Pike Suite 200 Frederick, MD 21704\n${BODY}` }))
      .toMatchObject({ source: 'description_address', city: 'Frederick', stateCode: 'MD' });
  });

  it('a numbered sentence with a comma does not', () => {
    expect(resolveLocationFallback({ title: 'NP', description: `3 years of psychiatric experience, Texas license required\n${BODY}` })).toBeNull();
  });
});

describe('the model\'s city goes through the same guard (inline LLM rescue)', () => {
  const llm = (city: string, state: string): LLMExtractResult => ({ city, state });

  it('drops a fragment and keeps the state', () => {
    const merged = mergeLlmIntoNormalized({ title: 'NP', city: null, state: null, stateCode: null }, llm('must reside in', 'Texas'));
    expect(merged).toMatchObject({ city: null, state: 'Texas', stateCode: 'TX' });
  });

  it('keeps a real town', () => {
    const merged = mergeLlmIntoNormalized({ title: 'NP', city: null, state: null, stateCode: null }, llm('Austin', 'Texas'));
    expect(merged).toMatchObject({ city: 'Austin', stateCode: 'TX' });
  });
});
