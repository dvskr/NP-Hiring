/**
 * Truth tables for every pSEO render and index gate in lib/pseo/render-gate.ts
 * (PLAN C.2), pinned at their boundaries, plus the PseoStats index-gate
 * migration shape (additive only, defaults on every column).
 *
 * The gates are pure functions over plain numbers, so these tests need no
 * database, no Next.js and no Prisma client.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  MIN_JOBS_FOR_CATEGORY_CITY,
  MIN_JOBS_FOR_INDEX,
  MIN_EMPLOYERS_FOR_INDEX,
  MIN_SETTING_STATE_INDEX_SIGNALS,
  MIN_JOBS_FOR_STATE_HUB_INDEX,
  MIN_DATA_SECTIONS_FOR_STATE_HUB_INDEX,
  MIN_JOBS_FOR_METRO_INDEX,
  MIN_LINKABLE_CITIES_FOR_DIRECTORY_INDEX,
  MIN_ACTIVE_JOBS_FOR_COMPANY_INDEX,
  MIN_JOBS_FOR_LINK_LIST_ROW,
  PSEO_STATS_MAX_AGE_HOURS,
  PSEO_STATS_MAX_AGE_MS,
  isPseoStatsFresh,
  pseoStatsFreshnessThreshold,
  shouldRenderCategoryCity,
  shouldIndexListingPage,
  shouldIndexSettingState,
  countSettingStateIndexSignals,
  shouldIndexLocalListingPage,
  shouldIndexStateHub,
  shouldIndexStateCityDirectory,
  shouldIndexMetro,
  shouldIndexSalaryGuideState,
  shouldIndexCompanyProfile,
  shouldRenderMarketSnapshot,
  type SettingStateIndexFacts,
} from '@/lib/pseo/render-gate';

const ROOT = process.cwd();
const MIGRATION_DIR = 'prisma/migrations/20260916120000_pseo_stats_index_gate';

describe('thresholds', () => {
  it('MIN_JOBS_FOR_CATEGORY_CITY stays pinned at 3 (owner decision, do not raise or lower)', () => {
    expect(MIN_JOBS_FOR_CATEGORY_CITY).toBe(3);
  });

  it('the listing index floor and the link-list floor are the category x city floor', () => {
    expect(MIN_JOBS_FOR_INDEX).toBe(MIN_JOBS_FOR_CATEGORY_CITY);
    expect(MIN_JOBS_FOR_LINK_LIST_ROW).toBe(MIN_JOBS_FOR_CATEGORY_CITY);
  });

  it('every other floor matches the PLAN C.2 table', () => {
    expect(MIN_EMPLOYERS_FOR_INDEX).toBe(2);
    expect(MIN_SETTING_STATE_INDEX_SIGNALS).toBe(2);
    expect(MIN_JOBS_FOR_STATE_HUB_INDEX).toBe(3);
    expect(MIN_DATA_SECTIONS_FOR_STATE_HUB_INDEX).toBe(4);
    expect(MIN_JOBS_FOR_METRO_INDEX).toBe(3);
    expect(MIN_LINKABLE_CITIES_FOR_DIRECTORY_INDEX).toBe(3);
    expect(MIN_ACTIVE_JOBS_FOR_COMPANY_INDEX).toBe(5);
  });

  it('shouldRenderCategoryCity still gates at 3', () => {
    expect(shouldRenderCategoryCity(2)).toBe(false);
    expect(shouldRenderCategoryCity(3)).toBe(true);
  });
});

describe('PseoStats freshness', () => {
  it('the window is 36 hours', () => {
    expect(PSEO_STATS_MAX_AGE_HOURS).toBe(36);
    expect(PSEO_STATS_MAX_AGE_MS).toBe(36 * 60 * 60 * 1000);
  });

  it('a row is fresh up to and including 36h and stale one millisecond later', () => {
    const now = Date.UTC(2026, 8, 16, 12, 0, 0);
    expect(isPseoStatsFresh(new Date(now - PSEO_STATS_MAX_AGE_MS), now)).toBe(true);
    expect(isPseoStatsFresh(new Date(now - PSEO_STATS_MAX_AGE_MS - 1), now)).toBe(false);
    expect(isPseoStatsFresh(new Date(now), now)).toBe(true);
  });

  it('the Prisma threshold is exactly now minus the window', () => {
    const now = Date.UTC(2026, 8, 16, 12, 0, 0);
    expect(pseoStatsFreshnessThreshold(now).getTime()).toBe(now - PSEO_STATS_MAX_AGE_MS);
  });
});

describe('shouldIndexListingPage (category landing, count half of every listing page)', () => {
  it.each([
    [0, 1, false],
    [2, 1, false],
    [3, 1, true],
    [50, 1, true],
    [3, 2, false],
    [50, 2, false],
    [3, 0, false],
  ])('jobs=%i page=%i -> %s', (jobs, page, expected) => {
    expect(shouldIndexListingPage(jobs, page)).toBe(expected);
  });

  it('defaults to page 1', () => {
    expect(shouldIndexListingPage(3)).toBe(true);
  });

  it('a non-finite count gates closed', () => {
    expect(shouldIndexListingPage(Number.NaN)).toBe(false);
  });
});

describe('shouldIndexSettingState (category x state)', () => {
  const NONE: SettingStateIndexFacts = {
    totalJobs: 3,
    employerCount: 1,
    namedCityCount: 1,
    hasBenchmark: false,
    postedLast30Days: 0,
    roleSetupRenders: false,
  };

  it('3 jobs with zero signals does not index', () => {
    expect(countSettingStateIndexSignals(NONE)).toBe(0);
    expect(shouldIndexSettingState(NONE)).toBe(false);
  });

  it('3 jobs with one signal does not index', () => {
    expect(shouldIndexSettingState({ ...NONE, employerCount: 2 })).toBe(false);
    expect(shouldIndexSettingState({ ...NONE, hasBenchmark: true })).toBe(false);
  });

  it.each<[string, Partial<SettingStateIndexFacts>]>([
    ['employers + cities', { employerCount: 2, namedCityCount: 2 }],
    ['employers + benchmark', { employerCount: 2, hasBenchmark: true }],
    ['cities + recency', { namedCityCount: 2, postedLast30Days: 1 }],
    ['benchmark + role setup', { hasBenchmark: true, roleSetupRenders: true }],
    ['recency + role setup', { postedLast30Days: 1, roleSetupRenders: true }],
  ])('3 jobs with two signals (%s) indexes', (_label, facts) => {
    expect(shouldIndexSettingState({ ...NONE, ...facts })).toBe(true);
  });

  it('counts each signal at its own floor', () => {
    expect(countSettingStateIndexSignals({ ...NONE, employerCount: 2, namedCityCount: 2, postedLast30Days: 1 })).toBe(3);
    expect(countSettingStateIndexSignals({
      ...NONE, employerCount: 2, namedCityCount: 2, hasBenchmark: true, postedLast30Days: 1, roleSetupRenders: true,
    })).toBe(5);
  });

  it('all five signals cannot rescue 2 jobs', () => {
    const rich: SettingStateIndexFacts = {
      totalJobs: 2,
      employerCount: 2,
      namedCityCount: 2,
      hasBenchmark: true,
      postedLast30Days: 5,
      roleSetupRenders: true,
    };
    expect(shouldIndexSettingState(rich)).toBe(false);
  });

  it('page 2 never indexes', () => {
    expect(shouldIndexSettingState({ ...NONE, employerCount: 2, namedCityCount: 2 }, 2)).toBe(false);
  });
});

describe('shouldIndexLocalListingPage (category x city and city)', () => {
  it.each([
    [2, 2, 1, false],
    [3, 1, 1, false],
    [3, 2, 1, true],
    [10, 1, 1, false],
    [10, 2, 1, true],
    [3, 2, 2, false],
    [0, 0, 1, false],
  ])('jobs=%i employers=%i page=%i -> %s', (activeJobs, distinctEmployers, page, expected) => {
    expect(shouldIndexLocalListingPage({ activeJobs, distinctEmployers, page })).toBe(expected);
  });

  it('page defaults to 1', () => {
    expect(shouldIndexLocalListingPage({ activeJobs: 3, distinctEmployers: 2 })).toBe(true);
  });
});

describe('shouldIndexStateHub', () => {
  it.each([
    [2, 4, 1, false],
    [3, 3, 1, false],
    [3, 4, 1, true],
    [3, 7, 1, true],
    [100, 4, 1, true],
    [100, 3, 1, false],
    [3, 4, 2, false],
  ])('jobs=%i sections=%i page=%i -> %s', (activeJobs, liveDataSections, page, expected) => {
    expect(shouldIndexStateHub({ activeJobs, liveDataSections, page })).toBe(expected);
  });

  it('page defaults to 1', () => {
    expect(shouldIndexStateHub({ activeJobs: 3, liveDataSections: 4 })).toBe(true);
  });
});

describe('shouldIndexStateCityDirectory', () => {
  it.each([
    [0, false],
    [2, false],
    [3, true],
    [12, true],
  ])('linkableCities=%i -> %s', (linkableCities, expected) => {
    expect(shouldIndexStateCityDirectory({ linkableCities })).toBe(expected);
  });
});

describe('shouldIndexMetro', () => {
  it.each([
    [0, false],
    [2, false],
    [3, true],
    [40, true],
  ])('activeJobs=%i -> %s', (activeJobs, expected) => {
    expect(shouldIndexMetro({ activeJobs })).toBe(expected);
  });
});

describe('shouldIndexSalaryGuideState', () => {
  it.each([
    [0, true, false],
    [0, false, false],
    [1, false, false],
    [1, true, true],
    [40, false, false],
    [40, true, true],
  ])('activeJobs=%i gatePassed=%s -> %s', (activeJobs, salaryGatePassed, expected) => {
    expect(shouldIndexSalaryGuideState({ activeJobs, salaryGatePassed })).toBe(expected);
  });
});

describe('shouldIndexCompanyProfile', () => {
  it.each([
    [0, false],
    [1, false],
    [4, false],
    [5, true],
    [8, true],
  ])('activeJobs=%i -> %s', (activeJobs, expected) => {
    expect(shouldIndexCompanyProfile(activeJobs)).toBe(expected);
  });
});

describe('shouldRenderMarketSnapshot', () => {
  it('renders at 1 or more jobs and never at 0', () => {
    expect(shouldRenderMarketSnapshot(0)).toBe(false);
    expect(shouldRenderMarketSnapshot(1)).toBe(true);
  });
});

describe('PseoStats index-gate migration', () => {
  const sql = fs.readFileSync(path.join(ROOT, MIGRATION_DIR, 'migration.sql'), 'utf8');

  /** Statements with comment lines removed and whitespace collapsed. */
  const statements = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  it('contains only ALTER TABLE "PseoStats" ADD COLUMN clauses, each with a default', () => {
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) {
      expect(statement).toMatch(/^ALTER TABLE "PseoStats" ADD COLUMN /);
      const clauses = statement.replace(/^ALTER TABLE "PseoStats" /, '').split(/,\s*(?=ADD COLUMN)/);
      for (const clause of clauses) {
        expect(clause).toMatch(/^ADD COLUMN "\w+" \w+ NOT NULL DEFAULT \S+$/);
      }
    }
  });

  it('never drops, renames, rewrites or creates anything', () => {
    const body = statements.join(';');
    expect(body).not.toMatch(/\b(DROP|RENAME|CREATE|TRUNCATE|DELETE|UPDATE|ALTER COLUMN)\b/i);
  });

  it('adds exactly distinctEmployers (INTEGER, 0) and indexable (BOOLEAN, false)', () => {
    const body = statements.join(';');
    expect(body).toContain('ADD COLUMN "distinctEmployers" INTEGER NOT NULL DEFAULT 0');
    expect(body).toContain('ADD COLUMN "indexable" BOOLEAN NOT NULL DEFAULT false');
    expect(body.match(/ADD COLUMN/g)).toHaveLength(2);
  });

  it('schema.prisma declares the same two columns with the same defaults on PseoStats', () => {
    const schema = fs.readFileSync(path.join(ROOT, 'prisma/schema.prisma'), 'utf8');
    const model = schema.match(/model PseoStats \{([\s\S]*?)\n\}/);
    expect(model).not.toBeNull();
    const body = model?.[1] ?? '';
    expect(body).toMatch(/^\s*distinctEmployers\s+Int\s+@default\(0\)\s*$/m);
    expect(body).toMatch(/^\s*indexable\s+Boolean\s+@default\(false\)\s*$/m);
  });
});
