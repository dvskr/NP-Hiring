/**
 * Static regression guards for the funnel + pSEO HIGH audit fixes (2026-07-11
 * enterprise gap audit, batch 3). Each reads the real source and asserts the
 * fix is still present so a future edit can't silently undo it.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('Withdraw button sends the field the endpoint requires', () => {
  const src = () => read('app/my-applications/page.tsx');
  it('posts applicationId, not jobId', () => {
    expect(src()).toMatch(/JSON\.stringify\(\{ applicationId \}\)/);
    expect(src()).not.toMatch(/JSON\.stringify\(\{ jobId \}\)/);
  });
  it('surfaces an error instead of failing silently', () => {
    expect(src()).toContain('setWithdrawError(');
    expect(src()).not.toContain('// Silently fail');
  });
});

describe('job edit re-derives the computed columns the app reads', () => {
  const src = () => read('app/api/jobs/update/route.ts');
  it('imports and calls the same derivation helpers as the create paths', () => {
    expect(src()).toContain("from '@/lib/salary-normalizer'");
    expect(src()).toContain("from '@/lib/salary-display'");
    expect(src()).toContain("from '@/lib/location-parser'");
  });
  it('persists every derived column in the job.update', () => {
    for (const field of [
      'normalizedMinSalary', 'normalizedMaxSalary', 'salaryIsEstimated',
      'salaryConfidence', 'displaySalary', 'city:', 'state:', 'stateCode:',
      'isRemote:', 'isHybrid:',
    ]) {
      expect(src(), `job.update must write ${field}`).toContain(field);
    }
  });
});

describe('pSEO internal links only target pages that clear the render gate', () => {
  it('category-city template gates sibling-category and nearby-city links at MIN_JOBS_FOR_CATEGORY_CITY', () => {
    const src = read('lib/pseo/category-city-template.tsx');
    expect(src).toContain('MIN_JOBS_FOR_CATEGORY_CITY } from \'./render-gate\'');
    expect(src).toMatch(/totalJobs: \{ gte: MIN_JOBS_FOR_CATEGORY_CITY \}/);
    // no remaining gte: 1 gates on category-city link queries
    const categoryCityGte1 = src.match(/type: 'category-city',[\s\S]{0,200}?totalJobs: \{ gte: 1 \}/g) || [];
    expect(categoryCityGte1).toHaveLength(0);
  });
  it('exploreCards never blindly append /city/ — resolved through the gate', () => {
    const src = read('lib/pseo/category-city-template.tsx');
    expect(src).toContain('exploreCardLinks');
    expect(src).not.toMatch(/c\.href\.includes\('\/city\/'\) \? c\.href : `\$\{c\.href\}\/city\//);
  });
  it('state-page Top Cities links gate at MIN_JOBS_FOR_CATEGORY_CITY', () => {
    const src = read('lib/pseo/setting-state-template.tsx');
    expect(src).toContain("MIN_JOBS_FOR_CATEGORY_CITY } from './render-gate'");
    expect(src).toMatch(/totalJobs: \{ gte: MIN_JOBS_FOR_CATEGORY_CITY \}/);
  });
  it('CategoryLocationsExplore city links gate at MIN_JOBS_FOR_CATEGORY_CITY (state links stay gte 1)', () => {
    const src = read('components/seo/CategoryLocationsExplore.tsx');
    const cityBlock = src.match(/type: 'category-city',[\s\S]{0,300}?totalJobs: \{ gte: (\w+) \}/);
    expect(cityBlock?.[1]).toBe('MIN_JOBS_FOR_CATEGORY_CITY');
    const stateBlock = src.match(/type: 'setting-state',[\s\S]{0,300}?totalJobs: \{ gte: (\w+) \}/);
    expect(stateBlock?.[1]).toBe('1');
  });
});

describe('index-pseo cron submits only pages its own render gate serves', () => {
  const src = () => read('app/api/cron/index-pseo/route.ts');
  it('sources candidates from category-city pseoStats, not city-wide groupBy', () => {
    expect(src()).toMatch(/type: 'category-city'/);
    expect(src()).not.toMatch(/prisma\.job\.groupBy/);
  });
  it('applies the job-count and freshness gates', () => {
    expect(src()).toMatch(/totalJobs: \{ gte: MIN_JOBS \}/);
    expect(src()).toMatch(/updatedAt: \{ gte: freshnessThreshold \}/);
  });
});
