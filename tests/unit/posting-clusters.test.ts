/**
 * lib/pseo/posting-clusters.ts (indexing audit fixSoon 8, CQ-10): the index
 * gates count distinct postings and role clusters, never raw rows.
 */
import { describe, it, expect } from 'vitest';
import { normalizeTitle } from '@/lib/deduplicator';
import {
  countPostings,
  distinctPostingTotal,
  normalizeRoleTitle,
  type PostingRow,
} from '@/lib/pseo/posting-clusters';

const row = (over: Partial<PostingRow> = {}): PostingRow => ({
  employer: 'LifeStance Health',
  title: 'Psychiatric Nurse Practitioner',
  city: 'Salt Lake City',
  state: 'Utah',
  stateCode: 'UT',
  ...over,
});

describe('normalizeRoleTitle', () => {
  it('is the ingestion deduplicator rule, so ingest and the gates agree on "the same title"', () => {
    for (const title of ['Psychiatric Nurse Practitioner (PMHNP)', 'NP - Remote, Full Time', 'The Nurse Practitioner for Kids']) {
      expect(normalizeRoleTitle(title)).toBe(normalizeTitle(title));
    }
  });

  it('folds case and punctuation', () => {
    expect(normalizeRoleTitle('Psychiatric Nurse Practitioner - PMHNP')).toBe(normalizeRoleTitle('psychiatric nurse practitioner (pmhnp)'));
  });

  it('is empty for a missing title', () => {
    expect(normalizeRoleTitle(null)).toBe('');
    expect(normalizeRoleTitle(undefined)).toBe('');
  });
});

describe('countPostings', () => {
  it('collapses exact duplicates (same employer, title, city and state) to one posting', () => {
    const counts = countPostings([row(), row(), row({ title: 'PSYCHIATRIC NURSE PRACTITIONER' })]);
    expect(counts).toEqual({ rows: 3, postings: 1, employers: 1, roleClusters: 1, topEmployerPostings: 1 });
  });

  it('keeps per-city requisitions as separate postings but one role cluster', () => {
    const counts = countPostings([
      row({ city: 'Salt Lake City' }),
      row({ city: 'Riverton' }),
      row({ city: 'Pleasant Grove' }),
    ]);
    expect(counts.postings).toBe(3);
    expect(counts.roleClusters).toBe(1);
    expect(counts.employers).toBe(1);
    expect(counts.topEmployerPostings).toBe(3);
  });

  it('merges employer aliases the way the employer rosters do', () => {
    const counts = countPostings([
      row({ employer: 'LifeStance' }),
      row({ employer: 'LifeStance Health', city: 'Riverton' }),
    ]);
    expect(counts.employers).toBe(1);
    expect(counts.roleClusters).toBe(1);
  });

  it('counts distinct role clusters across employers and titles', () => {
    const counts = countPostings([
      row(),
      row({ title: 'Family Nurse Practitioner' }),
      row({ employer: 'Geode Health' }),
      row({ employer: 'Geode Health', city: 'Provo' }),
    ]);
    expect(counts.postings).toBe(4);
    expect(counts.employers).toBe(2);
    expect(counts.roleClusters).toBe(3);
    expect(counts.topEmployerPostings).toBe(2);
  });

  it('never merges rows whose title was not selected', () => {
    const counts = countPostings([
      { employer: 'LifeStance Health', city: 'Provo', state: 'Utah', stateCode: 'UT' },
      { employer: 'LifeStance Health', city: 'Provo', state: 'Utah', stateCode: 'UT' },
    ]);
    expect(counts.postings).toBe(2);
    expect(counts.roleClusters).toBe(2);
  });

  it('a row with no employer name is a posting but not an employer', () => {
    const counts = countPostings([row({ employer: null }), row({ employer: '  ' })]);
    expect(counts.postings).toBe(2);
    expect(counts.employers).toBe(0);
    expect(counts.topEmployerPostings).toBe(0);
  });

  it('is empty for no rows', () => {
    expect(countPostings([])).toEqual({ rows: 0, postings: 0, employers: 0, roleClusters: 0, topEmployerPostings: 0 });
  });
});

describe('distinctPostingTotal', () => {
  it('subtracts the duplicates a sample found from the full total', () => {
    expect(distinctPostingTotal(42, { rows: 42, postings: 38 })).toBe(38);
    expect(distinctPostingTotal(5000, { rows: 2000, postings: 1990 })).toBe(4990);
  });

  it('never goes below zero', () => {
    expect(distinctPostingTotal(1, { rows: 5, postings: 1 })).toBe(0);
  });
});
