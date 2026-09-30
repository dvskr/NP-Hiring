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
  MIN_POSTINGS_FOR_LISTING_INDEX,
  MIN_EMPLOYERS_FOR_LISTING_INDEX,
  MIN_JOBS_FOR_STATE_HUB_INDEX,
  MIN_EMPLOYERS_FOR_STATE_HUB_INDEX,
  MIN_DATA_SECTIONS_FOR_STATE_HUB_INDEX,
  MIN_JOBS_FOR_METRO_INDEX,
  MIN_RECENT_POSTINGS_FOR_METRO_INDEX,
  MIN_LINKABLE_CITIES_FOR_DIRECTORY_INDEX,
  MIN_ACTIVE_JOBS_FOR_COMPANY_INDEX,
  MIN_JOBS_FOR_LINK_LIST_ROW,
  MIN_POSTINGS_FOR_SETTING_STATE_INDEX,
  MIN_EMPLOYERS_FOR_SETTING_STATE_INDEX,
  MIN_ROLE_CLUSTERS_FOR_SETTING_STATE_INDEX,
  MAX_TOP_EMPLOYER_SHARE_FOR_SETTING_STATE_INDEX,
  MAX_HUB_SHARE_FOR_SETTING_STATE_INDEX,
  SETTING_STATE_INDEXING_ENABLED,
  STRUCTURED_REMOTE_SETTING_SLUGS,
  PSEO_STATS_MAX_AGE_HOURS,
  PSEO_STATS_MAX_AGE_MS,
  isPseoStatsFresh,
  pseoStatsFreshnessThreshold,
  shouldRenderCategoryCity,
  shouldIndexListingPage,
  meetsListingFloor,
  shouldIndexCategoryLanding,
  shouldIndexSettingState,
  isSettingStateIndexable,
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

  it('the count half and the link-list floor are the category x city render floor', () => {
    expect(MIN_JOBS_FOR_INDEX).toBe(MIN_JOBS_FOR_CATEGORY_CITY);
    expect(MIN_JOBS_FOR_LINK_LIST_ROW).toBe(MIN_JOBS_FOR_CATEGORY_CITY);
  });

  it('the listing floor is 5 distinct postings from 3 employers (indexing audit fixSoon 1)', () => {
    expect(MIN_POSTINGS_FOR_LISTING_INDEX).toBe(5);
    expect(MIN_EMPLOYERS_FOR_LISTING_INDEX).toBe(3);
    // The index floor sits above the render floor, never below it.
    expect(MIN_POSTINGS_FOR_LISTING_INDEX).toBeGreaterThan(MIN_JOBS_FOR_CATEGORY_CITY);
  });

  it('every other floor matches the PLAN C.2 table as raised by the audit', () => {
    expect(MIN_JOBS_FOR_STATE_HUB_INDEX).toBe(5);
    expect(MIN_EMPLOYERS_FOR_STATE_HUB_INDEX).toBe(3);
    expect(MIN_DATA_SECTIONS_FOR_STATE_HUB_INDEX).toBe(4);
    expect(MIN_JOBS_FOR_METRO_INDEX).toBe(3);
    expect(MIN_RECENT_POSTINGS_FOR_METRO_INDEX).toBe(1);
    expect(MIN_LINKABLE_CITIES_FOR_DIRECTORY_INDEX).toBe(5);
    expect(MIN_ACTIVE_JOBS_FOR_COMPANY_INDEX).toBe(5);
  });

  it('the strict setting x state gate carries the CQ-01 thresholds', () => {
    expect(MIN_POSTINGS_FOR_SETTING_STATE_INDEX).toBe(5);
    expect(MIN_EMPLOYERS_FOR_SETTING_STATE_INDEX).toBe(3);
    expect(MIN_ROLE_CLUSTERS_FOR_SETTING_STATE_INDEX).toBe(3);
    expect(MAX_TOP_EMPLOYER_SHARE_FOR_SETTING_STATE_INDEX).toBe(0.5);
    expect(MAX_HUB_SHARE_FOR_SETTING_STATE_INDEX).toBe(0.7);
    expect([...STRUCTURED_REMOTE_SETTING_SLUGS].sort()).toEqual(['remote', 'telehealth']);
  });

  it('FB-1: setting x state indexing ships switched off', () => {
    expect(SETTING_STATE_INDEXING_ENABLED).toBe(false);
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

describe('shouldIndexListingPage (the count half only)', () => {
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

describe('meetsListingFloor and shouldIndexCategoryLanding (CQ-06, fixSoon 1)', () => {
  it.each([
    [5, 3, true],
    [4, 3, false],
    [5, 2, false],
    [16, 2, false],
    [3, 1, false],
    [50, 9, true],
  ])('postings=%i employers=%i -> %s', (activeJobs, distinctEmployers, expected) => {
    expect(meetsListingFloor({ activeJobs, distinctEmployers })).toBe(expected);
    expect(shouldIndexCategoryLanding({ activeJobs, distinctEmployers })).toBe(expected);
  });

  it('a landing indexes only on page 1', () => {
    expect(shouldIndexCategoryLanding({ activeJobs: 50, distinctEmployers: 9, page: 2 })).toBe(false);
  });

  it('a non-finite count gates closed', () => {
    expect(meetsListingFloor({ activeJobs: Number.NaN, distinctEmployers: 5 })).toBe(false);
    expect(meetsListingFloor({ activeJobs: 9, distinctEmployers: Number.NaN })).toBe(false);
  });
});

describe('shouldIndexSettingState (the strict category x state gate, CQ-01)', () => {
  /** Eight postings from four employers in five roles; the hub is indexable and three times larger. */
  const PASSING: SettingStateIndexFacts = {
    postings: 8,
    employers: 4,
    roleClusters: 5,
    topEmployerPostings: 3,
    hubIndexable: true,
    hubPostings: 24,
    postedLast30Days: 2,
  };

  it('a page that clears every condition indexes', () => {
    expect(shouldIndexSettingState(PASSING)).toBe(true);
  });

  it('3 jobs from 1 employer in 3 cities, all recent, does not index (the old gate passed it)', () => {
    expect(shouldIndexSettingState({
      postings: 3,
      employers: 1,
      roleClusters: 1,
      topEmployerPostings: 3,
      hubIndexable: true,
      hubPostings: 40,
      postedLast30Days: 3,
    })).toBe(false);
  });

  it('a setting whose jobs are its noindex hub does not index (Utah, Rhode Island)', () => {
    expect(shouldIndexSettingState({ ...PASSING, hubIndexable: false, hubPostings: 8 })).toBe(false);
    // Even an indexable hub: a setting holding every hub job is the hub again.
    expect(shouldIndexSettingState({ ...PASSING, hubPostings: 8 })).toBe(false);
  });

  it.each<[string, Partial<SettingStateIndexFacts>]>([
    ['4 postings', { postings: 4, topEmployerPostings: 2, hubPostings: 24 }],
    ['2 employers', { employers: 2 }],
    ['2 role clusters', { roleClusters: 2 }],
    ['top employer above half', { topEmployerPostings: 5 }],
    ['parent hub noindex', { hubIndexable: false }],
    ['more than 70 percent of the hub', { hubPostings: 11 }],
    ['no hub postings', { hubPostings: 0 }],
    // Skeptic 2's hard requirement: /jobs/1099/massachusetts passed the old
    // gate with four postings, the newest 39 days old.
    ['no posting in the last 30 days', { postedLast30Days: 0 }],
    ['an unknown recency', { postedLast30Days: Number.NaN }],
  ])('fails on %s', (_label, over) => {
    expect(shouldIndexSettingState({ ...PASSING, ...over })).toBe(false);
  });

  it('sits exactly on each boundary and passes', () => {
    expect(shouldIndexSettingState({
      postings: 5,
      employers: 3,
      roleClusters: 3,
      // 2 of 5 is 40 percent; 50 percent needs an even count, below.
      topEmployerPostings: 2,
      hubIndexable: true,
      hubPostings: 8, // 5 of 8 is 62.5 percent
      postedLast30Days: 1,
    })).toBe(true);
    expect(shouldIndexSettingState({ ...PASSING, postings: 10, topEmployerPostings: 5, hubPostings: 100 })).toBe(true);
    expect(shouldIndexSettingState({ ...PASSING, postings: 7, topEmployerPostings: 3, hubPostings: 10 })).toBe(true);
  });

  it('page 2 never indexes', () => {
    expect(shouldIndexSettingState(PASSING, 2)).toBe(false);
  });
});

describe('isSettingStateIndexable (the FB-1 switch over the stored verdict)', () => {
  it('nothing indexes while the switch is off, whatever the stored verdict', () => {
    expect(isSettingStateIndexable(true)).toBe(false);
    expect(isSettingStateIndexable(false)).toBe(false);
  });

  it('once switched on, the stored verdict decides', () => {
    expect(isSettingStateIndexable(true, true)).toBe(true);
    expect(isSettingStateIndexable(false, true)).toBe(false);
  });
});

describe('shouldIndexLocalListingPage (category x city and city, the listing floor)', () => {
  it.each([
    [3, 2, 1, false],
    [4, 3, 1, false],
    [5, 2, 1, false],
    [5, 3, 1, true],
    [19, 7, 1, true],
    [5, 3, 2, false],
    [0, 0, 1, false],
  ])('postings=%i employers=%i page=%i -> %s', (activeJobs, distinctEmployers, page, expected) => {
    expect(shouldIndexLocalListingPage({ activeJobs, distinctEmployers, page })).toBe(expected);
  });

  it('page defaults to 1', () => {
    expect(shouldIndexLocalListingPage({ activeJobs: 5, distinctEmployers: 3 })).toBe(true);
  });
});

describe('shouldIndexStateHub (CQ-07)', () => {
  it.each([
    [4, 3, 4, 1, false],
    [5, 2, 4, 1, false],
    [5, 3, 3, 1, false],
    [5, 3, 4, 1, true],
    [42, 9, 7, 1, true],
    [42, 9, 4, 2, false],
  ])('postings=%i employers=%i sections=%i page=%i -> %s', (activeJobs, distinctEmployers, liveDataSections, page, expected) => {
    expect(shouldIndexStateHub({ activeJobs, distinctEmployers, liveDataSections, page })).toBe(expected);
  });

  it('page defaults to 1', () => {
    expect(shouldIndexStateHub({ activeJobs: 5, distinctEmployers: 3, liveDataSections: 4 })).toBe(true);
  });

  it('an absent employer count gates closed, so a caller that omits it can only under-list', () => {
    expect(shouldIndexStateHub({ activeJobs: 42, liveDataSections: 7 })).toBe(false);
  });
});

describe('shouldIndexStateCityDirectory (FB-1, M-05)', () => {
  it.each([
    [0, false],
    [3, false],
    [4, false],
    [5, true],
    [12, true],
  ])('linkableCities=%i -> %s', (linkableCities, expected) => {
    expect(shouldIndexStateCityDirectory({ linkableCities })).toBe(expected);
  });
});

describe('shouldIndexMetro (CQ-08 recency)', () => {
  it.each([
    [0, 0, false],
    [2, 2, false],
    [3, 0, false],
    [3, 1, true],
    [40, 12, true],
  ])('postings=%i postedLast30Days=%i -> %s', (activeJobs, postedLast30Days, expected) => {
    expect(shouldIndexMetro({ activeJobs, postedLast30Days })).toBe(expected);
  });

  it('an absent recency count gates closed', () => {
    expect(shouldIndexMetro({ activeJobs: 40 })).toBe(false);
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
