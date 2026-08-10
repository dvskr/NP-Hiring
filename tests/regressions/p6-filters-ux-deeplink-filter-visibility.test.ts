/**
 * P6 #3 — deep-linked filters must be visible and clearable.
 *
 * cityExact / stateCode / employer arrive only via URL params (city/metro/
 * company CTAs — no facet sets them) yet actively narrow /jobs results.
 * Before this fix they got no pill, no active-filter count, and — when they
 * were the sole filters — no "Clear all" button: an invisibly narrowed list.
 * LinkedInFilters and JobsPageClient also kept two DIVERGENT inline counts
 * (the sidebar omitted the three deep-link params; the page omitted
 * specialty/category/recruitmentType and more).
 *
 * Invariants pinned:
 *   1. ONE shared counting rule — countActiveFilters in lib/filters.ts —
 *      imported by BOTH surfaces; no inline field-sum remains in either.
 *   2. The counter counts every URL-contract field, including the three
 *      deep-link-only params, so "Clear all" appears when they are the sole
 *      filters.
 *   3. Each of the three params renders a pill showing its value with an
 *      individual remove.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { countActiveFilters, type RecruitmentFilterState } from '@/lib/filters';
import { DEFAULT_FILTERS } from '@/types/filters';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const withFilters = (overrides: Partial<RecruitmentFilterState>): RecruitmentFilterState => ({
  ...DEFAULT_FILTERS,
  ...overrides,
});

describe('countActiveFilters — the single counting rule', () => {
  it('counts zero for the default state', () => {
    expect(countActiveFilters(DEFAULT_FILTERS)).toBe(0);
  });

  it('counts each deep-link-only param as active (the sole-filter Clear-all case)', () => {
    expect(countActiveFilters(withFilters({ cityExact: 'Sacramento' }))).toBe(1);
    expect(countActiveFilters(withFilters({ stateCode: 'CA' }))).toBe(1);
    expect(countActiveFilters(withFilters({ employer: 'Lifestance Health' }))).toBe(1);
    expect(
      countActiveFilters(withFilters({ cityExact: 'Sacramento', stateCode: 'CA', employer: 'Lifestance Health' })),
    ).toBe(3);
  });

  it('counts every other URL-contract field the two surfaces used to disagree on', () => {
    expect(countActiveFilters(withFilters({ specialty: ['psychiatric-mental-health'] }))).toBe(1);
    expect(countActiveFilters(withFilters({ category: 'new-grad' }))).toBe(1);
    expect(countActiveFilters(withFilters({ recruitmentType: 'direct_hire' }))).toBe(1);
    expect(countActiveFilters(withFilters({ newGradFriendly: true }))).toBe(1);
    expect(countActiveFilters(withFilters({ minYearsExperience: 2 }))).toBe(1);
    expect(countActiveFilters(withFilters({ search: 'telehealth' }))).toBe(1);
    expect(countActiveFilters(withFilters({ location: 'California' }))).toBe(1);
    expect(countActiveFilters(withFilters({ salaryMin: 100000 }))).toBe(1);
    expect(countActiveFilters(withFilters({ postedWithin: '7d' }))).toBe(1);
    expect(countActiveFilters(withFilters({ workMode: ['remote'], jobType: ['Full-Time'] }))).toBe(2);
  });

  it('mirrors buildWhereClause gates: minYears 0 counts, null/false do not', () => {
    expect(countActiveFilters(withFilters({ minYearsExperience: 0 }))).toBe(1);
    expect(countActiveFilters(withFilters({ minYearsExperience: null }))).toBe(0);
    expect(countActiveFilters(withFilters({ newGradFriendly: null }))).toBe(0);
  });
});

describe('LinkedInFilters uses the shared counter and renders the three pills', () => {
  const src = read('components/jobs/LinkedInFilters.tsx');

  it('imports and calls countActiveFilters — no inline sum remains', () => {
    expect(src).toContain('countActiveFilters');
    expect(src).toMatch(/const activeFilterCount = countActiveFilters\(filters\)/);
    // The old divergent arithmetic must not come back under any name.
    expect(src).not.toMatch(/activeFilterCount\s*=\s*\n?\s*filters\.workMode\.length \+/);
  });

  it('renders a pill for each deep-link param, showing the value', () => {
    expect(src).toMatch(/key: 'cityExact'/);
    expect(src).toMatch(/label: `City: \$\{filters\.cityExact\}`/);
    expect(src).toMatch(/key: 'stateCode'/);
    expect(src).toMatch(/label: `State: \$\{filters\.stateCode\.toUpperCase\(\)\}`/);
    expect(src).toMatch(/key: 'employer'/);
    expect(src).toMatch(/label: `Employer: \$\{filters\.employer\}`/);
  });

  it('each pill has an individual remove that nulls exactly its own param', () => {
    expect(src).toMatch(/setSingleFilter\('cityExact', null\)/);
    expect(src).toMatch(/setSingleFilter\('stateCode', null\)/);
    expect(src).toMatch(/setSingleFilter\('employer', null\)/);
  });

  it('"Clear all" still gates on activeFilterCount > 0 — so it now appears for sole deep-link filters', () => {
    // Behavioral half proven above (countActiveFilters counts each param as
    // 1); this pins the render gate so the button is driven by that count.
    expect(src).toMatch(/\{activeFilterCount > 0 && \(/);
    expect(src).toContain('Clear all ({activeFilterCount})');
  });
});

describe('JobsPageClient uses the same shared counter', () => {
  const src = read('app/jobs/JobsPageClient.tsx');

  it('imports and calls countActiveFilters — no inline sum remains', () => {
    expect(src).toContain('countActiveFilters');
    expect(src).toMatch(/const activeFilterCount = countActiveFilters\(currentFilters\)/);
    expect(src).not.toMatch(/activeFilterCount\s*=\s*\n?\s*currentFilters\.workMode\.length \+/);
  });
});
